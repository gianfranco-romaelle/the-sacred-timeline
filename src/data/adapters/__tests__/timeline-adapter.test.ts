import { describe, expect, it } from "vitest";
import { buildTimelineProjection } from "@/data/adapters/timeline-adapter";
import { buildSeedIndex } from "@/data/entity-index";
import { defaultExplorerFilters } from "@/state/explorer-store";
import type {
  Concept,
  ConceptId,
  Person,
  PersonId,
  Place,
  PlaceId,
  SacredTimelineSeedData,
} from "@/types";

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
  roles: ["scientist"],
  institutionIds: [],
  traditionIds: [],
  textIds: [],
  ...(year !== undefined
    ? {
        dateRange: {
          kind: "instant" as const,
          start: { date: { year, precision: "year" as const } },
          sortStartYear: year,
          displayLabel: String(year),
        },
      }
    : {}),
});

const makeConcept = (id: string, year?: number): Concept => ({
  id: `concept_${id}` as ConceptId,
  entityType: "concept",
  slug: id,
  label: id,
  description: "",
  domainIds: [],
  tagIds: [],
  citationIds: [],
  relatedEntityIds: [],
  mediaAssetIds: [],
  conceptType: "theory",
  traditionIds: [],
  textIds: [],
  ...(year !== undefined
    ? {
        dateRange: {
          kind: "instant" as const,
          start: { date: { year, precision: "year" as const } },
          sortStartYear: year,
          displayLabel: String(year),
        },
      }
    : {}),
});

const makePlace = (id: string): Place => ({
  id: `place_${id}` as PlaceId,
  entityType: "place",
  slug: id,
  label: id,
  description: "",
  domainIds: [],
  tagIds: [],
  citationIds: [],
  relatedEntityIds: [],
  mediaAssetIds: [],
  placeType: "city",
  geometry: { point: { latitude: 0, longitude: 0 } },
});

const baseSeed: SacredTimelineSeedData = {
  meta: { datasetId: "test", title: "T", description: "", version: "0", generatedAt: "" },
  domains: [],
  tags: [],
  sources: [],
  citations: [],
  portraitAssets: [],
  people: [],
  texts: [],
  concepts: [],
  events: [],
  places: [],
  institutions: [],
  traditions: [],
  edges: [],
};

describe("buildTimelineProjection", () => {
  it("returns empty items and groups for empty seed", () => {
    const index = buildSeedIndex(baseSeed);
    const result = buildTimelineProjection(baseSeed, index, defaultExplorerFilters);
    expect(result.items).toHaveLength(0);
    expect(result.byEra).toHaveLength(0);
    expect(result.byCentury).toHaveLength(0);
  });

  it("excludes place entities from timeline items", () => {
    const place = makePlace("cairo");
    const seed = { ...baseSeed, places: [place] };
    const index = buildSeedIndex(seed);
    const result = buildTimelineProjection(seed, index, defaultExplorerFilters);
    expect(result.items).toHaveLength(0);
  });

  it("includes persons and concepts in timeline items", () => {
    const person = makePerson("al_haytham", 1000);
    const concept = makeConcept("optics", 1000);
    const seed = { ...baseSeed, people: [person], concepts: [concept] };
    const index = buildSeedIndex(seed);
    const result = buildTimelineProjection(seed, index, defaultExplorerFilters);
    expect(result.items).toHaveLength(2);
  });

  it("groups entities by era into byEra", () => {
    const ancient = makePerson("ancient", 300);
    const modern = makePerson("modern", 1850);
    const seed = { ...baseSeed, people: [ancient, modern] };
    const index = buildSeedIndex(seed);
    const result = buildTimelineProjection(seed, index, defaultExplorerFilters);
    expect(result.byEra.length).toBeGreaterThanOrEqual(2);
    const allGroupKeys = result.byEra.map((g) => g.key);
    expect(new Set(allGroupKeys).size).toBe(allGroupKeys.length);
  });

  it("groups same-century entities into the same byCentury group", () => {
    const p1 = makePerson("early_1200", 1210);
    const p2 = makePerson("late_1200", 1290);
    const seed = { ...baseSeed, people: [p1, p2] };
    const index = buildSeedIndex(seed);
    const result = buildTimelineProjection(seed, index, defaultExplorerFilters);
    expect(result.byCentury).toHaveLength(1);
    expect(result.byCentury[0].items).toHaveLength(2);
  });

  it("marks the selected entity as isSelected=true", () => {
    const person = makePerson("al_haytham", 1000);
    const seed = { ...baseSeed, people: [person] };
    const index = buildSeedIndex(seed);
    const result = buildTimelineProjection(seed, index, defaultExplorerFilters, person.id);
    expect(result.items[0].isSelected).toBe(true);
  });

  it("dims non-selected non-neighbor entities when a selection is active", () => {
    // Years must be > 120 apart so 'same-era' context reason is not triggered
    const selected = makePerson("selected", 1000);
    const other = makePerson("other", 1600);
    const seed = { ...baseSeed, people: [selected, other] };
    const index = buildSeedIndex(seed);
    const result = buildTimelineProjection(seed, index, defaultExplorerFilters, selected.id);
    const otherItem = result.items.find((item) => item.id === other.id);
    expect(otherItem?.isDimmed).toBe(true);
  });

  it("density is 'high' for groups with 6+ items", () => {
    // Years 1201–1207 are all in the 13th century per getCenturyLabel
    // (formula: Math.floor((year-1)/100)+1; year 1201 → 13th, year 1200 → 12th)
    const people = Array.from({ length: 7 }, (_, i) =>
      makePerson(`p${i}`, 1201 + i),
    );
    const seed = { ...baseSeed, people };
    const index = buildSeedIndex(seed);
    const result = buildTimelineProjection(seed, index, defaultExplorerFilters);
    // All 7 items are in the 13th century
    const group = result.byCentury[0];
    expect(group.items).toHaveLength(7);
    expect(group.density).toBe("high");
  });

  it("visibleCounts.items matches items array length", () => {
    const person = makePerson("al_haytham", 1000);
    const seed = { ...baseSeed, people: [person] };
    const index = buildSeedIndex(seed);
    const result = buildTimelineProjection(seed, index, defaultExplorerFilters);
    expect(result.visibleCounts.items).toBe(result.items.length);
    expect(result.visibleCounts.eraGroups).toBe(result.byEra.length);
    expect(result.visibleCounts.centuryGroups).toBe(result.byCentury.length);
  });
});
