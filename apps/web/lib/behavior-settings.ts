import "server-only";

import {
  behaviorSettingsStateSchema,
  DEFAULT_BEHAVIOR_SETTINGS,
  readBehaviorSettings,
  type BehaviorSettingsState,
} from "@docs-agent/control-plane";

const TEST_SCENARIO_ENV = "DOCS_AGENT_BEHAVIOR_TEST_SCENARIOS";

export type BehaviorSettingsInitialState = {
  state: BehaviorSettingsState;
  error: string | null;
};

export async function resolveBehaviorSettingsInitialState(
  requestedScenario?: string,
): Promise<BehaviorSettingsInitialState> {
  if (process.env[TEST_SCENARIO_ENV] === "1") {
    if (requestedScenario === "database-error") {
      return {
        state: defaultState(),
        error:
          "Behavior settings could not be loaded. Restore database access and apply committed migrations before saving changes.",
      };
    }
    return {
      state: requestedScenario === "tuned" ? tunedState() : defaultState(),
      error: null,
    };
  }

  try {
    return { state: await readBehaviorSettings(), error: null };
  } catch {
    return {
      state: defaultState(),
      error:
        "Behavior settings could not be loaded. Restore database access and apply committed migrations before saving changes.",
    };
  }
}

function defaultState(): BehaviorSettingsState {
  return behaviorSettingsStateSchema.parse({
    settings: DEFAULT_BEHAVIOR_SETTINGS,
    source: "default",
    updatedAt: null,
    updatedBy: null,
    audit: [],
  });
}

function tunedState(): BehaviorSettingsState {
  return behaviorSettingsStateSchema.parse({
    settings: {
      personality: {
        responseDepth: "thorough",
        directness: "direct",
        warmth: "reserved",
        pushback: "firm",
        uncertaintyStyle: "escalate-early",
      },
      participation: {
        slackEntry: "mentions-only",
        slackContinuation: "direct-only",
      },
    },
    source: "persisted",
    updatedAt: "2026-07-12T08:00:00.000Z",
    updatedBy: { id: "operator-101", githubLogin: "docs-owner" },
    audit: [{
      id: "behavior-event-1",
      actor: { id: "operator-101", githubLogin: "docs-owner" },
      previousSettings: DEFAULT_BEHAVIOR_SETTINGS,
      nextSettings: {
        personality: {
          responseDepth: "thorough",
          directness: "direct",
          warmth: "reserved",
          pushback: "firm",
          uncertaintyStyle: "escalate-early",
        },
        participation: {
          slackEntry: "mentions-only",
          slackContinuation: "direct-only",
        },
      },
      createdAt: "2026-07-12T08:00:00.000Z",
    }],
  });
}
