import { describe, expect, it } from "vitest";
import { personalStats, roomHighlights, type RecapQuestion } from "../gameRecap";
const q = (index: number, overrides: Partial<RecapQuestion> = {}): RecapQuestion => ({
  index, prompt: 'Prompt', answer: 'A', correct_answer: 'Corrected A', is_correct: true,
  voided: false, points: 1000, elapsed_ms: 1000, finale: false, ...overrides,
});
describe('personal recap stats', () => {
  it('sorts questions, skips voids, breaks streaks on no answer, uses corrected judgments', () => {
    expect(personalStats([q(4), q(0), q(1, { voided: true, is_correct: false }), q(2), q(3, { answer: null, is_correct: false })]))
      .toEqual({ accuracy: 75, fastest: 1000, bestStreak: 2 });
  });
  it('uses only timed nonvoid correct answers for fastest, including tied finale answers', () => {
    expect(personalStats([q(0, { elapsed_ms: null }), q(1, { elapsed_ms: 1, is_correct: false }), q(2, { voided: true, elapsed_ms: 2 }), q(3, { elapsed_ms: 500 }), q(4, { elapsed_ms: 500, finale: true, points: 2000 })]))
      .toEqual({ accuracy: 75, fastest: 500, bestStreak: 2 });
  });
  it('handles empty and entirely voided games', () => {
    for (const input of [[], [q(0, { voided: true })]]) expect(personalStats(input)).toEqual({ accuracy: 0, fastest: null, bestStreak: 0 });
  });
});
it('keeps all hardest/contested ties, excludes voids only from hardest', () => {
  const questions = [0, 1, 2].map(index => ({ index, prompt: 'Q', voided: index === 2, correct_count: 0, challenges: 2 }));
  expect(roomHighlights({ questions, player_count: 2, fastest: [] })).toEqual({ hardest: questions.slice(0, 2), contested: questions });
  expect(roomHighlights({ questions: [], player_count: 0, fastest: [] })).toEqual({ hardest: [], contested: [] });
});
