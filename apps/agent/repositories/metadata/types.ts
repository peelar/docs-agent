export interface RepositoryRelease {
  id: number;
  tagName: string;
  name: string | null;
  publishedAt: string | null;
  url: string;
  draft: boolean;
  prerelease: boolean;
}

export interface RepositoryIssue {
  number: number;
  title: string;
  state: "open" | "closed";
  url: string;
  labels: string[];
  createdAt: string;
  updatedAt: string;
}

export interface RepositoryTag {
  name: string;
  commitSha: string;
}

export interface RepositoryCommitSummary {
  sha: string;
  message: string;
  authoredAt: string | null;
  url: string;
}

export interface RepositoryMetadataQuery {
  repositoryId: string;
  limit: number;
}
