import { defineDynamic, defineInstructions } from "eve/instructions";

import { buildSetupInstructions, getSetupStatus } from "../lib/setup-state";

export default defineDynamic({
  events: {
    "turn.started": async () => {
      const status = await getSetupStatus();

      return defineInstructions({
        markdown: buildSetupInstructions(status),
      });
    },
  },
});
