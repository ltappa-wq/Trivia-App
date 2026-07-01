// Realtime channel + event vocabulary shared by the server broadcast emitters
// (server actions) and the client subscribers (U6). One per-room Broadcast
// channel carries every live delta; Postgres remains the source of truth and
// clients hydrate on subscribe/reconnect (KTD2, KTD8).

export function roomChannel(code: string): string {
  return `room:${code.toUpperCase()}`;
}

export const ROOM_EVENTS = {
  /** A player joined the lobby — drives the host roster (U5, KTD8). */
  playerJoined: "player_joined",
  /** A new question was revealed with its timer (U6). */
  question: "question",
  /** Leaderboard changed between questions or after a recompute (U6, U8). */
  leaderboard: "leaderboard",
  /** A challenge paused play (U8). */
  pause: "pause",
  /** Play resumed after adjudication (U8). */
  resume: "resume",
  /** A question was voided by an upheld challenge (U8). */
  void: "void",
  /** Final standings — the game ended (U9). */
  results: "results",
} as const;

export type RoomEvent = (typeof ROOM_EVENTS)[keyof typeof ROOM_EVENTS];
