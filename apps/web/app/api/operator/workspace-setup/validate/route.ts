import {
  readWorkspaceOnboardingDraft,
  validateWorkspaceOnboarding,
} from "@docs-agent/control-plane";

import { resolveOperatorAccess } from "@/lib/operator";

export async function POST(request: Request): Promise<Response> {
  const access = await resolveOperatorAccess(request.headers);
  if (access.status !== "authorized") return accessError(access.status);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { code: "invalid_workspace_setup", error: "Expected a JSON setup payload." },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    await readWorkspaceOnboardingDraft();
    const validation = await validateWorkspaceOnboarding(body, undefined, request.signal);
    return Response.json(
      { validation },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return Response.json(
      {
        code: "workspace_setup_unavailable",
        error:
          "Workspace setup validation could not reach its database. Check the Status report and server configuration.",
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}

function accessError(status: "unauthorized" | "forbidden" | "unavailable"): Response {
  const httpStatus = status === "unauthorized" ? 401 : status === "forbidden" ? 403 : 503;
  return Response.json(
    { code: `operator_${status}`, error: `Operator access is ${status}.` },
    { status: httpStatus, headers: { "cache-control": "no-store" } },
  );
}
