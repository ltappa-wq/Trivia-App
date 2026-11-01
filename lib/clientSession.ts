export interface HostCredential {
  gameId: string;
  code: string;
  token: string;
  /**
   * The host's own player token — present only when the host plays too. A
   * host-only gamemaster paces the room without answering, so it's absent.
   */
  playerToken?: string;
  username?: string;
}

export interface PlayerCredential {
  code: string;
  token: string;
  username: string;
}

export const CREDENTIAL_TTL = 12 * 60 * 60 * 1000;
type Kind = "host" | "player";
type Credential = HostCredential | PlayerCredential;
const memory = new Map<string, string>();
const key = (kind: Kind, code: string) => `trivia:${kind}:${code.toUpperCase()}`;
function storage(name: "localStorage" | "sessionStorage"): Storage | null {
  try { return typeof window === "undefined" ? null : window[name]; } catch { return null; }
}
function get(store: Storage | null, name: string) {
  try { return store?.getItem(name) ?? null; } catch { return null; }
}
function remove(name: string) {
  memory.delete(name);
  for (const type of ["localStorage", "sessionStorage"] as const) {
    try { storage(type)?.removeItem(name); } catch { /* storage blocked */ }
  }
}
function valid(value: unknown, kind: Kind, code: string): value is Credential {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v.code === code.toUpperCase() && typeof v.token === "string" && !!v.token &&
    (kind === "host" ? typeof v.gameId === "string" &&
      (v.playerToken === undefined || typeof v.playerToken === "string") &&
      (v.username === undefined || typeof v.username === "string") : typeof v.username === "string");
}
function save(kind: Kind, cred: Credential) {
  const name = key(kind, cred.code);
  const raw = JSON.stringify({ ...cred, code: cred.code.toUpperCase(), expiresAt: Date.now() + CREDENTIAL_TTL });
  memory.set(name, raw);
  try { storage("localStorage")?.setItem(name, raw); } catch { /* memory fallback */ }
  // Keep a tab fallback when persistent storage is blocked.
  try { storage("sessionStorage")?.setItem(name, raw); } catch { /* memory fallback */ }
}
function load(kind: Kind, code: string): Credential | null {
  const name = key(kind, code);
  const raw = get(storage("localStorage"), name) ?? get(storage("sessionStorage"), name) ?? memory.get(name);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    const expiresAt = value?.expiresAt;
    if (!valid(value, kind, code) || (expiresAt !== undefined &&
      (typeof expiresAt !== "number" || !Number.isFinite(expiresAt) || expiresAt <= Date.now()))) {
      remove(name); return null;
    }
    save(kind, value);
    return value;
  } catch { remove(name); return null; }
}
export const saveHostCredential = (cred: HostCredential) => save("host", cred);
export const savePlayerCredential = (cred: PlayerCredential) => save("player", cred);
export const loadHostCredential = (code: string) => load("host", code) as HostCredential | null;
export const loadPlayerCredential = (code: string) => load("player", code) as PlayerCredential | null;
export const clearCredential = (kind: Kind, code: string) => remove(key(kind, code));
export function listCredentials(kind: Kind): Credential[] {
  const names = new Set(memory.keys());
  for (const type of ["localStorage", "sessionStorage"] as const) {
    try {
      const store = storage(type);
      if (store) for (let i = 0; i < store.length; i++) { const name = store.key(i); if (name) names.add(name); }
    } catch { /* storage blocked */ }
  }
  return [...names].filter(n => n.startsWith(`trivia:${kind}:`))
    .map(n => load(kind, n.split(":")[2])).filter((v): v is Credential => v !== null);
}

export function hostRecoveryUrl(origin: string, cred: HostCredential): string {
  const fragment = new URLSearchParams({ t: cred.token, g: cred.gameId });
  if (cred.playerToken) fragment.set("p", cred.playerToken);
  if (cred.username) fragment.set("u", cred.username);
  return `${origin}/host?code=${encodeURIComponent(cred.code)}#${fragment}`;
}
/** Consume and scrub even malformed fragments; no secret remains in the address bar. */
export function consumeHostRecovery(code: string): HostCredential | null {
  if (typeof window === "undefined" || !window.location.hash) return null;
  const params = new URLSearchParams(window.location.hash.slice(1));
  window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
  const token = params.get("t"), gameId = params.get("g");
  if (!token || !gameId || !/^\d{5}$/.test(code)) return null;
  const cred: HostCredential = { code, token, gameId,
    ...(params.get("p") ? { playerToken: params.get("p")! } : {}),
    ...(params.get("u") ? { username: params.get("u")! } : {}) };
  saveHostCredential(cred);
  if (cred.playerToken && cred.username) savePlayerCredential({ code, token: cred.playerToken, username: cred.username });
  return cred;
}

/** Called only after a successful RPC response; transport errors preserve identity. */
export function forgetToken(token: string) {
  for (const kind of ["host", "player"] as const) {
    for (const cred of listCredentials(kind)) {
      if (cred.token === token || ("playerToken" in cred && cred.playerToken === token)) clearCredential(kind, cred.code);
    }
  }
}
