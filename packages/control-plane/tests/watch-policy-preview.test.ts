import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sql } from "drizzle-orm";
import { expect, test } from "vitest";

import { migrateDocsAgentDatabase, withDocsAgentDatabase } from "../src/db/client.ts";
import {
  previewWatchPolicy,
  WatchPolicyValidationError,
  type WatchPolicyPreviewContext,
} from "../src/watch-policy-preview.ts";
import type {
  WatchCapabilityFamily,
  WatchPolicyDraft,
} from "../src/watch-contract.ts";

const NOW = new Date("2026-07-13T20:00:00.000Z");
const ALL_CAPABILITIES: WatchCapabilityFamily[] = [
  "knowledge.read",
  "repository.read",
  "docs_work.manage",
  "draft.edit",
  "follow_up.schedule",
  "provider.deliver",
];
const CONTEXT: WatchPolicyPreviewContext = {
  availableCapabilities: ALL_CAPABILITIES,
  now: NOW,
};

test("watch policy preview resolves defaults without persistence", async () => {
  await withTemporaryDatabase(async () => {
    const preview = previewWatchPolicy({ policy: minimalDraft() }, CONTEXT);

    assert.equal(preview.contractVersion, 1);
    assert.equal(preview.lifecycleState, "proposed");
    assert.deepEqual(preview.effectivePolicy.trigger, { type: "on_event" });
    assert.deepEqual(preview.effectivePolicy.evaluation, { mode: "per_event" });
    assert.deepEqual(preview.effectivePolicy.delivery, { mode: "silent" });
    assert.deepEqual(preview.effectivePolicy.capabilityGrants, []);
    assert.deepEqual(preview.effectivePolicy.context, {
      eventTypes: ["message"],
      includeThread: false,
      historyMessageLimit: 0,
      maxCharacters: 12_000,
    });
    assert.deepEqual(preview.effectivePolicy.retention, {
      rawObservationSeconds: 0,
      auditDays: 30,
    });
    assert.deepEqual(preview.effectivePolicy.budgets, {
      observationsPerHour: 60,
      processingRunsPerHour: 12,
      deliveriesPerDay: 0,
      inputCharactersPerHour: 120_000,
    });
    assert.equal(preview.effectivePolicy.expiresAt, "2026-08-12T20:00:00.000Z");
    assert.ok(preview.defaultsApplied.includes("policy.delivery"));
    assert.ok(preview.defaultsApplied.includes("policy.context.maxCharacters"));
    assert.deepEqual(
      preview.operatorConsequences.map(({ kind }) => kind),
      ["source", "evaluation", "delivery", "context", "authority", "retention", "expiry"],
    );
    assert.match(
      preview.operatorConsequences.find(({ kind }) => kind === "authority")?.summary ?? "",
      /ignore and abstain.*outcomes/i,
    );

    const counts = await watchCounts();
    assert.deepEqual(counts, [0, 0], "preview must not persist or activate a watch");
  });
});

test("watch policy preview covers every trigger, evaluation, delivery, and grant value", () => {
  const eventWindow = previewWatchPolicy({
    lifecycleState: "proposed",
    contractVersion: 1,
    policy: completeDraft({
      trigger: { type: "on_event" },
      evaluation: { mode: "windowed", windowSeconds: 300, maxObservations: 20 },
      delivery: { mode: "immediate" },
      capabilityGrants: ALL_CAPABILITIES,
      retention: { rawObservationSeconds: 300, auditDays: 20 },
      budgets: {
        observationsPerHour: 200,
        processingRunsPerHour: 20,
        deliveriesPerDay: 5,
        inputCharactersPerHour: 250_000,
      },
    }),
  }, CONTEXT);
  assert.equal(eventWindow.effectivePolicy.trigger.type, "on_event");
  assert.equal(eventWindow.effectivePolicy.evaluation.mode, "windowed");
  assert.equal(eventWindow.effectivePolicy.delivery.mode, "immediate");
  assert.deepEqual(eventWindow.effectivePolicy.capabilityGrants, ALL_CAPABILITIES);

  const scheduledDigest = previewWatchPolicy({ policy: completeDraft({
    trigger: {
      type: "on_schedule",
      schedule: { cron: "0 9 * * 1-5", timeZone: "Europe/Warsaw" },
    },
    evaluation: { mode: "windowed", windowSeconds: 3_600, maxObservations: 50 },
    delivery: {
      mode: "digest",
      schedule: { cron: "0 10 * * 1-5", timeZone: "Europe/Warsaw" },
    },
    capabilityGrants: ["provider.deliver"],
    retention: { rawObservationSeconds: 3_600, auditDays: 30 },
    budgets: {
      observationsPerHour: 100,
      processingRunsPerHour: 10,
      deliveriesPerDay: 1,
      inputCharactersPerHour: 120_000,
    },
  }) }, CONTEXT);
  assert.equal(scheduledDigest.effectivePolicy.trigger.type, "on_schedule");
  assert.equal(scheduledDigest.effectivePolicy.delivery.mode, "digest");

  const perEventSilent = previewWatchPolicy({ policy: completeDraft() }, CONTEXT);
  assert.equal(perEventSilent.effectivePolicy.evaluation.mode, "per_event");
  assert.equal(perEventSilent.effectivePolicy.delivery.mode, "silent");
});

test("watch policy preview fails closed with secret-safe structured errors", () => {
  expect.hasAssertions();
  assertIssue(
    { lifecycleState: "active", policy: minimalDraft() },
    CONTEXT,
    "invalid-lifecycle",
  );
  assertIssue(
    { contractVersion: 99, policy: minimalDraft() },
    CONTEXT,
    "unsupported-contract-version",
  );
  assertIssue(
    { policy: { ...minimalDraft(), source: {
      provider: "linear",
      resource: { type: "project", id: "secret-resource-xoxb-123" },
    } } },
    CONTEXT,
    "unsupported-provider-resource",
    "secret-resource-xoxb-123",
  );

  for (const capability of [
    "publication.publish",
    "ignore",
    "abstain",
    "repo_read_file",
    "retired.read",
  ]) {
    assertIssue(
      { policy: completeDraft({ capabilityGrants: [capability] }) },
      CONTEXT,
      capability === "publication.publish" ? "publication-forbidden" : "unknown-capability",
    );
  }

  assertIssue(
    { policy: completeDraft({ capabilityGrants: ["repository.read"] }) },
    { availableCapabilities: ["knowledge.read"], now: NOW },
    "capability-unavailable",
  );
  assertIssue(
    { policy: completeDraft({ capabilityGrants: ["knowledge.read", "knowledge.read"] }) },
    CONTEXT,
    "duplicate-capability",
  );
  assertIssue(
    { policy: completeDraft({
      delivery: { mode: "immediate" },
      capabilityGrants: [],
      budgets: {
        observationsPerHour: 60,
        processingRunsPerHour: 12,
        deliveriesPerDay: 1,
        inputCharactersPerHour: 120_000,
      },
    }) },
    CONTEXT,
    "incompatible-policy",
  );
  assertIssue(
    { policy: completeDraft({
      trigger: {
        type: "on_schedule",
        schedule: { cron: "0 9 * * *", timeZone: "UTC" },
      },
      evaluation: { mode: "per_event" },
    }) },
    CONTEXT,
    "incompatible-policy",
  );
  assertIssue(
    { policy: completeDraft({
      evaluation: { mode: "windowed", windowSeconds: 600, maxObservations: 10 },
      retention: { rawObservationSeconds: 60, auditDays: 30 },
    }) },
    CONTEXT,
    "incompatible-policy",
  );
  assertIssue(
    { policy: completeDraft({ expiresAt: "2026-07-13T19:59:59.000Z" }) },
    CONTEXT,
    "expired-policy",
  );
  assertIssue(
    { policy: { ...minimalDraft(), actions: ["ignore"] } },
    CONTEXT,
    "invalid-contract",
  );
});

function minimalDraft(): WatchPolicyDraft {
  return {
    source: {
      provider: "slack",
      resource: { type: "channel", id: "C-DOCS-FEEDBACK" },
    },
    goal: "Find evidence-backed documentation gaps discussed in this channel.",
  };
}

function completeDraft(
  overrides: Partial<WatchPolicyDraft> = {},
): WatchPolicyDraft {
  return {
    ...minimalDraft(),
    trigger: { type: "on_event" },
    evaluation: { mode: "per_event" },
    delivery: { mode: "silent" },
    context: {
      eventTypes: ["message"],
      includeThread: false,
      historyMessageLimit: 0,
      maxCharacters: 12_000,
    },
    capabilityGrants: [],
    retention: { rawObservationSeconds: 0, auditDays: 30 },
    budgets: {
      observationsPerHour: 60,
      processingRunsPerHour: 12,
      deliveriesPerDay: 0,
      inputCharactersPerHour: 120_000,
    },
    expiresAt: "2026-08-13T00:00:00.000Z",
    ...overrides,
  };
}

function assertIssue(
  input: unknown,
  context: WatchPolicyPreviewContext,
  code: WatchPolicyValidationError["issues"][number]["code"],
  secret?: string,
): void {
  assert.throws(
    () => previewWatchPolicy(input, context),
    (error) => {
      assert.ok(error instanceof WatchPolicyValidationError);
      expect(error.issues.some((issue) => issue.code === code)).toBe(true);
      const forbiddenValue = secret ?? "__not-an-input-value__";
      expect(error.message).not.toContain(forbiddenValue);
      expect(JSON.stringify(error.issues)).not.toContain(forbiddenValue);
      return true;
    },
  );
}

async function withTemporaryDatabase(run: () => Promise<void>): Promise<void> {
  const tempRoot = await mkdtemp(join(tmpdir(), "paige-watch-policy-preview-"));
  const originalDatabaseUrl = process.env.DOCS_AGENT_DATABASE_URL;
  const originalVercel = process.env.VERCEL;
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.DOCS_AGENT_DATABASE_URL = `file:${join(tempRoot, "preview.sqlite")}`;
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

async function watchCounts(): Promise<[number, number]> {
  return withDocsAgentDatabase(async (db) => {
    const [watches, revisions] = await Promise.all([
      db.all<{ count: number }>(sql`SELECT COUNT(*) AS count FROM policy_bound_watches`),
      db.all<{ count: number }>(sql`SELECT COUNT(*) AS count FROM watch_policy_revisions`),
    ]);
    return [
      Number(watches[0]?.count ?? 0),
      Number(revisions[0]?.count ?? 0),
    ];
  });
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
