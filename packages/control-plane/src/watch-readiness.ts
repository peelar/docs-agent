import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { withDocsAgentDatabase } from "./db/client.ts";
import {
  policyBoundWatches,
  watchEffectiveRevisions,
  watchPolicyRevisions,
} from "./db/schema.ts";
import { DEFAULT_WORKSPACE_ID } from "./setup-state.ts";
import {
  proposedWatchPolicySchema,
  watchLifecycleStateSchema,
} from "./watch-contract.ts";
import { previewWatchPolicy, WatchPolicyValidationError } from "./watch-policy-preview.ts";
import {
  availableWatchCapabilities,
  requireWatchServiceReady,
  WatchServiceUnavailableError,
} from "./watch-service-readiness.ts";

export const watchReadinessStatusSchema = z.enum([
  "unavailable",
  "invalid",
  "proposed",
  "paused",
  "expired",
  "active",
  "deleted",
]);

export const watchReadinessIssueCodeSchema = z.enum([
  "storage-unavailable",
  "workspace-setup-unavailable",
  "capability-registry-unavailable",
  "watch-state-missing",
  "proposal-missing",
  "effective-revision-missing",
  "persisted-policy-invalid",
  "effective-policy-invalid",
]);

export const watchReadinessSchema = z.object({
  watchId: z.string().uuid(),
  status: watchReadinessStatusSchema,
  lifecycleState: watchLifecycleStateSchema.nullable(),
  usable: z.boolean(),
  effectiveRevisionId: z.string().uuid().nullable(),
  summary: z.string().min(1),
  issues: z.array(z.object({
    code: watchReadinessIssueCodeSchema,
    summary: z.string().min(1),
  }).strict()),
  checkedAt: z.string().datetime({ offset: true }),
}).strict();

export type WatchReadiness = z.infer<typeof watchReadinessSchema>;

export async function getWatchReadiness(
  input: { watchId: string },
  context: unknown,
): Promise<WatchReadiness> {
  const parsedInput = z.object({ watchId: z.string().uuid() }).strict().parse(input);
  const checkedAt = contextNow(context).toISOString();
  let readyContext;
  try {
    readyContext = await requireWatchServiceReady(context);
  } catch (error) {
    const code = error instanceof WatchServiceUnavailableError
      ? error.code
      : "storage-unavailable";
    return project({
      watchId: parsedInput.watchId,
      status: "unavailable",
      lifecycleState: null,
      usable: false,
      effectiveRevisionId: null,
      summary: "Watch state is unavailable because a required readiness dependency failed.",
      issues: [{ code, summary: unavailableSummary(code) }],
      checkedAt,
    });
  }

  try {
    return await withDocsAgentDatabase(async (db) => {
      const watchRows = await db
        .select()
        .from(policyBoundWatches)
        .where(and(
          eq(policyBoundWatches.workspaceId, DEFAULT_WORKSPACE_ID),
          eq(policyBoundWatches.id, parsedInput.watchId),
        ))
        .limit(1);
      const watch = watchRows[0];
      if (watch === undefined) {
        return invalid(parsedInput.watchId, checkedAt, null, null, {
          code: "watch-state-missing",
          summary: "The requested watch state does not exist.",
        });
      }

      const lifecycle = watchLifecycleStateSchema.safeParse(watch.lifecycleState);
      if (!lifecycle.success) {
        return invalid(parsedInput.watchId, checkedAt, null, null, {
          code: "persisted-policy-invalid",
          summary: "The persisted watch lifecycle state is invalid.",
        });
      }
      if (lifecycle.data === "deleted") {
        return project({
          watchId: watch.id,
          status: "deleted",
          lifecycleState: "deleted",
          usable: false,
          effectiveRevisionId: null,
          summary: "The watch is deleted and retains no policy authority.",
          issues: [],
          checkedAt,
        });
      }

      const policyRecord = watch.effectiveRevisionId === null
        ? await readLatestProposal(db, watch.id)
        : await readEffectiveRevision(db, watch.id, watch.effectiveRevisionId);
      if (policyRecord === undefined) {
        return invalid(watch.id, checkedAt, lifecycle.data, watch.effectiveRevisionId, {
          code: watch.effectiveRevisionId === null
            ? "proposal-missing"
            : "effective-revision-missing",
          summary: watch.effectiveRevisionId === null
            ? "The watch has no persisted proposal revision."
            : "The watch references an unavailable effective revision.",
        });
      }

      const parsedPolicy = proposedWatchPolicySchema.safeParse(policyRecord.policy);
      if (!parsedPolicy.success) {
        return invalid(watch.id, checkedAt, lifecycle.data, watch.effectiveRevisionId, {
          code: "persisted-policy-invalid",
          summary: "The persisted watch policy does not match the supported contract.",
        });
      }
      const expiresAt = parsedPolicy.data.expiresAt;
      if (
        lifecycle.data === "expired" ||
        expiresAt === null ||
        new Date(expiresAt).getTime() <= new Date(checkedAt).getTime()
      ) {
        return project({
          watchId: watch.id,
          status: "expired",
          lifecycleState: lifecycle.data,
          usable: false,
          effectiveRevisionId: watch.effectiveRevisionId,
          summary: "The watch policy has expired and cannot admit work.",
          issues: [],
          checkedAt,
        });
      }

      try {
        previewWatchPolicy({
          contractVersion: policyRecord.contractVersion,
          lifecycleState: "proposed",
          policy: parsedPolicy.data,
        }, {
          availableCapabilities: availableWatchCapabilities(readyContext),
          now: new Date(checkedAt),
        });
      } catch (error) {
        if (error instanceof WatchPolicyValidationError) {
          return invalid(watch.id, checkedAt, lifecycle.data, watch.effectiveRevisionId, {
            code: "effective-policy-invalid",
            summary: "The persisted policy is incompatible with current watch authority.",
          });
        }
        throw error;
      }

      if (lifecycle.data === "active" && watch.effectiveRevisionId !== null) {
        return project({
          watchId: watch.id,
          status: "active",
          lifecycleState: "active",
          usable: true,
          effectiveRevisionId: watch.effectiveRevisionId,
          summary: "The watch has a valid active effective revision.",
          issues: [],
          checkedAt,
        });
      }
      if (lifecycle.data === "paused" && watch.effectiveRevisionId !== null) {
        return project({
          watchId: watch.id,
          status: "paused",
          lifecycleState: "paused",
          usable: false,
          effectiveRevisionId: watch.effectiveRevisionId,
          summary: "The watch is paused and cannot admit work.",
          issues: [],
          checkedAt,
        });
      }
      if (lifecycle.data === "proposed" && watch.effectiveRevisionId === null) {
        return project({
          watchId: watch.id,
          status: "proposed",
          lifecycleState: "proposed",
          usable: false,
          effectiveRevisionId: null,
          summary: "The watch is proposed and has no approved authority.",
          issues: [],
          checkedAt,
        });
      }
      return invalid(watch.id, checkedAt, lifecycle.data, watch.effectiveRevisionId, {
        code: "effective-revision-missing",
        summary: "The persisted lifecycle and effective revision do not form a valid watch state.",
      });
    });
  } catch {
    return project({
      watchId: parsedInput.watchId,
      status: "unavailable",
      lifecycleState: null,
      usable: false,
      effectiveRevisionId: null,
      summary: "Watch state is unavailable because required persistence could not be read.",
      issues: [{
        code: "storage-unavailable",
        summary: "The app-owned watch store is unavailable or behind the required schema.",
      }],
      checkedAt,
    });
  }
}

type Executor = Parameters<Parameters<typeof withDocsAgentDatabase>[0]>[0];

async function readLatestProposal(db: Executor, watchId: string) {
  return (await db
    .select({
      contractVersion: watchPolicyRevisions.contractVersion,
      policy: watchPolicyRevisions.policy,
    })
    .from(watchPolicyRevisions)
    .where(and(
      eq(watchPolicyRevisions.workspaceId, DEFAULT_WORKSPACE_ID),
      eq(watchPolicyRevisions.watchId, watchId),
    ))
    .orderBy(desc(watchPolicyRevisions.revision))
    .limit(1))[0];
}

async function readEffectiveRevision(db: Executor, watchId: string, id: string) {
  return (await db
    .select({
      contractVersion: watchEffectiveRevisions.contractVersion,
      policy: watchEffectiveRevisions.policy,
    })
    .from(watchEffectiveRevisions)
    .where(and(
      eq(watchEffectiveRevisions.workspaceId, DEFAULT_WORKSPACE_ID),
      eq(watchEffectiveRevisions.watchId, watchId),
      eq(watchEffectiveRevisions.id, id),
    ))
    .limit(1))[0];
}

function invalid(
  watchId: string,
  checkedAt: string,
  lifecycleState: z.infer<typeof watchLifecycleStateSchema> | null,
  effectiveRevisionId: string | null,
  issue: z.input<typeof watchReadinessSchema>["issues"][number],
): WatchReadiness {
  return project({
    watchId,
    status: "invalid",
    lifecycleState,
    usable: false,
    effectiveRevisionId,
    summary: "The persisted watch state is invalid and cannot admit work.",
    issues: [issue],
    checkedAt,
  });
}

function project(input: z.input<typeof watchReadinessSchema>): WatchReadiness {
  return watchReadinessSchema.parse(input);
}

function contextNow(context: unknown): Date {
  if (typeof context === "object" && context !== null && "now" in context) {
    const now = (context as { now?: unknown }).now;
    if (now instanceof Date && !Number.isNaN(now.getTime())) return now;
  }
  return new Date();
}

function unavailableSummary(
  code: WatchServiceUnavailableError["code"] | "storage-unavailable",
): string {
  if (code === "workspace-setup-unavailable") {
    return "Canonical workspace setup is missing or invalid.";
  }
  if (code === "capability-registry-unavailable") {
    return "The server-owned watch capability registry is missing or invalid.";
  }
  return "The app-owned watch store is unavailable or behind the required schema.";
}
