import type { AgentSessionSource } from "./types";

const maximumTitleLength = 80;
const slackUserMention = /<?@U[A-Z0-9]+>?/;

export function agentSessionTitle(
  firstMessage: string,
  source?: AgentSessionSource,
): string {
  // Eve's flattened Slack event keeps the platform user ID but does not expose
  // which ID belongs to the addressed agent. New Slack sessions are mention
  // driven, so presenting that trigger as Paige avoids leaking the raw ID.
  const displayMessage = source === "slack"
    ? firstMessage.replace(slackUserMention, "@Paige")
    : firstMessage;
  const normalized = displayMessage.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) return "Untitled session";
  if (normalized.length <= maximumTitleLength) return normalized;
  return `${normalized.slice(0, maximumTitleLength - 1).trimEnd()}…`;
}
