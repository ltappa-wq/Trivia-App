import { getServiceClient } from "@/lib/supabase/server";
import { authorizeHostByCode } from "@/lib/serverAuth";
import { generationProgress } from "@/lib/generation/progress";

const headers = { "Cache-Control": "private, no-store" };

/** A separate HTTP read bypasses the client's sequential Server Action queue. */
export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code") ?? "";
  const token = request.headers.get("authorization")?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) return Response.json({ error: "Host authorization required" }, { status: 401, headers });
  if (!/^\d{5}$/.test(code)) return Response.json({ error: "Invalid room code" }, { status: 400, headers });

  try {
    const game = await authorizeHostByCode(getServiceClient(), code, token);
    return Response.json(generationProgress(game), { headers });
  } catch {
    // Do not disclose room existence or server-side lookup details.
    return Response.json({ error: "Could not load generation progress" }, { status: 403, headers });
  }
}
