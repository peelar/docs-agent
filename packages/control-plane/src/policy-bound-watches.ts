import { randomUUID } from "node:crypto";

import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { withDocsAgentDatabase } from "./db/client.ts";
import {
  policyBoundWatches,
  watchPolicyRevisions,
} from "./db/schema.ts";
import { DEFAULT_WORKSPACE_ID } from "./setup-state.ts";
import {
  createProposedWatchInputSchema,
  getPolicyBoundWatchInputSchema,
  policyBoundWatchSchema,
  WATCH_POLICY_CONTRACT_VERSION,
  type PolicyBoundWatch,
} from "./watch-contract.ts";

export * from "./watch-contract.ts";

export async function createProposedWatch(
  input: z.input<typeof createProposedWatchInputSchema>,
): Promise<PolicyBoundWatch> {
  const parsed = createProposedWatchInputSchema.parse(input);
  const watchId = randomUUID();
  const revisionId = randomUUID();
  const now = new Date().toISOString();

  await withDocsAgentDatabase(async (db) => {
    await db.transaction(async (tx) => {
      await tx.insert(policyBoundWatches).values({
        id: watchId,
        workspaceId: DEFAULT_WORKSPACE_ID,
        lifecycleState: "proposed",
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
        createdById: parsed.actor.id,
        createdByLogin: parsed.actor.githubLogin,
        createdAt: now,
      });
    });
  });

  return getPolicyBoundWatch({ id: watchId });
}

export async function getPolicyBoundWatch(
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
        revisionId: watchPolicyRevisions.id,
        revision: watchPolicyRevisions.revision,
        contractVersion: watchPolicyRevisions.contractVersion,
        policy: watchPolicyRevisions.policy,
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
      latestProposal: {
        id: row.revisionId,
        watchId: row.id,
        revision: row.revision,
        contractVersion: row.contractVersion,
        policy: row.policy,
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

