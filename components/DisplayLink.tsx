"use client";
import { useState } from "react";
import { updateDisplayLink } from "@/app/actions/displayLink";
import { displayUrl } from "@/lib/displaySession";
import { JoinQrCode } from "./JoinQrCode";

export function DisplayLink({ code, token }: { code: string; token: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function update(revoke = false) {
    setBusy(true); setError(null);
    try {
      const displayToken = await updateDisplayLink(code, token, revoke);
      setUrl(displayToken ? displayUrl(window.location.origin, code, displayToken) : null);
    } catch { setError("Could not update TV display link. Try again."); }
    finally { setBusy(false); }
  }
  return <section className="display-link" aria-label="TV display link">
    <button type="button" disabled={busy} onClick={() => void update()}>Open TV display</button>
    <button type="button" disabled={busy} onClick={() => void update(true)}>Revoke TV display link</button>
    {url && <div>
      <p>Open this private link on your TV. Creating another link revokes the previous one.</p>
      <a href={url} target="_blank" rel="noopener noreferrer">Open read-only TV screen</a>
      <JoinQrCode url={url} label="Scan to open the private TV display" />
      <button type="button" disabled={busy} onClick={() => void update()}>Regenerate TV display link</button>
    </div>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
