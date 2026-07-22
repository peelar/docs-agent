import { posix } from "node:path";

import type { SandboxSession } from "eve/sandbox";
import { err, ok, ResultAsync } from "neverthrow";

import {
  assertRepositoryRelativePath,
  selectFileLines,
} from "../files";
import type {
  RepositoryResult,
  RepositoryResultAsync,
} from "@paige/repositories/errors";
import { RepositoryError } from "@paige/repositories/errors";
import { MAX_CHANGED_FILES, MAX_FILE_BYTES } from "./rules";
import {
  type ShellResult,
  SandboxShell,
  quoteShellArgument,
} from "./sandbox-shell";
import { createReviewId } from "./review";
import type { ChangedFile, DocumentationReview } from "./review";
import type { WorkspaceRecord } from "./workspace-record";

const MAX_EDIT_BYTES = 200_000;
const MAX_REVIEW_BYTES = 120_000;
const MAX_SEARCH_FILES = 2_000;
const MAX_SEARCH_EXCERPT_CHARACTERS = 500;

export interface DocumentationSearchMatch {
  path: string;
  line: number;
  excerpt: string;
}

export class DocumentationEditor {
  readonly #sandbox: SandboxSession;
  readonly #shell: SandboxShell;
  readonly #record: WorkspaceRecord;
  readonly #abortSignal: AbortSignal;

  constructor(input: {
    sandbox: SandboxSession;
    record: WorkspaceRecord;
    abortSignal: AbortSignal;
  }) {
    this.#sandbox = input.sandbox;
    this.#shell = new SandboxShell(input);
    this.#record = input.record;
    this.#abortSignal = input.abortSignal;
  }

  listFiles(input: {
    pathPrefix: string;
    limit: number;
  }): RepositoryResultAsync<{
    files: string[];
    truncated: boolean;
  }> {
    return new ResultAsync((async () => {
      const editable = await this.#assertEditableBase();
      if (editable.isErr()) return err(editable.error);
      const pathspec = input.pathPrefix === "."
        ? ""
        : ` -- ${quoteShellArgument(input.pathPrefix)}`;
      const result = await this.#run(
        `git -C ${quoteShellArgument(this.#record.path)} ls-files -co --exclude-standard -z${pathspec}`,
      );
      const listed = result.assertSucceeded(
        "Failed to list documentation workspace files",
      );
      if (listed.isErr()) return err(listed.error);
      const files = [
        ...new Set(result.nullSeparatedOutput()),
      ].sort();
      return ok({
        files: files.slice(0, input.limit),
        truncated: files.length > input.limit,
      });
    })());
  }

  search(input: {
    query: string;
    pathPrefix: string;
    limit: number;
  }): RepositoryResultAsync<{
    matches: DocumentationSearchMatch[];
    truncated: boolean;
  }> {
    return this.listFiles({
      pathPrefix: input.pathPrefix,
      limit: MAX_SEARCH_FILES + 1,
    }).andThen(({ files, truncated: fileListTruncated }) =>
      new ResultAsync((async () => {
        const matches: DocumentationSearchMatch[] = [];
        for (const path of files.slice(0, MAX_SEARCH_FILES)) {
          const content = await this.#tryReadText(path);
          if (content.isErr()) return err(content.error);
          if (content.value === null) continue;
          for (const [index, line] of content.value.split("\n").entries()) {
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
        return ok({ matches, truncated: fileListTruncated });
      })())
    );
  }

  read(input: {
    path: string;
    startLine: number;
    endLine?: number;
    maxCharacters: number;
  }) {
    return new ResultAsync((async () => {
      const editable = await this.#assertEditableBase();
      if (editable.isErr()) return err(editable.error);
      const content = await this.#readRequiredText(input.path);
      if (content.isErr()) return err(content.error);
      return selectFileLines(content.value, {
        startLine: input.startLine,
        endLine: input.endLine,
        maxCharacters: input.maxCharacters,
      }).map((value) => ({ path: input.path, ...value }));
    })());
  }

  write(input: { path: string; content: string }) {
    return new ResultAsync((async () => {
      const editable = await this.#assertEditableBase();
      if (editable.isErr()) return err(editable.error);
      const size = Buffer.byteLength(input.content);
      if (size > MAX_EDIT_BYTES) {
        return err(new RepositoryError(
          "REPOSITORY_INVALID_INPUT",
          `Documentation edits must be at most ${MAX_EDIT_BYTES} bytes.`,
        ));
      }
      const safe = await this.#assertSafePath(input.path);
      if (safe.isErr()) return err(safe.error);
      const directory = posix.dirname(input.path);
      if (directory !== ".") {
        const created = await this.#run(
          `mkdir -p ${quoteShellArgument(`${this.#record.path}/${directory}`)}`,
        );
        const createdOk = created.assertSucceeded(
          "Failed to create documentation directory",
        );
        if (createdOk.isErr()) return err(createdOk.error);
      }
      const directoryCheck = await this.#assertSafePath(input.path);
      if (directoryCheck.isErr()) return err(directoryCheck.error);
      await this.#sandbox.writeTextFile({
        path: `${this.#record.path}/${input.path}`,
        content: input.content,
        abortSignal: this.#abortSignal,
      });
      return ok({ path: input.path, bytes: size });
    })());
  }

  remove(input: { path: string }) {
    return new ResultAsync((async () => {
      const editable = await this.#assertEditableBase();
      if (editable.isErr()) return err(editable.error);
      const safe = await this.#assertSafePath(input.path);
      if (safe.isErr()) return err(safe.error);
      const absolutePath = `${this.#record.path}/${input.path}`;
      const regular = await this.#run(
        `test -f ${quoteShellArgument(absolutePath)} && test ! -L ${quoteShellArgument(absolutePath)}`,
      );
      if (regular.exitCode !== 0) {
        return err(new RepositoryError(
          "REPOSITORY_FILE_NOT_FOUND",
          `Documentation file does not exist: ${input.path}`,
        ));
      }
      await this.#sandbox.removePath({
        path: absolutePath,
        force: false,
        abortSignal: this.#abortSignal,
      });
      return ok({ path: input.path, removed: true });
    })());
  }

  review(): RepositoryResultAsync<DocumentationReview> {
    return new ResultAsync((async () => {
      const editable = await this.#assertEditableBase();
      if (editable.isErr()) return err(editable.error);
      const trackedResult = await this.#run(
        `git -C ${quoteShellArgument(this.#record.path)} diff --name-only --no-renames -z ${quoteShellArgument(this.#record.baseCommitSha)} --`,
      );
      const trackedOk = trackedResult.assertSucceeded(
        "Failed to review tracked documentation changes",
      );
      if (trackedOk.isErr()) return err(trackedOk.error);
      const untrackedResult = await this.#run(
        `git -C ${quoteShellArgument(this.#record.path)} ls-files --others --exclude-standard -z`,
      );
      const untrackedOk = untrackedResult.assertSucceeded(
        "Failed to review untracked documentation files",
      );
      if (untrackedOk.isErr()) return err(untrackedOk.error);

      const untracked = new Set(untrackedResult.nullSeparatedOutput());
      const changedFiles = [
        ...new Set([
          ...trackedResult.nullSeparatedOutput(),
          ...untracked,
        ]),
      ].sort();
      if (changedFiles.length === 0) {
        return ok({
          baseCommitSha: this.#record.baseCommitSha,
          reviewId: null,
          hasChanges: false,
          patch: "",
          changedFiles: [],
        });
      }
      if (changedFiles.length > MAX_CHANGED_FILES) {
        return err(new RepositoryError(
          "REPOSITORY_CHANGES_REJECTED",
          `Documentation review contains ${changedFiles.length} files; the limit is ${MAX_CHANGED_FILES}.`,
        ));
      }

      const files = await this.#readChangedFiles(changedFiles);
      if (files.isErr()) return err(files.error);
      const patch = await this.#createPatch(changedFiles, untracked);
      if (patch.isErr()) return err(patch.error);
      return ok({
        baseCommitSha: this.#record.baseCommitSha,
        reviewId: createReviewId(
          this.#record.baseCommitSha,
          files.value,
        ),
        hasChanges: true,
        patch: patch.value,
        changedFiles,
      });
    })());
  }

  async #assertEditableBase(): Promise<RepositoryResult<void>> {
    const head = await this.#readCommand(
      `git -C ${quoteShellArgument(this.#record.path)} rev-parse HEAD`,
      "Failed to inspect documentation workspace HEAD",
    );
    if (head.isErr()) return err(head.error);
    return head.value === this.#record.baseCommitSha
      ? ok(undefined)
      : err(new RepositoryError(
          "REPOSITORY_CONFLICT",
          "The documentation workspace HEAD no longer equals its recorded base commitSha.",
        ));
  }

  async #assertSafePath(path: string): Promise<RepositoryResult<void>> {
    if (path === ".git" || path.startsWith(".git/")) {
      return err(new RepositoryError(
        "REPOSITORY_INVALID_INPUT",
        "Documentation edits cannot access Git internals.",
      ));
    }
    let current = this.#record.path;
    for (const component of path.split("/")) {
      current = `${current}/${component}`;
      const symlink = await this.#run(
        `test -L ${quoteShellArgument(current)}`,
      );
      if (symlink.exitCode === 0) {
        return err(new RepositoryError(
          "REPOSITORY_CHANGES_REJECTED",
          `Documentation paths cannot contain symlinks: ${path}`,
        ));
      }
      if (symlink.exitCode !== 1) {
        return err(new RepositoryError(
          "REPOSITORY_SANDBOX_FAILED",
          `Failed to inspect documentation path: ${path}`,
        ));
      }
    }
    return ok(undefined);
  }

  async #readRequiredText(path: string): Promise<RepositoryResult<string>> {
    const safe = await this.#assertSafePath(path);
    if (safe.isErr()) return err(safe.error);
    const absolutePath = `${this.#record.path}/${path}`;
    const regular = await this.#run(
      `test -f ${quoteShellArgument(absolutePath)} && test ! -L ${quoteShellArgument(absolutePath)}`,
    );
    if (regular.exitCode !== 0) {
      return err(new RepositoryError(
        "REPOSITORY_FILE_NOT_FOUND",
        `Documentation file does not exist: ${path}`,
      ));
    }
    const size = await this.#fileSize(path);
    if (size.isErr()) return err(size.error);
    if (size.value > MAX_FILE_BYTES) {
      return err(new RepositoryError(
        "REPOSITORY_CHANGES_REJECTED",
        `Documentation file is too large: ${path}`,
      ));
    }
    try {
      const content = await this.#sandbox.readTextFile({
        path: absolutePath,
        abortSignal: this.#abortSignal,
      });
      return content === null
        ? err(new RepositoryError(
            "REPOSITORY_FILE_NOT_FOUND",
            `Documentation file does not exist: ${path}`,
          ))
        : content.includes("\0")
        ? err(new RepositoryError(
            "REPOSITORY_CHANGES_REJECTED",
            `Documentation file is binary: ${path}`,
          ))
        : ok(content);
    } catch (cause) {
      return err(new RepositoryError(
        "REPOSITORY_CHANGES_REJECTED",
        `Documentation file is not valid UTF-8 text: ${path}`,
        { cause },
      ));
    }
  }

  async #tryReadText(
    path: string,
  ): Promise<RepositoryResult<string | null>> {
    const safe = await this.#assertSafePath(path);
    if (safe.isErr()) {
      return safe.error.code === "REPOSITORY_CHANGES_REJECTED"
        ? ok(null)
        : err(safe.error);
    }
    const size = await this.#fileSize(path);
    if (size.isErr() || size.value > MAX_FILE_BYTES) return ok(null);
    try {
      const content = await this.#sandbox.readTextFile({
        path: `${this.#record.path}/${path}`,
        abortSignal: this.#abortSignal,
      });
      return content === null || content.includes("\0")
        ? ok(null)
        : ok(content);
    } catch {
      return ok(null);
    }
  }

  async #fileSize(path: string): Promise<RepositoryResult<number>> {
    const result = await this.#readCommand(
      `wc -c < ${quoteShellArgument(`${this.#record.path}/${path}`)}`,
      `Failed to inspect documentation file size: ${path}`,
    );
    if (result.isErr()) return err(result.error);
    const size = Number.parseInt(result.value, 10);
    return Number.isSafeInteger(size) && size >= 0
      ? ok(size)
      : err(new RepositoryError(
          "REPOSITORY_SANDBOX_FAILED",
          `Documentation file size is invalid: ${path}`,
        ));
  }

  async #readChangedFiles(
    changedFiles: string[],
  ): Promise<RepositoryResult<ChangedFile[]>> {
    const files: ChangedFile[] = [];
    for (const path of changedFiles) {
      const normalized = assertRepositoryRelativePath(path, {
        allowRoot: false,
      });
      if (normalized.isErr() || normalized.value !== path) {
        return err(new RepositoryError(
          "REPOSITORY_CHANGES_REJECTED",
          `Documentation review contains an invalid path: ${path}`,
        ));
      }
      const safe = await this.#assertSafePath(path);
      if (safe.isErr()) return err(safe.error);
      const baseMode = await this.#readCommand(
        `git -C ${quoteShellArgument(this.#record.path)} ls-tree ${quoteShellArgument(this.#record.baseCommitSha)} -- ${quoteShellArgument(path)}`,
        `Failed to inspect the base file mode: ${path}`,
      );
      if (baseMode.isErr()) return err(baseMode.error);
      if (baseMode.value.startsWith("120000 ")) {
        return err(new RepositoryError(
          "REPOSITORY_CHANGES_REJECTED",
          `Documentation changes cannot modify symlinks: ${path}`,
        ));
      }
      const binary = await this.#run(
        `git -C ${quoteShellArgument(this.#record.path)} diff --numstat ${quoteShellArgument(this.#record.baseCommitSha)} -- ${quoteShellArgument(path)}`,
      );
      const binaryOk = binary.assertSucceeded(
        `Failed to inspect documentation change type: ${path}`,
      );
      if (binaryOk.isErr()) return err(binaryOk.error);
      if (binary.stdout.startsWith("-\t-")) {
        return err(new RepositoryError(
          "REPOSITORY_CHANGES_REJECTED",
          `Documentation changes cannot include binary files: ${path}`,
        ));
      }
      if (!(await this.#pathExists(`${this.#record.path}/${path}`))) {
        files.push({ path, content: null });
        continue;
      }
      const changedFileType = await this.#run(
        `cd ${quoteShellArgument(this.#record.path)} && git diff --no-index --numstat -- /dev/null ${quoteShellArgument(path)}`,
      );
      if (changedFileType.exitCode !== 0 && changedFileType.exitCode !== 1) {
        return err(new RepositoryError(
          "REPOSITORY_SANDBOX_FAILED",
          `Failed to inspect changed documentation file type: ${path}`,
        ));
      }
      if (changedFileType.stdout.startsWith("-\t-")) {
        return err(new RepositoryError(
          "REPOSITORY_CHANGES_REJECTED",
          `Documentation changes cannot include binary files: ${path}`,
        ));
      }
      const content = await this.#readRequiredText(path);
      if (content.isErr()) return err(content.error);
      files.push({ path, content: content.value });
    }
    return ok(files);
  }

  async #createPatch(
    changedFiles: string[],
    untrackedFiles: Set<string>,
  ): Promise<RepositoryResult<string>> {
    const pathspec = changedFiles.map(quoteShellArgument).join(" ");
    const tracked = await this.#run(
      `git -C ${quoteShellArgument(this.#record.path)} diff --no-ext-diff --no-renames --no-color ${quoteShellArgument(this.#record.baseCommitSha)} -- ${pathspec}`,
    );
    const trackedOk = tracked.assertSucceeded(
      "Failed to create the documentation patch",
    );
    if (trackedOk.isErr()) return err(trackedOk.error);
    let patch = tracked.stdout;
    for (const path of [...untrackedFiles].sort()) {
      const untracked = await this.#run(
        `cd ${quoteShellArgument(this.#record.path)} && git diff --no-index --no-color -- /dev/null ${quoteShellArgument(path)}`,
      );
      if (untracked.exitCode !== 0 && untracked.exitCode !== 1) {
        return err(new RepositoryError(
          "REPOSITORY_SANDBOX_FAILED",
          `Failed to create the patch for untracked file ${path}: ${untracked.failureSummary()}`,
        ));
      }
      patch += untracked.stdout;
    }
    if (Buffer.byteLength(patch) > MAX_REVIEW_BYTES) {
      return err(new RepositoryError(
        "REPOSITORY_CHANGES_REJECTED",
        `Documentation patch exceeds the ${MAX_REVIEW_BYTES}-byte review limit.`,
      ));
    }
    return ok(patch);
  }

  async #pathExists(path: string): Promise<boolean> {
    return await this.#shell.pathExists(path);
  }

  async #readCommand(
    command: string,
    message: string,
    options: { trim?: boolean } = {},
  ): Promise<RepositoryResult<string>> {
    return await this.#shell.read(command, message, options);
  }

  async #run(command: string): Promise<ShellResult> {
    return await this.#shell.run(command);
  }
}
