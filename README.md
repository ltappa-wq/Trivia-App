# BUZZR

BUZZR is a live, Kahoot-style AI trivia game. A host configures a game, xAI/Grok
generates questions, and players join by room code for real-time, speed-scored
play with challenges the host can adjudicate. Play is anonymous and ephemeral;
no accounts are required.

## Stack

Next.js 16 App Router, React 19 and TypeScript · Supabase Postgres + Realtime ·
xAI/Grok · Vercel deployment.

## Get started

Prerequisites: Node.js 20.9+ and npm, a Supabase project, and an xAI API key.
Use a separate development Supabase project for local work.

```sh
npm ci
cp .env.example .env
```

Fill in the required Supabase URL, anon key, server-only service-role key and
xAI key in `.env`; optional settings are documented in `.env.example`. Never
commit secrets. Apply the files in `supabase/migrations/` in numbered order to
your development project using the [migration runbook](docs/MIGRATIONS.md).
Then run `npm run dev` and open http://localhost:3000.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Local development server |
| `npm run build` / `npm run start` | Production build / serve |
| `npm run typecheck` | TypeScript checks |
| `npm run lint` | ESLint (`eslint . --max-warnings=0`, flat config) |
| `npm test` | Vitest unit and integration tests |
| `npm run test:e2e` | Playwright multi-client tests; requires local Supabase and Chromium ([setup](e2e/README.md)) |

## Project layout

- `app/` — routes and pages; `app/actions/` contains token-authorized server actions.
- `lib/` — game logic, generation, scoring and Supabase helpers.
- `components/` — shared UI.
- `supabase/migrations/` — ordered database schema and RPC migrations.
- `e2e/` — Playwright realtime scenarios.
- `docs/` — product checklist, operational guidance and design references.

## Documentation

- [Product checklist](docs/PRODUCT-CHECKLIST.md) — expected functionality.
- [Migration runbook](docs/MIGRATIONS.md) — owner-operated database releases.
- [Documented solutions](docs/solutions/) — architecture and past fixes.
- [Agent guidance](AGENTS.md) — repository conventions.
- [Design handoff](docs/design/README.md) — UX reference and screenshots.
