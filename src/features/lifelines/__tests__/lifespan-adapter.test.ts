import { describe, expect, it } from "vitest";
import { buildLifelinesProjection } from "@/features/lifelines/lifespan-adapter";
import type { RawLifespanEntry } from "@/features/lifelines/types";

const makeEntry = (overrides: Partial<RawLifespanEntry> = {}): RawLifespanEntry => ({
  name: "Test Person",
  birth_year: 1000,
  death_year: 1080,
  lifespan_raw: null,
  country: null,
  field: null,
  calculus_number: null,
  calculus_name: null,
  portrait_url: null,
  ...overrides,
});

describe("buildLifelinesProjection", () => {
  it("returns empty projection for empty input", () => {
    const result = buildLifelinesProjection([]);
    expect(result.groups).toHaveLength(0);
    expect(result.totalBars).toBe(0);
  });

  it("drops entries with null birth_year", () => {
    const result = buildLifelinesProjection([makeEntry({ birth_year: null })]);
    expect(result.totalBars).toBe(0);
  });

  it("drops entries where death_year < birth_year", () => {
    const result = buildLifelinesProjection([makeEntry({ birth_year: 1080, death_year: 1000 })]);
    expect(result.totalBars).toBe(0);
  });

  it("drops modern entries with lifespan > 140 years", () => {
    const result = buildLifelinesProjection([makeEntry({ birth_year: 1900, death_year: 2060 })]);
    expect(result.totalBars).toBe(0);
  });

  it("does NOT drop ancient entries with lifespan > 140 years (historical uncertainty)", () => {
    const result = buildLifelinesProjection([makeEntry({ birth_year: -1700, death_year: -1500 })]);
    expect(result.totalBars).toBe(1);
  });

  it("adapts a valid entry to a LifespanBar", () => {
    const result = buildLifelinesProjection([makeEntry()]);
    expect(result.totalBars).toBe(1);
    const bar = result.groups[0].bars[0];
    expect(bar.startYear).toBe(1000);
    expect(bar.endYear).toBe(1080);
    expect(bar.isOpenEnded).toBe(false);
  });

  it("uses PRESENT_YEAR as end when death_year is null and lifespan_raw is unparseable", () => {
    const currentYear = new Date().getFullYear();
    const result = buildLifelinesProjection([makeEntry({ death_year: null })]);
    const bar = result.groups[0].bars[0];
    expect(bar.isOpenEnded).toBe(true);
    expect(bar.endYear).toBe(currentYear);
  });

  it("parses approximate death year from lifespan_raw with en-dash", () => {
    const result = buildLifelinesProjection([
      makeEntry({ death_year: null, birth_year: 170, lifespan_raw: "c. 170–c. 270" }),
    ]);
    const bar = result.groups[0].bars[0];
    expect(bar.isOpenEnded).toBe(false);
    expect(bar.endYear).toBe(270);
  });

  it("treats 'present' keyword in lifespan_raw as open-ended", () => {
    const currentYear = new Date().getFullYear();
    const result = buildLifelinesProjection([
      makeEntry({ death_year: null, birth_year: 1970, lifespan_raw: "1970–present" }),
    ]);
    const bar = result.groups[0].bars[0];
    expect(bar.isOpenEnded).toBe(true);
    expect(bar.endYear).toBe(currentYear);
  });

  it("cleans portrait_url and rejects placeholder 'picture' value", () => {
    const result1 = buildLifelinesProjection([makeEntry({ portrait_url: "picture" })]);
    expect(result1.groups[0].bars[0].portraitUrl).toBeNull();

    const result2 = buildLifelinesProjection([makeEntry({ portrait_url: "http://example.com/p.jpg" })]);
    expect(result2.groups[0].bars[0].portraitUrl).toBe("http://example.com/p.jpg");
  });

  it("groups entries by calculus_number", () => {
    const entries = [
      makeEntry({ calculus_number: 1, calculus_name: "Pre-Axial" }),
      makeEntry({ calculus_number: 2, calculus_name: "Axial" }),
      makeEntry({ calculus_number: 1, calculus_name: "Pre-Axial", birth_year: 1050, death_year: 1100 }),
    ];
    const result = buildLifelinesProjection(entries);
    expect(result.groups).toHaveLength(2);
    const group1 = result.groups.find((g) => g.calculusNumber === 1)!;
    expect(group1.bars).toHaveLength(2);
  });

  it("sorts groups by calculus_number ascending, null last", () => {
    const entries = [
      makeEntry({ calculus_number: null }),
      makeEntry({ calculus_number: 2, birth_year: 1200, death_year: 1250 }),
      makeEntry({ calculus_number: 1 }),
    ];
    const result = buildLifelinesProjection(entries);
    expect(result.groups.map((g) => g.calculusNumber)).toEqual([1, 2, null]);
  });

  it("sorts bars within a group chronologically by birth year", () => {
    const entries = [
      makeEntry({ birth_year: 1200, death_year: 1250, calculus_number: 1 }),
      makeEntry({ birth_year: 1000, death_year: 1050, calculus_number: 1 }),
    ];
    const result = buildLifelinesProjection(entries);
    const bars = result.groups[0].bars;
    expect(bars[0].startYear).toBe(1000);
    expect(bars[1].startYear).toBe(1200);
  });

  it("assigns sequential lane indices within a group", () => {
    const entries = [
      makeEntry({ birth_year: 1000, death_year: 1050, calculus_number: 1 }),
      makeEntry({ birth_year: 1100, death_year: 1150, calculus_number: 1 }),
    ];
    const result = buildLifelinesProjection(entries);
    const bars = result.groups[0].bars;
    expect(bars[0].lane).toBe(0);
    expect(bars[1].lane).toBe(1);
  });

  it("computes globalStartYear and globalEndYear across all groups", () => {
    const entries = [
      makeEntry({ birth_year: 500, death_year: 600, calculus_number: 1 }),
      makeEntry({ birth_year: 1800, death_year: 1850, calculus_number: 2 }),
    ];
    const result = buildLifelinesProjection(entries);
    expect(result.globalStartYear).toBe(500);
    expect(result.globalEndYear).toBe(1850);
  });

  it("counts totalBars across all groups", () => {
    const entries = [
      makeEntry({ calculus_number: 1 }),
      makeEntry({ calculus_number: 1, birth_year: 1050, death_year: 1100 }),
      makeEntry({ calculus_number: 2, birth_year: 1200, death_year: 1250 }),
    ];
    const result = buildLifelinesProjection(entries);
    expect(result.totalBars).toBe(3);
  });

  it("uses 'NaN' lifespan_raw as blank (open-ended)", () => {
    const currentYear = new Date().getFullYear();
    const result = buildLifelinesProjection([
      makeEntry({ death_year: null, lifespan_raw: "NaN" }),
    ]);
    expect(result.groups[0].bars[0].isOpenEnded).toBe(true);
    expect(result.groups[0].bars[0].endYear).toBe(currentYear);
  });

  it("keeps field grouping aligned after invalid rows are dropped", () => {
    const result = buildLifelinesProjection(
      [
        makeEntry({ birth_year: null, field: "Dropped field" }),
        makeEntry({ name: "Valid mathematician", field: "Mathematics" }),
      ],
      "field",
    );

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].calculusName).toBe("Mathematics");
    expect(result.groups[0].bars[0].name).toBe("Valid mathematician");
  });
});
