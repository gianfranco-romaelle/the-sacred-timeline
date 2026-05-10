import { describe, expect, it } from "vitest";

import {
  buildChronoItems,
  buildFilteredTimelineItems,
  collectTimelineFilterOptions,
  countActiveTimelineFilters,
  getChronoYearOffset,
} from "@/features/timeline/timeline_projection";

const sampleItems = [
  {
    id: "b",
    type: "event",
    name: "Later Event",
    startYear: 1200,
    endYear: 1200,
    era: "Medieval",
    category: "Religion",
    school: "Monastic",
    historicalPeriod: "High Medieval",
    images: [],
    sortYear: 1200,
    searchText: "later event religion monastic",
  },
  {
    id: "a",
    type: "person",
    name: "Earlier Figure",
    startYear: -30,
    endYear: 10,
    era: "Classical / Late Antiquity",
    category: "Science",
    school: "Alexandria",
    historicalPeriod: "Late Antiquity",
    images: ["https://example.com/portrait.jpg"],
    sortYear: -30,
    searchText: "earlier figure science alexandria",
  },
];

describe("timeline_projection", () => {
  it("collects sorted filter options from items", () => {
    const options = collectTimelineFilterOptions(sampleItems);

    expect(options.categories).toEqual(["Religion", "Science"]);
    expect(options.schools).toEqual(["Alexandria", "Monastic"]);
    expect(options.periods).toEqual(["High Medieval", "Late Antiquity"]);
    expect(options.eras).toContain("Medieval");
  });

  it("counts active filter buckets", () => {
    expect(countActiveTimelineFilters({
      typeFilter: ["person"],
      eraFilter: ["Medieval"],
      categoryFilter: [],
      schoolFilter: ["Alexandria"],
      periodFilter: [],
    })).toBe(3);
  });

  it("filters and sorts timeline items consistently", () => {
    const results = buildFilteredTimelineItems(sampleItems, {
      query: "figure",
      typeFilter: ["person"],
      eraFilter: [],
      categoryFilter: [],
      schoolFilter: [],
      periodFilter: [],
    });

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("a");
  });

  it("computes a chrono offset for BCE ranges", () => {
    expect(getChronoYearOffset(sampleItems)).toBe(31);
  });

  it("builds chrono items with stable ids and optional media", () => {
    const chrono = buildChronoItems(sampleItems, 31, (item) => item.name);

    expect(chrono[0].id).toBe("b");
    expect(chrono[1].id).toBe("a");
    expect(chrono[0].media).toBeUndefined();
    expect(chrono[1].media?.source?.url).toBe("https://example.com/portrait.jpg");
  });
});
