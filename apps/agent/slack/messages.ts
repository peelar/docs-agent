import type { Message, Thread } from "chat";

import type { SlackChannelService } from "./service";

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
  ) => {
    const result = await service.handleMessage(thread, message);
    if (result.isErr()) throw result.error;
  };

  slackMessageBot.onDirectMessage((thread, message) =>
    handleMessage(thread, message)
  );
  slackMessageBot.onNewMention(async (thread, message) => {
    // A mention invites Paige into this conversation. Subscribe before the
    // first reply so every later message continues the same conversation.
    await thread.subscribe();
    await handleMessage(thread, message);
  });
  slackMessageBot.onSubscribedMessage((thread, message) =>
    handleMessage(thread, message)
  );
}
