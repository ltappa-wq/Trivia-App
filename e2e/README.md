# Deterministic multiplayer E2E

Playwright drives the real app, Postgres RPCs and Realtime against **local
Supabase only**. Normal runs use server-side canned questions: no xAI key,
provider requests, hosted database credentials or production data are needed.
The suite covers lobby sync, challenge adjudication/results, host-only play,
typed answering and persisted answers, and reconnect hydration.

## Local run

Install Docker and the Supabase CLI (CI pins CLI 2.122.0), then:

```sh
npm ci
supabase start
supabase db reset --local --no-seed
supabase status -o env
npx playwright install chromium
```

Export `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY` from the local status output (`API_URL`, `ANON_KEY`,
`SERVICE_ROLE_KEY`). Do not use a hosted project or production credentials.
`db reset --local` destroys only the local stack's data and applies all repo
migrations; no new migration is required for fixtures.

```sh
npm run test:e2e
supabase stop --no-backup
```

Playwright starts a fresh `npm run dev` with `GENERATION_MODE=fixture` and
`E2E_TEST_MODE=1`; it does not reuse an existing server. Remove conflicting local
`.env*` settings if needed; explicitly exported environment variables take
precedence. `E2E_BASE_URL` can point to a separately configured **local** app;
that app must be started with the fixture variables itself. It does not change
the database safety check or load credentials from `.env` into Playwright.

Fixture prompts are `Fixture 1: spell the number 0.` through `Fixture 100: spell
the number 99.`. MC answers use fixed options with the spelled number first;
typed answers accept that spelling. Review regeneration uses distinct fixture numbers 100–119, deterministically keyed
to the room regeneration attempt. The review spec verifies regenerate → remove →
reload → Start reuses the saved set and keeps players waiting during review.
Fixture generation bypasses question-bank
reads/writes, so repeated runs cannot exhaust or pollute it. Each spec registers
created game IDs from the host credential immediately after setup redirects; a fixture deletes those
games (including dependent rows via cascade) even if assertions fail. A killed
runner may leave rows; resetting the disposable local DB clears them.

The mode and fixture module are server-only. `GENERATION_MODE=fixture` is honored
only outside production, or with the additional explicit `E2E_TEST_MODE=1` flag.
Every fixture generation logs a loud warning. Never set these flags on a deployed
production app. Host-token authorization and all normal game writes remain active.

## CI

`.github/workflows/e2e.yml` starts an isolated Docker-based Supabase stack on
GitHub's Ubuntu runner, resets it with repository migrations, obtains generated
local credentials, installs Chromium, and runs Playwright. No GitHub secrets or
Supabase link/login are used. It follows the [Supabase local CI workflow](https://supabase.com/docs/guides/deployment/managing-environments).
The separate job initially has `continue-on-error: true`; unit/lint/typecheck CI
remains blocking. Failures retain Playwright traces for seven days. Cold image
pulls make this slower than unit tests; the stack is stopped in an always step.

## Opt-in real xAI smoke

With the same **local** database and an explicitly exported development
`XAI_API_KEY`, run:

```sh
E2E_LIVE_XAI=1 npm run test:e2e
```

This selects only one tiny provider-compatibility smoke spec, disables fixture
mode on the fresh app server, and creates one MC question through the real xAI
path. It costs provider usage and is skipped in normal runs/CI. An externally
started app must also have fixture mode disabled. No live Supabase is allowed.

Mixed fixtures follow MC → typed → true/false → MC. Binary statements use number parity and canonical True/False tiles. `mixed-mode.spec.ts` completes a three-type game, checks keyboard controls and axe, TV/review/recap rendering, hydration errors, and rematch mode. Playwright retries are disabled.
