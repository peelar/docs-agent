import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sql } from "drizzle-orm";
import { test } from "vitest";

import {
  createProposedWatch,
  createProposedWatchInputSchema,
  getPolicyBoundWatch,
  WATCH_POLICY_CONTRACT_VERSION,
  type ProposedWatchPolicy,
} from "../src/policy-bound-watches.ts";
import {
  migrateDocsAgentDatabase,
  withDocsAgentDatabase,
} from "../src/db/client.ts";
import {
  prepareWatchWorkspace,
  READY_WATCH_SERVICE_CONTEXT,
} from "./watch-test-fixtures.ts";

test("policy-bound watch proposals are durable and inactive", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "paige-policy-bound-watch-"));
  const originalDatabaseUrl = process.env.DOCS_AGENT_DATABASE_URL;
  const originalVercel = process.env.VERCEL;
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.DOCS_AGENT_DATABASE_URL = `file:${join(tempRoot, "watches.sqlite")}`;
  delete process.env.VERCEL;
  delete process.env.NODE_ENV;

  try {
    await migrateDocsAgentDatabase();
    await prepareWatchWorkspace();
    const policy = fixturePolicy();
    const created = await createProposedWatch({
      policy,
      actor: { id: "operator-64", githubLogin: "docs-owner" },
    }, READY_WATCH_SERVICE_CONTEXT);

    assert.equal(created.workspaceId, "default");
    assert.equal(created.lifecycleState, "proposed");
    assert.equal(created.latestProposal.revision, 1);
    assert.equal(
      created.latestProposal.contractVersion,
      WATCH_POLICY_CONTRACT_VERSION,
    );
    assert.deepEqual(created.latestProposal.policy, policy);
    assert.deepEqual(created.latestProposal.createdBy, {
      id: "operator-64",
      githubLogin: "docs-owner",
    });

    const persisted = await getPolicyBoundWatch(
      { id: created.id },
      READY_WATCH_SERVICE_CONTEXT,
    );
    assert.deepEqual(persisted, created);

    const rowCounts = await withDocsAgentDatabase(async (db) => {
      const [watchRows, revisionRows, signalRows, memoryRows, presenceRows] =
        await Promise.all([
          db.all<{ count: number }>(sql`SELECT COUNT(*) AS count FROM policy_bound_watches`),
          db.all<{ count: number }>(sql`SELECT COUNT(*) AS count FROM watch_policy_revisions`),
          db.all<{ count: number }>(sql`SELECT COUNT(*) AS count FROM docs_signals`),
          db.all<{ count: number }>(sql`SELECT COUNT(*) AS count FROM workspace_knowledge_records`),
          db.all<{ count: number }>(sql`SELECT COUNT(*) AS count FROM slack_thread_presence`),
        ]);
      return [watchRows, revisionRows, signalRows, memoryRows, presenceRows]
        .map((rows) => Number(rows[0]?.count ?? 0));
    });
    assert.deepEqual(rowCounts, [1, 1, 0, 0, 0]);

    await assert.rejects(
      () => getPolicyBoundWatch(
        { id: "00000000-0000-4000-8000-000000000064" },
        READY_WATCH_SERVICE_CONTEXT,
      ),
      /was not found/,
    );

    assert.equal(createProposedWatchInputSchema.safeParse({
      policy,
      actor: { id: "operator-64", githubLogin: "docs-owner" },
      lifecycleState: "active",
    }).success, false);
    assert.equal(createProposedWatchInputSchema.safeParse({
      policy: {
        ...policy,
        capabilityGrants: ["publication.publish"],
      },
      actor: { id: "operator-64", githubLogin: "docs-owner" },
    }).success, false);
  } finally {
    restoreEnvironment("DOCS_AGENT_DATABASE_URL", originalDatabaseUrl);
    restoreEnvironment("VERCEL", originalVercel);
    restoreEnvironment("NODE_ENV", originalNodeEnv);
    await rm(tempRoot, { recursive: true, force: true });
  }
});

function fixturePolicy(): ProposedWatchPolicy {
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
      includeThread: true,
      historyMessageLimit: 10,
      maxCharacters: 12_000,
    },
    capabilityGrants: ["knowledge.read", "repository.read", "docs_work.manage"],
    retention: { rawObservationSeconds: 3_600, auditDays: 30 },
    budgets: {
      observationsPerHour: 100,
      processingRunsPerHour: 20,
      deliveriesPerDay: 0,
      inputCharactersPerHour: 120_000,
    },
    expiresAt: "2026-08-13T00:00:00.000Z",
  };
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
