---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
title: "fix: Review-phase answer reveal, timer, next-question race, and challenge access"
date: 2026-07-03
type: fix
depth: standard
---

# fix: Review-phase answer reveal, timer, next-question race, and challenge access

## Summary

Four defects on the per-question **review phase** (the `reviewing` state introduced in `supabase/migrations/0006_review_phase.sql`, surfaced on the host and player screens):

1. **No correct answer shown.** When a question closes into review, players and the host see "Answers locked — see the standings below" but never the correct answer. Reveal it to everyone once the room is `reviewing`.
2. **Timer lingers during review.** The player screen keeps rendering the countdown after answering is locked. Hide it during review.
3. **"Next question" instantly times out (bug).** Advancing from review immediately re-enters review on the fresh question. Root cause: the host's auto-close effect reads a **stale `remaining` value** (0 from the prior question) on the commit right after `advance`, before the countdown recomputes, and fires `closeQuestion` on the just-revealed question.
4. **Challenge buttons vanish in review.** Both challenge affordances ("Challenge this question" and "My answer was wrongly marked") are gated behind `!reviewing`, so they disappear exactly when a player sees the answer and would want to dispute it. Surface them during review.

Scope is bounded to the review phase. No changes to scoring, generation, adjudication mechanics, or the answer-window durations.

---

## Problem Frame

The review phase lands the room on a leaderboard between questions (R5). Testing surfaced that the screen is under-informative and has one hard bug:

- The review screen withholds the correct answer, so players can't learn from a question before the next one.
- The anti-cheat design (KTD4) deliberately strips answer keys from `hydrate_game_state` and from every client-facing shape (`ClientQuestion`), enforced by the invariant test `never returns answer keys to clients` in `lib/db/__tests__/schema.test.ts`. Revealing the answer must **not** weaken that guarantee for the *live* (still-answerable) phase — only for `reviewing`/`ended`.
- The host auto-close effect (`app/(host)/host/page.tsx`, the `closedForIndex` effect) trusts the async `remaining` state. On the render where `game` has advanced but `remaining` has not yet recomputed, the guard `remaining > 0` is false (stale 0) and `closedForIndex.current` no longer matches the new index, so it closes the fresh question. This is the "times out right away" report.
- Challenge access is gated to the live phase, but the natural moment to dispute a marking is *after* the answer is revealed, i.e. during review.

---

## Requirements

- **R1** — During `reviewing` (and after game end), every participant (host shared screen + each player) sees the correct answer for the current question. For multiple-choice this is the correct option text; for type-answer, the accepted answer(s).
- **R2** — The answer key is exposed to clients **only** when the room is `reviewing` or `ended`. The live-phase invariant (no answer keys reachable while a question is still answerable) is preserved and still test-enforced.
- **R3** — The player countdown is hidden once the room enters review (answering is locked, so a ticking timer is misleading).
- **R4** — Advancing from review to the next question reveals that question with its full answer window; it does not immediately re-enter review.
- **R5** — During review, a player can raise both challenge types: "Challenge this question" and "My answer was wrongly marked" (the latter only when they were marked wrong on this question).

---

## Key Technical Decisions

**KTD-A — Reveal via a dedicated `reviewing`/`ended`-gated RPC, not by extending `hydrate_game_state`.**
Add a `reveal_answer(p_token)` security-definer RPC (migration `0007`) that returns the current question's answer key **only** when `g.reviewing OR g.status = 'ended'`, granted to `anon, authenticated`. This mirrors the existing `list_open_challenges` pattern (host-only key exposure lives in a gated RPC, not hydrate) and leaves `hydrate_game_state` — and its `never returns answer keys to clients` invariant test — untouched. Clients fetch it when `reviewing` flips (the `review` broadcast already triggers a re-hydrate; the reveal fetch rides the same signal). Rejected: conditionally embedding the key in `hydrate_game_state`, which would force rewriting the anti-cheat invariant test and blur the live/review boundary in the hottest RPC.

**KTD-B — Format the answer key with a pure `lib/` helper.**
Extract `formatAnswerKey(question)` into `lib/reviewAnswer.ts`, reused by the review reveal and mirroring the inline formatting already in the host adjudication panel (`app/(host)/host/page.tsx`, the `answerKey` computation). Pure and unit-testable per the repo's "logic in `lib/`, tested with vitest" convention.

**KTD-C — Fix the race by recomputing freshness from `reveal_at`, not the `remaining` state.**
Extract `shouldAutoClose({ reveal_at, answer_mode, current_index }, offset, now)` into `lib/gameFlow.ts`. It recomputes remaining directly from `reveal_at` via `remainingMs(...)` rather than reading the async `remaining` render state, so a stale value from the prior question can't trigger a close on the freshly-revealed one. The host effect calls this helper. Pure and unit-testable.

**KTD-D — Answer keys never enter the live-phase client payload.**
The reveal RPC is the *only* new key-exposure path, and it is gated. `ClientQuestion` / `hydrate_game_state` remain answer-key-free.

---

## High-Level Technical Design

### Item 3 race — why "Next question" self-closes today

```
Host is on question N, in review (remaining for N == 0, closedForIndex.current == N)
      │
      ▼  host clicks "Next question" → advance(code, token, N)
server: current_index = N+1, reveal_at = now, reviewing = false → broadcast(question)
      │
      ▼  client reconciles → re-hydrate → setState(game = {index:N+1, reveal_at:now, reviewing:false})
React commit #1:  game = N+1        │  remaining = 0  ← STALE (useCountdown hasn't re-run yet)
      │
      ├─ useCountdown effect queues setRemaining(~20000) … applies on a LATER commit
      └─ closedForIndex effect runs NOW with the values in THIS commit:
             reviewing? false  →  passes
             remaining > 0?    →  false (stale 0)  →  passes
             closedForIndex.current (N) == current_index (N+1)?  →  false → passes
             ⇒ fires closeQuestion(N+1)  ❌  → question N+1 snaps into review
```

**Fix:** the close decision reads `reveal_at` directly.

```
closedForIndex effect (after fix):
   shouldAutoClose({reveal_at:now, answer_mode, current_index:N+1}, offset, Date.now())
       remainingMs(now, 20000, offset) == 0 ?  →  false (fresh window) → do NOT close  ✅
```

### Answer-reveal data path

```
review broadcast ──► useRoomState.reconcile() ──► re-hydrate (no keys)
                                              └─► revealAnswer(token) RPC
                                                     └─ returns key ONLY if reviewing|ended
                                                        └─ formatAnswerKey() ─► "Correct answer: Paris"
                                                             (rendered on host + player review screens)
```

---

## Implementation Units

### U1. `reveal_answer` RPC, client helper, and answer-key formatter

**Goal:** Provide a gated data path that returns the current question's answer key only during review/ended, plus a pure formatter for display.

**Requirements:** R1, R2 (advances), supports R5 display context.

**Dependencies:** none.

**Files:**
- `supabase/migrations/0007_reveal_answer.sql` (new) — `reveal_answer(p_token text) returns jsonb`, `security definer`, `set search_path = public`. Resolves the token via `resolve_token` (as `hydrate_game_state` does), loads the game, and returns `jsonb_build_object('index', q.index, 'mode', q.mode, 'correct_option', q.correct_option, 'accepted_variants', q.accepted_variants, 'options', q.options, 'correction', q.correction)` for `q.index = g.current_index` **only when** `g.reviewing = true OR g.status = 'ended'`; otherwise returns `null`. `grant execute ... to anon, authenticated`.
- `lib/reviewAnswer.ts` (new) — `formatAnswerKey(reveal): string` (MC → `options[correct_option]`; type-answer → `accepted_variants.join(", ")`; guards missing/out-of-range). Export a `RevealedAnswer` type.
- `lib/realtime/channel.ts` (modify) — add `revealAnswer(token: string): Promise<RevealedAnswer | null>` calling `supabase.rpc("reveal_answer", { p_token: token })`, mirroring `hydrate` / `listOpenChallenges`.
- `lib/db/types.ts` (modify) — add the `RevealedAnswer` client shape.
- `lib/db/__tests__/schema.test.ts` (modify) — migration-text assertions.
- `lib/__tests__/reviewAnswer.test.ts` (new) — formatter unit tests.

**Approach:** Copy the `resolve_token` + game-load preamble from `hydrate_game_state` (0006). Gate the question sub-select on the reviewing/ended condition so a non-reviewing call returns `null`. Keep the shape answer-key-bearing — this RPC is *the* sanctioned key path; `hydrate` stays clean.

**Patterns to follow:** `list_open_challenges` RPC (host-only key exposure) in `supabase/migrations/0003_challenges.sql`; `hydrate_game_state` token/preamble in `0006_review_phase.sql`; client RPC helpers in `lib/realtime/channel.ts`; the inline `answerKey` formatting in `app/(host)/host/page.tsx`.

**Test scenarios:**
- `lib/__tests__/reviewAnswer.test.ts`:
  - MC: `{ mode: "multiple_choice", options: ["A","B","C"], correct_option: 2 }` → `"C"`.
  - MC out-of-range/`null` `correct_option` → safe fallback (`"—"`), no throw.
  - Type-answer: `{ mode: "type_answer", accepted_variants: ["Paris","paris"] }` → `"Paris, paris"`.
  - Type-answer empty/`null` variants → safe fallback, no throw.
- `lib/db/__tests__/schema.test.ts`:
  - Covers R2. `reveal_answer` gates the key on `g.reviewing` or `g.status = 'ended'` (assert the migration text contains the reviewing/ended condition guarding the question select).
  - Covers R2. `reveal_answer` is granted to `anon, authenticated`.
  - Covers R2. The existing `hydrate` block still contains **no** `correct_option` / `accepted_variants` (guard against accidental leak regression — keep the existing assertion green).

**Verification:** Unit suite green. Against the running app, calling the RPC on an active (non-reviewing) question returns `null`; on a reviewing question returns the key.

---

### U2. Show the correct answer on the review screen (host + player) and hide the player timer

**Goal:** Render the correct answer to everyone during review; stop showing the player countdown once answering is locked.

**Requirements:** R1, R3.

**Dependencies:** U1.

**Files:**
- `components/AnswerReveal.tsx` (new) — presentational component taking a formatted answer string (+ optional `correction`), rendering e.g. "Correct answer: Paris". Shared by both views.
- `app/(play)/play/page.tsx` (modify) — when `reviewing`, fetch via `revealAnswer(token)` and render `<AnswerReveal>` in the review branch (replacing/augmenting the "Answers locked" overlay); gate the countdown render (`remaining !== null && …`) on `!reviewing` (R3).
- `app/(host)/host/page.tsx` (modify) — in the review section (`started && !ended && reviewing && !game.paused`), fetch and render `<AnswerReveal>`. (The host active-question section is already gated `!reviewing`, so no host timer change is needed.)

**Approach:** Add a small effect in each view that calls `revealAnswer(token)` when `reviewing` becomes true and clears the revealed answer when it leaves review (so a stale answer never bleeds into the next question). Reuse the existing re-hydrate trigger cadence; a direct fetch keyed on `reviewing` + `current_index` is sufficient (no new broadcast). Format with `formatAnswerKey` (U1).

**Patterns to follow:** the host paused-panel data fetch (`listOpenChallenges` in a `useEffect` keyed on state) in `app/(host)/host/page.tsx`; existing conditional overlays in `app/(play)/play/page.tsx`.

**Test scenarios:** `Test expectation: none (presentational + client fetch wiring; no jsdom/component suite in this repo).` Logic is covered by `formatAnswerKey` (U1) and the manual/e2e verification below. Consider extending `e2e/game-flow.spec.ts` to assert the correct answer text appears on the review screen and the countdown is gone (see Verification).

**Verification:** Play a full question to review (both all-answered and timer paths). The correct answer appears on the player and host screens; the player countdown is absent during review; on advance, the reveal clears and does not show for the next question until it enters review.

---

### U3. Fix the host "Next question" immediate re-close race

**Goal:** Advancing from review reveals the next question with a full answer window instead of instantly re-entering review.

**Requirements:** R4.

**Dependencies:** none (independent of U1/U2; can land first).

**Files:**
- `lib/gameFlow.ts` (modify) — add `shouldAutoClose(game: { reveal_at: string | null; answer_mode: AnswerMode; current_index: number }, offset: number, now?: number): boolean`. Returns `true` only when `current_index >= 0`, `reveal_at` is set, and `remainingMs(new Date(reveal_at).getTime(), ANSWER_TIMER_MS[answer_mode], offset, now) <= 0`.
- `app/(host)/host/page.tsx` (modify) — the `closedForIndex` effect calls `shouldAutoClose(game, offset)` instead of reading the `remaining` render state; add `offset` to the effect deps. Keep the `closedForIndex` ref guard and the reset-on-failure behavior.
- `lib/__tests__/gameFlow.test.ts` (modify) — unit tests for `shouldAutoClose`.

**Approach:** The bug is a stale-`remaining` read on the commit right after `advance` (see High-Level Technical Design). Deriving the decision from `reveal_at` directly makes it immune to the async countdown lag: a freshly stamped `reveal_at` yields a full window regardless of what `remaining` currently holds.

**Execution note:** Start with a failing `shouldAutoClose` test that reproduces the race (fresh `reveal_at`, stale-equivalent inputs → must return `false`).

**Patterns to follow:** existing pure helpers and tests in `lib/gameFlow.ts` / `lib/__tests__/gameFlow.test.ts`; `remainingMs` in `lib/realtime/clock.ts`.

**Test scenarios:**
- Covers R4. Fresh reveal (`reveal_at = now`, `offset = 0`) → `false` (do not close) — the regression guard for the reported bug.
- Elapsed window (`reveal_at = now - (timer + 1s)`) → `true`.
- `current_index < 0` (lobby) → `false`.
- `reveal_at = null` → `false`.
- Non-zero clock `offset` shifts the boundary correctly (server ahead/behind): a reveal that is fresh in server time but skewed in local time still returns `false`.
- Exact boundary (`remaining == 0`) → `true` (matches the current close-at-zero semantics).

**Verification:** In the running app, click "Next question" from review repeatedly across several questions — each next question shows a full countdown and stays answerable; it does not snap back into review. The timer-expiry auto-close still works when a question genuinely runs out.

---

### U4. Surface challenge buttons during review

**Goal:** Let players raise challenges from the review screen — "Challenge this question" and "My answer was wrongly marked" (the latter when marked wrong on this question).

**Requirements:** R5.

**Dependencies:** none functionally, but best sequenced after U2 so the answer is visible when the challenge affordance appears.

**Files:**
- `app/(play)/play/page.tsx` (modify) — allow the challenge block to render during `reviewing` (currently gated `!paused && !reviewing && !voided && !spectating`); reset the persisted `result` state when `current_index` changes so `markedWrong` reflects the current question, not a stale prior answer.

**Approach:** Change the gate so the challenge block shows in the review branch (still excluded while `paused`, `voided`, or `spectating`). The `challenge` server action already accepts submissions while `status = 'active'` (review keeps `status = 'active'`, only `reviewing = true`), so no server change is needed — raising a challenge pauses the game as today and routes to host adjudication. Add an effect that clears `result` on `current_index` change to prevent a stale "wrongly marked" affordance carrying into the next question.

**Patterns to follow:** the existing challenge block and `raiseChallenge` handler in `app/(play)/play/page.tsx`; `challenge` action guards in `app/actions/challenge.ts`.

**Test scenarios:** `Test expectation: none (UI gating + client state reset; no component suite).` Behavior verified manually / via e2e below. If `markedWrong` derivation grows non-trivial, extract it to a pure `lib/` helper and unit-test it; not required for the current one-line predicate.

**Verification:** Enter review after answering incorrectly → both "Challenge this question" and "My answer was wrongly marked" are visible; raising either pauses the game and shows the host adjudication panel. Advance to the next question → the "wrongly marked" button does not appear until a fresh wrong answer occurs. Spectators and voided-question cases still show no challenge buttons.

---

## Scope Boundaries

**In scope:** the four review-phase behaviors above and their minimal data path (one gated RPC, two pure helpers, three UI edits).

**Non-goals:**
- Changing answer-window durations, scoring, or the speed-score formula.
- Reworking adjudication, void, or pause/resume mechanics.
- Adding new broadcast events (the existing `review`/`question` deltas plus a keyed client fetch are sufficient).
- Exposing answer keys anywhere outside the review/ended-gated RPC.

### Deferred to Follow-Up Work
- Showing the question's `correction` text and/or per-player answer breakdown on the review screen (the RPC returns `correction`, but rendering it is out of scope here).
- e2e coverage expansion for the review screen if not folded into U2/U3 verification.

---

## Risks & Dependencies

- **Answer-key leak regression (high sensitivity).** Any future edit that routes the key through `hydrate` or the live payload breaks KTD4. Mitigated by keeping the reveal in a single gated RPC and retaining the `never returns answer keys to clients` hydrate assertion (U1 tests).
- **Migration ordering.** `0007_reveal_answer.sql` must be applied to the Supabase database before U2 works at runtime (the same manual-apply path used for `0006`). Note in the PR that a migration apply is required; the repo has no Supabase-CLI migration tracking.
- **Race-fix completeness.** `shouldAutoClose` removes the stale-`remaining` path, but the `closedForIndex` ref guard and reset-on-failure must be preserved so the genuine timer-expiry close still fires exactly once.

---

## Verification Contract

- `npm run test` — all vitest suites green, including new `lib/__tests__/reviewAnswer.test.ts`, extended `lib/__tests__/gameFlow.test.ts`, and extended `lib/db/__tests__/schema.test.ts`.
- `npm run typecheck` and `npm run lint` clean.
- Manual run (`npm run dev`, migration `0007` applied): a full question → review shows the correct answer on host and player, no player timer in review, both challenge buttons available, and "Next question" reveals a fresh, answerable question every time.
- Optional: `npm run test:e2e` extended in `e2e/game-flow.spec.ts` for the review-screen assertions.

## Definition of Done

- R1–R5 satisfied and demonstrated in a live run.
- The answer-key anti-cheat invariant remains test-enforced and unbroken.
- The "Next question" immediate-timeout bug is covered by a regression unit test that fails before U3 and passes after.
- Migration `0007` documented as an apply step in the PR.

---

## Sources & Research

- `supabase/migrations/0006_review_phase.sql` — `reviewing` column + `hydrate_game_state` (no keys).
- `supabase/migrations/0003_challenges.sql` — `list_open_challenges` gated-RPC pattern.
- `app/(host)/host/page.tsx` — `closedForIndex` auto-close effect (item 3), review section, adjudication key formatting.
- `app/(play)/play/page.tsx` — review overlay, countdown render, challenge block gating.
- `lib/realtime/hooks.ts`, `lib/realtime/clock.ts` — countdown derivation and `remainingMs`.
- `app/actions/advance.ts`, `app/actions/closeQuestion.ts`, `app/actions/submitAnswer.ts`, `app/actions/challenge.ts` — review transitions and challenge action.
- `lib/db/__tests__/schema.test.ts` — the `never returns answer keys to clients` invariant.

_External research: none — fully local, well-patterned work._

_Product Contract preservation: n/a (solo plan; `product_contract_source: ce-plan-bootstrap`)._
