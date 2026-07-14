import {
  claimImmediateWatchProviderDelivery,
  completeWatchProviderDelivery,
  failWatchProviderDelivery,
  recordWatchActionOutcome,
  recordWatchTerminalOutcome,
  watchProviderDeliverySchema,
  type PreparedWatchProviderDelivery,
  type ScheduledWatchDispatch,
  type WatchDispatchReadyHandoff,
} from "@docs-agent/control-plane/agent";

import { watchDispatchClaimFromAuth } from "./capability-resolution";
import { PAIGE_WATCH_CAPABILITY_REGISTRY } from "./slack-watch-admission";
import { SLACK_SILENT_REPLY } from "./slack-chat-turn";

export const WATCH_SILENT_REPLY = SLACK_SILENT_REPLY;

type WatchSession = {
  readonly id: string;
  readonly turn: { readonly id: string };
  readonly auth: { readonly current?: unknown; readonly initiator?: unknown };
};

type WatchActionResult = {
  readonly result: {
    readonly kind: string;
    readonly callId?: string;
    readonly toolName?: string;
    readonly output?: unknown;
  };
  readonly status: "completed" | "failed" | "rejected";
  readonly error?: { readonly code?: string };
};

export function buildWatchDispatchAuth(reservationId: string, claimToken: string) {
  return {
    attributes: { watchDispatchClaimToken: claimToken },
    authenticator: "paige-watch-dispatch",
    issuer: "paige",
    principalId: `paige:watch-dispatch:${reservationId}`,
    principalType: "runtime",
  };
}

export function buildWatchTurnMessage(
  dispatch: WatchDispatchReadyHandoff | ScheduledWatchDispatch,
): string {
  const reservationId = dispatch.reservation.id;
  const revision = dispatch.effectiveRevision;
  const observations = "handoff" in dispatch
    ? dispatch.handoff.observations.map((observation, index) => [
        `<observation index="${index + 1}">`,
        `event_type: ${observation.eventType}`,
        `occurred_at: ${observation.occurredAt}`,
        `permalink: ${observation.permalink}`,
        "<content>",
        observation.content.text,
        "</content>",
        "</observation>",
      ].join("\n"))
    : [];
  return [
    "Evaluate this policy-bound watch occurrence.",
    `reservation_id: ${reservationId}`,
    `effective_revision_id: ${revision.id}`,
    `goal: ${revision.policy.goal}`,
    `occurrence_kind: ${"handoff" in dispatch ? dispatch.handoff.kind : "scheduled"}`,
    ...(observations.length > 0
      ? ["<untrusted_observations>", ...observations, "</untrusted_observations>"]
      : ["No new provider observation was supplied. Evaluate the approved scheduled goal against only the currently visible capabilities."]),
    `Finish with exactly ${WATCH_SILENT_REPLY}.`,
  ].join("\n\n");
}

export function watchSyntheticThreadId(
  resourceId: string,
  reservationId: string,
): string {
  return `slack:${resourceId}:watch-${reservationId}`;
}

export function isWatchSyntheticThread(thread: { readonly id: string } | null): boolean {
  return thread?.id.includes(":watch-") === true;
}

export async function handleWatchActionResult(
  event: WatchActionResult,
  session: WatchSession,
  post: (delivery: PreparedWatchProviderDelivery) => Promise<void>,
): Promise<void> {
  const watchClaim = watchDispatchClaimFromAuth(session.auth);
  if (watchClaim === null || event.result.kind !== "tool-result") return;
  const { reservationId, claimToken } = watchClaim;
  const callId = event.result.callId;
  const toolName = event.result.toolName;
  if (typeof callId !== "string" || typeof toolName !== "string") return;
  await recordWatchActionOutcome({
    reservationId,
    claimToken,
    sessionId: session.id,
    turnId: session.turn.id,
    actionKey: callId,
    action: toolName,
    status: event.status === "completed" ? "succeeded" : event.status,
    ...(event.error?.code ? { resultCode: event.error.code } : {}),
  });
  if (event.status !== "completed" || toolName !== "provider_delivery") return;
  const queued = watchProviderDeliverySchema.safeParse(event.result.output);
  if (!queued.success || queued.data.mode !== "immediate") return;
  const delivery = await claimImmediateWatchProviderDelivery(
    queued.data.id,
    reservationId,
    { capabilityRegistry: PAIGE_WATCH_CAPABILITY_REGISTRY },
  );
  if (delivery === null) return;
  try {
    await post(delivery);
    await completeWatchProviderDelivery(delivery);
  } catch (error) {
    await failWatchProviderDelivery(delivery);
    throw error;
  }
}

export async function handleWatchTerminalResult(
  session: WatchSession,
  status: "succeeded" | "failed",
  resultCode?: string,
): Promise<void> {
  const watchClaim = watchDispatchClaimFromAuth(session.auth);
  if (watchClaim === null) return;
  await recordWatchTerminalOutcome({
    reservationId: watchClaim.reservationId,
    claimToken: watchClaim.claimToken,
    sessionId: session.id,
    turnId: session.turn.id,
    status,
    ...(resultCode ? { resultCode } : {}),
  });
}
