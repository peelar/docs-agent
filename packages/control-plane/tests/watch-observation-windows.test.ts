import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test } from "vitest";

import {
  migrateDocsAgentDatabase,
  withDocsAgentDatabase,
} from "../src/db/client.ts";
import {
  watchObservationClaims,
  watchObservationWindows,
} from "../src/db/schema.ts";
import {
  approveWatchProposal,
  createProposedWatch,
  editWatchProposal,
} from "../src/policy-bound-watches.ts";
import { DEFAULT_WORKSPACE_ID } from "../src/setup-state.ts";
import type {
  ActivePolicyBoundWatch,
  ProposedWatchPolicy,
} from "../src/watch-contract.ts";
import { claimWatchObservation } from "../src/watch-observation-claims.ts";
import { createEphemeralWatchObservation } from "../src/watch-observation.ts";
import { mutateWatchLifecycle } from "../src/watch-lifecycle.ts";
import {
  assembleClaimedWatchObservation,
  flushReadyWatchObservationWindows,
  WatchObservationAssemblyError,
} from "../src/watch-observation-windows.ts";
import {
  prepareWatchWorkspace,
  READY_WATCH_CAPABILITY_REGISTRY,
} from "./watch-test-fixtures.ts";

const NOW = new Date("2026-07-13T22:00:00.000Z");

test("per-event evaluation returns one ephemeral handoff without storing raw content", async () => {
  await withTemporaryDatabase(async () => {
    const active = await createActiveWatch(policy({ evaluation: { mode: "per_event" } }));
    const observation = createObservation(active, "raw per-event secret", "001");
    const claimResult = await claim(observation);
    const result = await assembleClaimedWatchObservation({
      workspaceId: DEFAULT_WORKSPACE_ID,
      claimResult,
      observation,
    }, { now: NOW });

    assert.equal(result.disposition, "ready");
    assert.equal(result.handoffs.length, 1);
    assert.equal(result.handoffs[0]?.kind, "per_event");
    assert.equal(result.handoffs[0]?.observations[0]?.content.text, "raw per-event secret");
    assert.equal((await windowRows()).length, 0);
    assert.doesNotMatch(
      JSON.stringify(await claimRows()),
      /raw per-event secret|U-PRIVATE-ACTOR/u,
    );
  });
});

test("windowed evaluation survives reopens and hands off at event and context bounds", async () => {
  await withTemporaryDatabase(async () => {
    const active = await createActiveWatch(policy({
      evaluation: { mode: "windowed", windowSeconds: 300, maxObservations: 2 },
      retention: { rawObservationSeconds: 300, auditDays: 30 },
      context: {
        eventTypes: ["message"],
        includeThread: false,
        historyMessageLimit: 0,
        maxCharacters: 20,
      },
    }));
    const first = createObservation(active, "first secret", "101");
    const firstResult = await assemble(first, NOW);
    assert.equal(firstResult.disposition, "accumulated");
    assert.match(JSON.stringify(await windowRows()), /first secret/u);

    const second = createObservation(active, "second", "102");
    const secondResult = await assemble(
      second,
      new Date("2026-07-13T22:00:01.000Z"),
    );
    assert.equal(secondResult.disposition, "ready");
    assert.deepEqual(
      secondResult.handoffs[0]?.observations.map(({ content }) => content.text),
      ["first secret", "second"],
    );
    const handedOff = await windowRows();
    assert.equal(handedOff[0]?.status, "handed-off");
    assert.equal(handedOff[0]?.rawObservations, null);
    assert.equal(handedOff[0]?.observationCount, 2);
    assert.doesNotMatch(JSON.stringify(handedOff), /first secret|second/u);

    const contextActive = await createActiveWatch(policy({
      source: {
        provider: "slack",
      providerWorkspaceId: "T-DOCS",
        resource: { type: "channel", id: "C-CONTEXT" },
      },
      evaluation: { mode: "windowed", windowSeconds: 300, maxObservations: 10 },
      retention: { rawObservationSeconds: 300, auditDays: 30 },
      context: {
        eventTypes: ["message"],
        includeThread: false,
        historyMessageLimit: 0,
        maxCharacters: 8,
      },
    }));
    const contextFirst = createObservation(contextActive, "12345", "201");
    assert.equal((await assemble(contextFirst, NOW)).disposition, "accumulated");
    const contextSecond = createObservation(contextActive, "67890", "202");
    const split = await assemble(
      contextSecond,
      new Date("2026-07-13T22:00:02.000Z"),
    );
    assert.equal(split.disposition, "ready");
    assert.deepEqual(
      split.handoffs[0]?.observations.map(({ content }) => content.text),
      ["12345"],
    );
    const collecting = (await windowRows()).find(({ status }) => status === "collecting");
    assert.equal(collecting?.characterCount, 5);
    assert.match(JSON.stringify(collecting?.rawObservations), /67890/u);
  });
});

test("due windows hand off within retention and expire raw content after retention", async () => {
  await withTemporaryDatabase(async () => {
    const active = await createActiveWatch(policy({
      evaluation: { mode: "windowed", windowSeconds: 60, maxObservations: 10 },
      retention: { rawObservationSeconds: 60, auditDays: 30 },
    }));
    await assemble(createObservation(active, "handoff at boundary", "301"), NOW);
    const due = await flushReadyWatchObservationWindows({
      now: new Date("2026-07-13T22:01:00.000Z"),
    });
    assert.equal(due.length, 1);
    assert.equal(due[0]?.observations[0]?.content.text, "handoff at boundary");

    const laterActive = await createActiveWatch(policy({
      source: {
        provider: "slack",
      providerWorkspaceId: "T-DOCS",
        resource: { type: "channel", id: "C-RETENTION" },
      },
      evaluation: { mode: "windowed", windowSeconds: 60, maxObservations: 10 },
      retention: { rawObservationSeconds: 60, auditDays: 30 },
    }));
    await assemble(
      createObservation(laterActive, "must expire", "302"),
      new Date("2026-07-13T23:00:00.000Z"),
    );
    const expired = await flushReadyWatchObservationWindows({
      now: new Date("2026-07-13T23:01:01.000Z"),
    });
    assert.equal(expired.length, 0);
    const rows = await windowRows();
    const retentionRow = rows.find(({ resourceId }) => resourceId === "C-RETENTION");
    assert.equal(retentionRow?.status, "expired");
    assert.equal(retentionRow?.rawObservations, null);
    assert.doesNotMatch(JSON.stringify(retentionRow), /must expire/u);
  });
});

test("pause, policy expiry, and replacement reject new joins and clear old raw windows", async () => {
  await withTemporaryDatabase(async () => {
    const paused = await createActiveWatch(policy({
      source: {
        provider: "slack",
      providerWorkspaceId: "T-DOCS",
        resource: { type: "channel", id: "C-PAUSED" },
      },
      evaluation: { mode: "windowed", windowSeconds: 300, maxObservations: 10 },
      retention: { rawObservationSeconds: 300, auditDays: 30 },
    }));
    await assemble(createObservation(paused, "paused raw", "400"), NOW);
    await mutateWatchLifecycle({
      watchId: paused.id,
      action: "pause",
      expectedStateRevision: paused.stateRevision,
      operationKey: "pause-window-74",
      reason: "Verify paused watches cannot collect more observations.",
    }, {
      capabilityRegistry: READY_WATCH_CAPABILITY_REGISTRY,
      operator: { id: "operator-74", githubLogin: "docs-owner" },
      now: new Date("2026-07-13T22:00:05.000Z"),
    });
    await assert.rejects(
      () => assemble(
        createObservation(paused, "cannot join paused", "400b"),
        new Date("2026-07-13T22:00:06.000Z"),
      ),
      errorWithCode("authority-changed"),
    );

    const active = await createActiveWatch(policy({
      evaluation: { mode: "windowed", windowSeconds: 300, maxObservations: 10 },
      retention: { rawObservationSeconds: 300, auditDays: 30 },
    }));
    await assemble(createObservation(active, "old revision raw", "401"), NOW);

    const replacement = await editWatchProposal({
      watchId: active.id,
      expectedProposalRevision: 1,
      policy: { ...active.effectiveRevision.policy, goal: "Use replacement authority." },
    }, {
      capabilityRegistry: READY_WATCH_CAPABILITY_REGISTRY,
      operator: { id: "operator-74", githubLogin: "docs-owner" },
      now: new Date("2026-07-13T22:00:10.000Z"),
    });
    await approveWatchProposal({
      watchId: active.id,
      proposalRevisionId: replacement.watch.latestProposal.id,
      expectedProposalRevision: replacement.watch.latestProposal.revision,
      decision: "approved",
      idempotencyKey: `approve-${replacement.watch.latestProposal.id}`,
    }, {
      capabilityRegistry: READY_WATCH_CAPABILITY_REGISTRY,
      operator: { id: "operator-74", githubLogin: "docs-owner" },
      now: new Date("2026-07-13T22:00:11.000Z"),
    });

    const late = createObservation(active, "cannot join old revision", "402");
    await assert.rejects(
      () => assemble(late, new Date("2026-07-13T22:00:12.000Z")),
      errorWithCode("authority-changed"),
    );
    const row = (await windowRows()).find(
      ({ effectiveRevisionId }) => effectiveRevisionId === active.effectiveRevision.id,
    );
    assert.equal(row?.status, "expired");
    assert.equal(row?.rawObservations, null);
    assert.doesNotMatch(JSON.stringify(row), /old revision raw/u);

    const expiring = await createActiveWatch(policy({
      source: {
        provider: "slack",
      providerWorkspaceId: "T-DOCS",
        resource: { type: "channel", id: "C-EXPIRING" },
      },
      evaluation: { mode: "windowed", windowSeconds: 60, maxObservations: 10 },
      retention: { rawObservationSeconds: 60, auditDays: 30 },
      expiresAt: "2026-07-13T22:02:00.000Z",
    }));
    await assemble(
      createObservation(expiring, "expires with policy", "403"),
      new Date("2026-07-13T22:01:00.000Z"),
    );
    const expiredObservation = createObservation(expiring, "too late", "404");
    await assert.rejects(
      () => assemble(expiredObservation, new Date("2026-07-13T22:02:00.000Z")),
      errorWithCode("authority-changed"),
    );
  });
});

async function assemble(
  observation: ReturnType<typeof createObservation>,
  now: Date,
) {
  const claimResult = await claim(observation, now);
  return assembleClaimedWatchObservation({
    workspaceId: DEFAULT_WORKSPACE_ID,
    claimResult,
    observation,
  }, { now });
}

async function claim(
  observation: ReturnType<typeof createObservation>,
  now = NOW,
) {
  return claimWatchObservation({
    workspaceId: DEFAULT_WORKSPACE_ID,
    watchId: observation.watchId,
    effectiveRevisionId: observation.effectiveRevisionId,
    source: observation.source,
    providerEventId: observation.provenance.providerEventId,
  }, { now });
}

function createObservation(
  active: ActivePolicyBoundWatch,
  text: string,
  occurrence: string,
) {
  return createEphemeralWatchObservation({
    watchId: active.id,
    effectiveRevisionId: active.effectiveRevision.id,
    source: active.effectiveRevision.policy.source,
    actor: { kind: "user", id: "U-PRIVATE-ACTOR" },
    occurredAt: NOW.toISOString(),
    eventType: "message",
    thread: null,
    permalink: `https://example.slack.com/archives/${active.effectiveRevision.policy.source.resource.id}/p${occurrence}`,
    provenance: {
      ingress: "provider-adapter",
      providerWorkspaceId: "T-DOCS",
      providerEventId: `slack:T-DOCS:${active.effectiveRevision.policy.source.resource.id}:${occurrence}`,
      receivedAt: NOW.toISOString(),
      adapter: { name: "slack-events", version: "1" },
    },
    content: { text, mediaType: "text/plain" },
  }, active.effectiveRevision);
}

async function createActiveWatch(
  proposedPolicy: ProposedWatchPolicy,
): Promise<ActivePolicyBoundWatch> {
  await prepareWatchWorkspace();
  const proposed = await createProposedWatch({
    policy: proposedPolicy,
    actor: { id: "author-74", githubLogin: "watch-author" },
  }, {
    capabilityRegistry: READY_WATCH_CAPABILITY_REGISTRY,
    now: NOW,
  });
  return (await approveWatchProposal({
    watchId: proposed.id,
    proposalRevisionId: proposed.latestProposal.id,
    expectedProposalRevision: proposed.latestProposal.revision,
    decision: "approved",
    idempotencyKey: `approve-${proposed.id}`,
  }, {
    capabilityRegistry: READY_WATCH_CAPABILITY_REGISTRY,
    operator: { id: "operator-74", githubLogin: "docs-owner" },
    now: NOW,
  })).watch;
}

function policy(
  overrides: Partial<ProposedWatchPolicy> = {},
): ProposedWatchPolicy {
  return {
    source: {
      provider: "slack",
      providerWorkspaceId: "T-DOCS",
      resource: { type: "channel", id: "C-WINDOW" },
    },
    goal: "Find evidence-backed documentation gaps in a bounded window.",
    trigger: { type: "on_event" },
    evaluation: { mode: "per_event" },
    delivery: { mode: "silent" },
    context: {
      eventTypes: ["message"],
      includeThread: false,
      historyMessageLimit: 0,
      maxCharacters: 100,
    },
    capabilityGrants: ["knowledge.read"],
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

async function windowRows() {
  return withDocsAgentDatabase((db) => db.select().from(watchObservationWindows));
}

async function claimRows() {
  return withDocsAgentDatabase((db) => db.select().from(watchObservationClaims));
}

function errorWithCode(code: WatchObservationAssemblyError["code"]) {
  return (error: unknown) =>
    error instanceof WatchObservationAssemblyError && error.code === code;
}

async function withTemporaryDatabase(run: () => Promise<void>): Promise<void> {
  const tempRoot = await mkdtemp(join(tmpdir(), "paige-watch-windows-"));
  const originalDatabaseUrl = process.env.DOCS_AGENT_DATABASE_URL;
  const originalVercel = process.env.VERCEL;
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.DOCS_AGENT_DATABASE_URL = `file:${join(tempRoot, "windows.sqlite")}`;
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
