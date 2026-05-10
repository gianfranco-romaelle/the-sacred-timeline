import type {
  ExposedConnection,
  FragmentId,
  LocalGraphEdge,
  SimulationState,
  TriangleFragment,
} from "@/types/hegel-triangle";
import { findNeighboringFragments } from "./fragment-dust-generator";

export interface DecCompatibilityMetrics {
  boundaryCompatibility: number;
  cofaceCompatibility: number;
  gluingFitness: number;
}

function roundMetric(value: number) {
  return Number(value.toFixed(6));
}

function clampUnit(value: number) {
  return roundMetric(Math.max(0, Math.min(1, value)));
}

function average(values: number[], fallback = 0) {
  if (values.length === 0) {
    return fallback;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function edgeStatusScore(status: LocalGraphEdge["status"]) {
  switch (status) {
    case "accepted":
      return 0.95;
    case "highlighted":
      return 0.78;
    case "active":
      return 0.64;
    case "dormant":
      return 0.38;
    case "blocked":
      return 0.24;
    case "rejected":
      return 0.12;
    default:
      return 0.4;
  }
}

function connectionStatusScore(status: ExposedConnection["status"]) {
  switch (status) {
    case "engaged":
      return 0.95;
    case "available":
      return 0.66;
    case "saturated":
      return 0.34;
    case "retired":
      return 0.1;
    default:
      return 0.4;
  }
}

function connectedFragmentId(
  simulation: SimulationState,
  fragmentId: FragmentId,
  edge: LocalGraphEdge,
) {
  const sourceFragmentId = simulation.vertices[edge.sourceVertexId]?.fragmentId;
  const targetFragmentId = simulation.vertices[edge.targetVertexId]?.fragmentId;

  if (sourceFragmentId === fragmentId && targetFragmentId && targetFragmentId !== fragmentId) {
    return targetFragmentId;
  }
  if (targetFragmentId === fragmentId && sourceFragmentId && sourceFragmentId !== fragmentId) {
    return sourceFragmentId;
  }
  return undefined;
}

function crossFragmentEdges(simulation: SimulationState, fragment: TriangleFragment) {
  return Object.values(simulation.edges).filter((edge) => connectedFragmentId(simulation, fragment.id, edge));
}

export function computeDecCompatibilityMetrics(
  simulation: SimulationState,
  fragmentId: FragmentId,
): DecCompatibilityMetrics {
  const fragment = simulation.fragments[fragmentId];
  if (!fragment) {
    return {
      boundaryCompatibility: 0,
      cofaceCompatibility: 0,
      gluingFitness: 0,
    };
  }

  const neighbors = findNeighboringFragments(simulation, fragmentId);
  const neighborSet = new Set(neighbors);
  const cofaces = [
    ...(fragment.parentFragmentId ? [fragment.parentFragmentId] : []),
    ...fragment.childFragmentIds,
  ];
  const cofaceSet = new Set(cofaces);
  const sharedEdges = crossFragmentEdges(simulation, fragment).filter((edge) => {
    const connectedId = connectedFragmentId(simulation, fragment.id, edge);
    return connectedId ? neighborSet.has(connectedId) : false;
  });
  const cofaceEdges = sharedEdges.filter((edge) => {
    const connectedId = connectedFragmentId(simulation, fragment.id, edge);
    return connectedId ? cofaceSet.has(connectedId) : false;
  });

  const exposedConnectionMean = average(
    fragment.newlyExposedConnectionIds
      .map((connectionId) => simulation.exposedConnections[connectionId])
      .filter((connection): connection is ExposedConnection => Boolean(connection))
      .map((connection) => connectionStatusScore(connection.status)),
    0.5,
  );
  const sharedNeighborCoverage =
    neighbors.length > 0
      ? new Set(
          sharedEdges
            .map((edge) => connectedFragmentId(simulation, fragment.id, edge))
            .filter((connectedId): connectedId is FragmentId => Boolean(connectedId)),
        ).size / neighbors.length
      : exposedConnectionMean;
  const sharedEdgeDensity = sharedEdges.length / Math.max(1, neighbors.length * 2);
  const boundaryCompatibility = clampUnit(
    average([sharedNeighborCoverage, sharedEdgeDensity, exposedConnectionMean], exposedConnectionMean),
  );

  const cofaceCoverage =
    cofaces.length > 0
      ? cofaces.filter((cofaceId) => neighborSet.has(cofaceId)).length / cofaces.length
      : 0.5;
  const cofaceEdgeSupport =
    cofaces.length > 0 ? cofaceEdges.length / Math.max(1, cofaces.length) : 0.5;
  const cofaceCompatibility = clampUnit(average([cofaceCoverage, cofaceEdgeSupport], 0.5));

  const sharedEdgeQuality = average(sharedEdges.map((edge) => edgeStatusScore(edge.status)), exposedConnectionMean);
  const gluingFitness = clampUnit(
    average(
      [
        boundaryCompatibility,
        cofaceCompatibility,
        sharedEdgeQuality,
      ],
      0,
    ),
  );

  return {
    boundaryCompatibility,
    cofaceCompatibility,
    gluingFitness,
  };
}
