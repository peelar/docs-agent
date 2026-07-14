import { z } from "zod";

import { legacyImpactDecisionSchema } from "./docs-impact-decision";
import { repositoryActionRecordSchema } from "./repository-materialization";
import type { RepositoryActionRecord } from "./repository-materialization";
import type { ResolvedRepositoryInput } from "./repository-contract";
import type { WorkingRepositoryValidationProfile } from "./working-repository-service";

export const repositoryCheckNameSchema = z.enum([
  "install",
  "build",
  "diff-check",
  "diff-quiet",
  "status",
]);

export const impactDecisionSchema = legacyImpactDecisionSchema;

export const repositoryCheckResultSchema = z.object({
  name: repositoryCheckNameSchema,
  command: z.string(),
  exitCode: z.number(),
  status: z.enum(["passed", "failed"]),
  stdout: z.string(),
  stderr: z.string(),
});

export const repositoryMaterializationSchema = z.object({
  repositoryUrl: z.string(),
  requestedRef: z.string(),
  resolvedCommit: z.string().optional(),
  docsRoot: z.string(),
  sandboxPath: z.string(),
  status: z.enum(["materialized", "failed"]),
});

export const documentationImpactReportSchema = z.object({
  decision: impactDecisionSchema,
  affectedPages: z.array(z.string()),
  proposedAction: z.string(),
  evidence: z.array(z.string()),
  consideredPages: z.array(z.string()),
  uncertainty: z.array(z.string()),
  patchSummary: z.string(),
  checks: z.array(repositoryCheckResultSchema),
});

export const docsMaintenanceWorkflowResultSchema = z.object({
  draftId: z.string(),
  preparedAt: z.string(),
  preparedDiffHash: z.string().regex(/^[a-f0-9]{64}$/),
  ok: z.boolean(),
  materialization: repositoryMaterializationSchema,
  report: documentationImpactReportSchema,
  changedFiles: z.array(z.string()),
  diff: z.string(),
  noDiff: z.boolean(),
  actionProvenance: z.array(repositoryActionRecordSchema),
  rawSandboxToolsPolicy: z.string(),
});

export const authoringOperationKindSchema = z.enum([
  "write-text",
  "write-binary",
  "move",
  "copy",
  "delete",
]);

export const authoringOperationResultSchema = z.object({
  index: z.number().int().nonnegative(),
  kind: authoringOperationKindSchema,
  status: z.enum(["applied", "preflight-failed", "failed", "rolled-back", "skipped"]),
  sourcePath: z.string().optional(),
  targetPath: z.string(),
  expectedContentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  beforeContentHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  afterContentHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  error: z.string().optional(),
});

export const authoringDraftSchema = z.object({
  id: z.string(),
  status: z.enum(["editing", "prepared", "checks-failed"]),
  baseRevision: z.string(),
  taskReferences: z.array(z.string()),
  signalId: z.string().optional(),
  ownedWorkId: z.string().optional(),
  editorialRecommendationId: z.string().optional(),
  editorialRecommendationRevision: z.number().int().positive().optional(),
  contentPlanId: z.string().optional(),
  contentPlanRevision: z.number().int().positive().optional(),
  operationCount: z.number().int().nonnegative(),
  operations: z.array(authoringOperationResultSchema).max(500),
  checks: z.array(repositoryCheckResultSchema),
  changedFiles: z.array(z.string()),
  diff: z.string(),
  preparedAt: z.string().optional(),
  preparedDiffHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});

export const contentPlanSurfaceSchema = z.object({
  action: z.enum(["create", "change", "move", "remove"]),
  path: z.string().trim().min(1),
  destination: z.string().trim().min(1).optional(),
});

export const contentPlanEvidenceSchema = z.object({
  need: z.string().trim().min(1),
  status: z.enum(["available", "missing"]),
  source: z.string().trim().min(1).optional(),
});

export const contentPlanDecisionSchema = z.object({
  question: z.string().trim().min(1),
  consequential: z.boolean(),
  resolution: z.string().trim().min(1).optional(),
});

export const contentPlanSchema = z.object({
  id: z.string(),
  revision: z.number().int().positive(),
  sourceDecisionReference: z.string().trim().min(1),
  taskReferences: z.array(z.string().trim().min(1)),
  reader: z.string().trim().min(1),
  desiredOutcome: z.string().trim().min(1),
  contentType: z.string().trim().min(1),
  placement: z.string().trim().min(1),
  affectedSurfaces: z.array(contentPlanSurfaceSchema).min(1),
  outline: z.array(z.string().trim().min(1)).min(1),
  requiredEvidence: z.array(contentPlanEvidenceSchema),
  examples: z.array(z.string().trim().min(1)),
  assets: z.array(z.string().trim().min(1)),
  unresolvedDecisions: z.array(contentPlanDecisionSchema),
  validation: z.array(z.string().trim().min(1)).min(1),
  definitionOfDone: z.array(z.string().trim().min(1)).min(1),
  status: z.enum(["ready", "blocked"]),
  blockers: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const editorialInterventionSchema = z.enum([
  "no-change",
  "focused-patch",
  "new-document",
  "rewrite",
  "restructure",
  "consolidate",
  "remove",
  "changelog-only",
  "wait-for-evidence",
  "ask-maintainer",
]);

export const editorialRecommendationSchema = z.object({
  id: z.string(),
  revision: z.number().int().positive(),
  sourceDecisionReference: z.string().trim().min(1),
  taskReferences: z.array(z.string().trim().min(1)),
  reader: z.string().trim().min(1),
  readerProblem: z.string().trim().min(1),
  chosenIntervention: editorialInterventionSchema,
  rationale: z.string().trim().min(1),
  repositoryEvidence: z.array(z.string().trim().min(1)),
  docsProfileReferences: z.array(z.string().trim().min(1)),
  sourceEvidence: z.array(z.string().trim().min(1)),
  workspaceMemoryReferences: z.array(z.string().trim().min(1)),
  alternatives: z.array(z.object({
    intervention: editorialInterventionSchema,
    reasonRejected: z.string().trim().min(1),
  })),
  remainingUncertainty: z.array(z.string().trim().min(1)),
  blockingDecisions: z.array(z.string().trim().min(1)),
  maintainerDirection: z.object({
    requestedIntervention: editorialInterventionSchema,
    reaffirmed: z.boolean(),
  }).optional(),
  overrideReason: z.enum(["unsupported-public-claim", "existing-safety-boundary"]).optional(),
  status: z.enum(["proceed", "plan-required", "complete-no-change", "blocked"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type RepositoryCheckName = z.infer<typeof repositoryCheckNameSchema>;
export type RepositoryCheckResult = z.infer<typeof repositoryCheckResultSchema>;
export type DocumentationImpactReport = z.infer<typeof documentationImpactReportSchema>;
export type DocsMaintenanceWorkflowResult = z.infer<typeof docsMaintenanceWorkflowResultSchema>;

export interface WorkflowState {
  repositoryInput: ResolvedRepositoryInput;
  materialization: DocsMaintenanceWorkflowResult["materialization"];
  actionProvenance: RepositoryActionRecord[];
  repositoryValidationProfile?: WorkingRepositoryValidationProfile;
  lastResult?: DocsMaintenanceWorkflowResult;
  editorialRecommendation?: z.infer<typeof editorialRecommendationSchema>;
  contentPlan?: z.infer<typeof contentPlanSchema>;
  draft?: z.infer<typeof authoringDraftSchema>;
  lastAbandonedDraftId?: string;
}
