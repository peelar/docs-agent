import { defineEval } from "eve/evals";

export default defineEval({
  description: "Paige reads files at a configured repository ref",
  tags: ["repository"],
  timeoutMs: 180_000,
  async test(t) {
    await t.send(
      "Use repository_read to read the first five lines of README.md from saleor-dashboard. Briefly confirm the file was readable.",
    );
    t.succeeded();
    t.noFailedActions();
    t.calledTool("repository_read", {
      input: { action: "read", repositoryId: "saleor-dashboard", path: "README.md" },
    });
  },
});
