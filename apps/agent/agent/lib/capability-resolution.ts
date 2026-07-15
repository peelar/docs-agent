import type { DynamicResolveContext, ToolContext } from "eve/tools";

import {
  authoredToolNames,
  recordCapabilityResolution,
  hasApprovedToolResume,
  resolveCapabilityMatrix,
  resolveWatchDispatchCapabilityAuthority,
  type AuthoredToolName,
  type CapabilityResolution,
  type PrincipalProjection,
} from "@docs-agent/control-plane/agent";

import { PAIGE_WATCH_CAPABILITY_REGISTRY } from "./slack-watch-admission";
import { inspectRepositoryWorkflowState } from "./repository-workflow-state";
import { getSetupStatus } from "./setup-state";

export { authoredToolNames, resolveCapabilityMatrix };
export type { AuthoredToolName, CapabilityResolution, PrincipalProjection };

const eventResolutionCache = new WeakMap<object, Promise<CapabilityResolution>>();

type ResolverSession = Pick<ToolContext["session"], "id" | "auth">;
type ResolverContext = Pick<DynamicResolveContext, "session" | "channel">;

export function resolveDynamicCapabilities(
  event: unknown,
  context: ResolverContext,
): Promise<CapabilityResolution> {
  const turnId = turnIdFromEvent(event);
  if (typeof event !== "object" || event === null) {
    return resolveRuntimeCapabilities(
      context.session,
      "unavailable",
      context.channel.kind ?? null,
      true,
      true,
    );
  }
  const existing = eventResolutionCache.get(event);
  if (existing !== undefined) return existing;
  const resolving = resolveRuntimeCapabilities(
    context.session,
    turnId ?? "unavailable",
    context.channel.kind ?? null,
    true,
    turnId === null,
  );
  eventResolutionCache.set(event, resolving);
  return resolving;
}

export async function requireCapabilityToolExecution(
  toolName: AuthoredToolName,
  ctx: ToolContext,
): Promise<void> {
  const resolved = await resolveRuntimeCapabilities(
    ctx.session,
    ctx.session.turn.id,
    null,
    false,
  );
  if (resolved.toolNames.includes(toolName)) return;
  const current = projectPrincipal(ctx.session.auth.current);
  const initiator = projectPrincipal(ctx.session.auth.initiator);
  if (
    await canExecuteApprovedPublicationResume({
      toolName,
      current,
      initiator,
      preparedDraftReady: preparedDraftIsReady(),
      sessionId: ctx.session.id,
      runId: ctx.session.turn.id,
      callId: ctx.callId,
    })
  ) return;
  throw new Error(`The ${toolName} capability is unavailable in this verified runtime context.`);
}

async function resolveRuntimeCapabilities(
  session: ResolverSession,
  turnId: string,
  channelKind: string | null,
  enforceChannel: boolean,
  forceFailure = false,
): Promise<CapabilityResolution> {
  const current = projectPrincipal(session.auth.current);
  const initiator = projectPrincipal(session.auth.initiator);
  const watchClaim = watchDispatchClaimFromAuth(session.auth);
  const reservationId = watchClaim?.reservationId ?? null;

  try {
    if (forceFailure) throw new Error("Dynamic resolver event has no verified turn id.");
    const [setup, watchAuthority] = await Promise.all([
      getSetupStatus(),
      reservationId === null
        ? Promise.resolve(null)
        : resolveWatchDispatchCapabilityAuthority(reservationId, {
            capabilityRegistry: PAIGE_WATCH_CAPABILITY_REGISTRY,
          }, { claimToken: watchClaim!.claimToken }),
    ]);
    const resolved = resolveCapabilityMatrix({
      current,
      initiator,
      channelKind,
      enforceChannel,
      docsMaintenanceReady: setup.docsMaintenanceReady,
      githubWritebackReady: setup.githubWritebackReady,
      preparedDraftReady: preparedDraftIsReady(),
      watchReservationId: reservationId,
      watchAuthority,
    });
    await persistResolution(session, turnId, resolved);
    return resolved;
  } catch {
    const failed = resolveCapabilityMatrix({
      current,
      initiator,
      channelKind,
      enforceChannel,
      docsMaintenanceReady: false,
      githubWritebackReady: false,
      preparedDraftReady: false,
      watchReservationId: reservationId,
      watchAuthority: null,
      resolverFailed: true,
    });
    try {
      await persistResolution(session, turnId, failed);
    } catch {
      // The resolver remains fail-closed when its durable projection is unavailable.
    }
    return failed;
  }
}

async function persistResolution(
  session: ResolverSession,
  turnId: string,
  resolved: CapabilityResolution,
): Promise<void> {
  await recordCapabilityResolution({
    sessionId: session.id,
    turnId,
    contextClass: resolved.contextClass,
    status: resolved.status,
    capabilityFamilies: [...resolved.capabilityFamilies],
    toolNames: [...resolved.toolNames],
    reasonCodes: [...resolved.reasonCodes],
    reservationId: resolved.reservationId,
    watchId: resolved.watchId,
    effectiveRevisionId: resolved.effectiveRevisionId,
  });
}

function turnIdFromEvent(event: unknown): string | null {
  if (typeof event !== "object" || event === null || !("data" in event)) return null;
  const data = event.data;
  if (typeof data !== "object" || data === null || !("turnId" in data)) return null;
  return typeof data.turnId === "string" && data.turnId.length > 0 ? data.turnId : null;
}

function projectPrincipal(value: unknown): PrincipalProjection {
  if (typeof value !== "object" || value === null) {
    return { principalId: null, principalType: null, authenticator: null, issuer: null };
  }
  const principal = value as Record<string, unknown>;
  return {
    principalId: typeof principal.principalId === "string" ? principal.principalId : null,
    principalType: typeof principal.principalType === "string" ? principal.principalType : null,
    authenticator: typeof principal.authenticator === "string" ? principal.authenticator : null,
    issuer: typeof principal.issuer === "string" ? principal.issuer : null,
  };
}

function watchReservationId(
  current: PrincipalProjection,
  initiator: PrincipalProjection,
): string | null {
  const prefix = "paige:watch-dispatch:";
  if (
    current.principalType !== "runtime" ||
    initiator.principalType !== "runtime" ||
    current.authenticator !== "paige-watch-dispatch" ||
    initiator.authenticator !== "paige-watch-dispatch" ||
    current.issuer !== "paige" ||
    initiator.issuer !== "paige" ||
    current.principalId !== initiator.principalId ||
    !current.principalId?.startsWith(prefix)
  ) return null;
  const reservationId = current.principalId.slice(prefix.length);
  return /^[a-f0-9]{64}$/u.test(reservationId) ? reservationId : null;
}

export function watchDispatchClaimFromAuth(auth: {
  readonly current?: unknown;
  readonly initiator?: unknown;
}): { reservationId: string; claimToken: string } | null {
  const reservationId = watchReservationId(
    projectPrincipal(auth.current),
    projectPrincipal(auth.initiator),
  );
  if (reservationId === null) return null;
  const currentToken = dispatchClaimToken(auth.current);
  const initiatorToken = dispatchClaimToken(auth.initiator);
  if (currentToken === null || currentToken !== initiatorToken) return null;
  return { reservationId, claimToken: currentToken };
}

export function watchReservationIdFromAuth(auth: {
  readonly current?: unknown;
  readonly initiator?: unknown;
}): string | null {
  return watchDispatchClaimFromAuth(auth)?.reservationId ?? null;
}

export async function resolveFrameworkKnowledgeReadVisibility(
  event: unknown,
  context: ResolverContext,
): Promise<boolean> {
  if (!isWatchDispatchAuthCandidate(context.session.auth)) return true;
  return canExposeFrameworkKnowledgeRead(
    context.session.auth,
    await resolveDynamicCapabilities(event, context),
  );
}

export async function requireFrameworkKnowledgeReadExecution(
  ctx: ToolContext,
): Promise<void> {
  if (!isWatchDispatchAuthCandidate(ctx.session.auth)) return;
  const resolved = await resolveRuntimeCapabilities(
    ctx.session,
    ctx.session.turn.id,
    null,
    false,
  );
  if (canExposeFrameworkKnowledgeRead(ctx.session.auth, resolved)) return;
  throw new Error(
    "Framework knowledge reads are unavailable in this exact watch runtime context.",
  );
}

export function canExposeFrameworkKnowledgeRead(
  auth: { readonly current?: unknown; readonly initiator?: unknown },
  resolution: CapabilityResolution | null,
): boolean {
  if (!isWatchDispatchAuthCandidate(auth)) return true;
  return resolution?.contextClass === "watch" &&
    resolution.status === "resolved" &&
    resolution.capabilityFamilies.includes("knowledge.read");
}

function dispatchClaimToken(value: unknown): string | null {
  if (typeof value !== "object" || value === null || !("attributes" in value)) return null;
  const attributes = value.attributes;
  if (typeof attributes !== "object" || attributes === null ||
    !("watchDispatchClaimToken" in attributes)) return null;
  const token = attributes.watchDispatchClaimToken;
  return typeof token === "string" && /^[0-9a-f-]{36}$/u.test(token) ? token : null;
}

function isWatchDispatchAuthCandidate(auth: {
  readonly current?: unknown;
  readonly initiator?: unknown;
}): boolean {
  return [auth.current, auth.initiator].some((value) => {
    if (typeof value !== "object" || value === null) return false;
    const principal = value as Record<string, unknown>;
    return principal.authenticator === "paige-watch-dispatch" ||
      typeof principal.principalId === "string" &&
        principal.principalId.startsWith("paige:watch-dispatch:");
  });
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

export async function canExecuteApprovedPublicationResume(
  input: {
    readonly toolName: AuthoredToolName;
    readonly current: PrincipalProjection;
    readonly initiator: PrincipalProjection;
    readonly preparedDraftReady: boolean;
    readonly sessionId: string;
    readonly runId: string;
    readonly callId: string;
  },
  dependencies: {
    readonly checkApprovedResume: typeof hasApprovedToolResume;
    readonly recordResolution: typeof recordCapabilityResolution;
  } = {
    checkApprovedResume: hasApprovedToolResume,
    recordResolution: recordCapabilityResolution,
  },
): Promise<boolean> {
  const allowed = input.toolName === "publish_working_repository_pr" &&
    input.preparedDraftReady &&
    isOperatorApprovalResumeContext(input.current, input.initiator) &&
    await dependencies.checkApprovedResume({
      sessionId: input.sessionId,
      runId: input.runId,
      callId: input.callId,
      toolName: input.toolName,
    });
  if (!allowed) return false;
  await dependencies.recordResolution({
    sessionId: input.sessionId,
    turnId: input.runId,
    contextClass: "approval-resume",
    status: "resolved",
    capabilityFamilies: ["publication.publish"],
    toolNames: ["publish_working_repository_pr"],
    reasonCodes: ["approved-publication-resume"],
    reservationId: null,
    watchId: null,
    effectiveRevisionId: null,
  });
  return true;
}

export function isOperatorApprovalResumeContext(
  current: PrincipalProjection,
  initiator: PrincipalProjection,
): boolean {
  const currentIsOperatorRuntime = current.authenticator === "oidc" &&
    current.principalType === "runtime" &&
    current.principalId !== null &&
    current.issuer?.startsWith("https://oidc.vercel.com/") === true;
  const humanInitiator = isSlackPrincipal(initiator) ||
    isLinearPrincipal(initiator) ||
    isInteractivePrincipalPair(initiator, initiator);
  return currentIsOperatorRuntime &&
    humanInitiator &&
    !isSchedulePrincipal(initiator) &&
    watchReservationId(current, initiator) === null;
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

function preparedDraftIsReady(): boolean {
  const state = inspectRepositoryWorkflowState();
  const draft = state?.draft;
  const result = state?.lastResult;
  return draft?.status === "prepared" &&
    draft.preparedAt !== undefined &&
    draft.preparedDiffHash !== undefined &&
    result?.ok === true &&
    result.preparedAt === draft.preparedAt &&
    result.preparedDiffHash === draft.preparedDiffHash &&
    result.report.checks.every(({ status }) => status === "passed") &&
    result.changedFiles.length > 0 &&
    result.diff.length > 0;
}
