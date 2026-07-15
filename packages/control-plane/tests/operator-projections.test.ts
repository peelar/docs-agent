import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test } from "vitest";

import { migrateDocsAgentDatabase } from "../src/db/client.ts";
import {
  getOperatorCapabilityReport,
  getOperatorKnowledgeSources,
  operatorCapabilityReportSchema,
} from "../src/operator-projections.ts";
import {
  githubRepositoryUrlSchema,
  repositoryInputSchema,
} from "../src/repository-contract.ts";
import { saveWorkingRepositorySetup } from "../src/setup-state.ts";

test("operator source and capability projections reuse canonical policy", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "paige-operator-projections-"));
  const originalDatabaseUrl = process.env.DOCS_AGENT_DATABASE_URL;
  const originalVercel = process.env.VERCEL;
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.DOCS_AGENT_DATABASE_URL = `file:${join(tempRoot, "operator.sqlite")}`;
  delete process.env.VERCEL;
  delete process.env.NODE_ENV;

  try {
    await migrateDocsAgentDatabase();
    const empty = await getOperatorKnowledgeSources();
    assert.equal(empty.state, "unconfigured");
    assert.deepEqual(empty.sources, []);

    await saveWorkingRepositorySetup(repositoryInputSchema.parse({
      workingDocumentationRepository: {
        source: { type: "github-url", url: "https://github.com/example/docs" },
        ref: "main",
        docsRoot: "docs",
      },
      watchedRepositories: [{
        id: "product",
        name: "Product source",
        description: "Implementation evidence",
        source: { type: "github-url", url: "https://github.com/example/product" },
        defaultRef: "stable",
        sandboxPath: "/workspace/watched/product",
        pathFilters: ["src/**"],
        provenanceLabel: "watched-repository:example/product",
      }],
      contextRepositories: [{
        id: "decisions",
        name: "Product decisions",
        description: "Accepted product decisions",
        source: { type: "github-url", url: "https://github.com/example/decisions" },
        ref: "accepted",
        sandboxPath: "/workspace/context/decisions",
        pathFilters: ["decisions/**"],
        evidenceClass: "maintainer-confirmed-product-decision",
        canSupportPublicDocsClaim: true,
        provenanceLabel: "context-repository:example/decisions",
      }],
    }));

    const sources = await getOperatorKnowledgeSources();
    assert.equal(sources.state, "ready");
    assert.deepEqual(sources.sources.map(({ sourceId }) => sourceId), [
      "working-documentation",
      "watched:product",
      "context:decisions",
    ]);
    assert.equal(sources.sources[0]?.authority.draftMutation, "working-documentation-only");
    assert.equal(sources.sources[1]?.authority.draftMutation, "none");
    assert.equal(sources.sources[1]?.readiness.access, "not-checked");
    assert.equal(sources.sources[1]?.repository.resolvedRevision, null);
    const serializedSources = JSON.stringify(sources);
    assert.equal(serializedSources.includes("workspaceId"), false);
    assert.equal(serializedSources.includes("sandboxPath"), false);
    assert.equal(
      githubRepositoryUrlSchema.safeParse("https://operator:token@github.com/example/docs").success,
      false,
    );
    assert.equal(
      githubRepositoryUrlSchema.safeParse("https://github.com/example/docs?token=secret").success,
      false,
    );

    const capabilities = await getOperatorCapabilityReport();
    assert.equal(capabilities.setupReady, true);
    const eve = capabilities.contexts.find(({ context }) => context === "eve");
    const schedule = capabilities.contexts.find(({ context }) => context === "schedule");
    const watch = capabilities.contexts.find(({ context }) => context === "watch");
    assert.equal(eve?.capabilities.find(({ family }) => family === "draft.edit")?.availability, "available");
    assert.equal(eve?.capabilities.find(({ family }) => family === "provider.deliver")?.availability, "unavailable");
    assert.equal(schedule?.capabilities.find(({ family }) => family === "publication.publish")?.availability, "unavailable");
    assert.deepEqual(
      schedule?.capabilities.find(({ family }) => family === "follow_up.schedule")?.toolNames,
      ["process_due_docs_followups"],
    );
    assert.equal(schedule?.effectiveToolNames.includes("docs_follow_up"), false);
    assert.equal(schedule?.effectiveToolNames.includes("process_due_docs_followups"), true);
    assert.equal(watch?.capabilities.find(({ family }) => family === "knowledge.read")?.availability, "conditional");
    assert.equal(watch?.capabilities.find(({ family }) => family === "publication.publish")?.availability, "unavailable");
    assert.equal(capabilities.contexts.every(({ capabilities: items }) => items.length === 7), true);
    for (const context of capabilities.contexts) {
      for (const capability of context.capabilities) {
        assert.equal(
          capability.toolNames.every((tool) => context.effectiveToolNames.includes(tool)),
          true,
          `${context.context}/${capability.family} must expose only exactly resolved tools`,
        );
      }
    }
    const fabricated = structuredClone(capabilities);
    fabricated.contexts[0]!.effectiveToolNames.push("knowledge_read" as never);
    assert.equal(operatorCapabilityReportSchema.safeParse(fabricated).success, false);
    const fabricatedReason = structuredClone(capabilities);
    fabricatedReason.contexts[0]!.reasonCodes.push("browser-granted" as never);
    assert.equal(operatorCapabilityReportSchema.safeParse(fabricatedReason).success, false);
  } finally {
    restoreEnvironment("DOCS_AGENT_DATABASE_URL", originalDatabaseUrl);
    restoreEnvironment("VERCEL", originalVercel);
    restoreEnvironment("NODE_ENV", originalNodeEnv);
    await rm(tempRoot, { recursive: true, force: true });
  }
});

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
