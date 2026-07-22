import assert from "node:assert/strict";

import type { ToolContext } from "eve/tools";
import { ResultAsync } from "neverthrow";
import { afterEach, describe, test, vi } from "vitest";

import { PullRequestReadService } from "../repositories/pull-requests/service";
import type { RepositoryConfig } from "@paige/repositories/types";

const repository: RepositoryConfig = {
  id: "saleor-core",
  owner: "saleor",
  name: "saleor",
  role: "evidence",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pull request read service", () => {
  test("lists bounded pull request summaries with exact commit SHAs", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([
      summaryResponse(77),
      summaryResponse(76),
    ]));
    vi.stubGlobal("fetch", fetchMock);

    const { service, getSandbox } = createService();
    const result = await service.list({
      repositoryId: repository.id,
      state: "all",
      page: 2,
      limit: 1,
    });

    assert(result.isOk());
    assert.deepEqual(result.value, {
      items: [summaryOutput(77)],
      page: 2,
      nextPage: 3,
    });
    const url = fetchMock.mock.calls[0][0].toString();
    assert.match(url, /pulls\?/);
    assert.match(url, /state=all/);
    assert.match(url, /sort=updated/);
    assert.match(url, /direction=desc/);
    assert.match(url, /page=2/);
    assert.match(url, /per_page=2/);
    assert.equal(getSandbox.mock.calls.length, 0);
  });

  test("reads one pull request without mixing in files or comments", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      ...summaryResponse(77),
      body: "Explain the checkout change.",
      closed_at: null,
      merged_at: null,
      author_association: "MEMBER",
      labels: [{ name: "documentation" }, "customer-facing"],
      requested_reviewers: [{ login: "reviewer" }],
      commits: 3,
      changed_files: 2,
      additions: 40,
      deletions: 5,
      comments: 4,
      review_comments: 6,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createService().service.read({
      repositoryId: repository.id,
      pullRequestNumber: 77,
    });

    assert(result.isOk());
    assert.deepEqual(result.value, {
      ...summaryOutput(77),
      body: "Explain the checkout change.",
      headRef: "feature-77",
      merged: false,
      closedAt: null,
      mergedAt: null,
      authorAssociation: "MEMBER",
      labels: ["documentation", "customer-facing"],
      requestedReviewers: ["reviewer"],
      commitCount: 3,
      changedFileCount: 2,
      additions: 40,
      deletions: 5,
      conversationCommentCount: 4,
      inlineCommentCount: 6,
    });
    assert.match(fetchMock.mock.calls[0][0].toString(), /pulls\/77$/);
  });

  test("lists changed-file metadata without returning patch content", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([
      {
        filename: "src/new-name.ts",
        previous_filename: "src/old-name.ts",
        status: "renamed",
        sha: "blob-sha",
        additions: 5,
        deletions: 2,
        changes: 7,
        patch: "untrusted patch that must not be returned",
      },
    ]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createService().service.listFiles({
      repositoryId: repository.id,
      pullRequestNumber: 77,
      page: 1,
      limit: 20,
    });

    assert(result.isOk());
    assert.deepEqual(result.value, {
      items: [{
        path: "src/new-name.ts",
        previousPath: "src/old-name.ts",
        status: "renamed",
        blobSha: "blob-sha",
        additions: 5,
        deletions: 2,
        changes: 7,
      }],
      page: 1,
      nextPage: null,
    });
    assert.equal(JSON.stringify(result.value).includes("untrusted patch"), false);
    assert.match(fetchMock.mock.calls[0][0].toString(), /pulls\/77\/files\?/);
  });

  test("keeps conversation, review, and inline comments distinct", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse([{
        id: 1,
        user: { login: "alice" },
        author_association: "MEMBER",
        body: "General discussion",
        html_url: "https://github.com/saleor/saleor/pull/77#issuecomment-1",
        created_at: "2026-07-10T00:00:00Z",
        updated_at: "2026-07-10T01:00:00Z",
      }]))
      .mockResolvedValueOnce(jsonResponse([{
        id: 2,
        user: { login: "bob" },
        author_association: "COLLABORATOR",
        body: "Review summary",
        html_url: "https://github.com/saleor/saleor/pull/77#pullrequestreview-2",
        state: "APPROVED",
        submitted_at: "2026-07-11T00:00:00Z",
        commit_id: "reviewed-sha",
      }]))
      .mockResolvedValueOnce(jsonResponse([{
        id: 3,
        user: null,
        author_association: "NONE",
        body: "Inline concern",
        html_url: "https://github.com/saleor/saleor/pull/77#discussion_r3",
        created_at: "2026-07-12T00:00:00Z",
        updated_at: "2026-07-12T01:00:00Z",
        path: "src/checkout.ts",
        line: 42,
        start_line: 40,
        side: "RIGHT",
        start_side: "RIGHT",
        original_line: 39,
        commit_id: "head-sha-77",
        original_commit_id: "original-sha",
        in_reply_to_id: 2,
      }]));
    vi.stubGlobal("fetch", fetchMock);
    const service = createService().service;

    const conversation = await service.listComments({
      repositoryId: repository.id,
      pullRequestNumber: 77,
      commentKind: "conversation",
      page: 1,
      limit: 20,
    });
    const review = await service.listComments({
      repositoryId: repository.id,
      pullRequestNumber: 77,
      commentKind: "review",
      page: 1,
      limit: 20,
    });
    const inline = await service.listComments({
      repositoryId: repository.id,
      pullRequestNumber: 77,
      commentKind: "inline",
      page: 1,
      limit: 20,
    });

    assert(conversation.isOk());
    assert(review.isOk());
    assert(inline.isOk());
    assert.equal(conversation.value.items[0]?.kind, "conversation");
    assert.equal(review.value.items[0]?.kind, "review");
    assert.deepEqual(inline.value.items[0], {
      kind: "inline",
      id: 3,
      author: null,
      authorAssociation: "NONE",
      body: "Inline concern",
      url: "https://github.com/saleor/saleor/pull/77#discussion_r3",
      createdAt: "2026-07-12T00:00:00Z",
      updatedAt: "2026-07-12T01:00:00Z",
      path: "src/checkout.ts",
      line: 42,
      startLine: 40,
      side: "RIGHT",
      startSide: "RIGHT",
      originalLine: 39,
      commitSha: "head-sha-77",
      originalCommitSha: "original-sha",
      inReplyToId: 2,
    });
    assert.match(fetchMock.mock.calls[0][0].toString(), /issues\/77\/comments\?/);
    assert.match(fetchMock.mock.calls[1][0].toString(), /pulls\/77\/reviews\?/);
    assert.match(fetchMock.mock.calls[2][0].toString(), /pulls\/77\/comments\?/);
  });

  test("rejects invalid input before authentication or network access", async () => {
    let tokenRequests = 0;
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const { ctx } = createContext();
    const service = new PullRequestReadService(ctx, {
      repositories: [repository],
      getGitHubToken: () => {
        tokenRequests += 1;
        return ResultAsync.fromSafePromise(Promise.resolve("token"));
      },
    });

    const invalidNumber = await service.read({
      repositoryId: repository.id,
      pullRequestNumber: 0,
    });
    const invalidLimit = await service.listFiles({
      repositoryId: repository.id,
      pullRequestNumber: 77,
      page: 1,
      limit: 51,
    });
    const unconfigured = await service.read({
      repositoryId: "unconfigured",
      pullRequestNumber: 77,
    });

    assert(invalidNumber.isErr());
    assert.equal(invalidNumber.error.code, "REPOSITORY_INVALID_INPUT");
    assert(invalidLimit.isErr());
    assert.equal(invalidLimit.error.code, "REPOSITORY_INVALID_INPUT");
    assert(unconfigured.isErr());
    assert.equal(unconfigured.error.code, "REPOSITORY_NOT_CONFIGURED");
    assert.equal(tokenRequests, 0);
    assert.equal(fetchMock.mock.calls.length, 0);
  });

  test("fails closed on malformed GitHub responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        number: 77,
        title: "Missing required pull request fields",
      })),
    );

    const result = await createService().service.read({
      repositoryId: repository.id,
      pullRequestNumber: 77,
    });

    assert(result.isErr());
    assert.equal(result.error.code, "REPOSITORY_GITHUB_FAILED");
    assert.match(result.error.message, /pull request response is invalid/);
  });
});

function createService() {
  const { ctx, getSandbox } = createContext();
  return {
    service: new PullRequestReadService(ctx, {
      repositories: [repository],
      getGitHubToken: () =>
        ResultAsync.fromSafePromise(Promise.resolve("secret-token")),
    }),
    getSandbox,
  };
}

function createContext() {
  const getSandbox = vi.fn<ToolContext["getSandbox"]>();
  return {
    ctx: {
      abortSignal: new AbortController().signal,
      getSandbox,
    } as unknown as ToolContext,
    getSandbox,
  };
}

function summaryResponse(number: number) {
  return {
    number,
    title: `Pull request ${number}`,
    state: "open",
    html_url: `https://github.com/saleor/saleor/pull/${number}`,
    draft: false,
    user: { login: "author" },
    head: { sha: `head-sha-${number}`, ref: `feature-${number}` },
    base: { sha: `base-sha-${number}`, ref: "main" },
    created_at: "2026-07-10T00:00:00Z",
    updated_at: "2026-07-13T10:11:12Z",
  };
}

function summaryOutput(number: number) {
  return {
    number,
    title: `Pull request ${number}`,
    state: "open",
    url: `https://github.com/saleor/saleor/pull/${number}`,
    draft: false,
    author: "author",
    headCommitSha: `head-sha-${number}`,
    baseCommitSha: `base-sha-${number}`,
    baseRef: "main",
    createdAt: "2026-07-10T00:00:00Z",
    updatedAt: "2026-07-13T10:11:12Z",
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
}
