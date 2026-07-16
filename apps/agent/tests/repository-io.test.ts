import assert from "node:assert/strict";

import type { SandboxCommandResult, SandboxSession } from "eve/sandbox";
import type { ToolContext } from "eve/tools";
import { err, ok, ResultAsync } from "neverthrow";
import { afterEach, describe, test, vi } from "vitest";

import {
  checkoutRepositoryRevision,
  ensureRepositoryRevisions,
} from "../repositories/git";
import {
  compareRepositoryRevisions,
  readRepositoryFile,
  searchRepository,
} from "../repositories/inspection";
import { RepositoryService } from "../repositories/service";
import { RepositoryError } from "../repositories/shared/errors";
import { resolveGitHubRevision } from "../repositories/shared/github";
import { serializeSandbox } from "../repositories/shared/serialization";
import type {
  RepositoryConfig,
  RepositoryWorkspace,
  ResolvedRepository,
} from "../repositories/types";

const repository: RepositoryConfig = {
  id: "saleor-core",
  owner: "saleor",
  name: "saleor",
  role: "evidence",
};
const resolvedRepository: ResolvedRepository = {
  ...repository,
  isPrivate: false,
  ref: "main",
  resolvedRevision: "0123456789abcdef0123456789abcdef01234567",
};
const workspace: RepositoryWorkspace = {
  path: "/workspace/repositories/saleor-core",
  repository: resolvedRepository,
};
const remoteUrl = "https://github.com/saleor/saleor.git";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("repository sandbox serialization", () => {
  test("runs tasks for one sandbox sequentially", async () => {
    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;
    let markFirstStarted: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });

    const first = serializeSandbox(
      "sandbox-1",
      () =>
        new ResultAsync(
          (async () => {
            events.push("first:start");
            markFirstStarted?.();
            await firstGate;
            events.push("first:end");
            return ok("first");
          })(),
        ),
    );
    const second = serializeSandbox(
      "sandbox-1",
      () =>
        new ResultAsync(
          Promise.resolve().then(() => {
            events.push("second:start");
            return ok("second");
          }),
        ),
    );

    await firstStarted;
    assert.deepEqual(events, ["first:start"]);

    assert.ok(releaseFirst);
    releaseFirst();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    assert(firstResult.isOk());
    assert(secondResult.isOk());
    assert.deepEqual(events, ["first:start", "first:end", "second:start"]);
  });

  test("continues the queue after an unexpected rejection", async () => {
    const failure = new Error("sandbox disconnected");
    const first = serializeSandbox(
      "sandbox-rejection",
      () => new ResultAsync(Promise.reject(failure)),
    );
    let secondRan = false;
    const second = serializeSandbox(
      "sandbox-rejection",
      () =>
        new ResultAsync(
          Promise.resolve().then(() => {
            secondRan = true;
            return ok("recovered");
          }),
        ),
    );

    await assert.rejects(async () => await first, failure);
    const secondResult = await second;

    assert(secondResult.isOk());
    assert.equal(secondResult.value, "recovered");
    assert.equal(secondRan, true);
  });
});

describe("Git repository cache", () => {
  test("reuses a cached shallow repository when the commit is already present", async () => {
    const sandbox = createSandbox({
      run: commandSequence([
        commandResult(),
        commandResult({ stdout: `${remoteUrl}\n` }),
        commandResult(),
        commandResult(),
      ]),
    });

    const result = await ensureRepositoryRevisions({
      sandbox,
      repository,
      revisions: [resolvedRepository],
      token: "token",
      abortSignal: new AbortController().signal,
    });

    assert(result.isOk());
    assert.deepEqual(result.value, [workspace]);
    assert.equal(sandbox.setNetworkPolicy.mock.calls.length, 0);
    assert.equal(sandbox.removePath.mock.calls.length, 0);
  });

  test("initializes and shallow-fetches a missing revision with brokered auth", async () => {
    const sandbox = createSandbox({
      run: commandSequence([
        commandResult({ exitCode: 1 }),
        commandResult(),
        commandResult({ exitCode: 1 }),
        commandResult(),
        commandResult(),
      ]),
    });

    const result = await ensureRepositoryRevisions({
      sandbox,
      repository,
      revisions: [resolvedRepository],
      token: "secret-token",
      abortSignal: new AbortController().signal,
    });

    assert(result.isOk());
    assert.match(
      sandbox.run.mock.calls[1][0].command,
      /git init && git remote add origin/,
    );
    assert.match(
      sandbox.run.mock.calls[3][0].command,
      new RegExp(
        `git fetch --depth=1 --no-tags origin '${resolvedRepository.resolvedRevision}'`,
      ),
    );
    assert.deepEqual(sandbox.setNetworkPolicy.mock.calls[1], ["deny-all"]);
    const brokerPolicy = sandbox.setNetworkPolicy.mock.calls[0][0];
    assert.equal("github.com" in brokerPolicy.allow, true);
    assert.equal(JSON.stringify(brokerPolicy).includes("Authorization"), false);
    assert.equal(
      JSON.stringify(brokerPolicy).includes("secret-token"),
      false,
    );
  });

  test("brokers the shared token only for a verified private repository", async () => {
    const privateRevision: ResolvedRepository = {
      ...resolvedRepository,
      isPrivate: true,
    };
    const sandbox = createSandbox({
      run: commandSequence([
        commandResult({ exitCode: 1 }),
        commandResult(),
        commandResult({ exitCode: 1 }),
        commandResult(),
        commandResult(),
      ]),
    });

    const result = await ensureRepositoryRevisions({
      sandbox,
      repository,
      revisions: [privateRevision],
      token: "secret-token",
      abortSignal: new AbortController().signal,
    });

    assert(result.isOk());
    const brokerPolicy = sandbox.setNetworkPolicy.mock.calls[0][0];
    assert.equal(JSON.stringify(brokerPolicy).includes("Authorization"), true);
    assert.equal(
      JSON.stringify(brokerPolicy).includes("secret-token"),
      false,
    );
  });

  test("restores deny-all and returns a typed error when fetch fails", async () => {
    const sandbox = createSandbox({
      run: commandSequence([
        commandResult({ exitCode: 1 }),
        commandResult(),
        commandResult({ exitCode: 1 }),
        commandResult({ exitCode: 128, stderr: "repository not found" }),
      ]),
    });

    const result = await ensureRepositoryRevisions({
      sandbox,
      repository,
      revisions: [resolvedRepository],
      token: "token",
      abortSignal: new AbortController().signal,
    });

    assert(result.isErr());
    assert.equal(result.error.code, "REPOSITORY_SANDBOX_FAILED");
    assert.match(result.error.message, /repository not found/);
    assert.deepEqual(sandbox.setNetworkPolicy.mock.calls[1], ["deny-all"]);
  });

  test("never discards an existing dirty working tree", async () => {
    const sandbox = createSandbox({
      run: commandSequence([
        commandResult({ stdout: " M docs/example.md\n" }),
      ]),
    });

    const result = await checkoutRepositoryRevision({
      sandbox,
      workspace,
      abortSignal: new AbortController().signal,
    });

    assert(result.isErr());
    assert.equal(result.error.code, "REPOSITORY_DIRTY_WORKSPACE");
    assert.equal(sandbox.run.mock.calls.length, 1);
  });
});

describe("Git object inspection", () => {
  test("returns bounded content and the inspected blob SHA", async () => {
    const sandbox = createSandbox({
      run: commandSequence([
        commandResult({ stdout: "blob\n" }),
        commandResult({ stdout: "14\n" }),
        commandResult({ stdout: "one\ntwo\nthree" }),
        commandResult({ stdout: "blob-sha\n" }),
      ]),
    });

    const result = await readRepositoryFile({
      sandbox,
      workspace,
      abortSignal: new AbortController().signal,
      path: "docs/example.md",
      startLine: 2,
      endLine: 3,
      maxCharacters: 5,
    });

    assert(result.isOk());
    assert.deepEqual(result.value, {
      repository: resolvedRepository,
      path: "docs/example.md",
      blobSha: "blob-sha",
      startLine: 2,
      endLine: 3,
      content: "two\nt",
      truncated: true,
    });
    assert.match(sandbox.run.mock.calls[2][0].command, /git show/);
  });

  test("parses bounded searches from an immutable revision", async () => {
    const sandbox = createSandbox({
      run: commandSequence([
        commandResult({
          stdout:
            `${resolvedRepository.resolvedRevision}:docs/a.md\0${12}\0first\n` +
            `${resolvedRepository.resolvedRevision}:src/b.ts\0${3}\0second\n`,
        }),
      ]),
    });

    const result = await searchRepository({
      sandbox,
      workspace,
      abortSignal: new AbortController().signal,
      query: "literal",
      pathPrefix: ".",
      limit: 1,
    });

    assert(result.isOk());
    assert.deepEqual(result.value.matches, [
      { path: "docs/a.md", line: 12, excerpt: "first" },
    ]);
    assert.equal(result.value.truncated, true);
    assert.match(sandbox.run.mock.calls[0][0].command, /git grep/);
  });

  test("compares two fetched revisions without another GitHub API", async () => {
    const headRepository: ResolvedRepository = {
      ...repository,
      isPrivate: false,
      ref: "3.21",
      resolvedRevision: "abcdef0123456789abcdef0123456789abcdef01",
    };
    const sandbox = createSandbox({
      run: commandSequence([
        commandResult({ stdout: "docs/a.md\0src/b.ts\0extra.md\0" }),
      ]),
    });

    const result = await compareRepositoryRevisions({
      sandbox,
      baseWorkspace: workspace,
      headWorkspace: {
        path: workspace.path,
        repository: headRepository,
      },
      abortSignal: new AbortController().signal,
      pathPrefix: ".",
      limit: 2,
    });

    assert(result.isOk());
    assert.deepEqual(result.value, {
      repositoryId: repository.id,
      baseRevision: resolvedRepository.resolvedRevision,
      headRevision: headRepository.resolvedRevision,
      changedFiles: ["docs/a.md", "src/b.ts"],
      truncated: true,
    });
    assert.match(sandbox.run.mock.calls[0][0].command, /git diff --name-only/);
  });
});

describe("repository GitHub boundary", () => {
  test("uses one GitHub App token and resolves a requested ref", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        default_branch: "main",
        private: false,
      }))
      .mockResolvedValueOnce(jsonResponse({
        sha: resolvedRepository.resolvedRevision,
      }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveGitHubRevision(
      repository,
      "secret-token",
      new AbortController().signal,
      "3.21",
    );

    assert(result.isOk());
    assert.equal(result.value.ref, "3.21");
    assert.deepEqual(fetchMock.mock.calls[0][1]?.headers, {
      accept: "application/vnd.github+json",
      authorization: "Bearer secret-token",
      "x-github-api-version": "2026-03-10",
    });
    assert.match(fetchMock.mock.calls[1][0].toString(), /commits\/3.21$/);
  });

  test("preserves cancellation as a rejected promise", async () => {
    const controller = new AbortController();
    const cancellation = new Error("cancelled");
    controller.abort();
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(cancellation));

    await assert.rejects(
      async () =>
        await resolveGitHubRevision(
          repository,
          "token",
          controller.signal,
          "main",
        ),
      cancellation,
    );
  });
});

describe("repository service", () => {
  test("short-circuits invalid input before acquiring a sandbox or token", async () => {
    let sandboxRequests = 0;
    let tokenRequests = 0;
    const ctx = {
      abortSignal: new AbortController().signal,
      getSandbox: async () => {
        sandboxRequests += 1;
        return createSandbox();
      },
    } as unknown as ToolContext;
    const service = new RepositoryService(ctx, {
      getGitHubToken: () => {
        tokenRequests += 1;
        return ResultAsync.fromSafePromise(Promise.resolve("token"));
      },
    });

    const result = await service.listFiles({
      repositoryId: repository.id,
      pathPrefix: "../private",
      limit: 10,
    });

    assert(result.isErr());
    assert.equal(result.error.code, "REPOSITORY_INVALID_INPUT");
    assert.equal(sandboxRequests, 0);
    assert.equal(tokenRequests, 0);
  });

  test("preserves typed GitHub authentication failures", async () => {
    const authError = new RepositoryError(
      "REPOSITORY_GITHUB_AUTH_FAILED",
      "connector unavailable",
    );
    const ctx = {
      abortSignal: new AbortController().signal,
      getSandbox: async () => createSandbox(),
    } as unknown as ToolContext;
    const service = new RepositoryService(ctx, {
      repositories: [repository],
      getGitHubToken: () => new ResultAsync(Promise.resolve(err(authError))),
    });

    const result = await service.listFiles({
      repositoryId: repository.id,
      pathPrefix: ".",
      limit: 10,
    });

    assert(result.isErr());
    assert.equal(result.error, authError);
  });
});

function createSandbox(
  overrides: Partial<
    Record<keyof SandboxSession, ReturnType<typeof vi.fn> | string>
  > = {},
) {
  return {
    id: "sandbox-1",
    readTextFile: vi
      .fn<SandboxSession["readTextFile"]>()
      .mockResolvedValue(null),
    removePath: vi
      .fn<SandboxSession["removePath"]>()
      .mockResolvedValue(undefined),
    resolvePath: vi.fn<SandboxSession["resolvePath"]>((path) => path),
    run: vi
      .fn<SandboxSession["run"]>()
      .mockResolvedValue(commandResult()),
    setNetworkPolicy: vi
      .fn<SandboxSession["setNetworkPolicy"]>()
      .mockResolvedValue(undefined),
    writeFile: vi
      .fn<SandboxSession["writeFile"]>()
      .mockResolvedValue(undefined),
    writeTextFile: vi
      .fn<SandboxSession["writeTextFile"]>()
      .mockResolvedValue(undefined),
    ...overrides,
  } as unknown as SandboxSession & {
    removePath: ReturnType<typeof vi.fn>;
    run: ReturnType<typeof vi.fn>;
    setNetworkPolicy: ReturnType<typeof vi.fn>;
  };
}

function commandSequence(results: SandboxCommandResult[]) {
  const mock = vi.fn<SandboxSession["run"]>();
  for (const result of results) mock.mockResolvedValueOnce(result);
  return mock;
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
