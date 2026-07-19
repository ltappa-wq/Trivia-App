import { describe, expect, it } from "vitest";
import { formatNumber, formatScore } from "@/lib/formatScore";

describe("formatNumber / formatScore", () => {
  it("uses US grouping for thousands", () => {
    expect(formatNumber(1000)).toBe("1,000");
    expect(formatScore(12500)).toBe("12,500");
  });

  it("leaves small numbers ungrouped", () => {
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(999)).toBe("999");
  });
});
