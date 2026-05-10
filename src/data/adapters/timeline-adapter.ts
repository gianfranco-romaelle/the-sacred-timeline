import type { ExplorerFilters, ExplorerView } from "@/state/explorer-store";
import {
  buildFocusContext,
  getContextReasonForEntity,
  type ContextReason,
  type FocusContext,
} from "@/data/focus-context";
import type { KnowledgeEntity, KnowledgeEntityId, SacredTimelineSeedData } from "@/types";
import type { SeedIndex } from "@/data/entity-index";
import type { ProjectionInput, ViewProjection, ViewProjectionAdapter } from "@/types/projections";
import {
  extractEntityEditorialMetadata,
  groupEntitiesByEditorialStage,
  groupEntitiesByQuantumStage,
} from "@/editorial/stage-lens";
import type { EditorialStageProfile, EntityEditorialMetadata } from "@/editorial/types";
import { filterKnowledgeEntities } from "@/data/filtering";
import { getEntityDateLabel, getPrimaryPortraitForEntity } from "@/data/entity-index";
import {
  groupEntitiesByCentury,
  groupEntitiesByEra,
  getPrimaryYearFromDateRange,
  sortEntitiesChronologically,
} from "@/data/time-grouping";
import { buildProjectionDiagnostics } from "./projection-diagnostics";

export type TimelineDensity = "low" | "medium" | "high";
export type TimelineImportance = "normal" | "featured";

export interface TimelineItem {
  id: KnowledgeEntityId;
  entityType: KnowledgeEntity["entityType"];
  label: string;
  description: string;
  subtitle?: string;
  dateLabel: string;
  primaryYear?: number;
  domainIds: string[];
  tagIds: string[];
  traditionIds: string[];
  citationCount: number;
  relationCount: number;
  hasPortrait: boolean;
  importance: TimelineImportance;
  isSelected: boolean;
  isNeighbor: boolean;
  isContextRelevant: boolean;
  contextReason?: ContextReason;
  editorial?: EntityEditorialMetadata;
  isDimmed: boolean;
}

export interface TimelineGroup {
  key: string;
  label: string;
  startYear?: number;
  endYear?: number;
  chronologyLabel?: string;
  density: TimelineDensity;
  featuredItemIds: KnowledgeEntityId[];
  itemCount: number;
  items: TimelineItem[];
  editorialProfile?: EditorialStageProfile;
}

export interface TimelineProjection extends ViewProjection<{
  items: number;
  eraGroups: number;
  centuryGroups: number;
  editorialStageGroups: number;
  quantumStageGroups: number;
}> {
  items: TimelineItem[];
  byEra: TimelineGroup[];
  byCentury: TimelineGroup[];
  byEditorialStage: TimelineGroup[];
  byQuantumStage: TimelineGroup[];
}

const getTimelineSubtitle = (entity: KnowledgeEntity) => {
  switch (entity.entityType) {
    case "person":
      return entity.roles.slice(0, 2).join(", ");
    case "text":
      return entity.textType.replaceAll("_", " ");
    case "concept":
      return entity.conceptType.replaceAll("_", " ");
    case "event":
      return entity.eventType.replaceAll("_", " ");
    case "institution":
      return entity.institutionType.replaceAll("_", " ");
    case "tradition":
      return entity.traditionType.replaceAll("_", " ");
    default:
      return undefined;
  }
};

const getTimelineImportance = (
  entity: KnowledgeEntity,
  index: SeedIndex,
  seed: SacredTimelineSeedData,
) => {
  const relationCount = (index.edgesByEntityId.get(entity.id) ?? []).length;
  const citationCount = entity.citationIds.length;
  const hasPortrait = Boolean(getPrimaryPortraitForEntity(entity.id, seed));

  const intrinsicWeight =
    entity.entityType === "person" || entity.entityType === "event"
      ? 2
      : entity.entityType === "text" || entity.entityType === "institution"
        ? 1
        : 0;

  return citationCount + relationCount + intrinsicWeight + (hasPortrait ? 1 : 0) >= 4
    ? "featured"
    : "normal";
};

const getGroupDensity = (count: number): TimelineDensity => {
  if (count >= 6) return "high";
  if (count >= 3) return "medium";
  return "low";
};

const getChronologyLabel = (items: TimelineItem[]) => {
  const years = items
    .map((item) => item.primaryYear)
    .filter((value): value is number => typeof value === "number");

  if (years.length === 0) {
    return "Undated";
  }

  const startYear = Math.min(...years);
  const endYear = Math.max(...years);
  return startYear === endYear ? `${startYear}` : `${startYear} to ${endYear}`;
};

const toTimelineItem = (
  entity: KnowledgeEntity,
  index: SeedIndex,
  seed: SacredTimelineSeedData,
  focusContext: FocusContext,
  selectedEntityId?: KnowledgeEntityId,
): TimelineItem => {
  const contextReason = getContextReasonForEntity(entity, focusContext);
  const editorial = extractEntityEditorialMetadata(entity);

  return {
    id: entity.id,
    entityType: entity.entityType,
    label: entity.label,
    description: entity.description,
    subtitle: getTimelineSubtitle(entity),
    dateLabel: getEntityDateLabel(entity),
    primaryYear: getPrimaryYearFromDateRange(entity.dateRange),
    domainIds: entity.domainIds,
    tagIds: entity.tagIds,
    traditionIds:
      entity.entityType === "person" ||
      entity.entityType === "text" ||
      entity.entityType === "concept" ||
      entity.entityType === "institution"
        ? entity.traditionIds
        : [],
    citationCount: entity.citationIds.length,
    relationCount: (index.edgesByEntityId.get(entity.id) ?? []).length,
    hasPortrait: Boolean(getPrimaryPortraitForEntity(entity.id, seed)),
    importance: getTimelineImportance(entity, index, seed),
    isSelected: selectedEntityId === entity.id,
    isNeighbor: focusContext.neighborIds.includes(entity.id),
    isContextRelevant: Boolean(contextReason),
    contextReason,
    editorial,
    isDimmed: Boolean(
      selectedEntityId &&
        selectedEntityId !== entity.id &&
        !focusContext.neighborIds.includes(entity.id) &&
        !contextReason,
    ),
  };
};

const mapGroups = (
  groups: ReturnType<typeof groupEntitiesByEra>,
  index: SeedIndex,
  seed: SacredTimelineSeedData,
  focusContext: FocusContext,
  selectedEntityId?: KnowledgeEntityId,
  _selectionSourceView?: ExplorerView,
): TimelineGroup[] =>
  groups.map((group) => {
    const items = group.items.map((entity) =>
      toTimelineItem(entity, index, seed, focusContext, selectedEntityId),
    );

    return {
      key: group.key,
      label: group.label,
      startYear: group.startYear,
      endYear: group.endYear,
      chronologyLabel: getChronologyLabel(items),
      density: getGroupDensity(items.length),
      featuredItemIds: items
        .filter((item) => item.importance === "featured")
        .map((item) => item.id),
      itemCount: items.length,
      items,
    };
  });

const mapEditorialGroups = (
  entities: KnowledgeEntity[],
  index: SeedIndex,
  seed: SacredTimelineSeedData,
  focusContext: FocusContext,
  selectedEntityId?: KnowledgeEntityId,
): TimelineGroup[] =>
  groupEntitiesByEditorialStage(entities).map((group) => {
    const chronologicallySortedItems = sortEntitiesChronologically(group.items);
    const sortedItems = chronologicallySortedItems.map((entity) =>
      toTimelineItem(entity, index, seed, focusContext, selectedEntityId),
    );

    return {
      key: group.key,
      label: group.label,
      chronologyLabel: getChronologyLabel(sortedItems),
      density: getGroupDensity(sortedItems.length),
      featuredItemIds: sortedItems
        .filter((item) => item.importance === "featured")
        .map((item) => item.id),
      itemCount: sortedItems.length,
      items: sortedItems,
      editorialProfile: group.profile,
    };
  });

const mapQuantumGroups = (
  entities: KnowledgeEntity[],
  index: SeedIndex,
  seed: SacredTimelineSeedData,
  focusContext: FocusContext,
  selectedEntityId?: KnowledgeEntityId,
): TimelineGroup[] =>
  groupEntitiesByQuantumStage(entities).map((group) => {
    const chronologicallySortedItems = sortEntitiesChronologically(group.items);
    const items = chronologicallySortedItems.map((entity) =>
      toTimelineItem(entity, index, seed, focusContext, selectedEntityId),
    );

    return {
      key: group.key,
      label: group.label,
      chronologyLabel: getChronologyLabel(items),
      density: getGroupDensity(items.length),
      featuredItemIds: items
        .filter((item) => item.importance === "featured")
        .map((item) => item.id),
      itemCount: items.length,
      items,
    };
  });

export const buildTimelineProjection = (
  seed: SacredTimelineSeedData,
  index: SeedIndex,
  filters: ExplorerFilters,
  selectedEntityId?: KnowledgeEntityId,
  selectionSourceView?: ExplorerView,
): TimelineProjection => {
  const entities = filterKnowledgeEntities(seed, filters).filter(
    (entity) => entity.entityType !== "place",
  );
  const focusContext = buildFocusContext(seed, index, filters, selectedEntityId, selectionSourceView);
  const items = entities.map((entity) =>
    toTimelineItem(entity, index, seed, focusContext, selectedEntityId),
  );

  const byEra = mapGroups(
    groupEntitiesByEra(entities),
    index,
    seed,
    focusContext,
    selectedEntityId,
    selectionSourceView,
  );
  const byCentury = mapGroups(
    groupEntitiesByCentury(entities),
    index,
    seed,
    focusContext,
    selectedEntityId,
    selectionSourceView,
  );
  const byEditorialStage = mapEditorialGroups(entities, index, seed, focusContext, selectedEntityId);
  const byQuantumStage = mapQuantumGroups(entities, index, seed, focusContext, selectedEntityId);

  return {
    projectionKind: "river",
    items,
    byEra,
    byCentury,
    byEditorialStage,
    byQuantumStage,
    diagnostics: buildProjectionDiagnostics({
      projectionKind: "river",
      itemCount: items.length,
      groupCount: Math.max(
        byEra.length,
        byCentury.length,
        byEditorialStage.length,
        byQuantumStage.length,
      ),
    }),
    visibleCounts: {
      items: items.length,
      eraGroups: byEra.length,
      centuryGroups: byCentury.length,
      editorialStageGroups: byEditorialStage.length,
      quantumStageGroups: byQuantumStage.length,
    },
  };
};

export const timelineProjectionAdapter: ViewProjectionAdapter<TimelineProjection> = ({
  seed,
  index,
  filters,
  selectedEntityId,
  selectionSourceView,
}: ProjectionInput) =>
  buildTimelineProjection(seed, index, filters, selectedEntityId, selectionSourceView);
