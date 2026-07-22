import { defineAgent } from "eve";

export default defineAgent({
  build: {
    // These workspace packages are compiled first and traced into Eve's
    // runtime output instead of being rebundled as authored agent modules.
    externalDependencies: ["@paige/repositories", "@paige/sessions"],
  },
  model: process.env.EVE_GATEWAY_MODEL ?? "zai/glm-5.2",
});
