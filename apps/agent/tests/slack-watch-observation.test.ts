import assert from "node:assert/strict";

import type { SlackEvent } from "@chat-adapter/slack";
import type { WatchEventAdmission } from "@docs-agent/control-plane/agent";
import { test } from "vitest";

import {
  isSlackWatchObservationCandidateMetadata,
  isSupportedSlackWatchObservationEvent,
  normalizeSlackWatchObservation,
  SlackWatchObservationError,
} from "../agent/lib/slack-watch-observation";

const WATCH_ID = "00000000-0000-4000-8000-000000000072";
const EFFECTIVE_REVISION_ID = "00000000-0000-4000-8000-000000000073";
const RECEIVED_AT = "2026-07-13T22:00:01.000Z";

test("normalizes one supported human Slack message into the ephemeral envelope", () => {
  const event = slackEvent();
  const observation = normalizeSlackWatchObservation({
    event,
    admission: admission(),
    isSelf: false,
    permalink: "https://example.slack.com/archives/C-DOCS/p1710000000000100",
    receivedAt: RECEIVED_AT,
  });

  assert.equal(observation.watchId, WATCH_ID);
  assert.equal(observation.effectiveRevisionId, EFFECTIVE_REVISION_ID);
  assert.deepEqual(observation.source, {
    provider: "slack",
      providerWorkspaceId: "T-DOCS",
    resource: { type: "channel", id: "C-DOCS" },
  });
  assert.deepEqual(observation.actor, { kind: "user", id: "U-AUTHOR" });
  assert.equal(observation.occurredAt, "2024-03-09T16:00:00.000Z");
  assert.equal(observation.eventType, "message");
  assert.deepEqual(observation.thread, {
    id: "slack:T-DOCS:C-DOCS:1709999999.000900",
    rootEventId: "1709999999.000900",
  });
  assert.equal(
    observation.permalink,
    "https://example.slack.com/archives/C-DOCS/p1710000000000100",
  );
  assert.deepEqual(observation.provenance, {
    ingress: "provider-adapter",
    providerWorkspaceId: "T-DOCS",
    providerEventId: "slack:T-DOCS:C-DOCS:1710000000.000100",
    receivedAt: RECEIVED_AT,
    adapter: { name: "slack-events", version: "1" },
  });
  assert.equal(observation.content.text, "A human reported a docs gap.");
  assert.equal(observation.content.storage, "ephemeral");
  assert.equal(observation.content.retentionSeconds, 0);
  assert.equal(observation.disposition, "candidate-context-only");
  assert.doesNotMatch(
    JSON.stringify(observation),
    /rawPayload|attachments|blocks|files|bot_id/,
  );
});

test("rejects bot, self-authored, edited, deleted, and unsupported Slack shapes", () => {
  const unsupported: Array<{ event: SlackEvent; isSelf: boolean }> = [
    { event: slackEvent({ bot_id: "B-OTHER" }), isSelf: false },
    { event: slackEvent(), isSelf: true },
    { event: slackEvent({ edited: { ts: "1710000001.000100" } }), isSelf: false },
    { event: slackEvent({ subtype: "message_changed" }), isSelf: false },
    { event: slackEvent({ subtype: "message_deleted" }), isSelf: false },
    { event: slackEvent({ subtype: "file_share" }), isSelf: false },
    { event: slackEvent({ type: "app_mention" }), isSelf: false },
    { event: slackEvent({ channel_type: "im" }), isSelf: false },
  ];

  for (const input of unsupported) {
    assert.equal(
      isSlackWatchObservationCandidateMetadata(input.event, input.isSelf),
      false,
    );
    assert.equal(
      isSupportedSlackWatchObservationEvent(input.event, input.isSelf),
      false,
    );
    assert.throws(
      () => normalizeSlackWatchObservation({
        ...input,
        admission: admission(),
        permalink: "https://example.slack.com/archives/C-DOCS/p1710000000000100",
        receivedAt: RECEIVED_AT,
      }),
      errorWithCode("event-not-supported"),
    );
  }
});

test("rejects a supported message that does not match its admitted authority", () => {
  assert.throws(
    () => normalizeSlackWatchObservation({
      event: slackEvent({ channel: "C-OTHER" }),
      admission: admission(),
      isSelf: false,
      permalink: "https://example.slack.com/archives/C-OTHER/p1710000000000100",
      receivedAt: RECEIVED_AT,
    }),
    errorWithCode("admission-mismatch"),
  );
});

function admission(): WatchEventAdmission {
  return {
    workspaceId: "default",
    providerWorkspaceId: "T-DOCS",
    watchId: WATCH_ID,
    stateRevision: 2,
    effectiveRevision: {
      id: EFFECTIVE_REVISION_ID,
      watchId: WATCH_ID,
      proposalRevisionId: "00000000-0000-4000-8000-000000000074",
      contractVersion: 1,
      policy: {
        source: {
          provider: "slack",
      providerWorkspaceId: "T-DOCS",
          resource: { type: "channel", id: "C-DOCS" },
        },
        goal: "Find evidence-backed documentation gaps.",
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
      },
      approvedBy: { id: "operator-72", githubLogin: "docs-owner" },
      approvedAt: "2026-07-13T21:00:00.000Z",
    },
    source: {
      provider: "slack",
      providerWorkspaceId: "T-DOCS",
      resource: { type: "channel", id: "C-DOCS" },
    },
    eventType: "message",
    admittedAt: "2026-07-13T22:00:00.000Z",
  };
}

function slackEvent(overrides: Partial<SlackEvent> = {}): SlackEvent {
  return {
    channel: "C-DOCS",
    channel_type: "channel",
    team_id: "T-DOCS",
    text: "A human reported a docs gap.",
    thread_ts: "1709999999.000900",
    ts: "1710000000.000100",
    type: "message",
    user: "U-AUTHOR",
    ...overrides,
  };
}

function errorWithCode(code: SlackWatchObservationError["code"]) {
  return (error: unknown) =>
    error instanceof SlackWatchObservationError && error.code === code;
}
