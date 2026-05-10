import { describe, expect, it } from "vitest";
import {
  buildFocusContext,
  getContextLabel,
  getContextReasonForEntity,
  getContextReasonForPlace,
} from "@/data/focus-context";
import { buildSeedIndex } from "@/data/entity-index";
import { defaultExplorerFilters } from "@/state/explorer-store";
import type {
  Edge,
  EdgeId,
  HistoricalDateRange,
  Person,
  PersonId,
  PlaceId,
  RecordId,
  SacredTimelineSeedData,
  TraditionId,
} from "@/types";

const makeInstant = (year: number): HistoricalDateRange => ({
  kind: "instant",
  start: { date: { year, precision: "year" } },
  sortStartYear: year,
  displayLabel: `${year}`,
});

const makePerson = (id: string, year?: number, overrides: Partial<Person> = {}): Person => ({
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
  ...overrides,
});

const makeEdge = (id: string, sourceId: string, targetId: string): Edge => ({
  id: id as EdgeId,
  recordType: "edge",
  relationType: "influenced",
  label: id,
  description: "",
  sourceId: sourceId as RecordId,
  targetId: targetId as RecordId,
  direction: "directed",
  domainIds: [],
  tagIds: [],
  citationIds: [],
  relatedEntityIds: [],
  mediaAssetIds: [],
  weight: 1,
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

describe("buildFocusContext", () => {
  it("returns no-context when selectedEntityId is undefined", () => {
    const seed = baseSeed;
    const index = buildSeedIndex(seed);
    const ctx = buildFocusContext(seed, index, defaultExplorerFilters, undefined);
    expect(ctx.hasContext).toBe(false);
    expect(ctx.selectedEntityId).toBeUndefined();
  });

  it("returns no-context when selectedEntityId is not in index", () => {
    const seed = baseSeed;
    const index = buildSeedIndex(seed);
    const ctx = buildFocusContext(seed, index, defaultExplorerFilters, "person_missing" as any);
    expect(ctx.hasContext).toBe(false);
  });

  it("returns context with selectedEntity when entity exists", () => {
    const person = makePerson("a", 1000);
    const seed = { ...baseSeed, people: [person] };
    const index = buildSeedIndex(seed);
    const ctx = buildFocusContext(seed, index, defaultExplorerFilters, "person_a" as any);
    expect(ctx.hasContext).toBe(true);
    expect(ctx.selectedEntity).toBe(person);
    expect(ctx.timeAnchorYear).toBe(1000);
  });

  it("includes visible neighbors in neighborIds", () => {
    const a = makePerson("a", 1000);
    const b = makePerson("b", 1050);
    const edge = makeEdge("edge_a_b", "person_a", "person_b");
    const seed = { ...baseSeed, people: [a, b], edges: [edge] };
    const index = buildSeedIndex(seed);
    const ctx = buildFocusContext(seed, index, defaultExplorerFilters, "person_a" as any);
    expect(ctx.neighborIds).toContain("person_b");
  });

  it("accumulates tradition ids from selected entity and neighbors", () => {
    const trad = "tradition_mysticism" as TraditionId;
    const a = makePerson("a", 1000, { traditionIds: [trad] });
    const seed = { ...baseSeed, people: [a] };
    const index = buildSeedIndex(seed);
    const ctx = buildFocusContext(seed, index, defaultExplorerFilters, "person_a" as any);
    expect(ctx.relatedTraditionIds).toContain(trad);
  });
});

describe("getContextReasonForEntity", () => {
  const selected = makePerson("selected", 1000);
  const neighbor = makePerson("neighbor", 1050);
  const sameEra = makePerson("same_era", 1080);
  const farAway = makePerson("far", 1700);
  const sharedTrad = makePerson("trad", 500, {
    traditionIds: ["tradition_sufism"] as TraditionId[],
  });
  const sharedDomain = makePerson("domain", 500, {
    domainIds: ["domain_philosophy"] as any,
  });
  const unrelated = makePerson("unrelated", 500);

  const edge = makeEdge("edge_sel_nb", "person_selected", "person_neighbor");
  const seed = { ...baseSeed, people: [selected, neighbor, sameEra, farAway, sharedTrad, sharedDomain, unrelated], edges: [edge] };
  const index = buildSeedIndex(seed);
  const ctx = buildFocusContext(seed, index, defaultExplorerFilters, "person_selected" as any);

  it("returns undefined when no context exists", () => {
    const emptyCtx = buildFocusContext(baseSeed, buildSeedIndex(baseSeed), defaultExplorerFilters, undefined);
    expect(getContextReasonForEntity(unrelated, emptyCtx)).toBeUndefined();
  });

  it("returns 'selected' for the selected entity", () => {
    expect(getContextReasonForEntity(selected, ctx)).toBe("selected");
  });

  it("returns 'neighbor' for a direct neighbor", () => {
    expect(getContextReasonForEntity(neighbor, ctx)).toBe("neighbor");
  });

  it("returns 'same-era' when |year diff| <= 120", () => {
    expect(getContextReasonForEntity(sameEra, ctx)).toBe("same-era");
  });

  it("returns undefined (not same-era) when |year diff| > 120", () => {
    const reason = getContextReasonForEntity(farAway, ctx);
    expect(reason).not.toBe("same-era");
  });

  it("boundary: |diff| = 120 is same-era", () => {
    const exactly120 = makePerson("exact", 1120);
    expect(getContextReasonForEntity(exactly120, ctx)).toBe("same-era");
  });

  it("boundary: |diff| = 121 is not same-era", () => {
    const just121 = makePerson("just121", 1121);
    const reason = getContextReasonForEntity(just121, ctx);
    expect(reason).not.toBe("same-era");
  });

  it("returns 'shared-tradition' when tradition intersects context", () => {
    const trad = "tradition_mysticism" as TraditionId;
    const selWithTrad = makePerson("sel2", 1000, { traditionIds: [trad] });
    const withSameTrad = makePerson("trad2", 500, { traditionIds: [trad] });
    const seed2 = { ...baseSeed, people: [selWithTrad, withSameTrad] };
    const index2 = buildSeedIndex(seed2);
    const ctx2 = buildFocusContext(seed2, index2, defaultExplorerFilters, "person_sel2" as any);
    expect(getContextReasonForEntity(withSameTrad, ctx2)).toBe("shared-tradition");
  });

  it("returns 'shared-domain' when domain intersects context", () => {
    const domId = "domain_philosophy" as any;
    const selWithDomain = makePerson("sel3", 1000, { domainIds: [domId] });
    const withSameDomain = makePerson("dom2", 500, { domainIds: [domId] });
    const seed3 = { ...baseSeed, people: [selWithDomain, withSameDomain] };
    const index3 = buildSeedIndex(seed3);
    const ctx3 = buildFocusContext(seed3, index3, defaultExplorerFilters, "person_sel3" as any);
    expect(getContextReasonForEntity(withSameDomain, ctx3)).toBe("shared-domain");
  });

  it("returns undefined for unrelated entity far in time", () => {
    expect(getContextReasonForEntity(unrelated, ctx)).toBeUndefined();
  });
});

describe("getContextReasonForPlace", () => {
  it("returns undefined when no context", () => {
    const emptyCtx = buildFocusContext(baseSeed, buildSeedIndex(baseSeed), defaultExplorerFilters, undefined);
    expect(getContextReasonForPlace("place_bingen" as PlaceId, emptyCtx)).toBeUndefined();
  });

  it("returns 'related-place' when place is in relatedPlaceIds", () => {
    const person = makePerson("p", 1000, { birthPlaceId: "place_bingen" as PlaceId });
    const seed = { ...baseSeed, people: [person] };
    const index = buildSeedIndex(seed);
    const ctx = buildFocusContext(seed, index, defaultExplorerFilters, "person_p" as any);
    expect(getContextReasonForPlace("place_bingen" as PlaceId, ctx)).toBe("related-place");
  });

  it("returns undefined for unrelated place", () => {
    const person = makePerson("p", 1000);
    const seed = { ...baseSeed, people: [person] };
    const index = buildSeedIndex(seed);
    const ctx = buildFocusContext(seed, index, defaultExplorerFilters, "person_p" as any);
    expect(getContextReasonForPlace("place_bingen" as PlaceId, ctx)).toBeUndefined();
  });
});

describe("getContextLabel", () => {
  it("returns undefined for undefined sourceView", () => {
    expect(getContextLabel(undefined)).toBeUndefined();
  });

  it("returns River of Time for river view", () => {
    expect(getContextLabel("river")).toBe("River of Time");
  });

  it("returns Constellation for constellation view", () => {
    expect(getContextLabel("constellation")).toBe("Constellation");
  });

  it("returns Atlas for atlas view", () => {
    expect(getContextLabel("atlas")).toBe("Atlas");
  });

  it("returns Face Atlas for face-atlas view", () => {
    expect(getContextLabel("face-atlas")).toBe("Face Atlas");
  });

  it("returns Scriptorium for scriptorium view", () => {
    expect(getContextLabel("scriptorium")).toBe("Scriptorium");
  });
});
