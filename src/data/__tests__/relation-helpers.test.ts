import { describe, expect, it } from "vitest";
import {
  deriveEntityNeighborhood,
  expandRelationsForEntity,
} from "@/data/relation-helpers";
import { buildSeedIndex } from "@/data/entity-index";
import type {
  Edge,
  EdgeId,
  KnowledgeEntityId,
  Person,
  PersonId,
  RecordId,
  SacredTimelineSeedData,
} from "@/types";

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
  roles: [],
  institutionIds: [],
  traditionIds: [],
  textIds: [],
});

const makeEdge = (id: string, sourceId: string, targetId: string, overrides: Partial<Edge> = {}): Edge => ({
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

describe("expandRelationsForEntity", () => {
  const personA = makePerson("a");
  const personB = makePerson("b");
  const personC = makePerson("c");

  const edgeAB = makeEdge("edge_a_b", "person_a", "person_b", { relationType: "influenced" });
  const edgeBA = makeEdge("edge_b_a", "person_b", "person_a", { relationType: "corresponded_with" });
  const edgeBC = makeEdge("edge_b_c", "person_b", "person_c", { relationType: "influenced" });

  const seed = { ...baseSeed, people: [personA, personB, personC], edges: [edgeAB, edgeBA, edgeBC] };
  const index = buildSeedIndex(seed);

  it("returns empty array for undefined entityId", () => {
    expect(expandRelationsForEntity(undefined, index)).toEqual([]);
  });

  it("returns all edges for an entity when no relation type filter", () => {
    const edges = expandRelationsForEntity("person_a" as KnowledgeEntityId, index);
    expect(edges).toHaveLength(2);
  });

  it("filters by relation type when specified", () => {
    const edges = expandRelationsForEntity("person_a" as KnowledgeEntityId, index, ["influenced"]);
    expect(edges).toHaveLength(1);
    expect(edges[0].id).toBe("edge_a_b");
  });

  it("returns empty array for entity with no edges", () => {
    const edges = expandRelationsForEntity("person_c" as KnowledgeEntityId, index);
    expect(edges).toHaveLength(1);
  });
});

describe("deriveEntityNeighborhood", () => {
  const personA = makePerson("a");
  const personB = makePerson("b");
  const personC = makePerson("c");

  const edgeAB = makeEdge("edge_a_b", "person_a", "person_b", { relationType: "influenced" });
  const edgeCA = makeEdge("edge_c_a", "person_c", "person_a", { relationType: "corresponded_with" });

  const seed = { ...baseSeed, people: [personA, personB, personC], edges: [edgeAB, edgeCA] };
  const index = buildSeedIndex(seed);

  it("returns empty neighborhood for undefined entityId", () => {
    const n = deriveEntityNeighborhood(undefined, index);
    expect(n.selectedEntityId).toBeUndefined();
    expect(n.allEdges).toHaveLength(0);
    expect(n.neighborIds).toHaveLength(0);
  });

  it("returns correct outgoing and incoming edges", () => {
    const n = deriveEntityNeighborhood("person_a" as KnowledgeEntityId, index);
    expect(n.outgoingEdges.map((e) => e.id)).toEqual(["edge_a_b"]);
    expect(n.incomingEdges.map((e) => e.id)).toEqual(["edge_c_a"]);
  });

  it("allEdges contains both outgoing and incoming", () => {
    const n = deriveEntityNeighborhood("person_a" as KnowledgeEntityId, index);
    expect(n.allEdges).toHaveLength(2);
  });

  it("neighborIds contains both source and target but not the entity itself", () => {
    const n = deriveEntityNeighborhood("person_a" as KnowledgeEntityId, index);
    expect(n.neighborIds.sort()).toEqual(["person_b", "person_c"]);
  });

  it("neighborIds are deduplicated", () => {
    const edgeAB2 = makeEdge("edge_a_b_2", "person_a", "person_b", { relationType: "corresponded_with" });
    const seed2 = { ...baseSeed, people: [personA, personB], edges: [edgeAB, edgeAB2] };
    const index2 = buildSeedIndex(seed2);
    const n = deriveEntityNeighborhood("person_a" as KnowledgeEntityId, index2);
    expect(n.neighborIds).toHaveLength(1);
    expect(n.neighborIds[0]).toBe("person_b");
  });

  it("filters by relation type when specified", () => {
    const n = deriveEntityNeighborhood("person_a" as KnowledgeEntityId, index, ["influenced"]);
    expect(n.allEdges).toHaveLength(1);
    expect(n.allEdges[0].id).toBe("edge_a_b");
  });

  it("does not include neighbors that are not in the index", () => {
    const edgeAX = makeEdge("edge_a_x", "person_a", "person_unknown");
    const seed3 = { ...baseSeed, people: [personA, personB], edges: [edgeAB, edgeAX] };
    const index3 = buildSeedIndex(seed3);
    const n = deriveEntityNeighborhood("person_a" as KnowledgeEntityId, index3);
    expect(n.neighborIds).toEqual(["person_b"]);
  });
});
