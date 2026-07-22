import type { SandboxCommandResult, SandboxSession } from "eve/sandbox";
import { err, ok, ResultAsync } from "neverthrow";

import { RepositoryError } from "@paige/repositories/errors";
import type {
  RepositoryResult,
  RepositoryResultAsync,
} from "@paige/repositories/errors";
import type {
  RepositoryComparison,
  RepositorySearchMatch,
  RepositoryWorkspace,
} from "@paige/repositories/types";

const MAX_READ_FILE_BYTES = 1_000_000;
const MAX_READ_LINES = 400;
const MAX_READ_CHARACTERS = 24_000;
const MAX_SEARCH_EXCERPT_CHARACTERS = 500;

/** Provides bounded, read-only access to repository files at one commit. */
export class RepositoryFiles {
  readonly #sandbox: SandboxSession;
  readonly #workspace: RepositoryWorkspace;

  constructor(sandbox: SandboxSession, workspace: RepositoryWorkspace) {
    this.#sandbox = sandbox;
    this.#workspace = workspace;
  }

  list(input: {
    pathPrefix: string;
    limit: number;
  }): RepositoryResultAsync<{
    repository: RepositoryWorkspace["repository"];
    files: string[];
    truncated: boolean;
  }> {
    return new ResultAsync((async () => {
      const pathspec = input.pathPrefix === "."
        ? ""
        : ` -- ${quoteShellArgument(input.pathPrefix)}`;
      const result = await this.#run(
        `cd ${quoteShellArgument(this.#workspace.path)} && git ls-tree -r --name-only -z ${quoteShellArgument(this.#workspace.repository.commitSha)}${pathspec} | head -z -n ${input.limit + 1}`,
      );
      const successful = successfulOutput(
        result,
        "Repository file listing failed",
      );
      if (successful.isErr()) return err(successful.error);
      const files = parseNullSeparated(result.stdout);

      return ok({
        repository: this.#workspace.repository,
        files: files.slice(0, input.limit),
        truncated: files.length > input.limit,
      });
    })());
  }

  /** Searches tracked content at this commit. */
  search(input: {
    query: string;
    pathPrefix: string;
    limit: number;
  }): RepositoryResultAsync<{
    repository: RepositoryWorkspace["repository"];
    matches: RepositorySearchMatch[];
    truncated: boolean;
  }> {
    return new ResultAsync((async () => {
      const pathspec = input.pathPrefix === "."
        ? ""
        : ` -- ${quoteShellArgument(input.pathPrefix)}`;
      const result = await this.#run(
        `cd ${quoteShellArgument(this.#workspace.path)} && git grep -n -z --full-name --fixed-strings -- ${quoteShellArgument(input.query)} ${quoteShellArgument(this.#workspace.repository.commitSha)}${pathspec} | head -n ${input.limit + 1} | cut -c 1-1000`,
      );
      const successful = successfulOutput(result, "Repository search failed");
      if (successful.isErr()) return err(successful.error);
      const matches = result.stdout
        .split("\n")
        .filter(Boolean)
        .map(parseSearchMatch)
        .filter((match): match is Omit<RepositorySearchMatch, "sourceUrl"> =>
          match !== null
        )
        .map((match): RepositorySearchMatch => ({
          ...match,
          sourceUrl: repositoryFileSourceUrl(
            this.#workspace.repository,
            match.path,
            { startLine: match.line, endLine: match.line },
          ),
        }));

      return ok({
        repository: this.#workspace.repository,
        matches: matches.slice(0, input.limit),
        truncated: matches.length > input.limit,
      });
    })());
  }

  /** Reads one tracked file and returns bounded lines plus its blob SHA. */
  read(input: {
    path: string;
    startLine: number;
    endLine?: number;
    maxCharacters: number;
  }): RepositoryResultAsync<{
    repository: RepositoryWorkspace["repository"];
    path: string;
    sourceUrl: string;
    blobSha: string;
    startLine: number;
    endLine: number;
    content: string;
    truncated: boolean;
  }> {
    return new ResultAsync((async () => {
      const object = `${this.#workspace.repository.commitSha}:${input.path}`;
      const typeResult = await this.#run(
        `cd ${quoteShellArgument(this.#workspace.path)} && git cat-file -t ${quoteShellArgument(object)}`,
      );
      if (typeResult.exitCode !== 0 || typeResult.stdout.trim() !== "blob") {
        return err(new RepositoryError(
          "REPOSITORY_FILE_NOT_FOUND",
          `Repository file does not exist: ${input.path}`,
        ));
      }

      const sizeResult = await this.#run(
        `cd ${quoteShellArgument(this.#workspace.path)} && git cat-file -s ${quoteShellArgument(object)}`,
      );
      const sizeSuccessful = successfulCommand(
        sizeResult,
        "Repository file size lookup failed",
      );
      if (sizeSuccessful.isErr()) return err(sizeSuccessful.error);
      const size = Number.parseInt(sizeResult.stdout.trim(), 10);
      if (!Number.isSafeInteger(size) || size < 0) {
        return err(new RepositoryError(
          "REPOSITORY_SANDBOX_FAILED",
          `Repository file size is invalid: ${input.path}`,
        ));
      }
      if (size > MAX_READ_FILE_BYTES) {
        return err(new RepositoryError(
          "REPOSITORY_INVALID_INPUT",
          `Repository file is too large to read: ${input.path}`,
        ));
      }

      const [contentResult, hashResult] = await Promise.all([
        this.#run(
          `cd ${quoteShellArgument(this.#workspace.path)} && git show ${quoteShellArgument(object)}`,
        ),
        this.#run(
          `cd ${quoteShellArgument(this.#workspace.path)} && git rev-parse ${quoteShellArgument(object)}`,
        ),
      ]);
      const contentSuccessful = successfulCommand(
        contentResult,
        "Repository file read failed",
      );
      if (contentSuccessful.isErr()) return err(contentSuccessful.error);
      const hashSuccessful = successfulCommand(
        hashResult,
        "Repository file hash lookup failed",
      );
      if (hashSuccessful.isErr()) return err(hashSuccessful.error);

      const selection = selectFileLines(contentResult.stdout, {
        startLine: input.startLine,
        endLine: input.endLine,
        maxCharacters: input.maxCharacters,
      });
      if (selection.isErr()) return err(selection.error);

      return ok({
        repository: this.#workspace.repository,
        path: input.path,
        sourceUrl: repositoryFileSourceUrl(
          this.#workspace.repository,
          input.path,
          selection.value,
        ),
        blobSha: hashResult.stdout.trim(),
        ...selection.value,
      });
    })());
  }

  /** Lists paths changed from another already-fetched commit. */
  compareWith(
    baseWorkspace: RepositoryWorkspace,
    input: {
      pathPrefix: string;
      limit: number;
    },
  ): RepositoryResultAsync<RepositoryComparison> {
    return new ResultAsync((async () => {
      const pathspec = input.pathPrefix === "."
        ? ""
        : ` -- ${quoteShellArgument(input.pathPrefix)}`;
      const result = await this.#run(
        `cd ${quoteShellArgument(this.#workspace.path)} && git diff --name-only -z ${quoteShellArgument(baseWorkspace.repository.commitSha)} ${quoteShellArgument(this.#workspace.repository.commitSha)}${pathspec} | head -z -n ${input.limit + 1}`,
      );
      const successful = successfulOutput(
        result,
        "Repository comparison failed",
      );
      if (successful.isErr()) return err(successful.error);
      const changedFiles = parseNullSeparated(result.stdout);

      return ok({
        repositoryId: this.#workspace.repository.id,
        baseCommitSha: baseWorkspace.repository.commitSha,
        headCommitSha: this.#workspace.repository.commitSha,
        changedFiles: changedFiles.slice(0, input.limit),
        truncated: changedFiles.length > input.limit,
      });
    })());
  }

  async #run(command: string): Promise<SandboxCommandResult> {
    return await this.#sandbox.run({ command });
  }
}

/** Normalizes a path while preventing absolute paths and parent traversal. */
export function assertRepositoryRelativePath(
  value: string,
  options: { allowRoot: boolean },
): RepositoryResult<string> {
  const path = value.trim();
  if (options.allowRoot && (path === "." || path === "/")) return ok(".");
  if (
    path === "" ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.includes("\n") ||
    path.includes("\r") ||
    path.split("/").includes("..") ||
    path === "."
  ) {
    return err(new RepositoryError(
      "REPOSITORY_INVALID_INPUT",
      `Use a repository-relative path: ${value}`,
    ));
  }
  return ok(path.replace(/^\.\//, "") || ".");
}

/** Selects a bounded, 1-based line range and records omitted content. */
export function selectFileLines(
  content: string,
  input: { startLine: number; endLine?: number; maxCharacters?: number },
): RepositoryResult<{
  startLine: number;
  endLine: number;
  content: string;
  truncated: boolean;
}> {
  const lines = content.split("\n");
  if (input.startLine > lines.length) {
    return err(new RepositoryError(
      "REPOSITORY_INVALID_INPUT",
      `Start line ${input.startLine} is past the end of the file.`,
    ));
  }
  const requestedEndLine = input.endLine ?? input.startLine + MAX_READ_LINES - 1;
  if (requestedEndLine < input.startLine) {
    return err(new RepositoryError(
      "REPOSITORY_INVALID_INPUT",
      "End line must be greater than or equal to start line.",
    ));
  }
  if (requestedEndLine - input.startLine + 1 > MAX_READ_LINES) {
    return err(new RepositoryError(
      "REPOSITORY_INVALID_INPUT",
      `Read at most ${MAX_READ_LINES} lines at a time.`,
    ));
  }

  const endLine = Math.min(requestedEndLine, lines.length);
  const selected = lines.slice(input.startLine - 1, endLine).join("\n");
  const maxCharacters = input.maxCharacters ?? MAX_READ_CHARACTERS;
  const characterTruncated = selected.length > maxCharacters;

  return ok({
    startLine: input.startLine,
    endLine,
    content: characterTruncated ? selected.slice(0, maxCharacters) : selected,
    truncated:
      input.startLine > 1 || endLine < lines.length || characterTruncated,
  });
}

/** Normalizes a literal search query and rejects multiline command input. */
export function assertSearchQuery(value: string): RepositoryResult<string> {
  const query = value.trim();
  if (
    query === "" ||
    query.includes("\0") ||
    query.includes("\n") ||
    query.includes("\r")
  ) {
    return err(new RepositoryError(
      "REPOSITORY_INVALID_INPUT",
      "Use a non-empty, single-line repository search query.",
    ));
  }
  return ok(query);
}

function parseSearchMatch(
  value: string,
): Omit<RepositorySearchMatch, "sourceUrl"> | null {
  const [location, lineValue, excerpt] = value.split("\0", 3);
  if (
    location === undefined ||
    lineValue === undefined ||
    excerpt === undefined
  ) {
    return null;
  }
  const separator = location.indexOf(":");
  const line = Number.parseInt(lineValue, 10);
  if (separator === -1 || !Number.isSafeInteger(line) || line < 1) return null;
  return {
    path: location.slice(separator + 1),
    line,
    excerpt: excerpt.slice(0, MAX_SEARCH_EXCERPT_CHARACTERS),
  };
}

function repositoryFileSourceUrl(
  repository: RepositoryWorkspace["repository"],
  path: string,
  lines: { startLine: number; endLine: number },
): string {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const url = `https://github.com/${encodeURIComponent(repository.owner)}` +
    `/${encodeURIComponent(repository.name)}/blob/` +
    `${encodeURIComponent(repository.commitSha)}/${encodedPath}`;
  const lineAnchor = lines.startLine === lines.endLine
    ? `#L${lines.startLine}`
    : `#L${lines.startLine}-L${lines.endLine}`;
  return `${url}${lineAnchor}`;
}

function parseNullSeparated(value: string): string[] {
  return value.split("\0").filter(Boolean);
}

function successfulOutput(
  result: SandboxCommandResult,
  message: string,
): RepositoryResult<void> {
  if (result.exitCode !== 0 || result.stderr.trim() !== "") {
    return err(new RepositoryError(
      "REPOSITORY_SANDBOX_FAILED",
      `${message}: ${summarizeCommandFailure(result)}`,
    ));
  }
  return ok(undefined);
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
