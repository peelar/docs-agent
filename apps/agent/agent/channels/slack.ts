import { connectSlackAdapter } from "@vercel/connect/chat";
import {
  DEFAULT_SLACK_CONNECTOR,
  resolveSlackConnector,
  SLACK_CONNECTOR_ENV,
} from "@docs-agent/control-plane/provider-config";
import {
  acknowledgeWatchTurnDispatch,
  assembleClaimedWatchObservation,
  claimPreparedWatchTurnDispatch,
  claimWatchObservation,
  continueSlackThreadPresence,
  createLibSqlChatStateAdapter,
  endSlackThreadPresence,
  enrollSlackThreadPresence,
  recordConnectorDeliveryVerification,
  readBehaviorSettings,
  releaseWatchTurnDispatch,
  slackEntryAllows,
} from "@docs-agent/control-plane/agent";
import { chatSdkChannel } from "eve/channels/chat-sdk";

import {
  buildSlackActionAuth,
  isSilentSlackReply,
  registerSlackTurnHandlers,
} from "../lib/slack-chat-turn";
import {
  buildWatchDispatchAuth,
  buildWatchTurnMessage,
  handleWatchActionResult,
  isWatchSyntheticThread,
  watchSyntheticThreadId,
} from "../lib/watch-runtime";
import { watchReservationIdFromAuth } from "../lib/capability-resolution";
import { createSubscriptionFilteredSlackAdapter } from "../lib/subscription-filtered-slack-adapter";
import {
  PAIGE_WATCH_CAPABILITY_REGISTRY,
  prepareSlackWatchDispatch,
  resolveSlackWatchEventAdmissions,
} from "../lib/slack-watch-admission";
import { normalizeSlackWatchObservation } from "../lib/slack-watch-observation";

export { DEFAULT_SLACK_CONNECTOR, SLACK_CONNECTOR_ENV };

const slackConnector = resolveSlackConnector();
export const slackAdapter = createSubscriptionFilteredSlackAdapter({
  ...connectSlackAdapter(slackConnector),
  userName: "Paige",
}, {
  admitEntryMessage: async (entry) =>
    slackEntryAllows((await readBehaviorSettings()).settings.participation, entry),
  admitWatchEvent: resolveSlackWatchEventAdmissions,
  normalizeWatchEvent: normalizeSlackWatchObservation,
  claimWatchObservation: ({ admission, observation }) =>
    claimWatchObservation({
      workspaceId: admission.workspaceId,
      watchId: observation.watchId,
      effectiveRevisionId: observation.effectiveRevisionId,
      source: observation.source,
      providerEventId: observation.provenance.providerEventId,
    }),
  assembleWatchObservation: ({ admission, claimResult, observation }) =>
    assembleClaimedWatchObservation({
      workspaceId: admission.workspaceId,
      claimResult,
      observation,
    }),
  prepareWatchDispatch: prepareSlackWatchDispatch,
  dispatchWatchTurn: dispatchSlackWatchTurn,
  admitOrdinaryMessage: async (threadId) => {
    const participation = (await readBehaviorSettings()).settings.participation;
    if (participation.slackContinuation === "off") {
      await endSlackThreadPresence({
        chatThreadId: threadId,
        status: "dismissed",
        reason: "workspace-participation-disabled",
      });
      return false;
    }
    return (await continueSlackThreadPresence({ chatThreadId: threadId })).admitted;
  },
});

export const { bot, channel, send } = chatSdkChannel({
  adapters: { slack: slackAdapter },
  concurrency: { strategy: "burst", debounceMs: 1_000 },
  events: {
    async "action.result"(event, context, runtime) {
      await handleWatchActionResult(
        event,
        runtime.session,
        (delivery) => slackAdapter.postPreparedWatchDelivery(delivery),
      );
    },
    async "message.completed"(event, context, runtime) {
      if (
        watchReservationIdFromAuth(runtime.session.auth) !== null ||
        isWatchSyntheticThread(context.thread) ||
        event.finishReason === "tool-calls" ||
        !event.message ||
        isSilentSlackReply(event.message)
      ) return;
      await context.thread?.post({ markdown: event.message });
    },
  },
  resolveInputAuth: buildSlackActionAuth,
  state: createLibSqlChatStateAdapter(),
  streaming: false,
  userName: "Paige",
});

registerSlackTurnHandlers(bot, send, {
  enroll: enrollSlackThreadPresence,
  end: endSlackThreadPresence,
  verifyInbound: () =>
    recordConnectorDeliveryVerification({
      provider: "slack",
      evidence: "slack-verified-webhook",
    }),
}, async () => (await readBehaviorSettings()).settings.participation);

export default channel;

async function dispatchSlackWatchTurn(
  dispatch: Awaited<ReturnType<typeof prepareSlackWatchDispatch>>,
): Promise<void> {
  const reservationId = dispatch.reservation.id;
  const claimed = await claimPreparedWatchTurnDispatch(dispatch, {
    capabilityRegistry: PAIGE_WATCH_CAPABILITY_REGISTRY,
  });
  if (claimed === null) return;
  const channelId = claimed.dispatch.effectiveRevision.policy.source.resource.id;
  try {
    const session = await send(buildWatchTurnMessage(claimed.dispatch), {
      adapterName: "slack",
      auth: buildWatchDispatchAuth(reservationId, claimed.claimToken),
      mode: "task",
      thread: watchSyntheticThreadId(channelId, reservationId),
      title: `Policy-bound watch ${claimed.dispatch.effectiveRevision.watchId}`,
    });
    await acknowledgeWatchTurnDispatch({
      reservationId,
      claimToken: claimed.claimToken,
      sessionId: session.id,
    });
  } catch (error) {
    await releaseWatchTurnDispatch({
      reservationId,
      claimToken: claimed.claimToken,
    });
    throw error;
  }
}
