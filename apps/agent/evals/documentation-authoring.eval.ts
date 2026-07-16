import { defineEval } from "eve/evals";

export default defineEval({
  description: "Paige prepares, edits, and inspects documentation locally",
  tags: ["documentation"],
  timeoutMs: 240_000,
  async test(t) {
    await t.send(
      "Use documentation_draft to prepare the documentation repository, write paige-eval-local.md with exactly 'Local eval only.\\n', and inspect the diff. Report the changed path and digest. Do not call documentation_publish.",
    );
    t.succeeded();
    t.noFailedActions();
    t.toolOrder([
      "documentation_draft",
      "documentation_draft",
      "documentation_draft",
    ]);
    t.calledTool("documentation_draft", {
      input: { action: "prepare" },
    });
    t.calledTool("documentation_draft", {
      input: {
        action: "write",
        path: "paige-eval-local.md",
        content: "Local eval only.\n",
      },
    });
    t.calledTool("documentation_draft", {
      input: { action: "inspect_diff" },
      output: (output) =>
        JSON.stringify(output).includes("paige-eval-local.md") &&
        JSON.stringify(output).includes("sha256:"),
    });
    t.notCalledTool("documentation_publish");
    t.messageIncludes("paige-eval-local.md");
  },
});
