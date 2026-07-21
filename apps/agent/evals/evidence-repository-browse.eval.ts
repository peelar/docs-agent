import { defineEval } from "eve/evals";

import { repositoryEvalFixture } from "./repository-fixture";

export default defineEval({
  description: "Paige lists and searches a configured repository",
  tags: ["integration", "repository"],
  timeoutMs: 180_000,
  async test(t) {
    await t.send(
      `Find README.md in ${repositoryEvalFixture.repositories.dashboard.id}, then search that repository for the phrase 'Saleor Dashboard'. Briefly report the matching path.`,
    );
    t.succeeded();
    t.noFailedActions();
    t.calledTool("repository_read", {
      input: {
        action: "list_files",
        repositoryId: repositoryEvalFixture.repositories.dashboard.id,
      },
    });
    t.calledTool("repository_read", {
      input: {
        action: "search",
        repositoryId: repositoryEvalFixture.repositories.dashboard.id,
        query: "Saleor Dashboard",
      },
      output: (output) => JSON.stringify(output).includes("README.md"),
    });
    t.messageIncludes("README.md");
  },
});
