import { describe, expect, it } from "vitest";
import { buildGraphProjection } from "@/data/adapters/graph-adapter";
import { buildSeedIndex } from "@/data/entity-index";
import { defaultExplorerFilters } from "@/state/explorer-store";
import type {
  CanonicalEntityType,
  Concept,
  ConceptId,
  DomainDefinition,
  Edge,
  EdgeId,
  Event,
  EventId,
  Person,
  PersonId,
  RecordId,
  SacredTimelineSeedData,
  TagDefinition,
  Text,
  TextId,
  Tradition,
  TraditionId,
} from "@/types";

// ── Minimal entity factories ──────────────────────────────────────────────────

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

const makeText = (id: string, overrides: Partial<Text> = {}): Text => ({
  id: `text_${id}` as TextId,
  entityType: "text",
  slug: id,
  label: id,
  description: "",
  domainIds: [],
  tagIds: [],
  citationIds: [],
  relatedEntityIds: [],
  mediaAssetIds: [],
  textType: "treatise",
  authorIds: [],
  contributorIds: [],
  languageCodes: ["fr"],
  institutionIds: [],
  traditionIds: [],
  placeIds: [],
  conceptIds: [],
  ...overrides,
});

const makeConcept = (id: string, overrides: Partial<Concept> = {}): Concept => ({
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
  ...overrides,
});

const makeEvent = (id: string, overrides: Partial<Event> = {}): Event => ({
  id: `event_${id}` as EventId,
  entityType: "event",
  slug: id,
  label: id,
  description: "",
  domainIds: [],
  tagIds: [],
  citationIds: [],
  relatedEntityIds: [],
  mediaAssetIds: [],
  eventType: "discovery",
  participantIds: [],
  placeIds: [],
  institutionIds: [],
  textIds: [],
  conceptIds: [],
  ...overrides,
});

const makeTradition = (id: string, overrides: Partial<Tradition> = {}): Tradition => ({
  id: `tradition_${id}` as TraditionId,
  entityType: "tradition",
  slug: id,
  label: id,
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
  ...overrides,
});

const makeDomain = (id: string, overrides: Partial<DomainDefinition> = {}): DomainDefinition => ({
  id: `domain_${id}`,
  slug: id,
  label: id,
  description: "",
  kind: "science",
  ...overrides,
});

const makeTag = (id: string, overrides: Partial<TagDefinition> = {}): TagDefinition => ({
  id: `tag_${id}`,
  slug: id,
  label: id,
  description: "",
  category: "theme",
  domainIds: [],
  ...overrides,
});

const makeEdge = (
  id: string,
  sourceId: RecordId,
  targetId: RecordId,
  overrides: Partial<Edge> = {},
): Edge => ({
  id: `edge_${id}` as EdgeId,
  recordType: "edge",
  relationType: "influenced",
  label: `${sourceId} → ${targetId}`,
  description: "",
  sourceId,
  targetId,
  direction: "directed",
  domainIds: [],
  tagIds: [],
  citationIds: [],
  relatedEntityIds: [],
  mediaAssetIds: [],
  weight: 1,
  ...overrides,
});

const baseSeed: SacredTimelineSeedData = {
  meta: { datasetId: "test", title: "Test Seed", description: "", version: "0.0.1", generatedAt: "" },
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("buildGraphProjection", () => {
  it("returns empty projection for empty seed", () => {
    const index = buildSeedIndex(baseSeed);
    const result = buildGraphProjection(baseSeed, index, defaultExplorerFilters);
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
    expect(result.visibleCounts.nodes).toBe(0);
    expect(result.visibleCounts.edges).toBe(0);
  });

  it("includes persons, texts, and concepts as nodes", () => {
    const seed = {
      ...baseSeed,
      people: [makePerson("laurent")],
      texts: [makeText("methode")],
      concepts: [makeConcept("substitution")],
    };
    const index = buildSeedIndex(seed);
    const result = buildGraphProjection(seed, index, defaultExplorerFilters);
    expect(result.nodes).toHaveLength(3);
    const types = result.nodes.map((n) => n.entityType);
    expect(types).toContain("person");
    expect(types).toContain("text");
    expect(types).toContain("concept");
  });

  it("excludes events and traditions (non-constellation entity types)", () => {
    const seed = {
      ...baseSeed,
      people: [makePerson("laurent")],
      events: [makeEvent("discovery")],
      traditions: [makeTradition("organic_chemistry")],
    };
    const index = buildSeedIndex(seed);
    const result = buildGraphProjection(seed, index, defaultExplorerFilters);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].entityType).toBe("person");
  });

  it("marks the selected entity as isSelected=true", () => {
    const seed = {
      ...baseSeed,
      people: [makePerson("laurent"), makePerson("gerhardt")],
    };
    const index = buildSeedIndex(seed);
    const result = buildGraphProjection(
      seed,
      index,
      defaultExplorerFilters,
      "person_laurent" as PersonId,
    );
    const selected = result.nodes.find((n) => n.id === "person_laurent");
    const other = result.nodes.find((n) => n.id === "person_gerhardt");
    expect(selected?.isSelected).toBe(true);
    expect(other?.isSelected).toBe(false);
  });

  it("marks direct neighbors as isNeighbor=true", () => {
    const seed = {
      ...baseSeed,
      people: [makePerson("laurent"), makePerson("gerhardt"), makePerson("dumas")],
      edges: [makeEdge("e1", "person_laurent", "person_gerhardt")],
    };
    const index = buildSeedIndex(seed);
    const result = buildGraphProjection(
      seed,
      index,
      defaultExplorerFilters,
      "person_laurent" as PersonId,
    );
    const gerhardt = result.nodes.find((n) => n.id === "person_gerhardt");
    expect(gerhardt?.isNeighbor).toBe(true);
  });

  it("dims non-selected non-neighbor nodes when selection is active", () => {
    const seed = {
      ...baseSeed,
      people: [makePerson("laurent"), makePerson("gerhardt"), makePerson("dumas")],
      edges: [makeEdge("e1", "person_laurent", "person_gerhardt")],
    };
    const index = buildSeedIndex(seed);
    const result = buildGraphProjection(
      seed,
      index,
      defaultExplorerFilters,
      "person_laurent" as PersonId,
    );
    const dumas = result.nodes.find((n) => n.id === "person_dumas");
    expect(dumas?.isDimmed).toBe(true);
  });

  it("computes node degree from visible edges only", () => {
    const seed = {
      ...baseSeed,
      people: [makePerson("laurent"), makePerson("gerhardt"), makePerson("dumas")],
      edges: [
        makeEdge("e1", "person_laurent", "person_gerhardt"),
        makeEdge("e2", "person_laurent", "person_dumas"),
      ],
    };
    const index = buildSeedIndex(seed);
    const result = buildGraphProjection(seed, index, defaultExplorerFilters);
    const laurent = result.nodes.find((n) => n.id === "person_laurent");
    expect(laurent?.degree).toBe(2);
  });

  it("keeps degree calculation linear across denser visible graphs", () => {
    const people = Array.from({ length: 120 }, (_, index) => makePerson(`node_${index}`));
    const edges = people.slice(1).map((person, index) =>
      makeEdge(`dense_${index}`, "person_node_0" as PersonId, person.id),
    );
    const seed = {
      ...baseSeed,
      people,
      edges,
    };
    const index = buildSeedIndex(seed);
    const result = buildGraphProjection(seed, index, defaultExplorerFilters);
    const hub = result.nodes.find((n) => n.id === "person_node_0");

    expect(result.visibleCounts.nodes).toBe(120);
    expect(result.visibleCounts.edges).toBe(119);
    expect(hub?.degree).toBe(119);
  });

  it("filters nodes by entityTypes when that filter is active", () => {
    const seed = {
      ...baseSeed,
      people: [makePerson("laurent")],
      texts: [makeText("methode")],
    };
    const index = buildSeedIndex(seed);
    const filters = {
      ...defaultExplorerFilters,
      entityTypes: ["person"] as CanonicalEntityType[],
    };
    const result = buildGraphProjection(seed, index, filters);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].entityType).toBe("person");
  });

  it("excludes edges where either endpoint is filtered out", () => {
    const seed = {
      ...baseSeed,
      people: [makePerson("laurent")],
      texts: [makeText("methode")],
      edges: [makeEdge("e1", "person_laurent", "text_methode")],
    };
    const index = buildSeedIndex(seed);
    const filters = {
      ...defaultExplorerFilters,
      entityTypes: ["person"] as CanonicalEntityType[],
    };
    const result = buildGraphProjection(seed, index, filters);
    expect(result.edges).toHaveLength(0);
  });

  it("exposes visibleRelationTypes from the edge set", () => {
    const seed = {
      ...baseSeed,
      people: [makePerson("laurent"), makePerson("gerhardt")],
      edges: [
        makeEdge("e1", "person_laurent", "person_gerhardt", { relationType: "influenced" }),
        makeEdge("e2", "person_gerhardt", "person_laurent", { relationType: "corresponded_with" }),
      ],
    };
    const index = buildSeedIndex(seed);
    const result = buildGraphProjection(seed, index, defaultExplorerFilters);
    expect(result.visibleRelationTypes).toContain("influenced");
    expect(result.visibleRelationTypes).toContain("corresponded_with");
  });

  it("counts selectedNeighborCount correctly", () => {
    const seed = {
      ...baseSeed,
      people: [makePerson("laurent"), makePerson("gerhardt"), makePerson("dumas")],
      edges: [
        makeEdge("e1", "person_laurent", "person_gerhardt"),
        makeEdge("e2", "person_laurent", "person_dumas"),
      ],
    };
    const index = buildSeedIndex(seed);
    const result = buildGraphProjection(
      seed,
      index,
      defaultExplorerFilters,
      "person_laurent" as PersonId,
    );
    expect(result.visibleCounts.selectedNeighborCount).toBe(2);
  });

  it("builds ontology clusters from schools and keeps semantic edges projection-only", () => {
    const school = makeTradition("buffalo_school", { label: "Buffalo School" });
    const seed = {
      ...baseSeed,
      people: [
        makePerson("lawvere", { traditionIds: [school.id] }),
        makePerson("tierney", { traditionIds: [school.id] }),
      ],
      traditions: [school],
      edges: [],
    };
    const index = buildSeedIndex(seed);
    const result = buildGraphProjection(seed, index, defaultExplorerFilters);

    const schoolCluster = result.clusters.find((cluster) => cluster.kind === "school");
    expect(schoolCluster?.label).toBe("Buffalo School");
    expect(schoolCluster?.nodeIds).toEqual(
      expect.arrayContaining(["person_lawvere", "person_tierney"]),
    );
    expect(result.edges.some((edge) => edge.isSemantic)).toBe(true);
    expect(seed.edges).toHaveLength(0);
  });

  it("adds math, scientific, and cognitive tag regions without Gemini metadata", () => {
    const mathTag = makeTag("genesis_math_topos", { label: "Topos", category: "method" });
    const scienceTag = makeTag("genesis_scientific_category_theory", {
      label: "Category Theory",
      category: "discipline",
    });
    const cognitiveTag = makeTag("genesis_cognitive_structure", {
      label: "Structure",
      category: "theme",
    });
    const seed = {
      ...baseSeed,
      tags: [mathTag, scienceTag, cognitiveTag],
      concepts: [
        makeConcept("topos", {
          tagIds: [mathTag.id, scienceTag.id, cognitiveTag.id],
        }),
      ],
    };
    const index = buildSeedIndex(seed);
    const result = buildGraphProjection(seed, index, defaultExplorerFilters);
    const kinds = result.clusters.map((cluster) => cluster.kind);

    expect(kinds).toEqual(expect.arrayContaining(["math_tag", "scientific_domain", "cognitive_tag"]));
    expect(result.nodes[0].clusterIds.length).toBeGreaterThanOrEqual(4);
  });

  it("uses Gemini-shaped embedding metadata as optional story layer, not the only cluster source", () => {
    const school = makeTradition("grothendieck_school", { label: "Grothendieck School" });
    const mathTag = makeTag("genesis_math_sheaf", { label: "Sheaf", category: "method" });
    const seed = {
      ...baseSeed,
      tags: [mathTag],
      traditions: [school],
      people: [
        makePerson("grothendieck", {
          tagIds: [mathTag.id],
          traditionIds: [school.id],
          metadata: {
            embeddingCluster: "Algebraic Geometry Foundations",
            centralityScore: 0.99,
            sourceFiles: [8, 29],
          },
        }),
      ],
    };
    const index = buildSeedIndex(seed);
    const result = buildGraphProjection(seed, index, defaultExplorerFilters);
    const node = result.nodes[0];

    expect(result.clusters.map((cluster) => cluster.kind)).toEqual(
      expect.arrayContaining(["embedding_cluster", "school", "math_tag"]),
    );
    expect(node.primaryClusterId).toContain("embedding_cluster");
    expect(node.semanticCentrality).toBe(0.99);
    expect(node.storyLayerIds.length).toBeGreaterThan(0);
  });
});
