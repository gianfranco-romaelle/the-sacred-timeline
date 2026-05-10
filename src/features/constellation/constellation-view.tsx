import { useMemo, useState } from "react";
import {
  graphProjectionAdapter,
  type ConstellationClusterKind,
  type GraphProjection,
} from "@/data/adapters/graph-adapter";
import { EmptyStateCard } from "@/components/shared/empty-state-card";
import type { SeedIndex } from "@/data/entity-index";
import { useViewCoordination } from "@/features/shared/use-view-coordination";
import { useExplorerStore } from "@/state/explorer-store";
import type { KnowledgeEntityId, SacredTimelineSeedData } from "@/types";
import { ConstellationCanvas, type ConstellationLayoutMode } from "./constellation-canvas";
import {
  ConstellationControls,
  type ConstellationDensity,
  type ConstellationViewMode,
} from "./constellation-controls";
import { ConstellationLegend } from "./constellation-legend";
import {
  constellationRelationFamilies,
  getEdgeRelationFamily,
  getRelationFamily,
  type ConstellationRelationFamilyId,
} from "./constellation-styles";

interface ConstellationViewProps {
  seed: SacredTimelineSeedData;
  index: SeedIndex;
}

export function ConstellationView({ seed, index }: ConstellationViewProps) {
  const [hoveredNodeId, setHoveredNodeId] = useState<KnowledgeEntityId | undefined>(undefined);
  const [viewMode, setViewMode] = useState<ConstellationViewMode>("regions");
  const [density, setDensity] = useState<ConstellationDensity>("readable");
  const [layoutMode, setLayoutMode] = useState<ConstellationLayoutMode>("circle");
  const [focusedClusterId, setFocusedClusterId] = useState<string | undefined>(undefined);
  const [enabledClusterKinds, setEnabledClusterKinds] = useState<ConstellationClusterKind[]>([
    "embedding_cluster",
    "school",
    "math_tag",
    "scientific_domain",
    "cognitive_tag",
    "calculus",
    "domain",
  ]);
  const [neighborhoodDepth, setNeighborhoodDepth] = useState(1);
  const [isolateNeighborhood, setIsolateNeighborhood] = useState(false);
  const [hiddenRelationFamilies, setHiddenRelationFamilies] = useState<
    ConstellationRelationFamilyId[]
  >([]);
  const [pinnedNodeIds, setPinnedNodeIds] = useState<KnowledgeEntityId[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const {
    filters,
    selectedEntityId,
    selectionSourceView,
    activeFilterSummary,
    resetFilters,
    selectFromView,
  } = useViewCoordination();
  const toggleRelationType = useExplorerStore((state) => state.toggleRelationType);

  const projection = useMemo(
    () =>
      graphProjectionAdapter({
        seed,
        index,
        filters,
        selectedEntityId,
        selectionSourceView,
      }),
    [filters, index, seed, selectedEntityId, selectionSourceView],
  );

  const hoveredNode = hoveredNodeId
    ? projection.nodes.find((node) => node.id === hoveredNodeId)
    : undefined;
  const selectedNode = selectedEntityId
    ? projection.nodes.find((node) => node.id === selectedEntityId)
    : undefined;

  const graphState = useMemo(() => {
    const hiddenFamilies = new Set(hiddenRelationFamilies);
    const activeEdges = projection.edges.filter(
      (edge) => !hiddenFamilies.has(getEdgeRelationFamily(edge)),
    );
    const adjacency = new Map<KnowledgeEntityId, KnowledgeEntityId[]>();

    activeEdges.forEach((edge) => {
      adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
      adjacency.set(edge.target, [...(adjacency.get(edge.target) ?? []), edge.source]);
    });

    const distances = new Map<KnowledgeEntityId, number>();

    if (selectedEntityId && projection.nodes.some((node) => node.id === selectedEntityId)) {
      const queue: { id: KnowledgeEntityId; depth: number }[] = [
        { id: selectedEntityId, depth: 0 },
      ];
      distances.set(selectedEntityId, 0);

      while (queue.length > 0) {
        const current = queue.shift();
        if (!current || current.depth >= neighborhoodDepth) continue;

        for (const neighborId of adjacency.get(current.id) ?? []) {
          if (distances.has(neighborId)) continue;
          const nextDepth = current.depth + 1;
          distances.set(neighborId, nextDepth);
          queue.push({ id: neighborId, depth: nextDepth });
        }
      }
    }

    const normalizedSearch = searchQuery.trim().toLowerCase();
    const searchMatchedIds = new Set<KnowledgeEntityId>();

    if (normalizedSearch) {
      projection.nodes.forEach((node) => {
        const tagLabels = node.tagIds
          .map((tagId) => index.tagsById.get(tagId)?.label)
          .filter(Boolean)
          .join(" ");
        const traditionLabels = node.traditionIds
          .map((traditionId) => index.entitiesById.get(traditionId)?.label)
          .filter(Boolean)
          .join(" ");
        const searchable =
          `${node.label} ${node.description} ${node.entityType} ${node.clusterLabel} ${tagLabels} ${traditionLabels}`.toLowerCase();
        if (searchable.includes(normalizedSearch)) {
          searchMatchedIds.add(node.id);
        }
      });
    }

    const pinnedIds = new Set(pinnedNodeIds);
    const nodeLookup = new Map(projection.nodes.map((node) => [node.id, node]));
    const enabledKinds = new Set(enabledClusterKinds);
    const activeClusters = projection.clusters.filter(
      (cluster) => enabledKinds.has(cluster.kind) && cluster.kind !== "entity_type",
    );
    const focusedCluster = focusedClusterId
      ? activeClusters.find((cluster) => cluster.id === focusedClusterId)
      : undefined;
    const clusterLimit = density === "exhibit" ? 8 : density === "readable" ? 12 : activeClusters.length;
    const nodeLimitByDensity = density === "exhibit" ? 0 : density === "readable" ? 8 : Number.POSITIVE_INFINITY;

    const addClusterNodes = (target: Set<KnowledgeEntityId>, clusterId: string) => {
      const cluster = activeClusters.find((item) => item.id === clusterId);
      if (!cluster) return;
      cluster.anchorNodeIds.forEach((nodeId) => target.add(nodeId));
      if (nodeLimitByDensity > 0) {
        cluster.nodeIds
          .filter((nodeId) => !cluster.anchorNodeIds.includes(nodeId))
          .sort(
            (left, right) =>
              (nodeLookup.get(right)?.semanticCentrality ?? 0) -
              (nodeLookup.get(left)?.semanticCentrality ?? 0),
          )
          .slice(0, nodeLimitByDensity)
          .forEach((nodeId) => target.add(nodeId));
      }
    };

    const visibleNodeIds = new Set<KnowledgeEntityId>();

    if (viewMode === "network") {
      projection.nodes.forEach((node) => visibleNodeIds.add(node.id));
    } else if (viewMode === "story") {
      if (focusedCluster) {
        addClusterNodes(visibleNodeIds, focusedCluster.id);
      }

      if (selectedEntityId && nodeLookup.has(selectedEntityId)) {
        visibleNodeIds.add(selectedEntityId);
        distances.forEach((depth, nodeId) => {
          if (depth <= neighborhoodDepth) visibleNodeIds.add(nodeId);
        });
        const selectedNode = nodeLookup.get(selectedEntityId);
        selectedNode?.clusterIds.slice(0, 3).forEach((clusterId) => {
          const cluster = activeClusters.find((item) => item.id === clusterId);
          cluster?.anchorNodeIds.forEach((nodeId) => visibleNodeIds.add(nodeId));
        });
      }

      if (visibleNodeIds.size === 0) {
        activeClusters.slice(0, clusterLimit).forEach((cluster) => addClusterNodes(visibleNodeIds, cluster.id));
      }
    } else {
      const clusters = focusedCluster ? [focusedCluster] : activeClusters.slice(0, clusterLimit);
      clusters.forEach((cluster) => addClusterNodes(visibleNodeIds, cluster.id));
    }

    pinnedNodeIds.forEach((nodeId) => visibleNodeIds.add(nodeId));

    const shouldUseDepth = Boolean(selectedEntityId && distances.size > 0);
    if (shouldUseDepth && isolateNeighborhood) {
      Array.from(visibleNodeIds).forEach((nodeId) => {
        if (!distances.has(nodeId)) visibleNodeIds.delete(nodeId);
      });
    }

    const nodes = projection.nodes
      .filter((node) => visibleNodeIds.has(node.id))
      .map((node) => {
        const depthDistance = distances.get(node.id);
        const isOutsideDepth = shouldUseDepth && typeof depthDistance !== "number";
        const isSearchMiss = normalizedSearch.length > 0 && !searchMatchedIds.has(node.id);

        return {
          ...node,
          depthDistance,
          isNeighbor: typeof depthDistance === "number" && depthDistance > 0,
          isPinned: pinnedIds.has(node.id),
          isSearchMatch: searchMatchedIds.has(node.id),
          isDimmed: node.isDimmed || isOutsideDepth || isSearchMiss,
        };
      });
    const visibleSearchMatchedIds = new Set(
      nodes.filter((node) => node.isSearchMatch).map((node) => node.id),
    );

    const nextVisibleNodeIds = new Set(nodes.map((node) => node.id));
    const edges = activeEdges
      .filter((edge) => nextVisibleNodeIds.has(edge.source) && nextVisibleNodeIds.has(edge.target))
      .map((edge) => {
        const isOutsideDepth =
          shouldUseDepth &&
          (!distances.has(edge.source) || !distances.has(edge.target));

        return {
          ...edge,
          isSelectionAdjacent:
            edge.isSelectionAdjacent ||
            edge.source === selectedEntityId ||
            edge.target === selectedEntityId,
          isDimmed: edge.isDimmed || isOutsideDepth,
        };
      });

    const visibleRelationTypes = projection.visibleRelationTypes.filter(
      (relationType) => !hiddenFamilies.has(getRelationFamily(relationType)),
    );
    const visibleClusters = activeClusters
      .filter((cluster) => cluster.nodeIds.some((nodeId) => nextVisibleNodeIds.has(nodeId)))
      .map((cluster) => ({
        ...cluster,
        nodeIds: cluster.nodeIds.filter((nodeId) => nextVisibleNodeIds.has(nodeId)),
        anchorNodeIds: cluster.anchorNodeIds.filter((nodeId) => nextVisibleNodeIds.has(nodeId)),
      }));

    const visibleCounts = {
      ...projection.visibleCounts,
      nodes: nodes.length,
      edges: edges.length,
      selectedNeighborCount: nodes.filter((node) => node.isNeighbor).length,
      contextNodeCount: nodes.filter((node) => node.isContextRelevant).length,
    };

    return {
      projection: {
        ...projection,
        nodes,
        edges,
        clusters: visibleClusters,
        visibleRelationTypes,
        visibleCounts,
      } satisfies GraphProjection,
      searchMatchedIds: visibleSearchMatchedIds,
      clusterChips: activeClusters.slice(0, 24).map((cluster) => {
        const visibleCount = cluster.nodeIds.filter((nodeId) => nextVisibleNodeIds.has(nodeId)).length;
        return {
          id: cluster.id,
          label: cluster.label,
          kind: cluster.kind,
          nodeCount: visibleCount || cluster.nodeIds.length,
          hiddenCount: Math.max(0, cluster.nodeIds.length - visibleCount),
        };
      }),
    };
  }, [
    density,
    enabledClusterKinds,
    focusedClusterId,
    hiddenRelationFamilies,
    isolateNeighborhood,
    neighborhoodDepth,
    pinnedNodeIds,
    projection,
    searchQuery,
    selectedEntityId,
    index,
    viewMode,
  ]);

  const focusedNodeId = hoveredNodeId ?? selectedEntityId;
  const focusedNodePinned = Boolean(focusedNodeId && pinnedNodeIds.includes(focusedNodeId));
  const searchMatchCount = graphState.searchMatchedIds.size;

  const availableRelationFamilies = useMemo(() => {
    const visibleFamilies = new Set(
      projection.edges.map((edge) => getEdgeRelationFamily(edge)),
    );

    return constellationRelationFamilies
      .filter((family) => visibleFamilies.has(family.id))
      .map((family) => ({ id: family.id, label: family.label }));
  }, [projection.edges]);

  const toggleHiddenRelationFamily = (familyId: ConstellationRelationFamilyId) => {
    setHiddenRelationFamilies((current) =>
      current.includes(familyId)
        ? current.filter((item) => item !== familyId)
        : [...current, familyId],
    );
  };

  const toggleClusterKind = (kind: ConstellationClusterKind) => {
    setEnabledClusterKinds((current) =>
      current.includes(kind)
        ? current.filter((item) => item !== kind)
        : [...current, kind],
    );
    setFocusedClusterId(undefined);
  };

  const effectiveLayoutMode: ConstellationLayoutMode =
    viewMode === "story" && selectedEntityId ? "radial" : viewMode === "network" ? layoutMode : "circle";

  const toggleFocusedPin = () => {
    if (!focusedNodeId) return;

    setPinnedNodeIds((current) =>
      current.includes(focusedNodeId)
        ? current.filter((item) => item !== focusedNodeId)
        : [...current, focusedNodeId],
    );
  };

  const focusSearchResult = () => {
    const [firstMatchId] = Array.from(graphState.searchMatchedIds);
    const firstMatch = graphState.projection.nodes.find((node) => node.id === firstMatchId);
    if (firstMatch) {
      selectFromView(firstMatch.id, firstMatch.entityType, "constellation");
    }
  };

  return (
    <div className="constellation-view">
      <ConstellationControls
        visibleNodeCount={graphState.projection.visibleCounts.nodes}
        visibleEdgeCount={graphState.projection.visibleCounts.edges}
        selectedNeighborCount={graphState.projection.visibleCounts.selectedNeighborCount}
        hoveredLabel={hoveredNode?.label}
        selectedLabel={selectedNode?.label}
        activeFilterSummary={activeFilterSummary}
        activeRelationTypes={filters.relationTypes}
        visibleRelationTypes={projection.visibleRelationTypes}
        viewMode={viewMode}
        density={density}
        focusedClusterId={focusedClusterId}
        clusterChips={graphState.clusterChips}
        enabledClusterKinds={enabledClusterKinds}
        availableRelationFamilies={availableRelationFamilies}
        hiddenRelationFamilies={hiddenRelationFamilies}
        layoutMode={layoutMode}
        neighborhoodDepth={neighborhoodDepth}
        isolateNeighborhood={isolateNeighborhood}
        hasSelectedNode={Boolean(selectedNode)}
        pinnedNodeCount={pinnedNodeIds.length}
        canPinFocusedNode={Boolean(focusedNodeId)}
        focusedNodePinned={focusedNodePinned}
        searchQuery={searchQuery}
        searchMatchCount={searchMatchCount}
        onViewModeChange={setViewMode}
        onDensityChange={setDensity}
        onFocusCluster={setFocusedClusterId}
        onToggleClusterKind={toggleClusterKind}
        onLayoutModeChange={setLayoutMode}
        onDepthChange={setNeighborhoodDepth}
        onToggleIsolateNeighborhood={() => setIsolateNeighborhood((current) => !current)}
        onToggleRelationType={toggleRelationType}
        onToggleHiddenRelationFamily={toggleHiddenRelationFamily}
        onToggleFocusedPin={toggleFocusedPin}
        onClearPinnedNodes={() => setPinnedNodeIds([])}
        onSearchQueryChange={setSearchQuery}
        onFocusSearchResult={focusSearchResult}
      />

      {graphState.projection.nodes.length === 0 ? (
        <EmptyStateCard
          activeFilterSummary={activeFilterSummary}
          description={
            activeFilterSummary.length > 0
              ? "No records match; clear these filters or relax relation constraints to restore the visible knowledge field."
              : "This view is waiting for connected records in the current archive."
          }
          eyebrow="Constellation"
          onResetFilters={resetFilters}
          title={
            activeFilterSummary.length > 0
              ? "No records match the current scope."
              : "No connected records available."
          }
        />
      ) : (
        <>
          <ConstellationCanvas
            projection={graphState.projection}
            selectedEntityId={selectedEntityId}
            hoveredNodeId={hoveredNodeId}
            layoutMode={effectiveLayoutMode}
            pinnedNodeIds={pinnedNodeIds}
            editorialMode={filters.editorialMode}
            editorialScopeMode={filters.editorialScopeMode}
            onHoverNodeChange={setHoveredNodeId}
            onSelectNode={(nodeId) => {
              const node = graphState.projection.nodes.find((item) => item.id === nodeId);
              if (node) {
                selectFromView(node.id, node.entityType, "constellation");
              }
            }}
          />
          <ConstellationLegend />
        </>
      )}
    </div>
  );
}
