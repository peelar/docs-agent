import { defineEval } from "eve/evals";

import { repositoryEvalFixture } from "./repository-fixture";

export default defineEval({
  description: "Paige discovers configured Git repositories",
  tags: ["integration", "repository"],
  timeoutMs: 180_000,
  async test(t) {
    await t.send(
      "Use the repository_read catalog and briefly list the configured repositories.",
    );
    t.succeeded();
    t.noFailedActions();
    t.calledTool("repository_read", {
      input: { action: "catalog" },
      output: (output) =>
        JSON.stringify(output).includes(repositoryEvalFixture.repositories.dashboard.id) &&
        JSON.stringify(output).includes(repositoryEvalFixture.repositories.documentation.id),
    });
    t.messageIncludes(repositoryEvalFixture.repositories.dashboard.name);
  },
});
