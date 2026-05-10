import { useMemo, useState } from "react";
import { timelineProjectionAdapter } from "@/data/adapters/timeline-adapter";
import { buildRiverLaneProjection } from "@/historical/projections/river-lane-functor";
import type { SeedIndex } from "@/data/entity-index";
import { EmptyStateCard } from "@/components/shared/empty-state-card";
import { useViewCoordination } from "@/features/shared/use-view-coordination";
import type { KnowledgeEntityId, SacredTimelineSeedData } from "@/types";
import { RiverControls, type RiverGroupingMode } from "./river-controls";
import { RiverLaneStage } from "./river-lane-stage";
import { RiverStage } from "./river-stage";

interface RiverViewProps {
  seed: SacredTimelineSeedData;
  index: SeedIndex;
}

export function RiverView({ seed, index }: RiverViewProps) {
  const [groupingMode, setGroupingMode] = useState<RiverGroupingMode>("era");
  const {
    filters,
    selectedEntityId,
    selectionSourceView,
    activeFilterSummary,
    resetFilters,
    selectFromView,
  } = useViewCoordination();

  const isEditorialMode = filters.editorialMode;
  const editorialScopeMode = filters.editorialScopeMode;
  const isTraditionMode = groupingMode === "tradition" && !isEditorialMode;

  const timelineProjection = useMemo(
    () =>
      timelineProjectionAdapter({
        seed,
        index,
        filters,
        selectedEntityId,
        selectionSourceView,
      }),
    [filters, index, seed, selectedEntityId, selectionSourceView],
  );

  const laneProjection = useMemo(
    () =>
      isTraditionMode
        ? buildRiverLaneProjection(seed, index, filters, selectedEntityId, selectionSourceView)
        : null,
    [filters, index, isTraditionMode, seed, selectedEntityId, selectionSourceView],
  );

  const densityHint = useMemo(() => {
    if (isTraditionMode && laneProjection) {
      const total = laneProjection.visibleCounts.totalEntities + laneProjection.visibleCounts.unassigned;
      return `${laneProjection.visibleCounts.lanes} tradition lane${laneProjection.visibleCounts.lanes === 1 ? "" : "s"}, ${total} records`;
    }

    const groups =
      !isEditorialMode || editorialScopeMode === "standard-chronology"
        ? groupingMode === "era"
          ? timelineProjection.byEra
          : timelineProjection.byCentury
        : editorialScopeMode === "quantum-stages"
          ? timelineProjection.byQuantumStage
          : timelineProjection.byEditorialStage;
    const highDensityCount = groups.filter((group) => group.density === "high").length;

    if (highDensityCount > 0) {
      return `${highDensityCount} dense ${
        !isEditorialMode || editorialScopeMode === "standard-chronology"
          ? groupingMode === "era"
            ? "era"
            : "century"
          : editorialScopeMode === "quantum-stages"
            ? "quantum"
            : "stage"
      } band${highDensityCount === 1 ? "" : "s"}`;
    }

    return `${groups.length} ${
      !isEditorialMode || editorialScopeMode === "standard-chronology"
        ? groupingMode
        : editorialScopeMode.replaceAll("-", " ")
    } grouping${groups.length === 1 ? "" : "s"}`;
  }, [
    editorialScopeMode,
    groupingMode,
    isEditorialMode,
    isTraditionMode,
    laneProjection,
    timelineProjection.byCentury,
    timelineProjection.byEditorialStage,
    timelineProjection.byEra,
    timelineProjection.byQuantumStage,
  ]);

  const isEmpty = isTraditionMode
    ? laneProjection === null || (laneProjection.lanes.length === 0 && laneProjection.undatedOrUnassigned.length === 0)
    : timelineProjection.items.length === 0;

  return (
    <div className="river-view">
      <RiverControls
        groupingMode={groupingMode}
        onGroupingModeChange={setGroupingMode}
        itemCount={isTraditionMode ? (laneProjection?.visibleCounts.totalEntities ?? 0) : timelineProjection.items.length}
        activeFilterSummary={activeFilterSummary}
        densityHint={densityHint}
        isEditorialMode={isEditorialMode}
        editorialScopeMode={editorialScopeMode}
      />

      {isEmpty ? (
        <EmptyStateCard
          activeFilterSummary={activeFilterSummary}
          description="Adjust the shared controls to reopen the historical stream. The current inspector selection stays intact while the river is narrowed out."
          eyebrow="River of Time"
          onResetFilters={resetFilters}
          title="No records match the current scope."
        />
      ) : isTraditionMode && laneProjection ? (
        <RiverLaneStage
          projection={laneProjection}
          onSelect={(id) => {
            const entity = index.entitiesById.get(id);
            if (entity) selectFromView(id, entity.entityType, "river");
          }}
        />
      ) : (
        <RiverStage
          projection={timelineProjection}
          groupingMode={groupingMode === "tradition" ? "era" : groupingMode}
          isEditorialMode={isEditorialMode}
          editorialScopeMode={editorialScopeMode}
          showEditorialLabels={isEditorialMode && filters.showEditorialLabels}
          editorialCrosswalks={isEditorialMode ? filters.editorialCrosswalks : []}
          onSelect={(item) => selectFromView(item.id, item.entityType, "river")}
        />
      )}
    </div>
  );
}
