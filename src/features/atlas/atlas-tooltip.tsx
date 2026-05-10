import type { MapConnection, MapHub, MapPoint } from "@/data/adapters/map-adapter";

type AtlasTooltipData =
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

interface AtlasTooltipProps {
  data?: AtlasTooltipData;
}

export function AtlasTooltip({ data }: AtlasTooltipProps) {
  if (!data) return null;

  return (
    <div
      className="atlas-tooltip"
      style={{
        left: data.x,
        top: data.y,
      }}
    >
      {data.kind === "point" ? (
        <>
          <p className="eyebrow">Mapped entity</p>
          <h3>{data.item.label}</h3>
          <p className="atlas-tooltip__meta">
            {data.item.entityType} - {data.item.dateLabel}
          </p>
          <p>{data.item.placeLabel}</p>
          {data.item.description ? <p>{data.item.description}</p> : null}
        </>
      ) : null}

      {data.kind === "hub" ? (
        <>
          <p className="eyebrow">Place hub</p>
          <h3>{data.item.label}</h3>
          <p className="atlas-tooltip__meta">
            {data.item.entityCount} mapped records - {data.item.relationCount} local relation
            {data.item.relationCount === 1 ? "" : "s"}
          </p>
          <p>Click to show entities at this place.</p>
        </>
      ) : null}

      {data.kind === "connection" ? (
        <>
          <p className="eyebrow">Transmission route</p>
          <h3>
            {data.item.sourcePlaceLabel} to {data.item.targetPlaceLabel}
          </h3>
          <p className="atlas-tooltip__meta">
            {data.item.relationType.replaceAll("_", " ")} - {data.item.relationCount} relation
            {data.item.relationCount === 1 ? "" : "s"}
          </p>
        </>
      ) : null}
    </div>
  );
}
