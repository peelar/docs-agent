import { expect, test } from "@playwright/test";

test("opens a stable signal route from the queue", async ({ page }) => {
  await page.goto("/signals?scenario=ready");
  await page.getByRole("link", { name: "Private metadata filtering needs a focused conceptual docs update." }).click();

  await expect(page).toHaveURL(/\/signals\/signal-linear-metadata$/);
  await expect(page.getByRole("heading", { name: "Signal record", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Private metadata filtering needs a focused conceptual docs update." })).toBeVisible();
});

test("distinguishes summary, claims, and safely rendered source text", async ({ page }) => {
  await page.goto("/signals/signal-linear-metadata?scenario=ready");

  await expect(page.getByText("Verbatim source content")).toBeVisible();
  await expect(page.getByText("<script>window.__unsafe = true</script> Staff and apps need permission-aware guidance.")).toBeVisible();
  await expect(page.getByText("Privileged apps and staff can filter objects by private metadata.")).toBeVisible();
  await expect(page.getByText("Provider").locator("..").getByText("Linear")).toBeVisible();
  await expect(page.getByText("Marta, Kai")).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { __unsafe?: boolean }).__unsafe)).toBeUndefined();
});

test("renders ordered lifecycle history and every workflow artifact kind", async ({ page }) => {
  await page.goto("/signals/signal-linear-metadata?scenario=ready");

  const events = page.locator("[data-signal-event]");
  await expect(events).toHaveCount(3);
  await expect(events.nth(0)).toHaveAttribute("data-signal-event", "event-1");
  await expect(events.nth(2)).toHaveAttribute("data-signal-event", "event-3");

  for (const kind of ["verification-report", "check-log", "diff", "draft-pr"]) {
    await expect(page.locator(`[data-artifact-kind="${kind}"]`)).toBeVisible();
  }
  await expect(page.getByRole("link", { name: /Open artifact/ })).toHaveAttribute("href", "https://github.com/peelar/saleor-docs/pull/42");
  await expect(page.getByText(/Unsafe source · unavailable or unsafe URL/)).toBeVisible();

  const body = await page.locator("body").innerText();
  expect(body).not.toMatch(/lin_api_|xox[baprs]-|github_pat_/i);
  expect(body).toContain('"secretToken": "[redacted]"');
});

test("renders missing, corrupt, unauthorized, and database failures explicitly", async ({ page }) => {
  const states = [
    ["missing", "Signal not found"],
    ["corrupt", "Invalid signal record"],
    ["unauthorized", "Signal access denied"],
    ["database-error", "Signal database unavailable"],
  ] as const;

  for (const [scenario, heading] of states) {
    await page.goto(`/signals/example?scenario=${scenario}`);
    await expect(page.locator(`[data-signal-detail-state="${scenario}"]`)).toBeVisible();
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
});
