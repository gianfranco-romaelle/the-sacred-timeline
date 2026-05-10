import { describe, expect, it } from "vitest";
import {
  countBaseFilterSignals,
  countEditorialFilterSignals,
  hasActiveEditorialControls,
  hasActiveFilters,
  hasSharedContext,
  selectActiveFilterCount,
} from "@/state/selectors";
import { defaultExplorerFilters } from "@/state/explorer-store";
import type { ExplorerFilters, ExplorerStoreState } from "@/state/explorer-store";

const makeState = (
  overrides: Partial<ExplorerStoreState> = {},
): ExplorerStoreState => {
  const state: ExplorerStoreState = {
    activeView: "river",
    selectedEntityId: undefined,
    selectedEntityType: undefined,
    selectedRelationId: undefined,
    selectionSourceView: undefined,
    editorialFocusedStage: undefined,
    filters: defaultExplorerFilters,
    savedLocalScopes: [],
    panels: {
      filtersCollapsed: false,
      inspectorCollapsed: false,
      inspectorDetached: false,
      inspectorPosition: { x: 0, y: 80 },
    },
    setActiveView: () => {},
    selectEntity: () => {},
    selectRelation: () => {},
    clearSelection: () => {},
    setTimePreset: () => {},
    setTimeRange: () => {},
    setIncludeUndated: () => {},
    enableEditorialMode: () => {},
    disableEditorialMode: () => {},
    setEditorialMode: () => {},
    setEditorialChronology: () => {},
    setEditorialScopeMode: () => {},
    setEditorialFocusedStage: () => {},
    focusEditorialStage: () => {},
    setShowEditorialLabels: () => {},
    setCalculusStages: () => {},
    setQuantumStages: () => {},
    setEditorialCrosswalks: () => {},
    toggleCalculusStage: () => {},
    toggleQuantumStage: () => {},
    toggleEditorialCrosswalk: () => {},
    toggleEntityType: () => {},
    toggleDomain: () => {},
    toggleTradition: () => {},
    toggleTag: () => {},
    toggleRelationType: () => {},
    toggleGeographyPlace: () => {},
    focusEntityNeighborhood: () => {},
    setShowAiHypotheses: () => {},
    saveCurrentScope: () => {},
    applySavedScope: () => {},
    removeSavedScope: () => {},
    setFiltersCollapsed: () => {},
    setInspectorCollapsed: () => {},
    setInspectorDetached: () => {},
    setInspectorPosition: () => {},
    resetFilters: () => {},
  };

  Object.assign(state, overrides);
  return state;
};

const makeFilters = (overrides: Partial<ExplorerFilters> = {}): ExplorerFilters => ({
  ...defaultExplorerFilters,
  ...overrides,
});

describe("countBaseFilterSignals", () => {
  it("returns 0 for default filters", () => {
    expect(countBaseFilterSignals(defaultExplorerFilters)).toBe(0);
  });

  it("counts non-'all' time preset as 1", () => {
    expect(countBaseFilterSignals(makeFilters({ timePreset: "medieval" }))).toBe(1);
  });

  it("counts explicit startYear as 1", () => {
    expect(countBaseFilterSignals(makeFilters({ startYear: 500 }))).toBe(1);
  });

  it("counts startYear and endYear together as 1 signal", () => {
    expect(countBaseFilterSignals(makeFilters({ startYear: 500, endYear: 1500 }))).toBe(1);
  });

  it("counts includeUndated=false as 1", () => {
    expect(countBaseFilterSignals(makeFilters({ includeUndated: false }))).toBe(1);
  });

  it("counts showAiHypotheses=false as 1", () => {
    expect(countBaseFilterSignals(makeFilters({ showAiHypotheses: false }))).toBe(1);
  });

  it("counts each entity type filter individually", () => {
    expect(
      countBaseFilterSignals(makeFilters({ entityTypes: ["person", "text"] })),
    ).toBe(2);
  });

  it("counts each domain filter individually", () => {
    expect(
      countBaseFilterSignals(makeFilters({ domainIds: ["domain_a", "domain_b", "domain_c"] as any })),
    ).toBe(3);
  });

  it("accumulates multiple base signals", () => {
    const filters = makeFilters({
      timePreset: "medieval",
      entityTypes: ["person"],
      domainIds: ["domain_a"] as any,
      showAiHypotheses: false,
    });
    expect(countBaseFilterSignals(filters)).toBe(4);
  });

  it("counts a local neighborhood scope as 1", () => {
    expect(
      countBaseFilterSignals(makeFilters({ localEntityIds: ["person_a", "person_b"] as any })),
    ).toBe(1);
  });
});

describe("countEditorialFilterSignals", () => {
  it("returns 0 when editorial mode is off", () => {
    expect(countEditorialFilterSignals(defaultExplorerFilters)).toBe(0);
  });

  it("returns 1 when editorial mode is on with no extras", () => {
    expect(countEditorialFilterSignals(makeFilters({ editorialMode: true }))).toBe(1);
  });

  it("adds 1 for non-standard scope mode", () => {
    expect(
      countEditorialFilterSignals(
        makeFilters({ editorialMode: true, editorialScopeMode: "crosswalk" }),
      ),
    ).toBe(2);
  });

  it("adds 1 for showEditorialLabels", () => {
    expect(
      countEditorialFilterSignals(
        makeFilters({ editorialMode: true, showEditorialLabels: true }),
      ),
    ).toBe(2);
  });

  it("counts each calculus stage individually", () => {
    expect(
      countEditorialFilterSignals(
        makeFilters({ editorialMode: true, calculusStages: ["pre-axial", "axial"] as any }),
      ),
    ).toBe(3);
  });

  it("counts each quantum stage individually", () => {
    expect(
      countEditorialFilterSignals(
        makeFilters({ editorialMode: true, quantumStages: ["q1"] as any }),
      ),
    ).toBe(2);
  });

  it("counts each editorial crosswalk individually", () => {
    expect(
      countEditorialFilterSignals(
        makeFilters({ editorialMode: true, editorialCrosswalks: ["crosswalk_a", "crosswalk_b"] as any }),
      ),
    ).toBe(3);
  });
});

describe("hasActiveEditorialControls", () => {
  it("returns false when editorial mode is off", () => {
    expect(hasActiveEditorialControls(defaultExplorerFilters)).toBe(false);
  });

  it("returns false when editorial mode is on but no controls are active", () => {
    expect(hasActiveEditorialControls(makeFilters({ editorialMode: true }))).toBe(false);
  });

  it("returns true when editorial mode on and scope mode is non-standard", () => {
    expect(
      hasActiveEditorialControls(
        makeFilters({ editorialMode: true, editorialScopeMode: "crosswalk" }),
      ),
    ).toBe(true);
  });

  it("returns true when editorial mode on and showEditorialLabels", () => {
    expect(
      hasActiveEditorialControls(
        makeFilters({ editorialMode: true, showEditorialLabels: true }),
      ),
    ).toBe(true);
  });

  it("returns true when calculus stages are set", () => {
    expect(
      hasActiveEditorialControls(
        makeFilters({ editorialMode: true, calculusStages: ["pre-axial"] as any }),
      ),
    ).toBe(true);
  });
});

describe("hasActiveFilters", () => {
  it("returns false for default state", () => {
    expect(hasActiveFilters(makeState())).toBe(false);
  });

  it("returns true when a base filter is active", () => {
    expect(
      hasActiveFilters(makeState({ filters: makeFilters({ timePreset: "medieval" }) })),
    ).toBe(true);
  });

  it("returns true when editorial mode is active", () => {
    expect(
      hasActiveFilters(makeState({ filters: makeFilters({ editorialMode: true }) })),
    ).toBe(true);
  });
});

describe("selectActiveFilterCount", () => {
  it("returns 0 for default state", () => {
    expect(selectActiveFilterCount(makeState())).toBe(0);
  });

  it("sums base and editorial signals", () => {
    const state = makeState({
      filters: makeFilters({
        timePreset: "medieval",
        editorialMode: true,
        showEditorialLabels: true,
      }),
    });
    expect(selectActiveFilterCount(state)).toBe(3);
  });
});

describe("hasSharedContext", () => {
  it("returns false when nothing is selected", () => {
    expect(hasSharedContext(makeState())).toBe(false);
  });

  it("returns true when an entity is selected", () => {
    expect(
      hasSharedContext(makeState({ selectedEntityId: "person_a" as any })),
    ).toBe(true);
  });

  it("returns true when a relation is selected", () => {
    expect(
      hasSharedContext(makeState({ selectedRelationId: "edge_a_b" as any })),
    ).toBe(true);
  });
});
