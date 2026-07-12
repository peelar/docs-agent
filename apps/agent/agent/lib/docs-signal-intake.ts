import { z } from "zod";

import {
  docsImpactDecisionRecordSchema,
  planDocsImpactDecision,
  shouldVerifyCurrentDocs,
  type DocsImpactDecisionRecord,
  type DocsImpactTriageInput,
} from "./docs-impact-decision.js";
import {
  captureDocsSignal,
  createDocsSignalResultSchema,
  type CreateDocsSignalInput,
  type DocsSignalStatus,
} from "./docs-signals.js";
import { getSetupStatus } from "./setup-state.js";

export const docsSignalVerificationStatusSchema = z.object({
  required: z.boolean(),
  setupReady: z.boolean(),
  state: z.enum(["not-needed", "needed", "blocked", "completed"]),
  reason: z.string(),
});

export const providerDocsSignalIntakeResultSchema = z.object({
  created: z.boolean(),
  signal: createDocsSignalResultSchema.shape.signal,
  decision: docsImpactDecisionRecordSchema,
  shouldVerifyCurrentDocs: z.boolean(),
  verificationStatus: docsSignalVerificationStatusSchema,
});

export type DocsSignalVerificationStatus = z.infer<
  typeof docsSignalVerificationStatusSchema
>;

export type ProviderDocsSignalIntakeInput = {
  signal: CreateDocsSignalInput;
  triage: DocsImpactTriageInput;
  actor: string;
  externalContext: unknown;
};

export type ProviderDocsSignalIntakeResult = z.infer<
  typeof providerDocsSignalIntakeResultSchema
>;

export async function captureProviderDocsSignal(
  input: ProviderDocsSignalIntakeInput,
): Promise<ProviderDocsSignalIntakeResult> {
  const decision = planDocsImpactDecision(input.triage);
  const desiredStatus = docsSignalStatusForDecision(decision);
  const captured = await captureDocsSignal(input.signal, {
    status: desiredStatus,
    reason: decision.reason,
    actor: input.actor,
    metadata: {
      decision: decision.decision,
      recommendedNextAction: decision.recommendedNextAction,
      currentDocsVerification: decision.currentDocsVerification,
      shouldVerifyCurrentDocs: shouldVerifyCurrentDocs(decision),
      externalContext: input.externalContext,
    },
  });
  const setupStatus = await getSetupStatus();
  const verificationStatus = buildDocsSignalVerificationStatus(
    decision,
    setupStatus.docsMaintenanceReady,
    setupStatus.issues.map((issue) => issue.message),
  );

  return providerDocsSignalIntakeResultSchema.parse({
    created: captured.created,
    signal: captured.signal,
    decision,
    shouldVerifyCurrentDocs: shouldVerifyCurrentDocs(decision),
    verificationStatus,
  });
}

export function docsSignalStatusForDecision(
  decision: DocsImpactDecisionRecord,
): DocsSignalStatus {
  switch (decision.decision) {
    case "not-docs-relevant":
      return "closed-not-docs-relevant";
    case "needs-maintainer-answer":
      return "needs-maintainer-answer";
    case "needs-source-evidence":
      return "needs-source-evidence";
    case "verification-skipped":
      return "verification-skipped";
    case "already-covered":
      return "closed-already-covered";
    case "likely-stale":
    case "docs-patch-recommended":
    case "changelog-only":
      return "docs-verified";
    case "needs-docs-verification":
      return "captured";
  }
}

export function buildDocsSignalVerificationStatus(
  decision: DocsImpactDecisionRecord,
  setupReady: boolean,
  setupIssues: string[],
): DocsSignalVerificationStatus {
  const required = shouldVerifyCurrentDocs(decision);

  if (decision.currentDocsVerification.state === "completed") {
    return {
      required,
      setupReady,
      state: "completed",
      reason: decision.currentDocsVerification.reason,
    };
  }

  if (required && !setupReady) {
    return {
      required,
      setupReady,
      state: "blocked",
      reason: [
        "Current docs verification is required, but workspace setup is not ready.",
        ...setupIssues,
      ].join(" "),
    };
  }

  return {
    required,
    setupReady,
    state: decision.currentDocsVerification.state,
    reason: decision.currentDocsVerification.reason,
  };
}

export function buildDocsSignalReplyGuidance(input: {
  decision: DocsImpactDecisionRecord;
  verificationStatus: DocsSignalVerificationStatus;
  transportInstruction: string;
}): string[] {
  const guidance = [input.transportInstruction];

  if (input.decision.decision === "needs-source-evidence") {
    guidance.push(
      "Ask for source, release, or maintainer-confirmed evidence before making public docs claims.",
      "State that current docs were not verified because the required source evidence is missing.",
    );
  }

  if (input.decision.decision === "verification-skipped") {
    guidance.push("Include the explicit skipped-verification reason.");
  }

  if (input.verificationStatus.state === "blocked") {
    guidance.push(
      "Use setup mode to collect the working documentation repository before docs verification.",
      "State that setup blocked current-docs verification.",
    );
  } else if (input.verificationStatus.required) {
    guidance.push(
      "Verify current docs against the configured working documentation repository before deciding whether docs are stale.",
    );
  }

  guidance.push(
    "State explicitly that no patch was prepared and no pull request was published.",
    "Do not prepare a patch or publish without a later explicit approval-gated handoff.",
  );

  return guidance;
}
