import {
  type AuthFn,
  UnauthenticatedError,
} from "eve/channels/auth";

const workspaceHeader = "x-paige-operator-workspace";

export function operatorWebAuth(): AuthFn<Request> {
  return (request) => {
    const suppliedWorkspaceId = request.headers.get(workspaceHeader)?.trim();
    if (!suppliedWorkspaceId) return null;

    const configuredWorkspaceId =
      process.env.PAIGE_OPERATOR_WORKSPACE_ID?.trim();
    if (
      process.env.PAIGE_OPERATOR_ACCESS !== "local" ||
      !configuredWorkspaceId ||
      suppliedWorkspaceId !== configuredWorkspaceId ||
      !isLocalHostname(new URL(request.url).hostname)
    ) {
      throw new UnauthenticatedError({
        message: "Invalid Paige operator authentication.",
      });
    }

    return {
      authenticator: "slack",
      principalType: "user",
      principalId: `operator:${configuredWorkspaceId}`,
      attributes: { slackWorkspaceId: configuredWorkspaceId },
    };
  };
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "127.0.0.1" ||
    normalized === "::1";
}
