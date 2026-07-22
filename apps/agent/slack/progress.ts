import type { Adapter } from "chat";
import { defineState } from "eve/context";
import { z } from "zod";

import type { SlackReactionTarget } from "./reactions";

export interface SlackProgressTurnState {
  readonly startedAtMs: number | null;
  readonly turnId: string | null;
  readonly updateSent: boolean;
}

export type SlackProgressClient = Pick<Adapter, "postMessage">;

export const slackProgressMessageSchema = z.string().trim().min(1).max(500)
  .refine(
    (value) => value.trim().split(/\s+/u).length <= 60,
    "The progress update must contain no more than 60 words.",
  ).refine(
    (value) =>
      !/^(?:(?:i(?:['’]m| am) )?(?:still )?working on (?:this|it)|still on it)(?:[\s.!—-].*)?$/iu
        .test(value.trim()),
    "Share a concrete interim finding and what remains, not a generic activity update.",
  );

export const slackProgressTurnState = defineState<SlackProgressTurnState>(
  "paige.slack-progress-turn",
  emptySlackProgressTurn,
);

export function beginSlackProgressTurn(
  turnId: string,
  nowMs = Date.now(),
): SlackProgressTurnState {
  return {
    startedAtMs: nowMs,
    turnId,
    updateSent: false,
  };
}

export function elapsedSlackTurnDescription(
  state: SlackProgressTurnState,
  nowMs = Date.now(),
): string {
  if (state.startedAtMs === null) return "an unknown amount of time";

  const elapsedSeconds = Math.max(
    0,
    Math.floor((nowMs - state.startedAtMs) / 1_000),
  );
  if (elapsedSeconds < 60) return `${elapsedSeconds} seconds`;

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  const remainingSeconds = elapsedSeconds % 60;
  if (remainingSeconds === 0) return `${elapsedMinutes} minutes`;
  return `${elapsedMinutes} minutes ${remainingSeconds} seconds`;
}

export function claimSlackProgressUpdate(
  state: SlackProgressTurnState,
  turnId: string,
): SlackProgressTurnState {
  if (state.turnId !== turnId) {
    throw new Error("The active Slack turn changed before progress was shared.");
  }
  if (state.updateSent) {
    throw new Error("Paige already shared progress for this Slack turn.");
  }
  return { ...state, updateSent: true };
}

export function releaseSlackProgressUpdate(
  state: SlackProgressTurnState,
  turnId: string,
): SlackProgressTurnState {
  return state.turnId === turnId ? { ...state, updateSent: false } : state;
}

export async function postSlackProgressUpdate(
  client: SlackProgressClient,
  target: SlackReactionTarget,
  message: string,
): Promise<void> {
  await client.postMessage(target.threadId, { markdown: message });
}

function emptySlackProgressTurn(): SlackProgressTurnState {
  return {
    startedAtMs: null,
    turnId: null,
    updateSent: false,
  };
}
