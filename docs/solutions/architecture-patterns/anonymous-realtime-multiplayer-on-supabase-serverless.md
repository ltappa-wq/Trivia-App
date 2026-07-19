---
module: ai-trivia-game
date: 2026-07-01
problem_type: architecture_pattern
component: database
severity: high
applies_when:
  - "Building anonymous (no-login) realtime multiplayer on Next.js + Supabase + serverless"
  - "Clients must read scoped state without a Supabase Auth identity"
  - "A host/server must drive a live loop but the platform has no long-lived process"
  - "Scores or other trusted outcomes must resist client tampering"
related_components:
  - authentication
  - service_object
  - background_job
tags:
  - supabase
  - realtime
  - rls
  - token-auth
  - serverless
  - hydrate-then-delta
  - speed-scoring
  - nextjs
---

# Anonymous realtime multiplayer on Supabase + serverless

## Context

The AI Trivia Game (U1–U9) is a Kahoot-style live multiplayer app on the owner's
fixed stack: Next.js on Vercel, Supabase (Postgres + Realtime), and xAI for
question generation. Play is anonymous and ephemeral — no accounts, no Supabase
Auth. That combination forces a specific set of architectural decisions that are
non-obvious and easy to get subtly wrong (several were caught only in code review
or against a live project). This captures the durable foundation so the next
realtime feature — or a similar anonymous-multiplayer build — starts from the
proven shape instead of re-deriving it. The pillars are cross-referenced by their
Key Technical Decision IDs (KTD*) in `docs/PRODUCT-CHECKLIST.md (historical KTD ids may still appear in code comments)`.

## Guidance

Five pillars hold the system together. They are interdependent — the auth model
only works because reads go through RPCs; the RPCs only work because Postgres is
the source of truth; scoring is trustworthy only because the server owns time.

### 1. Anonymous tokens + write-side authorization (KTD6, KTD7)

There is no `auth.jwt()` to scope by, and the server uses the **service-role**
client, which **bypasses RLS**. Therefore *read-side RLS protects nothing on the
write path* — every server action must authorize its own caller explicitly:

- **Host** is a credential, not "whoever opened the host route": mint a
  high-entropy host token at game creation, store only its **SHA-256 hash**
  (`games.host_token_hash`), return the plaintext once. Every host-only action
  (`advance`, `adjudicate`, `endGame`) re-derives the hash and compares
  constant-time.
- **Player** identity is a server-issued token stored on the player row. Actions
  (`submitAnswer`, `challenge`) resolve the acting player *from the token* and
  **never trust a client-supplied `player_id`**. Per-player limits (e.g. the
  challenge cap) key off the validated token.
- Room codes are high-entropy over an unambiguous alphabet (rejection-sampled,
  never sequential); `createGame`/`joinGame` are per-IP rate-limited to blunt
  enumeration and paid-API cost-DoS.

### 2. Default-deny RLS + security-definer read RPCs (KTD8)

Every table has RLS enabled with **zero policies** for `anon`/`authenticated` — a
direct client read returns nothing. Clients read *only* through security-definer
functions that take a room-scoped token, validate it server-side, and return that
room's state (`hydrate_game_state`, `list_open_challenges`). Answer keys
(`correct_option`, `accepted_variants`) are **never** returned to players — only
the host-role-gated adjudication RPC exposes them.

### 3. Broadcast is a delta layer; Postgres is the source of truth (KTD2, KTD8)

Supabase Realtime Broadcast is **best-effort** (no ordering/delivery guarantee).
So: clients **hydrate authoritative state from Postgres on subscribe AND on
reconnect**, and treat every Broadcast event as a nudge to reconcile. A dropped
`pause`/`resume`/`void` self-heals on the next hydrate instead of stranding a
device. Emit broadcasts server-side via the Realtime REST endpoint (stateless
functions can't hold a socket); a failed emit is logged, never thrown.

### 4. Host-authoritative pacing on stateless serverless (KTD3, KTD9)

Vercel can't hold a game loop, so the **host device** is the pacing authority:
start/advance call a server action that stamps `reveal_at` **server-side**, mutates
Postgres, and broadcasts. Make advance **idempotent** with a compare-and-set on
`current_index` (`.eq("current_index", expectedIndex)`) so a double-fire can't
skip a question. Clients render the countdown from `reveal_at` corrected by a
measured **client clock offset**, not a local timer.

### 5. Server-side judging + speed scoring (KTD4)

Clients never compute their own score. The submit action records the server-side
submit time, judges (exact option for MC; normalized + bounded-edit-distance fuzzy
match for type-the-answer), and computes the speed score from
`submit_at − reveal_at`. Keep judging/scoring as **pure, unit-tested modules**;
the action is a thin orchestrator. Recompute paths (challenge void / disputed
rescore) reuse the same pure scoring and **atomically claim** the challenge
(CAS on status) before mutating scores so a double-fired ruling applies once.

## Why This Matters

- **Security is on the write side.** The most common failure is assuming RLS or a
  read policy protects a mutation — with a service-role client it doesn't. Miss
  the per-action check and "host" becomes anyone.
- **Best-effort transport + hydrate-on-reconnect is what makes the live loop
  survivable.** Without hydrate-on-*reconnect* specifically (not just on mount), a
  client that briefly drops is stranded on stale state until the next broadcast.
- **Server-owned time is the only honest speed score.** Any client-reported timing
  is tamperable.
- **Idempotent CAS + atomic claims** are the difference between a correct
  leaderboard and one silently corrupted by a retry or double-click.

## When to Apply

Reach for this whole shape when a feature is **anonymous + realtime + scored/
authoritative on stateless serverless**. If any leg is absent the tradeoffs
change (e.g. with real Supabase Auth you can use `auth.jwt()` RLS and skip the
token-RPC read path). Target scale here is small (≤10 players); the delta layer
and per-instance rate limits are calibrated for that.

## Examples

**Write-side host authorization (constant-time hash compare):**

```ts
// lib/serverAuth.ts — every host-only action starts here
const { data } = await supabase.from("games").select("*").eq("code", code).maybeSingle();
if (!constantTimeEqualHex(data.host_token_hash, hashToken(hostToken))) {
  throw new Error("Not authorized"); // "host" is a credential, not a route
}
```

**Idempotent advance (compare-and-set):**

```ts
const { data: updated } = await supabase.from("games")
  .update({ current_index: next, reveal_at: new Date().toISOString(), paused: false })
  .eq("id", game.id)
  .eq("current_index", expectedIndex)   // CAS: only advance if still here
  .select("current_index").maybeSingle();
if (!updated) return { status: "noop", index: game.current_index }; // double-fire is safe
```

**Hydrate-then-delta on the client (re-hydrate on reconnect):**

```ts
channel.subscribe((status) => {
  if (status === "SUBSCRIBED") refresh(); // fires again on reconnect → recovers missed deltas
});
// every broadcast handler also just calls refresh(); Postgres is the truth.
```

### Gotchas discovered (prevention notes)

These bit us in review or against the live project — check them explicitly:

- **`jsonb_agg(... ORDER BY row->>'score')` sorts scores as *text*** (90 above
  100). Order the aggregate by the numeric column (`ORDER BY sort_score DESC`),
  not the extracted JSON text.
- **`REVOKE EXECUTE ... FROM anon` is a no-op.** Postgres grants EXECUTE to
  `PUBLIC` by default; an internal RPC (e.g. `resolve_token`) stays anon-callable
  unless you `REVOKE ... FROM public`.
- **pgcrypto lives in the `extensions` schema on Supabase.** A security-definer
  function with `SET search_path = public` fails to resolve `digest()` at runtime.
  Use `SET search_path = public, extensions`.
- **The direct DB host (`db.<ref>.supabase.co`) is IPv6-only** and unreachable
  from many CI/Codespace environments — connect via the **session pooler**
  (`aws-<n>-<region>.pooler.supabase.com`, user `postgres.<ref>`). The region is
  not encoded in the project ref; you have to know/sweep it.
- **Model aliases age.** The xAI default `grok-2-latest` was retired and 404s;
  pin a currently-available model and keep it overridable via env
  (`XAI_MODEL`). Non-reasoning models are cheaper/faster for structured generation.
- **Verify multi-device behavior with a multi-context Playwright run**, not
  single-page tests — realtime sync and hydrate-on-reconnect only show up across
  isolated browser contexts (one per "device").
```
