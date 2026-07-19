"use client";
// U9. Player results view (R15) — phone-first. Shares the unified GameOver
// podium + standings + feedback with the host end screen.

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { loadPlayerCredential } from "@/lib/clientSession";
import { useRoomState } from "@/lib/realtime/hooks";
import { GameOver } from "@/components/GameOver";

function ResultsView() {
  const params = useSearchParams();
  const code = (params.get("code") ?? "").toUpperCase();
  const cred = loadPlayerCredential(code);
  const token = cred?.token ?? null;

  const { state, error, loading } = useRoomState(code, token);

  if (!cred) return <main><p>Not in this game.</p></main>;
  if (loading) return <main aria-busy="true"><p>Tallying results…</p></main>;
  if (error) return <main><p role="alert">{error}</p></main>;

  return (
    <main>
      <GameOver
        standings={state?.leaderboard ?? []}
        myPlayerId={state?.player?.id}
        roomCode={code}
      />
    </main>
  );
}

export default function ResultsPage() {
  return (
    <Suspense>
      <ResultsView />
    </Suspense>
  );
}
