import { z } from "zod";

import {
  gitHubWritebackPermissions,
  githubApiRequest,
  parseGitHubRepositoryUrl,
  resolveGitHubAppInstallationToken,
  type ConnectTokenResponse,
  type GitHubApiErrorResult,
} from "./github-app-client.js";
import {
  resolveGitHubConnector,
  type SetupState,
} from "./setup-state.js";

export const githubWritebackPreflightSchema = z.object({
  status: z.enum([
    "ready",
    "missing-connector",
    "connector-unavailable",
    "app-not-installed",
    "repository-not-granted",
    "insufficient-permissions",
  ]),
  message: z.string(),
});

export type GitHubWritebackPreflight = z.infer<
  typeof githubWritebackPreflightSchema
>;

export async function runGitHubWritebackPreflight(input: {
  state: SetupState;
  abortSignal?: AbortSignal;
}): Promise<GitHubWritebackPreflight> {
  const repository = input.state.workingRepositoryInput?.workingDocumentationRepository;
  if (repository === undefined) {
    return {
      status: "repository-not-granted",
      message: "No working documentation repository is configured.",
    };
  }

  const connector = resolveGitHubConnector(input.state);
  if (connector === "") {
    return {
      status: "missing-connector",
      message: "No GitHub connector is configured for writeback.",
    };
  }

  const slug = parseGitHubRepositoryUrl(repository.source.url);
  let tokenResponse: ConnectTokenResponse;
  let token: string;

  try {
    tokenResponse = await resolveGitHubAppInstallationToken({ connector, slug });
    token = tokenResponse.token;
  } catch (error) {
    return classifyConnectorError(error);
  }

  const installation = await githubApiRequest<GitHubInstallationRepositoriesResponse>({
    token,
    path: "/installation/repositories?per_page=100",
    abortSignal: input.abortSignal,
  });
  if (!installation.ok) return classifyInstallationError(installation);

  const repositoryAccess = await githubApiRequest<GitHubRepositoryResponse>({
    token,
    path: `/repos/${encodeURIComponent(slug.owner)}/${encodeURIComponent(slug.repo)}`,
    abortSignal: input.abortSignal,
  });
  if (!repositoryAccess.ok && repositoryAccess.status === 404) {
    return {
      status: "repository-not-granted",
      message:
        "The GitHub App token is valid, but the configured repository is not granted to the app installation.",
    };
  }
  if (!repositoryAccess.ok) {
    return {
      status: "connector-unavailable",
      message: repositoryAccess.message,
    };
  }

  const permissions = gitHubWritebackPermissions(tokenResponse);
  if (permissions.contents !== "write" || permissions.pull_requests !== "write") {
    return {
      status: "insufficient-permissions",
      message:
        "The GitHub App installation is available, but it does not have contents:write and pull_requests:write permissions.",
    };
  }

  return {
    status: "ready",
    message: "GitHub writeback is ready for the configured working documentation repository.",
  };
}

function classifyConnectorError(error: unknown): GitHubWritebackPreflight {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (lower.includes("connector") && lower.includes("not found")) {
    return { status: "missing-connector", message };
  }

  if (
    lower.includes("not available") ||
    lower.includes("environment") ||
    lower.includes("runtime") ||
    lower.includes("project")
  ) {
    return { status: "connector-unavailable", message };
  }

  return { status: "app-not-installed", message };
}

function classifyInstallationError(
  result: GitHubApiErrorResult,
): GitHubWritebackPreflight {
  if (result.status === 401 || result.status === 403) {
    return { status: "connector-unavailable", message: result.message };
  }
  if (result.status === 404) {
    return { status: "app-not-installed", message: result.message };
  }
  return { status: "connector-unavailable", message: result.message };
}

type GitHubInstallationRepositoriesResponse = {
  repositories: unknown[];
};

type GitHubRepositoryResponse = {
  full_name: string;
};
