"use client";
import type { AnswerDistribution, HydratedState, LeaderboardEntry, RevealedAnswer } from "@/lib/db/types";
import { derivePhase } from "@/lib/gamePhase";
import { answerTimerMs, questionMultiplier } from "@/lib/gameConfig";
import { JoinQrCode } from "./JoinQrCode";
import { Countdown } from "./Countdown";
import { GetReady } from "./GetReady";
import { ReviewStage } from "./ReviewStage";
import { Podium } from "./Podium";
import { RoundLeaderboard } from "./RoundLeaderboard";
import { AnswerProgress } from "./AnswerProgress";

export function DisplayStage({ state, token, origin, offset, remaining, reveal, distribution, baseline }: {
  state: HydratedState; token: string; origin: string; offset: number; remaining: number | null;
  reveal: RevealedAnswer | null; distribution: AnswerDistribution | null; baseline: LeaderboardEntry[] | null;
}) {
  const { game, current_question: question, leaderboard } = state;
  const phase = derivePhase(game, question, offset).phase;
  // Defend against stale responses during question transitions.
  const currentReveal = reveal?.index === game.current_index ? reveal : null;
  const currentDist = distribution?.index === game.current_index ? distribution : null;
  return <main className={`tv-display tv-display--${phase}`}>
    <header className="tv-header"><strong>BUZZR</strong><span>Room {game.code}</span>
      {game.current_index >= 0 && <span>Question {game.current_index + 1} / {game.question_count}</span>}
    </header>
    {phase === "lobby" && <section className="tv-lobby">
      <div className="tv-join"><h1>Join the game</h1>
        {origin && <JoinQrCode url={`${origin}/join?code=${game.code}`} />}
        <p>Room code <strong className="tv-code">{game.code}</strong></p>
      </div>
      <div><h2>{leaderboard.length} players ready</h2>
        <ul className="tv-roster">{leaderboard.map(p => <li key={p.id}>{p.username}</li>)}</ul>
        <p>Waiting for the host to start…</p>
      </div>
    </section>}
    {phase === "get_ready" && game.reveal_at && <GetReady revealAt={game.reveal_at} offset={offset} doublePoints={questionMultiplier(game) === 2} />}
    {phase === "paused" && <section className="tv-paused" role="status"><h1>Paused</h1><p>The host is reviewing a challenge.</p><p>We’ll resume shortly.</p></section>}
    {phase === "question" && question && <section className="tv-question">
      <h1>{question.prompt}</h1>
      {questionMultiplier(game) === 2 && <p>Double points!</p>}
      {remaining !== null && <Countdown remaining={remaining} total={answerTimerMs(game)} />}
      {question.voided ? <p>This question was voided.</p> : <>
        {question.mode === "multiple_choice" ? <ol className="tv-options">{question.options?.map((option, i) => <li key={i}><strong>{String.fromCharCode(65 + i)}</strong> {option}</li>)}</ol> : <p>Type your answer on your phone.</p>}
        <AnswerProgress state={state} token={token} />
        {remaining === 0 && <p>Time’s up — waiting for review.</p>}
      </>}
    </section>}
    {phase === "review" && <div className="tv-review">
      <section><h1>{question?.prompt}</h1><ReviewStage voided={question?.voided ?? false}
        reveal={currentReveal} distribution={currentDist} isHost canChallenge={false}
        challenging={false} challengeError={null} showAnswerDispute={false} onChallenge={() => {}} />
      </section>
      <section><h2>Round leaderboard</h2><RoundLeaderboard standings={leaderboard} baseline={baseline} reviewing /></section>
    </div>}
    {phase === "ended" && <section><h1>Final standings</h1><Podium standings={leaderboard} />
      <RoundLeaderboard standings={leaderboard} baseline={null} reviewing={false} />
    </section>}
  </main>;
}
