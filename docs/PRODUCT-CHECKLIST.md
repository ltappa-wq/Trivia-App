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

- [x] Host can **play too** (default on) with a required display name, or host-only.
- [x] Host selects **one or more categories** from a built-in list (~30+).
- [x] Host may add **custom categories** (free text).
- [x] Custom category **Add** runs an **AI viability check**; thin/joke topics that cannot support enough distinct questions are rejected.
- [x] Total categories capped at **10** (built-in + custom combined).
- [x] Custom categories additionally capped (e.g. max 5 free-text labels).
- [x] Host sets **question count** from **1–100** (default **10**).
- [x] Host chooses **answer mode**: multiple choice or type-the-answer.
- [x] Host chooses **difficulty**: easy / medium / hard.
- [x] Submit shows a generating state; on success, room is created and host is taken to the host lobby with credentials stored for that tab.
- [x] Generation failure surfaces error with **Retry** / **Back to edit**; no half-initialized joinable game left behind.
- [x] Create-game is **rate-limited** (abuse / cost protection).

---

## 3. Generation quality

- [x] Full set is generated at setup via xAI (structured JSON), then persisted.
- [x] Type-the-answer answers constrained to **one or two easy-to-spell words**.
- [x] Multiple-choice options are validated; **correct option is shuffled** so the right answer is not always first.
- [x] **No two questions in a set share the same correct answer** (normalized).
- [x] Prompts are de-duplicated against a durable **question bank** (normalized prompt text).
- [x] Short/invalid batches are **tail-regenerated** until count is met or attempts exhaust (loud failure).
- [x] Difficulty on each stored question matches the host’s selected difficulty.

---

## 4. Join & lobby

- [x] Players join with a **5-digit numeric** room code + display name (no account).
- [x] Join is **rate-limited** per IP.
- [x] Only **lobby / active** games are joinable; ended games do not accept joins (code reusable after end).
- [x] Mid-game join seats a **spectator** for the current question; they play from the next question.
- [x] Host lobby shows room code, shareable **copy join link**, and live roster.
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
- [x] Live **leaderboard** updates as answers land.
- [x] When all active players have answered **or** the timer ends, the room enters **review** (answers locked).
- [x] During review, host and players see the **correct answer** (and host sees distribution where applicable).
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

- [x] Host and players both see a **unified end experience**: sequenced **podium** (3rd → 2nd → 1st where applicable) plus **full standings** with scores.
- [x] Players may see personal placement (“you placed Nth”) when their identity is known.
- [x] Ties for a podium rank **share the step**.
- [x] **Start a new game** returns everyone to the **home** page.
- [x] End screen includes **feedback**: free-text submit emailed to the product owner (`FEEDBACK_TO_EMAIL` / default product inbox) via Resend (`RESEND_API_KEY`, `RESEND_FROM`).
- [x] Ending the game retires the room for joins; no long-term player accounts or history.

---

## 8. Security & reliability (product-facing)

- [x] Host and player **tokens** are the write credentials (host token stored hashed; player token hashed at rest).
- [x] Server actions authorize by token; clients never supply trusted player ids for writes.
- [x] Clients read via token-validated RPCs; tables are default-deny RLS.
- [x] Answer keys are not exposed while a question is still answerable.
- [x] Broadcast is best-effort; clients **hydrate** authoritative state on subscribe/reconnect.
- [x] Phase locks: no submit during review/pause/ended; advance cannot skip open challenges or revive ended games.
- [x] Optional Sentry error monitoring when DSN is configured.

---

## Explicitly deferred / out of scope

- [ ] Accounts, profiles, saved history, rematch-with-same-roster as a first-class feature.
- [ ] Pre-game host edit/review of every AI question before the room opens.
- [ ] Large-crowd scaling (100+ players) and associated infra.
- [ ] Classroom / public content-safety filtering of AI questions.
- [ ] Semantic/embedding-based question dedup (beyond normalized text).
- [ ] Per-host private question banks.
- [ ] Real model fine-tuning from challenges.
- [ ] Compensating speed score for each client’s network latency beyond server submit time.
- [ ] Hiding the question payload during the between-question lead-in. The prompt/options are broadcast at reveal (3s before answering opens); the server blocks early *scoring* but not early *reading*, so a modified client could pre-read (esp. type-answer) during the lead-in. Accepted for ephemeral social play; the anti-cheat guard still prevents early submits.
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
