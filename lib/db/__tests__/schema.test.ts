import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// U2. The DB round-trip / anon-read / hydrate-scoping scenarios require a live
// Supabase project (`supabase db reset`) and run in the realtime e2e suite.
// These static checks guard the security-critical invariants of the schema so a
// regression (e.g. dropping RLS, storing the host token in plaintext, or leaking
// answer keys through the client RPC) fails fast in the unit suite.

const init = readFileSync(
  fileURLToPath(new URL("../../../supabase/migrations/0001_init.sql", import.meta.url)),
  "utf8",
);
const rpcs = readFileSync(
  fileURLToPath(new URL("../../../supabase/migrations/0002_rpcs.sql", import.meta.url)),
  "utf8",
);
const challenges = readFileSync(
  fileURLToPath(new URL("../../../supabase/migrations/0003_challenges.sql", import.meta.url)),
  "utf8",
);
const reviewPhase = readFileSync(
  fileURLToPath(new URL("../../../supabase/migrations/0006_review_phase.sql", import.meta.url)),
  "utf8",
);
const revealAnswer = readFileSync(
  fileURLToPath(new URL("../../../supabase/migrations/0007_reveal_answer.sql", import.meta.url)),
  "utf8",
);
const phaseAuth = readFileSync(
  fileURLToPath(
    new URL("../../../supabase/migrations/0009_phase_auth_hardening.sql", import.meta.url),
  ),
  "utf8",
);

describe("schema security invariants", () => {
  const tables = ["games", "questions", "players", "answers", "challenges"];

  it("enables default-deny RLS on every table with no permissive policies", () => {
    for (const t of tables) {
      expect(init).toMatch(
        new RegExp(`alter table public\\.${t} enable row level security`),
      );
    }
    // Default-deny means RLS is on but no CREATE POLICY grants anon/auth access.
    expect(init).not.toMatch(/create policy/i);
  });

  it("stores the host token hashed, never in plaintext", () => {
    expect(init).toMatch(/host_token_hash\s+text not null/);
    expect(init).not.toMatch(/\bhost_token\s+text/); // no plaintext column
  });

  it("enforces one answer per player per question (dup-submit guard)", () => {
    expect(init).toMatch(/unique \(question_id, player_id\)/);
  });

  it("stores the player token hashed in a unique column, never in plaintext", () => {
    expect(init).toMatch(/token_hash\s+text not null unique/);
    expect(init).not.toMatch(/\btoken\s+text/); // no plaintext player-token column
  });

  it("migration 0009 rewires resolve_token to hash match and drops residual plaintext", () => {
    expect(phaseAuth).toMatch(/token_hash/);
    expect(phaseAuth).toMatch(/drop column token/i);
    expect(phaseAuth).toMatch(
      /p\.token_hash = encode\(digest\(p_token, 'sha256'\), 'hex'\)/,
    );
  });
});

describe("hydrate RPC invariants", () => {
  it("is a security-definer function executable by anon", () => {
    expect(rpcs).toMatch(/create or replace function public\.hydrate_game_state/);
    expect(rpcs).toMatch(/security definer/);
    expect(rpcs).toMatch(/grant execute on function public\.hydrate_game_state\(text\) to anon/);
  });

  it("never returns answer keys to clients", () => {
    // The client-facing question object must not surface the grading columns.
    const questionBlock = rpcs.slice(rpcs.indexOf("'current_question'"));
    expect(questionBlock).not.toContain("correct_option");
    expect(questionBlock).not.toContain("accepted_variants");
  });

  it("keeps resolve_token off-limits to anonymous callers", () => {
    expect(rpcs).toMatch(/revoke execute on function public\.resolve_token\(text\) from anon/);
  });

  it("revokes resolve_token from PUBLIC (a revoke from anon alone is a no-op)", () => {
    // Postgres grants EXECUTE to PUBLIC by default, so without this the function
    // stays callable by anonymous clients despite the anon-revoke.
    expect(rpcs).toMatch(/revoke execute on function public\.resolve_token\(text\) from public/i);
  });
});

describe("review phase migration invariants (U5, R5)", () => {
  it("adds the reviewing flag to games", () => {
    expect(reviewPhase).toMatch(/add column if not exists reviewing boolean not null default false/);
  });

  it("re-exposes reviewing through the hydrate RPC without leaking answer keys", () => {
    expect(reviewPhase).toMatch(/create or replace function public\.hydrate_game_state/);
    expect(reviewPhase).toMatch(/'reviewing', g\.reviewing/);
    const questionBlock = reviewPhase.slice(reviewPhase.indexOf("'current_question'"));
    expect(questionBlock).not.toContain("correct_option");
    expect(questionBlock).not.toContain("accepted_variants");
  });
});

describe("reveal_answer RPC invariants (R1, R2)", () => {
  it("is a security-definer function executable by anon", () => {
    expect(revealAnswer).toMatch(/create or replace function public\.reveal_answer/);
    expect(revealAnswer).toMatch(/security definer/);
    expect(revealAnswer).toMatch(
      /grant execute on function public\.reveal_answer\(text\) to anon/,
    );
  });

  it("exposes the answer key only when reviewing or ended", () => {
    // It DOES surface correct_option/accepted_variants (the review reveal), but
    // the current-question select is gated on the room no longer being answerable.
    expect(revealAnswer).toMatch(/correct_option/);
    expect(revealAnswer).toMatch(/accepted_variants/);
    expect(revealAnswer).toMatch(/g\.reviewing = true or g\.status = 'ended'/);
  });

  it("pins search_path including extensions so nested digest() resolves", () => {
    expect(revealAnswer).toMatch(/set search_path = public, extensions/);
  });
});

describe("list_open_challenges RPC invariants (U8)", () => {
  it("is a security-definer function executable by anon", () => {
    expect(challenges).toMatch(/create or replace function public\.list_open_challenges/);
    expect(challenges).toMatch(/security definer/);
    expect(challenges).toMatch(
      /grant execute on function public\.list_open_challenges\(text\) to anon/,
    );
  });

  it("returns answer keys only behind a host-role gate", () => {
    // It DOES surface correct_option/accepted_variants (the host adjudicates),
    // but only after rejecting any non-host token.
    expect(challenges).toMatch(/role is distinct from 'host'|v_role\s*<>\s*'host'/);
    expect(challenges).toMatch(/correct_option/);
    expect(challenges).toMatch(/accepted_variants/);
  });

  it("pins search_path including extensions so nested digest() resolves", () => {
    expect(challenges).toMatch(/set search_path = public, extensions/);
  });
});

describe("phase/auth hardening migration (0009)", () => {
  it("exposes atomic score adjust and shared rate limit, revoked from clients", () => {
    expect(phaseAuth).toMatch(/create or replace function public\.adjust_player_score/);
    expect(phaseAuth).toMatch(/create or replace function public\.check_rate_limit/);
    expect(phaseAuth).toMatch(
      /revoke execute on function public\.adjust_player_score\(uuid, integer\) from (public|anon)/i,
    );
    expect(phaseAuth).toMatch(
      /revoke execute on function public\.check_rate_limit\(text, integer, integer\) from (public|anon)/i,
    );
  });

  it("enables RLS on rate_limit_hits without permissive policies", () => {
    expect(phaseAuth).toMatch(
      /alter table public\.rate_limit_hits enable row level security/i,
    );
    expect(phaseAuth).not.toMatch(/create policy/i);
  });
});
