"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRightIcon,
  CircleDotIcon,
  LaptopIcon,
  PlusIcon,
} from "lucide-react";

import type {
  AgentSessionSource,
  IndexedAgentSession,
} from "../../../agent/sessions/types";
import { agentSessionTitle } from "../../../agent/sessions/title";
import {
  OperatorPage,
  OperatorPageContent,
  OperatorPageHeader,
} from "@/components/operator-page";
import { Button } from "@/components/ui/button";
import { SlackIcon } from "./slack-icon";

type SourceFilter = "all" | AgentSessionSource;

const filters: Array<{ label: string; value: SourceFilter }> = [
  { label: "All", value: "all" },
  { label: "Slack", value: "slack" },
  { label: "Web chat", value: "local-web" },
];

export function SessionsIndex({
  initialSessions,
}: {
  initialSessions: IndexedAgentSession[];
}) {
  const [sessions, setSessions] = useState(initialSessions);
  const [filter, setFilter] = useState<SourceFilter>("all");
  const [connection, setConnection] = useState<"connecting" | "live" | "retrying">(
    "connecting",
  );

  useEffect(() => {
    const events = new EventSource("/api/sessions/events");
    events.addEventListener("sessions", (event) => {
      try {
        setSessions(JSON.parse(event.data) as IndexedAgentSession[]);
        setConnection("live");
      } catch {
        setConnection("retrying");
      }
    });
    events.onopen = () => setConnection("live");
    events.onerror = () => setConnection("retrying");
    return () => events.close();
  }, []);

  const visibleSessions = useMemo(
    () => filter === "all"
      ? sessions
      : sessions.filter((session) => session.source === filter),
    [filter, sessions],
  );

  return (
    <OperatorPage aria-labelledby="sessions-title">
      <OperatorPageHeader
        actions={
          <Button
            nativeButton={false}
            render={<Link aria-label="Start a new session" href="/agent" />}
          >
            <PlusIcon data-icon="inline-start" />
            New session
          </Button>
        }
        description="Inspect Paige activity across channels."
        title="Sessions"
        titleId="sessions-title"
      />

      <OperatorPageContent>
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div className="max-w-xl">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Activity ledger
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
              What Paige has been doing
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Slack and web chat remain separate conversations. This index gives
              them one read-only operational view.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 text-[11px] text-muted-foreground">
            <span
              className={`size-1.5 rounded-full ${
                connection === "live" ? "bg-emerald-500" : "bg-amber-500"
              }`}
            />
            {connection === "live" ? "Live updates" : "Reconnecting…"}
          </div>
        </div>

        <div className="mt-9 flex items-center gap-1 rounded-lg border bg-background p-1 shadow-xs sm:w-fit">
          {filters.map((item) => (
            <button
              aria-pressed={filter === item.value}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors sm:flex-none ${
                filter === item.value
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
              key={item.value}
              onClick={() => setFilter(item.value)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="mt-5 overflow-hidden rounded-xl border bg-background shadow-xs">
          <div className="hidden grid-cols-[minmax(0,1.8fr)_120px_120px_145px_145px] gap-4 border-b bg-[#fbfbfa] px-5 py-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground md:grid">
            <span>Session</span>
            <span>Source</span>
            <span>Status</span>
            <span>Started</span>
            <span>Last activity</span>
          </div>
          {visibleSessions.length === 0 ? (
            <EmptySessions filter={filter} />
          ) : (
            <div className="divide-y">
              {visibleSessions.map((session) => (
                <SessionRow key={session.sessionId} session={session} />
              ))}
            </div>
          )}
        </div>
      </OperatorPageContent>
    </OperatorPage>
  );
}

function SessionRow({ session }: { session: IndexedAgentSession }) {
  return (
    <a
      className="group grid gap-4 px-5 py-4 transition-colors hover:bg-[#fafaf8] md:grid-cols-[minmax(0,1.8fr)_120px_120px_145px_145px] md:items-center"
      href={`/sessions/${encodeURIComponent(session.sessionId)}`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">
            {agentSessionTitle(session.title, session.source)}
          </p>
          <ArrowRightIcon className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" />
        </div>
        <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
          {session.sessionId}
        </p>
      </div>
      <SourceBadge source={session.source} />
      <StatusBadge status={session.status} />
      <Time value={session.startedAt} />
      <Time relative value={session.updatedAt} />
    </a>
  );
}

function SourceBadge({ source }: { source: AgentSessionSource }) {
  const local = source === "local-web";
  return (
    <span className="inline-flex w-fit items-center gap-1.5 rounded-full border bg-background px-2 py-1 text-[11px] font-medium text-muted-foreground">
      {local
        ? <LaptopIcon className="size-3" />
        : <SlackIcon className="size-3" />}
      {local ? "Local web" : "Slack"}
    </span>
  );
}

function StatusBadge({ status }: { status: IndexedAgentSession["status"] }) {
  const color = status === "failed"
    ? "bg-red-500"
    : status === "running"
    ? "bg-blue-500"
    : status === "waiting"
    ? "bg-amber-500"
    : "bg-emerald-500";
  return (
    <span className="inline-flex w-fit items-center gap-1.5 text-xs capitalize text-muted-foreground">
      <span className={`size-1.5 rounded-full ${color}`} />
      {status}
    </span>
  );
}

function Time({ value, relative = false }: { value: string; relative?: boolean }) {
  const date = new Date(value);
  const label = relative ? relativeTime(date) : date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <time
      className="text-xs text-muted-foreground"
      dateTime={value}
      title={date.toLocaleString("en-GB")}
    >
      {label}
    </time>
  );
}

function relativeTime(date: Date): string {
  const seconds = Math.round((date.getTime() - Date.now()) / 1_000);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  return formatter.format(Math.round(hours / 24), "day");
}

function EmptySessions({ filter }: { filter: SourceFilter }) {
  return (
    <div className="grid place-items-center px-6 py-20 text-center">
      <div className="grid size-10 place-items-center rounded-lg border bg-[#fafaf8]">
        {filter === "local-web" ? (
          <LaptopIcon className="size-4" />
        ) : filter === "slack" ? (
          <SlackIcon className="size-4" />
        ) : (
          <CircleDotIcon className="size-4" />
        )}
      </div>
      <p className="mt-4 text-sm font-medium">No sessions here yet</p>
      <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
        Sessions created after this feature was deployed will appear here.
      </p>
    </div>
  );
}
