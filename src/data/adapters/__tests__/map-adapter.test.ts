import { describe, expect, it } from "vitest";
import { buildMapProjection } from "@/data/adapters/map-adapter";
import { buildSeedIndex } from "@/data/entity-index";
import { defaultExplorerFilters } from "@/state/explorer-store";
import type {
  Person,
  PersonId,
  Place,
  PlaceId,
  SacredTimelineSeedData,
} from "@/types";

const makePlace = (id: string, lat: number, lon: number): Place => ({
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
  geometry: { point: { latitude: lat, longitude: lon } },
});

const makePerson = (id: string, placeId?: PlaceId): Person => ({
  id: `person_${id}` as PersonId,
  entityType: "person",
  slug: id,
  label: id,
  description: "",
  domainIds: ["domain_science" as never],
  tagIds: [],
  citationIds: [],
  relatedEntityIds: [],
  mediaAssetIds: [],
  roles: ["scientist"],
  institutionIds: [],
  traditionIds: [],
  textIds: [],
  ...(placeId ? { birthPlaceId: placeId } : {}),
});

const makeDatedPerson = (id: string, year: number, placeId?: PlaceId): Person => ({
  ...makePerson(id, placeId),
  dateRange: {
    kind: "instant",
    start: { date: { year, precision: "year" } },
    sortStartYear: year,
    displayLabel: String(year),
  },
});

const baseSeed: SacredTimelineSeedData = {
  meta: { datasetId: "test", title: "T", description: "", version: "0", generatedAt: "" },
  domains: [{ id: "domain_science" as never, slug: "science", label: "Science", description: "", kind: "science", colorToken: "science" }],
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

describe("buildMapProjection", () => {
  it("returns empty points, hubs, and connections for empty seed", () => {
    const index = buildSeedIndex(baseSeed);
    const result = buildMapProjection(baseSeed, index, defaultExplorerFilters);
    expect(result.points).toHaveLength(0);
    expect(result.hubs).toHaveLength(0);
    expect(result.connections).toHaveLength(0);
  });

  it("excludes entities with no associated place from points", () => {
    const person = makePerson("unplaced");
    const seed = { ...baseSeed, people: [person] };
    const index = buildSeedIndex(seed);
    const result = buildMapProjection(seed, index, defaultExplorerFilters);
    expect(result.points).toHaveLength(0);
  });

  it("creates a point for a person entity with a birthPlace that has coordinates", () => {
    const place = makePlace("cairo", 30.0, 31.2);
    const person = makePerson("al_haytham", place.id);
    const seed = { ...baseSeed, places: [place], people: [person] };
    const index = buildSeedIndex(seed);
    const result = buildMapProjection(seed, index, defaultExplorerFilters);
    // place entity itself + person entity = 2 points at cairo
    const personPoint = result.points.find((p) => p.entityId === person.id);
    expect(personPoint).toBeDefined();
    expect(personPoint?.latitude).toBe(30.0);
    expect(personPoint?.longitude).toBe(31.2);
  });

  it("creates one hub per distinct place", () => {
    const placeA = makePlace("cairo", 30.0, 31.2);
    const placeB = makePlace("rome", 41.9, 12.5);
    const p1 = makePerson("a", placeA.id);
    const p2 = makePerson("b", placeB.id);
    const seed = { ...baseSeed, places: [placeA, placeB], people: [p1, p2] };
    const index = buildSeedIndex(seed);
    const result = buildMapProjection(seed, index, defaultExplorerFilters);
    expect(result.hubs).toHaveLength(2);
  });

  it("jitters display coordinates when multiple entities share a place", () => {
    const place = makePlace("cairo", 30.0, 31.2);
    const p1 = makePerson("a", place.id);
    const p2 = makePerson("b", place.id);
    const seed = { ...baseSeed, places: [place], people: [p1, p2] };
    const index = buildSeedIndex(seed);
    const result = buildMapProjection(seed, index, defaultExplorerFilters);
    // place entity + 2 persons = 3 entities all at same location
    expect(result.points).toHaveLength(3);
    // At least one point should be jittered (non-trivial when total > 1)
    const hasJitter = result.points.some(
      (pt) => pt.displayLatitude !== pt.latitude || pt.displayLongitude !== pt.longitude,
    );
    expect(hasJitter).toBe(true);
  });

  it("creates a connection for an edge between entities at different places", () => {
    const placeA = makePlace("cairo", 30.0, 31.2);
    const placeB = makePlace("rome", 41.9, 12.5);
    const p1 = makePerson("al_haytham", placeA.id);
    const p2 = makePerson("galileo", placeB.id);
    const seed = {
      ...baseSeed,
      places: [placeA, placeB],
      people: [p1, p2],
      edges: [
        {
          id: "edge_test" as never,
          recordType: "edge" as const,
          relationType: "influenced" as const,
          label: "influenced",
          description: "",
          sourceId: p1.id,
          targetId: p2.id,
          direction: "directed" as const,
          domainIds: [],
          tagIds: [],
          citationIds: [],
          relatedEntityIds: [],
          mediaAssetIds: [],
        },
      ],
    };
    const index = buildSeedIndex(seed);
    const result = buildMapProjection(seed, index, defaultExplorerFilters);
    expect(result.connections).toHaveLength(1);
    expect(result.connections[0].relationType).toBe("influenced");
  });

  it("accumulates same-place edges into hub.relationCount instead of connections", () => {
    const place = makePlace("cairo", 30.0, 31.2);
    const p1 = makePerson("a", place.id);
    const p2 = makePerson("b", place.id);
    const seed = {
      ...baseSeed,
      places: [place],
      people: [p1, p2],
      edges: [
        {
          id: "edge_local" as never,
          recordType: "edge" as const,
          relationType: "influenced" as const,
          label: "influenced",
          description: "",
          sourceId: p1.id,
          targetId: p2.id,
          direction: "directed" as const,
          domainIds: [],
          tagIds: [],
          citationIds: [],
          relatedEntityIds: [],
          mediaAssetIds: [],
        },
      ],
    };
    const index = buildSeedIndex(seed);
    const result = buildMapProjection(seed, index, defaultExplorerFilters);
    expect(result.connections).toHaveLength(0);
    expect(result.hubs[0].relationCount).toBe(1);
  });

  it("visibleCounts match output arrays", () => {
    const place = makePlace("cairo", 30.0, 31.2);
    const person = makePerson("al_haytham", place.id);
    const seed = { ...baseSeed, places: [place], people: [person] };
    const index = buildSeedIndex(seed);
    const result = buildMapProjection(seed, index, defaultExplorerFilters);
    expect(result.visibleCounts.points).toBe(result.points.length);
    expect(result.visibleCounts.connections).toBe(result.connections.length);
    expect(result.visibleCounts.places).toBe(result.hubs.length);
  });

  it("marks the selected entity point as isSelected=true", () => {
    const place = makePlace("cairo", 30.0, 31.2);
    const person = makePerson("al_haytham", place.id);
    const seed = { ...baseSeed, places: [place], people: [person] };
    const index = buildSeedIndex(seed);
    const result = buildMapProjection(seed, index, defaultExplorerFilters, person.id);
    expect(result.points[0].isSelected).toBe(true);
  });

  it("exposes point years for atlas time controls", () => {
    const place = makePlace("cairo", 30.0, 31.2);
    const person = makeDatedPerson("al_haytham", 1011, place.id);
    const seed = { ...baseSeed, places: [place], people: [person] };
    const index = buildSeedIndex(seed);
    const result = buildMapProjection(seed, index, defaultExplorerFilters);
    expect(result.points.find((point) => point.entityId === person.id)?.year).toBe(1011);
  });
});
