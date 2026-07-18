import type { ResultAsync } from "neverthrow";

export type AgentSessionErrorCode = "AGENT_SESSION_STORAGE_FAILED";

/** A failure while reading or updating Paige's agent session index. */
export class AgentSessionError extends Error {
  override readonly name = "AgentSessionError";

  constructor(
    readonly code: AgentSessionErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export type AgentSessionResultAsync<T> = ResultAsync<T, AgentSessionError>;
