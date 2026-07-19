import { createSlackAdapter } from "@chat-adapter/slack";
import { connectSlackAdapter } from "@vercel/connect/chat";
import type { Message, Thread } from "chat";
import { chatSdkChannel } from "eve/channels/chat-sdk";

import { postSlackAuthorizationRequired } from "../../slack/authorization";
import { SlackChannelService } from "../../slack/service";
import { createSlackState } from "../../slack/state";

const connector = process.env.PAIGE_SLACK_CONNECTOR?.trim() || "slack/paige";

export const { bot, channel, send } = chatSdkChannel({
  adapters: {
    slack: createSlackAdapter(connectSlackAdapter(connector)),
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

type DirectMessageBot = {
  onDirectMessage(
    handler: (thread: Thread, message: Message) => void | Promise<void>,
  ): void;
};

export function registerDirectMessages(
  directMessageBot: DirectMessageBot,
  service: Pick<SlackChannelService, "handleDirectMessage">,
): void {
  directMessageBot.onDirectMessage(async (thread, message) => {
    const result = await service.handleDirectMessage(thread, message);
    if (result.isErr()) throw result.error;
  });
}

registerDirectMessages(
  bot,
  new SlackChannelService(send),
);

export default channel;
