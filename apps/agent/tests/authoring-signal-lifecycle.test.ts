import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { ToolContext } from "eve/tools";
import { test } from "vitest";

test("authoring signal lifecycle", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "docs-agent-authoring-signal-"));
  const repositoryRoot = join(tempRoot, "repository");
  process.env.DOCS_AGENT_DATABASE_URL = `file:${join(tempRoot, "authoring-signal.sqlite")}`;
  delete process.env.VERCEL;
  delete process.env.NODE_ENV;

  const { migrateDocsAgentDatabase } = await import("@docs-agent/control-plane/testing");
  const { createDocsSignal, getDocsSignal, transitionDocsSignalLifecycle } = await import("../agent/lib/docs-signals");
  const { applyAuthoringDraft, prepareAuthoringDraft } = await import("../agent/lib/authoring-workspace");
  const { buildPullRequestBody } = await import("../agent/lib/github-writeback");
  type WorkflowState = import("../agent/lib/repository-workflow-contract").WorkflowState;
  await migrateDocsAgentDatabase();

  await mkdir(join(repositoryRoot, "docs", "api-usage"), { recursive: true });
  const path = "docs/api-usage/metadata.mdx";
  const original = "# Metadata\n\nOld permission guidance.\n";
  await writeFile(join(repositoryRoot, path), original);
  await writeFile(join(repositoryRoot, "package.json"), JSON.stringify({ scripts: { build: "node -e \"process.exit(0)\"" } }));
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("add", ".");
  git("commit", "-qm", "base");
  const baseRevision = git("rev-parse", "HEAD").trim();

  const sandbox = {
    async run(input: { command: string; workingDirectory?: string }) {
      const result = spawnSync(input.command, { cwd: input.workingDirectory ?? repositoryRoot, encoding: "utf8", shell: true });
      return { exitCode: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
    },
    async readTextFile({ path: file }: { path: string }) { try { return await readFile(file, "utf8"); } catch { return null; } },
    async readBinaryFile({ path: file }: { path: string }) { try { return await readFile(file); } catch { return null; } },
    async writeTextFile({ path: file, content }: { path: string; content: string }) { await mkdir(dirname(file), { recursive: true }); await writeFile(file, content); },
    async writeBinaryFile({ path: file, content }: { path: string; content: Uint8Array }) { await mkdir(dirname(file), { recursive: true }); await writeFile(file, content); },
    async removePath({ path: file, force }: { path: string; force?: boolean }) { try { await unlink(file); } catch (error) { if (!force) throw error; } },
  };
  const ctx = {
    getSandbox: async () => sandbox,
    abortSignal: new AbortController().signal,
    session: { id: "signal-authoring-session", turn: { id: "signal-authoring-run" } },
  } as unknown as ToolContext;
  const state: WorkflowState = {
    repositoryInput: {
      workingDocumentationRepository: {
        source: { type: "github-url", url: "https://github.com/acme/docs.git" },
        ref: "main",
        docsRoot: "docs",
        sandboxPath: repositoryRoot,
        accessMode: "sandbox-write",
        allowedActions: ["clone", "read", "search", "patch", "run-checks", "export-diff", "publish-pr"],
        provenanceLabel: "working-documentation-repository",
      },
      watchedRepositories: [],
      contextRepositories: [],
      externalContext: [],
    },
    materialization: {
      repositoryUrl: "https://github.com/acme/docs.git",
      requestedRef: "main",
      resolvedCommit: baseRevision,
      docsRoot: "docs",
      sandboxPath: repositoryRoot,
      status: "materialized",
    },
    actionProvenance: [],
  };
  const noPersist = async () => {};

  try {
    const created = await createDocsSignal({
      source: {
        kind: "linear-issue",
        provider: "linear",
        providerId: "issue:DOC-123",
        permalink: "https://linear.app/acme/issue/DOC-123/docs-impact",
        title: "DOC-123: Docs impact",
        authors: ["docs@example.com"],
        sourceText: "Release-backed docs signal.",
        capturedAt: "2026-07-09T18:00:00.000Z",
      },
      sourceSummary: "Verified signal says metadata docs are stale.",
      extractedClaims: ["Private metadata filtering is permission-bound."],
      likelyDocsPages: [path],
      productSurfaces: ["GraphQL API"],
    });
    const verified = await transitionDocsSignalLifecycle({
      id: created.signal.id,
      status: "docs-verified",
      reason: "Current docs verification completed for the test signal.",
      actor: "docs-agent:test-verification",
    }, "verification");

    const updated = "# Metadata\n\nPrivate metadata filtering requires permission.\n";
    const applied = await applyAuthoringDraft({
      signalId: verified.id,
      taskReferences: [verified.id],
      operations: [{ kind: "write-text", path, content: updated, expectedContentHash: hash(original) }],
    }, ctx, state, noPersist);
    assert.equal(applied.ok, true);
    assert.equal(applied.draft?.signalId, verified.id);
    assert.equal(applied.draft?.contentPlanId, undefined, "a localized signal patch remains plan-free");

    const prepared = await prepareAuthoringDraft({
      patchSummary: "Document permission-bound private metadata filtering.",
      evidence: [],
      uncertainty: ["Maintainer should review wording."],
      checks: ["diff-check"],
    }, ctx, state, noPersist);
    assert.equal(prepared.ok, true);
    assert.equal(prepared.signal?.status, "patch-prepared");
    assert.equal(prepared.report?.evidence.some(item => item.includes(verified.sourceSummary)), true);
    assert.equal(prepared.signal?.artifacts[0]?.metadata.draftId, applied.draft?.id);
    assert.equal(prepared.signal?.artifacts[0]?.metadata.preparedDiffHash, prepared.draft?.preparedDiffHash);

    const invalid = `${updated.trimEnd()}   \n`;
    const invalidApplied = await applyAuthoringDraft({
      taskReferences: [verified.id],
      operations: [{ kind: "write-text", path, content: invalid, expectedContentHash: hash(updated) }],
    }, ctx, state, noPersist);
    assert.equal(invalidApplied.ok, true, "a correction may revise the same prepared signal draft");
    const failedValidation = await prepareAuthoringDraft({
      patchSummary: "Validate the corrected signal draft.",
      evidence: [],
      uncertainty: [],
      checks: ["diff-check"],
    }, ctx, state, noPersist);
    assert.equal(failedValidation.ok, false);
    assert.equal(failedValidation.draft?.status, "checks-failed");
    assert.equal(failedValidation.signal?.status, "patch-failed");

    const corrected = await applyAuthoringDraft({
      taskReferences: [verified.id],
      operations: [{ kind: "write-text", path, content: updated, expectedContentHash: hash(invalid) }],
    }, ctx, state, noPersist);
    assert.equal(corrected.ok, true);
    const rePrepared = await prepareAuthoringDraft({
      patchSummary: "Document permission-bound private metadata filtering.",
      evidence: [],
      uncertainty: [],
      checks: ["diff-check"],
    }, ctx, state, noPersist);
    assert.equal(rePrepared.ok, true);
    assert.equal(rePrepared.signal?.status, "patch-prepared");

    const finalSignal = await getDocsSignal({ id: verified.id });
    assert.deepEqual(finalSignal.events.slice(0, 3).map(({ toStatus }) => toStatus), ["patch-prepared", "patch-failed", "patch-prepared"]);
    const prBody = buildPullRequestBody({
      result: state.lastResult!,
      baseBranch: "main",
      branchName: "docs-agent/main/signal",
      diffHash: state.draft!.preparedDiffHash!,
      changedFiles: state.draft!.changedFiles,
      signal: finalSignal,
    });
    assert.match(prBody, /Originating Signal/);
    assert.match(prBody, new RegExp(verified.id));
    assert.match(prBody, /Verified signal says metadata docs are stale/);
    assert.match(prBody, /https:\/\/linear\.app\/acme\/issue\/DOC-123\/docs-impact/);

    const unverified = await createDocsSignal({ source: { kind: "manual-scenario" }, sourceSummary: "Not verified." });
    const rejected = await applyAuthoringDraft({
      signalId: unverified.signal.id,
      operations: [{ kind: "write-text", path, content: "clobber\n", expectedContentHash: hash(updated) }],
    }, ctx, { ...state, draft: undefined, lastResult: undefined }, noPersist);
    assert.equal(rejected.ok, false);
    assert.match(rejected.error, /verify current docs first/i);
    assert.equal(await readFile(join(repositoryRoot, path), "utf8"), updated);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }

  function git(...args: string[]) { return execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8" }); }
});

function hash(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}
