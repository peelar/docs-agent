import { defineDynamic, defineTool } from "eve/tools";

import {
  docsWorkManageProviderInputSchema,
  manageDocsWork,
  projectDocsWorkModelOutput,
} from "../lib/docs-work";
import { requireCapabilityToolExecution, resolveDynamicCapabilities } from "../lib/capability-resolution";

export default defineDynamic({ events: { "step.started": async (event, context) => {
  if (!(await resolveDynamicCapabilities(event, context)).toolNames.includes("docs_work_manage")) return null;
  return defineTool({
  description: "Create or update bounded documentation work through typed operations. Use this surface to create explicitly requested durable manual work, triage it, run repository-corroborated current-docs verification, record or revise an editorial decision or substantial-work plan, link evidence, start substantial ownership, record milestones, correct, park or manually pause, resume, or finish the original work with a completed, blocked, abandoned, or failed outcome. An explicit repository task can use decide and plan directly; do not search for, create, or start a docs signal merely to support it. Actors, workspace scope, lifecycle authority, and runtime provenance are server-owned. Statuses cannot be selected directly. Drafting, follow-ups, internal documents, provider admission, workspace memory, and publication remain separate capabilities.",
  inputSchema: docsWorkManageProviderInputSchema,
  async execute(input, ctx) {
    await requireCapabilityToolExecution("docs_work_manage", ctx);
    return manageDocsWork(input, ctx);
  },
  toModelOutput(output) {
    return { type: "json", value: projectDocsWorkModelOutput(output) };
  },
  });
} } });
