import { defineTool } from "eve/tools";
import { z } from "zod";

import { repositoryInputSchema } from "../lib/repository-contract.js";
import {
  materializeWorkingRepository,
  type RepositoryActionRecord,
  repositoryActionRecordSchema,
  repositoryMaterializationSchema,
} from "../lib/repository-workflow.js";

const outputSchema = z.object({
  configured: z.literal(true),
  materialization: repositoryMaterializationSchema,
  actionProvenance: z.array(repositoryActionRecordSchema),
});

export default defineTool({
  description:
    "Configure the session working documentation repository and materialize it in the sandbox. Defaults the ref to main and detects the docs root when omitted.",
  inputSchema: repositoryInputSchema,
  outputSchema,
  async execute(input, ctx) {
    const actionProvenance: RepositoryActionRecord[] = [];
    const materialization = await materializeWorkingRepository(ctx, input, actionProvenance);

    return {
      configured: true as const,
      materialization,
      actionProvenance,
    };
  },
  toModelOutput(output) {
    return {
      type: "json",
      value: {
        configured: output.configured,
        repository: output.materialization.repositoryUrl,
        ref: output.materialization.requestedRef,
        resolvedCommit: output.materialization.resolvedCommit,
        docsRoot: output.materialization.docsRoot,
        sandboxPath: output.materialization.sandboxPath,
      },
    };
  },
});
