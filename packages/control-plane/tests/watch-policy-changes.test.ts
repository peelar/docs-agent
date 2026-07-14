import assert from "node:assert/strict";

import { test } from "vitest";

import { classifyWatchPolicyChange } from "../src/watch-policy-changes.ts";
import type { ProposedWatchPolicy } from "../src/watch-contract.ts";

test("classifies every authority expansion that requires fresh approval", () => {
  const base = validPolicy();
  const cases: Array<{
    path: string;
    policy: ProposedWatchPolicy;
  }> = [
    {
      path: "policy.source",
      policy: {
        ...base,
        source: { ...base.source, resource: { ...base.source.resource, id: "C-OTHER" } },
      },
    },
    {
      path: "policy.capabilityGrants",
      policy: { ...base, capabilityGrants: [...base.capabilityGrants, "draft.edit"] },
    },
    {
      path: "policy.context.eventTypes",
      policy: {
        ...base,
        context: { ...base.context, eventTypes: ["message", "reaction_added"] },
      },
    },
    {
      path: "policy.context.includeThread",
      policy: {
        ...base,
        context: { ...base.context, includeThread: true, historyMessageLimit: 10 },
      },
    },
    {
      path: "policy.retention.rawObservationSeconds",
      policy: {
        ...base,
        retention: { ...base.retention, rawObservationSeconds: 300 },
      },
    },
    {
      path: "policy.budgets.processingRunsPerHour",
      policy: {
        ...base,
        budgets: { ...base.budgets, processingRunsPerHour: 24 },
      },
    },
    {
      path: "policy.delivery",
      policy: {
        ...base,
        delivery: { mode: "immediate" },
        capabilityGrants: [...base.capabilityGrants, "provider.deliver"],
        budgets: { ...base.budgets, deliveriesPerDay: 10 },
      },
    },
    {
      path: "policy.expiresAt",
      policy: { ...base, expiresAt: "2026-09-13T00:00:00.000Z" },
    },
  ];

  for (const example of cases) {
    const classification = classifyWatchPolicyChange(base, example.policy);
    assert.equal(classification.approvalRequired, true);
    assert.equal(classification.approvalConsequence, "fresh-approval-required");
    assert.equal(classification.hasAuthorityExpansion, true);
    assert.equal(
      classification.changes.some(
        ({ path, direction }) => path === example.path && direction === "expanded",
      ),
      true,
      `expected ${example.path} to be classified as expanded`,
    );
  }
});

test("classifies goal, policy, and authority-narrowing changes deterministically", () => {
  const previous: ProposedWatchPolicy = {
    ...validPolicy(),
    goal: "Review release readiness and report missing documentation.",
    delivery: { mode: "immediate" },
    context: {
      eventTypes: ["message", "reaction_added"],
      includeThread: true,
      historyMessageLimit: 20,
      maxCharacters: 24_000,
    },
    capabilityGrants: ["knowledge.read", "repository.read", "provider.deliver"],
    retention: { rawObservationSeconds: 600, auditDays: 60 },
    budgets: {
      observationsPerHour: 120,
      processingRunsPerHour: 24,
      deliveriesPerDay: 20,
      inputCharactersPerHour: 240_000,
    },
    expiresAt: "2026-09-13T00:00:00.000Z",
  };
  const next: ProposedWatchPolicy = {
    ...validPolicy(),
    goal: "Report only high-confidence release documentation gaps.",
  };

  const first = classifyWatchPolicyChange(previous, next);
  const second = classifyWatchPolicyChange(previous, next);
  assert.deepEqual(first, second);
  assert.equal(first.hasAuthorityExpansion, false);
  assert.equal(first.hasAuthorityNarrowing, true);
  assert.equal(
    first.changes.some(({ kind, direction }) => kind === "goal" && direction === "changed"),
    true,
  );
  for (const kind of ["context", "capability", "retention", "budget", "delivery", "expiry"] as const) {
    assert.equal(
      first.changes.some((change) => change.kind === kind && change.direction === "narrowed"),
      true,
      `expected a narrowing ${kind} change`,
    );
  }
  assert.throws(
    () => classifyWatchPolicyChange(next, structuredClone(next)),
    /does not change/,
  );
});

function validPolicy(): ProposedWatchPolicy {
  return {
    source: {
      provider: "slack",
      providerWorkspaceId: "T-DOCS",
      resource: { type: "channel", id: "C-DOCS-FEEDBACK" },
    },
    goal: "Find evidence-backed documentation gaps discussed in this channel.",
    trigger: { type: "on_event" },
    evaluation: { mode: "per_event" },
    delivery: { mode: "silent" },
    context: {
      eventTypes: ["message"],
      includeThread: false,
      historyMessageLimit: 0,
      maxCharacters: 12_000,
    },
    capabilityGrants: ["knowledge.read", "repository.read"],
    retention: { rawObservationSeconds: 0, auditDays: 30 },
    budgets: {
      observationsPerHour: 60,
      processingRunsPerHour: 12,
      deliveriesPerDay: 0,
      inputCharactersPerHour: 120_000,
    },
    expiresAt: "2026-08-13T00:00:00.000Z",
  };
}
