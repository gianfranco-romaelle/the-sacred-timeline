import type { ScriptoriumMode } from "@/data/adapters/scriptorium-adapter";

interface ScriptoriumControlsProps {
  mapTitle: string;
  mapDescription: string;
  galleryCount: number;
  edgeCount: number;
  exhibitCount: number;
  reviewCount: number;
  activeFilterSummary: string[];
  mode: ScriptoriumMode;
  onModeChange: (mode: ScriptoriumMode) => void;
}

const modes: Array<{ id: ScriptoriumMode; label: string }> = [
  { id: "gallery", label: "Gallery" },
  { id: "map", label: "Relationship Map" },
  { id: "exhibits", label: "Exhibit Builder" },
  { id: "review", label: "Review Queue" },
];

export function ScriptoriumControls({
  mapTitle,
  mapDescription,
  galleryCount,
  edgeCount,
  exhibitCount,
  reviewCount,
  activeFilterSummary,
  mode,
  onModeChange,
}: ScriptoriumControlsProps) {
  return (
    <div className="scriptorium-controls">
      <div className="scriptorium-controls__intro">
        <div className="scriptorium-controls__heading">
          <p className="eyebrow">Scriptorium</p>
          <span className="scriptorium-controls__badge">Authoring v1</span>
        </div>
        <h2>{mapTitle}</h2>
        <p>{mapDescription}</p>
      </div>

      <div className="scriptorium-controls__tabs" role="tablist" aria-label="Scriptorium modes">
        {modes.map((item) => (
          <button
            className={`scriptorium-controls__tab${mode === item.id ? " is-active" : ""}`}
            key={item.id}
            onClick={() => onModeChange(item.id)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="scriptorium-controls__meta">
        <span>{galleryCount} gallery records</span>
        <span>{edgeCount} visible links</span>
        <span>{exhibitCount} exhibits</span>
        <span>{reviewCount} review items</span>
      </div>

      {activeFilterSummary.length > 0 ? (
        <div className="scriptorium-controls__chips">
          {activeFilterSummary.map((item) => (
            <span className="scriptorium-controls__chip" key={item}>
              {item}
            </span>
          ))}
        </div>
      ) : (
        <p className="scriptorium-controls__scope">
          Showing the full canonical scope plus local Scriptorium authoring overlays.
        </p>
      )}
    </div>
  );
}
