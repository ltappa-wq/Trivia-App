// Test stub for the `server-only` package. The real module throws when imported
// outside a React Server Component graph, which breaks Vitest's node runner. In
// tests we alias `server-only` here (see vitest.config.ts) so server modules —
// which are only ever imported by server actions/RPCs at runtime — remain
// unit-testable. Production builds still use the real `server-only` guard.
export {};
