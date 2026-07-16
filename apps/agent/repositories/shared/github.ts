import { getToken } from "@vercel/connect";
import { err, ok, Result, ResultAsync } from "neverthrow";

import { RepositoryError } from "./errors";
import type { RepositoryResult, RepositoryResultAsync } from "./errors";
import { documentationRepository } from "../config";
import type {
  RepositoryConfig,
  ResolvedRepository,
} from "../types";

const DEFAULT_GITHUB_CONNECTOR = "github/docs-agent";
const GITHUB_API_VERSION = "2026-03-10";

/** Obtains the one GitHub App token used for every repository operation. */
export function resolveGitHubToken(): RepositoryResultAsync<string> {
  const connector =
    process.env.PAIGE_GITHUB_CONNECTOR?.trim() || DEFAULT_GITHUB_CONNECTOR;

  return ResultAsync.fromPromise(
    getToken(connector, {
      subject: { type: "app" },
      authorizationDetails: [
        {
          type: "github_app_installation",
          org: documentationRepository.owner,
          repositories: [documentationRepository.name],
        },
      ],
    }),
    (cause) =>
      new RepositoryError(
        "REPOSITORY_GITHUB_AUTH_FAILED",
        `Failed to authenticate GitHub connector ${connector}.`,
        { cause },
      ),
  );
}

/** Resolves a configured GitHub ref, tag, or SHA to an immutable commit SHA. */
export function resolveGitHubRevision<TRepository extends RepositoryConfig>(
  repository: TRepository,
  token: string,
  abortSignal: AbortSignal,
  requestedRef?: string,
): RepositoryResultAsync<ResolvedRepository<TRepository>> {
  const repositoryPath = `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`;

  return githubJson(repositoryPath, token, abortSignal)
    .andThen((details) =>
      Result.combine([
        requestedRef === undefined
          ? readStringProperty(
              details,
              "default_branch",
              "GitHub repository response",
            )
          : normalizeRequestedRef(requestedRef),
        readBooleanProperty(
          details,
          "private",
          "GitHub repository response",
        ),
      ])
    )
    .andThen(([resolvedRef, isPrivate]) =>
      githubJson(
        `${repositoryPath}/commits/${encodeURIComponent(resolvedRef)}`,
        token,
        abortSignal,
      ).andThen((commit) =>
        readStringProperty(commit, "sha", "GitHub commit response").map(
          (resolvedRevision) => ({
            ...repository,
            isPrivate,
            ref: resolvedRef,
            resolvedRevision,
          }),
        ),
      ),
    );
}

function normalizeRequestedRef(value: string): RepositoryResult<string> {
  const ref = value.trim();
  return ref.length === 0
    ? err(new RepositoryError(
        "REPOSITORY_INVALID_INPUT",
        "Repository revision must not be empty.",
      ))
    : ok(ref);
}

function githubJson(
  path: string,
  token: string,
  abortSignal: AbortSignal,
): RepositoryResultAsync<unknown> {
  return githubFetch(path, token, abortSignal).andThen((response) =>
    ResultAsync.fromPromise(
      response.json(),
      (cause) =>
        new RepositoryError(
          "REPOSITORY_GITHUB_FAILED",
          `GitHub returned invalid JSON: ${path}`,
          { cause },
        ),
    ),
  );
}

function githubFetch(
  path: string,
  token: string,
  abortSignal: AbortSignal,
): RepositoryResultAsync<Response> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": GITHUB_API_VERSION,
  };
  headers.authorization = `Bearer ${token}`;

  const request = fetch(`https://api.github.com${path}`, {
    headers,
    signal: abortSignal,
  }).then(
    (response) =>
      response.ok
        ? ok(response)
        : err(
            new RepositoryError(
              "REPOSITORY_GITHUB_FAILED",
              `GitHub request failed with HTTP ${response.status}: ${path}`,
            ),
          ),
    (cause) => {
      // Cancellation is control flow owned by Eve, not a GitHub domain error.
      // Preserve the rejection so the active turn stops immediately.
      if (abortSignal.aborted) return Promise.reject(cause);
      return err(
        new RepositoryError(
          "REPOSITORY_GITHUB_FAILED",
          `GitHub request failed: ${path}`,
          { cause },
        ),
      );
    },
  );

  return new ResultAsync(request);
}

function readStringProperty(
  value: unknown,
  property: string,
  label: string,
): RepositoryResult<string> {
  if (typeof value !== "object" || value === null || !(property in value)) {
    return err(
      new RepositoryError(
        "REPOSITORY_GITHUB_FAILED",
        `${label} is missing ${property}.`,
      ),
    );
  }
  const result = (value as Record<string, unknown>)[property];
  if (typeof result !== "string" || result.length === 0) {
    return err(
      new RepositoryError(
        "REPOSITORY_GITHUB_FAILED",
        `${label} has an invalid ${property}.`,
      ),
    );
  }
  return ok(result);
}

function readBooleanProperty(
  value: unknown,
  property: string,
  label: string,
): RepositoryResult<boolean> {
  if (typeof value !== "object" || value === null || !(property in value)) {
    return err(
      new RepositoryError(
        "REPOSITORY_GITHUB_FAILED",
        `${label} is missing ${property}.`,
      ),
    );
  }
  const result = (value as Record<string, unknown>)[property];
  if (typeof result !== "boolean") {
    return err(
      new RepositoryError(
        "REPOSITORY_GITHUB_FAILED",
        `${label} has an invalid ${property}.`,
      ),
    );
  }
  return ok(result);
}
