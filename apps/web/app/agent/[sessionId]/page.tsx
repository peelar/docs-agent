import { notFound } from "next/navigation";

import { resolveAgentSessionService } from "../../../../agent/sessions/database";
import { assertLocalOperatorAccess } from "@/operator-access";

import { AgentChat } from "../agent-chat";

export const dynamic = "force-dynamic";

export default async function ExistingAgentPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  assertLocalOperatorAccess();
  const { sessionId } = await params;
  const result = await resolveAgentSessionService().asyncAndThen((sessions) =>
    sessions.get(sessionId)
  );
  if (result.isErr()) throw result.error;
  if (result.value?.source !== "local-web") notFound();

  return <AgentChat sessionId={sessionId} />;
}
