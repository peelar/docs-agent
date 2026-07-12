"use client";

import {
  behaviorSettingsSchema,
  behaviorSettingsStateSchema,
  type BehaviorSettings,
  type BehaviorSettingsAuditEvent,
  type BehaviorSettingsState,
} from "@docs-agent/control-plane/behavior-contract";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Choice = { value: string; label: string; description: string };

const personalityGroups = [
  {
    key: "responseDepth",
    eyebrow: "01 / Depth",
    title: "Response depth",
    summary: "How much context Paige gives before the next useful action.",
    choices: [
      { value: "concise", label: "Concise", description: "Compact by default; expand on request." },
      { value: "adaptive", label: "Adaptive", description: "Brief conversation, thorough impact reports." },
      { value: "thorough", label: "Thorough", description: "More reasoning and context up front." },
    ],
  },
  {
    key: "directness",
    eyebrow: "02 / Direction",
    title: "Directness",
    summary: "How quickly Paige puts the conclusion or disagreement on the table.",
    choices: [
      { value: "tactful", label: "Tactful", description: "Ease into recommendations and disagreement." },
      { value: "balanced", label: "Balanced", description: "Clear conclusion with measured context." },
      { value: "direct", label: "Direct", description: "Lead with the conclusion, then support it." },
    ],
  },
  {
    key: "warmth",
    eyebrow: "03 / Temperature",
    title: "Warmth",
    summary: "The conversational temperature, never the standard of evidence.",
    choices: [
      { value: "reserved", label: "Reserved", description: "Professional and restrained." },
      { value: "warm", label: "Warm", description: "Human and tactful without performance." },
      { value: "expressive", label: "Expressive", description: "Openly encouraging, still grounded." },
    ],
  },
  {
    key: "pushback",
    eyebrow: "04 / Editorial spine",
    title: "Pushback",
    summary: "How strongly Paige challenges weak framing or a reader-hostile choice.",
    choices: [
      { value: "light", label: "Light", description: "Flag the concern, then ask what you prefer." },
      { value: "reader-advocate", label: "Reader advocate", description: "Recommend the smallest reader-solving choice." },
      { value: "firm", label: "Firm", description: "Refuse to smooth over misleading documentation." },
    ],
  },
  {
    key: "uncertaintyStyle",
    eyebrow: "05 / Unknowns",
    title: "Uncertainty style",
    summary: "What Paige does when the evidence is incomplete or consequentially ambiguous.",
    choices: [
      { value: "state-limits", label: "State limits", description: "Name assumptions and proceed when reversible." },
      { value: "ask-when-blocked", label: "Ask when blocked", description: "Continue safely; pause only on a real blocker." },
      { value: "escalate-early", label: "Escalate early", description: "Surface consequential ambiguity sooner." },
    ],
  },
] as const;

const entryChoices: Choice[] = [
  { value: "mentions-and-dms", label: "Mentions + DMs", description: "Respond to explicit Slack mentions and direct messages." },
  { value: "mentions-only", label: "Mentions only", description: "Ignore direct messages before they enter Chat SDK." },
  { value: "dms-only", label: "DMs only", description: "Ignore channel mentions before they enter Chat SDK." },
];

const continuationChoices: Choice[] = [
  { value: "relevant-only", label: "Relevant threads", description: "Continue invited threads when a useful docs, product, API, release, or support reply is available." },
  { value: "direct-only", label: "Direct follow-ups", description: "Continue only when Paige is addressed or the latest exchange directly continues." },
  { value: "off", label: "Do not follow", description: "Answer the entry message without enrolling the thread for later replies." },
];

export function BehaviorSettingsDesk({
  initialError,
  initialState,
}: {
  initialError: string | null;
  initialState: BehaviorSettingsState;
}) {
  const [state, setState] = useState(initialState);
  const [settings, setSettings] = useState(initialState.settings);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState(initialError);
  const [saved, setSaved] = useState(false);

  function updatePersonality(key: string, value: string) {
    setSettings((current) => behaviorSettingsSchema.parse({
      ...current,
      personality: { ...current.personality, [key]: value },
    }));
    setSaved(false);
    setMessage(null);
  }

  function updateParticipation(key: string, value: string) {
    setSettings((current) => behaviorSettingsSchema.parse({
      ...current,
      participation: { ...current.participation, [key]: value },
    }));
    setSaved(false);
    setMessage(null);
  }

  async function save() {
    setPending(true);
    setMessage(null);
    setSaved(false);
    try {
      const response = await fetch("/api/operator/behavior-settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ settings }),
      });
      const body = await response.json() as {
        error?: string;
        state?: BehaviorSettingsState;
      };
      if (!response.ok || body.state === undefined) {
        setMessage(body.error ?? "Behavior settings could not be saved.");
        return;
      }
      const nextState = behaviorSettingsStateSchema.parse(body.state);
      setState(nextState);
      setSettings(nextState.settings);
      setSaved(true);
      setMessage("Behavior settings saved with your operator identity.");
    } catch {
      setMessage("Behavior settings could not reach the server and were not saved.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-8" data-behavior-settings>
      <SafetyBoundary />

      <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1.35fr)_minmax(21rem,0.65fr)]">
        <form
          className="overflow-hidden rounded-xl border border-foreground/20 bg-card shadow-[0_24px_70px_rgba(24,51,44,0.07)]"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="border-b border-foreground/15 bg-[#f4ead8] p-[clamp(1.5rem,4vw,3rem)]">
            <p className="font-mono text-[0.64rem] font-bold tracking-[0.11em] text-accent uppercase">
              Personality / structured controls
            </p>
            <h2 className="mt-4 max-w-[15ch] font-heading text-[clamp(2.4rem,5vw,4.8rem)] leading-[0.92] font-medium tracking-[-0.055em]">
              Tune the editor, not the rules.
            </h2>
          </div>

          <div className="grid gap-10 p-[clamp(1.5rem,4vw,3rem)]">
            {personalityGroups.map((group) => (
              <ChoiceGroup
                choices={[...group.choices]}
                eyebrow={group.eyebrow}
                key={group.key}
                name={group.key}
                onChange={(value) => updatePersonality(group.key, value)}
                summary={group.summary}
                title={group.title}
                value={settings.personality[group.key]}
              />
            ))}
          </div>

          <div className="grid gap-9 border-t border-primary/20 bg-primary p-[clamp(1.5rem,4vw,3rem)] text-primary-foreground">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-end">
              <div>
                <p className="font-mono text-[0.64rem] font-bold tracking-[0.11em] text-primary-foreground/60 uppercase">
                  Participation / Slack presence map
                </p>
                <h2 className="mt-4 max-w-[12ch] font-heading text-[clamp(2.2rem,5vw,4.4rem)] leading-[0.94] font-medium tracking-[-0.05em]">
                  Choose the doorway and the distance.
                </h2>
              </div>
              <p className="border-t border-primary-foreground/20 pt-4 text-sm leading-6 text-primary-foreground/65 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-5">
                Entry and continuation can become narrower. They never grant repository writes or publication.
              </p>
            </div>

            <ChoiceGroup
              choices={entryChoices}
              dark
              eyebrow="A / Entry"
              name="slackEntry"
              onChange={(value) => updateParticipation("slackEntry", value)}
              summary="Which explicit Slack entry points start a Paige turn."
              title="Channel entry"
              value={settings.participation.slackEntry}
            />
            <ChoiceGroup
              choices={continuationChoices}
              dark
              eyebrow="B / Continuation"
              name="slackContinuation"
              onChange={(value) => updateParticipation("slackContinuation", value)}
              summary="How an explicitly invited Slack thread continues after its entry message."
              title="Followed threads"
              value={settings.participation.slackContinuation}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-foreground/15 p-[clamp(1.25rem,3vw,2rem)]">
            <div className="min-h-6 text-sm" role="status">
              {message ? (
                <p className={cn("text-muted-foreground", initialError && !saved && "text-destructive")}>
                  {message}
                </p>
              ) : (
                <p className="text-muted-foreground">Changes take effect on the next admitted turn.</p>
              )}
            </div>
            <Button disabled={pending || initialError !== null} type="submit">
              {pending ? "Saving…" : "Save behavior settings"}
            </Button>
          </div>
        </form>

        <aside className="grid gap-6 xl:sticky xl:top-8" aria-label="Behavior preview and audit">
          <BehaviorPreview settings={settings} />
          <AuditLedger state={state} />
        </aside>
      </div>
    </div>
  );
}

function SafetyBoundary() {
  return (
    <section className="grid gap-5 rounded-xl border border-accent/35 bg-card p-[clamp(1.3rem,3vw,2.4rem)] md:grid-cols-[auto_minmax(0,1fr)] md:items-center" data-behavior-safety>
      <span className="grid size-14 place-items-center rounded-full border border-accent/30 bg-[#f4ead8] font-heading text-2xl text-accent" aria-hidden="true">≠</span>
      <div>
        <p className="font-mono text-[0.64rem] font-bold tracking-[0.1em] text-accent uppercase">Voice and presence are not authority</p>
        <p className="mt-2 max-w-5xl text-sm leading-6 text-foreground/75">
          Evidence, provenance, sandbox isolation, the working-repository boundary, and explicit publication approval are permanent. No setting on this page can disable or widen them.
        </p>
      </div>
    </section>
  );
}

function ChoiceGroup({
  choices,
  dark = false,
  eyebrow,
  name,
  onChange,
  summary,
  title,
  value,
}: {
  choices: Choice[];
  dark?: boolean;
  eyebrow: string;
  name: string;
  onChange: (value: string) => void;
  summary: string;
  title: string;
  value: string;
}) {
  return (
    <fieldset className="grid gap-4">
      <legend className="contents">
        <span className={cn("font-mono text-[0.62rem] font-bold tracking-[0.1em] uppercase", dark ? "text-primary-foreground/55" : "text-muted-foreground")}>{eyebrow}</span>
        <span className="mt-2 block font-heading text-2xl font-semibold tracking-[-0.03em]">{title}</span>
        <span className={cn("mt-1 block max-w-2xl text-sm leading-6", dark ? "text-primary-foreground/65" : "text-muted-foreground")}>{summary}</span>
      </legend>
      <div className="grid gap-2 md:grid-cols-3">
        {choices.map((choice) => (
          <label
            className={cn(
              "relative grid min-h-32 cursor-pointer content-between gap-4 rounded-lg border p-4 transition",
              dark
                ? "border-primary-foreground/20 bg-primary-foreground/[0.04] hover:bg-primary-foreground/[0.08]"
                : "border-foreground/15 bg-background/60 hover:border-foreground/35",
              value === choice.value && (dark
                ? "border-[#d7aa6d] bg-[#d7aa6d]/10 shadow-[inset_0_0_0_1px_#d7aa6d]"
                : "border-accent bg-[#f4ead8] shadow-[inset_0_0_0_1px_#b84428]"),
            )}
            key={choice.value}
          >
            <input
              checked={value === choice.value}
              className="sr-only"
              name={name}
              onChange={(event) => onChange(event.target.value)}
              type="radio"
              value={choice.value}
            />
            <span className="flex items-start justify-between gap-3">
              <strong className="text-sm">{choice.label}</strong>
              <span className={cn("mt-0.5 size-3 rounded-full border", dark ? "border-primary-foreground/40" : "border-foreground/35", value === choice.value && (dark ? "border-[#d7aa6d] bg-[#d7aa6d]" : "border-accent bg-accent"))} aria-hidden="true" />
            </span>
            <span className={cn("text-xs leading-5", dark ? "text-primary-foreground/60" : "text-muted-foreground")}>{choice.description}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function BehaviorPreview({ settings }: { settings: BehaviorSettings }) {
  return (
    <section className="overflow-hidden rounded-xl border border-foreground/20 bg-[#f4ead8]" data-behavior-preview>
      <div className="border-b border-foreground/15 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-mono text-[0.64rem] font-bold tracking-[0.1em] text-accent uppercase">Illustrative preview</p>
          <Badge className="border-accent/25 bg-background text-accent" variant="outline">Not a script</Badge>
        </div>
        <h2 className="mt-5 font-heading text-3xl leading-none tracking-[-0.04em]">A likely shape, not promised prose.</h2>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">Actual wording varies with the request, evidence, channel, and conversation.</p>
      </div>
      <div className="grid gap-px bg-foreground/15">
        <PreviewCard label="Evidence gap" body={evidencePreview(settings)} />
        <PreviewCard label="Slack presence" body={participationPreview(settings)} />
      </div>
    </section>
  );
}

function PreviewCard({ body, label }: { body: string; label: string }) {
  return (
    <article className="bg-card p-6">
      <p className="font-mono text-[0.58rem] font-bold tracking-[0.09em] text-muted-foreground uppercase">{label}</p>
      <p className="mt-4 text-sm leading-7 text-foreground/80">“{body}”</p>
    </article>
  );
}

function AuditLedger({ state }: { state: BehaviorSettingsState }) {
  return (
    <section className="rounded-xl border border-foreground/20 bg-card p-6" data-behavior-audit>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-[0.64rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">Change ledger</p>
        <Badge variant="outline">{state.source === "default" ? "Code defaults" : "Workspace override"}</Badge>
      </div>
      {state.audit.length === 0 ? (
        <p className="mt-6 text-sm leading-6 text-muted-foreground">No workspace override has been recorded. Paige is using the tested technical-editor defaults.</p>
      ) : (
        <ol className="mt-6 grid gap-5 border-l border-foreground/20 pl-5">
          {state.audit.map((event) => <AuditEvent event={event} key={event.id} />)}
        </ol>
      )}
    </section>
  );
}

function AuditEvent({ event }: { event: BehaviorSettingsAuditEvent }) {
  return (
    <li className="relative">
      <span className="absolute top-1.5 -left-[1.57rem] size-2 rounded-full bg-accent ring-4 ring-card" />
      <p className="text-sm font-semibold">@{event.actor.githubLogin}</p>
      <p className="mt-1 text-xs text-muted-foreground">{formatTimestamp(event.createdAt)}</p>
      <p className="mt-3 text-xs leading-5 text-foreground/70">{summarizeChanges(event)}</p>
    </li>
  );
}

function evidencePreview(settings: BehaviorSettings): string {
  const opening = settings.personality.directness === "direct"
    ? "I wouldn't publish this yet."
    : settings.personality.directness === "tactful"
      ? "I think we should pause before publishing this."
      : "I’d hold this change for now.";
  const warmth = settings.personality.warmth === "expressive"
    ? "Good catch bringing it up, though. "
    : settings.personality.warmth === "reserved"
      ? ""
      : "Thanks for flagging it. ";
  const pushback = settings.personality.pushback === "firm"
    ? "The claim would mislead readers without source evidence."
    : settings.personality.pushback === "light"
      ? "The claim still needs a stronger source."
      : "The smallest reader-safe outcome is to wait for source evidence.";
  const uncertainty = settings.personality.uncertaintyStyle === "escalate-early"
    ? "Can a product owner confirm the public behavior before I continue?"
    : settings.personality.uncertaintyStyle === "state-limits"
      ? "I can inspect the current page now, but I’ll keep the public claim out until the source is confirmed."
      : "If you can share the release note or source change, I can verify the docs next.";
  const detail = settings.personality.responseDepth === "thorough"
    ? " The discussion is useful provenance, but it does not prove the shipped API contract."
    : "";
  return `${warmth}${opening} ${pushback}${detail} ${uncertainty}`;
}

function participationPreview(settings: BehaviorSettings): string {
  const entry = settings.participation.slackEntry === "mentions-and-dms"
    ? "I enter through explicit mentions and direct messages"
    : settings.participation.slackEntry === "mentions-only"
      ? "I enter through explicit channel mentions, not direct messages"
      : "I enter through direct messages, not channel mentions";
  const continuation = settings.participation.slackContinuation === "relevant-only"
    ? "and keep an invited thread moving when I can add relevant help."
    : settings.participation.slackContinuation === "direct-only"
      ? "and continue invited threads only when addressed or directly followed up."
      : "and do not follow the thread after answering that entry message.";
  return `${entry} ${continuation}`;
}

function summarizeChanges(event: BehaviorSettingsAuditEvent): string {
  const labels: Record<string, string> = {
    responseDepth: "depth",
    directness: "directness",
    warmth: "warmth",
    pushback: "pushback",
    uncertaintyStyle: "uncertainty",
    slackEntry: "Slack entry",
    slackContinuation: "thread continuation",
  };
  const before = { ...event.previousSettings.personality, ...event.previousSettings.participation };
  const after = { ...event.nextSettings.personality, ...event.nextSettings.participation };
  const changes = Object.entries(after)
    .filter(([key, value]) => before[key as keyof typeof before] !== value)
    .map(([key, value]) => `${labels[key] ?? key} → ${String(value).replaceAll("-", " ")}`);
  return changes.length > 0 ? changes.join(" · ") : "Saved the existing structured settings.";
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
