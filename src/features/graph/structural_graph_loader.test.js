import { describe, expect, it } from "vitest";

import {
  formatStructuralGraphYearRange,
  getDefaultStructuralGraphBundleLayout,
  getStructuralGraphBundleLayout,
  normalizeStructuralGraphStatePayload,
  parseStructuralGraphDataItemId,
} from "@/features/graph/structural_graph_loader";

describe("structural_graph_loader", () => {
  it("returns a safe default bundle layout", () => {
    expect(getDefaultStructuralGraphBundleLayout()).toEqual({
      view: {
        zoom: 1,
        scrollLeft: 0,
        scrollTop: 0,
      },
      selection: [],
      nodes: {},
    });
  });

  it("normalizes graph state and clamps invalid values", () => {
    const payload = normalizeStructuralGraphStatePayload({
      bundleLayouts: {
        calculus: {
          view: { zoom: 9, scrollLeft: -20, scrollTop: 15 },
          selection: ["node-1", 4, null],
          nodes: {
            "node-1": { x: "20", y: "35", title: "Title", subtitle: "Subtitle" },
            "node-2": "bad",
          },
        },
      },
    });

    expect(payload.bundleLayouts.calculus.view.zoom).toBeGreaterThan(0);
    expect(payload.bundleLayouts.calculus.view.scrollLeft).toBe(0);
    expect(payload.bundleLayouts.calculus.selection).toEqual(["node-1"]);
    expect(payload.bundleLayouts.calculus.nodes["node-1"]).toEqual({
      x: 20,
      y: 35,
      title: "Title",
      subtitle: "Subtitle",
    });
  });

  it("falls back to a default layout when a bundle key is missing", () => {
    const layout = getStructuralGraphBundleLayout({ bundleLayouts: {} }, "historicalPeriod");
    expect(layout).toEqual(getDefaultStructuralGraphBundleLayout());
  });

  it("parses graph-backed item ids and formats year ranges", () => {
    expect(parseStructuralGraphDataItemId("g-item-isaac-newton")).toBe("isaac-newton");
    expect(parseStructuralGraphDataItemId("plain-node")).toBeNull();
    expect(formatStructuralGraphYearRange({ startYear: -3, endYear: 14 })).toBe("3 BCE - 14 CE");
  });
});
