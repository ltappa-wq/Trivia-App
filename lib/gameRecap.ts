export interface RecapQuestion {
  index: number; prompt: string; voided: boolean; correct_answer: string;
  answer: string | null; is_correct: boolean; points: number;
  elapsed_ms: number | null; finale: boolean;
}
export interface RoomQuestion {
  index: number; prompt: string; voided: boolean; correct_count: number; challenges: number;
}
export interface GameRecapData {
  personal: { total_points: number; questions: RecapQuestion[] } | null;
  room: {
    questions: RoomQuestion[]; player_count: number;
    fastest: { id: string; username: string; elapsed_ms: number }[];
  };
}
/** Voids do not count toward accuracy and neither break nor extend a streak.
 * Missing answers break streaks. Persisted adjudicated correctness/points win. */
export function personalStats(questions: RecapQuestion[]) {
  let correct = 0, count = 0, streak = 0, bestStreak = 0;
  let fastest: number | null = null;
  for (const q of [...questions].sort((a, b) => a.index - b.index)) {
    if (q.voided) continue;
    count++;
    if (q.is_correct) {
      correct++; streak++; bestStreak = Math.max(bestStreak, streak);
      if (q.elapsed_ms !== null) fastest = Math.min(fastest ?? Infinity, q.elapsed_ms);
    } else streak = 0;
  }
  return { accuracy: count ? Math.round(100 * correct / count) : 0, fastest, bestStreak };
}
export function roomHighlights(room: GameRecapData['room']) {
  const valid = room.questions.filter(q => !q.voided);
  const min = Math.min(...valid.map(q => q.correct_count));
  const max = Math.max(0, ...room.questions.map(q => q.challenges));
  return {
    hardest: room.player_count ? valid.filter(q => q.correct_count === min) : [],
    contested: max ? room.questions.filter(q => q.challenges === max) : [],
  };
}
export const recapTime = (ms: number | null) => ms === null ? 'Time unavailable' : `${(ms / 1000).toFixed(2)} s`;
