import { spawn } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import {
  type BenchmarkModelResult,
  type BenchmarkRunResult,
  type BenchmarkSuiteResult,
  renderBenchmarkSection,
  replaceBenchmarkSection,
} from "./benchmark-report";
import { benchmarkConfig } from "./benchmark.config";
import { evalGroupsForSuite } from "./runner";
import type { EvalSuiteName } from "./runner";

interface EvalArtifactSummary {
  passed: number;
  failed: number;
  errored: number;
  skipped: number;
  totalEvals: number;
  startedAt: string;
  completedAt: string;
  evals: readonly {
    assertions: readonly {
      severity: string;
      passed: boolean;
    }[];
  }[];
}

const evalArtifactRoot = join(process.cwd(), ".eve", "evals");
const publicEvalPath = resolve(process.cwd(), "..", "..", "EVALS.md");

try {
  await runBenchmark();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Benchmark stopped: ${message}\n`);
  process.exitCode = 1;
}

async function runBenchmark(): Promise<void> {
  validateBenchmarkConfig();
  await ensureRepositoryIsClean();

  const originalModel = process.env.EVE_GATEWAY_MODEL;
  const results: BenchmarkModelResult[] = [];

  try {
    for (const model of benchmarkConfig.models) {
      process.stdout.write(`\nBenchmarking ${model.label}\n`);
      const runs: BenchmarkRunResult[] = [];
      for (let runIndex = 0; runIndex < benchmarkConfig.runCount; runIndex += 1) {
        process.stdout.write(
          `Run ${runIndex + 1}/${benchmarkConfig.runCount}\n`,
        );
        process.env.EVE_GATEWAY_MODEL = model.modelId;
        runs.push({
          behavior: await runAndReadSuite("behavior", model.modelId),
          safety: await runAndReadSuite("safety", model.modelId),
        });
      }
      results.push({ ...model, runs });
    }
  } finally {
    if (originalModel === undefined) delete process.env.EVE_GATEWAY_MODEL;
    else process.env.EVE_GATEWAY_MODEL = originalModel;
  }

  // Product failures belong in the table. Infrastructure failures throw before
  // this point, so a broken benchmark can never replace the last trusted report.
  await ensureRepositoryIsClean();
  const currentDocument = await readFile(publicEvalPath, "utf8");
  const section = renderBenchmarkSection(new Date(), results);
  await writeFile(
    publicEvalPath,
    replaceBenchmarkSection(currentDocument, section),
    "utf8",
  );
  process.stdout.write(`\nUpdated ${publicEvalPath}\n`);
}

function validateBenchmarkConfig(): void {
  if (benchmarkConfig.runCount < 1 || benchmarkConfig.models.length === 0) {
    throw new Error("Benchmark config needs at least one model and one run.");
  }
  const modelIds = benchmarkConfig.models.map((model) => model.modelId);
  if (new Set(modelIds).size !== modelIds.length) {
    throw new Error("Benchmark config contains duplicate model IDs.");
  }
}

async function runAndReadSuite(
  suite: Extract<EvalSuiteName, "behavior" | "safety">,
  expectedModelId: string,
): Promise<BenchmarkSuiteResult> {
  const before = await listArtifactDirectories();
  await spawnEvalSuite(suite);
  const after = await listArtifactDirectories();
  const artifactNames = [...after].filter((name) => !before.has(name)).sort();
  const expectedArtifacts = evalGroupsForSuite(suite).length;

  if (artifactNames.length !== expectedArtifacts) {
    throw new Error(
      `${suite} produced ${artifactNames.length} artifacts; expected ${expectedArtifacts}.`,
    );
  }

  const artifacts = await Promise.all(artifactNames.map((name) =>
    readArtifact(join(evalArtifactRoot, name), expectedModelId)
  ));
  return sumArtifacts(artifacts);
}

function spawnEvalSuite(suite: "behavior" | "safety"): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("pnpm", ["eval:run", suite], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal !== null) {
        reject(new Error(`Benchmark ${suite} suite stopped by ${signal}.`));
        return;
      }
      // Exit 1 is an expected model qualification failure. Artifact validation
      // below distinguishes it from an incomplete or broken benchmark run.
      if (code !== 0 && code !== 1) {
        reject(new Error(`Benchmark ${suite} suite exited with code ${code}.`));
        return;
      }
      resolvePromise();
    });
  });
}

async function readArtifact(
  directory: string,
  expectedModelId: string,
): Promise<BenchmarkSuiteResult> {
  const summary = JSON.parse(
    await readFile(join(directory, "summary.json"), "utf8"),
  ) as EvalArtifactSummary;
  if (summary.errored !== 0 || summary.skipped !== 0) {
    throw new Error(
      `${relative(process.cwd(), directory)} contains errored or skipped evals.`,
    );
  }

  const resultFiles = (await listJsonFiles(join(directory, "evals")))
    .filter((path) => !path.endsWith("summary.json"));
  const observations = await Promise.all(resultFiles.map(async (path) =>
    observeEvalResult(JSON.parse(await readFile(path, "utf8")) as unknown)
  ));
  const modelIds = new Set(observations.flatMap((item) => item.modelIds));
  if (modelIds.size !== 1 || !modelIds.has(expectedModelId)) {
    throw new Error(
      `${relative(process.cwd(), directory)} did not use only ${expectedModelId}.`,
    );
  }

  const gateAssertions = summary.evals.flatMap((item) => item.assertions)
    .filter((assertion) => assertion.severity === "gate");
  return {
    passed: summary.passed,
    total: summary.totalEvals,
    gatePassed: gateAssertions.filter((assertion) => assertion.passed).length,
    gateTotal: gateAssertions.length,
    costUsd: observations.reduce((total, item) => total + item.costUsd, 0),
    durationSeconds: (
      Date.parse(summary.completedAt) - Date.parse(summary.startedAt)
    ) / 1_000,
  };
}

function observeEvalResult(value: unknown): {
  costUsd: number;
  modelIds: string[];
} {
  let costUsd = 0;
  const modelIds: string[] = [];
  visit(value);
  return { costUsd, modelIds };

  function visit(current: unknown): void {
    if (Array.isArray(current)) {
      for (const item of current) visit(item);
      return;
    }
    if (current === null || typeof current !== "object") return;

    const record = current as Record<string, unknown>;
    if (typeof record.modelId === "string") modelIds.push(record.modelId);
    if (record.type === "step.completed") {
      const data = asRecord(record.data);
      const usage = asRecord(data?.usage);
      if (typeof usage?.costUsd === "number") costUsd += usage.costUsd;
    }
    for (const child of Object.values(record)) visit(child);
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function sumArtifacts(
  artifacts: readonly BenchmarkSuiteResult[],
): BenchmarkSuiteResult {
  return artifacts.reduce<BenchmarkSuiteResult>((total, artifact) => ({
    passed: total.passed + artifact.passed,
    total: total.total + artifact.total,
    gatePassed: total.gatePassed + artifact.gatePassed,
    gateTotal: total.gateTotal + artifact.gateTotal,
    costUsd: total.costUsd + artifact.costUsd,
    durationSeconds: total.durationSeconds + artifact.durationSeconds,
  }), {
    passed: 0,
    total: 0,
    gatePassed: 0,
    gateTotal: 0,
    costUsd: 0,
    durationSeconds: 0,
  });
}

async function listArtifactDirectories(): Promise<Set<string>> {
  try {
    return new Set(await readdir(evalArtifactRoot));
  } catch {
    return new Set();
  }
}

async function listJsonFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listJsonFiles(path);
    return entry.isFile() && entry.name.endsWith(".json") ? [path] : [];
  }));
  return files.flat();
}

async function ensureRepositoryIsClean(): Promise<void> {
  const changes = await benchmarkInputChanges();
  if (changes.length !== 0) {
    throw new Error(
      "Commit or stash agent changes before publishing a model benchmark.",
    );
  }
}

function benchmarkInputChanges(): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("git", [
      "status",
      "--porcelain",
      "--",
      "apps/agent",
      "pnpm-lock.yaml",
    ], {
      cwd: resolve(process.cwd(), "..", ".."),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let errorOutput = "";
    child.stdout.on("data", (chunk: Buffer) => output += chunk.toString());
    child.stderr.on("data", (chunk: Buffer) => {
      errorOutput += chunk.toString();
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0) {
        reject(new Error(
          `Could not inspect the repository before benchmarking: ${errorOutput.trim()}`,
        ));
        return;
      }
      resolvePromise(output.trim());
    });
  });
}
