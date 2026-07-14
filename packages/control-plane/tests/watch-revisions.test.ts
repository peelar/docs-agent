import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sql } from "drizzle-orm";
import { test } from "vitest";

import {
  approveWatchProposal,
  createProposedWatch,
  editWatchProposal,
  getActivePolicyBoundWatch,
  getEffectiveWatchRevision,
  getPolicyBoundWatch,
  type WatchApprovalContext,
} from "../src/policy-bound-watches.ts";
import {
  migrateDocsAgentDatabase,
  withDocsAgentDatabase,
} from "../src/db/client.ts";
import { listWatchLifecycleEvents } from "../src/watch-lifecycle.ts";
import type { ProposedWatchPolicy } from "../src/watch-contract.ts";
import {
  prepareWatchWorkspace,
  READY_WATCH_CAPABILITY_REGISTRY,
  READY_WATCH_SERVICE_CONTEXT,
} from "./watch-test-fixtures.ts";

const NOW = new Date("2026-07-13T20:00:00.000Z");
const OPERATOR = { id: "operator-68", githubLogin: "docs-owner" };
const APPROVAL_CONTEXT: WatchApprovalContext = {
  operator: OPERATOR,
  capabilityRegistry: READY_WATCH_CAPABILITY_REGISTRY,
  now: NOW,
};

test("goal edits remain proposed until approved and preserve in-flight revisions", async () => {
  await withTemporaryDatabase(async () => {
    const initial = await createProposedWatch({
      policy: validPolicy(),
      actor: { id: "author-68", githubLogin: "watch-author" },
    }, READY_WATCH_SERVICE_CONTEXT);
    assert.equal(initial.latestProposal.changeClassification, null);
    const firstApproval = await approveWatchProposal({
      watchId: initial.id,
      proposalRevisionId: initial.latestProposal.id,
      expectedProposalRevision: 1,
      decision: "approved",
      idempotencyKey: "approve-68-r1",
    }, APPROVAL_CONTEXT);
    const firstEffectiveId = firstApproval.watch.effectiveRevision.id;

    const editedPolicy = {
      ...validPolicy(),
      goal: "Find only high-confidence documentation gaps in this channel.",
    };
    const edited = await editWatchProposal({
      watchId: initial.id,
      expectedProposalRevision: 1,
      policy: editedPolicy,
    }, {
      ...READY_WATCH_SERVICE_CONTEXT,
      operator: OPERATOR,
      now: new Date("2026-07-13T20:01:00.000Z"),
    });

    assert.equal(edited.watch.latestProposal.revision, 2);
    assert.deepEqual(edited.watch.latestProposal.changeClassification, edited.classification);
    assert.equal(edited.classification.approvalRequired, true);
    assert.equal(
      edited.classification.changes.some(({ kind }) => kind === "goal"),
      true,
    );
    const beforeApproval = await getActivePolicyBoundWatch(
      { id: initial.id },
      { ...READY_WATCH_SERVICE_CONTEXT, now: NOW },
    );
    assert.equal(beforeApproval.effectiveRevision.id, firstEffectiveId);
    assert.deepEqual(beforeApproval.effectiveRevision.policy, validPolicy());

    const replacement = await approveWatchProposal({
      watchId: initial.id,
      proposalRevisionId: edited.watch.latestProposal.id,
      expectedProposalRevision: 2,
      decision: "approved",
      idempotencyKey: "approve-68-r2",
    }, APPROVAL_CONTEXT);
    assert.notEqual(replacement.watch.effectiveRevision.id, firstEffectiveId);
    assert.deepEqual(replacement.watch.effectiveRevision.policy, editedPolicy);

    const inFlight = await getEffectiveWatchRevision({
      watchId: initial.id,
      effectiveRevisionId: firstEffectiveId,
    }, READY_WATCH_SERVICE_CONTEXT);
    assert.deepEqual(inFlight.policy, validPolicy());
    assert.equal(inFlight.id, firstEffectiveId);
    assert.equal(await effectiveRevisionCount(), 2);
    const events = await listWatchLifecycleEvents({ watchId: initial.id });
    assert.deepEqual(events.map(({ action }) => action), [
      "create",
      "approve",
      "approve-replacement",
    ]);
  });
});

test("narrowing edits are audited without mutating approved policy", async () => {
  await withTemporaryDatabase(async () => {
    const initial = await createAndApprove();
    const approvedPolicy = initial.effectiveRevision.policy;
    const narrowedPolicy: ProposedWatchPolicy = {
      ...approvedPolicy,
      capabilityGrants: ["knowledge.read"],
      context: { ...approvedPolicy.context, maxCharacters: 6_000 },
      retention: { ...approvedPolicy.retention, auditDays: 15 },
      budgets: { ...approvedPolicy.budgets, processingRunsPerHour: 6 },
      expiresAt: "2026-08-01T00:00:00.000Z",
    };

    const edited = await editWatchProposal({
      watchId: initial.id,
      expectedProposalRevision: 1,
      policy: narrowedPolicy,
    }, {
      ...READY_WATCH_SERVICE_CONTEXT,
      operator: OPERATOR,
      now: new Date("2026-07-13T20:02:00.000Z"),
    });
    assert.equal(edited.classification.hasAuthorityExpansion, false);
    assert.equal(edited.classification.hasAuthorityNarrowing, true);
    assert.equal(edited.watch.latestProposal.createdBy.id, OPERATOR.id);
    assert.deepEqual(
      (await getActivePolicyBoundWatch(
        { id: initial.id },
        { ...READY_WATCH_SERVICE_CONTEXT, now: NOW },
      ))
        .effectiveRevision.policy,
      approvedPolicy,
    );

    await assert.rejects(
      () => editWatchProposal({
        watchId: initial.id,
        expectedProposalRevision: 1,
        policy: { ...narrowedPolicy, goal: "A stale edit." },
      }, { ...READY_WATCH_SERVICE_CONTEXT, operator: OPERATOR, now: NOW }),
      /proposal changed concurrently/,
    );
    assert.equal((await getPolicyBoundWatch(
      { id: initial.id },
      READY_WATCH_SERVICE_CONTEXT,
    )).latestProposal.revision, 2);
  });
});

test("concurrent edits produce one next revision and leave admission on the approved one", async () => {
  await withTemporaryDatabase(async () => {
    const initial = await createAndApprove();
    const edits = await Promise.allSettled([
      editWatchProposal({
        watchId: initial.id,
        expectedProposalRevision: 1,
        policy: { ...initial.effectiveRevision.policy, goal: "Concurrent goal A." },
      }, {
        ...READY_WATCH_SERVICE_CONTEXT,
        operator: OPERATOR,
        now: new Date("2026-07-13T20:03:00.000Z"),
      }),
      editWatchProposal({
        watchId: initial.id,
        expectedProposalRevision: 1,
        policy: { ...initial.effectiveRevision.policy, goal: "Concurrent goal B." },
      }, {
        ...READY_WATCH_SERVICE_CONTEXT,
        operator: OPERATOR,
        now: new Date("2026-07-13T20:03:01.000Z"),
      }),
    ]);
    assert.equal(edits.filter(({ status }) => status === "fulfilled").length, 1);
    assert.equal(edits.filter(({ status }) => status === "rejected").length, 1);
    assert.equal((await getPolicyBoundWatch(
      { id: initial.id },
      READY_WATCH_SERVICE_CONTEXT,
    )).latestProposal.revision, 2);
    assert.equal(await proposalRevisionCount(), 2);
    assert.equal(
      (await getActivePolicyBoundWatch(
        { id: initial.id },
        { ...READY_WATCH_SERVICE_CONTEXT, now: NOW },
      ))
        .effectiveRevision.id,
      initial.effectiveRevision.id,
    );
  });
});

async function createAndApprove() {
  const proposed = await createProposedWatch({
    policy: validPolicy(),
    actor: { id: "author-68", githubLogin: "watch-author" },
  }, READY_WATCH_SERVICE_CONTEXT);
  return (await approveWatchProposal({
    watchId: proposed.id,
    proposalRevisionId: proposed.latestProposal.id,
    expectedProposalRevision: 1,
    decision: "approved",
    idempotencyKey: `approve-${proposed.id}`,
  }, APPROVAL_CONTEXT)).watch;
}

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

async function proposalRevisionCount(): Promise<number> {
  return count("watch_policy_revisions");
}

async function effectiveRevisionCount(): Promise<number> {
  return count("watch_effective_revisions");
}

async function count(table: "watch_policy_revisions" | "watch_effective_revisions") {
  return withDocsAgentDatabase(async (db) => {
    const rows = await db.all<{ count: number }>(sql.raw(
      `SELECT COUNT(*) AS count FROM ${table}`,
    ));
    return Number(rows[0]?.count ?? 0);
  });
}

async function withTemporaryDatabase(run: () => Promise<void>): Promise<void> {
  const tempRoot = await mkdtemp(join(tmpdir(), "paige-watch-revisions-"));
  const originalDatabaseUrl = process.env.DOCS_AGENT_DATABASE_URL;
  const originalVercel = process.env.VERCEL;
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.DOCS_AGENT_DATABASE_URL = `file:${join(tempRoot, "revisions.sqlite")}`;
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
