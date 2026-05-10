import type { Edge, EdgeRelationType, KnowledgeEntityId } from "@/types";
import type { SeedIndex } from "./entity-index";

export interface EntityNeighborhood {
  selectedEntityId?: KnowledgeEntityId;
  outgoingEdges: Edge[];
  incomingEdges: Edge[];
  allEdges: Edge[];
  neighborIds: KnowledgeEntityId[];
}

export const expandRelationsForEntity = (
  entityId: KnowledgeEntityId | undefined,
  index: SeedIndex,
  relationTypes: EdgeRelationType[] = [],
) => {
  if (!entityId) return [];

  return (index.edgesByEntityId.get(entityId) ?? []).filter(
    (edge) => relationTypes.length === 0 || relationTypes.includes(edge.relationType),
  );
};

export const deriveEntityNeighborhood = (
  entityId: KnowledgeEntityId | undefined,
  index: SeedIndex,
  relationTypes: EdgeRelationType[] = [],
): EntityNeighborhood => {
  if (!entityId) {
    return {
      selectedEntityId: undefined,
      outgoingEdges: [],
      incomingEdges: [],
      allEdges: [],
      neighborIds: [],
    };
  }

  const allEdges = expandRelationsForEntity(entityId, index, relationTypes);
  const outgoingEdges = allEdges.filter((edge) => edge.sourceId === entityId);
  const incomingEdges = allEdges.filter((edge) => edge.targetId === entityId);
  const neighborIds = Array.from(
    new Set(
      allEdges
        .flatMap((edge) => [edge.sourceId, edge.targetId])
        .filter((id): id is KnowledgeEntityId => id !== entityId && index.entitiesById.has(id as KnowledgeEntityId)),
    ),
  );

  return {
    selectedEntityId: entityId,
    outgoingEdges,
    incomingEdges,
    allEdges,
    neighborIds,
  };
};
