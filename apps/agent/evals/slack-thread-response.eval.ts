import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";

import {
  slackThreadFollowUpInstruction,
} from "../slack/service";

export default defineEval({
  description:
    "Paige decides whether an unmentioned message in a followed Slack thread needs a reply",
  tags: ["slack"],
  timeoutMs: 180_000,
  async test(t) {
    const continuation = await t.send({
      clientContext: [
        slackThreadFollowUpInstruction,
        "Conversation context: Paige asked whether the user wants to set up the documentation repositories now. The user's next message is their answer.",
      ],
      message: "yup!",
    });
    continuation.succeeded();
    t.check(
      continuation.message,
      satisfies(
        (message) =>
          typeof message === "string" && message.trim().length > 0,
        "Paige continues a conversation when the user answers her question",
      ),
    );

    const sideConversation = await t.newSession().send({
      clientContext: [
        slackThreadFollowUpInstruction,
        "Conversation context: Paige already answered the documentation question. Two teammates are now coordinating the release with each other.",
      ],
      message: "Thanks Alex, I'll handle the release after lunch.",
    });
    sideConversation.succeeded();
    t.check(
      sideConversation.message,
      satisfies(
        (message) => message === undefined,
        "Paige stays quiet during a human side conversation",
      ),
    );
  },
});
