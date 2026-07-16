import type {
  SandboxCommandResult,
  SandboxSession,
} from "eve/sandbox";
import { err, ok, ResultAsync } from "neverthrow";

import { RepositoryError } from "./shared/errors";
import type {
  RepositoryResult,
  RepositoryResultAsync,
} from "./shared/errors";
import type {
  RepositoryConfig,
  RepositoryWorkspace,
  ResolvedRepository,
} from "./types";

const REPOSITORY_PATH_PREFIX = "/workspace/repositories";

/**
 * Ensures the requested immutable revisions exist in one cached shallow Git
 * repository. No working tree checkout is required for read operations.
 */
export function ensureRepositoryRevisions<
  TRepository extends RepositoryConfig,
>(input: {
  sandbox: SandboxSession;
  repository: TRepository;
  revisions: ResolvedRepository<TRepository>[];
  token: string;
  abortSignal: AbortSignal;
}): RepositoryResultAsync<RepositoryWorkspace<TRepository>[]> {
  return new ResultAsync((async () => {
    if (input.revisions.length === 0) {
      return err(new RepositoryError(
        "REPOSITORY_INVALID_INPUT",
        "At least one repository revision is required.",
      ));
    }
    const path = `${REPOSITORY_PATH_PREFIX}/${input.repository.id}`;
    const remoteUrl = githubRemoteUrl(input.repository);
    const initialized = await ensureRepositoryInitialized({
      sandbox: input.sandbox,
      path,
      remoteUrl,
      abortSignal: input.abortSignal,
    });
    if (initialized.isErr()) return err(initialized.error);

    const missing: ResolvedRepository<TRepository>[] = [];
    for (const revision of input.revisions) {
      const present = await hasCommit(
        input.sandbox,
        path,
        revision.resolvedRevision,
        input.abortSignal,
      );
      if (!present) missing.push(revision);
    }

    if (missing.length > 0) {
      try {
        await input.sandbox.setNetworkPolicy(
          githubFetchNetworkPolicy({
            token: input.token,
            authenticated: input.revisions[0].isPrivate,
          }),
        );
        for (const revision of missing) {
          const fetchResult = await run(
            input.sandbox,
            `cd ${quoteShellArgument(path)} && GIT_TERMINAL_PROMPT=0 git fetch --depth=1 --no-tags origin ${quoteShellArgument(revision.resolvedRevision)}`,
            input.abortSignal,
          );
          const fetched = successfulCommand(
            fetchResult,
            `Failed to fetch repository ${input.repository.id} revision ${revision.ref}`,
          );
          if (fetched.isErr()) return err(fetched.error);
        }
      } finally {
        await input.sandbox.setNetworkPolicy("deny-all");
      }
    }

    for (const revision of input.revisions) {
      if (
        !(await hasCommit(
          input.sandbox,
          path,
          revision.resolvedRevision,
          input.abortSignal,
        ))
      ) {
        return err(new RepositoryError(
          "REPOSITORY_SANDBOX_FAILED",
          `Fetched repository ${input.repository.id} did not contain revision ${revision.resolvedRevision}.`,
        ));
      }
    }

    return ok(input.revisions.map((repository) => ({ path, repository })));
  })());
}

/**
 * Checks out one resolved revision for the future documentation authoring
 * workflow. Existing uncommitted changes are never discarded.
 */
export function checkoutRepositoryRevision<
  TRepository extends RepositoryConfig,
>(input: {
  sandbox: SandboxSession;
  workspace: RepositoryWorkspace<TRepository>;
  abortSignal: AbortSignal;
}): RepositoryResultAsync<RepositoryWorkspace<TRepository>> {
  return new ResultAsync((async () => {
    const statusResult = await run(
      input.sandbox,
      `cd ${quoteShellArgument(input.workspace.path)} && git status --porcelain`,
      input.abortSignal,
    );
    const status = successfulCommand(
      statusResult,
      `Failed to inspect repository ${input.workspace.repository.id} status`,
    );
    if (status.isErr()) return err(status.error);
    if (statusResult.stdout.trim() !== "") {
      return err(new RepositoryError(
        "REPOSITORY_DIRTY_WORKSPACE",
        `Repository workspace has uncommitted changes: ${input.workspace.repository.id}`,
      ));
    }

    const checkoutResult = await run(
      input.sandbox,
      `cd ${quoteShellArgument(input.workspace.path)} && git checkout --detach ${quoteShellArgument(input.workspace.repository.resolvedRevision)}`,
      input.abortSignal,
    );
    const checkedOut = successfulCommand(
      checkoutResult,
      `Failed to check out repository ${input.workspace.repository.id}`,
    );
    if (checkedOut.isErr()) return err(checkedOut.error);

    return ok(input.workspace);
  })());
}

function githubRemoteUrl(repository: RepositoryConfig): string {
  return `https://github.com/${repository.owner}/${repository.name}.git`;
}

async function ensureRepositoryInitialized(input: {
  sandbox: SandboxSession;
  path: string;
  remoteUrl: string;
  abortSignal: AbortSignal;
}): Promise<RepositoryResult<void>> {
  const gitDirectory = await run(
    input.sandbox,
    `test -d ${quoteShellArgument(`${input.path}/.git`)}`,
    input.abortSignal,
  );
  if (gitDirectory.exitCode === 0) {
    const remoteResult = await run(
      input.sandbox,
      `cd ${quoteShellArgument(input.path)} && git remote get-url origin`,
      input.abortSignal,
    );
    const remote = successfulCommand(
      remoteResult,
      "Failed to inspect repository origin",
    );
    if (remote.isErr()) return err(remote.error);
    if (remoteResult.stdout.trim() === input.remoteUrl) return ok(undefined);

    const statusResult = await run(
      input.sandbox,
      `cd ${quoteShellArgument(input.path)} && git status --porcelain`,
      input.abortSignal,
    );
    const status = successfulCommand(
      statusResult,
      "Failed to inspect repository status",
    );
    if (status.isErr()) return err(status.error);
    if (statusResult.stdout.trim() !== "") {
      return err(new RepositoryError(
        "REPOSITORY_DIRTY_WORKSPACE",
        `Refusing to replace a repository workspace with uncommitted changes: ${input.path}`,
      ));
    }
    await input.sandbox.removePath({
      path: input.path,
      force: true,
      recursive: true,
      abortSignal: input.abortSignal,
    });
  } else {
    await input.sandbox.removePath({
      path: input.path,
      force: true,
      recursive: true,
      abortSignal: input.abortSignal,
    });
  }

  const initializeResult = await run(
    input.sandbox,
    `mkdir -p ${quoteShellArgument(input.path)} && cd ${quoteShellArgument(input.path)} && git init && git remote add origin ${quoteShellArgument(input.remoteUrl)}`,
    input.abortSignal,
  );
  return successfulCommand(
    initializeResult,
    `Failed to initialize repository workspace ${input.path}`,
  );
}

async function hasCommit(
  sandbox: SandboxSession,
  path: string,
  revision: string,
  abortSignal: AbortSignal,
): Promise<boolean> {
  const result = await run(
    sandbox,
    `cd ${quoteShellArgument(path)} && git cat-file -e ${quoteShellArgument(`${revision}^{commit}`)}`,
    abortSignal,
  );
  return result.exitCode === 0;
}

function githubFetchNetworkPolicy(input: {
  token: string;
  authenticated: boolean;
}) {
  const rules = input.authenticated
    ? [
        {
          transform: [
            {
              headers: {
                Authorization: `Basic ${Buffer.from(
                  `x-access-token:${input.token}`,
                ).toString("base64")}`,
              },
            },
          ],
        },
      ]
    : [];
  return {
    allow: {
      "github.com": rules,
      "codeload.github.com": rules,
    },
  };
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

function quoteShellArgument(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
