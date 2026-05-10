import { useEffect, useMemo, useState } from "react";
import DeckGL from "@deck.gl/react";
import {
  ArcLayer,
  ScatterplotLayer,
  TextLayer,
} from "@deck.gl/layers";
import {
  MapView,
  type PickingInfo,
} from "@deck.gl/core";
import type { MapConnection, MapHub, MapPoint, MapProjection } from "@/data/adapters/map-adapter";
import type { CanonicalEntityType, KnowledgeEntityId, PlaceId } from "@/types";
import { AtlasTooltip } from "./atlas-tooltip";

interface AtlasCanvasProps {
  clusterPlaces: boolean;
  focusRequest: number;
  projection: MapProjection;
  selectedEntityId?: KnowledgeEntityId;
  selectedPlaceId?: PlaceId;
  showRoutes: boolean;
  onSelectEntity: (entityId: KnowledgeEntityId, entityType: CanonicalEntityType) => void;
  onSelectPlace: (placeId: PlaceId) => void;
}

type AtlasHoverData =
  | {
      kind: "point";
      item: MapPoint;
      x: number;
      y: number;
    }
  | {
      kind: "hub";
      item: MapHub;
      x: number;
      y: number;
    }
  | {
      kind: "connection";
      item: MapConnection;
      x: number;
      y: number;
    };

const toneToRgb = {
  science: [91, 123, 153],
  religion: [143, 99, 92],
  hybrid: [156, 127, 82],
  neutral: [122, 111, 95],
} as const;

interface AtlasViewState {
  longitude: number;
  latitude: number;
  zoom: number;
  maxZoom: number;
  minZoom: number;
  pitch: number;
  bearing: number;
}

const getCentroid = (projection: MapProjection) => {
  if (projection.hubs.length === 0) {
    return {
      latitude: 25,
      longitude: 10,
      zoom: 2.25,
    };
  }

  const latitude =
    projection.hubs.reduce((total, hub) => total + hub.latitude, 0) / projection.hubs.length;
  const longitude =
    projection.hubs.reduce((total, hub) => total + hub.longitude, 0) / projection.hubs.length;

  const latitudes = projection.hubs.map((hub) => hub.latitude);
  const longitudes = projection.hubs.map((hub) => hub.longitude);
  const span = Math.max(
    Math.max(...latitudes) - Math.min(...latitudes),
    Math.max(...longitudes) - Math.min(...longitudes),
  );

  const zoom = span > 80 ? 2 : span > 35 ? 3 : span > 15 ? 3.8 : 4.6;

  return {
    latitude,
    longitude,
    zoom,
  };
};

const toHoverData = <T extends MapPoint | MapHub | MapConnection>(
  kind: AtlasHoverData["kind"],
  info: PickingInfo<T>,
): AtlasHoverData | undefined => {
  if (!info.object || typeof info.x !== "number" || typeof info.y !== "number") {
    return undefined;
  }

  if (kind === "point") {
    return {
      kind,
      item: info.object as MapPoint,
      x: info.x,
      y: info.y,
    };
  }

  if (kind === "hub") {
    return {
      kind,
      item: info.object as MapHub,
      x: info.x,
      y: info.y,
    };
  }

  return {
    kind,
    item: info.object as MapConnection,
    x: info.x,
    y: info.y,
  };
};

export function AtlasCanvas({
  clusterPlaces,
  focusRequest,
  projection,
  selectedEntityId,
  selectedPlaceId,
  showRoutes,
  onSelectEntity,
  onSelectPlace,
}: AtlasCanvasProps) {
  const [hovered, setHovered] = useState<AtlasHoverData | undefined>(undefined);

  const initialViewState = useMemo(() => {
    const centroid = getCentroid(projection);

    return {
      longitude: centroid.longitude,
      latitude: centroid.latitude,
      zoom: centroid.zoom,
      maxZoom: 8,
      minZoom: 1.5,
      pitch: 18,
      bearing: 0,
    };
  }, [projection]);

  const [viewState, setViewState] = useState<AtlasViewState>(initialViewState);

  useEffect(() => {
    setViewState(initialViewState);
  }, [initialViewState]);

  useEffect(() => {
    if (focusRequest === 0) return;

    const selectedPoint = selectedEntityId
      ? projection.points.find((point) => point.entityId === selectedEntityId)
      : undefined;
    const selectedHub = selectedPlaceId
      ? projection.hubs.find((hub) => hub.placeId === selectedPlaceId)
      : undefined;
    const target = selectedPoint
      ? {
          longitude: selectedPoint.displayLongitude,
          latitude: selectedPoint.displayLatitude,
          zoom: 6.2,
        }
      : selectedHub
        ? {
            longitude: selectedHub.longitude,
            latitude: selectedHub.latitude,
            zoom: 5.4,
          }
        : undefined;

    if (!target) return;

    setViewState((current) => ({
      ...current,
      longitude: target.longitude,
      latitude: target.latitude,
      zoom: Math.max(current.minZoom, Math.min(current.maxZoom, target.zoom)),
    }));
  }, [focusRequest, projection.hubs, projection.points, selectedEntityId, selectedPlaceId]);

  const layers = useMemo(
    () => [
      new ArcLayer<MapConnection>({
        id: "atlas-connections",
        data: showRoutes ? projection.connections : [],
        pickable: true,
        getSourcePosition: (connection) => [
          connection.sourceLongitude,
          connection.sourceLatitude,
        ],
        getTargetPosition: (connection) => [
          connection.targetLongitude,
          connection.targetLatitude,
        ],
        getSourceColor: (connection) =>
          connection.isSelectionAdjacent || connection.isContextRelevant
            ? [124, 93, 46, 180]
            : [135, 122, 101, 110],
        getTargetColor: (connection) =>
          connection.isSelectionAdjacent || connection.isContextRelevant
            ? [124, 93, 46, 220]
            : [135, 122, 101, 140],
        getWidth: (connection) => Math.min(6, 1.4 + connection.weight * 0.8),
        widthUnits: "pixels",
        greatCircle: true,
        opacity: 0.72,
        onHover: (info) => setHovered(toHoverData("connection", info)),
      }),
      new ScatterplotLayer<MapHub>({
        id: "atlas-hubs",
        data: projection.hubs,
        pickable: true,
        stroked: true,
        filled: true,
        radiusUnits: "meters",
        getPosition: (hub) => [hub.longitude, hub.latitude],
        getRadius: (hub) => 32000 + hub.weight * 9000,
        getFillColor: (hub) => {
          const color = toneToRgb[hub.tone];
          return hub.isSelected
            ? [color[0], color[1], color[2], 135]
            : hub.isNeighbor
              ? [color[0], color[1], color[2], 95]
              : hub.isContextRelevant
                ? [color[0], color[1], color[2], 72]
                : [color[0], color[1], color[2], 52];
        },
        getLineColor: (hub) =>
          hub.placeId === selectedPlaceId || hub.isSelected
            ? [70, 50, 26, 220]
            : hub.isNeighbor
              ? [87, 79, 63, 170]
              : hub.isContextRelevant
                ? [95, 86, 70, 145]
                : [99, 93, 79, 110],
        lineWidthUnits: "pixels",
        lineWidthMinPixels: 1,
        onHover: (info) => setHovered(toHoverData("hub", info)),
        onClick: (info) => {
          if (!info.object) return;
          onSelectPlace(info.object.placeId);
        },
      }),
      new ScatterplotLayer<MapPoint>({
        id: "atlas-points",
        data: clusterPlaces ? [] : projection.points,
        pickable: true,
        stroked: true,
        filled: true,
        radiusUnits: "meters",
        getPosition: (point) => [point.displayLongitude, point.displayLatitude],
        getRadius: (point) => {
          if (point.isSelected) return 28000;
          if (point.isNeighbor) return 22000;
          return 14000 + point.weight * 3000;
        },
        getFillColor: (point) => {
          const color = toneToRgb[point.tone];
          return point.isSelected
            ? [color[0], color[1], color[2], 240]
            : point.isNeighbor
              ? [color[0], color[1], color[2], 200]
              : point.isContextRelevant
                ? [color[0], color[1], color[2], 186]
                : [color[0], color[1], color[2], 170];
        },
        getLineColor: (point) =>
          point.entityId === selectedEntityId ? [46, 33, 18, 255] : [255, 249, 240, 220],
        lineWidthUnits: "pixels",
        lineWidthMinPixels: 1.5,
        onHover: (info) => setHovered(toHoverData("point", info)),
        onClick: (info) => {
          if (!info.object) return;
          onSelectEntity(info.object.entityId, info.object.entityType);
        },
      }),
      new TextLayer<MapHub>({
        id: "atlas-labels",
        data: projection.hubs.filter(
          (hub) =>
            hub.isSelected ||
            hub.isNeighbor ||
            hub.isContextRelevant ||
            hub.entityCount > 1 ||
            hub.relationCount > 0,
        ),
        pickable: false,
        getPosition: (hub) => [hub.longitude, hub.latitude],
        getText: (hub) => hub.label,
        getSize: 14,
        sizeUnits: "pixels",
        getColor: (hub) =>
          hub.isSelected
            ? [33, 24, 16, 255]
            : hub.isNeighbor || hub.isContextRelevant
              ? [56, 45, 33, 230]
              : [78, 68, 56, 210],
        getTextAnchor: "middle",
        getAlignmentBaseline: "bottom",
        getPixelOffset: [0, -12],
        background: false,
      }),
    ],
    [
      clusterPlaces,
      onSelectEntity,
      onSelectPlace,
      projection.connections,
      projection.hubs,
      projection.points,
      selectedEntityId,
      selectedPlaceId,
      showRoutes,
    ],
  );

  return (
    <div className="atlas-canvas-shell">
      <DeckGL
        views={new MapView({ repeat: true })}
        viewState={viewState}
        onViewStateChange={({ viewState: nextViewState }) =>
          setViewState(nextViewState as AtlasViewState)
        }
        controller={{
          dragRotate: false,
          doubleClickZoom: false,
          touchRotate: false,
        }}
        layers={layers}
        getCursor={({ isHovering }) => (isHovering ? "pointer" : "grab")}
      >
        <div className="atlas-canvas-backdrop" />
      </DeckGL>
      <AtlasTooltip data={hovered} />
    </div>
  );
}
