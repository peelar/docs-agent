import { notFound } from "next/navigation";

import { agentSessionStore } from "../../../../agent/sessions/database";
import { assertLocalOperatorAccess } from "@/operator-access";

import { SessionDetail } from "./session-detail";

export const dynamic = "force-dynamic";

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  assertLocalOperatorAccess();
  const { sessionId } = await params;
  const session = await agentSessionStore().get(sessionId);
  if (session === undefined) notFound();

  return <SessionDetail session={session} />;
}
