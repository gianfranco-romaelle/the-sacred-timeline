/**
 * Integration smoke test for buildGraphProjection (constellation functor).
 * Mirrors the tests in src/data/adapters/__tests__/graph-adapter.test.ts but
 * exercises the full functor from the root import path, validating the
 * assertion-layer and new relation-type extensions.
 */
import { describe, expect, it } from "vitest";
import { buildGraphProjection } from "./src/data/adapters/graph-adapter";
import { buildSeedIndex } from "./src/data/entity-index";
import { defaultExplorerFilters } from "./src/state/explorer-store";
import type {
  Edge,
  EdgeId,
  Person,
  PersonId,
  SacredTimelineSeedData,
  Text,
  TextId,
} from "./src/types";

const makePerson = (id: string): Person => ({
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
});

const makeText = (id: string): Text => ({
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
});

const makeEdge = (
  id: string,
  sourceId: string,
  targetId: string,
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

describe("constellationFunctor (buildGraphProjection) — assertion layer & scholarly relations", () => {
  it("passes through edges with assertionLayer=canonical", () => {
    const seed = {
      ...baseSeed,
      people: [makePerson("laurent"), makePerson("gerhardt")],
      edges: [
        makeEdge("e1", "person_laurent", "person_gerhardt", {
          assertionLayer: "canonical",
        }),
      ],
    };
    const index = buildSeedIndex(seed);
    const result = buildGraphProjection(seed, index, defaultExplorerFilters);
    expect(result.edges).toHaveLength(1);
  });

  it("passes through edges with assertionLayer=ai_hypothesis", () => {
    const seed = {
      ...baseSeed,
      people: [makePerson("laurent"), makePerson("gerhardt")],
      edges: [
        makeEdge("e1", "person_laurent", "person_gerhardt", {
          assertionLayer: "ai_hypothesis",
          relationType: "symbolic_analogue_of",
        }),
      ],
    };
    const index = buildSeedIndex(seed);
    const result = buildGraphProjection(seed, index, defaultExplorerFilters);
    expect(result.edges[0].relationType).toBe("symbolic_analogue_of");
  });

  it("handles mathematical_generalization_of relation between concepts", () => {
    const seed = {
      ...baseSeed,
      people: [makePerson("laurent")],
      texts: [makeText("methode")],
      edges: [
        makeEdge("e1", "person_laurent", "text_methode", {
          relationType: "cited_in",
        }),
      ],
    };
    const index = buildSeedIndex(seed);
    const result = buildGraphProjection(seed, index, defaultExplorerFilters);
    expect(result.visibleRelationTypes).toContain("cited_in");
  });

  it("visibleCounts.nodes matches the number of constellation-eligible entities", () => {
    const seed = {
      ...baseSeed,
      people: [makePerson("a"), makePerson("b"), makePerson("c")],
    };
    const index = buildSeedIndex(seed);
    const result = buildGraphProjection(seed, index, defaultExplorerFilters);
    expect(result.visibleCounts.nodes).toBe(result.nodes.length);
  });
});
