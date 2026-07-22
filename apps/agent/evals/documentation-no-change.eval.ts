import { defineEval } from "eve/evals";

export default defineEval({
  description: "Paige reports an unchanged documentation workspace",
  tags: ["behavior", "documentation-workflow"],
  timeoutMs: 240_000,
  async test(t) {
    await t.send(
      "Open the documentation editor and check whether it already has changes. Do not edit or publish anything; briefly report the result.",
    );
    t.succeeded();
    t.noFailedActions();
    t.calledTool("documentation_edit", {
      input: { action: "open" },
    });
    t.calledTool("documentation_edit", {
      input: { action: "review" },
      output: (output) =>
        JSON.stringify(output).includes('"hasChanges":false') &&
        JSON.stringify(output).includes('"changedFiles":[]'),
    });
    t.notCalledTool("documentation_publish");
  },
});
