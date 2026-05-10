import type { ExplorerFilters } from "@/state/explorer-store";
import { getEntityEditorialStageCoverage } from "@/editorial/stage-lens";
import type {
  Edge,
  HistoricalDateRange,
  KnowledgeEntity,
  PlaceId,
  SacredTimelineSeedData,
  TagId,
  TraditionId,
} from "@/types";
import { getPrimaryYearFromDateRange } from "./time-grouping";

export const getEntityTraditionIds = (entity: KnowledgeEntity): TraditionId[] => {
  if (
    entity.entityType === "person" ||
    entity.entityType === "text" ||
    entity.entityType === "concept" ||
    entity.entityType === "institution"
  ) {
    return entity.traditionIds;
  }

  return [];
};

export const getEntityPlaceIds = (entity: KnowledgeEntity): PlaceId[] => {
  switch (entity.entityType) {
    case "person":
      return [entity.birthPlaceId, entity.deathPlaceId].filter(
        (value): value is PlaceId => Boolean(value),
      );
    case "text":
    case "event":
    case "institution":
    case "tradition":
      return entity.placeIds;
    case "place":
      return [entity.id];
    default:
      return [];
  }
};

export const matchesTimeFilter = (
  dateRange: HistoricalDateRange | undefined,
  filters: ExplorerFilters,
) => {
  const year = getPrimaryYearFromDateRange(dateRange);

  if (typeof year !== "number") {
    return filters.includeUndated;
  }

  if (typeof filters.startYear === "number" && year < filters.startYear) {
    return false;
  }

  if (typeof filters.endYear === "number" && year > filters.endYear) {
    return false;
  }

  if (filters.timePreset === "all") return true;
  if (filters.timePreset === "ancient") return year < 500;
  if (filters.timePreset === "medieval") return year >= 500 && year < 1500;
  if (filters.timePreset === "early-modern") return year >= 1500 && year < 1800;
  return year >= 1800;
};

export const matchesTagFilters = (tagIds: TagId[], filters: ExplorerFilters) =>
  filters.tagIds.length === 0 || filters.tagIds.some((tagId) => tagIds.includes(tagId));

export const matchesDomainFilters = (domainIds: string[], filters: ExplorerFilters) =>
  filters.domainIds.length === 0 || filters.domainIds.some((domainId) => domainIds.includes(domainId));

export const matchesTraditionFilters = (
  entity: KnowledgeEntity,
  filters: ExplorerFilters,
) =>
  filters.traditionIds.length === 0 ||
  filters.traditionIds.some((traditionId) => getEntityTraditionIds(entity).includes(traditionId));

export const matchesEntityTypeFilters = (
  entity: KnowledgeEntity,
  filters: ExplorerFilters,
) =>
  filters.entityTypes.length === 0 || filters.entityTypes.includes(entity.entityType);

export const matchesLocalEntityScope = (
  entity: KnowledgeEntity,
  filters: ExplorerFilters,
) =>
  filters.localEntityIds.length === 0 || filters.localEntityIds.includes(entity.id);

export const matchesGeographyFilters = (
  entity: KnowledgeEntity,
  filters: ExplorerFilters,
) =>
  filters.geographyPlaceIds.length === 0 ||
  filters.geographyPlaceIds.some((placeId) => getEntityPlaceIds(entity).includes(placeId));

export const matchesEditorialFilters = (
  entity: KnowledgeEntity,
  filters: ExplorerFilters,
) => {
  if (!filters.editorialMode) {
    return true;
  }

  const editorialCoverage = getEntityEditorialStageCoverage(entity);

  if (filters.calculusStages.length > 0) {
    if (
      !filters.calculusStages.some((stage) =>
        editorialCoverage.calculusStages.includes(stage),
      )
    ) {
      return false;
    }
  }

  if (filters.quantumStages.length > 0) {
    if (
      !filters.quantumStages.some((stage) =>
        editorialCoverage.quantumStages.includes(stage),
      )
    ) {
      return false;
    }
  }

  return true;
};

export const matchesEntityFilters = (
  entity: KnowledgeEntity,
  filters: ExplorerFilters,
) =>
  matchesEntityTypeFilters(entity, filters) &&
  matchesDomainFilters(entity.domainIds, filters) &&
  matchesTraditionFilters(entity, filters) &&
  matchesTagFilters(entity.tagIds, filters) &&
  matchesGeographyFilters(entity, filters) &&
  matchesEditorialFilters(entity, filters) &&
  matchesTimeFilter(entity.dateRange, filters);

export const matchesRelationFiltersForEntity = (
  entityId: KnowledgeEntity["id"],
  seed: SacredTimelineSeedData,
  filters: ExplorerFilters,
) =>
  // Relation filters are global scope controls, so entities should only survive
  // when they participate in at least one relation still allowed by that scope.
  filters.relationTypes.length === 0 ||
  seed.edges.some(
    (edge) =>
      (edge.sourceId === entityId || edge.targetId === entityId) &&
      matchesEdgeFilters(edge, filters),
  );

const buildRelationParticipantIds = (
  seed: SacredTimelineSeedData,
  filters: ExplorerFilters,
) => {
  if (filters.relationTypes.length === 0) {
    return undefined;
  }

  const participantIds = new Set<string>();
  for (const edge of seed.edges) {
    if (!matchesEdgeFilters(edge, filters)) {
      continue;
    }
    participantIds.add(edge.sourceId);
    participantIds.add(edge.targetId);
  }

  return participantIds;
};

export const filterKnowledgeEntities = (
  seed: SacredTimelineSeedData,
  filters: ExplorerFilters,
) => {
  const relationParticipantIds = buildRelationParticipantIds(seed, filters);

  return [
    ...seed.people,
    ...seed.texts,
    ...seed.concepts,
    ...seed.events,
    ...seed.places,
    ...seed.institutions,
    ...seed.traditions,
  ].filter(
    (entity) =>
      matchesEntityFilters(entity, filters) &&
      matchesLocalEntityScope(entity, filters) &&
      (!relationParticipantIds || relationParticipantIds.has(entity.id)),
  );
};

export const matchesEdgeFilters = (edge: Edge, filters: ExplorerFilters) => {
  if (
    filters.relationTypes.length > 0 &&
    !filters.relationTypes.includes(edge.relationType)
  ) {
    return false;
  }

  if (!filters.showAiHypotheses && edge.assertionLayer === "ai_hypothesis") {
    return false;
  }

  if (!matchesDomainFilters(edge.domainIds, filters)) {
    return false;
  }

  if (!matchesTagFilters(edge.tagIds, filters)) {
    return false;
  }

  return matchesTimeFilter(edge.dateRange, filters);
};

export const filterVisibleEdges = (
  edges: Edge[],
  visibleEntityIds: Set<string>,
  filters: ExplorerFilters,
) =>
  edges.filter(
    (edge) =>
      visibleEntityIds.has(edge.sourceId) &&
      visibleEntityIds.has(edge.targetId) &&
      matchesEdgeFilters(edge, filters),
  );
