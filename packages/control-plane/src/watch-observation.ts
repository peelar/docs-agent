import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  effectiveWatchRevisionSchema,
  watchSourceSchema,
  type EffectiveWatchRevision,
} from "./watch-contract.ts";

export const WATCH_OBSERVATION_CONTRACT_VERSION = 1;

const identifierSchema = z.string().trim().min(1).max(500);
const securePermalinkSchema = z.url().superRefine((value, context) => {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") {
    context.addIssue({
      code: "custom",
      message: "Observation permalinks must use HTTPS and cannot contain credentials.",
    });
  }
});

export const watchObservationActorSchema = z.object({
  kind: z.enum(["user", "bot", "system"]),
  id: identifierSchema,
}).strict();

export const watchObservationThreadReferenceSchema = z.object({
  id: identifierSchema,
  rootEventId: identifierSchema,
}).strict();

export const watchObservationProvenanceSchema = z.object({
  ingress: z.literal("provider-adapter"),
  providerWorkspaceId: identifierSchema,
  providerEventId: identifierSchema,
  providerDeliveryId: identifierSchema.optional(),
  receivedAt: z.string().datetime({ offset: true }),
  adapter: z.object({
    name: z.string().trim().regex(/^[a-z][a-z0-9-]*$/).max(100),
    version: z.string().trim().min(1).max(100),
  }).strict(),
}).strict();

export const watchObservationContentSchema = z.object({
  text: z.string().min(1).max(100_000),
  mediaType: z.literal("text/plain"),
  characterCount: z.number().int().positive().max(100_000),
  storage: z.literal("ephemeral"),
  retentionSeconds: z.number().int().min(0).max(604_800),
}).strict().superRefine(({ text, characterCount }, context) => {
  if (unicodeCharacterCount(text) !== characterCount) {
    context.addIssue({
      code: "custom",
      path: ["characterCount"],
      message: "Observation character count does not match its ephemeral content.",
    });
  }
});

export const ephemeralWatchObservationSchema = z.object({
  contractVersion: z.literal(WATCH_OBSERVATION_CONTRACT_VERSION),
  id: z.string().uuid(),
  watchId: z.string().uuid(),
  effectiveRevisionId: z.string().uuid(),
  source: watchSourceSchema,
  actor: watchObservationActorSchema,
  occurredAt: z.string().datetime({ offset: true }),
  eventType: identifierSchema,
  thread: watchObservationThreadReferenceSchema.nullable(),
  permalink: securePermalinkSchema,
  provenance: watchObservationProvenanceSchema,
  content: watchObservationContentSchema,
  disposition: z.literal("candidate-context-only"),
}).strict();

export const createEphemeralWatchObservationInputSchema = z.object({
  watchId: z.string().uuid(),
  effectiveRevisionId: z.string().uuid(),
  source: watchSourceSchema,
  actor: watchObservationActorSchema,
  occurredAt: z.string().datetime({ offset: true }),
  eventType: identifierSchema,
  thread: watchObservationThreadReferenceSchema.nullable(),
  permalink: securePermalinkSchema,
  provenance: watchObservationProvenanceSchema,
  content: z.object({
    text: z.string().min(1).max(100_000),
    mediaType: z.literal("text/plain").default("text/plain"),
  }).strict(),
}).strict();

export const redactedWatchObservationSchema = ephemeralWatchObservationSchema
  .omit({ content: true })
  .extend({
    content: z.object({
      characterCount: z.number().int().positive(),
      storage: z.literal("ephemeral"),
      retentionSeconds: z.number().int().min(0),
      redacted: z.literal(true),
    }).strict(),
  })
  .strict();

export type EphemeralWatchObservation = z.infer<typeof ephemeralWatchObservationSchema>;
export type RedactedWatchObservation = z.infer<typeof redactedWatchObservationSchema>;

export function createEphemeralWatchObservation(
  input: z.input<typeof createEphemeralWatchObservationInputSchema>,
  effectiveRevisionInput: EffectiveWatchRevision,
): EphemeralWatchObservation {
  const parsed = createEphemeralWatchObservationInputSchema.parse(input);
  const effectiveRevision = effectiveWatchRevisionSchema.parse(
    effectiveRevisionInput,
  );
  if (
    parsed.watchId !== effectiveRevision.watchId ||
    parsed.effectiveRevisionId !== effectiveRevision.id
  ) {
    throw new WatchObservationContractError(
      "revision-mismatch",
      "Observation authority does not match the supplied effective watch revision.",
    );
  }
  if (stable(parsed.source) !== stable(effectiveRevision.policy.source)) {
    throw new WatchObservationContractError(
      "source-mismatch",
      "Observation source is outside the effective watch policy.",
    );
  }
  if (!effectiveRevision.policy.context.eventTypes.includes(parsed.eventType)) {
    throw new WatchObservationContractError(
      "event-not-admitted",
      "Observation event type is outside the effective watch context policy.",
    );
  }
  const characterCount = unicodeCharacterCount(parsed.content.text);
  if (characterCount > effectiveRevision.policy.context.maxCharacters) {
    throw new WatchObservationContractError(
      "context-over-budget",
      `Observation content exceeds the effective context limit of ${effectiveRevision.policy.context.maxCharacters} characters.`,
    );
  }
  const expiresAt = effectiveRevision.policy.expiresAt;
  if (
    expiresAt === null ||
    new Date(parsed.occurredAt).getTime() >= new Date(expiresAt).getTime()
  ) {
    throw new WatchObservationContractError(
      "revision-expired",
      "Observation occurred after the effective watch revision expired.",
    );
  }

  return ephemeralWatchObservationSchema.parse({
    contractVersion: WATCH_OBSERVATION_CONTRACT_VERSION,
    id: randomUUID(),
    watchId: parsed.watchId,
    effectiveRevisionId: parsed.effectiveRevisionId,
    source: parsed.source,
    actor: parsed.actor,
    occurredAt: parsed.occurredAt,
    eventType: parsed.eventType,
    thread: parsed.thread,
    permalink: parsed.permalink,
    provenance: parsed.provenance,
    content: {
      text: parsed.content.text,
      mediaType: parsed.content.mediaType,
      characterCount,
      storage: "ephemeral",
      retentionSeconds: effectiveRevision.policy.retention.rawObservationSeconds,
    },
    disposition: "candidate-context-only",
  });
}

export function redactWatchObservation(
  input: EphemeralWatchObservation,
): RedactedWatchObservation {
  const observation = ephemeralWatchObservationSchema.parse(input);
  const { content, ...metadata } = observation;
  return redactedWatchObservationSchema.parse({
    ...metadata,
    content: {
      characterCount: content.characterCount,
      storage: content.storage,
      retentionSeconds: content.retentionSeconds,
      redacted: true,
    },
  });
}

export class WatchObservationContractError extends Error {
  readonly code:
    | "revision-mismatch"
    | "source-mismatch"
    | "event-not-admitted"
    | "context-over-budget"
    | "revision-expired";

  constructor(code: WatchObservationContractError["code"], message: string) {
    super(message);
    this.name = "WatchObservationContractError";
    this.code = code;
  }
}

function unicodeCharacterCount(value: string): number {
  return Array.from(value).length;
}

function stable(value: unknown): string {
  return JSON.stringify(value);
}
