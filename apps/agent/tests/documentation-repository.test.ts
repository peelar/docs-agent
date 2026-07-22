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

import { DocumentationEditor } from "../repositories/documentation/editor";
import { GitHubPublisher } from "../repositories/documentation/github-publisher";
import {
  DocumentationPublisher,
  type PublishInput,
} from "../repositories/documentation/publish";
import { PublishCheckpoint } from "../repositories/documentation/publish-checkpoint";
import { SandboxShell } from "../repositories/documentation/sandbox-shell";
import type {
  PublishRequest,
  WorkspaceRecord,
} from "../repositories/documentation/workspace-record";
import { DocumentationWorkspace } from "../repositories/documentation/workspace";
import { createGitHubRequest } from "@paige/repositories/github";
import type {
  DocumentationRepository,
  RepositoryWorkspace,
  ResolvedRepository,
} from "@paige/repositories/types";

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
  test("reuses a clean detached workspace at its recorded base", async () => {
    const fixture = await createFixture();

    const result = await openDocumentationWorkspace({
      sandbox: fixture.sandbox,
      cache: fixture.cache,
      abortSignal: fixture.abortSignal,
    });

    assert(result.isOk());
    await assertWorkspaceAtBase(fixture);
  });

  test("reuses only a clean matching worktree and protects existing edits", async () => {
    const fixture = await createFixture();
    await writeFile(
      fixture.actualPath("worktrees/saleor-docs/README.md"),
      "dirty\n",
    );

    const result = await openDocumentationWorkspace({
      sandbox: fixture.sandbox,
      cache: fixture.cache,
      abortSignal: fixture.abortSignal,
    });

    assert(result.isErr());
    assert.equal(result.error.code, "REPOSITORY_DIRTY_WORKSPACE");
  });

  test("checkpoints an interrupted reviewed change on the next operation", async () => {
    const fixture = await createFixture();
    await writeDocumentationFile({
      ...fixture.operation,
      path: "README.md",
      content: "reviewed\n",
    });
    const review = await reviewDocumentation(fixture.operation);
    assert(review.isOk());
    assert(review.value.reviewId);
    await savePublishRequest(fixture, {
      reviewId: review.value.reviewId,
      branch: "paige/interrupted-draft",
      commitMessage: "docs: update readme",
    });

    const result = await openDocumentationWorkspace({
      sandbox: fixture.sandbox,
      cache: fixture.cache,
      abortSignal: fixture.abortSignal,
    });

    assert(result.isOk(), result.isErr() ? result.error.message : "");
    await assertWorkspaceAtBase(fixture);
    const localCommit = await fixture.run(
      `git -C '${fixture.actualPath("worktrees/saleor-docs")}' rev-parse refs/heads/paige/interrupted-draft`,
    );
    assert.equal(localCommit.exitCode, 0);
    assert.notEqual(
      localCommit.stdout.trim(),
      fixture.record.baseCommitSha,
    );
  });

  test("preserves post-review edits and refuses recovery", async () => {
    const fixture = await createFixture();
    await writeDocumentationFile({
      ...fixture.operation,
      path: "README.md",
      content: "reviewed\n",
    });
    const review = await reviewDocumentation(fixture.operation);
    assert(review.isOk());
    assert(review.value.reviewId);
    await savePublishRequest(fixture, {
      reviewId: review.value.reviewId,
      branch: "paige/post-review-drift",
      commitMessage: "docs: update readme",
    });
    await writeDocumentationFile({
      ...fixture.operation,
      path: "README.md",
      content: "changed after review\n",
    });

    const result = await openDocumentationWorkspace({
      sandbox: fixture.sandbox,
      cache: fixture.cache,
      abortSignal: fixture.abortSignal,
    });

    assert(result.isErr());
    assert.equal(result.error.code, "REPOSITORY_DIRTY_WORKSPACE");
    const content = await readFile(
      fixture.actualPath("worktrees/saleor-docs/README.md"),
      "utf8",
    );
    assert.equal(content, "changed after review\n");
  });

  test("rejects a clean unknown branch without deleting it", async () => {
    const fixture = await createFixture();
    const created = await fixture.run(
      `git -C '${fixture.actualPath("worktrees/saleor-docs")}' switch -c unknown/manual`,
    );
    assert.equal(created.exitCode, 0);

    const result = await openDocumentationWorkspace({
      sandbox: fixture.sandbox,
      cache: fixture.cache,
      abortSignal: fixture.abortSignal,
    });

    assert(result.isErr());
    assert.equal(result.error.code, "REPOSITORY_CONFLICT");
    assert.match(result.error.message, /unknown branch or commit/);
    const branch = await fixture.run(
      `git -C '${fixture.actualPath("worktrees/saleor-docs")}' symbolic-ref --quiet --short HEAD`,
    );
    assert.equal(branch.stdout.trim(), "unknown/manual");
  });

  test("restores publish leftovers before moving to a new remote base", async () => {
    const fixture = await createFixture();
    await writeDocumentationFile({
      ...fixture.operation,
      path: "README.md",
      content: "reviewed\n",
    });
    const review = await reviewDocumentation(fixture.operation);
    assert(review.isOk());
    assert(review.value.reviewId);
    await savePublishRequest(fixture, {
      reviewId: review.value.reviewId,
      branch: "paige/moved-base",
      commitMessage: "docs: update readme",
    });
    await writeFile(
      fixture.actualPath("repositories/saleor-docs/REMOTE.md"),
      "new base\n",
    );
    await fixture.run(
      `git -C '${fixture.actualPath("repositories/saleor-docs")}' add REMOTE.md`,
    );
    await fixture.run(
      `git -C '${fixture.actualPath("repositories/saleor-docs")}' commit -q -m 'new base'`,
    );
    const moved = await fixture.run(
      `git -C '${fixture.actualPath("repositories/saleor-docs")}' rev-parse HEAD`,
    );
    const movedCommitSha = moved.stdout.trim();

    const result = await openDocumentationWorkspace({
      sandbox: fixture.sandbox,
      cache: {
        ...fixture.cache,
        repository: {
          ...fixture.repository,
          commitSha: movedCommitSha,
        },
      },
      abortSignal: fixture.abortSignal,
    });

    assert(result.isOk(), result.isErr() ? result.error.message : "");
    assert.equal(result.value.baseCommitSha, movedCommitSha);
    const head = await fixture.run(
      `git -C '${fixture.actualPath("worktrees/saleor-docs")}' rev-parse HEAD`,
    );
    assert.equal(head.stdout.trim(), movedCommitSha);
  });

  test(
    "includes tracked, deleted, and untracked text in a stable review ID",
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

      const first = await reviewDocumentation(fixture.operation);
      const second = await reviewDocumentation(fixture.operation);

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
      assert.equal(first.value.reviewId, second.value.reviewId);

      await writeDocumentationFile({
        ...fixture.operation,
        path: "docs/new.md",
        content: "changed after review\n",
      });
      const drifted = await reviewDocumentation(fixture.operation);
      assert(drifted.isOk());
      assert.notEqual(drifted.value.reviewId, first.value.reviewId);
    },
    15_000,
  );

  test("rejects symlink traversal and binary changed files", async () => {
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
    assert.equal(symlinkWrite.error.code, "REPOSITORY_CHANGES_REJECTED");

    await rm(fixture.actualPath("worktrees/saleor-docs/linked"));
    await writeFile(
      fixture.actualPath("worktrees/saleor-docs/binary.dat"),
      Buffer.from([0, 1, 2, 3]),
    );
    const binaryDiff = await reviewDocumentation(fixture.operation);
    assert(binaryDiff.isErr());
    assert.equal(binaryDiff.error.code, "REPOSITORY_CHANGES_REJECTED");
    assert.match(binaryDiff.error.message, /binary/);
  });

  test("rejects changes that exceed the review file limit", async () => {
    const fixture = await createFixture();
    const changes = fixture.actualPath("worktrees/saleor-docs/changes");
    await mkdir(changes, { recursive: true });
    await Promise.all(
      Array.from({ length: 51 }, async (_, index) =>
        await writeFile(join(changes, `${index}.md`), `${index}\n`)
      ),
    );

    const result = await reviewDocumentation(fixture.operation);

    assert(result.isErr());
    assert.equal(result.error.code, "REPOSITORY_CHANGES_REJECTED");
    assert.match(result.error.message, /51 files/);
  });
});

describe("documentation publishing", () => {
  test("replays publish from an interrupted reviewed change", async () => {
    const fixture = await createFixture();
    await writeDocumentationFile({
      ...fixture.operation,
      path: "README.md",
      content: "reviewed\n",
    });
    const review = await reviewDocumentation(fixture.operation);
    assert(review.isOk());
    assert(review.value.reviewId);
    await savePublishRequest(fixture, {
      reviewId: review.value.reviewId,
      branch: "paige/interrupted-publish",
      commitMessage: "docs: update readme",
    });
    const remoteCommit = "d".repeat(40);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({
        default_branch: "main",
        private: true,
      }))
      .mockResolvedValueOnce(jsonResponse({
        sha: fixture.record.baseCommitSha,
      }))
      .mockResolvedValueOnce(jsonResponse({
        object: { sha: fixture.record.baseCommitSha },
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
        parents: [{ sha: fixture.record.baseCommitSha }],
        files: [{ filename: "README.md", status: "modified" }],
      }))
      .mockResolvedValueOnce(jsonResponse({
        type: "file",
        encoding: "base64",
        content: Buffer.from("reviewed\n").toString("base64"),
      }))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({
        number: 46,
        html_url: "https://github.com/peelar/saleor-docs/pull/46",
        draft: true,
      }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await publishDocumentation({
      sandbox: fixture.sandbox,
      repository: fixture.repository,
      github: fixture.github,
      abortSignal: fixture.abortSignal,
      input: {
        reviewId: review.value.reviewId,
        branch: "paige/interrupted-publish",
        commitMessage: "docs: update readme",
        pullRequestTitle: "Update readme",
        pullRequestBody: "Prepared by Paige.",
      },
    });

    assert(result.isOk(), result.isErr() ? result.error.message : "");
    assert.equal(result.value.commit.commitSha, remoteCommit);
    assert.equal(result.value.pullRequest.number, 46);
    assert.equal(result.value.resumed, true);
    await assertWorkspaceAtBase(fixture);
    const localCommit = await fixture.run(
      `git -C '${fixture.actualPath("worktrees/saleor-docs")}' rev-parse refs/heads/paige/interrupted-publish`,
    );
    assert.equal(localCommit.exitCode, 0);
    assert.notEqual(
      localCommit.stdout.trim(),
      fixture.record.baseCommitSha,
    );
  });

  test("preserves workspace changes that no longer match the review", async () => {
    const fixture = await createFixture();
    await writeDocumentationFile({
      ...fixture.operation,
      path: "README.md",
      content: "reviewed\n",
    });
    const review = await reviewDocumentation(fixture.operation);
    assert(review.isOk());
    assert(review.value.reviewId);
    await writeDocumentationFile({
      ...fixture.operation,
      path: "README.md",
      content: "changed after review\n",
    });

    const result = await publishDocumentation({
      sandbox: fixture.sandbox,
      repository: fixture.repository,
      github: fixture.github,
      abortSignal: fixture.abortSignal,
      input: {
        reviewId: review.value.reviewId,
        branch: "paige/drifted",
        commitMessage: "docs: update readme",
        pullRequestTitle: "Update readme",
        pullRequestBody: "Prepared by Paige.",
      },
    });

    assert(result.isErr());
    assert.equal(result.error.code, "REPOSITORY_REVIEW_MISMATCH");
    const content = await readFile(
      fixture.actualPath("worktrees/saleor-docs/README.md"),
      "utf8",
    );
    assert.equal(content, "changed after review\n");
  });

  test("stages exactly the reviewed paths and reuses the publish checkpoint", async () => {
    const fixture = await createFixture();
    await writeDocumentationFile({
      ...fixture.operation,
      path: "docs/new.md",
      content: "reviewed\n",
    });
    const review = await reviewDocumentation(fixture.operation);
    assert(review.isOk());
    assert(review.value.reviewId);

    const commit = await createPublishCheckpoint({
      ...fixture.operation,
      branch: "paige/reviewed-docs",
      message: "docs: add reviewed page",
      changedFiles: review.value.changedFiles,
    });
    assert(
      commit.isOk(),
      commit.isErr() ? `${commit.error.code}: ${commit.error.message}` : "",
    );
    const committedPaths = await fixture.run(
      `git -C '${fixture.actualPath("worktrees/saleor-docs")}' diff --name-only '${fixture.record.baseCommitSha}' '${commit.value.commitSha}'`,
    );
    assert.equal(committedPaths.stdout.trim(), "docs/new.md");

    const retried = await findPublishCheckpoint({
      ...fixture.operation,
      input: {
        reviewId: review.value.reviewId,
        branch: "paige/reviewed-docs",
        commitMessage: "docs: add reviewed page",
      },
    });
    assert(retried.isOk());
    assert.equal(retried.value?.commitSha, commit.value.commitSha);

    await savePublishRequest(fixture, {
      reviewId: review.value.reviewId,
      branch: "paige/reviewed-docs",
      commitMessage: "docs: add reviewed page",
    });
    const reopened = await openDocumentationWorkspace({
      sandbox: fixture.sandbox,
      cache: fixture.cache,
      abortSignal: fixture.abortSignal,
    });
    assert(
      reopened.isOk(),
      reopened.isErr() ? reopened.error.message : "",
    );
    await assertWorkspaceAtBase(fixture);

    const driftedRequest = await findPublishCheckpoint({
      ...fixture.operation,
      input: {
        reviewId: `sha256:${"0".repeat(64)}`,
        branch: "paige/reviewed-docs",
        commitMessage: "docs: add reviewed page",
      },
    });
    assert(driftedRequest.isErr());
    assert.equal(
      driftedRequest.error.code,
      "REPOSITORY_REVIEW_MISMATCH",
    );
  });

  test("refuses publishing when the remote base moved", async () => {
    const fixture = await createFixture();
    await writeDocumentationFile({
      ...fixture.operation,
      path: "README.md",
      content: "reviewed\n",
    });
    const review = await reviewDocumentation(fixture.operation);
    assert(review.isOk());
    assert(review.value.reviewId);
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

    const result = await publishDocumentation({
      sandbox: fixture.sandbox,
      repository: fixture.repository,
      github: fixture.github,
      abortSignal: fixture.abortSignal,
      input: {
        reviewId: review.value.reviewId,
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
    const nextOperation = await openDocumentationWorkspace({
      sandbox: fixture.sandbox,
      cache: fixture.cache,
      abortSignal: fixture.abortSignal,
    });
    assert(nextOperation.isOk());
    await assertWorkspaceAtBase(fixture);
  });

  test("reuses a completed branch and pull request before checking a moved base", async () => {
    const fixture = await createFixture();
    await writeDocumentationFile({
      ...fixture.operation,
      path: "README.md",
      content: "reviewed\n",
    });
    const review = await reviewDocumentation(fixture.operation);
    assert(review.isOk());
    assert(review.value.reviewId);
    const commit = await createPublishCheckpoint({
      ...fixture.operation,
      branch: "paige/completed-retry",
      message: "docs: update readme",
      changedFiles: review.value.changedFiles,
    });
    assert(commit.isOk());
    await savePublishRequest(fixture, {
      reviewId: review.value.reviewId,
      branch: "paige/completed-retry",
      commitMessage: "docs: update readme",
    });
    const remoteCommit = "b".repeat(40);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        object: { sha: remoteCommit },
      }))
      .mockResolvedValueOnce(jsonResponse({
        commit: { message: "docs: update readme" },
        parents: [{ sha: fixture.record.baseCommitSha }],
        files: [{ filename: "README.md", status: "modified" }],
      }))
      .mockResolvedValueOnce(jsonResponse({
        type: "file",
        encoding: "base64",
        content: Buffer.from("reviewed\n").toString("base64"),
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

    const result = await publishDocumentation({
      sandbox: fixture.sandbox,
      repository: fixture.repository,
      github: fixture.github,
      abortSignal: fixture.abortSignal,
      input: {
        reviewId: review.value.reviewId,
        branch: "paige/completed-retry",
        commitMessage: "docs: update readme",
        pullRequestTitle: "Update readme",
        pullRequestBody: "Prepared by Paige.",
      },
    });

    assert(result.isOk());
    assert.equal(result.value.resumed, true);
    assert.equal(result.value.commit.commitSha, remoteCommit);
    assert.equal(result.value.pullRequest.number, 44);
    assert.equal(fetchMock.mock.calls.length, 4);
  });

  test("retries a publish checkpoint through GitHub without sandbox credentials", async () => {
    const fixture = await createFixture();
    await writeDocumentationFile({
      ...fixture.operation,
      path: "README.md",
      content: "reviewed\n",
    });
    const review = await reviewDocumentation(fixture.operation);
    assert(review.isOk());
    assert(review.value.reviewId);
    const localCommit = await createPublishCheckpoint({
      ...fixture.operation,
      branch: "paige/manual-test",
      message: "docs: update readme",
      changedFiles: review.value.changedFiles,
    });
    assert(localCommit.isOk());
    await savePublishRequest(fixture, {
      reviewId: review.value.reviewId,
      branch: "paige/manual-test",
      commitMessage: "docs: update readme",
    });
    const remoteCommit = "a".repeat(40);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({
        default_branch: "main",
        private: true,
      }))
      .mockResolvedValueOnce(jsonResponse({
        sha: fixture.record.baseCommitSha,
      }))
      .mockResolvedValueOnce(jsonResponse({
        object: { sha: fixture.record.baseCommitSha },
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
        parents: [{ sha: fixture.record.baseCommitSha }],
        files: [{ filename: "README.md", status: "modified" }],
      }))
      .mockResolvedValueOnce(jsonResponse({
        type: "file",
        encoding: "base64",
        content: Buffer.from("reviewed\n").toString("base64"),
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

    const result = await publishDocumentation({
      sandbox: fixture.sandbox,
      repository: fixture.repository,
      github: fixture.github,
      abortSignal: fixture.abortSignal,
      input: {
        reviewId: review.value.reviewId,
        branch: "paige/manual-test",
        commitMessage: "docs: update readme",
        pullRequestTitle: "Update readme",
        pullRequestBody: "Prepared by Paige.",
      },
    });

    assert(result.isOk(), result.isErr() ? result.error.message : "");
    assert.equal(result.value.commit.commitSha, remoteCommit);
    assert.equal(result.value.pullRequest.number, 45);
    assert.equal(result.value.resumed, true);
    assert.equal(fixture.networkPolicies.length, 0);
    assert.equal(
      fixture.commands.some((command) => command.includes(" push origin ")),
      false,
    );
    const mutation = fetchMock.mock.calls[4];
    assert.equal(mutation[0], "https://api.github.com/graphql");
    assert.equal(
      String(mutation[1]?.body).includes(
        Buffer.from("reviewed\n").toString("base64"),
      ),
      true,
    );
    assert.equal(
      String(mutation[1]?.body).includes("secret-token"),
      false,
    );

    const retryFetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        object: { sha: remoteCommit },
      }))
      .mockResolvedValueOnce(jsonResponse({
        commit: { message: "docs: update readme" },
        parents: [{ sha: fixture.record.baseCommitSha }],
        files: [{ filename: "README.md", status: "modified" }],
      }))
      .mockResolvedValueOnce(jsonResponse({
        type: "file",
        encoding: "base64",
        content: Buffer.from("reviewed\n").toString("base64"),
      }))
      .mockResolvedValueOnce(jsonResponse([
        {
          number: 45,
          html_url: "https://github.com/peelar/saleor-docs/pull/45",
          title: "Update readme",
          body: "Prepared by Paige.",
          draft: true,
        },
      ]));
    vi.stubGlobal("fetch", retryFetchMock);

    const retried = await publishDocumentation({
      sandbox: fixture.sandbox,
      repository: fixture.repository,
      github: fixture.github,
      abortSignal: fixture.abortSignal,
      input: {
        reviewId: review.value.reviewId,
        branch: "paige/manual-test",
        commitMessage: "docs: update readme",
        pullRequestTitle: "Update readme",
        pullRequestBody: "Prepared by Paige.",
      },
    });

    assert(retried.isOk(), retried.isErr() ? retried.error.message : "");
    assert.equal(retried.value.resumed, true);
    assert.equal(retried.value.pullRequest.number, 45);
  });

  test("restores the workspace after conflicting pull request metadata", async () => {
    const fixture = await createFixture();
    await writeDocumentationFile({
      ...fixture.operation,
      path: "paige-manual-test.md",
      content: "Paige manual test.\n",
    });
    const review = await reviewDocumentation(fixture.operation);
    assert(review.isOk());
    assert(review.value.reviewId);
    const remoteCommit = "c".repeat(40);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>()
        .mockResolvedValueOnce(jsonResponse({
          default_branch: "main",
          private: true,
        }))
        .mockResolvedValueOnce(jsonResponse({
          sha: fixture.record.baseCommitSha,
        }))
        .mockResolvedValueOnce(jsonResponse({
          object: { sha: remoteCommit },
        }))
        .mockResolvedValueOnce(jsonResponse({
          commit: { message: "Add paige-manual-test.md" },
          parents: [{ sha: fixture.record.baseCommitSha }],
          files: [{
            filename: "paige-manual-test.md",
            status: "added",
          }],
        }))
        .mockResolvedValueOnce(jsonResponse({
          type: "file",
          encoding: "base64",
          content: Buffer.from("Paige manual test.\n").toString("base64"),
        }))
        .mockResolvedValueOnce(jsonResponse([
          {
            number: 3,
            html_url: "https://github.com/peelar/saleor-docs/pull/3",
            title: "Old manual test title",
            body: "Old manual test body.",
            draft: true,
          },
        ])),
    );

    const result = await publishDocumentation({
      sandbox: fixture.sandbox,
      repository: fixture.repository,
      github: fixture.github,
      abortSignal: fixture.abortSignal,
      input: {
        reviewId: review.value.reviewId,
        branch: "paige/manual-test",
        commitMessage: "Add paige-manual-test.md",
        pullRequestTitle: "New manual test title",
        pullRequestBody: "New manual test body.",
      },
    });

    assert(result.isErr());
    assert.equal(result.error.code, "REPOSITORY_CONFLICT");
    assert.match(result.error.message, /different requested details/);

    const reopened = await openDocumentationWorkspace({
      sandbox: fixture.sandbox,
      cache: fixture.cache,
      abortSignal: fixture.abortSignal,
    });
    assert(reopened.isOk());
    await assertWorkspaceAtBase(fixture);

    const localBranch = await fixture.run(
      `git -C '${fixture.actualPath("worktrees/saleor-docs")}' rev-parse refs/heads/paige/manual-test`,
    );
    assert.equal(localBranch.exitCode, 0);
  });

  test("fails closed when GitHub rejects the atomic documentation commit", async () => {
    const fixture = await createFixture();
    await writeDocumentationFile({
      ...fixture.operation,
      path: "README.md",
      content: "reviewed\n",
    });
    const review = await reviewDocumentation(fixture.operation);
    assert(review.isOk());
    assert(review.value.reviewId);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>()
        .mockResolvedValueOnce(jsonResponse({
          default_branch: "main",
          private: true,
        }))
        .mockResolvedValueOnce(jsonResponse({
          sha: fixture.record.baseCommitSha,
        }))
        .mockResolvedValueOnce(new Response(null, { status: 404 }))
        .mockResolvedValueOnce(jsonResponse({
          object: { sha: fixture.record.baseCommitSha },
        }))
        .mockResolvedValueOnce(jsonResponse({
          data: { createCommitOnBranch: null },
          errors: [{ message: "permission denied" }],
        })),
    );

    const result = await publishDocumentation({
      sandbox: fixture.sandbox,
      repository: fixture.repository,
      github: fixture.github,
      abortSignal: fixture.abortSignal,
      input: {
        reviewId: review.value.reviewId,
        branch: "paige/publish-failure",
        commitMessage: "docs: update readme",
        pullRequestTitle: "Update readme",
        pullRequestBody: "Prepared by Paige.",
      },
    });

    assert(result.isErr());
    assert.equal(result.error.code, "REPOSITORY_GITHUB_FAILED");
    assert.equal(fixture.networkPolicies.length, 0);
    const nextOperation = await openDocumentationWorkspace({
      sandbox: fixture.sandbox,
      cache: fixture.cache,
      abortSignal: fixture.abortSignal,
    });
    assert(nextOperation.isOk());
    await assertWorkspaceAtBase(fixture);
  });
});

function openDocumentationWorkspace(input: {
  sandbox: SandboxSession;
  cache: RepositoryWorkspace<DocumentationRepository>;
  abortSignal: AbortSignal;
}) {
  return new DocumentationWorkspace(input).open(input.cache);
}

function writeDocumentationFile(input: {
  sandbox: SandboxSession;
  record: WorkspaceRecord;
  abortSignal: AbortSignal;
  path: string;
  content: string;
}) {
  return new DocumentationEditor(input).write(input);
}

function removeDocumentationFile(input: {
  sandbox: SandboxSession;
  record: WorkspaceRecord;
  abortSignal: AbortSignal;
  path: string;
}) {
  return new DocumentationEditor(input).remove(input);
}

function reviewDocumentation(input: {
  sandbox: SandboxSession;
  record: WorkspaceRecord;
  abortSignal: AbortSignal;
}) {
  return new DocumentationEditor(input).review();
}

async function createPublishCheckpoint(input: {
  sandbox: SandboxSession;
  record: WorkspaceRecord;
  abortSignal: AbortSignal;
  branch: string;
  message: string;
  changedFiles: string[];
}) {
  return await new PublishCheckpoint(new SandboxShell(input)).create(input);
}

async function findPublishCheckpoint(input: {
  sandbox: SandboxSession;
  record: WorkspaceRecord;
  abortSignal: AbortSignal;
  input: PublishRequest;
}) {
  return await new PublishCheckpoint(new SandboxShell(input)).find({
    record: input.record,
    publishRequest: input.input,
  });
}

async function publishDocumentation(input: {
  sandbox: SandboxSession;
  repository: DocumentationRepository;
  github: GitHubPublisher;
  abortSignal: AbortSignal;
  input: PublishInput;
}) {
  const workspace = new DocumentationWorkspace(input);
  const loaded = await workspace.reopen(input.repository);
  if (loaded.isErr()) return loaded;
  return await new DocumentationPublisher({
    sandbox: input.sandbox,
    record: loaded.value,
    abortSignal: input.abortSignal,
    github: input.github,
  }).publish(input.input);
}

async function assertWorkspaceAtBase(
  fixture: Awaited<ReturnType<typeof createFixture>>,
) {
  const head = await fixture.run(
    `git -C '${fixture.actualPath("worktrees/saleor-docs")}' rev-parse HEAD`,
  );
  const status = await fixture.run(
    `git -C '${fixture.actualPath("worktrees/saleor-docs")}' status --porcelain=v1`,
  );
  const branch = await fixture.run(
    `git -C '${fixture.actualPath("worktrees/saleor-docs")}' symbolic-ref --quiet --short HEAD`,
  );
  assert.equal(head.stdout.trim(), fixture.record.baseCommitSha);
  assert.equal(status.stdout.trim(), "");
  assert.equal(branch.exitCode, 1);
}

async function savePublishRequest(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  publishRequest: NonNullable<
    WorkspaceRecord["publishRequest"]
  >,
) {
  await fixture.sandbox.writeTextFile({
    path: "/workspace/worktrees/.saleor-docs.json",
    content: `${JSON.stringify({
      ...fixture.record,
      publishRequest: publishRequest,
    })}\n`,
    abortSignal: fixture.abortSignal,
  });
}

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
  const github = new GitHubPublisher(
    repository,
    createGitHubRequest({
      token: "secret-token",
      abortSignal,
    }),
  );
  const opened = await openDocumentationWorkspace({
    sandbox: local.sandbox,
    cache,
    abortSignal,
  });
  assert(opened.isOk());
  const record: WorkspaceRecord = {
    version: 2,
    path: opened.value.path,
    cachePath: cache.path,
    repository,
    baseBranch: opened.value.baseBranch,
    baseCommitSha: opened.value.baseCommitSha,
  };

  return {
    ...local,
    abortSignal,
    cache,
    github,
    operation: {
      sandbox: local.sandbox,
      record,
      abortSignal,
    },
    repository,
    record,
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
