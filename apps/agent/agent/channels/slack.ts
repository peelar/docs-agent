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

type SlackMessageBot = {
  onDirectMessage(
    handler: (thread: Thread, message: Message) => void | Promise<void>,
  ): void;
  onNewMention(
    handler: (thread: Thread, message: Message) => void | Promise<void>,
  ): void;
  onSubscribedMessage(
    handler: (thread: Thread, message: Message) => void | Promise<void>,
  ): void;
};

export function registerSlackMessages(
  slackMessageBot: SlackMessageBot,
  service: Pick<SlackChannelService, "handleMessage">,
): void {
  const handleMessage = async (
    thread: Thread,
    message: Message,
    responseMode: "always" | "when-needed" = "always",
  ) => {
    const result = await service.handleMessage(thread, message, responseMode);
    if (result.isErr()) throw result.error;
  };

  slackMessageBot.onDirectMessage((thread, message) =>
    handleMessage(thread, message)
  );
  slackMessageBot.onNewMention(async (thread, message) => {
    // A mention invites Paige into this conversation. Follow later messages,
    // but let the agent decide whether answering would help or add noise.
    await thread.subscribe();
    await handleMessage(thread, message);
  });
  slackMessageBot.onSubscribedMessage((thread, message) =>
    handleMessage(thread, message, "when-needed")
  );
}

registerSlackMessages(
  bot,
  new SlackChannelService(send),
);

export default channel;
