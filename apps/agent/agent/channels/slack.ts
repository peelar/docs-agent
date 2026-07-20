import { createSlackAdapter } from "@chat-adapter/slack";
import { connectSlackAdapter } from "@vercel/connect/chat";
import { chatSdkChannel } from "eve/channels/chat-sdk";

import { postSlackAuthorizationRequired } from "../../slack/authorization";
import { registerSlackMessages } from "../../slack/messages";
import { SlackChannelService } from "../../slack/service";
import { createSlackState } from "../../slack/state";

const connector = process.env.PAIGE_SLACK_CONNECTOR?.trim() || "slack/paige";
const signingSecret = process.env.PAIGE_SLACK_SIGNING_SECRET?.trim();
if (!signingSecret) {
  throw new Error("PAIGE_SLACK_SIGNING_SECRET is required.");
}
const { botToken } = connectSlackAdapter(connector);

export const { bot, channel, send } = chatSdkChannel({
  adapters: {
    // Slack calls Paige directly so Connect cannot filter thread replies.
    // Keep Connect only for rotating outbound bot credentials.
    slack: createSlackAdapter({ botToken, signingSecret }),
  },
  events: {
    "authorization.required": async (event, context) => {
      await postSlackAuthorizationRequired(event, context.thread);
    },
  },
  state: createSlackState(),
  streaming: false,
  userName: "Paige",
});

registerSlackMessages(
  bot,
  new SlackChannelService(send),
);

export default channel;
