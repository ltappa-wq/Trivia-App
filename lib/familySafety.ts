/** One policy shared by generation, moderation and category viability. */
export const FAMILY_SAFETY_RULES = [
  "Every question, option, accepted answer and explanation must suit a mixed-age audience.",
  "Exclude sexual content, graphic violence, drugs or alcohol focus, slurs or hate, self-harm, gambling focus and crude humour.",
  "Historical topics must stay factual and non-graphic.",
].join(" ");

export const FAMILY_CATEGORY_MESSAGE = "Please choose a topic suitable for family play.";

/** Exact coverage is required: partial/ambiguous classification never passes. */
export function parseSafetyVerdicts(raw: unknown, count: number): boolean[] {
  const rows = (raw as { verdicts?: unknown } | null)?.verdicts;
  if (!Array.isArray(rows) || rows.length !== count) throw new Error("Incomplete safety check");
  const safe: boolean[] = new Array(count);
  const seen = new Set<number>();
  for (const row of rows) {
    if (!row || !Number.isInteger(row.index) || row.index < 0 || row.index >= count ||
        seen.has(row.index) || typeof row.safe !== "boolean") throw new Error("Invalid safety check");
    seen.add(row.index);
    safe[row.index] = row.safe;
  }
  return safe;
}
