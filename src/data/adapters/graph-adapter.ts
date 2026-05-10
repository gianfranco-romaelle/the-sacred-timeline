import type { ExplorerFilters, ExplorerView } from "@/state/explorer-store";
import { buildFocusContext, getContextReasonForEntity, type ContextReason } from "@/data/focus-context";
import { extractEntityEditorialMetadata } from "@/editorial/stage-lens";
import type { ProjectionInput, ViewProjection, ViewProjectionAdapter } from "@/types/projections";
import type { EntityEditorialMetadata } from "@/editorial/types";
import type {
  CanonicalEntityType,
  DomainId,
  EdgeRelationType,
  KnowledgeEntity,
  KnowledgeEntityId,
  SacredTimelineSeedData,
  TagId,
  TraditionId,
} from "@/types";
import type { SeedIndex } from "@/data/entity-index";
import { filterKnowledgeEntities, filterVisibleEdges } from "@/data/filtering";
import { deriveEntityNeighborhood } from "@/data/relation-helpers";
import { buildProjectionDiagnostics } from "./projection-diagnostics";

export type ConstellationEntityType =
  | "person"
  | "text"
  | "concept"
  | "institution"
  | "place";

export type ConstellationTone = "science" | "religion" | "hybrid" | "neutral";
export type ConstellationClusterKind =
  | "embedding_cluster"
  | "school"
  | "math_tag"
  | "scientific_domain"
  | "cognitive_tag"
  | "calculus"
  | "domain"
  | "entity_type";

export interface ConstellationCluster {
  id: string;
  label: string;
  kind: ConstellationClusterKind;
  nodeIds: KnowledgeEntityId[];
  anchorNodeIds: KnowledgeEntityId[];
  tagIds: TagId[];
  traditionIds: TraditionId[];
  domainIds: DomainId[];
  calculiIds: number[];
  evidenceCount: number;
  centralityMean: number;
  sourceFileRefs: string[];
  storyLayerIds: string[];
}

export interface GraphNode {
  id: KnowledgeEntityId;
  entityType: ConstellationEntityType;
  label: string;
  description: string;
  domainIds: DomainId[];
  tagIds: TagId[];
  traditionIds: TraditionId[];
  clusterKey: string;
  clusterLabel: string;
  clusterIds: string[];
  primaryClusterId: string;
  semanticCentrality: number;
  isClusterAnchor: boolean;
  semanticNeighborNames: string[];
  storyLayerIds: string[];
  ontologyFacetLabels: string[];
  degree: number;
  size: number;
  tone: ConstellationTone;
  editorial?: EntityEditorialMetadata;
  isSelected: boolean;
  isNeighbor: boolean;
  isContextRelevant: boolean;
  contextReason?: ContextReason;
  isDimmed: boolean;
  isPinned?: boolean;
  isSearchMatch?: boolean;
  depthDistance?: number;
}

export interface GraphEdge {
  id: `edge_${string}`;
  source: KnowledgeEntityId;
  target: KnowledgeEntityId;
  relationType: EdgeRelationType;
  label: string;
  weight: number;
  isSemantic?: boolean;
  semanticKind?: ConstellationClusterKind | "embedding_neighbor";
  isSelectionAdjacent: boolean;
  isDimmed: boolean;
}

export interface GraphProjection extends ViewProjection<{
  nodes: number;
  edges: number;
  selectedNeighborCount: number;
  contextNodeCount: number;
}> {
  nodes: GraphNode[];
  edges: GraphEdge[];
  clusters: ConstellationCluster[];
  visibleRelationTypes: EdgeRelationType[];
}

const constellationNodeTypes = new Set<ConstellationEntityType>([
  "person",
  "text",
  "concept",
  "institution",
  "place",
]);

const getNodeTone = (domainIds: DomainId[]): ConstellationTone => {
  const hasScience = domainIds.includes("domain_science");
  const hasReligion = domainIds.includes("domain_religion");

  if (hasScience && hasReligion) return "hybrid";
  if (hasScience) return "science";
  if (hasReligion) return "religion";
  return "neutral";
};

const slugifyClusterPart = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "cluster";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const stringArrayFromUnknown = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" || typeof item === "number" ? String(item) : ""))
    .map((item) => item.trim())
    .filter(Boolean);
};

const stringFromUnknown = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const numberFromUnknown = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const getMetadata = (entity: KnowledgeEntity) =>
  isRecord(entity.metadata) ? entity.metadata : {};

const normalizeClusterLabel = (value: string) =>
  value
    .replace(/^cluster[_:-]+/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const getClusterId = (kind: ConstellationClusterKind, label: string) =>
  `cluster_${kind}_${slugifyClusterPart(label)}`;

const calculusLabel = (value: number) => {
  const labels = ["Zeroth", "First", "Second", "Third", "Fourth", "Fifth", "Sixth"];
  return `${labels[value] ?? `Stage ${value}`} Calculus`;
};

interface ClusterCandidate {
  id: string;
  label: string;
  kind: ConstellationClusterKind;
  tagIds?: TagId[];
  traditionIds?: TraditionId[];
  domainIds?: DomainId[];
  calculiIds?: number[];
  storyLayerIds?: string[];
  sourceFileRefs?: string[];
}

const clusterKindRank: Record<ConstellationClusterKind, number> = {
  embedding_cluster: 0,
  school: 1,
  math_tag: 2,
  scientific_domain: 3,
  cognitive_tag: 4,
  calculus: 5,
  domain: 6,
  entity_type: 7,
};

const semanticRelationLabel: Record<ConstellationClusterKind | "embedding_neighbor", string> = {
  embedding_cluster: "embedding cluster",
  school: "shared school",
  math_tag: "shared math tag",
  scientific_domain: "shared scientific domain",
  cognitive_tag: "shared cognitive tag",
  calculus: "shared calculus",
  domain: "shared domain",
  entity_type: "shared entity type",
  embedding_neighbor: "semantic neighbor",
};

const getSemanticCentrality = (
  entity: KnowledgeEntity,
  degree: number,
  candidates: ClusterCandidate[],
) => {
  const metadata = getMetadata(entity);
  const importedCentrality = numberFromUnknown(metadata.centralityScore);
  if (importedCentrality !== undefined) return importedCentrality;

  return Math.min(
    1,
    0.18 +
      Math.min(0.34, degree * 0.035) +
      Math.min(0.18, entity.citationIds.length * 0.04) +
      Math.min(0.16, entity.relatedEntityIds.length * 0.025) +
      Math.min(0.14, candidates.length * 0.018),
  );
};

const getSemanticNeighborNames = (entity: KnowledgeEntity) => {
  const metadata = getMetadata(entity);
  return [
    ...stringArrayFromUnknown(metadata.semanticNeighbors),
    ...stringArrayFromUnknown(metadata.relatedEntities),
  ];
};

const getEntityTraditionIdsForGraph = (entity: KnowledgeEntity): TraditionId[] => {
  if (
    entity.entityType === "person" ||
    entity.entityType === "text" ||
    entity.entityType === "concept" ||
    entity.entityType === "institution"
  ) {
    return entity.traditionIds;
  }

  return [];
};

const getTagClusterKind = (tagId: TagId, index: SeedIndex): ConstellationClusterKind | undefined => {
  if (tagId.startsWith("tag_genesis_math_")) return "math_tag";
  if (tagId.startsWith("tag_genesis_scientific_")) return "scientific_domain";
  if (tagId.startsWith("tag_genesis_cognitive_")) return "cognitive_tag";
  if (tagId.startsWith("tag_genesis_pipeline_")) return undefined;

  const category = index.tagsById.get(tagId)?.category;
  if (category === "method") return "math_tag";
  if (category === "discipline") return "scientific_domain";
  if (category === "theme" || category === "period") return "cognitive_tag";
  return undefined;
};

const getEntityClusterCandidates = (
  entity: KnowledgeEntity,
  index: SeedIndex,
): ClusterCandidate[] => {
  const metadata = getMetadata(entity);
  const editorial = extractEntityEditorialMetadata(entity);
  const sourceFileRefs = stringArrayFromUnknown(metadata.sourceFiles);
  const candidates: ClusterCandidate[] = [];
  const storyLayerIds: string[] = [];

  const embeddingLabels = [
    stringFromUnknown(metadata.embeddingCluster),
    ...(entity.embedding?.clusterIds ?? []).map((id) => normalizeClusterLabel(id)),
  ]
    .filter((label): label is string => Boolean(label))
    .filter((label, index, labels) => labels.indexOf(label) === index);

  embeddingLabels.forEach((label) => {
    const storyLayerId = `story_${slugifyClusterPart(label)}`;
    storyLayerIds.push(storyLayerId);
    candidates.push({
      id: getClusterId("embedding_cluster", label),
      label,
      kind: "embedding_cluster",
      storyLayerIds: [storyLayerId],
      sourceFileRefs,
    });
  });

  getEntityTraditionIdsForGraph(entity).forEach((traditionId) => {
    const label = index.entitiesById.get(traditionId)?.label ?? "Shared school";
    candidates.push({
      id: getClusterId("school", label),
      label,
      kind: "school",
      traditionIds: [traditionId],
    });
  });

  entity.tagIds.forEach((tagId) => {
    const kind = getTagClusterKind(tagId, index);
    if (!kind) return;
    const label = index.tagsById.get(tagId)?.label ?? "Shared tag";
    candidates.push({
      id: getClusterId(kind, label),
      label,
      kind,
      tagIds: [tagId],
    });
  });

  if (editorial?.calculusStage !== undefined) {
    const label = calculusLabel(editorial.calculusStage);
    candidates.push({
      id: getClusterId("calculus", label),
      label,
      kind: "calculus",
      calculiIds: [editorial.calculusStage],
    });
  }

  entity.domainIds.forEach((domainId) => {
    const label = index.domainsById.get(domainId)?.label ?? "Shared domain";
    candidates.push({
      id: getClusterId("domain", label),
      label,
      kind: "domain",
      domainIds: [domainId],
    });
  });

  candidates.push({
    id: getClusterId("entity_type", entity.entityType),
    label: entity.entityType.replaceAll("_", " "),
    kind: "entity_type",
  });

  const uniqueCandidates = new Map<string, ClusterCandidate>();
  candidates.forEach((candidate) => {
    if (!uniqueCandidates.has(candidate.id)) uniqueCandidates.set(candidate.id, candidate);
  });

  return [...uniqueCandidates.values()].map((candidate) => ({
    ...candidate,
    storyLayerIds: [...new Set([...(candidate.storyLayerIds ?? []), ...storyLayerIds])],
    sourceFileRefs: [...new Set([...(candidate.sourceFileRefs ?? []), ...sourceFileRefs])],
  }));
};

export const buildGraphProjection = (
  seed: SacredTimelineSeedData,
  index: SeedIndex,
  filters: ExplorerFilters,
  selectedEntityId?: KnowledgeEntityId,
  selectionSourceView?: ExplorerView,
): GraphProjection => {
  const visibleEntities = filterKnowledgeEntities(seed, filters).filter((entity) =>
    constellationNodeTypes.has(entity.entityType as ConstellationEntityType),
  );
  const visibleEntityIds = new Set(visibleEntities.map((entity) => entity.id));
  const visibleEdges = filterVisibleEdges(seed.edges, visibleEntityIds, filters);
  const degreeByEntityId = new Map<KnowledgeEntityId, number>();

  for (const edge of visibleEdges) {
    const sourceId = edge.sourceId as KnowledgeEntityId;
    const targetId = edge.targetId as KnowledgeEntityId;
    degreeByEntityId.set(sourceId, (degreeByEntityId.get(sourceId) ?? 0) + 1);
    degreeByEntityId.set(targetId, (degreeByEntityId.get(targetId) ?? 0) + 1);
  }

  const neighborhood = deriveEntityNeighborhood(selectedEntityId, index, filters.relationTypes);
  const focusContext = buildFocusContext(seed, index, filters, selectedEntityId, selectionSourceView);

  let nodes: GraphNode[] = visibleEntities.map((entity) => {
    const degree = degreeByEntityId.get(entity.id) ?? 0;
    const isSelected = selectedEntityId === entity.id;
    const isNeighbor = neighborhood.neighborIds.includes(entity.id);
    const contextReason = getContextReasonForEntity(entity, focusContext);
    const isContextRelevant = Boolean(contextReason);
    const traditionIds = getEntityTraditionIdsForGraph(entity);
    const clusterCandidates = getEntityClusterCandidates(entity, index).sort(
      (left, right) => clusterKindRank[left.kind] - clusterKindRank[right.kind],
    );
    const primaryCluster = clusterCandidates[0];
    const semanticCentrality = getSemanticCentrality(entity, degree, clusterCandidates);
    const storyLayerIds = Array.from(
      new Set(clusterCandidates.flatMap((cluster) => cluster.storyLayerIds ?? [])),
    );
    const sourceFileRefs = Array.from(
      new Set(clusterCandidates.flatMap((cluster) => cluster.sourceFileRefs ?? [])),
    );
    const ontologyFacetLabels = clusterCandidates
      .filter((cluster) => cluster.kind !== "entity_type")
      .slice(0, 8)
      .map((cluster) => cluster.label);

    return {
      id: entity.id,
      entityType: entity.entityType as ConstellationEntityType,
      label: entity.label,
      description: entity.description,
      domainIds: entity.domainIds,
      tagIds: entity.tagIds,
      traditionIds,
      clusterKey: primaryCluster.id,
      clusterLabel: primaryCluster.label,
      clusterIds: clusterCandidates.map((cluster) => cluster.id),
      primaryClusterId: primaryCluster.id,
      semanticCentrality,
      isClusterAnchor: false,
      semanticNeighborNames: getSemanticNeighborNames(entity),
      storyLayerIds,
      ontologyFacetLabels: [...new Set([...ontologyFacetLabels, ...sourceFileRefs])],
      degree,
      size: Math.min(22, 7 + degree * 1.1 + entity.citationIds.length * 0.5 + semanticCentrality * 6),
      tone: getNodeTone(entity.domainIds),
      editorial: extractEntityEditorialMetadata(entity),
      isSelected,
      isNeighbor,
      isContextRelevant,
      contextReason,
      isDimmed: Boolean(selectedEntityId && !isSelected && !isNeighbor && !isContextRelevant),
    } satisfies GraphNode;
  });

  const edges = visibleEdges.map((edge) => {
    const isSelectionAdjacent =
      edge.sourceId === selectedEntityId ||
      edge.targetId === selectedEntityId ||
      neighborhood.neighborIds.includes(edge.sourceId as KnowledgeEntityId) ||
      neighborhood.neighborIds.includes(edge.targetId as KnowledgeEntityId);

    return {
      id: edge.id,
      source: edge.sourceId as KnowledgeEntityId,
      target: edge.targetId as KnowledgeEntityId,
      relationType: edge.relationType,
      label: edge.label,
      weight: edge.weight ?? 1,
      isSemantic: false,
      isSelectionAdjacent,
      isDimmed: Boolean(selectedEntityId && !isSelectionAdjacent),
    } satisfies GraphEdge;
  });
  const existingEdgeKeys = new Set(
    edges.map((edge) =>
      [edge.source, edge.target].sort().join("|"),
    ),
  );
  const semanticEdges: GraphEdge[] = [];
  const nodesByCluster = new Map<string, GraphNode[]>();
  const clusterInfoById = new Map<string, ClusterCandidate>();

  nodes.forEach((node) => {
    const entity = index.entitiesById.get(node.id);
    if (!entity) return;
    getEntityClusterCandidates(entity, index).forEach((cluster) => {
      clusterInfoById.set(cluster.id, cluster);
      const group = nodesByCluster.get(cluster.id);
      if (group) {
        group.push(node);
      } else {
        nodesByCluster.set(cluster.id, [node]);
      }
    });
  });

  const clusters: ConstellationCluster[] = [];
  const anchorNodeIds = new Set<KnowledgeEntityId>();

  for (const [clusterId, clusterNodes] of nodesByCluster) {
    const clusterInfo = clusterInfoById.get(clusterId);
    if (!clusterInfo) continue;
    const sortedClusterNodes = [...clusterNodes].sort(
      (left, right) =>
        right.semanticCentrality - left.semanticCentrality ||
        right.degree - left.degree ||
        left.label.localeCompare(right.label),
    );
    const anchorIds = sortedClusterNodes.slice(0, Math.min(5, sortedClusterNodes.length)).map((node) => node.id);
    anchorIds.forEach((id) => anchorNodeIds.add(id));

    clusters.push({
      id: clusterId,
      label: clusterInfo.label,
      kind: clusterInfo.kind,
      nodeIds: sortedClusterNodes.map((node) => node.id),
      anchorNodeIds: anchorIds,
      tagIds: [...new Set(clusterNodes.flatMap((node) => node.tagIds))],
      traditionIds: [...new Set(clusterNodes.flatMap((node) => node.traditionIds))],
      domainIds: [...new Set(clusterNodes.flatMap((node) => node.domainIds))],
      calculiIds: [...new Set(clusterNodes.flatMap((node) => node.editorial?.calculusStage ?? []))],
      evidenceCount: clusterNodes.reduce(
        (total, node) => total + node.degree + node.ontologyFacetLabels.length,
        0,
      ),
      centralityMean:
        clusterNodes.reduce((total, node) => total + node.semanticCentrality, 0) / clusterNodes.length,
      sourceFileRefs: [...new Set(clusterNodes.flatMap((node) => node.ontologyFacetLabels).filter((label) => /\d|\.pdf/i.test(label)))],
      storyLayerIds: [...new Set(clusterNodes.flatMap((node) => node.storyLayerIds))],
    });
  }

  nodes = nodes.map((node) => ({
    ...node,
    isClusterAnchor: anchorNodeIds.has(node.id),
  }));

  const sortedClusters = clusters.sort(
    (left, right) =>
      clusterKindRank[left.kind] - clusterKindRank[right.kind] ||
      right.anchorNodeIds.length - left.anchorNodeIds.length ||
      right.centralityMean - left.centralityMean ||
      left.label.localeCompare(right.label),
  );

  const nodeByLabel = new Map(nodes.map((node) => [node.label.toLowerCase(), node]));

  for (const [clusterKey, clusterNodes] of nodesByCluster) {
    if (clusterNodes.length < 2 || semanticEdges.length > 160) continue;
    const clusterInfo = clusterInfoById.get(clusterKey);
    if (!clusterInfo || clusterInfo.kind === "entity_type") continue;
    const sortedClusterNodes = [...clusterNodes].sort((left, right) => right.semanticCentrality - left.semanticCentrality);
    const anchor = sortedClusterNodes[0];

    sortedClusterNodes.slice(1, 12).forEach((node, index) => {
      const edgeKey = [anchor.id, node.id].sort().join("|");
      if (existingEdgeKeys.has(edgeKey)) return;
      existingEdgeKeys.add(edgeKey);
      semanticEdges.push({
        id: `edge_semantic_cluster_${clusterKey.replace(/[^a-z0-9]+/gi, "_")}_${index}` as `edge_${string}`,
        source: anchor.id,
        target: node.id,
        relationType: "associated_with",
        label: semanticRelationLabel[clusterInfo.kind],
        weight: 0.16,
        isSemantic: true,
        semanticKind: clusterInfo.kind,
        isSelectionAdjacent: false,
        isDimmed: Boolean(selectedEntityId),
      });
    });
  }

  nodes.forEach((node) => {
    node.semanticNeighborNames.slice(0, 8).forEach((neighborName, index) => {
      const target = nodeByLabel.get(neighborName.toLowerCase());
      if (!target || target.id === node.id || semanticEdges.length > 220) return;
      const edgeKey = [node.id, target.id].sort().join("|");
      if (existingEdgeKeys.has(edgeKey)) return;
      existingEdgeKeys.add(edgeKey);
      semanticEdges.push({
        id: `edge_semantic_neighbor_${node.id}_${index}` as `edge_${string}`,
        source: node.id,
        target: target.id,
        relationType: "associated_with",
        label: semanticRelationLabel.embedding_neighbor,
        weight: 0.24,
        isSemantic: true,
        semanticKind: "embedding_neighbor",
        isSelectionAdjacent: false,
        isDimmed: Boolean(selectedEntityId),
      });
    });
  });

  const graphEdges = [...edges, ...semanticEdges];

  return {
    projectionKind: "constellation",
    nodes,
    edges: graphEdges,
    clusters: sortedClusters,
    visibleRelationTypes: Array.from(new Set(graphEdges.map((edge) => edge.relationType))),
    diagnostics: buildProjectionDiagnostics({
      projectionKind: "constellation",
      nodeCount: nodes.length,
      edgeCount: graphEdges.length,
    }),
    visibleCounts: {
      nodes: nodes.length,
      edges: graphEdges.length,
      selectedNeighborCount: neighborhood.neighborIds.length,
      contextNodeCount: nodes.filter((node) => node.isContextRelevant).length,
    },
  };
};

export const graphProjectionAdapter: ViewProjectionAdapter<GraphProjection> = ({
  seed,
  index,
  filters,
  selectedEntityId,
  selectionSourceView,
}: ProjectionInput) =>
  buildGraphProjection(seed, index, filters, selectedEntityId, selectionSourceView);
