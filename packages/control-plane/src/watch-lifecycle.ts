import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import {
  withDocsAgentDatabase,
  type DocsAgentDatabase,
} from "./db/client.ts";
import {
  policyBoundWatches,
  watchEffectiveRevisions,
  watchLifecycleEvents,
  watchPolicyRevisions,
} from "./db/schema.ts";
import { DEFAULT_WORKSPACE_ID } from "./setup-state.ts";
import {
  listPolicyBoundWatchesInputSchema,
  mutateWatchLifecycleInputSchema,
  mutateWatchLifecycleResultSchema,
  policyBoundWatchListItemSchema,
  proposedWatchPolicySchema,
  watchActorSchema,
  watchLifecycleEventSchema,
  type MutateWatchLifecycleResult,
  type PolicyBoundWatchListItem,
  type WatchLifecycleEvent,
} from "./watch-contract.ts";
import { previewWatchPolicy } from "./watch-policy-preview.ts";
import {
  availableWatchCapabilities,
  requireWatchServiceReady,
  type WatchServiceContext,
} from "./watch-service-readiness.ts";

export type WatchLifecycleContext = WatchServiceContext & {
  operator: z.input<typeof watchActorSchema>;
};

export async function listPolicyBoundWatches(
  input: z.input<typeof listPolicyBoundWatchesInputSchema> = {},
  context: WatchServiceContext,
): Promise<PolicyBoundWatchListItem[]> {
  const parsed = listPolicyBoundWatchesInputSchema.parse(input);
  const readyContext = await requireWatchServiceReady(context);
  const now = parsed.now ?? (readyContext.now ?? new Date()).toISOString();

  return withDocsAgentDatabase(async (db) => {
    const conditions = [eq(policyBoundWatches.workspaceId, DEFAULT_WORKSPACE_ID)];
    if (parsed.states !== undefined && parsed.states.length > 0) {
      conditions.push(inArray(policyBoundWatches.lifecycleState, parsed.states));
    }
    const rows = await db
      .select({ id: policyBoundWatches.id })
      .from(policyBoundWatches)
      .where(and(...conditions))
      .orderBy(desc(policyBoundWatches.updatedAt), asc(policyBoundWatches.id))
      .limit(parsed.limit);

    return Promise.all(rows.map(({ id }) =>
      readWatchListItem(
        db,
        id,
        now,
        availableWatchCapabilities(readyContext),
      )
    ));
  });
}

export async function mutateWatchLifecycle(
  input: z.input<typeof mutateWatchLifecycleInputSchema>,
  context: WatchLifecycleContext,
): Promise<MutateWatchLifecycleResult> {
  const parsed = mutateWatchLifecycleInputSchema.parse(input);
  const readyContext = await requireWatchServiceReady({
    capabilityRegistry: context.capabilityRegistry,
    now: context.now,
  });
  const operator = watchActorSchema.parse(context.operator);
  const occurredAt = (readyContext.now ?? new Date()).toISOString();

  const transition = await withDocsAgentDatabase(async (db) =>
    db.transaction(async (tx) => {
      const duplicate = await readLifecycleEventByOperation(
        tx,
        parsed.watchId,
        parsed.operationKey,
      );
      if (duplicate !== undefined) {
        if (duplicate.action !== parsed.action || duplicate.reason !== parsed.reason) {
          throw new Error(
            `Watch lifecycle operation ${parsed.operationKey} was already used for a different mutation.`,
          );
        }
        return {
          applied: false,
          replayed: true,
          event: projectEvent(duplicate),
        };
      }

      const watch = await readWatchIdentity(tx, parsed.watchId);
      if (watch === undefined) {
        throw new Error(`Policy-bound watch ${parsed.watchId} was not found.`);
      }
      if (watch.stateRevision !== parsed.expectedStateRevision) {
        throw new Error(
          `Watch ${parsed.watchId} changed concurrently. Expected state revision ${parsed.expectedStateRevision}, found ${watch.stateRevision}.`,
        );
      }

      const nextState = await resolveTransition(tx, watch, parsed.action, {
        availableCapabilities: availableWatchCapabilities(readyContext),
        now: readyContext.now,
      });
      const nextRevision = watch.stateRevision + 1;
      const nextEffectiveRevisionId = parsed.action === "delete"
        ? null
        : watch.effectiveRevisionId;
      const updated = await tx
        .update(policyBoundWatches)
        .set({
          lifecycleState: nextState,
          effectiveRevisionId: nextEffectiveRevisionId,
          stateRevision: nextRevision,
          updatedAt: occurredAt,
        })
        .where(and(
          eq(policyBoundWatches.id, parsed.watchId),
          eq(policyBoundWatches.workspaceId, DEFAULT_WORKSPACE_ID),
          eq(policyBoundWatches.lifecycleState, watch.lifecycleState),
          eq(policyBoundWatches.stateRevision, parsed.expectedStateRevision),
        ))
        .returning({ id: policyBoundWatches.id });
      if (updated.length === 0) {
        throw new Error(`Watch ${parsed.watchId} changed concurrently during mutation.`);
      }

      const event = watchLifecycleEventSchema.parse({
        id: randomUUID(),
        watchId: parsed.watchId,
        operationKey: parsed.operationKey,
        action: parsed.action,
        actor: operator,
        previousState: watch.lifecycleState,
        nextState,
        reason: parsed.reason,
        stateRevision: nextRevision,
        effectiveRevisionId: watch.effectiveRevisionId,
        occurredAt,
      });
      await tx.insert(watchLifecycleEvents).values({
        id: event.id,
        watchId: event.watchId,
        workspaceId: DEFAULT_WORKSPACE_ID,
        operationKey: event.operationKey,
        action: event.action,
        actorId: event.actor.id,
        actorLogin: event.actor.githubLogin,
        previousState: event.previousState,
        nextState: event.nextState,
        reason: event.reason,
        stateRevision: event.stateRevision,
        effectiveRevisionId: event.effectiveRevisionId,
        occurredAt: event.occurredAt,
      });

      if (parsed.action === "delete") {
        await tx
          .delete(watchEffectiveRevisions)
          .where(and(
            eq(watchEffectiveRevisions.workspaceId, DEFAULT_WORKSPACE_ID),
            eq(watchEffectiveRevisions.watchId, parsed.watchId),
          ));
        await tx
          .delete(watchPolicyRevisions)
          .where(and(
            eq(watchPolicyRevisions.workspaceId, DEFAULT_WORKSPACE_ID),
            eq(watchPolicyRevisions.watchId, parsed.watchId),
          ));
      }

      return { applied: true, replayed: false, event };
    })
  );

  return mutateWatchLifecycleResultSchema.parse({
    ...transition,
    watch: await getPolicyBoundWatchLifecycleItem({
      watchId: parsed.watchId,
      now: occurredAt,
    }, readyContext),
  });
}

export async function getPolicyBoundWatchLifecycleItem(input: {
  watchId: string;
  now?: string;
}, context: WatchServiceContext): Promise<PolicyBoundWatchListItem> {
  const parsed = z.object({
    watchId: z.string().uuid(),
    now: z.string().datetime({ offset: true }).optional(),
  }).strict().parse(input);
  const readyContext = await requireWatchServiceReady(context);
  return withDocsAgentDatabase((db) =>
    readWatchListItem(
      db,
      parsed.watchId,
      parsed.now ?? (readyContext.now ?? new Date()).toISOString(),
      availableWatchCapabilities(readyContext),
    )
  );
}

export async function listWatchLifecycleEvents(input: {
  watchId: string;
}): Promise<WatchLifecycleEvent[]> {
  const parsed = z.object({ watchId: z.string().uuid() }).strict().parse(input);
  return withDocsAgentDatabase(async (db) => {
    const rows = await db
      .select()
      .from(watchLifecycleEvents)
      .where(and(
        eq(watchLifecycleEvents.workspaceId, DEFAULT_WORKSPACE_ID),
        eq(watchLifecycleEvents.watchId, parsed.watchId),
      ))
      .orderBy(asc(watchLifecycleEvents.stateRevision), asc(watchLifecycleEvents.id));
    return rows.map(projectEvent);
  });
}

type Executor = Pick<
  DocsAgentDatabase,
  "select" | "insert" | "update" | "delete"
>;

async function resolveTransition(
  db: Executor,
  watch: NonNullable<Awaited<ReturnType<typeof readWatchIdentity>>>,
  action: z.output<typeof mutateWatchLifecycleInputSchema>["action"],
  context: {
    availableCapabilities: WatchServiceContext["capabilityRegistry"]["availableCapabilities"];
    now?: Date;
  },
) {
  if (action === "pause") {
    if (watch.lifecycleState !== "active") {
      throw new Error("Only an active watch can be paused.");
    }
    return "paused" as const;
  }

  if (action === "resume") {
    if (watch.lifecycleState !== "paused" || watch.effectiveRevisionId === null) {
      throw new Error("Only a paused watch with an approved revision can be resumed.");
    }
    const effective = await readEffectiveRevision(db, watch.effectiveRevisionId);
    if (effective === undefined) {
      throw new Error("The paused watch effective revision is unavailable.");
    }
    previewWatchPolicy({
      contractVersion: effective.contractVersion,
      lifecycleState: "proposed",
      policy: effective.policy,
    }, context);
    return "active" as const;
  }

  if (action === "expire") {
    if (
      watch.lifecycleState === "expired" ||
      watch.lifecycleState === "deleted"
    ) {
      throw new Error("The watch cannot transition to expired from its current state.");
    }
    const expiresAt = await readWatchExpiry(db, watch);
    const now = context.now ?? new Date();
    if (expiresAt === null || new Date(expiresAt).getTime() > now.getTime()) {
      throw new Error("The watch has not reached its configured expiry.");
    }
    return "expired" as const;
  }

  if (watch.lifecycleState === "deleted") {
    throw new Error("A deleted watch cannot be deleted again with a new operation.");
  }
  return "deleted" as const;
}

async function readWatchIdentity(db: Executor, watchId: string) {
  const rows = await db
    .select()
    .from(policyBoundWatches)
    .where(and(
      eq(policyBoundWatches.workspaceId, DEFAULT_WORKSPACE_ID),
      eq(policyBoundWatches.id, watchId),
    ))
    .limit(1);
  return rows[0];
}

async function readEffectiveRevision(db: Executor, id: string) {
  const rows = await db
    .select()
    .from(watchEffectiveRevisions)
    .where(and(
      eq(watchEffectiveRevisions.workspaceId, DEFAULT_WORKSPACE_ID),
      eq(watchEffectiveRevisions.id, id),
    ))
    .limit(1);
  return rows[0];
}

async function readWatchExpiry(
  db: Executor,
  watch: NonNullable<Awaited<ReturnType<typeof readWatchIdentity>>>,
): Promise<string | null> {
  if (watch.effectiveRevisionId !== null) {
    const effective = await readEffectiveRevision(db, watch.effectiveRevisionId);
    if (effective === undefined) {
      throw new Error("The watch effective revision is unavailable.");
    }
    return proposedWatchPolicySchema.parse(effective.policy).expiresAt;
  }
  const proposals = await db
    .select({ policy: watchPolicyRevisions.policy })
    .from(watchPolicyRevisions)
    .where(and(
      eq(watchPolicyRevisions.workspaceId, DEFAULT_WORKSPACE_ID),
      eq(watchPolicyRevisions.watchId, watch.id),
    ))
    .orderBy(desc(watchPolicyRevisions.revision))
    .limit(1);
  return proposals[0] === undefined
    ? null
    : proposedWatchPolicySchema.parse(proposals[0].policy).expiresAt;
}

async function readWatchListItem(
  db: Executor,
  watchId: string,
  now: string,
  availableCapabilities: WatchServiceContext["capabilityRegistry"]["availableCapabilities"],
): Promise<PolicyBoundWatchListItem> {
  const watch = await readWatchIdentity(db, watchId);
  if (watch === undefined) {
    throw new Error(`Policy-bound watch ${watchId} was not found.`);
  }
  const expiresAt = watch.lifecycleState === "deleted"
    ? null
    : await readWatchExpiry(db, watch);
  const policyRetained = watch.lifecycleState !== "deleted" && (
    watch.effectiveRevisionId !== null || await hasProposedPolicy(db, watch.id)
  );
  if (
    (watch.lifecycleState === "active" || watch.lifecycleState === "paused") &&
    watch.effectiveRevisionId !== null &&
    expiresAt !== null &&
    new Date(expiresAt).getTime() > new Date(now).getTime()
  ) {
    const effective = await readEffectiveRevision(db, watch.effectiveRevisionId);
    if (effective === undefined) {
      throw new Error("The watch effective revision is unavailable.");
    }
    previewWatchPolicy({
      contractVersion: effective.contractVersion,
      lifecycleState: "proposed",
      policy: effective.policy,
    }, {
      availableCapabilities,
      now: new Date(now),
    });
  }
  return policyBoundWatchListItemSchema.parse({
    id: watch.id,
    workspaceId: watch.workspaceId,
    lifecycleState: watch.lifecycleState,
    stateRevision: watch.stateRevision,
    effectiveRevisionId: watch.effectiveRevisionId,
    expiresAt,
    admissionReady:
      watch.lifecycleState === "active" &&
      watch.effectiveRevisionId !== null &&
      expiresAt !== null &&
      new Date(expiresAt).getTime() > new Date(now).getTime(),
    policyRetained,
    createdAt: watch.createdAt,
    updatedAt: watch.updatedAt,
  });
}

async function hasProposedPolicy(db: Executor, watchId: string): Promise<boolean> {
  const rows = await db
    .select({ id: watchPolicyRevisions.id })
    .from(watchPolicyRevisions)
    .where(and(
      eq(watchPolicyRevisions.workspaceId, DEFAULT_WORKSPACE_ID),
      eq(watchPolicyRevisions.watchId, watchId),
    ))
    .limit(1);
  return rows.length > 0;
}

async function readLifecycleEventByOperation(
  db: Executor,
  watchId: string,
  operationKey: string,
) {
  const rows = await db
    .select()
    .from(watchLifecycleEvents)
    .where(and(
      eq(watchLifecycleEvents.workspaceId, DEFAULT_WORKSPACE_ID),
      eq(watchLifecycleEvents.watchId, watchId),
      eq(watchLifecycleEvents.operationKey, operationKey),
    ))
    .limit(1);
  return rows[0];
}

function projectEvent(
  row: typeof watchLifecycleEvents.$inferSelect,
): WatchLifecycleEvent {
  return watchLifecycleEventSchema.parse({
    id: row.id,
    watchId: row.watchId,
    operationKey: row.operationKey,
    action: row.action,
    actor: { id: row.actorId, githubLogin: row.actorLogin },
    previousState: row.previousState,
    nextState: row.nextState,
    reason: row.reason,
    stateRevision: row.stateRevision,
    effectiveRevisionId: row.effectiveRevisionId,
    occurredAt: row.occurredAt,
  });
}
