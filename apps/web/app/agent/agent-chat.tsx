"use client";

import type { UserContent } from "ai";
import type { HandleMessageStreamEvent, SessionState } from "eve/client";
import { useEveAgent } from "eve/react";
import {
  AlertCircleIcon,
  PlusIcon,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { collectEveEvents } from "@/app/sessions/eve-stream";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  PromptInput,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

import { AgentMessage } from "./agent-message";
import {
  clearLegacyAgentSession,
  readContinuationToken,
  storeContinuationToken,
} from "./continuation-storage";

interface SavedAgentSession {
  events?: readonly HandleMessageStreamEvent[];
  session?: SessionState;
}

export function AgentChat({ sessionId }: { sessionId?: string }) {
  const [saved, setSaved] = useState<SavedAgentSession | undefined>(
    sessionId === undefined ? {} : undefined,
  );
  const [loadError, setLoadError] = useState<string>();

  useEffect(() => {
    clearLegacyAgentSession();
    if (sessionId === undefined) return;

    const continuationToken = readContinuationToken(sessionId);
    if (!continuationToken) {
      setLoadError(
        "This browser does not have the continuation token for this session.",
      );
      return;
    }

    const controller = new AbortController();
    void collectEveEvents({
      sessionId,
      signal: controller.signal,
    }).then((events) => {
      setSaved({
        events,
        session: {
          sessionId,
          continuationToken,
          streamIndex: events.length,
        },
      });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setLoadError(errorMessage(error));
    });

    return () => controller.abort();
  }, [sessionId]);

  if (loadError) {
    return <UnavailableSession error={loadError} sessionId={sessionId} />;
  }

  if (saved === undefined) {
    return (
      <section
        aria-label="Loading agent session"
        className="grid min-h-[calc(100svh-3.5rem)] place-items-center bg-background md:min-h-svh"
      >
        <Spinner className="size-4 text-muted-foreground" />
      </section>
    );
  }

  return <AgentSession initialSessionId={sessionId} saved={saved} />;
}

function AgentSession({
  saved,
  initialSessionId,
}: {
  saved: SavedAgentSession;
  initialSessionId?: string;
}) {
  const [indexError, setIndexError] = useState<string>();
  const firstMessageRef = useRef<string | undefined>(undefined);
  const registrationInFlightRef = useRef<string | undefined>(undefined);
  const registeredSessionIdRef = useRef(initialSessionId);
  const agent = useEveAgent({
    initialEvents: saved.events ?? [],
    initialSession: saved.session,
    onSessionChange: storeContinuationToken,
    prepareSend: (input) => ({
      ...input,
      clientContext: {
        surface: "Paige operator web app",
        route: initialSessionId ? `/agent/${initialSessionId}` : "/agent",
      },
    }),
  });
  const isBusy = agent.status === "submitted" || agent.status === "streaming";
  const isEmpty = agent.data.messages.length === 0;
  const activeSessionId = agent.session.sessionId;
  const activeContinuationToken = agent.session.continuationToken;

  useEffect(() => {
    storeContinuationToken(agent.session);
    if (
      initialSessionId !== undefined ||
      !activeSessionId ||
      !activeContinuationToken ||
      !firstMessageRef.current ||
      registeredSessionIdRef.current === activeSessionId ||
      registrationInFlightRef.current === activeSessionId
    ) return;

    registrationInFlightRef.current = activeSessionId;
    const firstMessage = firstMessageRef.current;
    void fetch("/api/sessions/local", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: activeSessionId, firstMessage }),
    }).then(async (response) => {
      if (!response.ok) {
        const payload = await response.json() as { error?: string };
        throw new Error(payload.error ?? "The web session could not be indexed.");
      }
      registeredSessionIdRef.current = activeSessionId;
      setIndexError(undefined);
      // Keep the Eve hook mounted while giving refreshes a durable session URL.
      window.history.replaceState(
        window.history.state,
        "",
        `/agent/${encodeURIComponent(activeSessionId)}`,
      );
    }).catch((error: unknown) => {
      setIndexError(errorMessage(error));
    }).finally(() => {
      registrationInFlightRef.current = undefined;
    });
  }, [
    activeContinuationToken,
    activeSessionId,
    agent.session,
    initialSessionId,
  ]);

  async function submit(message: PromptInputMessage) {
    const text = message.text.trim();
    if ((text.length === 0 && message.files.length === 0) || isBusy) return;

    if (!agent.session.sessionId && firstMessageRef.current === undefined) {
      firstMessageRef.current = firstMessageTitle(message);
    }

    if (message.files.length === 0) {
      await agent.send({ message: text });
      return;
    }

    const parts: UserContent = [];
    if (text.length > 0) parts.push({ text, type: "text" });
    for (const file of message.files) {
      parts.push({
        data: file.url,
        filename: file.filename,
        mediaType: file.mediaType,
        type: "file",
      });
    }
    await agent.send({ message: parts });
  }

  const composer = (
    <PromptInput
      className="rounded-xl bg-background shadow-sm"
      onSubmit={submit}
    >
      <PromptInputTextarea
        aria-label="Message Paige"
        className="min-h-24 px-3 pt-3"
        disabled={isBusy}
        placeholder="Ask Paige about your documentation…"
      />
      <PromptInputFooter>
        <span className="text-[11px] font-normal text-muted-foreground">
          Enter to send · Shift + Enter for a new line
        </span>
        <PromptInputSubmit onStop={agent.stop} status={agent.status} />
      </PromptInputFooter>
    </PromptInput>
  );

  return (
    <section
      aria-labelledby="agent-title"
      className="flex h-[calc(100svh-3.5rem)] min-h-[32rem] flex-col overflow-hidden bg-muted/20 md:h-svh"
    >
      <header className="shrink-0 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <PaigeAvatar className="size-9" />
            <h1 className="truncate text-sm font-medium" id="agent-title">
              Chat with Paige
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {activeSessionId ? (
              <span className="hidden max-w-40 truncate font-mono text-[10px] text-muted-foreground lg:block">
                {activeSessionId}
              </span>
            ) : null}
            <Button
              aria-label="Start a new session"
              onClick={() => window.location.assign("/agent")}
              type="button"
              variant="outline"
            >
              <PlusIcon data-icon="inline-start" />
              New chat
            </Button>
          </div>
        </div>
      </header>

      <ErrorMessages agentError={agent.error?.message} indexError={indexError} />

      {isEmpty ? (
        <div className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-8 px-5 pb-[8vh] sm:px-8">
          <div className="text-center">
            <PaigeAvatar className="mx-auto size-12" />
            <h2 className="mt-5 text-2xl font-semibold tracking-tight">
              What should Paige look into?
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Share a pull request, issue, or documentation question to get started.
            </p>
          </div>
          <div className="w-full">{composer}</div>
        </div>
      ) : (
        <>
          <Conversation className="min-h-0 flex-1">
            <ConversationContent className="mx-auto w-full max-w-6xl gap-6 px-5 py-8 sm:px-8">
              {agent.data.messages.map((message, index) => (
                <AgentMessage
                  canRespond={!isBusy}
                  isStreaming={
                    agent.status === "streaming" &&
                    index === agent.data.messages.length - 1
                  }
                  key={message.id}
                  message={message}
                  onInputResponses={(inputResponses) =>
                    agent.send({ inputResponses })}
                />
              ))}
              {agent.status === "submitted" ? (
                <div
                  aria-live="polite"
                  className="flex items-center gap-2 text-xs text-muted-foreground"
                >
                  <Spinner className="size-3.5" />
                  Paige is starting…
                </div>
              ) : null}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>
          <div className="shrink-0 border-t bg-background/90 px-5 pb-5 pt-4 backdrop-blur sm:px-8 sm:pb-6">
            <div className="mx-auto w-full max-w-6xl">{composer}</div>
          </div>
        </>
      )}
    </section>
  );
}

function PaigeAvatar({ className }: { readonly className?: string }) {
  return (
    <span
      className={cn(
        "block shrink-0 overflow-hidden rounded-full border bg-background shadow-xs",
        className,
      )}
    >
      <Image
        alt=""
        className="size-full object-cover"
        height={48}
        priority
        src="/paige-magpie.png"
        width={48}
      />
    </span>
  );
}

function ErrorMessages({
  agentError,
  indexError,
}: {
  agentError?: string;
  indexError?: string;
}) {
  if (!agentError && !indexError) return null;
  return (
    <div className="mx-auto w-full max-w-6xl shrink-0 px-5 pt-3 sm:px-8">
      {[agentError, indexError].filter(Boolean).map((error) => (
        <div
          className="mb-2 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs"
          key={error}
        >
          <AlertCircleIcon className="mt-0.5 size-3.5 shrink-0 text-destructive" />
          <p>{error}</p>
        </div>
      ))}
    </div>
  );
}

function UnavailableSession({
  error,
  sessionId,
}: {
  error: string;
  sessionId?: string;
}) {
  return (
    <section className="grid min-h-[calc(100svh-3.5rem)] place-items-center bg-muted/20 px-5 md:min-h-svh">
      <div className="max-w-md rounded-xl border bg-background p-6 shadow-xs">
        <h1 className="text-sm font-medium">Session unavailable</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{error}</p>
        <div className="mt-5 flex gap-3 text-xs font-medium">
          <Link className="underline underline-offset-4" href="/agent">
            Start a new session
          </Link>
          {sessionId ? (
            <Link
              className="underline underline-offset-4"
              href={`/sessions/${encodeURIComponent(sessionId)}`}
            >
              Inspect activity
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function firstMessageTitle(message: PromptInputMessage): string {
  const text = message.text.trim();
  if (text.length > 0) return text;
  return message.files.map((file) => file.filename).filter(Boolean).join(", ") ||
    "Attachment";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The session could not be loaded.";
}
