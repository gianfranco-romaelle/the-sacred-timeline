import { LocateFixed, Network, Route, Users } from "lucide-react";
import type { EdgeRelationType } from "@/types";

interface AtlasControlsProps {
  pointCount: number;
  placeCount: number;
  connectionCount: number;
  activeFilterSummary: string[];
  selectedLabel?: string;
  canZoomToSelection: boolean;
  clusterPlaces: boolean;
  showRoutes: boolean;
  activeRelationTypes: EdgeRelationType[];
  availableRelationTypes: EdgeRelationType[];
  timeExtent?: { startYear: number; endYear: number };
  activeYear?: number;
  onClusterPlacesChange: (clusterPlaces: boolean) => void;
  onShowRoutesChange: (showRoutes: boolean) => void;
  onToggleRelationType: (relationType: EdgeRelationType) => void;
  onTimeScrub: (year: number) => void;
  onResetTimeScrub: () => void;
  onZoomToSelection: () => void;
}

export function AtlasControls({
  pointCount,
  placeCount,
  connectionCount,
  activeFilterSummary,
  selectedLabel,
  canZoomToSelection,
  clusterPlaces,
  showRoutes,
  activeRelationTypes,
  availableRelationTypes,
  timeExtent,
  activeYear,
  onClusterPlacesChange,
  onShowRoutesChange,
  onToggleRelationType,
  onTimeScrub,
  onResetTimeScrub,
  onZoomToSelection,
}: AtlasControlsProps) {
  const hasTimeScrub = Boolean(timeExtent && typeof activeYear === "number");
  const hasActiveRouteFilter = activeRelationTypes.length > 0;

  return (
    <div className="atlas-controls">
      <div className="atlas-controls__intro">
        <p className="eyebrow">Atlas</p>
        <h2>Transmission across place</h2>
        <p>
          Geographic emphasis reveals where people, institutions, texts, and events gather into
          scholarly and religious centers, and where relation data can suggest movement between
          them.
        </p>
      </div>

      <div className="atlas-controls__summary">
        <span>{pointCount} mapped records</span>
        <span>{placeCount} visible places</span>
        <span>{connectionCount} transmission routes</span>
        {selectedLabel ? <span>Focused on {selectedLabel}</span> : null}
      </div>

      <div className="atlas-controls__panel" aria-label="Atlas map controls">
        <div className="atlas-controls__row">
          <span className="atlas-controls__label">Map</span>
          <div className="atlas-segmented">
            <button
              className={`atlas-segmented__button${clusterPlaces ? " is-active" : ""}`}
              onClick={() => onClusterPlacesChange(true)}
              title="Cluster mapped entities by place"
              type="button"
            >
              <Users aria-hidden="true" size={16} />
              Places
            </button>
            <button
              className={`atlas-segmented__button${clusterPlaces ? "" : " is-active"}`}
              onClick={() => onClusterPlacesChange(false)}
              title="Show individual mapped entities"
              type="button"
            >
              <Network aria-hidden="true" size={16} />
              Entities
            </button>
          </div>
          <button
            className={`atlas-icon-button${showRoutes ? " is-active" : ""}`}
            onClick={() => onShowRoutesChange(!showRoutes)}
            title={showRoutes ? "Hide routes" : "Show routes"}
            type="button"
          >
            <Route aria-hidden="true" size={17} />
          </button>
          <button
            className="atlas-icon-button"
            disabled={!canZoomToSelection}
            onClick={onZoomToSelection}
            title="Zoom to selected"
            type="button"
          >
            <LocateFixed aria-hidden="true" size={17} />
          </button>
        </div>

        {availableRelationTypes.length > 0 ? (
          <div className="atlas-controls__row">
            <span className="atlas-controls__label">Routes</span>
            <div className="atlas-controls__chips is-control-row">
              {availableRelationTypes.map((relationType) => {
                const isActive = !hasActiveRouteFilter || activeRelationTypes.includes(relationType);
                return (
                  <button
                    className={`atlas-controls__chip-button${isActive ? " is-active" : ""}`}
                    key={relationType}
                    onClick={() => onToggleRelationType(relationType)}
                    type="button"
                  >
                    {relationType.replaceAll("_", " ")}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {hasTimeScrub && timeExtent ? (
          <div className="atlas-controls__row is-scrubber">
            <span className="atlas-controls__label">Time</span>
            <input
              aria-label="Scrub geographic spread by year"
              max={timeExtent.endYear}
              min={timeExtent.startYear}
              onChange={(event) => onTimeScrub(Number(event.currentTarget.value))}
              step={1}
              type="range"
              value={activeYear}
            />
            <span className="atlas-controls__year">{activeYear}</span>
            <button className="atlas-controls__reset" onClick={onResetTimeScrub} type="button">
              All years
            </button>
          </div>
        ) : null}
      </div>

      {activeFilterSummary.length > 0 ? (
        <div className="atlas-controls__chips">
          {activeFilterSummary.map((item) => (
            <span className="atlas-controls__chip" key={item}>
              {item}
            </span>
          ))}
        </div>
      ) : (
        <p className="atlas-controls__scope">All geographically resolved records in scope.</p>
      )}
    </div>
  );
}
