import { access } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { repositoryEvalFixture } from "../evals/repository-fixture";
import {
  classifyIntegrationFailure,
  createEvalEnvironment,
  evalGroupsForSuite,
} from "../evals/runner";

describe("repository eval fixture", () => {
  it("derives repository IDs through production normalization", () => {
    expect(repositoryEvalFixture.repositories.documentation.id).toBe(
      "peelar--saleor-docs",
    );
    expect(repositoryEvalFixture.repositories.core.id).toBe("saleor--saleor");
    expect(repositoryEvalFixture.repositories.dashboard.id).toBe(
      "saleor--saleor-dashboard",
    );
  });
});

describe("eval runner", () => {
  it("uses fresh temporary databases and removes them", async () => {
    const first = await createEvalEnvironment(false);
    const second = await createEvalEnvironment(false);

    expect(first.directory).not.toBe(second.directory);
    expect(first.variables.PAIGE_DATABASE_URL).not.toBe(
      second.variables.PAIGE_DATABASE_URL,
    );
    expect(first.variables.WORKFLOW_LOCAL_DATA_DIR).not.toBe(
      second.variables.WORKFLOW_LOCAL_DATA_DIR,
    );

    await first.cleanup();
    await second.cleanup();
    await expect(access(first.directory)).rejects.toThrow(/ENOENT/);
    await expect(access(second.directory)).rejects.toThrow(/ENOENT/);
  });

  it("runs onboarding scenarios as isolated groups", () => {
    const groups = evalGroupsForSuite("full").filter((group) =>
      group.name.includes("repository-onboarding")
    );

    expect(groups).toHaveLength(3);
    expect(groups.every((group) => !group.seedRepositories)).toBe(true);
    expect(groups.every((group) => group.maxConcurrency === 1)).toBe(true);
  });

  it("classifies common live integration blockers", () => {
    expect(classifyIntegrationFailure("GitHub API rate limit")).toContain(
      "rate limiting",
    );
    expect(classifyIntegrationFailure("OIDC token is required")).toContain(
      "credentials",
    );
    expect(
      classifyIntegrationFailure("Failed to authenticate GitHub access"),
    ).toContain("credentials");
    expect(classifyIntegrationFailure("Repository access denied")).toContain(
      "repository access",
    );
  });
});
