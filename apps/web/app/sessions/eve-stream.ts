import type { HandleMessageStreamEvent } from "eve/client";

interface EveStreamInput {
  sessionId: string;
  signal?: AbortSignal;
  onEvent?: (event: HandleMessageStreamEvent) => void;
}

export async function collectEveEvents(
  input: EveStreamInput,
): Promise<HandleMessageStreamEvent[]> {
  const events: HandleMessageStreamEvent[] = [];
  await streamEveEvents({
    ...input,
    onEvent(event) {
      events.push(event);
      input.onEvent?.(event);
    },
  });
  return events;
}

export async function streamEveEvents(input: EveStreamInput): Promise<void> {
  const response = await fetch(
    `/eve/v1/session/${encodeURIComponent(input.sessionId)}/stream?startIndex=0`,
    {
      cache: "no-store",
      headers: { "x-paige-operator": "local" },
      signal: input.signal,
    },
  );
  if (!response.ok) {
    throw new Error(`Eve session activity is unavailable (${response.status}).`);
  }
  if (!response.body) throw new Error("Eve returned an empty session stream.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";

  while (true) {
    const { done, value } = await reader.read();
    pending += decoder.decode(value, { stream: !done });
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) emitLine(line, input.onEvent);
    if (done) break;
  }
  emitLine(pending, input.onEvent);
}

function emitLine(
  line: string,
  onEvent: EveStreamInput["onEvent"],
): void {
  const normalized = line.trim();
  if (normalized.length === 0) return;
  const value: unknown = JSON.parse(normalized);
  if (
    typeof value !== "object" ||
    value === null ||
    !("type" in value) ||
    typeof value.type !== "string"
  ) {
    throw new Error("Eve returned an invalid session event.");
  }
  onEvent?.(value as HandleMessageStreamEvent);
}
