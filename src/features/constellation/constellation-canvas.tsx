import { useEffect, useMemo, useRef } from "react";
import Sigma from "sigma";
import { MultiGraph } from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import type { GraphEdge, GraphNode, GraphProjection } from "@/data/adapters/graph-adapter";
import type { KnowledgeEntityId } from "@/types";
import type { EditorialScopeMode } from "@/editorial/types";
import {
  dimHex,
  getEdgeColor,
  getEdgeSize,
  getEditorialNodeBorderColor,
  getNodeBorderColor,
  getNodeColor,
  getNodeGlyph,
  getNodeLabelColor,
} from "./constellation-styles";

export type ConstellationLayoutMode = "force" | "circle" | "radial" | "degree";

interface ConstellationCanvasProps {
  projection: GraphProjection;
  selectedEntityId?: KnowledgeEntityId;
  hoveredNodeId?: KnowledgeEntityId;
  layoutMode?: ConstellationLayoutMode;
  pinnedNodeIds?: KnowledgeEntityId[];
  editorialMode: boolean;
  editorialScopeMode: EditorialScopeMode;
  onHoverNodeChange: (nodeId?: KnowledgeEntityId) => void;
  onSelectNode: (nodeId: KnowledgeEntityId) => void;
}

const assignCircularPositions = (graph: MultiGraph, nodes: GraphNode[]) => {
  const clusters = Array.from(
    nodes.reduce((map, node) => {
      map.set(node.clusterKey, [...(map.get(node.clusterKey) ?? []), node]);
      return map;
    }, new Map<string, GraphNode[]>()),
  ).sort((left, right) => right[1].length - left[1].length);
  const total = Math.max(clusters.length, 1);

  clusters.forEach(([, clusterNodes], clusterIndex) => {
    const clusterAngle = (clusterIndex / total) * Math.PI * 2;
    const clusterRadius = nodes.length > 14 ? 1.35 : 1;
    const centerX = Math.cos(clusterAngle) * clusterRadius;
    const centerY = Math.sin(clusterAngle) * clusterRadius;

    clusterNodes.forEach((node, nodeIndex) => {
      const localAngle = (nodeIndex / Math.max(clusterNodes.length, 1)) * Math.PI * 2;
      const localRadius = 0.12 + Math.sqrt(clusterNodes.length) * 0.045;
      graph.setNodeAttribute(node.id, "x", centerX + Math.cos(localAngle) * localRadius);
      graph.setNodeAttribute(node.id, "y", centerY + Math.sin(localAngle) * localRadius);
    });
  });
};

const assignRadialPositions = (
  graph: MultiGraph,
  nodes: GraphNode[],
  selectedEntityId?: KnowledgeEntityId,
) => {
  if (!selectedEntityId) {
    assignCircularPositions(graph, nodes);
    return;
  }

  const rings = new Map<number, GraphNode[]>();
  const fallback: GraphNode[] = [];

  nodes.forEach((node) => {
    if (node.id === selectedEntityId) {
      graph.setNodeAttribute(node.id, "x", 0);
      graph.setNodeAttribute(node.id, "y", 0);
      return;
    }

    if (typeof node.depthDistance === "number") {
      const ring = Math.max(1, node.depthDistance);
      rings.set(ring, [...(rings.get(ring) ?? []), node]);
      return;
    }

    fallback.push(node);
  });

  const orderedRings = Array.from(rings.entries()).sort(([left], [right]) => left - right);

  orderedRings.forEach(([ring, ringNodes]) => {
    ringNodes.forEach((node, index) => {
      const angle = (index / Math.max(ringNodes.length, 1)) * Math.PI * 2 + ring * 0.32;
      const radius = 0.46 + ring * 0.62;
      graph.setNodeAttribute(node.id, "x", Math.cos(angle) * radius);
      graph.setNodeAttribute(node.id, "y", Math.sin(angle) * radius);
    });
  });

  fallback.forEach((node, index) => {
    const angle = (index / Math.max(fallback.length, 1)) * Math.PI * 2;
    const radius = 0.46 + (orderedRings.length + 1) * 0.68;
    graph.setNodeAttribute(node.id, "x", Math.cos(angle) * radius);
    graph.setNodeAttribute(node.id, "y", Math.sin(angle) * radius);
  });
};

const assignDegreePositions = (graph: MultiGraph, nodes: GraphNode[]) => {
  const sortedNodes = [...nodes].sort((left, right) => right.degree - left.degree);

  sortedNodes.forEach((node, index) => {
    const radius = 0.22 + Math.sqrt(index) * 0.34;
    const angle = index * 2.399963229728653;
    graph.setNodeAttribute(node.id, "x", Math.cos(angle) * radius);
    graph.setNodeAttribute(node.id, "y", Math.sin(angle) * radius);
  });
};

const assignLayoutPositions = (
  graph: MultiGraph,
  nodes: GraphNode[],
  layoutMode: ConstellationLayoutMode,
  selectedEntityId?: KnowledgeEntityId,
) => {
  if (layoutMode === "radial") {
    assignRadialPositions(graph, nodes, selectedEntityId);
    return;
  }

  if (layoutMode === "degree") {
    assignDegreePositions(graph, nodes);
    return;
  }

  assignCircularPositions(graph, nodes);

  if (layoutMode === "force" && nodes.length > 1) {
    try {
      forceAtlas2.assign(graph, {
        iterations: 120,
        settings: {
          ...forceAtlas2.inferSettings(graph),
          gravity: 0.16,
          scalingRatio: 8,
          slowDown: 4,
          barnesHutOptimize: true,
        },
      });
    } catch {
      // Fall back to circular positions if layout inference fails.
    }
  }
};

const createNodeReducer =
  (
    nodeLookup: Map<KnowledgeEntityId, GraphNode>,
    editorialMode: boolean,
    editorialScopeMode: EditorialScopeMode,
    hoveredNodeId?: KnowledgeEntityId,
  ) =>
  (nodeKey: string, data: Record<string, unknown>) => {
    const node = nodeLookup.get(nodeKey as KnowledgeEntityId);
    if (!node) return data;

    const isHovered = hoveredNodeId === node.id;
    const shouldDim =
      (hoveredNodeId &&
        !isHovered &&
        !node.isSelected &&
        !node.isNeighbor &&
        !node.isContextRelevant) ||
      node.isDimmed;

    const editorialBorderColor = editorialMode
      ? getEditorialNodeBorderColor(node, editorialScopeMode)
      : undefined;
    const editorialHighlight = Boolean(editorialBorderColor) && !shouldDim;
    const borderColor = node.isPinned
      ? "#4d6a73"
      : node.isSearchMatch
        ? "#8d5a48"
        : editorialBorderColor ?? getNodeBorderColor(node);

    return {
      ...data,
      color: shouldDim ? dimHex(getNodeColor(node)) : getNodeColor(node),
      borderColor,
      size:
        typeof data.size === "number"
          ? Math.max(
              data.size,
              (data.size as number) +
                (editorialHighlight ? 0.8 : 0) +
                (node.isPinned || node.isSearchMatch ? 0.9 : 0),
            )
          : data.size,
      label:
        node.isSelected ||
        node.isNeighbor ||
        node.isContextRelevant ||
        node.isPinned ||
        node.isSearchMatch ||
        isHovered ||
        node.degree >= 2
          ? `${getNodeGlyph(node)} ${node.label}`
          : "",
      labelColor: getNodeLabelColor(node),
      zIndex: node.isSelected ? 4 : node.isNeighbor || node.isContextRelevant || isHovered ? 3 : 1,
      highlighted: editorialHighlight,
    };
  };

const createEdgeReducer =
  (edgeLookup: Map<string, GraphEdge>, hoveredNodeId?: KnowledgeEntityId) =>
  (edgeKey: string, data: Record<string, unknown>) => {
    const edge = edgeLookup.get(edgeKey);
    if (!edge) return data;

    const isHoveredAdjacent =
      hoveredNodeId && (edge.source === hoveredNodeId || edge.target === hoveredNodeId);
    const shouldDim = (hoveredNodeId && !isHoveredAdjacent) || edge.isDimmed;

    return {
      ...data,
      color: shouldDim ? dimHex(getEdgeColor(edge)) : getEdgeColor(edge),
      size: getEdgeSize(edge),
      zIndex: edge.isSelectionAdjacent || isHoveredAdjacent ? 2 : 0,
    };
  };

export function ConstellationCanvas({
  projection,
  selectedEntityId,
  hoveredNodeId,
  layoutMode = "force",
  pinnedNodeIds = [],
  editorialMode,
  editorialScopeMode,
  onHoverNodeChange,
  onSelectNode,
}: ConstellationCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const pinnedPositionsRef = useRef(new Map<KnowledgeEntityId, { x: number; y: number }>());

  const nodeLookup = useMemo(
    () => new Map(projection.nodes.map((node) => [node.id, node])),
    [projection.nodes],
  );
  const edgeLookup = useMemo(
    () => new Map(projection.edges.map((edge) => [edge.id, edge])),
    [projection.edges],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const graph = new MultiGraph();

    projection.nodes.forEach((node) => {
      graph.mergeNode(node.id, {
        x: 0,
        y: 0,
        size: node.size,
        color: getNodeColor(node),
        label: `${getNodeGlyph(node)} ${node.label}`,
        forceLabel: node.isSelected || node.isNeighbor || node.isContextRelevant || node.degree >= 2,
        type: "circle",
        borderColor:
          (editorialMode && getEditorialNodeBorderColor(node, editorialScopeMode)) ??
          getNodeBorderColor(node),
      });
    });

    assignLayoutPositions(graph, projection.nodes, layoutMode, selectedEntityId);

    projection.clusters.slice(0, 18).forEach((cluster) => {
      const memberPositions = cluster.nodeIds
        .filter((nodeId) => graph.hasNode(nodeId))
        .map((nodeId) => ({
          x: graph.getNodeAttribute(nodeId, "x") as number,
          y: graph.getNodeAttribute(nodeId, "y") as number,
        }));
      if (memberPositions.length === 0) return;

      const x = memberPositions.reduce((total, point) => total + point.x, 0) / memberPositions.length;
      const y = memberPositions.reduce((total, point) => total + point.y, 0) / memberPositions.length;
      graph.mergeNode(`cluster_label_${cluster.id}`, {
        x,
        y: y - 0.24,
        size: 0.01,
        color: "#00000000",
        label: `${cluster.label} (${cluster.nodeIds.length})`,
        forceLabel: true,
        type: "circle",
        zIndex: 0,
      });
    });

    pinnedNodeIds.forEach((nodeId) => {
      const position = pinnedPositionsRef.current.get(nodeId);
      if (!position || !graph.hasNode(nodeId)) return;
      graph.setNodeAttribute(nodeId, "x", position.x);
      graph.setNodeAttribute(nodeId, "y", position.y);
    });

    projection.edges.forEach((edge) => {
      graph.mergeEdgeWithKey(edge.id, edge.source, edge.target, {
        size: getEdgeSize(edge),
        color: getEdgeColor(edge),
        label: edge.label,
        type: "line",
        forceLabel: false,
        zIndex: edge.isSelectionAdjacent ? 2 : 0,
        weight: edge.weight,
      });
    });

    const sigma = new Sigma(graph, container, {
      allowInvalidContainer: true,
      defaultEdgeType: "line",
      labelDensity: 0.08,
      labelRenderedSizeThreshold: 9,
      renderEdgeLabels: false,
      zIndex: true,
      nodeReducer: createNodeReducer(nodeLookup, editorialMode, editorialScopeMode, hoveredNodeId),
      edgeReducer: createEdgeReducer(edgeLookup, hoveredNodeId),
    });

    sigma.on("enterNode", ({ node }) => onHoverNodeChange(node as KnowledgeEntityId));
    sigma.on("leaveNode", () => onHoverNodeChange(undefined));
    sigma.on("clickNode", ({ node }) => {
      if (nodeLookup.has(node as KnowledgeEntityId)) {
        onSelectNode(node as KnowledgeEntityId);
      }
    });

    pinnedNodeIds.forEach((nodeId) => {
      if (!graph.hasNode(nodeId)) return;
      pinnedPositionsRef.current.set(nodeId, {
        x: graph.getNodeAttribute(nodeId, "x") as number,
        y: graph.getNodeAttribute(nodeId, "y") as number,
      });
    });

    sigmaRef.current = sigma;

    return () => {
      pinnedNodeIds.forEach((nodeId) => {
        if (!graph.hasNode(nodeId)) return;
        pinnedPositionsRef.current.set(nodeId, {
          x: graph.getNodeAttribute(nodeId, "x") as number,
          y: graph.getNodeAttribute(nodeId, "y") as number,
        });
      });
      sigma.kill();
      sigmaRef.current = null;
    };
  }, [
    edgeLookup,
    editorialMode,
    editorialScopeMode,
    hoveredNodeId,
    layoutMode,
    nodeLookup,
    onHoverNodeChange,
    onSelectNode,
    pinnedNodeIds,
    projection.edges,
    projection.nodes,
    projection.clusters,
    selectedEntityId,
  ]);

  useEffect(() => {
    if (!sigmaRef.current) return;

    sigmaRef.current.setSetting(
      "nodeReducer",
      createNodeReducer(nodeLookup, editorialMode, editorialScopeMode, hoveredNodeId),
    );
    sigmaRef.current.setSetting("edgeReducer", createEdgeReducer(edgeLookup, hoveredNodeId));
    sigmaRef.current.refresh();
  }, [edgeLookup, editorialMode, editorialScopeMode, hoveredNodeId, nodeLookup, selectedEntityId]);

  return (
    <div
      className={`constellation-canvas${editorialMode ? " is-editorial" : ""}${
        editorialMode && editorialScopeMode === "quantum-stages" ? " is-quantum" : ""
      }`}
      ref={containerRef}
    />
  );
}
