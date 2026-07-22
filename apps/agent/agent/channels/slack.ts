import { chatSdkChannel } from "eve/channels/chat-sdk";

import { slackAdapter } from "../../slack/adapter";
import { postSlackAuthorizationRequired } from "../../slack/authorization";
import { registerSlackMessages } from "../../slack/messages";
import {
  beginSlackProgressTurn,
  slackProgressTurnState,
} from "../../slack/progress";
import {
  beginSlackReactionTurn,
  clearSlackWorkingReaction,
} from "../../slack/reactions";
import { markdownReportFile, pendingSlackReport } from "../../slack/report";
import { SlackChannelService } from "../../slack/service";
import { createSlackState } from "../../slack/state";

export const { bot, channel, send } = chatSdkChannel({
  adapters: {
    // Slack calls Paige directly so Connect cannot filter thread replies.
    // Keep Connect only for rotating outbound bot credentials.
    slack: slackAdapter,
  },
  events: {
    "session.waiting": async (_event, context) => {
      await clearSlackWorkingReaction(context.thread?.adapter ?? null);
    },
    "turn.completed": async (_event, context) => {
      await clearSlackWorkingReaction(context.thread?.adapter ?? null);
    },
    "turn.started": (event, context) => {
      beginSlackReactionTurn(context.state.thread);
      slackProgressTurnState.update(() =>
        beginSlackProgressTurn(event.turnId)
      );
    },
    "authorization.required": async (event, context) => {
      await clearSlackWorkingReaction(context.thread?.adapter ?? null);
      await postSlackAuthorizationRequired(event, context.thread);
    },
    "message.completed": async (event, context, ctx) => {
      if (event.finishReason === "tool-calls") return;
      if (!context.thread) return;

      const report = await pendingSlackReport.get();
      if (report?.turnSequence !== ctx.session.turn.sequence) {
        if (!event.message) return;
        await context.thread.post({ markdown: event.message });
        return;
      }

      // The concise answer and its optional evidence must arrive as one Slack
      // message so the attachment never displaces or precedes the answer.
      await context.thread.post({
        files: [markdownReportFile(report)],
        markdown: report.answer,
      });
      await pendingSlackReport.update((current) =>
        current?.turnSequence === report.turnSequence ? null : current
      );
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
