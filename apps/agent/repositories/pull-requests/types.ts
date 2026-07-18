type PullRequestState = "open" | "closed";

export type PullRequestListState = PullRequestState | "all";

export type PullRequestCommentKind =
  | "conversation"
  | "review"
  | "inline";

export interface PullRequestSummary {
  number: number;
  title: string;
  state: PullRequestState;
  url: string;
  draft: boolean;
  author: string | null;
  headCommitSha: string;
  baseCommitSha: string;
  baseRef: string;
  createdAt: string;
  updatedAt: string;
}

export interface PullRequestDetails extends PullRequestSummary {
  body: string | null;
  headRef: string;
  merged: boolean;
  closedAt: string | null;
  mergedAt: string | null;
  authorAssociation: string;
  labels: string[];
  requestedReviewers: string[];
  commitCount: number;
  changedFileCount: number;
  additions: number;
  deletions: number;
  conversationCommentCount: number;
  inlineCommentCount: number;
}

export interface PullRequestFile {
  path: string;
  previousPath: string | null;
  status:
    | "added"
    | "removed"
    | "modified"
    | "renamed"
    | "copied"
    | "changed"
    | "unchanged";
  blobSha: string;
  additions: number;
  deletions: number;
  changes: number;
}

interface PullRequestCommentBase {
  id: number;
  author: string | null;
  authorAssociation: string;
  body: string | null;
  url: string;
}

export interface PullRequestConversationComment
  extends PullRequestCommentBase {
  kind: "conversation";
  createdAt: string;
  updatedAt: string;
}

export interface PullRequestReview extends PullRequestCommentBase {
  kind: "review";
  state: string;
  submittedAt: string | null;
  commitSha: string;
}

export interface PullRequestInlineComment extends PullRequestCommentBase {
  kind: "inline";
  createdAt: string;
  updatedAt: string;
  path: string;
  line: number | null;
  startLine: number | null;
  side: string | null;
  startSide: string | null;
  originalLine: number | null;
  commitSha: string;
  originalCommitSha: string;
  inReplyToId: number | null;
}

export type PullRequestComment =
  | PullRequestConversationComment
  | PullRequestReview
  | PullRequestInlineComment;

export interface PullRequestPage<T> {
  items: T[];
  page: number;
  nextPage: number | null;
}
