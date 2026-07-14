import { defineDynamic, defineTool } from "eve/tools";
import { webSearch } from "eve/tools/defaults";

import { resolveFrameworkKnowledgeReadVisibility } from "../lib/capability-resolution";

const { execute: _providerManagedStub, ...providerManagedWebSearch } = webSearch;

export default defineDynamic({
  events: {
    "step.started": async (event, context) => {
      if (!(await resolveFrameworkKnowledgeReadVisibility(event, context))) return null;
      // Eve injects the provider implementation only when this named descriptor
      // has no local execute. Its public authoring type does not expose that
      // framework-only shape, so retain the installed framework contract here.
      return defineTool(providerManagedWebSearch as never);
    },
  },
});
