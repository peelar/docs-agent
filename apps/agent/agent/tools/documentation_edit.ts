import { defineTool } from "eve/tools";
import { z } from "zod";

import { DocumentationActions } from "../../repositories/documentation/actions";

const actionInputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("open") }),
  z.object({
    action: z.literal("list_files"),
    pathPrefix: z.string().default("."),
    limit: z.number().int().min(1).max(200).default(100),
  }),
  z.object({
    action: z.literal("search"),
    query: z.string().min(1).max(500),
    pathPrefix: z.string().default("."),
    limit: z.number().int().min(1).max(100).default(50),
  }),
  z.object({
    action: z.literal("read"),
    path: z.string().min(1),
    startLine: z.number().int().positive().default(1),
    endLine: z.number().int().positive().optional(),
    maxCharacters: z.number().int().min(1).max(24_000).default(24_000),
  }),
  z.object({
    action: z.literal("write"),
    path: z.string().min(1),
    content: z.string().max(200_000),
  }),
  z.object({
    action: z.literal("remove"),
    path: z.string().min(1),
  }),
  z.object({ action: z.literal("review") }),
]);

export const documentationEditToolInputSchema = z.object({
  action: z.enum([
    "open",
    "list_files",
    "search",
    "read",
    "write",
    "remove",
    "review",
  ]),
  pathPrefix: z.string().optional(),
  limit: z.number().int().positive().optional(),
  query: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  content: z.string().optional(),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  maxCharacters: z.number().int().positive().optional(),
}).strict().pipe(actionInputSchema);

export default defineTool({
  description:
    "Edit Paige's configured documentation repository without publishing. Use open first, then bounded list/search/read/write/remove actions, and review to present the complete patch and review ID. For read-only documentation work, repository_read is also available.",
  inputSchema: documentationEditToolInputSchema,
  async execute(input, ctx) {
    const actions = new DocumentationActions(ctx);

    switch (input.action) {
      case "open":
        return await actions.open().match(
          (workspace) => ({ action: input.action, workspace }),
          raiseRepositoryError,
        );
      case "list_files":
        return await actions.listFiles(input).match(
          (output) => ({ action: input.action, ...output }),
          raiseRepositoryError,
        );
      case "search":
        return await actions.search(input).match(
          (output) => ({ action: input.action, ...output }),
          raiseRepositoryError,
        );
      case "read":
        return await actions.read(input).match(
          (output) => ({ action: input.action, ...output }),
          raiseRepositoryError,
        );
      case "write":
        return await actions.write(input).match(
          (output) => ({ action: input.action, ...output }),
          raiseRepositoryError,
        );
      case "remove":
        return await actions.remove(input).match(
          (output) => ({ action: input.action, ...output }),
          raiseRepositoryError,
        );
      case "review":
        return await actions.review().match(
          (output) => ({ action: input.action, ...output }),
          raiseRepositoryError,
        );
    }
  },
});

function raiseRepositoryError(error: Error): never {
  throw error;
}
