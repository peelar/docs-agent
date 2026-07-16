import { defineEval } from "eve/evals";

export default defineEval({
  description: "Paige lists and searches a configured repository",
  tags: ["repository"],
  timeoutMs: 180_000,
  async test(t) {
    await t.send(
      "Use repository_read list_files to find README.md in saleor-dashboard, then use repository_read search to find the phrase 'Saleor Dashboard' in that repository. Briefly report the matching path.",
    );
    t.succeeded();
    t.noFailedActions();
    t.calledTool("repository_read", {
      input: { action: "list_files", repositoryId: "saleor-dashboard" },
    });
    t.calledTool("repository_read", {
      input: {
        action: "search",
        repositoryId: "saleor-dashboard",
        query: "Saleor Dashboard",
      },
      output: (output) => JSON.stringify(output).includes("README.md"),
    });
    t.messageIncludes("README.md");
  },
});
