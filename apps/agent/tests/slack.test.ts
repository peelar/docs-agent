import assert from "node:assert/strict";

import type { Message, Thread } from "chat";
import { test } from "vitest";

import { postSlackAuthorizationRequired } from "../slack/authorization";
import { registerSlackMessages } from "../slack/messages";
import {
  extractSlackWorkspaceId,
  SlackChannelService,
} from "../slack/service";

test("Slack follows mentioned threads and continues every later message", async () => {
  let directMessageHandler:
    | ((thread: Thread, message: Message) => void | Promise<void>)
    | undefined;
  let mentionHandler:
    | ((thread: Thread, message: Message) => void | Promise<void>)
    | undefined;
  let subscribedMessageHandler:
    | ((thread: Thread, message: Message) => void | Promise<void>)
    | undefined;
  const bot = {
    onDirectMessage(candidate: NonNullable<typeof directMessageHandler>) {
      directMessageHandler = candidate;
    },
    onNewMention(candidate: NonNullable<typeof mentionHandler>) {
      mentionHandler = candidate;
    },
    onSubscribedMessage(
      candidate: NonNullable<typeof subscribedMessageHandler>,
    ) {
      subscribedMessageHandler = candidate;
    },
  };
  const calls: Array<{
    message: unknown;
    thread: Thread;
    auth: {
      authenticator: "slack";
      principalType: "user";
      principalId: string;
      attributes: { slackWorkspaceId: string };
    };
  }> = [];
  const service = new SlackChannelService(
    async (message, { thread, auth }) => {
      calls.push({ message, thread, auth });
      return undefined;
    },
  );
  registerSlackMessages(bot, service);

  assert.ok(directMessageHandler, "the direct-message handler is registered");
  assert.ok(mentionHandler, "the mention handler is registered");
  assert.ok(
    subscribedMessageHandler,
    "the subscribed-thread handler is registered",
  );
  const directMessageThread = { id: "slack:D123:" } as Thread;
  await Reflect.apply(directMessageHandler, undefined, [
    directMessageThread,
    {
      text: "Hello Paige",
      raw: { team_id: "T123" },
      author: { userId: "U123" },
    } as Message,
    { sdk: "channel argument" },
    { sdk: "message context" },
  ]);
  let subscriptionCount = 0;
  const mentionThread = {
    id: "slack:C123:1234.5678",
    async subscribe() {
      subscriptionCount += 1;
    },
  } as Thread;
  await mentionHandler(mentionThread, {
    text: "<@UPAIGE> can you help?",
    raw: { team_id: "T123" },
    author: { userId: "U456" },
  } as Message);
  await subscribedMessageHandler(mentionThread, {
    text: "yup!",
    raw: { team_id: "T123" },
    author: { userId: "U456" },
  } as Message);
  assert.equal(subscriptionCount, 1);
  assert.deepEqual(calls, [
    {
      message: "Hello Paige",
      thread: directMessageThread,
      auth: {
        authenticator: "slack",
        principalType: "user",
        principalId: "U123",
        attributes: { slackWorkspaceId: "T123" },
      },
    },
    {
      message: "<@UPAIGE> can you help?",
      thread: mentionThread,
      auth: {
        authenticator: "slack",
        principalType: "user",
        principalId: "U456",
        attributes: { slackWorkspaceId: "T123" },
      },
    },
    {
      message: "yup!",
      thread: mentionThread,
      auth: {
        authenticator: "slack",
        principalType: "user",
        principalId: "U456",
        attributes: { slackWorkspaceId: "T123" },
      },
    },
  ]);
});

test("Slack workspace identity fails closed when the verified payload omits it", () => {
  const result = extractSlackWorkspaceId({ raw: {} } as Message);
  assert.equal(result.isErr(), true);
  if (result.isErr()) {
    assert.equal(result.error.code, "SLACK_INVALID_MESSAGE");
    assert.match(result.error.message, /verified workspace ID/);
  }
});

test("Slack maps Eve dispatch failures into its channel contract", async () => {
  const service = new SlackChannelService(
    async () => {
      throw new Error("Eve is unavailable");
    },
  );

  const result = await service.handleMessage(
    { id: "slack:D123:" } as Thread,
    {
      text: "Hello Paige",
      raw: { team_id: "T123" },
      author: { userId: "U123" },
    } as Message,
  );

  assert.equal(result.isErr(), true);
  if (result.isErr()) {
    assert.equal(result.error.code, "SLACK_SESSION_DISPATCH_FAILED");
  }
});

test("Slack sends Eve authorization challenges to direct messages", async () => {
  const posts: Array<{ markdown: string }> = [];

  await postSlackAuthorizationRequired({
    description: "Connect with GitHub to continue.",
    authorization: {
      url: "https://example.com/authorize",
      userCode: "ABCD-1234",
    },
  }, {
    isDM: true,
    async post(message) {
      posts.push(message);
      return undefined;
    },
  });

  assert.deepEqual(posts, [{
    markdown: [
      "Connect with GitHub to continue.",
      "https://example.com/authorize",
      "Code: `ABCD-1234`",
    ].join("\n\n"),
  }]);
});

test("Slack never exposes authorization challenges outside direct messages", async () => {
  await assert.rejects(
    postSlackAuthorizationRequired({
      description: "Connect with GitHub to continue.",
      authorization: { url: "https://example.com/authorize" },
    }, {
      isDM: false,
      async post() {
        throw new Error("post must not be called");
      },
    }),
    /outside a direct message/,
  );
});
