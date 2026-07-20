import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("session activity detail", () => {
  it("stays read-only without exposing transport details", async () => {
    const source = await readFile(
      new URL(
        "../../web/app/sessions/[sessionId]/session-detail.tsx",
        import.meta.url,
      ),
      "utf8",
    );

    expect(source).not.toContain("Agent activity, not a complete Slack transcript");
    expect(source).not.toContain("Stream unavailable");
    expect(source).toContain("SlackIcon");
    expect(source).not.toMatch(/<form|Textarea|contentEditable|onSubmit|onRespond/);
  });
});
