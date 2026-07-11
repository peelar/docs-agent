import { expect, test } from "@playwright/test";

const scenarios = [
  ["ready", "ready", "Ready to work."],
  ["partial", "attention", "Some paths still need proof."],
  ["unknown", "attention", "Some paths still need proof."],
  ["blocked", "blocked", "A known requirement is blocking work."],
  ["database-down", "blocked", "A known requirement is blocking work."],
  ["provider-down", "blocked", "A known requirement is blocking work."],
] as const;

for (const [scenario, overall, title] of scenarios) {
  test(`renders the ${scenario} readiness report`, async ({ page }) => {
    await page.goto(`/status?scenario=${scenario}`);

    await expect(page.getByRole("heading", { name: "Status", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.locator(`[data-readiness-overall="${overall}"]`)).toBeVisible();
    await expect(page.locator("[data-readiness-id]")).toHaveCount(6);
    await expect(page.getByText(/Last checked/)).toBeVisible();
  });
}

test("keeps unknown and reachable provider paths distinct from verified", async ({ page }) => {
  await page.goto("/status?scenario=partial");

  await expect(page.locator('[data-readiness-id="slack"]')).toHaveAttribute(
    "data-readiness-state",
    "reachable",
  );
  await expect(page.locator('[data-readiness-id="linear"]')).toHaveAttribute(
    "data-readiness-state",
    "configured",
  );
  await expect(page.getByText("Mention Paige in Slack and confirm the inbound event.")).toBeVisible();
});

test("renders actionable database and provider failures without secrets", async ({ page }) => {
  await page.goto("/status?scenario=database-down");
  await expect(page.getByText("Check DOCS_AGENT_DATABASE_URL and run pnpm db:migrate.")).toBeVisible();

  await page.goto("/status?scenario=provider-down");
  await expect(page.getByText("Check the Slack connector installation, then retry.")).toBeVisible();
  await expect(page.getByText("Check the Linear connector installation, then retry.")).toBeVisible();

  const body = await page.locator("body").innerText();
  expect(body).not.toMatch(/xox[baprs]-|lin_api_|github_pat_/i);
});
