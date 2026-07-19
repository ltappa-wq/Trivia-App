# AGENTS.md

Guidance for agents working in this repo.

## Project

AI Trivia Game — a live, Kahoot-style multiplayer trivia web app. The gamemaster
configures a game, xAI generates the question set, and players join by room code
on their own devices for a real-time, speed-scored round with a pause-to-adjudicate
challenge mechanism. Play is anonymous and ephemeral (no accounts).

**Stack:** Next.js (App Router, TypeScript) on Vercel · Supabase (Postgres +
Realtime) · xAI/Grok for generation.

## Commands

- `npm run dev` — local dev server
- `npm run build` / `npm run start` — production build / serve
- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` — ESLint (`next lint`)
- `npm test` — Vitest unit/integration (excludes `e2e/`)
- `npm run test:e2e` — Playwright multi-client realtime specs (needs live env; see `e2e/README.md`)

## Setup

- Secrets live in `.env` (gitignored); `.env.example` documents every key with
  placeholders — never put a real key in `.env.example`.
- Schema is in `supabase/migrations/` (`0001`–`0003`); apply them to the Supabase
  project before running (SQL Editor or `supabase db`).

## Conventions

- **Server/client split:** client-callable server actions start with `"use server"`
  (`app/actions/*`); server-only helpers `import "server-only"`. The privileged
  service-role Supabase client (`lib/supabase/server.ts`) is server-only; the browser
  uses the anon client (`lib/supabase/browser.ts`) for Realtime + token-validated RPCs.
- **Write-side authorization:** the service-role client bypasses RLS, so every server
  action authorizes its own caller by token (host or player) — never trust a
  client-supplied id. Tables are default-deny RLS; clients read only via
  security-definer RPCs.
- Imports use the `@/` alias for cross-directory paths, relative paths within a
  directory. Keep pure logic (judging, scoring, generation validation) in unit-tested
  `lib/` modules; keep server actions thin.

## Documentation

- `docs/PRODUCT-CHECKLIST.md` — product source of truth (expected functionality checklist).

- `docs/solutions/` — documented solutions to past problems (bugs, best practices,
  architecture/workflow patterns), organized by category with YAML frontmatter
  (`module`, `tags`, `problem_type`, `component`). Relevant when implementing or
  debugging in a documented area — e.g. the anonymous realtime/RLS/token-auth
  architecture is captured under `architecture-patterns/`.
- `docs/plans/` — implementation plans and their Key Technical Decisions (KTD*),
  which the code comments reference by id.
