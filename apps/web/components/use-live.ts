"use client";

import { useEffect, useRef, useState } from "react";
import type { LiveEvent } from "@/lib/api-types";

export type LiveConnection = "connecting" | "open" | "closed";

// Uma única conexão SSE por aba, compartilhada por todos os componentes.
// (O navegador permite só ~6 conexões simultâneas por site; uma conexão por componente
// esgotava esse limite e as demais requisições da página ficavam esperando.)
type Listener = (event: LiveEvent) => void;
const listeners = new Set<Listener>();
const stateListeners = new Set<(s: LiveConnection) => void>();
let source: EventSource | null = null;
let state: LiveConnection = "connecting";

function setState(next: LiveConnection) {
  state = next;
  for (const l of stateListeners) l(next);
}

function connect() {
  if (source || typeof window === "undefined") return;
  source = new EventSource("/api/v1/live");
  const dispatch = (e: MessageEvent<string>) => {
    let event: LiveEvent;
    try {
      event = JSON.parse(e.data) as LiveEvent;
    } catch {
      return;
    }
    for (const l of listeners) l(event);
  };
  source.onopen = () => setState("open");
  source.onerror = () => setState(source?.readyState === EventSource.CLOSED ? "closed" : "connecting");
  source.addEventListener("result_update", dispatch);
  source.addEventListener("status", dispatch);
  source.addEventListener("municipal_update", dispatch);
}

function disconnectIfUnused() {
  if (listeners.size === 0 && source) {
    source.close();
    source = null;
    state = "connecting";
  }
}

/** Assina os avisos em tempo real da plataforma (conexão compartilhada pela aba inteira). */
export function useLive(onEvent: (event: LiveEvent) => void): LiveConnection {
  const [connection, setConnection] = useState<LiveConnection>(state);
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    const listener: Listener = (event) => handler.current(event);
    listeners.add(listener);
    stateListeners.add(setConnection);
    connect();
    setConnection(state);
    return () => {
      listeners.delete(listener);
      stateListeners.delete(setConnection);
      disconnectIfUnused();
    };
  }, []);

  return connection;
}
