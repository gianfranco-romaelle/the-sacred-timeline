import { describe, expect, it } from "vitest";
import { buildFaceAtlasProjection } from "@/data/adapters/face-atlas-adapter";
import { buildSeedIndex } from "@/data/entity-index";
import { defaultExplorerFilters } from "@/state/explorer-store";
import type {
  Person,
  PersonId,
  PortraitAsset,
  PortraitAssetId,
  SacredTimelineSeedData,
} from "@/types";

const makePerson = (id: string, year?: number): Person => ({
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

const makePortrait = (id: string, entityId: PersonId, isPrimary = false): PortraitAsset => ({
  id: `portrait_${id}` as PortraitAssetId,
  assetType: "portrait",
  slug: id,
  label: id,
  description: "",
  domainIds: [],
  tagIds: [],
  citationIds: [],
  relatedEntityIds: [],
  mediaAssetIds: [],
  altText: id,
  file: { src: `/${id}.jpg`, mimeType: "image/jpeg" },
  depictedEntityIds: [entityId],
  depictionType: "painting",
  isPrimaryPortrait: isPrimary,
});

const baseSeed: SacredTimelineSeedData = {
  meta: { datasetId: "test", title: "T", description: "", version: "0", generatedAt: "" },
  domains: [
    {
      id: "domain_science" as never,
      slug: "science",
      label: "Science",
      description: "",
      kind: "science",
      colorToken: "science",
    },
    {
      id: "domain_religion" as never,
      slug: "religion",
      label: "Religion",
      description: "",
      kind: "religion",
      colorToken: "religion",
    },
  ],
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

describe("buildFaceAtlasProjection", () => {
  it("returns empty items and groups for seed with no portrait assets", () => {
    const person = makePerson("al_haytham");
    const seed = { ...baseSeed, people: [person] };
    const index = buildSeedIndex(seed);
    const result = buildFaceAtlasProjection(seed, index, defaultExplorerFilters, undefined, undefined, "era", "chronological");
    expect(result.items).toHaveLength(0);
    expect(result.groups).toHaveLength(0);
  });

  it("creates one item per portrait asset, not per entity", () => {
    const person = makePerson("al_haytham");
    const portrait1 = makePortrait("p1", person.id, true);
    const portrait2 = makePortrait("p2", person.id, false);
    const seed = { ...baseSeed, people: [person], portraitAssets: [portrait1, portrait2] };
    const index = buildSeedIndex(seed);
    const result = buildFaceAtlasProjection(seed, index, defaultExplorerFilters, undefined, undefined, "era", "chronological");
    expect(result.items).toHaveLength(2);
    expect(result.visibleCounts.entities).toBe(1);
    expect(result.visibleCounts.portraits).toBe(2);
  });

  it("excludes portraits for entities not in visibleEntities (filtered out)", () => {
    const person = makePerson("al_haytham");
    const portrait = makePortrait("p1", person.id, true);
    const seed = { ...baseSeed, people: [person], portraitAssets: [portrait] };
    const index = buildSeedIndex(seed);
    const filters = { ...defaultExplorerFilters, entityTypes: ["text" as never] };
    const result = buildFaceAtlasProjection(seed, index, filters, undefined, undefined, "era", "chronological");
    expect(result.items).toHaveLength(0);
  });

  it("groups items by era when grouping=era", () => {
    const p1 = makePerson("ancient", 300);
    const p2 = makePerson("modern", 1850);
    const portrait1 = makePortrait("pa", p1.id, true);
    const portrait2 = makePortrait("pm", p2.id, true);
    const seed = {
      ...baseSeed,
      people: [p1, p2],
      portraitAssets: [portrait1, portrait2],
    };
    const index = buildSeedIndex(seed);
    const result = buildFaceAtlasProjection(seed, index, defaultExplorerFilters, undefined, undefined, "era", "chronological");
    expect(result.groups.length).toBeGreaterThanOrEqual(2);
    const groupKeys = result.groups.map((g) => g.key);
    expect(new Set(groupKeys).size).toBe(groupKeys.length);
  });

  it("sort=label produces alphabetical order within a group", () => {
    // Both in ancient era (before 500 CE)
    const pZ = makePerson("zeno", 300);
    const pA = makePerson("aristotle", 350);
    const pZ_portrait = makePortrait("pz", pZ.id, true);
    const pA_portrait = makePortrait("pa", pA.id, true);
    const seed = {
      ...baseSeed,
      people: [pZ, pA],
      portraitAssets: [pZ_portrait, pA_portrait],
    };
    const index = buildSeedIndex(seed);
    const result = buildFaceAtlasProjection(seed, index, defaultExplorerFilters, undefined, undefined, "era", "label");
    // Both in the same era group (ancient)
    expect(result.groups).toHaveLength(1);
    const groupLabels = result.groups[0].items.map((item) => item.label);
    expect(groupLabels).toEqual([...groupLabels].sort((a, b) => a.localeCompare(b)));
  });

  it("sort=chronological orders items within a group by primaryYear ascending", () => {
    // Both in medieval era (500–1499 CE)
    const pLate = makePerson("late_person", 1400);
    const pEarly = makePerson("early_person", 600);
    const pLate_portrait = makePortrait("pl", pLate.id, true);
    const pEarly_portrait = makePortrait("pe", pEarly.id, true);
    const seed = {
      ...baseSeed,
      people: [pLate, pEarly],
      portraitAssets: [pLate_portrait, pEarly_portrait],
    };
    const index = buildSeedIndex(seed);
    const result = buildFaceAtlasProjection(seed, index, defaultExplorerFilters, undefined, undefined, "era", "chronological");
    // Both in the same era group (medieval)
    expect(result.groups).toHaveLength(1);
    const years = result.groups[0].items.map(
      (item) => item.primaryYear ?? Number.POSITIVE_INFINITY,
    );
    for (let i = 1; i < years.length; i++) {
      expect(years[i]).toBeGreaterThanOrEqual(years[i - 1]);
    }
  });

  it("marks the selected entity's item as isSelected=true", () => {
    const person = makePerson("al_haytham");
    const portrait = makePortrait("p1", person.id, true);
    const seed = { ...baseSeed, people: [person], portraitAssets: [portrait] };
    const index = buildSeedIndex(seed);
    const result = buildFaceAtlasProjection(seed, index, defaultExplorerFilters, person.id, undefined, "era", "chronological");
    expect(result.items[0].isSelected).toBe(true);
  });

  it("groups.visibleCounts.groups matches groups array length", () => {
    const person = makePerson("al_haytham", 1000);
    const portrait = makePortrait("p1", person.id, true);
    const seed = { ...baseSeed, people: [person], portraitAssets: [portrait] };
    const index = buildSeedIndex(seed);
    const result = buildFaceAtlasProjection(seed, index, defaultExplorerFilters, undefined, undefined, "era", "chronological");
    expect(result.visibleCounts.groups).toBe(result.groups.length);
  });
});
