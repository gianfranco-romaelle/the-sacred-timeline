import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import {
  mapProjectionAdapter,
  type MapHub,
  type MapProjection,
} from "@/data/adapters/map-adapter";
import { EmptyStateCard } from "@/components/shared/empty-state-card";
import { useViewCoordination } from "@/features/shared/use-view-coordination";
import { getEntityById, type SeedIndex } from "@/data/entity-index";
import type { EdgeRelationType, KnowledgeEntityId, PlaceId, SacredTimelineSeedData } from "@/types";
import { AtlasControls } from "./atlas-controls";

const AtlasCanvas = lazy(async () => {
  const module = await import("./atlas-canvas");
  return { default: module.AtlasCanvas };
});

interface AtlasViewProps {
  seed: SacredTimelineSeedData;
  index: SeedIndex;
}

const getTimeExtent = (projection: MapProjection) => {
  const years = projection.points
    .map((point) => point.year)
    .filter((year): year is number => typeof year === "number");

  if (years.length === 0) return undefined;

  return {
    startYear: Math.min(...years),
    endYear: Math.max(...years),
  };
};

const filterProjectionForAtlasControls = (
  projection: MapProjection,
  activeYear: number | undefined,
  activeRelationTypes: EdgeRelationType[],
): MapProjection => {
  const points =
    typeof activeYear === "number"
      ? projection.points.filter((point) => typeof point.year !== "number" || point.year <= activeYear)
      : projection.points;
  const visibleEntityIds = new Set(points.map((point) => point.entityId));
  const visiblePlaceIds = new Set(points.map((point) => point.placeId));
  const activeRelationTypeSet = new Set(activeRelationTypes);
  const connections = projection.connections.filter(
    (connection) =>
      visiblePlaceIds.has(connection.sourcePlaceId) &&
      visiblePlaceIds.has(connection.targetPlaceId) &&
      visibleEntityIds.has(connection.sourceEntityId) &&
      visibleEntityIds.has(connection.targetEntityId) &&
      (activeRelationTypeSet.size === 0 || activeRelationTypeSet.has(connection.relationType)),
  );
  const pointsByPlaceId = new Map<PlaceId, typeof points>();

  for (const point of points) {
    pointsByPlaceId.set(point.placeId, [...(pointsByPlaceId.get(point.placeId) ?? []), point]);
  }

  const hubs = projection.hubs
    .map((hub) => {
      const placePoints = pointsByPlaceId.get(hub.placeId) ?? [];
      if (placePoints.length === 0) return undefined;

      return {
        ...hub,
        entityIds: placePoints.map((point) => point.entityId),
        entityCount: placePoints.length,
        weight: placePoints.reduce((total, point) => total + point.weight, 0) + hub.relationCount * 0.6,
        isSelected: placePoints.some((point) => point.isSelected),
        isNeighbor: placePoints.some((point) => point.isNeighbor),
        isContextRelevant: hub.isContextRelevant || placePoints.some((point) => point.isContextRelevant),
      } satisfies MapHub;
    })
    .filter(Boolean) as MapHub[];

  return {
    ...projection,
    points,
    hubs,
    connections,
    visibleCounts: {
      points: points.length,
      places: hubs.length,
      connections: connections.length,
    },
  };
};

const getPlaceLabel = (placeId: PlaceId | undefined, projection: MapProjection) =>
  projection.hubs.find((hub) => hub.placeId === placeId)?.label;

export function AtlasView({ seed, index }: AtlasViewProps) {
  const {
    filters,
    selectedEntityId,
    selectionSourceView,
    activeFilterSummary,
    resetFilters,
    selectFromView,
  } = useViewCoordination();

  const projection = useMemo(
    () =>
      mapProjectionAdapter({
        seed,
        index,
        filters,
        selectedEntityId,
        selectionSourceView,
      }),
    [filters, index, seed, selectedEntityId, selectionSourceView],
  );

  const [clusterPlaces, setClusterPlaces] = useState(true);
  const [showRoutes, setShowRoutes] = useState(true);
  const [selectedPlaceId, setSelectedPlaceId] = useState<PlaceId | undefined>(undefined);
  const [activeRelationTypes, setActiveRelationTypes] = useState<EdgeRelationType[]>([]);
  const [scrubbedYear, setScrubbedYear] = useState<number | undefined>(undefined);
  const [focusRequest, setFocusRequest] = useState(0);
  const timeExtent = useMemo(() => getTimeExtent(projection), [projection]);
  const activeYear = scrubbedYear ?? timeExtent?.endYear;
  const availableRelationTypes = useMemo(
    () =>
      Array.from(new Set(projection.connections.map((connection) => connection.relationType))).sort(),
    [projection.connections],
  );
  const atlasProjection = useMemo(
    () => filterProjectionForAtlasControls(projection, activeYear, activeRelationTypes),
    [activeRelationTypes, activeYear, projection],
  );

  useEffect(() => {
    setScrubbedYear(undefined);
    setActiveRelationTypes([]);
    setSelectedPlaceId(undefined);
  }, [projection]);

  const selectedLabel = getEntityById(selectedEntityId, index)?.label;
  const selectedPlaceLabel = getPlaceLabel(selectedPlaceId, atlasProjection);
  const selectedPlaceEntities = useMemo(
    () =>
      selectedPlaceId
        ? atlasProjection.points
            .filter((point) => point.placeId === selectedPlaceId)
            .sort((left, right) => left.label.localeCompare(right.label))
        : [],
    [atlasProjection.points, selectedPlaceId],
  );
  const canZoomToSelection = Boolean(
    selectedEntityId || (selectedPlaceId && atlasProjection.hubs.some((hub) => hub.placeId === selectedPlaceId)),
  );

  const toggleRelationType = (relationType: EdgeRelationType) => {
    setActiveRelationTypes((current) =>
      current.includes(relationType)
        ? current.filter((item) => item !== relationType)
        : [...current, relationType],
    );
  };

  return (
    <div className="atlas-view">
      <AtlasControls
        pointCount={atlasProjection.visibleCounts.points}
        placeCount={atlasProjection.visibleCounts.places}
        connectionCount={showRoutes ? atlasProjection.visibleCounts.connections : 0}
        activeFilterSummary={activeFilterSummary}
        selectedLabel={selectedLabel}
        canZoomToSelection={canZoomToSelection}
        clusterPlaces={clusterPlaces}
        showRoutes={showRoutes}
        activeRelationTypes={activeRelationTypes}
        availableRelationTypes={availableRelationTypes}
        timeExtent={timeExtent}
        activeYear={activeYear}
        onClusterPlacesChange={setClusterPlaces}
        onShowRoutesChange={setShowRoutes}
        onToggleRelationType={toggleRelationType}
        onTimeScrub={setScrubbedYear}
        onResetTimeScrub={() => setScrubbedYear(undefined)}
        onZoomToSelection={() => setFocusRequest((current) => current + 1)}
      />

      {atlasProjection.points.length === 0 ? (
        <EmptyStateCard
          activeFilterSummary={activeFilterSummary}
          description={
            activeFilterSummary.length > 0
              ? "This view has no geographic data for the current scope. Clear these filters or widen the place controls to restore mapped records."
              : "This view has no geographic data yet. Place-bearing records will appear here as the archive gains resolved locations."
          }
          eyebrow="Atlas"
          onResetFilters={resetFilters}
          title={
            activeFilterSummary.length > 0
              ? "No records match this geographic scope."
              : "No geographically resolved records yet."
          }
        />
      ) : (
        <>
          <Suspense
            fallback={
              <div className="main-stage__loading" role="status">
                Loading atlas canvas...
              </div>
            }
          >
            <AtlasCanvas
              clusterPlaces={clusterPlaces}
              focusRequest={focusRequest}
              projection={atlasProjection}
              selectedEntityId={selectedEntityId}
              selectedPlaceId={selectedPlaceId}
              showRoutes={showRoutes}
              onSelectEntity={(entityId, entityType) =>
                selectFromView(entityId, entityType, "atlas")
              }
              onSelectPlace={setSelectedPlaceId}
            />
          </Suspense>
          {selectedPlaceId && selectedPlaceLabel ? (
            <aside className="atlas-place-panel" aria-label="Entities at selected place">
              <div>
                <p className="eyebrow">Selected place</p>
                <h3>{selectedPlaceLabel}</h3>
                <p>
                  {selectedPlaceEntities.length} mapped record
                  {selectedPlaceEntities.length === 1 ? "" : "s"} in the current atlas spread.
                </p>
              </div>
              <div className="atlas-place-panel__list">
                {selectedPlaceEntities.map((point) => (
                  <button
                    key={point.entityId}
                    onClick={() => selectFromView(point.entityId, point.entityType, "atlas")}
                    type="button"
                  >
                    <span>{point.label}</span>
                    <small>
                      {point.entityType} - {point.dateLabel}
                    </small>
                  </button>
                ))}
              </div>
            </aside>
          ) : null}
          <div className="atlas-note">
            <p>
              Larger place halos mark centers of concentration. Routes appear where relation data
              resolves both ends to distinct places; otherwise the atlas leans on local place
              emphasis.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
