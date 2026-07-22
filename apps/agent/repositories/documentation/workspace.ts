import type { SandboxSession } from "eve/sandbox";
import { err, ok, Result, ResultAsync } from "neverthrow";

import type { RepositoryResult } from "@paige/repositories/errors";
import { RepositoryError } from "@paige/repositories/errors";
import type {
  DocumentationRepository,
  RepositoryConfig,
  RepositoryWorkspace,
  ResolvedRepository,
} from "@paige/repositories/types";
import { PublishRecovery } from "./publish-recovery";
import {
  SandboxShell,
  quoteShellArgument,
} from "./sandbox-shell";
import {
  assertRecordMatchesRepository,
  type OpenedWorkspace,
  type WorkspaceRecord,
  WorkspaceRecordStore,
  toOpenedWorkspace,
  workspacePath,
  workspaceRoot,
} from "./workspace-record";

// The workspace is Paige's protected editable copy of the documentation
// repository. Opening it verifies its identity and recovers known publish states.
export class DocumentationWorkspace {
  readonly #shell: SandboxShell;
  readonly #records: WorkspaceRecordStore;
  readonly #recovery: PublishRecovery;

  constructor(input: {
    sandbox: SandboxSession;
    abortSignal: AbortSignal;
  }) {
    this.#shell = new SandboxShell(input);
    this.#records = new WorkspaceRecordStore(input);
    this.#recovery = new PublishRecovery(input);
  }

  open(
    cache: RepositoryWorkspace<DocumentationRepository>,
  ): ResultAsync<OpenedWorkspace, RepositoryError> {
    return new ResultAsync((async () => {
      const path = workspacePath(cache.repository);
      if (await this.#shell.pathExists(path)) {
        const stored = await this.#records.read(cache.repository);
        if (stored.isErr()) return err(stored.error);
        const matching = assertRecordMatchesRepository(
          stored.value,
          cache.repository,
        );
        if (matching.isErr()) return err(matching.error);
        const verified = await this.#verifyIdentity({
          path,
          cachePath: cache.path,
          repository: stored.value.repository,
        });
        if (verified.isErr()) return err(verified.error);

        const restored = await this.#recovery.restoreWorkspace(stored.value);
        if (restored.isErr()) return err(restored.error);
        const status = await this.#shell.run(
          `git -C ${quoteShellArgument(path)} status --porcelain=v1`,
        );
        const statusOk = status.assertSucceeded(
          "Failed to inspect documentation workspace status",
        );
        if (statusOk.isErr()) return err(statusOk.error);
        if (status.stdout.trim() !== "") {
          return err(new RepositoryError(
            "REPOSITORY_DIRTY_WORKSPACE",
            "The documentation workspace contains uncommitted edits.",
          ));
        }

        const head = await this.#shell.read(
          `git -C ${quoteShellArgument(path)} rev-parse HEAD`,
          "Failed to inspect documentation workspace HEAD",
        );
        if (head.isErr()) return err(head.error);
        if (head.value !== cache.repository.commitSha) {
          const removed = await this.#shell.run(
            `git -C ${quoteShellArgument(cache.path)} worktree remove ${quoteShellArgument(path)}`,
          );
          const removedOk = removed.assertSucceeded(
            "Failed to replace the clean documentation workspace",
          );
          if (removedOk.isErr()) return err(removedOk.error);
          const created = await this.#create(cache);
          if (created.isErr()) return err(created.error);
        }
      } else {
        const created = await this.#create(cache);
        if (created.isErr()) return err(created.error);
      }

      const record: WorkspaceRecord = {
        version: 2,
        path,
        cachePath: cache.path,
        repository: cache.repository,
        baseBranch: cache.repository.ref,
        baseCommitSha: cache.repository.commitSha,
      };
      const saved = await this.#records.save(record);
      if (saved.isErr()) return err(saved.error);
      return ok(toOpenedWorkspace(record));
    })());
  }

  reopen(
    repository: DocumentationRepository,
  ): ResultAsync<WorkspaceRecord, RepositoryError> {
    return new ResultAsync((async () => {
      const stored = await this.#records.read(repository);
      if (stored.isErr()) return err(stored.error);
      const matching = assertRecordMatchesRepository(
        stored.value,
        repository,
      );
      if (matching.isErr()) return err(matching.error);
      const verified = await this.#verifyIdentity({
        path: stored.value.path,
        cachePath: stored.value.cachePath,
        repository: stored.value.repository,
      });
      if (verified.isErr()) return err(verified.error);
      return await this.#recovery.restoreWorkspace(stored.value);
    })());
  }

  async #create(
    cache: RepositoryWorkspace<DocumentationRepository>,
  ): Promise<RepositoryResult<void>> {
    const path = workspacePath(cache.repository);
    const root = await this.#shell.run(
      `mkdir -p ${quoteShellArgument(workspaceRoot())}`,
    );
    const rootOk = root.assertSucceeded(
      "Failed to create the documentation workspace root",
    );
    if (rootOk.isErr()) return err(rootOk.error);
    const pruned = await this.#shell.run(
      `git -C ${quoteShellArgument(cache.path)} worktree prune`,
    );
    const prunedOk = pruned.assertSucceeded(
      "Failed to prune stale documentation worktrees",
    );
    if (prunedOk.isErr()) return err(prunedOk.error);
    const result = await this.#shell.run(
      `git -C ${quoteShellArgument(cache.path)} worktree add --detach ${quoteShellArgument(path)} ${quoteShellArgument(cache.repository.commitSha)}`,
    );
    return result.assertSucceeded(
      "Failed to create documentation workspace",
    );
  }

  async #verifyIdentity(input: {
    path: string;
    cachePath: string;
    repository:
      | DocumentationRepository
      | ResolvedRepository<DocumentationRepository>;
  }): Promise<RepositoryResult<void>> {
    const [root, remote, workspaceGitDirectory, cacheGitDirectory] =
      await Promise.all([
        this.#shell.read(
          `git -C ${quoteShellArgument(input.path)} rev-parse --show-toplevel`,
          "Failed to resolve the documentation workspace root",
        ),
        this.#shell.read(
          `git -C ${quoteShellArgument(input.path)} remote get-url origin`,
          "Failed to resolve the documentation workspace origin",
        ),
        this.#shell.read(
          `cd ${quoteShellArgument(input.path)} && cd "$(git rev-parse --git-common-dir)" && pwd -P`,
          "Failed to resolve the documentation workspace Git directory",
        ),
        this.#shell.read(
          `cd ${quoteShellArgument(input.cachePath)} && cd "$(git rev-parse --git-common-dir)" && pwd -P`,
          "Failed to resolve the repository cache Git directory",
        ),
      ]);
    const combined = Result.combine([
      root,
      remote,
      workspaceGitDirectory,
      cacheGitDirectory,
    ]);
    if (combined.isErr()) {
      return err(new RepositoryError(
        "REPOSITORY_CONFLICT",
        "The documentation path is not the expected Git workspace.",
        { cause: combined.error },
      ));
    }
    const [rootValue, remoteValue, workspaceGitValue, cacheGitValue] =
      combined.value;
    if (
      rootValue !== input.path ||
      remoteValue !== githubRemoteUrl(input.repository) ||
      workspaceGitValue !== cacheGitValue
    ) {
      return err(new RepositoryError(
        "REPOSITORY_CONFLICT",
        "The documentation workspace identity does not match the configured repository cache.",
      ));
    }
    return ok(undefined);
  }
}

function githubRemoteUrl(repository: RepositoryConfig): string {
  return `https://github.com/${repository.owner}/${repository.name}.git`;
}
