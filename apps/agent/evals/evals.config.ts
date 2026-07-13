import { defineEvalConfig } from "eve/evals";

import { ControlPlaneReporter } from "./control-plane-reporter";

export default defineEvalConfig({
  maxConcurrency: 1,
  timeoutMs: 900_000,
  reporters: [ControlPlaneReporter({ suite: "docs-agent" })],
});
