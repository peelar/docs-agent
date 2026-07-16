export interface RepositoryConfig {
  id: string;
  owner: string;
  name: string;
  role: "documentation" | "evidence";
}

export type DocumentationRepository = RepositoryConfig & {
  role: "documentation";
};

export type ResolvedRepository<
  TRepository extends RepositoryConfig = RepositoryConfig,
> = TRepository & {
  isPrivate: boolean;
  ref: string;
  commitSha: string;
};

export interface RepositoryWorkspace<
  TRepository extends RepositoryConfig = RepositoryConfig,
> {
  path: string;
  repository: ResolvedRepository<TRepository>;
}

export interface RepositorySearchMatch {
  path: string;
  line: number;
  excerpt: string;
}

export interface RepositoryComparison {
  repositoryId: string;
  baseCommitSha: string;
  headCommitSha: string;
  changedFiles: string[];
  truncated: boolean;
}
