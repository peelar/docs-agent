import assert from "node:assert/strict";
import { exec } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type {
  SandboxCommandResult,
  SandboxSession,
} from "eve/sandbox";
import { afterEach, describe, test, vi } from "vitest";

import {
  createApprovedCommit,
  inspectDocumentationDiff,
  prepareDocumentationWorkspace,
  readApprovedCommit,
  removeDocumentationFile,
  writebackDocumentation,
  writeDocumentationFile,
} from "../repositories/documentation/service";
import type {
  DocumentationWorkspaceState,
} from "../repositories/documentation/service";
import {
  createGitHubRequest,
  GitHubRepository,
} from "../repositories/shared/github";
import type {
  DocumentationRepository,
  RepositoryWorkspace,
  ResolvedRepository,
} from "../repositories/types";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    temporaryDirectories.splice(0).map(async (path) =>
      await rm(path, { force: true, recursive: true })
    ),
  );
});

describe("documentation workspace", () => {
  test("reuses only a clean matching worktree and protects existing edits", async () => {
    const fixture = await createFixture();
    await writeFile(
      fixture.actualPath("worktrees/saleor-docs/README.md"),
      "dirty\n",
    );

    const result = await prepareDocumentationWorkspace({
      sandbox: fixture.sandbox,
      cache: fixture.cache,
      abortSignal: fixture.abortSignal,
    });

    assert(result.isErr());
    assert.equal(result.error.code, "REPOSITORY_DIRTY_WORKSPACE");
  });

  test(
    "includes tracked, deleted, and untracked text in a stable digest",
    async () => {
      const fixture = await createFixture();
      const wrote = await writeDocumentationFile({
        ...fixture.operation,
        path: "README.md",
        content: "updated\n",
      });
      assert(wrote.isOk());
      const created = await writeDocumentationFile({
        ...fixture.operation,
        path: "docs/new.md",
        content: "new\n",
      });
      assert(created.isOk());
      const removed = await removeDocumentationFile({
        ...fixture.operation,
        path: "docs/old.md",
      });
      assert(removed.isOk());

      const first = await inspectDocumentationDiff(fixture.operation);
      const second = await inspectDocumentationDiff(fixture.operation);

      assert(first.isOk());
      assert(second.isOk());
      assert.equal(first.value.hasChanges, true);
      assert.deepEqual(first.value.changedFiles, [
        "README.md",
        "docs/new.md",
        "docs/old.md",
      ]);
      assert.match(first.value.patch, /updated/);
      assert.match(first.value.patch, /new\.md/);
      assert.equal(first.value.digest, second.value.digest);

      await writeDocumentationFile({
        ...fixture.operation,
        path: "docs/new.md",
        content: "changed after review\n",
      });
      const drifted = await inspectDocumentationDiff(fixture.operation);
      assert(drifted.isOk());
      assert.notEqual(drifted.value.digest, first.value.digest);
    },
    15_000,
  );

  test("rejects symlink traversal and binary proposed files", async () => {
    const fixture = await createFixture();
    const outside = fixture.actualPath("outside");
    await mkdir(outside, { recursive: true });
    await symlink(
      outside,
      fixture.actualPath("worktrees/saleor-docs/linked"),
    );

    const symlinkWrite = await writeDocumentationFile({
      ...fixture.operation,
      path: "linked/escape.md",
      content: "escape\n",
    });
    assert(symlinkWrite.isErr());
    assert.equal(symlinkWrite.error.code, "REPOSITORY_DIFF_REJECTED");

    await rm(fixture.actualPath("worktrees/saleor-docs/linked"));
    await writeFile(
      fixture.actualPath("worktrees/saleor-docs/binary.dat"),
      Buffer.from([0, 1, 2, 3]),
    );
    const binaryDiff = await inspectDocumentationDiff(fixture.operation);
    assert(binaryDiff.isErr());
    assert.equal(binaryDiff.error.code, "REPOSITORY_DIFF_REJECTED");
    assert.match(binaryDiff.error.message, /binary/);
  });

  test("rejects diffs that exceed the complete review file limit", async () => {
    const fixture = await createFixture();
    const changes = fixture.actualPath("worktrees/saleor-docs/changes");
    await mkdir(changes, { recursive: true });
    await Promise.all(
      Array.from({ length: 51 }, async (_, index) =>
        await writeFile(join(changes, `${index}.md`), `${index}\n`)
      ),
    );

    const result = await inspectDocumentationDiff(fixture.operation);

    assert(result.isErr());
    assert.equal(result.error.code, "REPOSITORY_DIFF_REJECTED");
    assert.match(result.error.message, /51 files/);
  });
});

describe("documentation writeback", () => {
  test("stages exactly the approved paths and reuses the approved local commit", async () => {
    const fixture = await createFixture();
    await writeDocumentationFile({
      ...fixture.operation,
      path: "docs/new.md",
      content: "approved\n",
    });
    const diff = await inspectDocumentationDiff(fixture.operation);
    assert(diff.isOk());
    assert(diff.value.digest);

    const commit = await createApprovedCommit({
      ...fixture.operation,
      branch: "paige/approved-docs",
      message: "docs: add approved page",
      changedFiles: diff.value.changedFiles,
    });
    assert(
      commit.isOk(),
      commit.isErr() ? `${commit.error.code}: ${commit.error.message}` : "",
    );
    const committedPaths = await fixture.run(
      `git -C '${fixture.actualPath("worktrees/saleor-docs")}' diff --name-only '${fixture.state.baseCommitSha}' '${commit.value.commitSha}'`,
    );
    assert.equal(committedPaths.stdout.trim(), "docs/new.md");

    const retried = await readApprovedCommit({
      ...fixture.operation,
      input: {
        digest: diff.value.digest,
        branch: "paige/approved-docs",
        commitMessage: "docs: add approved page",
      },
    });
    assert(retried.isOk());
    assert.equal(retried.value?.commitSha, commit.value.commitSha);

    const preparedAgain = await prepareDocumentationWorkspace({
      sandbox: fixture.sandbox,
      cache: fixture.cache,
      abortSignal: fixture.abortSignal,
    });
    assert(preparedAgain.isErr());
    assert.equal(preparedAgain.error.code, "REPOSITORY_CONFLICT");
    assert.match(preparedAgain.error.message, /local branch/);

    const driftedApproval = await readApprovedCommit({
      ...fixture.operation,
      input: {
        digest: `sha256:${"0".repeat(64)}`,
        branch: "paige/approved-docs",
        commitMessage: "docs: add approved page",
      },
    });
    assert(driftedApproval.isErr());
    assert.equal(
      driftedApproval.error.code,
      "REPOSITORY_APPROVAL_MISMATCH",
    );
  });

  test("refuses writeback when the remote base moved", async () => {
    const fixture = await createFixture();
    await writeDocumentationFile({
      ...fixture.operation,
      path: "README.md",
      content: "approved\n",
    });
    const diff = await inspectDocumentationDiff(fixture.operation);
    assert(diff.isOk());
    assert(diff.value.digest);
    const movedCommitSha = "f".repeat(40);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>()
        .mockResolvedValueOnce(jsonResponse({
          default_branch: "main",
          private: true,
        }))
        .mockResolvedValueOnce(jsonResponse({ sha: movedCommitSha })),
    );

    const result = await writebackDocumentation({
      sandbox: fixture.sandbox,
      repository: fixture.repository,
      github: fixture.github,
      abortSignal: fixture.abortSignal,
      input: {
        digest: diff.value.digest,
        branch: "paige/remote-moved",
        commitMessage: "docs: update readme",
        pullRequestTitle: "Update readme",
        pullRequestBody: "Prepared by Paige.",
      },
    });

    assert(result.isErr());
    assert.equal(
      result.error.code,
      "REPOSITORY_CONFLICT",
      result.error.message,
    );
    assert.match(result.error.message, /remote base/);
  });

  test("reuses a completed branch and pull request before checking a moved base", async () => {
    const fixture = await createFixture();
    await writeDocumentationFile({
      ...fixture.operation,
      path: "README.md",
      content: "approved\n",
    });
    const diff = await inspectDocumentationDiff(fixture.operation);
    assert(diff.isOk());
    assert(diff.value.digest);
    const commit = await createApprovedCommit({
      ...fixture.operation,
      branch: "paige/completed-retry",
      message: "docs: update readme",
      changedFiles: diff.value.changedFiles,
    });
    assert(commit.isOk());
    const remoteCommit = "b".repeat(40);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        object: { sha: remoteCommit },
      }))
      .mockResolvedValueOnce(jsonResponse({
        commit: { message: "docs: update readme" },
        parents: [{ sha: fixture.state.baseCommitSha }],
        files: [{ filename: "README.md", status: "modified" }],
      }))
      .mockResolvedValueOnce(jsonResponse({
        type: "file",
        encoding: "base64",
        content: Buffer.from("approved\n").toString("base64"),
      }))
      .mockResolvedValueOnce(jsonResponse([
        {
          number: 44,
          html_url: "https://github.com/peelar/saleor-docs/pull/44",
          title: "Update readme",
          body: "Prepared by Paige.",
          draft: true,
        },
      ]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await writebackDocumentation({
      sandbox: fixture.sandbox,
      repository: fixture.repository,
      github: fixture.github,
      abortSignal: fixture.abortSignal,
      input: {
        digest: diff.value.digest,
        branch: "paige/completed-retry",
        commitMessage: "docs: update readme",
        pullRequestTitle: "Update readme",
        pullRequestBody: "Prepared by Paige.",
      },
    });

    assert(result.isOk());
    assert.equal(result.value.reused, true);
    assert.equal(result.value.commit.commitSha, remoteCommit);
    assert.equal(result.value.pullRequest.number, 44);
    assert.equal(fetchMock.mock.calls.length, 4);
  });

  test("retries an approved local commit through GitHub without sandbox credentials", async () => {
    const fixture = await createFixture();
    await writeDocumentationFile({
      ...fixture.operation,
      path: "README.md",
      content: "approved\n",
    });
    const diff = await inspectDocumentationDiff(fixture.operation);
    assert(diff.isOk());
    assert(diff.value.digest);
    const localCommit = await createApprovedCommit({
      ...fixture.operation,
      branch: "paige/manual-test",
      message: "docs: update readme",
      changedFiles: diff.value.changedFiles,
    });
    assert(localCommit.isOk());
    const remoteCommit = "a".repeat(40);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({
        default_branch: "main",
        private: true,
      }))
      .mockResolvedValueOnce(jsonResponse({
        sha: fixture.state.baseCommitSha,
      }))
      .mockResolvedValueOnce(jsonResponse({
        object: { sha: fixture.state.baseCommitSha },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          createCommitOnBranch: {
            commit: { oid: remoteCommit },
          },
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        commit: { message: "docs: update readme" },
        parents: [{ sha: fixture.state.baseCommitSha }],
        files: [{ filename: "README.md", status: "modified" }],
      }))
      .mockResolvedValueOnce(jsonResponse({
        type: "file",
        encoding: "base64",
        content: Buffer.from("approved\n").toString("base64"),
      }))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({
        number: 45,
        html_url: "https://github.com/peelar/saleor-docs/pull/45",
        draft: true,
      }));
    vi.stubGlobal(
      "fetch",
      fetchMock,
    );

    const result = await writebackDocumentation({
      sandbox: fixture.sandbox,
      repository: fixture.repository,
      github: fixture.github,
      abortSignal: fixture.abortSignal,
      input: {
        digest: diff.value.digest,
        branch: "paige/manual-test",
        commitMessage: "docs: update readme",
        pullRequestTitle: "Update readme",
        pullRequestBody: "Prepared by Paige.",
      },
    });

    assert(result.isOk(), result.isErr() ? result.error.message : "");
    assert.equal(result.value.commit.commitSha, remoteCommit);
    assert.equal(result.value.pullRequest.number, 45);
    assert.equal(result.value.reused, true);
    assert.equal(fixture.networkPolicies.length, 0);
    assert.equal(
      fixture.commands.some((command) => command.includes(" push origin ")),
      false,
    );
    const mutation = fetchMock.mock.calls[4];
    assert.equal(mutation[0], "https://api.github.com/graphql");
    assert.equal(
      String(mutation[1]?.body).includes(
        Buffer.from("approved\n").toString("base64"),
      ),
      true,
    );
    assert.equal(
      String(mutation[1]?.body).includes("secret-token"),
      false,
    );
  });

  test("fails closed when GitHub rejects the atomic documentation commit", async () => {
    const fixture = await createFixture();
    await writeDocumentationFile({
      ...fixture.operation,
      path: "README.md",
      content: "approved\n",
    });
    const diff = await inspectDocumentationDiff(fixture.operation);
    assert(diff.isOk());
    assert(diff.value.digest);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>()
        .mockResolvedValueOnce(jsonResponse({
          default_branch: "main",
          private: true,
        }))
        .mockResolvedValueOnce(jsonResponse({
          sha: fixture.state.baseCommitSha,
        }))
        .mockResolvedValueOnce(new Response(null, { status: 404 }))
        .mockResolvedValueOnce(jsonResponse({
          object: { sha: fixture.state.baseCommitSha },
        }))
        .mockResolvedValueOnce(jsonResponse({
          data: { createCommitOnBranch: null },
          errors: [{ message: "permission denied" }],
        })),
    );

    const result = await writebackDocumentation({
      sandbox: fixture.sandbox,
      repository: fixture.repository,
      github: fixture.github,
      abortSignal: fixture.abortSignal,
      input: {
        digest: diff.value.digest,
        branch: "paige/publish-failure",
        commitMessage: "docs: update readme",
        pullRequestTitle: "Update readme",
        pullRequestBody: "Prepared by Paige.",
      },
    });

    assert(result.isErr());
    assert.equal(result.error.code, "REPOSITORY_GITHUB_FAILED");
    assert.equal(fixture.networkPolicies.length, 0);
  });
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "paige-documentation-"));
  temporaryDirectories.push(root);
  await mkdir(join(root, "workspace"), { recursive: true });
  const actualWorkspace = await realpath(join(root, "workspace"));
  const actualCache = join(actualWorkspace, "repositories", "saleor-docs");
  await mkdir(actualCache, { recursive: true });
  await runShell(`git -C '${actualCache}' init -q`);
  await runShell(`git -C '${actualCache}' config user.name Test`);
  await runShell(`git -C '${actualCache}' config user.email test@example.com`);
  await runShell(
    `git -C '${actualCache}' remote add origin https://github.com/peelar/saleor-docs.git`,
  );
  await mkdir(join(actualCache, "docs"), { recursive: true });
  await writeFile(join(actualCache, "README.md"), "base\n");
  await writeFile(join(actualCache, "docs", "old.md"), "old\n");
  await runShell(`git -C '${actualCache}' add README.md docs/old.md`);
  await runShell(`git -C '${actualCache}' commit -q -m base`);
  const commitSha = (
    await runShell(`git -C '${actualCache}' rev-parse HEAD`)
  ).stdout.trim();

  const repository: ResolvedRepository<DocumentationRepository> = {
    id: "saleor-docs",
    owner: "peelar",
    name: "saleor-docs",
    role: "documentation",
    isPrivate: true,
    ref: "main",
    commitSha: commitSha,
  };
  const cache: RepositoryWorkspace<DocumentationRepository> = {
    path: "/workspace/repositories/saleor-docs",
    repository,
  };
  const local = createLocalSandbox(actualWorkspace);
  const abortSignal = new AbortController().signal;
  const github = new GitHubRepository(
    repository,
    createGitHubRequest({
      token: "secret-token",
      abortSignal,
    }),
  );
  const prepared = await prepareDocumentationWorkspace({
    sandbox: local.sandbox,
    cache,
    abortSignal,
  });
  assert(prepared.isOk());
  const state: DocumentationWorkspaceState = {
    version: 1,
    path: prepared.value.path,
    cachePath: cache.path,
    repository,
    baseBranch: prepared.value.baseBranch,
    baseCommitSha: prepared.value.baseCommitSha,
  };

  return {
    ...local,
    abortSignal,
    cache,
    github,
    operation: {
      sandbox: local.sandbox,
      state,
      abortSignal,
    },
    repository,
    state,
    actualPath(path: string) {
      return join(actualWorkspace, path);
    },
    run: runShell,
  };
}

function createLocalSandbox(
  actualWorkspace: string,
) {
  const networkPolicies: unknown[] = [];
  const commands: string[] = [];
  const translate = (value: string) =>
    value.replaceAll("/workspace", actualWorkspace);
  const virtualize = (value: string) =>
    value.replaceAll(actualWorkspace, "/workspace");

  const sandbox = {
    id: `sandbox-${Math.random()}`,
    resolvePath(path: string) {
      return path.startsWith("/")
        ? path
        : `/workspace/${path}`;
    },
    async run({ command }: { command: string }) {
      commands.push(command);
      const result = await runShell(translate(command));
      return commandResult({
        ...result,
        stdout: virtualize(result.stdout),
        stderr: virtualize(result.stderr),
      });
    },
    async readTextFile({ path }: { path: string }) {
      try {
        const bytes = await readFile(translate(path));
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          return null;
        }
        throw error;
      }
    },
    async writeTextFile({ path, content }: { path: string; content: string }) {
      const target = translate(path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
    },
    async removePath(input: {
      path: string;
      force?: boolean;
      recursive?: boolean;
    }) {
      await rm(translate(input.path), {
        force: input.force ?? false,
        recursive: input.recursive ?? false,
      });
    },
    async setNetworkPolicy(policy: unknown) {
      networkPolicies.push(policy);
    },
  } as unknown as SandboxSession;

  return { commands, networkPolicies, sandbox };
}

function runShell(
  command: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    exec(command, { maxBuffer: 10_000_000 }, (error, stdout, stderr) => {
      resolve({
        exitCode:
          typeof error === "object" &&
            error !== null &&
            "code" in error &&
            typeof error.code === "number"
            ? error.code
            : error === null
            ? 0
            : 1,
        stdout,
        stderr,
      });
    });
  });
}

function commandResult(
  overrides: Partial<SandboxCommandResult> = {},
): SandboxCommandResult {
  return {
    exitCode: 0,
    stderr: "",
    stdout: "",
    ...overrides,
  } as SandboxCommandResult;
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
}
