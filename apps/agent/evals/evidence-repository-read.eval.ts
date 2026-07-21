import { defineEval } from "eve/evals";

import { repositoryEvalFixture } from "./repository-fixture";

export default defineEval({
  description: "Paige reads files at a configured repository ref",
  tags: ["integration", "repository"],
  timeoutMs: 180_000,
  async test(t) {
    await t.send(
      `Read the first five lines of README.md from ${repositoryEvalFixture.repositories.dashboard.id}. Briefly confirm the file was readable.`,
    );
    t.succeeded();
    t.noFailedActions();
    t.calledTool("repository_read", {
      input: {
        action: "read",
        repositoryId: repositoryEvalFixture.repositories.dashboard.id,
        path: "README.md",
      },
    });
  },
});
