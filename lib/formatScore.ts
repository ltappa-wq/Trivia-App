/** Display scores with US grouping (e.g. 1,000). */
export function formatScore(score: number): string {
  return Number(score).toLocaleString("en-US");
}
