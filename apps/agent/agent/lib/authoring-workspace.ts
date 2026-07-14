import { createHash, randomUUID } from "node:crypto";

import { getOwnedDocsWork } from "@docs-agent/control-plane/agent";
import type { ToolContext } from "eve/tools";
import { z } from "zod";

import {
  copyRepositoryFile,
  deleteRepositoryFile,
  exportRepositoryDiff,
  listChangedFiles,
  moveRepositoryFile,
  resolveRepositoryPath,
  resetRepositoryDraft,
  runRepositoryCheck,
  writeRepositoryBinary,
  writeRepositoryText,
} from "./repository-operations";
import { WorkingRepositoryService } from "./working-repository-service";
import { assertSafeRepositoryPath } from "./repository-path-policy";
import { saveRepositoryWorkflowState } from "./repository-workflow-state";
import {
  authoringOperationResultSchema,
  type WorkflowState,
} from "./repository-workflow-contract";
import { repositoryCheckNameSchema } from "./repository-workflow-contract";
import { recommendationMatchesTask } from "./editorial-recommendation";
import {
  getDocsSignal,
  transitionDocsSignalLifecycle,
  type DocsSignalDetail,
} from "./docs-signals";

const MAX_OPERATIONS_PER_BATCH = 50;
const MAX_TEXT_BYTES = 1_000_000;
const MAX_BINARY_BYTES = 10 * 1024 * 1024;
const MAX_BATCH_BYTES = 20 * 1024 * 1024;
const MAX_DRAFT_OPERATIONS = 500;
const pathSchema = z.string().trim().min(1).max(500);
const referenceSchema = z.string().trim().min(1).max(200);
const contentHashSchema = z.string().regex(/^[a-f0-9]{64}$/, "Use a lowercase SHA-256 content hash.");

const writeTextOperationSchema = z.object({
  kind: z.literal("write-text"),
  path: pathSchema,
  content: z.string(),
  expectedContentHash: contentHashSchema.optional(),
  createOnly: z.literal(true).optional(),
}).superRefine(requireOneWritePrecondition);

const writeBinaryOperationSchema = z.object({
  kind: z.literal("write-binary"),
  path: pathSchema,
  contentBase64: z.string().base64(),
  expectedContentHash: contentHashSchema.optional(),
  createOnly: z.literal(true).optional(),
}).superRefine(requireOneWritePrecondition);

export const authoringOperationSchema = z.union([
  writeTextOperationSchema,
  writeBinaryOperationSchema,
  z.object({
    kind: z.literal("move"),
    from: pathSchema,
    to: pathSchema,
    expectedContentHash: contentHashSchema,
    createOnly: z.literal(true),
  }),
  z.object({
    kind: z.literal("copy"),
    from: pathSchema,
    to: pathSchema,
    expectedContentHash: contentHashSchema,
    createOnly: z.literal(true),
  }),
  z.object({
    kind: z.literal("delete"),
    path: pathSchema,
    expectedContentHash: contentHashSchema,
  }),
]);

export const applyAuthoringDraftInputSchema = z.object({
  operations: z.array(authoringOperationSchema).min(1).max(MAX_OPERATIONS_PER_BATCH),
  taskReferences: z.array(referenceSchema).max(20).default([]),
  signalId: referenceSchema.optional(),
  ownedWorkId: referenceSchema.optional(),
  editorialRecommendationId: referenceSchema.optional(),
  contentPlanId: referenceSchema.optional(),
}).superRefine((input, ctx) => {
  let totalBytes = 0;
  input.operations.forEach((operation, index) => {
    if (operation.kind === "write-text") {
      const bytes = Buffer.byteLength(operation.content);
      totalBytes += bytes;
      if (bytes > MAX_TEXT_BYTES) {
        ctx.addIssue({ code: "custom", path: ["operations", index, "content"], message: `Text content exceeds ${MAX_TEXT_BYTES} bytes.` });
      }
    }
    if (operation.kind === "write-binary") {
      const bytes = Buffer.from(operation.contentBase64, "base64").byteLength;
      totalBytes += bytes;
      if (bytes > MAX_BINARY_BYTES) {
        ctx.addIssue({ code: "custom", path: ["operations", index, "contentBase64"], message: `Binary content exceeds ${MAX_BINARY_BYTES} decoded bytes.` });
      }
    }
  });
  if (totalBytes > MAX_BATCH_BYTES) {
    ctx.addIssue({ code: "custom", path: ["operations"], message: `Authoring batch exceeds ${MAX_BATCH_BYTES} payload bytes.` });
  }
});

export const prepareAuthoringDraftInputSchema = z.object({
  patchSummary: z.string().trim().min(1).max(2_000),
  evidence: z.array(z.string().trim().min(1).max(4_000)).max(50).default([]),
  uncertainty: z.array(z.string().trim().min(1).max(4_000)).max(50).default([]),
  checks: z.array(repositoryCheckNameSchema).min(1).max(5).default(["diff-check"]),
});

export const abandonAuthoringDraftInputSchema = z.object({
  draftId: referenceSchema,
});

type AuthoringOperation = z.infer<typeof authoringOperationSchema>;
type AuthoringOperationResult = z.infer<typeof authoringOperationResultSchema>;
type PersistState = (state: WorkflowState) => Promise<void>;
type FileSnapshot = { content: Uint8Array | null; mode: number | null };

export async function applyAuthoringDraft(
  input: z.infer<typeof applyAuthoringDraftInputSchema>,
  ctx: ToolContext,
  state: WorkflowState,
  persistState: PersistState = saveRepositoryWorkflowState,
) {
  const parsed = applyAuthoringDraftInputSchema.parse(input);
  const repository = state.repositoryInput.workingDocumentationRepository;

  try {
    await assertCurrentDraftBase(ctx, state);
  } catch (error) {
    return failedApply(state, [], null, formatUnknownError(error));
  }

  for (const [index, operation] of parsed.operations.entries()) {
    try {
      for (const path of operationPaths(operation)) {
        await assertSafeRepositoryPath(ctx, repository, path, "file-or-create");
      }
    } catch (error) {
      const message = formatUnknownError(error);
      const failedOperation = operationResult(operation, index, "preflight-failed", null, null, message);
      const results = parsed.operations.map((candidate, candidateIndex) => candidateIndex === index
        ? failedOperation
        : operationResult(candidate, candidateIndex, "skipped", null, null));
      return failedApply(state, results, failedOperation, message);
    }
  }

  const preflight = await preflightOperations(parsed.operations, ctx, state);
  if (!preflight.ok) {
    return failedApply(state, preflight.results, preflight.failedOperation, preflight.error);
  }

  let relations: Awaited<ReturnType<typeof resolveDraftRelations>>;
  try {
    const substantialReason = substantialWorkReason(parsed.operations, preflight.initialFiles);
    relations = await resolveDraftRelations(parsed, substantialReason, ctx, state);
  } catch (error) {
    return failedApply(state, [], null, formatUnknownError(error));
  }

  const previous = snapshotWorkflowState(state);
  const indexSnapshot = await readGitIndex(ctx, state);
  const results: AuthoringOperationResult[] = [];

  try {
    for (const [index, operation] of parsed.operations.entries()) {
      try {
        await executeOperation(operation, ctx, state);
        const planned = preflight.planned[index]!;
        results.push(operationResult(operation, index, "applied", planned.before, planned.after));
      } catch (error) {
        results.push(operationResult(operation, index, "failed", preflight.planned[index]!.before, preflight.planned[index]!.after, formatUnknownError(error)));
        for (let skippedIndex = index + 1; skippedIndex < parsed.operations.length; skippedIndex += 1) {
          const skipped = parsed.operations[skippedIndex]!;
          const planned = preflight.planned[skippedIndex]!;
          results.push(operationResult(skipped, skippedIndex, "skipped", planned.before, planned.after));
        }
        throw error;
      }
    }

    const changedFiles = await listChangedFiles(ctx, repository, state.actionProvenance);
    const diff = await exportRepositoryDiff(ctx, repository, state.actionProvenance);
    const draftId = state.draft?.id ?? `authoring-draft-${randomUUID()}`;
    const allOperations = [...(state.draft?.operations ?? []), ...results];
    if (allOperations.length > MAX_DRAFT_OPERATIONS) {
      throw new Error(`Authoring draft exceeds ${MAX_DRAFT_OPERATIONS} recorded operations. Prepare or abandon it before continuing.`);
    }

    state.draft = {
      id: draftId,
      status: "editing",
      baseRevision: state.materialization.resolvedCommit!,
      taskReferences: unique([...(state.draft?.taskReferences ?? []), ...parsed.taskReferences]),
      signalId: relations.signalId,
      ownedWorkId: relations.ownedWorkId,
      editorialRecommendationId: relations.editorialRecommendation?.id,
      editorialRecommendationRevision: relations.editorialRecommendation?.revision,
      contentPlanId: relations.contentPlan?.id,
      contentPlanRevision: relations.contentPlan?.revision,
      operationCount: allOperations.length,
      operations: allOperations,
      checks: [],
      changedFiles,
      diff,
    };
    state.lastResult = undefined;
    await persistState(state);
    return { ok: true as const, draft: state.draft, operations: results, failedOperation: null, error: null };
  } catch (transactionError) {
    try {
      await restorePreCallFiles(ctx, state, preflight.initialFiles, indexSnapshot);
      restoreWorkflowState(state, previous);
    } catch (rollbackError) {
      restoreWorkflowState(state, previous);
      throw new Error(`Authoring batch failed (${formatUnknownError(transactionError)}) and exact rollback failed: ${formatUnknownError(rollbackError)}`);
    }
    const rolledBack = results.map((result) => result.status === "applied" ? { ...result, status: "rolled-back" as const } : result);
    const failedOperation = rolledBack.find((result) => result.status === "failed") ?? null;
    return failedApply(state, rolledBack, failedOperation, formatUnknownError(transactionError));
  }
}

export async function inspectAuthoringDraft(
  input: { paths?: string[] },
  ctx: ToolContext,
  state: WorkflowState,
  persistState: PersistState = saveRepositoryWorkflowState,
) {
  const repository = state.repositoryInput.workingDocumentationRepository;
  const changedFiles = await listChangedFiles(ctx, repository, state.actionProvenance);
  const diff = await exportRepositoryDiff(ctx, repository, state.actionProvenance);
  const inspection = new WorkingRepositoryService({
    ctx,
    repository,
    materialization: state.materialization,
    actionProvenance: state.actionProvenance,
  });
  const files = [];
  for (const path of unique(input.paths ?? []).slice(0, 10)) {
    try {
      const file = await inspection.read({ path });
      files.push({
        path,
        content: file.content,
        binary: file.binary,
        contentHash: file.contentHash,
        sizeBytes: file.sizeBytes,
      });
    } catch {
      files.push({ path, content: null, binary: null, contentHash: null, sizeBytes: null });
    }
  }
  await persistState(state);
  return { draft: state.draft ?? null, changedFiles, diff, files };
}

export async function prepareAuthoringDraft(
  input: z.infer<typeof prepareAuthoringDraftInputSchema>,
  ctx: ToolContext,
  state: WorkflowState,
  persistState: PersistState = saveRepositoryWorkflowState,
) {
  const parsed = prepareAuthoringDraftInputSchema.parse(input);
  const repository = state.repositoryInput.workingDocumentationRepository;
  const draft = state.draft;
  if (draft === undefined) return failedPrepare("No authoring draft exists to prepare.");

  try {
    await assertCurrentDraftBase(ctx, state);
    await assertDraftRelationsCurrent(ctx, state);
  } catch (error) {
    return failedPrepare(formatUnknownError(error), draft);
  }

  const checks = [];
  for (const check of unique(parsed.checks)) {
    checks.push(await runRepositoryCheck(ctx, repository, check, state.actionProvenance));
  }
  const changedFiles = await listChangedFiles(ctx, repository, state.actionProvenance);
  const diff = await exportRepositoryDiff(ctx, repository, state.actionProvenance);
  if (changedFiles.length === 0 || diff.trim() === "") {
    return failedPrepare("Cannot prepare an empty authoring draft.", draft);
  }

  const ok = checks.every(({ status }) => status === "passed");
  const preparedAt = new Date().toISOString();
  const preparedDiffHash = hashContent(Buffer.from(diff));
  state.draft = {
    ...draft,
    status: ok ? "prepared" : "checks-failed",
    checks,
    changedFiles,
    diff,
    preparedAt,
    preparedDiffHash,
  };

  const linkedSignal = draft.signalId === undefined ? undefined : await getDocsSignal({ id: draft.signalId });
  const evidence = linkedSignal === undefined
    ? parsed.evidence
    : unique([...buildSignalEvidence(linkedSignal), ...parsed.evidence]);
  state.lastResult = {
    draftId: draft.id,
    preparedAt,
    preparedDiffHash,
    ok,
    materialization: state.materialization,
    report: {
      decision: ok ? "docs-patch" : "ask-maintainer",
      affectedPages: changedFiles,
      proposedAction: ok
        ? "Review the complete prepared authoring draft before approved writeback."
        : "Fix failed repository checks before publishing.",
      evidence,
      consideredPages: unique([...changedFiles, ...(linkedSignal?.likelyDocsPages ?? [])]),
      uncertainty: unique([
        ...parsed.uncertainty,
        ...(linkedSignal === undefined ? [] : signalUncertainty(linkedSignal)),
        ...(ok ? [] : [`Checks failed: ${checks.filter(({ status }) => status !== "passed").map(({ name }) => name).join(", ")}`]),
      ]),
      patchSummary: parsed.patchSummary,
      checks,
    },
    changedFiles,
    diff,
    noDiff: false,
    actionProvenance: state.actionProvenance,
    rawSandboxToolsPolicy: "Use only the policy-aware authoring workspace for working-repository changes.",
  };
  await persistState(state);

  const signal = linkedSignal === undefined
    ? undefined
    : await recordPreparedSignalDraft(linkedSignal, state.draft, state.lastResult.report, ok);
  return { ok, draft: state.draft, report: state.lastResult.report, signal, error: null };
}

export async function abandonAuthoringDraft(
  input: z.infer<typeof abandonAuthoringDraftInputSchema>,
  ctx: ToolContext,
  state: WorkflowState,
  persistState: PersistState = saveRepositoryWorkflowState,
) {
  const { draftId } = abandonAuthoringDraftInputSchema.parse(input);
  if (state.draft === undefined) {
    if (state.lastAbandonedDraftId === draftId) {
      return { abandoned: true as const, replayed: true as const, draftId };
    }
    throw new Error(`Authoring draft not found: ${draftId}`);
  }
  if (state.draft.id !== draftId) {
    throw new Error(`Refusing to abandon draft ${draftId}; the active draft is ${state.draft.id}.`);
  }
  await resetRepositoryDraft(ctx, state.repositoryInput.workingDocumentationRepository, state.actionProvenance);
  state.draft = undefined;
  state.lastResult = undefined;
  state.lastAbandonedDraftId = draftId;
  await persistState(state);
  return { abandoned: true as const, replayed: false as const, draftId };
}

async function preflightOperations(
  operations: AuthoringOperation[],
  ctx: ToolContext,
  state: WorkflowState,
): Promise<
  | { ok: true; initialFiles: Map<string, FileSnapshot>; planned: Array<{ before: Uint8Array | null; after: Uint8Array | null }>; results: AuthoringOperationResult[] }
  | { ok: false; initialFiles: Map<string, FileSnapshot>; results: AuthoringOperationResult[]; failedOperation: AuthoringOperationResult; error: string }
> {
  const repository = state.repositoryInput.workingDocumentationRepository;
  const paths = unique(operations.flatMap(operationPaths));
  const sandbox = await ctx.getSandbox();
  const initialFiles = new Map<string, FileSnapshot>();
  for (const path of paths) {
    const absolutePath = resolveRepositoryPath(repository, path);
    const content = await sandbox.readBinaryFile({ path: absolutePath, abortSignal: ctx.abortSignal });
    initialFiles.set(path, {
      content: content === null ? null : Uint8Array.from(content),
      mode: content === null ? null : await readFileMode(ctx, repository.sandboxPath, path),
    });
  }

  const virtual = new Map<string, Uint8Array | null>();
  for (const [path, snapshot] of initialFiles) {
    virtual.set(path, snapshot.content === null ? null : Uint8Array.from(snapshot.content));
  }
  const planned: Array<{ before: Uint8Array | null; after: Uint8Array | null }> = [];
  for (const [index, operation] of operations.entries()) {
    try {
      const before = operation.kind === "move" || operation.kind === "copy"
        ? virtual.get(operation.from) ?? null
        : virtual.get(operation.path) ?? null;
      let after: Uint8Array | null;
      if (operation.kind === "write-text") {
        assertWritePrecondition(operation, before);
        after = Buffer.from(operation.content);
        virtual.set(operation.path, after);
      } else if (operation.kind === "write-binary") {
        assertWritePrecondition(operation, before);
        after = Buffer.from(operation.contentBase64, "base64");
        virtual.set(operation.path, after);
      } else if (operation.kind === "copy" || operation.kind === "move") {
        assertExpectedHash(operation.from, before, operation.expectedContentHash);
        const destination = virtual.get(operation.to) ?? null;
        if (destination !== null) throw new Error(`Create-only destination already exists: ${operation.to}`);
        after = Uint8Array.from(before!);
        virtual.set(operation.to, after);
        if (operation.kind === "move") virtual.set(operation.from, null);
      } else {
        assertExpectedHash(operation.path, before, operation.expectedContentHash);
        after = null;
        virtual.set(operation.path, null);
      }
      planned.push({ before, after });
    } catch (error) {
      const message = formatUnknownError(error);
      const failedOperation = operationResult(operation, index, "preflight-failed", planned[index]?.before ?? null, planned[index]?.after ?? null, message);
      const results = operations.map((candidate, candidateIndex) => {
        if (candidateIndex === index) return failedOperation;
        const candidatePlan = planned[candidateIndex];
        return operationResult(candidate, candidateIndex, "skipped", candidatePlan?.before ?? null, candidatePlan?.after ?? null);
      });
      return { ok: false, initialFiles, results, failedOperation, error: message };
    }
  }
  return { ok: true, initialFiles, planned, results: [] };
}

async function executeOperation(operation: AuthoringOperation, ctx: ToolContext, state: WorkflowState) {
  const repository = state.repositoryInput.workingDocumentationRepository;
  switch (operation.kind) {
    case "write-text": return writeRepositoryText(ctx, repository, operation.path, operation.content, state.actionProvenance);
    case "write-binary": return writeRepositoryBinary(ctx, repository, operation.path, operation.contentBase64, state.actionProvenance);
    case "move": return moveRepositoryFile(ctx, repository, operation.from, operation.to, state.actionProvenance);
    case "copy": return copyRepositoryFile(ctx, repository, operation.from, operation.to, state.actionProvenance);
    case "delete": return deleteRepositoryFile(ctx, repository, operation.path, state.actionProvenance);
  }
}

async function resolveDraftRelations(
  input: z.infer<typeof applyAuthoringDraftInputSchema>,
  substantialReason: string | null,
  ctx: ToolContext,
  state: WorkflowState,
) {
  const draft = state.draft;
  const signalId = stableRelation("docs signal", draft?.signalId, input.signalId);
  const ownedWorkId = stableRelation("owned work", draft?.ownedWorkId, input.ownedWorkId);
  const recommendationId = stableRelation("editorial recommendation", draft?.editorialRecommendationId, input.editorialRecommendationId);
  const planId = stableRelation("content plan", draft?.contentPlanId, input.contentPlanId);
  const taskReferences = unique([...(draft?.taskReferences ?? []), ...input.taskReferences]);

  if (signalId !== undefined) {
    const signal = await getDocsSignal({ id: signalId });
    assertSignalCanBackAuthoringDraft(signal);
  }
  if (ownedWorkId !== undefined) {
    if (signalId === undefined) throw new Error("An owned-work draft relation requires its originating docs signal.");
    const work = await getOwnedDocsWork({ signalId });
    if (work.id !== ownedWorkId) throw new Error(`Owned work ${ownedWorkId} does not belong to signal ${signalId}.`);
    if (work.sessionId !== ctx.session.id) throw new Error(`Owned work ${ownedWorkId} belongs to Eve session ${work.sessionId}, not ${ctx.session.id}.`);
    if (!["active", "draft-ready", "awaiting-approval"].includes(work.status)) {
      throw new Error(`Owned work ${ownedWorkId} cannot author from ${work.status}.`);
    }
  }

  const recommendation = resolveEditorialRecommendation(recommendationId, taskReferences, state);
  const contentPlan = resolveContentPlan(planId, substantialReason, taskReferences, recommendation, state, input.operations);
  return { signalId, ownedWorkId, editorialRecommendation: recommendation, contentPlan };
}

function resolveEditorialRecommendation(
  requestedId: string | undefined,
  taskReferences: string[],
  state: WorkflowState,
) {
  const recommendation = state.editorialRecommendation;
  if (requestedId !== undefined && recommendation?.id !== requestedId) {
    throw new Error(`Editorial recommendation not found: ${requestedId}`);
  }
  const selected = requestedId !== undefined || (recommendation !== undefined && recommendationMatchesTask(recommendation, taskReferences))
    ? recommendation
    : undefined;
  if (selected === undefined) return undefined;
  if (state.draft?.editorialRecommendationRevision !== undefined && state.draft.editorialRecommendationRevision !== selected.revision) {
    throw new Error("The editorial recommendation linked to this draft is stale. Abandon the draft before adopting the revised recommendation.");
  }
  if (selected.status === "blocked") throw new Error(`Editorial recommendation pauses drafting: ${selected.blockingDecisions.join("; ")}`);
  if (selected.status === "complete-no-change") throw new Error("Editorial recommendation selected no change, so no authoring draft should be created.");
  return selected;
}

function resolveContentPlan(
  requestedId: string | undefined,
  substantialReason: string | null,
  taskReferences: string[],
  recommendation: WorkflowState["editorialRecommendation"],
  state: WorkflowState,
  operations: AuthoringOperation[],
) {
  const plan = state.contentPlan;
  const needsPlan = substantialReason !== null || recommendation?.status === "plan-required" || requestedId !== undefined;
  if (!needsPlan) return undefined;
  if (plan === undefined) throw new Error(`Content plan required before substantial documentation work (${substantialReason ?? "planned intervention"}).`);
  if (requestedId !== undefined && plan.id !== requestedId) throw new Error(`Content plan not found: ${requestedId}`);
  if (state.draft?.contentPlanId !== undefined && state.draft.contentPlanId !== plan.id) {
    throw new Error("The active content plan belongs to another draft.");
  }
  if (state.draft?.contentPlanRevision !== undefined && state.draft.contentPlanRevision !== plan.revision) {
    throw new Error(`The content plan linked to this draft is stale. Expected revision ${state.draft.contentPlanRevision}, found ${plan.revision}. Abandon or replan before drafting.`);
  }
  if (plan.status !== "ready") throw new Error(`Content plan is blocked. Resolve before drafting: ${plan.blockers.join("; ")}`);
  if (taskReferences.length === 0 || plan.taskReferences.length === 0 || !taskReferences.some(reference => plan.taskReferences.includes(reference))) {
    throw new Error("The active content plan is unrelated to this authoring task.");
  }
  if (recommendation !== undefined && recommendation.sourceDecisionReference !== plan.sourceDecisionReference) {
    throw new Error("The editorial recommendation and content plan are unrelated.");
  }
  assertOperationsMatchPlan(operations, plan);
  return plan;
}

async function assertDraftRelationsCurrent(ctx: ToolContext, state: WorkflowState) {
  const draft = state.draft!;
  if (draft.signalId !== undefined) assertSignalCanBackAuthoringDraft(await getDocsSignal({ id: draft.signalId }));
  if (draft.ownedWorkId !== undefined) {
    if (draft.signalId === undefined) throw new Error("The prepared draft lost its originating signal relation.");
    const work = await getOwnedDocsWork({ signalId: draft.signalId });
    if (work.id !== draft.ownedWorkId || work.sessionId !== ctx.session.id) throw new Error("The owned-work relation for this draft is missing or belongs to another session.");
    if (!["active", "draft-ready", "awaiting-approval"].includes(work.status)) throw new Error(`Owned work ${work.id} cannot prepare from ${work.status}.`);
  }
  if (draft.editorialRecommendationId !== undefined) {
    const recommendation = state.editorialRecommendation;
    if (recommendation?.id !== draft.editorialRecommendationId || recommendation.revision !== draft.editorialRecommendationRevision) {
      throw new Error("The editorial recommendation linked to this draft is missing or stale.");
    }
    if (recommendation.status === "blocked" || recommendation.status === "complete-no-change") throw new Error("The editorial recommendation no longer permits authoring.");
  }
  if (draft.contentPlanId !== undefined) {
    const plan = state.contentPlan;
    if (plan?.id !== draft.contentPlanId || plan.revision !== draft.contentPlanRevision) throw new Error("The content plan linked to this draft is missing or stale.");
    if (plan.status !== "ready") throw new Error("The content plan linked to this draft is blocked.");
  }
}

async function assertCurrentDraftBase(ctx: ToolContext, state: WorkflowState) {
  const sandbox = await ctx.getSandbox();
  const repository = state.repositoryInput.workingDocumentationRepository;
  const head = await sandbox.run({ command: "git rev-parse HEAD", workingDirectory: repository.sandboxPath, abortSignal: ctx.abortSignal });
  const resolvedBase = state.materialization.resolvedCommit;
  const expectedBase = state.draft?.baseRevision ?? resolvedBase;
  if (head.exitCode !== 0 || resolvedBase === undefined || expectedBase !== resolvedBase || head.stdout.trim() !== resolvedBase) {
    throw new Error(`Authoring draft base is stale. Expected ${expectedBase ?? "a resolved revision"}, materialized ${resolvedBase ?? "unknown"}, found ${head.stdout.trim() || "unknown"}. Re-materialize and rebuild the draft.`);
  }
}

async function recordPreparedSignalDraft(
  signal: DocsSignalDetail,
  draft: NonNullable<WorkflowState["draft"]>,
  report: NonNullable<WorkflowState["lastResult"]>["report"],
  ok: boolean,
) {
  const status = ok ? "patch-prepared" as const : "patch-failed" as const;
  return transitionDocsSignalLifecycle({
    id: signal.id,
    status,
    reason: ok ? `Prepared checked authoring draft ${draft.id}.` : `Validation failed for authoring draft ${draft.id}.`,
    actor: "docs-agent:authoring-workspace",
    links: [],
    artifacts: [{
      kind: ok ? "diff" : "check-log",
      label: ok ? "Prepared authoring draft diff" : "Failed authoring draft validation",
      metadata: {
        draftId: draft.id,
        ownedWorkId: draft.ownedWorkId,
        baseRevision: draft.baseRevision,
        preparedDiffHash: draft.preparedDiffHash,
        changedFiles: draft.changedFiles,
        checks: draft.checks.map(({ name, status: checkStatus, exitCode }) => ({ name, status: checkStatus, exitCode })),
      },
    }],
    metadata: {
      outcome: status,
      draftId: draft.id,
      preparedDiffHash: draft.preparedDiffHash,
      workflowDecision: report.decision,
      approvalRequiredForPublish: true,
    },
  }, "patch-handoff");
}

export function assertSignalCanBackAuthoringDraft(signal: DocsSignalDetail) {
  if (signal.missingEvidence.length > 0 || signal.status === "needs-source-evidence") {
    throw new Error("Refusing authoring because source evidence is still insufficient.");
  }
  if (!["docs-verified", "patch-failed", "patch-prepared"].includes(signal.status)) {
    throw new Error(`Refusing authoring for signal ${signal.id} in ${signal.status}; verify current docs first.`);
  }
}

function assertOperationsMatchPlan(operations: AuthoringOperation[], plan: NonNullable<WorkflowState["contentPlan"]>) {
  const plannedPaths = new Set(plan.affectedSurfaces.flatMap(({ path, destination }) => destination === undefined ? [path] : [path, destination]));
  const changedPaths = unique(operations.flatMap(operation => {
    if (operation.kind === "copy") return [operation.to];
    if (operation.kind === "move") return [operation.from, operation.to];
    return [operation.path];
  }));
  const unrelated = changedPaths.filter(path => !plannedPaths.has(path));
  if (unrelated.length > 0) throw new Error(`The content plan is unrelated to authoring paths: ${unrelated.join(", ")}.`);
}

function substantialWorkReason(operations: AuthoringOperation[], initialFiles: Map<string, FileSnapshot>): string | null {
  const changedPaths = new Set<string>();
  for (const operation of operations) {
    if (operation.kind === "move" || operation.kind === "copy") return `${operation.kind} operation`;
    changedPaths.add(operation.path);
    if (operation.kind === "delete") return "file removal";
  }
  if (changedPaths.size > 1) return "multi-surface change";
  const operation = operations[0]!;
  if (operation.kind === "write-binary") return initialFiles.get(operation.path)?.content === null ? "new asset" : null;
  if (operation.kind === "write-text") {
    const current = initialFiles.get(operation.path)?.content;
    if (current === null || current === undefined) return "new page or file";
    if (isLargeReplacement(Buffer.from(current).toString("utf8"), operation.content)) return "large single-file replacement";
  }
  return null;
}

function isLargeReplacement(current: string, next: string): boolean {
  const before = current.split("\n");
  const after = next.split("\n");
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;
  const changed = Math.max(before.length - prefix - suffix, after.length - prefix - suffix);
  return changed >= 50 || (before.length >= 20 && changed >= Math.ceil(before.length / 2));
}

async function restorePreCallFiles(
  ctx: ToolContext,
  state: WorkflowState,
  files: Map<string, FileSnapshot>,
  indexSnapshot: { path: string; content: Uint8Array },
) {
  const sandbox = await ctx.getSandbox();
  const repository = state.repositoryInput.workingDocumentationRepository;
  for (const [path] of files) {
    await sandbox.removePath({ path: resolveRepositoryPath(repository, path), force: true, recursive: false });
  }
  for (const [path, snapshot] of files) {
    if (snapshot.content === null) continue;
    const absolutePath = resolveRepositoryPath(repository, path);
    await sandbox.writeBinaryFile({ path: absolutePath, content: snapshot.content, abortSignal: ctx.abortSignal });
    if (snapshot.mode !== null) {
      const mode = snapshot.mode.toString(8);
      const result = await sandbox.run({ command: `chmod ${mode} ${quoteShell(path)}`, workingDirectory: repository.sandboxPath, abortSignal: ctx.abortSignal });
      if (result.exitCode !== 0) throw new Error(`Could not restore file mode for ${path}.`);
    }
  }
  await sandbox.writeBinaryFile({ path: indexSnapshot.path, content: indexSnapshot.content, abortSignal: ctx.abortSignal });
  for (const [path, snapshot] of files) {
    const absolutePath = resolveRepositoryPath(repository, path);
    const restored = await sandbox.readBinaryFile({ path: absolutePath, abortSignal: ctx.abortSignal });
    if (hashNullable(restored) !== hashNullable(snapshot.content)) throw new Error(`Rollback did not restore ${path}.`);
  }
}

async function readGitIndex(ctx: ToolContext, state: WorkflowState) {
  const sandbox = await ctx.getSandbox();
  const repository = state.repositoryInput.workingDocumentationRepository;
  const result = await sandbox.run({ command: "git rev-parse --path-format=absolute --git-path index", workingDirectory: repository.sandboxPath, abortSignal: ctx.abortSignal });
  if (result.exitCode !== 0 || result.stdout.trim() === "") throw new Error("Could not locate the Git index before authoring.");
  const path = result.stdout.trim();
  const content = await sandbox.readBinaryFile({ path, abortSignal: ctx.abortSignal });
  if (content === null) throw new Error("Could not snapshot the Git index before authoring.");
  return { path, content: Uint8Array.from(content) };
}

async function readFileMode(ctx: ToolContext, root: string, path: string) {
  const sandbox = await ctx.getSandbox();
  const script = "const fs=require('node:fs');process.stdout.write(String(fs.statSync(process.argv[1]).mode & 0o777))";
  const result = await sandbox.run({ command: `node -e ${quoteShell(script)} ${quoteShell(path)}`, workingDirectory: root, abortSignal: ctx.abortSignal });
  if (result.exitCode !== 0) throw new Error(`Could not inspect file mode for ${path}.`);
  return Number(result.stdout.trim());
}

function snapshotWorkflowState(state: WorkflowState) {
  return {
    actionProvenance: [...state.actionProvenance],
    draft: state.draft === undefined ? undefined : structuredClone(state.draft),
    lastResult: state.lastResult === undefined ? undefined : structuredClone(state.lastResult),
    lastAbandonedDraftId: state.lastAbandonedDraftId,
  };
}

function restoreWorkflowState(state: WorkflowState, previous: ReturnType<typeof snapshotWorkflowState>) {
  state.actionProvenance = previous.actionProvenance;
  state.draft = previous.draft;
  state.lastResult = previous.lastResult;
  state.lastAbandonedDraftId = previous.lastAbandonedDraftId;
}

function operationResult(
  operation: AuthoringOperation,
  index: number,
  status: AuthoringOperationResult["status"],
  before: Uint8Array | null,
  after: Uint8Array | null,
  error?: string,
): AuthoringOperationResult {
  const sourcePath = operation.kind === "move" || operation.kind === "copy" ? operation.from : undefined;
  const targetPath = operation.kind === "move" || operation.kind === "copy" ? operation.to : operation.path;
  return authoringOperationResultSchema.parse({
    index,
    kind: operation.kind,
    status,
    sourcePath,
    targetPath,
    expectedContentHash: "expectedContentHash" in operation ? operation.expectedContentHash : undefined,
    beforeContentHash: hashNullable(before),
    afterContentHash: hashNullable(after),
    error,
  });
}

function failedApply(
  state: WorkflowState,
  operations: AuthoringOperationResult[],
  failedOperation: AuthoringOperationResult | null,
  error: string,
) {
  return { ok: false as const, draft: state.draft ?? null, operations, failedOperation, error };
}

function failedPrepare(error: string, draft?: NonNullable<WorkflowState["draft"]>) {
  return { ok: false as const, draft: draft ?? null, report: null, signal: undefined, error };
}

function requireOneWritePrecondition(
  value: { expectedContentHash?: string; createOnly?: true },
  ctx: z.RefinementCtx,
) {
  if ((value.expectedContentHash === undefined) === (value.createOnly === undefined)) {
    ctx.addIssue({ code: "custom", message: "Provide exactly one of expectedContentHash or createOnly for a write." });
  }
}

function assertWritePrecondition(
  operation: z.infer<typeof writeTextOperationSchema> | z.infer<typeof writeBinaryOperationSchema>,
  current: Uint8Array | null,
) {
  if (operation.createOnly === true) {
    if (current !== null) throw new Error(`Create-only target already exists: ${operation.path}`);
    return;
  }
  assertExpectedHash(operation.path, current, operation.expectedContentHash!);
}

function assertExpectedHash(path: string, content: Uint8Array | null, expected: string) {
  if (content === null) throw new Error(`Expected existing content for ${path}, but the path does not exist.`);
  const actual = hashContent(content);
  if (actual !== expected) throw new Error(`Stale content hash for ${path}. Expected ${expected}, found ${actual}.`);
}

function stableRelation(label: string, current: string | undefined, requested: string | undefined) {
  if (current !== undefined && requested !== undefined && current !== requested) {
    throw new Error(`The active draft is linked to ${label} ${current}, not ${requested}. Abandon it before changing relations.`);
  }
  return current ?? requested;
}

function operationPaths(operation: AuthoringOperation) {
  return operation.kind === "move" || operation.kind === "copy" ? [operation.from, operation.to] : [operation.path];
}

function buildSignalEvidence(signal: DocsSignalDetail): string[] {
  return [
    `Signal ${signal.id}: ${signal.sourceSummary}`,
    ...signal.sources.map(source => [
      `Source ${source.kind}`,
      source.provider === null ? undefined : `provider=${source.provider}`,
      source.providerId === null ? undefined : `providerId=${source.providerId}`,
      source.permalink === null ? undefined : `url=${source.permalink}`,
      source.title === null ? undefined : `title=${source.title}`,
    ].filter(Boolean).join("; ")),
    ...signal.extractedClaims.map(claim => `Claim: ${claim}`),
    ...signal.productSurfaces.map(surface => `Product surface: ${surface}`),
  ];
}

function signalUncertainty(signal: DocsSignalDetail): string[] {
  return [
    ...(signal.uncertainty === null ? [] : [signal.uncertainty]),
    ...signal.missingEvidence.map(item => `Missing evidence: ${item}`),
  ];
}

function hashContent(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashNullable(value: Uint8Array | null): string | null {
  return value === null ? null : hashContent(value);
}

function unique<T extends string>(values: T[]): T[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean) as T[])];
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function quoteShell(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
