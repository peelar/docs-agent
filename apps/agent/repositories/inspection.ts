import type { SandboxCommandResult, SandboxSession } from "eve/sandbox";
import { err, ok, ResultAsync } from "neverthrow";

import { RepositoryError } from "./shared/errors";
import type {
  RepositoryResult,
  RepositoryResultAsync,
} from "./shared/errors";
import type {
  RepositoryComparison,
  RepositorySearchMatch,
  RepositoryWorkspace,
} from "./types";

const MAX_READ_FILE_BYTES = 1_000_000;
const MAX_READ_LINES = 400;
const MAX_READ_CHARACTERS = 24_000;
const MAX_SEARCH_EXCERPT_CHARACTERS = 500;

/** Lists files from one immutable revision without populating a working tree. */
export function listRepositoryFiles(input: {
  sandbox: SandboxSession;
  workspace: RepositoryWorkspace;
  abortSignal: AbortSignal;
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
    const result = await run(
      input.sandbox,
      `cd ${quoteShellArgument(input.workspace.path)} && git ls-tree -r --name-only -z ${quoteShellArgument(input.workspace.repository.resolvedRevision)}${pathspec} | head -z -n ${input.limit + 1}`,
      input.abortSignal,
    );
    const successful = successfulInspection(
      result,
      "Repository file listing failed",
    );
    if (successful.isErr()) return err(successful.error);
    const files = parseNullSeparated(result.stdout);

    return ok({
      repository: input.workspace.repository,
      files: files.slice(0, input.limit),
      truncated: files.length > input.limit,
    });
  })());
}

/** Searches tracked content at one immutable revision. */
export function searchRepository(input: {
  sandbox: SandboxSession;
  workspace: RepositoryWorkspace;
  abortSignal: AbortSignal;
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
    const result = await run(
      input.sandbox,
      `cd ${quoteShellArgument(input.workspace.path)} && git grep -n -z --full-name --fixed-strings -- ${quoteShellArgument(input.query)} ${quoteShellArgument(input.workspace.repository.resolvedRevision)}${pathspec} | head -n ${input.limit + 1} | cut -c 1-1000`,
      input.abortSignal,
    );
    const successful = successfulInspection(result, "Repository search failed");
    if (successful.isErr()) return err(successful.error);
    const matches = result.stdout
      .split("\n")
      .filter(Boolean)
      .map(parseSearchMatch)
      .filter((match): match is RepositorySearchMatch => match !== null);

    return ok({
      repository: input.workspace.repository,
      matches: matches.slice(0, input.limit),
      truncated: matches.length > input.limit,
    });
  })());
}

/**
 * Reads one tracked blob from an immutable revision and returns a bounded line
 * selection plus the blob SHA Paige can cite.
 */
export function readRepositoryFile(input: {
  sandbox: SandboxSession;
  workspace: RepositoryWorkspace;
  abortSignal: AbortSignal;
  path: string;
  startLine: number;
  endLine?: number;
  maxCharacters: number;
}): RepositoryResultAsync<{
  repository: RepositoryWorkspace["repository"];
  path: string;
  blobSha: string;
  startLine: number;
  endLine: number;
  content: string;
  truncated: boolean;
}> {
  return new ResultAsync((async () => {
    const object = `${input.workspace.repository.resolvedRevision}:${input.path}`;
    const typeResult = await run(
      input.sandbox,
      `cd ${quoteShellArgument(input.workspace.path)} && git cat-file -t ${quoteShellArgument(object)}`,
      input.abortSignal,
    );
    if (typeResult.exitCode !== 0 || typeResult.stdout.trim() !== "blob") {
      return err(new RepositoryError(
        "REPOSITORY_FILE_NOT_FOUND",
        `Repository file does not exist: ${input.path}`,
      ));
    }

    const sizeResult = await run(
      input.sandbox,
      `cd ${quoteShellArgument(input.workspace.path)} && git cat-file -s ${quoteShellArgument(object)}`,
      input.abortSignal,
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
      run(
        input.sandbox,
        `cd ${quoteShellArgument(input.workspace.path)} && git show ${quoteShellArgument(object)}`,
        input.abortSignal,
      ),
      run(
        input.sandbox,
        `cd ${quoteShellArgument(input.workspace.path)} && git rev-parse ${quoteShellArgument(object)}`,
        input.abortSignal,
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
      repository: input.workspace.repository,
      path: input.path,
      blobSha: hashResult.stdout.trim(),
      ...selection.value,
    });
  })());
}

/** Lists changed paths between two already-fetched immutable revisions. */
export function compareRepositoryRevisions(input: {
  sandbox: SandboxSession;
  baseWorkspace: RepositoryWorkspace;
  headWorkspace: RepositoryWorkspace;
  abortSignal: AbortSignal;
  pathPrefix: string;
  limit: number;
}): RepositoryResultAsync<RepositoryComparison> {
  return new ResultAsync((async () => {
    const pathspec = input.pathPrefix === "."
      ? ""
      : ` -- ${quoteShellArgument(input.pathPrefix)}`;
    const result = await run(
      input.sandbox,
      `cd ${quoteShellArgument(input.headWorkspace.path)} && git diff --name-only -z ${quoteShellArgument(input.baseWorkspace.repository.resolvedRevision)} ${quoteShellArgument(input.headWorkspace.repository.resolvedRevision)}${pathspec} | head -z -n ${input.limit + 1}`,
      input.abortSignal,
    );
    const successful = successfulInspection(
      result,
      "Repository comparison failed",
    );
    if (successful.isErr()) return err(successful.error);
    const changedFiles = parseNullSeparated(result.stdout);

    return ok({
      repositoryId: input.headWorkspace.repository.id,
      baseRevision: input.baseWorkspace.repository.resolvedRevision,
      headRevision: input.headWorkspace.repository.resolvedRevision,
      changedFiles: changedFiles.slice(0, input.limit),
      truncated: changedFiles.length > input.limit,
    });
  })());
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

function parseSearchMatch(value: string): RepositorySearchMatch | null {
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

function parseNullSeparated(value: string): string[] {
  return value.split("\0").filter(Boolean);
}

async function run(
  sandbox: SandboxSession,
  command: string,
  abortSignal: AbortSignal,
): Promise<SandboxCommandResult> {
  return await sandbox.run({ command, abortSignal });
}

function successfulInspection(
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
