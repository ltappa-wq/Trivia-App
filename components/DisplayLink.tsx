"use client";
import { useEffect, useRef, useState } from "react";
import { updateDisplayLink } from "@/app/actions/displayLink";
import { displayUrl } from "@/lib/displaySession";
import { JoinQrCode } from "./JoinQrCode";

export function DisplayLink({ code, token }: { code: string; token: string }) {
  const link = useRef<HTMLAnchorElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const [message, setMessage] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!busy && message) (url ? link.current : opener.current)?.focus({ preventScroll: true });
  }, [busy, message, url]);
  async function update(revoke = false) {
    setBusy(true); setError(null);
    try {
      const displayToken = await updateDisplayLink(code, token, revoke);
      setUrl(displayToken ? displayUrl(window.location.origin, code, displayToken) : null);
      setMessage(displayToken ? "TV display link ready. Open the read-only TV screen." : "TV display link revoked.");
    } catch { setError("Could not update TV display link. Try again."); }
    finally { setBusy(false); }
  }
  return <section className="display-link" aria-label="TV display link">
    <p role="status" aria-atomic="true">{busy ? "Updating TV display link…" : message}</p>
    <button ref={opener} type="button" disabled={busy} onClick={() => void update()}>Open TV display</button>
    <button type="button" disabled={busy} onClick={() => void update(true)}>Revoke TV display link</button>
    {url && <div>
      <p>Open this private link on your TV. Creating another link revokes the previous one.</p>
      <a ref={link} href={url} target="_blank" rel="noopener noreferrer">Open read-only TV screen</a>
      <JoinQrCode url={url} label="Scan to open the private TV display" />
      <button type="button" disabled={busy} onClick={() => void update()}>Regenerate TV display link</button>
    </div>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
