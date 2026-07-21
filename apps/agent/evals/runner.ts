import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";

import { createClient } from "@libsql/client";

import { LibsqlRepositoryConfigurationStore } from "../repositories/configuration/store";
import { repositoryEvalFixture } from "./repository-fixture";

export type EvalSuiteName = "behavior" | "safety" | "integration" | "full";

type EvalGatePolicy = "gate" | "report-only";

interface EvalGroup {
  name: string;
  evalIds: readonly string[];
  maxConcurrency: number;
  seedRepositories: boolean;
  gatePolicy: EvalGatePolicy;
}

interface EvalEnvironment {
  directory: string;
  variables: NodeJS.ProcessEnv;
  cleanup(): Promise<void>;
}

interface EvalArtifactSummary {
  evals: readonly {
    id: string;
    verdict: string;
  }[];
}

const behaviorGroups: readonly EvalGroup[] = [
  {
    name: "behavior",
    evalIds: [
      "basic",
      "documentation-impact/required",
      "documentation-impact/no-change",
      "documentation-impact/optional",
      "documentation-impact/insufficient-evidence",
      "documentation-impact/contradictory-evidence",
      "documentation-authoring",
      "documentation-no-change",
    ],
    maxConcurrency: 4,
    seedRepositories: true,
    gatePolicy: "gate",
  },
  onboardingGroup("repository-onboarding-collection", "behavior"),
  onboardingGroup("repository-onboarding-welcome", "behavior"),
];

const safetyGroups: readonly EvalGroup[] = [
  {
    name: "safety",
    evalIds: [
      "documentation-impact/malicious-evidence",
      "documentation-impact/supplied-evidence-no-inspection",
      "evidence-repository-read-only",
      "repository-access-failure",
      "documentation-publish-approval",
      "documentation-publish-drift",
    ],
    maxConcurrency: 1,
    seedRepositories: true,
    gatePolicy: "gate",
  },
];

const integrationGroups: readonly EvalGroup[] = [
  {
    name: "integration",
    evalIds: [
      "evidence-repository",
      "evidence-repository-read",
      "evidence-repository-browse",
      "repository-metadata",
      "repository-compare",
      "pull-request-read",
    ],
    maxConcurrency: 1,
    seedRepositories: true,
    gatePolicy: "report-only",
  },
  {
    name: "integration:repository-onboarding-confirm",
    evalIds: ["repository-onboarding-confirm"],
    maxConcurrency: 1,
    seedRepositories: false,
    gatePolicy: "report-only",
  },
];

export function evalGroupsForSuite(
  suite: EvalSuiteName,
): readonly EvalGroup[] {
  switch (suite) {
    case "behavior":
      return behaviorGroups;
    case "safety":
      return safetyGroups;
    case "integration":
      return integrationGroups;
    case "full":
      return [...behaviorGroups, ...safetyGroups, ...integrationGroups];
  }
}

export async function createEvalEnvironment(
  seedRepositories: boolean,
): Promise<EvalEnvironment> {
  const directory = await mkdtemp(join(tmpdir(), "paige-evals-"));
  const databasePath = join(directory, "paige.db");
  const client = createClient({ url: `file:${databasePath}` });

  try {
    if (seedRepositories) {
      const store = new LibsqlRepositoryConfigurationStore(client);
      const saved = await store.save({
        configuration: repositoryEvalFixture.configuration,
        expectedRevision: null,
      });
      if (saved.isErr()) throw saved.error;
    }
  } catch (error) {
    client.close();
    await rm(directory, { force: true, recursive: true });
    throw error;
  }

  client.close();
  return {
    directory,
    variables: {
      PAIGE_DATABASE_URL: `file:${databasePath}`,
      PAIGE_DATABASE_AUTH_TOKEN: "",
      PAIGE_EVAL_AUTH_TOKEN: randomBytes(32).toString("hex"),
      WORKFLOW_LOCAL_DATA_DIR: join(directory, "workflow"),
    },
    async cleanup() {
      await rm(directory, { force: true, recursive: true });
    },
  };
}

export async function runEvalSuite(suite: EvalSuiteName): Promise<number> {
  let gatedFailure = false;
  for (const group of evalGroupsForSuite(suite)) {
    const exitCode = await runEvalGroup(group);
    if (exitCode !== 0 && group.gatePolicy === "gate") gatedFailure = true;
  }
  return gatedFailure ? 1 : 0;
}

async function runEvalGroup(group: EvalGroup): Promise<number> {
  const environment = await createEvalEnvironment(group.seedRepositories);
  const previousArtifacts = await listArtifactDirectories();
  process.stdout.write(`\nPaige eval suite: ${group.name}\n`);

  try {
    const exitCode = await spawnEveEval(group, environment.variables);
    const artifact = await findNewArtifactDirectory(previousArtifacts);
    if (group.gatePolicy === "report-only") {
      await reportIntegrationFailures(artifact);
      if (exitCode !== 0) {
        process.stdout.write(
          "Live integration failures were reported and did not fail the gate.\n",
        );
      }
      return 0;
    }
    return exitCode;
  } finally {
    await environment.cleanup();
  }
}

function spawnEveEval(
  group: EvalGroup,
  variables: NodeJS.ProcessEnv,
): Promise<number> {
  const args = [
    "exec",
    "eve",
    "eval",
    ...group.evalIds,
    "--max-concurrency",
    String(group.maxConcurrency),
  ];

  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", args, {
      cwd: process.cwd(),
      env: { ...process.env, ...variables },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal !== null) {
        reject(new Error(`Eve eval stopped by ${signal}.`));
        return;
      }
      resolve(code ?? 1);
    });
  });
}

async function listArtifactDirectories(): Promise<Set<string>> {
  const root = join(process.cwd(), ".eve", "evals");
  try {
    return new Set(await readdir(root));
  } catch {
    return new Set();
  }
}

async function findNewArtifactDirectory(
  previous: ReadonlySet<string>,
): Promise<string | undefined> {
  const root = join(process.cwd(), ".eve", "evals");
  let names: string[];
  try {
    names = (await readdir(root)).filter((name) => !previous.has(name));
  } catch {
    return undefined;
  }

  const candidates = await Promise.all(names.map(async (name) => ({
    path: join(root, name),
    modifiedAt: (await stat(join(root, name))).mtimeMs,
  })));
  return candidates.sort((left, right) => right.modifiedAt - left.modifiedAt)[0]
    ?.path;
}

async function reportIntegrationFailures(
  artifactDirectory: string | undefined,
): Promise<void> {
  if (artifactDirectory === undefined) {
    process.stdout.write("Integration result: artifact unavailable.\n");
    return;
  }

  const summary = JSON.parse(
    await readFile(join(artifactDirectory, "summary.json"), "utf8"),
  ) as EvalArtifactSummary;
  const failures = summary.evals.filter((item) => item.verdict !== "passed");
  if (failures.length === 0) {
    process.stdout.write("Integration result: all live cases passed.\n");
    return;
  }

  for (const failure of failures) {
    const resultPath = join(
      artifactDirectory,
      "evals",
      `${failure.id}.json`,
    );
    let body = "";
    try {
      body = await readFile(resultPath, "utf8");
    } catch {
      // The summary still gives us a useful execution-level classification.
    }
    process.stdout.write(
      `Integration result: ${failure.id} — ${classifyIntegrationFailure(body)}\n`,
    );
  }
}

export function classifyIntegrationFailure(body: string): string {
  if (/rate.?limit|too many requests|\b429\b/i.test(body)) {
    return "blocked by GitHub rate limiting";
  }
  if (/credential|unauthenticated|authenticat|oidc|token.*(?:missing|required)/i.test(body)) {
    return "blocked by missing or invalid credentials";
  }
  if (/forbidden|not accessible|access denied|permission/i.test(body)) {
    return "blocked by repository access";
  }
  if (/"status":"failed"|ACTION_RESULT_FAILED/.test(body)) {
    return "failed in the repository integration";
  }
  return "failed an agent behavior or assertion contract";
}

function onboardingGroup(evalId: string, suite: string): EvalGroup {
  return {
    name: `${suite}:${evalId}`,
    evalIds: [evalId],
    maxConcurrency: 1,
    seedRepositories: false,
    gatePolicy: "gate",
  };
}
