import type { SeedIndex } from "@/data/entity-index";
import { getEntityTraditionIds, getEntityPlaceIds, filterKnowledgeEntities } from "@/data/filtering";
import { deriveEntityNeighborhood } from "@/data/relation-helpers";
import { getPrimaryYearFromDateRange } from "@/data/time-grouping";
import type { ExplorerFilters, ExplorerView } from "@/state/explorer-store";
import type {
  DomainId,
  KnowledgeEntity,
  KnowledgeEntityId,
  PlaceId,
  SacredTimelineSeedData,
  TraditionId,
} from "@/types";

export type ContextReason =
  | "selected"
  | "neighbor"
  | "same-era"
  | "shared-tradition"
  | "shared-domain"
  | "related-place";

export interface FocusContext {
  selectedEntityId?: KnowledgeEntityId;
  selectedEntity?: KnowledgeEntity;
  selectionSourceView?: ExplorerView;
  neighborIds: KnowledgeEntityId[];
  neighborEntities: KnowledgeEntity[];
  relationTypes: string[];
  relatedPlaceIds: PlaceId[];
  relatedPortraitIds: string[];
  relatedTraditionIds: TraditionId[];
  relatedDomainIds: DomainId[];
  timeAnchorYear?: number;
  hasContext: boolean;
}

const intersects = <T,>(left: T[], right: T[]) => left.some((value) => right.includes(value));

const getContextEntityIds = (
  selectedEntityId: KnowledgeEntityId | undefined,
  neighborIds: KnowledgeEntityId[],
) =>
  selectedEntityId ? [selectedEntityId, ...neighborIds] : [];

export const buildFocusContext = (
  seed: SacredTimelineSeedData,
  index: SeedIndex,
  filters: ExplorerFilters,
  selectedEntityId?: KnowledgeEntityId,
  selectionSourceView?: ExplorerView,
): FocusContext => {
  const selectedEntity = selectedEntityId ? index.entitiesById.get(selectedEntityId) : undefined;
  if (!selectedEntity) {
    return {
      selectedEntityId: undefined,
      selectedEntity: undefined,
      selectionSourceView,
      neighborIds: [],
      neighborEntities: [],
      relationTypes: [],
      relatedPlaceIds: [],
      relatedPortraitIds: [],
      relatedTraditionIds: [],
      relatedDomainIds: [],
      timeAnchorYear: undefined,
      hasContext: false,
    };
  }

  const visibleEntityIds = new Set(filterKnowledgeEntities(seed, filters).map((entity) => entity.id));
  const neighborhood = deriveEntityNeighborhood(selectedEntityId, index, filters.relationTypes);
  const neighborEntities = neighborhood.neighborIds
    .filter((entityId) => visibleEntityIds.has(entityId))
    .map((entityId) => index.entitiesById.get(entityId))
    .filter((value): value is KnowledgeEntity => Boolean(value));
  const relatedEntityIds = getContextEntityIds(selectedEntity.id, neighborEntities.map((entity) => entity.id));
  const relatedEntities = relatedEntityIds
    .map((entityId) => index.entitiesById.get(entityId))
    .filter((value): value is KnowledgeEntity => Boolean(value));

  return {
    selectedEntityId: selectedEntity.id,
    selectedEntity,
    selectionSourceView,
    neighborIds: neighborEntities.map((entity) => entity.id),
    neighborEntities,
    relationTypes: Array.from(new Set(neighborhood.allEdges.map((edge) => edge.relationType))),
    relatedPlaceIds: Array.from(
      new Set(relatedEntities.flatMap((entity) => getEntityPlaceIds(entity))),
    ),
    relatedPortraitIds: seed.portraitAssets
      .filter((portrait) => portrait.depictedEntityIds.some((entityId) => relatedEntityIds.includes(entityId)))
      .map((portrait) => portrait.id),
    relatedTraditionIds: Array.from(
      new Set(relatedEntities.flatMap((entity) => getEntityTraditionIds(entity))),
    ),
    relatedDomainIds: Array.from(new Set(relatedEntities.flatMap((entity) => entity.domainIds))),
    timeAnchorYear: getPrimaryYearFromDateRange(selectedEntity.dateRange),
    hasContext: true,
  };
};

export const getContextReasonForEntity = (
  entity: KnowledgeEntity,
  context: FocusContext,
): ContextReason | undefined => {
  if (!context.selectedEntityId || !context.selectedEntity) return undefined;
  if (entity.id === context.selectedEntityId) return "selected";
  if (context.neighborIds.includes(entity.id)) return "neighbor";

  const entityYear = getPrimaryYearFromDateRange(entity.dateRange);
  if (
    typeof entityYear === "number" &&
    typeof context.timeAnchorYear === "number" &&
    Math.abs(entityYear - context.timeAnchorYear) <= 120
  ) {
    return "same-era";
  }

  if (intersects(getEntityTraditionIds(entity), context.relatedTraditionIds)) {
    return "shared-tradition";
  }

  if (intersects(entity.domainIds, context.relatedDomainIds)) {
    return "shared-domain";
  }

  return undefined;
};

export const getContextReasonForPlace = (
  placeId: PlaceId,
  context: FocusContext,
): ContextReason | undefined => {
  if (!context.selectedEntityId) return undefined;
  if (context.relatedPlaceIds.includes(placeId)) return "related-place";
  return undefined;
};

export const getContextLabel = (sourceView?: ExplorerView) => {
  if (!sourceView) return undefined;

  return {
    river: "River of Time",
    constellation: "Constellation",
    atlas: "Atlas",
    "face-atlas": "Face Atlas",
    scriptorium: "Scriptorium",
  }[sourceView];
};
