import { err, ok, Result } from "neverthrow";

import type { RepositoryResult } from "@paige/repositories/errors";
import { RepositoryError } from "@paige/repositories/errors";
import { createReviewId } from "./review";
import type { ChangedFile } from "./review";
import { MAX_CHANGED_FILES, MAX_FILE_BYTES } from "./rules";
import {
  SandboxShell,
  quoteShellArgument,
} from "./sandbox-shell";
import type { PublishRequest, WorkspaceRecord } from "./workspace-record";

export interface DocumentationCommit {
  branch: string;
  commitSha: string;
  baseCommitSha: string;
}

// A checkpoint is the local commit that freezes the exact reviewed changes.
// It makes an interrupted publish safe to resume without sandbox credentials.
export class PublishCheckpoint {
  readonly #shell: SandboxShell;

  constructor(shell: SandboxShell) {
    this.#shell = shell;
  }

  async create(input: {
    record: WorkspaceRecord;
    branch: string;
    message: string;
    changedFiles: string[];
  }): Promise<RepositoryResult<DocumentationCommit>> {
    const existingBranch = await this.#shell.run(
      `git -C ${quoteShellArgument(input.record.path)} rev-parse --verify --quiet ${quoteShellArgument(`refs/heads/${input.branch}`)}`,
    );
    if (existingBranch.exitCode === 0) {
      if (existingBranch.stdout.trim() !== input.record.baseCommitSha) {
        return err(new RepositoryError(
          "REPOSITORY_CONFLICT",
          `Local branch ${input.branch} already points at a different commit.`,
        ));
      }
      const switched = await this.#shell.run(
        `git -C ${quoteShellArgument(input.record.path)} switch ${quoteShellArgument(input.branch)}`,
      );
      const switchedOk = switched.assertSucceeded(
        `Failed to reuse local branch ${input.branch}`,
      );
      if (switchedOk.isErr()) return err(switchedOk.error);
    } else if (existingBranch.exitCode === 1) {
      const created = await this.#shell.run(
        `git -C ${quoteShellArgument(input.record.path)} switch -c ${quoteShellArgument(input.branch)}`,
      );
      const createdOk = created.assertSucceeded(
        `Failed to create local branch ${input.branch}`,
      );
      if (createdOk.isErr()) return err(createdOk.error);
    } else {
      return err(new RepositoryError(
        "REPOSITORY_SANDBOX_FAILED",
        `Failed to inspect local branch ${input.branch}: ${existingBranch.failureSummary()}`,
      ));
    }

    const pathspec = input.changedFiles.map(quoteShellArgument).join(" ");
    const staged = await this.#shell.run(
      `git -C ${quoteShellArgument(input.record.path)} add -A -- ${pathspec}`,
    );
    const stagedOk = staged.assertSucceeded(
      "Failed to stage reviewed documentation paths",
    );
    if (stagedOk.isErr()) return err(stagedOk.error);
    const stagedPaths = await this.#shell.readNullSeparated(
      `git -C ${quoteShellArgument(input.record.path)} diff --cached --name-only --no-renames -z ${quoteShellArgument(input.record.baseCommitSha)} --`,
      "Failed to verify staged documentation paths",
    );
    if (stagedPaths.isErr()) return err(stagedPaths.error);
    const actualPaths = stagedPaths.value.sort();
    if (!sameStrings(actualPaths, [...input.changedFiles].sort())) {
      return err(new RepositoryError(
        "REPOSITORY_REVIEW_MISMATCH",
        "Git staging did not match the exact reviewed documentation paths.",
      ));
    }

    const committed = await this.#shell.run(
      `git -C ${quoteShellArgument(input.record.path)} -c user.name=Paige -c user.email=paige@users.noreply.github.com commit --no-gpg-sign -m ${quoteShellArgument(input.message)}`,
    );
    const committedOk = committed.assertSucceeded(
      "Failed to create the documentation publish checkpoint",
    );
    if (committedOk.isErr()) return err(committedOk.error);
    const commitSha = await this.#shell.read(
      `git -C ${quoteShellArgument(input.record.path)} rev-parse HEAD`,
      "Failed to resolve the documentation checkpoint commit SHA",
    );
    return commitSha.map((value) => ({
      branch: input.branch,
      commitSha: value,
      baseCommitSha: input.record.baseCommitSha,
    }));
  }

  async find(input: {
    record: WorkspaceRecord;
    publishRequest: PublishRequest;
  }): Promise<RepositoryResult<DocumentationCommit | undefined>> {
    const branch = await this.#shell.run(
      `git -C ${quoteShellArgument(input.record.path)} rev-parse --verify --quiet ${quoteShellArgument(`refs/heads/${input.publishRequest.branch}`)}`,
    );
    if (branch.exitCode === 1) return ok(undefined);
    if (branch.exitCode !== 0) {
      return err(new RepositoryError(
        "REPOSITORY_SANDBOX_FAILED",
        `Failed to inspect local branch ${input.publishRequest.branch}: ${branch.failureSummary()}`,
      ));
    }
    const commitSha = branch.stdout.trim();
    if (commitSha === input.record.baseCommitSha) return ok(undefined);

    const [head, status, parent, message] = await Promise.all([
      this.#shell.read(
        `git -C ${quoteShellArgument(input.record.path)} rev-parse HEAD`,
        "Failed to inspect documentation workspace HEAD",
      ),
      this.#shell.read(
        `git -C ${quoteShellArgument(input.record.path)} status --porcelain=v1`,
        "Failed to inspect documentation workspace status",
      ),
      this.#shell.read(
        `git -C ${quoteShellArgument(input.record.path)} rev-parse ${quoteShellArgument(`${commitSha}^`)}`,
        "Failed to inspect the documentation checkpoint parent",
      ),
      this.#shell.read(
        `git -C ${quoteShellArgument(input.record.path)} log -1 --format=%B ${quoteShellArgument(commitSha)}`,
        "Failed to inspect the documentation checkpoint message",
      ),
    ]);
    const combined = Result.combine([head, status, parent, message]);
    if (combined.isErr()) return err(combined.error);
    if (
      (combined.value[0] !== commitSha &&
        combined.value[0] !== input.record.baseCommitSha) ||
      combined.value[1] !== "" ||
      combined.value[2] !== input.record.baseCommitSha ||
      combined.value[3] !== input.publishRequest.commitMessage
    ) {
      return err(new RepositoryError(
        "REPOSITORY_CONFLICT",
        `Local branch ${input.publishRequest.branch} is not the recorded publish checkpoint.`,
      ));
    }
    const changes = await this.readChanges(input.record, commitSha);
    if (changes.isErr()) return err(changes.error);
    if (changes.value.reviewId !== input.publishRequest.reviewId) {
      return err(new RepositoryError(
        "REPOSITORY_REVIEW_MISMATCH",
        "The existing publish checkpoint does not match the reviewed changes.",
      ));
    }
    return ok({
      branch: input.publishRequest.branch,
      commitSha,
      baseCommitSha: input.record.baseCommitSha,
    });
  }

  async readChanges(
    record: WorkspaceRecord,
    commitSha: string,
  ): Promise<RepositoryResult<{
    reviewId: string;
    files: ChangedFile[];
  }>> {
    const changed = await this.#shell.readNullSeparated(
      `git -C ${quoteShellArgument(record.path)} diff --name-only --no-renames -z ${quoteShellArgument(record.baseCommitSha)} ${quoteShellArgument(commitSha)} --`,
      "Failed to read checkpoint documentation paths",
    );
    if (changed.isErr()) return err(changed.error);
    const changedFiles = changed.value.sort();
    if (
      changedFiles.length === 0 ||
      changedFiles.length > MAX_CHANGED_FILES
    ) {
      return err(new RepositoryError(
        "REPOSITORY_REVIEW_MISMATCH",
        "The publish checkpoint has an invalid changed-file set.",
      ));
    }
    const files: ChangedFile[] = [];
    for (const path of changedFiles) {
      const mode = await this.#shell.read(
        `git -C ${quoteShellArgument(record.path)} ls-tree ${quoteShellArgument(commitSha)} -- ${quoteShellArgument(path)}`,
        `Failed to inspect checkpoint file mode: ${path}`,
      );
      if (mode.isErr()) return err(mode.error);
      if (mode.value.startsWith("120000 ")) {
        return err(new RepositoryError(
          "REPOSITORY_CHANGES_REJECTED",
          `Documentation checkpoints cannot include symlinks: ${path}`,
        ));
      }
      const binary = await this.#shell.read(
        `git -C ${quoteShellArgument(record.path)} diff --numstat ${quoteShellArgument(record.baseCommitSha)} ${quoteShellArgument(commitSha)} -- ${quoteShellArgument(path)}`,
        `Failed to inspect checkpoint file type: ${path}`,
      );
      if (binary.isErr()) return err(binary.error);
      if (binary.value.startsWith("-\t-")) {
        return err(new RepositoryError(
          "REPOSITORY_CHANGES_REJECTED",
          `Documentation checkpoints cannot include binary files: ${path}`,
        ));
      }
      const object = `${commitSha}:${path}`;
      const exists = await this.#shell.run(
        `git -C ${quoteShellArgument(record.path)} cat-file -e ${quoteShellArgument(object)}`,
      );
      if (exists.exitCode === 1 || exists.exitCode === 128) {
        files.push({ path, content: null });
        continue;
      }
      const existsOk = exists.assertSucceeded(
        `Failed to inspect checkpoint file: ${path}`,
      );
      if (existsOk.isErr()) return err(existsOk.error);
      const size = await this.#shell.read(
        `git -C ${quoteShellArgument(record.path)} cat-file -s ${quoteShellArgument(object)}`,
        `Failed to inspect checkpoint file size: ${path}`,
      );
      if (size.isErr()) return err(size.error);
      if (Number.parseInt(size.value, 10) > MAX_FILE_BYTES) {
        return err(new RepositoryError(
          "REPOSITORY_CHANGES_REJECTED",
          `Documentation checkpoint file is too large: ${path}`,
        ));
      }
      const content = await this.#shell.read(
        `git -C ${quoteShellArgument(record.path)} show ${quoteShellArgument(object)}`,
        `Failed to read checkpoint file: ${path}`,
        { trim: false },
      );
      if (content.isErr()) return err(content.error);
      files.push({ path, content: content.value });
    }
    return ok({
      reviewId: createReviewId(record.baseCommitSha, files),
      files,
    });
  }
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}
