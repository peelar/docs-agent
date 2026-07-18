import { resolveAgentSessionService } from "../../../../../agent/sessions/database";
import {
  isOperatorAccessFailure,
  localOperatorAccess,
} from "@/operator-access";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const access = localOperatorAccess(request);
  if (isOperatorAccessFailure(access)) {
    return errorResponse(access.status, access.error);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Expected local session metadata.");
  }

  if (!isRegistrationBody(body)) {
    return errorResponse(400, "Expected a session ID and first message.");
  }

  const result = await resolveAgentSessionService().asyncAndThen((sessions) =>
    sessions.register({
      sessionId: body.sessionId,
      source: "local-web",
      firstMessage: body.firstMessage,
    })
  );
  if (result.isErr()) {
    return errorResponse(503, "The local session could not be indexed.");
  }
  return Response.json({ session: result.value }, { headers: noStoreHeaders });
}

function isRegistrationBody(
  value: unknown,
): value is { sessionId: string; firstMessage: string } {
  if (typeof value !== "object" || value === null) return false;
  if (!("sessionId" in value) || !("firstMessage" in value)) return false;
  return typeof value.sessionId === "string" &&
    value.sessionId.trim().length > 0 &&
    value.sessionId.length <= 200 &&
    typeof value.firstMessage === "string" &&
    value.firstMessage.trim().length > 0;
}

const noStoreHeaders = { "cache-control": "no-store" };

function errorResponse(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: noStoreHeaders });
}
