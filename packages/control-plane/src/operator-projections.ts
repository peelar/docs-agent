import { z } from "zod";

import {
  authoredToolNameSchema,
  capabilityFamilyTools,
  resolveCapabilityMatrix,
  type CapabilityResolution,
  type PrincipalProjection,
} from "./capability-resolution.ts";
import { capabilityResolutionReasonSchema } from "./capability-resolution-events.ts";
import { capabilityFamilySchema, type CapabilityFamily } from "./capability-contract.ts";
import {
  buildWorkspaceKnowledgeSourceRegistry,
  workspaceKnowledgeSourceKindSchema,
  workspaceKnowledgeSourceReferenceSchema,
  type WorkspaceKnowledgeSource,
} from "./workspace-knowledge-contract.ts";
import { getSetupStatus, readSetupState } from "./setup-state.ts";

const canonicalSourceShape = workspaceKnowledgeSourceReferenceSchema.shape;
const canonicalRepositoryShape = canonicalSourceShape.repository.unwrap().shape;
const canonicalFreshnessShape = canonicalSourceShape.freshness.shape;
const canonicalRetentionShape = canonicalSourceShape.retention.shape;
const operatorRepositorySourceKindSchema = workspaceKnowledgeSourceKindSchema.extract([
  "working-documentation",
  "watched-repository",
  "context-repository",
]);

export const operatorKnowledgeSourceSchema = z.object({
  sourceId: canonicalSourceShape.sourceId,
  kind: operatorRepositorySourceKindSchema,
  displayName: canonicalSourceShape.displayName,
  description: canonicalSourceShape.description,
  provenanceLabel: canonicalSourceShape.provenanceLabel,
  evidenceClass: canonicalSourceShape.evidenceClass,
  canSupportPublicDocsClaim: canonicalSourceShape.canSupportPublicDocsClaim,
  readiness: canonicalSourceShape.readiness,
  repository: z.object({
    url: canonicalRepositoryShape.url,
    requestedRef: canonicalRepositoryShape.requestedRef,
    resolvedRevision: canonicalFreshnessShape.resolvedRevision,
    observedAt: canonicalFreshnessShape.observedAt,
    pathFilters: canonicalRepositoryShape.pathFilters,
  }).strict(),
  authority: z.object({
    readActions: canonicalSourceShape.allowedReadActions,
    draftMutation: z.enum(["working-documentation-only", "none"]),
    explanation: z.string(),
  }).strict(),
  retention: canonicalRetentionShape.detail,
  contentTrust: canonicalSourceShape.contentTrust,
}).strict();

export const operatorKnowledgeSourcesSchema = z.object({
  state: z.enum(["ready", "unconfigured"]),
  summary: z.string(),
  sources: z.array(operatorKnowledgeSourceSchema),
}).strict();

export type OperatorKnowledgeSources = z.infer<typeof operatorKnowledgeSourcesSchema>;

export async function getOperatorKnowledgeSources(): Promise<OperatorKnowledgeSources> {
  const state = await readSetupState();
  const repositoryInput = state?.workingRepositoryInput;
  if (repositoryInput === undefined) {
    return operatorKnowledgeSourcesSchema.parse({
      state: "unconfigured",
      summary: "Workspace setup has no configured knowledge-source registry yet.",
      sources: [],
    });
  }

  const registry = buildWorkspaceKnowledgeSourceRegistry({
    workspaceId: "operator-projection",
    repositoryInput,
  });
  return operatorKnowledgeSourcesSchema.parse({
    state: "ready",
    summary: `${registry.length} configured knowledge ${registry.length === 1 ? "source" : "sources"}. Repository revisions resolve on verified reads rather than from browser input.`,
    sources: registry.map(projectSource),
  });
}

const capabilityAvailabilitySchema = z.enum(["available", "unavailable", "conditional"]);
const capabilityContextSchema = z.enum(["eve", "slack", "linear", "schedule", "watch"]);

export const operatorCapabilityItemSchema = z.object({
  family: capabilityFamilySchema,
  label: z.string(),
  availability: capabilityAvailabilitySchema,
  explanation: z.string(),
  toolNames: z.array(authoredToolNameSchema),
}).strict();

export const operatorCapabilityContextSchema = z.object({
  context: capabilityContextSchema,
  label: z.string(),
  principalClass: z.string(),
  verifiedBy: z.string(),
  reasonCodes: z.array(capabilityResolutionReasonSchema).max(12),
  effectiveToolNames: z.array(authoredToolNameSchema),
  capabilities: z.array(operatorCapabilityItemSchema).length(7),
}).strict();

export const operatorCapabilityReportSchema = z.object({
  setupReady: z.boolean(),
  writebackReady: z.boolean(),
  summary: z.string(),
  contexts: z.array(operatorCapabilityContextSchema).length(5),
}).strict();

export type OperatorCapabilityReport = z.infer<typeof operatorCapabilityReportSchema>;

export async function getOperatorCapabilityReport(): Promise<OperatorCapabilityReport> {
  const setup = await getSetupStatus();
  return buildOperatorCapabilityReport({
    docsMaintenanceReady: setup.docsMaintenanceReady,
    githubWritebackReady: setup.githubWritebackReady,
  });
}

export function buildOperatorCapabilityReport(input: {
  docsMaintenanceReady: boolean;
  githubWritebackReady: boolean;
}): OperatorCapabilityReport {
  const resolutionInput = {
    docsMaintenanceReady: input.docsMaintenanceReady,
    githubWritebackReady: input.githubWritebackReady,
    preparedDraftReady: false,
    watchReservationId: null,
    watchAuthority: null,
    enforceChannel: true,
  } as const;

  const ordinaryContexts = operatorContexts.map((context) => ({
    ...context,
    resolution: resolveCapabilityMatrix({
      ...resolutionInput,
      current: context.principal,
      initiator: context.principal,
      channelKind: context.channelKind,
    }),
  }));

  return operatorCapabilityReportSchema.parse({
    setupReady: input.docsMaintenanceReady,
    writebackReady: input.githubWritebackReady,
    summary: "Capability availability is derived from the same verified-principal, setup, and tool-family resolver used by the Eve runtime. Execution rechecks authority inside every tool.",
    contexts: [
      ...ordinaryContexts.map(projectCapabilityContext),
      projectConditionalWatchContext(),
    ],
  });
}

const familyLabels: Record<CapabilityFamily, string> = {
  "knowledge.read": "Workspace knowledge",
  "repository.read": "Repository inspection",
  "docs_work.manage": "Documentation work",
  "draft.edit": "Reversible drafting",
  "follow_up.schedule": "Bounded follow-up",
  "provider.deliver": "Provider delivery",
  "publication.publish": "Publication",
};

const familyDescriptions: Record<CapabilityFamily, string> = {
  "knowledge.read": "Read bounded, provenance-bearing workspace evidence.",
  "repository.read": "Inspect configured repositories under repository policy.",
  "docs_work.manage": "Read or update typed Paige-owned documentation work.",
  "draft.edit": "Edit only the reversible working-documentation sandbox.",
  "follow_up.schedule": "Manage bounded signal-linked follow-up work.",
  "provider.deliver": "Deliver to an exact preapproved provider target under policy and budgets.",
  "publication.publish": "Publish one prepared checked draft only after explicit human approval.",
};

const operatorContexts: Array<{
  context: "eve" | "slack" | "linear" | "schedule";
  label: string;
  principalClass: string;
  verifiedBy: string;
  channelKind: string;
  principal: PrincipalProjection;
}> = [
  {
    context: "eve",
    label: "Interactive Eve",
    principalClass: "Verified human operator",
    verifiedBy: "Vercel OIDC or loopback-only local development authentication",
    channelKind: "http",
    principal: {
      authenticator: "oidc",
      issuer: "https://oidc.vercel.com/operator-projection",
      principalId: "operator-projection",
      principalType: "user",
    },
  },
  {
    context: "slack",
    label: "Slack",
    principalClass: "Verified Slack participant",
    verifiedBy: "Slack signature and installed-workspace admission",
    channelKind: "chat-sdk",
    principal: {
      authenticator: "slack-webhook",
      issuer: "slack:operator-projection",
      principalId: "slack:operator-projection:user",
      principalType: "user",
    },
  },
  {
    context: "linear",
    label: "Linear",
    principalClass: "Verified Linear participant",
    verifiedBy: "Linear Agent Session webhook admission",
    channelKind: "linear",
    principal: {
      authenticator: "linear-agent-webhook",
      issuer: "linear:operator-projection",
      principalId: "linear:operator-projection:user",
      principalType: "user",
    },
  },
  {
    context: "schedule",
    label: "Schedule",
    principalClass: "Eve runtime schedule",
    verifiedBy: "Framework-owned schedule principal",
    channelKind: "schedule",
    principal: {
      authenticator: "app",
      issuer: null,
      principalId: "eve:app",
      principalType: "runtime",
    },
  },
];

function projectSource(source: WorkspaceKnowledgeSource) {
  if (source.repository === undefined || ![
    "working-documentation",
    "watched-repository",
    "context-repository",
  ].includes(source.kind)) {
    throw new Error(`Configured source ${source.sourceId} has no operator repository projection.`);
  }
  const mutable = source.kind === "working-documentation";
  return {
    sourceId: source.sourceId,
    kind: source.kind,
    displayName: source.displayName,
    description: source.description,
    provenanceLabel: source.provenanceLabel,
    evidenceClass: source.evidenceClass,
    canSupportPublicDocsClaim: source.canSupportPublicDocsClaim,
    readiness: source.readiness,
    repository: {
      url: source.repository.url,
      requestedRef: source.repository.requestedRef,
      resolvedRevision: source.freshness.resolvedRevision,
      observedAt: source.freshness.observedAt,
      pathFilters: source.repository.pathFilters,
    },
    authority: {
      readActions: source.allowedReadActions,
      draftMutation: mutable ? "working-documentation-only" as const : "none" as const,
      explanation: mutable
        ? "This is the only repository eligible for reversible draft edits. Publication remains separately approval gated."
        : "This source is read-only and cannot reach drafting or publication.",
    },
    retention: source.retention.detail,
    contentTrust: source.contentTrust,
  };
}

function projectCapabilityContext(input: {
  context: "eve" | "slack" | "linear" | "schedule";
  label: string;
  principalClass: string;
  verifiedBy: string;
  resolution: CapabilityResolution;
}) {
  return {
    context: input.context,
    label: input.label,
    principalClass: input.principalClass,
    verifiedBy: input.verifiedBy,
    reasonCodes: [...input.resolution.reasonCodes],
    effectiveToolNames: [...input.resolution.toolNames],
    capabilities: capabilityFamilySchema.options.map((family) => {
      const available = input.resolution.capabilityFamilies.includes(family);
      return {
        family,
        label: familyLabels[family],
        availability: available ? "available" as const : "unavailable" as const,
        explanation: available
          ? `${familyDescriptions[family]} Available for this verified context.`
          : explainUnavailable(family, input.context, input.resolution),
        toolNames: available ? resolvedFamilyTools(family, input.resolution) : [],
      };
    }),
  };
}

function projectConditionalWatchContext() {
  return {
    context: "watch" as const,
    label: "Policy-bound watch",
    principalClass: "Exact claimed watch dispatch",
    verifiedBy: "Opaque dispatch claim, active watch, immutable effective revision, expiry, source scope, and grants",
    reasonCodes: ["watch-authority-unavailable"],
    effectiveToolNames: [],
    capabilities: capabilityFamilySchema.options.map((family) => ({
      family,
      label: familyLabels[family],
      availability: family === "publication.publish" ? "unavailable" as const : "conditional" as const,
      explanation: family === "publication.publish"
        ? "Publication is forbidden for every watch. A human must approve the exact prepared draft in an interactive resume."
        : `${familyDescriptions[family]} Available only when the exact active effective revision grants it and execution rechecks that claim.`,
      toolNames: [],
    })),
  };
}

function resolvedFamilyTools(
  family: CapabilityFamily,
  resolution: CapabilityResolution,
): string[] {
  return resolution.toolNames.filter((tool) =>
    capabilityFamilyTools[family].includes(tool) ||
    family === "follow_up.schedule" && tool === "process_due_docs_followups" ||
    ["knowledge.read", "repository.read"].includes(family) &&
      tool === "scan_watched_repositories"
  );
}

function explainUnavailable(
  family: CapabilityFamily,
  context: "eve" | "slack" | "linear" | "schedule",
  resolution: CapabilityResolution,
): string {
  if (["knowledge.read", "repository.read", "draft.edit"].includes(family) &&
    resolution.reasonCodes.includes("setup-not-ready")) {
    return `${familyDescriptions[family]} Unavailable because canonical workspace setup is not ready.`;
  }
  if (family === "publication.publish") {
    if (context === "schedule") {
      return "Scheduled work cannot publish. Publication requires an exact prepared draft and an explicit human approval resume.";
    }
    return "Publication is unavailable until GitHub writeback and the current Eve session's exact prepared checked draft are both ready; approval is still required on execution.";
  }
  if (family === "provider.deliver") {
    return "Provider delivery is unavailable outside an exact policy-bound watch dispatch.";
  }
  return `${familyDescriptions[family]} This verified context does not grant this family.`;
}
