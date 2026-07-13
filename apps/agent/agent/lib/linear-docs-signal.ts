import { z } from "zod";

import {
  docsImpactDecisionRecordSchema,
  docsImpactEvidenceSchema,
  docsImpactTriageInputSchema,
} from "./docs-impact-decision";
import {
  buildDocsSignalReplyGuidance,
  captureProviderDocsSignal,
  docsSignalVerificationStatusSchema,
} from "./docs-signal-intake";
import {
  docsSignalDetailSchema,
  docsSignalLinkInputSchema,
} from "./docs-signals";

const linearCommentSchema = z.object({
  author: z.string().trim().min(1),
  text: z.string().trim().min(1),
  timestamp: z.string().trim().min(1).optional(),
  url: z.string().url().optional(),
});

const issueTrackerItemContextSchema = z.object({
  type: z.literal("issue-tracker-item"),
  provider: z.literal("linear"),
  organizationId: z.string().optional(),
  agentSessionId: z.string(),
  agentSessionUrl: z.string().url().optional(),
  issueId: z.string().optional(),
  issueIdentifier: z.string().optional(),
  issueTitle: z.string().optional(),
  issueUrl: z.string().url().optional(),
  labels: z.array(z.string()),
  project: z.string().optional(),
  status: z.string().optional(),
  authors: z.array(z.string()),
  commentCount: z.number().int().min(0),
  promptCaptured: z.boolean(),
  capturedAt: z.string(),
  sourceCreatedAt: z.string().optional(),
  sourceUpdatedAt: z.string().optional(),
});

export const captureLinearDocsSignalInputSchema = z.object({
  organizationId: z.string().trim().min(1).optional(),
  agentSessionId: z.string().trim().min(1),
  agentSessionUrl: z.string().url().optional(),
  agentActivityId: z.string().trim().min(1).optional(),
  sourceCommentId: z.string().trim().min(1).optional(),
  issueId: z.string().trim().min(1).optional(),
  issueIdentifier: z.string().trim().min(1).optional(),
  issueTitle: z.string().trim().min(1).optional(),
  issueUrl: z.string().url().optional(),
  labels: z.array(z.string().trim().min(1)).default([]),
  project: z.string().trim().min(1).optional(),
  status: z.string().trim().min(1).optional(),
  promptContext: z.string().trim().min(1).optional(),
  comments: z.array(linearCommentSchema).default([]),
  sourceCreatedAt: z.string().trim().min(1).optional(),
  sourceUpdatedAt: z.string().trim().min(1).optional(),
  capturedAt: z.string().trim().min(1).optional(),
  sourceSummary: z.string().trim().min(1),
  extractedClaims: z.array(z.string().trim().min(1)).default([]),
  likelyDocsConcepts: z.array(z.string().trim().min(1)).default([]),
  likelyDocsPages: z.array(z.string().trim().min(1)).default([]),
  productSurfaces: z.array(z.string().trim().min(1)).default([]),
  missingEvidence: z.array(z.string().trim().min(1)).default([]),
  uncertainty: z.array(z.string().trim().min(1)).default([]),
  priority: z.number().int().min(0).max(100).default(50),
  publicDocsImpact: docsImpactTriageInputSchema.shape.publicDocsImpact,
  sourceEvidence: docsImpactTriageInputSchema.shape.sourceEvidence,
  currentDocsState: docsImpactTriageInputSchema.shape.currentDocsState,
  skippedVerificationReason:
    docsImpactTriageInputSchema.shape.skippedVerificationReason,
  evidence: z.array(docsImpactEvidenceSchema).default([]),
  links: z.array(docsSignalLinkInputSchema).default([]),
});

export const captureLinearDocsSignalResultSchema = z.object({
  created: z.boolean(),
  signal: docsSignalDetailSchema,
  externalContext: issueTrackerItemContextSchema,
  decision: docsImpactDecisionRecordSchema,
  shouldVerifyCurrentDocs: z.boolean(),
  verificationStatus: docsSignalVerificationStatusSchema,
  replyGuidance: z.array(z.string()),
});

export type CaptureLinearDocsSignalInput = z.infer<
  typeof captureLinearDocsSignalInputSchema
>;
export type CaptureLinearDocsSignalResult = z.infer<
  typeof captureLinearDocsSignalResultSchema
>;

export async function captureLinearDocsSignal(
  input: CaptureLinearDocsSignalInput,
): Promise<CaptureLinearDocsSignalResult> {
  const parsed = captureLinearDocsSignalInputSchema.parse(input);
  const capturedAt = parsed.capturedAt ?? new Date().toISOString();
  const externalContext = buildIssueTrackerItemContext(parsed, capturedAt);
  const evidence = [
    buildLinearEvidence(parsed),
    ...parsed.evidence,
  ];
  const intake = await captureProviderDocsSignal({
    signal: {
      source: {
        kind: "linear-issue",
        provider: "linear",
        providerId: linearProviderId(parsed),
        permalink: parsed.issueUrl ?? parsed.agentSessionUrl,
        title: parsed.issueIdentifier === undefined
          ? parsed.issueTitle ?? parsed.sourceSummary
          : `${parsed.issueIdentifier}: ${parsed.issueTitle ?? parsed.sourceSummary}`,
        authors: externalContext.authors,
        sourceText: formatLinearIssueSourceText(parsed),
        sourceCreatedAt: externalContext.sourceCreatedAt,
        sourceUpdatedAt: externalContext.sourceUpdatedAt,
        capturedAt,
        metadata: {
          externalContextType: "issue-tracker-item",
          organizationId: parsed.organizationId,
          agentSessionId: parsed.agentSessionId,
          agentActivityId: parsed.agentActivityId,
          sourceCommentId: parsed.sourceCommentId,
          agentSessionUrl: parsed.agentSessionUrl,
          issueId: parsed.issueId,
          issueIdentifier: parsed.issueIdentifier,
          issueTitle: parsed.issueTitle,
          labels: parsed.labels,
          project: parsed.project,
          status: parsed.status,
          commentUrls: parsed.comments
            .map((comment) => comment.url)
            .filter((url): url is string => url !== undefined),
          commentCount: parsed.comments.length,
        },
      },
      sourceSummary: parsed.sourceSummary,
      extractedClaims: parsed.extractedClaims,
      likelyDocsConcepts: parsed.likelyDocsConcepts,
      likelyDocsPages: parsed.likelyDocsPages,
      productSurfaces: parsed.productSurfaces,
      missingEvidence: parsed.missingEvidence,
      uncertainty: parsed.uncertainty.join(" ") || undefined,
      priority: parsed.priority,
      links: [
        ...linearIssueLinks(parsed),
        ...parsed.links,
      ],
      artifacts: [],
    },
    triage: {
      signalSummary: parsed.sourceSummary,
      publicDocsImpact: parsed.publicDocsImpact,
      sourceEvidence: parsed.sourceEvidence,
      currentDocsState: parsed.currentDocsState,
      evidence,
      missingEvidence: parsed.missingEvidence,
      uncertainty: parsed.uncertainty,
      skippedVerificationReason: parsed.skippedVerificationReason,
    },
    actor: "docs-agent:linear-intake",
    externalContext,
  });

  return captureLinearDocsSignalResultSchema.parse({
    created: intake.created,
    signal: intake.signal,
    externalContext,
    decision: intake.decision,
    shouldVerifyCurrentDocs: intake.shouldVerifyCurrentDocs,
    verificationStatus: intake.verificationStatus,
    replyGuidance: buildDocsSignalReplyGuidance({
      decision: intake.decision,
      verificationStatus: intake.verificationStatus,
      transportInstruction:
        "Reply through Linear Agent Activities with the captured signal summary, decision, evidence, uncertainty, verification status, and next action.",
    }),
  });
}

function buildIssueTrackerItemContext(
  input: CaptureLinearDocsSignalInput,
  capturedAt: string,
): z.infer<typeof issueTrackerItemContextSchema> {
  return issueTrackerItemContextSchema.parse({
    type: "issue-tracker-item",
    provider: "linear",
    organizationId: input.organizationId,
    agentSessionId: input.agentSessionId,
    agentSessionUrl: input.agentSessionUrl,
    issueId: input.issueId,
    issueIdentifier: input.issueIdentifier,
    issueTitle: input.issueTitle,
    issueUrl: input.issueUrl,
    labels: input.labels,
    project: input.project,
    status: input.status,
    authors: linearAuthors(input),
    commentCount: input.comments.length,
    promptCaptured: input.promptContext !== undefined,
    capturedAt,
    sourceCreatedAt: input.sourceCreatedAt ?? firstCommentTimestamp(input),
    sourceUpdatedAt: input.sourceUpdatedAt ?? lastCommentTimestamp(input),
  });
}

function buildLinearEvidence(
  input: CaptureLinearDocsSignalInput,
): z.infer<typeof docsImpactEvidenceSchema> {
  const label = input.issueIdentifier ?? input.issueId ?? input.agentSessionId;

  return docsImpactEvidenceSchema.parse({
    kind: "signal-source",
    summary: `Linear issue/session ${label} was captured as structured issue-tracker-item context.`,
    source: "linear",
    url: input.issueUrl ?? input.agentSessionUrl,
  });
}

function linearProviderId(input: CaptureLinearDocsSignalInput): string {
  if (input.issueId !== undefined) return `issue:${input.issueId}`;
  if (input.issueIdentifier !== undefined) return `issue-key:${input.issueIdentifier}`;
  return `agent-session:${input.agentSessionId}`;
}

function formatLinearIssueSourceText(input: CaptureLinearDocsSignalInput): string {
  const lines = [];

  if (input.issueIdentifier !== undefined || input.issueTitle !== undefined) {
    lines.push(
      `Issue: ${[input.issueIdentifier, input.issueTitle].filter(Boolean).join(" ")}`,
    );
  }

  if (input.status !== undefined) lines.push(`Status: ${input.status}`);
  if (input.project !== undefined) lines.push(`Project: ${input.project}`);
  if (input.labels.length > 0) lines.push(`Labels: ${input.labels.join(", ")}`);
  if (input.promptContext !== undefined) lines.push(`Prompt: ${input.promptContext}`);

  for (const comment of input.comments) {
    const timestamp = comment.timestamp === undefined ? "unknown-time" : comment.timestamp;
    lines.push(`[${timestamp}] ${comment.author}: ${comment.text}`);
  }

  return lines.join("\n");
}

function linearIssueLinks(
  input: CaptureLinearDocsSignalInput,
): z.infer<typeof docsSignalLinkInputSchema>[] {
  const links: z.infer<typeof docsSignalLinkInputSchema>[] = [];

  if (input.issueUrl !== undefined) {
    links.push({
      kind: "linear-issue",
      label: input.issueIdentifier === undefined
        ? input.issueTitle ?? "Linear issue"
        : `${input.issueIdentifier}: ${input.issueTitle ?? "Linear issue"}`,
      url: input.issueUrl,
      externalId: input.issueId ?? input.issueIdentifier,
      metadata: {
        issueId: input.issueId,
        issueIdentifier: input.issueIdentifier,
      },
    });
  }

  if (input.agentSessionUrl !== undefined) {
    links.push({
      kind: "linear-issue",
      label: "Linear Agent Session",
      url: input.agentSessionUrl,
      externalId: input.agentSessionId,
      metadata: {
        agentSessionId: input.agentSessionId,
      },
    });
  }

  return links;
}

function linearAuthors(input: CaptureLinearDocsSignalInput): string[] {
  return [
    ...new Set(input.comments.map((comment) => comment.author)),
  ];
}

function firstCommentTimestamp(input: CaptureLinearDocsSignalInput): string | undefined {
  return input.comments.find((comment) => comment.timestamp !== undefined)?.timestamp;
}

function lastCommentTimestamp(input: CaptureLinearDocsSignalInput): string | undefined {
  return input.comments
    .filter((comment) => comment.timestamp !== undefined)
    .at(-1)?.timestamp;
}
