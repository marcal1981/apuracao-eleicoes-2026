"use client";

import { useEffect, useRef, useState } from "react";
import type { LiveEvent } from "@/lib/api-types";

export type LiveConnection = "connecting" | "open" | "closed";

/** Assina o canal SSE da plataforma. Uma única conexão por aba. */
export function useLive(onEvent: (event: LiveEvent) => void): LiveConnection {
  const [state, setState] = useState<LiveConnection>("connecting");
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    const source = new EventSource("/api/v1/live");
    const dispatch = (e: MessageEvent<string>) => {
      try {
        handler.current(JSON.parse(e.data) as LiveEvent);
      } catch {}
    };
    source.onopen = () => setState("open");
    source.onerror = () => setState(source.readyState === EventSource.CLOSED ? "closed" : "connecting");
    source.addEventListener("result_update", dispatch);
    source.addEventListener("status", dispatch);
    source.addEventListener("municipal_update", dispatch);
    return () => source.close();
  }, []);

  return state;
}
