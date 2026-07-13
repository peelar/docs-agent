import { fileURLToPath } from "node:url";

import { pruneLocalState } from "../src/local-state-pruning.ts";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

try {
  const result = await pruneLocalState({ repositoryRoot });

  console.log(JSON.stringify({
    pruned: true,
    ...result,
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
