# Handoff: Buzzr Trivia UX Refresh

## Overview
A visual/UX refresh of the trivia app (rebranded "BUZZR" in the mockup — rename optional) adding motion, celebration moments, and mobile-first polish across the full host + player flow.

## About the Design Files
`buzzr-trivia-redesign.dc.html` is a **design reference built in HTML** — a clickable prototype showing intended look, motion, and copy. It is NOT production code to paste in. The task is to **recreate this design inside the existing Next.js/React codebase** (`ltappa-wq/Trivia-App`), using its current architecture: server actions, Supabase realtime, and the existing component set (`AnswerPanel`, `AnswerReveal`, `Fireworks`, `JoinToast`, `Podium`), replacing `app/globals.css` styling and extending those components — not rewriting the data/realtime logic.

## Fidelity
**High-fidelity.** Colors, type, spacing, and motion in the mock are intended as final — implement pixel-close using the tokens below, adapted to CSS custom properties in `globals.css` (the current file already uses CSS vars in `:root`, so token swap-in is direct).

## Design tokens

Colors (replace the `:root` block in `app/globals.css`):
```
--ink: #201c33
--muted: #716c88
--surface: #ffffff
--surface-2: #f5f2fb
--border: #e7e2f5
--accent: oklch(0.64 0.19 340)      /* was --accent: #6d5efc */
--accent-strong: oklch(0.52 0.19 340)
--accent-soft: #f5f2fb
--accent-b: oklch(0.80 0.15 95)     /* new: gold, used for 1st place / celebration */
--blue: oklch(0.62 0.16 250)        /* new: 2nd answer-tile color */
--success: oklch(0.70 0.17 150)
--success-strong: oklch(0.55 0.15 150)
--danger: oklch(0.60 0.20 25)
--bg-grad-1: oklch(0.26 0.08 300)   /* was #1b1440 */
--bg-grad-2: oklch(0.15 0.045 280)  /* was #0f0b1e */
```

Typography:
- Headings/buttons/scores: **Fredoka** (600/700) — rounded, playful, replaces the current system-font headings.
- Body/inputs: keep existing **Inter/system-ui** stack.

Radii: cards 20px, inputs/buttons 12–14px, pills 999px (unchanged scale from current CSS, just apply consistently).

## Screens covered in the prototype (11 steps, use the step nav/dots to browse)
1. **Home** — hero rename + two big CTA buttons ("🎤 Host a game" / "🏃 Join a game"), floating decorative shapes (`app/page.tsx`)
2. **Host Setup** — rotating one-line joke tagline under the title (rotate every ~2.2s, 4 lines provided), colorful category pills, +/- question-count stepper, 3-button difficulty selector, animated CTA (`app/(host)/setup/page.tsx`)
3. **Host Lobby** — big tiled room code, bouncing "X joined" toasts (staggered `joinPop` keyframe, 150ms stagger), player chip grid, **new: copy-shareable-join-link row** with a Copy button (`navigator.clipboard.writeText`, shows "✓ Copied" for ~1.6s) (`app/(host)/host/page.tsx`, `components/JoinToast.tsx`)
4. **Player Join** — big digit-box code display, username field, bolt-icon submit (`app/(play)/join/page.tsx`)
5. **Player Waiting** — bouncing controller emoji, animated waiting dots, "also here" chip list (`app/(play)/play/page.tsx`, lobby state)
6. **Host Live Question** — two-column layout (question+timer left, live leaderboard right; **collapses to one column under 720px** — implement via a real CSS media query, the prototype fakes it with a JS width listener since inline-style-only tooling forced that workaround), color/shape-coded answer tiles (▲ ◆ ● ★), circular countdown ring that shifts to red + shakes at ≤3s
7. **Player Answering** — same countdown/tile treatment, phone-first; tapping a tile locks in immediately and reveals correct/wrong inline (matches current `AnswerPanel` behavior)
8. **Player Correct** — confetti burst (24 particles, radial `confettiBurst` keyframe) + trophy + streak badge "🔥 3 in a row!" (`components/Fireworks.tsx` — extend this, don't replace)
9. **Host Review** — correct tile highlighted with ✅, per-option answer-distribution bar (new — needs a distribution query/RPC if not already available server-side)
10. **Host Podium** — sequential reveal 3rd→2nd→1st (900ms steps) with confetti on 1st reveal (`components/Podium.tsx` already has this sequencing logic — just apply new visual styling, no logic change needed)
11. **Player Results** — personal placement card ("You placed 2nd!") above full standings, winner row styled (`app/(play)/results/page.tsx`)

## Interactions & motion specifics
- Countdown ring: `conic-gradient(color pct%, var(--border) 0)`, color `--accent` → `--danger` at ≤3s, adds a horizontal shake keyframe at urgency.
- Join toast: `joinPop` cubic-bezier(.22,1,.36,1), 700ms, staggered per-item delay.
- Confetti: radial burst, particle count/duration/travel-distance are the three "motion intensity" tunables (subtle/playful/big) — see Tweaks in the prototype for exact numbers if you want a settings toggle server-side too.
- Copy-link button: optimistic UI, resets after 1.6s regardless of clipboard permission result (fails silently in sandboxed contexts).

## Assets
No external images — all iconography is emoji (kept deliberately, matches the app's existing lightweight style) plus CSS shapes (triangle/diamond/circle/star via unicode glyphs, not custom SVG).

## Files
- `buzzr-trivia-redesign.dc.html` — the interactive prototype (open directly in a browser; use the step arrows/dots at the top to move through all 11 screens).
- `screenshots/01-home.png` … `11-player-results.png` — static capture of each screen in order, matching the numbered list above.
