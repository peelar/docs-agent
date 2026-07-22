import type { SandboxSession } from "eve/sandbox";
import type { ToolContext } from "eve/tools";
import { err, ok, Result, ResultAsync } from "neverthrow";

import {
  assertDocumentationRepository,
} from "@paige/repositories/config";
import { resolveRepositoryCatalog } from "@paige/repositories/configuration/resolver";
import {
  assertRepositoryRelativePath,
  assertSearchQuery,
} from "../files";
import { SandboxGit } from "../git";
import type { RepositoryResultAsync } from "@paige/repositories/errors";
import { RepositoryError } from "@paige/repositories/errors";
import {
  createGitHubRequest,
  resolveGitHubToken,
} from "@paige/repositories/github";
import { serializeSandbox } from "../shared/serialization";
import type {
  DocumentationRepository,
  RepositoryConfig,
} from "@paige/repositories/types";
import { DocumentationEditor } from "./editor";
import { GitHubPublisher } from "./github-publisher";
import {
  DocumentationPublisher,
  validatePublishInput,
} from "./publish";
import type { PublishInput } from "./publish";
import { DocumentationWorkspace } from "./workspace";

interface DocumentationActionsOptions {
  repositories?: RepositoryConfig[];
  getGitHubToken?: (
    repository: RepositoryConfig,
  ) => RepositoryResultAsync<string>;
}

export class DocumentationActions {
  readonly #ctx: ToolContext;
  readonly #repositories?: RepositoryConfig[];
  readonly #getGitHubToken: (
    repository: RepositoryConfig,
  ) => RepositoryResultAsync<string>;

  constructor(
    ctx: ToolContext,
    options: DocumentationActionsOptions = {},
  ) {
    this.#ctx = ctx;
    this.#repositories = options.repositories;
    this.#getGitHubToken =
      options.getGitHubToken ?? resolveGitHubToken;
  }

  open() {
    return this.#documentationRepository().andThen((repository) =>
      this.#getGitHubToken(repository).andThen((token) =>
        this.#github(repository, token).resolveCommit().andThen((resolved) =>
          this.#withSandbox((sandbox) =>
            new SandboxGit(sandbox).ensureCommits({
              repository,
              commits: [resolved],
              token,
            }).andThen(([cache]) =>
              new DocumentationWorkspace({
                sandbox,
                abortSignal: this.#ctx.abortSignal,
              }).open(cache)
            )
          )
        )
      )
    );
  }

  listFiles(input: { pathPrefix: string; limit: number }) {
    return assertRepositoryRelativePath(
      input.pathPrefix,
      { allowRoot: true },
    ).asyncAndThen((pathPrefix) =>
      this.#withOpenEditor((editor) =>
        editor.listFiles({ pathPrefix, limit: input.limit })
      )
    );
  }

  search(input: {
    query: string;
    pathPrefix: string;
    limit: number;
  }) {
    return Result.combine([
      assertSearchQuery(input.query),
      assertRepositoryRelativePath(input.pathPrefix, { allowRoot: true }),
    ]).asyncAndThen(([query, pathPrefix]) =>
      this.#withOpenEditor((editor) =>
        editor.search({
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
      this.#withOpenEditor((editor) =>
        editor.read({
          path,
          startLine: input.startLine,
          endLine: input.endLine,
          maxCharacters: input.maxCharacters,
        })
      )
    );
  }

  write(input: { path: string; content: string }) {
    return assertRepositoryRelativePath(
      input.path,
      { allowRoot: false },
    ).asyncAndThen((path) =>
      this.#withOpenEditor((editor) =>
        editor.write({ path, content: input.content })
      )
    );
  }

  remove(input: { path: string }) {
    return assertRepositoryRelativePath(
      input.path,
      { allowRoot: false },
    ).asyncAndThen((path) =>
      this.#withOpenEditor((editor) => editor.remove({ path }))
    );
  }

  review() {
    return this.#withOpenEditor((editor) => editor.review());
  }

  publish(input: PublishInput) {
    const normalized = validatePublishInput(input);
    if (normalized.isErr()) {
      return new ResultAsync(Promise.resolve(err(normalized.error)));
    }
    return this.#documentationRepository().andThen((repository) =>
      this.#getGitHubToken(repository).andThen((token) =>
        this.#withSandbox((sandbox) => {
          const workspace = new DocumentationWorkspace({
            sandbox,
            abortSignal: this.#ctx.abortSignal,
          });
          return workspace.reopen(repository).andThen((record) =>
            new ResultAsync(
              new DocumentationPublisher({
                sandbox,
                record,
                abortSignal: this.#ctx.abortSignal,
                github: this.#github(repository, token),
              }).publish(normalized.value),
            )
          );
        })
      )
    );
  }

  #withOpenEditor<T>(
    operation: (editor: DocumentationEditor) => RepositoryResultAsync<T>,
  ): RepositoryResultAsync<T> {
    return this.#documentationRepository().andThen((repository) =>
      this.#withSandbox((sandbox) => {
        const workspace = new DocumentationWorkspace({
          sandbox,
          abortSignal: this.#ctx.abortSignal,
        });
        return workspace.reopen(repository).andThen((record) =>
          operation(new DocumentationEditor({
            sandbox,
            record,
            abortSignal: this.#ctx.abortSignal,
          }))
        );
      })
    );
  }

  #documentationRepository(): RepositoryResultAsync<DocumentationRepository> {
    const catalog = this.#repositories === undefined
      ? resolveRepositoryCatalog()
      : new ResultAsync(Promise.resolve(ok(this.#repositories)));
    return catalog.andThen((repositories) => {
      const candidates = repositories.filter(
        (repository) => repository.role === "documentation",
      );
      if (candidates.length !== 1) {
        return err(new RepositoryError(
          "REPOSITORY_NOT_CONFIGURED",
          "Configure exactly one documentation repository.",
        ));
      }
      return assertDocumentationRepository(candidates[0]);
    });
  }

  #github(
    repository: DocumentationRepository,
    token: string,
  ): GitHubPublisher {
    return new GitHubPublisher(
      repository,
      createGitHubRequest({
        token,
        abortSignal: this.#ctx.abortSignal,
      }),
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
