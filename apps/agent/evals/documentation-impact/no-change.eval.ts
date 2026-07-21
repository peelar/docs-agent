import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";

import { hasAtMostWords } from "./assertions";

export default defineEval({
  description: "An internal refactor with unchanged behavior is classified as no change",
  tags: ["behavior", "documentation-impact"],
  timeoutMs: 180_000,
  async test(t) {
    await t.send([
      "Should we update documentation for this change? The evidence is verified and complete.",
      "The checkout tax calculation was moved from one internal module to three smaller modules.",
      "Inputs, outputs, errors, configuration, and observable checkout behavior are unchanged.",
      "The current tax guide describes only the observable behavior and remains accurate.",
    ].join("\n"));

    t.succeeded();
    t.noFailedActions();
    t.loadedSkill("assess-documentation-impact");
    t.maxToolCalls(1);
    t.check(
      t.reply,
      satisfies(
        (reply) => /no (?:documentation|docs) (?:change|update).{0,20}(?:needed|required)|(?:documentation|docs).{0,20}not (?:needed|required)/i.test(String(reply)),
        "decision class is no documentation change",
      ),
    );
    t.check(
      t.reply,
      satisfies(
        (reply) => /unchanged|remains accurate|same (?:behavior|inputs|outputs)/i.test(String(reply)),
        "decision is grounded in unchanged behavior",
      ),
    );
    t.check(t.reply, satisfies((reply) => hasAtMostWords(reply, 150), "concise teammate response")).soft();
  },
});
