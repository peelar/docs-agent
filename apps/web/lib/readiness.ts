import "server-only";

import {
  getReadinessReport,
  readinessReportSchema,
  type ReadinessItem,
  type ReadinessReport,
  type ReadinessState,
} from "@docs-agent/control-plane";

const TEST_SCENARIO_ENV = "DOCS_AGENT_READINESS_TEST_SCENARIOS";
const checkedAt = "2026-07-11T12:00:00.000Z";

export async function resolveReadinessReport(
  requestedScenario?: string,
): Promise<ReadinessReport> {
  if (process.env[TEST_SCENARIO_ENV] === "1") {
    return readinessFixture(requestedScenario ?? "partial");
  }

  return getReadinessReport();
}

function readinessFixture(scenario: string): ReadinessReport {
  const items = readyItems();

  switch (scenario) {
    case "ready":
      break;
    case "partial":
      replace(items, "slack", fixtureItem("slack", "reachable", false, {
        summary: "Slack is reachable; inbound delivery has not been verified.",
        nextAction: "Mention Paige in Slack and confirm the inbound event.",
      }));
      replace(items, "linear", fixtureItem("linear", "configured", false, {
        summary: "Linear is configured but has not passed a provider check.",
        nextAction: "Run the Linear provider check, then delegate a test issue.",
      }));
      break;
    case "unknown":
      for (const item of items) {
        Object.assign(item, {
          state: "unknown" satisfies ReadinessState,
          ready: false,
          summary: `No supported check has established ${item.label.toLowerCase()} readiness.`,
          nextAction: "Run the documented manual verification action.",
        });
      }
      break;
    case "blocked":
      replace(items, "github-writeback", fixtureItem("github-writeback", "blocked", false, {
        summary: "The GitHub App is not granted to the working repository.",
        nextAction: "Grant the app access to the repository, then retry preflight.",
      }));
      break;
    case "database-down":
      replace(items, "database", fixtureItem("database", "blocked", false, {
        summary: "The application database could not be reached.",
        nextAction: "Check DOCS_AGENT_DATABASE_URL and run pnpm db:migrate.",
      }));
      break;
    case "provider-down":
      replace(items, "slack", fixtureItem("slack", "blocked", false, {
        summary: "Slack auth.test could not reach the provider.",
        nextAction: "Check the Slack connector installation, then retry.",
      }));
      replace(items, "linear", fixtureItem("linear", "blocked", false, {
        summary: "The Linear viewer query returned a provider error.",
        nextAction: "Check the Linear connector installation, then retry.",
      }));
      break;
    default:
      return readinessFixture("partial");
  }

  return readinessReportSchema.parse({
    checkedAt,
    overall: items.every(({ ready }) => ready)
      ? "ready"
      : items.some(({ state }) => state === "blocked")
        ? "blocked"
        : "attention",
    items,
  });
}

function readyItems(): ReadinessItem[] {
  return [
    fixtureItem("database", "verified", true),
    fixtureItem("working-repository", "verified", true),
    fixtureItem("github-writeback", "verified", true),
    fixtureItem("slack", "verified", true),
    fixtureItem("linear", "verified", true),
    fixtureItem("eve-runtime", "verified", true),
  ];
}

const labels = {
  database: "Application database",
  "working-repository": "Working repository",
  "github-writeback": "GitHub writeback",
  slack: "Slack channel",
  linear: "Linear channel",
  "eve-runtime": "Eve runtime",
} as const;

function fixtureItem(
  id: keyof typeof labels,
  state: ReadinessState,
  ready: boolean,
  overrides: Partial<ReadinessItem> = {},
): ReadinessItem {
  return {
    id,
    label: labels[id],
    state,
    ready,
    summary: `${labels[id]} passed its explicit capability check.`,
    source: `Deterministic ${labels[id].toLowerCase()} readiness fixture`,
    lastCheckedAt: checkedAt,
    nextAction: ready ? null : "Complete the documented verification action.",
    detail: [],
    ...overrides,
  };
}

function replace(
  items: ReadinessItem[],
  id: ReadinessItem["id"],
  replacement: ReadinessItem,
): void {
  const index = items.findIndex((item) => item.id === id);
  items[index] = replacement;
}
