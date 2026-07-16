import type {
  DocumentationRepository,
  ResolvedRepository,
} from "../types";

export interface DocumentationWorkspace {
  path: string;
  repository: ResolvedRepository<DocumentationRepository>;
  baseBranch: string;
  baseCommitSha: string;
}

export interface DocumentationDiff {
  baseCommitSha: string;
  digest: string | null;
  hasChanges: boolean;
  patch: string;
  changedFiles: string[];
}

export interface DocumentationCommit {
  branch: string;
  commitSha: string;
  baseCommitSha: string;
}

interface DocumentationPullRequest {
  number: number;
  url: string;
  draft: true;
}

export interface DocumentationWriteback {
  commit: DocumentationCommit;
  pullRequest: DocumentationPullRequest;
  reused: boolean;
}

export interface DocumentationSearchMatch {
  path: string;
  line: number;
  excerpt: string;
}
