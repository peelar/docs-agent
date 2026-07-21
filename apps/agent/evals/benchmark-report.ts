export interface BenchmarkSuiteResult {
  passed: number;
  total: number;
  gatePassed: number;
  gateTotal: number;
  costUsd: number;
  durationSeconds: number;
}

export interface BenchmarkRunResult {
  behavior: BenchmarkSuiteResult;
  safety: BenchmarkSuiteResult;
}

export interface BenchmarkModelResult {
  label: string;
  modelId: string;
  runs: readonly BenchmarkRunResult[];
}

interface BenchmarkModelSummary {
  behavior: BenchmarkSuiteResult;
  safety: BenchmarkSuiteResult;
  cleanRuns: number;
  averageCostUsd: number;
  averageDurationSeconds: number;
  outcome: string;
}

export const benchmarkSectionStart = "<!-- benchmark-results:start -->";
export const benchmarkSectionEnd = "<!-- benchmark-results:end -->";

export function renderBenchmarkSection(
  generatedAt: Date,
  models: readonly BenchmarkModelResult[],
): string {
  if (models.length === 0) throw new Error("Benchmark has no model results.");

  const runCount = models[0]?.runs.length ?? 0;
  if (runCount === 0 || models.some((model) => model.runs.length !== runCount)) {
    throw new Error("Every benchmarked model must have the same number of runs.");
  }

  const rows = models.map((model) => {
    const summary = summarizeBenchmarkModel(model);
    return `| ${model.label} | ${formatSuite(summary.behavior)} | ${formatSuite(summary.safety)} | ${summary.cleanRuns}/${runCount} | ${formatCost(summary.averageCostUsd)} | ${formatDuration(summary.averageDurationSeconds)} | ${summary.outcome} |`;
  });

  return [
    benchmarkSectionStart,
    "## Current model qualification",
    "",
    `_Updated ${formatDate(generatedAt)} from ${runCount} repeated runs per model._`,
    "",
    "| Model | Behavior | Safety | Clean full runs | Average model cost | Average duration | Outcome |",
    "| --- | ---: | ---: | ---: | ---: | ---: | --- |",
    ...rows,
    "",
    "A full run contains the behavior and safety suites. Safety must pass on every run before a model can be qualified. Cost is the amount reported by the model gateway and may change as provider pricing changes.",
    benchmarkSectionEnd,
  ].join("\n");
}

export function replaceBenchmarkSection(
  document: string,
  section: string,
): string {
  const start = document.indexOf(benchmarkSectionStart);
  const end = document.indexOf(benchmarkSectionEnd);
  if (start === -1 || end === -1 || end < start) {
    throw new Error("EVALS.md is missing its benchmark result markers.");
  }

  const afterEnd = end + benchmarkSectionEnd.length;
  return `${document.slice(0, start)}${section}${document.slice(afterEnd)}`;
}

function summarizeBenchmarkModel(
  model: BenchmarkModelResult,
): BenchmarkModelSummary {
  const behavior = sumSuites(model.runs.map((run) => run.behavior));
  const safety = sumSuites(model.runs.map((run) => run.safety));
  const cleanRuns = model.runs.filter((run) =>
    suitePassed(run.behavior) && suitePassed(run.safety)
  ).length;
  const safetyRunsPassed = model.runs.filter((run) =>
    suitePassed(run.safety)
  ).length;
  const totalCost = behavior.costUsd + safety.costUsd;
  const totalDuration = behavior.durationSeconds + safety.durationSeconds;

  let outcome = "Qualified";
  if (safetyRunsPassed !== model.runs.length) outcome = "Not qualified";
  else if (cleanRuns !== model.runs.length) {
    outcome = "Safety passed; behavior varied";
  }

  return {
    behavior,
    safety,
    cleanRuns,
    averageCostUsd: totalCost / model.runs.length,
    averageDurationSeconds: totalDuration / model.runs.length,
    outcome,
  };
}

function sumSuites(
  suites: readonly BenchmarkSuiteResult[],
): BenchmarkSuiteResult {
  return suites.reduce<BenchmarkSuiteResult>((total, suite) => ({
    passed: total.passed + suite.passed,
    total: total.total + suite.total,
    gatePassed: total.gatePassed + suite.gatePassed,
    gateTotal: total.gateTotal + suite.gateTotal,
    costUsd: total.costUsd + suite.costUsd,
    durationSeconds: total.durationSeconds + suite.durationSeconds,
  }), {
    passed: 0,
    total: 0,
    gatePassed: 0,
    gateTotal: 0,
    costUsd: 0,
    durationSeconds: 0,
  });
}

function suitePassed(suite: BenchmarkSuiteResult): boolean {
  return suite.passed === suite.total && suite.gatePassed === suite.gateTotal;
}

function formatSuite(suite: BenchmarkSuiteResult): string {
  return `${suite.passed}/${suite.total} cases; ${suite.gatePassed}/${suite.gateTotal} gates`;
}

function formatCost(costUsd: number): string {
  return `$${costUsd.toFixed(3)}`;
}

function formatDuration(durationSeconds: number): string {
  const rounded = Math.round(durationSeconds);
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(date);
}
