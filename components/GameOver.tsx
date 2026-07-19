"use client";
// Unified end screen for host and player: podium, full standings, home CTA,
// and optional feedback form (emailed via submitFeedback).

import { useState } from "react";
import Link from "next/link";
import { Podium } from "@/components/Podium";
import type { LeaderboardEntry } from "@/lib/db/types";
import { formatScore } from "@/lib/formatScore";
import { describeWinners, sortStandings } from "@/lib/results";
import { submitFeedback } from "@/app/actions/submitFeedback";

export function GameOver({
  standings,
  myPlayerId,
  roomCode,
}: {
  standings: LeaderboardEntry[];
  myPlayerId?: string | null;
  roomCode?: string;
}) {
  const sorted = sortStandings(standings);
  const { winnerIds, label } = describeWinners(sorted);
  const myRank = myPlayerId ? sorted.findIndex((p) => p.id === myPlayerId) + 1 : 0;
  const iWon = myPlayerId ? winnerIds.has(myPlayerId) : false;

  const [feedback, setFeedback] = useState("");
  const [fbStatus, setFbStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [fbError, setFbError] = useState<string | null>(null);

  async function sendFeedback(e: React.FormEvent) {
    e.preventDefault();
    setFbStatus("sending");
    setFbError(null);
    try {
      await submitFeedback({
        message: feedback,
        roomCode: roomCode ?? null,
      });
      setFbStatus("sent");
      setFeedback("");
    } catch (err) {
      setFbStatus("error");
      setFbError(err instanceof Error ? err.message : "Could not send feedback");
    }
  }

  return (
    <section className="game-over" aria-live="polite">
      <h1>Final results</h1>
      <p>{label ? `${label} 🎉` : "No winner — nobody scored."}</p>

      {myRank > 0 && (
        <div className={`placement-card${iWon ? " placement-card--winner" : ""}`}>
          <span className="placement-card__rank">
            {iWon ? "🏆 You won!" : `You placed ${ordinal(myRank)}!`}
          </span>
          <p className="placement-card__sub">
            out of {sorted.length} player{sorted.length === 1 ? "" : "s"}
          </p>
        </div>
      )}

      <Podium standings={sorted} />

      <ol className="results-list">
        {sorted.map((p, i) => (
          <li
            key={p.id}
            className={`${p.id === myPlayerId ? "is-you " : ""}${
              winnerIds.has(p.id) ? "is-winner" : ""
            }`.trim()}
          >
            <span>
              {i + 1}. {p.username} — {formatScore(p.score)}
            </span>
            {winnerIds.has(p.id) && <span> ★ winner</span>}
            {p.id === myPlayerId && <span> (you)</span>}
          </li>
        ))}
      </ol>

      <p className="game-over__cta">
        <Link className="cta-primary" href="/">
          Start a new game
        </Link>
      </p>

      <form className="feedback-form" onSubmit={(e) => void sendFeedback(e)}>
        <h3>Send feedback</h3>
        <p className="field__hint">Ideas, bugs, or how the game felt — we read every note.</p>
        <label>
          Your feedback
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            maxLength={2000}
            rows={4}
            required
            disabled={fbStatus === "sending" || fbStatus === "sent"}
            placeholder="What should we improve?"
          />
        </label>
        {fbError && <p role="alert">{fbError}</p>}
        {fbStatus === "sent" ? (
          <p className="feedback-form__thanks" aria-live="polite">
            Thanks — feedback sent!
          </p>
        ) : (
          <button type="submit" disabled={fbStatus === "sending" || !feedback.trim()}>
            {fbStatus === "sending" ? "Sending…" : "Submit feedback"}
          </button>
        )}
      </form>
    </section>
  );
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
