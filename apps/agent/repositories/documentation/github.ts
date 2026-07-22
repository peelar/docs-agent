import { err, ok, Result } from "neverthrow";

import { RepositoryError } from "../shared/errors";
import type { RepositoryResultAsync } from "../shared/errors";
import {
  GitHubRepository,
  readBooleanProperty,
  readNestedStringProperty,
  readNumberProperty,
  readStringProperty,
} from "../shared/github";
import type { GitHubRequest } from "../shared/github";
import type { DocumentationRepository } from "../types";

export interface GitHubFileChange {
  path: string;
  content: string | null;
}

/** GitHub writes that exist only for an approved documentation repository. */
export class DocumentationGitHubRepository extends GitHubRepository<
  DocumentationRepository
> {
  constructor(repository: DocumentationRepository, request: GitHubRequest) {
    super(repository, request);
  }

  createBranch(input: {
    branch: string;
    commitSha: string;
  }): RepositoryResultAsync<void> {
    return this.requiredJson(`${this.path}/git/refs`, {
      method: "POST",
      body: {
        ref: `refs/heads/${input.branch}`,
        sha: input.commitSha,
      },
    }).andThen((created) =>
      readNestedStringProperty(
        created,
        ["object", "sha"],
        "GitHub branch creation response",
      ).andThen((commitSha) =>
        commitSha === input.commitSha
          ? ok(undefined)
          : err(new RepositoryError(
              "REPOSITORY_GITHUB_FAILED",
              `GitHub created branch ${input.branch} at an unexpected commit.`,
            ))
      )
    );
  }

  createCommitOnBranch(input: {
    branch: string;
    expectedHeadCommitSha: string;
    message: string;
    files: GitHubFileChange[];
  }): RepositoryResultAsync<string> {
    const additions = input.files
      .filter((file): file is { path: string; content: string } =>
        file.content !== null
      )
      .map((file) => ({
        path: file.path,
        contents: Buffer.from(file.content, "utf8").toString("base64"),
      }));
    const deletions = input.files
      .filter((file) => file.content === null)
      .map((file) => ({ path: file.path }));
    const query = `
      mutation CreateDocumentationCommit($input: CreateCommitOnBranchInput!) {
        createCommitOnBranch(input: $input) {
          commit {
            oid
          }
        }
      }
    `;

    return this.request.graphql(query, {
      input: {
        branch: {
          repositoryNameWithOwner:
            `${this.repository.owner}/${this.repository.name}`,
          branchName: input.branch,
        },
        expectedHeadOid: input.expectedHeadCommitSha,
        message: { headline: input.message },
        fileChanges: { additions, deletions },
      },
    }).andThen((value) =>
      readNestedStringProperty(
        value,
        ["data", "createCommitOnBranch", "commit", "oid"],
        "GitHub commit creation response",
      )
    );
  }

  createOrReuseDraftPullRequest(input: {
    branch: string;
    baseBranch: string;
    title: string;
    body: string;
  }): RepositoryResultAsync<{
    number: number;
    url: string;
    draft: true;
    reused: boolean;
  }> {
    return this.findDraftPullRequest(input).andThen((existing) => {
      if (existing !== undefined) {
        return ok({ ...existing, reused: true });
      }
      return this.requiredJson(`${this.path}/pulls`, {
        method: "POST",
        body: {
          title: input.title,
          head: input.branch,
          base: input.baseBranch,
          body: input.body,
          draft: true,
        },
      }).andThen((created) =>
        Result.combine([
          readNumberProperty(created, "number", "GitHub pull request response"),
          readStringProperty(
            created,
            "html_url",
            "GitHub pull request response",
          ),
          readBooleanProperty(
            created,
            "draft",
            "GitHub pull request response",
          ),
        ]).andThen(([number, url, draft]) =>
          draft
            ? ok({ number, url, draft: true as const, reused: false })
            : err(new RepositoryError(
                "REPOSITORY_GITHUB_FAILED",
                "GitHub created a pull request that was not a draft.",
              ))
        )
      );
    });
  }
}
