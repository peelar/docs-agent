import { expect, test } from "@playwright/test";

const defaultSettings = {
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
} as const;

test("shows structured defaults, representative previews, and permanent boundaries", async ({
  page,
}) => {
  await page.goto("/settings");
  const desk = page.locator("[data-behavior-settings]");

  await expect(page.getByRole("heading", { name: "Behavior settings" })).toBeVisible();
  await expect(desk.getByText("Voice and presence are not authority")).toBeVisible();
  await expect(desk.getByText(/No setting on this page can disable or widen them/)).toBeVisible();
  await expect(desk.locator("textarea")).toHaveCount(0);
  await expect(desk.locator('input[name="responseDepth"]:checked')).toHaveValue("adaptive");
  await expect(desk.locator('input[name="pushback"]:checked')).toHaveValue("reader-advocate");
  await expect(desk.locator('input[name="slackEntry"]:checked')).toHaveValue("mentions-and-dms");
  await expect(desk.locator('input[name="slackContinuation"]:checked')).toHaveValue("relevant-only");
  await expect(desk.locator("[data-behavior-preview]").getByText("Not a script")).toBeVisible();
  await expect(desk.getByText(/Actual wording varies/)).toBeVisible();
  await expect(desk.locator("[data-behavior-audit]").getByText("Code defaults")).toBeVisible();
});

test("previews and persists only supported personality and participation fields", async ({
  page,
}) => {
  let savedPayload: Record<string, unknown> | undefined;
  await page.route("**/api/operator/behavior-settings", async (route) => {
    savedPayload = route.request().postDataJSON() as Record<string, unknown>;
    const settings = savedPayload.settings;
    await route.fulfill({
      json: {
        saved: true,
        state: {
          settings,
          source: "persisted",
          updatedAt: "2026-07-12T09:00:00.000Z",
          updatedBy: { id: "docs-agent:github:1001", githubLogin: "testoperator" },
          audit: [{
            id: "event-test",
            actor: { id: "docs-agent:github:1001", githubLogin: "testoperator" },
            previousSettings: defaultSettings,
            nextSettings: settings,
            createdAt: "2026-07-12T09:00:00.000Z",
          }],
        },
      },
    });
  });

  await page.goto("/settings");
  const desk = page.locator("[data-behavior-settings]");
  await desk.getByText("Thorough", { exact: true }).click();
  await desk.getByText("Direct", { exact: true }).click();
  await desk.getByText("Reserved", { exact: true }).click();
  await desk.getByText("Firm", { exact: true }).click();
  await desk.getByText("Escalate early", { exact: true }).click();
  await desk.getByText("Mentions only", { exact: true }).click();
  await desk.getByText("Direct follow-ups", { exact: true }).click();

  const preview = desk.locator("[data-behavior-preview]");
  await expect(preview.getByText(/wouldn't publish this yet/)).toBeVisible();
  await expect(preview.getByText(/addresses Paige|directly followed up/)).toBeVisible();
  await desk.getByRole("button", { name: "Save behavior settings" }).click();
  await expect(desk.getByText("Behavior settings saved with your operator identity.")).toBeVisible();
  await expect(desk.locator("[data-behavior-audit]").getByText("@testoperator")).toBeVisible();

  expect(savedPayload).toEqual({
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
  });
  expect(JSON.stringify(savedPayload)).not.toMatch(/prompt|authority|approval|repository/i);
});

test("fails visibly when persisted settings cannot be loaded", async ({ page }) => {
  await page.goto("/settings?scenario=database-error");
  const desk = page.locator("[data-behavior-settings]");
  await expect(desk.getByText(/Behavior settings could not be loaded/)).toBeVisible();
  await expect(desk.getByRole("button", { name: "Save behavior settings" })).toBeDisabled();
});
