import type { ProjectionDiagnostic } from "@/types/projections";

interface ProjectionDiagnosticInput {
  projectionKind: string;
  nodeCount?: number;
  edgeCount?: number;
  groupCount?: number;
  itemCount?: number;
}

const addThresholdDiagnostic = (
  diagnostics: ProjectionDiagnostic[],
  value: number | undefined,
  threshold: number,
  code: string,
  message: string,
) => {
  if (typeof value === "number" && value > threshold) {
    diagnostics.push({
      code,
      severity: "warning",
      message,
    });
  }
};

export const buildProjectionDiagnostics = ({
  projectionKind,
  nodeCount,
  edgeCount,
  groupCount,
  itemCount,
}: ProjectionDiagnosticInput): ProjectionDiagnostic[] => {
  const diagnostics: ProjectionDiagnostic[] = [];

  addThresholdDiagnostic(
    diagnostics,
    nodeCount,
    750,
    `${projectionKind}.dense-nodes`,
    "Projection contains enough nodes to require label and interaction level-of-detail.",
  );
  addThresholdDiagnostic(
    diagnostics,
    edgeCount,
    1500,
    `${projectionKind}.dense-edges`,
    "Projection contains enough relations to require edge bundling or relation-type narrowing.",
  );
  addThresholdDiagnostic(
    diagnostics,
    itemCount,
    1500,
    `${projectionKind}.dense-items`,
    "Projection contains enough records to require virtualized or clustered rendering.",
  );
  addThresholdDiagnostic(
    diagnostics,
    groupCount,
    120,
    `${projectionKind}.many-groups`,
    "Projection contains enough groups to require progressive disclosure.",
  );

  return diagnostics;
};
