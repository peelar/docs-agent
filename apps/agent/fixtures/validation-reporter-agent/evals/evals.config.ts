import { defineEvalConfig } from "eve/evals";

import { ControlPlaneReporter } from "../../../evals/control-plane-reporter.js";

export default defineEvalConfig({
  maxConcurrency: 1,
  reporters: [ControlPlaneReporter({ suite: "validation-reporter-fixture" })],
});
