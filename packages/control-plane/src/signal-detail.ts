import { z } from "zod";

import {
  docsSignalArtifactKindSchema,
  docsSignalLinkKindSchema,
  docsSignalSourceKindSchema,
  getDocsSignal,
  type DocsSignalDetail,
} from "./docs-signals.ts";
import { docsSignalStatusSchema } from "./docs-signal-lifecycle.ts";
import {
  ownedDocsWorkConversationSchema,
  ownedDocsWorkOutcomeSchema,
  ownedDocsWorkReferencesSchema,
  ownedDocsWorkStatusSchema,
} from "./owned-docs-work-contract.ts";
import {
  internalDocumentReferenceSchema,
  listInternalDocumentReferencesBySource,
} from "./internal-documents.ts";

const redactedMetadataSchema = z.record(z.string(), z.unknown());

export const operatorWorkMapSchema = z.object({
  source: z.object({ recordIds: z.array(z.string()) }).strict(),
  evidence: z.object({
    linkIds: z.array(z.string()),
    artifactIds: z.array(z.string()),
  }).strict(),
  typedDecisions: z.object({
    editorialRecommendationId: z.string().nullable(),
    contentPlanId: z.string().nullable(),
    artifactIds: z.array(z.string()),
  }).strict(),
  internalDocuments: z.array(internalDocumentReferenceSchema),
  draft: z.object({
    draftId: z.string().nullable(),
    artifactIds: z.array(z.string()),
  }).strict(),
  checks: z.object({
    referenceIds: z.array(z.string()),
    artifactIds: z.array(z.string()),
  }).strict(),
  approval: z.object({
    requestId: z.string().nullable(),
    artifactIds: z.array(z.string()),
  }).strict(),
  outcome: z.object({
    workStatus: ownedDocsWorkStatusSchema.nullable(),
    result: ownedDocsWorkOutcomeSchema.nullable(),
    publicationArtifactId: z.string().nullable(),
    artifactIds: z.array(z.string()),
  }).strict(),
  memoryBoundary: z.object({
    classification: z.literal("routing-context"),
    independentPublicProof: z.literal(false),
    explanation: z.string(),
  }).strict(),
}).strict();

export const operatorSignalDetailSchema = z.object({
  id: z.string(),
  status: docsSignalStatusSchema,
  sourceKind: docsSignalSourceKindSchema,
  sourceSummary: z.string(),
  extractedClaims: z.array(z.string()),
  likelyDocsConcepts: z.array(z.string()),
  likelyDocsPages: z.array(z.string()),
  productSurfaces: z.array(z.string()),
  missingEvidence: z.array(z.string()),
  uncertainty: z.string().nullable(),
  priority: z.number().int(),
  nextActionAt: z.string().nullable(),
  capturedAt: z.string(),
  updatedAt: z.string(),
  workMap: operatorWorkMapSchema,
  ownedWork: z.object({
    id: z.string(),
    signalId: z.string(),
    status: ownedDocsWorkStatusSchema,
    sessionId: z.string(),
    startedRunId: z.string(),
    lastRunId: z.string(),
    conversation: ownedDocsWorkConversationSchema,
    intendedOutcome: z.string(),
    references: ownedDocsWorkReferencesSchema,
    outcome: ownedDocsWorkOutcomeSchema.nullable(),
    revision: z.number().int().positive(),
    lastMilestone: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }).nullable(),
  sources: z.array(z.object({
    id: z.string(),
    kind: docsSignalSourceKindSchema,
    provider: z.string().nullable(),
    permalink: z.string().nullable(),
    title: z.string().nullable(),
    authors: z.array(z.string()),
    sourceText: z.string().nullable(),
    sourceCreatedAt: z.string().nullable(),
    sourceUpdatedAt: z.string().nullable(),
    capturedAt: z.string(),
    metadata: redactedMetadataSchema,
  })),
  links: z.array(z.object({
    id: z.string(),
    kind: docsSignalLinkKindSchema,
    label: z.string().nullable(),
    url: z.string().nullable(),
    externalId: z.string().nullable(),
    metadata: redactedMetadataSchema,
  })),
  artifacts: z.array(z.object({
    id: z.string(),
    kind: docsSignalArtifactKindSchema,
    label: z.string().nullable(),
    url: z.string().nullable(),
    path: z.string().nullable(),
    metadata: redactedMetadataSchema,
    createdAt: z.string(),
  })),
  events: z.array(z.object({
    id: z.string(),
    eventType: z.string(),
    fromStatus: docsSignalStatusSchema.nullable(),
    toStatus: docsSignalStatusSchema.nullable(),
    reason: z.string(),
    actor: z.string(),
    metadata: redactedMetadataSchema,
    createdAt: z.string(),
  })),
});

export type OperatorSignalDetail = z.infer<typeof operatorSignalDetailSchema>;

export async function getOperatorSignalDetail(input: {
  id: string;
}): Promise<OperatorSignalDetail> {
  const [detail, internalDocuments] = await Promise.all([
    getDocsSignal(input),
    listInternalDocumentReferencesBySource({
      kind: "docs-signal",
      id: input.id,
    }),
  ]);

  return operatorSignalDetailSchema.parse({
    id: detail.id,
    status: detail.status,
    sourceKind: detail.sourceKind,
    sourceSummary: detail.sourceSummary,
    extractedClaims: detail.extractedClaims,
    likelyDocsConcepts: detail.likelyDocsConcepts,
    likelyDocsPages: detail.likelyDocsPages,
    productSurfaces: detail.productSurfaces,
    missingEvidence: detail.missingEvidence,
    uncertainty: detail.uncertainty,
    priority: detail.priority,
    nextActionAt: detail.nextActionAt,
    capturedAt: detail.capturedAt,
    updatedAt: detail.updatedAt,
    workMap: buildOperatorWorkMap(detail, internalDocuments),
    ownedWork: detail.ownedWork === null ? null : {
      id: detail.ownedWork.id,
      signalId: detail.ownedWork.signalId,
      status: detail.ownedWork.status,
      sessionId: detail.ownedWork.sessionId,
      startedRunId: detail.ownedWork.startedRunId,
      lastRunId: detail.ownedWork.lastRunId,
      conversation: {
        ...detail.ownedWork.conversation,
        url: safeExternalUrl(detail.ownedWork.conversation.url ?? null) ?? undefined,
      },
      intendedOutcome: detail.ownedWork.intendedOutcome,
      references: detail.ownedWork.references,
      outcome: detail.ownedWork.outcome,
      revision: detail.ownedWork.revision,
      lastMilestone: detail.ownedWork.lastMilestone,
      createdAt: detail.ownedWork.createdAt,
      updatedAt: detail.ownedWork.updatedAt,
    },
    sources: detail.sources.map((source) => ({
      id: source.id,
      kind: source.kind,
      provider: source.provider,
      permalink: safeExternalUrl(source.permalink),
      title: source.title,
      authors: source.authors,
      sourceText: source.sourceText,
      sourceCreatedAt: source.sourceCreatedAt,
      sourceUpdatedAt: source.sourceUpdatedAt,
      capturedAt: source.capturedAt,
      metadata: redactMetadata(source.metadata),
    })),
    links: detail.links.map((link) => ({
      id: link.id,
      kind: link.kind,
      label: link.label,
      url: safeExternalUrl(link.url),
      externalId: link.externalId,
      metadata: redactMetadata(link.metadata),
    })),
    artifacts: detail.artifacts.map((artifact) => ({
      id: artifact.id,
      kind: artifact.kind,
      label: artifact.label,
      url: safeExternalUrl(artifact.url),
      path: artifact.path,
      metadata: redactMetadata(artifact.metadata),
      createdAt: artifact.createdAt,
    })),
    events: detail.events
      .map((event) => ({
        id: event.id,
        eventType: event.eventType,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        reason: event.reason,
        actor: event.actor,
        metadata: redactMetadata(event.metadata),
        createdAt: event.createdAt,
      }))
      .sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      ),
  });
}

function buildOperatorWorkMap(
  detail: DocsSignalDetail,
  internalDocuments: z.infer<typeof internalDocumentReferenceSchema>[],
) {
  const artifacts = (...kinds: Array<z.infer<typeof docsSignalArtifactKindSchema>>) =>
    detail.artifacts.filter(({ kind }) => kinds.includes(kind)).map(({ id }) => id);
  return {
    source: { recordIds: detail.sources.map(({ id }) => id) },
    evidence: {
      linkIds: detail.links.map(({ id }) => id),
      artifactIds: artifacts("verification-report", "impact-report"),
    },
    typedDecisions: {
      editorialRecommendationId: detail.ownedWork?.references.editorialRecommendationId ?? null,
      contentPlanId: detail.ownedWork?.references.contentPlanId ?? null,
      artifactIds: artifacts("editorial-recommendation", "content-plan"),
    },
    internalDocuments,
    draft: {
      draftId: detail.ownedWork?.references.draftId ?? null,
      artifactIds: artifacts("authoring-draft", "diff"),
    },
    checks: {
      referenceIds: detail.ownedWork?.references.validationArtifactIds ?? [],
      artifactIds: artifacts("validation-result", "check-log"),
    },
    approval: {
      requestId: detail.ownedWork?.references.approvalRequestId ?? null,
      artifactIds: artifacts("approval-request"),
    },
    outcome: {
      workStatus: detail.ownedWork?.status ?? null,
      result: detail.ownedWork?.outcome ?? null,
      publicationArtifactId: detail.ownedWork?.references.publicationArtifactId ?? null,
      artifactIds: artifacts("publication", "draft-pr"),
    },
    memoryBoundary: {
      classification: "routing-context" as const,
      independentPublicProof: false as const,
      explanation: "Workspace memory may route investigation and preserve reviewed context, but it remains separate from verified source evidence and cannot independently prove a public documentation claim.",
    },
  };
}

const sensitiveKey = /token|secret|password|authorization|cookie|credential|api[-_]?key/i;
const internalKey = /^(?:dedupeKey|providerId|workspaceId|operationKey|lastOperationKey)$/i;
const sensitiveValue = /(?:github_pat_|gh[opusr]_|xox[baprs]-|lin_api_)[A-Za-z0-9_-]+/i;

export function redactMetadata(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input)
      .filter(([key]) => !internalKey.test(key))
      .map(([key, value]) => [
        key,
        sensitiveKey.test(key) ? "[redacted]" : redactValue(value),
      ]),
  );
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    return sensitiveValue.test(value) ? "[redacted]" : value;
  }
  if (Array.isArray(value)) return value.map(redactValue);
  if (isRecord(value)) return redactMetadata(value);
  return value;
}

export function safeExternalUrl(value: string | null): string | null {
  if (value === null) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "") return null;
    if ([...url.searchParams.keys()].some((key) => sensitiveKey.test(key))) return null;
    if (sensitiveValue.test(value)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
