import { defineEval } from "eve/evals";

import { repositoryEvalFixture } from "./repository-fixture";

export default defineEval({
  description: "Paige compares files across a known pull-request change",
  tags: ["integration", "repository"],
  timeoutMs: 180_000,
  async test(t) {
    await t.send(
      `Compare ${repositoryEvalFixture.pullRequest.baseSha} with ${repositoryEvalFixture.pullRequest.headSha} in ${repositoryEvalFixture.repositories.dashboard.id}. Briefly report whether ${repositoryEvalFixture.pullRequest.changedPath} changed.`,
    );
    t.succeeded();
    t.noFailedActions();
    t.calledTool("repository_read", {
      input: {
        action: "compare",
        repositoryId: repositoryEvalFixture.repositories.dashboard.id,
        baseRef: repositoryEvalFixture.pullRequest.baseSha,
        headRef: repositoryEvalFixture.pullRequest.headSha,
      },
      output: (output) =>
        JSON.stringify(output).includes(repositoryEvalFixture.pullRequest.changedPath),
    });
  },
});
