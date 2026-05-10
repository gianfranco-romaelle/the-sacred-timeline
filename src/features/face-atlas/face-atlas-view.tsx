import { useMemo, useState } from "react";
import { LayoutGroup } from "motion/react";
import { EmptyStateCard } from "@/components/shared/empty-state-card";
import {
  faceAtlasProjectionAdapter,
  type FaceAtlasGrouping,
  type FaceAtlasItem,
  type FaceAtlasSort,
} from "@/data/adapters/face-atlas-adapter";
import type { SeedIndex } from "@/data/entity-index";
import { useViewCoordination } from "@/features/shared/use-view-coordination";
import type { SacredTimelineSeedData } from "@/types";
import { FaceAtlasControls } from "./face-atlas-controls";
import { FaceAtlasGroup } from "./face-atlas-group";

interface FaceAtlasViewProps {
  seed: SacredTimelineSeedData;
  index: SeedIndex;
}

export function FaceAtlasView({ seed, index }: FaceAtlasViewProps) {
  const [grouping, setGrouping] = useState<FaceAtlasGrouping>("era");
  const [sort, setSort] = useState<FaceAtlasSort>("prominence");

  const {
    filters,
    selectedEntityId,
    selectionSourceView,
    activeFilterSummary,
    resetFilters,
    selectFromView,
  } = useViewCoordination();

  const projection = useMemo(
    () =>
      faceAtlasProjectionAdapter({
        seed,
        index,
        filters,
        selectedEntityId,
        selectionSourceView,
        grouping,
        sort,
      }),
    [filters, grouping, index, seed, selectedEntityId, selectionSourceView, sort],
  );
  return (
    <div className="face-atlas-view">
      <FaceAtlasControls
        grouping={grouping}
        sort={sort}
        portraitCount={projection.visibleCounts.portraits}
        entityCount={projection.visibleCounts.entities}
        activeFilterSummary={activeFilterSummary}
        onGroupingChange={setGrouping}
        onSortChange={setSort}
      />

      {projection.items.length === 0 ? (
        <EmptyStateCard
          activeFilterSummary={activeFilterSummary}
          description={
            activeFilterSummary.length > 0
              ? "Portraits are missing for the selected records in this scope. Clear these filters to return to portrait-bearing entries."
              : "Portraits are missing for the current records. Linked image assets will appear here as they are added."
          }
          eyebrow="Face Atlas"
          onResetFilters={resetFilters}
          title={
            activeFilterSummary.length > 0
              ? "No records match this portrait scope."
              : "No portrait-bearing records yet."
          }
        />
      ) : (
        <LayoutGroup>
          <div className="face-atlas-groups">
            {projection.groups.map((group) => (
              <FaceAtlasGroup
                group={group}
                key={group.key}
                editorialMode={filters.editorialMode}
                editorialScopeMode={filters.editorialScopeMode}
                onSelect={(item: FaceAtlasItem) =>
                  selectFromView(item.entityId, item.entityType, "face-atlas")
                }
              />
            ))}
          </div>
        </LayoutGroup>
      )}
    </div>
  );
}
