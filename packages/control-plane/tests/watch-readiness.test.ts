import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq, sql } from "drizzle-orm";
import { test } from "vitest";

import {
  migrateDocsAgentDatabase,
  withDocsAgentDatabase,
} from "../src/db/client.ts";
import {
  policyBoundWatches,
  watchEffectiveRevisions,
  watchPolicyRevisions,
  workspaceSetup,
} from "../src/db/schema.ts";
import {
  approveWatchProposal,
  createProposedWatch,
  getActivePolicyBoundWatch,
} from "../src/policy-bound-watches.ts";
import {
  listPolicyBoundWatches,
  mutateWatchLifecycle,
} from "../src/watch-lifecycle.ts";
import { getWatchReadiness } from "../src/watch-readiness.ts";
import type { ProposedWatchPolicy } from "../src/watch-contract.ts";
import {
  prepareWatchWorkspace,
  READY_WATCH_SERVICE_CONTEXT,
} from "./watch-test-fixtures.ts";

const NOW = new Date("2026-07-13T20:00:00.000Z");
const OPERATOR = { id: "operator-69", githubLogin: "docs-owner" };
const SERVICE_CONTEXT = { ...READY_WATCH_SERVICE_CONTEXT, now: NOW };
const LIFECYCLE_CONTEXT = {
  ...SERVICE_CONTEXT,
  operator: OPERATOR,
};

test("watch readiness distinguishes every durable state without inventing usability", async () => {
  await withTemporaryDatabase(async () => {
    await prepareWatchWorkspace();
    const proposed = await createProposedWatch({
      policy: validPolicy(),
      actor: OPERATOR,
    }, SERVICE_CONTEXT);
    assert.deepEqual(
      await getWatchReadiness({ watchId: proposed.id }, SERVICE_CONTEXT),
      {
        watchId: proposed.id,
        status: "proposed",
        lifecycleState: "proposed",
        usable: false,
        effectiveRevisionId: null,
        summary: "The watch is proposed and has no approved authority.",
        issues: [],
        checkedAt: NOW.toISOString(),
      },
    );

    const active = await approveWatchProposal({
      watchId: proposed.id,
      proposalRevisionId: proposed.latestProposal.id,
      expectedProposalRevision: 1,
      decision: "approved",
      idempotencyKey: "approve-watch-69",
    }, {
      ...SERVICE_CONTEXT,
      operator: OPERATOR,
    });
    const activeReadiness = await getWatchReadiness(
      { watchId: proposed.id },
      SERVICE_CONTEXT,
    );
    assert.equal(activeReadiness.status, "active");
    assert.equal(activeReadiness.usable, true);
    assert.equal(
      activeReadiness.effectiveRevisionId,
      active.watch.effectiveRevision.id,
    );

    await mutateWatchLifecycle({
      watchId: proposed.id,
      action: "pause",
      expectedStateRevision: active.watch.stateRevision,
      operationKey: "pause-watch-69",
      reason: "Verify paused readiness.",
    }, LIFECYCLE_CONTEXT);
    const paused = await getWatchReadiness({ watchId: proposed.id }, SERVICE_CONTEXT);
    assert.equal(paused.status, "paused");
    assert.equal(paused.usable, false);

    const expired = await getWatchReadiness(
      { watchId: proposed.id },
      { ...READY_WATCH_SERVICE_CONTEXT, now: new Date("2026-08-14T00:00:00.000Z") },
    );
    assert.equal(expired.status, "expired");
    assert.equal(expired.usable, false);

    await withDocsAgentDatabase((db) =>
      db.update(watchEffectiveRevisions)
        .set({ policy: { corrupt: true } })
        .where(eq(watchEffectiveRevisions.id, active.watch.effectiveRevision.id))
    );
    const invalid = await getWatchReadiness({ watchId: proposed.id }, SERVICE_CONTEXT);
    assert.equal(invalid.status, "invalid");
    assert.equal(invalid.usable, false);
    assert.equal(invalid.issues[0]?.code, "persisted-policy-invalid");

    const missing = await getWatchReadiness(
      { watchId: "00000000-0000-4000-8000-000000000069" },
      SERVICE_CONTEXT,
    );
    assert.equal(missing.status, "invalid");
    assert.equal(missing.issues[0]?.code, "watch-state-missing");

    const unavailable = await getWatchReadiness(
      { watchId: proposed.id },
      { capabilityRegistry: undefined, now: NOW },
    );
    assert.equal(unavailable.status, "unavailable");
    assert.equal(unavailable.usable, false);
    assert.equal(unavailable.issues[0]?.code, "capability-registry-unavailable");
    assert.doesNotMatch(JSON.stringify(unavailable), /sqlite|token|github\.com/i);
  });
});

test("missing setup or capability state cannot create, approve, resume, or report active", async () => {
  await withTemporaryDatabase(async () => {
    await assert.rejects(
      () => createProposedWatch({ policy: validPolicy(), actor: OPERATOR }, SERVICE_CONTEXT),
      /valid canonical workspace setup/,
    );
    assert.deepEqual(await watchRowCounts(), [0, 0, 0]);

    await prepareWatchWorkspace();
    const awaitingApproval = await createProposedWatch({
      policy: validPolicy(),
      actor: OPERATOR,
    }, SERVICE_CONTEXT);
    const activeProposal = await createProposedWatch({
      policy: validPolicy(),
      actor: OPERATOR,
    }, SERVICE_CONTEXT);
    const active = await approveWatchProposal({
      watchId: activeProposal.id,
      proposalRevisionId: activeProposal.latestProposal.id,
      expectedProposalRevision: 1,
      decision: "approved",
      idempotencyKey: "approve-active-watch-69",
    }, { ...SERVICE_CONTEXT, operator: OPERATOR });
    await mutateWatchLifecycle({
      watchId: active.watch.id,
      action: "pause",
      expectedStateRevision: active.watch.stateRevision,
      operationKey: "pause-before-setup-loss-69",
      reason: "Prepare the fail-closed resume case.",
    }, LIFECYCLE_CONTEXT);

    await withDocsAgentDatabase((db) =>
      db.delete(workspaceSetup).where(eq(workspaceSetup.id, "default"))
    );
    await assert.rejects(
      () => approveWatchProposal({
        watchId: awaitingApproval.id,
        proposalRevisionId: awaitingApproval.latestProposal.id,
        expectedProposalRevision: 1,
        decision: "approved",
        idempotencyKey: "approval-without-setup-69",
      }, { ...SERVICE_CONTEXT, operator: OPERATOR }),
      /valid canonical workspace setup/,
    );
    await assert.rejects(
      () => mutateWatchLifecycle({
        watchId: active.watch.id,
        action: "resume",
        expectedStateRevision: active.watch.stateRevision + 1,
        operationKey: "resume-without-setup-69",
        reason: "This must fail before resuming.",
      }, LIFECYCLE_CONTEXT),
      /valid canonical workspace setup/,
    );
    await assert.rejects(
      () => listPolicyBoundWatches({}, SERVICE_CONTEXT),
      /valid canonical workspace setup/,
    );
    await assert.rejects(
      () => getActivePolicyBoundWatch({ id: active.watch.id }, SERVICE_CONTEXT),
      /valid canonical workspace setup/,
    );
    const unavailable = await getWatchReadiness(
      { watchId: active.watch.id },
      SERVICE_CONTEXT,
    );
    assert.equal(unavailable.status, "unavailable");
    assert.equal(unavailable.issues[0]?.code, "workspace-setup-unavailable");

    await prepareWatchWorkspace();
    await assert.rejects(
      () => createProposedWatch(
        { policy: validPolicy(), actor: OPERATOR },
        { capabilityRegistry: undefined } as never,
      ),
      /server-owned capability registry/,
    );
    const missingRegistryContext = {
      capabilityRegistry: undefined,
      operator: OPERATOR,
      now: NOW,
    } as never;
    await assert.rejects(
      () => approveWatchProposal({
        watchId: awaitingApproval.id,
        proposalRevisionId: awaitingApproval.latestProposal.id,
        expectedProposalRevision: 1,
        decision: "approved",
        idempotencyKey: "approval-without-registry-69",
      }, missingRegistryContext),
      /server-owned capability registry/,
    );
    await assert.rejects(
      () => mutateWatchLifecycle({
        watchId: active.watch.id,
        action: "resume",
        expectedStateRevision: active.watch.stateRevision + 1,
        operationKey: "resume-without-registry-69",
        reason: "This must fail before resuming.",
      }, missingRegistryContext),
      /server-owned capability registry/,
    );
    await assert.rejects(
      () => listPolicyBoundWatches({}, missingRegistryContext),
      /server-owned capability registry/,
    );
    await assert.rejects(
      () => getActivePolicyBoundWatch({ id: active.watch.id }, missingRegistryContext),
      /server-owned capability registry/,
    );
    assert.deepEqual(await watchRowCounts(), [2, 2, 1]);
  });
});

test("watch persistence failures roll back and survive a fresh connection", async () => {
  await withTemporaryDatabase(async () => {
    await prepareWatchWorkspace();
    const corrupt = await createProposedWatch({
      policy: validPolicy(),
      actor: OPERATOR,
    }, SERVICE_CONTEXT);
    await withDocsAgentDatabase((db) =>
      db.update(watchPolicyRevisions)
        .set({ policy: { corrupt: true } })
        .where(eq(watchPolicyRevisions.id, corrupt.latestProposal.id))
    );
    await assert.rejects(
      () => approveWatchProposal({
        watchId: corrupt.id,
        proposalRevisionId: corrupt.latestProposal.id,
        expectedProposalRevision: 1,
        decision: "approved",
        idempotencyKey: "reject-corrupt-policy-69",
      }, { ...SERVICE_CONTEXT, operator: OPERATOR }),
      /watch policy is invalid/i,
    );
    assert.equal((await watchRowCounts())[2], 0, "failed approval rolls back");

    const restartProposal = await createProposedWatch({
      policy: validPolicy(),
      actor: OPERATOR,
    }, SERVICE_CONTEXT);
    const beforeRestart = await approveWatchProposal({
      watchId: restartProposal.id,
      proposalRevisionId: restartProposal.latestProposal.id,
      expectedProposalRevision: 1,
      decision: "approved",
      idempotencyKey: "restart-watch-69",
    }, { ...SERVICE_CONTEXT, operator: OPERATOR });
    await migrateDocsAgentDatabase();
    const afterRestart = await getActivePolicyBoundWatch(
      { id: restartProposal.id },
      SERVICE_CONTEXT,
    );
    assert.equal(
      afterRestart.effectiveRevision.id,
      beforeRestart.watch.effectiveRevision.id,
    );

    await withDocsAgentDatabase((db) =>
      db.update(policyBoundWatches)
        .set({ effectiveRevisionId: "00000000-0000-4000-8000-000000000001" })
        .where(eq(policyBoundWatches.id, restartProposal.id))
    );
    const missingState = await getWatchReadiness(
      { watchId: restartProposal.id },
      SERVICE_CONTEXT,
    );
    assert.equal(missingState.status, "invalid");
    assert.equal(missingState.issues[0]?.code, "effective-revision-missing");
  });
});

test("missing deployment database configuration and migrations fail visibly", async () => {
  const originalDatabaseUrl = process.env.DOCS_AGENT_DATABASE_URL;
  const originalVercel = process.env.VERCEL;
  const originalNodeEnv = process.env.NODE_ENV;
  try {
    delete process.env.DOCS_AGENT_DATABASE_URL;
    process.env.VERCEL = "1";
    process.env.NODE_ENV = "production";
    await assert.rejects(
      () => createProposedWatch({ policy: validPolicy(), actor: OPERATOR }, SERVICE_CONTEXT),
      /DOCS_AGENT_DATABASE_URL is required/,
    );
    const unavailable = await getWatchReadiness(
      { watchId: "00000000-0000-4000-8000-000000000069" },
      SERVICE_CONTEXT,
    );
    assert.equal(unavailable.status, "unavailable");
    assert.equal(unavailable.issues[0]?.code, "storage-unavailable");

    const tempRoot = await mkdtemp(join(tmpdir(), "paige-watch-unmigrated-"));
    try {
      delete process.env.VERCEL;
      delete process.env.NODE_ENV;
      process.env.DOCS_AGENT_DATABASE_URL = `file:${join(tempRoot, "unmigrated.sqlite")}`;
      await assert.rejects(
        () => createProposedWatch(
          { policy: validPolicy(), actor: OPERATOR },
          SERVICE_CONTEXT,
        ),
        /database schema is not ready/i,
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  } finally {
    restoreEnvironment("DOCS_AGENT_DATABASE_URL", originalDatabaseUrl);
    restoreEnvironment("VERCEL", originalVercel);
    restoreEnvironment("NODE_ENV", originalNodeEnv);
  }
});

function validPolicy(): ProposedWatchPolicy {
  return {
    source: {
      provider: "slack",
      providerWorkspaceId: "T-DOCS",
      resource: { type: "channel", id: "C-DOCS-FEEDBACK" },
    },
    goal: "Find evidence-backed documentation gaps discussed in this channel.",
    trigger: { type: "on_event" },
    evaluation: { mode: "per_event" },
    delivery: { mode: "silent" },
    context: {
      eventTypes: ["message"],
      includeThread: false,
      historyMessageLimit: 0,
      maxCharacters: 12_000,
    },
    capabilityGrants: ["knowledge.read", "repository.read"],
    retention: { rawObservationSeconds: 0, auditDays: 30 },
    budgets: {
      observationsPerHour: 60,
      processingRunsPerHour: 12,
      deliveriesPerDay: 0,
      inputCharactersPerHour: 120_000,
    },
    expiresAt: "2026-08-13T00:00:00.000Z",
  };
}

async function watchRowCounts(): Promise<[number, number, number]> {
  return withDocsAgentDatabase(async (db) => {
    const rows = await Promise.all([
      db.all<{ count: number }>(sql`SELECT COUNT(*) AS count FROM policy_bound_watches`),
      db.all<{ count: number }>(sql`SELECT COUNT(*) AS count FROM watch_policy_revisions`),
      db.all<{ count: number }>(sql`SELECT COUNT(*) AS count FROM watch_effective_revisions`),
    ]);
    return rows.map((result) => Number(result[0]?.count ?? 0)) as [number, number, number];
  });
}

async function withTemporaryDatabase(run: () => Promise<void>): Promise<void> {
  const tempRoot = await mkdtemp(join(tmpdir(), "paige-watch-readiness-"));
  const originalDatabaseUrl = process.env.DOCS_AGENT_DATABASE_URL;
  const originalVercel = process.env.VERCEL;
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.DOCS_AGENT_DATABASE_URL = `file:${join(tempRoot, "readiness.sqlite")}`;
  delete process.env.VERCEL;
  delete process.env.NODE_ENV;
  try {
    await migrateDocsAgentDatabase();
    await run();
  } finally {
    restoreEnvironment("DOCS_AGENT_DATABASE_URL", originalDatabaseUrl);
    restoreEnvironment("VERCEL", originalVercel);
    restoreEnvironment("NODE_ENV", originalNodeEnv);
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
