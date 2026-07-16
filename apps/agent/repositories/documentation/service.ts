import { createHash } from "node:crypto";
import { posix } from "node:path";

import type {
  SandboxCommandResult,
  SandboxSession,
} from "eve/sandbox";
import type { ToolContext } from "eve/tools";
import { err, ok, Result, ResultAsync } from "neverthrow";

import {
  assertDocumentationRepository,
  repositories,
} from "../config";
import { SandboxGit } from "../git";
import {
  assertRepositoryRelativePath,
  assertSearchQuery,
  selectFileLines,
} from "../files";
import type {
  RepositoryResult,
  RepositoryResultAsync,
} from "../shared/errors";
import { RepositoryError } from "../shared/errors";
import {
  createGitHubRequest,
  GitHubRepository,
  resolveGitHubToken,
} from "../shared/github";
import { serializeSandbox } from "../shared/serialization";
import type {
  DocumentationRepository,
  RepositoryConfig,
  RepositoryWorkspace,
  ResolvedRepository,
} from "../types";
import type {
  DocumentationCommit,
  DocumentationDiff,
  DocumentationSearchMatch,
  DocumentationWorkspace,
  DocumentationWriteback,
} from "./types";

const WORKTREE_ROOT = "/workspace/worktrees";
const MAX_EDIT_BYTES = 200_000;
const MAX_FILE_BYTES = 1_000_000;
const MAX_DIFF_FILES = 50;
const MAX_DIFF_BYTES = 120_000;
const MAX_SEARCH_FILES = 2_000;
const MAX_SEARCH_EXCERPT_CHARACTERS = 500;

interface DocumentationRepositoryServiceOptions {
  repositories?: RepositoryConfig[];
  getGitHubToken?: () => RepositoryResultAsync<string>;
}

export interface DocumentationWorkspaceState {
  version: 1;
  path: string;
  cachePath: string;
  repository: ResolvedRepository<DocumentationRepository>;
  baseBranch: string;
  baseCommitSha: string;
}

interface ProposedFile {
  path: string;
  content: string | null;
}

export class DocumentationRepositoryService {
  readonly #ctx: ToolContext;
  readonly #repositories: RepositoryConfig[];
  readonly #getGitHubToken: () => RepositoryResultAsync<string>;

  constructor(
    ctx: ToolContext,
    options: DocumentationRepositoryServiceOptions = {},
  ) {
    this.#ctx = ctx;
    this.#repositories = options.repositories ?? repositories;
    this.#getGitHubToken =
      options.getGitHubToken ?? resolveGitHubToken;
  }

  prepareWorkspace(): RepositoryResultAsync<DocumentationWorkspace> {
    return this.#documentationRepository().asyncAndThen((repository) =>
      this.#getGitHubToken().andThen((token) =>
        this.#github(repository, token).resolveCommit().andThen((resolved) =>
          this.#withSandbox((sandbox) => {
            const git = new SandboxGit(sandbox);
            return git.ensureCommits({
              repository,
              commits: [resolved],
              token,
            }).andThen(([cache]) =>
              prepareDocumentationWorkspace({
                sandbox,
                cache,
                abortSignal: this.#ctx.abortSignal,
              })
            );
          })
        )
      )
    );
  }

  listFiles(input: {
    pathPrefix: string;
    limit: number;
  }): RepositoryResultAsync<{
    files: string[];
    truncated: boolean;
  }> {
    return assertRepositoryRelativePath(
      input.pathPrefix,
      { allowRoot: true },
    ).asyncAndThen((pathPrefix) =>
      this.#withReadyWorkspace((sandbox, state) =>
        listDocumentationFiles({
          sandbox,
          state,
          abortSignal: this.#ctx.abortSignal,
          pathPrefix,
          limit: input.limit,
        })
      )
    );
  }

  search(input: {
    query: string;
    pathPrefix: string;
    limit: number;
  }): RepositoryResultAsync<{
    matches: DocumentationSearchMatch[];
    truncated: boolean;
  }> {
    return Result.combine([
      assertSearchQuery(input.query),
      assertRepositoryRelativePath(input.pathPrefix, { allowRoot: true }),
    ]).asyncAndThen(([query, pathPrefix]) =>
      this.#withReadyWorkspace((sandbox, state) =>
        searchDocumentationWorkspace({
          sandbox,
          state,
          abortSignal: this.#ctx.abortSignal,
          query,
          pathPrefix,
          limit: input.limit,
        })
      )
    );
  }

  read(input: {
    path: string;
    startLine: number;
    endLine?: number;
    maxCharacters: number;
  }) {
    return assertRepositoryRelativePath(
      input.path,
      { allowRoot: false },
    ).asyncAndThen((path) =>
      this.#withReadyWorkspace((sandbox, state) =>
        readDocumentationFile({
          sandbox,
          state,
          abortSignal: this.#ctx.abortSignal,
          path,
          startLine: input.startLine,
          endLine: input.endLine,
          maxCharacters: input.maxCharacters,
        })
      )
    );
  }

  write(input: {
    path: string;
    content: string;
  }) {
    return assertRepositoryRelativePath(
      input.path,
      { allowRoot: false },
    ).asyncAndThen((path) =>
      this.#withReadyWorkspace((sandbox, state) =>
        writeDocumentationFile({
          sandbox,
          state,
          abortSignal: this.#ctx.abortSignal,
          path,
          content: input.content,
        })
      )
    );
  }

  remove(input: { path: string }) {
    return assertRepositoryRelativePath(
      input.path,
      { allowRoot: false },
    ).asyncAndThen((path) =>
      this.#withReadyWorkspace((sandbox, state) =>
        removeDocumentationFile({
          sandbox,
          state,
          abortSignal: this.#ctx.abortSignal,
          path,
        })
      )
    );
  }

  inspectDiff(): RepositoryResultAsync<DocumentationDiff> {
    return this.#withReadyWorkspace((sandbox, state) =>
      inspectDocumentationDiff({
        sandbox,
        state,
        abortSignal: this.#ctx.abortSignal,
      })
    );
  }

  writeback(input: {
    digest: string;
    branch: string;
    commitMessage: string;
    pullRequestTitle: string;
    pullRequestBody: string;
  }): RepositoryResultAsync<DocumentationWriteback> {
    const normalized = validateWritebackInput(input);
    if (normalized.isErr()) {
      return new ResultAsync(Promise.resolve(err(normalized.error)));
    }

    return this.#documentationRepository().asyncAndThen((repository) =>
      this.#getGitHubToken().andThen((token) =>
        this.#withSandbox((sandbox) =>
          writebackDocumentation({
            sandbox,
            repository,
            github: this.#github(repository, token),
            abortSignal: this.#ctx.abortSignal,
            input: normalized.value,
          })
        )
      )
    );
  }

  #documentationRepository(): RepositoryResult<DocumentationRepository> {
    const candidates = this.#repositories.filter(
      (repository) => repository.role === "documentation",
    );
    if (candidates.length !== 1) {
      return err(new RepositoryError(
        "REPOSITORY_NOT_CONFIGURED",
        "Configure exactly one documentation repository.",
      ));
    }
    return assertDocumentationRepository(candidates[0]);
  }

  #github(
    repository: DocumentationRepository,
    token: string,
  ): GitHubRepository<DocumentationRepository> {
    return new GitHubRepository(
      repository,
      createGitHubRequest({
        token,
        abortSignal: this.#ctx.abortSignal,
      }),
    );
  }

  #withReadyWorkspace<T>(
    operation: (
      sandbox: SandboxSession,
      state: DocumentationWorkspaceState,
    ) => RepositoryResultAsync<T>,
  ): RepositoryResultAsync<T> {
    return this.#withSandbox((sandbox) =>
      loadDocumentationWorkspace({
        sandbox,
        repository: this.#documentationRepository(),
        abortSignal: this.#ctx.abortSignal,
      }).andThen((state) => operation(sandbox, state))
    );
  }

  #withSandbox<T>(
    operation: (sandbox: SandboxSession) => RepositoryResultAsync<T>,
  ): RepositoryResultAsync<T> {
    return new ResultAsync(
      this.#ctx.getSandbox().then((sandbox) => ok(sandbox)),
    ).andThen((sandbox) =>
      serializeSandbox(sandbox.id, () => operation(sandbox))
    );
  }
}

export function prepareDocumentationWorkspace(input: {
  sandbox: SandboxSession;
  cache: RepositoryWorkspace<DocumentationRepository>;
  abortSignal: AbortSignal;
}): RepositoryResultAsync<DocumentationWorkspace> {
  return new ResultAsync((async () => {
    const path = worktreePath(input.cache.repository);
    const exists = await pathExists(
      input.sandbox,
      path,
      input.abortSignal,
    );
    if (exists) {
      const verified = await verifyWorktreeIdentity({
        sandbox: input.sandbox,
        path,
        cachePath: input.cache.path,
        repository: input.cache.repository,
        abortSignal: input.abortSignal,
      });
      if (verified.isErr()) return err(verified.error);

      const status = await run(
        input.sandbox,
        `git -C ${quoteShellArgument(path)} status --porcelain=v1`,
        input.abortSignal,
      );
      const statusOk = successfulCommand(
        status,
        "Failed to inspect documentation workspace status",
      );
      if (statusOk.isErr()) return err(statusOk.error);
      if (status.stdout.trim() !== "") {
        return err(new RepositoryError(
          "REPOSITORY_DIRTY_WORKSPACE",
          "The documentation workspace contains uncommitted edits.",
        ));
      }

      const head = await readCommand(
        input.sandbox,
        `git -C ${quoteShellArgument(path)} rev-parse HEAD`,
        input.abortSignal,
        "Failed to inspect documentation workspace HEAD",
      );
      if (head.isErr()) return err(head.error);
      if (head.value !== input.cache.repository.commitSha) {
        const branch = await run(
          input.sandbox,
          `git -C ${quoteShellArgument(path)} symbolic-ref --quiet --short HEAD`,
          input.abortSignal,
        );
        if (branch.exitCode === 0) {
          return err(new RepositoryError(
            "REPOSITORY_CONFLICT",
            `The documentation workspace is on local branch ${branch.stdout.trim()}; refusing to replace it.`,
          ));
        }
        if (branch.exitCode !== 1) {
          return err(new RepositoryError(
            "REPOSITORY_SANDBOX_FAILED",
            `Failed to inspect the documentation workspace branch: ${summarizeCommandFailure(branch)}`,
          ));
        }
        const removed = await run(
          input.sandbox,
          `git -C ${quoteShellArgument(input.cache.path)} worktree remove ${quoteShellArgument(path)}`,
          input.abortSignal,
        );
        const removedOk = successfulCommand(
          removed,
          "Failed to replace the clean documentation workspace",
        );
        if (removedOk.isErr()) return err(removedOk.error);
        const created = await createWorktree(input);
        if (created.isErr()) return err(created.error);
      }
    } else {
      const created = await createWorktree(input);
      if (created.isErr()) return err(created.error);
    }

    const state: DocumentationWorkspaceState = {
      version: 1,
      path,
      cachePath: input.cache.path,
      repository: input.cache.repository,
      baseBranch: input.cache.repository.ref,
      baseCommitSha: input.cache.repository.commitSha,
    };
    await input.sandbox.writeTextFile({
      path: workspaceStatePath(input.cache.repository),
      content: `${JSON.stringify(state)}\n`,
      abortSignal: input.abortSignal,
    });

    return ok(toDocumentationWorkspace(state));
  })());
}

function listDocumentationFiles(input: {
  sandbox: SandboxSession;
  state: DocumentationWorkspaceState;
  abortSignal: AbortSignal;
  pathPrefix: string;
  limit: number;
}): RepositoryResultAsync<{
  files: string[];
  truncated: boolean;
}> {
  return new ResultAsync((async () => {
    const editable = await assertEditableBase(input);
    if (editable.isErr()) return err(editable.error);
    const pathspec = input.pathPrefix === "."
      ? ""
      : ` -- ${quoteShellArgument(input.pathPrefix)}`;
    const result = await run(
      input.sandbox,
      `git -C ${quoteShellArgument(input.state.path)} ls-files -co --exclude-standard -z${pathspec}`,
      input.abortSignal,
    );
    const listed = successfulCommand(
      result,
      "Failed to list documentation workspace files",
    );
    if (listed.isErr()) return err(listed.error);
    const files = [...new Set(parseNullSeparated(result.stdout))].sort();
    return ok({
      files: files.slice(0, input.limit),
      truncated: files.length > input.limit,
    });
  })());
}

function searchDocumentationWorkspace(input: {
  sandbox: SandboxSession;
  state: DocumentationWorkspaceState;
  abortSignal: AbortSignal;
  query: string;
  pathPrefix: string;
  limit: number;
}): RepositoryResultAsync<{
  matches: DocumentationSearchMatch[];
  truncated: boolean;
}> {
  return listDocumentationFiles({
    ...input,
    limit: MAX_SEARCH_FILES + 1,
  }).andThen(({ files, truncated: fileListTruncated }) =>
    new ResultAsync((async () => {
      const matches: DocumentationSearchMatch[] = [];
      for (const path of files.slice(0, MAX_SEARCH_FILES)) {
        const content = await tryReadWorkspaceText({
          sandbox: input.sandbox,
          state: input.state,
          abortSignal: input.abortSignal,
          path,
        });
        if (content.isErr()) return err(content.error);
        if (content.value === null) continue;
        const lines = content.value.split("\n");
        for (const [index, line] of lines.entries()) {
          if (!line.includes(input.query)) continue;
          matches.push({
            path,
            line: index + 1,
            excerpt: line.slice(0, MAX_SEARCH_EXCERPT_CHARACTERS),
          });
          if (matches.length > input.limit) {
            return ok({
              matches: matches.slice(0, input.limit),
              truncated: true,
            });
          }
        }
      }
      return ok({
        matches,
        truncated: fileListTruncated,
      });
    })())
  );
}

function readDocumentationFile(input: {
  sandbox: SandboxSession;
  state: DocumentationWorkspaceState;
  abortSignal: AbortSignal;
  path: string;
  startLine: number;
  endLine?: number;
  maxCharacters: number;
}) {
  return new ResultAsync((async () => {
    const editable = await assertEditableBase(input);
    if (editable.isErr()) return err(editable.error);
    const content = await readRequiredWorkspaceText(input);
    if (content.isErr()) return err(content.error);
    const selection = selectFileLines(content.value, {
      startLine: input.startLine,
      endLine: input.endLine,
      maxCharacters: input.maxCharacters,
    });
    return selection.map((value) => ({ path: input.path, ...value }));
  })());
}

export function writeDocumentationFile(input: {
  sandbox: SandboxSession;
  state: DocumentationWorkspaceState;
  abortSignal: AbortSignal;
  path: string;
  content: string;
}) {
  return new ResultAsync((async () => {
    const editable = await assertEditableBase(input);
    if (editable.isErr()) return err(editable.error);
    const size = Buffer.byteLength(input.content);
    if (size > MAX_EDIT_BYTES) {
      return err(new RepositoryError(
        "REPOSITORY_INVALID_INPUT",
        `Documentation edits must be at most ${MAX_EDIT_BYTES} bytes.`,
      ));
    }
    const safe = await assertSafeWorkspacePath(input);
    if (safe.isErr()) return err(safe.error);
    const directory = posix.dirname(input.path);
    if (directory !== ".") {
      const created = await run(
        input.sandbox,
        `mkdir -p ${quoteShellArgument(`${input.state.path}/${directory}`)}`,
        input.abortSignal,
      );
      const createdOk = successfulCommand(
        created,
        "Failed to create documentation directory",
      );
      if (createdOk.isErr()) return err(createdOk.error);
    }
    const directoryCheck = await assertSafeWorkspacePath(input);
    if (directoryCheck.isErr()) return err(directoryCheck.error);
    await input.sandbox.writeTextFile({
      path: `${input.state.path}/${input.path}`,
      content: input.content,
      abortSignal: input.abortSignal,
    });
    return ok({ path: input.path, bytes: size });
  })());
}

export function removeDocumentationFile(input: {
  sandbox: SandboxSession;
  state: DocumentationWorkspaceState;
  abortSignal: AbortSignal;
  path: string;
}) {
  return new ResultAsync((async () => {
    const editable = await assertEditableBase(input);
    if (editable.isErr()) return err(editable.error);
    const safe = await assertSafeWorkspacePath(input);
    if (safe.isErr()) return err(safe.error);
    const absolutePath = `${input.state.path}/${input.path}`;
    const regular = await run(
      input.sandbox,
      `test -f ${quoteShellArgument(absolutePath)} && test ! -L ${quoteShellArgument(absolutePath)}`,
      input.abortSignal,
    );
    if (regular.exitCode !== 0) {
      return err(new RepositoryError(
        "REPOSITORY_FILE_NOT_FOUND",
        `Documentation file does not exist: ${input.path}`,
      ));
    }
    await input.sandbox.removePath({
      path: absolutePath,
      force: false,
      abortSignal: input.abortSignal,
    });
    return ok({ path: input.path, removed: true });
  })());
}

export function inspectDocumentationDiff(input: {
  sandbox: SandboxSession;
  state: DocumentationWorkspaceState;
  abortSignal: AbortSignal;
}): RepositoryResultAsync<DocumentationDiff> {
  return new ResultAsync((async () => {
    const editable = await assertEditableBase(input);
    if (editable.isErr()) return err(editable.error);
    const trackedResult = await run(
      input.sandbox,
      `git -C ${quoteShellArgument(input.state.path)} diff --name-only --no-renames -z ${quoteShellArgument(input.state.baseCommitSha)} --`,
      input.abortSignal,
    );
    const trackedOk = successfulCommand(
      trackedResult,
      "Failed to inspect tracked documentation changes",
    );
    if (trackedOk.isErr()) return err(trackedOk.error);
    const untrackedResult = await run(
      input.sandbox,
      `git -C ${quoteShellArgument(input.state.path)} ls-files --others --exclude-standard -z`,
      input.abortSignal,
    );
    const untrackedOk = successfulCommand(
      untrackedResult,
      "Failed to inspect untracked documentation files",
    );
    if (untrackedOk.isErr()) return err(untrackedOk.error);

    const untracked = new Set(parseNullSeparated(untrackedResult.stdout));
    const changedFiles = [
      ...new Set([
        ...parseNullSeparated(trackedResult.stdout),
        ...untracked,
      ]),
    ].sort();
    if (changedFiles.length === 0) {
      return ok({
        baseCommitSha: input.state.baseCommitSha,
        digest: null,
        hasChanges: false,
        patch: "",
        changedFiles: [],
      });
    }
    if (changedFiles.length > MAX_DIFF_FILES) {
      return err(new RepositoryError(
        "REPOSITORY_DIFF_REJECTED",
        `Documentation diff changes ${changedFiles.length} files; the limit is ${MAX_DIFF_FILES}.`,
      ));
    }

    const proposedFiles = await readProposedWorkspaceFiles({
      ...input,
      changedFiles,
    });
    if (proposedFiles.isErr()) return err(proposedFiles.error);
    const patch = await createWorkspacePatch({
      ...input,
      changedFiles,
      untracked,
    });
    if (patch.isErr()) return err(patch.error);

    return ok({
      baseCommitSha: input.state.baseCommitSha,
      digest: createDocumentationDiffDigest(
        input.state.baseCommitSha,
        proposedFiles.value,
      ),
      hasChanges: true,
      patch: patch.value,
      changedFiles,
    });
  })());
}

function createDocumentationDiffDigest(
  baseCommitSha: string,
  files: ProposedFile[],
): string {
  const hash = createHash("sha256");
  hash.update("paige-documentation-diff-v1\0");
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

export function writebackDocumentation(input: {
  sandbox: SandboxSession;
  repository: DocumentationRepository;
  github: GitHubRepository<DocumentationRepository>;
  abortSignal: AbortSignal;
  input: {
    digest: string;
    branch: string;
    commitMessage: string;
    pullRequestTitle: string;
    pullRequestBody: string;
  };
}): RepositoryResultAsync<DocumentationWriteback> {
  return loadDocumentationWorkspace({
    sandbox: input.sandbox,
    repository: ok(input.repository),
    abortSignal: input.abortSignal,
  }).andThen((state) =>
    new ResultAsync((async () => {
      const existingCommit = await readApprovedCommit({
        ...input,
        state,
      });
      if (existingCommit.isErr()) return err(existingCommit.error);

      let remoteBranchCommitSha: string | undefined;
      let remoteBranchWasChecked = false;
      if (existingCommit.value !== undefined) {
        const remoteBranch = await input.github.resolveBranchCommitSha(
          existingCommit.value.branch,
        );
        if (remoteBranch.isErr()) return err(remoteBranch.error);
        remoteBranchCommitSha = remoteBranch.value;
        remoteBranchWasChecked = true;
        if (
          remoteBranchCommitSha !== undefined &&
          remoteBranchCommitSha !== state.baseCommitSha
        ) {
          const published = await verifyPublishedDocumentationCommit({
            github: input.github,
            state,
            branch: existingCommit.value.branch,
            commitSha: remoteBranchCommitSha,
            digest: input.input.digest,
            message: input.input.commitMessage,
          });
          if (published.isErr()) return err(published.error);
          const existingPullRequest = await input.github.findDraftPullRequest({
            branch: existingCommit.value.branch,
            baseBranch: state.baseBranch,
            title: input.input.pullRequestTitle,
            body: input.input.pullRequestBody,
          });
          if (existingPullRequest.isErr()) {
            return err(existingPullRequest.error);
          }
          if (existingPullRequest.value !== undefined) {
            return ok({
              commit: published.value,
              pullRequest: existingPullRequest.value,
              reused: true,
            });
          }
        }
      }

      let approvedDiff: DocumentationDiff | undefined;
      if (existingCommit.value === undefined) {
        const diff = await inspectDocumentationDiff({
          sandbox: input.sandbox,
          state,
          abortSignal: input.abortSignal,
        });
        if (diff.isErr()) return err(diff.error);
        if (!diff.value.hasChanges || diff.value.digest === null) {
          return err(new RepositoryError(
            "REPOSITORY_APPROVAL_MISMATCH",
            "The approved documentation diff no longer contains changes.",
          ));
        }
        if (diff.value.digest !== input.input.digest) {
          return err(new RepositoryError(
            "REPOSITORY_APPROVAL_MISMATCH",
            "The documentation workspace no longer matches the approved diff digest.",
          ));
        }
        approvedDiff = diff.value;
      }

      const remoteBase = await input.github.resolveCommit();
      if (remoteBase.isErr()) return err(remoteBase.error);
      if (
        remoteBase.value.ref !== state.baseBranch ||
        remoteBase.value.commitSha !== state.baseCommitSha
      ) {
        return err(new RepositoryError(
          "REPOSITORY_CONFLICT",
          `The remote base ${state.baseBranch} moved after the documentation diff was prepared.`,
        ));
      }

      let commit = existingCommit.value;
      if (commit === undefined) {
        if (approvedDiff === undefined) {
          return err(new RepositoryError(
            "REPOSITORY_APPROVAL_MISMATCH",
            "The approved documentation diff is unavailable.",
          ));
        }
        const created = await createApprovedCommit({
          sandbox: input.sandbox,
          state,
          abortSignal: input.abortSignal,
          branch: input.input.branch,
          message: input.input.commitMessage,
          changedFiles: approvedDiff.changedFiles,
        });
        if (created.isErr()) return err(created.error);
        commit = created.value;
      }

      const committed = await inspectCommit({
        sandbox: input.sandbox,
        state,
        abortSignal: input.abortSignal,
        commitSha: commit.commitSha,
      });
      if (committed.isErr()) return err(committed.error);
      if (committed.value.digest !== input.input.digest) {
        return err(new RepositoryError(
          "REPOSITORY_APPROVAL_MISMATCH",
          "The committed documentation bytes do not match the approved diff digest.",
        ));
      }

      if (!remoteBranchWasChecked) {
        const remoteBranch = await input.github.resolveBranchCommitSha(
          commit.branch,
        );
        if (remoteBranch.isErr()) return err(remoteBranch.error);
        remoteBranchCommitSha = remoteBranch.value;
      }
      const published = await publishApprovedCommit({
        github: input.github,
        state,
        commit,
        remoteBranchCommitSha,
        digest: input.input.digest,
        message: input.input.commitMessage,
        files: committed.value.files,
      });
      if (published.isErr()) return err(published.error);
      const reused =
        existingCommit.value !== undefined ||
        remoteBranchCommitSha !== undefined;

      const pullRequest = await input.github.createOrReuseDraftPullRequest({
        branch: published.value.branch,
        baseBranch: state.baseBranch,
        title: input.input.pullRequestTitle,
        body: input.input.pullRequestBody,
      });
      if (pullRequest.isErr()) return err(pullRequest.error);

      return ok({
        commit: published.value,
        pullRequest: {
          number: pullRequest.value.number,
          url: pullRequest.value.url,
          draft: true as const,
        },
        reused: reused || pullRequest.value.reused,
      });
    })())
  );
}

function loadDocumentationWorkspace(input: {
  sandbox: SandboxSession;
  repository: RepositoryResult<DocumentationRepository>;
  abortSignal: AbortSignal;
}): RepositoryResultAsync<DocumentationWorkspaceState> {
  if (input.repository.isErr()) {
    return new ResultAsync(Promise.resolve(err(input.repository.error)));
  }
  const repository = input.repository.value;
  return new ResultAsync((async () => {
    const statePath = workspaceStatePath(repository);
    let contents: string;
    try {
      const stored = await input.sandbox.readTextFile({
        path: statePath,
        abortSignal: input.abortSignal,
      });
      if (stored === null) {
        return err(new RepositoryError(
          "REPOSITORY_CONFLICT",
          "Prepare the documentation workspace before using it.",
        ));
      }
      contents = stored;
    } catch (cause) {
      return err(new RepositoryError(
        "REPOSITORY_CONFLICT",
        "Prepare the documentation workspace before using it.",
        { cause },
      ));
    }
    const parsed = parseWorkspaceState(contents);
    if (parsed.isErr()) return err(parsed.error);
    const state = parsed.value;
    if (
      state.repository.id !== repository.id ||
      state.repository.owner !== repository.owner ||
      state.repository.name !== repository.name ||
      state.repository.role !== "documentation" ||
      state.path !== worktreePath(repository) ||
      state.cachePath !== repositoryCachePath(repository)
    ) {
      return err(new RepositoryError(
        "REPOSITORY_CONFLICT",
        "The documentation workspace metadata does not match the configured repository.",
      ));
    }
    const verified = await verifyWorktreeIdentity({
      sandbox: input.sandbox,
      path: state.path,
      cachePath: state.cachePath,
      repository: state.repository,
      abortSignal: input.abortSignal,
    });
    if (verified.isErr()) return err(verified.error);
    return ok(state);
  })());
}

async function createWorktree(input: {
  sandbox: SandboxSession;
  cache: RepositoryWorkspace<DocumentationRepository>;
  abortSignal: AbortSignal;
}): Promise<RepositoryResult<void>> {
  const path = worktreePath(input.cache.repository);
  const root = await run(
    input.sandbox,
    `mkdir -p ${quoteShellArgument(WORKTREE_ROOT)}`,
    input.abortSignal,
  );
  const rootOk = successfulCommand(
    root,
    "Failed to create the documentation worktree root",
  );
  if (rootOk.isErr()) return err(rootOk.error);
  const pruned = await run(
    input.sandbox,
    `git -C ${quoteShellArgument(input.cache.path)} worktree prune`,
    input.abortSignal,
  );
  const prunedOk = successfulCommand(
    pruned,
    "Failed to prune stale documentation worktrees",
  );
  if (prunedOk.isErr()) return err(prunedOk.error);
  const result = await run(
    input.sandbox,
    `git -C ${quoteShellArgument(input.cache.path)} worktree add --detach ${quoteShellArgument(path)} ${quoteShellArgument(input.cache.repository.commitSha)}`,
    input.abortSignal,
  );
  return successfulCommand(result, "Failed to create documentation worktree");
}

async function verifyWorktreeIdentity(input: {
  sandbox: SandboxSession;
  path: string;
  cachePath: string;
  repository: DocumentationRepository | ResolvedRepository<DocumentationRepository>;
  abortSignal: AbortSignal;
}): Promise<RepositoryResult<void>> {
  const [root, remote, worktreeGitDirectory, cacheGitDirectory] =
    await Promise.all([
      readCommand(
        input.sandbox,
        `git -C ${quoteShellArgument(input.path)} rev-parse --show-toplevel`,
        input.abortSignal,
        "Failed to resolve the documentation worktree root",
      ),
      readCommand(
        input.sandbox,
        `git -C ${quoteShellArgument(input.path)} remote get-url origin`,
        input.abortSignal,
        "Failed to resolve the documentation worktree origin",
      ),
      readCommand(
        input.sandbox,
        `cd ${quoteShellArgument(input.path)} && cd "$(git rev-parse --git-common-dir)" && pwd -P`,
        input.abortSignal,
        "Failed to resolve the documentation worktree Git directory",
      ),
      readCommand(
        input.sandbox,
        `cd ${quoteShellArgument(input.cachePath)} && cd "$(git rev-parse --git-common-dir)" && pwd -P`,
        input.abortSignal,
        "Failed to resolve the repository cache Git directory",
      ),
    ]);
  const combined = Result.combine([
    root,
    remote,
    worktreeGitDirectory,
    cacheGitDirectory,
  ]);
  if (combined.isErr()) {
    return err(new RepositoryError(
      "REPOSITORY_CONFLICT",
      "The documentation path is not the expected Git worktree.",
      { cause: combined.error },
    ));
  }
  const [rootValue, remoteValue, worktreeGitValue, cacheGitValue] =
    combined.value;
  if (
    rootValue !== input.path ||
    remoteValue !== githubRemoteUrl(input.repository) ||
    worktreeGitValue !== cacheGitValue
  ) {
    return err(new RepositoryError(
      "REPOSITORY_CONFLICT",
      "The documentation worktree identity does not match the configured repository cache.",
    ));
  }
  return ok(undefined);
}

async function assertEditableBase(input: {
  sandbox: SandboxSession;
  state: DocumentationWorkspaceState;
  abortSignal: AbortSignal;
}): Promise<RepositoryResult<void>> {
  const head = await readCommand(
    input.sandbox,
    `git -C ${quoteShellArgument(input.state.path)} rev-parse HEAD`,
    input.abortSignal,
    "Failed to inspect documentation workspace HEAD",
  );
  if (head.isErr()) return err(head.error);
  return head.value === input.state.baseCommitSha
    ? ok(undefined)
    : err(new RepositoryError(
        "REPOSITORY_CONFLICT",
        "The documentation workspace HEAD no longer equals its recorded base commitSha.",
      ));
}

async function assertSafeWorkspacePath(input: {
  sandbox: SandboxSession;
  state: DocumentationWorkspaceState;
  abortSignal: AbortSignal;
  path: string;
}): Promise<RepositoryResult<void>> {
  if (input.path === ".git" || input.path.startsWith(".git/")) {
    return err(new RepositoryError(
      "REPOSITORY_INVALID_INPUT",
      "Documentation edits cannot access Git internals.",
    ));
  }
  let current = input.state.path;
  for (const component of input.path.split("/")) {
    current = `${current}/${component}`;
    const symlink = await run(
      input.sandbox,
      `test -L ${quoteShellArgument(current)}`,
      input.abortSignal,
    );
    if (symlink.exitCode === 0) {
      return err(new RepositoryError(
        "REPOSITORY_DIFF_REJECTED",
        `Documentation paths cannot contain symlinks: ${input.path}`,
      ));
    }
    if (symlink.exitCode !== 1) {
      return err(new RepositoryError(
        "REPOSITORY_SANDBOX_FAILED",
        `Failed to inspect documentation path: ${input.path}`,
      ));
    }
  }
  return ok(undefined);
}

async function readRequiredWorkspaceText(input: {
  sandbox: SandboxSession;
  state: DocumentationWorkspaceState;
  abortSignal: AbortSignal;
  path: string;
}): Promise<RepositoryResult<string>> {
  const safe = await assertSafeWorkspacePath(input);
  if (safe.isErr()) return err(safe.error);
  const absolutePath = `${input.state.path}/${input.path}`;
  const regular = await run(
    input.sandbox,
    `test -f ${quoteShellArgument(absolutePath)} && test ! -L ${quoteShellArgument(absolutePath)}`,
    input.abortSignal,
  );
  if (regular.exitCode !== 0) {
    return err(new RepositoryError(
      "REPOSITORY_FILE_NOT_FOUND",
      `Documentation file does not exist: ${input.path}`,
    ));
  }
  const size = await workspaceFileSize(input);
  if (size.isErr()) return err(size.error);
  if (size.value > MAX_FILE_BYTES) {
    return err(new RepositoryError(
      "REPOSITORY_DIFF_REJECTED",
      `Documentation file is too large: ${input.path}`,
    ));
  }
  try {
    const content = await input.sandbox.readTextFile({
      path: absolutePath,
      abortSignal: input.abortSignal,
    });
    return content === null
      ? err(new RepositoryError(
          "REPOSITORY_FILE_NOT_FOUND",
          `Documentation file does not exist: ${input.path}`,
        ))
      : content.includes("\0")
      ? err(new RepositoryError(
          "REPOSITORY_DIFF_REJECTED",
          `Documentation file is binary: ${input.path}`,
        ))
      : ok(content);
  } catch (cause) {
    return err(new RepositoryError(
      "REPOSITORY_DIFF_REJECTED",
      `Documentation file is not valid UTF-8 text: ${input.path}`,
      { cause },
    ));
  }
}

async function tryReadWorkspaceText(input: {
  sandbox: SandboxSession;
  state: DocumentationWorkspaceState;
  abortSignal: AbortSignal;
  path: string;
}): Promise<RepositoryResult<string | null>> {
  const safe = await assertSafeWorkspacePath(input);
  if (safe.isErr()) {
    return safe.error.code === "REPOSITORY_DIFF_REJECTED"
      ? ok(null)
      : err(safe.error);
  }
  const size = await workspaceFileSize(input);
  if (size.isErr()) return ok(null);
  if (size.value > MAX_FILE_BYTES) return ok(null);
  try {
    const content = await input.sandbox.readTextFile({
      path: `${input.state.path}/${input.path}`,
      abortSignal: input.abortSignal,
    });
    return content === null || content.includes("\0")
      ? ok(null)
      : ok(content);
  } catch {
    return ok(null);
  }
}

async function workspaceFileSize(input: {
  sandbox: SandboxSession;
  state: DocumentationWorkspaceState;
  abortSignal: AbortSignal;
  path: string;
}): Promise<RepositoryResult<number>> {
  const result = await readCommand(
    input.sandbox,
    `wc -c < ${quoteShellArgument(`${input.state.path}/${input.path}`)}`,
    input.abortSignal,
    `Failed to inspect documentation file size: ${input.path}`,
  );
  if (result.isErr()) return err(result.error);
  const size = Number.parseInt(result.value, 10);
  return Number.isSafeInteger(size) && size >= 0
    ? ok(size)
    : err(new RepositoryError(
        "REPOSITORY_SANDBOX_FAILED",
        `Documentation file size is invalid: ${input.path}`,
      ));
}

async function readProposedWorkspaceFiles(input: {
  sandbox: SandboxSession;
  state: DocumentationWorkspaceState;
  abortSignal: AbortSignal;
  changedFiles: string[];
}): Promise<RepositoryResult<ProposedFile[]>> {
  const files: ProposedFile[] = [];
  for (const path of input.changedFiles) {
    const normalized = assertRepositoryRelativePath(path, { allowRoot: false });
    if (normalized.isErr() || normalized.value !== path) {
      return err(new RepositoryError(
        "REPOSITORY_DIFF_REJECTED",
        `Documentation diff contains an invalid path: ${path}`,
      ));
    }
    const safe = await assertSafeWorkspacePath({ ...input, path });
    if (safe.isErr()) return err(safe.error);
    const baseMode = await readCommand(
      input.sandbox,
      `git -C ${quoteShellArgument(input.state.path)} ls-tree ${quoteShellArgument(input.state.baseCommitSha)} -- ${quoteShellArgument(path)}`,
      input.abortSignal,
      `Failed to inspect the base file mode: ${path}`,
    );
    if (baseMode.isErr()) return err(baseMode.error);
    if (baseMode.value.startsWith("120000 ")) {
      return err(new RepositoryError(
        "REPOSITORY_DIFF_REJECTED",
        `Documentation diffs cannot change symlinks: ${path}`,
      ));
    }
    const binary = await run(
      input.sandbox,
      `git -C ${quoteShellArgument(input.state.path)} diff --numstat ${quoteShellArgument(input.state.baseCommitSha)} -- ${quoteShellArgument(path)}`,
      input.abortSignal,
    );
    const binaryOk = successfulCommand(
      binary,
      `Failed to inspect documentation diff type: ${path}`,
    );
    if (binaryOk.isErr()) return err(binaryOk.error);
    if (binary.stdout.startsWith("-\t-")) {
      return err(new RepositoryError(
        "REPOSITORY_DIFF_REJECTED",
        `Documentation diffs cannot include binary files: ${path}`,
      ));
    }
    const exists = await pathExists(
      input.sandbox,
      `${input.state.path}/${path}`,
      input.abortSignal,
    );
    if (!exists) {
      files.push({ path, content: null });
      continue;
    }
    const proposedBinary = await run(
      input.sandbox,
      `cd ${quoteShellArgument(input.state.path)} && git diff --no-index --numstat -- /dev/null ${quoteShellArgument(path)}`,
      input.abortSignal,
    );
    if (
      proposedBinary.exitCode !== 0 &&
      proposedBinary.exitCode !== 1
    ) {
      return err(new RepositoryError(
        "REPOSITORY_SANDBOX_FAILED",
        `Failed to inspect proposed documentation file type: ${path}`,
      ));
    }
    if (proposedBinary.stdout.startsWith("-\t-")) {
      return err(new RepositoryError(
        "REPOSITORY_DIFF_REJECTED",
        `Documentation diffs cannot include binary files: ${path}`,
      ));
    }
    const content = await readRequiredWorkspaceText({ ...input, path });
    if (content.isErr()) return err(content.error);
    files.push({ path, content: content.value });
  }
  return ok(files);
}

async function createWorkspacePatch(input: {
  sandbox: SandboxSession;
  state: DocumentationWorkspaceState;
  abortSignal: AbortSignal;
  changedFiles: string[];
  untracked: Set<string>;
}): Promise<RepositoryResult<string>> {
  const pathspec = input.changedFiles
    .map(quoteShellArgument)
    .join(" ");
  const tracked = await run(
    input.sandbox,
    `git -C ${quoteShellArgument(input.state.path)} diff --no-ext-diff --no-renames --no-color ${quoteShellArgument(input.state.baseCommitSha)} -- ${pathspec}`,
    input.abortSignal,
  );
  const trackedOk = successfulCommand(
    tracked,
    "Failed to create the documentation patch",
  );
  if (trackedOk.isErr()) return err(trackedOk.error);
  let patch = tracked.stdout;
  for (const path of [...input.untracked].sort()) {
    const untracked = await run(
      input.sandbox,
      `cd ${quoteShellArgument(input.state.path)} && git diff --no-index --no-color -- /dev/null ${quoteShellArgument(path)}`,
      input.abortSignal,
    );
    if (untracked.exitCode !== 0 && untracked.exitCode !== 1) {
      return err(new RepositoryError(
        "REPOSITORY_SANDBOX_FAILED",
        `Failed to create the patch for untracked file ${path}: ${summarizeCommandFailure(untracked)}`,
      ));
    }
    patch += untracked.stdout;
  }
  if (Buffer.byteLength(patch) > MAX_DIFF_BYTES) {
    return err(new RepositoryError(
      "REPOSITORY_DIFF_REJECTED",
      `Documentation patch exceeds the ${MAX_DIFF_BYTES}-byte review limit.`,
    ));
  }
  return ok(patch);
}

export async function createApprovedCommit(input: {
  sandbox: SandboxSession;
  state: DocumentationWorkspaceState;
  abortSignal: AbortSignal;
  branch: string;
  message: string;
  changedFiles: string[];
}): Promise<RepositoryResult<DocumentationCommit>> {
  const existingBranch = await run(
    input.sandbox,
    `git -C ${quoteShellArgument(input.state.path)} rev-parse --verify --quiet ${quoteShellArgument(`refs/heads/${input.branch}`)}`,
    input.abortSignal,
  );
  if (existingBranch.exitCode === 0) {
    if (existingBranch.stdout.trim() !== input.state.baseCommitSha) {
      return err(new RepositoryError(
        "REPOSITORY_CONFLICT",
        `Local branch ${input.branch} already points at a different commit.`,
      ));
    }
    const switched = await run(
      input.sandbox,
      `git -C ${quoteShellArgument(input.state.path)} switch ${quoteShellArgument(input.branch)}`,
      input.abortSignal,
    );
    const switchedOk = successfulCommand(
      switched,
      `Failed to reuse local branch ${input.branch}`,
    );
    if (switchedOk.isErr()) return err(switchedOk.error);
  } else if (existingBranch.exitCode === 1) {
    const created = await run(
      input.sandbox,
      `git -C ${quoteShellArgument(input.state.path)} switch -c ${quoteShellArgument(input.branch)}`,
      input.abortSignal,
    );
    const createdOk = successfulCommand(
      created,
      `Failed to create local branch ${input.branch}`,
    );
    if (createdOk.isErr()) return err(createdOk.error);
  } else {
    return err(new RepositoryError(
      "REPOSITORY_SANDBOX_FAILED",
      `Failed to inspect local branch ${input.branch}: ${summarizeCommandFailure(existingBranch)}`,
    ));
  }

  const pathspec = input.changedFiles.map(quoteShellArgument).join(" ");
  const staged = await run(
    input.sandbox,
    `git -C ${quoteShellArgument(input.state.path)} add -A -- ${pathspec}`,
    input.abortSignal,
  );
  const stagedOk = successfulCommand(
    staged,
    "Failed to stage approved documentation paths",
  );
  if (stagedOk.isErr()) return err(stagedOk.error);
  const stagedPaths = await readCommand(
    input.sandbox,
    `git -C ${quoteShellArgument(input.state.path)} diff --cached --name-only --no-renames -z ${quoteShellArgument(input.state.baseCommitSha)} --`,
    input.abortSignal,
    "Failed to verify staged documentation paths",
    { trim: false },
  );
  if (stagedPaths.isErr()) return err(stagedPaths.error);
  const actualPaths = parseNullSeparated(stagedPaths.value).sort();
  if (!sameStrings(actualPaths, [...input.changedFiles].sort())) {
    return err(new RepositoryError(
      "REPOSITORY_APPROVAL_MISMATCH",
      "Git staging did not match the exact approved documentation paths.",
    ));
  }

  const committed = await run(
    input.sandbox,
    `git -C ${quoteShellArgument(input.state.path)} -c user.name=Paige -c user.email=paige@users.noreply.github.com commit --no-gpg-sign -m ${quoteShellArgument(input.message)}`,
    input.abortSignal,
  );
  const committedOk = successfulCommand(
    committed,
    "Failed to commit approved documentation changes",
  );
  if (committedOk.isErr()) return err(committedOk.error);
  const commitSha = await readCommand(
    input.sandbox,
    `git -C ${quoteShellArgument(input.state.path)} rev-parse HEAD`,
    input.abortSignal,
    "Failed to resolve the documentation commit SHA",
  );
  return commitSha.map((value) => ({
    branch: input.branch,
    commitSha: value,
    baseCommitSha: input.state.baseCommitSha,
  }));
}

export async function readApprovedCommit(input: {
  sandbox: SandboxSession;
  state: DocumentationWorkspaceState;
  abortSignal: AbortSignal;
  input: {
    digest: string;
    branch: string;
    commitMessage: string;
  };
}): Promise<RepositoryResult<DocumentationCommit | undefined>> {
  const branch = await run(
    input.sandbox,
    `git -C ${quoteShellArgument(input.state.path)} rev-parse --verify --quiet ${quoteShellArgument(`refs/heads/${input.input.branch}`)}`,
    input.abortSignal,
  );
  if (branch.exitCode === 1) return ok(undefined);
  if (branch.exitCode !== 0) {
    return err(new RepositoryError(
      "REPOSITORY_SANDBOX_FAILED",
      `Failed to inspect local branch ${input.input.branch}: ${summarizeCommandFailure(branch)}`,
    ));
  }
  const commitSha = branch.stdout.trim();
  if (commitSha === input.state.baseCommitSha) return ok(undefined);

  const [head, status, parent, message] = await Promise.all([
    readCommand(
      input.sandbox,
      `git -C ${quoteShellArgument(input.state.path)} rev-parse HEAD`,
      input.abortSignal,
      "Failed to inspect documentation workspace HEAD",
    ),
    readCommand(
      input.sandbox,
      `git -C ${quoteShellArgument(input.state.path)} status --porcelain=v1`,
      input.abortSignal,
      "Failed to inspect documentation workspace status",
    ),
    readCommand(
      input.sandbox,
      `git -C ${quoteShellArgument(input.state.path)} rev-parse ${quoteShellArgument(`${commitSha}^`)}`,
      input.abortSignal,
      "Failed to inspect the documentation commit parent",
    ),
    readCommand(
      input.sandbox,
      `git -C ${quoteShellArgument(input.state.path)} log -1 --format=%B ${quoteShellArgument(commitSha)}`,
      input.abortSignal,
      "Failed to inspect the documentation commit message",
    ),
  ]);
  const combined = Result.combine([head, status, parent, message]);
  if (combined.isErr()) return err(combined.error);
  if (
    combined.value[0] !== commitSha ||
    combined.value[1] !== "" ||
    combined.value[2] !== input.state.baseCommitSha ||
    combined.value[3] !== input.input.commitMessage
  ) {
    return err(new RepositoryError(
      "REPOSITORY_CONFLICT",
      `Local branch ${input.input.branch} is not the approved idempotent writeback state.`,
    ));
  }
  const inspected = await inspectCommit({
    sandbox: input.sandbox,
    state: input.state,
    abortSignal: input.abortSignal,
    commitSha,
  });
  if (inspected.isErr()) return err(inspected.error);
  if (inspected.value.digest !== input.input.digest) {
    return err(new RepositoryError(
      "REPOSITORY_APPROVAL_MISMATCH",
      "The existing documentation commit does not match the approved diff digest.",
    ));
  }
  return ok({
    branch: input.input.branch,
    commitSha,
    baseCommitSha: input.state.baseCommitSha,
  });
}

async function inspectCommit(input: {
  sandbox: SandboxSession;
  state: DocumentationWorkspaceState;
  abortSignal: AbortSignal;
  commitSha: string;
}): Promise<RepositoryResult<{
  digest: string;
  files: ProposedFile[];
}>> {
  const changed = await readCommand(
    input.sandbox,
    `git -C ${quoteShellArgument(input.state.path)} diff --name-only --no-renames -z ${quoteShellArgument(input.state.baseCommitSha)} ${quoteShellArgument(input.commitSha)} --`,
    input.abortSignal,
    "Failed to inspect committed documentation paths",
    { trim: false },
  );
  if (changed.isErr()) return err(changed.error);
  const changedFiles = parseNullSeparated(changed.value).sort();
  if (changedFiles.length === 0 || changedFiles.length > MAX_DIFF_FILES) {
    return err(new RepositoryError(
      "REPOSITORY_APPROVAL_MISMATCH",
      "The existing documentation commit has an invalid changed-file set.",
    ));
  }
  const files: ProposedFile[] = [];
  for (const path of changedFiles) {
    const mode = await readCommand(
      input.sandbox,
      `git -C ${quoteShellArgument(input.state.path)} ls-tree ${quoteShellArgument(input.commitSha)} -- ${quoteShellArgument(path)}`,
      input.abortSignal,
      `Failed to inspect committed documentation mode: ${path}`,
    );
    if (mode.isErr()) return err(mode.error);
    if (mode.value.startsWith("120000 ")) {
      return err(new RepositoryError(
        "REPOSITORY_DIFF_REJECTED",
        `Documentation commits cannot include symlinks: ${path}`,
      ));
    }
    const binary = await readCommand(
      input.sandbox,
      `git -C ${quoteShellArgument(input.state.path)} diff --numstat ${quoteShellArgument(input.state.baseCommitSha)} ${quoteShellArgument(input.commitSha)} -- ${quoteShellArgument(path)}`,
      input.abortSignal,
      `Failed to inspect committed documentation type: ${path}`,
    );
    if (binary.isErr()) return err(binary.error);
    if (binary.value.startsWith("-\t-")) {
      return err(new RepositoryError(
        "REPOSITORY_DIFF_REJECTED",
        `Documentation commits cannot include binary files: ${path}`,
      ));
    }
    const object = `${input.commitSha}:${path}`;
    const exists = await run(
      input.sandbox,
      `git -C ${quoteShellArgument(input.state.path)} cat-file -e ${quoteShellArgument(object)}`,
      input.abortSignal,
    );
    if (exists.exitCode === 1 || exists.exitCode === 128) {
      files.push({ path, content: null });
      continue;
    }
    const existsOk = successfulCommand(
      exists,
      `Failed to inspect committed documentation file: ${path}`,
    );
    if (existsOk.isErr()) return err(existsOk.error);
    const size = await readCommand(
      input.sandbox,
      `git -C ${quoteShellArgument(input.state.path)} cat-file -s ${quoteShellArgument(object)}`,
      input.abortSignal,
      `Failed to inspect committed documentation size: ${path}`,
    );
    if (size.isErr()) return err(size.error);
    if (Number.parseInt(size.value, 10) > MAX_FILE_BYTES) {
      return err(new RepositoryError(
        "REPOSITORY_DIFF_REJECTED",
        `Committed documentation file is too large: ${path}`,
      ));
    }
    const content = await readCommand(
      input.sandbox,
      `git -C ${quoteShellArgument(input.state.path)} show ${quoteShellArgument(object)}`,
      input.abortSignal,
      `Failed to read committed documentation file: ${path}`,
      { trim: false },
    );
    if (content.isErr()) return err(content.error);
    files.push({ path, content: content.value });
  }
  return ok({
    digest: createDocumentationDiffDigest(input.state.baseCommitSha, files),
    files,
  });
}

async function publishApprovedCommit(input: {
  github: GitHubRepository<DocumentationRepository>;
  state: DocumentationWorkspaceState;
  commit: DocumentationCommit;
  remoteBranchCommitSha: string | undefined;
  digest: string;
  message: string;
  files: ProposedFile[];
}): Promise<RepositoryResult<DocumentationCommit>> {
  let remoteCommitSha = input.remoteBranchCommitSha;
  if (remoteCommitSha === undefined) {
    const created = await input.github.createBranch({
      branch: input.commit.branch,
      commitSha: input.state.baseCommitSha,
    });
    if (created.isErr()) {
      const raced = await input.github.resolveBranchCommitSha(
        input.commit.branch,
      );
      if (raced.isErr()) return err(raced.error);
      if (raced.value === undefined) return err(created.error);
      remoteCommitSha = raced.value;
    } else {
      remoteCommitSha = input.state.baseCommitSha;
    }
  }

  if (remoteCommitSha === input.state.baseCommitSha) {
    const created = await input.github.createCommitOnBranch({
      branch: input.commit.branch,
      expectedHeadCommitSha: input.state.baseCommitSha,
      message: input.message,
      files: input.files,
    });
    if (created.isErr()) return err(created.error);
    remoteCommitSha = created.value;
  }

  return await verifyPublishedDocumentationCommit({
    github: input.github,
    state: input.state,
    branch: input.commit.branch,
    commitSha: remoteCommitSha,
    digest: input.digest,
    message: input.message,
  });
}

async function verifyPublishedDocumentationCommit(input: {
  github: GitHubRepository<DocumentationRepository>;
  state: DocumentationWorkspaceState;
  branch: string;
  commitSha: string;
  digest: string;
  message: string;
}): Promise<RepositoryResult<DocumentationCommit>> {
  const details = await input.github.readCommitDetails(input.commitSha);
  if (details.isErr()) return err(details.error);
  if (
    details.value.parentSha !== input.state.baseCommitSha ||
    details.value.message !== input.message
  ) {
    return err(new RepositoryError(
      "REPOSITORY_CONFLICT",
      `Remote branch ${input.branch} does not contain the approved commit.`,
    ));
  }
  const files: ProposedFile[] = [];
  for (const file of details.value.files) {
    const path = assertRepositoryRelativePath(file.path, { allowRoot: false });
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
    const content = await input.github.readTextFile({
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
  if (files.length === 0 || files.length > MAX_DIFF_FILES) {
    return err(new RepositoryError(
      "REPOSITORY_CONFLICT",
      `Remote branch ${input.branch} has an invalid changed-file set.`,
    ));
  }
  if (
    createDocumentationDiffDigest(input.state.baseCommitSha, files) !==
      input.digest
  ) {
    return err(new RepositoryError(
      "REPOSITORY_CONFLICT",
      `Remote branch ${input.branch} does not match the approved documentation diff.`,
    ));
  }
  return ok({
    branch: input.branch,
    commitSha: input.commitSha,
    baseCommitSha: input.state.baseCommitSha,
  });
}

function validateWritebackInput(input: {
  digest: string;
  branch: string;
  commitMessage: string;
  pullRequestTitle: string;
  pullRequestBody: string;
}): RepositoryResult<{
  digest: string;
  branch: string;
  commitMessage: string;
  pullRequestTitle: string;
  pullRequestBody: string;
}> {
  const normalized = {
    digest: input.digest.trim(),
    branch: input.branch.trim(),
    commitMessage: input.commitMessage.trim(),
    pullRequestTitle: input.pullRequestTitle.trim(),
    pullRequestBody: input.pullRequestBody.trim(),
  };
  if (!/^sha256:[a-f0-9]{64}$/.test(normalized.digest)) {
    return err(new RepositoryError(
      "REPOSITORY_INVALID_INPUT",
      "Use the exact sha256 documentation diff digest returned by inspect_diff.",
    ));
  }
  if (
    !/^paige\/[a-z0-9][a-z0-9._/-]*[a-z0-9]$/.test(normalized.branch) ||
    normalized.branch.includes("..") ||
    normalized.branch.includes("//") ||
    normalized.branch.length > 120
  ) {
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
      "Approved commit and pull request metadata is missing, too large, or the commit message is not single-line.",
    ));
  }
  return ok(normalized);
}

function parseWorkspaceState(
  value: string,
): RepositoryResult<DocumentationWorkspaceState> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (cause) {
    return err(new RepositoryError(
      "REPOSITORY_CONFLICT",
      "The documentation workspace metadata is invalid.",
      { cause },
    ));
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { version?: unknown }).version !== 1
  ) {
    return err(new RepositoryError(
      "REPOSITORY_CONFLICT",
      "The documentation workspace metadata is invalid.",
    ));
  }
  const state = parsed as Partial<DocumentationWorkspaceState>;
  const repository = state.repository;
  if (
    typeof state.path !== "string" ||
    typeof state.cachePath !== "string" ||
    typeof state.baseBranch !== "string" ||
    typeof state.baseCommitSha !== "string" ||
    typeof repository !== "object" ||
    repository === null ||
    repository.role !== "documentation" ||
    typeof repository.id !== "string" ||
    typeof repository.owner !== "string" ||
    typeof repository.name !== "string" ||
    typeof repository.isPrivate !== "boolean" ||
    typeof repository.ref !== "string" ||
    typeof repository.commitSha !== "string"
  ) {
    return err(new RepositoryError(
      "REPOSITORY_CONFLICT",
      "The documentation workspace metadata is incomplete.",
    ));
  }
  return ok(state as DocumentationWorkspaceState);
}

function toDocumentationWorkspace(
  state: DocumentationWorkspaceState,
): DocumentationWorkspace {
  return {
    path: state.path,
    repository: state.repository,
    baseBranch: state.baseBranch,
    baseCommitSha: state.baseCommitSha,
  };
}

function worktreePath(repository: DocumentationRepository): string {
  return `${WORKTREE_ROOT}/${repository.id}`;
}

function workspaceStatePath(repository: DocumentationRepository): string {
  return `${WORKTREE_ROOT}/.${repository.id}.json`;
}

function repositoryCachePath(repository: DocumentationRepository): string {
  return `/workspace/repositories/${repository.id}`;
}

function githubRemoteUrl(repository: RepositoryConfig): string {
  return `https://github.com/${repository.owner}/${repository.name}.git`;
}

async function pathExists(
  sandbox: SandboxSession,
  path: string,
  abortSignal: AbortSignal,
): Promise<boolean> {
  const result = await run(
    sandbox,
    `test -e ${quoteShellArgument(path)}`,
    abortSignal,
  );
  return result.exitCode === 0;
}

async function readCommand(
  sandbox: SandboxSession,
  command: string,
  abortSignal: AbortSignal,
  message: string,
  options: { trim?: boolean } = {},
): Promise<RepositoryResult<string>> {
  const result = await run(sandbox, command, abortSignal);
  const successful = successfulCommand(result, message);
  if (successful.isErr()) return err(successful.error);
  return ok(options.trim === false ? result.stdout : result.stdout.trim());
}

async function run(
  sandbox: SandboxSession,
  command: string,
  abortSignal: AbortSignal,
): Promise<SandboxCommandResult> {
  return await sandbox.run({ command, abortSignal });
}

function successfulCommand(
  result: SandboxCommandResult,
  message: string,
): RepositoryResult<void> {
  if (result.exitCode !== 0) {
    return err(new RepositoryError(
      "REPOSITORY_SANDBOX_FAILED",
      `${message}: ${summarizeCommandFailure(result)}`,
    ));
  }
  return ok(undefined);
}

function summarizeCommandFailure(result: SandboxCommandResult): string {
  return (
    result.stderr.trim() ||
    result.stdout.trim() ||
    `command exited with ${result.exitCode}`
  ).slice(0, 1_000);
}

function parseNullSeparated(value: string): string[] {
  return value.split("\0").filter(Boolean);
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function quoteShellArgument(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
