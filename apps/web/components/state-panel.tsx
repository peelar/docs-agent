import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type StatePanelProps = {
  action?: ReactNode;
  body: string;
  mark: string;
  title: string;
  kicker: string;
  tone?: "empty" | "error" | "loading" | "not-found";
};

function StatePanel({
  action,
  body,
  mark,
  title,
  kicker,
  tone = "empty",
}: StatePanelProps) {
  const isError = tone === "error";

  return (
    <Card
      className="relative min-h-72 overflow-hidden border-foreground/20 bg-card/80 py-0 shadow-[0_22px_70px_rgba(28,43,38,0.1)]"
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
    >
      <div className="pointer-events-none absolute -top-20 -right-16 size-60 rounded-full border border-foreground/10" />
      <CardContent className="relative grid min-h-72 items-end gap-8 p-[clamp(1.5rem,4vw,3.5rem)] md:grid-cols-[minmax(8rem,0.4fr)_minmax(0,1fr)]">
        <div
          className={cn(
            "grid size-[clamp(5rem,10vw,8rem)] place-items-center rounded-full border border-foreground/25 bg-background font-heading text-[clamp(2rem,5vw,4rem)] text-accent",
            isError && "text-destructive",
            tone === "loading" && "animate-pulse",
          )}
          aria-hidden="true"
        >
          {mark}
        </div>
        <div className="max-w-2xl">
          <p className="font-mono text-[0.68rem] font-bold tracking-[0.12em] text-accent uppercase">
            {kicker}
          </p>
          <h2 className="mt-3 max-w-[18ch] font-heading text-[clamp(2rem,4vw,3.8rem)] leading-none font-medium tracking-[-0.055em] text-balance">
            {title}
          </h2>
          <p className="mt-5 max-w-xl leading-7 text-muted-foreground">{body}</p>
          {action ? <div className="mt-6">{action}</div> : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function LoadingState() {
  return (
    <StatePanel
      body="The workspace frame is staying available while this view prepares."
      kicker="Preparing view…"
      mark="·"
      title="Bringing the next surface into focus."
      tone="loading"
    />
  );
}

export function EmptyState({
  body,
  kicker,
  title,
}: Pick<StatePanelProps, "body" | "kicker" | "title">) {
  return <StatePanel body={body} kicker={kicker} mark="○" title={title} />;
}

export function ErrorState({ action }: { action: ReactNode }) {
  return (
    <StatePanel
      action={action}
      body="The shell is still available, but this view could not be prepared. Try it again before changing anything."
      kicker="View unavailable"
      mark="!"
      title="This surface needs another pass."
      tone="error"
    />
  );
}

export function NotFoundState({ action }: { action: ReactNode }) {
  return (
    <StatePanel
      action={action}
      body="The requested control-plane route does not exist in this workspace."
      kicker="Route not found"
      mark="↙"
      title="There is nothing at this address."
      tone="not-found"
    />
  );
}
