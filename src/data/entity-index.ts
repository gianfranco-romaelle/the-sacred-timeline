import type {
  CanonicalEntityType,
  CitationRecord,
  DomainDefinition,
  DomainId,
  Edge,
  HistoricalDateRange,
  KnowledgeEntity,
  KnowledgeEntityId,
  PlaceId,
  PortraitAsset,
  SacredTimelineSeedData,
  SourceRecord,
  TagDefinition,
  TagId,
  Tradition,
  TraditionId,
} from "@/types";
import { sacredTimelineSeed } from "./sacred-timeline.seed";
import { filterKnowledgeEntities } from "./filtering";
import { getPrimaryYearFromDateRange, sortEntitiesChronologically } from "./time-grouping";
import type { ExplorerFilters } from "@/state/explorer-store";

export type TimePreset = "all" | "ancient" | "medieval" | "early-modern" | "modern";

export interface SeedIndex {
  entitiesById: Map<KnowledgeEntityId, KnowledgeEntity>;
  edgesById: Map<string, Edge>;
  domainsById: Map<DomainId, DomainDefinition>;
  tagsById: Map<TagId, TagDefinition>;
  citationsById: Map<string, CitationRecord>;
  sourcesById: Map<string, SourceRecord>;
  portraitsById: Map<PortraitAsset["id"], PortraitAsset>;
  outgoingEdgesByEntityId: Map<KnowledgeEntityId, Edge[]>;
  incomingEdgesByEntityId: Map<KnowledgeEntityId, Edge[]>;
  edgesByEntityId: Map<KnowledgeEntityId, Edge[]>;
}

export const getAllEntities = (seed: SacredTimelineSeedData): KnowledgeEntity[] => [
  ...seed.people,
  ...seed.texts,
  ...seed.concepts,
  ...seed.events,
  ...seed.places,
  ...seed.institutions,
  ...seed.traditions,
];

const appendMapValue = <TKey, TValue>(
  map: Map<TKey, TValue[]>,
  key: TKey,
  value: TValue,
) => {
  const existing = map.get(key);
  if (existing) {
    existing.push(value);
    return;
  }
  map.set(key, [value]);
};

export const buildSeedIndex = (seed: SacredTimelineSeedData): SeedIndex => {
  const entitiesById = new Map<KnowledgeEntityId, KnowledgeEntity>();
  const outgoingEdgesByEntityId = new Map<KnowledgeEntityId, Edge[]>();
  const incomingEdgesByEntityId = new Map<KnowledgeEntityId, Edge[]>();
  const edgesByEntityId = new Map<KnowledgeEntityId, Edge[]>();

  for (const entity of getAllEntities(seed)) {
    entitiesById.set(entity.id, entity);
  }

  for (const edge of seed.edges) {
    const sourceId = entitiesById.has(edge.sourceId as KnowledgeEntityId)
      ? (edge.sourceId as KnowledgeEntityId)
      : undefined;
    const targetId = entitiesById.has(edge.targetId as KnowledgeEntityId)
      ? (edge.targetId as KnowledgeEntityId)
      : undefined;

    if (sourceId) {
      appendMapValue(outgoingEdgesByEntityId, sourceId, edge);
      appendMapValue(edgesByEntityId, sourceId, edge);
    }

    if (targetId) {
      appendMapValue(incomingEdgesByEntityId, targetId, edge);
      appendMapValue(edgesByEntityId, targetId, edge);
    }
  }

  return {
    entitiesById,
    edgesById: new Map(seed.edges.map((item) => [item.id, item])),
    domainsById: new Map(seed.domains.map((item) => [item.id, item])),
    tagsById: new Map(seed.tags.map((item) => [item.id, item])),
    citationsById: new Map(seed.citations.map((item) => [item.id, item])),
    sourcesById: new Map(seed.sources.map((item) => [item.id, item])),
    portraitsById: new Map(seed.portraitAssets.map((item) => [item.id, item])),
    outgoingEdgesByEntityId,
    incomingEdgesByEntityId,
    edgesByEntityId,
  };
};

export const seedIndex = buildSeedIndex(sacredTimelineSeed);

export const getEntityById = (
  id: KnowledgeEntityId | undefined,
  index: SeedIndex = seedIndex,
) => (id ? index.entitiesById.get(id) : undefined);

export const getEntitiesByType = (
  entityType: CanonicalEntityType,
  index: SeedIndex = seedIndex,
) =>
  Array.from(index.entitiesById.values()).filter((entity) => entity.entityType === entityType);

export const getEdgeById = (edgeId: string | undefined, index: SeedIndex = seedIndex) =>
  edgeId ? index.edgesById.get(edgeId) : undefined;

export const getPortraitsForEntity = (
  entityId: KnowledgeEntityId | undefined,
  seed: SacredTimelineSeedData = sacredTimelineSeed,
) =>
  entityId
    ? seed.portraitAssets.filter((portrait) => portrait.depictedEntityIds.includes(entityId))
    : [];

export const getPrimaryPortraitForEntity = (
  entityId: KnowledgeEntityId | undefined,
  seed: SacredTimelineSeedData = sacredTimelineSeed,
) =>
  getPortraitsForEntity(entityId, seed).sort((left, right) => {
    if (left.isPrimaryPortrait === right.isPrimaryPortrait) return 0;
    return left.isPrimaryPortrait ? -1 : 1;
  })[0];

export const getCitationsForEntity = (
  entityId: KnowledgeEntityId | undefined,
  seed: SacredTimelineSeedData = sacredTimelineSeed,
) =>
  entityId
    ? seed.citations.filter((citation) => citation.relatedEntityIds.includes(entityId))
    : [];

export const getEdgesForEntity = (
  entityId: KnowledgeEntityId | undefined,
  index: SeedIndex = seedIndex,
) => (entityId ? index.edgesByEntityId.get(entityId) ?? [] : []);

export const getOutgoingEdgesForEntity = (
  entityId: KnowledgeEntityId | undefined,
  index: SeedIndex = seedIndex,
) => (entityId ? index.outgoingEdgesByEntityId.get(entityId) ?? [] : []);

export const getIncomingEdgesForEntity = (
  entityId: KnowledgeEntityId | undefined,
  index: SeedIndex = seedIndex,
) => (entityId ? index.incomingEdgesByEntityId.get(entityId) ?? [] : []);

export const getRelatedEntities = (
  entity: KnowledgeEntity | undefined,
  index: SeedIndex = seedIndex,
) =>
  entity
    ? entity.relatedEntityIds
        .map((id) => index.entitiesById.get(id))
        .filter((value): value is KnowledgeEntity => Boolean(value))
    : [];

export const getTraditionsForEntity = (
  entity: KnowledgeEntity | undefined,
  seed: SacredTimelineSeedData = sacredTimelineSeed,
) => {
  if (!entity) return [] as Tradition[];

  const ids =
    entity.entityType === "person" ||
    entity.entityType === "text" ||
    entity.entityType === "concept" ||
    entity.entityType === "institution"
      ? entity.traditionIds
      : [];

  return seed.traditions.filter((tradition) => ids.includes(tradition.id));
};

export const getDomainLabels = (domainIds: DomainId[], index: SeedIndex = seedIndex) =>
  domainIds
    .map((id) => index.domainsById.get(id)?.label)
    .filter((value): value is string => Boolean(value));

export const getTagLabels = (tagIds: TagId[], index: SeedIndex = seedIndex) =>
  tagIds
    .map((id) => index.tagsById.get(id)?.label)
    .filter((value): value is string => Boolean(value));

export const getEntityDateLabel = (entity: KnowledgeEntity | undefined) =>
  entity?.dateRange?.displayLabel ?? "Undated";

export const getEntityTypeLabel = (entityType: CanonicalEntityType) =>
  ({
    person: "Person",
    text: "Text",
    concept: "Concept",
    event: "Event",
    place: "Place",
    institution: "Institution",
    tradition: "Tradition",
  })[entityType];

export const getPrimaryYear = (dateRange?: HistoricalDateRange) =>
  getPrimaryYearFromDateRange(dateRange);

export { sortEntitiesChronologically };

export const filterEntities = (
  seed: SacredTimelineSeedData,
  filters: ExplorerFilters,
) => filterKnowledgeEntities(seed, filters);

export const getAvailablePlaces = (seed: SacredTimelineSeedData = sacredTimelineSeed) =>
  seed.places.filter((place) => Boolean(place.geometry?.point));
