import type { SandboxSession } from "eve/sandbox";
import type { ToolContext } from "eve/tools";
import { err, ok, Result, ResultAsync } from "neverthrow";

import {
  catalogRepositories,
  repositories,
  resolveConfiguredRepository,
} from "./config";
import { ensureRepositoryRevisions } from "./git";
import {
  assertRepositoryRelativePath,
  assertSearchQuery,
  compareRepositoryRevisions,
  listRepositoryFiles,
  readRepositoryFile,
  searchRepository,
} from "./inspection";
import type { RepositoryResultAsync } from "./shared/errors";
import { resolveGitHubRevision, resolveGitHubToken } from "./shared/github";
import { serializeSandbox } from "./shared/serialization";
import type {
  RepositoryConfig,
  RepositoryWorkspace,
  ResolvedRepository,
} from "./types";

interface RepositoryServiceOptions {
  repositories?: RepositoryConfig[];
  getGitHubToken?: () => RepositoryResultAsync<string>;
}

export class RepositoryService {
  readonly #ctx: ToolContext;
  readonly #repositories: RepositoryConfig[];
  readonly #getGitHubToken: () => RepositoryResultAsync<string>;

  constructor(
    ctx: ToolContext,
    options: RepositoryServiceOptions = {},
  ) {
    this.#ctx = ctx;
    this.#repositories = options.repositories ?? repositories;
    this.#getGitHubToken =
      options.getGitHubToken ?? resolveGitHubToken;
  }

  /** Describes the fixed repository catalog without acquiring a sandbox. */
  catalog(): RepositoryConfig[] {
    return catalogRepositories(this.#repositories);
  }

  listFiles(input: {
    repositoryId: string;
    revision?: string;
    pathPrefix: string;
    limit: number;
  }) {
    return Result.combine([
      assertRepositoryRelativePath(input.pathPrefix, { allowRoot: true }),
      resolveConfiguredRepository(this.#repositories, input.repositoryId),
    ]).asyncAndThen(([pathPrefix, repository]) =>
      this.#inspect(repository, input.revision, (sandbox, workspace) =>
        listRepositoryFiles({
          sandbox,
          workspace,
          abortSignal: this.#ctx.abortSignal,
          pathPrefix,
          limit: input.limit,
        }),
      ),
    );
  }

  search(input: {
    repositoryId: string;
    revision?: string;
    query: string;
    pathPrefix: string;
    limit: number;
  }) {
    return Result.combine([
      assertSearchQuery(input.query),
      assertRepositoryRelativePath(input.pathPrefix, { allowRoot: true }),
      resolveConfiguredRepository(this.#repositories, input.repositoryId),
    ]).asyncAndThen(([query, pathPrefix, repository]) =>
      this.#inspect(repository, input.revision, (sandbox, workspace) =>
        searchRepository({
          sandbox,
          workspace,
          abortSignal: this.#ctx.abortSignal,
          query,
          pathPrefix,
          limit: input.limit,
        }),
      ),
    );
  }

  read(input: {
    repositoryId: string;
    revision?: string;
    path: string;
    startLine: number;
    endLine?: number;
    maxCharacters: number;
  }) {
    return Result.combine([
      assertRepositoryRelativePath(input.path, { allowRoot: false }),
      resolveConfiguredRepository(this.#repositories, input.repositoryId),
    ]).asyncAndThen(([path, repository]) =>
      this.#inspect(repository, input.revision, (sandbox, workspace) =>
        readRepositoryFile({
          sandbox,
          workspace,
          abortSignal: this.#ctx.abortSignal,
          path,
          startLine: input.startLine,
          endLine: input.endLine,
          maxCharacters: input.maxCharacters,
        }),
      ),
    );
  }

  compare(input: {
    repositoryId: string;
    baseRevision: string;
    headRevision: string;
    pathPrefix: string;
    limit: number;
  }) {
    return Result.combine([
      assertRepositoryRelativePath(input.pathPrefix, { allowRoot: true }),
      resolveConfiguredRepository(this.#repositories, input.repositoryId),
    ]).asyncAndThen(([pathPrefix, repository]) =>
      this.#resolve(repository, [input.baseRevision, input.headRevision])
        .andThen(({ token, revisions }) =>
          this.#withSandbox(repository, revisions, token, (
            sandbox,
            workspaces,
          ) =>
            compareRepositoryRevisions({
              sandbox,
              baseWorkspace: workspaces[0],
              headWorkspace: workspaces[1],
              abortSignal: this.#ctx.abortSignal,
              pathPrefix,
              limit: input.limit,
            })
          )
        ),
    );
  }

  #inspect<T>(
    repository: RepositoryConfig,
    revision: string | undefined,
    operation: (
      sandbox: SandboxSession,
      workspace: RepositoryWorkspace,
    ) => RepositoryResultAsync<T>,
  ): RepositoryResultAsync<T> {
    return this.#resolve(repository, [revision])
      .andThen(({ token, revisions }) =>
        this.#withSandbox(
          repository,
          revisions,
          token,
          (sandbox, workspaces) => operation(sandbox, workspaces[0]),
        )
      );
  }

  #resolve(
    repository: RepositoryConfig,
    refs: Array<string | undefined>,
  ): RepositoryResultAsync<{
    token: string;
    revisions: ResolvedRepository[];
  }> {
    return this.#getGitHubToken().andThen((token) =>
      new ResultAsync((async () => {
        const results = await Promise.all(
          refs.map(async (ref) =>
            await resolveGitHubRevision(
              repository,
              token,
              this.#ctx.abortSignal,
              ref,
            )
          ),
        );
        const combined = Result.combine(results);
        if (combined.isErr()) return err(combined.error);
        return ok({
          token,
          revisions: combined.value,
        });
      })())
    );
  }

  #withSandbox<T>(
    repository: RepositoryConfig,
    revisions: ResolvedRepository[],
    token: string,
    operation: (
      sandbox: SandboxSession,
      workspaces: RepositoryWorkspace[],
    ) => RepositoryResultAsync<T>,
  ): RepositoryResultAsync<T> {
    return new ResultAsync(
      this.#ctx.getSandbox().then((sandbox) => ok(sandbox)),
    ).andThen((sandbox) =>
      serializeSandbox(sandbox.id, () =>
        ensureRepositoryRevisions({
          sandbox,
          repository,
          revisions,
          token,
          abortSignal: this.#ctx.abortSignal,
        }).andThen((workspaces) => operation(sandbox, workspaces)),
      ),
    );
  }
}
