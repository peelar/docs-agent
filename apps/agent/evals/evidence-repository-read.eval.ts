import { defineEval } from "eve/evals";

export default defineEval({
  description: "Paige reads a configured repository revision",
  tags: ["repository"],
  timeoutMs: 180_000,
  async test(t) {
    await t.send(
      "Use the repository tool to read the first five lines of README.md from saleor-dashboard. Briefly confirm the file was readable.",
    );
    t.succeeded();
    t.noFailedActions();
    t.calledTool("repository", {
      input: { action: "read", repositoryId: "saleor-dashboard", path: "README.md" },
    });
  },
});
