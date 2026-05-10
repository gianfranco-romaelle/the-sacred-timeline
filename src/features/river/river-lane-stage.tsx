import { useMemo } from "react";
import type { RiverLaneEntity, RiverLaneProjection } from "@/historical/projections/river-lane-functor";
import type { KnowledgeEntityId } from "@/types";

interface RiverLaneStageProps {
  projection: RiverLaneProjection;
  onSelect: (id: KnowledgeEntityId) => void;
}

const LANE_HEADER_W = 160; // px — sticky label column width
const LANE_H = 120;        // px — track height per tradition
const MIN_CHIP_GAP = 80;   // px — min gap between chip starts before staggering rows

interface PlacedChip {
  entity: RiverLaneEntity;
  left: number; // px offset from track start
  row: 0 | 1 | 2; // 0 = top quarter, 1 = center, 2 = bottom quarter
}

function placeChips(
  entities: RiverLaneEntity[],
  globalStartYear: number,
  pxPerYear: number,
): PlacedChip[] {
  const placed: PlacedChip[] = [];
  const rowRight: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  for (const entity of entities) {
    const left = (entity.primaryYear - globalStartYear) * pxPerYear;

    // Prefer center row; fall back to whichever off-center row has most room.
    let row: PlacedChip["row"];
    if (left - rowRight[1] >= MIN_CHIP_GAP) {
      row = 1;
    } else {
      const gap0 = left - rowRight[0];
      const gap2 = left - rowRight[2];
      row = gap0 >= gap2 ? 0 : 2;
    }

    placed.push({ entity, left, row });
    rowRight[row] = left + MIN_CHIP_GAP;
  }
  return placed;
}

// Vertical center of each row (px from top), offset slightly for transform: translateY(-50%)
const ROW_TOP_PX = [LANE_H * 0.2, LANE_H * 0.5, LANE_H * 0.8] as const;

export function RiverLaneStage({ projection, onSelect }: RiverLaneStageProps) {
  const { lanes, undatedOrUnassigned, globalStartYear, globalEndYear } = projection;
  const span = Math.max(globalEndYear - globalStartYear, 1);

  const pxPerYear = Math.min(8, Math.max(3, 4800 / span));
  const trackWidth = Math.max(Math.ceil(span * pxPerYear), 800);

  const tickStep = span > 800 ? 100 : span > 400 ? 50 : span > 200 ? 25 : 10;
  const ticks = useMemo(() => {
    const result: number[] = [];
    const first = Math.ceil(globalStartYear / tickStep) * tickStep;
    for (let y = first; y <= globalEndYear; y += tickStep) result.push(y);
    return result;
  }, [globalStartYear, globalEndYear, tickStep]);

  return (
    <div className="river-lane-stage" aria-label="Tradition lanes">
      {/* Year axis row — spacer keeps alignment with sticky headers */}
      <div className="river-lane-stage__axis-row">
        <div className="river-lane-stage__axis-spacer" aria-hidden="true" />
        <div className="river-lane-stage__axis" style={{ width: `${trackWidth}px` }}>
          {ticks.map((year) => (
            <div
              key={year}
              className="river-lane-stage__tick"
              style={{ left: `${(year - globalStartYear) * pxPerYear}px` }}
            >
              <div className="river-lane-stage__tick-line" />
              <span className="river-lane-stage__tick-label">{year}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Tradition swim-lanes */}
      <div className="river-lane-stage__lanes">
        {lanes.map((lane) => {
          const chips = placeChips(lane.entities, globalStartYear, pxPerYear);
          return (
            <div className="river-lane" key={lane.traditionId}>
              <div className="river-lane__header">
                <span className="river-lane__label">{lane.traditionLabel}</span>
                <span className="river-lane__count">{lane.entities.length}</span>
              </div>
              <div className="river-lane__track" style={{ width: `${trackWidth}px` }}>
                {chips.map(({ entity, left, row }) => (
                  <button
                    key={entity.id}
                    type="button"
                    className={[
                      "river-lane__chip",
                      entity.importance === "featured" ? "river-lane__chip--featured" : "",
                      entity.isSelected ? "is-selected" : "",
                      entity.isDimmed ? "is-dimmed" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    data-entity-type={entity.entityType}
                    onClick={() => onSelect(entity.id as KnowledgeEntityId)}
                    style={{ left: `${left}px`, top: `${ROW_TOP_PX[row]}px` }}
                  >
                    <span className="river-lane__chip-label">{entity.label}</span>
                    <span className="river-lane__chip-sub">
                      {entity.entityType} · {entity.primaryYear}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}

        {undatedOrUnassigned.length > 0 ? (
          <div className="river-lane river-lane--unassigned">
            <div className="river-lane__header">
              <span className="river-lane__label">Unassigned / undated</span>
              <span className="river-lane__count">{undatedOrUnassigned.length}</span>
            </div>
            <div className="river-lane__track river-lane__track--flow">
              {undatedOrUnassigned.map((entity) => (
                <button
                  key={entity.id}
                  type="button"
                  className={[
                    "river-lane__chip",
                    entity.isSelected ? "is-selected" : "",
                    entity.isDimmed ? "is-dimmed" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  data-entity-type={entity.entityType}
                  onClick={() => onSelect(entity.id as KnowledgeEntityId)}
                >
                  <span className="river-lane__chip-label">{entity.label}</span>
                  <span className="river-lane__chip-sub">{entity.entityType}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
