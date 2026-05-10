import { describe, expect, it } from "vitest";
import {
  getCenturyLabel,
  getEraBucket,
  getPrimaryYearFromDateRange,
  getRangeEndYear,
  groupEntitiesByCentury,
  groupEntitiesByEra,
  sortEntitiesChronologically,
} from "@/data/time-grouping";
import type { HistoricalDateRange, KnowledgeEntity, Person, PersonId } from "@/types";

const makeInstant = (year: number): HistoricalDateRange => ({
  kind: "instant",
  start: { date: { year, precision: "year" } },
  sortStartYear: year,
  displayLabel: `${year}`,
});

const makeRange = (startYear: number, endYear: number): HistoricalDateRange => ({
  kind: "range",
  start: { date: { year: startYear, precision: "year" } },
  end: { date: { year: endYear, precision: "year" } },
  sortStartYear: startYear,
  sortEndYear: endYear,
  displayLabel: `${startYear}–${endYear}`,
});

const makePerson = (id: string, year?: number): Person => ({
  id: `person_${id}` as PersonId,
  entityType: "person",
  slug: id,
  label: id,
  description: "",
  domainIds: [],
  tagIds: [],
  citationIds: [],
  relatedEntityIds: [],
  mediaAssetIds: [],
  roles: [],
  institutionIds: [],
  traditionIds: [],
  textIds: [],
  dateRange: year !== undefined ? makeInstant(year) : undefined,
});

describe("getPrimaryYearFromDateRange", () => {
  it("returns undefined for undefined input", () => {
    expect(getPrimaryYearFromDateRange(undefined)).toBeUndefined();
  });

  it("returns sortStartYear when present", () => {
    expect(getPrimaryYearFromDateRange(makeInstant(1200))).toBe(1200);
  });

  it("falls back to start.date.year when sortStartYear is absent", () => {
    const dateRange: HistoricalDateRange = {
      kind: "instant",
      start: { date: { year: 800, precision: "year" } },
      displayLabel: "800",
    };
    expect(getPrimaryYearFromDateRange(dateRange)).toBe(800);
  });
});

describe("getRangeEndYear", () => {
  it("returns undefined for undefined input", () => {
    expect(getRangeEndYear(undefined)).toBeUndefined();
  });

  it("returns sortEndYear when present", () => {
    const dr = makeRange(1100, 1200);
    expect(getRangeEndYear(dr)).toBe(1200);
  });

  it("falls back to end.date.year when sortEndYear is absent", () => {
    const dateRange: HistoricalDateRange = {
      kind: "range",
      start: { date: { year: 1100, precision: "year" } },
      end: { date: { year: 1200, precision: "year" } },
      displayLabel: "1100-1200",
    };
    expect(getRangeEndYear(dateRange)).toBe(1200);
  });
});

describe("getCenturyLabel", () => {
  it("labels year 1 in the 1st-century bucket", () => {
    expect(getCenturyLabel(1)).toMatch(/^1th century$/);
  });

  it("labels year 100 in the 1st-century bucket (last year)", () => {
    expect(getCenturyLabel(100)).toMatch(/^1th century$/);
  });

  it("labels year 101 in the 2nd-century bucket", () => {
    expect(getCenturyLabel(101)).toMatch(/^2th century$/);
  });

  it("labels year 1200 as 12th century (last year of that bucket)", () => {
    expect(getCenturyLabel(1200)).toBe("12th century");
  });

  it("labels year 1201 as 13th century (first year of that bucket)", () => {
    expect(getCenturyLabel(1201)).toBe("13th century");
  });

  it("year 1200 and year 1201 are in different century buckets", () => {
    expect(getCenturyLabel(1200)).not.toBe(getCenturyLabel(1201));
  });

  it("labels BCE years with BCE suffix", () => {
    expect(getCenturyLabel(-400)).toMatch(/BCE/);
  });
});

describe("getEraBucket", () => {
  it("ancient: year < 500", () => {
    expect(getEraBucket(499)).toEqual({ key: "ancient", label: "Ancient World" });
  });

  it("medieval: 500 <= year < 1500", () => {
    expect(getEraBucket(1000)).toEqual({ key: "medieval", label: "Medieval World" });
  });

  it("early-modern: 1500 <= year < 1800", () => {
    expect(getEraBucket(1600)).toEqual({ key: "early-modern", label: "Early Modern" });
  });

  it("modern: year >= 1800", () => {
    expect(getEraBucket(1900)).toEqual({ key: "modern", label: "Modern World" });
  });

  it("boundary 500 is medieval", () => {
    expect(getEraBucket(500).key).toBe("medieval");
  });

  it("boundary 1500 is early-modern", () => {
    expect(getEraBucket(1500).key).toBe("early-modern");
  });

  it("boundary 1800 is modern", () => {
    expect(getEraBucket(1800).key).toBe("modern");
  });
});

describe("sortEntitiesChronologically", () => {
  it("sorts entities by primary year ascending", () => {
    const a = makePerson("a", 1500);
    const b = makePerson("b", 800);
    const c = makePerson("c", 1200);
    const result = sortEntitiesChronologically([a, b, c] as KnowledgeEntity[]);
    expect(result.map((e) => e.id)).toEqual(["person_b", "person_c", "person_a"]);
  });

  it("breaks ties by label alphabetically", () => {
    const alpha = makePerson("alpha", 1000);
    const beta = makePerson("beta", 1000);
    const result = sortEntitiesChronologically([beta, alpha] as KnowledgeEntity[]);
    expect(result[0].id).toBe("person_alpha");
  });

  it("places undated entities at the end", () => {
    const dated = makePerson("dated", 1000);
    const undated = makePerson("undated");
    const result = sortEntitiesChronologically([undated, dated] as KnowledgeEntity[]);
    expect(result[0].id).toBe("person_dated");
    expect(result[1].id).toBe("person_undated");
  });

  it("does not mutate the original array", () => {
    const a = makePerson("a", 1500);
    const b = makePerson("b", 800);
    const original = [a, b] as KnowledgeEntity[];
    sortEntitiesChronologically(original);
    expect(original[0].id).toBe("person_a");
  });
});

describe("groupEntitiesByCentury", () => {
  it("returns empty array for empty input", () => {
    expect(groupEntitiesByCentury([])).toEqual([]);
  });

  it("places entities from the same century in one group", () => {
    const a = makePerson("a", 1201);
    const b = makePerson("b", 1250);
    const groups = groupEntitiesByCentury([a, b] as KnowledgeEntity[]);
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toHaveLength(2);
  });

  it("creates separate groups for different centuries", () => {
    const medieval = makePerson("medieval", 1100);
    const earlyMod = makePerson("early", 1600);
    const groups = groupEntitiesByCentury([medieval, earlyMod] as KnowledgeEntity[]);
    expect(groups).toHaveLength(2);
  });

  it("places undated entities in a separate undated group", () => {
    const dated = makePerson("dated", 1100);
    const undated = makePerson("undated");
    const groups = groupEntitiesByCentury([dated, undated] as KnowledgeEntity[]);
    const undatedGroup = groups.find((g) => g.key === "undated");
    expect(undatedGroup).toBeDefined();
    expect(undatedGroup!.items).toHaveLength(1);
  });
});

describe("groupEntitiesByEra", () => {
  it("returns empty array for empty input", () => {
    expect(groupEntitiesByEra([])).toEqual([]);
  });

  it("groups medieval entities together", () => {
    const a = makePerson("a", 900);
    const b = makePerson("b", 1200);
    const groups = groupEntitiesByEra([a, b] as KnowledgeEntity[]);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("medieval");
    expect(groups[0].items).toHaveLength(2);
  });

  it("creates separate era groups in chronological order", () => {
    const ancient = makePerson("anc", 300);
    const medieval = makePerson("med", 1000);
    const modern = makePerson("mod", 1900);
    const groups = groupEntitiesByEra([ancient, medieval, modern] as KnowledgeEntity[]);
    expect(groups.map((g) => g.key)).toEqual(["ancient", "medieval", "modern"]);
  });

  it("places undated in an undated group", () => {
    const undated = makePerson("anon");
    const groups = groupEntitiesByEra([undated] as KnowledgeEntity[]);
    expect(groups[0].key).toBe("undated");
  });
});
