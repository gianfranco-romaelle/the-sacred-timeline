import type { ProvenanceEntry } from "@/historical/types";

interface ProvenanceBadgeListProps {
  entries: ProvenanceEntry[];
}

export function ProvenanceBadgeList({ entries }: ProvenanceBadgeListProps) {
  if (entries.length === 0) {
    return <p className="admin-panel__muted">No provenance entries recorded yet.</p>;
  }

  return (
    <div className="admin-panel__provenance-list">
      {entries.map((entry) => (
        <article className="admin-panel__provenance-item" key={entry.id}>
          <div className="admin-panel__provenance">
            <span className="admin-panel__provenance-badge">
              {entry.sourceKind.replaceAll("_", " ")}
            </span>
            {typeof entry.confidence === "number" ? (
              <span className="admin-panel__provenance-score">
                {Math.round(entry.confidence)}%
              </span>
            ) : null}
          </div>
          {entry.valueLabel ? (
            <span className="admin-panel__provenance-value">{entry.valueLabel}</span>
          ) : null}
          {entry.path ? <span className="admin-panel__provenance-path">{entry.path}</span> : null}
          {entry.note ? <span className="admin-panel__provenance-note">{entry.note}</span> : null}
        </article>
      ))}
    </div>
  );
}
