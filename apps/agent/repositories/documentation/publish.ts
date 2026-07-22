import type { SandboxSession } from "eve/sandbox";
import { err, ok } from "neverthrow";

import { assertRepositoryRelativePath } from "../files";
import type { RepositoryResult } from "@paige/repositories/errors";
import { RepositoryError } from "@paige/repositories/errors";
import { DocumentationEditor } from "./editor";
import type { GitHubPublisher } from "./github-publisher";
import type { DocumentationCommit } from "./publish-checkpoint";
import { PublishCheckpoint } from "./publish-checkpoint";
import { createReviewId } from "./review";
import type { ChangedFile } from "./review";
import {
  isValidPublishBranch,
  MAX_CHANGED_FILES,
  MAX_FILE_BYTES,
} from "./rules";
import { SandboxShell } from "./sandbox-shell";
import type { WorkspaceRecord } from "./workspace-record";
import { WorkspaceRecordStore } from "./workspace-record";

export interface PublishInput {
  reviewId: string;
  branch: string;
  commitMessage: string;
  pullRequestTitle: string;
  pullRequestBody: string;
}

export interface PublishResult {
  commit: DocumentationCommit;
  pullRequest: {
    number: number;
    url: string;
    draft: true;
  };
  resumed: boolean;
}

export class DocumentationPublisher {
  readonly #record: WorkspaceRecord;
  readonly #records: WorkspaceRecordStore;
  readonly #checkpoints: PublishCheckpoint;
  readonly #editor: DocumentationEditor;
  readonly #github: GitHubPublisher;

  constructor(input: {
    sandbox: SandboxSession;
    record: WorkspaceRecord;
    abortSignal: AbortSignal;
    github: GitHubPublisher;
  }) {
    this.#record = input.record;
    this.#records = new WorkspaceRecordStore(input);
    this.#checkpoints = new PublishCheckpoint(new SandboxShell(input));
    this.#editor = new DocumentationEditor(input);
    this.#github = input.github;
  }

  async publish(
    input: PublishInput,
  ): Promise<RepositoryResult<PublishResult>> {
    const publishRequest = {
      reviewId: input.reviewId,
      branch: input.branch,
      commitMessage: input.commitMessage,
    };
    const existingCheckpoint = await this.#checkpoints.find({
      record: this.#record,
      publishRequest,
    });
    if (existingCheckpoint.isErr()) return err(existingCheckpoint.error);

    let remoteBranchCommitSha: string | undefined;
    let remoteBranchWasChecked = false;
    if (existingCheckpoint.value !== undefined) {
      const remoteBranch = await this.#github.resolveBranchCommitSha(
        existingCheckpoint.value.branch,
      );
      if (remoteBranch.isErr()) return err(remoteBranch.error);
      remoteBranchCommitSha = remoteBranch.value;
      remoteBranchWasChecked = true;
      if (
        remoteBranchCommitSha !== undefined &&
        remoteBranchCommitSha !== this.#record.baseCommitSha
      ) {
        const published = await this.#verifyPublishedCommit({
          branch: existingCheckpoint.value.branch,
          commitSha: remoteBranchCommitSha,
          reviewId: input.reviewId,
          message: input.commitMessage,
        });
        if (published.isErr()) return err(published.error);
        const existingPullRequest = await this.#github.findDraftPullRequest({
          branch: existingCheckpoint.value.branch,
          baseBranch: this.#record.baseBranch,
          title: input.pullRequestTitle,
          body: input.pullRequestBody,
        });
        if (existingPullRequest.isErr()) {
          return err(existingPullRequest.error);
        }
        if (existingPullRequest.value !== undefined) {
          return ok({
            commit: published.value,
            pullRequest: existingPullRequest.value,
            resumed: true,
          });
        }
      }
    }

    let changedFiles: string[] | undefined;
    if (existingCheckpoint.value === undefined) {
      const review = await this.#editor.review();
      if (review.isErr()) return err(review.error);
      if (!review.value.hasChanges || review.value.reviewId === null) {
        return err(new RepositoryError(
          "REPOSITORY_REVIEW_MISMATCH",
          "The reviewed documentation no longer contains changes.",
        ));
      }
      if (review.value.reviewId !== input.reviewId) {
        return err(new RepositoryError(
          "REPOSITORY_REVIEW_MISMATCH",
          "The documentation workspace no longer matches the reviewed changes.",
        ));
      }
      changedFiles = review.value.changedFiles;
    }

    const recorded = await this.#records.savePublishRequest(
      this.#record,
      publishRequest,
    );
    if (recorded.isErr()) return err(recorded.error);

    const remoteBase = await this.#github.resolveCommit();
    if (remoteBase.isErr()) return err(remoteBase.error);
    if (
      remoteBase.value.ref !== this.#record.baseBranch ||
      remoteBase.value.commitSha !== this.#record.baseCommitSha
    ) {
      return err(new RepositoryError(
        "REPOSITORY_CONFLICT",
        `The remote base ${this.#record.baseBranch} moved after the documentation changes were reviewed.`,
      ));
    }

    let checkpoint = existingCheckpoint.value;
    if (checkpoint === undefined) {
      if (changedFiles === undefined) {
        return err(new RepositoryError(
          "REPOSITORY_REVIEW_MISMATCH",
          "The reviewed documentation changes are unavailable.",
        ));
      }
      const created = await this.#checkpoints.create({
        record: this.#record,
        branch: input.branch,
        message: input.commitMessage,
        changedFiles,
      });
      if (created.isErr()) return err(created.error);
      checkpoint = created.value;
    }

    const checkpointChanges = await this.#checkpoints.readChanges(
      this.#record,
      checkpoint.commitSha,
    );
    if (checkpointChanges.isErr()) return err(checkpointChanges.error);
    if (checkpointChanges.value.reviewId !== input.reviewId) {
      return err(new RepositoryError(
        "REPOSITORY_REVIEW_MISMATCH",
        "The publish checkpoint does not match the reviewed changes.",
      ));
    }

    if (!remoteBranchWasChecked) {
      const remoteBranch = await this.#github.resolveBranchCommitSha(
        checkpoint.branch,
      );
      if (remoteBranch.isErr()) return err(remoteBranch.error);
      remoteBranchCommitSha = remoteBranch.value;
    }
    const published = await this.#publishCommit({
      commit: checkpoint,
      remoteBranchCommitSha,
      reviewId: input.reviewId,
      message: input.commitMessage,
      files: checkpointChanges.value.files,
    });
    if (published.isErr()) return err(published.error);
    const resumed =
      existingCheckpoint.value !== undefined ||
      remoteBranchCommitSha !== undefined;

    const pullRequest = await this.#github.createOrFindDraftPullRequest({
      branch: published.value.branch,
      baseBranch: this.#record.baseBranch,
      title: input.pullRequestTitle,
      body: input.pullRequestBody,
    });
    if (pullRequest.isErr()) return err(pullRequest.error);
    return ok({
      commit: published.value,
      pullRequest: {
        number: pullRequest.value.number,
        url: pullRequest.value.url,
        draft: true,
      },
      resumed: resumed || pullRequest.value.existing,
    });
  }

  async #publishCommit(input: {
    commit: DocumentationCommit;
    remoteBranchCommitSha: string | undefined;
    reviewId: string;
    message: string;
    files: ChangedFile[];
  }): Promise<RepositoryResult<DocumentationCommit>> {
    let remoteCommitSha = input.remoteBranchCommitSha;
    if (remoteCommitSha === undefined) {
      const created = await this.#github.createBranch({
        branch: input.commit.branch,
        commitSha: this.#record.baseCommitSha,
      });
      if (created.isErr()) {
        const raced = await this.#github.resolveBranchCommitSha(
          input.commit.branch,
        );
        if (raced.isErr()) return err(raced.error);
        if (raced.value === undefined) return err(created.error);
        remoteCommitSha = raced.value;
      } else {
        remoteCommitSha = this.#record.baseCommitSha;
      }
    }
    if (remoteCommitSha === this.#record.baseCommitSha) {
      const created = await this.#github.createCommitOnBranch({
        branch: input.commit.branch,
        expectedHeadCommitSha: this.#record.baseCommitSha,
        message: input.message,
        files: input.files,
      });
      if (created.isErr()) return err(created.error);
      remoteCommitSha = created.value;
    }
    return await this.#verifyPublishedCommit({
      branch: input.commit.branch,
      commitSha: remoteCommitSha,
      reviewId: input.reviewId,
      message: input.message,
    });
  }

  async #verifyPublishedCommit(input: {
    branch: string;
    commitSha: string;
    reviewId: string;
    message: string;
  }): Promise<RepositoryResult<DocumentationCommit>> {
    const details = await this.#github.readCommitDetails(input.commitSha);
    if (details.isErr()) return err(details.error);
    if (
      details.value.parentSha !== this.#record.baseCommitSha ||
      details.value.message !== input.message
    ) {
      return err(new RepositoryError(
        "REPOSITORY_CONFLICT",
        `Remote branch ${input.branch} does not contain the reviewed commit.`,
      ));
    }
    const files: ChangedFile[] = [];
    for (const file of details.value.files) {
      const path = assertRepositoryRelativePath(file.path, {
        allowRoot: false,
      });
      if (path.isErr() || path.value !== file.path) {
        return err(new RepositoryError(
          "REPOSITORY_CONFLICT",
          `Remote branch ${input.branch} contains an invalid path.`,
        ));
      }
      if (file.status === "renamed") {
        const previousPath = assertRepositoryRelativePath(
          file.previousPath ?? "",
          { allowRoot: false },
        );
        if (
          previousPath.isErr() ||
          previousPath.value !== file.previousPath
        ) {
          return err(new RepositoryError(
            "REPOSITORY_CONFLICT",
            `Remote branch ${input.branch} contains an invalid renamed path.`,
          ));
        }
        files.push({ path: previousPath.value, content: null });
      }
      if (file.status === "removed") {
        files.push({ path: path.value, content: null });
        continue;
      }
      const content = await this.#github.readTextFile({
        commitSha: input.commitSha,
        path: path.value,
      });
      if (content.isErr()) return err(content.error);
      if (Buffer.byteLength(content.value, "utf8") > MAX_FILE_BYTES) {
        return err(new RepositoryError(
          "REPOSITORY_CONFLICT",
          `Remote branch ${input.branch} contains an oversized documentation file.`,
        ));
      }
      files.push({ path: path.value, content: content.value });
    }
    if (files.length === 0 || files.length > MAX_CHANGED_FILES) {
      return err(new RepositoryError(
        "REPOSITORY_CONFLICT",
        `Remote branch ${input.branch} has an invalid changed-file set.`,
      ));
    }
    if (createReviewId(this.#record.baseCommitSha, files) !== input.reviewId) {
      return err(new RepositoryError(
        "REPOSITORY_CONFLICT",
        `Remote branch ${input.branch} does not match the reviewed documentation changes.`,
      ));
    }
    return ok({
      branch: input.branch,
      commitSha: input.commitSha,
      baseCommitSha: this.#record.baseCommitSha,
    });
  }
}

export function validatePublishInput(
  input: PublishInput,
): RepositoryResult<PublishInput> {
  const normalized = {
    reviewId: input.reviewId.trim(),
    branch: input.branch.trim(),
    commitMessage: input.commitMessage.trim(),
    pullRequestTitle: input.pullRequestTitle.trim(),
    pullRequestBody: input.pullRequestBody.trim(),
  };
  if (!/^sha256:[a-f0-9]{64}$/.test(normalized.reviewId)) {
    return err(new RepositoryError(
      "REPOSITORY_INVALID_INPUT",
      "Use the exact review ID returned by documentation_edit review.",
    ));
  }
  if (!isValidPublishBranch(normalized.branch)) {
    return err(new RepositoryError(
      "REPOSITORY_INVALID_INPUT",
      "Use a valid deterministic branch in the paige/ namespace.",
    ));
  }
  if (
    normalized.commitMessage === "" ||
    normalized.commitMessage.length > 200 ||
    normalized.commitMessage.includes("\n") ||
    normalized.pullRequestTitle === "" ||
    normalized.pullRequestTitle.length > 200 ||
    normalized.pullRequestBody.length > 20_000
  ) {
    return err(new RepositoryError(
      "REPOSITORY_INVALID_INPUT",
      "Commit and pull request details are missing, too large, or the commit message is not single-line.",
    ));
  }
  return ok(normalized);
}
