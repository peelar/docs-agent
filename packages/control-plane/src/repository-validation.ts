import { z } from "zod";

import {
  formatUnknownError,
  githubApiRequest,
  parseGitHubRepositoryUrl,
  resolveGitHubAppInstallationToken,
  type GitHubApiResult,
  type GitHubRepositorySlug,
} from "./github-app-client.js";
import { repositoryInputSchema, type RepositoryInput } from "./repository-contract.js";
import {
  readSetupState,
  resolveGitHubConnector,
  type SetupState,
} from "./setup-state.js";

export const workingRepositoryValidationSchema = z.object({
  repositoryUrl: z.string(),
  ref: z.string(),
  docsRoot: z.string().optional(),
  status: z.literal("ready"),
});

export type WorkingRepositoryValidation = z.infer<
  typeof workingRepositoryValidationSchema
>;

type RepositoryValidationDependencies = {
  resolveToken: typeof resolveGitHubAppInstallationToken;
  request: typeof githubApiRequest;
};

const defaultDependencies: RepositoryValidationDependencies = {
  resolveToken: resolveGitHubAppInstallationToken,
  request: githubApiRequest,
};

export async function validateWorkingRepositoryAccess(
  input: {
    repositoryInput: RepositoryInput;
    setupState?: SetupState;
    abortSignal?: AbortSignal;
  },
  dependencies: RepositoryValidationDependencies = defaultDependencies,
): Promise<WorkingRepositoryValidation> {
  const parsed = repositoryInputSchema.parse(input.repositoryInput);
  const repository = parsed.workingDocumentationRepository;
  const slug = parseGitHubRepositoryUrl(repository.source.url);
  const state = input.setupState !== undefined
    ? input.setupState
    : await readSetupState();
  const connector = resolveGitHubConnector(state);
  if (connector === "") {
    throw new Error(
      "Could not validate GitHub repository with app-scoped credentials: no GitHub connector is configured.",
    );
  }

  let token: string;
  try {
    token = (await dependencies.resolveToken({ connector, slug })).token;
  } catch (error) {
    throw new Error(
      `Could not validate GitHub repository with app-scoped credentials from connector ${connector}: ${formatUnknownError(error)}`,
    );
  }

  await assertRepositoryExists(dependencies, token, slug, input.abortSignal);
  await assertRefExists(
    dependencies,
    token,
    slug,
    repository.ref,
    input.abortSignal,
  );
  if (repository.docsRoot !== undefined) {
    await assertDirectoryExists(
      dependencies,
      token,
      slug,
      repository.ref,
      repository.docsRoot,
      input.abortSignal,
    );
  }

  return workingRepositoryValidationSchema.parse({
    repositoryUrl: repository.source.url,
    ref: repository.ref,
    docsRoot: repository.docsRoot,
    status: "ready",
  });
}

async function assertRepositoryExists(
  dependencies: RepositoryValidationDependencies,
  token: string,
  slug: GitHubRepositorySlug,
  abortSignal?: AbortSignal,
): Promise<void> {
  const result = await request<unknown>(dependencies, {
    token,
    path: `/repos/${encodeURIComponent(slug.owner)}/${encodeURIComponent(slug.repo)}`,
    abortSignal,
  });
  if (result.ok) return;
  if (result.status === 404) {
    throw new Error(
      `GitHub repository was not found or is not granted to the GitHub App installation: ${slug.owner}/${slug.repo}.`,
    );
  }
  throw new Error(`Could not validate GitHub repository: ${result.message}`);
}

async function assertRefExists(
  dependencies: RepositoryValidationDependencies,
  token: string,
  slug: GitHubRepositorySlug,
  ref: string,
  abortSignal?: AbortSignal,
): Promise<void> {
  const encodedRepository = `${encodeURIComponent(slug.owner)}/${encodeURIComponent(slug.repo)}`;
  const encodedRef = encodeURIComponent(ref);
  const branch = await request<unknown>(dependencies, {
    token,
    path: `/repos/${encodedRepository}/branches/${encodedRef}`,
    abortSignal,
  });
  if (branch.ok) return;
  if (branch.status !== 404) {
    throw new Error(`Could not validate GitHub branch ${ref}: ${branch.message}`);
  }

  const tag = await request<unknown>(dependencies, {
    token,
    path: `/repos/${encodedRepository}/git/ref/tags/${encodedRef}`,
    abortSignal,
  });
  if (tag.ok) return;
  if (tag.status !== 404) {
    throw new Error(`Could not validate GitHub tag ${ref}: ${tag.message}`);
  }

  const commit = await request<unknown>(dependencies, {
    token,
    path: `/repos/${encodedRepository}/commits/${encodedRef}`,
    abortSignal,
  });
  if (commit.ok) return;
  if (commit.status === 404) {
    throw new Error(`GitHub ref was not found: ${slug.owner}/${slug.repo}#${ref}.`);
  }
  throw new Error(`Could not validate GitHub ref ${ref}: ${commit.message}`);
}

async function assertDirectoryExists(
  dependencies: RepositoryValidationDependencies,
  token: string,
  slug: GitHubRepositorySlug,
  ref: string,
  docsRoot: string,
  abortSignal?: AbortSignal,
): Promise<void> {
  const path = docsRoot === "."
    ? ""
    : `/${docsRoot.split("/").map((part) => encodeURIComponent(part)).join("/")}`;
  const result = await request<unknown>(dependencies, {
    token,
    path: `/repos/${encodeURIComponent(slug.owner)}/${encodeURIComponent(slug.repo)}/contents${path}?ref=${encodeURIComponent(ref)}`,
    abortSignal,
  });
  if (result.ok) {
    if (Array.isArray(result.body) || isDirectory(result.body)) return;
    throw new Error(`Configured docs root is not a directory: ${docsRoot}.`);
  }
  if (result.status === 404) {
    throw new Error(`Configured docs root was not found at ${ref}: ${docsRoot}.`);
  }
  throw new Error(`Could not validate docs root ${docsRoot}: ${result.message}`);
}

async function request<T>(
  dependencies: RepositoryValidationDependencies,
  input: Parameters<typeof githubApiRequest<T>>[0],
): Promise<GitHubApiResult<T>> {
  return dependencies.request<T>(input);
}

function isDirectory(value: unknown): value is { type: "dir" } {
  return typeof value === "object" && value !== null &&
    "type" in value && (value as { type?: unknown }).type === "dir";
}
