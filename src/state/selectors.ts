import type { ExplorerFilters, ExplorerStoreState } from "./explorer-store";

export const countBaseFilterSignals = (filters: ExplorerFilters) => {
  let count = 0;

  if (filters.timePreset !== "all") {
    count += 1;
  }

  if (typeof filters.startYear === "number" || typeof filters.endYear === "number") {
    count += 1;
  }

  if (!filters.includeUndated) {
    count += 1;
  }

  count += filters.entityTypes.length;
  count += filters.domainIds.length;
  count += filters.traditionIds.length;
  count += filters.tagIds.length;
  count += filters.relationTypes.length;
  count += filters.geographyPlaceIds.length;
  if (filters.localEntityIds.length > 0) {
    count += 1;
  }

  if (!filters.showAiHypotheses) {
    count += 1;
  }

  return count;
};

export const countEditorialFilterSignals = (filters: ExplorerFilters) => {
  if (!filters.editorialMode) {
    return 0;
  }

  let count = 1;

  if (filters.editorialScopeMode !== "standard-chronology") {
    count += 1;
  }

  if (filters.showEditorialLabels) {
    count += 1;
  }

  count += filters.calculusStages.length;
  count += filters.quantumStages.length;
  count += filters.editorialCrosswalks.length;

  return count;
};

export const hasActiveEditorialControls = (filters: ExplorerFilters) =>
  filters.editorialMode &&
  (filters.editorialScopeMode !== "standard-chronology" ||
    filters.showEditorialLabels ||
    filters.calculusStages.length > 0 ||
    filters.quantumStages.length > 0 ||
    filters.editorialCrosswalks.length > 0);

export const selectActiveView = (state: ExplorerStoreState) => state.activeView;
export const selectFilters = (state: ExplorerStoreState) => state.filters;
export const selectTimeFilter = (state: ExplorerStoreState) => ({
  timePreset: state.filters.timePreset,
  startYear: state.filters.startYear,
  endYear: state.filters.endYear,
  includeUndated: state.filters.includeUndated,
  editorialMode: state.filters.editorialMode,
  editorialChronology: state.filters.editorialChronology,
  editorialScopeMode: state.filters.editorialScopeMode,
  showEditorialLabels: state.filters.showEditorialLabels,
  calculusStages: state.filters.calculusStages,
  quantumStages: state.filters.quantumStages,
  editorialCrosswalks: state.filters.editorialCrosswalks,
});
export const selectSelection = (state: ExplorerStoreState) => ({
  selectedEntityId: state.selectedEntityId,
  selectedEntityType: state.selectedEntityType,
  selectedRelationId: state.selectedRelationId,
  selectionSourceView: state.selectionSourceView,
});
export const selectSelectedEntityId = (state: ExplorerStoreState) => state.selectedEntityId;
export const selectSelectedEntityType = (state: ExplorerStoreState) => state.selectedEntityType;
export const selectSelectedRelationId = (state: ExplorerStoreState) => state.selectedRelationId;
export const selectSelectionSourceView = (state: ExplorerStoreState) => state.selectionSourceView;
export const selectEntityTypeFilters = (state: ExplorerStoreState) => state.filters.entityTypes;
export const selectDomainFilters = (state: ExplorerStoreState) => state.filters.domainIds;
export const selectTraditionFilters = (state: ExplorerStoreState) => state.filters.traditionIds;
export const selectTagFilters = (state: ExplorerStoreState) => state.filters.tagIds;
export const selectRelationTypeFilters = (state: ExplorerStoreState) => state.filters.relationTypes;
export const selectGeographyFilters = (state: ExplorerStoreState) => state.filters.geographyPlaceIds;
export const selectCalculusStageFilters = (state: ExplorerStoreState) => state.filters.calculusStages;
export const selectQuantumStageFilters = (state: ExplorerStoreState) => state.filters.quantumStages;
export const selectEditorialMode = (state: ExplorerStoreState) => state.filters.editorialMode;
export const selectEditorialScopeMode = (state: ExplorerStoreState) => state.filters.editorialScopeMode;
export const selectEditorialState = (state: ExplorerStoreState) => ({
  editorialMode: state.filters.editorialMode,
  editorialScopeMode: state.filters.editorialScopeMode,
  editorialChronology: state.filters.editorialChronology,
  showEditorialLabels: state.filters.showEditorialLabels,
  calculusStages: state.filters.calculusStages,
  quantumStages: state.filters.quantumStages,
  editorialCrosswalks: state.filters.editorialCrosswalks,
  editorialFocusedStage: state.editorialFocusedStage,
  hasActiveEditorialControls: hasActiveEditorialControls(state.filters),
});

export const hasActiveFilters = (state: ExplorerStoreState) =>
  countBaseFilterSignals(state.filters) + countEditorialFilterSignals(state.filters) > 0;

export const selectHasActiveFilters = (state: ExplorerStoreState) => hasActiveFilters(state);
export const selectActiveFilterCount = (state: ExplorerStoreState) =>
  countBaseFilterSignals(state.filters) + countEditorialFilterSignals(state.filters);

export const hasSharedContext = (state: ExplorerStoreState) =>
  Boolean(state.selectedEntityId || state.selectedRelationId);
