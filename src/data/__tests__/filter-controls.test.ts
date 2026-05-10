import { describe, expect, it } from "vitest";
import {
  getExpandedActiveFilterTokens,
  getCondensedActiveFilterSummary,
  getFilterScopeLabel,
  getTimePresetOptions,
  getTimePresetLabel,
  getRelationTypeLabel,
  getEntityTypeOptions,
  getRelationTypeOptions,
  getDomainOptions,
  getGeographyOptions,
} from "@/data/filter-controls";
import { buildSeedIndex } from "@/data/entity-index";
import { defaultExplorerFilters } from "@/state/explorer-store";
import type {
  DomainId,
  EdgeId,
  PlaceId,
  SacredTimelineSeedData,
  TraditionId,
  RecordId,
} from "@/types";

const emptySeed: SacredTimelineSeedData = {
  meta: { datasetId: "test", title: "T", description: "", version: "0", generatedAt: "" },
  domains: [],
  tags: [],
  sources: [],
  citations: [],
  portraitAssets: [],
  people: [],
  texts: [],
  concepts: [],
  events: [],
  places: [],
  institutions: [],
  traditions: [],
  edges: [],
};

const emptyIndex = buildSeedIndex(emptySeed);

describe("getExpandedActiveFilterTokens", () => {
  it("returns no tokens for default filters", () => {
    const tokens = getExpandedActiveFilterTokens(defaultExplorerFilters, emptyIndex);
    expect(tokens).toHaveLength(0);
  });

  it("adds an AI-hypotheses-hidden token when showAiHypotheses is false", () => {
    const filters = { ...defaultExplorerFilters, showAiHypotheses: false };
    const tokens = getExpandedActiveFilterTokens(filters, emptyIndex);
    const aiToken = tokens.find((t) => t.key === "no-ai-hypotheses");
    expect(aiToken).toBeDefined();
    expect(aiToken?.label).toBe("AI hypotheses hidden");
    expect(aiToken?.category).toBe("relation");
  });

  it("does not add an AI token when showAiHypotheses is true (default)", () => {
    const tokens = getExpandedActiveFilterTokens(defaultExplorerFilters, emptyIndex);
    expect(tokens.some((t) => t.key === "no-ai-hypotheses")).toBe(false);
  });
});

describe("getCondensedActiveFilterSummary", () => {
  it("returns empty array for default filters", () => {
    expect(getCondensedActiveFilterSummary(defaultExplorerFilters, emptyIndex)).toHaveLength(0);
  });

  it("includes 'AI hypotheses off' when showAiHypotheses is false", () => {
    const filters = { ...defaultExplorerFilters, showAiHypotheses: false };
    const summary = getCondensedActiveFilterSummary(filters, emptyIndex);
    expect(summary).toContain("AI hypotheses off");
  });

  it("respects the maxItems cap", () => {
    const filters = {
      ...defaultExplorerFilters,
      showAiHypotheses: false,
      includeUndated: false,
    };
    const summary = getCondensedActiveFilterSummary(filters, emptyIndex, 1);
    expect(summary).toHaveLength(1);
  });
});

describe("getFilterScopeLabel", () => {
  it("returns 'All records in scope' for default filters", () => {
    expect(getFilterScopeLabel(defaultExplorerFilters, emptyIndex)).toBe("All records in scope");
  });

  it("counts the AI-hypotheses-hidden token in the active filter count", () => {
    const filters = { ...defaultExplorerFilters, showAiHypotheses: false };
    const label = getFilterScopeLabel(filters, emptyIndex);
    expect(label).toMatch(/1 active filter/);
  });

  it("uses plural 'filters' for multiple active filters", () => {
    const filters = { ...defaultExplorerFilters, showAiHypotheses: false, includeUndated: false };
    const label = getFilterScopeLabel(filters, emptyIndex);
    expect(label).toMatch(/active filters/);
  });
});

describe("getTimePresetOptions", () => {
  it("returns 5 preset options", () => {
    expect(getTimePresetOptions()).toHaveLength(5);
  });

  it("includes all, ancient, medieval, early-modern, modern", () => {
    const ids = getTimePresetOptions().map((o) => o.id);
    expect(ids).toContain("all");
    expect(ids).toContain("ancient");
    expect(ids).toContain("medieval");
    expect(ids).toContain("early-modern");
    expect(ids).toContain("modern");
  });

  it("each option has a non-empty label and description", () => {
    for (const option of getTimePresetOptions()) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.description!.length).toBeGreaterThan(0);
    }
  });
});

describe("getTimePresetLabel", () => {
  it("returns All eras for all", () => {
    expect(getTimePresetLabel("all")).toBe("All eras");
  });

  it("returns Medieval for medieval", () => {
    expect(getTimePresetLabel("medieval")).toBe("Medieval");
  });
});

describe("getRelationTypeLabel", () => {
  it("replaces underscores with spaces", () => {
    expect(getRelationTypeLabel("influenced")).toBe("influenced");
    expect(getRelationTypeLabel("corresponded_with")).toBe("corresponded with");
  });
});

describe("getEntityTypeOptions", () => {
  it("returns 7 entity types", () => {
    expect(getEntityTypeOptions()).toHaveLength(7);
  });

  it("starts with person", () => {
    expect(getEntityTypeOptions()[0].id).toBe("person");
  });

  it("includes all canonical types", () => {
    const ids = getEntityTypeOptions().map((o) => o.id);
    expect(ids).toContain("person");
    expect(ids).toContain("text");
    expect(ids).toContain("concept");
    expect(ids).toContain("event");
    expect(ids).toContain("place");
    expect(ids).toContain("institution");
    expect(ids).toContain("tradition");
  });
});

describe("getRelationTypeOptions", () => {
  it("returns empty array for seed with no edges", () => {
    expect(getRelationTypeOptions(emptySeed)).toHaveLength(0);
  });

  it("returns one option per distinct relationType in edges", () => {
    const seed: SacredTimelineSeedData = {
      ...emptySeed,
      edges: [
        {
          id: "e1" as EdgeId,
          recordType: "edge",
          relationType: "influenced",
          label: "e1",
          description: "",
          sourceId: "p_a" as RecordId,
          targetId: "p_b" as RecordId,
          direction: "directed",
          domainIds: [],
          tagIds: [],
          citationIds: [],
          relatedEntityIds: [],
          mediaAssetIds: [],
          weight: 1,
        },
        {
          id: "e2" as EdgeId,
          recordType: "edge",
          relationType: "influenced",
          label: "e2",
          description: "",
          sourceId: "p_b" as RecordId,
          targetId: "p_c" as RecordId,
          direction: "directed",
          domainIds: [],
          tagIds: [],
          citationIds: [],
          relatedEntityIds: [],
          mediaAssetIds: [],
          weight: 1,
        },
        {
          id: "e3" as EdgeId,
          recordType: "edge",
          relationType: "corresponded_with",
          label: "e3",
          description: "",
          sourceId: "p_a" as RecordId,
          targetId: "p_c" as RecordId,
          direction: "directed",
          domainIds: [],
          tagIds: [],
          citationIds: [],
          relatedEntityIds: [],
          mediaAssetIds: [],
          weight: 1,
        },
      ],
    };
    const options = getRelationTypeOptions(seed);
    expect(options).toHaveLength(2);
    expect(options.map((o) => o.id).sort()).toEqual(["corresponded_with", "influenced"]);
  });
});

describe("getDomainOptions", () => {
  it("returns empty array for seed with no domains", () => {
    expect(getDomainOptions(emptySeed)).toHaveLength(0);
  });

  it("maps domain fields to FilterOption shape", () => {
    const seed: SacredTimelineSeedData = {
      ...emptySeed,
      domains: [
        {
          id: "domain_science" as DomainId,
          slug: "science",
          label: "Science",
          description: "Natural science",
          kind: "knowledge" as any,
        },
      ],
    };
    const options = getDomainOptions(seed);
    expect(options).toHaveLength(1);
    expect(options[0]).toEqual({
      id: "domain_science",
      label: "Science",
      description: "Natural science",
    });
  });
});

describe("getGeographyOptions", () => {
  it("returns empty array for seed with no places having geometry", () => {
    expect(getGeographyOptions(emptySeed)).toHaveLength(0);
  });

  it("includes only places with a geometry.point", () => {
    const seed: SacredTimelineSeedData = {
      ...emptySeed,
      places: [
        {
          id: "place_bingen" as PlaceId,
          entityType: "place",
          slug: "bingen",
          label: "Bingen",
          description: "",
          domainIds: [],
          tagIds: [],
          citationIds: [],
          relatedEntityIds: [],
          mediaAssetIds: [],
          placeType: "city" as any,
          geometry: { point: { latitude: 49.96, longitude: 7.9 } },
        },
        {
          id: "place_noloc" as PlaceId,
          entityType: "place",
          slug: "noloc",
          label: "No Location",
          description: "",
          domainIds: [],
          tagIds: [],
          citationIds: [],
          relatedEntityIds: [],
          mediaAssetIds: [],
          placeType: "city" as any,
        },
      ],
    };
    const options = getGeographyOptions(seed);
    expect(options).toHaveLength(1);
    expect(options[0].id).toBe("place_bingen");
  });
});

describe("getExpandedActiveFilterTokens — extended", () => {
  it("adds a time-preset token for non-all presets", () => {
    const filters = { ...defaultExplorerFilters, timePreset: "medieval" as const };
    const tokens = getExpandedActiveFilterTokens(filters, emptyIndex);
    expect(tokens.find((t) => t.key === "time-preset-medieval")).toBeDefined();
    expect(tokens.find((t) => t.category === "time")).toBeDefined();
  });

  it("adds a time-range token when startYear is set", () => {
    const filters = { ...defaultExplorerFilters, startYear: 500 };
    const tokens = getExpandedActiveFilterTokens(filters, emptyIndex);
    expect(tokens.find((t) => t.key === "time-range")).toBeDefined();
  });

  it("adds a dated-only token when includeUndated is false", () => {
    const filters = { ...defaultExplorerFilters, includeUndated: false };
    const tokens = getExpandedActiveFilterTokens(filters, emptyIndex);
    expect(tokens.find((t) => t.key === "dated-only")).toBeDefined();
  });

  it("adds entity-type tokens for each active type", () => {
    const filters = { ...defaultExplorerFilters, entityTypes: ["person", "text"] as any };
    const tokens = getExpandedActiveFilterTokens(filters, emptyIndex);
    expect(tokens.filter((t) => t.category === "entityType")).toHaveLength(2);
  });

  it("adds relation tokens for each active relation type", () => {
    const filters = { ...defaultExplorerFilters, relationTypes: ["influenced" as const] };
    const tokens = getExpandedActiveFilterTokens(filters, emptyIndex);
    expect(tokens.filter((t) => t.category === "relation").some((t) => t.key === "relation-influenced")).toBe(true);
  });

  it("adds a neighborhood token when a local entity scope is active", () => {
    const filters = { ...defaultExplorerFilters, localEntityIds: ["person_a", "person_b"] as any };
    const tokens = getExpandedActiveFilterTokens(filters, emptyIndex);
    expect(tokens.find((t) => t.key === "local-entity-scope")?.label).toBe(
      "Neighborhood: 2 records",
    );
  });
});

describe("getCondensedActiveFilterSummary — extended", () => {
  it("includes preset label for non-all preset", () => {
    const filters = { ...defaultExplorerFilters, timePreset: "medieval" as const };
    expect(getCondensedActiveFilterSummary(filters, emptyIndex)).toContain("Medieval");
  });

  it("summarises single entity type by label", () => {
    const filters = { ...defaultExplorerFilters, entityTypes: ["person"] as any };
    expect(getCondensedActiveFilterSummary(filters, emptyIndex)).toContain("Person");
  });

  it("summarises multiple entity types by count", () => {
    const filters = { ...defaultExplorerFilters, entityTypes: ["person", "text"] as any };
    const summary = getCondensedActiveFilterSummary(filters, emptyIndex);
    expect(summary.some((s) => s.includes("entity types"))).toBe(true);
  });

  it("includes time range label when range is active", () => {
    const filters = { ...defaultExplorerFilters, startYear: 500, endYear: 1500 };
    const summary = getCondensedActiveFilterSummary(filters, emptyIndex);
    expect(summary.some((s) => s.includes("500"))).toBe(true);
  });

  it("summarises a local entity scope", () => {
    const filters = { ...defaultExplorerFilters, localEntityIds: ["person_a", "person_b"] as any };
    expect(getCondensedActiveFilterSummary(filters, emptyIndex)).toContain("2 scoped records");
  });
});
