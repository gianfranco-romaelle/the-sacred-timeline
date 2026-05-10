import { useMemo } from "react";
import { getCondensedActiveFilterSummary } from "@/data/filter-controls";
import { useHistoricalRuntime } from "@/historical/runtime-context";
import { useExplorerStore } from "@/state/explorer-store";

export function useViewCoordination(summaryLimit = 6) {
  const filters = useExplorerStore((state) => state.filters);
  const selectedEntityId = useExplorerStore((state) => state.selectedEntityId);
  const selectedRelationId = useExplorerStore((state) => state.selectedRelationId);
  const selectionSourceView = useExplorerStore((state) => state.selectionSourceView);
  const selectEntity = useExplorerStore((state) => state.selectEntity);
  const selectRelation = useExplorerStore((state) => state.selectRelation);
  const resetFilters = useExplorerStore((state) => state.resetFilters);
  const { index } = useHistoricalRuntime();

  const activeFilterSummary = useMemo(
    () => getCondensedActiveFilterSummary(filters, index, summaryLimit),
    [filters, index, summaryLimit],
  );

  return {
    filters,
    index,
    selectedEntityId,
    selectedRelationId,
    selectionSourceView,
    activeFilterSummary,
    resetFilters,
    selectFromView: selectEntity,
    selectRelationFromView: selectRelation,
  };
}
