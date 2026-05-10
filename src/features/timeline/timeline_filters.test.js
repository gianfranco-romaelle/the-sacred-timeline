import { describe, expect, it } from "vitest";

import {
  buildTagGraphElements,
  compareTimelineItems,
  toggleListValue,
} from "@/features/timeline/timeline_filters";

describe("timeline_filters", () => {
  it("sorts by sort index before chronological fallback", () => {
    const items = [
      { id: "later", name: "Later", sortIndex: 2, startYear: 1900, endYear: 1900 },
      { id: "earlier", name: "Earlier", sortIndex: 1, startYear: 2000, endYear: 2000 },
    ];

    const sorted = [...items].sort(compareTimelineItems);
    expect(sorted.map((item) => item.id)).toEqual(["earlier", "later"]);
  });

  it("toggles values in filter lists", () => {
    expect(toggleListValue(["science"], "religion")).toEqual(["science", "religion"]);
    expect(toggleListValue(["science", "religion"], "science")).toEqual(["religion"]);
  });

  it("builds tag graph metadata from visible items", () => {
    const graph = buildTagGraphElements([
      {
        id: "item-1",
        name: "Item One",
        type: "person",
        startYear: 100,
        endYear: 110,
        color: "#123456",
        images: [],
        tags: ["optics", "vision", "optics"],
      },
      {
        id: "item-2",
        name: "Item Two",
        type: "event",
        startYear: 120,
        endYear: 120,
        color: "#654321",
        images: [],
        tags: ["vision"],
      },
    ]);

    expect(graph.entryCount).toBe(2);
    expect(graph.tagCount).toBe(2);
    expect(graph.edgeCount).toBe(3);
    expect(graph.nodeCount).toBe(4);
  });
});
