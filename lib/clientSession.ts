// Browser-side credential storage. Tokens (host/player) are the write-side
// credentials (KTD7); they live in sessionStorage keyed by room code so a page
// navigation (setup -> host, join -> play) carries them without putting a secret
// in the URL. sessionStorage (not localStorage) keeps them scoped to the tab and
// cleared when it closes — play is ephemeral (no persistence beyond the game).

export interface HostCredential {
  gameId: string;
  code: string;
  token: string;
  /** The host's own player token — the host plays too (submits answers). */
  playerToken: string;
  username: string;
}

export interface PlayerCredential {
  code: string;
  token: string;
  username: string;
}

const hostKey = (code: string) => `trivia:host:${code.toUpperCase()}`;
const playerKey = (code: string) => `trivia:player:${code.toUpperCase()}`;

function read<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function saveHostCredential(cred: HostCredential): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(hostKey(cred.code), JSON.stringify(cred));
}

export function loadHostCredential(code: string): HostCredential | null {
  return read<HostCredential>(hostKey(code));
}

export function savePlayerCredential(cred: PlayerCredential): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(playerKey(cred.code), JSON.stringify(cred));
}

export function loadPlayerCredential(code: string): PlayerCredential | null {
  return read<PlayerCredential>(playerKey(code));
}
