---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
type: feat
title: "feat: make host playing an option (default on)"
date: 2026-07-02
---

# feat: Make host playing an option (default on)

## Summary

Today the gamemaster **always** plays: setup requires a host name, `createGame`
always seats a host player row, and the host view always shows answer controls
(commit `78c87b8`). This plan makes host-play a **choice** — a toggle on the
setup form, defaulting to **on** — so the gamemaster can instead run a pure,
non-playing "host the room" session. When the toggle is off, no name is
required, no host player row is seated, and the host view shows the current
question read-only (the pre-`78c87b8` shared-screen behavior) instead of answer
controls.

Scope is a narrow extension of the existing host-play feature: one new form
control, one conditional branch in `createGame`, an optional credential field,
and a conditional render in the host view. It also repairs the e2e helper, which
`78c87b8` left unable to submit the now-required name field.

---

## Problem Frame

The "let the host play too" work resolved the original host-only vs.
host-plays question by making the host **always** a player. That removed a valid
mode: a gamemaster who runs the game on a shared screen for a room of players and
does not want to compete. Restoring that mode as an explicit, default-on option
gives both behaviors without regressing the common case (host plays).

**In scope**
- A setup toggle "I'll play too" defaulting to on.
- Conditional name requirement, host-player seating, and host-view answer UI.
- Making `hostPlayerToken` / `username` optional through the createGame result
  and the stored host credential.
- Restoring a read-only current-question display in the host view when the host
  is not playing.
- Fixing the e2e host helper and adding non-playing-host coverage.

**Out of scope** (see Scope Boundaries)

---

## Requirements

- **R1** — The setup form offers a host-play toggle defaulting to **on**.
- **R2** — When host-play is on, behavior is unchanged from `78c87b8`: name
  required, host seated as a player, host view shows `AnswerPanel`.
- **R3** — When host-play is off, the name field is not required (and is hidden
  or disabled), no host player row is created, and the host view shows the
  current question read-only with no answer controls.
- **R4** — `createGame` seats a host player **only** when host-play is on; the
  result's player fields are absent otherwise, and no orphaned game is left if
  seating fails (existing rollback behavior preserved).
- **R5** — A non-playing host can still run the full game (start once ≥1 player
  has joined, advance, adjudicate, finish). Solo play remains available only via
  host-play on.
- **R6** — The e2e happy path drives the host-name field so game creation
  succeeds; a spec covers the non-playing-host path.

---

## Key Technical Decisions

- **KTD1 — `createGame` takes a host-intent options object.** Change the second
  argument from `rawHostName: string` to `host: { plays: boolean; name: string }`.
  Reads clearly at the call site and keeps the play/name pair together rather
  than threading a separate boolean. The action branches on `host.plays`:
  validate name + seat player when true; skip both when false.
- **KTD2 — Player credential fields become optional, not a second type.** Make
  `HostCredential.playerToken` and `.username` optional (`?`) and
  `CreateGameResult.hostPlayerToken` / `.username` optional, rather than
  introducing separate playing/non-playing credential types. The host view keys
  its answer UI on `cred.playerToken` being present.
- **KTD3 — Non-playing host view restores the pre-`78c87b8` read-only display.**
  When the host is not playing, render the multiple-choice options as a
  read-only list (and, for type-answer mode, just the prompt/timer) — the
  behavior that existed before the shared `AnswerPanel` was wired in. This keeps
  the shared screen useful for a room to read from.

---

## Assumptions

These were resolved autonomously during planning (no upstream product doc); flip
any of them by editing the relevant unit before implementation.

- The non-playing host view shows the current question **read-only** (KTD3),
  matching the shared-screen intent, rather than hiding the question entirely.
- Host intent is passed to `createGame` as an options object (KTD1), not a bare
  name plus a separate boolean.
- Toggle copy is "I'll play too" / default checked; exact wording is cosmetic
  and may be adjusted during implementation.

---

## Implementation Units

### U1. Setup form — host-play toggle

**Goal:** Add a default-on "I'll play too" toggle that gates the host-name field
and the submit rule.

**Requirements:** R1, R2, R3

**Dependencies:** none

**Files:**
- `app/(host)/setup/page.tsx`

**Approach:**
- Add `const [hostPlays, setHostPlays] = useState(true)`.
- Render a checkbox bound to `hostPlays` above the name field.
- Render the name `<label>`/`<input>` only when `hostPlays` is true (and keep
  `required` on it in that branch). When off, do not render it.
- `canSubmit`: `categories.length > 0 && (!hostPlays || hostName.trim().length > 0)`.
- Pass the new shape to `createGame(input, { plays: hostPlays, name: hostName })`
  (per KTD1) and only include `playerToken` / `username` in
  `saveHostCredential` when the result returns them.

**Patterns to follow:** existing `answerMode` radio / `categories` checkbox
handling in the same file; existing `saveHostCredential` call.

**Test scenarios:**
- Covers R1. Default render: the toggle is checked and the name field is visible
  and required.
- Covers R3. Unchecking the toggle hides the name field and `Create game`
  becomes enabled with at least one category selected and no name entered.
- Covers R2. With the toggle checked, `Create game` stays disabled until a
  non-empty name is entered.
- Test expectation: exercised via the U4 e2e specs (component has no standalone
  unit harness in this repo); no new unit-test file.

### U2. `createGame` — conditional name validation and host seating

**Goal:** Branch game creation on host-play intent: validate name and seat a host
player only when the host plays.

**Requirements:** R2, R4, R5

**Dependencies:** U1 (call shape), but implementable in parallel against KTD1.

**Files:**
- `app/actions/createGame.ts`

**Approach:**
- Change signature to `createGame(raw: SetupInput, host: { plays: boolean; name: string })`.
- Make `CreateGameResult.hostPlayerToken` and `.username` optional.
- Move the username `normalizeUsername` + `validateUsername` check inside an
  `if (host.plays)` branch; when not playing, skip it entirely.
- Gate the "Seat the host as a player" insert block on `host.plays`. Preserve the
  existing rollback-on-seat-failure behavior in the playing branch.
- Return `{ gameId, code, hostToken }` plus `hostPlayerToken` / `username` only
  in the playing branch.

**Patterns to follow:** existing validation-then-throw flow and the existing
seat/rollback block in the same file.

**Test scenarios:**
- Covers R4. Host-play off: no `players` row is inserted; result omits
  `hostPlayerToken`/`username`; game is created successfully.
- Covers R2. Host-play on: name is validated (empty/invalid name rejected before
  any DB write) and exactly one host `players` row is seated.
- Covers R4. Host-play on with a seat failure: the game row is rolled back (no
  orphaned lobby game) — existing behavior preserved.
- Test expectation: covered through the U4 e2e flows; `createGame` is a thin
  server action with no existing unit harness (per repo conventions), so no new
  unit file unless the branch logic is extracted to `lib/`.

### U3. Host credential + host view — conditional answer UI

**Goal:** Store optional player credentials and render answer controls only when
the host plays; otherwise show the current question read-only.

**Requirements:** R2, R3, R5

**Dependencies:** U2 (result shape)

**Files:**
- `lib/clientSession.ts`
- `app/(host)/host/page.tsx`

**Approach:**
- In `lib/clientSession.ts`, make `HostCredential.playerToken` and `.username`
  optional (`?`). Update the doc comment to note the host may not play.
- In the host view live-question section, branch on `cred.playerToken`:
  - **Present** → render `<AnswerPanel token={cred.playerToken} … />` (unchanged).
  - **Absent** → render the read-only display: for `multiple_choice`, an ordered
    list of `state.current_question.options`; for `type_answer`, just the
    prompt + timer (already shown above). This restores the pre-`78c87b8`
    branch.
- Update the stale U6 header comment ("host-only … does not also play") to
  reflect that host-play is now optional.

**Patterns to follow:** the pre-`78c87b8` read-only `<ol>` options render (see
commit `78c87b8` diff for `app/(host)/host/page.tsx`); existing conditional
rendering in the same section.

**Test scenarios:**
- Covers R3. Non-playing host: during a live multiple-choice question the host
  sees the options read-only with no answer buttons.
- Covers R2. Playing host: `AnswerPanel` renders and the host can submit/lock.
- Covers R5. Non-playing host can start (once a player joins), advance, and
  finish the game.
- Test expectation: exercised via U4 e2e specs.

### U4. e2e — repair host helper and cover non-playing host

**Goal:** Make the e2e host helper submit the required name and add coverage for
the non-playing-host path.

**Requirements:** R6

**Dependencies:** U1, U3

**Files:**
- `e2e/helpers.ts`
- `e2e/game-flow.spec.ts` (or a new `e2e/host-play-option.spec.ts`)

**Approach:**
- In `hostCreateGame`, accept an optional `{ hostName?: string; hostPlays?: boolean }`.
  Default to playing with a name (e.g. "Gamemaster") so the existing happy-path
  spec keeps passing. When `hostPlays === false`, uncheck the toggle and skip the
  name fill.
- Add a spec: host creates a game with host-play **off**, one player joins, host
  starts, the host view shows the question read-only (no answer buttons), the
  player answers, host finishes, both reach results. Assert the host does **not**
  appear on the leaderboard.
- Keep the existing multi-client spec, now driven with a host name.

**Patterns to follow:** existing `hostCreateGame` / `playerJoin` /
`answerFirstOption` helpers and the current `game-flow.spec.ts` structure.

**Test scenarios:**
- Covers R6. Happy path (host plays) still completes end-to-end with the name
  filled.
- Covers R3/R5. Non-playing host: game runs to results; host view shows no
  answer buttons during a live question; host is absent from the leaderboard.
- Test expectation: Playwright specs above (live env; per `e2e/README.md`).

---

## Scope Boundaries

**Deferred to Follow-Up Work**
- Toggling host-play *after* a game is created (this plan sets it only at setup).
- Any leaderboard/results styling changes for the non-playing-host case beyond
  the host simply not appearing.

**Non-goals**
- Changing scoring, judging, challenge/adjudication, or generation.
- Persisting host-play preference across sessions.

---

## Verification Contract

- `npm run typecheck` and `npm run lint` pass.
- `npm test` passes (no unit files change unless branch logic is extracted).
- `npm run test:e2e` passes both the host-plays happy path and the new
  non-playing-host spec (live env required).
- Manual: at `/setup`, default toggle is on and requires a name; unchecking it
  removes the name requirement and yields a host view with a read-only question
  and a leaderboard that excludes the host.

## Definition of Done

- All units (U1–U4) implemented; R1–R6 satisfied.
- Verification Contract gates pass.
- Stale host-only comments updated; no orphaned game path introduced.

---

## Sources & Research

- Commit `78c87b8` ("feat: let the host play too") — the baseline this plan makes
  optional; its diff is the reference for the read-only host-view branch (KTD3).
- `docs/solutions/architecture-patterns/anonymous-realtime-multiplayer-on-supabase-serverless.md`
  — token-auth / seating model context.
- `AGENTS.md` — server/client split and thin-server-action conventions.
