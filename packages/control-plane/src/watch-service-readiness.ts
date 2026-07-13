import { z } from "zod";

import { requireSetupReady, SetupRequiredError } from "./setup-state.ts";
import {
  watchCapabilityFamilySchema,
  type WatchCapabilityFamily,
} from "./watch-contract.ts";

export const WATCH_CAPABILITY_REGISTRY_VERSION = 1;

export const watchCapabilityRegistrySchema = z.object({
  version: z.literal(WATCH_CAPABILITY_REGISTRY_VERSION),
  status: z.literal("ready"),
  availableCapabilities: z.array(watchCapabilityFamilySchema).max(6),
}).strict().superRefine(({ availableCapabilities }, context) => {
  if (new Set(availableCapabilities).size !== availableCapabilities.length) {
    context.addIssue({
      code: "custom",
      path: ["availableCapabilities"],
      message: "Capability registry entries must be unique.",
    });
  }
});

export const watchServiceContextSchema = z.object({
  capabilityRegistry: watchCapabilityRegistrySchema,
  now: z.date().optional(),
});

export type WatchCapabilityRegistry = z.infer<typeof watchCapabilityRegistrySchema>;
export type WatchServiceContext = z.infer<typeof watchServiceContextSchema>;

export class WatchServiceUnavailableError extends Error {
  readonly code: "capability-registry-unavailable" | "workspace-setup-unavailable";

  constructor(
    code: WatchServiceUnavailableError["code"],
    message: string,
  ) {
    super(message);
    this.name = "WatchServiceUnavailableError";
    this.code = code;
  }
}

export async function requireWatchServiceReady(
  context: unknown,
): Promise<WatchServiceContext> {
  const parsed = parseWatchServiceContext(context);
  try {
    await requireSetupReady("docs-maintenance");
  } catch (error) {
    if (error instanceof SetupRequiredError) {
      throw new WatchServiceUnavailableError(
        "workspace-setup-unavailable",
        "Watch services require a valid canonical workspace setup.",
      );
    }
    throw error;
  }
  return parsed;
}

export function parseWatchServiceContext(context: unknown): WatchServiceContext {
  const parsed = watchServiceContextSchema.safeParse(context);
  if (!parsed.success) {
    throw new WatchServiceUnavailableError(
      "capability-registry-unavailable",
      "Watch services require a ready server-owned capability registry.",
    );
  }
  return parsed.data;
}

export function availableWatchCapabilities(
  context: WatchServiceContext,
): WatchCapabilityFamily[] {
  return context.capabilityRegistry.availableCapabilities;
}
