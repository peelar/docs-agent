import { defineTool } from "eve/tools";
import { z } from "zod";

import { repositoryInputSchema } from "../lib/repository-contract";
import { saveConfiguredRepositoryInput } from "../lib/repository-workflow-state";
import { repositoryActionRecordSchema } from "../lib/repository-materialization";
import { saveWorkingRepositorySetup } from "../lib/setup-state";
import { validateWorkingRepositorySetup } from "../lib/working-repository-lifecycle";

const outputSchema = z.object({
  configured: z.literal(true),
  repository: z.string(),
  ref: z.string(),
  docsRoot: z.string().optional(),
  sandboxPath: z.string(),
  watchedRepositories: z.number(),
  materialized: z.boolean(),
  actionProvenance: z.array(repositoryActionRecordSchema),
});

export default defineTool({
  description:
    "Validate and persist the working documentation repository setup without cloning it. The first working_repository operation materializes the configured checkout implicitly.",
  inputSchema: repositoryInputSchema,
  outputSchema,
  async execute(input, ctx) {
    const repositoryInput = repositoryInputSchema.parse(input);
    const actionProvenance = await validateWorkingRepositorySetup(repositoryInput, ctx.abortSignal);
    await saveConfiguredRepositoryInput(repositoryInput);
    await saveWorkingRepositorySetup(repositoryInput);
    const repository = repositoryInput.workingDocumentationRepository;

    return {
      configured: true as const,
      repository: repository.source.url,
      ref: repository.ref,
      docsRoot: repository.docsRoot,
      sandboxPath: repository.sandboxPath,
      watchedRepositories: repositoryInput.watchedRepositories.length,
      materialized: false,
      actionProvenance,
    };
  },
  toModelOutput(output) {
    return {
      type: "json",
      value: {
        configured: output.configured,
        repository: output.repository,
        ref: output.ref,
        docsRoot: output.docsRoot,
        sandboxPath: output.sandboxPath,
        watchedRepositories: output.watchedRepositories,
        materialized: output.materialized,
      },
    };
  },
});
