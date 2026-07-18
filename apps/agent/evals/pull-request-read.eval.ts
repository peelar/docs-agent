import { defineEval } from "eve/evals";

const pullRequestNumber = 6744;
const headCommitSha = "723e17e5e789d8824d89ced25cf36ccc3714d919";

export default defineEval({
  description:
    "Paige reads pull-request details, files, and discussion separately from source files",
  tags: ["repository", "pull-request"],
  timeoutMs: 180_000,
  async test(t) {
    await t.send(
      "Read saleor-dashboard pull request 6744, list its changed files, and list its conversation comments. Then use repository_read to read the first five lines of .changeset/tough-candies-dig.md at the pull request's exact head commit. Briefly summarize the pull request and discussion. Do not inspect CI/CD checks.",
    );
    t.succeeded();
    t.noFailedActions();
    t.calledTool("pull_request_read", {
      input: {
        action: "read",
        repositoryId: "saleor-dashboard",
        pullRequestNumber,
      },
      output: (output) => JSON.stringify(output).includes(headCommitSha),
    });
    t.calledTool("pull_request_read", {
      input: {
        action: "list_files",
        repositoryId: "saleor-dashboard",
        pullRequestNumber,
      },
      output: (output) =>
        JSON.stringify(output).includes(".changeset/tough-candies-dig.md"),
    });
    t.calledTool("pull_request_read", {
      input: {
        action: "list_comments",
        repositoryId: "saleor-dashboard",
        pullRequestNumber,
        commentKind: "conversation",
      },
    });
    t.calledTool("repository_read", {
      input: {
        action: "read",
        repositoryId: "saleor-dashboard",
        ref: headCommitSha,
        path: ".changeset/tough-candies-dig.md",
        startLine: 1,
        endLine: 5,
      },
    });
    t.notCalledTool("documentation_publish");
  },
});
