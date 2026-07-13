import { defineTool } from "eve/tools";
import { z } from "zod";

import {
  createContentPlan,
  createContentPlanInputSchema,
  inspectContentPlan,
  reviseContentPlan,
  reviseContentPlanInputSchema,
} from "../lib/content-plan";
import { contentPlanSchema } from "../lib/repository-workflow-contract";
import { loadOrMaterializeRepositoryWorkflowState } from "../lib/working-repository-lifecycle";

const inputSchema = z.discriminatedUnion("mode", [
  createContentPlanInputSchema.extend({ mode: z.literal("create") }),
  reviseContentPlanInputSchema.extend({ mode: z.literal("revise") }),
  z.object({ mode: z.literal("inspect") }),
]);
const planResultSchema = z.object({
  plan: contentPlanSchema,
  progressUpdate: z.string(),
  continuesToDraft: z.boolean(),
});
const outputSchema = z.union([
  planResultSchema.extend({ mode: z.enum(["create", "revise"]) }),
  z.object({ mode: z.literal("inspect"), result: planResultSchema.nullable() }),
]);

export default defineTool({
  description: "Create, revise, or inspect the living content plan for substantial documentation work after docs-impact judgment. Share progressUpdate, then continue sandbox drafting when continuesToDraft is true. This is not an approval gate. If it is false, pause because evidence or a consequential product decision is missing. Do not use this tool for a small localized patch.",
  inputSchema,
  outputSchema,
  async execute(input, ctx) {
    const state = await loadOrMaterializeRepositoryWorkflowState(ctx);
    switch (input.mode) {
      case "create": return { mode: "create" as const, ...(await createContentPlan(input, state)) };
      case "revise": return { mode: "revise" as const, ...(await reviseContentPlan(input, state)) };
      case "inspect": return { mode: "inspect" as const, result: inspectContentPlan(state) };
    }
  },
});
