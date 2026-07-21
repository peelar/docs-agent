import { defineEval } from "eve/evals";

import { repositoryEvalFixture } from "./repository-fixture";

const { number: pullRequestNumber, headSha: headCommitSha } =
  repositoryEvalFixture.pullRequest;

export default defineEval({
  description:
    "Paige reads pull-request details, files, and discussion separately from source files",
  tags: ["integration", "repository", "pull-request"],
  timeoutMs: 180_000,
  async test(t) {
    await t.send(
      `Read pull request ${pullRequestNumber} in ${repositoryEvalFixture.repositories.dashboard.id}, including its changed files and conversation comments. Read the first five lines of ${repositoryEvalFixture.pullRequest.changedPath} at the exact head commit. Briefly summarize the change and discussion. Do not inspect CI/CD checks.`,
    );
    t.succeeded();
    t.noFailedActions();
    t.calledTool("pull_request_read", {
      input: {
        action: "read",
        repositoryId: repositoryEvalFixture.repositories.dashboard.id,
        pullRequestNumber,
      },
      output: (output) => JSON.stringify(output).includes(headCommitSha),
    });
    t.calledTool("pull_request_read", {
      input: {
        action: "list_files",
        repositoryId: repositoryEvalFixture.repositories.dashboard.id,
        pullRequestNumber,
      },
      output: (output) =>
        JSON.stringify(output).includes(repositoryEvalFixture.pullRequest.changedPath),
    });
    t.calledTool("pull_request_read", {
      input: {
        action: "list_comments",
        repositoryId: repositoryEvalFixture.repositories.dashboard.id,
        pullRequestNumber,
        commentKind: "conversation",
      },
    });
    t.calledTool("repository_read", {
      input: {
        action: "read",
        repositoryId: repositoryEvalFixture.repositories.dashboard.id,
        ref: headCommitSha,
        path: repositoryEvalFixture.pullRequest.changedPath,
        startLine: 1,
        endLine: 5,
      },
    });
    t.notCalledTool("documentation_publish");
  },
});
