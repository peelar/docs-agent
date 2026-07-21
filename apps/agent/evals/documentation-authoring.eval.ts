import { defineEval } from "eve/evals";

export default defineEval({
  description: "Paige prepares, edits, and inspects documentation locally",
  tags: ["behavior", "documentation-workflow"],
  timeoutMs: 240_000,
  async test(t) {
    await t.send(
      "Prepare a local documentation change that adds paige-eval-local.md with exactly 'Local eval only.\\n'. Show me the changed path and review digest, but leave publishing for later.",
    );
    t.succeeded();
    t.noFailedActions();
    t.toolOrder([
      "documentation_workspace",
      "documentation_workspace",
      "documentation_workspace",
    ]);
    t.calledTool("documentation_workspace", {
      input: { action: "prepare" },
    });
    t.calledTool("documentation_workspace", {
      input: {
        action: "write",
        path: "paige-eval-local.md",
        content: "Local eval only.\n",
      },
    });
    t.calledTool("documentation_workspace", {
      input: { action: "inspect_diff" },
      output: (output) =>
        JSON.stringify(output).includes("paige-eval-local.md") &&
        JSON.stringify(output).includes("sha256:"),
    });
    t.notCalledTool("documentation_publish");
    t.messageIncludes("paige-eval-local.md");
  },
});
