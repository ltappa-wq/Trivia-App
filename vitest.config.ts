import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      // The real `server-only` package throws outside an RSC graph, which breaks
      // the node test runner. Alias it to a no-op so server modules stay testable.
      "server-only": fileURLToPath(
        new URL("./test/stubs/server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    // Playwright specs live in e2e/ and run via `npm run test:e2e`, not Vitest.
    exclude: ["node_modules/**", "e2e/**", ".next/**"],
  },
});
