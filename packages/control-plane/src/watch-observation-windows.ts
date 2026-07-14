import { randomUUID } from "node:crypto";

import { and, asc, eq, lte } from "drizzle-orm";
import { z } from "zod";

import {
  withDocsAgentDatabase,
  type DocsAgentDatabase,
} from "./db/client.ts";
import {
  policyBoundWatches,
  watchEffectiveRevisions,
  watchObservationWindows,
} from "./db/schema.ts";
import { DEFAULT_WORKSPACE_ID } from "./setup-state.ts";
import {
  effectiveWatchRevisionSchema,
  watchSourceSchema,
} from "./watch-contract.ts";
import {
  ephemeralWatchObservationSchema,
  type EphemeralWatchObservation,
} from "./watch-observation.ts";
import {
  watchObservationClaimResultSchema,
  type WatchObservationClaimResult,
} from "./watch-observation-claims.ts";

const MAX_ASSEMBLY_ATTEMPTS = 5;
const identifierSchema = z.string().trim().min(1).max(500);
type WatchWindowDatabase = Pick<DocsAgentDatabase, "select" | "update">;
const AUTHORITY_CHANGED = Symbol("authority-changed");

export const watchObservationHandoffSchema = z.object({
  kind: z.enum(["per_event", "windowed"]),
  workspaceId: identifierSchema,
  watchId: z.string().uuid(),
  effectiveRevisionId: z.string().uuid(),
  source: watchSourceSchema,
  claimIds: z.array(z.string().regex(/^[a-f0-9]{64}$/u)).min(1).max(100),
  openedAt: z.string().datetime({ offset: true }),
  closedAt: z.string().datetime({ offset: true }),
  observations: z.array(ephemeralWatchObservationSchema).min(1).max(100),
}).strict();

export const watchObservationAssemblyResultSchema = z.object({
  disposition: z.enum(["duplicate", "accumulated", "ready"]),
  handoffs: z.array(watchObservationHandoffSchema),
}).strict();

export type WatchObservationHandoff = z.infer<typeof watchObservationHandoffSchema>;
export type WatchObservationAssemblyResult = z.infer<
  typeof watchObservationAssemblyResultSchema
>;

export type AssembleClaimedWatchObservationInput = {
  workspaceId: string;
  claimResult: WatchObservationClaimResult;
  observation: EphemeralWatchObservation;
};

export type WatchObservationAssemblyContext = {
  now?: Date;
  limit?: number;
};

export class WatchObservationAssemblyError extends Error {
  readonly code:
    | "authority-changed"
    | "claim-mismatch"
    | "concurrent-conflict"
    | "retention-expired"
    | "storage-unavailable"
    | "window-state-invalid";

  constructor(
    code: WatchObservationAssemblyError["code"],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WatchObservationAssemblyError";
    this.code = code;
  }
}

export async function assembleClaimedWatchObservation(
  input: AssembleClaimedWatchObservationInput,
  context: WatchObservationAssemblyContext = {},
): Promise<WatchObservationAssemblyResult> {
  const workspaceId = identifierSchema.parse(input.workspaceId);
  const claimResult = watchObservationClaimResultSchema.parse(input.claimResult);
  const observation = ephemeralWatchObservationSchema.parse(input.observation);
  assertClaimMatchesObservation(workspaceId, claimResult, observation);
  if (!claimResult.acquired) {
    return watchObservationAssemblyResultSchema.parse({
      disposition: "duplicate",
      handoffs: [],
    });
  }

  const now = context.now ?? new Date();
  for (let attempt = 1; attempt <= MAX_ASSEMBLY_ATTEMPTS; attempt += 1) {
    try {
      return await assembleOnce(workspaceId, claimResult, observation, now);
    } catch (error) {
      if (error instanceof ConcurrentWindowUpdate && attempt < MAX_ASSEMBLY_ATTEMPTS) {
        continue;
      }
      if (error instanceof ConcurrentWindowUpdate) {
        throw new WatchObservationAssemblyError(
          "concurrent-conflict",
          "The watch observation window changed repeatedly during assembly.",
          { cause: error },
        );
      }
      throw error;
    }
  }
  throw new WatchObservationAssemblyError(
    "concurrent-conflict",
    "The watch observation window could not be assembled.",
  );
}

export async function flushReadyWatchObservationWindows(
  context: WatchObservationAssemblyContext = {},
): Promise<readonly WatchObservationHandoff[]> {
  const now = context.now ?? new Date();
  const limit = z.number().int().min(1).max(100).parse(context.limit ?? 25);
  const nowIso = now.toISOString();
  try {
    return await withDocsAgentDatabase(async (db) => db.transaction(async (tx) => {
      const rows = await tx.select().from(watchObservationWindows).where(and(
        eq(watchObservationWindows.workspaceId, DEFAULT_WORKSPACE_ID),
        eq(watchObservationWindows.status, "collecting"),
        lte(watchObservationWindows.closesAt, nowIso),
      )).orderBy(
        asc(watchObservationWindows.closesAt),
        asc(watchObservationWindows.id),
      ).limit(limit);
      const handoffs: WatchObservationHandoff[] = [];
      for (const row of rows) {
        const authority = await readAuthority(
          tx,
          row.workspaceId,
          row.watchId,
          row.effectiveRevisionId,
        );
        if (
          !authority.current ||
          now.getTime() >= authority.expiresAt ||
          now.getTime() > new Date(row.rawExpiresAt).getTime()
        ) {
          await expireWindow(tx, row.id, row.revision, nowIso);
          continue;
        }
        handoffs.push(await handOffWindow(tx, row, nowIso));
      }
      return handoffs;
    }));
  } catch (error) {
    if (error instanceof WatchObservationAssemblyError) throw error;
    throw storageError(error);
  }
}

async function assembleOnce(
  workspaceId: string,
  claimResult: WatchObservationClaimResult,
  observation: EphemeralWatchObservation,
  now: Date,
): Promise<WatchObservationAssemblyResult> {
  const nowIso = now.toISOString();
  try {
    const result = await withDocsAgentDatabase(async (db) => db.transaction(async (tx) => {
      const authority = await readAuthority(
        tx,
        workspaceId,
        observation.watchId,
        observation.effectiveRevisionId,
      );
      if (!authority.current || now.getTime() >= authority.expiresAt) {
        await expireCollectingWindows(
          tx,
          workspaceId,
          observation.watchId,
          observation.effectiveRevisionId,
          nowIso,
        );
        return AUTHORITY_CHANGED;
      }

      const policy = authority.revision.policy;
      if (policy.evaluation.mode === "per_event") {
        return watchObservationAssemblyResultSchema.parse({
          disposition: "ready",
          handoffs: [watchObservationHandoffSchema.parse({
            kind: "per_event",
            workspaceId,
            watchId: observation.watchId,
            effectiveRevisionId: observation.effectiveRevisionId,
            source: observation.source,
            claimIds: [claimResult.claim.id],
            openedAt: nowIso,
            closedAt: nowIso,
            observations: [observation],
          })],
        });
      }

      if (observation.content.retentionSeconds < policy.evaluation.windowSeconds) {
        throw new WatchObservationAssemblyError(
          "window-state-invalid",
          "The observation retention does not cover its effective evaluation window.",
        );
      }

      const handoffs: WatchObservationHandoff[] = [];
      let window: typeof watchObservationWindows.$inferSelect | undefined =
        (await tx.select().from(watchObservationWindows).where(and(
        eq(watchObservationWindows.workspaceId, workspaceId),
        eq(watchObservationWindows.effectiveRevisionId, observation.effectiveRevisionId),
        eq(watchObservationWindows.status, "collecting"),
      )).limit(1))[0];

      if (window !== undefined) {
        if (now.getTime() > new Date(window.rawExpiresAt).getTime()) {
          await expireWindow(tx, window.id, window.revision, nowIso);
          window = undefined;
        } else if (
          now.getTime() >= new Date(window.closesAt).getTime() ||
          window.characterCount + observation.content.characterCount >
            policy.context.maxCharacters
        ) {
          handoffs.push(await handOffWindow(tx, window, nowIso));
          window = undefined;
        }
      }

      if (window === undefined) {
        const closesAt = new Date(
          now.getTime() + policy.evaluation.windowSeconds * 1_000,
        ).toISOString();
        const rawExpiresAt = new Date(
          now.getTime() + policy.retention.rawObservationSeconds * 1_000,
        ).toISOString();
        const inserted = await tx.insert(watchObservationWindows).values({
          id: randomUUID(),
          workspaceId,
          watchId: observation.watchId,
          effectiveRevisionId: observation.effectiveRevisionId,
          provider: observation.source.provider,
          resourceType: observation.source.resource.type,
          resourceId: observation.source.resource.id,
          status: "collecting",
          revision: 1,
          claimIds: [claimResult.claim.id],
          rawObservations: [observation],
          observationCount: 1,
          characterCount: observation.content.characterCount,
          openedAt: nowIso,
          closesAt,
          rawExpiresAt,
          handedOffAt: null,
          expiredAt: null,
          updatedAt: nowIso,
        }).onConflictDoNothing().returning();
        if (inserted[0] === undefined) throw new ConcurrentWindowUpdate();
        window = inserted[0];
      } else {
        const observations = parseRawObservations(window.rawObservations);
        const claimIds = parseClaimIds(window.claimIds);
        const updated = await tx.update(watchObservationWindows).set({
          revision: window.revision + 1,
          claimIds: [...claimIds, claimResult.claim.id],
          rawObservations: [...observations, observation],
          observationCount: window.observationCount + 1,
          characterCount: window.characterCount + observation.content.characterCount,
          updatedAt: nowIso,
        }).where(and(
          eq(watchObservationWindows.id, window.id),
          eq(watchObservationWindows.status, "collecting"),
          eq(watchObservationWindows.revision, window.revision),
        )).returning();
        if (updated[0] === undefined) throw new ConcurrentWindowUpdate();
        window = updated[0];
      }

      if (
        window.observationCount >= policy.evaluation.maxObservations ||
        window.characterCount >= policy.context.maxCharacters
      ) {
        handoffs.push(await handOffWindow(tx, window, nowIso));
      }
      return watchObservationAssemblyResultSchema.parse({
        disposition: handoffs.length > 0 ? "ready" : "accumulated",
        handoffs,
      });
    }));
    if (result === AUTHORITY_CHANGED) {
      throw new WatchObservationAssemblyError(
        "authority-changed",
        "The admitted watch revision is no longer active for new window assembly.",
      );
    }
    return result;
  } catch (error) {
    if (
      error instanceof WatchObservationAssemblyError ||
      error instanceof ConcurrentWindowUpdate
    ) throw error;
    throw storageError(error);
  }
}

function assertClaimMatchesObservation(
  workspaceId: string,
  claimResult: WatchObservationClaimResult,
  observation: EphemeralWatchObservation,
): void {
  const claim = claimResult.claim;
  if (
    claim.workspaceId !== workspaceId ||
    claim.watchId !== observation.watchId ||
    claim.effectiveRevisionId !== observation.effectiveRevisionId ||
    claim.provider !== observation.source.provider ||
    claim.resourceType !== observation.source.resource.type ||
    claim.resourceId !== observation.source.resource.id ||
    claim.providerEventId !== observation.provenance.providerEventId ||
    claim.status !== "claimed"
  ) {
    throw new WatchObservationAssemblyError(
      "claim-mismatch",
      "The durable occurrence claim does not match the normalized observation.",
    );
  }
}

async function readAuthority(
  tx: WatchWindowDatabase,
  workspaceId: string,
  watchId: string,
  effectiveRevisionId: string,
) {
  const rows = await tx.select({
    watchId: policyBoundWatches.id,
    lifecycleState: policyBoundWatches.lifecycleState,
    currentEffectiveRevisionId: policyBoundWatches.effectiveRevisionId,
    revisionId: watchEffectiveRevisions.id,
    revisionWatchId: watchEffectiveRevisions.watchId,
    proposalRevisionId: watchEffectiveRevisions.proposalRevisionId,
    contractVersion: watchEffectiveRevisions.contractVersion,
    policy: watchEffectiveRevisions.policy,
    approvedById: watchEffectiveRevisions.approvedById,
    approvedByLogin: watchEffectiveRevisions.approvedByLogin,
    approvedAt: watchEffectiveRevisions.approvedAt,
  }).from(policyBoundWatches).innerJoin(
    watchEffectiveRevisions,
    and(
      eq(watchEffectiveRevisions.id, effectiveRevisionId),
      eq(watchEffectiveRevisions.watchId, policyBoundWatches.id),
      eq(watchEffectiveRevisions.workspaceId, policyBoundWatches.workspaceId),
    ),
  ).where(and(
    eq(policyBoundWatches.id, watchId),
    eq(policyBoundWatches.workspaceId, workspaceId),
  )).limit(1);
  const row = rows[0];
  if (row === undefined || row.revisionWatchId !== row.watchId) {
    throw new WatchObservationAssemblyError(
      "authority-changed",
      "The admitted watch revision is no longer available.",
    );
  }
  const revision = effectiveWatchRevisionSchema.parse({
    id: row.revisionId,
    watchId: row.revisionWatchId,
    proposalRevisionId: row.proposalRevisionId,
    contractVersion: row.contractVersion,
    policy: row.policy,
    approvedBy: { id: row.approvedById, githubLogin: row.approvedByLogin },
    approvedAt: row.approvedAt,
  });
  return {
    current:
      row.lifecycleState === "active" &&
      row.currentEffectiveRevisionId === effectiveRevisionId,
    expiresAt: revision.policy.expiresAt === null
      ? Number.NEGATIVE_INFINITY
      : new Date(revision.policy.expiresAt).getTime(),
    revision,
  };
}

async function handOffWindow(
  tx: WatchWindowDatabase,
  row: typeof watchObservationWindows.$inferSelect,
  nowIso: string,
): Promise<WatchObservationHandoff> {
  const observations = parseRawObservations(row.rawObservations);
  const claimIds = parseClaimIds(row.claimIds);
  if (
    observations.length !== row.observationCount ||
    observations.length !== claimIds.length
  ) {
    throw new WatchObservationAssemblyError(
      "window-state-invalid",
      "The collecting watch window has inconsistent durable contents.",
    );
  }
  const updated = await tx.update(watchObservationWindows).set({
    status: "handed-off",
    revision: row.revision + 1,
    rawObservations: null,
    handedOffAt: nowIso,
    updatedAt: nowIso,
  }).where(and(
    eq(watchObservationWindows.id, row.id),
    eq(watchObservationWindows.status, "collecting"),
    eq(watchObservationWindows.revision, row.revision),
  )).returning({ id: watchObservationWindows.id });
  if (updated.length !== 1) throw new ConcurrentWindowUpdate();
  return watchObservationHandoffSchema.parse({
    kind: "windowed",
    workspaceId: row.workspaceId,
    watchId: row.watchId,
    effectiveRevisionId: row.effectiveRevisionId,
    source: {
      provider: row.provider,
      providerWorkspaceId: observations[0]!.source.providerWorkspaceId,
      resource: { type: row.resourceType, id: row.resourceId },
    },
    claimIds,
    openedAt: row.openedAt,
    closedAt: nowIso,
    observations,
  });
}

async function expireCollectingWindows(
  tx: WatchWindowDatabase,
  workspaceId: string,
  watchId: string,
  effectiveRevisionId: string,
  nowIso: string,
): Promise<void> {
  await tx.update(watchObservationWindows).set({
    status: "expired",
    rawObservations: null,
    expiredAt: nowIso,
    updatedAt: nowIso,
  }).where(and(
    eq(watchObservationWindows.workspaceId, workspaceId),
    eq(watchObservationWindows.watchId, watchId),
    eq(watchObservationWindows.effectiveRevisionId, effectiveRevisionId),
    eq(watchObservationWindows.status, "collecting"),
  ));
}

async function expireWindow(
  tx: WatchWindowDatabase,
  id: string,
  revision: number,
  nowIso: string,
): Promise<void> {
  const updated = await tx.update(watchObservationWindows).set({
    status: "expired",
    revision: revision + 1,
    rawObservations: null,
    expiredAt: nowIso,
    updatedAt: nowIso,
  }).where(and(
    eq(watchObservationWindows.id, id),
    eq(watchObservationWindows.status, "collecting"),
    eq(watchObservationWindows.revision, revision),
  )).returning({ id: watchObservationWindows.id });
  if (updated.length !== 1) throw new ConcurrentWindowUpdate();
}

function parseRawObservations(value: unknown): EphemeralWatchObservation[] {
  const parsed = z.array(ephemeralWatchObservationSchema).min(1).max(100).safeParse(value);
  if (!parsed.success) {
    throw new WatchObservationAssemblyError(
      "window-state-invalid",
      "The collecting watch window contains invalid raw observations.",
    );
  }
  return parsed.data;
}

function parseClaimIds(value: unknown): string[] {
  const parsed = z.array(z.string().regex(/^[a-f0-9]{64}$/u)).min(1).max(100).safeParse(value);
  if (!parsed.success) {
    throw new WatchObservationAssemblyError(
      "window-state-invalid",
      "The collecting watch window contains invalid claim references.",
    );
  }
  return parsed.data;
}

function storageError(error: unknown): WatchObservationAssemblyError {
  return new WatchObservationAssemblyError(
    "storage-unavailable",
    "Watch observation window state could not be read or updated.",
    { cause: error },
  );
}

class ConcurrentWindowUpdate extends Error {}
