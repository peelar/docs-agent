import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";

import {
  evalSandboxSuffix,
  importEvalRuntimeModule,
  initializeEvalDatabase,
  saveEvalWorkspaceSetup,
} from "./eval-database";

const controlPlaneTestingModule = "@docs-agent/control-plane/testing";
const controlPlaneAgentModule = "@docs-agent/control-plane/agent";
const { migrateDocsAgentDatabase } = await importEvalRuntimeModule<
  typeof import("@docs-agent/control-plane/testing")
>(controlPlaneTestingModule);
const { saveWorkingRepositorySetup } = await importEvalRuntimeModule<
  typeof import("@docs-agent/control-plane/agent")
>(controlPlaneAgentModule);
await initializeEvalDatabase(migrateDocsAgentDatabase);
const evalSandboxPath = `/workspace/working-docs-${evalSandboxSuffix("working-repository")}`;

export default defineEval({
  description: "An unknown docs page is discovered through the canonical repository capability",
  tags: ["working-repository", "discovery", "read-only", "named-validator"],
  timeoutMs: 900_000,
  async test(t) {
    await saveEvalWorkspaceSetup(saveWorkingRepositorySetup, {
      workingDocumentationRepository: {
        source: { type: "github-url", url: "https://github.com/peelar/saleor-docs.git" },
        ref: "main",
        docsRoot: "docs",
        sandboxPath: evalSandboxPath,
        accessMode: "sandbox-write",
        allowedActions: ["clone", "read", "search", "patch", "run-checks", "export-diff", "publish-pr"],
        provenanceLabel: "working-documentation-repository",
      },
      watchedRepositories: [],
      contextRepositories: [],
      externalContext: [],
    });
    await t.send([
      "Load the docs-maintenance skill and reuse the configured working documentation repository.",
      "I do not know the file path. Find the page that documents the public maximum number of objects returned by a paginated connection query, read the relevant lines, and tell me the current limit with the exact page path.",
      "Use the canonical working repository capability. Call its atomic run_validators mode with the trusted internal.diff-quiet id so it discovers the current profile and runs that check, then inspect the bounded diff.",
      "This is read-only verification. Do not configure setup, call an authoring tool, edit files, prepare a draft, or publish anything.",
      "This task is already bounded. Complete every operation in the root session yourself. Do not call agent, delegate, or start a workflow or subagent.",
    ].join("\n"));

    t.succeeded();
    t.noFailedActions();
    t.loadedSkill("docs-maintenance", { count: 1 });
    t.notEvent("subagent.called");
    t.notCalledTool("configure_working_repository");
    t.calledTool("working_repository", {
      input: (input) => isRecord(input) && input.mode === "search",
    });
    t.calledTool("working_repository", {
      input: (input) => isRecord(input) && input.mode === "read",
      output: (output) =>
        isRecord(output) &&
        output.path === "docs/api-usage/pagination.mdx" &&
        String(output.content).includes("100"),
    });
    t.calledTool("working_repository", {
      input: (input) =>
        isRecord(input) &&
        input.mode === "run_validators" &&
        Array.isArray(input.validatorIds) &&
        input.validatorIds.includes("internal.diff-quiet"),
      output: (output) =>
        hasValidator(output, "internal.diff-quiet") &&
        hasPassedValidator(output, "internal.diff-quiet"),
    });
    t.calledTool("working_repository", {
      input: (input) => isRecord(input) && input.mode === "diff",
      output: (output) => isRecord(output) && output.noDiff === true,
    });
    t.check(
      t.reply,
      satisfies(
        (reply) => {
          const text = String(reply);
          return text.includes("docs/api-usage/pagination.mdx") && text.includes("100");
        },
        "final reply cites the discovered pagination page and its current limit",
      ),
    );
    t.notCalledTool("authoring_workspace");
    t.notCalledTool("repo_replace_text");
    t.notCalledTool("publish_working_repository_pr");
    t.notCalledTool("bash");
    t.notCalledTool("read_file");
    t.notCalledTool("write_file");
    t.notCalledTool("glob");
    t.notCalledTool("grep");
  },
});

function hasValidator(output: unknown, id: string): boolean {
  return (
    isRecord(output) &&
    isRecord(output.profile) &&
    Array.isArray(output.profile.validators) &&
    output.profile.validators.some((validator) => isRecord(validator) && validator.id === id)
  );
}

function hasPassedValidator(output: unknown, id: string): boolean {
  return (
    isRecord(output) &&
    Array.isArray(output.results) &&
    output.results.some(
      (result) => isRecord(result) && result.id === id && result.status === "passed",
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
