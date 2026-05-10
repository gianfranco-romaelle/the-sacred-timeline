import { describe, expect, it } from "vitest";
import { countLanes, LANE_GAP_YEARS, MAX_LANES, packLanes } from "../lane-packing";
import type { LifespanBar } from "../types";

function makeBar(
  id: string,
  startYear: number,
  endYear: number,
  overrides: Partial<LifespanBar> = {},
): LifespanBar {
  const bar = {
    id,
    name: id,
    startYear,
    endYear,
    isOpenEnded: false,
    displayText: `${startYear}–${endYear}`,
    country: null,
    field: null,
    calculusNumber: null,
    calculusName: null,
    domainIds: [],
    domainLabels: [],
    traditionIds: [],
    traditionLabels: [],
    portraitUrl: null,
    lane: -1,
    ...overrides,
  };

  return {
    ...bar,
    domainIds: bar.domainIds ?? [],
    domainLabels: bar.domainLabels ?? [],
    traditionIds: bar.traditionIds ?? [],
    traditionLabels: bar.traditionLabels ?? [],
  };
}

describe("packLanes", () => {
  it("empty array returns empty array", () => {
    expect(packLanes([])).toEqual([]);
  });

  it("single bar is assigned to lane 0", () => {
    const bars = [makeBar("a", 1700, 1780)];
    packLanes(bars);
    expect(bars[0].lane).toBe(0);
  });

  it("non-overlapping bars share lane 0", () => {
    // 1700–1780 ends at 1780; next must start after 1780 + LANE_GAP_YEARS
    const bars = [
      makeBar("a", 1700, 1780),
      makeBar("b", 1784 + LANE_GAP_YEARS, 1850),
    ];
    packLanes(bars);
    expect(bars[0].lane).toBe(0);
    expect(bars[1].lane).toBe(0);
  });

  it("overlapping bars go into separate lanes", () => {
    const bars = [
      makeBar("a", 1700, 1780),
      makeBar("b", 1750, 1810),
    ];
    packLanes(bars);
    expect(bars[0].lane).not.toBe(bars[1].lane);
  });

  it("three bars: two overlap first, third fits in lane 0 after both", () => {
    const bars = [
      makeBar("a", 1700, 1760),
      makeBar("b", 1710, 1770),
      makeBar("c", 1800, 1860),
    ];
    packLanes(bars);
    // a → lane 0, b → lane 1, c → lane 0 (a ended 1760, 1800 > 1760 + gap)
    expect(bars[0].lane).toBe(0);
    expect(bars[1].lane).toBe(1);
    expect(bars[2].lane).toBe(0);
  });

  it("works with BCE (negative) years", () => {
    const bars = [
      makeBar("socrates", -470, -399),
      makeBar("plato", -428, -348),
    ];
    packLanes(bars);
    expect(bars[0].lane).not.toBe(bars[1].lane);
    expect(bars[0].lane).toBeGreaterThanOrEqual(0);
    expect(bars[1].lane).toBeGreaterThanOrEqual(0);
  });

  it("open-ended bars (present year) overlap with recent entries", () => {
    const PRESENT = new Date().getFullYear();
    const bars = [
      makeBar("living-a", 1980, PRESENT, { isOpenEnded: true }),
      makeBar("living-b", 1985, PRESENT, { isOpenEnded: true }),
    ];
    packLanes(bars);
    expect(bars[0].lane).not.toBe(bars[1].lane);
  });

  it("caps at MAX_LANES and overflows into existing lanes", () => {
    // Create MAX_LANES + 5 bars all overlapping (same year range)
    const bars = Array.from({ length: MAX_LANES + 5 }, (_, i) =>
      makeBar(`bar-${i}`, 1800, 1900),
    );
    packLanes(bars);
    const maxLane = Math.max(...bars.map((b) => b.lane));
    expect(maxLane).toBeLessThan(MAX_LANES);
  });

  it("preserves original array order after packing", () => {
    const bars = [
      makeBar("c", 1750, 1820),
      makeBar("a", 1600, 1680),
      makeBar("b", 1700, 1770),
    ];
    const originalOrder = bars.map((b) => b.id);
    packLanes(bars);
    expect(bars.map((b) => b.id)).toEqual(originalOrder);
  });

  it("assigns all bars non-negative lanes", () => {
    const bars = [
      makeBar("x", -700, -600),
      makeBar("y", -650, -550),
      makeBar("z", 500, 600),
      makeBar("w", 550, 700),
    ];
    packLanes(bars);
    for (const bar of bars) {
      expect(bar.lane).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("countLanes", () => {
  it("returns 0 for empty array", () => {
    expect(countLanes([])).toBe(0);
  });

  it("returns 1 when all bars are in lane 0", () => {
    const bars = [makeBar("a", 1700, 1750)];
    packLanes(bars);
    expect(countLanes(bars)).toBe(1);
  });

  it("returns correct count for multiple lanes", () => {
    const bars = [
      makeBar("a", 1700, 1760),
      makeBar("b", 1710, 1770),
      makeBar("c", 1720, 1780),
    ];
    packLanes(bars);
    expect(countLanes(bars)).toBe(3);
  });
});
