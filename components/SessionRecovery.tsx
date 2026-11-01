"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listCredentials, loadPlayerCredential, clearCredential, hostRecoveryUrl, type HostCredential, type PlayerCredential } from "@/lib/clientSession";
import { hydrate } from "@/lib/realtime/channel";

export function SessionRecovery({ code }: { code?: string }) {
  const [offers, setOffers] = useState<{ kind: "host" | "player"; cred: HostCredential | PlayerCredential }[]>([]);
  useEffect(() => {
    let active = true;
    const candidates = code === undefined
      ? (["host", "player"] as const).flatMap(kind => listCredentials(kind).map(cred => ({ kind, cred })))
      : [loadPlayerCredential(code)].filter((cred): cred is PlayerCredential => !!cred).map(cred => ({ kind: "player" as const, cred }));
    void Promise.all(candidates.map(async offer => {
      try {
        const state = await hydrate(offer.cred.token);
        // Keep ended credentials for results/feedback, but never offer recovery.
        if (state?.game.status === "ended") return null;
        if (!state || state.game.code !== offer.cred.code ||
          (offer.kind === "host" && state.role !== "host")) {
          clearCredential(offer.kind, offer.cred.code); return null;
        }
        return offer;
      } catch { return null; } // Offline is not evidence of revocation.
    })).then(results => { if (active) setOffers(results.filter(v => v !== null)); });
    return () => { active = false; };
  }, [code]);
  const visible = offers.filter(o => code === undefined || o.cred.code === code);
  return <div aria-label="Saved games">{visible.map(({ kind, cred }) =>
    <p key={`${kind}:${cred.code}`}><Link href={`/${kind === "host" ? "host" : "play"}?code=${encodeURIComponent(cred.code)}`}>
      {kind === "host" ? `Resume hosting room ${cred.code}` : code === undefined ? `Rejoin room ${cred.code} as ${cred.username}` : `Rejoin as ${cred.username}`}
    </Link></p>)}</div>;
}

export function SaveHostLink({ credential }: { credential: HostCredential }) {
  const [message, setMessage] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(hostRecoveryUrl(window.location.origin, credential));
      setMessage("Host link copied. Keep it private.");
    } catch { setMessage("Could not copy. Allow clipboard access and try again."); }
  }
  return <section>
    <button type="button" onClick={() => void copy()}>Save host link</button>
    <p>Keep this recovery link private: anyone with the link can control the game. Save it to resume on another device.</p>
    {message && <p role="status">{message}</p>}
  </section>;
}
