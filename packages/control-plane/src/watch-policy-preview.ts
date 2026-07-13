import { z } from "zod";

import {
  proposedWatchPolicySchema,
  WATCH_POLICY_CONTRACT_VERSION,
  watchCapabilityFamilySchema,
  watchPolicyPreviewInputSchema,
  watchPolicyPreviewSchema,
  type ProposedWatchPolicy,
  type WatchCapabilityFamily,
  type WatchPolicyPreview,
} from "./watch-contract.ts";

export const WATCH_POLICY_DEFAULT_EXPIRY_DAYS = 30;

export const DEFAULT_WATCH_POLICY = Object.freeze({
  trigger: { type: "on_event" } as const,
  evaluation: { mode: "per_event" } as const,
  delivery: { mode: "silent" } as const,
  context: {
    eventTypes: ["message"],
    includeThread: false,
    historyMessageLimit: 0,
    maxCharacters: 12_000,
  },
  capabilityGrants: [] as WatchCapabilityFamily[],
  retention: {
    rawObservationSeconds: 0,
    auditDays: 30,
  },
  budgets: {
    observationsPerHour: 60,
    processingRunsPerHour: 12,
    deliveriesPerDay: 0,
    inputCharactersPerHour: 120_000,
  },
});

export type WatchPolicyPreviewContext = {
  availableCapabilities: readonly WatchCapabilityFamily[];
  now?: Date;
};

export type WatchPolicyValidationIssue = {
  code:
    | "invalid-contract"
    | "unsupported-contract-version"
    | "invalid-lifecycle"
    | "unsupported-provider-resource"
    | "unknown-capability"
    | "publication-forbidden"
    | "capability-unavailable"
    | "duplicate-capability"
    | "incompatible-policy"
    | "expired-policy";
  path: string;
  message: string;
};

export class WatchPolicyValidationError extends Error {
  readonly issues: readonly WatchPolicyValidationIssue[];

  constructor(issues: readonly WatchPolicyValidationIssue[]) {
    super("The watch policy is invalid. Review the structured validation issues.");
    this.name = "WatchPolicyValidationError";
    this.issues = issues;
  }
}

export function previewWatchPolicy(
  input: unknown,
  context: WatchPolicyPreviewContext,
): WatchPolicyPreview {
  const parsedInput = parseInput(input);
  const parsedContext = parseContext(context);
  const defaultsApplied: string[] = [];
  const issues: WatchPolicyValidationIssue[] = [];
  const now = parsedContext.now ?? new Date();

  const contractVersion = parsedInput.contractVersion ?? applyDefault(
    defaultsApplied,
    "contractVersion",
    WATCH_POLICY_CONTRACT_VERSION,
  );
  if (contractVersion !== WATCH_POLICY_CONTRACT_VERSION) {
    issues.push({
      code: "unsupported-contract-version",
      path: "contractVersion",
      message: `Only watch contract version ${WATCH_POLICY_CONTRACT_VERSION} is supported.`,
    });
  }

  const lifecycleState = parsedInput.lifecycleState ?? applyDefault(
    defaultsApplied,
    "lifecycleState",
    "proposed",
  );
  if (lifecycleState !== "proposed") {
    issues.push({
      code: "invalid-lifecycle",
      path: "lifecycleState",
      message: "Policy preview is available only for a proposed watch.",
    });
  }

  const draft = parsedInput.policy;
  if (draft.source.provider !== "slack" || draft.source.resource.type !== "channel") {
    issues.push({
      code: "unsupported-provider-resource",
      path: "policy.source",
      message: "The first watch contract supports Slack channel resources only.",
    });
  }

  const trigger = draft.trigger ?? applyDefault(
    defaultsApplied,
    "policy.trigger",
    DEFAULT_WATCH_POLICY.trigger,
  );
  const evaluation = draft.evaluation ?? applyDefault(
    defaultsApplied,
    "policy.evaluation",
    DEFAULT_WATCH_POLICY.evaluation,
  );
  const delivery = draft.delivery ?? applyDefault(
    defaultsApplied,
    "policy.delivery",
    DEFAULT_WATCH_POLICY.delivery,
  );
  const contextPolicy = mergeDefaults(
    draft.context,
    DEFAULT_WATCH_POLICY.context,
    "policy.context",
    defaultsApplied,
  );
  const capabilityGrants = draft.capabilityGrants ?? applyDefault(
    defaultsApplied,
    "policy.capabilityGrants",
    DEFAULT_WATCH_POLICY.capabilityGrants,
  );
  const retention = mergeDefaults(
    draft.retention,
    DEFAULT_WATCH_POLICY.retention,
    "policy.retention",
    defaultsApplied,
  );
  const budgets = mergeDefaults(
    draft.budgets,
    DEFAULT_WATCH_POLICY.budgets,
    "policy.budgets",
    defaultsApplied,
  );
  const expiresAt = draft.expiresAt ?? applyDefault(
    defaultsApplied,
    "policy.expiresAt",
    new Date(
      now.getTime() + WATCH_POLICY_DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1_000,
    ).toISOString(),
  );

  const grantable = new Set<string>(watchCapabilityFamilySchema.options);
  const available = new Set<string>(parsedContext.availableCapabilities);
  const seen = new Set<string>();
  for (const [index, capability] of capabilityGrants.entries()) {
    const path = `policy.capabilityGrants.${index}`;
    if (capability === "publication.publish") {
      issues.push({
        code: "publication-forbidden",
        path,
        message: "Publication authority cannot be granted by a watch.",
      });
    } else if (!grantable.has(capability)) {
      issues.push({
        code: "unknown-capability",
        path,
        message: "The requested capability is unknown or retired.",
      });
    } else if (!available.has(capability)) {
      issues.push({
        code: "capability-unavailable",
        path,
        message: `The ${capability} capability is unavailable in this workspace.`,
      });
    }
    if (seen.has(capability)) {
      issues.push({
        code: "duplicate-capability",
        path,
        message: "A capability can be granted only once.",
      });
    }
    seen.add(capability);
  }

  const grantsDelivery = capabilityGrants.includes("provider.deliver");
  if (delivery.mode === "silent" && grantsDelivery) {
    incompatible(
      issues,
      "policy.delivery",
      "Silent delivery cannot grant provider delivery authority.",
    );
  }
  if (delivery.mode !== "silent" && !grantsDelivery) {
    incompatible(
      issues,
      "policy.capabilityGrants",
      "Immediate or digest delivery requires provider delivery authority.",
    );
  }
  if (delivery.mode === "silent" && budgets.deliveriesPerDay !== 0) {
    incompatible(
      issues,
      "policy.budgets.deliveriesPerDay",
      "Silent delivery requires a zero delivery budget.",
    );
  }
  if (delivery.mode !== "silent" && budgets.deliveriesPerDay === 0) {
    incompatible(
      issues,
      "policy.budgets.deliveriesPerDay",
      "A delivering watch requires a positive delivery budget.",
    );
  }
  if (trigger.type === "on_schedule" && evaluation.mode !== "windowed") {
    incompatible(
      issues,
      "policy.evaluation",
      "A scheduled trigger requires windowed evaluation.",
    );
  }
  if (
    evaluation.mode === "windowed" &&
    retention.rawObservationSeconds < evaluation.windowSeconds
  ) {
    incompatible(
      issues,
      "policy.retention.rawObservationSeconds",
      "Raw observation retention must cover the complete evaluation window.",
    );
  }
  if (!contextPolicy.includeThread && contextPolicy.historyMessageLimit !== 0) {
    incompatible(
      issues,
      "policy.context.historyMessageLimit",
      "Thread history must be zero when thread context is disabled.",
    );
  }
  if (new Date(expiresAt).getTime() <= now.getTime()) {
    issues.push({
      code: "expired-policy",
      path: "policy.expiresAt",
      message: "A watch must expire in the future.",
    });
  }

  if (issues.length > 0) throw new WatchPolicyValidationError(issues);

  const effectivePolicy = parseEffectivePolicy({
    source: draft.source,
    goal: draft.goal,
    trigger,
    evaluation,
    delivery,
    context: contextPolicy,
    capabilityGrants,
    retention,
    budgets,
    expiresAt,
  });

  return watchPolicyPreviewSchema.parse({
    contractVersion,
    lifecycleState,
    effectivePolicy,
    defaultsApplied,
    operatorConsequences: buildConsequences(effectivePolicy),
  });
}

function parseInput(input: unknown) {
  const result = watchPolicyPreviewInputSchema.safeParse(input);
  if (!result.success) throw zodValidationError(result.error);
  return result.data;
}

function parseContext(context: WatchPolicyPreviewContext) {
  const result = z.object({
    availableCapabilities: z.array(watchCapabilityFamilySchema),
    now: z.date().optional(),
  }).strict().safeParse(context);
  if (!result.success) throw zodValidationError(result.error);
  return result.data;
}

function parseEffectivePolicy(input: unknown): ProposedWatchPolicy {
  const result = proposedWatchPolicySchema.safeParse(input);
  if (!result.success) throw zodValidationError(result.error);
  return result.data;
}

function zodValidationError(error: z.ZodError): WatchPolicyValidationError {
  const issues = error.issues.map((issue) => ({
    code: "invalid-contract" as const,
    path: issue.path.join("."),
    message: issue.path.length === 0
      ? "The watch contract is malformed."
      : `The ${issue.path.join(".")} field is invalid.`,
  }));
  return new WatchPolicyValidationError(issues);
}

function applyDefault<T>(defaultsApplied: string[], path: string, value: T): T {
  defaultsApplied.push(path);
  return value;
}

function mergeDefaults<T extends Record<string, unknown>>(
  candidate: Partial<T> | undefined,
  defaults: T,
  path: string,
  defaultsApplied: string[],
): T {
  const result = { ...defaults, ...candidate };
  for (const key of Object.keys(defaults)) {
    if (candidate?.[key] === undefined) defaultsApplied.push(`${path}.${key}`);
  }
  return result;
}

function incompatible(
  issues: WatchPolicyValidationIssue[],
  path: string,
  message: string,
): void {
  issues.push({ code: "incompatible-policy", path, message });
}

function buildConsequences(policy: ProposedWatchPolicy) {
  const evaluation = policy.evaluation.mode === "per_event"
    ? "Each admitted event is evaluated independently."
    : `Admitted events may accumulate for up to ${policy.evaluation.windowSeconds} seconds and ${policy.evaluation.maxObservations} observations.`;
  const delivery = policy.delivery.mode === "silent"
    ? "The watch cannot send a provider message."
    : policy.delivery.mode === "immediate"
      ? "Allowed results may be delivered immediately within the delivery budget."
      : "Allowed results may be delivered only on the configured digest schedule.";
  const authority = policy.capabilityGrants.length === 0
    ? "The watch grants no executable Paige capability; ignore and abstain remain available outcomes."
    : `The watch grants only: ${policy.capabilityGrants.join(", ")}. Publication is never included.`;

  return [
    {
      kind: "source" as const,
      summary: "Only events from the configured Slack channel are eligible for admission.",
    },
    { kind: "evaluation" as const, summary: evaluation },
    { kind: "delivery" as const, summary: delivery },
    {
      kind: "context" as const,
      summary: `Context is capped at ${policy.context.maxCharacters} characters and ${policy.context.historyMessageLimit} history messages.`,
    },
    { kind: "authority" as const, summary: authority },
    {
      kind: "retention" as const,
      summary: `Raw observations may exist for at most ${policy.retention.rawObservationSeconds} seconds; redacted audit metadata expires after ${policy.retention.auditDays} days.`,
    },
    {
      kind: "expiry" as const,
      summary: `The effective policy expires at ${policy.expiresAt}.`,
    },
  ];
}

