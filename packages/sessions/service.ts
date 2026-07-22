import type { AgentSessionResultAsync } from "./errors.js";
import type { AgentSessionStore } from "./store.js";
import { agentSessionTitle } from "./title.js";
import type {
  IndexedAgentSession,
  ListAgentSessionsInput,
  RegisterAgentSessionInput,
  UpdateAgentSessionLifecycleInput,
} from "./types.js";

export class AgentSessionService {
  readonly #store: AgentSessionStore;

  constructor(store: AgentSessionStore) {
    this.#store = store;
  }

  get(sessionId: string): AgentSessionResultAsync<IndexedAgentSession | undefined> {
    return this.#store.get(sessionId);
  }

  list(
    input?: ListAgentSessionsInput,
  ): AgentSessionResultAsync<IndexedAgentSession[]> {
    return this.#store.list(input);
  }

  register(
    input: RegisterAgentSessionInput,
  ): AgentSessionResultAsync<IndexedAgentSession> {
    return this.#store.register({
      sessionId: input.sessionId,
      source: input.source,
      title: agentSessionTitle(input.firstMessage, input.source),
      registeredAt: input.registeredAt,
    });
  }

  updateLifecycle(
    input: UpdateAgentSessionLifecycleInput,
  ): AgentSessionResultAsync<void> {
    return this.#store.updateLifecycle(input);
  }
}
