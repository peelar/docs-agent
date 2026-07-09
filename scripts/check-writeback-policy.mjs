import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const toolSource = readFileSync("agent/tools/publish_working_repository_pr.ts", "utf8");
const writebackSource = readFileSync("agent/lib/github-writeback.ts", "utf8");
const evalSource = readFileSync("evals/saleor-docs-user-tests.eval.ts", "utf8");

assert.match(
  toolSource,
  /approval:\s*always\(\)/,
  "publish_working_repository_pr must require approval on every call.",
);

assert.match(
  writebackSource,
  /principalType:\s*"app"/,
  "GitHub writeback must use app-scoped Vercel Connect credentials.",
);

assert.match(
  writebackSource,
  /No patch to publish/,
  "GitHub writeback must fail visibly when there is no prepared patch.",
);

assert.match(
  writebackSource,
  /GitHub \$\{input\.method\} \$\{input\.path\} failed/,
  "GitHub writeback must surface GitHub API write failures.",
);

assert.match(
  writebackSource,
  /Branch already exists/,
  "GitHub writeback must surface branch conflicts.",
);

assert.match(
  evalSource,
  /notCalledTool\("publish_working_repository_pr"\)/,
  "Scenario evals must assert no implicit GitHub writeback.",
);

assert.equal(
  existsSync("agent/connections/github.ts"),
  false,
  "Do not expose generated GitHub API tools as the model-facing writeback surface.",
);

console.log("writeback policy checks passed");
