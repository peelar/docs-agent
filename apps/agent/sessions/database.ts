import { createClient } from "@libsql/client";
import { err, ok, Result } from "neverthrow";

import { AgentSessionError } from "./errors";
import { AgentSessionService } from "./service";
import { LibsqlAgentSessionStore } from "./store";

let service: AgentSessionService | undefined;

export function resolveAgentSessionService(): Result<
  AgentSessionService,
  AgentSessionError
> {
  if (service !== undefined) return ok(service);

  const url = process.env.PAIGE_DATABASE_URL?.trim();
  if (!url) {
    return err(new AgentSessionError(
      "AGENT_SESSION_STORAGE_FAILED",
      "Paige's agent session index is not configured.",
    ));
  }

  return Result.fromThrowable(
    () => {
      service = new AgentSessionService(
        new LibsqlAgentSessionStore(createClient({
          url,
          authToken: process.env.PAIGE_DATABASE_AUTH_TOKEN?.trim() || undefined,
        })),
      );
      return service;
    },
    (cause) =>
      new AgentSessionError(
        "AGENT_SESSION_STORAGE_FAILED",
        "Paige's agent session index could not be initialized.",
        { cause },
      ),
  )();
}
