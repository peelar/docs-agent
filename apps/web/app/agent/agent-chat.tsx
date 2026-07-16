"use client";

import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUpIcon,
  BotIcon,
  LoaderCircleIcon,
  RotateCcwIcon,
  SquareIcon,
  WrenchIcon,
} from "lucide-react";
import type { HandleMessageStreamEvent, SessionState } from "eve/client";
import {
  useEveAgent,
  type EveDynamicToolPart,
  type EveMessage,
  type EveMessagePart,
} from "eve/react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

const CHAT_STORAGE_KEY = "paige.operator.agent-session.v1";

interface SavedAgentSession {
  events?: readonly HandleMessageStreamEvent[];
  session?: SessionState;
}

export function AgentChat({ workspaceId }: { workspaceId?: string }) {
  const [saved, setSaved] = useState<SavedAgentSession>();

  useEffect(() => {
    setSaved(readSavedSession());
  }, []);

  if (saved === undefined) {
    return (
      <section className="min-h-svh bg-[#fafafa]" aria-label="Loading agent session">
        <div className="grid min-h-svh place-items-center text-xs text-muted-foreground">
          <LoaderCircleIcon className="size-4 animate-spin" />
        </div>
      </section>
    );
  }

  return <AgentSession saved={saved} workspaceId={workspaceId} />;
}

function AgentSession({
  saved,
  workspaceId,
}: {
  saved: SavedAgentSession;
  workspaceId?: string;
}) {
  const [draft, setDraft] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const agent = useEveAgent({
    headers: workspaceId
      ? { "x-paige-operator-workspace": workspaceId }
      : undefined,
    initialEvents: saved.events ?? [],
    initialSession: saved.session,
    prepareSend: (input) => ({
      ...input,
      clientContext: { surface: "Paige operator web app", route: "/agent" },
    }),
  });
  const isBusy = agent.status === "submitted" || agent.status === "streaming";

  useEffect(() => {
    localStorage.setItem(
      CHAT_STORAGE_KEY,
      JSON.stringify({ events: agent.events, session: agent.session }),
    );
  }, [agent.events, agent.session]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [agent.data.messages]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || isBusy) return;

    setDraft("");
    void agent.send({ message });
  }

  function resetSession() {
    localStorage.removeItem(CHAT_STORAGE_KEY);
    agent.reset();
    setDraft("");
  }

  return (
    <section className="flex min-h-svh flex-col bg-[#fafafa]" aria-labelledby="agent-title">
      <header className="border-b bg-background px-5 py-4 sm:px-8">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <div>
            <h1 id="agent-title" className="text-sm font-medium">Agent</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              A live Eve session in the operator app.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {agent.session.sessionId ? (
              <span className="hidden max-w-44 truncate font-mono text-[10px] text-muted-foreground sm:block">
                {agent.session.sessionId}
              </span>
            ) : null}
            <Button
              aria-label="Start a new session"
              onClick={resetSession}
              size="icon"
              title="Start a new session"
              variant="outline"
            >
              <RotateCcwIcon />
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-5 sm:px-8">
        <div className="flex-1 py-8 sm:py-12">
          {agent.data.messages.length === 0 ? (
            <EmptyConversation />
          ) : (
            <div className="space-y-8">
              {agent.data.messages.map((message) => (
                <Message key={message.id} message={message} onRespond={agent.send} />
              ))}
              {isBusy ? <StreamingIndicator status={agent.status} /> : null}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="sticky bottom-0 bg-[#fafafa] pb-5 pt-3 sm:pb-8">
          {agent.error ? (
            <p className="mb-2 text-xs text-destructive">{agent.error.message}</p>
          ) : null}
          <form
            className="rounded-xl border bg-background p-2 shadow-sm"
            onSubmit={submit}
          >
            <Textarea
              aria-label="Message Paige"
              className="max-h-40 min-h-20 resize-none border-0 bg-transparent px-2 py-2 shadow-none focus-visible:ring-0"
              disabled={isBusy}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="Ask Paige about your documentation…"
              value={draft}
            />
            <div className="flex items-center justify-between px-1 pb-1">
              <p className="text-[11px] text-muted-foreground">
                Web session · Shift + Enter for a new line
              </p>
              {isBusy ? (
                <Button
                  aria-label="Stop response"
                  onClick={agent.stop}
                  size="icon"
                  type="button"
                  variant="outline"
                >
                  <SquareIcon />
                </Button>
              ) : (
                <Button
                  aria-label="Send message"
                  disabled={draft.trim().length === 0}
                  size="icon"
                  type="submit"
                >
                  <ArrowUpIcon />
                </Button>
              )}
            </div>
          </form>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            This view resumes its last web session. Cross-channel session history comes next.
          </p>
        </div>
      </div>
    </section>
  );
}

function EmptyConversation() {
  return (
    <div className="mx-auto grid max-w-lg place-items-center py-24 text-center">
      <div className="grid size-11 place-items-center rounded-xl border bg-background shadow-xs">
        <BotIcon className="size-5" />
      </div>
      <h2 className="mt-5 text-xl font-semibold tracking-tight">Talk to Paige</h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        Start a durable Eve session here. The conversation will survive page
        reloads on this browser.
      </p>
    </div>
  );
}

function Message({
  message,
  onRespond,
}: {
  message: EveMessage;
  onRespond: ReturnType<typeof useEveAgent>["send"];
}) {
  const isUser = message.role === "user";

  return (
    <article className={isUser ? "ml-auto max-w-2xl" : "max-w-3xl"}>
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
        {isUser ? "You" : "Paige"}
        {message.metadata?.status === "streaming" ? (
          <LoaderCircleIcon className="size-3 animate-spin" />
        ) : null}
      </div>
      <div
        className={
          isUser
            ? "rounded-xl bg-foreground px-4 py-3 text-sm leading-6 text-background"
            : "space-y-3 text-sm leading-7"
        }
      >
        {message.parts.map((part, index) => (
          <MessagePart
            key={`${message.id}-${index}`}
            onRespond={onRespond}
            part={part}
          />
        ))}
      </div>
    </article>
  );
}

function MessagePart({
  part,
  onRespond,
}: {
  part: EveMessagePart;
  onRespond: ReturnType<typeof useEveAgent>["send"];
}) {
  if (part.type === "text") {
    return <p className="whitespace-pre-wrap">{part.text}</p>;
  }

  if (part.type === "dynamic-tool") {
    return <ToolActivity onRespond={onRespond} part={part} />;
  }

  if (part.type === "authorization") {
    return (
      <div className="rounded-lg border bg-background p-3">
        <p className="font-medium">{part.displayName}</p>
        <p className="mt-1 text-xs text-muted-foreground">{part.description}</p>
        {part.state === "required" && part.authorization?.url ? (
          <a
            className="mt-3 inline-flex text-xs font-medium underline underline-offset-4"
            href={part.authorization.url}
            rel="noreferrer"
            target="_blank"
          >
            Sign in
          </a>
        ) : null}
      </div>
    );
  }

  return null;
}

function ToolActivity({
  part,
  onRespond,
}: {
  part: EveDynamicToolPart;
  onRespond: ReturnType<typeof useEveAgent>["send"];
}) {
  const request = part.toolMetadata?.eve?.inputRequest;

  return (
    <div className="overflow-hidden rounded-lg border bg-background text-xs">
      <div className="flex items-center gap-2 px-3 py-2 text-muted-foreground">
        <WrenchIcon className="size-3.5" />
        <span className="font-medium text-foreground">
          {part.toolMetadata?.eve?.name ?? part.toolName}
        </span>
        <span className="ml-auto">{toolStateLabel(part.state)}</span>
      </div>
      {request && part.state === "approval-requested" ? (
        <>
          <Separator />
          <div className="p-3">
            <p className="text-sm">{request.prompt}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {request.options?.map((option) => (
                <Button
                  key={option.id}
                  onClick={() => {
                    void onRespond({
                      inputResponses: [{
                        requestId: request.requestId,
                        optionId: option.id,
                      }],
                    });
                  }}
                  size="sm"
                  type="button"
                  variant={option.style === "primary" ? "default" : "outline"}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function StreamingIndicator({ status }: { status: "submitted" | "streaming" }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <LoaderCircleIcon className="size-3.5 animate-spin" />
      {status === "submitted" ? "Starting session…" : "Paige is working…"}
    </div>
  );
}

function toolStateLabel(state: EveDynamicToolPart["state"]) {
  if (state === "output-available") return "Completed";
  if (state === "output-error") return "Failed";
  if (state === "output-denied") return "Denied";
  if (state === "approval-requested") return "Approval needed";
  return "Working";
}

function readSavedSession(): SavedAgentSession {
  if (typeof window === "undefined") return {};

  const raw = localStorage.getItem(CHAT_STORAGE_KEY);
  if (!raw) return {};

  try {
    return JSON.parse(raw) as SavedAgentSession;
  } catch {
    localStorage.removeItem(CHAT_STORAGE_KEY);
    return {};
  }
}
