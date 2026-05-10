import { describe, expect, it } from "vitest";
import {
  matchesTimeFilter,
  matchesEntityTypeFilters,
  matchesLocalEntityScope,
  matchesDomainFilters,
  filterKnowledgeEntities,
  matchesEdgeFilters,
  matchesTraditionFilters,
  matchesTagFilters,
  matchesGeographyFilters,
  filterVisibleEdges,
} from "@/data/filtering";
import { defaultExplorerFilters } from "@/state/explorer-store";
import type {
  CanonicalEntityType,
  DomainId,
  Edge,
  EdgeId,
  EventId,
  HistoricalDateRange,
  Person,
  PersonId,
  PlaceId,
  SacredTimelineSeedData,
  TagId,
  TraditionId,
} from "@/types";

const makeDateRange = (year: number): HistoricalDateRange => ({
  kind: "instant",
  start: { date: { year, precision: "year" } },
  sortStartYear: year,
  displayLabel: `${year}`,
});

const makePerson = (id: string, overrides: Partial<Person> = {}): Person => ({
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
  ...overrides,
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

describe("matchesTimeFilter", () => {
  it("includes undated entities when includeUndated is true", () => {
    expect(
      matchesTimeFilter(undefined, { ...defaultExplorerFilters, includeUndated: true }),
    ).toBe(true);
  });

  it("excludes undated entities when includeUndated is false", () => {
    expect(
      matchesTimeFilter(undefined, { ...defaultExplorerFilters, includeUndated: false }),
    ).toBe(false);
  });

  it("includes entity within explicit year range", () => {
    const dateRange = makeDateRange(1800);
    expect(
      matchesTimeFilter(dateRange, { ...defaultExplorerFilters, startYear: 1750, endYear: 1850 }),
    ).toBe(true);
  });

  it("excludes entity before startYear", () => {
    const dateRange = makeDateRange(1700);
    expect(
      matchesTimeFilter(dateRange, { ...defaultExplorerFilters, startYear: 1750 }),
    ).toBe(false);
  });

  it("excludes entity after endYear", () => {
    const dateRange = makeDateRange(1900);
    expect(
      matchesTimeFilter(dateRange, { ...defaultExplorerFilters, endYear: 1850 }),
    ).toBe(false);
  });

  it("includes entity matching 'medieval' preset", () => {
    const dateRange = makeDateRange(1200);
    expect(
      matchesTimeFilter(dateRange, { ...defaultExplorerFilters, timePreset: "medieval" }),
    ).toBe(true);
  });

  it("excludes entity not matching 'medieval' preset", () => {
    const dateRange = makeDateRange(1850);
    expect(
      matchesTimeFilter(dateRange, { ...defaultExplorerFilters, timePreset: "medieval" }),
    ).toBe(false);
  });
});

describe("matchesEntityTypeFilters", () => {
  const laurent = makePerson("laurent");

  it("passes when no type filter is set", () => {
    expect(matchesEntityTypeFilters(laurent, defaultExplorerFilters)).toBe(true);
  });

  it("passes when entity type is in the filter list", () => {
    const filters = {
      ...defaultExplorerFilters,
      entityTypes: ["person"] as CanonicalEntityType[],
    };
    expect(matchesEntityTypeFilters(laurent, filters)).toBe(true);
  });

  it("fails when entity type is not in the filter list", () => {
    const filters = {
      ...defaultExplorerFilters,
      entityTypes: ["text"] as CanonicalEntityType[],
    };
    expect(matchesEntityTypeFilters(laurent, filters)).toBe(false);
  });
});

describe("matchesLocalEntityScope", () => {
  const laurent = makePerson("laurent");

  it("passes when no local scope is set", () => {
    expect(matchesLocalEntityScope(laurent, defaultExplorerFilters)).toBe(true);
  });

  it("passes when entity is in the local scope", () => {
    expect(
      matchesLocalEntityScope(laurent, {
        ...defaultExplorerFilters,
        localEntityIds: ["person_laurent"] as any,
      }),
    ).toBe(true);
  });

  it("fails when entity is outside the local scope", () => {
    expect(
      matchesLocalEntityScope(laurent, {
        ...defaultExplorerFilters,
        localEntityIds: ["person_other"] as any,
      }),
    ).toBe(false);
  });
});

describe("matchesDomainFilters", () => {
  it("passes when no domain filter is set", () => {
    expect(matchesDomainFilters([], defaultExplorerFilters)).toBe(true);
  });

  it("passes when entity has a matching domain", () => {
    const filters = {
      ...defaultExplorerFilters,
      domainIds: ["domain_science"] as DomainId[],
    };
    expect(matchesDomainFilters(["domain_science"] as DomainId[], filters)).toBe(true);
  });

  it("fails when entity has no matching domain", () => {
    const filters = {
      ...defaultExplorerFilters,
      domainIds: ["domain_science"] as DomainId[],
    };
    expect(matchesDomainFilters(["domain_religion"] as DomainId[], filters)).toBe(false);
  });
});

const makeEdge = (overrides: Partial<Edge> = {}): Edge => ({
  id: "edge_test" as EdgeId,
  recordType: "edge",
  relationType: "influenced",
  label: "test edge",
  description: "",
  sourceId: "person_a",
  targetId: "person_b",
  direction: "directed",
  domainIds: [],
  tagIds: [],
  citationIds: [],
  relatedEntityIds: [],
  mediaAssetIds: [],
  weight: 1,
  ...overrides,
});

describe("matchesEdgeFilters — assertion layer", () => {
  it("allows canonical edges when showAiHypotheses is false", () => {
    const edge = makeEdge({ assertionLayer: "canonical" });
    expect(
      matchesEdgeFilters(edge, { ...defaultExplorerFilters, showAiHypotheses: false }),
    ).toBe(true);
  });

  it("allows editorial edges when showAiHypotheses is false", () => {
    const edge = makeEdge({ assertionLayer: "editorial" });
    expect(
      matchesEdgeFilters(edge, { ...defaultExplorerFilters, showAiHypotheses: false }),
    ).toBe(true);
  });

  it("blocks ai_hypothesis edges when showAiHypotheses is false", () => {
    const edge = makeEdge({ assertionLayer: "ai_hypothesis" });
    expect(
      matchesEdgeFilters(edge, { ...defaultExplorerFilters, showAiHypotheses: false }),
    ).toBe(false);
  });

  it("allows ai_hypothesis edges when showAiHypotheses is true (default)", () => {
    const edge = makeEdge({ assertionLayer: "ai_hypothesis" });
    expect(matchesEdgeFilters(edge, defaultExplorerFilters)).toBe(true);
  });

  it("allows edges with no assertionLayer when showAiHypotheses is false", () => {
    const edge = makeEdge({ assertionLayer: undefined });
    expect(
      matchesEdgeFilters(edge, { ...defaultExplorerFilters, showAiHypotheses: false }),
    ).toBe(true);
  });
});

describe("filterKnowledgeEntities", () => {
  it("returns all entities when no filters are active", () => {
    const seed = {
      ...baseSeed,
      people: [makePerson("laurent"), makePerson("gerhardt")],
    };
    const result = filterKnowledgeEntities(seed, defaultExplorerFilters);
    expect(result).toHaveLength(2);
  });

  it("excludes entities that do not match entity type filter", () => {
    const seed = {
      ...baseSeed,
      people: [makePerson("laurent")],
      events: [
        {
          id: "event_discovery" as EventId,
          entityType: "event" as const,
          slug: "discovery",
          label: "A Discovery",
          description: "",
          domainIds: [],
          tagIds: [],
          citationIds: [],
          relatedEntityIds: [],
          mediaAssetIds: [],
          eventType: "discovery" as const,
          participantIds: [],
          placeIds: [],
          institutionIds: [],
          textIds: [],
          conceptIds: [],
        },
      ],
    };
    const filters = {
      ...defaultExplorerFilters,
      entityTypes: ["person"] as CanonicalEntityType[],
    };
    const result = filterKnowledgeEntities(seed, filters);
    expect(result).toHaveLength(1);
    expect(result[0].entityType).toBe("person");
  });

  it("excludes entities outside the time range", () => {
    const seed = {
      ...baseSeed,
      people: [
        makePerson("ancient", { dateRange: makeDateRange(200) }),
        makePerson("modern", { dateRange: makeDateRange(1800) }),
      ],
    };
    const filters = { ...defaultExplorerFilters, startYear: 1700, endYear: 1900 };
    const result = filterKnowledgeEntities(seed, filters);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("person_modern");
  });

  it("uses matching relation participants when relation type filters are active", () => {
    const seed = {
      ...baseSeed,
      people: [makePerson("a"), makePerson("b"), makePerson("c")],
      edges: [
        makeEdge({
          id: "edge_a_b" as EdgeId,
          sourceId: "person_a",
          targetId: "person_b",
          relationType: "influenced",
        }),
        makeEdge({
          id: "edge_b_c" as EdgeId,
          sourceId: "person_b",
          targetId: "person_c",
          relationType: "corresponded_with",
        }),
      ],
    };
    const result = filterKnowledgeEntities(seed, {
      ...defaultExplorerFilters,
      relationTypes: ["influenced"],
    });

    expect(result.map((entity) => entity.id).sort()).toEqual(["person_a", "person_b"]);
  });

  it("does not keep entities connected only through hidden AI relations", () => {
    const seed = {
      ...baseSeed,
      people: [makePerson("a"), makePerson("b"), makePerson("c")],
      edges: [
        makeEdge({
          id: "edge_a_b" as EdgeId,
          sourceId: "person_a",
          targetId: "person_b",
          relationType: "influenced",
          assertionLayer: "ai_hypothesis",
        }),
        makeEdge({
          id: "edge_b_c" as EdgeId,
          sourceId: "person_b",
          targetId: "person_c",
          relationType: "influenced",
          assertionLayer: "canonical",
        }),
      ],
    };
    const result = filterKnowledgeEntities(seed, {
      ...defaultExplorerFilters,
      relationTypes: ["influenced"],
      showAiHypotheses: false,
    });

    expect(result.map((entity) => entity.id).sort()).toEqual(["person_b", "person_c"]);
  });

  it("limits results to a local neighborhood scope", () => {
    const seed = {
      ...baseSeed,
      people: [makePerson("a"), makePerson("b"), makePerson("c")],
    };
    const result = filterKnowledgeEntities(seed, {
      ...defaultExplorerFilters,
      localEntityIds: ["person_a", "person_c"] as any,
    });

    expect(result.map((entity) => entity.id).sort()).toEqual(["person_a", "person_c"]);
  });
});

describe("matchesTraditionFilters", () => {
  const personWithTradition = makePerson("monk", {
    traditionIds: ["tradition_latin_christian_monasticism"] as TraditionId[],
  });
  const personNoTradition = makePerson("no_tradition");

  it("passes when no tradition filter is set", () => {
    expect(matchesTraditionFilters(personWithTradition, defaultExplorerFilters)).toBe(true);
  });

  it("passes when entity belongs to the filtered tradition", () => {
    const filters = {
      ...defaultExplorerFilters,
      traditionIds: ["tradition_latin_christian_monasticism"] as TraditionId[],
    };
    expect(matchesTraditionFilters(personWithTradition, filters)).toBe(true);
  });

  it("fails when entity does not belong to the filtered tradition", () => {
    const filters = {
      ...defaultExplorerFilters,
      traditionIds: ["tradition_sufism"] as TraditionId[],
    };
    expect(matchesTraditionFilters(personNoTradition, filters)).toBe(false);
  });
});

describe("matchesTagFilters", () => {
  it("passes when no tag filter is set", () => {
    expect(matchesTagFilters([], defaultExplorerFilters)).toBe(true);
  });

  it("passes when entity has a matching tag", () => {
    const filters = {
      ...defaultExplorerFilters,
      tagIds: ["tag_mystic"] as TagId[],
    };
    expect(matchesTagFilters(["tag_mystic"] as TagId[], filters)).toBe(true);
  });

  it("fails when entity has no matching tag", () => {
    const filters = {
      ...defaultExplorerFilters,
      tagIds: ["tag_mystic"] as TagId[],
    };
    expect(matchesTagFilters(["tag_scientist"] as TagId[], filters)).toBe(false);
  });

  it("passes when entity has at least one matching tag among several", () => {
    const filters = {
      ...defaultExplorerFilters,
      tagIds: ["tag_mystic", "tag_theologian"] as TagId[],
    };
    expect(matchesTagFilters(["tag_scientist", "tag_mystic"] as TagId[], filters)).toBe(true);
  });
});

describe("matchesGeographyFilters", () => {
  const personFromBingen = makePerson("hildegard", {
    birthPlaceId: "place_bingen" as PlaceId,
  });
  const personNoPlace = makePerson("anonymous");

  it("passes when no geography filter is set", () => {
    expect(matchesGeographyFilters(personFromBingen, defaultExplorerFilters)).toBe(true);
  });

  it("passes when entity birth place matches the geography filter", () => {
    const filters = {
      ...defaultExplorerFilters,
      geographyPlaceIds: ["place_bingen"] as PlaceId[],
    };
    expect(matchesGeographyFilters(personFromBingen, filters)).toBe(true);
  });

  it("fails when entity has no matching place", () => {
    const filters = {
      ...defaultExplorerFilters,
      geographyPlaceIds: ["place_bingen"] as PlaceId[],
    };
    expect(matchesGeographyFilters(personNoPlace, filters)).toBe(false);
  });
});

describe("filterVisibleEdges", () => {
  const edgeAB = makeEdge({
    id: "edge_a_b" as EdgeId,
    sourceId: "person_a",
    targetId: "person_b",
    relationType: "influenced",
  });
  const edgeBC = makeEdge({
    id: "edge_b_c" as EdgeId,
    sourceId: "person_b",
    targetId: "person_c",
    relationType: "corresponded_with",
  });
  const edgeAC = makeEdge({
    id: "edge_a_c" as EdgeId,
    sourceId: "person_a",
    targetId: "person_c",
    relationType: "influenced",
    assertionLayer: "ai_hypothesis",
  });

  it("returns edges whose both endpoints are visible", () => {
    const visible = new Set(["person_a", "person_b", "person_c"]);
    const result = filterVisibleEdges([edgeAB, edgeBC], visible, defaultExplorerFilters);
    expect(result).toHaveLength(2);
  });

  it("excludes edges where source is not visible", () => {
    const visible = new Set(["person_b", "person_c"]);
    const result = filterVisibleEdges([edgeAB, edgeBC], visible, defaultExplorerFilters);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("edge_b_c");
  });

  it("excludes edges where target is not visible", () => {
    const visible = new Set(["person_a", "person_b"]);
    const result = filterVisibleEdges([edgeAB, edgeBC], visible, defaultExplorerFilters);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("edge_a_b");
  });

  it("excludes ai_hypothesis edges when showAiHypotheses is false", () => {
    const visible = new Set(["person_a", "person_b", "person_c"]);
    const filters = { ...defaultExplorerFilters, showAiHypotheses: false };
    const result = filterVisibleEdges([edgeAB, edgeAC], visible, filters);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("edge_a_b");
  });

  it("excludes edges not matching relation type filter", () => {
    const visible = new Set(["person_a", "person_b", "person_c"]);
    const filters = { ...defaultExplorerFilters, relationTypes: ["influenced" as const] };
    const result = filterVisibleEdges([edgeAB, edgeBC], visible, filters);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("edge_a_b");
  });

  it("returns empty array when no entities are visible", () => {
    const visible = new Set<string>();
    const result = filterVisibleEdges([edgeAB, edgeBC], visible, defaultExplorerFilters);
    expect(result).toHaveLength(0);
  });
});
