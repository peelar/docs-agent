import type { ToolContext } from "eve/tools";
import { z } from "zod";

import {
  copyRepositoryFile,
  deleteRepositoryFile,
  exportRepositoryDiff,
  listChangedFiles,
  moveRepositoryFile,
  readRepositoryFile,
  resetRepositoryDraft,
  runRepositoryCheck,
  writeRepositoryBinary,
  writeRepositoryText,
} from "./repository-operations.js";
import { saveRepositoryWorkflowState } from "./repository-workflow-state.js";
import type { WorkflowState } from "./repository-workflow-contract.js";
import { repositoryCheckNameSchema } from "./repository-workflow-contract.js";

const pathSchema = z.string().trim().min(1);
export const authoringOperationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("write-text"), path: pathSchema, content: z.string() }),
  z.object({ kind: z.literal("write-binary"), path: pathSchema, contentBase64: z.string().base64().max(14_000_000) }),
  z.object({ kind: z.literal("move"), from: pathSchema, to: pathSchema }),
  z.object({ kind: z.literal("copy"), from: pathSchema, to: pathSchema }),
  z.object({ kind: z.literal("delete"), path: pathSchema }),
]);
export const applyAuthoringDraftInputSchema = z.object({
  operations: z.array(authoringOperationSchema).min(1).max(50),
  taskReferences: z.array(z.string().trim().min(1)).max(20).default([]),
});
export const prepareAuthoringDraftInputSchema = z.object({
  patchSummary: z.string().trim().min(1),
  evidence: z.array(z.string().trim().min(1)).default([]),
  uncertainty: z.array(z.string().trim().min(1)).default([]),
  checks: z.array(repositoryCheckNameSchema).min(1).default(["diff-check"]),
});

type PersistState = (state: WorkflowState) => Promise<void>;

export async function applyAuthoringDraft(input: z.infer<typeof applyAuthoringDraftInputSchema>, ctx: ToolContext, state: WorkflowState, persistState: PersistState = saveRepositoryWorkflowState): Promise<WorkflowState["draft"]> {
  const parsed = applyAuthoringDraftInputSchema.parse(input);
  const repository = state.repositoryInput.workingDocumentationRepository;
  for (const operation of parsed.operations) {
    switch (operation.kind) {
      case "write-text": await writeRepositoryText(ctx, repository, operation.path, operation.content, state.actionProvenance); break;
      case "write-binary": await writeRepositoryBinary(ctx, repository, operation.path, operation.contentBase64, state.actionProvenance); break;
      case "move": await moveRepositoryFile(ctx, repository, operation.from, operation.to, state.actionProvenance); break;
      case "copy": await copyRepositoryFile(ctx, repository, operation.from, operation.to, state.actionProvenance); break;
      case "delete": await deleteRepositoryFile(ctx, repository, operation.path, state.actionProvenance); break;
    }
  }
  const changedFiles = await listChangedFiles(ctx, repository, state.actionProvenance);
  const diff = await exportRepositoryDiff(ctx, repository, state.actionProvenance);
  state.draft = {
    baseRevision: state.materialization.resolvedCommit ?? state.materialization.requestedRef,
    taskReferences: [...new Set([...(state.draft?.taskReferences ?? []), ...parsed.taskReferences])],
    operationCount: (state.draft?.operationCount ?? 0) + parsed.operations.length,
    checks: [], changedFiles, diff,
  };
  state.lastResult = undefined;
  await persistState(state);
  return state.draft;
}

export async function inspectAuthoringDraft(input: { paths?: string[] }, ctx: ToolContext, state: WorkflowState, persistState: PersistState = saveRepositoryWorkflowState) {
  const repository = state.repositoryInput.workingDocumentationRepository;
  const changedFiles = await listChangedFiles(ctx, repository, state.actionProvenance);
  const diff = await exportRepositoryDiff(ctx, repository, state.actionProvenance);
  const files = [];
  for (const path of [...new Set(input.paths ?? [])].slice(0, 10)) {
    try { files.push({ path, content: await readRepositoryFile(ctx, repository, path, state.actionProvenance) }); }
    catch { files.push({ path, content: null }); }
  }
  await persistState(state);
  return { draft: state.draft ?? null, changedFiles, diff, files };
}

export async function prepareAuthoringDraft(input: z.infer<typeof prepareAuthoringDraftInputSchema>, ctx: ToolContext, state: WorkflowState, persistState: PersistState = saveRepositoryWorkflowState) {
  const parsed = prepareAuthoringDraftInputSchema.parse(input);
  const repository = state.repositoryInput.workingDocumentationRepository;
  const sandbox = await ctx.getSandbox();
  const head = await sandbox.run({ command: "git rev-parse HEAD", workingDirectory: repository.sandboxPath, abortSignal: ctx.abortSignal });
  const baseRevision = state.materialization.resolvedCommit;
  if (head.exitCode !== 0 || baseRevision === undefined || head.stdout.trim() !== baseRevision) {
    throw new Error(`Authoring draft base is stale. Expected ${baseRevision ?? "a resolved revision"}, found ${head.stdout.trim() || "unknown"}. Re-materialize and rebuild the draft.`);
  }
  const checks = [];
  for (const check of parsed.checks) checks.push(await runRepositoryCheck(ctx, repository, check, state.actionProvenance));
  const changedFiles = await listChangedFiles(ctx, repository, state.actionProvenance);
  const diff = await exportRepositoryDiff(ctx, repository, state.actionProvenance);
  if (changedFiles.length === 0 || diff.trim() === "") throw new Error("Cannot prepare an empty authoring draft.");
  const ok = checks.every(({ status }) => status === "passed");
  state.draft = { baseRevision, taskReferences: state.draft?.taskReferences ?? [], operationCount: state.draft?.operationCount ?? 0, checks, changedFiles, diff, preparedAt: new Date().toISOString() };
  state.lastResult = {
    ok, scenarioKind: "unknown", materialization: state.materialization,
    report: { decision: ok ? "docs-patch" : "ask-maintainer", affectedPages: changedFiles, proposedAction: ok ? "Review the complete authoring draft before approved writeback." : "Fix failed repository checks before publishing.", evidence: parsed.evidence, consideredPages: changedFiles, uncertainty: parsed.uncertainty, patchSummary: parsed.patchSummary, checks },
    changedFiles, diff, noDiff: false, actionProvenance: state.actionProvenance,
    rawSandboxToolsPolicy: "Use only the policy-aware authoring workspace for working-repository changes.",
  };
  await persistState(state);
  return { ok, draft: state.draft, report: state.lastResult.report };
}

export async function abandonAuthoringDraft(ctx: ToolContext, state: WorkflowState, persistState: PersistState = saveRepositoryWorkflowState) {
  await resetRepositoryDraft(ctx, state.repositoryInput.workingDocumentationRepository, state.actionProvenance);
  state.draft = undefined;
  state.lastResult = undefined;
  await persistState(state);
  return { abandoned: true as const };
}
