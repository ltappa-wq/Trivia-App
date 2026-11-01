"use client";

import { useEffect, useSyncExternalStore } from "react";
import { gameSound } from "@/lib/sound";
import type { MyAnswer } from "@/lib/db/types";

export function SoundToggle() {
  const muted = useSyncExternalStore(gameSound.subscribe, gameSound.isMuted, () => false);
  useEffect(() => {
    const unlock = () => gameSound.unlock();
    window.addEventListener("pointerdown", unlock, { capture: true });
    window.addEventListener("keydown", unlock, { capture: true });
    return () => {
      window.removeEventListener("pointerdown", unlock, { capture: true });
      window.removeEventListener("keydown", unlock, { capture: true });
    };
  }, []);
  return <button type="button" className="sound-toggle" aria-pressed={!muted}
    onClick={() => gameSound.setMuted(!muted)}>
    {muted ? "🔇 Sound & haptics off" : "🔊 Sound & haptics on"}
  </button>;
}

export function GameFeedback({ phase, remaining, roundKey, answer, voided, spectating }: {
  phase: string; remaining: number | null; roundKey: string; answer: MyAnswer | null;
  voided: boolean; spectating: boolean;
}) {
  const seconds = remaining === null ? null : Math.ceil(remaining / 1000);
  useEffect(() => {
    if (phase === "question" && seconds !== null && seconds >= 1 && seconds <= 3)
      gameSound.play("tick", `${roundKey}:tick:${seconds}`);
  }, [phase, seconds, roundKey]);
  useEffect(() => {
    if (phase !== "review" || voided || spectating) return;
    const cue = answer?.is_correct ? "correct" : "wrong";
    gameSound.play(cue, `${roundKey}:result:${cue}`);
    gameSound.haptic(cue, `${roundKey}:result:${cue}`);
  }, [phase, roundKey, answer?.is_correct, voided, spectating]);
  return null;
}
