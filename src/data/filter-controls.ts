import type { TimePreset } from "@/data/entity-index";
import {
  getAvailablePlaces,
  getDomainLabels,
  getEntityTypeLabel,
  seedIndex,
  type SeedIndex,
} from "@/data/entity-index";
import { sacredTimelineSeed } from "@/data/sacred-timeline.seed";
import type { ExplorerFilters } from "@/state/explorer-store";
import {
  getEditorialStageLabel,
  getEditorialStageOptions,
  getEditorialStageWindowLabel,
  getEditorialStageProfile,
  getQuantumStageOptions as getQuantumStageFilterOptions,
} from "@/editorial/stage-lens";
import type {
  CalculusStage,
  EditorialChronologyMode,
  EditorialCrosswalkDimension,
  EditorialScopeMode,
  QuantumStage,
} from "@/editorial/types";
import type {
  CanonicalEntityType,
  DomainId,
  EdgeRelationType,
  PlaceId,
  TagId,
  TraditionId,
} from "@/types";

export interface FilterOption<T extends string | number> {
  id: T;
  label: string;
  description?: string;
}

export interface ActiveFilterToken {
  key: string;
  label: string;
  category:
    | "time"
    | "entityType"
    | "domain"
    | "tradition"
    | "tag"
    | "relation"
    | "geography"
    | "editorial";
}

const entityTypeOrder: CanonicalEntityType[] = [
  "person",
  "text",
  "concept",
  "event",
  "place",
  "institution",
  "tradition",
];

const timePresetDescriptions: Record<TimePreset, string> = {
  all: "Every available period",
  ancient: "Before 500 CE",
  medieval: "500-1499 CE",
  "early-modern": "1500-1799 CE",
  modern: "1800 CE onward",
};

export const getTimePresetLabel = (timePreset: TimePreset) =>
  ({
    all: "All eras",
    ancient: "Ancient",
    medieval: "Medieval",
    "early-modern": "Early Modern",
    modern: "Modern",
  })[timePreset];

export const getRelationTypeLabel = (relationType: EdgeRelationType) =>
  relationType.replaceAll("_", " ");

export const getTimePresetOptions = (): FilterOption<TimePreset>[] =>
  (["all", "ancient", "medieval", "early-modern", "modern"] as const).map((id) => ({
    id,
    label: getTimePresetLabel(id),
    description: timePresetDescriptions[id],
  }));

export const getEntityTypeOptions = (): FilterOption<CanonicalEntityType>[] =>
  entityTypeOrder.map((id) => ({
    id,
    label: getEntityTypeLabel(id),
  }));

export const getDomainOptions = (
  seed = sacredTimelineSeed,
): FilterOption<DomainId>[] =>
  seed.domains.map((domain) => ({
    id: domain.id,
    label: domain.label,
    description: domain.description,
  }));

export const getTraditionOptions = (
  seed = sacredTimelineSeed,
): FilterOption<TraditionId>[] =>
  seed.traditions.map((tradition) => ({
    id: tradition.id,
    label: tradition.label,
    description: tradition.description,
  }));

export const getTagOptions = (
  seed = sacredTimelineSeed,
): FilterOption<TagId>[] =>
  seed.tags.map((tag) => ({
    id: tag.id,
    label: tag.label,
    description: tag.description,
  }));

export const getRelationTypeOptions = (
  seed = sacredTimelineSeed,
): FilterOption<EdgeRelationType>[] =>
  Array.from(new Set(seed.edges.map((edge) => edge.relationType))).map((id) => ({
    id,
    label: getRelationTypeLabel(id),
  }));

export const getGeographyOptions = (
  seed = sacredTimelineSeed,
): FilterOption<PlaceId>[] =>
  getAvailablePlaces(seed).map((place) => ({
    id: place.id,
    label: place.label,
    description: place.description,
  }));

export const getEditorialChronologyOptions = (): FilterOption<EditorialChronologyMode>[] => [
  {
    id: "historical",
    label: "Historical chronology",
    description: "Preserve the ordinary chronological reading of the archive.",
  },
  {
    id: "editorial",
    label: "Editorial chronology",
    description: "Group the archive by the curatorial stage lens instead of standard historical period bands.",
  },
];

export const getEditorialScopeOptions = (): FilterOption<EditorialScopeMode>[] => [
  {
    id: "standard-chronology",
    label: "Standard chronology",
    description: "Keep the usual historical periodization and ordering.",
  },
  {
    id: "calculus-stages",
    label: "Calculus stages",
    description: "Interpret the archive through the simplified calculus-stage lens.",
  },
  {
    id: "quantum-stages",
    label: "Quantum stages",
    description: "Re-read the archive through the quantum-stage grouping lens.",
  },
  {
    id: "crosswalk",
    label: "Crosswalk mode",
    description: "Surface stage crosswalks like structure, form, and ontological focus.",
  },
];

export const getEditorialCrosswalkOptions = (): FilterOption<EditorialCrosswalkDimension>[] => [
  { id: "structural-theme", label: "Structural theme" },
  { id: "mental-mode", label: "Mental mode" },
  { id: "characteristic-form", label: "Characteristic form" },
  { id: "chemical-epoch", label: "Chemical epoch" },
  { id: "drug-epoch", label: "Drug epoch" },
  { id: "ontological-focus", label: "Ontological focus" },
];

export const getEditorialCrosswalkLabel = (
  dimension: EditorialCrosswalkDimension,
) =>
  getEditorialCrosswalkOptions().find((option) => option.id === dimension)?.label ?? dimension;

export const getCalculusStageOptions = (): FilterOption<CalculusStage>[] =>
  getEditorialStageOptions();

export const getQuantumStageOptions = (): FilterOption<QuantumStage>[] =>
  getQuantumStageFilterOptions().map((option) => ({
    ...option,
    description:
      option.description ??
      getEditorialStageWindowLabel(getEditorialStageProfile(option.id as CalculusStage)) ??
      "Quantum-stage interpretation lens.",
  }));

const formatTimeRangeLabel = (startYear?: number, endYear?: number) => {
  const start = typeof startYear === "number" ? String(startYear) : "...";
  const end = typeof endYear === "number" ? String(endYear) : "...";
  return `${start}-${end}`;
};

export const getExpandedActiveFilterTokens = (
  filters: ExplorerFilters,
  index: SeedIndex,
): ActiveFilterToken[] => {
  const tokens: ActiveFilterToken[] = [];

  if (filters.timePreset !== "all") {
    tokens.push({
      key: `time-preset-${filters.timePreset}`,
      label: getTimePresetLabel(filters.timePreset),
      category: "time",
    });
  }

  if (typeof filters.startYear === "number" || typeof filters.endYear === "number") {
    tokens.push({
      key: "time-range",
      label: formatTimeRangeLabel(filters.startYear, filters.endYear),
      category: "time",
    });
  }

  if (!filters.includeUndated) {
    tokens.push({
      key: "dated-only",
      label: "Dated records only",
      category: "time",
    });
  }

  if (filters.editorialMode) {
    tokens.push({
      key: "editorial-mode",
      label: "Editorial mode",
      category: "editorial",
    });
  }

  if (filters.editorialMode && filters.editorialScopeMode !== "standard-chronology") {
    tokens.push({
      key: "editorial-scope",
      label:
        getEditorialScopeOptions().find((option) => option.id === filters.editorialScopeMode)
          ?.label ?? "Editorial scope",
      category: "editorial",
    });
  }

  if (filters.editorialMode && filters.showEditorialLabels) {
    tokens.push({
      key: "editorial-labels",
      label: "Stage overlays on",
      category: "editorial",
    });
  }

  if (filters.editorialMode) {
    tokens.push(
      ...filters.calculusStages.map((stage) => ({
        key: `calculus-stage-${stage}`,
        label: `Calculus: ${getEditorialStageLabel(stage) ?? stage}`,
        category: "editorial" as const,
      })),
    );
  }

  if (filters.editorialMode) {
    tokens.push(
      ...filters.quantumStages.map((stage) => ({
        key: `quantum-stage-${stage}`,
        label: `Quantum: ${getEditorialStageLabel(stage) ?? stage}`,
        category: "editorial" as const,
      })),
    );
  }

  if (filters.editorialMode) {
    tokens.push(
      ...filters.editorialCrosswalks.map((dimension) => ({
        key: `crosswalk-${dimension}`,
        label:
          getEditorialCrosswalkOptions().find((option) => option.id === dimension)?.label ??
          dimension,
        category: "editorial" as const,
      })),
    );
  }

  tokens.push(
    ...filters.entityTypes.map((entityType) => ({
      key: `entity-type-${entityType}`,
      label: getEntityTypeLabel(entityType),
      category: "entityType" as const,
    })),
  );

  tokens.push(
    ...filters.domainIds.map((domainId) => ({
      key: `domain-${domainId}`,
      label: getDomainLabels([domainId], index)[0] ?? domainId,
      category: "domain" as const,
    })),
  );

  tokens.push(
    ...filters.traditionIds.map((traditionId) => ({
      key: `tradition-${traditionId}`,
      label: index.entitiesById.get(traditionId)?.label ?? traditionId,
      category: "tradition" as const,
    })),
  );

  tokens.push(
    ...filters.tagIds.map((tagId) => ({
      key: `tag-${tagId}`,
      label: index.tagsById.get(tagId)?.label ?? tagId,
      category: "tag" as const,
    })),
  );

  tokens.push(
    ...filters.relationTypes.map((relationType) => ({
      key: `relation-${relationType}`,
      label: getRelationTypeLabel(relationType),
      category: "relation" as const,
    })),
  );

  tokens.push(
    ...filters.geographyPlaceIds.map((placeId) => ({
      key: `place-${placeId}`,
      label: index.entitiesById.get(placeId)?.label ?? placeId,
      category: "geography" as const,
    })),
  );

  if (filters.localEntityIds.length > 0) {
    tokens.push({
      key: "local-entity-scope",
      label: `Neighborhood: ${filters.localEntityIds.length} record${
        filters.localEntityIds.length === 1 ? "" : "s"
      }`,
      category: "relation" as const,
    });
  }

  if (!filters.showAiHypotheses) {
    tokens.push({
      key: "no-ai-hypotheses",
      label: "AI hypotheses hidden",
      category: "relation" as const,
    });
  }

  return tokens;
};

export const getCondensedActiveFilterSummary = (
  filters: ExplorerFilters,
  index: SeedIndex,
  maxItems = 6,
): string[] => {
  const summary: string[] = [];

  if (filters.timePreset !== "all") {
    summary.push(getTimePresetLabel(filters.timePreset));
  }

  if (typeof filters.startYear === "number" || typeof filters.endYear === "number") {
    summary.push(formatTimeRangeLabel(filters.startYear, filters.endYear));
  }

  if (!filters.includeUndated) {
    summary.push("dated only");
  }

  if (filters.editorialMode) {
    summary.push("editorial on");

    if (filters.editorialScopeMode !== "standard-chronology") {
      summary.push(
        getEditorialScopeOptions().find((option) => option.id === filters.editorialScopeMode)
          ?.label.toLowerCase() ?? "editorial scope",
      );
    }

    if (filters.showEditorialLabels) {
      summary.push("stage overlays");
    }

    if (filters.calculusStages.length > 0) {
      summary.push(
        filters.calculusStages.length === 1
          ? `calc ${getEditorialStageLabel(filters.calculusStages[0])?.toLowerCase()}`
          : `${filters.calculusStages.length} calculus stages`,
      );
    }

    if (filters.quantumStages.length > 0) {
      summary.push(
        filters.quantumStages.length === 1
          ? `quantum ${getEditorialStageLabel(filters.quantumStages[0])?.toLowerCase()}`
          : `${filters.quantumStages.length} quantum stages`,
      );
    }

    if (filters.editorialCrosswalks.length > 0) {
      summary.push(
        filters.editorialCrosswalks.length === 1
          ? getEditorialCrosswalkOptions()
              .find((option) => option.id === filters.editorialCrosswalks[0])
              ?.label.toLowerCase() ?? "crosswalk"
          : `${filters.editorialCrosswalks.length} crosswalks`,
      );
    }
  }

  if (filters.entityTypes.length > 0) {
    summary.push(
      filters.entityTypes.length === 1
        ? getEntityTypeLabel(filters.entityTypes[0])
        : `${filters.entityTypes.length} entity types`,
    );
  }

  if (filters.domainIds.length > 0) {
    const labels = getDomainLabels(filters.domainIds, index);
    summary.push(
      labels.length <= 2
        ? labels.join(", ")
        : `${labels.slice(0, 2).join(", ")} +${labels.length - 2}`,
    );
  }

  if (filters.traditionIds.length > 0) {
    summary.push(
      filters.traditionIds.length === 1
        ? (index.entitiesById.get(filters.traditionIds[0])?.label ?? "1 tradition")
        : `${filters.traditionIds.length} traditions`,
    );
  }

  if (filters.tagIds.length > 0) {
    summary.push(`${filters.tagIds.length} tags`);
  }

  if (filters.relationTypes.length > 0) {
    summary.push(
      filters.relationTypes.length === 1
        ? getRelationTypeLabel(filters.relationTypes[0])
        : `${filters.relationTypes.length} relation types`,
    );
  }

  if (filters.geographyPlaceIds.length > 0) {
    summary.push(
      filters.geographyPlaceIds.length === 1
        ? (index.entitiesById.get(filters.geographyPlaceIds[0])?.label ?? "1 place")
        : `${filters.geographyPlaceIds.length} places`,
    );
  }

  if (filters.localEntityIds.length > 0) {
    summary.push(
      filters.localEntityIds.length === 1
        ? "1 scoped record"
        : `${filters.localEntityIds.length} scoped records`,
    );
  }

  if (!filters.showAiHypotheses) {
    summary.push("AI hypotheses off");
  }

  return summary.slice(0, maxItems);
};

export const getFilterScopeLabel = (
  filters: ExplorerFilters,
  index: SeedIndex = seedIndex,
) => {
  const activeFilters = getExpandedActiveFilterTokens(filters, index);

  if (activeFilters.length === 0) {
    return "All records in scope";
  }

  return `${activeFilters.length} active filter${activeFilters.length === 1 ? "" : "s"}`;
};
