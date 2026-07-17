import type { SessionState } from "eve/client";

const continuationPrefix = "paige.operator.continuation.v1:";
const legacySessionKey = "paige.operator.agent-session.v1";

export function clearLegacyAgentSession(): void {
  localStorage.removeItem(legacySessionKey);
}

export function readContinuationToken(sessionId: string): string | undefined {
  return localStorage.getItem(continuationKey(sessionId)) ?? undefined;
}

export function storeContinuationToken(session: SessionState): void {
  if (!session.sessionId || !session.continuationToken) return;
  localStorage.setItem(
    continuationKey(session.sessionId),
    session.continuationToken,
  );
}

function continuationKey(sessionId: string): string {
  return `${continuationPrefix}${sessionId}`;
}
