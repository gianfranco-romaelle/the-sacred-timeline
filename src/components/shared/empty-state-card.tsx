interface EmptyStateCardProps {
  eyebrow: string;
  title: string;
  description: string;
  activeFilterSummary?: string[];
  onResetFilters?: () => void;
}

export function EmptyStateCard({
  eyebrow,
  title,
  description,
  activeFilterSummary = [],
  onResetFilters,
}: EmptyStateCardProps) {
  return (
    <div className="empty-state-card">
      <p className="eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      <p>{description}</p>
      {activeFilterSummary.length > 0 ? (
        <div className="empty-state-card__filters">
          {activeFilterSummary.map((item) => (
            <span className="empty-state-card__chip" key={item}>
              {item}
            </span>
          ))}
        </div>
      ) : null}
      {onResetFilters ? (
        <button className="empty-state-card__reset" onClick={onResetFilters} type="button">
          Clear filters
        </button>
      ) : null}
    </div>
  );
}
