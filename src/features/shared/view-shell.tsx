import { EmptyStateCard } from "@/components/shared/empty-state-card";
import { getEntityDateLabel, getEntityTypeLabel } from "@/data/entity-index";
import { getCondensedActiveFilterSummary } from "@/data/filter-controls";
import { useHistoricalRuntime } from "@/historical/runtime-context";
import { useExplorerStore } from "@/state/explorer-store";
import type { KnowledgeEntity } from "@/types";

interface ViewShellProps {
  eyebrow: string;
  title: string;
  description: string;
  items: KnowledgeEntity[];
  emptyMessage: string;
  itemMeta?: (entity: KnowledgeEntity) => string;
}

export function ViewShell({
  eyebrow,
  title,
  description,
  items,
  emptyMessage,
  itemMeta,
}: ViewShellProps) {
  const selectedEntityId = useExplorerStore((state) => state.selectedEntityId);
  const activeView = useExplorerStore((state) => state.activeView);
  const selectEntity = useExplorerStore((state) => state.selectEntity);
  const filters = useExplorerStore((state) => state.filters);
  const resetFilters = useExplorerStore((state) => state.resetFilters);
  const { index } = useHistoricalRuntime();
  const activeFilterSummary = getCondensedActiveFilterSummary(filters, index);

  return (
    <div className="view-shell">
      <div className="view-shell__header">
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>

      {items.length === 0 ? (
        <EmptyStateCard
          activeFilterSummary={activeFilterSummary}
          description={
            activeFilterSummary.length > 0
              ? "No records match; clear these filters to reopen the shared scope."
              : emptyMessage
          }
          eyebrow={eyebrow}
          onResetFilters={resetFilters}
          title={
            activeFilterSummary.length > 0
              ? "No records match the current scope."
              : "This view has no records yet."
          }
        />
      ) : (
        <div className="view-shell__grid">
          {items.map((entity) => (
            <button
              key={entity.id}
              className={`entity-card${selectedEntityId === entity.id ? " is-selected" : ""}`}
              onClick={() => selectEntity(entity.id, entity.entityType, activeView)}
              type="button"
            >
              <span className="entity-card__type">{getEntityTypeLabel(entity.entityType)}</span>
              <strong>{entity.label}</strong>
              <span className="entity-card__date">{getEntityDateLabel(entity)}</span>
              <p>{entity.description}</p>
              <span className="entity-card__meta">
                {itemMeta?.(entity) ?? `${entity.domainIds.length} domain link(s)`}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
