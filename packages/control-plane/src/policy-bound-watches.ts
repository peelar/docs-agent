import { randomUUID } from "node:crypto";

import { and, desc, eq, isNull, sql } from "drizzle-orm";
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
  activePolicyBoundWatchSchema,
  approveWatchProposalInputSchema,
  approveWatchProposalResultSchema,
  createProposedWatchInputSchema,
  editWatchProposalInputSchema,
  editWatchProposalResultSchema,
  effectiveWatchRevisionSchema,
  getEffectiveWatchRevisionInputSchema,
  getPolicyBoundWatchInputSchema,
  policyBoundWatchSchema,
  WATCH_POLICY_CONTRACT_VERSION,
  watchActorSchema,
  type ActivePolicyBoundWatch,
  type ApproveWatchProposalResult,
  type EditWatchProposalResult,
  type EffectiveWatchRevision,
  type PolicyBoundWatch,
} from "./watch-contract.ts";
import { classifyWatchPolicyChange } from "./watch-policy-changes.ts";
import {
  previewWatchPolicy,
} from "./watch-policy-preview.ts";
import {
  availableWatchCapabilities,
  requireWatchServiceReady,
  type WatchServiceContext,
} from "./watch-service-readiness.ts";

export * from "./watch-contract.ts";

export async function createProposedWatch(
  input: z.input<typeof createProposedWatchInputSchema>,
  context: WatchServiceContext,
): Promise<PolicyBoundWatch> {
  const parsed = createProposedWatchInputSchema.parse(input);
  await requireWatchServiceReady(context);
  const watchId = randomUUID();
  const revisionId = randomUUID();
  const now = new Date().toISOString();

  await withDocsAgentDatabase(async (db) => {
    await db.transaction(async (tx) => {
      await tx.insert(policyBoundWatches).values({
        id: watchId,
        workspaceId: DEFAULT_WORKSPACE_ID,
        lifecycleState: "proposed",
        effectiveRevisionId: null,
        stateRevision: 1,
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(watchPolicyRevisions).values({
        id: revisionId,
        watchId,
        workspaceId: DEFAULT_WORKSPACE_ID,
        revision: 1,
        contractVersion: WATCH_POLICY_CONTRACT_VERSION,
        policy: parsed.policy,
        changeClassification: null,
        createdById: parsed.actor.id,
        createdByLogin: parsed.actor.githubLogin,
        createdAt: now,
      });
      await tx.insert(watchLifecycleEvents).values({
        id: randomUUID(),
        watchId,
        workspaceId: DEFAULT_WORKSPACE_ID,
        operationKey: `watch-created:${watchId}`,
        action: "create",
        actorId: parsed.actor.id,
        actorLogin: parsed.actor.githubLogin,
        previousState: null,
        nextState: "proposed",
        reason: "Proposed watch created.",
        stateRevision: 1,
        effectiveRevisionId: null,
        occurredAt: now,
      });
    });
  });

  return readPolicyBoundWatch({ id: watchId });
}

export type WatchProposalEditContext = WatchServiceContext & {
  operator: z.input<typeof watchActorSchema>;
};

export async function editWatchProposal(
  input: z.input<typeof editWatchProposalInputSchema>,
  context: WatchProposalEditContext,
): Promise<EditWatchProposalResult> {
  const parsed = editWatchProposalInputSchema.parse(input);
  const readyContext = await requireWatchServiceReady({
    capabilityRegistry: context.capabilityRegistry,
    now: context.now,
  });
  const operator = watchActorSchema.parse(context.operator);
  const createdAt = (readyContext.now ?? new Date()).toISOString();
  const revisionId = randomUUID();

  const classification = await withDocsAgentDatabase(async (db) =>
    db.transaction(async (tx) => {
      const rows = await tx
        .select({
          lifecycleState: policyBoundWatches.lifecycleState,
          latestRevision: watchPolicyRevisions.revision,
          latestPolicy: watchPolicyRevisions.policy,
        })
        .from(policyBoundWatches)
        .innerJoin(
          watchPolicyRevisions,
          and(
            eq(watchPolicyRevisions.watchId, policyBoundWatches.id),
            eq(watchPolicyRevisions.workspaceId, policyBoundWatches.workspaceId),
          ),
        )
        .where(and(
          eq(policyBoundWatches.id, parsed.watchId),
          eq(policyBoundWatches.workspaceId, DEFAULT_WORKSPACE_ID),
        ))
        .orderBy(desc(watchPolicyRevisions.revision))
        .limit(1);
      const current = rows[0];
      if (current === undefined) {
        throw new Error(`Policy-bound watch ${parsed.watchId} was not found.`);
      }
      if (current.lifecycleState !== "active") {
        throw new Error("Only an active watch can receive a replacement proposal.");
      }
      if (current.latestRevision !== parsed.expectedProposalRevision) {
        throw new Error(
          `Watch ${parsed.watchId} proposal changed concurrently. Expected revision ${parsed.expectedProposalRevision}, found ${current.latestRevision}.`,
        );
      }

      const changeClassification = classifyWatchPolicyChange(
        current.latestPolicy as z.output<typeof editWatchProposalInputSchema>["policy"],
        parsed.policy,
      );
      const nextRevision = current.latestRevision + 1;
      const inserted = await tx
        .insert(watchPolicyRevisions)
        .values({
          id: revisionId,
          watchId: parsed.watchId,
          workspaceId: DEFAULT_WORKSPACE_ID,
          revision: nextRevision,
          contractVersion: WATCH_POLICY_CONTRACT_VERSION,
          policy: parsed.policy,
          changeClassification,
          createdById: operator.id,
          createdByLogin: operator.githubLogin,
          createdAt,
        })
        .onConflictDoNothing()
        .returning({ id: watchPolicyRevisions.id });
      if (inserted.length === 0) {
        throw new Error(
          `Watch ${parsed.watchId} proposal changed concurrently during editing.`,
        );
      }

      const updated = await tx
        .update(policyBoundWatches)
        .set({ updatedAt: createdAt })
        .where(and(
          eq(policyBoundWatches.id, parsed.watchId),
          eq(policyBoundWatches.workspaceId, DEFAULT_WORKSPACE_ID),
          eq(policyBoundWatches.lifecycleState, "active"),
        ))
        .returning({ id: policyBoundWatches.id });
      if (updated.length === 0) {
        throw new Error(
          `Watch ${parsed.watchId} changed concurrently during proposal editing.`,
        );
      }
      return changeClassification;
    })
  );

  return editWatchProposalResultSchema.parse({
    watch: await readPolicyBoundWatch({ id: parsed.watchId }),
    classification,
  });
}

export type WatchApprovalContext = WatchServiceContext & {
  operator: z.input<typeof watchActorSchema>;
};

export async function approveWatchProposal(
  input: z.input<typeof approveWatchProposalInputSchema>,
  context: WatchApprovalContext,
): Promise<ApproveWatchProposalResult> {
  const parsed = approveWatchProposalInputSchema.parse(input);
  const readyContext = await requireWatchServiceReady({
    capabilityRegistry: context.capabilityRegistry,
    now: context.now,
  });
  const operator = watchActorSchema.parse(context.operator);
  const approvedAt = (readyContext.now ?? new Date()).toISOString();
  const effectiveRevisionId = randomUUID();

  const activation = await withDocsAgentDatabase(async (db) =>
    db.transaction(async (tx) => {
      const watchRows = await tx
        .select({
          id: policyBoundWatches.id,
          lifecycleState: policyBoundWatches.lifecycleState,
          effectiveRevisionId: policyBoundWatches.effectiveRevisionId,
          stateRevision: policyBoundWatches.stateRevision,
          proposalRevisionId: watchPolicyRevisions.id,
          proposalRevision: watchPolicyRevisions.revision,
          contractVersion: watchPolicyRevisions.contractVersion,
          proposalPolicy: watchPolicyRevisions.policy,
        })
        .from(policyBoundWatches)
        .innerJoin(
          watchPolicyRevisions,
          and(
            eq(watchPolicyRevisions.watchId, policyBoundWatches.id),
            eq(watchPolicyRevisions.workspaceId, policyBoundWatches.workspaceId),
          ),
        )
        .where(and(
          eq(policyBoundWatches.id, parsed.watchId),
          eq(policyBoundWatches.workspaceId, DEFAULT_WORKSPACE_ID),
        ))
        .orderBy(desc(watchPolicyRevisions.revision))
        .limit(1);
      const watch = watchRows[0];
      if (watch === undefined) {
        throw new Error(`Policy-bound watch ${parsed.watchId} was not found.`);
      }

      if (watch.lifecycleState === "active" && watch.effectiveRevisionId !== null) {
        const existing = await readEffectiveRevisionById(tx, watch.effectiveRevisionId);
        if (existing?.proposalRevisionId === parsed.proposalRevisionId) {
          return { created: false, replayed: true };
        }
      }
      if (watch.lifecycleState !== "proposed" && watch.lifecycleState !== "active") {
        throw new Error(`Watch ${parsed.watchId} is not awaiting proposal approval.`);
      }
      if (
        watch.proposalRevisionId !== parsed.proposalRevisionId ||
        watch.proposalRevision !== parsed.expectedProposalRevision
      ) {
        throw new Error(
          `Watch ${parsed.watchId} proposal changed concurrently. Inspect the latest proposal before approving it.`,
        );
      }

      const preview = previewWatchPolicy({
        contractVersion: watch.contractVersion,
        lifecycleState: "proposed",
        policy: watch.proposalPolicy,
      }, {
        availableCapabilities: availableWatchCapabilities(readyContext),
        now: readyContext.now,
      });

      const inserted = await tx
        .insert(watchEffectiveRevisions)
        .values({
          id: effectiveRevisionId,
          watchId: parsed.watchId,
          workspaceId: DEFAULT_WORKSPACE_ID,
          proposalRevisionId: parsed.proposalRevisionId,
          contractVersion: WATCH_POLICY_CONTRACT_VERSION,
          policy: preview.effectivePolicy,
          approvalKey: parsed.idempotencyKey,
          approvedById: operator.id,
          approvedByLogin: operator.githubLogin,
          approvedAt,
        })
        .onConflictDoNothing()
        .returning({ id: watchEffectiveRevisions.id });

      if (inserted.length === 0) {
        const existing = await readEffectiveRevisionByProposal(
          tx,
          parsed.watchId,
          parsed.proposalRevisionId,
        );
        if (existing === undefined) {
          throw new Error(
            `Approval key ${parsed.idempotencyKey} is already assigned to another watch revision.`,
          );
        }
        return { created: false, replayed: true };
      }

      const updated = await tx
        .update(policyBoundWatches)
        .set({
          lifecycleState: "active",
          effectiveRevisionId,
          updatedAt: approvedAt,
          stateRevision: sql`${policyBoundWatches.stateRevision} + 1`,
        })
        .where(and(
          eq(policyBoundWatches.id, parsed.watchId),
          eq(policyBoundWatches.workspaceId, DEFAULT_WORKSPACE_ID),
          eq(policyBoundWatches.lifecycleState, watch.lifecycleState),
          eq(policyBoundWatches.stateRevision, watch.stateRevision),
          watch.effectiveRevisionId === null
            ? isNull(policyBoundWatches.effectiveRevisionId)
            : eq(policyBoundWatches.effectiveRevisionId, watch.effectiveRevisionId),
        ))
        .returning({
          id: policyBoundWatches.id,
          stateRevision: policyBoundWatches.stateRevision,
        });
      if (updated.length === 0) {
        throw new Error(
          `Watch ${parsed.watchId} changed concurrently during approval.`,
        );
      }

      await tx.insert(watchLifecycleEvents).values({
        id: randomUUID(),
        watchId: parsed.watchId,
        workspaceId: DEFAULT_WORKSPACE_ID,
        operationKey: `watch-approved:${parsed.idempotencyKey}`,
        action: watch.lifecycleState === "active" ? "approve-replacement" : "approve",
        actorId: operator.id,
        actorLogin: operator.githubLogin,
        previousState: watch.lifecycleState,
        nextState: "active",
        reason: watch.lifecycleState === "active"
          ? "Operator approved a replacement watch policy."
          : "Operator approved the proposed watch policy.",
        stateRevision: updated[0]!.stateRevision,
        effectiveRevisionId,
        occurredAt: approvedAt,
      });

      return { created: true, replayed: false };
    })
  );

  return approveWatchProposalResultSchema.parse({
    ...activation,
    watch: await getActivePolicyBoundWatch({ id: parsed.watchId }, readyContext),
  });
}

export async function getActivePolicyBoundWatch(
  input: z.input<typeof getPolicyBoundWatchInputSchema>,
  context: WatchServiceContext,
): Promise<ActivePolicyBoundWatch> {
  const parsed = getPolicyBoundWatchInputSchema.parse(input);
  const readyContext = await requireWatchServiceReady(context);

  return withDocsAgentDatabase(async (db) => {
    const rows = await db
      .select({
        id: policyBoundWatches.id,
        workspaceId: policyBoundWatches.workspaceId,
        lifecycleState: policyBoundWatches.lifecycleState,
        createdAt: policyBoundWatches.createdAt,
        updatedAt: policyBoundWatches.updatedAt,
        stateRevision: policyBoundWatches.stateRevision,
        effectiveRevisionId: watchEffectiveRevisions.id,
        proposalRevisionId: watchEffectiveRevisions.proposalRevisionId,
        contractVersion: watchEffectiveRevisions.contractVersion,
        policy: watchEffectiveRevisions.policy,
        approvedById: watchEffectiveRevisions.approvedById,
        approvedByLogin: watchEffectiveRevisions.approvedByLogin,
        approvedAt: watchEffectiveRevisions.approvedAt,
      })
      .from(policyBoundWatches)
      .innerJoin(
        watchEffectiveRevisions,
        and(
          eq(watchEffectiveRevisions.id, policyBoundWatches.effectiveRevisionId),
          eq(watchEffectiveRevisions.watchId, policyBoundWatches.id),
          eq(watchEffectiveRevisions.workspaceId, policyBoundWatches.workspaceId),
        ),
      )
      .where(and(
        eq(policyBoundWatches.id, parsed.id),
        eq(policyBoundWatches.workspaceId, DEFAULT_WORKSPACE_ID),
        eq(policyBoundWatches.lifecycleState, "active"),
      ))
      .limit(1);
    const row = rows[0];
    if (row === undefined) {
      throw new Error(`Policy-bound watch ${parsed.id} is not active.`);
    }

    const active = activePolicyBoundWatchSchema.parse({
      id: row.id,
      workspaceId: row.workspaceId,
      lifecycleState: row.lifecycleState,
      stateRevision: row.stateRevision,
      effectiveRevision: {
        id: row.effectiveRevisionId,
        watchId: row.id,
        proposalRevisionId: row.proposalRevisionId,
        contractVersion: row.contractVersion,
        policy: row.policy,
        approvedBy: {
          id: row.approvedById,
          githubLogin: row.approvedByLogin,
        },
        approvedAt: row.approvedAt,
      },
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
    const expiresAt = active.effectiveRevision.policy.expiresAt;
    if (
      expiresAt === null ||
      new Date(expiresAt).getTime() <= (readyContext.now ?? new Date()).getTime()
    ) {
      throw new Error(`Policy-bound watch ${parsed.id} has expired.`);
    }
    previewWatchPolicy({
      contractVersion: active.effectiveRevision.contractVersion,
      lifecycleState: "proposed",
      policy: active.effectiveRevision.policy,
    }, {
      availableCapabilities: availableWatchCapabilities(readyContext),
      now: readyContext.now,
    });
    return active;
  });
}

export async function getEffectiveWatchRevision(
  input: z.input<typeof getEffectiveWatchRevisionInputSchema>,
  context: WatchServiceContext,
): Promise<EffectiveWatchRevision> {
  const parsed = getEffectiveWatchRevisionInputSchema.parse(input);
  const readyContext = await requireWatchServiceReady(context);
  return withDocsAgentDatabase(async (db) => {
    const rows = await db
      .select()
      .from(watchEffectiveRevisions)
      .where(and(
        eq(watchEffectiveRevisions.workspaceId, DEFAULT_WORKSPACE_ID),
        eq(watchEffectiveRevisions.watchId, parsed.watchId),
        eq(watchEffectiveRevisions.id, parsed.effectiveRevisionId),
      ))
      .limit(1);
    const row = rows[0];
    if (row === undefined) {
      throw new Error(
        `Effective revision ${parsed.effectiveRevisionId} was not found for watch ${parsed.watchId}.`,
      );
    }
    const effective = effectiveWatchRevisionSchema.parse({
      id: row.id,
      watchId: row.watchId,
      proposalRevisionId: row.proposalRevisionId,
      contractVersion: row.contractVersion,
      policy: row.policy,
      approvedBy: {
        id: row.approvedById,
        githubLogin: row.approvedByLogin,
      },
      approvedAt: row.approvedAt,
    });
    previewWatchPolicy({
      contractVersion: effective.contractVersion,
      lifecycleState: "proposed",
      policy: effective.policy,
    }, {
      availableCapabilities: availableWatchCapabilities(readyContext),
      now: readyContext.now,
    });
    return effective;
  });
}

export async function getPolicyBoundWatch(
  input: z.input<typeof getPolicyBoundWatchInputSchema>,
  context: WatchServiceContext,
): Promise<PolicyBoundWatch> {
  await requireWatchServiceReady(context);
  return readPolicyBoundWatch(input);
}

async function readPolicyBoundWatch(
  input: z.input<typeof getPolicyBoundWatchInputSchema>,
): Promise<PolicyBoundWatch> {
  const parsed = getPolicyBoundWatchInputSchema.parse(input);

  return withDocsAgentDatabase(async (db) => {
    const rows = await db
      .select({
        id: policyBoundWatches.id,
        workspaceId: policyBoundWatches.workspaceId,
        lifecycleState: policyBoundWatches.lifecycleState,
        createdAt: policyBoundWatches.createdAt,
        updatedAt: policyBoundWatches.updatedAt,
        stateRevision: policyBoundWatches.stateRevision,
        revisionId: watchPolicyRevisions.id,
        revision: watchPolicyRevisions.revision,
        contractVersion: watchPolicyRevisions.contractVersion,
        policy: watchPolicyRevisions.policy,
        changeClassification: watchPolicyRevisions.changeClassification,
        createdById: watchPolicyRevisions.createdById,
        createdByLogin: watchPolicyRevisions.createdByLogin,
        revisionCreatedAt: watchPolicyRevisions.createdAt,
      })
      .from(policyBoundWatches)
      .innerJoin(
        watchPolicyRevisions,
        and(
          eq(watchPolicyRevisions.watchId, policyBoundWatches.id),
          eq(watchPolicyRevisions.workspaceId, policyBoundWatches.workspaceId),
        ),
      )
      .where(
        and(
          eq(policyBoundWatches.id, parsed.id),
          eq(policyBoundWatches.workspaceId, DEFAULT_WORKSPACE_ID),
        ),
      )
      .orderBy(desc(watchPolicyRevisions.revision))
      .limit(1);
    const row = rows[0];

    if (row === undefined) {
      throw new Error(`Policy-bound watch ${parsed.id} was not found.`);
    }

    return policyBoundWatchSchema.parse({
      id: row.id,
      workspaceId: row.workspaceId,
      lifecycleState: row.lifecycleState,
      stateRevision: row.stateRevision,
      latestProposal: {
        id: row.revisionId,
        watchId: row.id,
        revision: row.revision,
        contractVersion: row.contractVersion,
        policy: row.policy,
        changeClassification: row.changeClassification,
        createdBy: {
          id: row.createdById,
          githubLogin: row.createdByLogin,
        },
        createdAt: row.revisionCreatedAt,
      },
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  });
}

type WatchExecutor = Pick<DocsAgentDatabase, "select" | "update">;

async function readEffectiveRevisionById(
  db: WatchExecutor,
  id: string,
) {
  const rows = await db
    .select()
    .from(watchEffectiveRevisions)
    .where(and(
      eq(watchEffectiveRevisions.id, id),
      eq(watchEffectiveRevisions.workspaceId, DEFAULT_WORKSPACE_ID),
    ))
    .limit(1);
  return rows[0];
}

async function readEffectiveRevisionByProposal(
  db: WatchExecutor,
  watchId: string,
  proposalRevisionId: string,
) {
  const rows = await db
    .select()
    .from(watchEffectiveRevisions)
    .where(and(
      eq(watchEffectiveRevisions.workspaceId, DEFAULT_WORKSPACE_ID),
      eq(watchEffectiveRevisions.watchId, watchId),
      eq(watchEffectiveRevisions.proposalRevisionId, proposalRevisionId),
    ))
    .limit(1);
  return rows[0];
}
