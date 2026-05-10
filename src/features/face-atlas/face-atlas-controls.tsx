import type {
  FaceAtlasGrouping,
  FaceAtlasSort,
} from "@/data/adapters/face-atlas-adapter";

interface FaceAtlasControlsProps {
  grouping: FaceAtlasGrouping;
  sort: FaceAtlasSort;
  portraitCount: number;
  entityCount: number;
  activeFilterSummary: string[];
  onGroupingChange: (grouping: FaceAtlasGrouping) => void;
  onSortChange: (sort: FaceAtlasSort) => void;
}

const groupingLabels: Record<FaceAtlasGrouping, string> = {
  era: "Era",
  domain: "Domain",
  tradition: "Tradition",
  entityType: "Entity type",
};

const sortLabels: Record<FaceAtlasSort, string> = {
  chronological: "Chronological",
  label: "Alphabetical",
  prominence: "Prominence",
};

export function FaceAtlasControls({
  grouping,
  sort,
  portraitCount,
  entityCount,
  activeFilterSummary,
  onGroupingChange,
  onSortChange,
}: FaceAtlasControlsProps) {
  return (
    <div className="face-atlas-controls">
      <div className="face-atlas-controls__intro">
        <p className="eyebrow">Face Atlas</p>
        <h2>Curated likeness field</h2>
        <p>
          Portrait assets are treated as independent scholarly objects, allowing the archive to be
          explored through depiction, likeness, and visual memory rather than chronology alone.
        </p>
      </div>

      <div className="face-atlas-controls__meta">
        <span>{portraitCount} portraits</span>
        <span>{entityCount} depicted entities</span>
      </div>

      <div className="face-atlas-controls__rows">
        <div className="face-atlas-controls__row">
          <span className="face-atlas-controls__label">Group by</span>
          <div className="face-atlas-segmented">
            {Object.entries(groupingLabels).map(([key, label]) => (
              <button
                key={key}
                className={`face-atlas-segmented__button${grouping === key ? " is-active" : ""}`}
                onClick={() => onGroupingChange(key as FaceAtlasGrouping)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="face-atlas-controls__row">
          <span className="face-atlas-controls__label">Sort</span>
          <div className="face-atlas-segmented">
            {Object.entries(sortLabels).map(([key, label]) => (
              <button
                key={key}
                className={`face-atlas-segmented__button${sort === key ? " is-active" : ""}`}
                onClick={() => onSortChange(key as FaceAtlasSort)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {activeFilterSummary.length > 0 ? (
        <div className="face-atlas-controls__chips">
          {activeFilterSummary.map((item) => (
            <span className="face-atlas-controls__chip" key={item}>
              {item}
            </span>
          ))}
        </div>
      ) : (
        <p className="face-atlas-controls__scope">All portrait-bearing records in scope.</p>
      )}
    </div>
  );
}
