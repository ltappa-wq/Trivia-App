"use client";

import { useState } from "react";
import type { LeaderboardEntry } from "@/lib/db/types";
import { resultShareData, shareResult } from "@/lib/shareResult";

export function ShareResult({ standings, playerId }: { standings: LeaderboardEntry[]; playerId?: string | null }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function share() {
    setBusy(true);
    setMessage("");
    try {
      const result = await shareResult(resultShareData(standings, playerId, window.location.origin), navigator);
      setMessage(result === "copied" ? "Result copied!" : result === "shared" ? "Result shared!" : "");
    } catch { setMessage("Could not share or copy. Please try again."); }
    finally { setBusy(false); }
  }
  return <div className="share-result">
    <button type="button" onClick={() => void share()} disabled={busy}>Share result</button>
    <p role="status">{message}</p>
  </div>;
}
