import {
  acknowledgeWatchTurnDispatch,
  claimDueScheduledWatchDispatches,
  claimDueWatchDigestDeliveries,
  claimPendingWatchTurnDispatches,
  claimPendingImmediateWatchProviderDeliveries,
  completeWatchProviderDelivery,
  expireWatchRuntimeData,
  failWatchProviderDelivery,
  flushReadyWatchObservationWindows,
  releaseWatchTurnDispatch,
} from "@docs-agent/control-plane/agent";
import { defineSchedule } from "eve/schedules";

import slack, { slackAdapter } from "../channels/slack";
import {
  PAIGE_WATCH_CAPABILITY_REGISTRY,
  prepareSlackWatchDispatch,
} from "../lib/slack-watch-admission";
import {
  buildWatchDispatchAuth,
  buildWatchTurnMessage,
  watchSyntheticThreadId,
} from "../lib/watch-runtime";

export default defineSchedule({
  cron: "* * * * *",
  run({ receive, waitUntil }) {
    waitUntil((async () => {
      const errors: unknown[] = [];
      try {
        const windowedHandoffs = await flushReadyWatchObservationWindows({ limit: 25 });
        for (const handoff of windowedHandoffs) {
          try {
            await prepareSlackWatchDispatch(handoff);
          } catch (error) {
            errors.push(error);
          }
        }
      } catch (error) {
        errors.push(error);
      }

      try {
        await claimDueScheduledWatchDispatches({
          capabilityRegistry: PAIGE_WATCH_CAPABILITY_REGISTRY,
        }, { limit: 25 });
      } catch (error) {
        errors.push(error);
      }
      try {
        const turnDispatches = await claimPendingWatchTurnDispatches({
          capabilityRegistry: PAIGE_WATCH_CAPABILITY_REGISTRY,
        }, { limit: 25 });
        for (const claimed of turnDispatches) {
          try {
            await receiveWatchTurn(receive, claimed);
          } catch (error) {
            errors.push(error);
          }
        }
      } catch (error) {
        errors.push(error);
      }

      const deliveries: Array<Awaited<
        ReturnType<typeof claimPendingImmediateWatchProviderDeliveries>
      >[number]> = [];
      try {
        deliveries.push(...await claimPendingImmediateWatchProviderDeliveries({
          capabilityRegistry: PAIGE_WATCH_CAPABILITY_REGISTRY,
        }, { limit: 25 }));
      } catch (error) {
        errors.push(error);
      }
      try {
        deliveries.push(...await claimDueWatchDigestDeliveries({
          capabilityRegistry: PAIGE_WATCH_CAPABILITY_REGISTRY,
        }, { limit: 25 }));
      } catch (error) {
        errors.push(error);
      }
      for (const delivery of deliveries) {
        try {
          await slackAdapter.postPreparedWatchDelivery(delivery);
          await completeWatchProviderDelivery(delivery);
        } catch (error) {
          await failWatchProviderDelivery(delivery);
          errors.push(error);
        }
      }

      try {
        await expireWatchRuntimeData();
      } catch (error) {
        errors.push(error);
      }
      if (errors.length > 0) {
        throw new AggregateError(errors, "One or more watch runtime operations failed.");
      }
    })());
  },
});

async function receiveWatchTurn(
  receive: Parameters<NonNullable<Parameters<typeof defineSchedule>[0]["run"]>>[0]["receive"],
  claimed: Awaited<ReturnType<typeof claimPendingWatchTurnDispatches>>[number],
): Promise<void> {
  const { dispatch, claimToken } = claimed;
  const source = dispatch.effectiveRevision.policy.source;
  if (source.provider !== "slack" || source.resource.type !== "channel") {
    throw new Error("The current watch runtime has no durable channel for this source.");
  }
  const reservationId = dispatch.reservation.id;
  try {
    const session = await receive(slack, {
      message: buildWatchTurnMessage(dispatch),
      target: {
        adapterName: "slack",
        threadId: watchSyntheticThreadId(source.resource.id, reservationId),
      },
      auth: buildWatchDispatchAuth(reservationId, claimToken),
    });
    await acknowledgeWatchTurnDispatch({ reservationId, claimToken, sessionId: session.id });
  } catch (error) {
    await releaseWatchTurnDispatch({ reservationId, claimToken });
    throw error;
  }
}
