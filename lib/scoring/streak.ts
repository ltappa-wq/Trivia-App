// U8 / R1 celebration flourish: the player's current correct-answer streak, shown
// as a "🔥 N in a row!" badge on a correct result. Computed server-side from the
// player's own answer history (submitAnswer) so it survives reload/reconnect —
// the client never counts its own streak. Pure so it is unit-tested here.

export interface StreakAnswer {
  /** Question index the answer was for. */
  index: number;
  correct: boolean;
}

/**
 * The length of the trailing run of correct answers, i.e. how many of the
 * player's most-recent answered questions (by descending index) were correct
 * before the first incorrect one. A gap (an unanswered question) does not break
 * the run — only an incorrect answer does. Returns 0 when the most recent answer
 * was wrong or there are no answers.
 */
export function currentStreak(answers: StreakAnswer[]): number {
  const byRecency = [...answers].sort((a, b) => b.index - a.index);
  let streak = 0;
  for (const answer of byRecency) {
    if (!answer.correct) break;
    streak += 1;
  }
  return streak;
}
