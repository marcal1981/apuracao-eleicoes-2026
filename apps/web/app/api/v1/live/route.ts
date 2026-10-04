import { getIngestor } from "@/lib/server/ingestor";
import type { LiveEvent } from "@/lib/api-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Server-Sent Events: avisa os navegadores quando há novos dados, sem que eles consultem o TSE. */
export function GET(req: Request) {
  const ingestor = getIngestor();
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const onLive = (event: LiveEvent) => send(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      const heartbeat = setInterval(() => send(`: ping\n\n`), 25_000);
      cleanup = () => {
        clearInterval(heartbeat);
        ingestor.off("live", onLive);
      };
      ingestor.on("live", onLive);
      send(`retry: 5000\n\n`);
      onLive({ type: "status", timestamp: new Date().toISOString() });
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
