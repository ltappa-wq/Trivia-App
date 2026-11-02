"use client";

import { ANSWER_TIMER_MS, ANSWER_TIMER_OPTIONS, AUTO_ADVANCE_OPTIONS, type GameOptionsInput } from "@/lib/gameConfig";
import type { AnswerMode } from "@/lib/db/types";

export function GameOptionsFields({ value, onChange, answerMode }: {
  value: GameOptionsInput;
  onChange: (value: GameOptionsInput) => void;
  answerMode: AnswerMode;
}) {
  return <fieldset>
    <legend>Game options</legend>
    <label><input type="checkbox" checked={value.familyFriendly ?? false}
      onChange={e => onChange({ ...value, familyFriendly: e.target.checked })} />Family-friendly</label>
    <p>Keep questions and answers suitable for a mixed-age audience.</p>
    <label>Answer timer
      <select value={value.answerTimerMs ?? ""} onChange={e => onChange({ ...value, answerTimerMs: e.target.value ? Number(e.target.value) : null })}>
        <option value="">Mode default ({answerMode === "mixed" ? "20s choice / 35s typed / 15s true/false" : `${ANSWER_TIMER_MS[answerMode] / 1000} seconds`})</option>
        {ANSWER_TIMER_OPTIONS.map(ms => <option key={ms} value={ms}>{ms / 1000} seconds</option>)}
      </select>
    </label>
    <label>Auto-advance after review
      <select value={value.autoAdvanceMs ?? ""} onChange={e => onChange({ ...value, autoAdvanceMs: e.target.value ? Number(e.target.value) : null })}>
        <option value="">Off — host advances</option>
        {AUTO_ADVANCE_OPTIONS.map(ms => <option key={ms} value={ms}>{ms / 1000} seconds</option>)}
      </select>
    </label>
    <p>Challenges pause auto-advance. The host always finishes the final question.</p>
    <label><input type="checkbox" checked={value.doublePointsFinale ?? false}
      onChange={e => onChange({ ...value, doublePointsFinale: e.target.checked })} />Double-points finale</label>
  </fieldset>;
}
