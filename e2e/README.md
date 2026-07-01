# Realtime e2e (Playwright, multi-client)

Covers the plan's Verification Contract rows that unit tests can't: live-lobby
roster, cross-device question sync, challenge pause/resume + adjudication,
results (`game-flow.spec.ts`), and hydrate-on-reconnect (`reconnect.spec.ts`).

## Prerequisites

These specs drive the **real** app against **live Supabase + xAI**, so they
need a configured environment and cost a small amount of xAI usage per run.

1. `.env` populated (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `XAI_API_KEY`) and the migrations applied.
2. Playwright browser installed once: `npx playwright install chromium`.

## Run

```bash
npm run test:e2e
```

The Playwright `webServer` starts `npm run dev` automatically. To run against an
already-running server (e.g. a production build via `npm run start`), set
`E2E_BASE_URL=http://localhost:3000` and it will skip launching one.

## Notes

- Each participant runs in its own `BrowserContext` so per-tab `sessionStorage`
  credentials stay isolated — the real "different devices" model.
- Question text is AI-generated (non-deterministic), so assertions compare the
  prompt *across clients* rather than against fixed strings.
- Runs create real game rows; `game-flow` ends its game, but interrupted runs may
  leave lobby games behind — clean up in the Supabase dashboard if needed.
