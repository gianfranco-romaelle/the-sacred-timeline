import { describe, expect, it } from "vitest";
import { buildRiverLaneProjection } from "@/historical/projections/river-lane-functor";
import { buildSeedIndex } from "@/data/entity-index";
import { defaultExplorerFilters } from "@/state/explorer-store";
import type {
  Person,
  PersonId,
  SacredTimelineSeedData,
  Tradition,
  TraditionId,
  HistoricalDateRange,
} from "@/types";

const makeDateRange = (year: number): HistoricalDateRange => ({
  kind: "instant",
  start: { date: { year, precision: "year" } },
  sortStartYear: year,
  displayLabel: `${year}`,
});

const makeTradition = (id: string, label: string): Tradition => ({
  id: `tradition_${id}` as TraditionId,
  entityType: "tradition",
  slug: id,
  label,
  description: "",
  domainIds: [],
  tagIds: [],
  citationIds: [],
  relatedEntityIds: [],
  mediaAssetIds: [],
  traditionType: "scientific",
  placeIds: [],
  institutionIds: [],
  conceptIds: [],
});

const makePerson = (
  id: string,
  traditionIds: TraditionId[],
  year?: number,
): Person => ({
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
  traditionIds,
  textIds: [],
  dateRange: year !== undefined ? makeDateRange(year) : undefined,
});

const baseSeed: SacredTimelineSeedData = {
  meta: { datasetId: "test", title: "Test", description: "", version: "0", generatedAt: "" },
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

describe("buildRiverLaneProjection", () => {
  it("returns empty lanes for empty seed", () => {
    const index = buildSeedIndex(baseSeed);
    const result = buildRiverLaneProjection(baseSeed, index, defaultExplorerFilters);
    expect(result.lanes).toHaveLength(0);
    expect(result.undatedOrUnassigned).toHaveLength(0);
  });

  it("creates one lane per tradition that has members", () => {
    const t1 = makeTradition("organic", "Organic Chemistry");
    const t2 = makeTradition("alchemical", "Alchemy");
    const seed = {
      ...baseSeed,
      traditions: [t1, t2],
      people: [
        makePerson("laurent", [t1.id], 1840),
        makePerson("gerhardt", [t1.id], 1844),
        makePerson("paracelsus", [t2.id], 1520),
      ],
    };
    const index = buildSeedIndex(seed);
    const result = buildRiverLaneProjection(seed, index, defaultExplorerFilters);
    expect(result.lanes).toHaveLength(2);
    const organicLane = result.lanes.find((l) => l.traditionId === t1.id);
    expect(organicLane?.entities).toHaveLength(2);
  });

  it("routes entities with no tradition to undatedOrUnassigned", () => {
    const t1 = makeTradition("organic", "Organic Chemistry");
    const seed = {
      ...baseSeed,
      traditions: [t1],
      people: [
        makePerson("laurent", [t1.id], 1840),
        makePerson("unknown", [], 1800),
      ],
    };
    const index = buildSeedIndex(seed);
    const result = buildRiverLaneProjection(seed, index, defaultExplorerFilters);
    expect(result.undatedOrUnassigned).toHaveLength(1);
    expect(result.undatedOrUnassigned[0].id).toBe("person_unknown");
  });

  it("places undated entities in undatedOrUnassigned even with a tradition", () => {
    const t1 = makeTradition("organic", "Organic Chemistry");
    const seed = {
      ...baseSeed,
      traditions: [t1],
      people: [makePerson("mystery", [t1.id])],
    };
    const index = buildSeedIndex(seed);
    const result = buildRiverLaneProjection(seed, index, defaultExplorerFilters);
    expect(result.undatedOrUnassigned).toHaveLength(1);
    expect(result.lanes).toHaveLength(0);
  });

  it("sorts entities within a lane chronologically", () => {
    const t1 = makeTradition("organic", "Organic Chemistry");
    const seed = {
      ...baseSeed,
      traditions: [t1],
      people: [
        makePerson("gerhardt", [t1.id], 1844),
        makePerson("laurent", [t1.id], 1840),
      ],
    };
    const index = buildSeedIndex(seed);
    const result = buildRiverLaneProjection(seed, index, defaultExplorerFilters);
    const lane = result.lanes[0];
    expect(lane.entities[0].primaryYear).toBeLessThan(lane.entities[1].primaryYear);
  });

  it("computes globalStartYear and globalEndYear from all lanes", () => {
    const t1 = makeTradition("organic", "Organic Chemistry");
    const t2 = makeTradition("alchemical", "Alchemy");
    const seed = {
      ...baseSeed,
      traditions: [t1, t2],
      people: [
        makePerson("laurent", [t1.id], 1840),
        makePerson("paracelsus", [t2.id], 1520),
      ],
    };
    const index = buildSeedIndex(seed);
    const result = buildRiverLaneProjection(seed, index, defaultExplorerFilters);
    expect(result.globalStartYear).toBe(1520);
    expect(result.globalEndYear).toBe(1840);
  });

  it("excludes traditions with no visible members from the lane list", () => {
    const t1 = makeTradition("organic", "Organic Chemistry");
    const t2 = makeTradition("empty", "Empty Tradition");
    const seed = {
      ...baseSeed,
      traditions: [t1, t2],
      people: [makePerson("laurent", [t1.id], 1840)],
    };
    const index = buildSeedIndex(seed);
    const result = buildRiverLaneProjection(seed, index, defaultExplorerFilters);
    expect(result.lanes.every((l) => l.traditionId !== t2.id)).toBe(true);
  });

  it("dense lane: 20 entities across 5 years all land in the projection", () => {
    const t1 = makeTradition("dense", "Dense Tradition");
    const people = Array.from({ length: 20 }, (_, i) =>
      makePerson(`person_${i}`, [t1.id], 1800 + (i % 5)),
    );
    const seed = { ...baseSeed, traditions: [t1], people };
    const index = buildSeedIndex(seed);
    const result = buildRiverLaneProjection(seed, index, defaultExplorerFilters);
    const lane = result.lanes[0];
    expect(lane.entities).toHaveLength(20);
    expect(result.visibleCounts.totalEntities).toBe(20);
  });

  it("visibleCounts.totalEntities matches sum of entities across all lanes", () => {
    const t1 = makeTradition("a", "Tradition A");
    const t2 = makeTradition("b", "Tradition B");
    const seed = {
      ...baseSeed,
      traditions: [t1, t2],
      people: [
        makePerson("p1", [t1.id], 1600),
        makePerson("p2", [t1.id], 1650),
        makePerson("p3", [t2.id], 1700),
      ],
    };
    const index = buildSeedIndex(seed);
    const result = buildRiverLaneProjection(seed, index, defaultExplorerFilters);
    const sumFromLanes = result.lanes.reduce((s, l) => s + l.entities.length, 0);
    expect(result.visibleCounts.totalEntities).toBe(sumFromLanes);
    expect(result.visibleCounts.totalEntities).toBe(3);
  });
});
