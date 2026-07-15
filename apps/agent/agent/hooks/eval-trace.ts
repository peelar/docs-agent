import { appendFileSync } from "node:fs";

import { defineHook } from "eve/hooks";

const tracePath = process.env.PAIGE_EVAL_TRACE_PATH?.trim();
const actionStarts = new Map<string, { at: number; stepKey: string }>();
const steps = new Map<string, {
  actionsCompleted: number;
  actionsRequested: number;
  startedAt: number;
}>();

export default defineHook({
  events: {
    "session.started"(event, ctx) {
      if (!tracePath) return;
      record(event.type, ctx.session.id, { runtime: event.data.runtime });
    },
    "turn.started"(event, ctx) {
      if (!tracePath) return;
      record(event.type, ctx.session.id, event.data);
    },
    "step.started"(event, ctx) {
      if (!tracePath) return;
      const key = stepKey(ctx.session.id, event.data.turnId, event.data.stepIndex);
      steps.set(key, { actionsCompleted: 0, actionsRequested: 0, startedAt: Date.now() });
      record(event.type, ctx.session.id, event.data);
    },
    "actions.requested"(event, ctx) {
      if (!tracePath) return;
      const key = stepKey(ctx.session.id, event.data.turnId, event.data.stepIndex);
      const state = steps.get(key);
      if (state !== undefined) state.actionsRequested += event.data.actions.length;
      const now = Date.now();
      const actions = event.data.actions.map((action) => {
        actionStarts.set(actionKey(ctx.session.id, action.callId), { at: now, stepKey: key });
        return {
          callId: action.callId,
          kind: action.kind,
          toolName: action.kind === "tool-call" ? action.toolName : undefined,
          input: action.kind === "tool-call" ? summarizeRecord(action.input) : undefined,
        };
      });
      record(event.type, ctx.session.id, { ...event.data, actions });
    },
    "action.result"(event, ctx) {
      if (!tracePath) return;
      const { result } = event.data;
      const key = actionKey(ctx.session.id, result.callId);
      const started = actionStarts.get(key);
      actionStarts.delete(key);
      if (started !== undefined) {
        const state = steps.get(started.stepKey);
        if (state !== undefined) state.actionsCompleted += 1;
      }
      record(event.type, ctx.session.id, {
        callId: result.callId,
        durationMs: started === undefined ? undefined : Date.now() - started.at,
        status: event.data.status,
        toolName: "toolName" in result ? result.toolName : undefined,
        output: "output" in result ? summarizeOutput(result.output) : undefined,
        error: summarizeFailure(event.data.error),
      });
    },
    "step.completed"(event, ctx) {
      if (!tracePath) return;
      const key = stepKey(ctx.session.id, event.data.turnId, event.data.stepIndex);
      const state = steps.get(key);
      steps.delete(key);
      clearStepActions(key);
      record(event.type, ctx.session.id, {
        ...event.data,
        actionsCompleted: state?.actionsCompleted ?? 0,
        actionsRequested: state?.actionsRequested ?? 0,
        durationMs: state === undefined ? undefined : Date.now() - state.startedAt,
        zeroActionToolCallStep:
          event.data.finishReason === "tool-calls" && (state?.actionsRequested ?? 0) === 0,
      });
    },
    "step.failed"(event, ctx) {
      if (!tracePath) return;
      const key = stepKey(ctx.session.id, event.data.turnId, event.data.stepIndex);
      steps.delete(key);
      clearStepActions(key);
      record(event.type, ctx.session.id, summarizeFailure(event.data));
    },
    "turn.completed"(event, ctx) {
      if (!tracePath) return;
      clearSessionState(ctx.session.id);
      record(event.type, ctx.session.id, event.data);
    },
    "turn.failed"(event, ctx) {
      if (!tracePath) return;
      clearSessionState(ctx.session.id);
      record(event.type, ctx.session.id, summarizeFailure(event.data));
    },
    "session.waiting"(event, ctx) {
      if (!tracePath) return;
      clearSessionState(ctx.session.id);
      record(event.type, ctx.session.id, event.data);
    },
    "session.failed"(event, ctx) {
      if (!tracePath) return;
      clearSessionState(ctx.session.id);
      record(event.type, ctx.session.id, summarizeFailure(event.data));
    },
    "session.completed"(_event, ctx) {
      if (!tracePath) return;
      clearSessionState(ctx.session.id);
      record("session.completed", ctx.session.id, undefined);
    },
  },
});

function record(type: string, sessionId: string, data: unknown): void {
  if (!tracePath) return;
  try {
    appendFileSync(
      tracePath,
      `${JSON.stringify({ at: new Date().toISOString(), type, sessionId, data })}\n`,
    );
  } catch {
    // Eval diagnostics must never change the agent outcome.
  }
}

function stepKey(sessionId: string, turnId: string, stepIndex: number): string {
  return `${sessionId}:${turnId}:${stepIndex}`;
}

function actionKey(sessionId: string, callId: string): string {
  return `${sessionId}:${callId}`;
}

function clearStepActions(key: string): void {
  for (const [callId, state] of actionStarts) {
    if (state.stepKey === key) actionStarts.delete(callId);
  }
}

function clearSessionState(sessionId: string): void {
  const prefix = `${sessionId}:`;
  for (const key of steps.keys()) {
    if (key.startsWith(prefix)) steps.delete(key);
  }
  for (const key of actionStarts.keys()) {
    if (key.startsWith(prefix)) actionStarts.delete(key);
  }
}

function summarizeRecord(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const decision = isRecord(value.decision) ? value.decision : undefined;
  const plan = isRecord(value.plan) ? value.plan : undefined;
  return {
    keys: Object.keys(value),
    mode: value.mode,
    operation: value.operation,
    operationCount: Array.isArray(value.operations) ? value.operations.length : undefined,
    taskReferences: summarizeReferences(value.taskReferences),
    decisionTaskReferences: summarizeReferences(decision?.taskReferences),
    planTaskReferences: summarizeReferences(plan?.taskReferences),
  };
}

function summarizeReferences(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string").slice(0, 20);
}

function summarizeOutput(value: unknown): unknown {
  if (typeof value === "string") return { type: "string", length: value.length };
  if (!isRecord(value)) return value;
  const draft = isRecord(value.draft) ? value.draft : undefined;
  return {
    keys: Object.keys(value),
    mode: value.mode,
    ok: value.ok,
    draftStatus: draft?.status,
    error:
      typeof value.error === "string"
        ? value.error.slice(0, 500)
        : undefined,
  };
}

function summarizeFailure(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return {
    code: value.code,
    messageLength: typeof value.message === "string" ? value.message.length : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
