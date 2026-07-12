import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { z } from "zod";

import { withDocsAgentDatabase } from "./db/client.js";
import { validationCases, validationRuns } from "./db/schema.js";
import { DEFAULT_WORKSPACE_ID } from "./setup-state.js";

const RETENTION_DAYS = 30;
const REDACTION_VERSION = 1;
const text = z.string().trim().min(1);
const iso = z.string().datetime({ offset: true });

export const validationKindSchema = z.enum([
  "live-eval",
  "deterministic-validation",
]);
export const validationOutcomeSchema = z.enum([
  "missing",
  "skipped",
  "flaky",
  "failed",
  "passed",
]);
export const validationAssertionSummarySchema = z
  .object({
    name: text.max(300),
    passed: z.boolean(),
    severity: z.enum(["gate", "soft"]).optional(),
    score: z.number().finite().optional(),
    threshold: z.number().finite().optional(),
    message: z.string().max(500).optional(),
  })
  .strict();
export const startValidationRunInputSchema = z
  .object({
    id: text.max(500),
    kind: validationKindSchema,
    suite: text.max(300),
    target: text.max(1_000),
    model: text.max(300).optional(),
    revision: text.max(300).optional(),
    deployment: text.max(1_000).optional(),
    startedAt: iso,
    artifactReferences: z.array(text.max(1_000)).max(20).default([]),
  })
  .strict();
export const recordValidationCaseInputSchema = z
  .object({
    validationRunId: text,
    caseId: text.max(500),
    name: text.max(500),
    outcome: validationOutcomeSchema,
    assertions: z.array(validationAssertionSummarySchema).max(100).default([]),
    failureSummary: z.string().max(5_000).optional(),
    artifactReference: z.string().max(1_000).optional(),
    startedAt: iso,
    completedAt: iso.optional(),
  })
  .strict();
export const completeValidationRunInputSchema = z
  .object({
    id: text,
    outcome: validationOutcomeSchema,
    completedAt: iso,
    model: text.max(300).optional(),
    revision: text.max(300).optional(),
    deployment: text.max(1_000).optional(),
  })
  .strict();

export const validationCaseSchema = z.object({
  id: z.string(),
  caseId: z.string(),
  name: z.string(),
  outcome: validationOutcomeSchema,
  assertions: z.array(validationAssertionSummarySchema),
  failureSummary: z.string().nullable(),
  artifactReference: z.string().nullable(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  updatedAt: z.string(),
});
export const validationRunSchema = z.object({
  id: z.string(),
  kind: validationKindSchema,
  suite: z.string(),
  target: z.string(),
  model: z.string().nullable(),
  revision: z.string().nullable(),
  deployment: z.string().nullable(),
  outcome: validationOutcomeSchema,
  redactionVersion: z.literal(REDACTION_VERSION),
  artifactReferences: z.array(z.string()),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  expiresAt: z.string(),
  updatedAt: z.string(),
  cases: z.array(validationCaseSchema),
});

export type ValidationRun = z.infer<typeof validationRunSchema>;

export async function startValidationRun(
  input: z.input<typeof startValidationRunInputSchema>,
) {
  const parsed = startValidationRunInputSchema.parse(input);
  const artifactReferences = parsed.artifactReferences.map(redactExcerpt);

  await withDocsAgentDatabase((db) =>
    db
      .insert(validationRuns)
      .values({
        id: parsed.id,
        workspaceId: DEFAULT_WORKSPACE_ID,
        kind: parsed.kind,
        suite: parsed.suite,
        target: redactExcerpt(parsed.target),
        model: parsed.model ?? null,
        revision: parsed.revision ?? null,
        deployment: parsed.deployment ? redactExcerpt(parsed.deployment) : null,
        outcome: "missing",
        redactionVersion: REDACTION_VERSION,
        artifactReferences,
        startedAt: parsed.startedAt,
        completedAt: null,
        durationMs: null,
        expiresAt: addDays(parsed.startedAt, RETENTION_DAYS),
        updatedAt: parsed.startedAt,
      })
      .onConflictDoNothing(),
  );

  const run = await getValidationRun({ id: parsed.id });
  const target = redactExcerpt(parsed.target);
  if (
    run.kind !== parsed.kind ||
    run.suite !== parsed.suite ||
    run.target !== target ||
    run.startedAt !== parsed.startedAt
  ) {
    throw new Error(
      `Validation run identity conflict for ${parsed.id}; use a new stable run id.`,
    );
  }
  return run;
}

export async function recordValidationCase(
  input: z.input<typeof recordValidationCaseInputSchema>,
) {
  const parsed = recordValidationCaseInputSchema.parse(input);
  await requireRun(parsed.validationRunId);
  const id = `${parsed.validationRunId}:${parsed.caseId}`;
  const completedAt = parsed.completedAt ?? null;
  const values = {
    name: redactExcerpt(parsed.name),
    outcome: parsed.outcome,
    assertionSummaries: parsed.assertions.map((item) => ({
      ...item,
      name: redactExcerpt(item.name),
      message: item.message ? redactExcerpt(item.message) : undefined,
    })),
    failureSummary: parsed.failureSummary
      ? redactExcerpt(parsed.failureSummary)
      : null,
    artifactReference: parsed.artifactReference
      ? redactExcerpt(parsed.artifactReference)
      : null,
    startedAt: parsed.startedAt,
    completedAt,
    durationMs: completedAt ? duration(parsed.startedAt, completedAt) : null,
    updatedAt: completedAt ?? parsed.startedAt,
  };

  await withDocsAgentDatabase((db) =>
    db
      .insert(validationCases)
      .values({
        id,
        validationRunId: parsed.validationRunId,
        workspaceId: DEFAULT_WORKSPACE_ID,
        caseId: parsed.caseId,
        ...values,
      })
      .onConflictDoUpdate({
        target: [validationCases.validationRunId, validationCases.caseId],
        set: values,
      }),
  );

  return (await getValidationRun({ id: parsed.validationRunId })).cases.find(
    (item) => item.caseId === parsed.caseId,
  )!;
}

export async function completeValidationRun(
  input: z.input<typeof completeValidationRunInputSchema>,
) {
  const parsed = completeValidationRunInputSchema.parse(input);
  const run = await requireRun(parsed.id);

  await withDocsAgentDatabase((db) =>
    db
      .update(validationRuns)
      .set({
        outcome: parsed.outcome,
        completedAt: parsed.completedAt,
        durationMs: duration(run.startedAt, parsed.completedAt),
        model: parsed.model ?? run.model,
        revision: parsed.revision ?? run.revision,
        deployment: parsed.deployment
          ? redactExcerpt(parsed.deployment)
          : run.deployment,
        updatedAt: parsed.completedAt,
      })
      .where(
        and(
          eq(validationRuns.workspaceId, DEFAULT_WORKSPACE_ID),
          eq(validationRuns.id, parsed.id),
        ),
      ),
  );

  return getValidationRun({ id: parsed.id });
}

export async function getValidationRun(input: { id: string }) {
  const id = text.parse(input.id);

  return withDocsAgentDatabase(async (db) => {
    const runs = await db
      .select()
      .from(validationRuns)
      .where(
        and(
          eq(validationRuns.workspaceId, DEFAULT_WORKSPACE_ID),
          eq(validationRuns.id, id),
        ),
      )
      .limit(1);
    if (!runs[0]) throw new Error(`Validation run not found: ${id}`);

    const cases = await db
      .select()
      .from(validationCases)
      .where(eq(validationCases.validationRunId, id))
      .orderBy(asc(validationCases.startedAt), asc(validationCases.caseId));
    const run = runs[0];

    return validationRunSchema.parse({
      id: run.id,
      kind: run.kind,
      suite: run.suite,
      target: run.target,
      model: run.model,
      revision: run.revision,
      deployment: run.deployment,
      outcome: run.outcome,
      redactionVersion: run.redactionVersion,
      artifactReferences: run.artifactReferences,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      durationMs: run.durationMs,
      expiresAt: run.expiresAt,
      updatedAt: run.updatedAt,
      cases: cases.map((item) => ({
        id: item.id,
        caseId: item.caseId,
        name: item.name,
        outcome: item.outcome,
        assertions: item.assertionSummaries,
        failureSummary: item.failureSummary,
        artifactReference: item.artifactReference,
        startedAt: item.startedAt,
        completedAt: item.completedAt,
        durationMs: item.durationMs,
        updatedAt: item.updatedAt,
      })),
    });
  });
}

export async function cleanupExpiredValidationRuns(
  input: { now?: string; limit?: number } = {},
) {
  const now = iso.parse(input.now ?? new Date().toISOString());
  const limit = z.number().int().min(1).max(500).parse(input.limit ?? 100);

  return withDocsAgentDatabase((db) =>
    db.transaction(async (tx) => {
      const rows = await tx
        .select({ id: validationRuns.id })
        .from(validationRuns)
        .where(
          and(
            eq(validationRuns.workspaceId, DEFAULT_WORKSPACE_ID),
            lte(validationRuns.expiresAt, now),
          ),
        )
        .orderBy(asc(validationRuns.expiresAt))
        .limit(limit);
      if (rows.length === 0) return { deleted: 0 };

      await tx
        .delete(validationRuns)
        .where(inArray(validationRuns.id, rows.map((row) => row.id)));
      return { deleted: rows.length };
    }),
  );
}

export function redactValidationExcerpt(value: string) {
  return redactExcerpt(value);
}

async function requireRun(id: string) {
  return withDocsAgentDatabase(async (db) => {
    const rows = await db
      .select()
      .from(validationRuns)
      .where(
        and(
          eq(validationRuns.workspaceId, DEFAULT_WORKSPACE_ID),
          eq(validationRuns.id, id),
        ),
      )
      .limit(1);
    if (!rows[0]) throw new Error(`Validation run not found: ${id}`);
    return rows[0];
  });
}

function redactExcerpt(value: string) {
  return value
    .slice(0, 2_000)
    .replace(
      /(?:github_pat_|gh[opusr]_|xox[baprs]-|lin_api_)[A-Za-z0-9_-]+/gi,
      "[redacted]",
    )
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
    .replace(
      /((?:token|secret|password|api[-_]?key)\s*[=:]\s*)\S+/gi,
      "$1[redacted]",
    );
}

function addDays(value: string, days: number) {
  return new Date(new Date(value).getTime() + days * 86_400_000).toISOString();
}

function duration(start: string, end: string) {
  return Math.max(0, new Date(end).getTime() - new Date(start).getTime());
}
