"use client";
// U5 / U9. Player join form. Player-facing view: phone-first (UI conventions).
// On success it stores the server-issued token (KTD7) in the tab session and
// routes to the play view, which subscribes to the room and hydrates (U6).
//
// Players may also suggest categories here (R7). They travel with the join in
// one round trip rather than a separate call, so there is no pre-join room
// lookup to enumerate room codes against (KTD7).

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { joinGame } from "@/app/actions/joinGame";
import { savePlayerCredential } from "@/lib/clientSession";
import { CategoryPicker } from "@/components/CategoryPicker";

function JoinForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [code, setCode] = useState(params.get("code") ?? "");
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [suggested, setSuggested] = useState<string[]>([]);

  function toggleCategory(category: string) {
    setSuggested((prev) =>
      prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category],
    );
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const result = await joinGame(code, username, suggested);
      savePlayerCredential({
        code: result.code,
        token: result.token,
        username: result.username,
      });
      router.push(`/play?code=${result.code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not join");
      setSubmitting(false);
    }
  }

  return (
    <main>
      <h1>Join a game</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!submitting) void submit();
        }}
      >
        {error && <p role="alert">{error}</p>}
        <label>
          Room code
          <input
            value={code}
            // Numeric codes (R6.1): keep digits only and surface the number pad.
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            autoComplete="off"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={5}
            required
          />
        </label>
        <label>
          Username
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            maxLength={20}
            required
          />
        </label>
        <CategoryPicker
          selected={suggested}
          onToggle={toggleCategory}
          disabled={submitting}
        />
        <button type="submit" disabled={submitting || !code || !username}>
          {submitting ? "Joining…" : "Join"}
        </button>
      </form>
    </main>
  );
}

export default function JoinPage() {
  // useSearchParams requires a Suspense boundary in the App Router.
  return (
    <Suspense>
      <JoinForm />
    </Suspense>
  );
}
