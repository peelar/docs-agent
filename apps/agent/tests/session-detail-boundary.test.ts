import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("session activity detail", () => {
  it("stays read-only and explains the Slack boundary", async () => {
    const source = await readFile(
      new URL(
        "../../web/app/sessions/[sessionId]/session-detail.tsx",
        import.meta.url,
      ),
      "utf8",
    );

    expect(source).toContain(
      "Agent activity, not a complete Slack transcript",
    );
    expect(source).not.toMatch(/<form|Textarea|contentEditable|onSubmit|onRespond/);
  });
});
