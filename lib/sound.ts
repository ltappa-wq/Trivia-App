export type Cue = "tick" | "correct" | "wrong" | "gameOver";
export const MUTE_KEY = "buzzr:muted";

type SoundEnvironment = {
  storage: () => Pick<Storage, "getItem" | "setItem"> | undefined;
  audio: () => AudioContext | undefined;
  reducedMotion: () => boolean;
  vibrate: (pattern: number | number[]) => void;
};
const browserEnvironment: SoundEnvironment = {
  storage: () => typeof window === "undefined" ? undefined : window.localStorage,
  audio: () => typeof window === "undefined" || !window.AudioContext ? undefined : new window.AudioContext(),
  reducedMotion: () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  vibrate: (pattern) => { if (typeof navigator !== "undefined") navigator.vibrate?.(pattern); },
};

/** All browser capabilities are optional. Nothing here is awaited by gameplay. */
export function createSoundController(env: SoundEnvironment = browserEnvironment) {
  let muted = false;
  let loaded = false;
  let context: AudioContext | undefined;
  let gestured = false;
  const listeners = new Set<() => void>();
  const played = new Set<string>();
  const vibrated = new Set<string>();
  function isMuted() {
    if (!loaded) {
      try {
        const storage = env.storage();
        if (storage) { muted = storage.getItem(MUTE_KEY) === "true"; loaded = true; }
      } catch { loaded = true; }
    }
    return muted;
  }
  function unlock() {
    gestured = true;
    if (isMuted()) return;
    try {
      context ??= env.audio();
      if (context?.state === "suspended") void context.resume().catch(() => {});
    } catch { /* Unsupported or blocked audio must never interrupt play. */ }
  }
  function setMuted(value: boolean) {
    muted = value;
    loaded = true;
    try { env.storage()?.setItem(MUTE_KEY, String(value)); } catch { /* private browsing */ }
    if (value) {
      try { void context?.suspend().catch(() => {}); } catch { /* optional */ }
    } else unlock(); // Called by the toggle's user gesture.
    listeners.forEach((listener) => listener());
  }
  function haptic(kind: "lock" | "correct" | "wrong", key?: string) {
    if (key && vibrated.has(key)) return;
    if (key) vibrated.add(key);
    try {
      if (!isMuted() && gestured && !env.reducedMotion()) env.vibrate(kind === "lock" ? 20 : kind === "correct" ? [30, 40, 30] : [60]);
    } catch { /* Unsupported or denied vibration. */ }
  }
  function play(cue: Cue, key?: string) {
    if (key && played.has(key)) return;
    if (key) played.add(key);
    if (isMuted() || !gestured) return;
    try {
      if (!context || context.state !== "running") return;
      const notes = cue === "tick" ? [880] : cue === "correct" ? [523, 784] : cue === "wrong" ? [220, 165] : [523, 659, 784, 1047];
      const duration = cue === "tick" ? 0.06 : 0.12;
      notes.forEach((frequency, i) => {
        const oscillator = context!.createOscillator();
        const gain = context!.createGain();
        const start = context!.currentTime + i * (duration + 0.035);
        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.08, start + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        oscillator.connect(gain);
        gain.connect(context!.destination);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
        oscillator.start(start);
        oscillator.stop(start + duration);
      });
    } catch { /* Audio is cosmetic; never propagate failures. */ }
  }
  return { isMuted, setMuted, unlock, haptic, play,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

export const gameSound = createSoundController();
