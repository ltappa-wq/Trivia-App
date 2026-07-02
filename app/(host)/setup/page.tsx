"use client";
// U4. Gamemaster setup form. Host-facing view: targets a larger screen (UI
// conventions). Three states drive the submit lifecycle: the form, a blocking
// "generating" state (whole-set generation takes a moment, KTD10), and an error
// state offering Retry (re-run) and Back-to-edit (preserve the form).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createGame } from "@/app/actions/createGame";
import { saveHostCredential } from "@/lib/clientSession";
import {
  ANSWER_MODES,
  CATEGORIES,
  DIFFICULTIES,
  QUESTION_COUNT_MAX,
  QUESTION_COUNT_MIN,
} from "@/lib/gameConfig";
import type { AnswerMode, Difficulty } from "@/lib/db/types";

type Status = "editing" | "generating" | "error";

const MODE_LABELS: Record<AnswerMode, string> = {
  multiple_choice: "Multiple choice",
  type_answer: "Type the answer",
};

export default function SetupPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("editing");
  const [error, setError] = useState<string | null>(null);

  const [hostPlays, setHostPlays] = useState(true);
  const [hostName, setHostName] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [questionCount, setQuestionCount] = useState(10);
  const [answerMode, setAnswerMode] = useState<AnswerMode>("multiple_choice");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");

  function toggleCategory(cat: string) {
    setCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    );
  }

  async function submit() {
    setStatus("generating");
    setError(null);
    try {
      const result = await createGame(
        {
          categories,
          questionCount,
          answerMode,
          difficulty,
        },
        { plays: hostPlays, name: hostName },
      );
      saveHostCredential({
        gameId: result.gameId,
        code: result.code,
        token: result.hostToken,
        playerToken: result.hostPlayerToken,
        username: result.username,
      });
      router.push(`/host?code=${result.code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setStatus("error");
    }
  }

  if (status === "generating") {
    return (
      <main aria-busy="true">
        <h1>Generating questions…</h1>
        <p>This can take a moment while the AI writes your game.</p>
      </main>
    );
  }

  if (status === "error") {
    return (
      <main>
        <h1>Couldn’t create the game</h1>
        <p role="alert">{error}</p>
        <button type="button" onClick={submit}>
          Retry
        </button>
        <button type="button" onClick={() => setStatus("editing")}>
          Back to edit
        </button>
      </main>
    );
  }

  const canSubmit =
    categories.length > 0 && (!hostPlays || hostName.trim().length > 0);

  return (
    <main>
      <h1>Host a game</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) void submit();
        }}
      >
        <label>
          <input
            type="checkbox"
            checked={hostPlays}
            onChange={(e) => setHostPlays(e.target.checked)}
          />
          I&rsquo;ll play too
        </label>

        {hostPlays && (
          <label>
            Your name
            <input
              value={hostName}
              onChange={(e) => setHostName(e.target.value)}
              maxLength={20}
              autoComplete="off"
              required
            />
          </label>
        )}

        <fieldset>
          <legend>Categories</legend>
          {CATEGORIES.map((cat) => (
            <label key={cat}>
              <input
                type="checkbox"
                checked={categories.includes(cat)}
                onChange={() => toggleCategory(cat)}
              />
              {cat}
            </label>
          ))}
        </fieldset>

        <label>
          Number of questions
          <input
            type="number"
            min={QUESTION_COUNT_MIN}
            max={QUESTION_COUNT_MAX}
            value={questionCount}
            onChange={(e) =>
              setQuestionCount(
                Math.max(
                  QUESTION_COUNT_MIN,
                  Math.min(QUESTION_COUNT_MAX, Number(e.target.value) || QUESTION_COUNT_MIN),
                ),
              )
            }
          />
        </label>

        <fieldset>
          <legend>Answer mode</legend>
          {ANSWER_MODES.map((mode) => (
            <label key={mode}>
              <input
                type="radio"
                name="answerMode"
                checked={answerMode === mode}
                onChange={() => setAnswerMode(mode)}
              />
              {MODE_LABELS[mode]}
            </label>
          ))}
        </fieldset>

        <label>
          Difficulty
          <select
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value as Difficulty)}
          >
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>

        <button type="submit" disabled={!canSubmit}>
          Create game
        </button>
      </form>
    </main>
  );
}
