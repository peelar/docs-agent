import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";

export default defineEval({
  description: "Conflicting verified sources remain visibly unresolved",
  tags: ["behavior", "documentation-impact"],
  timeoutMs: 180_000,
  async test(t) {
    await t.send([
      "Assess the documentation impact, but do not inspect beyond these two verified sources.",
      "The release note says the new channel parameter is required for every request.",
      "The released GraphQL schema marks the same parameter optional, and existing requests without it still succeed.",
      "The current guide does not mention the parameter.",
    ].join("\n"));

    t.succeeded();
    t.noFailedActions();
    t.loadedSkill("assess-documentation-impact");
    t.maxToolCalls(1);
    t.check(
      t.reply,
      satisfies(
        (reply) => /conflict|contradict|inconsistent|disagree/i.test(String(reply)),
        "the evidence conflict is explicit",
      ),
    );
    t.check(
      t.reply,
      satisfies(
        (reply) => /can(?:not|'t) (?:decide|determine)|would(?: not|n't) (?:write|document)|before (?:deciding|documenting)|need to (?:confirm|resolve)|question needs an answer|uncertain|until .{0,30}resolved/i.test(String(reply)),
        "the response avoids an unsupported confident decision",
      ),
    );
    t.notCalledTool("repository_read");
    t.notCalledTool("web_fetch");
    t.notCalledTool("web_search");
  },
});
