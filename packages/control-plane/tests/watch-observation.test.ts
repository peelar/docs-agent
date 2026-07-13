import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test } from "vitest";

import {
  createEphemeralWatchObservation,
  createEphemeralWatchObservationInputSchema,
  ephemeralWatchObservationSchema,
  redactWatchObservation,
  WatchObservationContractError,
} from "../src/watch-observation.ts";
import type {
  EffectiveWatchRevision,
  ProposedWatchPolicy,
} from "../src/watch-contract.ts";

const WATCH_ID = "00000000-0000-4000-8000-000000000070";
const EFFECTIVE_REVISION_ID = "00000000-0000-4000-8000-000000000071";

test("constructs a provider-neutral observation as bounded ephemeral candidate context", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "paige-observation-purity-"));
  const databasePath = join(tempRoot, "must-not-exist.sqlite");
  const originalDatabaseUrl = process.env.DOCS_AGENT_DATABASE_URL;
  process.env.DOCS_AGENT_DATABASE_URL = `file:${databasePath}`;
  try {
    const observation = createEphemeralWatchObservation(
      validInput("A documentation gap was reported. 👋"),
      effectiveRevision(),
    );

    assert.equal(observation.watchId, WATCH_ID);
    assert.equal(observation.effectiveRevisionId, EFFECTIVE_REVISION_ID);
    assert.deepEqual(observation.source, effectivePolicy().source);
    assert.deepEqual(observation.actor, { kind: "user", id: "U-DOCS-AUTHOR" });
    assert.equal(observation.occurredAt, "2026-07-13T20:00:00.000Z");
    assert.equal(observation.eventType, "message");
    assert.deepEqual(observation.thread, {
      id: "thread-1710000000.000100",
      rootEventId: "1710000000.000100",
    });
    assert.equal(observation.permalink, "https://example.slack.com/archives/C-DOCS-FEEDBACK/p1710000000000100");
    assert.deepEqual(observation.provenance, {
      ingress: "provider-adapter",
      providerWorkspaceId: "T-DOCS",
      providerEventId: "Ev-DOCS-70",
      providerDeliveryId: "delivery-70",
      receivedAt: "2026-07-13T20:00:01.000Z",
      adapter: { name: "slack-events", version: "1" },
    });
    assert.equal(observation.content.storage, "ephemeral");
    assert.equal(observation.content.retentionSeconds, 0);
    assert.equal(observation.content.characterCount, 35);
    assert.equal(observation.disposition, "candidate-context-only");
    assert.equal(existsSync(databasePath), false, "construction does not open persistence");

    const source = await readFile(
      new URL("../src/watch-observation.ts", import.meta.url),
      "utf8",
    );
    for (const forbiddenDependency of [
      "docs-signals",
      "workspace-memory",
      "libsql-chat-state",
      "db/client",
    ]) {
      assert.equal(source.includes(forbiddenDependency), false);
    }
  } finally {
    restoreEnvironment("DOCS_AGENT_DATABASE_URL", originalDatabaseUrl);
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("rejects missing provenance, invalid revisions, provider payloads, and unsafe permalinks", () => {
  const input = validInput("Bounded context.");
  assert.equal(createEphemeralWatchObservationInputSchema.safeParse({
    ...input,
    provenance: undefined,
  }).success, false);
  assert.equal(createEphemeralWatchObservationInputSchema.safeParse({
    ...input,
    watchId: "watch-70",
  }).success, false);
  assert.equal(createEphemeralWatchObservationInputSchema.safeParse({
    ...input,
    effectiveRevisionId: "revision-70",
  }).success, false);
  assert.equal(createEphemeralWatchObservationInputSchema.safeParse({
    ...input,
    rawPayload: { team_id: "T-DOCS", event: { text: "must not escape" } },
  }).success, false);
  assert.equal(createEphemeralWatchObservationInputSchema.safeParse({
    ...input,
    permalink: "https://token:secret@example.com/private",
  }).success, false);
  assert.equal(ephemeralWatchObservationSchema.safeParse({
    ...createEphemeralWatchObservation(input, effectiveRevision()),
    content: {
      text: "count mismatch",
      mediaType: "text/plain",
      characterCount: 1,
      storage: "ephemeral",
      retentionSeconds: 0,
    },
  }).success, false);

  assert.throws(
    () => createEphemeralWatchObservation(
      { ...input, effectiveRevisionId: "00000000-0000-4000-8000-000000000099" },
      effectiveRevision(),
    ),
    errorWithCode("revision-mismatch"),
  );
  assert.throws(
    () => createEphemeralWatchObservation({
      ...input,
      source: {
        provider: "slack",
        resource: { type: "channel", id: "C-OTHER" },
      },
    }, effectiveRevision()),
    errorWithCode("source-mismatch"),
  );
  assert.throws(
    () => createEphemeralWatchObservation(
      { ...input, eventType: "reaction_added" },
      effectiveRevision(),
    ),
    errorWithCode("event-not-admitted"),
  );
  assert.throws(
    () => createEphemeralWatchObservation(
      { ...input, occurredAt: "2026-08-13T00:00:00.000Z" },
      effectiveRevision(),
    ),
    errorWithCode("revision-expired"),
  );
});

test("enforces effective context limits and redacts ephemeral content completely", () => {
  const limitedRevision = effectiveRevision({
    ...effectivePolicy(),
    context: { ...effectivePolicy().context, maxCharacters: 5 },
  });
  assert.throws(
    () => createEphemeralWatchObservation(
      validInput("123456"),
      limitedRevision,
    ),
    errorWithCode("context-over-budget"),
  );

  const secret = "xoxb-secret-token customer@example.com";
  const observation = createEphemeralWatchObservation(
    validInput(secret),
    effectiveRevision(),
  );
  const redacted = redactWatchObservation(observation);
  const serialized = JSON.stringify(redacted);
  assert.doesNotMatch(serialized, /xoxb-secret-token|customer@example\.com/);
  assert.equal("text" in redacted.content, false);
  assert.deepEqual(redacted.content, {
    characterCount: 38,
    storage: "ephemeral",
    retentionSeconds: 0,
    redacted: true,
  });
  assert.equal(redacted.watchId, observation.watchId);
  assert.equal(redacted.provenance.providerEventId, "Ev-DOCS-70");
});

function validInput(text: string) {
  return {
    watchId: WATCH_ID,
    effectiveRevisionId: EFFECTIVE_REVISION_ID,
    source: effectivePolicy().source,
    actor: { kind: "user" as const, id: "U-DOCS-AUTHOR" },
    occurredAt: "2026-07-13T20:00:00.000Z",
    eventType: "message",
    thread: {
      id: "thread-1710000000.000100",
      rootEventId: "1710000000.000100",
    },
    permalink: "https://example.slack.com/archives/C-DOCS-FEEDBACK/p1710000000000100",
    provenance: {
      ingress: "provider-adapter" as const,
      providerWorkspaceId: "T-DOCS",
      providerEventId: "Ev-DOCS-70",
      providerDeliveryId: "delivery-70",
      receivedAt: "2026-07-13T20:00:01.000Z",
      adapter: { name: "slack-events", version: "1" },
    },
    content: { text, mediaType: "text/plain" as const },
  };
}

function effectiveRevision(
  policy: ProposedWatchPolicy = effectivePolicy(),
): EffectiveWatchRevision {
  return {
    id: EFFECTIVE_REVISION_ID,
    watchId: WATCH_ID,
    proposalRevisionId: "00000000-0000-4000-8000-000000000072",
    contractVersion: 1,
    policy,
    approvedBy: { id: "operator-70", githubLogin: "docs-owner" },
    approvedAt: "2026-07-13T19:00:00.000Z",
  };
}

function effectivePolicy(): ProposedWatchPolicy {
  return {
    source: {
      provider: "slack",
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
    capabilityGrants: ["knowledge.read"],
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

function errorWithCode(code: WatchObservationContractError["code"]) {
  return (error: unknown) =>
    error instanceof WatchObservationContractError && error.code === code;
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
