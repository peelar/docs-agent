import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";

export default defineEval({
  description: "Paige answers a greeting briefly and without tools",
  tags: ["behavior", "smoke"],
  timeoutMs: 180_000,
  async test(t) {
    await t.send("Hello Paige. Reply with a short, friendly greeting.");
    t.succeeded();
    t.usedNoTools();
    t.check(
      t.reply,
      satisfies(
        (reply) =>
          typeof reply === "string" &&
          reply.trim().split(/\s+/).length <= 30,
        "Paige returns at most 30 words",
      ),
    );
  },
});
