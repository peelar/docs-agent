import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { migrateDocsAgentDatabase } from "../src/db/client.js";
import {
  cleanupExpiredValidationRuns,
  completeValidationRun,
  getValidationRun,
  recordValidationCase,
  startValidationRun,
} from "../src/validation-results.js";

const root = await mkdtemp(join(tmpdir(), "docs-agent-validation-results-"));
const originalUrl = process.env.DOCS_AGENT_DATABASE_URL;
const originalVercel = process.env.VERCEL;
const originalNodeEnv = process.env.NODE_ENV;
process.env.DOCS_AGENT_DATABASE_URL = `file:${join(root, "validation.sqlite")}`;
delete process.env.VERCEL;
delete process.env.NODE_ENV;

try {
  await migrateDocsAgentDatabase();
  const run = await startValidationRun({
    id: "deterministic:pnpm-check:2026-07-11",
    kind: "deterministic-validation",
    suite: "pnpm-check",
    target: "local workspace",
    revision: "abc123",
    startedAt: "2026-07-11T10:00:00.000Z",
    artifactReferences: ["artifact token=top-secret"],
  });
  assert.equal(run.outcome, "missing");
  assert.equal(run.expiresAt, "2026-08-10T10:00:00.000Z");
  assert.doesNotMatch(JSON.stringify(run), /top-secret/);

  await assert.rejects(
    startValidationRun({
      id: "invalid",
      kind: "deterministic-validation",
      suite: "pnpm-check",
      target: "local",
      startedAt: "2026-07-11T10:00:00.000Z",
      prompt: "must not persist",
    } as never),
  );

  const outcomes = ["missing", "skipped", "flaky", "failed", "passed"] as const;
  for (const [index, outcome] of outcomes.entries()) {
    await recordValidationCase({
      validationRunId: run.id,
      caseId: `case-${outcome}`,
      name: `Case ${outcome}`,
      outcome,
      assertions: [
        {
          name: `assertion-${outcome}`,
          passed: outcome === "passed",
          severity: "gate",
        },
      ],
      failureSummary:
        outcome === "failed" ? "Bearer private-token was rejected" : undefined,
      startedAt: `2026-07-11T10:00:0${index}.000Z`,
      completedAt: `2026-07-11T10:00:1${index}.000Z`,
    });
  }

  await recordValidationCase({
    validationRunId: run.id,
    caseId: "case-failed",
    name: "Case failed replay",
    outcome: "failed",
    assertions: [],
    failureSummary: "secret=second-private-value",
    startedAt: "2026-07-11T10:00:03.000Z",
    completedAt: "2026-07-11T10:00:13.000Z",
  });
  const completed = await completeValidationRun({
    id: run.id,
    outcome: "failed",
    completedAt: "2026-07-11T10:01:00.000Z",
  });
  assert.equal(completed.cases.length, outcomes.length);
  assert.deepEqual(
    completed.cases.map((item) => item.outcome).sort(),
    [...outcomes].sort(),
  );
  assert.equal(completed.cases.find((item) => item.caseId === "case-failed")?.name, "Case failed replay");
  assert.doesNotMatch(JSON.stringify(completed), /private-token|second-private-value/);

  const replay = await startValidationRun({
    id: run.id,
    kind: "deterministic-validation",
    suite: "pnpm-check",
    target: "local workspace",
    revision: "abc123",
    startedAt: "2026-07-11T10:00:00.000Z",
    artifactReferences: ["artifact token=top-secret"],
  });
  assert.equal(replay.suite, "pnpm-check");
  assert.equal(replay.outcome, "failed");
  await assert.rejects(
    startValidationRun({
      id: run.id,
      kind: "deterministic-validation",
      suite: "different-suite",
      target: "local workspace",
      startedAt: "2026-07-11T10:00:00.000Z",
    }),
    /identity conflict/,
  );

  await startValidationRun({
    id: "expired-one",
    kind: "deterministic-validation",
    suite: "pnpm-check",
    target: "local",
    startedAt: "2026-06-01T00:00:00.000Z",
  });
  await recordValidationCase({
    validationRunId: "expired-one",
    caseId: "child",
    name: "Child row",
    outcome: "passed",
    startedAt: "2026-06-01T00:00:00.000Z",
  });
  await startValidationRun({
    id: "expired-two",
    kind: "live-eval",
    suite: "smoke",
    target: "local",
    startedAt: "2026-06-02T00:00:00.000Z",
  });
  assert.equal(
    (await cleanupExpiredValidationRuns({ now: "2026-07-11T00:00:00.000Z", limit: 1 })).deleted,
    1,
  );
  await assert.rejects(getValidationRun({ id: "expired-one" }), /not found/);
  assert.equal(
    (await cleanupExpiredValidationRuns({ now: "2026-07-11T00:00:00.000Z", limit: 100 })).deleted,
    1,
  );
  await assert.rejects(
    recordValidationCase({
      validationRunId: "missing-run",
      caseId: "case",
      name: "Case",
      outcome: "passed",
      startedAt: "2026-07-11T00:00:00.000Z",
    }),
    /Validation run not found/,
  );
} finally {
  restore("DOCS_AGENT_DATABASE_URL", originalUrl);
  restore("VERCEL", originalVercel);
  restore("NODE_ENV", originalNodeEnv);
  await rm(root, { recursive: true, force: true });
}

console.log("Validation result checks passed.");

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
