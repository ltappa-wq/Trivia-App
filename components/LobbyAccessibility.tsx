"use client";
import { useEffect, useRef } from "react";

/** A new room (including automatic rematch transfer) has a clear focus destination. */
export function LobbyAccessibility({ code }: { code: string }) {
  const status = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    status.current?.closest("main")?.querySelector<HTMLElement>("header h1")?.focus({ preventScroll: true });
  }, [code]);
  return <p ref={status} className="sr-only" role="status" aria-atomic="true">Room {code}. Lobby ready. The host will start the round.</p>;
}
