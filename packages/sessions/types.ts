export type AgentSessionSource = "slack" | "local-web";

export type AgentSessionStatus =
  | "running"
  | "waiting"
  | "completed"
  | "failed";

export interface IndexedAgentSession {
  sessionId: string;
  source: AgentSessionSource;
  title: string;
  status: AgentSessionStatus;
  startedAt: string;
  updatedAt: string;
}

export interface RegisterAgentSessionInput {
  sessionId: string;
  source: AgentSessionSource;
  firstMessage: string;
  registeredAt?: string;
}

export interface UpdateAgentSessionLifecycleInput {
  sessionId: string;
  status?: AgentSessionStatus;
  occurredAt: string;
}

export interface ListAgentSessionsInput {
  source?: AgentSessionSource;
}
