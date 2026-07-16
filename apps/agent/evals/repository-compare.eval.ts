import { defineEval } from "eve/evals";

export default defineEval({
  description: "Paige compares two repository revisions in Git",
  tags: ["repository"],
  timeoutMs: 180_000,
  async test(t) {
    await t.send(
      "Use the repository compare action to compare main with main in saleor-core. Briefly confirm whether the changed-path list is empty.",
    );
    t.succeeded();
    t.noFailedActions();
    t.calledTool("repository", {
      input: {
        action: "compare",
        repositoryId: "saleor-core",
        baseRevision: "main",
        headRevision: "main",
      },
    });
  },
});
