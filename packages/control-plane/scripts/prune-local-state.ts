import { fileURLToPath } from "node:url";

import {
  inspectLocalGitState,
  pruneLocalState,
} from "../src/local-state-pruning.ts";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

try {
  const result = await pruneLocalState({ repositoryRoot });
  const git = inspectLocalGitState(repositoryRoot);

  console.log(JSON.stringify({
    pruned: true,
    ...result,
    git,
  }, null, 2));

  if (!git.clean || git.activeOperations.length > 0) process.exitCode = 2;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
