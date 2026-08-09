import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

const config = [
  { ignores: [".next/**", "test-results/**", "playwright-report/**"] },
  ...nextCoreWebVitals,
  {
    // Pre-existing debt in the live-game loop: the host and play views, the
    // realtime hooks and two stage components drive state from effects. These
    // are exactly the files the parity work (U5-U7) replaces with a pure phase
    // module and shared stage components, so fixing them by hand here would be
    // discarded. Kept as warnings — visible, and still errors anywhere new.
    files: [
      "app/(host)/host/page.tsx",
      "app/(play)/play/page.tsx",
      "lib/realtime/hooks.ts",
      "components/AnswerPanel.tsx",
      "components/Podium.tsx",
    ],
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
    },
  },
];

export default config;
