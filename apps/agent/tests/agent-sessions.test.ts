import assert from "node:assert/strict";

import { createClient } from "@libsql/client";
import type { Result } from "neverthrow";
import { describe, test } from "vitest";

import {
  sessionSourceForChannel,
  statusForLifecycleEvent,
} from "../agent/hooks/session-index";
import type { AgentSessionError } from "../sessions/errors";
import { AgentSessionService } from "../sessions/service";
import { LibsqlAgentSessionStore } from "../sessions/store";
import { agentSessionTitle } from "../sessions/title";

describe("agent session registry", () => {
  test("enriches an earlier lifecycle row without rolling status backward", async () => {
    const store = createStore();
    unwrap(await store.updateLifecycle({
      sessionId: "ses_1",
      status: "running",
      occurredAt: "2026-07-17T08:00:00.000Z",
    }));
    unwrap(await store.updateLifecycle({
      sessionId: "ses_1",
      status: "waiting",
      occurredAt: "2026-07-17T08:01:00.000Z",
    }));

    assert.deepEqual(unwrap(await store.list()), []);

    const registered = await store.register({
      sessionId: "ses_1",
      source: "slack",
      firstMessage: "  Please   review the release notes.  ",
      registeredAt: "2026-07-17T08:02:00.000Z",
    });

    assert.deepEqual(unwrap(registered), {
      sessionId: "ses_1",
      source: "slack",
      title: "Please review the release notes.",
      status: "waiting",
      startedAt: "2026-07-17T08:00:00.000Z",
      updatedAt: "2026-07-17T08:01:00.000Z",
    });
  });

  test("keeps the first title and filters sources by recent activity", async () => {
    const store = createStore();
    await store.register({
      sessionId: "ses_slack",
      source: "slack",
      firstMessage: "Slack title",
      registeredAt: "2026-07-17T08:00:00.000Z",
    });
    await store.register({
      sessionId: "ses_web",
      source: "local-web",
      firstMessage: "Local title",
      registeredAt: "2026-07-17T09:00:00.000Z",
    });
    await store.register({
      sessionId: "ses_web",
      source: "local-web",
      firstMessage: "Replacement title",
      registeredAt: "2026-07-17T10:00:00.000Z",
    });

    assert.deepEqual(
      unwrap(await store.list()).map(({ sessionId }) => sessionId),
      ["ses_web", "ses_slack"],
    );
    assert.deepEqual(
      unwrap(await store.list({ source: "slack" })).map(({ sessionId }) =>
        sessionId
      ),
      ["ses_slack"],
    );
    assert.equal(unwrap(await store.get("ses_web"))?.title, "Local title");
  });
});

describe("agent session lifecycle", () => {
  test("uses session boundaries for terminal status", () => {
    assert.equal(statusForLifecycleEvent("session.started"), "running");
    assert.equal(statusForLifecycleEvent("turn.started"), "running");
    assert.equal(statusForLifecycleEvent("turn.completed"), undefined);
    assert.equal(statusForLifecycleEvent("turn.failed"), undefined);
    assert.equal(statusForLifecycleEvent("session.waiting"), "waiting");
    assert.equal(statusForLifecycleEvent("session.completed"), "completed");
    assert.equal(statusForLifecycleEvent("session.failed"), "failed");
  });

  test("indexes Chat SDK sessions as Slack and ignores other channels", () => {
    assert.equal(sessionSourceForChannel("chat-sdk"), "slack");
    assert.equal(sessionSourceForChannel("http"), undefined);
    assert.equal(sessionSourceForChannel(undefined), undefined);
  });
});

test("session titles stay compact", () => {
  assert.equal(agentSessionTitle("\n\t"), "Untitled session");
  assert.equal(agentSessionTitle("word ".repeat(30)).length, 80);
});

function createStore(): AgentSessionService {
  return new AgentSessionService(
    new LibsqlAgentSessionStore(createClient({ url: ":memory:" })),
  );
}

function unwrap<T>(result: Result<T, AgentSessionError>): T {
  if (result.isErr()) throw result.error;
  return result.value;
}
