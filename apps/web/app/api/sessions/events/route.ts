import { agentSessionStore } from "../../../../../agent/sessions/database";
import {
  isOperatorAccessFailure,
  localOperatorAccess,
} from "@/operator-access";

export const dynamic = "force-dynamic";

const encoder = new TextEncoder();
const pollIntervalMs = 2_000;
const keepAliveIntervalMs = 15_000;

export function GET(request: Request): Response {
  const access = localOperatorAccess(request);
  if (isOperatorAccessFailure(access)) {
    return Response.json(
      { error: access.error },
      { status: access.status, headers: { "cache-control": "no-store" } },
    );
  }

  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let previousSnapshot = "";
  let lastWriteAt = 0;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const stop = () => {
        active = false;
        if (timer !== undefined) clearTimeout(timer);
      };
      request.signal.addEventListener("abort", stop, { once: true });

      const poll = async () => {
        if (!active) return;
        try {
          const snapshot = JSON.stringify(await agentSessionStore().list());
          const now = Date.now();
          if (snapshot !== previousSnapshot) {
            controller.enqueue(encoder.encode(
              `event: sessions\ndata: ${snapshot}\n\n`,
            ));
            previousSnapshot = snapshot;
            lastWriteAt = now;
          } else if (now - lastWriteAt >= keepAliveIntervalMs) {
            controller.enqueue(encoder.encode(": keep-alive\n\n"));
            lastWriteAt = now;
          }
          timer = setTimeout(() => void poll(), pollIntervalMs);
        } catch (error) {
          stop();
          controller.error(error);
        }
      };

      void poll();
    },
    cancel() {
      active = false;
      if (timer !== undefined) clearTimeout(timer);
    },
  });

  return new Response(stream, {
    headers: {
      "cache-control": "no-cache, no-transform",
      "content-type": "text/event-stream; charset=utf-8",
      connection: "keep-alive",
    },
  });
}
