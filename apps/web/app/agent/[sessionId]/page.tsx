import { notFound } from "next/navigation";

import { agentSessionStore } from "../../../../agent/sessions/database";
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
  const session = await agentSessionStore().get(sessionId);
  if (session?.source !== "local-web") notFound();

  return <AgentChat sessionId={sessionId} />;
}
