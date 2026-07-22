import type { SandboxSession } from "eve/sandbox";
import { err, ok, Result } from "neverthrow";

import type { RepositoryResult } from "@paige/repositories/errors";
import { RepositoryError } from "@paige/repositories/errors";
import { DocumentationEditor } from "./editor";
import { PublishCheckpoint } from "./publish-checkpoint";
import {
  SandboxShell,
  quoteShellArgument,
} from "./sandbox-shell";
import type { WorkspaceRecord } from "./workspace-record";
import { WorkspaceRecordStore } from "./workspace-record";

// Publishing may pause after approval, checkpoint creation, or the GitHub
// write. Recovery accepts only those known states and rejects unknown edits.
export class PublishRecovery {
  readonly #sandbox: SandboxSession;
  readonly #shell: SandboxShell;
  readonly #records: WorkspaceRecordStore;
  readonly #checkpoints: PublishCheckpoint;
  readonly #abortSignal: AbortSignal;

  constructor(input: {
    sandbox: SandboxSession;
    abortSignal: AbortSignal;
  }) {
    this.#sandbox = input.sandbox;
    this.#shell = new SandboxShell(input);
    this.#records = new WorkspaceRecordStore(input);
    this.#checkpoints = new PublishCheckpoint(this.#shell);
    this.#abortSignal = input.abortSignal;
  }

  async restoreWorkspace(
    record: WorkspaceRecord,
  ): Promise<RepositoryResult<WorkspaceRecord>> {
    const [head, status] = await Promise.all([
      this.#shell.read(
        `git -C ${quoteShellArgument(record.path)} rev-parse HEAD`,
        "Failed to inspect documentation workspace HEAD before recovery",
      ),
      this.#shell.read(
        `git -C ${quoteShellArgument(record.path)} status --porcelain=v1`,
        "Failed to inspect documentation workspace status before recovery",
      ),
    ]);
    const inspected = Result.combine([head, status]);
    if (inspected.isErr()) return err(inspected.error);
    const [headValue, statusValue] = inspected.value;
    const branch = await this.#shell.run(
      `git -C ${quoteShellArgument(record.path)} symbolic-ref --quiet --short HEAD`,
    );
    if (branch.exitCode !== 0 && branch.exitCode !== 1) {
      return err(new RepositoryError(
        "REPOSITORY_SANDBOX_FAILED",
        `Failed to inspect the documentation workspace branch: ${branch.failureSummary()}`,
      ));
    }
    const branchValue = branch.exitCode === 0
      ? branch.stdout.trim()
      : undefined;
    let branchToDetach = branchValue;
    const publishRequest = record.publishRequest;

    if (publishRequest === undefined) {
      if (headValue !== record.baseCommitSha || branchValue !== undefined) {
        return err(new RepositoryError(
          "REPOSITORY_CONFLICT",
          "The documentation workspace contains an unknown branch or commit; refusing recovery.",
        ));
      }
      return ok(record);
    }
    if (
      branchValue !== undefined &&
      branchValue !== publishRequest.branch
    ) {
      return err(new RepositoryError(
        "REPOSITORY_CONFLICT",
        `The documentation workspace is on unknown branch ${branchValue}; refusing recovery.`,
      ));
    }

    if (headValue === record.baseCommitSha) {
      if (statusValue !== "") {
        const review = await new DocumentationEditor({
          sandbox: this.#sandbox,
          record,
          abortSignal: this.#abortSignal,
        }).review();
        if (
          review.isErr() ||
          !review.value.hasChanges ||
          review.value.reviewId !== publishRequest.reviewId
        ) {
          return err(new RepositoryError(
            "REPOSITORY_DIRTY_WORKSPACE",
            "The documentation workspace changed after review; refusing to discard it during recovery.",
            { cause: review.isErr() ? review.error : undefined },
          ));
        }
        const checkpoint = await this.#checkpoints.create({
          record,
          branch: publishRequest.branch,
          message: publishRequest.commitMessage,
          changedFiles: review.value.changedFiles,
        });
        if (checkpoint.isErr()) return err(checkpoint.error);
        branchToDetach = publishRequest.branch;
      }
    } else {
      if (statusValue !== "") {
        return err(new RepositoryError(
          "REPOSITORY_DIRTY_WORKSPACE",
          "The documentation workspace contains edits after its publish checkpoint; refusing recovery.",
        ));
      }
      if (branchValue !== publishRequest.branch) {
        return err(new RepositoryError(
          "REPOSITORY_CONFLICT",
          "The documentation workspace is not on its recorded publish branch; refusing recovery.",
        ));
      }
      const checkpoint = await this.#checkpoints.find({
        record,
        publishRequest,
      });
      if (checkpoint.isErr()) return err(checkpoint.error);
      if (
        checkpoint.value === undefined ||
        checkpoint.value.commitSha !== headValue
      ) {
        return err(new RepositoryError(
          "REPOSITORY_CONFLICT",
          "The documentation workspace commit does not match its recorded publish checkpoint.",
        ));
      }
    }

    if (branchToDetach !== undefined) {
      const detached = await this.#shell.run(
        `git -C ${quoteShellArgument(record.path)} switch --detach ${quoteShellArgument(record.baseCommitSha)}`,
      );
      const detachedOk = detached.assertSucceeded(
        "Failed to restore the documentation workspace to its starting commit",
      );
      if (detachedOk.isErr()) return err(detachedOk.error);
    }
    const [restoredHead, restoredStatus] = await Promise.all([
      this.#shell.read(
        `git -C ${quoteShellArgument(record.path)} rev-parse HEAD`,
        "Failed to verify documentation workspace HEAD after recovery",
      ),
      this.#shell.read(
        `git -C ${quoteShellArgument(record.path)} status --porcelain=v1`,
        "Failed to verify documentation workspace status after recovery",
      ),
    ]);
    const restored = Result.combine([restoredHead, restoredStatus]);
    if (restored.isErr()) return err(restored.error);
    if (
      restored.value[0] !== record.baseCommitSha ||
      restored.value[1] !== ""
    ) {
      return err(new RepositoryError(
        "REPOSITORY_CONFLICT",
        "The documentation workspace did not return to its clean starting commit.",
      ));
    }
    return await this.#records.clearPublishRequest(record);
  }
}
