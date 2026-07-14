import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

test("workflow model", async () => {
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const workflows = await readFile(join(repositoryRoot, "docs/internal/WORKFLOWS.md"), "utf8");
const repositoryModel = await readFile(join(repositoryRoot, "docs/internal/REPOSITORY_MODEL.md"), "utf8");
const manifest = await readFile(join(repositoryRoot, "docs/internal/MANIFEST.md"), "utf8");
const roadmap = await readFile(join(repositoryRoot, "docs/internal/ROADMAP.md"), "utf8");
const readme = await readFile(join(repositoryRoot, "README.md"), "utf8");
const publicIdentity = await readFile(join(repositoryRoot, "docs/IDENTITY.md"), "utf8");
const teamContext = await readFile(join(repositoryRoot, "docs/TEAM_CONTEXT.md"), "utf8");
const userTesting = await readFile(join(repositoryRoot, "docs/internal/USER_TESTING.md"), "utf8");
const setupSkill = await readFile(join(repositoryRoot, ".agents/skills/setup/SKILL.md"), "utf8");

for (const heading of [
  "Workspace Knowledge Question",
  "Mentioned In Context",
  "Periodic Scan",
  "Initiative Or Project Participation",
  "Release Readiness",
  "Current-Docs Verification",
  "Patch Handoff",
]) {
  assert.match(workflows, new RegExp(`### ${heading}`));
}

for (const boundary of [
  "Documentation work",
  "Decision and triage",
  "Current-docs verification",
  "Draft authoring",
  "Writeback",
]) {
  assert.match(workflows, new RegExp(`\\| ${boundary} \\|`));
}

for (const tool of [
  "docs_work_manage",
  "docs_work_read",
  "scan_watched_repositories",
  "authoring_workspace",
  "publish_working_repository_pr",
]) {
  assert.equal(workflows.includes(`\`${tool}\``), true);
}
for (const removed of [
  "create_docs_signal",
  "get_docs_signal",
  "list_docs_signals",
  "update_docs_signal_lifecycle",
  "owned_docs_work",
  "editorial_recommendation",
  "content_plan",
  "verify_docs_signal_current_docs",
]) {
  assert.equal(workflows.includes(`\`${removed}\``), false);
}

assert.equal(workflows.includes("run_docs_maintenance_scenario"), false);
assert.match(workflows, /repository reads; bounded `working_repository` modes serve direct investigations/);
assert.match(workflows, /Draft PR publishing waits for explicit approval/);
assert.match(workflows, /No sandbox verification runs yet/);
assert.match(workflows, /Slack Mention With Source Evidence/);
assert.match(workflows, /Linear Issue Without Source Evidence/);
assert.match(workflows, /may end with a sourced answer, explicit abstention, or\s+recommendation without creating durable documentation work/);
assert.match(workflows, /Documentation is the only mutable product\s+domain/);
assert.match(manifest, /docs\/internal\/WORKFLOWS\.md/);
assert.match(roadmap, /docs\/internal\/WORKFLOWS\.md/);
assert.match(repositoryModel, /Docs Impact Decision Model/);

assert.match(readme, /A workspace question may end as a sourced answer, an explicit abstention, or a\s+recommendation without creating documentation work/);
assert.match(readme, /bounded source inspection/);
assert.match(readme, /Documentation is Paige's only mutable product domain/);
assert.match(publicIdentity, /knowledge and documentation agent/);
assert.match(publicIdentity, /A useful answer does not need to become documentation work/);
assert.match(manifest, /A useful interaction\s+may end as a sourced answer, an explicit abstention, or a recommendation/);
assert.match(manifest, /documentation\s+is the only mutable product domain/i);
assert.match(roadmap, /A question\s+can end as a sourced answer, explicit abstention, or recommendation without\s+creating docs work/);
assert.match(repositoryModel, /Everything\s+else is read-only evidence for a sourced answer, explicit abstention/);
assert.match(repositoryModel, /Inspecting evidence does not create\s+a docs signal, plan, draft, or memory by default/);
assert.match(teamContext, /entry points, not mandatory docs-signal workflows/);
assert.match(teamContext, /documentation remains\s+the only mutable product domain/);
assert.match(userTesting, /third `identity` eval covers that behavior before the identity text changes/);
assert.match(setupSkill, /Setup records sources and readiness; it does not grant model\s+authority/);

const activeProductDocs = [
  readme,
  publicIdentity,
  manifest,
  roadmap,
  workflows,
  repositoryModel,
  teamContext,
  userTesting,
  setupSkill,
].join("\n");
for (const obsoleteClaim of [
  "Paige starts with a documentation impact report",
  "Paige work starts from a docs signal",
  "Treat the documentation impact report as the core output",
  "Everything else is evidence for the documentation impact report",
]) {
  assert.equal(activeProductDocs.includes(obsoleteClaim), false);
}

console.log("Workflow model checks passed.");
});
