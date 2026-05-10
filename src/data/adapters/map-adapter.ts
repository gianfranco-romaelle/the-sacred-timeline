import type { ExplorerFilters, ExplorerView } from "@/state/explorer-store";
import {
  buildFocusContext,
  getContextReasonForEntity,
  getContextReasonForPlace,
  type ContextReason,
} from "@/data/focus-context";
import type {
  DomainId,
  EdgeRelationType,
  KnowledgeEntity,
  KnowledgeEntityId,
  PlaceId,
  SacredTimelineSeedData,
} from "@/types";
import type { SeedIndex } from "@/data/entity-index";
import type { ProjectionInput, ViewProjection, ViewProjectionAdapter } from "@/types/projections";
import { filterKnowledgeEntities, filterVisibleEdges, getEntityPlaceIds } from "@/data/filtering";
import { deriveEntityNeighborhood } from "@/data/relation-helpers";
import { getEntityDateLabel } from "@/data/entity-index";
import { getPrimaryYearFromDateRange } from "@/data/time-grouping";
import { buildProjectionDiagnostics } from "./projection-diagnostics";

export type AtlasTone = "science" | "religion" | "hybrid" | "neutral";

export interface MapPoint {
  entityId: KnowledgeEntityId;
  entityType: KnowledgeEntity["entityType"];
  label: string;
  description: string;
  dateLabel: string;
  year?: number;
  placeId: PlaceId;
  placeLabel: string;
  latitude: number;
  longitude: number;
  displayLatitude: number;
  displayLongitude: number;
  domainIds: DomainId[];
  weight: number;
  tone: AtlasTone;
  isSelected: boolean;
  isNeighbor: boolean;
  isContextRelevant: boolean;
  contextReason?: ContextReason;
}

export interface MapHub {
  placeId: PlaceId;
  label: string;
  latitude: number;
  longitude: number;
  entityIds: KnowledgeEntityId[];
  entityCount: number;
  relationCount: number;
  weight: number;
  tone: AtlasTone;
  isSelected: boolean;
  isNeighbor: boolean;
  isContextRelevant: boolean;
  contextReason?: ContextReason;
}

export interface MapConnection {
  edgeId: `edge_${string}`;
  sourceEntityId: KnowledgeEntityId;
  targetEntityId: KnowledgeEntityId;
  relationType: EdgeRelationType;
  label: string;
  sourcePlaceId: PlaceId;
  targetPlaceId: PlaceId;
  sourcePlaceLabel: string;
  targetPlaceLabel: string;
  sourceLatitude: number;
  sourceLongitude: number;
  targetLatitude: number;
  targetLongitude: number;
  weight: number;
  relationCount: number;
  isSelectionAdjacent: boolean;
  isContextRelevant: boolean;
}

export interface MapProjection extends ViewProjection<{
  points: number;
  connections: number;
  places: number;
}> {
  points: MapPoint[];
  hubs: MapHub[];
  connections: MapConnection[];
}

const getTone = (domainIds: DomainId[]): AtlasTone => {
  const hasScience = domainIds.includes("domain_science");
  const hasReligion = domainIds.includes("domain_religion");

  if (hasScience && hasReligion) return "hybrid";
  if (hasScience) return "science";
  if (hasReligion) return "religion";
  return "neutral";
};

const hashString = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
};

const toJitteredCoordinates = (
  latitude: number,
  longitude: number,
  stableKey: string,
  index: number,
  total: number,
) => {
  if (total <= 1) {
    return {
      displayLatitude: latitude,
      displayLongitude: longitude,
    };
  }

  const seed = hashString(stableKey);
  const angle = ((seed % 360) * Math.PI) / 180 + (index / total) * Math.PI * 2;
  const radius = 0.12 + Math.min(0.2, total * 0.015);

  return {
    displayLatitude: latitude + Math.sin(angle) * radius,
    displayLongitude: longitude + Math.cos(angle) * radius,
  };
};

const getPrimaryPlaceForEntity = (entityId: KnowledgeEntityId, index: SeedIndex) => {
  const entity = index.entitiesById.get(entityId);
  if (!entity) return undefined;

  const placeId = getEntityPlaceIds(entity)[0];
  if (!placeId) return undefined;

  const place = index.entitiesById.get(placeId);
  if (!place || place.entityType !== "place" || !place.geometry?.point) return undefined;

  return {
    entity,
    place,
  };
};

export const buildMapProjection = (
  seed: SacredTimelineSeedData,
  index: SeedIndex,
  filters: ExplorerFilters,
  selectedEntityId?: KnowledgeEntityId,
  selectionSourceView?: ExplorerView,
): MapProjection => {
  const visibleEntities = filterKnowledgeEntities(seed, filters).filter(
    (entity) =>
      entity.entityType === "person" ||
      entity.entityType === "text" ||
      entity.entityType === "event" ||
      entity.entityType === "institution" ||
      entity.entityType === "place",
  );
  const visibleEntityIds = new Set(visibleEntities.map((entity) => entity.id));
  const visibleEdges = filterVisibleEdges(seed.edges, visibleEntityIds, filters);
  const neighborhood = deriveEntityNeighborhood(selectedEntityId, index, filters.relationTypes);
  const focusContext = buildFocusContext(seed, index, filters, selectedEntityId, selectionSourceView);

  const basePoints = visibleEntities
    .map((entity) => {
      const resolved = getPrimaryPlaceForEntity(entity.id, index);
      if (!resolved) return undefined;

      return {
        entityId: entity.id,
        entityType: entity.entityType,
        label: entity.label,
        description: entity.description,
        dateLabel: getEntityDateLabel(entity),
        year: getPrimaryYearFromDateRange(entity.dateRange),
        placeId: resolved.place.id,
        placeLabel: resolved.place.label,
        latitude: resolved.place.geometry!.point!.latitude,
        longitude: resolved.place.geometry!.point!.longitude,
        displayLatitude: resolved.place.geometry!.point!.latitude,
        displayLongitude: resolved.place.geometry!.point!.longitude,
        domainIds: entity.domainIds,
        weight: 1 + entity.citationIds.length * 0.25 + entity.relatedEntityIds.length * 0.1,
        tone: getTone(entity.domainIds),
        isSelected: selectedEntityId === entity.id,
        isNeighbor: neighborhood.neighborIds.includes(entity.id),
        isContextRelevant: Boolean(getContextReasonForEntity(entity, focusContext)),
        contextReason: getContextReasonForEntity(entity, focusContext),
      } satisfies MapPoint;
    })
    .filter(Boolean) as MapPoint[];

  const pointsByPlaceId = new Map<PlaceId, MapPoint[]>();
  for (const point of basePoints) {
    const placePoints = pointsByPlaceId.get(point.placeId);
    if (placePoints) {
      placePoints.push(point);
    } else {
      pointsByPlaceId.set(point.placeId, [point]);
    }
  }

  const points = Array.from(pointsByPlaceId.values()).flatMap((placePoints) =>
    placePoints.map((point, placeIndex) => ({
      ...point,
      ...toJitteredCoordinates(
        point.latitude,
        point.longitude,
        point.entityId,
        placeIndex,
        placePoints.length,
      ),
    })),
  );

  const localRelationCountByPlaceId = new Map<PlaceId, number>();
  const connectionAccumulator = new Map<string, MapConnection>();

  for (const edge of visibleEdges) {
    const source = getPrimaryPlaceForEntity(edge.sourceId as KnowledgeEntityId, index);
    const target = getPrimaryPlaceForEntity(edge.targetId as KnowledgeEntityId, index);
    if (!source || !target) continue;

    const isSelectionAdjacent =
      edge.sourceId === selectedEntityId ||
      edge.targetId === selectedEntityId ||
      neighborhood.neighborIds.includes(edge.sourceId as KnowledgeEntityId) ||
      neighborhood.neighborIds.includes(edge.targetId as KnowledgeEntityId);

    if (source.place.id === target.place.id) {
      localRelationCountByPlaceId.set(
        source.place.id,
        (localRelationCountByPlaceId.get(source.place.id) ?? 0) + 1,
      );
      continue;
    }

    const directionKey = `${source.place.id}|${target.place.id}|${edge.relationType}`;
    const existing = connectionAccumulator.get(directionKey);

    if (existing) {
      existing.relationCount += 1;
      existing.weight += edge.weight ?? 1;
      existing.isSelectionAdjacent = existing.isSelectionAdjacent || isSelectionAdjacent;
      existing.isContextRelevant = existing.isContextRelevant || isSelectionAdjacent;
      continue;
    }

    connectionAccumulator.set(directionKey, {
      edgeId: edge.id,
      sourceEntityId: edge.sourceId as KnowledgeEntityId,
      targetEntityId: edge.targetId as KnowledgeEntityId,
      relationType: edge.relationType,
      label: edge.label,
      sourcePlaceId: source.place.id,
      targetPlaceId: target.place.id,
      sourcePlaceLabel: source.place.label,
      targetPlaceLabel: target.place.label,
      sourceLatitude: source.place.geometry!.point!.latitude,
      sourceLongitude: source.place.geometry!.point!.longitude,
      targetLatitude: target.place.geometry!.point!.latitude,
      targetLongitude: target.place.geometry!.point!.longitude,
      weight: edge.weight ?? 1,
      relationCount: 1,
      isSelectionAdjacent,
      isContextRelevant: isSelectionAdjacent,
    });
  }

  const hubs = Array.from(pointsByPlaceId.entries()).map(([placeId, placePoints]) => {
    const toneWeights = {
      science: 0,
      religion: 0,
      hybrid: 0,
      neutral: 0,
    } satisfies Record<AtlasTone, number>;

    for (const point of placePoints) {
      toneWeights[point.tone] += point.weight;
    }

    const dominantTone = (Object.entries(toneWeights).sort((left, right) => right[1] - left[1])[0]?.[0] ??
      "neutral") as AtlasTone;
    const relationCount = localRelationCountByPlaceId.get(placeId) ?? 0;

    return {
      placeId,
      label: placePoints[0].placeLabel,
      latitude: placePoints[0].latitude,
      longitude: placePoints[0].longitude,
      entityIds: placePoints.map((point) => point.entityId),
      entityCount: placePoints.length,
      relationCount,
      weight: placePoints.reduce((total, point) => total + point.weight, 0) + relationCount * 0.6,
      tone: dominantTone,
      isSelected: placePoints.some((point) => point.isSelected),
      isNeighbor: placePoints.some((point) => point.isNeighbor),
      isContextRelevant:
        placePoints.some((point) => point.isContextRelevant) ||
        Boolean(getContextReasonForPlace(placeId, focusContext)),
      contextReason:
        placePoints.find((point) => point.contextReason)?.contextReason ??
        getContextReasonForPlace(placeId, focusContext),
    } satisfies MapHub;
  });

  const connections = Array.from(connectionAccumulator.values());

  return {
    projectionKind: "atlas",
    points,
    hubs,
    connections,
    diagnostics: buildProjectionDiagnostics({
      projectionKind: "atlas",
      itemCount: points.length,
      edgeCount: connections.length,
      groupCount: hubs.length,
    }),
    visibleCounts: {
      points: points.length,
      connections: connections.length,
      places: hubs.length,
    },
  };
};

export const mapProjectionAdapter: ViewProjectionAdapter<MapProjection> = ({
  seed,
  index,
  filters,
  selectedEntityId,
  selectionSourceView,
}: ProjectionInput) =>
  buildMapProjection(seed, index, filters, selectedEntityId, selectionSourceView);
