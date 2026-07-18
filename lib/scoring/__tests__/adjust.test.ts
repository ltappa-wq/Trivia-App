import { describe, expect, it, vi } from "vitest";
import { addPlayerPoints, applyScoreDeltas } from "../adjust";

describe("applyScoreDeltas / addPlayerPoints", () => {
  it("skips zero deltas and calls adjust_player_score for non-zero ones", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const supabase = { rpc } as never;
    await applyScoreDeltas(
      supabase,
      new Map([
        ["p1", 100],
        ["p2", 0],
        ["p3", -50],
      ]),
    );
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith("adjust_player_score", {
      p_player_id: "p1",
      p_delta: 100,
    });
    expect(rpc).toHaveBeenCalledWith("adjust_player_score", {
      p_player_id: "p3",
      p_delta: -50,
    });
  });

  it("throws when any score RPC fails", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { message: "db down" } });
    await expect(
      applyScoreDeltas({ rpc } as never, new Map([["p1", 10]])),
    ).rejects.toThrow(/Failed to update score/);
  });

  it("addPlayerPoints no-ops for non-positive points", async () => {
    const rpc = vi.fn();
    await addPlayerPoints({ rpc } as never, "p1", 0);
    await addPlayerPoints({ rpc } as never, "p1", -1);
    expect(rpc).not.toHaveBeenCalled();
  });
});
