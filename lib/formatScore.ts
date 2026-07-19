/** Format integers with US grouping (e.g. 1,000). */
export function formatNumber(n: number): string {
  return Number(n).toLocaleString("en-US");
}

/** Scores use the same US grouping. */
export const formatScore = formatNumber;
