// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { GameRecap, RecapContent } from '../GameRecap';
import type { GameRecapData } from '@/lib/gameRecap';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/browser', () => ({ getBrowserClient: () => ({ rpc }) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const room: GameRecapData['room'] = { questions: [], player_count: 2, fastest: [{ id: 'p', username: 'Ada', elapsed_ms: 500 }] };
const personal: NonNullable<GameRecapData['personal']> = { total_points: 2000, questions: [
  { index: 0, prompt: 'A corrected question', answer: 'My answer', correct_answer: 'Corrected answer', is_correct: true, points: 2000, elapsed_ms: 500, finale: true, voided: false },
  { index: 1, prompt: 'A void question', answer: null, correct_answer: 'Voided by host', is_correct: false, points: 0, elapsed_ms: null, finale: false, voided: true },
] };
it('renders player and playing-host recap with corrected key, stored finale points and collapsed questions', () => {
  const { container } = render(<RecapContent data={{ personal, room }} />);
  expect(screen.getByText('Corrected answer')).toBeTruthy();
  expect(screen.getByText('Points (double-points finale)')).toBeTruthy();
  expect(screen.getAllByText('2,000').length).toBeGreaterThan(0);
  expect(screen.getAllByText('No answer').length).toBe(2);
  expect(screen.getByText(/A void question — Voided/)).toBeTruthy();
  expect(container.querySelectorAll('details[open]').length).toBe(0);
  expect(screen.getByRole('heading', { name: 'Room highlights' })).toBeTruthy();
});
it.each(['host-only', 'spectator'])('renders %s room highlights without personal answers', () => {
  render(<RecapContent data={{ personal: null, room }} />);
  expect(screen.queryByText('Your recap')).toBeNull();
  expect(screen.getByText('Ada — 0.50 s')).toBeTruthy();
});
it('fetches once by token, not once per question or render', async () => {
  rpc.mockResolvedValue({ data: { personal, room }, error: null });
  const { rerender } = render(<GameRecap token="player-token" />);
  await screen.findByText('Your recap');
  rerender(<GameRecap token="player-token" />);
  expect(rpc).toHaveBeenCalledExactlyOnceWith('game_recap', { p_token: 'player-token' });
});
it('handles RPC failure without exposing stale answers', async () => {
  rpc.mockRejectedValue(new Error('offline'));
  render(<GameRecap token="spectator" />);
  await waitFor(() => expect(screen.getByText('Game recap unavailable.')).toBeTruthy());
  expect(screen.queryByText('Your recap')).toBeNull();
});
