import {
  proposedWatchPolicySchema,
  watchPolicyChangeClassificationSchema,
  type ProposedWatchPolicy,
  type WatchPolicyChange,
  type WatchPolicyChangeClassification,
} from "./watch-contract.ts";

export function classifyWatchPolicyChange(
  previousInput: ProposedWatchPolicy,
  nextInput: ProposedWatchPolicy,
): WatchPolicyChangeClassification {
  const previous = proposedWatchPolicySchema.parse(previousInput);
  const next = proposedWatchPolicySchema.parse(nextInput);
  const changes: WatchPolicyChange[] = [];

  changedText(changes, "goal", "policy.goal", previous.goal, next.goal);
  changedSource(changes, previous, next);
  changedObject(
    changes,
    "trigger",
    "policy.trigger",
    previous.trigger,
    next.trigger,
  );
  changedObject(
    changes,
    "evaluation",
    "policy.evaluation",
    previous.evaluation,
    next.evaluation,
  );
  changedDelivery(changes, previous, next);
  changedSet(
    changes,
    "context",
    "policy.context.eventTypes",
    previous.context.eventTypes,
    next.context.eventTypes,
  );
  changedBoolean(
    changes,
    "context",
    "policy.context.includeThread",
    previous.context.includeThread,
    next.context.includeThread,
  );
  changedNumber(
    changes,
    "context",
    "policy.context.historyMessageLimit",
    previous.context.historyMessageLimit,
    next.context.historyMessageLimit,
  );
  changedNumber(
    changes,
    "context",
    "policy.context.maxCharacters",
    previous.context.maxCharacters,
    next.context.maxCharacters,
  );
  changedSet(
    changes,
    "capability",
    "policy.capabilityGrants",
    previous.capabilityGrants,
    next.capabilityGrants,
  );
  changedNumber(
    changes,
    "retention",
    "policy.retention.rawObservationSeconds",
    previous.retention.rawObservationSeconds,
    next.retention.rawObservationSeconds,
  );
  changedNumber(
    changes,
    "retention",
    "policy.retention.auditDays",
    previous.retention.auditDays,
    next.retention.auditDays,
  );
  changedNumber(
    changes,
    "budget",
    "policy.budgets.observationsPerHour",
    previous.budgets.observationsPerHour,
    next.budgets.observationsPerHour,
  );
  changedNumber(
    changes,
    "budget",
    "policy.budgets.processingRunsPerHour",
    previous.budgets.processingRunsPerHour,
    next.budgets.processingRunsPerHour,
  );
  changedNumber(
    changes,
    "budget",
    "policy.budgets.deliveriesPerDay",
    previous.budgets.deliveriesPerDay,
    next.budgets.deliveriesPerDay,
  );
  changedNumber(
    changes,
    "budget",
    "policy.budgets.inputCharactersPerHour",
    previous.budgets.inputCharactersPerHour,
    next.budgets.inputCharactersPerHour,
  );
  changedExpiry(changes, previous.expiresAt, next.expiresAt);

  if (changes.length === 0) {
    throw new Error("The edited watch policy does not change the current proposal.");
  }

  return watchPolicyChangeClassificationSchema.parse({
    approvalRequired: true,
    approvalConsequence: "fresh-approval-required",
    hasAuthorityExpansion: changes.some(({ direction }) => direction === "expanded"),
    hasAuthorityNarrowing: changes.some(({ direction }) => direction === "narrowed"),
    changes,
  });
}

function changedText(
  changes: WatchPolicyChange[],
  kind: WatchPolicyChange["kind"],
  path: string,
  previous: string,
  next: string,
) {
  if (previous === next) return;
  changes.push({
    kind,
    path,
    direction: "changed",
    summary: `${path} changed.`,
  });
}

function changedSource(
  changes: WatchPolicyChange[],
  previous: ProposedWatchPolicy,
  next: ProposedWatchPolicy,
) {
  if (stable(previous.source) === stable(next.source)) return;
  changes.push({
    kind: "source",
    path: "policy.source",
    direction: "expanded",
    summary: "The observed provider resource changed and requires new source authority.",
  });
}

function changedObject(
  changes: WatchPolicyChange[],
  kind: WatchPolicyChange["kind"],
  path: string,
  previous: unknown,
  next: unknown,
) {
  if (stable(previous) === stable(next)) return;
  changes.push({ kind, path, direction: "changed", summary: `${path} changed.` });
}

function changedDelivery(
  changes: WatchPolicyChange[],
  previous: ProposedWatchPolicy,
  next: ProposedWatchPolicy,
) {
  if (stable(previous.delivery) === stable(next.delivery)) return;
  const rank = { silent: 0, digest: 1, immediate: 2 } as const;
  const direction = rank[next.delivery.mode] > rank[previous.delivery.mode]
    ? "expanded"
    : rank[next.delivery.mode] < rank[previous.delivery.mode]
    ? "narrowed"
    : "changed";
  changes.push({
    kind: "delivery",
    path: "policy.delivery",
    direction,
    summary: `Delivery changed from ${previous.delivery.mode} to ${next.delivery.mode}.`,
  });
}

function changedSet(
  changes: WatchPolicyChange[],
  kind: WatchPolicyChange["kind"],
  path: string,
  previous: readonly string[],
  next: readonly string[],
) {
  const before = new Set(previous);
  const after = new Set(next);
  const added = [...after].filter((value) => !before.has(value)).sort();
  const removed = [...before].filter((value) => !after.has(value)).sort();
  if (added.length > 0) {
    changes.push({
      kind,
      path,
      direction: "expanded",
      summary: `Added: ${added.join(", ")}.`,
    });
  }
  if (removed.length > 0) {
    changes.push({
      kind,
      path,
      direction: "narrowed",
      summary: `Removed: ${removed.join(", ")}.`,
    });
  }
}

function changedBoolean(
  changes: WatchPolicyChange[],
  kind: WatchPolicyChange["kind"],
  path: string,
  previous: boolean,
  next: boolean,
) {
  if (previous === next) return;
  changes.push({
    kind,
    path,
    direction: next ? "expanded" : "narrowed",
    summary: `${path} changed from ${previous} to ${next}.`,
  });
}

function changedNumber(
  changes: WatchPolicyChange[],
  kind: WatchPolicyChange["kind"],
  path: string,
  previous: number,
  next: number,
) {
  if (previous === next) return;
  changes.push({
    kind,
    path,
    direction: next > previous ? "expanded" : "narrowed",
    summary: `${path} changed from ${previous} to ${next}.`,
  });
}

function changedExpiry(
  changes: WatchPolicyChange[],
  previous: string | null,
  next: string | null,
) {
  if (previous === next) return;
  const previousTime = previous === null ? Number.POSITIVE_INFINITY : Date.parse(previous);
  const nextTime = next === null ? Number.POSITIVE_INFINITY : Date.parse(next);
  changes.push({
    kind: "expiry",
    path: "policy.expiresAt",
    direction: nextTime > previousTime ? "expanded" : "narrowed",
    summary: "The watch expiry changed.",
  });
}

function stable(value: unknown): string {
  return JSON.stringify(value);
}
