import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ToolContext } from "eve/tools";

import {
  abandonAuthoringDraft,
  applyAuthoringDraftInputSchema,
  applyAuthoringDraft,
  inspectAuthoringDraft,
  prepareAuthoringDraft,
} from "../agent/lib/authoring-workspace";
import { createContentPlan } from "../agent/lib/content-plan";
import { createEditorialRecommendation } from "../agent/lib/editorial-recommendation";
import type { ResolvedRepositoryInput } from "../agent/lib/repository-contract";
import type { WorkflowState } from "../agent/lib/repository-workflow-contract";
import { collectChangedFileEntries } from "../agent/lib/github-writeback";
import { runWorkingRepositoryOperationSerially, workingRepositoryOperationKey } from "../agent/lib/working-repository-lifecycle";
import { authoringWorkspaceModelOutput } from "../agent/tools/authoring_workspace";
import { test } from "vitest";

test("authoring workspace", async () => {
  assert.throws(
    () => applyAuthoringDraftInputSchema.parse({
      operations: [{
        kind: "write-binary",
        path: "static/too-large.bin",
        contentBase64: Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64"),
        createOnly: true,
      }],
    }),
    /binary content exceeds/i,
  );
  const oneMegabyte = "x".repeat(1_000_000);
  assert.throws(
    () => applyAuthoringDraftInputSchema.parse({
      operations: Array.from({ length: 21 }, (_, index) => ({
        kind: "write-text",
        path: `docs/batch-${index}.mdx`,
        content: oneMegabyte,
        createOnly: true,
      })),
    }),
    /authoring batch exceeds/i,
  );
  const root = await mkdtemp(join(tmpdir(), "docs-agent-authoring-"));
  await mkdir(join(root, "docs"), { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ scripts: { build: "node -e \"console.log('docs build passed')\"" } }));
  await writeFile(join(root, "sidebars.js"), "module.exports = ['docs/old'];\n");
  await writeFile(join(root, "docs/old.mdx"), "# Old page\n");
  await writeFile(join(root, "docs/obsolete.mdx"), "# Obsolete page\n");
  await writeFile(join(root, "docs/related.mdx"), "# Related\n\nOld guidance.\n");
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("add", ".");
  git("commit", "-qm", "base");
  const baseRevision = git("rev-parse", "HEAD").trim();

  const sandbox = {
    async run(input: { command: string; workingDirectory?: string }) {
      const result = spawnSync(input.command, { cwd: input.workingDirectory ?? root, encoding: "utf8", shell: true });
      return { exitCode: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
    },
    async readTextFile({ path }: { path: string }) {
      try { return await readFile(path, "utf8"); } catch { return null; }
    },
    async readBinaryFile({ path }: { path: string }) {
      try { return await readFile(path); } catch { return null; }
    },
    async writeTextFile({ path, content }: { path: string; content: string }) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content);
    },
    async writeBinaryFile({ path, content }: { path: string; content: Uint8Array }) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content);
    },
    async removePath({ path, force }: { path: string; force?: boolean }) {
      try { await unlink(path); } catch (error) {
        if (!force) throw error;
      }
    },
  };
  const ctx = {
    getSandbox: async () => sandbox,
    abortSignal: new AbortController().signal,
    session: { id: "authoring-session", turn: { id: "authoring-run" } },
  } as unknown as ToolContext;
  const repositoryInput: ResolvedRepositoryInput = {
    workingDocumentationRepository: {
      source: { type: "github-url", url: "https://github.com/example/docs.git" },
      ref: "main",
      docsRoot: "docs",
      sandboxPath: root,
      accessMode: "sandbox-write",
      allowedActions: ["clone", "read", "search", "patch", "run-checks", "export-diff", "publish-pr"],
      provenanceLabel: "working-documentation-repository",
    },
    watchedRepositories: [],
    contextRepositories: [],
    externalContext: [],
  };
  const state: WorkflowState = {
    repositoryInput,
    materialization: {
      repositoryUrl: repositoryInput.workingDocumentationRepository.source.url,
      requestedRef: "main",
      resolvedCommit: baseRevision,
      docsRoot: "docs",
      sandboxPath: root,
      status: "materialized",
    },
    actionProvenance: [],
  };
  const noPersist = async () => {};

  try {
    const asset = Buffer.from([0, 1, 2, 3, 255]);
    const recommendation = await createEditorialRecommendation({
      sourceDecisionReference: "docs-impact:DOCS-53",
      taskReferences: ["DOCS-53"],
      reader: "Developers",
      readerProblem: "They need a complete new guide.",
      chosenIntervention: "new-document",
      rationale: "The reader task is not covered by an existing canonical page.",
      repositoryEvidence: ["No matching page exists."],
      docsProfileReferences: ["docs profile: guide placement"],
      sourceEvidence: ["DOCS-53"],
      workspaceMemoryReferences: [],
      alternatives: [{ intervention: "focused-patch", reasonRejected: "There is no existing page to patch." }],
      remainingUncertainty: [],
      blockingDecisions: [],
    }, state, noPersist);
    const plan = await createContentPlan({
      sourceDecisionReference: "docs-impact:DOCS-53",
      taskReferences: ["DOCS-53"],
      reader: "Developers",
      desiredOutcome: "use the new guide",
      contentType: "guide",
      placement: "docs",
      affectedSurfaces: [
        { action: "create", path: "docs/new-page.mdx" },
        { action: "change", path: "sidebars.js" },
        { action: "change", path: "docs/related.mdx" },
        { action: "create", path: "static/img/example.bin" },
        { action: "create", path: "docs/copied.mdx" },
        { action: "move", path: "docs/copied.mdx", destination: "docs/moved.mdx" },
        { action: "move", path: "docs/old.mdx", destination: "docs/renamed.mdx" },
        { action: "remove", path: "docs/obsolete.mdx" },
      ],
      outline: ["Complete guide"],
      requiredEvidence: [],
      examples: [],
      assets: ["static/img/example.bin"],
      unresolvedDecisions: [],
      validation: ["build", "diff-check"],
      definitionOfDone: ["The complete multi-file draft passes checks"],
    }, state, noPersist);

    const newPage = "# New page\n\nA complete page.\n";
    const copiedPage = newPage;
    const first = await applyAuthoringDraft({
      taskReferences: ["DOCS-53"],
      editorialRecommendationId: recommendation.recommendation.id,
      contentPlanId: plan.plan.id,
      operations: [
        { kind: "write-text", path: "docs/new-page.mdx", content: newPage, createOnly: true },
        { kind: "write-text", path: "sidebars.js", content: "module.exports = ['docs/new-page', 'docs/related'];\n", expectedContentHash: hash("module.exports = ['docs/old'];\n") },
        { kind: "write-text", path: "docs/related.mdx", content: "# Related\n\nSee the new page.\n", expectedContentHash: hash("# Related\n\nOld guidance.\n") },
        { kind: "write-binary", path: "static/img/example.bin", contentBase64: asset.toString("base64"), createOnly: true },
        { kind: "copy", from: "docs/new-page.mdx", to: "docs/copied.mdx", expectedContentHash: hash(newPage), createOnly: true },
        { kind: "move", from: "docs/copied.mdx", to: "docs/moved.mdx", expectedContentHash: hash(copiedPage), createOnly: true },
        { kind: "move", from: "docs/old.mdx", to: "docs/renamed.mdx", expectedContentHash: hash("# Old page\n"), createOnly: true },
        { kind: "delete", path: "docs/obsolete.mdx", expectedContentHash: hash("# Obsolete page\n") },
      ],
    }, ctx, state, noPersist);
    assert.equal(first.ok, true);
    assert.equal(first.draft?.baseRevision, baseRevision);
    assert.equal(first.draft?.editorialRecommendationId, recommendation.recommendation.id);
    assert.equal(first.draft?.contentPlanId, plan.plan.id);
    assert.equal(first.draft?.changedFiles.length, 8);
    assert.equal(first.operations.length, 8);
    assert.equal(first.operations.every(({ status }) => status === "applied"), true);
    assert.deepEqual(first.operations.map(({ index, kind }) => ({ index, kind })), [
      { index: 0, kind: "write-text" },
      { index: 1, kind: "write-text" },
      { index: 2, kind: "write-text" },
      { index: 3, kind: "write-binary" },
      { index: 4, kind: "copy" },
      { index: 5, kind: "move" },
      { index: 6, kind: "move" },
      { index: 7, kind: "delete" },
    ]);

    const inspected = await inspectAuthoringDraft({ paths: ["docs/new-page.mdx", "sidebars.js", "static/img/example.bin"] }, ctx, state, noPersist);
    assert.equal(inspected.files[0]?.content?.includes("complete page"), true);
    assert.equal(inspected.files[2]?.content, null);
    assert.equal(inspected.files[2]?.binary, true);
    assert.equal(inspected.files[2]?.contentHash, hash(asset));
    const exactLargeDiff = "diff-line\n".repeat(2_000);
    const exactLargeContent = "page-content\n".repeat(1_000);
    const projectedInspection = authoringWorkspaceModelOutput({
      mode: "inspect",
      draft: { ...inspected.draft!, diff: exactLargeDiff },
      changedFiles: inspected.changedFiles,
      diff: exactLargeDiff,
      files: [{ path: "docs/new-page.mdx", content: exactLargeContent, binary: false, contentHash: hash(exactLargeContent), sizeBytes: Buffer.byteLength(exactLargeContent) }],
    });
    const projectedValue = projectedInspection.value as {
      draft: { diff: { preview: string; truncated: boolean; contentHash: string } };
      diff: { preview: string; truncated: boolean; contentHash: string };
      files: Array<{ content: string; contentTruncated: boolean }>;
    };
    assert.equal(projectedValue.diff.truncated, true);
    assert.equal(projectedValue.diff.contentHash, hash(exactLargeDiff));
    assert.equal(projectedValue.draft.diff.contentHash, hash(exactLargeDiff));
    assert.equal(projectedValue.diff.preview.length < exactLargeDiff.length, true);
    assert.equal(projectedValue.files[0]?.contentTruncated, true);
    assert.equal(projectedValue.files[0]!.content.length < exactLargeContent.length, true);
    assert.equal(JSON.stringify(projectedInspection).includes(exactLargeDiff), false, "model output omits the exact unbounded diff while persisted state retains it");
    const updatedAsset = Buffer.from([255, 4, 3, 2, 1, 0]);
    const binaryUpdate = await applyAuthoringDraft({
      taskReferences: ["DOCS-53"],
      operations: [{ kind: "write-binary", path: "static/img/example.bin", contentBase64: updatedAsset.toString("base64"), expectedContentHash: inspected.files[2]!.contentHash! }],
    }, ctx, state, noPersist);
    assert.equal(binaryUpdate.ok, true);
    assert.deepEqual(await readFile(join(root, "static/img/example.bin")), updatedAsset);
    assert.equal(inspected.diff.includes("GIT binary patch"), true);
    assert.equal(inspected.diff.includes("deleted file mode"), true);

    state.materialization.resolvedCommit = "stale-base";
    const stalePrepare = await prepareAuthoringDraft({ patchSummary: "Stale draft.", evidence: [], uncertainty: [], checks: ["diff-check"] }, ctx, state, noPersist);
    assert.equal(stalePrepare.ok, false);
    assert.match(stalePrepare.error ?? "", /draft base is stale/i);
    state.materialization.resolvedCommit = baseRevision;

    const prepared = await prepareAuthoringDraft({
      patchSummary: "Add a complete guide and navigation.",
      evidence: ["DOCS-53"],
      uncertainty: [],
      checks: ["build", "diff-check"],
    }, ctx, state, noPersist);
    assert.equal(prepared.ok, true);
    assert.equal(prepared.draft.status, "prepared");
    assert.equal(prepared.draft.checks.every(({ status }) => status === "passed"), true);
    assert.equal(prepared.draft.preparedDiffHash, hash(prepared.draft.diff));
    assert.equal(state.lastResult?.draftId, prepared.draft.id);
    assert.equal(state.lastResult?.preparedDiffHash, prepared.draft.preparedDiffHash);

    const publishEntries = await collectChangedFileEntries(ctx, repositoryInput.workingDocumentationRepository, prepared.draft.changedFiles);
    assert.equal(publishEntries.some((entry) => entry.path === "docs/old.mdx" && entry.deleted === true), true);
    assert.equal(publishEntries.some((entry) => entry.path === "docs/obsolete.mdx" && entry.deleted === true), true);
    assert.equal(publishEntries.some((entry) => entry.path === "docs/renamed.mdx" && "content" in entry), true);
    assert.equal(publishEntries.some((entry) => entry.path === "static/img/example.bin" && "contentBase64" in entry), true);
    assert.deepEqual(await readFile(join(root, "static/img/example.bin")), updatedAsset);

    const beforePredictableFailure = await snapshot(root, state);
    const predictableFailure = await applyAuthoringDraft({
      taskReferences: ["DOCS-53"],
      operations: [
        { kind: "write-text", path: "docs/related.mdx", content: "would be written\n", expectedContentHash: hash("# Related\n\nSee the new page.\n") },
        { kind: "delete", path: "docs/moved.mdx", expectedContentHash: hash("wrong") },
      ],
    }, ctx, state, noPersist);
    assert.equal(predictableFailure.ok, false);
    assert.equal(predictableFailure.failedOperation?.index, 1);
    assert.equal(predictableFailure.failedOperation?.status, "preflight-failed");
    assert.deepEqual(await snapshot(root, state), beforePredictableFailure, "full ordered preflight performs zero writes and preserves prepared state");

    const beforeRollback = await snapshot(root, state);
    const failingSandbox = {
      ...sandbox,
      async writeTextFile(input: { path: string; content: string }) {
        if (input.path.endsWith("sidebars.js")) throw new Error("injected write failure");
        return sandbox.writeTextFile(input);
      },
    };
    const failingCtx = { ...ctx, getSandbox: async () => failingSandbox } as unknown as ToolContext;
    const rollbackFailure = await applyAuthoringDraft({
      taskReferences: ["DOCS-53"],
      operations: [
        { kind: "write-text", path: "docs/related.mdx", content: "temporary\n", expectedContentHash: hash("# Related\n\nSee the new page.\n") },
        { kind: "write-text", path: "sidebars.js", content: "temporary navigation\n", expectedContentHash: hash("module.exports = ['docs/new-page', 'docs/related'];\n") },
      ],
    }, failingCtx, state, noPersist);
    assert.equal(rollbackFailure.ok, false);
    assert.equal(rollbackFailure.failedOperation?.index, 1);
    assert.equal(rollbackFailure.operations[0]?.status, "rolled-back");
    assert.equal(rollbackFailure.operations[1]?.status, "failed");
    assert.deepEqual(await snapshot(root, state), beforeRollback, "execution rollback restores file existence, bytes, index diff, and workflow state");

    const retry = await applyAuthoringDraft({
      taskReferences: ["DOCS-53"],
      operations: [
        { kind: "write-text", path: "docs/related.mdx", content: "temporary\n", expectedContentHash: hash("# Related\n\nSee the new page.\n") },
        { kind: "write-text", path: "sidebars.js", content: "temporary navigation\n", expectedContentHash: hash("module.exports = ['docs/new-page', 'docs/related'];\n") },
      ],
    }, ctx, state, noPersist);
    assert.equal(retry.ok, true, "the exact batch can be retried after rollback");
    assert.equal(state.lastResult, undefined, "editing invalidates the prior prepared snapshot");

    const beforePersistFailure = await snapshot(root, state);
    const persistFailure = await applyAuthoringDraft({
      taskReferences: ["DOCS-53"],
      operations: [
        { kind: "write-text", path: "docs/related.mdx", content: "uncommitted metadata\n", expectedContentHash: hash("temporary\n") },
        { kind: "write-text", path: "sidebars.js", content: "uncommitted navigation\n", expectedContentHash: hash("temporary navigation\n") },
      ],
    }, ctx, state, async () => { throw new Error("injected persistence failure"); });
    assert.equal(persistFailure.ok, false);
    assert.match(persistFailure.error, /persistence failure/i);
    assert.equal(persistFailure.operations.every(({ status }) => status === "rolled-back"), true);
    assert.deepEqual(await snapshot(root, state), beforePersistFailure, "post-write metadata or persistence failure restores the complete pre-call transaction");

    const staleHash = await applyAuthoringDraft({
      taskReferences: ["DOCS-53"],
      operations: [{ kind: "write-text", path: "docs/related.mdx", content: "clobber\n", expectedContentHash: hash("stale") }],
    }, ctx, state, noPersist);
    assert.equal(staleHash.ok, false);
    assert.match(staleHash.error ?? "", /content hash/i);
    assert.equal(await readFile(join(root, "docs/related.mdx"), "utf8"), "temporary\n");

    state.materialization.resolvedCommit = "stale-base";
    const staleApply = await applyAuthoringDraft({
      taskReferences: ["DOCS-53"],
      operations: [{ kind: "write-text", path: "docs/related.mdx", content: "clobber\n", expectedContentHash: hash("temporary\n") }],
    }, ctx, state, noPersist);
    assert.equal(staleApply.ok, false);
    assert.match(staleApply.error ?? "", /base is stale/i);
    assert.equal(await readFile(join(root, "docs/related.mdx"), "utf8"), "temporary\n");
    state.materialization.resolvedCommit = baseRevision;

    const draftId = state.draft!.id;
    const abandoned = await abandonAuthoringDraft({ draftId }, ctx, state, noPersist);
    assert.deepEqual(abandoned, { abandoned: true, replayed: false, draftId });
    assert.equal(git("status", "--porcelain").trim(), "");
    const replayedAbandon = await abandonAuthoringDraft({ draftId }, ctx, state, noPersist);
    assert.deepEqual(replayedAbandon, { abandoned: true, replayed: true, draftId });

    let durableState = structuredClone(state);
    const operationKey = workingRepositoryOperationKey(ctx.session.id, repositoryInput.workingDocumentationRepository);
    const order: string[] = [];
    let firstLoaded!: () => void;
    let releaseFirst!: () => void;
    const loaded = new Promise<void>((resolve) => { firstLoaded = resolve; });
    const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const runSerializedAuthoring = (
      label: string,
      content: string,
      expectedContentHash: string,
      waitAfterLoad = false,
    ) => runWorkingRepositoryOperationSerially(operationKey, async () => {
      order.push(`${label}:load`);
      const transactionState = structuredClone(durableState);
      if (waitAfterLoad) {
        firstLoaded();
        await gate;
      }
      const result = await applyAuthoringDraft({
        taskReferences: ["DOCS-FIFO"],
        operations: [{ kind: "write-text", path: "docs/related.mdx", content, expectedContentHash }],
      }, ctx, transactionState, async (saved) => {
        order.push(`${label}:save`);
        durableState = structuredClone(saved);
      });
      order.push(`${label}:done`);
      return result;
    });
    const firstSerialized = runSerializedAuthoring("first", "first serialized edit\n", hash("# Related\n\nOld guidance.\n"), true);
    await loaded;
    const secondSerialized = runSerializedAuthoring("second", "second serialized edit\n", hash("first serialized edit\n"));
    await Promise.resolve();
    assert.deepEqual(order, ["first:load"], "same-session authoring waits before loading workflow state");
    releaseFirst();
    const [firstResult, secondResult] = await Promise.all([firstSerialized, secondSerialized]);
    assert.equal(firstResult.ok, true);
    assert.equal(secondResult.ok, true);
    assert.deepEqual(order, ["first:load", "first:save", "first:done", "second:load", "second:save", "second:done"]);
    assert.equal(durableState.draft?.operations.length, 2, "serialized saves preserve both authoring operations");
    assert.equal(await readFile(join(root, "docs/related.mdx"), "utf8"), "second serialized edit\n");

    const outsideDirectory = await mkdtemp(join(tmpdir(), "docs-agent-authoring-outside-"));
    const outsideFile = join(outsideDirectory, "outside.mdx");
    await writeFile(outsideFile, "outside remains unchanged\n");
    await symlink(outsideFile, join(root, "docs/direct-link.mdx"));
    await symlink(outsideDirectory, join(root, "docs/link-parent"));
    const escapeState = structuredClone(durableState);
    const stateBeforeEscapes = structuredClone(escapeState);
    const statusBeforeEscapes = git("status", "--porcelain=v1", "--untracked-files=all");
    const directEscape = await applyAuthoringDraft({
      taskReferences: ["DOCS-FIFO"],
      operations: [{ kind: "write-text", path: "docs/direct-link.mdx", content: "escaped\n", expectedContentHash: hash("outside remains unchanged\n") }],
    }, ctx, escapeState, noPersist);
    assert.equal(directEscape.ok, false);
    assert.equal(directEscape.failedOperation?.status, "preflight-failed");
    assert.match(directEscape.error ?? "", /symbolic link/i);
    const parentEscape = await applyAuthoringDraft({
      taskReferences: ["DOCS-FIFO"],
      operations: [{ kind: "write-text", path: "docs/link-parent/new.mdx", content: "escaped\n", createOnly: true }],
    }, ctx, escapeState, noPersist);
    assert.equal(parentEscape.ok, false);
    assert.equal(parentEscape.failedOperation?.status, "preflight-failed");
    assert.match(parentEscape.error ?? "", /symbolic link/i);
    assert.equal(await readFile(outsideFile, "utf8"), "outside remains unchanged\n");
    await assert.rejects(readFile(join(outsideDirectory, "new.mdx")), /ENOENT/);
    assert.equal(git("status", "--porcelain=v1", "--untracked-files=all"), statusBeforeEscapes, "symlink policy failures perform no repository writes");
    assert.deepEqual(escapeState, stateBeforeEscapes, "symlink policy failures preserve workflow state");
    await rm(outsideDirectory, { recursive: true, force: true });

    await abandonAuthoringDraft({ draftId: durableState.draft!.id }, ctx, durableState, noPersist);
    const lockRecommendation = await createEditorialRecommendation({
      sourceDecisionReference: "docs-impact:DOCS-LOCK",
      taskReferences: ["DOCS-LOCK"],
      reader: "Maintainers",
      readerProblem: "They need index failure atomicity documented.",
      chosenIntervention: "new-document",
      rationale: "The regression needs substantial planned surfaces.",
      repositoryEvidence: ["The fixture has a source file to move."],
      docsProfileReferences: ["fixture docs profile"],
      sourceEvidence: ["DOCS-LOCK"],
      workspaceMemoryReferences: [],
      alternatives: [],
      remainingUncertainty: [],
      blockingDecisions: [],
    }, durableState, noPersist);
    const lockPlan = await createContentPlan({
      sourceDecisionReference: "docs-impact:DOCS-LOCK",
      taskReferences: ["DOCS-LOCK"],
      reader: "Maintainers",
      desiredOutcome: "verify atomic index failure handling",
      contentType: "regression fixture",
      placement: "docs",
      affectedSurfaces: [
        { action: "create", path: "docs/locked-create.mdx" },
        { action: "move", path: "docs/old.mdx", destination: "docs/locked-move.mdx" },
      ],
      outline: ["Atomicity"],
      requiredEvidence: [],
      examples: [],
      assets: [],
      unresolvedDecisions: [],
      validation: ["diff-check"],
      definitionOfDone: ["Locked-index failures restore exact state"],
    }, durableState, noPersist);
    const indexLock = join(root, ".git/index.lock");
    await writeFile(indexLock, "locked\n");
    const beforeLockedCreate = await snapshot(root, durableState);
    const lockedCreate = await applyAuthoringDraft({
      taskReferences: ["DOCS-LOCK"],
      editorialRecommendationId: lockRecommendation.recommendation.id,
      contentPlanId: lockPlan.plan.id,
      operations: [{ kind: "write-text", path: "docs/locked-create.mdx", content: "# Locked create\n", createOnly: true }],
    }, ctx, durableState, noPersist);
    assert.equal(lockedCreate.ok, false);
    assert.equal(lockedCreate.failedOperation?.status, "failed");
    assert.match(lockedCreate.error ?? "", /intent-to-add failed/i);
    assert.deepEqual(await snapshot(root, durableState), beforeLockedCreate, "locked-index create failure restores files, index, and workflow state");

    const beforeLockedMove = await snapshot(root, durableState);
    const lockedMove = await applyAuthoringDraft({
      taskReferences: ["DOCS-LOCK"],
      editorialRecommendationId: lockRecommendation.recommendation.id,
      contentPlanId: lockPlan.plan.id,
      operations: [{ kind: "move", from: "docs/old.mdx", to: "docs/locked-move.mdx", expectedContentHash: hash("# Old page\n"), createOnly: true }],
    }, ctx, durableState, noPersist);
    assert.equal(lockedMove.ok, false);
    assert.equal(lockedMove.failedOperation?.status, "failed");
    assert.match(lockedMove.error ?? "", /move index reset failed/i);
    assert.deepEqual(await snapshot(root, durableState), beforeLockedMove, "locked-index move failure restores source, target, index, and workflow state");
    await unlink(indexLock);
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  function git(...args: string[]) {
    return execFileSync("git", args, { cwd: root, encoding: "utf8" });
  }
});

function hash(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function snapshot(root: string, state: WorkflowState) {
  const paths = [
    "docs/related.mdx",
    "docs/moved.mdx",
    "docs/fail.mdx",
    "docs/old.mdx",
    "docs/locked-create.mdx",
    "docs/locked-move.mdx",
    "static/img/example.bin",
  ];
  const files = await Promise.all(paths.map(async (path) => {
    try { return [path, (await readFile(join(root, path))).toString("base64")] as const; }
    catch { return [path, null] as const; }
  }));
  const status = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: root, encoding: "utf8" });
  const diff = execFileSync("git", ["diff", "--binary", "--full-index"], { cwd: root, encoding: "utf8" });
  return { files, status, diff, state: JSON.parse(JSON.stringify(state)) as unknown };
}
