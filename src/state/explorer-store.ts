import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import type {
  CanonicalEntityType,
  DomainId,
  EdgeId,
  EdgeRelationType,
  KnowledgeEntityId,
  PlaceId,
  TagId,
  TraditionId,
} from "@/types";
import type { TimePreset } from "@/data/entity-index";
import type {
  CalculusStage,
  EditorialChronologyMode,
  EditorialCrosswalkDimension,
  EditorialScopeMode,
  QuantumStage,
} from "@/editorial/types";

export type ExplorerView =
  | "river"
  | "constellation"
  | "atlas"
  | "face-atlas"
  | "scriptorium";

export interface ExplorerFilters {
  timePreset: TimePreset;
  startYear?: number;
  endYear?: number;
  includeUndated: boolean;
  editorialMode: boolean;
  editorialChronology: EditorialChronologyMode;
  editorialScopeMode: EditorialScopeMode;
  showEditorialLabels: boolean;
  calculusStages: CalculusStage[];
  quantumStages: QuantumStage[];
  editorialCrosswalks: EditorialCrosswalkDimension[];
  entityTypes: CanonicalEntityType[];
  domainIds: DomainId[];
  traditionIds: TraditionId[];
  tagIds: TagId[];
  relationTypes: EdgeRelationType[];
  geographyPlaceIds: PlaceId[];
  localEntityIds: KnowledgeEntityId[];
  showAiHypotheses: boolean;
}

export interface SavedLocalScope {
  id: string;
  label: string;
  createdAt: string;
  filters: ExplorerFilters;
}

export interface ExplorerPanelState {
  filtersCollapsed: boolean;
  inspectorCollapsed: boolean;
  inspectorDetached: boolean;
  inspectorPosition: {
    x: number;
    y: number;
  };
}

export interface ExplorerStoreState {
  activeView: ExplorerView;
  selectedEntityId?: KnowledgeEntityId;
  selectedEntityType?: CanonicalEntityType;
  selectedRelationId?: EdgeId;
  selectionSourceView?: ExplorerView;
  editorialFocusedStage?: CalculusStage;
  filters: ExplorerFilters;
  savedLocalScopes: SavedLocalScope[];
  panels: ExplorerPanelState;
  setActiveView: (view: ExplorerView) => void;
  selectEntity: (
    entityId: KnowledgeEntityId,
    entityType: CanonicalEntityType,
    sourceView?: ExplorerView,
  ) => void;
  selectRelation: (relationId: EdgeId, sourceView?: ExplorerView) => void;
  clearSelection: () => void;
  setTimePreset: (preset: TimePreset) => void;
  setTimeRange: (startYear?: number, endYear?: number) => void;
  setIncludeUndated: (includeUndated: boolean) => void;
  enableEditorialMode: (focusedStage?: CalculusStage) => void;
  disableEditorialMode: () => void;
  setEditorialMode: (editorialMode: boolean) => void;
  setEditorialChronology: (mode: EditorialChronologyMode) => void;
  setEditorialScopeMode: (mode: EditorialScopeMode) => void;
  setEditorialFocusedStage: (stage?: CalculusStage) => void;
  focusEditorialStage: (stage: CalculusStage, scopeMode?: EditorialScopeMode) => void;
  setShowEditorialLabels: (showEditorialLabels: boolean) => void;
  setCalculusStages: (stages: CalculusStage[]) => void;
  setQuantumStages: (stages: QuantumStage[]) => void;
  setEditorialCrosswalks: (dimensions: EditorialCrosswalkDimension[]) => void;
  toggleCalculusStage: (stage: CalculusStage) => void;
  toggleQuantumStage: (stage: QuantumStage) => void;
  toggleEditorialCrosswalk: (dimension: EditorialCrosswalkDimension) => void;
  toggleEntityType: (entityType: CanonicalEntityType) => void;
  toggleDomain: (domainId: DomainId) => void;
  toggleTradition: (traditionId: TraditionId) => void;
  toggleTag: (tagId: TagId) => void;
  toggleRelationType: (relationType: EdgeRelationType) => void;
  toggleGeographyPlace: (placeId: PlaceId) => void;
  focusEntityNeighborhood: (entityIds: KnowledgeEntityId[], label?: string) => void;
  setShowAiHypotheses: (show: boolean) => void;
  saveCurrentScope: (label?: string) => void;
  applySavedScope: (scopeId: string) => void;
  removeSavedScope: (scopeId: string) => void;
  setFiltersCollapsed: (filtersCollapsed: boolean) => void;
  setInspectorCollapsed: (inspectorCollapsed: boolean) => void;
  setInspectorDetached: (inspectorDetached: boolean) => void;
  setInspectorPosition: (position: ExplorerPanelState["inspectorPosition"]) => void;
  resetFilters: () => void;
}

export const defaultExplorerFilters: ExplorerFilters = {
  timePreset: "all",
  startYear: undefined,
  endYear: undefined,
  includeUndated: true,
  editorialMode: false,
  editorialChronology: "historical",
  editorialScopeMode: "standard-chronology",
  showEditorialLabels: false,
  calculusStages: [],
  quantumStages: [],
  editorialCrosswalks: [],
  entityTypes: [],
  domainIds: [],
  traditionIds: [],
  tagIds: [],
  relationTypes: [],
  geographyPlaceIds: [],
  localEntityIds: [],
  showAiHypotheses: true,
};

const defaultPanelState: ExplorerPanelState = {
  filtersCollapsed: false,
  inspectorCollapsed: false,
  inspectorDetached: false,
  inspectorPosition: { x: 0, y: 80 },
};

const memoryStorage = (): StateStorage => {
  const store = new Map<string, string>();

  return {
    getItem: (name) => store.get(name) ?? null,
    setItem: (name, value) => {
      store.set(name, value);
    },
    removeItem: (name) => {
      store.delete(name);
    },
  };
};

const getExplorerStorage = () => {
  if (typeof window === "undefined") {
    return memoryStorage();
  }

  try {
    return window.localStorage;
  } catch {
    return memoryStorage();
  }
};

const toggleValue = <T,>(items: T[], value: T) =>
  items.includes(value) ? items.filter((item) => item !== value) : [...items, value];

const normalizeEditorialFilters = (
  filters: ExplorerFilters,
  editorialMode = filters.editorialMode,
): ExplorerFilters => ({
  ...filters,
  editorialMode,
  editorialChronology:
    editorialMode && filters.editorialScopeMode !== "standard-chronology"
      ? "editorial"
      : "historical",
  showEditorialLabels: editorialMode ? filters.showEditorialLabels : false,
});

const withUpdatedFilters = (
  state: ExplorerStoreState,
  updater: (filters: ExplorerFilters) => ExplorerFilters,
) => ({
  filters: normalizeEditorialFilters(updater(state.filters)),
});

export const useExplorerStore = create<ExplorerStoreState>()(
  persist(
    (set) => ({
      activeView: "river",
      selectedEntityId: undefined,
      selectedEntityType: undefined,
      selectedRelationId: undefined,
      selectionSourceView: undefined,
      editorialFocusedStage: undefined,
      filters: defaultExplorerFilters,
      savedLocalScopes: [],
      panels: defaultPanelState,
      setActiveView: (view) => set({ activeView: view }),
      selectEntity: (entityId, entityType, sourceView) =>
        set({
          selectedEntityId: entityId,
          selectedEntityType: entityType,
          selectedRelationId: undefined,
          selectionSourceView: sourceView,
        }),
      selectRelation: (relationId, sourceView) =>
        set({
          selectedRelationId: relationId,
          selectionSourceView: sourceView,
        }),
      clearSelection: () =>
        set({
          selectedEntityId: undefined,
          selectedEntityType: undefined,
          selectedRelationId: undefined,
          selectionSourceView: undefined,
        }),
      setTimePreset: (preset) =>
        set((state) => withUpdatedFilters(state, (filters) => ({ ...filters, timePreset: preset }))),
      setTimeRange: (startYear, endYear) =>
        set((state) => withUpdatedFilters(state, (filters) => ({ ...filters, startYear, endYear }))),
      setIncludeUndated: (includeUndated) =>
        set((state) => withUpdatedFilters(state, (filters) => ({ ...filters, includeUndated }))),
      enableEditorialMode: (focusedStage) =>
        set((state) => ({
          editorialFocusedStage: focusedStage ?? state.editorialFocusedStage ?? state.filters.calculusStages[0],
          filters: normalizeEditorialFilters(
            {
              ...state.filters,
              editorialMode: true,
              showEditorialLabels: true,
            },
            true,
          ),
        })),
      disableEditorialMode: () =>
        set((state) => ({
          editorialFocusedStage: undefined,
          filters: normalizeEditorialFilters(
            {
              ...state.filters,
              editorialMode: false,
            },
            false,
          ),
        })),
      setEditorialMode: (editorialMode) =>
        set((state) => ({
          editorialFocusedStage: editorialMode ? state.editorialFocusedStage : undefined,
          filters: normalizeEditorialFilters(
            {
              ...state.filters,
              editorialMode,
            },
            editorialMode,
          ),
        })),
      setEditorialChronology: (editorialChronology) =>
        set((state) => ({
          filters: {
            ...state.filters,
            editorialChronology,
          },
        })),
      setEditorialScopeMode: (editorialScopeMode) =>
        set((state) =>
          withUpdatedFilters(state, (filters) => ({
            ...filters,
            editorialScopeMode,
          })),
        ),
      setEditorialFocusedStage: (editorialFocusedStage) => set({ editorialFocusedStage }),
      focusEditorialStage: (stage, scopeMode = "crosswalk") =>
        set((state) => ({
          editorialFocusedStage: stage,
          filters: normalizeEditorialFilters(
            {
              ...state.filters,
              editorialMode: true,
              editorialScopeMode: scopeMode,
              showEditorialLabels: true,
            },
            true,
          ),
        })),
      setShowEditorialLabels: (showEditorialLabels) =>
        set((state) => withUpdatedFilters(state, (filters) => ({ ...filters, showEditorialLabels }))),
      setCalculusStages: (calculusStages) =>
        set((state) => withUpdatedFilters(state, (filters) => ({ ...filters, calculusStages }))),
      setQuantumStages: (quantumStages) =>
        set((state) => withUpdatedFilters(state, (filters) => ({ ...filters, quantumStages }))),
      setEditorialCrosswalks: (editorialCrosswalks) =>
        set((state) =>
          withUpdatedFilters(state, (filters) => ({ ...filters, editorialCrosswalks })),
        ),
      toggleCalculusStage: (stage) =>
        set((state) =>
          withUpdatedFilters(state, (filters) => ({
            ...filters,
            calculusStages: toggleValue(filters.calculusStages, stage),
          })),
        ),
      toggleQuantumStage: (stage) =>
        set((state) =>
          withUpdatedFilters(state, (filters) => ({
            ...filters,
            quantumStages: toggleValue(filters.quantumStages, stage),
          })),
        ),
      toggleEditorialCrosswalk: (dimension) =>
        set((state) =>
          withUpdatedFilters(state, (filters) => ({
            ...filters,
            editorialCrosswalks: toggleValue(filters.editorialCrosswalks, dimension),
          })),
        ),
      toggleEntityType: (entityType) =>
        set((state) =>
          withUpdatedFilters(state, (filters) => ({
            ...filters,
            entityTypes: toggleValue(filters.entityTypes, entityType),
          })),
        ),
      toggleDomain: (domainId) =>
        set((state) =>
          withUpdatedFilters(state, (filters) => ({
            ...filters,
            domainIds: toggleValue(filters.domainIds, domainId),
          })),
        ),
      toggleTradition: (traditionId) =>
        set((state) =>
          withUpdatedFilters(state, (filters) => ({
            ...filters,
            traditionIds: toggleValue(filters.traditionIds, traditionId),
          })),
        ),
      toggleTag: (tagId) =>
        set((state) =>
          withUpdatedFilters(state, (filters) => ({
            ...filters,
            tagIds: toggleValue(filters.tagIds, tagId),
          })),
        ),
      toggleRelationType: (relationType) =>
        set((state) =>
          withUpdatedFilters(state, (filters) => ({
            ...filters,
            relationTypes: toggleValue(filters.relationTypes, relationType),
          })),
        ),
      toggleGeographyPlace: (placeId) =>
        set((state) =>
          withUpdatedFilters(state, (filters) => ({
            ...filters,
            geographyPlaceIds: toggleValue(filters.geographyPlaceIds, placeId),
          })),
        ),
      focusEntityNeighborhood: (entityIds, label) =>
        set((state) => {
          const localEntityIds = Array.from(new Set(entityIds));
          const createdAt = new Date().toISOString();
          const filters = normalizeEditorialFilters({
            ...defaultExplorerFilters,
            localEntityIds,
          });
          const scope =
            localEntityIds.length > 0
              ? {
                  id: `scope_${Date.now().toString(36)}`,
                  label: label?.trim() || `Neighborhood (${localEntityIds.length})`,
                  createdAt,
                  filters,
                }
              : undefined;

          return {
            filters,
            savedLocalScopes: scope
              ? [scope, ...state.savedLocalScopes].slice(0, 8)
              : state.savedLocalScopes,
          };
        }),
      setShowAiHypotheses: (show) =>
        set((state) =>
          withUpdatedFilters(state, (filters) => ({ ...filters, showAiHypotheses: show })),
        ),
      saveCurrentScope: (label) =>
        set((state) => {
          const createdAt = new Date().toISOString();
          const scope: SavedLocalScope = {
            id: `scope_${Date.now().toString(36)}`,
            label: label?.trim() || `Local scope ${state.savedLocalScopes.length + 1}`,
            createdAt,
            filters: { ...state.filters },
          };

          return {
            savedLocalScopes: [scope, ...state.savedLocalScopes].slice(0, 8),
          };
        }),
      applySavedScope: (scopeId) =>
        set((state) => {
          const scope = state.savedLocalScopes.find((item) => item.id === scopeId);
          return scope ? { filters: normalizeEditorialFilters({ ...scope.filters }) } : {};
        }),
      removeSavedScope: (scopeId) =>
        set((state) => ({
          savedLocalScopes: state.savedLocalScopes.filter((scope) => scope.id !== scopeId),
        })),
      setFiltersCollapsed: (filtersCollapsed) =>
        set((state) => ({ panels: { ...state.panels, filtersCollapsed } })),
      setInspectorCollapsed: (inspectorCollapsed) =>
        set((state) => ({ panels: { ...state.panels, inspectorCollapsed } })),
      setInspectorDetached: (inspectorDetached) =>
        set((state) => ({ panels: { ...state.panels, inspectorDetached } })),
      setInspectorPosition: (inspectorPosition) =>
        set((state) => ({ panels: { ...state.panels, inspectorPosition } })),
      resetFilters: () =>
        set((state) => ({
          filters: { ...defaultExplorerFilters },
          selectedEntityId: state.selectedEntityId,
          selectedEntityType: state.selectedEntityType,
          selectedRelationId: state.selectedRelationId,
          selectionSourceView: state.selectionSourceView,
          editorialFocusedStage: undefined,
        })),
    }),
    {
      name: "sacred-timeline-explorer-store",
      storage: createJSONStorage(getExplorerStorage),
      partialize: (state) => ({
        activeView: state.activeView,
        selectedEntityId: state.selectedEntityId,
        selectedEntityType: state.selectedEntityType,
        selectedRelationId: state.selectedRelationId,
        selectionSourceView: state.selectionSourceView,
        editorialFocusedStage: state.editorialFocusedStage,
        filters: state.filters,
        savedLocalScopes: state.savedLocalScopes,
        panels: state.panels,
      }),
      merge: (persisted, current) => {
        const persistedState = persisted as Partial<ExplorerStoreState> | undefined;
        return {
          ...current,
          ...persistedState,
          filters: {
            ...defaultExplorerFilters,
            ...(persistedState?.filters ?? {}),
          },
          panels: {
            ...defaultPanelState,
            ...(persistedState?.panels ?? {}),
            inspectorPosition: {
              ...defaultPanelState.inspectorPosition,
              ...(persistedState?.panels?.inspectorPosition ?? {}),
            },
          },
          savedLocalScopes: persistedState?.savedLocalScopes ?? [],
        };
      },
    },
  ),
);
