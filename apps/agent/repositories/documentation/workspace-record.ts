import type { SandboxSession } from "eve/sandbox";
import { err, ok } from "neverthrow";

import type { RepositoryResult } from "@paige/repositories/errors";
import { RepositoryError } from "@paige/repositories/errors";
import type {
  DocumentationRepository,
  ResolvedRepository,
} from "@paige/repositories/types";
import { isValidPublishBranch } from "./rules";

const WORKTREE_ROOT = "/workspace/worktrees";

export interface PublishRequest {
  reviewId: string;
  branch: string;
  commitMessage: string;
}

export interface WorkspaceRecord {
  version: 2;
  path: string;
  cachePath: string;
  repository: ResolvedRepository<DocumentationRepository>;
  baseBranch: string;
  baseCommitSha: string;
  publishRequest?: PublishRequest;
}

export interface OpenedWorkspace {
  path: string;
  repository: ResolvedRepository<DocumentationRepository>;
  baseBranch: string;
  baseCommitSha: string;
}

export class WorkspaceRecordStore {
  readonly #sandbox: SandboxSession;
  readonly #abortSignal: AbortSignal;

  constructor(input: {
    sandbox: SandboxSession;
    abortSignal: AbortSignal;
  }) {
    this.#sandbox = input.sandbox;
    this.#abortSignal = input.abortSignal;
  }

  async read(
    repository: DocumentationRepository,
  ): Promise<RepositoryResult<WorkspaceRecord>> {
    let contents: string;
    try {
      const stored = await this.#sandbox.readTextFile({
        path: workspaceRecordPath(repository),
        abortSignal: this.#abortSignal,
      });
      if (stored === null) return err(workspaceNotOpenError());
      contents = stored;
    } catch (cause) {
      return err(workspaceNotOpenError(cause));
    }
    return parseWorkspaceRecord(contents);
  }

  async save(record: WorkspaceRecord): Promise<RepositoryResult<void>> {
    try {
      await this.#sandbox.writeTextFile({
        path: workspaceRecordPath(record.repository),
        content: `${JSON.stringify(record)}\n`,
        abortSignal: this.#abortSignal,
      });
      return ok(undefined);
    } catch (cause) {
      return err(new RepositoryError(
        "REPOSITORY_SANDBOX_FAILED",
        "Failed to save the documentation workspace record.",
        { cause },
      ));
    }
  }

  async savePublishRequest(
    record: WorkspaceRecord,
    publishRequest: PublishRequest,
  ): Promise<RepositoryResult<void>> {
    return await this.save({ ...record, publishRequest });
  }

  async clearPublishRequest(
    record: WorkspaceRecord,
  ): Promise<RepositoryResult<WorkspaceRecord>> {
    const restored: WorkspaceRecord = { ...record };
    delete restored.publishRequest;
    const saved = await this.save(restored);
    return saved.isErr() ? err(saved.error) : ok(restored);
  }
}

export function assertRecordMatchesRepository(
  record: WorkspaceRecord,
  repository: DocumentationRepository,
): RepositoryResult<void> {
  if (
    record.repository.id !== repository.id ||
    record.repository.owner !== repository.owner ||
    record.repository.name !== repository.name ||
    record.repository.role !== "documentation" ||
    record.path !== workspacePath(repository) ||
    record.cachePath !== repositoryCachePath(repository)
  ) {
    return err(new RepositoryError(
      "REPOSITORY_CONFLICT",
      "The documentation workspace record does not match the configured repository.",
    ));
  }
  return ok(undefined);
}

export function toOpenedWorkspace(record: WorkspaceRecord): OpenedWorkspace {
  return {
    path: record.path,
    repository: record.repository,
    baseBranch: record.baseBranch,
    baseCommitSha: record.baseCommitSha,
  };
}

export function workspacePath(repository: DocumentationRepository): string {
  return `${WORKTREE_ROOT}/${repository.id}`;
}

export function workspaceRoot(): string {
  return WORKTREE_ROOT;
}

function repositoryCachePath(
  repository: DocumentationRepository,
): string {
  return `/workspace/repositories/${repository.id}`;
}

function workspaceRecordPath(repository: DocumentationRepository): string {
  return `${WORKTREE_ROOT}/.${repository.id}.json`;
}

function workspaceNotOpenError(cause?: unknown): RepositoryError {
  return new RepositoryError(
    "REPOSITORY_CONFLICT",
    "Open the documentation workspace before using it.",
    { cause },
  );
}

function parseWorkspaceRecord(value: string): RepositoryResult<WorkspaceRecord> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (cause) {
    return err(new RepositoryError(
      "REPOSITORY_CONFLICT",
      "The documentation workspace record is invalid.",
      { cause },
    ));
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { version?: unknown }).version !== 2
  ) {
    return err(new RepositoryError(
      "REPOSITORY_CONFLICT",
      "The documentation workspace record is invalid.",
    ));
  }
  const record = parsed as Partial<WorkspaceRecord>;
  const repository = record.repository;
  const publishRequest = record.publishRequest;
  if (
    typeof record.path !== "string" ||
    typeof record.cachePath !== "string" ||
    typeof record.baseBranch !== "string" ||
    typeof record.baseCommitSha !== "string" ||
    typeof repository !== "object" ||
    repository === null ||
    repository.role !== "documentation" ||
    typeof repository.id !== "string" ||
    typeof repository.owner !== "string" ||
    typeof repository.name !== "string" ||
    typeof repository.isPrivate !== "boolean" ||
    typeof repository.ref !== "string" ||
    typeof repository.commitSha !== "string" ||
    (
      publishRequest !== undefined &&
      (
        typeof publishRequest !== "object" ||
        publishRequest === null ||
        typeof publishRequest.reviewId !== "string" ||
        !/^sha256:[a-f0-9]{64}$/.test(publishRequest.reviewId) ||
        typeof publishRequest.branch !== "string" ||
        !isValidPublishBranch(publishRequest.branch) ||
        typeof publishRequest.commitMessage !== "string" ||
        publishRequest.commitMessage === "" ||
        publishRequest.commitMessage.length > 200 ||
        publishRequest.commitMessage.includes("\n")
      )
    )
  ) {
    return err(new RepositoryError(
      "REPOSITORY_CONFLICT",
      "The documentation workspace record is incomplete.",
    ));
  }
  return ok(record as WorkspaceRecord);
}
