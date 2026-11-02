# BUZZR Trivia — Product checklist

**Purpose:** Single source of truth for expected product behavior.  
Use this to review what the app is supposed to do. Implementation lives in the
codebase; this document is the product contract for hosts, players, and
generation/fairness rules.

**Last consolidated:** 2026-07-19  
**Product name in UI:** BUZZR  

---

## Product summary

Live, Kahoot-style multiplayer trivia for a large group or a small group of friends.

- The **host** configures a game; **xAI/Grok** generates the question set.
- **Players** join by room code on their own devices (no accounts or login required).
- Play is real-time and **speed-scored**.
- AI mistakes are handled with a **pause-to-adjudicate challenge** (host is final arbiter).
- Play is **ephemeral** (no accounts or long-term history), except a durable
  **question bank / voided-question record** used to avoid repeats and bad reuse.

**Stack:** Next.js (App Router) on Vercel · Supabase (Postgres + Realtime) · xAI · Sentry · Resend (feedback email).

---

## Data retention

- [x] Inactive lobbies expire after 24 hours of no persisted activity; ended games and results expire after 7 days. Scheduled cleanup drains bounded batches, including players, questions, answers, challenges and suggestions. Active games and the durable question bank are retained.
- [x] Rate-limit hits expire after 24 hours through scheduled cleanup.

## Actors

| Role | What they do |
|------|----------------|
| **Host (gamemaster)** | Creates the game, shares code/link, starts and advances questions, adjudicates challenges, ends the game. May optionally play as a seated player. |
| **Player** | Joins with code + display name, answers, can challenge questions (and disputed marks when marked wrong). |
| **AI generator** | Produces the question set at setup only; not used for live judging. |

---

## How to use this checklist

- `[x]` = expected shipped behavior (review against production / latest branch).
- `[ ]` = deferred or not in product yet.
- Mark items yourself when reviewing a release.

---

## 1. Landing & access

- [x] Home offers **Host a game** and **Join a game**.
- [x] No login / no accounts for host or players.
- [x] App is publicly reachable on production (no Vercel SSO gate for play).

---

## 2. Host setup

- [x] **Use last settings** restores the last successfully created game’s categories, question count, answer mode, difficulty, host participation and name from this browser. Custom topics are AI-validated again before restoration. **Clear saved settings** removes the saved copy; versioned storage safely ignores invalid/old data and unavailable storage never blocks creation.

- [x] Host can **play too** (default on) with a required display name, or host-only.
- [x] Host selects **one or more categories** from a built-in list (~30+).
- [x] Host may add **custom categories** (free text).
- [x] Custom category **Add** runs an **AI viability check**; thin/joke topics that cannot support enough distinct questions are rejected.
- [x] Total categories capped at **10** (built-in + custom combined).
- [x] Custom categories additionally capped (e.g. max 5 free-text labels).
- [x] Host sets **question count** from **1–100** (default **10**).
- [x] Host chooses **answer mode**: multiple choice or type-the-answer.
- [x] Host chooses **difficulty**: easy / medium / hard.
- [x] Submit is fast — it creates the room only; the host is taken to the host lobby with credentials stored for that tab.
- [x] Question generation runs at **Start game**, not at setup, so the host can review player category suggestions first.
- [x] A room that exists but has not generated questions yet is **joinable but not startable** — an expected state, not a half-initialized game.
- [x] Generation failure at start leaves the host in the lobby with an error and a **retry**; players stay seated and nothing is torn down.
- [x] Create-game is **rate-limited** (abuse / cost protection).

---

## 3. Generation quality

- [x] Full set is generated at **game start** via xAI (structured JSON), then persisted.
- [x] Type-the-answer answers constrained to **one or two easy-to-spell words**.
- [x] Multiple-choice options are validated; **correct option is shuffled** so the right answer is not always first.
- [x] **No two questions in a set share the same correct answer** (normalized). Across *different* games the same answer is permitted, provided the prompts are dissimilar — two unrelated questions may both answer "Paris".
- [x] Prompts are de-duplicated against a durable **question bank**: exact normalized-prompt match, plus **answer-anchored** near-duplicate detection — a candidate sharing a banked question's correct answer is rejected when its prompt is also similar, so rewordings no longer slip through.
- [x] The bank read at generation is scoped to the categories in play and explicitly bounded, never a silently truncated slice of the table.
- [x] Large sets use at most three concurrent AI batches, merged serially to reject sibling duplicates; generation has a bounded time budget.
- [x] Host lobby shows accepted-question progress (e.g. **Writing questions… 36/100**) and recovers progress after reload. Progress polls use independent HTTP reads so updates continue while Start is pending. A failed progress read does not block Start/Retry; the server still enforces the generation lease. Interrupted generation can be retried without removing players.
- [x] Provider timeouts/rate limits and insufficient valid output show distinct host messages with **Retry**.
- [x] Short/invalid batches are **tail-regenerated** until count is met or attempts exhaust (loud failure).
- [x] Difficulty on each stored question matches the host’s selected difficulty.

---

## 4. Join & lobby

- [x] Players join with a **5-digit numeric** room code + display name (no account).
- [x] Join is **rate-limited** per IP.
- [x] Only **lobby / active** games are joinable; ended games do not accept joins (code reusable after end).
- [x] Mid-game join seats a **spectator** for the current question; they play from the next question.
- [x] Players may **suggest categories** on the join screen (optional, from the built-in catalog, capped per player); suggestions travel with the join.
- [x] Host lobby shows suggested categories live, aggregated with a count of how many players asked, and the host **accepts or ignores** each one — nothing a player submits changes the game until the host accepts it.
- [x] Accepted suggestions merge into the host's categories at start and shape the generated set; the category cap still applies.
- [x] Host lobby shows room code, shareable **copy join link**, a high-contrast 320px QR of the absolute join URL (with quiet zone and accessible label), and live roster.
- [x] New joins produce a short **join toast** animation on the host lobby.
- [x] Host can start once at least one player is present (host-only); host-as-player is already seated at create when that option is on.

---

## 5. Live question loop

- [x] Host starts and advances questions (host-authoritative pacing).
- [x] Before each question is answerable, all devices show a synced **3–2–1 get-ready** screen (circular ring; server-stamped `reveal_at`).
- [x] After get-ready, all players see the **same question** and a **server-anchored** countdown (multiple-choice ~20s, type-answer ~35s).
- [x] Answers are judged **server-side**; clients never compute their own score.
- [x] Multiple-choice: exact option match. Type-answer: normalized / fuzzy match against accepted variants.
- [x] Speed scoring: correct answers score **500–1,000** points (full **1,000** in the first second, decaying to **500** at the mode’s deadline); wrong/late = 0.
- [x] Scores are displayed with **US number formatting** (comma every three digits, e.g. **1,000**).
- [x] Correct answers on the player’s device may show **celebration** (confetti / streak badge).
- [x] Live **leaderboard** updates as answers land. Host rows smoothly reorder with rank arrows during review; reduced-motion preference disables reorder animation.
- [x] Review shows each seated player their round points and tied placement with movement from the pre-question snapshot. Missing history after reload omits movement; voids and upheld challenges update the recap from authoritative scores.
- [x] Sound and haptics default on with a visible, persisted mute toggle. Synthesized final-three-second ticks, correct/wrong review cues and a game-over fanfare start only after a gesture; lock-in/result vibration respects reduced motion. Unsupported or blocked audio never affects play.
- [x] When all active players have answered **or** the timer ends, the room enters **review** (answers locked). The host requests timer close after the server deadline plus 750 ms. Players act as a fallback at 2000–3000 ms after the deadline, giving the host’s review broadcast time to arrive while still recovering from a backgrounded host tab.
- [x] During a question, everyone sees the answered count; the host also sees player chips light up as answers lock in and can **End question now** early. Player progress exposes counts only, never answer text or correctness.
- [x] Ending a game atomically rejects open challenges and clears pause/review state; repeated end requests are safe.
- [x] During review, host and players see the **correct answer** (and host sees distribution where applicable).
- [x] R23: After the answer reveal, everyone sees a one-sentence “Did you know?” explanation (at most 25 words). Missing/invalid explanations are omitted without blocking generation. Explanations are hidden for corrected or voided questions because the original fact may be misleading, even without mentioning the old answer.
- [x] Host advances with **Next question** or **Finish game** on the last question.
- [x] Open challenges **block** advancing until adjudicated.

---

## 6. Challenges & fairness

- [x] Active (non-spectator) players can **Challenge this question** during live play and **during review** (prominent control).
- [x] Players marked wrong can raise **My answer was wrongly marked** (when they have a submission).
- [x] A challenge **pauses** the game for everyone.
- [x] Host sees open challenges (with answer keys for adjudication) and can **Uphold** or **Reject**.
- [x] Uphold **question** challenge: void question, reverse scores for that question, record correction path for bank/quality.
- [x] Uphold **answer** challenge: count that player’s answer correct and rescore.
- [x] Reject: leave scoring as-is; resume when no open challenges remain.
- [x] Per-player **challenge cap** prevents indefinite stalling.
- [x] Spectators cannot raise challenges.

---

## 7. Results & after-game

- [x] R25: ended-only personal recap below standings lists every prompt, own answer (or no answer), correction-aware key, void/correct/wrong status, adjudicated points including double-points finale, and recorded elapsed time. Questions collapse for 100-question games. Historical answers without recorded timing show “Time unavailable”.
- [x] Personal stats show accuracy (missing answers count as wrong; voids excluded), fastest correct answer, best streak (voids skipped), and authoritative total points. Room highlights include all ties for hardest question (correct / room players), most challenges (including voided questions), and fastest player by single correct answer. Host-only and spectators see room highlights; playing hosts also see their own recap. No other player's raw answers are returned.

- [x] Host and players both see a **unified end experience**: sequenced **podium** (3rd → 2nd → 1st where applicable) plus **full standings** with scores.
- [x] Players may see personal placement (“you placed Nth”) when their identity is known.
- [x] Ties for a podium rank **share the step**.
- [x] End screen offers **Share result** with tied placement and the site root URL only (no room code or tokens); unsupported native sharing falls back to clipboard with success confirmation.
- [x] **Start a new game** returns everyone to the **home** page.
- [x] End screen includes **feedback**: free-text submit emailed to the product owner (`FEEDBACK_TO_EMAIL` / default product inbox) via Resend (`RESEND_API_KEY`, `RESEND_FROM`).
- [x] Ending the game retires the room for joins; no long-term player accounts or history.

---

## 8. Security & reliability (product-facing)

- [x] Host and player **tokens** are the write credentials (host token stored hashed; player token hashed at rest).
- [x] Server actions authorize by token; clients never supply trusted player ids for writes.
- [x] Clients read via token-validated RPCs; tables are default-deny RLS.
- [x] Answer keys are not exposed while a question is still answerable.
- [x] Broadcast is best-effort; clients **hydrate** authoritative state immediately on subscribe/reconnect and phase changes. Leaderboard/join bursts coalesce for 250ms (maximum scheduling delay 1s), with one hydrate in flight per client.
- [x] Reloading a live question restores the player’s locked answer, points, streak badge, and marked-wrong dispute option, including the playing host’s answer.
- [x] Phase locks: no submit during review/pause/ended; advance cannot skip open challenges or revive ended games.
- [x] Optional Sentry error monitoring when DSN is configured.

---

## Explicitly deferred / out of scope

- [ ] Accounts, profiles, saved history, rematch-with-same-roster as a first-class feature.
- [ ] Pre-game host edit/review of every AI question before the room opens.
- [ ] Large-crowd scaling (100+ players) and associated infra.
- [ ] Classroom / public content-safety filtering of AI questions.
- [ ] Semantic/embedding-based question dedup. Lexical, answer-anchored dedup now exists (§3); embeddings remain out of scope — revisit only if rewordings still get through after threshold tuning.
- [ ] Per-host private question banks.
- [ ] Real model fine-tuning from challenges.
- [ ] Compensating speed score for each client’s network latency beyond server submit time.
- [ ] Ability to upload your own list of questions.

---

## Suggested review pass (manual)

1. Host: multi-category (≤10), custom category AI check, 1–100 questions (default 10) → create.  
2. Player join + host join toast + start → 3–2–1 → question.  
3. Answer, leaderboard (US-formatted scores), review reveal, challenge → host uphold/reject.  
4. Next question → 3–2–1 → play through finish.  
5. Host and player end screens: podium, standings, home link, feedback email.  

**Production:** https://trivia-app-nine-blue.vercel.app  

---

## Document history

This checklist **replaces** the interim plan set previously under `docs/plans/`:

- `2026-06-30-001-feat-ai-trivia-game-plan.md`
- `2026-07-02-001-feat-optional-host-play-plan.md`
- `2026-07-02-002-feat-ux-enhancements-plan.md`
- `2026-07-03-001-fix-review-phase-fixes-plan.md`

Those files were removed to avoid conflicting/outdated requirement lists. Architecture notes may still live under `docs/solutions/`. Agent setup notes remain in `AGENTS.md`.

## Deterministic verification

- Multiplayer E2E runs against local Supabase with server-only canned questions in both answer modes (up to 100); no paid AI calls or hosted credentials in CI.
- A separate, initially non-blocking E2E workflow applies repository migrations to its disposable local stack and cleans created games. Real xAI compatibility is an explicit opt-in smoke test.

### Session recovery (R3 / R4)

- Browser credentials persist for 12 hours since last use, with legacy tab-session recovery. Invalid credentials are removed; ended rooms are hidden from recovery offers while their credentials remain until expiry for results, placement and feedback; storage restrictions do not prevent play.
- Home verifies saved rooms before offering host resume or player rejoin; join offers the remembered player seat alongside the editable new-player form for the entered code, preserving entered usernames and selected categories.
- Hosts can copy a private recovery link in the lobby. Tokens travel only in its fragment, which is removed on arrival; playing hosts recover their player identity too. Anyone holding this link can control the game.

### Configurable pacing and finale (R19, R31)

- Host setup offers a 10/20/30/40/50/60-second answer timer. Mode default remains
  20 seconds for multiple choice and 35 seconds for type-answer. Countdown,
  auto-close, speed scoring, and upheld-answer rescoring use the same window.
- Optional auto-advance waits 5/8/10/15 seconds after entering review (off by
  default). Any connected participant can request a due advance when the host
  tab sleeps; the server verifies the deadline and current index. Challenges
  block it and resolving the last challenge restarts the full review delay.
- During review the host can advance manually or pause/resume auto-advance for
  that question. The final question always waits for the host to finish.
- Optional double-points finale announces “Final question — double points!”
  during get-ready. Correct final answers earn 1000–2000 points, including
  upheld disputes; wrong/late answers still earn zero.


### R29 — accessibility

- Shared gameplay moves focus to the phase heading on get-ready, question,
  review and next-question transitions; results focus their heading. Timer ticks
  preserve the player's current focus.
- Dedicated polite announcements describe phases and challenge pauses. Timer
  warnings change only at 10 seconds, 5 seconds and expiry. Countdown rings have
  textual accessible names; results and correct/locked answers use text.
- MC buttons expose letter, shape and answer names. Arrow/Home/End keys move
  among tiles (forward from the prompt enters A, backward enters the last tile);
  1–4 select from the question heading or tiles. Typed answers submit
  with Enter. Inline host adjudication controls follow the document tab order.
- Visible focus outlines, dark answer text, darker pink primary buttons and
  success/error text, and contrasting input borders support the BUZZR palette.
  Shapes, text and correctness symbols supplement colour.
- Reduced motion disables CSS animation/transitions throughout the app and
  reveals the podium immediately. Leaderboard movement and haptics already
  respect the preference and are covered by unit tests.
- Fixture E2E axe scans fail on serious/critical WCAG A/AA findings across home,
  setup, join and both roles' game phases, with no rule exceptions. MC and typed
  rounds exercise keyboard controls. Coverage includes pre-game review and
  regenerate/remove focus recovery, recap disclosures and standalone results,
  display-link mint/regenerate/revoke, all TV phases, and rematch transfer into
  the next lobby. No migration is needed.
- Question edits name their question and announce success or failure accurately. New room/lobby
  focus and announcements identify the rematch destination. TV headings receive
  focus on phase changes and invalid/revoked links; timer ticks preserve focus.
- Display link controls announce success/revocation and focus the ready link or
  return to Open TV display. These are inline panels, not modal dialogs; native
  recap disclosures preserve summary focus when expanded/collapsed.
- Fredoka is bundled from npm so fixture CI and app builds require no external
  Google font request.

### R22 — Optional pre-game question review

- Default **Start game** still generates and reveals Q1 in one step.
- **Review questions first** uses the same generation/progress/retry flow, leaves players in the lobby, and shows the host the full prompts, options/correct answers or accepted answers, explanations, and game categories. Answer keys use a dedicated host-token-authorized server action, never player hydration.
- Answer keys appear only after this host screen explicitly chooses review; that choice persists across reloads in browser session storage. Default Start never fetches or displays the review panel, even if prepared questions remain in the lobby after a failed reveal. Other host tabs must opt in separately.
- The host can regenerate individual questions with the same settings, in-set answer uniqueness and bank dedup, or remove questions (contiguous numbering, count updated, at least one remains). Start reuses the prepared set, including after reload.
- Regeneration is limited to 20 attempts per room, including failed attempts, plus five requests per minute. Concurrent host tabs and Start are serialized using a database lease/row lock; expired work cannot overwrite the set.
- Once generated, category suggestions cannot change the prepared set; the lobby explains this and hides acceptance controls. Hosts who review while also playing will know the answers.

### Rematches (R26)

- [x] The host can choose **Play again (same players)** on the end screen. A new room copies categories, question count, answer mode, difficulty, timer, auto-advance and finale options; questions and scores start fresh.
- [x] Players still viewing results automatically enter the new lobby with their username and a new credential. Reloading results also discovers the rematch. Taken names receive a deterministic numbered suffix. The host retains hosting and playing participation.
- [x] Repeated host requests return the same rematch; only the old host can create it, using the shared create-game rate limit. Players can transfer only from their own old game; host credentials are never exposed through hydration or broadcasts. Players who left can join normally by the new code.

### R21 — Presenter / TV display

- The host can open, regenerate, or revoke a private TV display link from the host header (including the lobby). The private link/QR carries a separate display token only in its URL fragment; opening it scrubs the fragment and keeps the credential in tab storage.
- `/display?code=12345` is a read-only screen for a TV/projector, with viewport-scaled, high-contrast type for 1080p/4K: lobby join QR/code/roster, 3–2–1, question/options/timer, anonymous answered count, review answer/distribution/explanation, round leaderboard/rank movement, generic challenge pause, and podium/final standings.
- The display never answers, challenges, adjudicates, closes or advances a question. It uses coalesced room hydration and reconnect recovery; a read-only periodic refresh detects missed revocations. Before review no answer key or distribution is readable; private challenge details and player suggestions remain host-only.
- Long rosters/standings rotate through presentation pages every eight seconds, preserving full-board ranks without requiring TV controls.
- Display credentials are hashed separately on games and have no player identity. Replacing/revoking a link invalidates the old credential. Owner applies `0023_tv_display.sql` before deploying this feature.
