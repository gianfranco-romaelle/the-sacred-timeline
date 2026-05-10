import { describe, expect, it } from "vitest";
import { buildLifelinesProjection } from "../lifespan-adapter";
import { packLanes } from "../lane-packing";
import type { LifespanBar, RawLifespanEntry } from "../types";

// ── Synthetic data generators ───────────────────────────────────────────────

function makeSyntheticEntries(count: number): RawLifespanEntry[] {
  const calculusNumbers = [0, 1, 2, 3, 4, 5, null] as const;
  const calculusNames = ["Zeroth", "First", "Second", "Third", "Fourth", "Fifth", null] as const;

  return Array.from({ length: count }, (_, i) => {
    const birthYear = -700 + Math.floor((i / count) * 2720); // spread across -700..2020
    const lifespan = 40 + (i % 80); // 40–120 year lifespans
    const deathYear = birthYear + lifespan > 2024 ? null : birthYear + lifespan;
    const stage = i % 7;
    return {
      name: `Person ${i}`,
      birth_year: birthYear,
      death_year: deathYear,
      lifespan_raw: deathYear ? `${birthYear} – ${deathYear}` : `${birthYear} – present`,
      country: i % 3 === 0 ? "England" : i % 3 === 1 ? "Germany" : null,
      field: i % 4 === 0 ? "Mathematics" : i % 4 === 1 ? "Philosophy" : null,
      calculus_number: calculusNumbers[stage] ?? null,
      calculus_name: calculusNames[stage] ?? null,
      portrait_url: i % 5 === 0 ? "Picture" : null,
    };
  });
}

function makeDenseBars(count: number, startYear = 1800, endYear = 1900): LifespanBar[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `b-${i}`,
    name: `Person ${i}`,
    startYear: startYear + (i % (endYear - startYear)),
    endYear: startYear + (i % (endYear - startYear)) + 20 + (i % 40),
    isOpenEnded: false,
    displayText: "",
    country: null,
    field: null,
    calculusNumber: null,
    calculusName: null,
    domainIds: [],
    domainLabels: [],
    traditionIds: [],
    traditionLabels: [],
    portraitUrl: null,
    lane: 0,
  }));
}

// ── buildLifelinesProjection performance ────────────────────────────────────

describe("buildLifelinesProjection performance", () => {
  it("processes 100 entries in <50 ms", () => {
    const data = makeSyntheticEntries(100);
    const start = performance.now();
    const result = buildLifelinesProjection(data);
    const elapsed = performance.now() - start;

    expect(result.totalBars).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(50);
  });

  it("processes 1 000 entries in <200 ms", () => {
    const data = makeSyntheticEntries(1_000);
    const start = performance.now();
    const result = buildLifelinesProjection(data);
    const elapsed = performance.now() - start;

    expect(result.totalBars).toBeGreaterThan(900); // most valid
    expect(elapsed).toBeLessThan(200);
  });

  it("processes 10 000 entries in <2 000 ms", () => {
    const data = makeSyntheticEntries(10_000);
    const start = performance.now();
    const result = buildLifelinesProjection(data);
    const elapsed = performance.now() - start;

    expect(result.totalBars).toBeGreaterThan(9_000);
    expect(elapsed).toBeLessThan(2_000);
    console.log(`10 000 entries: ${elapsed.toFixed(1)} ms, ${result.totalBars} bars, ${result.groups.length} groups`);
  });
});

// ── packLanes performance ────────────────────────────────────────────────────

describe("packLanes performance", () => {
  it("packs 100 bars in <5 ms", () => {
    const bars = makeDenseBars(100);
    const start = performance.now();
    packLanes(bars);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(5);
  });

  it("packs 1 000 bars in <50 ms", () => {
    const bars = makeDenseBars(1_000);
    const start = performance.now();
    packLanes(bars);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(50);
    console.log(`1 000 bars packed in ${elapsed.toFixed(1)} ms, lanes used: ${Math.max(...bars.map(b => b.lane)) + 1}`);
  });

  it("packs 10 000 bars in <500 ms", () => {
    const bars = makeDenseBars(10_000);
    const start = performance.now();
    packLanes(bars);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(500);
    console.log(`10 000 bars packed in ${elapsed.toFixed(1)} ms`);
  });

  it("packs 10 000 sparse bars (spread across 2 000 years) in <500 ms", () => {
    const bars = makeDenseBars(10_000, -700, 2020);
    const start = performance.now();
    packLanes(bars);
    const elapsed = performance.now() - start;

    const laneCount = Math.max(...bars.map(b => b.lane)) + 1;
    expect(elapsed).toBeLessThan(500);
    expect(laneCount).toBeLessThanOrEqual(60); // MAX_LANES cap
    console.log(`10 000 sparse bars in ${elapsed.toFixed(1)} ms, lanes: ${laneCount}`);
  });
});

// ── Correctness at scale ──────────────────────────────────────────────────

describe("projection correctness at scale", () => {
  it("groups are ordered by calculus_number (null last)", () => {
    const data = makeSyntheticEntries(500);
    const { groups } = buildLifelinesProjection(data);

    const numberedGroups = groups.filter((g) => g.calculusNumber !== null);
    for (let i = 1; i < numberedGroups.length; i++) {
      expect(numberedGroups[i].calculusNumber!).toBeGreaterThan(
        numberedGroups[i - 1].calculusNumber!,
      );
    }
    const nullGroup = groups.find((g) => g.calculusNumber === null);
    if (nullGroup) {
      expect(groups.indexOf(nullGroup)).toBe(groups.length - 1);
    }
  });

  it("all bars within a group have the correct calculusNumber", () => {
    const { groups } = buildLifelinesProjection(makeSyntheticEntries(200));
    for (const group of groups) {
      for (const bar of group.bars) {
        expect(bar.calculusNumber).toBe(group.calculusNumber);
      }
    }
  });

  it("globalStartYear / globalEndYear span all bars", () => {
    const { groups, globalStartYear, globalEndYear } = buildLifelinesProjection(
      makeSyntheticEntries(300),
    );
    for (const group of groups) {
      for (const bar of group.bars) {
        expect(bar.startYear).toBeGreaterThanOrEqual(globalStartYear);
        expect(bar.endYear).toBeLessThanOrEqual(globalEndYear);
      }
    }
  });
});
