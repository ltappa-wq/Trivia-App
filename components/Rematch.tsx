"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createRematch, joinRematch } from "@/app/actions/rematch";
import { loadHostCredential, loadPlayerCredential, saveHostCredential, savePlayerCredential } from "@/lib/clientSession";

/** Mounted only on end screens; broadcast reconciliation and reload use the same path. */
export function Rematch({ code, rematchCode, host = false }: {
  code: string; rematchCode?: string | null; host?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function move() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      if (host) {
        const old = loadHostCredential(code);
        if (!old) throw new Error("Host credential unavailable");
        const next = await createRematch(code, old.token);
        // Save host identity before seating: a failed transfer can safely retry.
        saveHostCredential({ gameId: next.gameId, code: next.code, token: next.hostToken });
        if (old.playerToken) {
          const player = await joinRematch(code, old.playerToken);
          savePlayerCredential(player);
          saveHostCredential({ gameId: next.gameId, code: next.code, token: next.hostToken,
            playerToken: player.token, username: player.username });
        }
        router.replace(`/host?code=${encodeURIComponent(next.code)}`);
      } else {
        const old = loadPlayerCredential(code);
        if (!old) throw new Error("Player credential unavailable");
        const next = await joinRematch(code, old.token);
        savePlayerCredential(next);
        router.replace(`/play?code=${encodeURIComponent(next.code)}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not join rematch");
      inFlight.current = false;
      setBusy(false);
    }
  }
  const moveRef = useRef(move);
  useEffect(() => { moveRef.current = move; });
  useEffect(() => {
    if (rematchCode) void moveRef.current();
  }, [rematchCode]);

  return <section aria-label="Rematch">
    <p role="status" aria-atomic="true">{busy ? "Joining the next game. Please wait." : ""}</p>
    {(host || rematchCode) && <button type="button" disabled={busy} onClick={() => void move()}>
      {busy ? "Joining next game…" : host ? "Play again (same players)" : "Join next game"}
    </button>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
