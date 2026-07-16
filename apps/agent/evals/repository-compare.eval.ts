import { defineEval } from "eve/evals";

export default defineEval({
  description: "Paige compares files at two Git refs",
  tags: ["repository"],
  timeoutMs: 180_000,
  async test(t) {
    await t.send(
      "Use the repository_read compare action to compare main with main in saleor-core. Briefly confirm whether the changed-path list is empty.",
    );
    t.succeeded();
    t.noFailedActions();
    t.calledTool("repository_read", {
      input: {
        action: "compare",
        repositoryId: "saleor-core",
        baseRef: "main",
        headRef: "main",
      },
    });
  },
});
