import {
  getCitationsForEntity,
  getDomainLabels,
  getEntityDateLabel,
  getEntityTypeLabel,
  getTraditionsForEntity,
  type SeedIndex,
} from "@/data/entity-index";
import { getContextReasonForEntity, type ContextReason } from "@/data/focus-context";
import { filterKnowledgeEntities, filterVisibleEdges } from "@/data/filtering";
import {
  defaultScriptoriumAuthoringOverlay,
  mergeScriptoriumAuthoringOverlay,
} from "@/data/scriptorium-authoring";
import type { ExplorerFilters, ExplorerView } from "@/state/explorer-store";
import type {
  CanonicalEntityType,
  Edge,
  InstagramPostReference,
  KnowledgeEntity,
  KnowledgeEntityId,
  SacredTimelineSeedData,
  ScriptoriumAuthoringOverlay,
  ScriptoriumExhibit,
  ScriptoriumRelationshipSuggestion,
} from "@/types";
import { buildFocusContext } from "@/data/focus-context";
import type { ProjectionInput, ViewProjection, ViewProjectionAdapter } from "@/types/projections";
import { buildProjectionDiagnostics } from "./projection-diagnostics";

export type ScriptoriumZone = "text" | "school" | "person" | "concept";
export type ScriptoriumMode = "gallery" | "map" | "exhibits" | "review";

export interface ScriptoriumNodeProjection {
  id: string;
  entityId: KnowledgeEntityId;
  entityType: CanonicalEntityType;
  label: string;
  entityTypeLabel: string;
  dateLabel: string;
  description: string;
  note: string;
  position: { x: number; y: number };
  zone: ScriptoriumZone;
  emphasis: "primary" | "secondary";
  isSelected: boolean;
  isNeighbor: boolean;
  isContextRelevant: boolean;
  contextReason?: ContextReason;
}

export interface ScriptoriumEdgeProjection {
  id: string;
  source: string;
  target: string;
  label: string;
  note: string;
  tone: "authorship" | "institutional" | "conceptual" | "contested" | "transmission";
  isContextRelevant: boolean;
  reviewState: "approved" | "suggested";
}

export interface ScriptoriumGalleryItem {
  id: KnowledgeEntityId;
  entityId: KnowledgeEntityId;
  entityType: CanonicalEntityType;
  label: string;
  description: string;
  dateLabel: string;
  domainLabels: string[];
  traditionLabels: string[];
  sourceLabel?: string;
  drivePath?: string;
  importedDriveTrial: boolean;
  relationCount: number;
  citationCount: number;
  instagramReferenceCount: number;
  reviewState: "approved" | "suggested";
}

export interface ScriptoriumProjection extends ViewProjection<{
  galleryItems: number;
  nodes: number;
  edges: number;
  exhibits: number;
  instagramReferences: number;
  reviewItems: number;
}> {
  sourceLayer: "canonical_plus_authoring_overlay";
  title: string;
  description: string;
  zoneLabels: Record<ScriptoriumZone, string>;
  galleryItems: ScriptoriumGalleryItem[];
  nodes: ScriptoriumNodeProjection[];
  edges: ScriptoriumEdgeProjection[];
  instagramReferences: InstagramPostReference[];
  exhibits: ScriptoriumExhibit[];
  relationshipSuggestions: ScriptoriumRelationshipSuggestion[];
  approvedExhibits: ScriptoriumExhibit[];
}

const zoneLabels: Record<ScriptoriumZone, string> = {
  text: "Texts and source artifacts",
  school: "Schools and traditions",
  person: "Individuals",
  concept: "Concepts and methods",
};

const zoneForEntity = (entity: KnowledgeEntity): ScriptoriumZone => {
  if (entity.entityType === "text") return "text";
  if (entity.entityType === "tradition" || entity.entityType === "institution") return "school";
  if (entity.entityType === "person") return "person";
  return "concept";
};

const toneForEdge = (edge: Edge): ScriptoriumEdgeProjection["tone"] => {
  if (edge.assertionLayer === "ai_hypothesis") return "contested";
  if (edge.relationType === "member_of" || edge.relationType === "founded") return "institutional";
  if (edge.relationType === "developed_concept" || edge.relationType === "mathematical_generalization_of") {
    return "conceptual";
  }
  if (edge.relationType === "influenced" || edge.relationType === "translated") return "transmission";
  return "authorship";
};

const getDrivePath = (entity: KnowledgeEntity) => {
  const value = entity.metadata?.drivePath;
  return typeof value === "string" ? value : undefined;
};

const getSourceLabel = (entity: KnowledgeEntity, index: SeedIndex) => {
  const sourceId = entity.metadata?.sourceId;
  return typeof sourceId === "string" ? index.sourcesById.get(sourceId)?.label : undefined;
};

const isImportedDriveTrial = (entity: KnowledgeEntity) =>
  entity.metadata?.importedDriveTrial === true;

const gallerySort = (left: ScriptoriumGalleryItem, right: ScriptoriumGalleryItem) => {
  if (left.importedDriveTrial !== right.importedDriveTrial) return left.importedDriveTrial ? -1 : 1;
  if (left.entityType !== right.entityType) {
    const order = ["text", "person", "tradition", "institution", "concept", "event", "place"];
    return order.indexOf(left.entityType) - order.indexOf(right.entityType);
  }
  return left.label.localeCompare(right.label);
};

const selectMapEntities = (
  entities: KnowledgeEntity[],
  index: SeedIndex,
  selectedEntityId?: KnowledgeEntityId,
) => {
  if (!selectedEntityId) return entities.slice(0, 36);
  const neighborIds = new Set<KnowledgeEntityId>([selectedEntityId]);
  for (const edge of index.edgesByEntityId.get(selectedEntityId) ?? []) {
    if (index.entitiesById.has(edge.sourceId as KnowledgeEntityId)) {
      neighborIds.add(edge.sourceId as KnowledgeEntityId);
    }
    if (index.entitiesById.has(edge.targetId as KnowledgeEntityId)) {
      neighborIds.add(edge.targetId as KnowledgeEntityId);
    }
  }
  return entities.filter((entity) => neighborIds.has(entity.id)).slice(0, 48);
};

const positionFor = (entity: KnowledgeEntity, index: number) => {
  const zone = zoneForEntity(entity);
  const column = { text: 80, school: 420, person: 760, concept: 1100 }[zone];
  return { x: column, y: 70 + (index % 10) * 112 };
};

export const buildScriptoriumProjection = (
  seed: SacredTimelineSeedData,
  index: SeedIndex,
  filters: ExplorerFilters,
  selectedEntityId?: KnowledgeEntityId,
  selectionSourceView?: ExplorerView,
  authoringOverlay?: Partial<ScriptoriumAuthoringOverlay>,
): ScriptoriumProjection => {
  const overlay = mergeScriptoriumAuthoringOverlay(
    defaultScriptoriumAuthoringOverlay,
    authoringOverlay,
  );
  const focusContext = buildFocusContext(seed, index, filters, selectedEntityId, selectionSourceView);
  const visibleEntities = filterKnowledgeEntities(seed, filters);
  const visibleEntityIds = new Set(visibleEntities.map((entity) => entity.id));

  const instagramCounts = new Map<KnowledgeEntityId, number>();
  for (const reference of overlay.instagramReferences) {
    for (const entityId of reference.linkedEntityIds) {
      instagramCounts.set(entityId, (instagramCounts.get(entityId) ?? 0) + 1);
    }
  }

  const galleryItems = visibleEntities
    .filter((entity) =>
      ["text", "person", "tradition", "institution", "concept"].includes(entity.entityType),
    )
    .map((entity) => {
      const importedDriveTrial = isImportedDriveTrial(entity);
      return {
        id: entity.id,
        entityId: entity.id,
        entityType: entity.entityType,
        label: entity.label,
        description: entity.description,
        dateLabel: getEntityDateLabel(entity),
        domainLabels: getDomainLabels(entity.domainIds, index).slice(0, 3),
        traditionLabels: getTraditionsForEntity(entity, seed).map((tradition) => tradition.label).slice(0, 3),
        sourceLabel: getSourceLabel(entity, index),
        drivePath: getDrivePath(entity),
        importedDriveTrial,
        relationCount: index.edgesByEntityId.get(entity.id)?.length ?? 0,
        citationCount: getCitationsForEntity(entity.id, seed).length,
        instagramReferenceCount: instagramCounts.get(entity.id) ?? 0,
        reviewState: importedDriveTrial ? "suggested" : "approved",
      } satisfies ScriptoriumGalleryItem;
    }).sort(gallerySort);

  const mapEntities = selectMapEntities(visibleEntities, index, selectedEntityId);
  const mapEntityIds = new Set(mapEntities.map((entity) => entity.id));

  const nodes = mapEntities.map((entity, nodeIndex) => {
    const contextReason = getContextReasonForEntity(entity, focusContext);
    return {
      id: entity.id,
      entityId: entity.id,
      entityType: entity.entityType,
      label: entity.label,
      entityTypeLabel: getEntityTypeLabel(entity.entityType),
      dateLabel: getEntityDateLabel(entity),
      description: entity.description,
      note: isImportedDriveTrial(entity)
        ? "Imported Drive library record awaiting curatorial review."
        : entity.description,
      position: positionFor(entity, nodeIndex),
      zone: zoneForEntity(entity),
      emphasis: entity.id === selectedEntityId || entity.entityType === "text" ? "primary" : "secondary",
      isSelected: selectedEntityId === entity.id,
      isNeighbor: focusContext.neighborIds.includes(entity.id),
      isContextRelevant: Boolean(contextReason),
      contextReason,
    } satisfies ScriptoriumNodeProjection;
  });

  const edges = filterVisibleEdges(seed.edges, mapEntityIds, filters).map((edge) => {
    const isContextRelevant = Boolean(
      selectedEntityId && (edge.sourceId === selectedEntityId || edge.targetId === selectedEntityId),
    );
    return {
      id: edge.id,
      source: edge.sourceId,
      target: edge.targetId,
      label: edge.label,
      note: edge.description,
      tone: toneForEdge(edge),
      isContextRelevant,
      reviewState: edge.assertionLayer === "ai_hypothesis" ? "suggested" : "approved",
    } satisfies ScriptoriumEdgeProjection;
  });

  const approvedExhibits = overlay.exhibits.filter((exhibit) => exhibit.reviewState === "approved");
  const reviewItems =
    galleryItems.filter((item) => item.reviewState === "suggested").length +
    overlay.instagramReferences.filter((item) => item.reviewState === "suggested").length +
    overlay.relationshipSuggestions.filter((item) => item.reviewState === "suggested").length +
    overlay.exhibits.filter((item) => item.reviewState === "suggested").length;

  return {
    projectionKind: "scriptorium",
    sourceLayer: "canonical_plus_authoring_overlay",
    title: "Scriptorium Unified Gallery",
    description:
      "A curated workspace relating Drive library texts, Instagram references, schools, individuals, concepts, and authored exhibits.",
    zoneLabels,
    galleryItems,
    nodes,
    edges,
    instagramReferences: overlay.instagramReferences,
    exhibits: overlay.exhibits,
    relationshipSuggestions: overlay.relationshipSuggestions,
    approvedExhibits,
    diagnostics: buildProjectionDiagnostics({
      projectionKind: "scriptorium",
      nodeCount: nodes.length,
      edgeCount: edges.length,
    }),
    visibleCounts: {
      galleryItems: galleryItems.length,
      nodes: nodes.length,
      edges: edges.length,
      exhibits: overlay.exhibits.length,
      instagramReferences: overlay.instagramReferences.length,
      reviewItems,
    },
  };
};

export const scriptoriumProjectionAdapter: ViewProjectionAdapter<ScriptoriumProjection> = ({
  seed,
  index,
  filters,
  selectedEntityId,
  selectionSourceView,
}: ProjectionInput) =>
  buildScriptoriumProjection(seed, index, filters, selectedEntityId, selectionSourceView);
