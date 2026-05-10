/**
 * Tests for useExplorerStore — the shared substrate/selection state.
 * This is the actual store backing all five views (River, Constellation,
 * Atlas, Face Atlas, Scriptorium).
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  useExplorerStore,
  defaultExplorerFilters,
} from "./src/state/explorer-store";
import type { CanonicalEntityType, EdgeId, PersonId } from "./src/types";

const resetStore = () => {
  useExplorerStore.setState({
    activeView: "river",
    selectedEntityId: undefined,
    selectedEntityType: undefined,
    selectedRelationId: undefined,
    selectionSourceView: undefined,
    editorialFocusedStage: undefined,
    filters: { ...defaultExplorerFilters },
  });
};

describe("useExplorerStore — entity selection", () => {
  beforeEach(resetStore);

  it("starts with no selection", () => {
    const { selectedEntityId } = useExplorerStore.getState();
    expect(selectedEntityId).toBeUndefined();
  });

  it("selectEntity updates selectedEntityId and selectedEntityType", () => {
    useExplorerStore
      .getState()
      .selectEntity("person_laurent" as PersonId, "person", "river");
    const { selectedEntityId, selectedEntityType, selectionSourceView } =
      useExplorerStore.getState();
    expect(selectedEntityId).toBe("person_laurent");
    expect(selectedEntityType).toBe("person");
    expect(selectionSourceView).toBe("river");
  });

  it("clearSelection resets selection fields", () => {
    useExplorerStore
      .getState()
      .selectEntity("person_laurent" as PersonId, "person", "river");
    useExplorerStore.getState().selectRelation("edge_laurent_gerhardt" as EdgeId, "constellation");
    useExplorerStore.getState().clearSelection();
    const { selectedEntityId, selectedEntityType, selectedRelationId } = useExplorerStore.getState();
    expect(selectedEntityId).toBeUndefined();
    expect(selectedEntityType).toBeUndefined();
    expect(selectedRelationId).toBeUndefined();
  });

  it("selection survives a filter update (cross-view continuity)", () => {
    useExplorerStore
      .getState()
      .selectEntity("person_laurent" as PersonId, "person", "constellation");
    useExplorerStore.getState().toggleEntityType("text");
    const { selectedEntityId, filters } = useExplorerStore.getState();
    expect(selectedEntityId).toBe("person_laurent");
    expect(filters.entityTypes).toContain("text");
  });

  it("selectRelation records a shared morphism focus without replacing entity focus", () => {
    useExplorerStore
      .getState()
      .selectEntity("person_laurent" as PersonId, "person", "river");
    useExplorerStore.getState().selectRelation("edge_laurent_gerhardt" as EdgeId, "constellation");
    const { selectedEntityId, selectedRelationId, selectionSourceView } = useExplorerStore.getState();

    expect(selectedEntityId).toBe("person_laurent");
    expect(selectedRelationId).toBe("edge_laurent_gerhardt");
    expect(selectionSourceView).toBe("constellation");
  });
});

describe("useExplorerStore — view navigation", () => {
  beforeEach(resetStore);

  it("setActiveView updates the active view", () => {
    useExplorerStore.getState().setActiveView("constellation");
    expect(useExplorerStore.getState().activeView).toBe("constellation");
  });

  it("all five views are reachable", () => {
    const views = ["river", "constellation", "atlas", "face-atlas", "scriptorium"] as const;
    for (const view of views) {
      useExplorerStore.getState().setActiveView(view);
      expect(useExplorerStore.getState().activeView).toBe(view);
    }
  });
});

describe("useExplorerStore — filter operations", () => {
  beforeEach(resetStore);

  it("toggleEntityType adds a type to the filter list", () => {
    useExplorerStore.getState().toggleEntityType("person");
    expect(useExplorerStore.getState().filters.entityTypes).toContain("person");
  });

  it("toggleEntityType removes a type that is already in the filter list", () => {
    useExplorerStore.getState().toggleEntityType("person");
    useExplorerStore.getState().toggleEntityType("person");
    expect(useExplorerStore.getState().filters.entityTypes).not.toContain("person");
  });

  it("setTimeRange updates startYear and endYear", () => {
    useExplorerStore.getState().setTimeRange(1750, 1900);
    const { filters } = useExplorerStore.getState();
    expect(filters.startYear).toBe(1750);
    expect(filters.endYear).toBe(1900);
  });

  it("resetFilters restores defaults while preserving selection", () => {
    useExplorerStore
      .getState()
      .selectEntity("person_laurent" as PersonId, "person", "river");
    useExplorerStore.getState().toggleEntityType("text" as CanonicalEntityType);
    useExplorerStore.getState().resetFilters();

    const { filters, selectedEntityId } = useExplorerStore.getState();
    expect(filters.entityTypes).toHaveLength(0);
    expect(selectedEntityId).toBe("person_laurent");
  });
});

describe("useExplorerStore — editorial mode", () => {
  beforeEach(resetStore);

  it("enableEditorialMode activates editorial mode", () => {
    useExplorerStore.getState().enableEditorialMode();
    expect(useExplorerStore.getState().filters.editorialMode).toBe(true);
  });

  it("disableEditorialMode deactivates editorial mode", () => {
    useExplorerStore.getState().enableEditorialMode();
    useExplorerStore.getState().disableEditorialMode();
    expect(useExplorerStore.getState().filters.editorialMode).toBe(false);
  });

  it("editorial mode does not change selectedEntityId", () => {
    useExplorerStore
      .getState()
      .selectEntity("person_laurent" as PersonId, "person", "river");
    useExplorerStore.getState().enableEditorialMode();
    expect(useExplorerStore.getState().selectedEntityId).toBe("person_laurent");
  });
});

describe("useExplorerStore — assertion layer controls", () => {
  beforeEach(resetStore);

  it("showAiHypotheses defaults to true", () => {
    expect(useExplorerStore.getState().filters.showAiHypotheses).toBe(true);
  });

  it("setShowAiHypotheses(false) suppresses AI hypothesis edges", () => {
    useExplorerStore.getState().setShowAiHypotheses(false);
    expect(useExplorerStore.getState().filters.showAiHypotheses).toBe(false);
  });

  it("setShowAiHypotheses(true) re-enables AI hypotheses", () => {
    useExplorerStore.getState().setShowAiHypotheses(false);
    useExplorerStore.getState().setShowAiHypotheses(true);
    expect(useExplorerStore.getState().filters.showAiHypotheses).toBe(true);
  });

  it("resetFilters restores showAiHypotheses to true", () => {
    useExplorerStore.getState().setShowAiHypotheses(false);
    useExplorerStore.getState().resetFilters();
    expect(useExplorerStore.getState().filters.showAiHypotheses).toBe(true);
  });

  it("showAiHypotheses toggle survives entity selection", () => {
    useExplorerStore.getState().setShowAiHypotheses(false);
    useExplorerStore
      .getState()
      .selectEntity("person_laurent" as PersonId, "person", "river");
    expect(useExplorerStore.getState().filters.showAiHypotheses).toBe(false);
    expect(useExplorerStore.getState().selectedEntityId).toBe("person_laurent");
  });
});
