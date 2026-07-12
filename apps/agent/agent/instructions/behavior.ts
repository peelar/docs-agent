import { defineDynamic, defineInstructions } from "eve/instructions";

import {
  buildBehaviorInstructions,
  readBehaviorSettings,
} from "@docs-agent/control-plane/agent";

export default defineDynamic({
  events: {
    "turn.started": async () => {
      const state = await readBehaviorSettings();
      const markdown = buildBehaviorInstructions(state.settings);
      return markdown === null ? null : defineInstructions({ markdown });
    },
  },
});
