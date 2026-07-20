"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { HandleMessageStreamEvent } from "eve/client";
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  BotIcon,
  CheckCircle2Icon,
  CircleDotIcon,
  Clock3Icon,
  KeyRoundIcon,
  LaptopIcon,
  MessageSquareIcon,
  NetworkIcon,
  UserRoundIcon,
  WrenchIcon,
} from "lucide-react";

import type { IndexedAgentSession } from "../../../../agent/sessions/types";
import { agentSessionTitle } from "../../../../agent/sessions/title";
import { streamEveEvents } from "../eve-stream";
import { SlackIcon } from "../slack-icon";

const visibleEventTypes = new Set<HandleMessageStreamEvent["type"]>([
  "session.started",
  "turn.started",
  "message.received",
  "actions.requested",
  "action.result",
  "input.requested",
  "message.completed",
  "step.completed",
  "step.failed",
  "turn.failed",
  "turn.completed",
  "authorization.required",
  "authorization.completed",
  "subagent.called",
  "subagent.completed",
  "session.waiting",
  "session.failed",
  "session.completed",
]);

export function SessionDetail({
  session,
}: {
  session: IndexedAgentSession;
}) {
  const [events, setEvents] = useState<HandleMessageStreamEvent[]>([]);
  const [streamState, setStreamState] = useState<"loading" | "live" | "settled" | "error">(
    "loading",
  );
  const [streamError, setStreamError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    setEvents([]);
    setStreamError(undefined);
    setStreamState("loading");
    void streamEveEvents({
      sessionId: session.sessionId,
      signal: controller.signal,
      onEvent(event) {
        setStreamState("live");
        if (visibleEventTypes.has(event.type)) {
          setEvents((current) => [...current, event]);
        }
      },
    }).then(() => {
      if (!controller.signal.aborted) setStreamState("settled");
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setStreamState("error");
      setStreamError(error instanceof Error ? error.message : "Activity could not be loaded.");
    });
    return () => controller.abort();
  }, [session.sessionId]);

  return (
    <section className="min-h-svh bg-[#f7f7f5]" aria-labelledby="session-title">
      <header className="border-b bg-background px-5 py-4 sm:px-8">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              aria-label="Back to sessions"
              className="grid size-8 shrink-0 place-items-center rounded-lg border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              href="/sessions"
            >
              <ArrowLeftIcon className="size-4" />
            </Link>
            <div className="min-w-0">
              <h1 id="session-title" className="truncate text-sm font-medium">
                {agentSessionTitle(session.title, session.source)}
              </h1>
              <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                {session.sessionId}
              </p>
            </div>
          </div>
          <SourceLabel source={session.source} />
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
        <div className="grid gap-px overflow-hidden rounded-xl border bg-border shadow-xs sm:grid-cols-2">
          <SummaryCell label="Status">
            <span className="inline-flex items-center gap-2 capitalize">
              <StatusDot status={currentStatus(events, session.status)} />
              {currentStatus(events, session.status)}
            </span>
          </SummaryCell>
          <SummaryCell label="Started">
            {formatDate(session.startedAt)}
          </SummaryCell>
        </div>

        <div className="mt-9 flex items-center justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Eve event stream
            </p>
            <h2 className="mt-2 text-lg font-semibold tracking-tight">Activity</h2>
          </div>
          <span className="inline-flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className={`size-1.5 rounded-full ${
              streamState === "live" ? "bg-blue-500" :
              streamState === "error" ? "bg-red-500" : "bg-emerald-500"
            }`} />
            {streamState === "loading" ? "Loading history" :
              streamState === "live" ? "Receiving activity" :
              streamState === "error" ? "Activity unavailable" : "Up to date"}
          </span>
        </div>

        {streamError ? (
          <div className="mt-5 rounded-xl border bg-background px-5 py-10 text-center shadow-xs">
            <Clock3Icon className="mx-auto size-4 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">Activity is currently unavailable</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Check that the local Paige agent is running, then reload this page.
            </p>
          </div>
        ) : null}

        <div className={`relative mt-5 ${streamError ? "hidden" : ""}`}>
          <div className="absolute bottom-4 left-[17px] top-4 w-px bg-border" />
          {events.length === 0 && streamState !== "error" ? (
            <div className="relative rounded-xl border bg-background px-5 py-12 text-center text-sm text-muted-foreground shadow-xs">
              <Clock3Icon className="mx-auto size-4" />
              <p className="mt-3">Waiting for Eve activity…</p>
            </div>
          ) : (
            <div className="space-y-3">
              {events.map((event, index) => (
                <ActivityEvent event={event} key={`${event.type}-${index}`} />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function ActivityEvent({ event }: { event: HandleMessageStreamEvent }) {
  const time = event.meta?.at;

  if (event.type === "message.received") {
    return (
      <ActivityCard icon={<UserRoundIcon />} label="Input received" time={time}>
        <p className="whitespace-pre-wrap text-sm leading-6">{event.data.message}</p>
      </ActivityCard>
    );
  }

  if (event.type === "message.completed" && event.data.message) {
    return (
      <ActivityCard icon={<BotIcon />} label="Paige" time={time}>
        <p className="whitespace-pre-wrap text-sm leading-6">{event.data.message}</p>
      </ActivityCard>
    );
  }

  if (event.type === "actions.requested") {
    return event.data.actions.map((action) => (
      <ActivityCard
        icon={<WrenchIcon />}
        key={action.callId}
        label={`Requested ${actionLabel(action)}`}
        time={time}
      >
        <JsonDetails label="Input" value={action.input} />
      </ActivityCard>
    ));
  }

  if (event.type === "action.result") {
    return (
      <ActivityCard
        icon={event.data.status === "completed" ? <CheckCircle2Icon /> : <AlertTriangleIcon />}
        label={`${resultLabel(event.data.result)} ${event.data.status}`}
        tone={event.data.status === "failed" ? "error" : "default"}
        time={time}
      >
        {event.data.error ? (
          <p className="text-sm text-red-700">{event.data.error.message}</p>
        ) : (
          <JsonDetails label="Result" value={event.data.result.output} />
        )}
      </ActivityCard>
    );
  }

  if (event.type === "input.requested") {
    return event.data.requests.map((request) => (
      <ActivityCard
        icon={<MessageSquareIcon />}
        key={request.requestId}
        label="Input requested"
        time={time}
      >
        <p className="text-sm leading-6">{request.prompt}</p>
        {request.options ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Options: {request.options.map(({ label }) => label).join(", ")}
          </p>
        ) : null}
      </ActivityCard>
    ));
  }

  if (event.type === "authorization.required") {
    return (
      <ActivityCard icon={<KeyRoundIcon />} label="Authorization required" time={time}>
        <p className="text-sm leading-6">{event.data.description}</p>
      </ActivityCard>
    );
  }

  if (event.type === "authorization.completed") {
    return (
      <ActivityCard icon={<KeyRoundIcon />} label={`Authorization ${event.data.outcome}`} time={time}>
        {event.data.reason ? <p className="text-sm">{event.data.reason}</p> : null}
      </ActivityCard>
    );
  }

  if (event.type === "step.completed" && event.data.usage) {
    const usage = event.data.usage;
    return (
      <ActivityCard icon={<CircleDotIcon />} label="Model step completed" time={time}>
        <p className="font-mono text-[11px] text-muted-foreground">
          {usage.inputTokens ?? 0} input · {usage.outputTokens ?? 0} output
          {usage.costUsd === undefined ? "" : ` · $${usage.costUsd.toFixed(4)}`}
        </p>
      </ActivityCard>
    );
  }

  if (
    event.type === "step.failed" ||
    event.type === "turn.failed" ||
    event.type === "session.failed"
  ) {
    return (
      <ActivityCard icon={<AlertTriangleIcon />} label={`${failureLabel(event.type)} failed`} tone="error" time={time}>
        <p className="text-sm leading-6 text-red-700">{event.data.message}</p>
      </ActivityCard>
    );
  }

  if (event.type === "subagent.called") {
    return (
      <ActivityCard icon={<NetworkIcon />} label={`Delegated to ${event.data.name}`} time={time}>
        <p className="font-mono text-[11px] text-muted-foreground">
          Child session {event.data.childSessionId}
        </p>
      </ActivityCard>
    );
  }

  if (event.type === "subagent.completed") {
    return (
      <ActivityCard icon={<NetworkIcon />} label={`${event.data.subagentName} completed`} time={time}>
        <p className="whitespace-pre-wrap text-sm leading-6">{event.data.output}</p>
      </ActivityCard>
    );
  }

  const lifecycle = lifecycleLabel(event.type);
  return lifecycle ? (
    <ActivityCard icon={<CircleDotIcon />} label={lifecycle} quiet time={time} />
  ) : null;
}

function ActivityCard({
  children,
  icon,
  label,
  quiet = false,
  time,
  tone = "default",
}: {
  children?: ReactNode;
  icon: ReactNode;
  label: string;
  quiet?: boolean;
  time?: string;
  tone?: "default" | "error";
}) {
  return (
    <article className={`relative ml-9 rounded-xl border bg-background px-4 py-3 shadow-xs ${
      quiet ? "border-dashed shadow-none" : ""
    } ${tone === "error" ? "border-red-200 bg-red-50/60" : ""}`}>
      <div className="absolute -left-[30px] top-3.5 z-10 grid size-4 place-items-center rounded-full border bg-background text-muted-foreground [&_svg]:size-2.5">
        {icon}
      </div>
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs font-medium">{label}</p>
        {time ? (
          <time className="shrink-0 font-mono text-[9px] text-muted-foreground" dateTime={time}>
            {new Date(time).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </time>
        ) : null}
      </div>
      {children ? <div className="mt-2">{children}</div> : null}
    </article>
  );
}

function JsonDetails({ label, value }: { label: string; value: unknown }) {
  return (
    <details className="group text-xs">
      <summary className="cursor-pointer text-muted-foreground marker:text-border">
        {label}
      </summary>
      <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-[#f7f7f5] p-3 font-mono text-[10px] leading-5">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

function SummaryCell({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="bg-background px-5 py-4">
      <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="mt-2 text-sm font-medium">{children}</div>
    </div>
  );
}

function SourceLabel({ source }: { source: IndexedAgentSession["source"] }) {
  const local = source === "local-web";
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
      {local
        ? <LaptopIcon className="size-3" />
        : <SlackIcon className="size-3" />}
      {local ? "Local web" : "Slack"}
    </span>
  );
}

function StatusDot({ status }: { status: IndexedAgentSession["status"] }) {
  const color = status === "failed" ? "bg-red-500" : status === "running" ? "bg-blue-500" : status === "waiting" ? "bg-amber-500" : "bg-emerald-500";
  return <span className={`size-1.5 rounded-full ${color}`} />;
}

function currentStatus(
  events: HandleMessageStreamEvent[],
  fallback: IndexedAgentSession["status"],
): IndexedAgentSession["status"] {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const type = events[index]?.type;
    if (type === "session.failed") return "failed";
    if (type === "session.completed") return "completed";
    if (type === "session.waiting") return "waiting";
    if (type === "session.started" || type === "turn.started") return "running";
  }
  return fallback;
}

function actionLabel(action: Extract<HandleMessageStreamEvent, { type: "actions.requested" }>["data"]["actions"][number]): string {
  if (action.kind === "tool-call") return action.toolName;
  if (action.kind === "subagent-call") return action.subagentName;
  if (action.kind === "remote-agent-call") return action.remoteAgentName;
  return "skill";
}

function resultLabel(result: Extract<HandleMessageStreamEvent, { type: "action.result" }>["data"]["result"]): string {
  if (result.kind === "tool-result") return result.toolName;
  if (result.kind === "subagent-result") return result.subagentName;
  return result.name ?? "Skill";
}

function lifecycleLabel(type: HandleMessageStreamEvent["type"]): string | undefined {
  if (type === "session.started") return "Session started";
  if (type === "turn.started") return "Turn started";
  if (type === "turn.completed") return "Turn completed";
  if (type === "session.waiting") return "Waiting for input";
  if (type === "session.completed") return "Session completed";
  return undefined;
}

function failureLabel(type: "step.failed" | "turn.failed" | "session.failed"): string {
  if (type === "step.failed") return "Step";
  if (type === "turn.failed") return "Turn";
  return "Session";
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
