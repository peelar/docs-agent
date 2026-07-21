import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";

import { hasAtMostWords } from "./assertions";

export default defineEval({
  description: "An accurate guide with a useful clarification is classified as optional",
  tags: ["behavior", "documentation-impact"],
  timeoutMs: 180_000,
  async test(t) {
    await t.send([
      "Assess the documentation impact from this verified evidence.",
      "A stock webhook now also fires after order cancellation and returns. Its event type, payload, setup, and delivery rules did not change.",
      "The guide already says the webhook fires whenever variant stock quantity changes.",
      "A short list of common causes could help readers discover that order activity changes stock.",
    ].join("\n"));

    t.succeeded();
    t.noFailedActions();
    t.loadedSkill("assess-documentation-impact");
    t.maxToolCalls(1);
    t.check(
      t.reply,
      satisfies(
        (reply) => /optional|useful but not required|could (?:clarify|improve)/i.test(String(reply)),
        "decision class is optional improvement",
      ),
    );
    t.check(
      t.reply,
      satisfies(
        (reply) => /already|accurate|whenever|did not change/i.test(String(reply)),
        "decision distinguishes accurate docs from discoverability",
      ),
    );
    t.check(t.reply, satisfies((reply) => hasAtMostWords(reply, 160), "concise teammate response")).soft();
  },
});
