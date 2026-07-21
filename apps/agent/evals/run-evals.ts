import { runEvalSuite } from "./runner";
import type { EvalSuiteName } from "./runner";

const suite = process.argv[2];
if (!isEvalSuiteName(suite)) {
  process.stderr.write(
    "Usage: tsx evals/run-evals.ts <behavior|safety|integration|full>\n",
  );
  process.exitCode = 2;
} else {
  process.exitCode = await runEvalSuite(suite);
}

function isEvalSuiteName(value: string | undefined): value is EvalSuiteName {
  return value === "behavior" || value === "safety" ||
    value === "integration" || value === "full";
}
