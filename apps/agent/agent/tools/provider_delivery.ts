import {
  prepareWatchProviderDelivery,
  watchProviderDeliverySchema,
} from "@docs-agent/control-plane/agent";
import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";

import { PAIGE_WATCH_CAPABILITY_REGISTRY } from "../lib/slack-watch-admission";
import {
  requireCapabilityToolExecution,
  resolveDynamicCapabilities,
  watchDispatchClaimFromAuth,
} from "../lib/capability-resolution";

export default defineDynamic({
  events: {
    "step.started": async (event, context) => {
      if (!(await resolveDynamicCapabilities(event, context)).toolNames.includes("provider_delivery")) {
        return null;
      }
      return defineTool({
        description: "Deliver one bounded watch result through the exact source-bound provider destination. The destination, delivery mode, idempotency key, and budget are server-owned; this tool accepts no target. A digest request queues the result until the approved digest schedule. Silent watches cannot use this tool.",
        inputSchema: z.object({ content: z.string().trim().min(1).max(12_000) }).strict(),
        outputSchema: watchProviderDeliverySchema,
        async execute({ content }, ctx) {
          await requireCapabilityToolExecution("provider_delivery", ctx);
          const watchClaim = watchDispatchClaimFromAuth(ctx.session.auth);
          if (watchClaim === null) {
            throw new Error("Provider delivery is available only inside an exact watch dispatch.");
          }
          return prepareWatchProviderDelivery({
            reservationId: watchClaim.reservationId,
            dispatchClaimToken: watchClaim.claimToken,
            callId: ctx.callId,
            sessionId: ctx.session.id,
            turnId: ctx.session.turn.id,
            content,
          }, {
            capabilityRegistry: PAIGE_WATCH_CAPABILITY_REGISTRY,
          });
        },
        toModelOutput(output) {
          return {
            type: "json",
            value: {
              id: output.id,
              mode: output.mode,
              status: output.status,
              destination: "source-bound",
            },
          };
        },
      });
    },
  },
});
