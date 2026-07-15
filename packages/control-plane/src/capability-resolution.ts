import { z } from "zod";

import type { WatchDispatchCapabilityAuthority } from "./watch-dispatch-readiness.ts";
import type { CapabilityFamily } from "./capability-contract.ts";
import type { CapabilityResolutionEvent } from "./capability-resolution-events.ts";

export const authoredToolNames = [
  "authoring_workspace",
  "capture_linear_docs_signal",
  "capture_slack_docs_signal",
  "configure_github_writeback",
  "configure_working_repository",
  "docs_follow_up",
  "docs_work_manage",
  "docs_work_read",
  "get_docs_profile",
  "get_setup_status",
  "internal_document",
  "memory_get",
  "memory_mark_stale",
  "memory_promote",
  "memory_propose",
  "memory_retire",
  "memory_search",
  "process_due_docs_followups",
  "provider_delivery",
  "publish_working_repository_pr",
  "retrieve_slack_context",
  "scan_watched_repositories",
  "working_repository",
  "workspace_knowledge",
] as const;

export const authoredToolNameSchema = z.enum(authoredToolNames);

export type AuthoredToolName = (typeof authoredToolNames)[number];
export type CapabilityContextClass = CapabilityResolutionEvent["contextClass"];
export type CapabilityResolutionReason = CapabilityResolutionEvent["reasonCodes"][number];

export interface PrincipalProjection {
  readonly principalId: string | null;
  readonly principalType: string | null;
  readonly authenticator: string | null;
  readonly issuer: string | null;
}

export interface CapabilityMatrixInput {
  readonly current: PrincipalProjection;
  readonly initiator: PrincipalProjection;
  readonly channelKind: string | null;
  readonly enforceChannel: boolean;
  readonly docsMaintenanceReady: boolean;
  readonly githubWritebackReady: boolean;
  readonly preparedDraftReady: boolean;
  readonly watchReservationId: string | null;
  readonly watchAuthority: WatchDispatchCapabilityAuthority | null;
  readonly resolverFailed?: boolean;
}

export interface CapabilityResolution {
  readonly contextClass: CapabilityContextClass;
  readonly status: "resolved" | "denied";
  readonly capabilityFamilies: readonly CapabilityFamily[];
  readonly toolNames: readonly AuthoredToolName[];
  readonly reasonCodes: readonly CapabilityResolutionReason[];
  readonly reservationId: string | null;
  readonly watchId: string | null;
  readonly effectiveRevisionId: string | null;
}

export const capabilityFamilyTools: Readonly<
  Record<CapabilityFamily, readonly AuthoredToolName[]>
> = {
  "knowledge.read": ["workspace_knowledge"],
  "repository.read": ["working_repository", "get_docs_profile"],
  "docs_work.manage": ["docs_work_read", "docs_work_manage", "internal_document"],
  "draft.edit": ["authoring_workspace"],
  "follow_up.schedule": ["docs_follow_up"],
  "provider.deliver": ["provider_delivery"],
  "publication.publish": ["publish_working_repository_pr"],
};

export function resolveCapabilityMatrix(input: CapabilityMatrixInput): CapabilityResolution {
  const contextClass = classifyContext(
    input.current,
    input.initiator,
    input.watchReservationId,
    input.channelKind,
    input.enforceChannel,
  );
  const families = new Set<CapabilityFamily>();
  const tools = new Set<AuthoredToolName>();
  const reasons = new Set<CapabilityResolutionReason>();

  if (input.resolverFailed) {
    reasons.add("resolver-failure");
    return resolution(contextClass, families, tools, reasons, input);
  }

  if (contextClass === "unknown") {
    reasons.add("principal-unverified");
    return resolution(contextClass, families, tools, reasons, input);
  }

  if (contextClass === "watch") {
    if (input.watchAuthority === null || input.watchReservationId === null) {
      reasons.add("watch-authority-unavailable");
      return resolution(contextClass, families, tools, reasons, input);
    }
    reasons.add("watch-authority");
    for (const family of input.watchAuthority.capabilityGrants) families.add(family);
  } else if (contextClass === "schedule") {
    reasons.add("schedule-principal");
    families.add("docs_work.manage");
    families.add("follow_up.schedule");
    if (input.docsMaintenanceReady) {
      families.add("knowledge.read");
      families.add("repository.read");
      families.add("draft.edit");
    } else {
      reasons.add("setup-not-ready");
    }
  } else {
    reasons.add(
      contextClass === "slack"
        ? "slack-principal"
        : contextClass === "linear"
          ? "linear-principal"
          : "interactive-principal",
    );
    families.add("docs_work.manage");
    families.add("follow_up.schedule");
    if (input.docsMaintenanceReady) {
      families.add("knowledge.read");
      families.add("repository.read");
      families.add("draft.edit");
    } else {
      reasons.add("setup-not-ready");
    }
    if (input.githubWritebackReady && input.preparedDraftReady) {
      families.add("publication.publish");
    } else {
      if (!input.githubWritebackReady) reasons.add("writeback-not-ready");
      if (!input.preparedDraftReady) reasons.add("prepared-draft-unavailable");
    }
  }

  for (const family of families) {
    for (const tool of capabilityFamilyTools[family]) tools.add(tool);
  }

  if (contextClass === "eve") {
    tools.add("get_setup_status");
    tools.add("configure_working_repository");
    if (input.docsMaintenanceReady) tools.add("configure_github_writeback");
    for (const tool of [
      "memory_get",
      "memory_search",
      "memory_propose",
      "memory_promote",
      "memory_mark_stale",
      "memory_retire",
    ] as const) tools.add(tool);
  }
  if (contextClass === "slack") {
    tools.add("capture_slack_docs_signal");
    tools.add("retrieve_slack_context");
    tools.add("memory_get");
    tools.add("memory_search");
    tools.add("memory_propose");
  }
  if (contextClass === "linear") {
    tools.add("capture_linear_docs_signal");
    tools.add("memory_get");
    tools.add("memory_search");
    tools.add("memory_propose");
  }
  if (contextClass === "schedule") {
    tools.delete("docs_follow_up");
    tools.add("process_due_docs_followups");
  }
  if (contextClass !== "watch" && contextClass !== "schedule" && input.docsMaintenanceReady) {
    tools.add("scan_watched_repositories");
  }

  return resolution(contextClass, families, tools, reasons, input);
}

function resolution(
  contextClass: CapabilityContextClass,
  families: Set<CapabilityFamily>,
  tools: Set<AuthoredToolName>,
  reasons: Set<CapabilityResolutionReason>,
  input: CapabilityMatrixInput,
): CapabilityResolution {
  return {
    contextClass,
    status: tools.size === 0 ? "denied" : "resolved",
    capabilityFamilies: [...families].sort(),
    toolNames: [...tools].sort(),
    reasonCodes: [...reasons].sort(),
    reservationId: input.watchAuthority?.reservationId ?? input.watchReservationId,
    watchId: input.watchAuthority?.watchId ?? null,
    effectiveRevisionId: input.watchAuthority?.effectiveRevisionId ?? null,
  };
}

function classifyContext(
  current: PrincipalProjection,
  initiator: PrincipalProjection,
  reservationId: string | null,
  channelKind: string | null,
  enforceChannel: boolean,
): CapabilityContextClass {
  const channelMatches = (...expected: string[]) =>
    !enforceChannel || (channelKind !== null && expected.includes(channelKind));
  if (reservationId !== null && channelMatches("chat-sdk", "channel:slack")) return "watch";
  if (
    isSchedulePrincipal(current) &&
    isSchedulePrincipal(initiator) &&
    channelMatches("schedule")
  ) return "schedule";
  if (
    isSlackPrincipal(current) &&
    isSlackPrincipal(initiator) &&
    current.issuer === initiator.issuer &&
    channelMatches("chat-sdk", "channel:slack")
  ) return "slack";
  if (
    isLinearPrincipal(current) &&
    isLinearPrincipal(initiator) &&
    current.issuer === initiator.issuer &&
    channelMatches("linear", "channel:linear")
  ) return "linear";
  if (
    isInteractivePrincipalPair(current, initiator) &&
    channelMatches("http", "channel:eve")
  ) return "eve";
  return "unknown";
}

function isSchedulePrincipal(principal: PrincipalProjection): boolean {
  return principal.authenticator === "app" &&
    principal.principalType === "runtime" &&
    principal.principalId === "eve:app";
}

function isSlackPrincipal(principal: PrincipalProjection): boolean {
  return principal.principalType === "user" &&
    principal.authenticator === "slack-webhook" &&
    principal.issuer?.startsWith("slack:") === true &&
    principal.principalId?.startsWith("slack:") === true;
}

function isLinearPrincipal(principal: PrincipalProjection): boolean {
  return principal.principalType === "user" &&
    principal.authenticator === "linear-agent-webhook" &&
    principal.issuer?.startsWith("linear:") === true &&
    principal.principalId?.startsWith("linear:") === true;
}

function isInteractivePrincipalPair(
  current: PrincipalProjection,
  initiator: PrincipalProjection,
): boolean {
  const local = (principal: PrincipalProjection) =>
    principal.authenticator === "local-dev" &&
    principal.principalId === "local-dev" &&
    principal.principalType === "local-dev" &&
    principal.issuer === null;
  if (local(current) && local(initiator)) return true;

  const oidc = (principal: PrincipalProjection) =>
    principal.authenticator === "oidc" &&
    principal.principalType === "user" &&
    principal.principalId !== null &&
    principal.issuer?.startsWith("https://oidc.vercel.com/") === true;
  return oidc(current) && oidc(initiator) && current.issuer === initiator.issuer;
}
