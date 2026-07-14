import { defineHook } from "eve/hooks";

import { handleWatchTerminalResult } from "../lib/watch-runtime";

export default defineHook({
  events: {
    async "turn.completed"(_event, context) {
      await handleWatchTerminalResult(context.session, "succeeded");
    },
    async "turn.failed"(event, context) {
      await handleWatchTerminalResult(context.session, "failed", event.data.code);
    },
  },
});
