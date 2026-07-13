import { defineTool } from "eve/tools";
import { z } from "zod";

import { searchRepository } from "../lib/repository-operations";
import { saveRepositoryWorkflowState } from "../lib/repository-workflow-state";
import { loadOrMaterializeRepositoryWorkflowState } from "../lib/working-repository-lifecycle";

export default defineTool({
  description:
    "Search the materialized working documentation repository through the policy-aware repository runner.",
  inputSchema: z.object({
    query: z.string().trim().min(1),
  }),
  outputSchema: z.object({
    matches: z.string(),
  }),
  async execute({ query }, ctx) {
    const state = await loadOrMaterializeRepositoryWorkflowState(ctx);
    const matches = await searchRepository(
      ctx,
      state.repositoryInput.workingDocumentationRepository,
      query,
      state.actionProvenance,
    );
    await saveRepositoryWorkflowState(state);
    return { matches };
  },
});
