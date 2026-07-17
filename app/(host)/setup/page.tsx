"use client";
// Gamemaster setup form: glorious greeting + rotating taglines, expanded
// presets, type-in custom categories, and the create lifecycle (editing /
// generating / error with Retry + Back-to-edit).

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createGame } from "@/app/actions/createGame";
import { saveHostCredential } from "@/lib/clientSession";
import {
  ANSWER_MODES,
  CATEGORIES,
  CATEGORY_MAX_LEN,
  DIFFICULTIES,
  MAX_CATEGORIES,
  QUESTION_COUNT_MAX,
  QUESTION_COUNT_MIN,
  isPresetCategory,
  normalizeCategory,
} from "@/lib/gameConfig";
import { HOST_SETUP_TAGLINES, TAGLINE_ROTATE_MS } from "@/lib/setupCopy";
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
  const [customDraft, setCustomDraft] = useState("");
  const [customError, setCustomError] = useState<string | null>(null);
  const [questionCount, setQuestionCount] = useState(10);
  const [answerMode, setAnswerMode] = useState<AnswerMode>("multiple_choice");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [taglineIdx, setTaglineIdx] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setTaglineIdx((i) => (i + 1) % HOST_SETUP_TAGLINES.length);
    }, TAGLINE_ROTATE_MS);
    return () => window.clearInterval(id);
  }, []);

  function toggleCategory(cat: string) {
    setCategories((prev) => {
      if (prev.some((c) => c.toLowerCase() === cat.toLowerCase())) {
        return prev.filter((c) => c.toLowerCase() !== cat.toLowerCase());
      }
      if (prev.length >= MAX_CATEGORIES) {
        setCustomError(`You can choose at most ${MAX_CATEGORIES} categories`);
        return prev;
      }
      setCustomError(null);
      return [...prev, cat];
    });
  }

  function removeCategory(cat: string) {
    setCategories((prev) => prev.filter((c) => c !== cat));
  }

  function addCustomCategory() {
    const name = normalizeCategory(customDraft);
    setCustomError(null);
    if (name.length === 0) {
      setCustomError("Enter a category name");
      return;
    }
    if (name.length > CATEGORY_MAX_LEN) {
      setCustomError(`Keep it to ${CATEGORY_MAX_LEN} characters or fewer`);
      return;
    }
    if (categories.some((c) => c.toLowerCase() === name.toLowerCase())) {
      setCustomError("That category is already selected");
      return;
    }
    if (categories.length >= MAX_CATEGORIES) {
      setCustomError(`You can choose at most ${MAX_CATEGORIES} categories`);
      return;
    }
    // Prefer canonical preset casing if they typed a preset name.
    const preset = (CATEGORIES as readonly string[]).find(
      (c) => c.toLowerCase() === name.toLowerCase(),
    );
    setCategories((prev) => [...prev, preset ?? name]);
    setCustomDraft("");
  }

  const customSelected = categories.filter((c) => !isPresetCategory(c));

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
        <p role="alert" style={{ whiteSpace: "pre-wrap" }}>
          {error}
        </p>
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
      <header>
        <h1>Host a game</h1>
        <p
          aria-live="polite"
          style={{ minHeight: "1.5em", fontWeight: 600 }}
        >
          {HOST_SETUP_TAGLINES[taglineIdx]}
        </p>
      </header>
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
                checked={categories.some(
                  (c) => c.toLowerCase() === cat.toLowerCase(),
                )}
                onChange={() => toggleCategory(cat)}
              />
              {cat}
            </label>
          ))}
        </fieldset>

        <fieldset>
          <legend>Custom category</legend>
          <label>
            Add your own
            <input
              value={customDraft}
              onChange={(e) => {
                setCustomDraft(e.target.value);
                setCustomError(null);
              }}
              maxLength={CATEGORY_MAX_LEN}
              autoComplete="off"
              placeholder="e.g. 90s Sitcoms"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCustomCategory();
                }
              }}
            />
          </label>
          <button type="button" onClick={addCustomCategory}>
            Add category
          </button>
          {customError && <p role="alert">{customError}</p>}
          {customSelected.length > 0 && (
            <ul>
              {customSelected.map((cat) => (
                <li key={cat}>
                  {cat}{" "}
                  <button type="button" onClick={() => removeCategory(cat)}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
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
