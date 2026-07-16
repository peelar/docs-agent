import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";

import { DocumentationRepositoryService } from "../../repositories/documentation/service";

export const documentationPublishToolInputSchema = z.object({
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  branch: z.string().min(1).max(120).startsWith("paige/"),
  commitMessage: z.string().min(1).max(200),
  pullRequestTitle: z.string().min(1).max(200),
  pullRequestBody: z.string().max(20_000),
}).strict();

export default defineTool({
  description:
    "Publish one already-inspected documentation diff. Every call requires explicit human approval. Pass the exact inspect_diff digest plus approved paige/ branch, commit message, and draft pull request title/body. The call fails closed if workspace bytes, HEAD, remote base, branch, or metadata drifted.",
  inputSchema: documentationPublishToolInputSchema,
  approval: always(),
  async execute(input, ctx) {
    return await new DocumentationRepositoryService(ctx).writeback(input).match(
      (output) => output,
      raiseRepositoryError,
    );
  },
});

function raiseRepositoryError(error: Error): never {
  throw error;
}
