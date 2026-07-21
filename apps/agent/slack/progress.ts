import type { Thread } from "chat";
import { defineState } from "eve/context";

import {
  beginSlackReactionTurn,
  clearSlackWorkingReaction,
} from "./reactions";

const FIRST_PROGRESS_UPDATE_DELAY_MS = 60_000;
const LATER_PROGRESS_UPDATE_DELAY_MS = 120_000;
const SLACK_PROGRESS_MESSAGES = [
  "I’m still working on this — nothing’s stuck.",
  "Still on it. This is taking a little longer, but I’m making progress.",
] as const;

export interface SlackProgressTurnState {
  readonly nextUpdateAtMs: number | null;
  readonly turnId: string | null;
  readonly updatesSent: number;
}

interface SlackProgressUpdate {
  readonly message: string | null;
  readonly state: SlackProgressTurnState;
}

const slackProgressTurnState = defineState<SlackProgressTurnState>(
  "paige.slack-progress-turn",
  emptySlackProgressTurn,
);

export function beginSlackProgressTurn(
  turnId: string,
  nowMs = Date.now(),
): SlackProgressTurnState {
  return {
    nextUpdateAtMs: nowMs + FIRST_PROGRESS_UPDATE_DELAY_MS,
    turnId,
    updatesSent: 0,
  };
}

export function nextSlackProgressUpdate(
  state: SlackProgressTurnState,
  turnId: string,
  nowMs = Date.now(),
): SlackProgressUpdate {
  if (
    state.turnId !== turnId || state.nextUpdateAtMs === null ||
    nowMs < state.nextUpdateAtMs ||
    state.updatesSent >= SLACK_PROGRESS_MESSAGES.length
  ) {
    return { message: null, state };
  }

  const message = SLACK_PROGRESS_MESSAGES[state.updatesSent] ?? null;
  const updatesSent = state.updatesSent + 1;
  return {
    message,
    state: {
      nextUpdateAtMs: updatesSent < SLACK_PROGRESS_MESSAGES.length
        ? nowMs + LATER_PROGRESS_UPDATE_DELAY_MS
        : null,
      turnId,
      updatesSent,
    },
  };
}

function emptySlackProgressTurn(): SlackProgressTurnState {
  return { nextUpdateAtMs: null, turnId: null, updatesSent: 0 };
}

async function postSlackProgressUpdate(
  turnId: string,
  thread: Thread | null,
): Promise<void> {
  if (thread === null) return;

  const update = nextSlackProgressUpdate(slackProgressTurnState.get(), turnId);
  if (update.message === null) return;
  slackProgressTurnState.update(() => update.state);

  try {
    // Check at Eve's durable action boundaries: this avoids exposing tool names
    // while still reassuring users during genuinely long-running turns.
    await thread.post({ markdown: update.message });
  } catch (error) {
    // Progress feedback is helpful but must not turn accepted work into a
    // failed turn when Slack delivery is temporarily unavailable.
    console.error("Could not post Paige's Slack progress update.", error);
  }
}

async function handleSlackActionProgress(
  event: { readonly turnId: string },
  channel: { readonly thread: Thread | null },
): Promise<void> {
  await postSlackProgressUpdate(event.turnId, channel.thread);
}

export const quietSlackProgressEvents = {
  "action.result": handleSlackActionProgress,
  "actions.requested": handleSlackActionProgress,
  "session.waiting": async (
    _event: unknown,
    channel: { thread: Thread | null },
  ) => {
    await clearSlackWorkingReaction(channel.thread?.adapter ?? null);
  },
  "turn.completed": async (
    _event: unknown,
    channel: { thread: Thread | null },
  ) => {
    await clearSlackWorkingReaction(channel.thread?.adapter ?? null);
  },
  "turn.started": (
    event: { readonly turnId: string },
    channel: {
      state: { thread: Parameters<typeof beginSlackReactionTurn>[0] };
    },
  ) => {
    // Make the active inbound message available to the scoped reaction tool
    // and start a fresh, delayed progress cadence for this turn.
    beginSlackReactionTurn(channel.state.thread);
    slackProgressTurnState.update(() => beginSlackProgressTurn(event.turnId));
  },
};
