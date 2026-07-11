import type { ReactNode } from "react";

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
    <section
      className={`state-panel state-panel-${tone}`}
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
    >
      <div
        className={`state-mark ${tone === "loading" ? "state-mark-loading" : ""}`}
        aria-hidden="true"
      >
        {mark}
      </div>
      <div className="state-copy">
        <p className="state-kicker">{kicker}</p>
        <h2>{title}</h2>
        <p>{body}</p>
        {action ? <div className="state-action">{action}</div> : null}
      </div>
    </section>
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
