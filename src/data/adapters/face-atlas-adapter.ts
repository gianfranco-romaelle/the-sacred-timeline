import type { ExplorerFilters, ExplorerView } from "@/state/explorer-store";
import { buildFocusContext, getContextReasonForEntity, type ContextReason } from "@/data/focus-context";
import type {
  DepictionType,
  DomainId,
  KnowledgeEntity,
  KnowledgeEntityId,
  SacredTimelineSeedData,
  TagId,
  TraditionId,
} from "@/types";
import type { SeedIndex } from "@/data/entity-index";
import type { ProjectionInput, ViewProjection, ViewProjectionAdapter } from "@/types/projections";
import { getEntityTraditionIds, filterKnowledgeEntities } from "@/data/filtering";
import { deriveEntityNeighborhood } from "@/data/relation-helpers";
import { getEntityDateLabel } from "@/data/entity-index";
import { getEraBucket, getPrimaryYearFromDateRange } from "@/data/time-grouping";
import { extractEntityEditorialMetadata } from "@/editorial/stage-lens";
import type { EntityEditorialMetadata } from "@/editorial/types";
import { buildProjectionDiagnostics } from "./projection-diagnostics";

export type FaceAtlasGrouping = "era" | "domain" | "tradition" | "entityType";
export type FaceAtlasSort = "chronological" | "label" | "prominence";
export type FaceAtlasTone = "science" | "religion" | "hybrid" | "neutral";

export interface PortraitClusterHint {
  clusterIds: string[];
  styleGroupIds: string[];
  embeddingDescriptorIds: string[];
  similarityNeighborIds: string[];
}

export interface FaceAtlasItem {
  portraitAssetId: string;
  entityId: KnowledgeEntityId;
  entityType: KnowledgeEntity["entityType"];
  label: string;
  subtitle?: string;
  description: string;
  timeLabel: string;
  primaryYear?: number;
  groupKey: string;
  groupLabel: string;
  domainIds: DomainId[];
  tagIds: TagId[];
  traditionIds: TraditionId[];
  citationCount: number;
  relationCount: number;
  portraitLabel: string;
  imageSrc: string;
  thumbnailSrc?: string;
  altText: string;
  depictionType: DepictionType;
  hasFaceRegion: boolean;
  isPrimaryPortrait: boolean;
  isSelected: boolean;
  isNeighbor: boolean;
  isContextRelevant: boolean;
  contextReason?: ContextReason;
  editorial?: EntityEditorialMetadata;
  tone: FaceAtlasTone;
  clusterHint: PortraitClusterHint;
}

export interface FaceAtlasGroup {
  key: string;
  label: string;
  itemCount: number;
  featuredCount: number;
  items: FaceAtlasItem[];
}

export interface FaceAtlasProjection extends ViewProjection<{
  portraits: number;
  entities: number;
  groups: number;
}> {
  items: FaceAtlasItem[];
  groups: FaceAtlasGroup[];
  grouping: FaceAtlasGrouping;
  sort: FaceAtlasSort;
}

export interface FaceAtlasProjectionInput extends ProjectionInput {
  grouping: FaceAtlasGrouping;
  sort: FaceAtlasSort;
}

const getTone = (domainIds: DomainId[]): FaceAtlasTone => {
  const hasScience = domainIds.includes("domain_science");
  const hasReligion = domainIds.includes("domain_religion");

  if (hasScience && hasReligion) return "hybrid";
  if (hasScience) return "science";
  if (hasReligion) return "religion";
  return "neutral";
};

const getEntitySubtitle = (entity: KnowledgeEntity) => {
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

const getGroupDescriptor = (
  entity: KnowledgeEntity,
  grouping: FaceAtlasGrouping,
  index: SeedIndex,
) => {
  if (grouping === "era") {
    const year = getPrimaryYearFromDateRange(entity.dateRange);
    if (typeof year !== "number") {
      return { key: "undated", label: "Undated" };
    }
    const bucket = getEraBucket(year);
    return { key: bucket.key, label: bucket.label };
  }

  if (grouping === "domain") {
    const firstDomainId = entity.domainIds[0];
    const firstDomain = firstDomainId ? index.domainsById.get(firstDomainId) : undefined;
    return {
      key: firstDomainId ?? "domain_unspecified",
      label: firstDomain?.label ?? "Unspecified domain",
    };
  }

  if (grouping === "tradition") {
    const firstTraditionId = getEntityTraditionIds(entity)[0];
    const firstTradition =
      firstTraditionId && index.entitiesById.get(firstTraditionId)?.entityType === "tradition"
        ? index.entitiesById.get(firstTraditionId)
        : undefined;

    return {
      key: firstTraditionId ?? "tradition_unspecified",
      label: firstTradition?.label ?? "Unspecified tradition",
    };
  }

  return {
    key: entity.entityType,
    label: entity.entityType.replace("-", " "),
  };
};

export const faceAtlasProjectionAdapter: ViewProjectionAdapter<
  FaceAtlasProjection,
  FaceAtlasProjectionInput
> = (input) =>
  buildFaceAtlasProjection(
    input.seed,
    input.index,
    input.filters,
    input.selectedEntityId,
    input.selectionSourceView,
    input.grouping,
    input.sort,
  );

const getPortraitProminence = (item: FaceAtlasItem) =>
  item.citationCount * 1.6 +
  item.relationCount * 1.2 +
  (item.hasFaceRegion ? 1 : 0) +
  (item.isPrimaryPortrait ? 1.25 : 0) +
  item.clusterHint.clusterIds.length * 0.4;

const sortItems = (items: FaceAtlasItem[], sort: FaceAtlasSort) => {
  const nextItems = [...items];

  nextItems.sort((left, right) => {
    if (sort === "label") {
      return left.label.localeCompare(right.label);
    }

    if (sort === "prominence") {
      const prominenceDelta = getPortraitProminence(right) - getPortraitProminence(left);
      if (prominenceDelta !== 0) return prominenceDelta;
      return left.label.localeCompare(right.label);
    }

    const leftYear = left.primaryYear ?? Number.POSITIVE_INFINITY;
    const rightYear = right.primaryYear ?? Number.POSITIVE_INFINITY;
    if (leftYear === rightYear) {
      return left.label.localeCompare(right.label);
    }
    return leftYear - rightYear;
  });

  return nextItems;
};

export const buildFaceAtlasProjection = (
  seed: SacredTimelineSeedData,
  index: SeedIndex,
  filters: ExplorerFilters,
  selectedEntityId: KnowledgeEntityId | undefined,
  selectionSourceView: ExplorerView | undefined,
  grouping: FaceAtlasGrouping,
  sort: FaceAtlasSort,
): FaceAtlasProjection => {
  const visibleEntities = filterKnowledgeEntities(seed, filters);
  const neighborhood = deriveEntityNeighborhood(selectedEntityId, index, filters.relationTypes);
  const focusContext = buildFocusContext(seed, index, filters, selectedEntityId, selectionSourceView);

  const unsortedItems = visibleEntities.flatMap((entity) => {
    const portraits = seed.portraitAssets
      .filter((portrait) => portrait.depictedEntityIds.includes(entity.id))
      .sort((left, right) => {
        if (left.isPrimaryPortrait === right.isPrimaryPortrait) return 0;
        return left.isPrimaryPortrait ? -1 : 1;
      });

    return portraits.map((portrait) => {
      const group = getGroupDescriptor(entity, grouping, index);
      const primaryYear = getPrimaryYearFromDateRange(entity.dateRange);
      const embeddingDescriptorIds = portrait.embedding?.descriptors.map((descriptor) => descriptor.id) ?? [];
      const similarityNeighborIds = [
        ...(portrait.embedding?.similarityLinks?.map((link) => String(link.targetId)) ?? []),
        ...(portrait.faceRegions?.flatMap((region) => region.similarityNeighborIds ?? []) ?? []),
      ];
      const contextReason = getContextReasonForEntity(entity, focusContext);

      return {
        portraitAssetId: portrait.id,
        entityId: entity.id,
        entityType: entity.entityType,
        label: entity.label,
        subtitle: getEntitySubtitle(entity),
        description: entity.description,
        timeLabel: getEntityDateLabel(entity),
        primaryYear,
        groupKey: group.key,
        groupLabel: group.label,
        domainIds: entity.domainIds,
        tagIds: entity.tagIds,
        traditionIds: getEntityTraditionIds(entity),
        citationCount: entity.citationIds.length,
        relationCount: (index.edgesByEntityId.get(entity.id) ?? []).length,
        portraitLabel: portrait.label,
        imageSrc: portrait.file.src,
        thumbnailSrc: portrait.file.thumbnailSrc,
        altText: portrait.altText,
        depictionType: portrait.depictionType,
        hasFaceRegion: Boolean(portrait.faceRegions?.length),
        isPrimaryPortrait: Boolean(portrait.isPrimaryPortrait),
        isSelected: selectedEntityId === entity.id,
        isNeighbor: neighborhood.neighborIds.includes(entity.id),
        isContextRelevant: Boolean(contextReason),
        contextReason,
        editorial: extractEntityEditorialMetadata(entity),
        tone: getTone(entity.domainIds),
        clusterHint: {
          clusterIds: portrait.embedding?.clusterIds ?? [],
          styleGroupIds: portrait.embedding?.styleGroupIds ?? [],
          embeddingDescriptorIds,
          similarityNeighborIds,
        },
      } satisfies FaceAtlasItem;
    });
  });

  const items = sortItems(unsortedItems, sort);
  const grouped = new Map<string, FaceAtlasItem[]>();
  for (const item of items) {
    const groupItems = grouped.get(item.groupKey);
    if (groupItems) {
      groupItems.push(item);
    } else {
      grouped.set(item.groupKey, [item]);
    }
  }

  const groups = Array.from(grouped.entries()).map(([key, groupItems]) => ({
    key,
    label: groupItems[0]?.groupLabel ?? key,
    itemCount: groupItems.length,
    featuredCount: groupItems.filter(
      (item) =>
        item.isPrimaryPortrait ||
        item.clusterHint.clusterIds.length > 0 ||
        item.citationCount + item.relationCount >= 3,
    ).length,
    items: groupItems,
  }));

  groups.sort((left, right) => {
    if (grouping === "era") {
      const leftYear =
        left.items.reduce(
          (current, item) => Math.min(current, item.primaryYear ?? Number.POSITIVE_INFINITY),
          Number.POSITIVE_INFINITY,
        ) ?? Number.POSITIVE_INFINITY;
      const rightYear =
        right.items.reduce(
          (current, item) => Math.min(current, item.primaryYear ?? Number.POSITIVE_INFINITY),
          Number.POSITIVE_INFINITY,
        ) ?? Number.POSITIVE_INFINITY;
      return leftYear - rightYear;
    }

    return left.label.localeCompare(right.label);
  });

  return {
    projectionKind: "face-atlas",
    items,
    groups,
    grouping,
    sort,
    diagnostics: buildProjectionDiagnostics({
      projectionKind: "face-atlas",
      itemCount: items.length,
      groupCount: groups.length,
    }),
    visibleCounts: {
      portraits: items.length,
      entities: new Set(items.map((item) => item.entityId)).size,
      groups: groups.length,
    },
  };
};
