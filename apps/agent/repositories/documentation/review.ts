import { createHash } from "node:crypto";

export interface ChangedFile {
  path: string;
  content: string | null;
}

export interface DocumentationReview {
  baseCommitSha: string;
  reviewId: string | null;
  hasChanges: boolean;
  patch: string;
  changedFiles: string[];
}

// The review ID binds approval to the starting commit, changed paths, and
// exact resulting bytes. Any change after review produces a different ID.
export function createReviewId(
  baseCommitSha: string,
  files: ChangedFile[],
): string {
  const hash = createHash("sha256");
  hash.update("paige-documentation-review-v1\0");
  hash.update(`${baseCommitSha.length}:${baseCommitSha}\0`);
  for (const file of [...files].sort((left, right) =>
    left.path.localeCompare(right.path)
  )) {
    hash.update(`${file.path.length}:${file.path}\0`);
    if (file.content === null) {
      hash.update("deleted\0");
    } else {
      const bytes = Buffer.from(file.content, "utf8");
      hash.update(`present:${bytes.length}\0`);
      hash.update(bytes);
      hash.update("\0");
    }
  }
  return `sha256:${hash.digest("hex")}`;
}
