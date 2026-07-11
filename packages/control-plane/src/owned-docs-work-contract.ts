import { z } from "zod";

export const ownedDocsWorkStatusSchema = z.enum([
  "active",
  "parked",
  "paused",
  "draft-ready",
  "awaiting-approval",
  "completed",
  "blocked",
  "abandoned",
  "failed",
]);

export const ownedDocsWorkConversationSchema = z.object({
  kind: z.enum(["slack-thread", "linear-issue", "terminal", "web", "other"]),
  id: z.string().trim().min(1).max(500),
  url: z.string().url().optional(),
});

export const ownedDocsWorkReferencesSchema = z.object({
  impactReportId: z.string().trim().min(1).optional(),
  editorialRecommendationId: z.string().trim().min(1).optional(),
  contentPlanId: z.string().trim().min(1).optional(),
  draftId: z.string().trim().min(1).optional(),
  validationArtifactIds: z.array(z.string().trim().min(1)).max(50).default([]),
  approvalRequestId: z.string().trim().min(1).optional(),
  publicationArtifactId: z.string().trim().min(1).optional(),
});

export const ownedDocsWorkOutcomeSchema = z.enum([
  "completed-draft",
  "no-change",
  "blocked",
  "abandoned",
  "failed",
]);

export const ownedDocsWorkRecordSchema = z.object({
  id: z.string(),
  signalId: z.string(),
  workspaceId: z.string(),
  status: ownedDocsWorkStatusSchema,
  sessionId: z.string(),
  startedRunId: z.string(),
  lastRunId: z.string(),
  conversation: ownedDocsWorkConversationSchema,
  intendedOutcome: z.string(),
  references: ownedDocsWorkReferencesSchema,
  outcome: ownedDocsWorkOutcomeSchema.nullable(),
  revision: z.number().int().positive(),
  lastOperationKey: z.string(),
  lastMilestone: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type OwnedDocsWorkRecord = z.infer<typeof ownedDocsWorkRecordSchema>;
export type OwnedDocsWorkStatus = z.infer<typeof ownedDocsWorkStatusSchema>;
export type OwnedDocsWorkReferences = z.infer<typeof ownedDocsWorkReferencesSchema>;
