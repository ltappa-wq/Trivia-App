const memory = new Map<string, string>();
const key = (code: string) => `trivia:display:${code}`;
export function displayUrl(origin: string, code: string, token: string): string {
  return `${origin}/display?code=${encodeURIComponent(code)}#${new URLSearchParams({ t: token })}`;
}
/** Scrub every fragment, including invalid ones, before reading room state. */
export function consumeDisplayToken(code: string): string | null {
  if (typeof window === "undefined") return null;
  const fragment = window.location.hash;
  if (fragment) window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
  if (!/^\d{5}$/.test(code)) return null;
  const name = key(code);
  if (fragment) {
    const token = new URLSearchParams(fragment.slice(1)).get("t");
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      clearDisplayToken(code); return null;
    }
    memory.set(name, token);
    try { window.sessionStorage.setItem(name, token); } catch { /* tab memory fallback */ }
    return token;
  }
  try { return window.sessionStorage.getItem(name) ?? memory.get(name) ?? null; }
  catch { return memory.get(name) ?? null; }
}
export function clearDisplayToken(code: string) {
  memory.delete(key(code));
  try { window.sessionStorage.removeItem(key(code)); } catch { /* blocked storage */ }
}
