import { describe, expect, it } from "vitest";
import { buildScriptoriumProjection } from "@/data/adapters/scriptorium-adapter";
import { buildSeedIndex } from "@/data/entity-index";
import { sacredTimelineSeed } from "@/data/sacred-timeline.seed";
import { defaultExplorerFilters } from "@/state/explorer-store";

const index = buildSeedIndex(sacredTimelineSeed);

describe("scriptorium-adapter", () => {
  it("projects the unified gallery without requiring backend data", () => {
    const projection = buildScriptoriumProjection(
      sacredTimelineSeed,
      index,
      defaultExplorerFilters,
    );

    expect(projection.projectionKind).toBe("scriptorium");
    expect(projection.sourceLayer).toBe("canonical_plus_authoring_overlay");
    expect(projection.visibleCounts.galleryItems).toBe(projection.galleryItems.length);
    expect(projection.visibleCounts.nodes).toBe(projection.nodes.length);
    expect(projection.visibleCounts.edges).toBe(projection.edges.length);
    expect(projection.galleryItems.length).toBeGreaterThan(0);
    expect(projection.instagramReferences.length).toBeGreaterThan(0);
  });

  it("intersects gallery items with the shared entity-type filters", () => {
    const projection = buildScriptoriumProjection(
      sacredTimelineSeed,
      index,
      {
        ...defaultExplorerFilters,
        entityTypes: ["person"],
      },
    );

    expect(projection.galleryItems.length).toBeGreaterThan(0);
    expect(projection.galleryItems.every((item) => item.entityType === "person")).toBe(true);
    expect(
      projection.edges.every(
        (edge) =>
          projection.nodes.some((node) => node.id === edge.source) &&
          projection.nodes.some((node) => node.id === edge.target),
      ),
    ).toBe(true);
  });

  it("preserves cross-view selection in authored nodes", () => {
    const baseProjection = buildScriptoriumProjection(
      sacredTimelineSeed,
      index,
      defaultExplorerFilters,
    );
    const selectedEntityId = baseProjection.nodes[0]?.entityId;

    const selectedProjection = buildScriptoriumProjection(
      sacredTimelineSeed,
      index,
      defaultExplorerFilters,
      selectedEntityId,
      "river",
    );

    expect(selectedProjection.nodes.some((node) => node.isSelected)).toBe(true);
    expect(
      selectedProjection.nodes.find((node) => node.entityId === selectedEntityId)?.isSelected,
    ).toBe(true);
  });

  it("counts Instagram references linked from an authoring overlay", () => {
    const firstEntity = sacredTimelineSeed.texts[0] ?? sacredTimelineSeed.people[0];
    const projection = buildScriptoriumProjection(
      sacredTimelineSeed,
      index,
      defaultExplorerFilters,
      undefined,
      undefined,
      {
        instagramReferences: [
          {
            id: "instagram_test_reference",
            permalink: "https://www.instagram.com/p/test/",
            caption: "Test reference",
            linkedEntityIds: [firstEntity.id],
            rightsStatus: "embed_only",
            reviewState: "suggested",
            provenance: {
              sourceKind: "instagram",
              importedAt: "2026-05-09T00:00:00.000Z",
              sourceUrl: "https://www.instagram.com/p/test/",
            },
          },
        ],
      },
    );

    expect(
      projection.galleryItems.find((item) => item.entityId === firstEntity.id)
        ?.instagramReferenceCount,
    ).toBe(1);
    expect(projection.visibleCounts.instagramReferences).toBe(1);
  });

  it("preserves manual exhibit ordering and hides suggested exhibits from approved output", () => {
    const projection = buildScriptoriumProjection(
      sacredTimelineSeed,
      index,
      defaultExplorerFilters,
      undefined,
      undefined,
      {
        exhibits: [
          {
            id: "exhibit_suggested_test",
            title: "Suggested",
            description: "Draft",
            reviewState: "suggested",
            sourceKind: "ai",
            createdAt: "2026-05-09T00:00:00.000Z",
            updatedAt: "2026-05-09T00:00:00.000Z",
            sections: [],
            relationshipEmphasis: [],
          },
          {
            id: "exhibit_approved_test",
            title: "Approved",
            description: "Ready",
            reviewState: "approved",
            sourceKind: "manual",
            createdAt: "2026-05-09T00:00:00.000Z",
            updatedAt: "2026-05-09T00:00:00.000Z",
            sections: [],
            relationshipEmphasis: [],
          },
        ],
      },
    );

    expect(projection.exhibits.map((exhibit) => exhibit.title)).toEqual([
      "Suggested",
      "Approved",
    ]);
    expect(projection.approvedExhibits.map((exhibit) => exhibit.title)).toEqual(["Approved"]);
  });
});
