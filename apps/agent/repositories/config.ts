import { err, ok } from "neverthrow";

import { RepositoryError } from "./shared/errors";
import type { RepositoryResult } from "./shared/errors";
import type {
  DocumentationRepository,
  RepositoryConfig,
} from "./types";

export const documentationRepository = {
  id: "saleor-docs",
  owner: "peelar",
  name: "saleor-docs",
  role: "documentation",
} satisfies DocumentationRepository;

export const repositories = [
  {
    id: "saleor-core",
    owner: "saleor",
    name: "saleor",
    role: "evidence",
  },
  {
    id: "saleor-dashboard",
    owner: "saleor",
    name: "saleor-dashboard",
    role: "evidence",
  },
  {
    id: "saleor-apps",
    owner: "saleor",
    name: "apps",
    role: "evidence",
  },
  documentationRepository,
] satisfies RepositoryConfig[];

/** Returns the repositories Paige is explicitly allowed to inspect. */
export function catalogRepositories(
  config: RepositoryConfig[] = repositories,
): RepositoryConfig[] {
  return [...config];
}

/** Resolves a model-facing repository ID without accepting arbitrary origins. */
export function resolveConfiguredRepository(
  config: RepositoryConfig[],
  repositoryId: string,
): RepositoryResult<RepositoryConfig> {
  const repository = catalogRepositories(config).find(
    (candidate) => candidate.id === repositoryId,
  );
  if (repository === undefined) {
    return err(new RepositoryError(
      "REPOSITORY_NOT_CONFIGURED",
      `Repository is not configured: ${repositoryId}`,
    ));
  }
  return ok(repository);
}

/** Enforces the only repository role that may enter a writeback workflow. */
export function assertDocumentationRepository(
  repository: RepositoryConfig,
): RepositoryResult<DocumentationRepository> {
  if (repository.role !== "documentation") {
    return err(new RepositoryError(
      "REPOSITORY_WRITE_FORBIDDEN",
      `Repository is read-only: ${repository.id}`,
    ));
  }
  return ok(repository as DocumentationRepository);
}
