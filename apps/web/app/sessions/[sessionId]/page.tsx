import { notFound } from "next/navigation";

import { resolveAgentSessionService } from "@paige/sessions/database";
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
  const result = await resolveAgentSessionService().asyncAndThen((sessions) =>
    sessions.get(sessionId)
  );
  if (result.isErr()) throw result.error;
  if (result.value === undefined) notFound();

  return <SessionDetail session={result.value} />;
}
