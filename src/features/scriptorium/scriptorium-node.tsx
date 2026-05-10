import type { CanonicalEntityType, KnowledgeEntityId } from "@/types";
import { Handle, Position, type NodeProps } from "@xyflow/react";

interface ScriptoriumNodeData {
  label: string;
  entityId: KnowledgeEntityId;
  entityType: CanonicalEntityType;
  entityTypeLabel: string;
  dateLabel: string;
  note: string;
  zoneLabel: string;
  emphasis: "primary" | "secondary";
  isSelected: boolean;
  isNeighbor: boolean;
  isContextRelevant: boolean;
  contextReason?: string;
}

export function ScriptoriumNode({
  data,
  selected,
}: NodeProps) {
  const typedData = data as unknown as ScriptoriumNodeData;
  const className = [
    "scriptorium-node",
    `is-${typedData.emphasis}`,
    selected || typedData.isSelected ? "is-selected" : "",
    typedData.isNeighbor ? "is-neighbor" : "",
    typedData.isContextRelevant ? "is-context" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={className}>
      <Handle className="scriptorium-node__handle" position={Position.Left} type="target" />
      <p className="scriptorium-node__zone">{typedData.zoneLabel}</p>
      <strong>{typedData.label}</strong>
      <span className="scriptorium-node__type">
        {typedData.entityTypeLabel} - {typedData.dateLabel}
      </span>
      <p>{typedData.note}</p>
      {typedData.contextReason ? (
        <span className="scriptorium-node__context">
          {typedData.contextReason.replace("-", " ")}
        </span>
      ) : null}
      <Handle className="scriptorium-node__handle" position={Position.Right} type="source" />
    </div>
  );
}
