// U2. Shared data-model types — the contract every unit reads and writes.
// Mirrors the Postgres schema in supabase/migrations/0001_init.sql.

export type AnswerMode = "multiple_choice" | "type_answer";
export type Difficulty = "easy" | "medium" | "hard";
export type GameStatus = "lobby" | "active" | "ended";
export type ChallengeType = "question" | "answer";
export type ChallengeStatus = "open" | "upheld" | "rejected";
export type PlayerRole = "host" | "player" | "spectator";

export interface GameRow {
  id: string;
  code: string;
  host_token_hash: string;
  status: GameStatus;
  categories: string[];
  question_count: number;
  answer_mode: AnswerMode;
  difficulty: Difficulty;
  /** -1 until the host starts; 0-based index into questions once live. */
  current_index: number;
  reveal_at: string | null;
  paused: boolean;
  // True while the room is showing the post-question review leaderboard (R5).
  reviewing: boolean;
  created_at: string;
}

export interface QuestionRow {
  id: string;
  game_id: string;
  index: number;
  prompt: string;
  mode: AnswerMode;
  options: string[] | null;
  correct_option: number | null;
  accepted_variants: string[] | null;
  difficulty: Difficulty;
  voided: boolean;
  correction: string | null;
}

export interface PlayerRow {
  id: string;
  game_id: string;
  username: string;
  token_hash: string;
  score: number;
  is_spectator: boolean;
  joined_at: string;
}

export interface AnswerRow {
  id: string;
  question_id: string;
  player_id: string;
  submitted_at: string;
  raw_answer: string;
  is_correct: boolean;
  awarded_points: number;
}

export interface ChallengeRow {
  id: string;
  question_id: string;
  player_id: string;
  type: ChallengeType;
  status: ChallengeStatus;
  submitted_text: string | null;
  resolution: string | null;
  created_at: string;
}

// --- Client-facing shapes returned by hydrate_game_state (answer keys omitted) ---

export interface LeaderboardEntry {
  id: string;
  username: string;
  score: number;
}

export interface ClientQuestion {
  index: number;
  prompt: string;
  mode: AnswerMode;
  options: string[] | null;
  voided: boolean;
}

export interface ClientGame {
  id: string;
  code: string;
  status: GameStatus;
  answer_mode: AnswerMode;
  difficulty: Difficulty;
  question_count: number;
  current_index: number;
  reveal_at: string | null;
  paused: boolean;
  // Post-question review phase (R5): answering locked, leaderboard shown.
  reviewing: boolean;
}

export interface HydratedState {
  role: PlayerRole;
  game: ClientGame;
  player: { id: string; username: string; score: number } | null;
  current_question: ClientQuestion | null;
  leaderboard: LeaderboardEntry[];
}

// --- Review-phase answer reveal (reveal_answer; gated on reviewing/ended) ---

export interface RevealedAnswer {
  index: number;
  mode: AnswerMode;
  options: string[] | null;
  correct_option: number | null;
  accepted_variants: string[] | null;
  correction: string | null;
}

// --- Review-phase answer distribution (answer_distribution; gated on phase) ---

export interface AnswerDistribution {
  index: number;
  mode: AnswerMode;
  options: string[] | null;
  correct_option: number | null;
  /** Total answers recorded for the current question. */
  total: number;
  /** Per-option answer counts (multiple_choice only); null for type_answer. */
  counts: number[] | null;
}

// --- Host adjudication view (list_open_challenges; host-only, includes keys) ---

export interface OpenChallenge {
  id: string;
  type: ChallengeType;
  submitted_text: string | null;
  challenger: string;
  question: {
    index: number;
    prompt: string;
    mode: AnswerMode;
    options: string[] | null;
    correct_option: number | null;
    accepted_variants: string[] | null;
  };
}
