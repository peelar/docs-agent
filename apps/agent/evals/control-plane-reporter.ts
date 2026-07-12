import { randomUUID } from "node:crypto";

import type { ValidationRun } from "@docs-agent/control-plane/agent";
import type {
  EveEvalResult,
  EveEvalRunSummary,
  EveEvalTarget,
} from "eve/evals";
import type { EvalReporter } from "eve/evals/reporters";

type ControlPlaneReporterOptions = {
  suite: string;
  runId?: string;
  revision?: string;
  deployment?: string;
  artifactReferences?: string[];
};

const controlPlaneModule = "@docs-agent/control-plane/agent";
let controlPlanePromise:
  | Promise<typeof import("@docs-agent/control-plane/agent")>
  | undefined;

export function ControlPlaneReporter(
  options: ControlPlaneReporterOptions,
): EvalReporter {
  const runId =
    options.runId ??
    (process.env.DOCS_AGENT_EVAL_RUN_ID?.trim() || `eval:${randomUUID()}`);
  const startedAt = new Date().toISOString();

  return {
    async onRunStart(_evaluations, nextTarget) {
      const { startValidationRun } = await controlPlane();
      await startValidationRun({
        id: runId,
        kind: "live-eval",
        suite: options.suite,
        target: renderTarget(nextTarget),
        revision: options.revision,
        deployment: options.deployment,
        startedAt,
        artifactReferences: options.artifactReferences ?? [],
      });
    },

    async onEvalComplete(result) {
      const { recordValidationCase, redactValidationExcerpt } =
        await controlPlane();
      await recordValidationCase({
        validationRunId: runId,
        caseId: result.id,
        name: result.id,
        outcome: mapVerdict(result.verdict),
        assertions: result.assertions.map((assertion, index) => ({
          name: summarizeAssertionName(assertion.name, index),
          passed: assertion.passed,
          severity: assertion.severity,
          score: assertion.score,
          threshold: assertion.threshold,
        })),
        failureSummary: failureSummary(result, redactValidationExcerpt),
        startedAt: result.startedAt,
        completedAt: result.completedAt,
      });
    },

    async onRunComplete(summary) {
      const { completeValidationRun } = await controlPlane();
      const identity = summary.results.find(
        (result) => result.result.runtimeIdentity !== undefined,
      )?.result.runtimeIdentity;
      await completeValidationRun({
        id: runId,
        outcome: summaryOutcome(summary),
        completedAt: summary.completedAt,
        model: identity?.modelId,
        revision: identity?.build?.gitSha ?? options.revision,
        deployment: identity?.build?.deployedAt ?? options.deployment,
      });
    },
  };

  function renderTarget(nextTarget: EveEvalTarget) {
    return `${nextTarget.kind}:${nextTarget.url}`;
  }

  function failureSummary(
    result: EveEvalResult,
    redact: (value: string) => string,
  ) {
    if (result.verdict === "passed") return undefined;
    if (result.verdict === "skipped") return "Eval intentionally skipped.";
    if (result.error) {
      return `Eval execution failed: ${redact(result.error)}`;
    }

    const failedNames = result.assertions
      .filter((assertion) => !assertion.passed)
      .map((assertion, index) =>
        redact(summarizeAssertionName(assertion.name, index)),
      )
      .slice(0, 10);
    const label = result.verdict === "scored" ? "Soft assertions" : "Assertions";
    return failedNames.length > 0
      ? `${label} did not pass: ${failedNames.join(", ")}.`
      : `${label} did not pass.`;
  }

  function summaryOutcome(summary: EveEvalRunSummary): ValidationRun["outcome"] {
    if (summary.failed > 0 || summary.errored > 0) return "failed";
    if (summary.scored > 0) return "flaky";
    if (summary.passed > 0) return "passed";
    if (summary.skipped > 0) return "skipped";
    return "missing";
  }

  function mapVerdict(result: EveEvalResult["verdict"]): ValidationRun["outcome"] {
    if (result === "scored") return "flaky";
    return result;
  }
}

function summarizeAssertionName(name: string, index: number) {
  const match = /^([A-Za-z][A-Za-z0-9_.:-]{0,99})(?:\(|$)/u.exec(name);
  return match?.[1] ?? `assertion-${index + 1}`;
}

function controlPlane() {
  controlPlanePromise ??= import(controlPlaneModule);
  return controlPlanePromise;
}
