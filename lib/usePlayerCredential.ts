"use client";
import { useEffect, useState } from "react";
import { loadPlayerCredential, type PlayerCredential } from "./clientSession";

/** Storage is browser-only. Keep SSR and the first hydration render identical. */
export function usePlayerCredential(code: string) {
  const [loaded, setLoaded] = useState<{ code: string; credential: PlayerCredential | null } | null>(null);
  useEffect(() => {
    let active = true;
    const credential = loadPlayerCredential(code);
    queueMicrotask(() => { if (active) setLoaded({ code, credential }); });
    return () => { active = false; };
  }, [code]);
  const ready = loaded?.code === code;
  return { ready, credential: ready ? loaded.credential : null };
}
