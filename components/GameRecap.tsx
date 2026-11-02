"use client";

import { useEffect, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/browser";
import { personalStats, roomHighlights, recapTime, type GameRecapData } from "@/lib/gameRecap";
import { formatScore } from "@/lib/formatScore";

export function RecapContent({ data }: { data: GameRecapData }) {
  const { personal, room } = data;
  const highlights = roomHighlights(room);
  const stats = personal ? personalStats(personal.questions) : null;
  return <section className="game-recap" aria-label="Game recap">
    {personal && stats && <>
      <h2>Your recap</h2>
      <dl className="game-recap__stats">
        <div><dt>Accuracy</dt><dd>{stats.accuracy}%</dd></div>
        <div><dt>Fastest correct answer</dt><dd>{recapTime(stats.fastest)}</dd></div>
        <div><dt>Best streak</dt><dd>{stats.bestStreak}</dd></div>
        <div><dt>Total points</dt><dd>{formatScore(personal.total_points)}</dd></div>
      </dl>
      <p className="field__hint">Voided questions are excluded from accuracy and streaks. Missing answers count as wrong.</p>
      <details><summary>Review all {personal.questions.length} questions</summary>
        <ol className="game-recap__questions">{personal.questions.map(q => <li key={q.index}>
          <details><summary>Question {q.index + 1}: {q.prompt} — {q.voided ? "Voided" : q.is_correct ? "Correct" : "Wrong"}</summary>
            <dl>
              <dt>Your answer</dt><dd>{q.answer ?? "No answer"}</dd>
              <dt>Correct answer</dt><dd>{q.correct_answer}</dd>
              <dt>Points{q.finale ? " (double-points finale)" : ""}</dt><dd>{formatScore(q.points)}</dd>
              <dt>Time taken</dt><dd>{q.answer === null ? "No answer" : recapTime(q.elapsed_ms)}</dd>
            </dl>
          </details>
        </li>)}</ol>
      </details>
    </>}
    <h2>Room highlights</h2>
    <h3>Hardest question</h3>
    <p className="field__hint">Lowest correct percentage of the room’s players; voided questions excluded.</p>
    {highlights.hardest.length ? <ul>{highlights.hardest.map(q => <li key={q.index}>Question {q.index + 1}: {q.prompt} — {Math.round(100 * q.correct_count / room.player_count)}% correct</li>)}</ul> : <p>No eligible questions.</p>}
    <h3>Most contested</h3>
    {highlights.contested.length ? <ul>{highlights.contested.map(q => <li key={q.index}>Question {q.index + 1}: {q.prompt} — {q.challenges} challenges{q.voided ? " (voided)" : ""}</li>)}</ul> : <p>No challenges.</p>}
    <h3>Fastest player overall</h3>
    <p className="field__hint">Fastest recorded correct answer; tied players share the highlight.</p>
    {room.fastest.length ? <ul>{room.fastest.map(p => <li key={p.id}>{p.username} — {recapTime(p.elapsed_ms)}</li>)}</ul> : <p>No timed correct answers.</p>}
  </section>;
}

export function GameRecap({ token }: { token: string }) {
  const [result, setResult] = useState<{ token: string; data: GameRecapData | null; error: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const { data, error } = await getBrowserClient().rpc("game_recap", { p_token: token });
        if (active) setResult({ token, data: error ? null : data, error: !!error || !data });
      } catch { if (active) setResult({ token, data: null, error: true }); }
    }
    void load();
    return () => { active = false; };
  }, [token, attempt]);
  if (!result || result.token !== token) return <p role="status">Loading game recap…</p>;
  if (result.error || !result.data) return <div><p role="status">Game recap unavailable.</p><button onClick={() => setAttempt(a => a + 1)}>Retry recap</button></div>;
  return <RecapContent data={result.data} />;
}
