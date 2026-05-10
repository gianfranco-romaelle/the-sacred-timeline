import "@xyflow/react/dist/style.css";

import { useMemo } from "react";
import {
  Background,
  MarkerType,
  Panel,
  ReactFlow,
  type Edge,
  type Node,
  type NodeTypes,
} from "@xyflow/react";
import type { CanonicalEntityType, KnowledgeEntityId } from "@/types";
import type { ScriptoriumProjection } from "@/data/adapters/scriptorium-adapter";
import { ScriptoriumNode } from "./scriptorium-node";

interface ScriptoriumCanvasProps {
  projection: ScriptoriumProjection;
  onSelectEntity: (entityId: KnowledgeEntityId, entityType: CanonicalEntityType) => void;
}

const zoneOrder = ["text", "school", "person", "concept"] as const;

const nodeTypes: NodeTypes = {
  scriptorium: ScriptoriumNode,
};

export function ScriptoriumCanvas({
  projection,
  onSelectEntity,
}: ScriptoriumCanvasProps) {
  const nodes = useMemo<Node[]>(
    () =>
      projection.nodes.map((node) => ({
        id: node.id,
        type: "scriptorium",
        position: node.position,
        draggable: false,
        data: {
          label: node.label,
          entityType: node.entityType,
          entityTypeLabel: node.entityTypeLabel,
          dateLabel: node.dateLabel,
          note: node.note,
          zoneLabel: projection.zoneLabels[node.zone],
          emphasis: node.emphasis,
          isSelected: node.isSelected,
          isNeighbor: node.isNeighbor,
          isContextRelevant: node.isContextRelevant,
          contextReason: node.contextReason,
          entityId: node.entityId,
        },
        selected: node.isSelected,
      })),
    [projection.nodes, projection.zoneLabels],
  );

  const edges = useMemo<Edge[]>(
    () =>
      projection.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.label,
        type: "smoothstep",
        animated: edge.tone === "transmission" || edge.tone === "contested",
        style: {
          stroke:
            edge.tone === "contested"
              ? "#8a5a54"
              : edge.tone === "conceptual"
                ? "#61748c"
                : edge.tone === "institutional"
                  ? "#6f7c63"
                  : "#8b6a42",
          strokeWidth: edge.isContextRelevant ? 2.2 : 1.5,
          opacity: edge.isContextRelevant ? 0.96 : 0.62,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color:
            edge.tone === "contested"
              ? "#8a5a54"
              : edge.tone === "conceptual"
                ? "#61748c"
                : edge.tone === "institutional"
                  ? "#6f7c63"
                  : "#8b6a42",
        },
        labelStyle: {
          fill: "#584937",
          fontSize: 12,
          fontFamily: "Iowan Old Style, Georgia, serif",
        },
      })),
    [projection.edges],
  );

  return (
    <div className="scriptorium-canvas-shell">
      <div className="scriptorium-canvas__zones" aria-hidden="true">
        {zoneOrder.map((zone) => (
          <div className={`scriptorium-canvas__zone is-${zone}`} key={zone}>
            <span>{projection.zoneLabels[zone]}</span>
          </div>
        ))}
      </div>

      <ReactFlow
        className="scriptorium-flow"
        defaultEdgeOptions={{ zIndex: 0 }}
        edges={edges}
        fitView
        fitViewOptions={{ padding: 0.16, duration: 600 }}
        maxZoom={1.15}
        minZoom={0.55}
        nodeTypes={nodeTypes}
        nodes={nodes}
        nodesConnectable={false}
        nodesDraggable={false}
        onNodeClick={(_, node) =>
          onSelectEntity(
            node.data.entityId as KnowledgeEntityId,
            node.data.entityType as CanonicalEntityType,
          )
        }
        panOnDrag
        proOptions={{ hideAttribution: true }}
        zoomOnDoubleClick={false}
      >
        <Background color="rgba(122, 99, 66, 0.18)" gap={28} size={1.2} />
        <Panel className="scriptorium-canvas__note" position="top-right">
          <p>Relationship map</p>
          <span>Pan, zoom, and select records. Imported and AI links remain reviewable.</span>
        </Panel>
      </ReactFlow>
    </div>
  );
}
