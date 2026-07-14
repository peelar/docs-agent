import {
  DEFAULT_WORKSPACE_ID,
  prepareWatchDispatch,
  resolveActiveWatchEventAdmissions,
  WATCH_CAPABILITY_REGISTRY_VERSION,
  type WatchCapabilityRegistry,
  type WatchEventAdmission,
  type WatchDispatchReadyHandoff,
  type WatchObservationHandoff,
} from "@docs-agent/control-plane/agent";

import type { SlackWatchEventScope } from "./subscription-filtered-slack-adapter";

export const PAIGE_WATCH_CAPABILITY_REGISTRY: WatchCapabilityRegistry = {
  version: WATCH_CAPABILITY_REGISTRY_VERSION,
  status: "ready",
  availableCapabilities: [
    "knowledge.read",
    "repository.read",
    "docs_work.manage",
    "draft.edit",
    "follow_up.schedule",
    "provider.deliver",
  ],
};

/**
 * This resolver is installed only inside the verified Slack webhook adapter.
 * The provider identity therefore comes from a signature-checked request, not
 * from a model, browser, or independently accepted body field.
 */
export function resolveSlackWatchEventAdmissions(
  scope: SlackWatchEventScope,
): Promise<WatchEventAdmission[]> {
  return resolveActiveWatchEventAdmissions({
    workspaceId: DEFAULT_WORKSPACE_ID,
    providerWorkspaceId: scope.providerWorkspaceId,
    source: {
      provider: "slack",
      providerWorkspaceId: scope.providerWorkspaceId,
      resource: scope.resource,
    },
    eventType: scope.eventType,
  }, {
    capabilityRegistry: PAIGE_WATCH_CAPABILITY_REGISTRY,
    providerAuthorization: {
      provider: "slack",
      providerWorkspaceId: scope.providerWorkspaceId,
      verification: "verified-webhook",
    },
  });
}

export function prepareSlackWatchDispatch(
  handoff: WatchObservationHandoff,
): Promise<WatchDispatchReadyHandoff> {
  const providerWorkspaceIds = new Set(
    handoff.observations.map(({ provenance }) => provenance.providerWorkspaceId),
  );
  const providerWorkspaceId = [...providerWorkspaceIds][0];
  if (providerWorkspaceIds.size !== 1 || providerWorkspaceId === undefined) {
    throw new Error(
      "A Slack watch handoff must belong to one verified provider workspace.",
    );
  }
  return prepareWatchDispatch(handoff, {
    capabilityRegistry: PAIGE_WATCH_CAPABILITY_REGISTRY,
    providerAuthorization: {
      provider: "slack",
      providerWorkspaceId,
      verification: "verified-webhook",
    },
  });
}
