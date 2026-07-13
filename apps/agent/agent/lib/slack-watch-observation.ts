import type { SlackEvent } from "@chat-adapter/slack";

import {
  createEphemeralWatchObservation,
  type EphemeralWatchObservation,
  type WatchEventAdmission,
} from "@docs-agent/control-plane/agent";

export type SlackWatchObservationInput = {
  event: SlackEvent;
  admission: WatchEventAdmission;
  isSelf: boolean;
  permalink: string;
  receivedAt: string;
};

export class SlackWatchObservationError extends Error {
  readonly code: "event-not-supported" | "admission-mismatch";

  constructor(code: SlackWatchObservationError["code"], message: string) {
    super(message);
    this.name = "SlackWatchObservationError";
    this.code = code;
  }
}

export function isSupportedSlackWatchObservationEvent(
  event: SlackEvent,
  isSelf: boolean,
): boolean {
  return isSlackWatchObservationCandidateMetadata(event, isSelf) &&
    typeof event.text === "string" &&
    event.text.length > 0;
}

export function isSlackWatchObservationCandidateMetadata(
  event: SlackEvent,
  isSelf: boolean,
): boolean {
  return event.type === "message" &&
    event.subtype === undefined &&
    event.bot_id === undefined &&
    event.edited === undefined &&
    !isSelf &&
    typeof event.team_id === "string" &&
    event.team_id.length > 0 &&
    typeof event.channel === "string" &&
    event.channel.length > 0 &&
    event.channel_type !== "im" &&
    typeof event.user === "string" &&
    event.user.length > 0 &&
    typeof event.ts === "string" &&
    slackTimestampPattern.test(event.ts);
}

export function normalizeSlackWatchObservation(
  input: SlackWatchObservationInput,
): EphemeralWatchObservation {
  if (!isSupportedSlackWatchObservationEvent(input.event, input.isSelf)) {
    throw new SlackWatchObservationError(
      "event-not-supported",
      "Only original human Slack channel messages can become watch observations.",
    );
  }

  const event = input.event as SlackEvent & {
    channel: string;
    team_id: string;
    text: string;
    ts: string;
    user: string;
  };
  if (
    input.admission.providerWorkspaceId !== event.team_id ||
    input.admission.source.provider !== "slack" ||
    input.admission.source.resource.type !== "channel" ||
    input.admission.source.resource.id !== event.channel ||
    input.admission.eventType !== event.type
  ) {
    throw new SlackWatchObservationError(
      "admission-mismatch",
      "The Slack message does not match its resolved watch admission.",
    );
  }

  const rootEventId = event.thread_ts ?? event.ts;
  return createEphemeralWatchObservation({
    watchId: input.admission.watchId,
    effectiveRevisionId: input.admission.effectiveRevision.id,
    source: input.admission.source,
    actor: { kind: "user", id: event.user },
    occurredAt: slackTimestampToIso(event.ts),
    eventType: input.admission.eventType,
    thread: {
      id: `slack:${event.team_id}:${event.channel}:${rootEventId}`,
      rootEventId,
    },
    permalink: input.permalink,
    provenance: {
      ingress: "provider-adapter",
      providerWorkspaceId: event.team_id,
      providerEventId: `slack:${event.team_id}:${event.channel}:${event.ts}`,
      receivedAt: input.receivedAt,
      adapter: { name: "slack-events", version: "1" },
    },
    content: {
      text: event.text,
      mediaType: "text/plain",
    },
  }, input.admission.effectiveRevision);
}

const slackTimestampPattern = /^\d+(?:\.\d{1,9})?$/u;

function slackTimestampToIso(value: string): string {
  const [seconds, fractional = ""] = value.split(".");
  const milliseconds = Number(seconds) * 1_000 +
    Number(fractional.padEnd(3, "0").slice(0, 3));
  if (!Number.isSafeInteger(milliseconds)) {
    throw new SlackWatchObservationError(
      "event-not-supported",
      "The Slack message occurrence time is invalid.",
    );
  }
  return new Date(milliseconds).toISOString();
}
