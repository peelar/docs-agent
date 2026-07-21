import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";

export default defineEval({
  description: "A vague bug report produces an explicit evidence gap",
  tags: ["behavior", "documentation-impact"],
  timeoutMs: 180_000,
  async test(t) {
    await t.send([
      "A teammate says checkout is sometimes wrong after yesterday's release and asks whether docs need updating.",
      "There is no reproduction, change description, expected behavior, current behavior, or relevant documentation excerpt yet.",
      "Tell me what conclusion we can support and what evidence is missing. Do not inspect anything yet.",
    ].join("\n"));

    t.succeeded();
    t.noFailedActions();
    t.loadedSkill("assess-documentation-impact").soft();
    t.maxToolCalls(1);
    t.check(
      t.reply,
      satisfies(
        (reply) => /insufficient|not enough|cannot (?:decide|determine)|uncertain|no .{0,30}conclusion.{0,20}support/i.test(String(reply)),
        "decision class is insufficient evidence",
      ),
    );
    t.check(
      t.reply,
      satisfies(
        (reply) => /repro|expected|actual|change|documentation|docs/i.test(String(reply)),
        "missing evidence is identified",
      ),
    );
    t.notCalledTool("repository_read");
    t.notCalledTool("pull_request_read");
    t.notCalledTool("web_fetch");
    t.notCalledTool("web_search");
  },
});
