import { defineTool } from "eve/tools";
import { z } from "zod";

import {
  abandonAuthoringDraft,
  applyAuthoringDraft,
  applyAuthoringDraftInputSchema,
  inspectAuthoringDraft,
  prepareAuthoringDraft,
  prepareAuthoringDraftInputSchema,
} from "../lib/authoring-workspace";
import { authoringDraftSchema, documentationImpactReportSchema } from "../lib/repository-workflow-contract";
import { loadOrMaterializeRepositoryWorkflowState } from "../lib/working-repository-lifecycle";

const inputSchema = z.discriminatedUnion("mode", [
  applyAuthoringDraftInputSchema.extend({ mode: z.literal("apply") }),
  z.object({ mode: z.literal("inspect"), paths: z.array(z.string().trim().min(1)).max(10).default([]) }),
  prepareAuthoringDraftInputSchema.extend({ mode: z.literal("prepare") }),
  z.object({ mode: z.literal("abandon") }),
]);

const outputSchema = z.union([
  z.object({ mode: z.literal("apply"), draft: authoringDraftSchema }),
  z.object({ mode: z.literal("inspect"), draft: authoringDraftSchema.nullable(), changedFiles: z.array(z.string()), diff: z.string(), files: z.array(z.object({ path: z.string(), content: z.string().nullable() })) }),
  z.object({ mode: z.literal("prepare"), ok: z.boolean(), draft: authoringDraftSchema, report: documentationImpactReportSchema }),
  z.object({ mode: z.literal("abandon"), abandoned: z.literal(true) }),
]);

export default defineTool({
  description: "Create, revise, inspect, prepare, or abandon one requested multi-file draft in the working documentation repository. Use working_repository for read-only investigation, status, diff, and validators. Authoring modes require an existing draft or requested edits; never prepare an empty draft. Apply batches can write text or base64 binary files, copy, move, and delete anywhere inside the repository. Sandbox edits are reversible; prepare records checks and a complete diff, while GitHub publication remains separately approval-gated.",
  inputSchema,
  outputSchema,
  async execute(input, ctx) {
    const state = await loadOrMaterializeRepositoryWorkflowState(ctx);
    switch (input.mode) {
      case "apply": return { mode: "apply" as const, draft: (await applyAuthoringDraft(input, ctx, state))! };
      case "inspect": return { mode: "inspect" as const, ...(await inspectAuthoringDraft(input, ctx, state)) };
      case "prepare": return { mode: "prepare" as const, ...(await prepareAuthoringDraft(input, ctx, state)) };
      case "abandon": return { mode: "abandon" as const, ...(await abandonAuthoringDraft(ctx, state)) };
    }
  },
});
