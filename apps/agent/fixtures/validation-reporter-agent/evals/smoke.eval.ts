import { defineEval } from "eve/evals";

export default defineEval({
  description: "Records one real Eve eval without copying its prompt or output",
  async test(t) {
    const turn = await t.send("Private reporter fixture prompt that must stay in Eve.");
    turn.succeeded();
    turn.messageIncludes("private fixture request completed");
  },
});
