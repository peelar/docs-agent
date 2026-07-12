import {
  saveBehaviorSettings,
  saveBehaviorSettingsInputSchema,
} from "@docs-agent/control-plane";

import { resolveOperatorAccess } from "@/lib/operator";

export async function POST(request: Request): Promise<Response> {
  const access = await resolveOperatorAccess(request.headers);
  if (access.status !== "authorized") return accessError(access.status);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return response(400, "invalid_behavior_settings", "Expected a JSON settings payload.");
  }

  const parsed = saveBehaviorSettingsInputSchema.omit({ actor: true }).safeParse(body);
  if (!parsed.success) {
    return response(
      400,
      "invalid_behavior_settings",
      "Choose one supported value for every personality and participation setting.",
    );
  }

  try {
    const state = await saveBehaviorSettings({
      settings: parsed.data.settings,
      actor: {
        id: access.principal.id,
        githubLogin: access.principal.githubLogin,
      },
    });
    return Response.json(
      { saved: true, state },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return response(
      503,
      "behavior_settings_unavailable",
      "Behavior settings could not be persisted. Check database readiness and retry.",
    );
  }
}

function response(status: number, code: string, error: string): Response {
  return Response.json(
    { code, error },
    { status, headers: { "cache-control": "no-store" } },
  );
}

function accessError(status: "unauthorized" | "forbidden" | "unavailable"): Response {
  const httpStatus = status === "unauthorized" ? 401 : status === "forbidden" ? 403 : 503;
  return response(httpStatus, `operator_${status}`, `Operator access is ${status}.`);
}
