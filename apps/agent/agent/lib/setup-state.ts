import type { ToolContext } from "eve/tools";

import {
  DEFAULT_WORKSPACE_ID,
  GITHUB_CONNECTOR_ENV,
  SETUP_STATE_VERSION,
  evaluateSetupState,
  getSetupStatus,
  readSetupState,
  repositoryInputForSetup,
  requireSetupReady,
  resolveGitHubConnector,
  saveGitHubWritebackSetup,
  saveSetupState,
  saveWorkingRepositorySetup,
  setupIssueSchema,
  setupStateSchema,
  setupStatusSchema,
  type ReadySetupState,
  type SetupCapability,
  type SetupIssue,
  type SetupState,
  type SetupStatus,
} from "@docs-agent/control-plane/agent";
import {
  formatUnknownError,
  gitHubWritebackPermissions,
  githubApiRequest,
  parseGitHubRepositoryUrl,
  resolveGitHubAppInstallationToken,
  type ConnectTokenResponse,
  type GitHubApiErrorResult,
} from "./github-app-client.js";

export {
  DEFAULT_WORKSPACE_ID,
  GITHUB_CONNECTOR_ENV,
  SETUP_STATE_VERSION,
  getSetupStatus,
  readSetupState,
  repositoryInputForSetup,
  requireSetupReady,
  resolveGitHubConnector,
  saveGitHubWritebackSetup,
  saveSetupState,
  saveWorkingRepositorySetup,
  setupIssueSchema,
  setupStateSchema,
  setupStatusSchema,
  type ReadySetupState,
  type SetupCapability,
  type SetupIssue,
  type SetupState,
  type SetupStatus,
};
export { resolveGitHubAppInstallationToken as resolveGitHubWritebackToken };

export async function preflightGitHubWritebackSetup(
  ctx: ToolContext,
  state: SetupState,
): Promise<SetupStatus> {
  const status = evaluateSetupState(state);
  if (state.workingRepositoryInput === undefined) return status;

  const connector = resolveGitHubConnector(state);
  if (connector.trim() === "") {
    return withGitHubPreflight(status, {
      status: "missing-connector",
      message: "No GitHub connector is configured for writeback.",
      issue: {
        code: "github-connector-missing",
        capability: "github-writeback",
        message: "GitHub writeback needs an app-scoped GitHub connector.",
        nextAction:
          "Configure GitHub writeback setup before attempting to publish a draft PR.",
      },
    });
  }

  const repository = state.workingRepositoryInput.workingDocumentationRepository;
  const slug = parseGitHubRepositoryUrl(repository.source.url);

  let tokenResponse: ConnectTokenResponse;
  let token: string;
  try {
    tokenResponse = await resolveGitHubAppInstallationToken({ connector, slug });
    token = tokenResponse.token;
  } catch (error) {
    return withGitHubPreflight(status, classifyConnectorError(error));
  }

  const installation = await githubApiRequest<GitHubInstallationRepositoriesResponse>({
    token,
    path: "/installation/repositories?per_page=100",
    abortSignal: ctx.abortSignal,
  });

  if (!installation.ok) {
    return withGitHubPreflight(status, classifyInstallationError(installation));
  }

  const repositoryAccess = await githubApiRequest<GitHubRepositoryResponse>({
    token,
    path: `/repos/${encodeURIComponent(slug.owner)}/${encodeURIComponent(slug.repo)}`,
    abortSignal: ctx.abortSignal,
  });

  if (!repositoryAccess.ok && repositoryAccess.status === 404) {
    return withGitHubPreflight(status, {
      status: "repository-not-granted",
      message:
        "The GitHub App token is valid, but the configured repository is not granted to the app installation.",
      issue: {
        code: "github-repository-not-granted",
        capability: "github-writeback",
        message:
          "The configured working documentation repository is not available to the GitHub App installation.",
        nextAction:
          "Ask a GitHub admin to grant the app access to the configured working documentation repository, then retry setup validation.",
      },
    });
  }

  if (!repositoryAccess.ok) {
    return withGitHubPreflight(status, {
      status: "connector-unavailable",
      message: repositoryAccess.message,
      issue: {
        code: "github-connector-unavailable",
        capability: "github-writeback",
        message: "The GitHub connector could not validate repository access.",
        nextAction: "Retry setup validation after checking the GitHub connector runtime state.",
      },
    });
  }

  const permissions = gitHubWritebackPermissions(tokenResponse);
  if (permissions.contents !== "write" || permissions.pull_requests !== "write") {
    return withGitHubPreflight(status, {
      status: "insufficient-permissions",
      message:
        "The GitHub App installation is available, but it does not have contents:write and pull_requests:write permissions.",
      issue: {
        code: "github-insufficient-permissions",
        capability: "github-writeback",
        message:
          "GitHub writeback needs contents:write and pull_requests:write permissions on the working documentation repository.",
        nextAction:
          "Update the GitHub App installation permissions, then retry setup validation.",
      },
    });
  }

  return withGitHubPreflight(status, {
    status: "ready",
    message: "GitHub writeback is ready for the configured working documentation repository.",
    issue: {
      code: "github-writeback-ready",
      capability: "github-writeback",
      message: "GitHub writeback preflight passed.",
      nextAction: "Continue with the approved publish flow.",
    },
  });
}

export function buildSetupInstructions(status: SetupStatus): string {
  if (!status.docsMaintenanceReady) {
    return [
      "## Setup State",
      "",
      "The workspace setup is incomplete. Enter setup mode when the user asks for docs maintenance.",
      "",
      "Ordinary conversation is not docs maintenance. Do not ask for repository setup until a docs task is clear.",
      "Ask for the working documentation repository GitHub URL if the user has not provided it.",
      "When the user provides a URL, call `configure_working_repository`. Use provided ref/docs root values, but do not require them: ref defaults to `main`, and docs root is detected when the sandbox checkout is first materialized.",
      "Do not call docs-maintenance or publish tools until setup is ready.",
      "",
      "Current setup issues:",
      ...status.issues.map((issue) => `- ${issue.message} Next: ${issue.nextAction}`),
    ].join("\n");
  }

  const repository = status.workingRepository;
  const lines = [
    "## Setup State",
    "",
    `Working documentation repository is configured: ${repository?.repositoryUrl ?? "unknown"} (${repository?.ref ?? "main"}).`,
  ];

  if (repository?.docsRoot !== undefined) {
    lines.push(`Configured docs root: ${repository.docsRoot}.`);
  } else {
    lines.push("Docs root will be detected during sandbox materialization.");
  }

  lines.push(
    "For normal docs maintenance, use the configured repository instead of asking for the same setup again.",
  );

  if (status.watchedRepositories.length > 0) {
    lines.push(
      `Configured watched repositories for read-only source evidence: ${status.watchedRepositories
        .map((watchedRepository) => `${watchedRepository.name} (${watchedRepository.repositoryUrl})`)
        .join(", ")}.`,
    );
    lines.push(
      "For watched repository scans, use the configured watched repositories as read-only evidence sources and keep writeback limited to the working documentation repository.",
    );
  }

  if (!status.githubWritebackReady) {
    lines.push(
      "If the user requests GitHub draft PR writeback, finish GitHub writeback setup first by calling `get_setup_status` with `checkGitHubWriteback: true` or `configure_github_writeback`.",
    );
  }

  return lines.join("\n");
}

function withGitHubPreflight(
  status: SetupStatus,
  input: {
    status: SetupStatus["githubWriteback"]["preflight"]["status"];
    message: string;
    issue: SetupIssue;
  },
): SetupStatus {
  const nextIssues = status.issues.filter(
    (issue) => issue.code !== "github-writeback-ready",
  );

  if (input.issue.code !== "github-writeback-ready") {
    nextIssues.push(input.issue);
  }

  const githubWritebackReady =
    status.docsMaintenanceReady &&
    input.status === "ready" &&
    !nextIssues.some((issue) => issue.capability === "github-writeback");

  return {
    ...status,
    githubWritebackReady,
    githubWriteback: {
      ...status.githubWriteback,
      preflight: {
        checked: true,
        status: input.status,
        message: input.message,
      },
    },
    issues: nextIssues,
  };
}

function classifyConnectorError(error: unknown): {
  status: SetupStatus["githubWriteback"]["preflight"]["status"];
  message: string;
  issue: SetupIssue;
} {
  const message = formatUnknownError(error);
  const lower = message.toLowerCase();

  if (lower.includes("connector") && lower.includes("not found")) {
    return {
      status: "missing-connector",
      message,
      issue: {
        code: "github-connector-missing",
        capability: "github-writeback",
        message: "The configured GitHub connector was not found.",
        nextAction: "Attach or configure the GitHub connector for this runtime.",
      },
    };
  }

  if (
    lower.includes("not available") ||
    lower.includes("environment") ||
    lower.includes("runtime") ||
    lower.includes("project")
  ) {
    return {
      status: "connector-unavailable",
      message,
      issue: {
        code: "github-connector-unavailable",
        capability: "github-writeback",
        message: "The GitHub connector is not available to this runtime environment.",
        nextAction:
          "Attach the connector to the current project/environment, then retry setup validation.",
      },
    };
  }

  return {
    status: "app-not-installed",
    message,
    issue: {
      code: "github-app-not-installed",
      capability: "github-writeback",
      message:
        "GitHub writeback could not resolve an app-scoped GitHub token. The GitHub App may need to be installed or authorized.",
      nextAction:
        "Complete the GitHub authorization challenge or ask a GitHub admin to install the app, then retry setup validation.",
    },
  };
}

function classifyInstallationError(
  result: GitHubApiErrorResult,
): {
  status: SetupStatus["githubWriteback"]["preflight"]["status"];
  message: string;
  issue: SetupIssue;
} {
  if (result.status === 401 || result.status === 403) {
    return {
      status: "connector-unavailable",
      message: result.message,
      issue: {
        code: "github-connector-unavailable",
        capability: "github-writeback",
        message: "The GitHub connector token could not access installation metadata.",
        nextAction: "Reconnect the GitHub connector for this runtime, then retry setup validation.",
      },
    };
  }

  if (result.status === 404) {
    return {
      status: "app-not-installed",
      message: result.message,
      issue: {
        code: "github-app-not-installed",
        capability: "github-writeback",
        message: "No GitHub App installation is visible for the resolved connector token.",
        nextAction: "Ask a GitHub admin to install the app, then retry setup validation.",
      },
    };
  }

  return {
    status: "connector-unavailable",
    message: result.message,
    issue: {
      code: "github-connector-unavailable",
      capability: "github-writeback",
      message: "GitHub writeback setup could not be validated.",
      nextAction: "Retry setup validation after checking the GitHub connector runtime state.",
    },
  };
}

type GitHubInstallationRepositoriesResponse = {
  repositories: unknown[];
};

type GitHubRepositoryResponse = {
  full_name: string;
};
