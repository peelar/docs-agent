import "server-only";

import { cache } from "react";
import { headers } from "next/headers";

import {
  isApprovedGitHubLogin,
  normalizeGitHubLogin,
  operatorAccessMode,
  readGitHubAuthConfiguration,
} from "./auth-config";
import { getOperatorAuth } from "./auth";

export type OperatorPrincipal = {
  id: string;
  githubAccountId: string | null;
  githubLogin: string;
  displayName: string;
  authMethod: "local" | "github" | "test";
};

export type OperatorAccessResult =
  | { status: "authorized"; principal: OperatorPrincipal }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "unavailable"; message: string };

export const getCurrentOperator = cache(async (): Promise<OperatorAccessResult> => {
  return resolveOperatorAccess(await headers());
});

export async function resolveOperatorAccess(
  requestHeaders: Headers,
): Promise<OperatorAccessResult> {
  const mode = operatorAccessMode();
  if (mode === "local") {
    return {
      status: "authorized",
      principal: {
        id: "docs-agent:local-operator",
        githubAccountId: null,
        githubLogin: "local-operator",
        displayName: "Local operator",
        authMethod: "local",
      },
    };
  }
  if (mode === "unavailable") {
    return {
      status: "unavailable",
      message:
        "Operator access is not configured. Set DOCS_AGENT_OPERATOR_ACCESS to local for explicit local development or github for a protected deployment.",
    };
  }

  let configuration;
  try {
    configuration = mode === "test"
      ? {
          approvedLogins: parseTestAllowlist(),
        }
      : readGitHubAuthConfiguration();
  } catch (error) {
    return {
      status: "unavailable",
      message: error instanceof Error
        ? error.message
        : "Operator authentication is unavailable.",
    };
  }

  const auth = await getOperatorAuth();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) return { status: "unauthorized" };

  const user = session.user as typeof session.user & { githubLogin?: unknown };
  const githubLogin = typeof user.githubLogin === "string"
    ? normalizeGitHubLogin(user.githubLogin)
    : "";
  if (!githubLogin || !isApprovedGitHubLogin(
    githubLogin,
    configuration.approvedLogins,
  )) {
    return { status: "forbidden" };
  }

  return {
    status: "authorized",
    principal: {
      id: `docs-agent:github:${user.id}`,
      githubAccountId: user.id,
      githubLogin,
      displayName: user.name || githubLogin,
      authMethod: mode,
    },
  };
}

function parseTestAllowlist(): ReadonlySet<string> {
  return new Set(["testoperator"]);
}
