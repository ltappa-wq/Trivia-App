import "server-only";
// Shared request helpers for server actions. Reading the caller IP feeds the
// per-IP abuse guards (createGame cost-DoS, join-code enumeration; KTD7, KTD10).

import { headers } from "next/headers";

export async function callerIp(): Promise<string> {
  const h = await headers();
  // Prefer x-real-ip: the platform (e.g. Vercel) sets it to the true client and
  // clients don't append it. The leftmost X-Forwarded-For entry is
  // client-influenceable behind a plain appending proxy, so a spoofed value
  // could rotate the rate-limit key and evade the abuse guards (KTD7/KTD10).
  return (
    h.get("x-real-ip")?.trim() ||
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}
