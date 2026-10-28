# BUZZR Trivia Improvement Plan

This is the working checklist for reviewing and improving the app step by step.
Complete and verify each item before moving to the next. Keep this file updated
as implementation decisions or priorities change.

## Phase 1: Stabilize Data Mutations

- [x] Map multi-step write paths for answer submission, scoring, challenge adjudication, and room creation. Document invariants and failure points.
- [x] Make answer submission and score updates atomic, with explicit outcomes for duplicate or replayed submissions.
- [x] Make challenge creation/pause and challenge rulings/score changes atomic; duplicate rulings do not apply twice.
- [x] Make game creation cleanup failures detectable after generation or host seating failures.
- [ ] Add tests for partial failures, retries, duplicate calls, and concurrent submissions/rulings.

## Phase 2: Operational Safeguards

- [ ] Bound and validate rate-limit RPC inputs on the server/database side.
- [ ] Test rate limiting under concurrent requests; assess the current per-hit delete/count approach under expected load.
- [ ] Define retention periods for abandoned lobbies, ended-game data, and rate-limit hits.
- [ ] Add scheduled cleanup and verify it cannot delete active games or durable question-bank records.
- [ ] Add deployment verification that required Supabase migrations and RPCs are present.

## Phase 3: Observability and Repeatable Tests

- [ ] Add structured, privacy-safe telemetry for generation latency/failures, game transitions, and realtime recovery.
- [ ] Avoid recording tokens, raw answers, or unnecessary personal/network data in logs and telemetry.
- [ ] Make core gameplay e2e tests deterministic with mocked question generation.
- [ ] Ensure e2e fixtures clean up created game data, including after interrupted or failed runs.
- [ ] Retain a smaller live integration suite for Supabase and xAI compatibility.
- [ ] Expand multi-client coverage for concurrent submissions, challenge/advance races, and disconnects during pauses.

## Phase 4: Host Setup and Generation Experience

- [ ] Add optional pre-game review and editing of generated questions.
- [ ] Show generation progress for multi-batch question sets.
- [ ] Distinguish retryable provider failures from invalid or insufficient generated output, with useful recovery actions.
- [ ] Add question quality checks for factual issues and ambiguous answers.
- [ ] Add content-safety checks, with a clear host override or correction flow where appropriate.

## Phase 5: Accessibility and Scale Readiness

- [ ] Add automated accessibility checks to the validation workflow.
- [ ] Verify keyboard, touch, focus management, live-region announcements, and reduced-motion behavior.
- [ ] Load-test the current supported room size and record performance thresholds.
- [ ] Define acceptance criteria before increasing the player cap.
- [ ] Revisit realtime hydration frequency and payload size based on load-test results.

## Additional Product Enhancements

- [ ] Add browser-local game configuration presets without introducing accounts or persistent player history.
- [ ] Improve host recovery and document behavior when the host reloads or loses tab-local credentials.
- [ ] Reassess the documented player limit and architecture before marketing or enabling larger rooms.

## Completion Notes

For each completed checklist item, record the implementation PR/commit or relevant code paths and the verification performed. Split an item into smaller tasks if it is not independently implementable or testable.

### Phase 1 implementation notes

- Atomic gameplay RPCs are in `supabase/migrations/0011_atomic_game_writes.sql`; service-role only. Answer writes include score and all-answered review transition. Challenge creation includes pausing, and resolution includes challenge state, void/rescore, and resume state.
- Server action wiring is in `app/actions/submitAnswer.ts`, `app/actions/challenge.ts`, and `app/actions/adjudicate.ts`. Game cleanup error handling is in `app/actions/createGame.ts`.
- Static migration contract tests were added to `lib/db/__tests__/schema.test.ts`. `npm test` and `npm run typecheck` pass. Database-backed race/failure-injection tests remain outstanding because they require applying the migration to a Supabase test database; the migration has not been applied or exercised against a live database in this pass.
- Direct ESLint invocation is currently unavailable: ESLint 9 is installed while the repository only has legacy `.eslintrc.json` configuration.
