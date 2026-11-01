import type { LeaderboardEntry } from "@/lib/db/types";
import { ordinal, rankMovement } from "@/lib/roundRecap";

export function resultShareData(standings: LeaderboardEntry[], playerId: string | null | undefined, origin: string): ShareData {
  // Share only the site root, never a room URL, query or credential fragment.
  const url = new URL("/", origin).href;
  const placement = playerId ? rankMovement(standings, null, playerId) : null;
  const text = placement ? `I placed ${ordinal(placement.rank)} of ${standings.length} in BUZZR trivia 🏆` : "I played BUZZR trivia 🏆";
  return { title: "BUZZR trivia", text, url };
}

export async function shareResult(data: ShareData, browser: Pick<Navigator, "share" | "clipboard">): Promise<"shared" | "copied" | "cancelled"> {
  if (browser.share) {
    try { await browser.share(data); return "shared"; }
    catch (error) { if (error instanceof Error && error.name === "AbortError") return "cancelled"; }
  }
  if (!browser.clipboard?.writeText) throw new Error("Sharing is unavailable in this browser.");
  await browser.clipboard.writeText(`${data.text}\n${data.url}`);
  return "copied";
}
