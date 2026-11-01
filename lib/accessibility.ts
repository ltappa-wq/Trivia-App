/** Pure policies shared by phase focus, announcements and keyboard controls. */
export function phaseAnnouncement(phase: string, index: number): string {
  switch (phase) {
    case "get_ready": return `Get ready for question ${index + 1}.`;
    case "question": return `Question ${index + 1}. Answer now.`;
    case "review": return "Answers locked. Review the correct answer.";
    case "paused": return "Game paused for a challenge. Answering is disabled.";
    case "ended": return "Game over. Final results are ready.";
    default: return "";
  }
}

export function timeWarning(remaining: number): string {
  const seconds = Math.ceil(remaining / 1000);
  if (seconds <= 0) return "Time is up.";
  if (seconds <= 5) return "Five seconds or less remaining.";
  if (seconds <= 10) return "Ten seconds or less remaining.";
  return "";
}

export function answerKeyIndex(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  if (/^[1-9]$/.test(key)) return Number(key) <= count ? Number(key) - 1 : null;
  if (key === "ArrowRight" || key === "ArrowDown") return (current + 1) % count;
  if (key === "ArrowLeft" || key === "ArrowUp") return (current - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

export function focusPhase(container: HTMLElement | null) {
  const target = container?.querySelector<HTMLElement>("h2, [data-phase-focus]");
  target?.focus({ preventScroll: true });
}
