import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

import { test } from "vitest";

test("eval database and workspace fixtures are run-scoped", async () => {
  const evalDirectory = new URL("../evals/", import.meta.url);
  const evalFiles = (await readdir(evalDirectory))
    .filter((name) => name.endsWith(".eval.ts"));

  for (const name of evalFiles) {
    const source = await readFile(new URL(name, evalDirectory), "utf8");
    assert.equal(
      source.includes("DOCS_AGENT_DATABASE_URL"),
      false,
      `${name} must not select a database while Eve is importing every eval module`,
    );
  }

  const databaseHelper = await readFile(new URL("eval-database.ts", evalDirectory), "utf8");
  assert.match(databaseHelper, /__paigeEvalDatabaseState__/u);
  assert.match(databaseHelper, /state\.migration \?\?=/u);
  assert.match(databaseHelper, /WORKFLOW_LOCAL_DATA_DIR/u);
  assert.match(databaseHelper, /process\.once\("exit"/u);

  const evalConfig = await readFile(new URL("../evals/evals.config.ts", import.meta.url), "utf8");
  assert.match(evalConfig, /maxConcurrency:\s*1/u, "shared eval fixtures require serial case execution");
  const supervisor = await readFile(new URL("../../../scripts/run-supervised-eval.mjs", import.meta.url), "utf8");
  assert.match(supervisor, /DB-backed eval fixtures require --max-concurrency 1/u);

  for (const name of [
    "authoring-convergence.eval.ts",
    "working-repository-discovery.eval.ts",
    "workspace-knowledge-sources.eval.ts",
  ]) {
    const source = await readFile(new URL(name, evalDirectory), "utf8");
    const definitionsStart = source.indexOf("export default");
    assert.notEqual(definitionsStart, -1);
    assert.equal(
      source.slice(0, definitionsStart).includes("await saveEvalWorkspaceSetup("),
      false,
      `${name} must configure its workspace inside the selected case`,
    );
    assert.equal(source.slice(definitionsStart).includes("await saveEvalWorkspaceSetup("), true);
  }
});
