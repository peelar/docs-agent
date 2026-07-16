import { defineEval } from "eve/evals";

export default defineEval({
  description: "Paige discovers configured Git repositories",
  tags: ["repository"],
  timeoutMs: 180_000,
  async test(t) {
    await t.send(
      "Use the repository_read catalog and briefly list the configured repositories.",
    );
    t.succeeded();
    t.noFailedActions();
    t.calledTool("repository_read", {
      input: { action: "catalog" },
      output: (output) =>
        JSON.stringify(output).includes("saleor-dashboard") &&
        JSON.stringify(output).includes("saleor-docs"),
    });
    t.messageIncludes("saleor-dashboard");
  },
});
