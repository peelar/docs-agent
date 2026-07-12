import { z } from "zod";

export const BEHAVIOR_SETTINGS_VERSION = 1;

export const responseDepthSchema = z.enum(["concise", "adaptive", "thorough"]);
export const directnessSchema = z.enum(["tactful", "balanced", "direct"]);
export const warmthSchema = z.enum(["reserved", "warm", "expressive"]);
export const pushbackSchema = z.enum(["light", "reader-advocate", "firm"]);
export const uncertaintyStyleSchema = z.enum([
  "state-limits",
  "ask-when-blocked",
  "escalate-early",
]);
export const slackEntryPolicySchema = z.enum([
  "mentions-and-dms",
  "mentions-only",
  "dms-only",
]);
export const slackContinuationPolicySchema = z.enum([
  "relevant-only",
  "direct-only",
  "off",
]);

export const personalitySettingsSchema = z.object({
  responseDepth: responseDepthSchema,
  directness: directnessSchema,
  warmth: warmthSchema,
  pushback: pushbackSchema,
  uncertaintyStyle: uncertaintyStyleSchema,
}).strict();

export const participationSettingsSchema = z.object({
  slackEntry: slackEntryPolicySchema,
  slackContinuation: slackContinuationPolicySchema,
}).strict();

export const behaviorSettingsSchema = z.object({
  personality: personalitySettingsSchema,
  participation: participationSettingsSchema,
}).strict();

export const behaviorSettingsActorSchema = z.object({
  id: z.string().trim().min(1),
  githubLogin: z.string().trim().min(1),
}).strict();

export const behaviorSettingsAuditEventSchema = z.object({
  id: z.string(),
  actor: behaviorSettingsActorSchema,
  previousSettings: behaviorSettingsSchema,
  nextSettings: behaviorSettingsSchema,
  createdAt: z.string(),
});

export const behaviorSettingsStateSchema = z.object({
  settings: behaviorSettingsSchema,
  source: z.enum(["default", "persisted"]),
  updatedAt: z.string().nullable(),
  updatedBy: behaviorSettingsActorSchema.nullable(),
  audit: z.array(behaviorSettingsAuditEventSchema),
});

export const saveBehaviorSettingsInputSchema = z.object({
  settings: behaviorSettingsSchema,
  actor: behaviorSettingsActorSchema,
}).strict();

export type BehaviorSettings = z.infer<typeof behaviorSettingsSchema>;
export type BehaviorSettingsActor = z.infer<typeof behaviorSettingsActorSchema>;
export type BehaviorSettingsAuditEvent = z.infer<
  typeof behaviorSettingsAuditEventSchema
>;
export type BehaviorSettingsState = z.infer<typeof behaviorSettingsStateSchema>;
export type ParticipationSettings = z.infer<typeof participationSettingsSchema>;

export const DEFAULT_BEHAVIOR_SETTINGS: BehaviorSettings = behaviorSettingsSchema.parse({
  personality: {
    responseDepth: "adaptive",
    directness: "balanced",
    warmth: "warm",
    pushback: "reader-advocate",
    uncertaintyStyle: "ask-when-blocked",
  },
  participation: {
    slackEntry: "mentions-and-dms",
    slackContinuation: "relevant-only",
  },
});

export function buildBehaviorInstructions(
  settings: BehaviorSettings,
): string | null {
  const parsed = behaviorSettingsSchema.parse(settings);
  const modifiers = [
    parsed.personality.responseDepth === DEFAULT_BEHAVIOR_SETTINGS.personality.responseDepth
      ? null
      : parsed.personality.responseDepth === "concise"
        ? "Keep ordinary answers compact unless the user asks for depth."
        : "Give fuller reasoning and context, while keeping the conclusion easy to scan.",
    parsed.personality.directness === DEFAULT_BEHAVIOR_SETTINGS.personality.directness
      ? null
      : parsed.personality.directness === "tactful"
        ? "Lead gently into disagreement and recommendations."
        : "State the conclusion and disagreement plainly before supporting detail.",
    parsed.personality.warmth === DEFAULT_BEHAVIOR_SETTINGS.personality.warmth
      ? null
      : parsed.personality.warmth === "reserved"
        ? "Use a restrained, professional conversational tone."
        : "Use an openly encouraging conversational tone without forced enthusiasm.",
    parsed.personality.pushback === DEFAULT_BEHAVIOR_SETTINGS.personality.pushback
      ? null
      : parsed.personality.pushback === "light"
        ? "Flag weak documentation choices briefly, then ask what the user prefers."
        : "Push back firmly when a request would mislead readers or weaken documentation quality.",
    parsed.personality.uncertaintyStyle ===
        DEFAULT_BEHAVIOR_SETTINGS.personality.uncertaintyStyle
      ? null
      : parsed.personality.uncertaintyStyle === "state-limits"
        ? "State uncertainty and assumptions, then proceed when the next step is reversible."
        : "Escalate uncertainty early instead of carrying a consequential ambiguity forward.",
  ].filter((value): value is string => value !== null);

  if (modifiers.length === 0) return null;
  return ["## Workspace Behavior Settings", "", ...modifiers.map((line) => `- ${line}`)]
    .join("\n");
}

export function slackEntryAllows(
  settings: ParticipationSettings,
  entry: "mention" | "direct-message",
): boolean {
  const parsed = participationSettingsSchema.parse(settings);
  if (parsed.slackEntry === "mentions-and-dms") return true;
  return parsed.slackEntry === "mentions-only"
    ? entry === "mention"
    : entry === "direct-message";
}

export function buildSlackContinuationPolicy(
  settings: ParticipationSettings,
  silentMarker: string,
): string | null {
  const parsed = participationSettingsSchema.parse(settings);
  if (parsed.slackContinuation === "off") return null;

  const participation = parsed.slackContinuation === "direct-only"
    ? "Reply only when the latest message addresses Paige or directly continues her latest exchange. Otherwise do not call tools and stay silent."
    : "Reply when the latest message directly continues the exchange, addresses Paige, or asks a documentation, product, API, release, or support question Paige can usefully answer.";
  return [
    "You are observing a Slack thread that explicitly invited Paige to participate.",
    participation,
    "Use capture_slack_docs_signal when an admitted message contains a plausible documentation concern, but do not create a signal for greetings, coordination, or unrelated chatter.",
    `When no reply would help, finish with exactly ${silentMarker} and no other text.`,
  ].join(" ");
}
