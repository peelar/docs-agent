import { defineEval } from "eve/evals";

import { repositoryEvalFixture } from "./repository-fixture";

export default defineEval({
  description: "Paige reads bounded GitHub repository metadata",
  tags: ["integration", "repository"],
  timeoutMs: 180_000,
  async test(t) {
    await t.send(
      `List the three most recent tags for ${repositoryEvalFixture.repositories.dashboard.id}. Briefly report the tag names.`,
    );
    t.succeeded();
    t.noFailedActions();
    t.calledTool("repository_metadata", {
      input: {
        action: "list_tags",
        repositoryId: repositoryEvalFixture.repositories.dashboard.id,
        limit: 3,
      },
      output: (output) =>
        JSON.stringify(output).includes('"tags"') &&
        JSON.stringify(output).includes('"commitSha"'),
    });
  },
});
