// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { usePlayerCredential } from "../usePlayerCredential";
const load = vi.hoisted(() => vi.fn());
vi.mock("../clientSession", () => ({ loadPlayerCredential: load }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
function Probe() {
  const { ready, credential } = usePlayerCredential("12345");
  return <p>{!ready ? "Loading" : credential?.username ?? "No credential"}</p>;
}
it("renders identical server/client markup before reading browser credentials, with no hydration recovery", async () => {
  load.mockReturnValue({ code: "12345", token: "player", username: "Ada" });
  const container = document.createElement("div");
  container.innerHTML = renderToString(<Probe />);
  expect(container.textContent).toBe("Loading");
  expect(load).not.toHaveBeenCalled();
  document.body.append(container);
  const onRecoverableError = vi.fn();
  let root!: ReturnType<typeof hydrateRoot>;
  await act(async () => { root = hydrateRoot(container, <Probe />, { onRecoverableError }); });
  expect(container.textContent).toBe("Ada");
  expect(onRecoverableError).not.toHaveBeenCalled();
  expect(load).toHaveBeenCalledExactlyOnceWith("12345");
  act(() => root.unmount());
  container.remove();
});
it("does not expose the previous room identity while loading another room", async () => {
  load.mockImplementation((code: string) => code === "12345" ? { code, token: "player", username: "Ada" } : null);
  const { result, rerender } = renderHook(({ code }) => usePlayerCredential(code), { initialProps: { code: "12345" } });
  await waitFor(() => expect(result.current.credential?.username).toBe("Ada"));
  rerender({ code: "54321" });
  expect(result.current).toEqual({ ready: false, credential: null });
  await waitFor(() => expect(result.current).toEqual({ ready: true, credential: null }));
});
