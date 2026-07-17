import { agentSessionStore } from "../../../agent/sessions/database";
import { assertLocalOperatorAccess } from "@/operator-access";

import { SessionsIndex } from "./sessions-index";

export const dynamic = "force-dynamic";

export default async function SessionsPage() {
  assertLocalOperatorAccess();
  const sessions = await agentSessionStore().list();
  return <SessionsIndex initialSessions={sessions} />;
}
