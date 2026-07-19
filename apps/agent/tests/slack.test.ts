import assert from "node:assert/strict";

import type { Message, Thread } from "chat";
import { test } from "vitest";

import { registerDirectMessages } from "../agent/channels/slack";
import { postSlackAuthorizationRequired } from "../slack/authorization";
import {
  extractSlackWorkspaceId,
  SlackChannelService,
} from "../slack/service";

test("Slack registers only the direct-message path", async () => {
  let handler:
    | ((thread: Thread, message: Message) => void | Promise<void>)
    | undefined;
  const bot = {
    onDirectMessage(candidate: NonNullable<typeof handler>) {
      handler = candidate;
    },
  };
  const calls: Array<{
    message: string;
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
  registerDirectMessages(bot, service);

  assert.ok(handler, "the direct-message handler is registered");
  const thread = { id: "slack:D123:" } as Thread;
  await handler(thread, {
    text: "Hello Paige",
    raw: { team_id: "T123" },
    author: { userId: "U123" },
  } as Message);
  assert.deepEqual(calls, [{
    message: "Hello Paige",
    thread,
    auth: {
      authenticator: "slack",
      principalType: "user",
      principalId: "U123",
      attributes: { slackWorkspaceId: "T123" },
    },
  }]);
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

  const result = await service.handleDirectMessage(
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
