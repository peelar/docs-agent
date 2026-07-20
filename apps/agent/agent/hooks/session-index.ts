import type { HandleMessageStreamEvent } from "eve/client";
import { defineHook, type HookContext } from "eve/hooks";

import { resolveAgentSessionService } from "../../sessions/database";
import type {
  AgentSessionSource,
  AgentSessionStatus,
} from "../../sessions/types";

type LifecycleEventType =
  | "session.started"
  | "turn.started"
  | "turn.completed"
  | "turn.failed"
  | "session.waiting"
  | "session.completed"
  | "session.failed";

type MessageReceivedEvent = Extract<
  HandleMessageStreamEvent,
  { type: "message.received" }
>;

export function statusForLifecycleEvent(
  type: LifecycleEventType,
): AgentSessionStatus | undefined {
  if (type === "session.started" || type === "turn.started") return "running";
  if (type === "session.waiting") return "waiting";
  if (type === "session.completed") return "completed";
  if (type === "session.failed") return "failed";
  return undefined;
}

export function sessionSourceForChannel(
  channelKind: string | undefined,
): AgentSessionSource | undefined {
  // Eve namespaces authored channel adapters at runtime, so Slack's original
  // "chat-sdk" kind reaches hooks as "channel:slack".
  return channelKind === "channel:slack" ? "slack" : undefined;
}

async function recordLifecycle(
  event: HandleMessageStreamEvent,
  ctx: HookContext,
): Promise<void> {
  if (ctx.session.parent !== undefined) return;
  const result = await resolveAgentSessionService().asyncAndThen((sessions) =>
    sessions.updateLifecycle({
      sessionId: ctx.session.id,
      status: statusForLifecycleEvent(event.type as LifecycleEventType),
      occurredAt: event.meta?.at ?? new Date().toISOString(),
    })
  );
  if (result.isErr()) throw result.error;
}

async function registerMessage(
  event: MessageReceivedEvent,
  ctx: HookContext,
): Promise<void> {
  if (ctx.session.parent !== undefined) return;
  const source = sessionSourceForChannel(ctx.channel.kind);
  if (source === undefined) return;

  // Indexing runs inside Eve's durable message lifecycle. A storage failure
  // fails the turn, and the next message can enrich an earlier partial row.
  const result = await resolveAgentSessionService().asyncAndThen((sessions) =>
    sessions.register({
      sessionId: ctx.session.id,
      source,
      firstMessage: event.data.message,
      registeredAt: event.meta?.at,
    })
  );
  if (result.isErr()) throw result.error;
}

export default defineHook({
  events: {
    "session.started": recordLifecycle,
    "message.received": registerMessage,
    "turn.started": recordLifecycle,
    "turn.completed": recordLifecycle,
    "turn.failed": recordLifecycle,
    "session.waiting": recordLifecycle,
    "session.completed": recordLifecycle,
    "session.failed": recordLifecycle,
  },
});
