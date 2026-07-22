import { resolveAgentSessionService } from "@paige/sessions/database";
import { assertLocalOperatorAccess } from "@/operator-access";

import { SessionsIndex } from "./sessions-index";

export const dynamic = "force-dynamic";

export default async function SessionsPage() {
  assertLocalOperatorAccess();
  const sessions = await resolveAgentSessionService().asyncAndThen((service) =>
    service.list()
  );
  if (sessions.isErr()) throw sessions.error;
  return <SessionsIndex initialSessions={sessions.value} />;
}
