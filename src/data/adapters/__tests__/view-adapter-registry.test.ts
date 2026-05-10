import { describe, expect, it } from "vitest";
import {
  buildStandardProjection,
  viewProjectionRegistry,
} from "@/data/adapters/view-adapter-registry";
import { buildSeedIndex } from "@/data/entity-index";
import { initialMockSeed } from "@/data/mockData";
import { defaultExplorerFilters } from "@/state/explorer-store";

const index = buildSeedIndex(initialMockSeed);
const baseInput = {
  seed: initialMockSeed,
  index,
  filters: defaultExplorerFilters,
};

describe("viewProjectionRegistry", () => {
  it("builds standard projections with stable projectionKind values", () => {
    expect(buildStandardProjection("river", baseInput).projectionKind).toBe("river");
    expect(buildStandardProjection("constellation", baseInput).projectionKind).toBe("constellation");
    expect(buildStandardProjection("atlas", baseInput).projectionKind).toBe("atlas");
  });

  it("builds the Face Atlas projection with view-local grouping options", () => {
    const projection = viewProjectionRegistry["face-atlas"]({
      ...baseInput,
      grouping: "era",
      sort: "prominence",
    });

    expect(projection.projectionKind).toBe("face-atlas");
    expect(projection.grouping).toBe("era");
    expect(projection.sort).toBe("prominence");
  });
});
