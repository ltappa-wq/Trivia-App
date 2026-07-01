import "server-only";
// Shared request helpers for server actions. Reading the caller IP feeds the
// per-IP abuse guards (createGame cost-DoS, join-code enumeration; KTD7, KTD10).

import { headers } from "next/headers";

export async function callerIp(): Promise<string> {
  const h = await headers();
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown"
  );
}
