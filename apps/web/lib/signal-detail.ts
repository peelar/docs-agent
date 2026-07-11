import "server-only";

import {
  getOperatorSignalDetail,
  operatorSignalDetailSchema,
  type OperatorSignalDetail,
} from "@docs-agent/control-plane";

const TEST_SCENARIO_ENV = "DOCS_AGENT_SIGNAL_TEST_SCENARIOS";

export type SignalDetailResult =
  | { state: "ready"; signal: OperatorSignalDetail }
  | { state: "missing" }
  | { state: "corrupt" }
  | { state: "unauthorized" }
  | { state: "database-error" };

export async function resolveSignalDetail(
  id: string,
  requestedScenario?: string,
): Promise<SignalDetailResult> {
  if (process.env[TEST_SCENARIO_ENV] === "1") {
    if (requestedScenario === "missing") return { state: "missing" };
    if (requestedScenario === "corrupt") return { state: "corrupt" };
    if (requestedScenario === "unauthorized") return { state: "unauthorized" };
    if (requestedScenario === "database-error") return { state: "database-error" };
    return { state: "ready", signal: fixtureSignal(id) };
  }

  try {
    return { state: "ready", signal: await getOperatorSignalDetail({ id }) };
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) return { state: "missing" };
    if (error instanceof Error && error.name === "ZodError") return { state: "corrupt" };
    if (
      error instanceof Error &&
      (error.name === "UnauthorizedError" || /unauthorized|forbidden/i.test(error.message))
    ) {
      return { state: "unauthorized" };
    }
    return { state: "database-error" };
  }
}

function fixtureSignal(id: string): OperatorSignalDetail {
  return operatorSignalDetailSchema.parse({
    id,
    status: "patch-prepared",
    sourceKind: "linear-issue",
    sourceSummary: "Private metadata filtering needs a focused conceptual docs update.",
    extractedClaims: ["Privileged apps and staff can filter objects by private metadata."],
    likelyDocsConcepts: ["Metadata permissions", "GraphQL filtering"],
    likelyDocsPages: ["docs/api-usage/metadata.mdx"],
    productSurfaces: ["GraphQL API", "Apps"],
    missingEvidence: [],
    uncertainty: "Generated API reference changes are tracked separately.",
    priority: 78,
    nextActionAt: "2026-07-12T11:00:00.000Z",
    capturedAt: "2026-07-11T14:00:00.000Z",
    updatedAt: "2026-07-11T17:05:00.000Z",
    ownedWork: {
      id: `owned:${id}`,
      signalId: id,
      status: "draft-ready",
      sessionId: "session-owned-docs-101",
      startedRunId: "turn-owned-docs-101-start",
      lastRunId: "turn-owned-docs-101-draft",
      conversation: { kind: "linear-issue", id: "DOCS-101", url: "https://linear.app/acme/issue/DOCS-101" },
      intendedOutcome: "Deliver a checked conceptual docs update for private metadata filtering.",
      references: { impactReportId: "impact-DOCS-101", editorialRecommendationId: "editorial-DOCS-101", contentPlanId: "plan-DOCS-101", draftId: "draft-DOCS-101", validationArtifactIds: ["artifact-check"] },
      outcome: null,
      revision: 6,
      lastMilestone: "draft-ready",
      createdAt: "2026-07-11T14:05:00.000Z",
      updatedAt: "2026-07-11T16:30:00.000Z",
    },
    sources: [{
      id: "source-linear",
      kind: "linear-issue",
      provider: "Linear",
      permalink: "https://linear.app/acme/issue/DOCS-101",
      title: "Document private metadata filtering",
      authors: ["Marta", "Kai"],
      sourceText: "<script>window.__unsafe = true</script> Staff and apps need permission-aware guidance.",
      sourceCreatedAt: "2026-07-11T13:30:00.000Z",
      sourceUpdatedAt: "2026-07-11T13:55:00.000Z",
      capturedAt: "2026-07-11T14:00:00.000Z",
      metadata: { team: "Documentation", credential: "[redacted]" },
    }],
    links: [
      { id: "link-docs", kind: "docs-page", label: "Metadata guide", url: "https://docs.saleor.io/developer/metadata", externalId: null, metadata: {} },
      { id: "link-unsafe", kind: "other", label: "Unsafe source", url: null, externalId: null, metadata: {} },
    ],
    artifacts: [
      { id: "artifact-report", kind: "verification-report", label: "Current docs verification", url: null, path: null, metadata: { decision: "docs-patch", pages: ["docs/api-usage/metadata.mdx"] }, createdAt: "2026-07-11T15:00:00.000Z" },
      { id: "artifact-check", kind: "check-log", label: "Repository checks", url: null, path: null, metadata: { checks: [{ name: "diff-check", status: "passed" }] }, createdAt: "2026-07-11T16:00:00.000Z" },
      { id: "artifact-diff", kind: "diff", label: "Prepared patch", url: null, path: "/workspace/working-docs", metadata: { changedFiles: ["docs/api-usage/metadata.mdx"] }, createdAt: "2026-07-11T16:30:00.000Z" },
      { id: "artifact-pr", kind: "draft-pr", label: "Draft pull request", url: "https://github.com/peelar/saleor-docs/pull/42", path: null, metadata: { secretToken: "[redacted]" }, createdAt: "2026-07-11T17:00:00.000Z" },
    ],
    events: [
      { id: "event-1", eventType: "signal-created", fromStatus: null, toStatus: "captured", reason: "Signal captured from delegated issue.", actor: "docs-agent", metadata: {}, createdAt: "2026-07-11T14:00:00.000Z" },
      { id: "event-2", eventType: "lifecycle-updated", fromStatus: "captured", toStatus: "docs-verified", reason: "Current documentation was verified.", actor: "docs-agent:current-docs-verification", metadata: {}, createdAt: "2026-07-11T15:00:00.000Z" },
      { id: "event-3", eventType: "lifecycle-updated", fromStatus: "docs-verified", toStatus: "patch-prepared", reason: "A checked patch is ready for review.", actor: "docs-agent:patch-handoff", metadata: {}, createdAt: "2026-07-11T16:30:00.000Z" },
    ],
  });
}
