import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";

import { slackAdapter } from "../../slack/adapter";
import {
  claimSlackProgressUpdate,
  elapsedSlackTurnDescription,
  postSlackProgressUpdate,
  releaseSlackProgressUpdate,
  slackProgressMessageSchema,
  slackProgressTurnState,
} from "../../slack/progress";
import { slackReactionTurnState } from "../../slack/reactions";

const shareProgressInputSchema = z.object({
  message: slackProgressMessageSchema.describe(
    "A concise, useful update with a concrete interim finding and what you are checking next. Do not merely say that you are still working.",
  ),
}).strict();

export default defineDynamic({
  events: {
    "step.started": (_event, ctx) => {
      if (ctx.channel.kind !== "channel:slack") return null;

      const progress = slackProgressTurnState.get();
      const target = slackReactionTurnState.get().target;
      if (
        progress.turnId === null || progress.updateSent || target === null
      ) return null;

      const turnId = progress.turnId;
      const elapsed = elapsedSlackTurnDescription(progress);
      return defineTool({
        description:
          `This Slack turn has been running for about ${elapsed}. Share one optional mid-way update when the user has waited longer than this task reasonably suggested and meaningful work still remains. Use your judgment: do not call this merely because time passed or to announce that you are working. Only call after you have a concrete interim finding, and say what you learned plus what you are checking next.`,
        inputSchema: shareProgressInputSchema,
        async execute({ message }) {
          slackProgressTurnState.update((current) =>
            claimSlackProgressUpdate(current, turnId)
          );
          try {
            await postSlackProgressUpdate(slackAdapter, target, message);
          } catch (error) {
            slackProgressTurnState.update((current) =>
              releaseSlackProgressUpdate(current, turnId)
            );
            throw error;
          }
          return { shared: true };
        },
        toModelOutput() {
          return {
            type: "text",
            value:
              "The user received the progress update. Continue the investigation without repeating it in the final answer.",
          };
        },
      });
    },
  },
});
