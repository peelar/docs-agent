import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { and, eq, sql } from "drizzle-orm";
import { test } from "vitest";

import {
  approveWatchProposal,
  createProposedWatch,
  getActivePolicyBoundWatch,
} from "../src/policy-bound-watches.ts";
import {
  getPolicyBoundWatchLifecycleItem,
  listPolicyBoundWatches,
  listWatchLifecycleEvents,
  mutateWatchLifecycle,
  type WatchLifecycleContext,
} from "../src/watch-lifecycle.ts";
import {
  migrateDocsAgentDatabase,
  withDocsAgentDatabase,
} from "../src/db/client.ts";
import {
  watchEffectiveRevisions,
  watchPolicyRevisions,
} from "../src/db/schema.ts";
import type { ProposedWatchPolicy } from "../src/watch-contract.ts";
import {
  prepareWatchWorkspace,
  READY_WATCH_CAPABILITY_REGISTRY,
  READY_WATCH_SERVICE_CONTEXT,
} from "./watch-test-fixtures.ts";

const NOW = new Date("2026-07-13T20:00:00.000Z");
const LIFECYCLE_CONTEXT: WatchLifecycleContext = {
  operator: { id: "operator-67", githubLogin: "docs-owner" },
  capabilityRegistry: READY_WATCH_CAPABILITY_REGISTRY,
  now: NOW,
};

test("watch lifecycle is audited, idempotent, and preserves approved authority", async () => {
  await withTemporaryDatabase(async () => {
    const active = await createActiveWatch("2026-08-13T00:00:00.000Z");
    assert.equal(active.stateRevision, 2);
    const effectiveRevisionId = active.effectiveRevision.id;

    const listed = await listPolicyBoundWatches(
      { now: NOW.toISOString() },
      READY_WATCH_SERVICE_CONTEXT,
    );
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.lifecycleState, "active");
    assert.equal(listed[0]?.admissionReady, true);

    const paused = await mutateWatchLifecycle({
      watchId: active.id,
      action: "pause",
      expectedStateRevision: 2,
      operationKey: "pause-watch-67",
      reason: "Pause proactive observation during the documentation freeze.",
    }, LIFECYCLE_CONTEXT);
    assert.equal(paused.watch.lifecycleState, "paused");
    assert.equal(paused.watch.stateRevision, 3);
    assert.equal(paused.watch.admissionReady, false);
    assert.equal(paused.watch.effectiveRevisionId, effectiveRevisionId);
    await assert.rejects(
      () => getActivePolicyBoundWatch(
        { id: active.id },
        { ...READY_WATCH_SERVICE_CONTEXT, now: NOW },
      ),
      /is not active/,
    );

    const replayedPause = await mutateWatchLifecycle({
      watchId: active.id,
      action: "pause",
      expectedStateRevision: 2,
      operationKey: "pause-watch-67",
      reason: "Pause proactive observation during the documentation freeze.",
    }, LIFECYCLE_CONTEXT);
    assert.equal(replayedPause.applied, false);
    assert.equal(replayedPause.replayed, true);
    assert.equal(replayedPause.event.id, paused.event.id);

    await assert.rejects(
      () => mutateWatchLifecycle({
        watchId: active.id,
        action: "resume",
        expectedStateRevision: 2,
        operationKey: "stale-resume-watch-67",
        reason: "Stale resume attempt.",
      }, LIFECYCLE_CONTEXT),
      /changed concurrently/,
    );
    await assert.rejects(
      () => mutateWatchLifecycle({
        watchId: active.id,
        action: "pause",
        expectedStateRevision: 3,
        operationKey: "invalid-second-pause-watch-67",
        reason: "Invalid second pause.",
      }, LIFECYCLE_CONTEXT),
      /only an active watch can be paused/i,
    );

    const resumed = await mutateWatchLifecycle({
      watchId: active.id,
      action: "resume",
      expectedStateRevision: 3,
      operationKey: "resume-watch-67",
      reason: "The documentation freeze ended.",
    }, LIFECYCLE_CONTEXT);
    assert.equal(resumed.watch.lifecycleState, "active");
    assert.equal(resumed.watch.stateRevision, 4);
    assert.equal(resumed.watch.effectiveRevisionId, effectiveRevisionId);
    assert.equal(
      (await getActivePolicyBoundWatch(
        { id: active.id },
        { ...READY_WATCH_SERVICE_CONTEXT, now: NOW },
      ))
        .effectiveRevision.id,
      effectiveRevisionId,
    );

    const deleted = await mutateWatchLifecycle({
      watchId: active.id,
      action: "delete",
      expectedStateRevision: 4,
      operationKey: "delete-watch-67",
      reason: "The operator no longer delegates attention to this channel.",
    }, LIFECYCLE_CONTEXT);
    assert.equal(deleted.watch.lifecycleState, "deleted");
    assert.equal(deleted.watch.stateRevision, 5);
    assert.equal(deleted.watch.policyRetained, false);
    assert.equal(deleted.watch.effectiveRevisionId, null);
    assert.deepEqual(await policyRowCounts(active.id), [0, 0]);

    const audit = await listWatchLifecycleEvents({ watchId: active.id });
    assert.deepEqual(
      audit.map(({ action }) => action),
      ["create", "approve", "pause", "resume", "delete"],
    );
    assert.deepEqual(
      audit.map(({ stateRevision }) => stateRevision),
      [1, 2, 3, 4, 5],
    );
    assert.deepEqual(audit.at(-1)?.actor, LIFECYCLE_CONTEXT.operator);
    assert.equal(audit.at(-1)?.effectiveRevisionId, effectiveRevisionId);
    assert.equal(audit.at(-1)?.previousState, "active");
    assert.equal(audit.at(-1)?.nextState, "deleted");

    const replayedDelete = await mutateWatchLifecycle({
      watchId: active.id,
      action: "delete",
      expectedStateRevision: 4,
      operationKey: "delete-watch-67",
      reason: "The operator no longer delegates attention to this channel.",
    }, LIFECYCLE_CONTEXT);
    assert.equal(replayedDelete.replayed, true);
    assert.equal((await listWatchLifecycleEvents({ watchId: active.id })).length, 5);
  });
});

test("watch expiry and concurrent lifecycle mutations fail closed", async () => {
  await withTemporaryDatabase(async () => {
    const expiring = await createActiveWatch("2026-07-14T00:00:00.000Z");
    const afterExpiry = new Date("2026-07-14T00:00:01.000Z");
    await assert.rejects(
      () => getActivePolicyBoundWatch(
        { id: expiring.id },
        { ...READY_WATCH_SERVICE_CONTEXT, now: afterExpiry },
      ),
      /has expired/,
    );
    assert.equal(
      (await getPolicyBoundWatchLifecycleItem({
        watchId: expiring.id,
        now: afterExpiry.toISOString(),
      }, { ...READY_WATCH_SERVICE_CONTEXT, now: afterExpiry })).admissionReady,
      false,
    );

    const expired = await mutateWatchLifecycle({
      watchId: expiring.id,
      action: "expire",
      expectedStateRevision: 2,
      operationKey: "expire-watch-67",
      reason: "The approved watch reached its configured expiry.",
    }, { ...LIFECYCLE_CONTEXT, now: afterExpiry });
    assert.equal(expired.watch.lifecycleState, "expired");
    assert.equal(expired.watch.stateRevision, 3);
    await assert.rejects(
      () => mutateWatchLifecycle({
        watchId: expiring.id,
        action: "resume",
        expectedStateRevision: 3,
        operationKey: "resume-expired-watch-67",
        reason: "Expired watches require a new approval.",
      }, { ...LIFECYCLE_CONTEXT, now: afterExpiry }),
      /only a paused watch/i,
    );

    const concurrent = await createActiveWatch("2026-08-13T00:00:00.000Z");
    const attempts = await Promise.allSettled([
      mutateWatchLifecycle({
        watchId: concurrent.id,
        action: "pause",
        expectedStateRevision: 2,
        operationKey: "concurrent-pause-a",
        reason: "First concurrent mutation.",
      }, LIFECYCLE_CONTEXT),
      mutateWatchLifecycle({
        watchId: concurrent.id,
        action: "delete",
        expectedStateRevision: 2,
        operationKey: "concurrent-delete-b",
        reason: "Second concurrent mutation.",
      }, LIFECYCLE_CONTEXT),
    ]);
    assert.equal(attempts.filter(({ status }) => status === "fulfilled").length, 1);
    assert.equal(attempts.filter(({ status }) => status === "rejected").length, 1);
    const events = await listWatchLifecycleEvents({ watchId: concurrent.id });
    assert.equal(
      events.filter(({ action }) => action === "pause" || action === "delete").length,
      1,
      "only one optimistic mutation is audited",
    );
  });
});

async function createActiveWatch(expiresAt: string) {
  const proposed = await createProposedWatch({
    policy: validPolicy(expiresAt),
    actor: { id: "author-67", githubLogin: "watch-author" },
  }, READY_WATCH_SERVICE_CONTEXT);
  return (await approveWatchProposal({
    watchId: proposed.id,
    proposalRevisionId: proposed.latestProposal.id,
    expectedProposalRevision: 1,
    decision: "approved",
    idempotencyKey: `approve-${proposed.id}`,
  }, {
    operator: { id: "operator-67", githubLogin: "docs-owner" },
    capabilityRegistry: READY_WATCH_CAPABILITY_REGISTRY,
    now: NOW,
  })).watch;
}

function validPolicy(expiresAt: string): ProposedWatchPolicy {
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
    expiresAt,
  };
}

async function policyRowCounts(watchId: string): Promise<[number, number]> {
  return withDocsAgentDatabase(async (db) => {
    const [proposals, effective] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(watchPolicyRevisions).where(and(
        eq(watchPolicyRevisions.workspaceId, "default"),
        eq(watchPolicyRevisions.watchId, watchId),
      )),
      db.select({ count: sql<number>`count(*)` }).from(watchEffectiveRevisions).where(and(
        eq(watchEffectiveRevisions.workspaceId, "default"),
        eq(watchEffectiveRevisions.watchId, watchId),
      )),
    ]);
    return [Number(proposals[0]?.count ?? 0), Number(effective[0]?.count ?? 0)];
  });
}

async function withTemporaryDatabase(run: () => Promise<void>): Promise<void> {
  const tempRoot = await mkdtemp(join(tmpdir(), "paige-watch-lifecycle-"));
  const originalDatabaseUrl = process.env.DOCS_AGENT_DATABASE_URL;
  const originalVercel = process.env.VERCEL;
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.DOCS_AGENT_DATABASE_URL = `file:${join(tempRoot, "lifecycle.sqlite")}`;
  delete process.env.VERCEL;
  delete process.env.NODE_ENV;
  try {
    await migrateDocsAgentDatabase();
    await prepareWatchWorkspace();
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
