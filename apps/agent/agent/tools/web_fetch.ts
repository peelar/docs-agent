import { defineDynamic, defineTool } from "eve/tools";
import { webFetch } from "eve/tools/defaults";

import {
  requireFrameworkKnowledgeReadExecution,
  resolveFrameworkKnowledgeReadVisibility,
} from "../lib/capability-resolution";

export default defineDynamic({
  events: {
    "step.started": async (event, context) => {
      if (!(await resolveFrameworkKnowledgeReadVisibility(event, context))) return null;
      return defineTool({
        ...webFetch,
        async execute(input, ctx) {
          await requireFrameworkKnowledgeReadExecution(ctx);
          if (webFetch.execute === undefined) {
            throw new Error("Eve's framework web_fetch executor is unavailable.");
          }
          return webFetch.execute(input, ctx);
        },
      });
    },
  },
});
