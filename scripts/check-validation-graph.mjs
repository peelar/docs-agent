import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync(
  "pnpm",
  ["exec", "turbo", "run", "check", "--dry=json"],
  {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, TURBO_TELEMETRY_DISABLED: "1" },
  },
);

if (result.status !== 0) {
  throw new Error(
    `Turbo validation graph inspection failed.\n${result.stdout}${result.stderr}`.trim(),
  );
}

const graph = JSON.parse(result.stdout);
const tasks = new Map(graph.tasks.map((task) => [task.taskId, task]));
const packages = new Map([
  [
    "@docs-agent/control-plane",
    readPackage("packages/control-plane/package.json"),
  ],
  ["@docs-agent/web", readPackage("apps/web/package.json")],
  ["docs-agent", readPackage("apps/agent/package.json")],
]);
const expectedBuilds = [
  "@docs-agent/control-plane#build",
  "@docs-agent/web#build",
  "docs-agent#build",
];
const actualBuilds = graph.tasks
  .filter((task) => task.task === "build")
  .map((task) => task.taskId)
  .sort();

assert.deepEqual(
  actualBuilds,
  [...expectedBuilds].sort(),
  "Turbo must schedule exactly one build task for every workspace package.",
);

for (const packageName of [
  "@docs-agent/control-plane",
  "@docs-agent/web",
  "docs-agent",
]) {
  const check = tasks.get(`${packageName}#check`);
  assert.ok(check, `Turbo is missing ${packageName}#check.`);
  assert.deepEqual(
    check.dependencies,
    [`${packageName}#build`],
    `${packageName}#check must delegate its build to Turbo.`,
  );

  for (const scriptName of ["check", "test"]) {
    const command = packages.get(packageName)?.scripts?.[scriptName];
    assert.equal(
      typeof command,
      "string",
      `${packageName} is missing ${scriptName}.`,
    );
    assert.doesNotMatch(
      command,
      /\bbuild\b/u,
      `${packageName}#${scriptName} must not hide a build command.`,
    );
  }
}

for (const appName of ["@docs-agent/web", "docs-agent"]) {
  assert.deepEqual(
    tasks.get(`${appName}#build`)?.dependencies,
    ["@docs-agent/control-plane#build"],
    `${appName}#build must share Turbo's control-plane build dependency.`,
  );
}

assert.deepEqual(
  tasks.get("@docs-agent/control-plane#build")?.dependencies,
  [],
  "The control-plane build must be the validation graph root.",
);

const agentPackage = packages.get("docs-agent");
const webPackage = packages.get("@docs-agent/web");
assert.match(agentPackage.scripts.build, /eve build/u);
assert.match(webPackage.scripts.build, /next build/u);

console.log("Turbo validation graph checks passed.");

function readPackage(path) {
  return JSON.parse(readFileSync(join(repositoryRoot, path), "utf8"));
}
