export type RiverGroupingMode = "era" | "century" | "tradition";

interface RiverControlsProps {
  groupingMode: RiverGroupingMode;
  onGroupingModeChange: (mode: RiverGroupingMode) => void;
  itemCount: number;
  activeFilterSummary: string[];
  densityHint?: string;
  isEditorialMode: boolean;
  editorialScopeMode: string;
}

export function RiverControls({
  groupingMode,
  onGroupingModeChange,
  itemCount,
  activeFilterSummary,
  densityHint,
  isEditorialMode,
  editorialScopeMode,
}: RiverControlsProps) {
  const usesEditorialGrouping =
    isEditorialMode && editorialScopeMode !== "standard-chronology";

  return (
    <div className="river-controls">
      <div className="river-controls__intro">
        <p className="eyebrow">River of Time</p>
        <h2>Flowing chronology</h2>
        <p>
          A horizontal manuscript-like timeline that groups the canon by large historical periods
          or finer century bands.
          {usesEditorialGrouping
            ? " Editorial bands keep chronology visible within each grouped lens."
            : ""}
        </p>
      </div>

      <div className="river-controls__meta">
        <div className="river-segmented-control" role="tablist" aria-label="Timeline grouping">
          <button
            className={`river-segmented-control__button${groupingMode === "era" ? " is-active" : ""}`}
            disabled={usesEditorialGrouping}
            onClick={() => onGroupingModeChange("era")}
            type="button"
          >
            Era
          </button>
          <button
            className={`river-segmented-control__button${groupingMode === "century" ? " is-active" : ""}`}
            disabled={usesEditorialGrouping}
            onClick={() => onGroupingModeChange("century")}
            type="button"
          >
            Century
          </button>
          <button
            className={`river-segmented-control__button${groupingMode === "tradition" ? " is-active" : ""}`}
            disabled={usesEditorialGrouping}
            onClick={() => onGroupingModeChange("tradition")}
            title="Group the river into tradition lanes — one band per intellectual tradition"
            type="button"
          >
            Tradition
          </button>
        </div>

        <div className="river-controls__summary">
          <span>{itemCount} visible records</span>
          {usesEditorialGrouping ? (
            <span className="river-controls__scope">
              {editorialScopeMode.replaceAll("-", " ")} active
            </span>
          ) : null}
          {densityHint ? <span className="river-controls__scope">{densityHint}</span> : null}
          {activeFilterSummary.length > 0 ? (
            <div className="river-controls__chips">
              {activeFilterSummary.map((item) => (
                <span className="river-controls__chip" key={item}>
                  {item}
                </span>
              ))}
            </div>
          ) : (
            <span className="river-controls__scope">All records in scope</span>
          )}
        </div>
      </div>
    </div>
  );
}
