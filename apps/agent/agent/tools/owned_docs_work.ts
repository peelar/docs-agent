import {
  getOwnedDocsWork,
  ownedDocsWorkRecordSchema,
  ownedDocsWorkResultSchema,
  startOwnedDocsWork,
  startOwnedDocsWorkInputSchema,
  updateOwnedDocsWork,
  updateOwnedDocsWorkInputSchema,
} from "@docs-agent/control-plane/agent";
import { defineTool } from "eve/tools";
import { z } from "zod";

const inputSchema = z.union([
  startOwnedDocsWorkInputSchema.extend({ mode: z.literal("start") }),
  z.object({ mode: z.literal("inspect"), signalId: z.string().trim().min(1) }),
  z.object({ mode: z.literal("update"), update: updateOwnedDocsWorkInputSchema }),
]);
const outputSchema = z.union([
  ownedDocsWorkResultSchema.extend({ mode: z.literal("start") }),
  z.object({ mode: z.literal("inspect"), work: ownedDocsWorkRecordSchema }),
  ownedDocsWorkResultSchema.extend({ mode: z.literal("update") }),
]);

export default defineTool({
  description: "Start, inspect, or update one substantial documentation work item on its existing docs signal. Eve owns durable execution; this tool records stable session/run/conversation references, milestones, artifacts, blockers, corrections, pause/resume, approval waits, and terminal outcomes without creating another workflow engine. Share channelUpdate when present. Continue reversible work in the same turn; routine records return no channel update. Quick questions and localized edits stay inline and do not use this tool.",
  inputSchema,
  outputSchema,
  async execute(input, ctx) {
    const runtime = { sessionId: ctx.session.id, runId: ctx.session.turn.id };
    switch (input.mode) {
      case "start": return { mode: "start" as const, ...(await startOwnedDocsWork(input, runtime)) };
      case "inspect": return { mode: "inspect" as const, work: await getOwnedDocsWork(input) };
      case "update": return { mode: "update" as const, ...(await updateOwnedDocsWork(input.update, runtime)) };
    }
  },
  toModelOutput(output) {
    if (output.mode === "inspect") return { type: "json", value: output };
    return {
      type: "json",
      value: {
        mode: output.mode,
        created: output.created,
        replayed: output.replayed,
        channelUpdate: output.channelUpdate,
        work: {
          id: output.work.id,
          signalId: output.work.signalId,
          status: output.work.status,
          revision: output.work.revision,
          intendedOutcome: output.work.intendedOutcome,
          references: output.work.references,
          outcome: output.work.outcome,
          lastMilestone: output.work.lastMilestone,
        },
      },
    };
  },
});
