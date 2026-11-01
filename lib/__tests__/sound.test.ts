import { describe, expect, it, vi } from "vitest";
import { createSoundController, MUTE_KEY } from "../sound";
function environment() {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  return { storage: () => storage, audio: vi.fn<() => AudioContext | undefined>(() => undefined), reducedMotion: () => false, vibrate: vi.fn() };
}
describe("sound controller", () => {
  it("defaults on and persists the mute preference across instances", () => {
    const env = environment();
    const controller = createSoundController(env);
    expect(controller.isMuted()).toBe(false);
    controller.setMuted(true);
    expect(env.storage().getItem(MUTE_KEY)).toBe("true");
    expect(createSoundController(env).isMuted()).toBe(true);
  });
  it("never throws with missing AudioContext or restricted storage/vibration", () => {
    const controller = createSoundController({ storage: () => { throw Error(); }, audio: () => undefined,
      reducedMotion: () => false, vibrate: () => { throw Error(); } });
    expect(() => { controller.unlock(); controller.play("correct"); controller.haptic("lock"); controller.setMuted(true); }).not.toThrow();
  });
  it("requires a gesture before audio creation or haptics and honors mute and reduced motion", () => {
    const env = environment();
    const controller = createSoundController(env);
    controller.play("tick"); controller.haptic("lock");
    expect(env.audio).not.toHaveBeenCalled(); expect(env.vibrate).not.toHaveBeenCalled();
    controller.unlock(); controller.haptic("lock");
    expect(env.audio).toHaveBeenCalledOnce(); expect(env.vibrate).toHaveBeenCalledWith(20);
    env.vibrate.mockClear();
    controller.setMuted(true); controller.haptic("correct");
    expect(env.vibrate).not.toHaveBeenCalled();
    controller.setMuted(false); env.reducedMotion = () => true; controller.haptic("wrong");
    expect(env.vibrate).not.toHaveBeenCalled();
  });
  it("synthesizes short notes and deduplicates keyed cues", () => {
    const env = environment();
    const oscillator = { frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), disconnect: vi.fn() };
    const gain = { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() };
    const audio = { state: "running", currentTime: 0, createOscillator: vi.fn(() => oscillator), createGain: () => gain, suspend: vi.fn(async () => {}) };
    env.audio.mockReturnValue(audio as unknown as AudioContext);
    const controller = createSoundController(env);
    controller.unlock(); controller.play("tick", "q1:3"); controller.play("tick", "q1:3");
    expect(audio.createOscillator).toHaveBeenCalledOnce();
    expect(oscillator.stop).toHaveBeenCalledWith(0.06);
    controller.setMuted(true); controller.play("wrong");
    expect(audio.createOscillator).toHaveBeenCalledOnce();
    expect(audio.suspend).toHaveBeenCalledOnce();
  });
});
