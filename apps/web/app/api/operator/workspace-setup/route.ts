import {
  saveValidatedWorkspaceOnboarding,
  WorkspaceOnboardingValidationError,
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
    const saved = await saveValidatedWorkspaceOnboarding({
      setup: body,
      actor: {
        id: access.principal.id,
        githubLogin: access.principal.githubLogin,
      },
      abortSignal: request.signal,
    });
    return Response.json(
      {
        saved: true,
        validation: saved.validation,
        repositoryUrl:
          saved.state.workingRepositoryInput?.workingDocumentationRepository.source.url,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof WorkspaceOnboardingValidationError) {
      return Response.json(
        {
          code: "workspace_setup_validation_failed",
          error: error.message,
          validation: error.validation,
        },
        { status: 409, headers: { "cache-control": "no-store" } },
      );
    }
    return Response.json(
      {
        code: "workspace_setup_unavailable",
        error:
          "Workspace setup could not be persisted. Check database readiness and retry validation.",
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
