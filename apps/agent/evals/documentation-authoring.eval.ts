import { defineEval } from "eve/evals";

export default defineEval({
  description: "Paige opens, edits, and reviews documentation locally",
  tags: ["behavior", "documentation-workflow"],
  timeoutMs: 240_000,
  async test(t) {
    await t.send(
      "Open the documentation editor and add paige-eval-local.md with exactly 'Local eval only.\\n'. Show me the changed path and review ID, but leave publishing for later.",
    );
    t.succeeded();
    t.noFailedActions();
    t.toolOrder([
      "documentation_edit",
      "documentation_edit",
      "documentation_edit",
    ]);
    t.calledTool("documentation_edit", {
      input: { action: "open" },
    });
    t.calledTool("documentation_edit", {
      input: {
        action: "write",
        path: "paige-eval-local.md",
        content: "Local eval only.\n",
      },
    });
    t.calledTool("documentation_edit", {
      input: { action: "review" },
      output: (output) =>
        JSON.stringify(output).includes("paige-eval-local.md") &&
        JSON.stringify(output).includes("sha256:"),
    });
    t.notCalledTool("documentation_publish");
    t.messageIncludes("paige-eval-local.md");
  },
});
