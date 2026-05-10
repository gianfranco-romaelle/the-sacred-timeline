/**
 * River-Lane Functor
 *
 * Projects the historical substrate onto a tradition-lane temporal space.
 * Each lane corresponds to one Tradition; entities within it are positioned
 * by their primary year and scaled by their importance weight.
 *
 * This is additive over buildTimelineProjection — the River of Time view can
 * render either the existing era/century grouping OR tradition lanes, using
 * the same underlying filtered items.
 */
import type { SacredTimelineSeedData, KnowledgeEntityId } from "@/types";
import type { SeedIndex } from "@/data/entity-index";
import type { ExplorerFilters, ExplorerView } from "@/state/explorer-store";
import { buildTimelineProjection, type TimelineItem } from "@/data/adapters/timeline-adapter";
import type { ProjectionInput, ViewProjection, ViewProjectionAdapter } from "@/types/projections";

export interface RiverLaneEntity {
  id: string;
  label: string;
  entityType: string;
  primaryYear: number;
  /** Normalized 0–1 span based on dateRange duration; minimum 0.5 yr. */
  durationYears: number;
  importance: "normal" | "featured";
  isSelected: boolean;
  isDimmed: boolean;
}

export interface RiverLane {
  traditionId: string;
  traditionLabel: string;
  entities: RiverLaneEntity[];
  /** Year of the earliest entity in this lane. */
  startYear: number;
  /** Year of the latest entity in this lane. */
  endYear: number;
}

export interface RiverLaneProjection extends ViewProjection<{
  lanes: number;
  totalEntities: number;
  unassigned: number;
}> {
  lanes: RiverLane[];
  undatedOrUnassigned: RiverLaneEntity[];
  globalStartYear: number;
  globalEndYear: number;
}

const toRiverLaneEntity = (item: TimelineItem): RiverLaneEntity | null => {
  if (typeof item.primaryYear !== "number") return null;
  return {
    id: item.id,
    label: item.label,
    entityType: item.entityType,
    primaryYear: item.primaryYear,
    durationYears: 0.5,
    importance: item.importance,
    isSelected: item.isSelected,
    isDimmed: item.isDimmed ?? false,
  };
};

export const buildRiverLaneProjection = (
  seed: SacredTimelineSeedData,
  index: SeedIndex,
  filters: ExplorerFilters,
  selectedEntityId?: KnowledgeEntityId,
  selectionSourceView?: ExplorerView,
): RiverLaneProjection => {
  const timeline = buildTimelineProjection(
    seed,
    index,
    filters,
    selectedEntityId,
    selectionSourceView,
  );

  const traditionMap = new Map<string, { label: string; entities: RiverLaneEntity[] }>();
  const undatedOrUnassigned: RiverLaneEntity[] = [];

  for (const tradition of seed.traditions) {
    traditionMap.set(tradition.id, { label: tradition.label, entities: [] });
  }

  for (const item of timeline.items) {
    if (item.entityType === "tradition") {
      continue;
    }

    const laneEntity = toRiverLaneEntity(item);
    if (!laneEntity) {
      undatedOrUnassigned.push({
        id: item.id,
        label: item.label,
        entityType: item.entityType,
        primaryYear: 0,
        durationYears: 0.5,
        importance: item.importance,
        isSelected: item.isSelected,
        isDimmed: item.isDimmed ?? false,
      });
      continue;
    }

    const entityTraditionIds =
      item.entityType === "person" ||
      item.entityType === "text" ||
      item.entityType === "concept" ||
      item.entityType === "institution"
        ? item.traditionIds
        : [];

    if (entityTraditionIds.length === 0) {
      undatedOrUnassigned.push(laneEntity);
      continue;
    }

    let assigned = false;
    for (const tId of entityTraditionIds) {
      if (traditionMap.has(tId)) {
        traditionMap.get(tId)!.entities.push(laneEntity);
        assigned = true;
      }
    }
    if (!assigned) {
      undatedOrUnassigned.push(laneEntity);
    }
  }

  const lanes: RiverLane[] = [];
  let globalStart = Number.POSITIVE_INFINITY;
  let globalEnd = Number.NEGATIVE_INFINITY;

  for (const [traditionId, { label, entities }] of traditionMap) {
    if (entities.length === 0) continue;
    const years = entities.map((e) => e.primaryYear).filter((y) => y !== 0);
    const laneStart = Math.min(...years);
    const laneEnd = Math.max(...years);
    globalStart = Math.min(globalStart, laneStart);
    globalEnd = Math.max(globalEnd, laneEnd);
    lanes.push({
      traditionId,
      traditionLabel: label,
      entities: entities.sort((a, b) => a.primaryYear - b.primaryYear),
      startYear: laneStart,
      endYear: laneEnd,
    });
  }

  lanes.sort((a, b) => a.startYear - b.startYear);

  const totalEntities = lanes.reduce((sum, l) => sum + l.entities.length, 0);

  return {
    projectionKind: "river",
    lanes,
    undatedOrUnassigned,
    globalStartYear: Number.isFinite(globalStart) ? globalStart : 0,
    globalEndYear: Number.isFinite(globalEnd) ? globalEnd : 0,
    visibleCounts: {
      lanes: lanes.length,
      totalEntities,
      unassigned: undatedOrUnassigned.length,
    },
  };
};

export const riverLaneProjectionAdapter: ViewProjectionAdapter<RiverLaneProjection> = ({
  seed,
  index,
  filters,
  selectedEntityId,
  selectionSourceView,
}: ProjectionInput) =>
  buildRiverLaneProjection(seed, index, filters, selectedEntityId, selectionSourceView);
