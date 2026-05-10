import { useEffect, useRef, useState } from "react";
import type {
  InformationGeometryLabAccumulationMode,
  InformationGeometryLabBarycenterSourceMode,
  InformationGeometryLabBarycenterWeightMode,
  InformationGeometryLabColorScaleMode,
  FragmentId,
  FragmentVertexId,
  InformationGeometryLabFlowMode,
  InformationGeometryLabRegressionDisplayMode,
  InformationGeometryLabRegressionTargetMode,
  InformationGeometryMode,
  InformationGeometryLabChartKind,
  InformationGeometryLabNormalizationMode,
  InformationGeometryLabScalarField,
  InformationGeometryLabTab,
  InformationGeometryLabVoronoiSiteSource,
  Point2D,
  ReplayEventId,
  ReplayLogEntry,
  SemanticProposal,
  SemanticProposalId,
  SimulationState,
  TriangleFragment,
  HegelTriangleFragmentTransformSnapshot,
} from "@/types/hegel-triangle";
import { selectLocalGraphNeighborhood } from "@/features/hegel-triangle-transform/sample-data";
import {
  computeEta,
  computeNegAdjunctionField,
  interpolateDualSimplexPoint,
  interpolatePrimalSimplexPoint,
} from "@/features/hegel-triangle-transform/information-geometry";
import { useHegelTriangleStore } from "@/features/hegel-triangle-transform/store/hegel-triangle-store";
import {
  getActiveTrianglePatch,
  getDualChartPoints,
  getLiftedSurfacePoints,
  getNearbyIGSites,
  getScalarFieldSamples,
  getVoronoiSites,
} from "@/ig/adapters";
import {
  listIGLabSnapshots,
  loadIGLabSnapshotArtifact,
  saveIGLabSnapshot,
} from "@/ig/snapshot-persistence";
import {
  computeBarycenter,
  getBarycenterInputsFromState,
  type BarycenterComputationResult,
  type BarycenterInputSet,
} from "@/ig/barycenter";
import {
  computeFlowDirection,
  computeObstructionFlowDirection,
  computeRepairFlowDirection,
  type GeometryFlowDirectionResult,
  type GeometryFlowNeighborhood,
  type GeometryFlowPoint,
} from "@/ig/flow";
import {
  computeConvergenceIndicators,
  computeTrajectoryResiduals,
  fitGeometricTrajectory,
  type GeometricTrajectoryConvergenceIndicators,
  type GeometricTrajectoryFit,
  type GeometricTrajectoryResidual,
  type GeometricTrajectorySample,
} from "@/ig/regression";
import type {
  IGChartSnapshot,
  IGLabSnapshotArtifact,
  IGLabSnapshotIndexRecord,
  IGLiftedPoint,
  IGScalarFieldSample,
  IGSite,
  IGTrianglePatch,
} from "@/ig/types";
import {
  getGeometryModeDefinition,
  getGeometryModeLabel,
  listGeometryModes,
} from "@/ig/geometryRegistry";

const LAB_TABS: Array<{ id: InformationGeometryLabTab; label: string }> = [
  { id: "patches", label: "Patches" },
  { id: "divergence", label: "Divergence" },
  { id: "voronoi", label: "Voronoi" },
  { id: "charts", label: "Charts" },
  { id: "potential", label: "Potential" },
  { id: "history", label: "History" },
];

const SCALAR_FIELD_OPTIONS: Array<{
  id: InformationGeometryLabScalarField;
  label: string;
}> = [
  { id: "divergence", label: "Divergence" },
  { id: "asymmetry", label: "Asymmetry" },
  { id: "curvature", label: "Curvature" },
  { id: "projection", label: "Projection" },
  { id: "promiseConstructive", label: "Constructive Promise" },
  { id: "promiseObstructive", label: "Obstructive Promise" },
];

const COLOR_SCALE_OPTIONS: Array<{
  id: InformationGeometryLabColorScaleMode;
  label: string;
}> = [
  { id: "sequential", label: "Sequential" },
  { id: "diverging", label: "Diverging" },
  { id: "spectral", label: "Spectral" },
];

const NORMALIZATION_MODE_OPTIONS: Array<{
  id: InformationGeometryLabNormalizationMode;
  label: string;
}> = [
  { id: "local", label: "Local" },
  { id: "tickWindow", label: "Tick Window" },
  { id: "global", label: "Global" },
];

const BARYCENTER_SOURCE_OPTIONS: Array<{
  id: InformationGeometryLabBarycenterSourceMode;
  label: string;
}> = [
  { id: "activeNeighborhood", label: "Active Neighborhood" },
  { id: "selectedVoronoiCell", label: "Selected Voronoi Cell" },
  { id: "selectedProposalCluster", label: "Selected Proposal Cluster" },
  { id: "selectedCorpusSupportCluster", label: "Corpus Support Cluster" },
  { id: "selectedPersistentBranch", label: "Persistent Branch" },
];

const BARYCENTER_WEIGHT_OPTIONS: Array<{
  id: InformationGeometryLabBarycenterWeightMode;
  label: string;
}> = [
  { id: "uniform", label: "Uniform" },
  { id: "corpusWeighted", label: "Corpus Weighted" },
  { id: "promiseWeighted", label: "Promise Weighted" },
  { id: "divergenceWeighted", label: "Divergence Weighted" },
];

const FLOW_MODE_OPTIONS: Array<{
  id: InformationGeometryLabFlowMode;
  label: string;
}> = [
  { id: "proposalFlow", label: "Proposal Flow" },
  { id: "repairFlow", label: "Repair Flow" },
  { id: "obstructionFlow", label: "Obstruction Flow" },
];

const REGRESSION_TARGET_OPTIONS: Array<{
  id: InformationGeometryLabRegressionTargetMode;
  label: string;
}> = [
  { id: "activeProposalHistory", label: "Active Proposal History" },
  { id: "activeFragmentHistory", label: "Active Fragment History" },
  { id: "selectedBranchHistory", label: "Selected Branch History" },
  { id: "selectedBarycenterHistory", label: "Selected Barycenter History" },
];

const REGRESSION_DISPLAY_OPTIONS: Array<{
  id: InformationGeometryLabRegressionDisplayMode;
  label: string;
}> = [
  { id: "fittedCurve", label: "Fitted Curve" },
  { id: "residuals", label: "Residuals" },
  { id: "velocity", label: "Velocity" },
  { id: "convergence", label: "Convergence" },
];

const GEOMETRY_MODE_OPTIONS = listGeometryModes();

type ProviderId = "chatgpt" | "claude" | "personal-open-llm" | "lean-verifier";
type ViewMode = "main" | "split";
type IGHistoryEventType =
  | "patch"
  | "voronoi"
  | "chart"
  | "nucleation"
  | "crystallization"
  | "catastrophe"
  | "projection"
  | "promise"
  | "geometry_mode_changed"
  | "barycenter_updated"
  | "flow_direction_updated"
  | "trajectory_fit_updated"
  | "voronoi_partition_updated"
  | "dual_chart_sync_updated"
  | "catastrophe_marker_detected"
  | "grammar_state_changed"
  | "ig_snapshot_saved";

type IGHistoryEventRecord = {
  id: string;
  source: "shared" | "local";
  tick: number;
  eventType: IGHistoryEventType;
  fragmentId?: FragmentId;
  proposalId?: SemanticProposalId;
  replayEventId?: ReplayEventId;
  message: string;
  detail?: string;
};

type BarycenterRecord = {
  tick: number;
  inputs: BarycenterInputSet;
  result: BarycenterComputationResult;
};

type FlowRecord = {
  tick: number;
  point: GeometryFlowPoint;
  neighborhood: GeometryFlowNeighborhood;
  result: GeometryFlowDirectionResult;
};

type TrajectoryDiagnosticsRecord = {
  samples: GeometricTrajectorySample[];
  fit: GeometricTrajectoryFit;
  residuals: GeometricTrajectoryResidual[];
  indicators: GeometricTrajectoryConvergenceIndicators;
};

type TopologyExplorerEntry = {
  id: string;
  label: string;
  detail: string;
  source: "proposal" | "dialectic" | "lean" | "persistent";
  tone: "accepted" | "blocked" | "promising" | "rejected" | "idle";
  fragmentId?: FragmentId;
  proposalId?: SemanticProposalId;
};

type TopologyExplorerSignal = {
  unresolvedCycle: TopologyExplorerEntry[];
  obstructionChain: TopologyExplorerEntry[];
  repairChain: TopologyExplorerEntry[];
  cancellationChain: TopologyExplorerEntry[];
  relatedProposalIds: Set<SemanticProposalId>;
  relatedFragmentIds: Set<FragmentId>;
};

const IG_EVENT_FILTERS: Array<{ id: IGHistoryEventType | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "patch", label: "Patch" },
  { id: "voronoi", label: "Voronoi" },
  { id: "chart", label: "Chart" },
  { id: "geometry_mode_changed", label: "Geometry Mode" },
  { id: "barycenter_updated", label: "Barycenter" },
  { id: "flow_direction_updated", label: "Flow" },
  { id: "trajectory_fit_updated", label: "Trajectory" },
  { id: "voronoi_partition_updated", label: "Voronoi Partition" },
  { id: "dual_chart_sync_updated", label: "Dual Chart Sync" },
  { id: "nucleation", label: "Nucleation" },
  { id: "crystallization", label: "Crystallization" },
  { id: "catastrophe", label: "Catastrophe" },
  { id: "catastrophe_marker_detected", label: "Catastrophe Marker" },
  { id: "projection", label: "Projection" },
  { id: "promise", label: "Promise" },
  { id: "grammar_state_changed", label: "Grammar" },
  { id: "ig_snapshot_saved", label: "Snapshot" },
];

function scalarFieldLabel(fieldKind: InformationGeometryLabScalarField) {
  return SCALAR_FIELD_OPTIONS.find((option) => option.id === fieldKind)?.label ?? fieldKind;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asNumberArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number") : [];
}

function metricValue(value: unknown) {
  return typeof value === "number" ? value : undefined;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function formatMetric(value?: number) {
  return typeof value === "number" ? value.toFixed(3) : "0.000";
}

function formatVectorCompact(values?: number[], limit = 8) {
  if (!values || values.length === 0) {
    return "[]";
  }

  const head = values.slice(0, limit).map((value) => Number(value.toFixed(3)).toString());
  const suffix = values.length > limit ? ", ..." : "";
  return `[${head.join(", ")}${suffix}]`;
}

function polygonPath(points: Point2D[]) {
  if (points.length === 0) {
    return "";
  }

  return `${points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ")} Z`;
}

function compactText(value?: string, limit = 140) {
  if (!value) {
    return undefined;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, limit - 1)}...`;
}

function pointDistanceSquared(left: Point2D, right: Point2D) {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return dx * dx + dy * dy;
}

function pointBounds(points: Point2D[]) {
  if (points.length === 0) {
    return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
  }

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);

  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function mapPointToFrame(
  point: Point2D,
  bounds: ReturnType<typeof pointBounds>,
  width: number,
  height: number,
  padding = 16,
) {
  const spanX = Math.max(1, bounds.maxX - bounds.minX);
  const spanY = Math.max(1, bounds.maxY - bounds.minY);

  return {
    x: padding + ((point.x - bounds.minX) / spanX) * Math.max(1, width - padding * 2),
    y: height - padding - ((point.y - bounds.minY) / spanY) * Math.max(1, height - padding * 2),
  };
}

function linePath(points: Point2D[]) {
  if (points.length === 0) {
    return "";
  }

  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

function smoothLinePath(points: Point2D[]) {
  if (points.length <= 2) {
    return linePath(points);
  }

  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const midpoint = {
      x: (current.x + next.x) / 2,
      y: (current.y + next.y) / 2,
    };
    path += ` Q ${current.x} ${current.y} ${midpoint.x} ${midpoint.y}`;
  }

  const last = points[points.length - 1];
  return `${path} T ${last.x} ${last.y}`;
}

function averagePoint(points: Point2D[]) {
  if (points.length === 0) {
    return { x: 0, y: 0 };
  }

  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

function scalarSampleMetric(sample: IGScalarFieldSample, fieldKind: InformationGeometryLabScalarField) {
  switch (fieldKind) {
    case "asymmetry":
      return sample.asymmetry;
    case "curvature":
      return sample.curvature;
    case "projection":
      return sample.projection;
    case "promiseConstructive":
      return sample.promiseConstructive;
    case "promiseObstructive":
      return sample.promiseObstructive;
    case "divergence":
    default:
      return sample.divergence;
  }
}

function contourPathsForSamples(
  samples: IGScalarFieldSample[],
  fieldKind: InformationGeometryLabScalarField,
  bounds: ReturnType<typeof pointBounds>,
  width: number,
  height: number,
  padding: number,
  minValue: number,
  maxValue: number,
) {
  if (samples.length < 4) {
    return [];
  }

  const thresholds = Array.from({ length: 4 }, (_, index) => minValue + ((index + 1) / 5) * (maxValue - minValue));
  const band = Math.max(0.04, (maxValue - minValue) / 10);

  return thresholds
    .map((threshold, index) => {
      const contourPoints = samples
        .filter((sample) => Math.abs(scalarSampleMetric(sample, fieldKind) - threshold) <= band)
        .map((sample) => mapPointToFrame(sample.point, bounds, width, height, padding));

      if (contourPoints.length < 3) {
        return undefined;
      }

      const center = averagePoint(contourPoints);
      const orderedPoints = [...contourPoints].sort(
        (left, right) =>
          Math.atan2(left.y - center.y, left.x - center.x) -
          Math.atan2(right.y - center.y, right.x - center.x),
      );

      return {
        id: `contour-${index}`,
        threshold,
        d: polygonPath(orderedPoints),
      };
    })
    .filter((path): path is { id: string; threshold: number; d: string } => Boolean(path));
}

function scalarValueForSite(
  site: {
    divergence: number;
    asymmetry: number;
    curvature: number;
    projection: number;
    promiseConstructive: number;
    promiseObstructive: number;
  },
  fieldKind: InformationGeometryLabScalarField,
) {
  switch (fieldKind) {
    case "asymmetry":
      return site.asymmetry;
    case "curvature":
      return site.curvature;
    case "projection":
      return site.projection;
    case "promiseConstructive":
      return site.promiseConstructive;
    case "promiseObstructive":
      return site.promiseObstructive;
    case "divergence":
    default:
      return site.divergence;
  }
}

type GeometryInstabilitySignal = {
  instability: number;
  highCurvature: boolean;
  asymmetryUnstable: boolean;
  projectionSpike: boolean;
  promiseInversion: boolean;
  catastropheCandidate: boolean;
  singularityCandidate: boolean;
};

function geometryInstabilitySignal(input: {
  curvature: number;
  asymmetry: number;
  projection: number;
  promiseConstructive?: number;
  promiseObstructive?: number;
  catastrophe?: boolean;
}): GeometryInstabilitySignal {
  const highCurvature = input.curvature >= 0.12;
  const asymmetryUnstable = input.asymmetry >= 0.08;
  const projectionSpike = input.projection >= 0.42;
  const promiseInversion = (input.promiseObstructive ?? 0) - (input.promiseConstructive ?? 0) >= 0.16;
  const catastropheCandidate =
    input.catastrophe === true || (highCurvature && projectionSpike && asymmetryUnstable);
  const singularityCandidate =
    !catastropheCandidate && ((highCurvature && projectionSpike) || (projectionSpike && promiseInversion));
  const instability = clamp01(
    input.curvature * 0.34 +
      input.asymmetry * 0.22 +
      input.projection * 0.28 +
      Math.max(0, (input.promiseObstructive ?? 0) - (input.promiseConstructive ?? 0)) * 0.16,
  );

  return {
    instability,
    highCurvature,
    asymmetryUnstable,
    projectionSpike,
    promiseInversion,
    catastropheCandidate,
    singularityCandidate,
  };
}

function instabilityStroke(kind: "catastrophe" | "singularity" | "boundary" | "curvature") {
  switch (kind) {
    case "catastrophe":
      return "rgba(224, 132, 104, 0.92)";
    case "singularity":
      return "rgba(245, 235, 214, 0.9)";
    case "boundary":
      return "rgba(242, 194, 122, 0.86)";
    case "curvature":
    default:
      return "rgba(131, 190, 231, 0.84)";
  }
}

function crossMarkerPath(center: Point2D, size: number) {
  return `M ${center.x - size} ${center.y - size} L ${center.x + size} ${center.y + size} M ${center.x - size} ${center.y + size} L ${center.x + size} ${center.y - size}`;
}

function resolveScalarBounds(
  values: number[],
  normalizationMode: InformationGeometryLabNormalizationMode,
  comparisonValues: number[] = [],
) {
  const current = values.filter((value) => Number.isFinite(value));
  const comparison = comparisonValues.filter((value) => Number.isFinite(value));
  const scope =
    normalizationMode === "tickWindow"
      ? [...current, ...comparison]
      : current;

  if (normalizationMode === "global") {
    return {
      minValue: 0,
      maxValue: Math.max(1, ...current, ...comparison, 1),
    };
  }

  if (scope.length === 0) {
    return { minValue: 0, maxValue: 1 };
  }

  const minValue = Math.min(...scope);
  const maxValue = Math.max(...scope);
  if (Math.abs(maxValue - minValue) < 1e-6) {
    return {
      minValue: minValue - 0.5,
      maxValue: maxValue + 0.5,
    };
  }

  return { minValue, maxValue };
}

function scalarFieldColor(
  value: number,
  minValue: number,
  maxValue: number,
  colorScaleMode: InformationGeometryLabColorScaleMode,
) {
  const normalized = clamp01((value - minValue) / Math.max(0.001, maxValue - minValue));
  if (colorScaleMode === "diverging") {
    const centered = normalized * 2 - 1;
    const hue = centered < 0 ? 208 : 18;
    const saturation = 72 + Math.abs(centered) * 12;
    const lightness = 84 - Math.abs(centered) * 34;
    return `hsla(${hue}, ${saturation}%, ${lightness}%, 0.8)`;
  }

  if (colorScaleMode === "spectral") {
    const hue = 276 - normalized * 252;
    const saturation = 74;
    const lightness = 72 - normalized * 34;
    return `hsla(${hue}, ${saturation}%, ${lightness}%, 0.8)`;
  }

  const hue = 220 - normalized * 170;
  const saturation = 62 + normalized * 18;
  const lightness = 72 - normalized * 38;
  return `hsla(${hue}, ${saturation}%, ${lightness}%, 0.78)`;
}

function siteChartPoint(
  site: {
    theta: number[];
    eta: number[];
  },
  geometryMode: InformationGeometryMode,
  chartKind: InformationGeometryLabChartKind,
) {
  const coordinates = getGeometryModeDefinition(geometryMode).hooks.computeChartProjection({
    theta: site.theta,
    eta: site.eta,
    chartKind,
  });
  return {
    x: coordinates[0] ?? 0,
    y: coordinates[1] ?? 0,
  };
}

function bregmanStyleDistance(
  point: Point2D,
  site: {
    theta: number[];
    eta: number[];
  },
  geometryMode: InformationGeometryMode,
  chartKind: InformationGeometryLabChartKind,
) {
  const definition = getGeometryModeDefinition(geometryMode);
  const sitePoint = siteChartPoint(site, geometryMode, chartKind);
  return definition.hooks.computeDivergence({
    // MVP chart partition: evaluate the registry divergence on the active 2D chart slice.
    p: { theta: [point.x, point.y], eta: [point.x, point.y] },
    q: { theta: [sitePoint.x, sitePoint.y], eta: [sitePoint.x, sitePoint.y] },
  });
}

function chartPointMetric(
  point: {
    divergence: number;
    asymmetry: number;
    curvature: number;
    projection: number;
    promiseConstructive: number;
    promiseObstructive: number;
  },
  fieldKind: InformationGeometryLabScalarField,
) {
  switch (fieldKind) {
    case "asymmetry":
      return point.asymmetry;
    case "curvature":
      return point.curvature;
    case "projection":
      return point.projection;
    case "promiseConstructive":
      return point.promiseConstructive;
    case "promiseObstructive":
      return point.promiseObstructive;
    case "divergence":
    default:
      return point.divergence;
  }
}

function pointSignature(point: { fragmentId: FragmentId; proposalId?: string }) {
  return point.proposalId ? `${point.fragmentId}:${point.proposalId}` : point.fragmentId;
}

function liftedPointMetric(
  point: {
    divergence: number;
    asymmetry: number;
    curvature: number;
    projection: number;
    promiseConstructive: number;
    promiseObstructive: number;
  },
  fieldKind: InformationGeometryLabScalarField,
) {
  switch (fieldKind) {
    case "asymmetry":
      return point.asymmetry;
    case "curvature":
      return point.curvature;
    case "projection":
      return point.projection;
    case "promiseConstructive":
      return point.promiseConstructive;
    case "promiseObstructive":
      return point.promiseObstructive;
    case "divergence":
    default:
      return point.divergence;
  }
}

function projectLiftedPoint(
  basePoint: Point2D,
  height: number,
  bounds: ReturnType<typeof pointBounds>,
  width: number,
  heightPx: number,
  angleDegrees: number,
  padding = 26,
) {
  const mapped = mapPointToFrame(basePoint, bounds, width, heightPx, padding);
  const radians = (angleDegrees * Math.PI) / 180;
  const dx = Math.cos(radians) * 22;
  const dy = Math.sin(radians) * 18;
  return {
    x: mapped.x + dx * height,
    y: mapped.y - dy * height - height * 28,
  };
}

function buildMotionSegments<T extends { fragmentId: FragmentId; proposalId?: string }>(
  current: T[],
  previous: T[],
  project: (value: T) => Point2D,
) {
  const previousBySignature = new Map(previous.map((value) => [pointSignature(value), value]));

  return current
    .map((value) => {
      const earlier = previousBySignature.get(pointSignature(value));
      if (!earlier) {
        return undefined;
      }

      return {
        id: pointSignature(value),
        from: project(earlier),
        to: project(value),
      };
    })
    .filter((segment): segment is { id: string; from: Point2D; to: Point2D } => Boolean(segment));
}

function accumulationModeLabel(mode: InformationGeometryLabAccumulationMode) {
  switch (mode) {
    case "sitesOnly":
      return "sites only";
    case "fieldsOnly":
      return "fields only";
    case "both":
    default:
      return "both";
  }
}

function barycenterSourceModeLabel(mode: InformationGeometryLabBarycenterSourceMode) {
  return BARYCENTER_SOURCE_OPTIONS.find((option) => option.id === mode)?.label ?? mode;
}

function barycenterWeightModeLabel(mode: InformationGeometryLabBarycenterWeightMode) {
  return BARYCENTER_WEIGHT_OPTIONS.find((option) => option.id === mode)?.label ?? mode;
}

function flowModeLabel(mode: InformationGeometryLabFlowMode) {
  return FLOW_MODE_OPTIONS.find((option) => option.id === mode)?.label ?? mode;
}

function supportLevelLabel(level: "native" | "surrogate" | "planned") {
  switch (level) {
    case "native":
      return "native";
    case "surrogate":
      return "surrogate";
    case "planned":
    default:
      return "planned";
  }
}

function implementationStatusLabel(status: "working" | "scaffold") {
  switch (status) {
    case "working":
      return "working";
    case "scaffold":
    default:
      return "scaffold";
  }
}

function geometryGrammarAssumptions(mode: InformationGeometryMode) {
  switch (mode) {
    case "quadraticBregman":
      return ["affine quadratic potential", "translation-invariant surrogate", "Euclidean barycenter support"];
    case "fisherRao":
      return ["statistical metric surrogate", "Riemannian density manifold placeholder"];
    case "klRelativeEntropy":
      return ["relative-entropy divergence scaffold", "dually flat placeholder"];
    case "mixtureGeometry":
      return ["mixture-affine chart bias", "eta-dominant lifted surrogate"];
    case "alphaEmbedding":
      return ["alpha-dual interpolation", "blended chart embedding"];
    case "lieGroupInvariant":
      return ["group-action placeholder", "left/right invariant flow scaffold"];
    case "kahlerSignal":
      return ["complex-symplectic signal scaffold", "Kahler potential placeholder"];
    case "customExperimental":
    default:
      return ["experimental registry slot", "custom invariance hook pending"];
  }
}

function regressionTargetModeLabel(mode: InformationGeometryLabRegressionTargetMode) {
  return REGRESSION_TARGET_OPTIONS.find((option) => option.id === mode)?.label ?? mode;
}

function regressionDisplayModeLabel(mode: InformationGeometryLabRegressionDisplayMode) {
  return REGRESSION_DISPLAY_OPTIONS.find((option) => option.id === mode)?.label ?? mode;
}

function trajectoryStatusLabel(indicators?: GeometricTrajectoryConvergenceIndicators) {
  if (!indicators) {
    return "inactive";
  }

  if (indicators.singularityApproachCandidate) {
    return "singularity approach";
  }

  if (indicators.converging) {
    return "converging";
  }

  if (indicators.oscillating) {
    return "oscillating";
  }

  if (indicators.drifting) {
    return "drifting";
  }

  return "tracking";
}

function trajectoryStatusTone(indicators?: GeometricTrajectoryConvergenceIndicators) {
  if (!indicators) {
    return "idle";
  }

  if (indicators.singularityApproachCandidate) {
    return "rejected";
  }

  if (indicators.converging) {
    return "accepted";
  }

  if (indicators.oscillating) {
    return "promising";
  }

  if (indicators.drifting) {
    return "blocked";
  }

  return "idle";
}

function trajectoryVelocityPaths(points: Point2D[], headSize = 5) {
  if (points.length <= 1) {
    return [];
  }

  return points.slice(1).map((point, index) => arrowPath(points[index], point, headSize));
}

function trajectoryBranchFragmentIds(fragment?: TriangleFragment) {
  if (!fragment) {
    return new Set<FragmentId>();
  }

  return new Set<FragmentId>(
    [fragment.parentFragmentId, fragment.id, ...fragment.childFragmentIds].filter(
      (value): value is FragmentId => Boolean(value),
    ),
  );
}

function barycenterChartPoint(
  geometryMode: InformationGeometryMode,
  chartKind: InformationGeometryLabChartKind,
  point: { theta: number[]; eta: number[] },
) {
  const coordinates = getGeometryModeDefinition(geometryMode).hooks.computeChartProjection({
    theta: point.theta,
    eta: point.eta,
    chartKind,
  });

  return {
    x: coordinates[0] ?? 0,
    y: coordinates[1] ?? 0,
  };
}

function projectBarycenterToPatch(
  patch: IGTrianglePatch,
  geometryMode: InformationGeometryMode,
  chartKind: InformationGeometryLabChartKind,
  point: { theta: number[]; eta: number[] },
) {
  const target = barycenterChartPoint(geometryMode, chartKind, point);
  const vertexChartPoints = patch.vertices.map((vertex) =>
    barycenterChartPoint(geometryMode, chartKind, { theta: vertex.theta, eta: vertex.eta }),
  );
  const weights = inverseDistanceWeights(target, vertexChartPoints);
  const total = weights.reduce((sum, value) => sum + value, 0) || 1;

  return patch.vertices.reduce(
    (accumulator, vertex, index) => ({
      x: accumulator.x + vertex.point.x * (weights[index] / total),
      y: accumulator.y + vertex.point.y * (weights[index] / total),
    }),
    { x: 0, y: 0 },
  );
}

function flowDirectionResultForMode(
  flowMode: InformationGeometryLabFlowMode,
  point: GeometryFlowPoint,
  neighborhood: GeometryFlowNeighborhood,
  geometryMode: InformationGeometryMode,
) {
  switch (flowMode) {
    case "repairFlow":
      return computeRepairFlowDirection(point, neighborhood, geometryMode);
    case "obstructionFlow":
      return computeObstructionFlowDirection(point, neighborhood, geometryMode);
    case "proposalFlow":
    default:
      return computeFlowDirection(point, neighborhood, geometryMode);
  }
}

function flowAnchorPoint(
  point: GeometryFlowPoint,
  geometryMode: InformationGeometryMode,
  chartKind: InformationGeometryLabChartKind,
) {
  return barycenterChartPoint(geometryMode, chartKind, point);
}

function flowArrowEndpoint(
  point: GeometryFlowPoint,
  result: GeometryFlowDirectionResult,
  geometryMode: InformationGeometryMode,
  chartKind: InformationGeometryLabChartKind,
  vectorScale: number,
) {
  return barycenterChartPoint(geometryMode, chartKind, {
    theta: point.theta.map((value, index) => value + (result.thetaDirection[index] ?? 0) * vectorScale),
    eta: point.eta.map((value, index) => value + (result.etaDirection[index] ?? 0) * vectorScale),
  });
}

function arrowPath(from: Point2D, to: Point2D, headSize = 7) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const left = {
    x: to.x - Math.cos(angle - Math.PI / 6) * headSize,
    y: to.y - Math.sin(angle - Math.PI / 6) * headSize,
  };
  const right = {
    x: to.x - Math.cos(angle + Math.PI / 6) * headSize,
    y: to.y - Math.sin(angle + Math.PI / 6) * headSize,
  };

  return {
    shaft: `M ${from.x} ${from.y} L ${to.x} ${to.y}`,
    head: `M ${left.x} ${left.y} L ${to.x} ${to.y} L ${right.x} ${right.y}`,
  };
}

function estimatedFlowPointForPatchSample(
  sample: IGScalarFieldSample,
  patch: IGTrianglePatch,
) {
  const weights = inverseDistanceWeights(
    sample.point,
    patch.vertices.map((vertex) => vertex.point),
  );
  const total = weights.reduce((sum, value) => sum + value, 0) || 1;

  const theta = patch.vertices[0]?.theta.map((_, index) =>
    patch.vertices.reduce((sum, vertex, vertexIndex) => sum + (vertex.theta[index] ?? 0) * (weights[vertexIndex] / total), 0),
  ) ?? [];
  const eta = patch.vertices[0]?.eta.map((_, index) =>
    patch.vertices.reduce((sum, vertex, vertexIndex) => sum + (vertex.eta[index] ?? 0) * (weights[vertexIndex] / total), 0),
  ) ?? [];

  return {
    theta,
    eta,
    divergence: sample.divergence,
    projection: sample.projection,
    constructivePromise: sample.promiseConstructive,
    obstructivePromise: sample.promiseObstructive,
    curvature: sample.curvature,
  } satisfies GeometryFlowPoint;
}

function weightedVector(vectors: number[][], weights: number[]) {
  const dimension = Math.max(0, ...vectors.map((vector) => vector.length));
  const total = weights.reduce((sum, value) => sum + value, 0) || 1;

  return Array.from({ length: dimension }, (_, index) =>
    vectors.reduce((sum, vector, vectorIndex) => sum + (vector[index] ?? 0) * (weights[vectorIndex] / total), 0),
  );
}

function inverseDistanceWeights(point: Point2D, sites: Point2D[]) {
  return sites.map((site) => 1 / Math.max(1, Math.sqrt(pointDistanceSquared(point, site))));
}

function quadraticPotentialValue(theta: number[]) {
  return theta.reduce((sum, value) => sum + 0.5 * value * value, 0);
}

function labColor(index: number) {
  const palette = [
    "rgba(142, 174, 212, 0.9)",
    "rgba(238, 213, 155, 0.9)",
    "rgba(163, 214, 165, 0.9)",
    "rgba(219, 125, 111, 0.9)",
    "rgba(210, 176, 234, 0.88)",
    "rgba(148, 210, 205, 0.88)",
  ];

  return palette[index % palette.length];
}

function providerGlyph(providerId: ProviderId) {
  switch (providerId) {
    case "chatgpt":
      return "G";
    case "claude":
      return "C";
    case "personal-open-llm":
      return "O";
    case "lean-verifier":
      return "L";
    default:
      return "?";
  }
}

function providerLabel(providerId: ProviderId) {
  switch (providerId) {
    case "chatgpt":
      return "ChatGPT";
    case "claude":
      return "Claude";
    case "personal-open-llm":
      return "Library Proposer";
    case "lean-verifier":
      return "Lean";
    default:
      return providerId;
  }
}

function fragmentTitle(fragment: TriangleFragment) {
  return fragment.labels.title ?? fragment.labels.short;
}

function latestFragmentProposal(fragment: TriangleFragment, simulation: SimulationState) {
  return fragment.activeProposalIds
    .map((proposalId) => simulation.proposals[proposalId])
    .filter((proposal): proposal is SemanticProposal => Boolean(proposal))
    .sort((left, right) => right.updatedAtTick - left.updatedAtTick)[0];
}

function leanBridgeSignal(proposal?: SemanticProposal) {
  const payload = asRecord(proposal?.payload);
  const orchestration = asRecord(payload?.orchestration);
  const leanBridge = asRecord(orchestration?.leanBridge);
  if (!leanBridge) {
    return undefined;
  }

  return {
    status: typeof leanBridge.status === "string" ? leanBridge.status : undefined,
    theoremKind: typeof leanBridge.theoremKind === "string" ? leanBridge.theoremKind : undefined,
    phase: typeof leanBridge.phase === "string" ? leanBridge.phase : undefined,
    sourceVector: asNumberArray(leanBridge.sourceVector),
    targetVector: asNumberArray(leanBridge.targetVector),
    repairedVector: asNumberArray(leanBridge.repairedVector),
    snippetPath: typeof leanBridge.snippetPath === "string" ? leanBridge.snippetPath : undefined,
    stderrPath: typeof leanBridge.stderrPath === "string" ? leanBridge.stderrPath : undefined,
  };
}

function promiseProfileSignal(proposal?: SemanticProposal) {
  const payload = asRecord(proposal?.payload);
  const orchestration = asRecord(payload?.orchestration);
  const promiseProfile = asRecord(orchestration?.promiseProfile);
  if (!promiseProfile) {
    return undefined;
  }

  return {
    constructivePromise: metricValue(promiseProfile?.constructivePromise),
    obstructivePromise: metricValue(promiseProfile?.obstructivePromise),
    repairability: metricValue(promiseProfile?.repairability),
    classification: typeof promiseProfile?.classification === "string" ? promiseProfile.classification : undefined,
  };
}

function average(values: number[]) {
  if (values.length === 0) {
    return undefined;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function corpusSupportSignal(proposal?: SemanticProposal) {
  const support = proposal?.corpusSupport ?? [];
  if (support.length === 0) {
    return undefined;
  }

  const similarities = support
    .map((entry) => (typeof entry.similarity === "number" ? entry.similarity : undefined))
    .filter((value): value is number => typeof value === "number");

  return {
    count: support.length,
    relevance:
      average(similarities.slice(0, Math.min(3, similarities.length))) ??
      average(similarities) ??
      undefined,
    strongest: similarities.length > 0 ? Math.max(...similarities) : undefined,
    sources: support.slice(0, 4).map((entry) => ({
      source: entry.source,
      similarity: typeof entry.similarity === "number" ? entry.similarity : undefined,
      passage: compactText(entry.passage, 88),
    })),
  };
}

function asNullableString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function topologicalHooks(...values: unknown[]) {
  const sources = values
    .map((value) => asRecord(value))
    .filter((value): value is Record<string, unknown> => Boolean(value))
    .flatMap((value) => [value, asRecord(value.topology), asRecord(value.homologicalHooks), asRecord(value.topologicalHooks)])
    .filter((value): value is Record<string, unknown> => Boolean(value));

  const first = (...keys: string[]) => {
    for (const source of sources) {
      for (const key of keys) {
        const candidate = asNullableString(source[key]);
        if (candidate) {
          return candidate;
        }
      }
    }
    return undefined;
  };

  return {
    relationType: first("relationType"),
    sourceNodeId: first("sourceNodeId", "sourceId"),
    targetNodeId: first("targetNodeId", "targetId"),
    cycleHint: first("cycleHint"),
    obstructionKind: first("obstructionKind"),
    cochainRole: first("cochainRole"),
    cancellationRole: first("cancellationRole"),
    resolutionStatus: first("resolutionStatus"),
  };
}

function topologyExplorerSignal(
  simulation: SimulationState,
  proposal?: SemanticProposal,
  fragment?: TriangleFragment,
): TopologyExplorerSignal {
  const unresolvedCycle: TopologyExplorerEntry[] = [];
  const obstructionChain: TopologyExplorerEntry[] = [];
  const repairChain: TopologyExplorerEntry[] = [];
  const cancellationChain: TopologyExplorerEntry[] = [];
  const relatedProposalIds = new Set<SemanticProposalId>();
  const relatedFragmentIds = new Set<FragmentId>();

  if (fragment) {
    relatedFragmentIds.add(fragment.id);
  }

  if (!proposal) {
    return {
      unresolvedCycle,
      obstructionChain,
      repairChain,
      cancellationChain,
      relatedProposalIds,
      relatedFragmentIds,
    };
  }

  relatedProposalIds.add(proposal.id);
  relatedFragmentIds.add(proposal.fragmentId);

  const payload = asRecord(proposal.payload);
  const orchestration = asRecord(payload?.orchestration);
  const leanBridge = asRecord(orchestration?.leanBridge);
  const hooks = topologicalHooks(payload, orchestration, leanBridge);
  const resolutionStatus = hooks.resolutionStatus ?? proposal.verificationState;

  if (hooks.cycleHint && resolutionStatus !== "accepted" && resolutionStatus !== "resolved") {
    unresolvedCycle.push({
      id: `cycle:${proposal.id}`,
      label: hooks.cycleHint,
      detail: `${hooks.relationType ?? proposal.proposalKind} / ${resolutionStatus}`,
      source: "proposal",
      tone: proposal.verificationState === "blocked" ? "blocked" : "promising",
      fragmentId: proposal.fragmentId,
      proposalId: proposal.id,
    });
  }

  if (hooks.obstructionKind || proposal.proposalKind === "obstruction_claim" || proposal.verificationState === "blocked") {
    obstructionChain.push({
      id: `obstruction:${proposal.id}`,
      label: hooks.obstructionKind ?? proposal.proposalKind.replaceAll("_", " "),
      detail: `${hooks.relationType ?? proposal.proposalKind} / ${resolutionStatus}`,
      source: "proposal",
      tone: proposal.verificationState === "accepted" ? "promising" : "blocked",
      fragmentId: proposal.fragmentId,
      proposalId: proposal.id,
    });
  }

  if (hooks.cancellationRole || resolutionStatus === "accepted" || resolutionStatus === "resolved") {
    cancellationChain.push({
      id: `resolution:${proposal.id}`,
      label: hooks.cancellationRole ?? "resolved proposal",
      detail: `${hooks.relationType ?? proposal.proposalKind} / ${resolutionStatus}`,
      source: "proposal",
      tone: "accepted",
      fragmentId: proposal.fragmentId,
      proposalId: proposal.id,
    });
  }

  const rawMoves = Array.isArray(orchestration?.dialecticMoves) ? orchestration.dialecticMoves : [];
  for (const rawMove of rawMoves) {
    const move = asRecord(rawMove);
    const moveId = asNullableString(move?.id);
    const moveRole = asNullableString(move?.role);
    if (!moveId || !moveRole) {
      continue;
    }
    const moveHooks = topologicalHooks(move);
    const targetProposalId = asNullableString(move?.targetProposalId) as SemanticProposalId | undefined;
    if (targetProposalId) {
      relatedProposalIds.add(targetProposalId);
      const targetProposal = simulation.proposals[targetProposalId];
      if (targetProposal) {
        relatedFragmentIds.add(targetProposal.fragmentId);
      }
    }

    if (moveHooks.cycleHint) {
      unresolvedCycle.push({
        id: `move-cycle:${moveId}`,
        label: moveHooks.cycleHint,
        detail: `${moveRole} / ${asNullableString(move?.summary) ?? "cycle-linked move"}`,
        source: "dialectic",
        tone: "promising",
        fragmentId: proposal.fragmentId,
        proposalId: proposal.id,
      });
    }

    if (moveRole === "criticize" || moveHooks.obstructionKind) {
      obstructionChain.push({
        id: `move-obstruction:${moveId}`,
        label: moveHooks.obstructionKind ?? "critical objection",
        detail: asNullableString(move?.summary) ?? "dialectic obstruction",
        source: "dialectic",
        tone: "blocked",
        fragmentId: proposal.fragmentId,
        proposalId: targetProposalId ?? proposal.id,
      });
    }

    if (moveRole === "repair") {
      repairChain.push({
        id: `move-repair:${moveId}`,
        label: "repair step",
        detail: asNullableString(move?.summary) ?? "repair move",
        source: "dialectic",
        tone: "promising",
        fragmentId: proposal.fragmentId,
        proposalId: targetProposalId ?? proposal.id,
      });
    }

    if (moveRole === "synthesize" || moveHooks.cancellationRole || moveHooks.resolutionStatus === "accepted") {
      cancellationChain.push({
        id: `move-resolution:${moveId}`,
        label: moveHooks.cancellationRole ?? "resolution step",
        detail: asNullableString(move?.summary) ?? "cancellation / synthesis move",
        source: "dialectic",
        tone: "accepted",
        fragmentId: proposal.fragmentId,
        proposalId: targetProposalId ?? proposal.id,
      });
    }
  }

  if (leanBridge) {
    const leanHooks = topologicalHooks(leanBridge);
    const leanStatus = asNullableString(leanBridge.status) ?? proposal.verificationState;
    if (leanHooks.obstructionKind || leanStatus === "blocked" || leanStatus === "rejected") {
      obstructionChain.push({
        id: `lean-obstruction:${proposal.id}`,
        label: leanHooks.obstructionKind ?? "lean obstruction",
        detail: `${asNullableString(leanBridge.theoremKind) ?? proposal.proposalKind} / ${leanStatus}`,
        source: "lean",
        tone: leanStatus === "rejected" ? "rejected" : "blocked",
        fragmentId: proposal.fragmentId,
        proposalId: proposal.id,
      });
    }
    if (leanHooks.cancellationRole || leanStatus === "accepted" || leanStatus === "succeeded") {
      cancellationChain.push({
        id: `lean-resolution:${proposal.id}`,
        label: leanHooks.cancellationRole ?? "lean resolution",
        detail: `${asNullableString(leanBridge.theoremKind) ?? proposal.proposalKind} / ${leanStatus}`,
        source: "lean",
        tone: "accepted",
        fragmentId: proposal.fragmentId,
        proposalId: proposal.id,
      });
    }
    if (leanHooks.cycleHint) {
      unresolvedCycle.push({
        id: `lean-cycle:${proposal.id}`,
        label: leanHooks.cycleHint,
        detail: `${asNullableString(leanBridge.theoremKind) ?? proposal.proposalKind} / ${leanStatus}`,
        source: "lean",
        tone: "promising",
        fragmentId: proposal.fragmentId,
        proposalId: proposal.id,
      });
    }
  }

  const persistentStub = [...simulation.persistent.theoremStubs, ...simulation.persistent.definitionStubs].find(
    (stub) => stub.proposalId === proposal.id,
  );
  if (persistentStub) {
    cancellationChain.push({
      id: `persistent:${persistentStub.id}`,
      label: persistentStub.kind,
      detail: `${persistentStub.layer} / promoted tick ${persistentStub.promotedAtTick}`,
      source: "persistent",
      tone: persistentStub.layer === "canonical" ? "accepted" : "promising",
      fragmentId: persistentStub.fragmentId,
      proposalId: persistentStub.proposalId,
    });
  }

  return {
    unresolvedCycle,
    obstructionChain,
    repairChain,
    cancellationChain,
    relatedProposalIds,
    relatedFragmentIds,
  };
}

function orchestrationInspectorSignal(proposal?: SemanticProposal) {
  const payload = asRecord(proposal?.payload);
  const orchestration = asRecord(payload?.orchestration);
  if (!orchestration) {
    return undefined;
  }

  const decCompatibility = asRecord(orchestration?.decCompatibility);
  const refinementFeatures = asRecord(orchestration?.refinementFeatures);
  const controlFeatures = asRecord(orchestration?.controlFeatures);
  const promiseProfile = asRecord(orchestration?.promiseProfile);
  const spectralFeatures =
    asRecord(orchestration?.spectralFeatures) ??
    asRecord(promiseProfile?.spectralFeatures) ??
    asRecord(payload?.spectralFeatures);

  return {
    corpusRelevance: metricValue(orchestration?.corpusRelevance),
    corpusNovelty: metricValue(orchestration?.corpusNovelty),
    dialecticSupport: metricValue(orchestration?.dialecticSupport),
    architectureCentrality: metricValue(orchestration?.architectureCentrality),
    refinementLegality: metricValue(refinementFeatures?.refinementLegality),
    projectionConsistency: metricValue(refinementFeatures?.projectionConsistency),
    branchAdmissibility: metricValue(refinementFeatures?.branchAdmissibility),
    metricCompressionGain: metricValue(refinementFeatures?.metricCompressionGain),
    boundaryCompatibility: metricValue(decCompatibility?.boundaryCompatibility),
    cofaceCompatibility: metricValue(decCompatibility?.cofaceCompatibility),
    gluingFitness: metricValue(decCompatibility?.gluingFitness),
    resetBurden: metricValue(controlFeatures?.resetBurden),
    groupLikeStability: metricValue(controlFeatures?.groupLikeStability),
    generatorComplexity: metricValue(controlFeatures?.generatorComplexity),
    cascadeDepth: metricValue(controlFeatures?.cascadeDepth),
    kernelConsistency: metricValue(spectralFeatures?.kernelConsistency),
    spectralStability: metricValue(spectralFeatures?.spectralStability),
    toeplitzCoherence: metricValue(spectralFeatures?.toeplitzCoherence),
    smearletFitness: metricValue(spectralFeatures?.smearletFitness),
    rkhsGrowthTendency: metricValue(spectralFeatures?.rkhsGrowthTendency),
    holonomyProxy: metricValue(promiseProfile?.holonomyProxy),
  };
}

function divergenceFieldSignal(proposal?: SemanticProposal, fragment?: TriangleFragment) {
  const payload = asRecord(proposal?.payload);
  const orchestration = asRecord(payload?.orchestration);
  const divergenceField = asRecord(orchestration?.divergenceField);
  const leanBridge = asRecord(orchestration?.leanBridge);
  const forward = metricValue(divergenceField?.forward);
  const reverse = metricValue(divergenceField?.reverse);
  const asymmetry = metricValue(divergenceField?.asymmetry);
  const curvature = metricValue(divergenceField?.curvature);
  const projection =
    metricValue(divergenceField?.projection) ?? metricValue(divergenceField?.projectionDivergence);
  const total =
    metricValue(divergenceField?.total) ??
    (typeof forward === "number" || typeof reverse === "number" || typeof projection === "number"
      ? (forward ?? 0) + (reverse ?? 0) + (projection ?? 0)
      : undefined);
  const phase =
    (typeof leanBridge?.phase === "string" ? leanBridge.phase : undefined) ?? fragment?.phase;

  if (
    typeof forward !== "number" &&
    typeof reverse !== "number" &&
    typeof asymmetry !== "number" &&
    typeof curvature !== "number" &&
    typeof projection !== "number" &&
    typeof total !== "number" &&
    !phase
  ) {
    return undefined;
  }

  return {
    forward,
    reverse,
    asymmetry,
    curvature,
    projection,
    total,
    phase,
  };
}

function statusTone(status?: string) {
  if (!status) {
    return "idle";
  }

  if (status.includes("accept") || status.includes("success")) {
    return "accepted";
  }

  if (status.includes("reject") || status.includes("fail")) {
    return "rejected";
  }

  if (status.includes("block")) {
    return "blocked";
  }

  if (status.includes("promis")) {
    return "promising";
  }

  if (status.includes("run")) {
    return "running";
  }

  return "pending";
}

function eventGeometrySummary(entry: ReplayLogEntry) {
  const payload = asRecord(entry.payload);
  const forward = metricValue(payload?.forward);
  const reverse = metricValue(payload?.reverse);
  const asymmetry = metricValue(payload?.asymmetry);
  const curvature = metricValue(payload?.curvature);
  const projection = metricValue(payload?.projection);
  const total =
    metricValue(payload?.total) ??
    (typeof forward === "number" || typeof reverse === "number" || typeof projection === "number"
      ? (forward ?? 0) + (reverse ?? 0) + (projection ?? 0)
      : undefined);
  const phase = typeof payload?.phase === "string" ? payload.phase : undefined;

  if (
    typeof forward !== "number" &&
    typeof reverse !== "number" &&
    typeof asymmetry !== "number" &&
    typeof curvature !== "number" &&
    typeof projection !== "number" &&
    typeof total !== "number" &&
    !phase
  ) {
    return undefined;
  }

  return {
    forward,
    reverse,
    asymmetry,
    curvature,
    projection,
    total,
    phase,
  };
}

function igEventsForReplayEntry(
  entry: ReplayLogEntry,
  geometry?: ReturnType<typeof eventGeometrySummary>,
): IGHistoryEventRecord[] {
  const output: IGHistoryEventRecord[] = [];
  const base = {
    source: "shared" as const,
    tick: entry.tick,
    fragmentId: entry.fragmentId,
    proposalId: entry.proposalId,
    replayEventId: entry.id,
  };
  const payload = asRecord(entry.payload);

  if (
    entry.eventType === "geometry_mode_changed" ||
    entry.eventType === "barycenter_updated" ||
    entry.eventType === "flow_direction_updated" ||
    entry.eventType === "trajectory_fit_updated" ||
    entry.eventType === "voronoi_partition_updated" ||
    entry.eventType === "dual_chart_sync_updated" ||
    entry.eventType === "catastrophe_marker_detected" ||
    entry.eventType === "grammar_state_changed" ||
    entry.eventType === "ig_snapshot_saved"
  ) {
    output.push({
      id: entry.id,
      ...base,
      eventType: entry.eventType,
      message: entry.message,
      detail: typeof payload?.detail === "string" ? payload.detail : entry.message,
    });
  }

  if (entry.eventType === "neighborhood_inspected" || entry.eventType === "fragment_activated" || entry.eventType === "proposal_enqueued") {
    output.push({
      id: `${entry.id}_patch`,
      ...base,
      eventType: "patch",
      message: "local patch updated",
      detail: entry.message,
    });
    output.push({
      id: `${entry.id}_voronoi`,
      ...base,
      eventType: "voronoi",
      message: "Voronoi sites changed",
      detail: entry.message,
    });
  }

  if (geometry?.phase === "nucleating") {
    output.push({
      id: `${entry.id}_nucleation`,
      ...base,
      eventType: "nucleation",
      message: "nucleation detected",
      detail: `total ${formatMetric(geometry.total)} / asymmetry ${formatMetric(geometry.asymmetry)}`,
    });
  }

  if (geometry?.phase === "crystallizing") {
    output.push({
      id: `${entry.id}_crystallization`,
      ...base,
      eventType: "crystallization",
      message: "crystallization detected",
      detail: `projection ${formatMetric(geometry.projection)} / total ${formatMetric(geometry.total)}`,
    });
  }

  if (typeof geometry?.projection === "number" && geometry.projection > 0) {
    output.push({
      id: `${entry.id}_projection`,
      ...base,
      eventType: "projection",
      message: "Lean-backed projection updated",
      detail: `projection ${formatMetric(geometry.projection)}`,
    });
  }

  return output;
}

function estimateProjectionDivergence(fragment: TriangleFragment, proposal?: SemanticProposal) {
  const payload = asRecord(proposal?.payload);
  const orchestration = asRecord(payload?.orchestration);
  const leanBoundary = asRecord(orchestration?.leanBoundary);
  if (typeof leanBoundary?.projectionDivergence === "number") {
    return leanBoundary.projectionDivergence;
  }

  switch (proposal?.verificationState ?? fragment.status) {
    case "accepted":
    case "persistent":
      return 0;
    case "promising":
    case "verifying":
      return 0.06;
    case "vacuous":
    case "inspecting":
      return 0.12;
    case "blocked":
      return 0.24;
    case "rejected":
      return 0.32;
    default:
      return 0.16;
  }
}

function manifoldPatchSamples(fragment: TriangleFragment, simulation: SimulationState) {
  const fragmentProposal = latestFragmentProposal(fragment, simulation);
  const vertices = fragment.vertexIds.map((vertexId) => simulation.vertices[vertexId]);
  const vertexPoints = vertices.map((vertex) => vertex.point);
  const statisticalVertices = vertices.map((vertex) => ({
    theta: vertex.theta,
    eta: vertex.eta,
  }));
  const weights: Array<[number, number, number]> = [
    [0.72, 0.14, 0.14],
    [0.14, 0.72, 0.14],
    [0.14, 0.14, 0.72],
    [1 / 3, 1 / 3, 1 / 3],
  ];

  return weights.map((sampleWeights) => {
    const primal = interpolatePrimalSimplexPoint(statisticalVertices, sampleWeights);
    const dual = interpolateDualSimplexPoint(statisticalVertices, sampleWeights);
    const projectionDivergence = estimateProjectionDivergence(fragment, fragmentProposal);
    return {
      point: {
        x: sampleWeights.reduce((sum, weight, index) => sum + vertexPoints[index].x * weight, 0),
        y: sampleWeights.reduce((sum, weight, index) => sum + vertexPoints[index].y * weight, 0),
      },
      field: computeNegAdjunctionField({ F: primal, G: dual }, undefined, projectionDivergence),
    };
  });
}

function referenceField(fragment?: TriangleFragment, proposal?: SemanticProposal, simulation?: SimulationState) {
  if (!fragment || !simulation) {
    return undefined;
  }

  const authoritative = divergenceFieldSignal(proposal, fragment);
  if (authoritative) {
    return authoritative;
  }

  return manifoldPatchSamples(fragment, simulation)[3]?.field;
}

function referencePhase(fragment?: TriangleFragment, proposal?: SemanticProposal) {
  return divergenceFieldSignal(proposal, fragment)?.phase ?? fragment?.phase;
}

function defaultTabForViewMode(viewMode: HegelTriangleFragmentTransformSnapshot["view"]["informationGeometryLab"]["selectedIGViewMode"] | string | undefined) {
  switch (viewMode) {
    case "voronoi":
      return "voronoi" as const;
    case "dualCharts":
      return "charts" as const;
    case "liftedSurface":
      return "potential" as const;
    case "accumulation":
      return "history" as const;
    case "localPatch":
    default:
      return "patches" as const;
  }
}

function buildIGLabSnapshotArtifact(input: {
  tick: number;
  currentTab: InformationGeometryLabTab;
  labView: HegelTriangleFragmentTransformSnapshot["view"]["informationGeometryLab"];
  selectedFragment?: TriangleFragment;
  selectedProposal?: SemanticProposal;
  label?: string;
  phase?: string;
  patch?: IGTrianglePatch;
  sites: IGSite[];
  samples: IGScalarFieldSample[];
  dualChart: IGChartSnapshot;
  liftedPoints: IGLiftedPoint[];
}): IGLabSnapshotArtifact {
  const savedAt = new Date().toISOString();
  return {
    id: `ig_snapshot_${savedAt.replace(/[:.]/g, "-")}_${input.selectedFragment?.id ?? "global"}`,
    savedAt,
    tick: input.tick,
    fragmentId: input.selectedFragment?.id,
    proposalId: input.selectedProposal?.id,
    geometryMode: input.labView.selectedGeometryMode,
    viewMode: input.labView.selectedIGViewMode,
    moduleTab: input.currentTab,
    chartKind: input.labView.selectedChartKind,
    scalarField: input.labView.selectedScalarField,
    colorScaleMode: input.labView.colorScaleMode,
    normalizationMode: input.labView.normalizationMode,
    label: input.label,
    phase: input.phase,
    compareWithPreviousTick: input.labView.compareWithPreviousTick,
    metadata: {
      autoFollowActiveFragment: input.labView.autoFollowActiveFragment,
      freezeCurrentSnapshot: input.labView.freezeCurrentSnapshot,
      voronoiGridResolution: input.labView.voronoiGridResolution,
      voronoiSiteSource: input.labView.voronoiSiteSource,
      accumulationTrailLength: input.labView.accumulationTrailLength,
      accumulationMode: input.labView.accumulationMode,
      barycenterSourceMode: input.labView.barycenterSourceMode,
      barycenterWeightMode: input.labView.barycenterWeightMode,
      barycenterTickWindow: input.labView.barycenterTickWindow,
      selectedFlowMode: input.labView.selectedFlowMode,
      regressionEnabled: input.labView.regressionEnabled,
      regressionTargetMode: input.labView.regressionTargetMode,
      regressionDisplayMode: input.labView.regressionDisplayMode,
      regressionTickWindow: input.labView.regressionTickWindow,
      flowVectorDensity: input.labView.flowVectorDensity,
      flowVectorScale: input.labView.flowVectorScale,
      showVoronoiSites: input.labView.showVoronoiSites,
      showVoronoiBoundaries: input.labView.showVoronoiBoundaries,
      showLiftedSurface: input.labView.showLiftedSurface,
      showLiftedStems: input.labView.showLiftedStems,
      showLiftedFootprint: input.labView.showLiftedFootprint,
      showGeodesics: input.labView.showGeodesics,
      showNucleation: input.labView.showNucleation,
      showCatastropheMarkers: input.labView.showCatastropheMarkers,
      showBarycenter: input.labView.showBarycenter,
      showBarycenterTrail: input.labView.showBarycenterTrail,
      showFlowVectors: input.labView.showFlowVectors,
      showFlowTrails: input.labView.showFlowTrails,
      animateFlowOverTicks: input.labView.animateFlowOverTicks,
      showResidualMarkers: input.labView.showResidualMarkers,
      showAccumulationHistory: input.labView.showAccumulationHistory,
    },
    sitePositions: input.sites.map((site) => ({
      ...site,
      point: { ...site.point },
      embedding: [...site.embedding],
      theta: [...site.theta],
      eta: [...site.eta],
    })),
    scalarSamples: input.samples.map((sample) => ({
      ...sample,
      point: { ...sample.point },
    })),
    patch: input.patch
      ? {
          ...input.patch,
          centroid: { ...input.patch.centroid },
          centerField: { ...input.patch.centerField },
          vertices: input.patch.vertices.map((vertex) => ({
            ...vertex,
            point: { ...vertex.point },
            embedding: [...vertex.embedding],
            theta: [...vertex.theta],
            eta: [...vertex.eta],
          })),
          scalarSamples: input.patch.scalarSamples.map((sample) => ({
            ...sample,
            point: { ...sample.point },
          })),
        }
      : undefined,
    dualChart: {
      tick: input.dualChart.tick,
      geometryMode: input.dualChart.geometryMode,
      geometrySource: input.dualChart.geometrySource,
      thetaPoints: input.dualChart.thetaPoints.map((point) => ({
        ...point,
        point: { ...point.point },
        coordinates: [...point.coordinates],
      })),
      etaPoints: input.dualChart.etaPoints.map((point) => ({
        ...point,
        point: { ...point.point },
        coordinates: [...point.coordinates],
      })),
    },
    liftedPoints: input.liftedPoints.map((point) => ({
      ...point,
      basePoint: { ...point.basePoint },
      embedding: [...point.embedding],
      theta: [...point.theta],
      eta: [...point.eta],
    })),
  };
}

export function InformationGeometryLabView({ mode = "main" }: { mode?: ViewMode }) {
  const simulation = useHegelTriangleStore((state) => state.simulation);
  const view = useHegelTriangleStore((state) => state.view);
  const runtimeConfig = useHegelTriangleStore((state) => state.runtimeConfig);
  const selectFragment = useHegelTriangleStore((state) => state.selectFragment);
  const selectProposal = useHegelTriangleStore((state) => state.selectProposal);
  const selectReplayEvent = useHegelTriangleStore((state) => state.selectReplayEvent);
  const setInformationGeometryLabTab = useHegelTriangleStore((state) => state.setInformationGeometryLabTab);
  const updateInformationGeometryLabState = useHegelTriangleStore((state) => state.updateInformationGeometryLabState);
  const setInformationGeometryLabViewMode = useHegelTriangleStore((state) => state.setInformationGeometryLabViewMode);
  const setInformationGeometryMode = useHegelTriangleStore((state) => state.setInformationGeometryMode);
  const setInformationGeometryLabScalarField = useHegelTriangleStore((state) => state.setInformationGeometryLabScalarField);
  const recordInformationGeometryEvent = useHegelTriangleStore((state) => state.recordInformationGeometryEvent);
  const [hoveredSampleId, setHoveredSampleId] = useState<string>();
  const [selectedSampleId, setSelectedSampleId] = useState<string>();
  const [hoveredBarycenterTick, setHoveredBarycenterTick] = useState<number>();
  const [selectedBarycenterTick, setSelectedBarycenterTick] = useState<number>();
  const [accumulationPlaying, setAccumulationPlaying] = useState(false);
  const [igEventFilter, setIgEventFilter] = useState<IGHistoryEventType | "all">("all");
  const [localIGEvents, setLocalIGEvents] = useState<IGHistoryEventRecord[]>([]);
  const [snapshotRecords, setSnapshotRecords] = useState<IGLabSnapshotIndexRecord[]>([]);
  const [persistedAccumulationSnapshots, setPersistedAccumulationSnapshots] = useState<
    IGLabSnapshotArtifact[]
  >([]);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string>();
  const [snapshotStatus, setSnapshotStatus] = useState<string>();
  const [loadedSnapshot, setLoadedSnapshot] = useState<IGLabSnapshotArtifact>();
  const previousSignalsRef = useRef<{
    geometryMode?: InformationGeometryMode;
    chartKind?: InformationGeometryLabChartKind;
    scalarField?: InformationGeometryLabScalarField;
    barycenterSourceMode?: InformationGeometryLabBarycenterSourceMode;
    barycenterWeightMode?: InformationGeometryLabBarycenterWeightMode;
    selectedFlowMode?: InformationGeometryLabFlowMode;
    regressionEnabled?: boolean;
    regressionTargetMode?: InformationGeometryLabRegressionTargetMode;
    regressionDisplayMode?: InformationGeometryLabRegressionDisplayMode;
    voronoiGridResolution?: number;
    voronoiSiteSource?: InformationGeometryLabVoronoiSiteSource;
    phase?: string;
    catastrophe?: boolean;
    projection?: number;
    constructivePromise?: number;
    obstructivePromise?: number;
  }>({});

  const currentTab = view.modulePanels.informationGeometryLabTab;
  const labView = view.informationGeometryLab;
  const effectiveAccumulationTrailLength = Math.max(
    1,
    Math.min(runtimeConfig.accumulationTrailLimit, labView.accumulationTrailLength),
  );
  const liftedSurfaceContourCount = Math.max(2, Math.min(8, runtimeConfig.liftedSurfaceQuality));
  const selectedFragment = labView.selectedFragmentId
    ? simulation.fragments[labView.selectedFragmentId]
    : view.selectedFragmentId
      ? simulation.fragments[view.selectedFragmentId]
    : simulation.activeFragmentId
      ? simulation.fragments[simulation.activeFragmentId]
      : undefined;
  const selectedProposal = labView.selectedProposalId
    ? simulation.proposals[labView.selectedProposalId]
    : view.selectedProposalId
      ? simulation.proposals[view.selectedProposalId]
    : selectedFragment
      ? latestFragmentProposal(selectedFragment, simulation)
      : simulation.activeProposalId
        ? simulation.proposals[simulation.activeProposalId]
        : undefined;
  const field = referenceField(selectedFragment, selectedProposal, simulation);
  const phase = referencePhase(selectedFragment, selectedProposal);
  const lean = leanBridgeSignal(selectedProposal);
  const promise = promiseProfileSignal(selectedProposal);
  const patch = selectedFragment ? getActiveTrianglePatch({ simulation, view }, selectedFragment.id) : undefined;
  const samples =
    selectedFragment && patch
      ? getScalarFieldSamples({ simulation, view }, selectedFragment.id, labView.selectedScalarField)
      : [];
  const neighborhood = selectedFragment
    ? selectLocalGraphNeighborhood(simulation, selectedFragment.id, 1)
    : { fragmentIds: new Set<FragmentId>(), edgeIds: new Set(), vertexIds: new Set<FragmentVertexId>() };
  const neighborhoodFragments = Array.from(neighborhood.fragmentIds)
    .map((fragmentId) => simulation.fragments[fragmentId])
    .filter((fragment): fragment is TriangleFragment => Boolean(fragment));
  const siteFragments =
    neighborhoodFragments.length > 0
      ? neighborhoodFragments.slice(0, 7)
      : selectedFragment
        ? [selectedFragment]
        : [];
  const igSites = selectedFragment ? getNearbyIGSites({ simulation, view }, selectedFragment.id, labView.selectedTick) : [];
  const voronoiSites = selectedFragment
    ? getVoronoiSites({ simulation, view }, labView.selectedTick, selectedFragment.id)
    : [];
  const dualChartSnapshot = selectedFragment
    ? getDualChartPoints({ simulation, view }, labView.selectedTick, selectedFragment.id)
    : {
        tick: labView.selectedTick ?? simulation.activeTick,
        geometryMode: labView.selectedGeometryMode,
        geometrySource:
          labView.selectedGeometryMode === "quadraticBregman"
            ? ("native" as const)
            : ("quadratic-surrogate" as const),
        thetaPoints: [],
        etaPoints: [],
      };
  const liftedPoints = selectedFragment
    ? getLiftedSurfacePoints({ simulation, view }, labView.selectedTick, selectedFragment.id)
    : [];
  const siteBounds = pointBounds(
    siteFragments.flatMap((fragment) =>
      fragment.vertexIds.map((vertexId) => simulation.vertices[vertexId].point),
    ),
  );
  const historyEntries = [...simulation.replayLog]
    .filter((entry) => {
      if (selectedProposal && entry.proposalId === selectedProposal.id) {
        return true;
      }
      if (selectedFragment && entry.fragmentId === selectedFragment.id) {
        return true;
      }
      return false;
    })
    .map((entry) => ({ entry, geometry: eventGeometrySummary(entry) }))
    .filter((record) => Boolean(record.geometry))
    .sort((left, right) => {
      if (left.entry.tick !== right.entry.tick) {
        return left.entry.tick - right.entry.tick;
      }
      return left.entry.id.localeCompare(right.entry.id);
    });
  const sharedIGEvents = historyEntries.flatMap((record) => igEventsForReplayEntry(record.entry, record.geometry));
  const activeSample =
    samples.find((sample) => sample.id === hoveredSampleId) ??
    samples.find((sample) => sample.id === selectedSampleId) ??
    samples[Math.floor(samples.length / 2)];
  const activePointSignature = selectedProposal
    ? `${selectedProposal.fragmentId}:${selectedProposal.id}`
    : selectedFragment
      ? selectedFragment.id
      : undefined;
  const availableTicks = Array.from(
    new Set([
      0,
      simulation.activeTick,
      ...simulation.replayLog.map((entry) => entry.tick),
      ...snapshotRecords.filter((record) => record.id.startsWith("ig_auto_")).map((record) => record.tick),
    ]),
  ).sort((left, right) => left - right);
  const minAvailableTick = availableTicks[0] ?? 0;
  const maxAvailableTick = availableTicks[availableTicks.length - 1] ?? simulation.activeTick;
  const accumulationTick =
    typeof labView.selectedTick === "number"
      ? Math.max(minAvailableTick, Math.min(maxAvailableTick, labView.selectedTick))
      : maxAvailableTick;
  const previousAvailableTick =
    [...availableTicks].reverse().find((tick) => tick < accumulationTick) ?? accumulationTick;
  const comparisonView = {
    ...view,
    informationGeometryLab: {
      ...view.informationGeometryLab,
      selectedTick: previousAvailableTick,
    },
  };
  const accumulationSites = selectedFragment
    ? getVoronoiSites(
        {
          simulation,
          view: {
            ...view,
            informationGeometryLab: {
              ...view.informationGeometryLab,
              selectedTick: accumulationTick,
            },
          },
        },
        accumulationTick,
        selectedFragment.id,
      )
    : [];
  const comparisonSites =
    selectedFragment && labView.compareWithPreviousTick
      ? getVoronoiSites(
          {
            simulation,
            view: comparisonView,
          },
          previousAvailableTick,
          selectedFragment.id,
        )
      : [];
  const comparisonSamples =
    selectedFragment && labView.compareWithPreviousTick && patch
      ? getScalarFieldSamples(
          {
            simulation,
            view: comparisonView,
          },
          selectedFragment.id,
          labView.selectedScalarField,
        )
      : [];
  const comparisonDualChartSnapshot =
    selectedFragment && labView.compareWithPreviousTick
      ? getDualChartPoints(
          {
            simulation,
            view: comparisonView,
          },
          previousAvailableTick,
          selectedFragment.id,
        )
      : {
          tick: previousAvailableTick,
          geometryMode: labView.selectedGeometryMode,
          geometrySource:
            labView.selectedGeometryMode === "quadraticBregman"
              ? ("native" as const)
              : ("quadratic-surrogate" as const),
          thetaPoints: [],
          etaPoints: [],
        };
  const comparisonLiftedPoints =
    selectedFragment && labView.compareWithPreviousTick
      ? getLiftedSurfacePoints(
          {
            simulation,
            view: comparisonView,
          },
          previousAvailableTick,
          selectedFragment.id,
        )
      : [];
  const barycenterState = selectedFragment
    ? {
        simulation,
        view: {
          ...view,
          informationGeometryLab: {
            ...view.informationGeometryLab,
            selectedTick: accumulationTick,
            selectedFragmentId: selectedFragment.id,
            selectedProposalId: selectedProposal?.id,
          },
        },
      }
    : undefined;
  const barycenterInputs = barycenterState
    ? getBarycenterInputsFromState(barycenterState)
    : undefined;
  const currentBarycenterRecord: BarycenterRecord | undefined =
    barycenterInputs && barycenterInputs.points.length > 0
      ? {
          tick: barycenterInputs.tick,
          inputs: barycenterInputs,
          result: computeBarycenter(
            barycenterInputs.points,
            barycenterInputs.geometryMode,
            barycenterInputs.weights,
          ),
        }
      : undefined;
  const barycenterTrailTicks = availableTicks
    .filter((tick) => tick <= accumulationTick)
    .slice(-Math.max(1, labView.barycenterTickWindow));
  const barycenterTrailRecords: BarycenterRecord[] =
    selectedFragment
      ? barycenterTrailTicks
          .map((tick) => {
            const trailState = {
              simulation,
              view: {
                ...view,
                informationGeometryLab: {
                  ...view.informationGeometryLab,
                  selectedTick: tick,
                  selectedFragmentId: selectedFragment.id,
                  selectedProposalId: selectedProposal?.id,
                },
              },
            };
            const inputs = getBarycenterInputsFromState(trailState);
            if (inputs.points.length === 0) {
              return undefined;
            }

            return {
              tick,
              inputs,
              result: computeBarycenter(inputs.points, inputs.geometryMode, inputs.weights),
            } satisfies BarycenterRecord;
          })
          .filter((record): record is BarycenterRecord => Boolean(record))
      : currentBarycenterRecord
        ? [currentBarycenterRecord]
        : [];
  const barycenterRecordByTick = new Map<number, BarycenterRecord>(
    [...barycenterTrailRecords, ...(currentBarycenterRecord ? [currentBarycenterRecord] : [])].map((record) => [
      record.tick,
      record,
    ]),
  );
  const activeBarycenterRecord =
    (typeof hoveredBarycenterTick === "number" ? barycenterRecordByTick.get(hoveredBarycenterTick) : undefined) ??
    (typeof selectedBarycenterTick === "number" ? barycenterRecordByTick.get(selectedBarycenterTick) : undefined) ??
    currentBarycenterRecord;
  const activeBarycenterWeights = activeBarycenterRecord
    ? activeBarycenterRecord.inputs.sites
        .map((site, index) => ({
          site,
          weight: activeBarycenterRecord.inputs.weights[index] ?? 0,
        }))
        .sort((left, right) => right.weight - left.weight)
    : [];
  const activeBarycenterSiteIds = new Set(activeBarycenterRecord?.inputs.sites.map((site) => site.id) ?? []);
  const visibleSiteList =
    currentTab === "voronoi" ? voronoiSites : currentTab === "history" ? accumulationSites : igSites;
  const geometryModeDefinition = getGeometryModeDefinition(labView.selectedGeometryMode);
  const grammarWeightMode =
    activeBarycenterRecord?.inputs.weightMode ?? labView.barycenterWeightMode;
  const grammarBarycenterSourceMode =
    activeBarycenterRecord?.inputs.sourceMode ?? labView.barycenterSourceMode;
  const orchestrationSignals = orchestrationInspectorSignal(selectedProposal);
  const corpusSignals = corpusSupportSignal(selectedProposal);
  const topologyExplorer = topologyExplorerSignal(simulation, selectedProposal, selectedFragment);
  const selectedSite =
    visibleSiteList.find((site) => pointSignature(site) === activePointSignature) ??
    (selectedProposal
      ? visibleSiteList.find((site) => site.proposalId === selectedProposal.id)
      : undefined) ??
    (selectedFragment ? visibleSiteList.find((site) => site.fragmentId === selectedFragment.id) : undefined);
  const inspectorPoint = activeSample?.point ?? selectedSite?.point ?? patch?.centroid;
  const nearestInspectorSites = inspectorPoint
    ? visibleSiteList
        .filter((site) => site.id !== selectedSite?.id)
        .map((site) => ({
          ...site,
          distance: Math.sqrt(pointDistanceSquared(site.point, inspectorPoint)),
        }))
        .sort((left, right) => left.distance - right.distance)
        .slice(0, 5)
    : [];
  const inspectorTick =
    activeSample?.tick ??
    selectedSite?.tick ??
    activeBarycenterRecord?.tick ??
    labView.selectedTick ??
    selectedProposal?.updatedAtTick ??
    simulation.activeTick;
  const inspectorTheta = selectedSite?.theta ?? selectedProposal?.theta ?? selectedFragment?.theta ?? [];
  const inspectorEta = selectedSite?.eta ?? selectedProposal?.eta ?? selectedFragment?.eta ?? [];
  const inspectorSelectionLabel = selectedSite?.label ?? selectedProposal?.title ?? selectedFragment?.labels.short;
  const inspectorBarycenterTheta = activeBarycenterRecord?.result.point.theta ?? [];
  const inspectorBarycenterEta = activeBarycenterRecord?.result.point.eta ?? [];
  const grammarInstability = geometryInstabilitySignal({
    curvature: field?.curvature ?? 0,
    asymmetry: field?.asymmetry ?? 0,
    projection: field?.projection ?? 0,
    promiseConstructive: promise?.constructivePromise,
    promiseObstructive: promise?.obstructivePromise,
    catastrophe: selectedFragment?.catastrophe,
  });
  const grammarAssumptions = geometryGrammarAssumptions(labView.selectedGeometryMode);
  const grammarProjectionMode = [
    runtimeConfig.leanRuntimeMode,
    lean?.theoremKind ?? "ts-projection",
    lean?.status ?? "TS fallback",
  ].join(" / ");
  const neighborSectionTitle = currentTab === "voronoi" ? "Neighboring Cells" : "Nearest Sites";
  const topologyRelatedSiteSignatures = new Set(
    visibleSiteList
      .filter(
        (site) =>
          topologyExplorer.relatedProposalIds.has(site.proposalId as SemanticProposalId) ||
          topologyExplorer.relatedFragmentIds.has(site.fragmentId),
      )
      .map((site) => pointSignature(site)),
  );
  const activeFlowPoint: GeometryFlowPoint | undefined = selectedSite
    ? {
        theta: [...selectedSite.theta],
        eta: [...selectedSite.eta],
        divergence: selectedSite.divergence,
        projection: selectedSite.projection,
        constructivePromise: selectedSite.promiseConstructive,
        obstructivePromise: selectedSite.promiseObstructive,
        curvature: selectedSite.curvature,
      }
    : selectedProposal
      ? {
          theta: [...selectedProposal.theta],
          eta: [...selectedProposal.eta],
          divergence: field?.total,
          projection: field?.projection,
          constructivePromise: promise?.constructivePromise,
          obstructivePromise: promise?.obstructivePromise,
          curvature: field?.curvature,
        }
      : selectedFragment
        ? {
            theta: [...selectedFragment.theta],
            eta: [...selectedFragment.eta],
            divergence: field?.total,
            projection: field?.projection,
            constructivePromise: promise?.constructivePromise,
            obstructivePromise: promise?.obstructivePromise,
            curvature: field?.curvature,
          }
        : undefined;
  const activeFlowNeighborhood: GeometryFlowNeighborhood = {
    fragmentId: selectedFragment?.id,
    tick: accumulationTick,
    sites:
      activeBarycenterRecord?.inputs.sites.length && activeBarycenterSiteIds.size > 0
        ? activeBarycenterRecord.inputs.sites
        : visibleSiteList,
  };
  const activeFlowRecord: FlowRecord | undefined =
    activeFlowPoint && activeFlowNeighborhood.sites.length > 0
      ? {
          tick: accumulationTick,
          point: activeFlowPoint,
          neighborhood: activeFlowNeighborhood,
          result: flowDirectionResultForMode(
            labView.selectedFlowMode,
            activeFlowPoint,
            activeFlowNeighborhood,
            labView.selectedGeometryMode,
          ),
        }
      : undefined;
  const activeBarycenterFlowRecord: FlowRecord | undefined =
    activeBarycenterRecord
      ? {
          tick: activeBarycenterRecord.tick,
          point: {
            theta: [...activeBarycenterRecord.result.point.theta],
            eta: [...activeBarycenterRecord.result.point.eta],
          },
          neighborhood: {
            fragmentId: activeBarycenterRecord.inputs.fragmentId,
            tick: activeBarycenterRecord.tick,
            sites: activeBarycenterRecord.inputs.sites,
          },
          result: flowDirectionResultForMode(
            labView.selectedFlowMode,
            {
              theta: [...activeBarycenterRecord.result.point.theta],
              eta: [...activeBarycenterRecord.result.point.eta],
            },
            {
              fragmentId: activeBarycenterRecord.inputs.fragmentId,
              tick: activeBarycenterRecord.tick,
              sites: activeBarycenterRecord.inputs.sites,
            },
            labView.selectedGeometryMode,
          ),
        }
      : undefined;
  const flowTrailTicks = availableTicks
    .filter((tick) => tick <= accumulationTick)
    .slice(-Math.max(2, labView.barycenterTickWindow));
  const selectedFlowTrailRecords: FlowRecord[] =
    activeFlowPoint && labView.showFlowTrails && selectedFragment
      ? flowTrailTicks
          .map((tick) => {
            const trailSites = getVoronoiSites(
              {
                simulation,
                view: {
                  ...view,
                  informationGeometryLab: {
                    ...view.informationGeometryLab,
                    selectedTick: tick,
                  },
                },
              },
              tick,
              selectedFragment.id,
            );
            if (trailSites.length === 0) {
              return undefined;
            }
            const trailPoint =
              selectedProposal?.id
                ? trailSites.find((site) => site.proposalId === selectedProposal.id)
                : trailSites.find((site) => site.fragmentId === selectedFragment.id);
            if (!trailPoint) {
              return undefined;
            }
            const point: GeometryFlowPoint = {
              theta: [...trailPoint.theta],
              eta: [...trailPoint.eta],
              divergence: trailPoint.divergence,
              projection: trailPoint.projection,
              constructivePromise: trailPoint.promiseConstructive,
              obstructivePromise: trailPoint.promiseObstructive,
              curvature: trailPoint.curvature,
            };
            const neighborhood: GeometryFlowNeighborhood = {
              fragmentId: selectedFragment.id,
              tick,
              sites: trailSites,
            };
            return {
              tick,
              point,
              neighborhood,
              result: flowDirectionResultForMode(
                labView.selectedFlowMode,
                point,
                neighborhood,
                labView.selectedGeometryMode,
              ),
            } satisfies FlowRecord;
          })
          .filter((record): record is FlowRecord => Boolean(record))
      : [];
  const regressionTicks = availableTicks
    .filter((tick) => tick <= accumulationTick)
    .slice(-Math.max(2, labView.regressionTickWindow));
  const persistedSitesByTick = new Map(
    persistedAccumulationSnapshots.map((snapshot) => [snapshot.tick, snapshot.sitePositions] as const),
  );
  const branchFragmentIds = trajectoryBranchFragmentIds(selectedFragment);
  const regressionSamples: GeometricTrajectorySample[] =
    labView.regressionEnabled && selectedFragment
      ? (() => {
          if (labView.regressionTargetMode === "selectedBarycenterHistory") {
            return barycenterTrailRecords
              .filter((record) => regressionTicks.includes(record.tick))
              .map(
                (record) =>
                  ({
                    id: `trajectory_barycenter_${record.tick}`,
                    tick: record.tick,
                    t: record.tick,
                    fragmentId: record.inputs.fragmentId,
                    proposalId: record.inputs.proposalId as SemanticProposalId | undefined,
                    point: {
                      theta: [...record.result.point.theta],
                      eta: [...record.result.point.eta],
                    },
                  }) satisfies GeometricTrajectorySample,
              );
          }

          const proposalTargetId =
            selectedProposal?.id ??
            simulation.activeProposalId ??
            latestFragmentProposal(selectedFragment, simulation)?.id;
          let previousSite: IGSite | undefined;

          const samples: GeometricTrajectorySample[] = [];
          regressionTicks.forEach((tick) => {
              const tickSites =
                persistedSitesByTick.get(tick) ??
                getVoronoiSites(
                  {
                    simulation,
                    view: {
                      ...view,
                      informationGeometryLab: {
                        ...view.informationGeometryLab,
                        selectedTick: tick,
                      },
                    },
                  },
                  tick,
                  selectedFragment.id,
                );

              if (tickSites.length === 0) {
                return;
              }

              let selectedTrajectorySite: IGSite | undefined;
              switch (labView.regressionTargetMode) {
                case "activeProposalHistory":
                  selectedTrajectorySite = proposalTargetId
                    ? tickSites.find((site) => site.proposalId === proposalTargetId)
                    : undefined;
                  break;
                case "selectedBranchHistory": {
                  const branchCandidates = tickSites.filter((site) => branchFragmentIds.has(site.fragmentId));
                  if (branchCandidates.length > 0) {
                    const anchorSite = previousSite;
                    selectedTrajectorySite =
                      anchorSite && branchCandidates.length > 1
                        ? branchCandidates.reduce((best, candidate) => {
                            if (!best) {
                              return candidate;
                            }
                            const bestDistance = pointDistanceSquared(
                              siteChartPoint(best, labView.selectedGeometryMode, labView.selectedChartKind),
                              siteChartPoint(anchorSite, labView.selectedGeometryMode, labView.selectedChartKind),
                            );
                            const candidateDistance = pointDistanceSquared(
                              siteChartPoint(candidate, labView.selectedGeometryMode, labView.selectedChartKind),
                              siteChartPoint(anchorSite, labView.selectedGeometryMode, labView.selectedChartKind),
                            );
                            return candidateDistance < bestDistance ? candidate : best;
                          }, branchCandidates[0])
                        : branchCandidates.find((site) => site.fragmentId === selectedFragment.id) ?? branchCandidates[0];
                  }
                  break;
                }
                case "activeFragmentHistory":
                default:
                  selectedTrajectorySite = tickSites.find((site) => site.fragmentId === selectedFragment.id);
                  break;
              }

              if (!selectedTrajectorySite) {
                return;
              }

              previousSite = selectedTrajectorySite;
              samples.push({
                id: `trajectory_${selectedTrajectorySite.id}_${tick}`,
                tick,
                t: tick,
                fragmentId: selectedTrajectorySite.fragmentId,
                proposalId: selectedTrajectorySite.proposalId,
                point: {
                    theta: [...selectedTrajectorySite.theta],
                    eta: [...selectedTrajectorySite.eta],
                  },
              });
            });

          return samples;
        })()
      : [];
  const trajectoryDiagnostics: TrajectoryDiagnosticsRecord | undefined =
    regressionSamples.length >= 2
      ? (() => {
          const fit = fitGeometricTrajectory(regressionSamples, labView.selectedGeometryMode);
          const residuals = computeTrajectoryResiduals(regressionSamples, fit);
          const indicators = computeConvergenceIndicators(regressionSamples, fit);
          return {
            samples: regressionSamples,
            fit,
            residuals,
            indicators,
          };
        })()
      : undefined;
  const igHistoryFeed = [...sharedIGEvents, ...localIGEvents]
    .filter((event) => (igEventFilter === "all" ? true : event.eventType === igEventFilter))
    .sort((left, right) => {
      if (left.tick !== right.tick) {
        return right.tick - left.tick;
      }
      return right.id.localeCompare(left.id);
    });
  const selectedSnapshotRecord = snapshotRecords.find((record) => record.id === selectedSnapshotId);
  const persistedAccumulationRecords = snapshotRecords
    .filter(
      (record) =>
        record.id.startsWith("ig_auto_") &&
        (selectedFragment ? record.fragmentId === selectedFragment.id : true) &&
        record.tick <= accumulationTick,
    )
    .sort((left, right) => left.tick - right.tick)
    .slice(-effectiveAccumulationTrailLength);

  useEffect(() => {
    let cancelled = false;

    async function refreshSnapshots() {
      const result = await listIGLabSnapshots(
        runtimeConfig.databasePath,
        runtimeConfig.igLabSnapshotRetention,
      );
      if (cancelled) {
        return;
      }

      setSnapshotRecords(result.records);
      setSelectedSnapshotId((current) => current ?? result.records[0]?.id);
      if (result.error) {
        setSnapshotStatus(result.error);
      }
    }

    void refreshSnapshots();
    return () => {
      cancelled = true;
    };
  }, [runtimeConfig.databasePath, runtimeConfig.igLabSnapshotRetention, simulation.activeTick]);

  useEffect(() => {
    if (!accumulationPlaying || currentTab !== "history") {
      return undefined;
    }

    const handle = window.setInterval(() => {
      updateInformationGeometryLabState({
        selectedTick: accumulationTick >= maxAvailableTick ? minAvailableTick : accumulationTick + 1,
      });
    }, 700);

    return () => window.clearInterval(handle);
  }, [
    accumulationPlaying,
    currentTab,
    accumulationTick,
    maxAvailableTick,
    minAvailableTick,
    updateInformationGeometryLabState,
  ]);

  useEffect(() => {
    let cancelled = false;

    async function loadPersistedAccumulation() {
      if (persistedAccumulationRecords.length === 0) {
        setPersistedAccumulationSnapshots([]);
        return;
      }

      const artifacts = await Promise.all(
        persistedAccumulationRecords.map((record) =>
          loadIGLabSnapshotArtifact(runtimeConfig.artifactDirectory, record.artifactPath),
        ),
      );

      if (cancelled) {
        return;
      }

      setPersistedAccumulationSnapshots(
        artifacts.filter((artifact): artifact is IGLabSnapshotArtifact => Boolean(artifact)),
      );
    }

    void loadPersistedAccumulation();
    return () => {
      cancelled = true;
    };
  }, [persistedAccumulationRecords, runtimeConfig.artifactDirectory]);

  useEffect(() => {
    const previous = previousSignalsRef.current;
    const nextTick = typeof labView.selectedTick === "number" ? labView.selectedTick : simulation.activeTick;
    const currentCatastropheSignal =
      selectedFragment?.catastrophe === true ||
      grammarInstability.catastropheCandidate ||
      grammarInstability.singularityCandidate;
    const grammarChanged =
      (previous.geometryMode && previous.geometryMode !== labView.selectedGeometryMode) ||
      (previous.chartKind && previous.chartKind !== labView.selectedChartKind) ||
      (previous.scalarField && previous.scalarField !== labView.selectedScalarField) ||
      (previous.barycenterSourceMode && previous.barycenterSourceMode !== labView.barycenterSourceMode) ||
      (previous.barycenterWeightMode && previous.barycenterWeightMode !== labView.barycenterWeightMode) ||
      (previous.selectedFlowMode && previous.selectedFlowMode !== labView.selectedFlowMode) ||
      (typeof previous.projection === "number" && previous.projection !== field?.projection);

    if (previous.geometryMode && previous.geometryMode !== labView.selectedGeometryMode) {
      recordInformationGeometryEvent({
        eventType: "geometry_mode_changed",
        tick: nextTick,
        fragmentId: selectedFragment?.id,
        proposalId: selectedProposal?.id,
        message: "geometry mode changed",
        payload: {
          detail: `${getGeometryModeLabel(previous.geometryMode)} -> ${getGeometryModeLabel(labView.selectedGeometryMode)}`,
          previousGeometryMode: previous.geometryMode,
          nextGeometryMode: labView.selectedGeometryMode,
        },
      });
    }

    if (
      (previous.barycenterSourceMode && previous.barycenterSourceMode !== labView.barycenterSourceMode) ||
      (previous.barycenterWeightMode && previous.barycenterWeightMode !== labView.barycenterWeightMode)
    ) {
      recordInformationGeometryEvent({
        eventType: "barycenter_updated",
        tick: nextTick,
        fragmentId: selectedFragment?.id,
        proposalId: selectedProposal?.id,
        message: "barycenter updated",
        payload: {
          detail: `${barycenterSourceModeLabel(labView.barycenterSourceMode)} / ${barycenterWeightModeLabel(
            labView.barycenterWeightMode,
          )}`,
          sourceMode: labView.barycenterSourceMode,
          weightMode: labView.barycenterWeightMode,
        },
      });
    }

    if (previous.selectedFlowMode && previous.selectedFlowMode !== labView.selectedFlowMode) {
      recordInformationGeometryEvent({
        eventType: "flow_direction_updated",
        tick: nextTick,
        fragmentId: selectedFragment?.id,
        proposalId: selectedProposal?.id,
        message: "flow direction updated",
        payload: {
          detail: flowModeLabel(labView.selectedFlowMode),
          flowMode: labView.selectedFlowMode,
        },
      });
    }

    if (
      previous.regressionEnabled !== undefined &&
      (previous.regressionEnabled !== labView.regressionEnabled ||
        previous.regressionTargetMode !== labView.regressionTargetMode ||
        previous.regressionDisplayMode !== labView.regressionDisplayMode)
    ) {
      recordInformationGeometryEvent({
        eventType: "trajectory_fit_updated",
        tick: nextTick,
        fragmentId: selectedFragment?.id,
        proposalId: selectedProposal?.id,
        message: "trajectory fit updated",
        payload: {
          detail: `${labView.regressionEnabled ? "enabled" : "disabled"} / ${regressionTargetModeLabel(
            labView.regressionTargetMode,
          )} / ${regressionDisplayModeLabel(labView.regressionDisplayMode)}`,
          regressionEnabled: labView.regressionEnabled,
          regressionTargetMode: labView.regressionTargetMode,
          regressionDisplayMode: labView.regressionDisplayMode,
        },
      });
    }

    if (
      (previous.voronoiGridResolution && previous.voronoiGridResolution !== labView.voronoiGridResolution) ||
      (previous.voronoiSiteSource && previous.voronoiSiteSource !== labView.voronoiSiteSource)
    ) {
      recordInformationGeometryEvent({
        eventType: "voronoi_partition_updated",
        tick: nextTick,
        fragmentId: selectedFragment?.id,
        proposalId: selectedProposal?.id,
        message: "Voronoi partition updated",
        payload: {
          detail: `${labView.voronoiSiteSource} / grid ${labView.voronoiGridResolution}`,
          voronoiSiteSource: labView.voronoiSiteSource,
          voronoiGridResolution: labView.voronoiGridResolution,
        },
      });
    }

    if (previous.chartKind && previous.chartKind !== labView.selectedChartKind) {
      recordInformationGeometryEvent({
        eventType: "dual_chart_sync_updated",
        tick: nextTick,
        fragmentId: selectedFragment?.id,
        proposalId: selectedProposal?.id,
        message: "dual chart sync updated",
        payload: {
          detail: `${previous.chartKind} -> ${labView.selectedChartKind}`,
          previousChartKind: previous.chartKind,
          nextChartKind: labView.selectedChartKind,
        },
      });
    }

    if (!previous.catastrophe && currentCatastropheSignal) {
      recordInformationGeometryEvent({
        eventType: "catastrophe_marker_detected",
        tick: nextTick,
        fragmentId: selectedFragment?.id,
        proposalId: selectedProposal?.id,
        message: "catastrophe marker detected",
        payload: {
          detail: `curvature ${formatMetric(field?.curvature)} / projection ${formatMetric(field?.projection)} / asymmetry ${formatMetric(
            field?.asymmetry,
          )}`,
          catastropheCandidate: grammarInstability.catastropheCandidate,
          singularityCandidate: grammarInstability.singularityCandidate,
        },
      });
    }

    if (grammarChanged) {
      recordInformationGeometryEvent({
        eventType: "grammar_state_changed",
        tick: nextTick,
        fragmentId: selectedFragment?.id,
        proposalId: selectedProposal?.id,
        message: "geometry grammar state changed",
        payload: {
          detail: `${getGeometryModeLabel(labView.selectedGeometryMode)} / ${labView.selectedChartKind} / ${scalarFieldLabel(
            labView.selectedScalarField,
          )}`,
          geometryMode: labView.selectedGeometryMode,
          chartKind: labView.selectedChartKind,
          scalarField: labView.selectedScalarField,
          barycenterSourceMode: labView.barycenterSourceMode,
          barycenterWeightMode: labView.barycenterWeightMode,
          selectedFlowMode: labView.selectedFlowMode,
          projection: field?.projection ?? null,
          leanStatus: lean?.status ?? null,
        },
      });
    }

    const previousScalarField = previous.scalarField;
    if (previousScalarField && previousScalarField !== labView.selectedScalarField) {
      setLocalIGEvents((current) =>
        [
          ...current,
          {
            id: `ig_local_scalar_${Date.now()}_${labView.selectedScalarField}`,
            source: "local" as const,
            tick: nextTick,
            eventType: "patch" as const,
            fragmentId: selectedFragment?.id,
            proposalId: selectedProposal?.id,
            message: "local patch updated",
            detail: `scalar ${scalarFieldLabel(previousScalarField)} -> ${scalarFieldLabel(labView.selectedScalarField)}`,
          } satisfies IGHistoryEventRecord,
        ].slice(-80),
      );
    }

    if (
      typeof previous.constructivePromise === "number" &&
      typeof previous.obstructivePromise === "number" &&
      (Math.abs((promise?.constructivePromise ?? 0) - previous.constructivePromise) >= 0.12 ||
        Math.abs((promise?.obstructivePromise ?? 0) - previous.obstructivePromise) >= 0.12)
    ) {
      setLocalIGEvents((current) =>
        [
          ...current,
          {
            id: `ig_local_promise_${Date.now()}_${selectedProposal?.id ?? "none"}`,
            source: "local" as const,
            tick: nextTick,
            eventType: "promise" as const,
            fragmentId: selectedFragment?.id,
            proposalId: selectedProposal?.id,
            message: "constructive / obstructive promise changed",
            detail: `C ${formatMetric(promise?.constructivePromise)} / O ${formatMetric(promise?.obstructivePromise)}`,
          } satisfies IGHistoryEventRecord,
        ].slice(-80),
      );
    }

    previousSignalsRef.current = {
      geometryMode: labView.selectedGeometryMode,
      chartKind: labView.selectedChartKind,
      scalarField: labView.selectedScalarField,
      barycenterSourceMode: labView.barycenterSourceMode,
      barycenterWeightMode: labView.barycenterWeightMode,
      selectedFlowMode: labView.selectedFlowMode,
      regressionEnabled: labView.regressionEnabled,
      regressionTargetMode: labView.regressionTargetMode,
      regressionDisplayMode: labView.regressionDisplayMode,
      voronoiGridResolution: labView.voronoiGridResolution,
      voronoiSiteSource: labView.voronoiSiteSource,
      phase,
      catastrophe: currentCatastropheSignal,
      projection: field?.projection,
      constructivePromise: promise?.constructivePromise,
      obstructivePromise: promise?.obstructivePromise,
    };
  }, [
    field?.asymmetry,
    field?.curvature,
    field?.projection,
    grammarInstability.catastropheCandidate,
    grammarInstability.singularityCandidate,
    labView.barycenterSourceMode,
    labView.barycenterWeightMode,
    labView.regressionDisplayMode,
    labView.regressionEnabled,
    labView.regressionTargetMode,
    labView.selectedChartKind,
    labView.selectedFlowMode,
    labView.selectedGeometryMode,
    labView.selectedScalarField,
    labView.selectedTick,
    labView.voronoiGridResolution,
    labView.voronoiSiteSource,
    lean?.status,
    phase,
    promise?.constructivePromise,
    promise?.obstructivePromise,
    recordInformationGeometryEvent,
    selectedFragment?.catastrophe,
    selectedFragment?.catastropheScore,
    selectedFragment?.id,
    selectedProposal?.id,
    simulation.activeTick,
  ]);

  const handleSaveSnapshot = async () => {
    if (!selectedFragment) {
      setSnapshotStatus("Select a fragment before saving an IG snapshot.");
      return;
    }

    const snapshot = buildIGLabSnapshotArtifact({
      tick: accumulationTick,
      currentTab,
      labView,
      selectedFragment,
      selectedProposal,
      label: inspectorSelectionLabel,
      phase: phase ?? selectedFragment.phase,
      patch,
      sites: visibleSiteList,
      samples,
      dualChart: dualChartSnapshot,
      liftedPoints,
    });

    const result = await saveIGLabSnapshot({
      runtimeConfig,
      retentionLimit: runtimeConfig.igLabSnapshotRetention,
      snapshot,
    });

    if (!result.saved) {
      setSnapshotStatus(result.error ?? "Unable to save IG snapshot.");
      return;
    }

    const listResult = await listIGLabSnapshots(
      runtimeConfig.databasePath,
      runtimeConfig.igLabSnapshotRetention,
    );
    setSnapshotRecords(listResult.records);
    setSelectedSnapshotId(result.record?.id ?? listResult.records[0]?.id);
    setLoadedSnapshot(snapshot);
    setSnapshotStatus(`Saved snapshot at tick ${snapshot.tick}.`);
    recordInformationGeometryEvent({
      eventType: "ig_snapshot_saved",
      tick: snapshot.tick,
      fragmentId: snapshot.fragmentId,
      proposalId: snapshot.proposalId,
      message: "IG snapshot saved",
      payload: {
        detail: `${snapshot.viewMode} / ${snapshot.chartKind} / ${snapshot.scalarField}`,
        snapshotId: snapshot.id,
        snapshotLabel: snapshot.label ?? null,
        geometryMode: snapshot.geometryMode,
      },
    });
  };

  const handleLoadSnapshot = async () => {
    if (!selectedSnapshotRecord) {
      setSnapshotStatus("Choose a saved snapshot to load.");
      return;
    }

    const snapshot = await loadIGLabSnapshotArtifact(
      runtimeConfig.artifactDirectory,
      selectedSnapshotRecord.artifactPath,
    );

    if (!snapshot) {
      setSnapshotStatus("Unable to read the selected snapshot artifact.");
      return;
    }

    setLoadedSnapshot(snapshot);
    setInformationGeometryLabTab(snapshot.moduleTab ?? defaultTabForViewMode(snapshot.viewMode));
    updateInformationGeometryLabState({
      selectedIGViewMode: snapshot.viewMode,
      selectedGeometryMode: snapshot.geometryMode ?? view.informationGeometryLab.selectedGeometryMode,
      selectedFragmentId: snapshot.fragmentId,
      selectedProposalId: snapshot.proposalId,
      selectedTick: snapshot.tick,
      selectedChartKind: snapshot.chartKind,
      selectedScalarField: snapshot.scalarField,
      colorScaleMode: snapshot.colorScaleMode,
      normalizationMode: snapshot.normalizationMode,
      autoFollowActiveFragment: false,
      freezeCurrentSnapshot: true,
      compareWithPreviousTick: snapshot.compareWithPreviousTick,
      voronoiGridResolution: snapshot.metadata.voronoiGridResolution,
      voronoiSiteSource: snapshot.metadata.voronoiSiteSource as InformationGeometryLabVoronoiSiteSource,
      accumulationTrailLength: snapshot.metadata.accumulationTrailLength,
      accumulationMode: snapshot.metadata.accumulationMode as InformationGeometryLabAccumulationMode,
      barycenterSourceMode:
        (snapshot.metadata.barycenterSourceMode as InformationGeometryLabBarycenterSourceMode) ??
        view.informationGeometryLab.barycenterSourceMode,
      barycenterWeightMode:
        (snapshot.metadata.barycenterWeightMode as InformationGeometryLabBarycenterWeightMode) ??
        view.informationGeometryLab.barycenterWeightMode,
      barycenterTickWindow:
        snapshot.metadata.barycenterTickWindow ?? view.informationGeometryLab.barycenterTickWindow,
      selectedFlowMode:
        (snapshot.metadata.selectedFlowMode as InformationGeometryLabFlowMode) ??
        view.informationGeometryLab.selectedFlowMode,
      regressionEnabled: snapshot.metadata.regressionEnabled ?? view.informationGeometryLab.regressionEnabled,
      regressionTargetMode:
        (snapshot.metadata.regressionTargetMode as InformationGeometryLabRegressionTargetMode) ??
        view.informationGeometryLab.regressionTargetMode,
      regressionDisplayMode:
        (snapshot.metadata.regressionDisplayMode as InformationGeometryLabRegressionDisplayMode) ??
        view.informationGeometryLab.regressionDisplayMode,
      regressionTickWindow:
        snapshot.metadata.regressionTickWindow ?? view.informationGeometryLab.regressionTickWindow,
      flowVectorDensity:
        snapshot.metadata.flowVectorDensity ?? view.informationGeometryLab.flowVectorDensity,
      flowVectorScale:
        snapshot.metadata.flowVectorScale ?? view.informationGeometryLab.flowVectorScale,
      showVoronoiSites: snapshot.metadata.showVoronoiSites,
      showVoronoiBoundaries: snapshot.metadata.showVoronoiBoundaries,
      showLiftedSurface: snapshot.metadata.showLiftedSurface,
      showLiftedStems: snapshot.metadata.showLiftedStems,
      showLiftedFootprint: snapshot.metadata.showLiftedFootprint,
      showGeodesics: snapshot.metadata.showGeodesics,
      showNucleation: snapshot.metadata.showNucleation,
      showCatastropheMarkers: snapshot.metadata.showCatastropheMarkers,
      showBarycenter: snapshot.metadata.showBarycenter ?? view.informationGeometryLab.showBarycenter,
      showBarycenterTrail:
        snapshot.metadata.showBarycenterTrail ?? view.informationGeometryLab.showBarycenterTrail,
      showFlowVectors: snapshot.metadata.showFlowVectors ?? view.informationGeometryLab.showFlowVectors,
      showFlowTrails: snapshot.metadata.showFlowTrails ?? view.informationGeometryLab.showFlowTrails,
      animateFlowOverTicks:
        snapshot.metadata.animateFlowOverTicks ?? view.informationGeometryLab.animateFlowOverTicks,
      showResidualMarkers:
        snapshot.metadata.showResidualMarkers ?? view.informationGeometryLab.showResidualMarkers,
      showAccumulationHistory: snapshot.metadata.showAccumulationHistory,
    });

    if (snapshot.fragmentId && simulation.fragments[snapshot.fragmentId]) {
      selectFragment(snapshot.fragmentId);
    }
    if (snapshot.proposalId && simulation.proposals[snapshot.proposalId]) {
      selectProposal(snapshot.proposalId);
    }

    setSnapshotStatus(`Loaded snapshot from tick ${snapshot.tick}.`);
  };

  const focusSharedGeometrySelection = (input: {
    fragmentId?: FragmentId;
    proposalId?: SemanticProposalId;
    tick?: number;
    freezeCurrentSnapshot?: boolean;
  }) => {
    updateInformationGeometryLabState({
      autoFollowActiveFragment: false,
      freezeCurrentSnapshot: input.freezeCurrentSnapshot ?? false,
      selectedTick: input.tick ?? accumulationTick,
      selectedFragmentId: input.fragmentId ?? selectedFragment?.id,
      selectedProposalId: input.proposalId,
    });

    if (input.proposalId && simulation.proposals[input.proposalId]) {
      selectProposal(input.proposalId);
      return;
    }

    if (input.fragmentId) {
      selectFragment(input.fragmentId);
    }
  };

  const focusIGSite = (site: {
    fragmentId: FragmentId;
    proposalId?: SemanticProposalId;
    tick?: number;
  }) => {
    focusSharedGeometrySelection({
      fragmentId: site.fragmentId,
      proposalId: site.proposalId,
      tick: site.tick,
      freezeCurrentSnapshot: typeof site.tick === "number" && site.tick !== simulation.activeTick,
    });
  };

  const focusBarycenterRecord = (record: BarycenterRecord) => {
    setSelectedBarycenterTick(record.tick);
    focusSharedGeometrySelection({
      freezeCurrentSnapshot: true,
      tick: record.tick,
      fragmentId: record.inputs.fragmentId,
      proposalId: record.inputs.proposalId as SemanticProposalId | undefined,
    });
  };

  const focusTrajectorySample = (sample: GeometricTrajectorySample) => {
    setSelectedSampleId(sample.id);
    setSelectedBarycenterTick(undefined);
    focusSharedGeometrySelection({
      fragmentId: sample.fragmentId,
      proposalId: sample.proposalId,
      tick: sample.tick,
      freezeCurrentSnapshot: typeof sample.tick === "number" && sample.tick !== simulation.activeTick,
    });
  };

  const renderCanvas = () => {
    if (!selectedFragment) {
      return <p className="htt-empty">Select a fragment to open the lab on a concrete local geometry.</p>;
    }

    const flowAnimationStyle = labView.animateFlowOverTicks
      ? ({ animation: "htt-ig-breathe 2.6s ease-in-out infinite" } as const)
      : undefined;

    if (currentTab === "patches") {
      if (labView.selectedIGViewMode !== "localPatch") {
        return (
          <div className="htt-empty">
            {`${labView.selectedIGViewMode} is not implemented yet. Switch the IG mode back to localPatch to inspect the active manifold patch.`}
          </div>
        );
      }

      if (!patch) {
        return <p className="htt-empty">The selected fragment does not yet expose a complete local patch.</p>;
      }

      const bounds = pointBounds(patch.vertices.map((vertex) => vertex.point));
      const mappedVertices = patch.vertices.map((vertex) => mapPointToFrame(vertex.point, bounds, 520, 320, 20));
      const mappedCentroid = mapPointToFrame(patch.centroid, bounds, 520, 320, 20);
      const polygon = mappedVertices.map((point) => `${point.x},${point.y}`).join(" ");
      const polygonD = polygonPath(mappedVertices);
      const scalarValues = samples.map((sample) => scalarSampleMetric(sample, labView.selectedScalarField));
      const comparisonScalarValues = comparisonSamples.map((sample) =>
        scalarSampleMetric(sample, labView.selectedScalarField),
      );
      const { minValue: scalarMin, maxValue: scalarMax } = resolveScalarBounds(
        scalarValues,
        labView.normalizationMode,
        labView.compareWithPreviousTick ? comparisonScalarValues : [],
      );
      const maxSample = samples.reduce(
        (best, sample) =>
          scalarSampleMetric(sample, labView.selectedScalarField) >
          scalarSampleMetric(best, labView.selectedScalarField)
            ? sample
            : best,
        samples[0],
      );
      const nucleationPoint = maxSample ? mapPointToFrame(maxSample.point, bounds, 520, 320, 20) : undefined;
      const midpoints = mappedVertices.map((point, index) => {
        const next = mappedVertices[(index + 1) % mappedVertices.length];
        return {
          x: (point.x + next.x) / 2,
          y: (point.y + next.y) / 2,
        };
      });
      const selectedMetric = activeSample ? scalarSampleMetric(activeSample, labView.selectedScalarField) : undefined;
      const sampleSignals = samples.map((sample) => ({
        sample,
        signal: geometryInstabilitySignal({
          curvature: sample.curvature,
          asymmetry: sample.asymmetry,
          projection: sample.projection,
          promiseConstructive: sample.promiseConstructive,
          promiseObstructive: sample.promiseObstructive,
          catastrophe: selectedFragment.catastrophe,
        }),
      }));
      const catastropheSample = sampleSignals
        .filter((entry) => entry.signal.catastropheCandidate)
        .sort((left, right) => right.signal.instability - left.signal.instability)[0];
      const singularitySample = sampleSignals
        .filter((entry) => entry.signal.singularityCandidate)
        .sort((left, right) => right.signal.instability - left.signal.instability)[0];
      const highCurvatureSamples = sampleSignals
        .filter((entry) => entry.signal.highCurvature)
        .sort((left, right) => right.sample.curvature - left.sample.curvature)
        .slice(0, 3);
      const unstableBoundaries = patch.vertices.map((vertex, index) => {
        const nextVertex = patch.vertices[(index + 1) % patch.vertices.length];
        const midpointActual = {
          x: (vertex.point.x + nextVertex.point.x) / 2,
          y: (vertex.point.y + nextVertex.point.y) / 2,
        };
        const nearest = sampleSignals.reduce((best, candidate) => {
          if (!best) {
            return candidate;
          }
          const bestDistance = pointDistanceSquared(best.sample.point, midpointActual);
          const candidateDistance = pointDistanceSquared(candidate.sample.point, midpointActual);
          return candidateDistance < bestDistance ? candidate : best;
        }, sampleSignals[0]);
        return {
          from: mappedVertices[index],
          to: mappedVertices[(index + 1) % mappedVertices.length],
          signal: nearest?.signal,
        };
      });
      const contourPaths = contourPathsForSamples(
        samples,
        labView.selectedScalarField,
        bounds,
        520,
        320,
        20,
        scalarMin,
        scalarMax,
      );
      const patchBarycenterTrailPoints =
        labView.showBarycenterTrail && barycenterTrailRecords.length > 1
          ? barycenterTrailRecords.map((record) =>
              mapPointToFrame(
                projectBarycenterToPatch(
                  patch,
                  labView.selectedGeometryMode,
                  labView.selectedChartKind,
                  record.result.point,
                ),
                bounds,
                520,
                320,
                20,
              ),
            )
          : [];
      const patchBarycenterPoint =
        labView.showBarycenter && activeBarycenterRecord
          ? mapPointToFrame(
              projectBarycenterToPatch(
                patch,
                labView.selectedGeometryMode,
                labView.selectedChartKind,
                activeBarycenterRecord.result.point,
              ),
              bounds,
              520,
              320,
              20,
            )
          : undefined;
      const patchFlowTrailPoints =
        labView.showFlowTrails && selectedFlowTrailRecords.length > 1
          ? selectedFlowTrailRecords.map((record) =>
              mapPointToFrame(
                projectBarycenterToPatch(
                  patch,
                  labView.selectedGeometryMode,
                  labView.selectedChartKind,
                  record.point,
                ),
                bounds,
                520,
                320,
                20,
              ),
            )
          : [];
      const patchFlowVectors =
        labView.showFlowVectors
          ? samples
              .filter((_, index) => index % Math.max(1, 6 - labView.flowVectorDensity) === 0)
              .map((sample) => {
                const point = estimatedFlowPointForPatchSample(sample, patch);
                const result = flowDirectionResultForMode(
                  labView.selectedFlowMode,
                  point,
                  activeFlowNeighborhood,
                  labView.selectedGeometryMode,
                );
                const from = mapPointToFrame(sample.point, bounds, 520, 320, 20);
                const to = mapPointToFrame(
                  projectBarycenterToPatch(
                    patch,
                    labView.selectedGeometryMode,
                    labView.selectedChartKind,
                    {
                      theta: point.theta.map((value, index) => value + (result.thetaDirection[index] ?? 0) * labView.flowVectorScale),
                      eta: point.eta.map((value, index) => value + (result.etaDirection[index] ?? 0) * labView.flowVectorScale),
                    },
                  ),
                  bounds,
                  520,
                  320,
                  20,
                );
                return {
                  sample,
                  result,
                  from,
                  to,
                  paths: arrowPath(from, to, 5),
                };
              })
          : [];
      const patchTrajectoryActualPoints =
        trajectoryDiagnostics && trajectoryDiagnostics.samples.length > 1
          ? trajectoryDiagnostics.samples.map((sample) =>
              mapPointToFrame(
                projectBarycenterToPatch(
                  patch,
                  labView.selectedGeometryMode,
                  labView.selectedChartKind,
                  sample.point,
                ),
                bounds,
                520,
                320,
                20,
              ),
            )
          : [];
      const patchTrajectoryFittedPoints =
        trajectoryDiagnostics && trajectoryDiagnostics.fit.fittedSamples.length > 1
          ? trajectoryDiagnostics.fit.fittedSamples.map((sample) =>
              mapPointToFrame(
                projectBarycenterToPatch(
                  patch,
                  labView.selectedGeometryMode,
                  labView.selectedChartKind,
                  sample.point,
                ),
                bounds,
                520,
                320,
                20,
              ),
            )
          : [];
      const patchTrajectoryResidualSegments =
        trajectoryDiagnostics && labView.showResidualMarkers
          ? trajectoryDiagnostics.residuals.map((residual) => ({
              actual: mapPointToFrame(
                projectBarycenterToPatch(
                  patch,
                  labView.selectedGeometryMode,
                  labView.selectedChartKind,
                  residual.actualPoint,
                ),
                bounds,
                520,
                320,
                20,
              ),
              fitted: mapPointToFrame(
                projectBarycenterToPatch(
                  patch,
                  labView.selectedGeometryMode,
                  labView.selectedChartKind,
                  residual.fittedPoint,
                ),
                bounds,
                520,
                320,
                20,
              ),
              residual,
            }))
          : [];
      const patchTrajectoryVelocityPaths =
        trajectoryDiagnostics && labView.regressionDisplayMode === "velocity"
          ? trajectoryVelocityPaths(patchTrajectoryFittedPoints, 4.5)
          : [];
      const patchTrajectoryStatus = trajectoryStatusLabel(trajectoryDiagnostics?.indicators);

      return (
        <svg className="htt-lab-module-canvas" viewBox="0 0 520 320" role="img" aria-label="Local manifold patch">
          <defs>
            <clipPath id={`ig-patch-clip-${selectedFragment.id}`}>
              <polygon points={polygon} />
            </clipPath>
            <radialGradient id={`ig-patch-core-${selectedFragment.id}`} cx="50%" cy="44%" r="68%">
              <stop offset="0%" stopColor="rgba(255,255,255,0.08)" />
              <stop offset="100%" stopColor="rgba(255,255,255,0.01)" />
            </radialGradient>
            <linearGradient id={`ig-patch-sheen-${selectedFragment.id}`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="rgba(255,255,255,0.12)" />
              <stop offset="48%" stopColor="rgba(255,255,255,0.02)" />
              <stop offset="100%" stopColor="rgba(142,174,212,0.05)" />
            </linearGradient>
          </defs>

          <rect x="0" y="0" width="520" height="320" fill="rgba(4, 5, 7, 0.22)" />
          <path d={polygonD} fill={`url(#ig-patch-core-${selectedFragment.id})`} stroke="rgba(233, 225, 214, 0.28)" strokeWidth="1.4" />
          <path
            d={polygonD}
            className="htt-ig-scene__surface"
            fill={`url(#ig-patch-sheen-${selectedFragment.id})`}
            stroke="rgba(245, 237, 225, 0.08)"
            strokeWidth="0.8"
          />

          <g clipPath={`url(#ig-patch-clip-${selectedFragment.id})`}>
            {samples.map((sample) => {
              const mapped = mapPointToFrame(sample.point, bounds, 520, 320, 20);
              const metric = scalarSampleMetric(sample, labView.selectedScalarField);
              const radius = 42 + clamp01(metric / Math.max(0.001, scalarMax)) * 62;
              const opacity = 0.18 + clamp01((metric - scalarMin) / Math.max(0.001, scalarMax - scalarMin || 1)) * 0.5;
              return (
                <circle
                  key={sample.id}
                  cx={mapped.x}
                  cy={mapped.y}
                  r={radius}
                  fill={scalarFieldColor(metric, scalarMin, scalarMax, labView.colorScaleMode)}
                  opacity={opacity}
                />
              );
            })}
            {contourPaths.map((contour, index) => (
              <path
                key={contour.id}
                d={contour.d}
                className="htt-ig-scene__contour"
                fill="none"
                stroke="rgba(245, 237, 225, 0.18)"
                strokeWidth={0.7 + index * 0.12}
                opacity={0.28 + index * 0.08}
              />
            ))}
          </g>

          {labView.showGeodesics ? (
            <>
              <path d={linePath([mappedVertices[0], midpoints[1]])} fill="none" stroke="rgba(245, 237, 225, 0.34)" strokeWidth="1.2" strokeDasharray="5 4" />
              <path d={linePath([mappedVertices[1], midpoints[2]])} fill="none" stroke="rgba(245, 237, 225, 0.34)" strokeWidth="1.2" strokeDasharray="5 4" />
              <path d={linePath([mappedVertices[2], midpoints[0]])} fill="none" stroke="rgba(245, 237, 225, 0.34)" strokeWidth="1.2" strokeDasharray="5 4" />
              <path d={linePath([midpoints[0], midpoints[1], midpoints[2], midpoints[0]])} fill="none" stroke="rgba(142, 174, 212, 0.32)" strokeWidth="1.1" />
            </>
          ) : null}

          {labView.showNucleation && patch.phase === "nucleating" && nucleationPoint ? (
            <g>
              <circle cx={nucleationPoint.x} cy={nucleationPoint.y} r="22" fill="rgba(0, 0, 0, 0.28)" />
              <circle cx={nucleationPoint.x} cy={nucleationPoint.y} r="10" fill="rgba(0, 0, 0, 0.52)" stroke="rgba(245, 237, 225, 0.42)" strokeWidth="1" />
            </g>
          ) : null}

          {labView.showCatastropheMarkers && selectedFragment.catastrophe ? (
            <path
              d={polygonD}
              fill="none"
              stroke="rgba(222, 146, 121, 0.86)"
              strokeWidth="2.1"
              strokeDasharray="7 5"
            />
          ) : null}

          {labView.showCatastropheMarkers
            ? unstableBoundaries
                .filter((entry) => entry.signal?.projectionSpike || entry.signal?.asymmetryUnstable)
                .map((entry, index) => (
                  <line
                    key={`unstable-boundary-${index}`}
                    x1={entry.from.x}
                    y1={entry.from.y}
                    x2={entry.to.x}
                    y2={entry.to.y}
                    stroke={instabilityStroke("boundary")}
                    strokeWidth={entry.signal?.catastropheCandidate ? 3.2 : 2.3}
                    strokeDasharray="6 4"
                  />
                ))
            : null}

          {labView.showCatastropheMarkers
            ? highCurvatureSamples.map(({ sample, signal }) => {
                const mapped = mapPointToFrame(sample.point, bounds, 520, 320, 20);
                return (
                  <circle
                    key={`high-curvature-${sample.id}`}
                    cx={mapped.x}
                    cy={mapped.y}
                    r={14 + signal.instability * 12}
                    fill="none"
                    stroke={instabilityStroke("curvature")}
                    strokeWidth="1.4"
                    opacity="0.78"
                  />
                );
              })
            : null}

          {labView.showCatastropheMarkers && catastropheSample ? (
            <g>
              <circle
                cx={mapPointToFrame(catastropheSample.sample.point, bounds, 520, 320, 20).x}
                cy={mapPointToFrame(catastropheSample.sample.point, bounds, 520, 320, 20).y}
                r={18 + catastropheSample.signal.instability * 12}
                fill="none"
                stroke={instabilityStroke("catastrophe")}
                strokeWidth="2.2"
                strokeDasharray="5 4"
              />
            </g>
          ) : null}

          {labView.showCatastropheMarkers && singularitySample ? (
            <path
              d={crossMarkerPath(
                mapPointToFrame(singularitySample.sample.point, bounds, 520, 320, 20),
                8 + singularitySample.signal.instability * 5,
              )}
              fill="none"
              stroke={instabilityStroke("singularity")}
              strokeWidth="2"
              strokeLinecap="round"
            />
          ) : null}

          {labView.showVoronoiSites
            ? mappedVertices.map((point, index) => (
                <g key={patch.vertices[index].id}>
                  <circle cx={point.x} cy={point.y} r="6.5" fill="rgba(245, 237, 225, 0.92)" stroke="rgba(16, 18, 22, 0.86)" strokeWidth="1.2" />
                  <text className="htt-lab-svg-label" x={point.x} y={point.y - 12}>
                    {`v${index + 1}`}
                  </text>
                </g>
              ))
            : null}

          {labView.showVoronoiSites ? (
            <g>
              <circle cx={mappedCentroid.x} cy={mappedCentroid.y} r="5.2" fill="rgba(12, 16, 20, 0.88)" stroke="rgba(245, 237, 225, 0.82)" strokeWidth="1.1" />
              <text className="htt-lab-svg-label" x={mappedCentroid.x} y={mappedCentroid.y + 18}>
                {selectedProposal?.title ? "site / proposal" : "site / fragment"}
              </text>
            </g>
          ) : null}

          {patchBarycenterTrailPoints.length > 1 ? (
            <g>
              <path
                className="htt-ig-scene__trail"
                d={smoothLinePath(patchBarycenterTrailPoints)}
                fill="none"
                stroke="rgba(255, 196, 120, 0.78)"
                strokeWidth="1.8"
                strokeDasharray="5 4"
              />
              {barycenterTrailRecords.map((record, index) => (
                <circle
                  key={`patch-barycenter-trail-${record.tick}`}
                  cx={patchBarycenterTrailPoints[index].x}
                  cy={patchBarycenterTrailPoints[index].y}
                  r={record.tick === activeBarycenterRecord?.tick ? 4.6 : 3.2}
                  fill="rgba(255, 214, 158, 0.92)"
                  stroke="rgba(119, 66, 18, 0.88)"
                  strokeWidth="1"
                  onMouseEnter={() => setHoveredBarycenterTick(record.tick)}
                  onMouseLeave={() => setHoveredBarycenterTick((current) => (current === record.tick ? undefined : current))}
                  onClick={() => focusBarycenterRecord(record)}
                  style={{ cursor: "pointer" }}
                />
              ))}
            </g>
          ) : null}

          {patchBarycenterPoint && activeBarycenterRecord ? (
            <g
              onMouseEnter={() => setHoveredBarycenterTick(activeBarycenterRecord.tick)}
              onMouseLeave={() => setHoveredBarycenterTick((current) => (current === activeBarycenterRecord.tick ? undefined : current))}
              onClick={() => focusBarycenterRecord(activeBarycenterRecord)}
              style={{ cursor: "pointer" }}
            >
              <circle
                cx={patchBarycenterPoint.x}
                cy={patchBarycenterPoint.y}
                r="11"
                fill="rgba(255, 196, 120, 0.22)"
                stroke="rgba(255, 214, 158, 0.96)"
                strokeWidth="2.2"
              />
              <circle cx={patchBarycenterPoint.x} cy={patchBarycenterPoint.y} r="4.1" fill="rgba(255, 237, 211, 0.98)" />
              <path
                d={crossMarkerPath(patchBarycenterPoint, 6)}
                fill="none"
                stroke="rgba(119, 66, 18, 0.92)"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
              <text className="htt-lab-svg-label" x={patchBarycenterPoint.x} y={patchBarycenterPoint.y - 16}>
                {`barycenter / ${activeBarycenterRecord.inputs.sites.length}`}
              </text>
              <title>{`${barycenterSourceModeLabel(activeBarycenterRecord.inputs.sourceMode)} / ${barycenterWeightModeLabel(activeBarycenterRecord.inputs.weightMode)} / tick ${activeBarycenterRecord.tick}`}</title>
            </g>
          ) : null}

          {patchFlowTrailPoints.length > 1 ? (
            <path
              className="htt-ig-scene__motion"
              d={smoothLinePath(patchFlowTrailPoints)}
              fill="none"
              stroke="rgba(142, 214, 220, 0.66)"
              strokeWidth="1.5"
              strokeDasharray="6 4"
              style={flowAnimationStyle}
            />
          ) : null}

          {patchFlowVectors.map((entry) => (
            <g
              key={`patch-flow-${entry.sample.id}`}
              opacity={labView.animateFlowOverTicks ? 0.62 : 0.78}
              style={flowAnimationStyle}
            >
              <path
                d={entry.paths.shaft}
                fill="none"
                stroke="rgba(142, 214, 220, 0.8)"
                strokeWidth="1.25"
                strokeLinecap="round"
              />
              <path
                d={entry.paths.head}
                fill="none"
                stroke="rgba(142, 214, 220, 0.8)"
                strokeWidth="1.25"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <title>{`${flowModeLabel(labView.selectedFlowMode)} / ${entry.result.method}`}</title>
            </g>
          ))}

          {trajectoryDiagnostics && patchTrajectoryFittedPoints.length > 1 ? (
            <g>
              <path
                className="htt-ig-scene__trace"
                d={smoothLinePath(patchTrajectoryFittedPoints)}
                fill="none"
                stroke="rgba(208, 190, 244, 0.9)"
                strokeWidth={labView.regressionDisplayMode === "fittedCurve" ? 2.4 : 2}
                strokeDasharray={labView.regressionDisplayMode === "convergence" ? "7 4" : undefined}
              />
              {labView.regressionDisplayMode === "velocity"
                ? patchTrajectoryVelocityPaths.map((path, index) => (
                    <g key={`patch-trajectory-velocity-${index}`}>
                      <path d={path.shaft} fill="none" stroke="rgba(208, 190, 244, 0.76)" strokeWidth="1.2" />
                      <path d={path.head} fill="none" stroke="rgba(208, 190, 244, 0.76)" strokeWidth="1.2" />
                    </g>
                  ))
                : null}
            </g>
          ) : null}

          {patchTrajectoryActualPoints.length > 0
            ? patchTrajectoryActualPoints.map((point, index) => (
                <circle
                  key={`patch-trajectory-sample-${index}`}
                  cx={point.x}
                  cy={point.y}
                  r={index === patchTrajectoryActualPoints.length - 1 ? 4.4 : 3.2}
                  fill="rgba(245, 237, 225, 0.92)"
                  stroke="rgba(91, 72, 124, 0.78)"
                  strokeWidth="1"
                  onClick={() => {
                    const sample = trajectoryDiagnostics?.samples[index];
                    if (sample) {
                      focusTrajectorySample(sample);
                    }
                  }}
                  style={{ cursor: trajectoryDiagnostics?.samples[index] ? "pointer" : "default" }}
                />
              ))
            : null}

          {patchTrajectoryResidualSegments.map((segment, index) => (
            <g key={`patch-trajectory-residual-${index}`}>
              <path
                d={linePath([segment.actual, segment.fitted])}
                fill="none"
                stroke="rgba(228, 150, 138, 0.62)"
                strokeWidth="1.15"
                strokeDasharray="4 3"
              />
              <circle
                cx={segment.fitted.x}
                cy={segment.fitted.y}
                r={2.1 + Math.min(4.6, segment.residual.combinedResidual * 6)}
                fill="rgba(228, 150, 138, 0.2)"
                stroke="rgba(228, 150, 138, 0.66)"
                strokeWidth="0.9"
              />
            </g>
          ))}

          {samples.map((sample) => {
            const mapped = mapPointToFrame(sample.point, bounds, 520, 320, 20);
            const metric = scalarSampleMetric(sample, labView.selectedScalarField);
            const isActive = sample.id === activeSample?.id;
            return (
              <g
                key={`patch-sample-hit-${sample.id}`}
                onMouseEnter={() => setHoveredSampleId(sample.id)}
                onMouseLeave={() => setHoveredSampleId((current) => (current === sample.id ? undefined : current))}
                onClick={() => {
                  setSelectedSampleId(sample.id);
                  setSelectedBarycenterTick(undefined);
                  focusSharedGeometrySelection({
                    fragmentId: sample.fragmentId,
                    proposalId: sample.proposalId,
                    tick: sample.tick,
                    freezeCurrentSnapshot: sample.tick !== simulation.activeTick,
                  });
                }}
                style={{ cursor: "pointer" }}
              >
                <circle
                  cx={mapped.x}
                  cy={mapped.y}
                  r={isActive ? 8.5 : 6}
                  fill={scalarFieldColor(metric, scalarMin, scalarMax, labView.colorScaleMode)}
                  stroke={isActive ? "rgba(255, 255, 255, 0.96)" : "rgba(17, 20, 24, 0.9)"}
                  strokeWidth={isActive ? 1.8 : 1.2}
                />
                <title>{`${scalarFieldLabel(labView.selectedScalarField)} ${formatMetric(metric)} / divergence ${formatMetric(sample.divergence)} / asymmetry ${formatMetric(sample.asymmetry)} / curvature ${formatMetric(sample.curvature)} / projection ${formatMetric(sample.projection)}`}</title>
              </g>
            );
          })}

          <text className="htt-lab-svg-title" x="20" y="24">
            {`local patch / ${getGeometryModeLabel(labView.selectedGeometryMode)} / ${scalarFieldLabel(labView.selectedScalarField)} / ${patch.phase ?? selectedFragment.phase}`}
          </text>
          {trajectoryDiagnostics ? (
            <text className="htt-lab-svg-label" x="500" y="24" textAnchor="end">
              {`trajectory / ${patchTrajectoryStatus}`}
            </text>
          ) : null}
          <text className="htt-lab-svg-label" x="20" y="302">
            {activeSample
              ? `sample ${activeSample.id.replace(`ig_patch_${selectedFragment.id}_`, "")} / ${scalarFieldLabel(labView.selectedScalarField)} ${formatMetric(selectedMetric)}`
              : `hover a sample to inspect / ${labView.colorScaleMode} / ${labView.normalizationMode}${
                  labView.compareWithPreviousTick ? ` / compare ${previousAvailableTick}` : ""
                }`}
          </text>
        </svg>
      );
    }

    if (currentTab === "divergence") {
      const metrics = [
        { label: "forward", value: field?.forward ?? 0, color: labColor(0) },
        { label: "reverse", value: field?.reverse ?? 0, color: labColor(1) },
        { label: "asymmetry", value: field?.asymmetry ?? 0, color: labColor(2) },
        { label: "projection", value: field?.projection ?? 0, color: labColor(3) },
        { label: "curvature", value: field?.curvature ?? 0, color: labColor(4) },
        { label: "total", value: field?.total ?? 0, color: "rgba(245, 237, 225, 0.92)" },
      ];
      const maxValue = Math.max(0.001, ...metrics.map((metric) => metric.value));

      return (
        <div className="htt-lab-module-metric-grid">
          {metrics.map((metric) => (
            <article key={metric.label} className="htt-lab-module-metric-card">
              <p className="htt-lab-module-metric-card__label">{metric.label}</p>
              <p className="htt-lab-module-metric-card__value">{metric.value.toFixed(3)}</p>
              <div className="htt-lab-bar">
                <span
                  className="htt-lab-bar__fill"
                  style={{
                    width: `${clamp01(metric.value / maxValue) * 100}%`,
                    background: metric.color,
                  }}
                />
              </div>
            </article>
          ))}
        </div>
      );
    }

    if (currentTab === "voronoi") {
      if (voronoiSites.length === 0) {
        return <p className="htt-empty">No Voronoi sites are available for the current source selection.</p>;
      }

      const columns = Math.max(8, Math.min(42, Math.round(labView.voronoiGridResolution)));
      const rows = Math.max(6, Math.round(columns * (320 / 520)));
      const cellWidth = 520 / columns;
      const cellHeight = 320 / rows;
      const chartBounds = pointBounds(
        voronoiSites.map((site) => siteChartPoint(site, labView.selectedGeometryMode, labView.selectedChartKind)),
      );
      const spanX = Math.max(0.12, chartBounds.maxX - chartBounds.minX);
      const spanY = Math.max(0.12, chartBounds.maxY - chartBounds.minY);
      const expandedBounds = {
        minX: chartBounds.minX - spanX * 0.18,
        maxX: chartBounds.maxX + spanX * 0.18,
        minY: chartBounds.minY - spanY * 0.18,
        maxY: chartBounds.maxY + spanY * 0.18,
      };
      const scalarValues = voronoiSites.map((site) => scalarValueForSite(site, labView.selectedScalarField));
      const comparisonScalarValues = comparisonSites.map((site) =>
        scalarValueForSite(site, labView.selectedScalarField),
      );
      const { minValue: scalarMin, maxValue: scalarMax } = resolveScalarBounds(
        scalarValues,
        labView.normalizationMode,
        labView.compareWithPreviousTick ? comparisonScalarValues : [],
      );
      const siteSignals = new Map(
        voronoiSites.map((site) => [
          site.id,
          geometryInstabilitySignal({
            curvature: site.curvature,
            asymmetry: site.asymmetry,
            projection: site.projection,
            promiseConstructive: site.promiseConstructive,
            promiseObstructive: site.promiseObstructive,
            catastrophe: selectedFragment.catastrophe,
          }),
          ]),
      );
      const siteMotionSegments =
        labView.compareWithPreviousTick && labView.showVoronoiSites
          ? buildMotionSegments(
              voronoiSites,
              comparisonSites,
              (site) =>
                mapPointToFrame(
                  siteChartPoint(site, labView.selectedGeometryMode, labView.selectedChartKind),
                  expandedBounds,
                  520,
                  320,
                  18,
                ),
            )
          : [];
      const voronoiBarycenterTrailPoints =
        labView.showBarycenterTrail && barycenterTrailRecords.length > 1
          ? barycenterTrailRecords.map((record) =>
              mapPointToFrame(
                barycenterChartPoint(
                  labView.selectedGeometryMode,
                  labView.selectedChartKind,
                  record.result.point,
                ),
                expandedBounds,
                520,
                320,
                18,
              ),
            )
          : [];
      const voronoiBarycenterPoint =
        labView.showBarycenter && activeBarycenterRecord
          ? mapPointToFrame(
              barycenterChartPoint(
                labView.selectedGeometryMode,
                labView.selectedChartKind,
                activeBarycenterRecord.result.point,
              ),
              expandedBounds,
              520,
              320,
              18,
            )
          : undefined;

      const cells = Array.from({ length: columns * rows }, (_, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        const chartPoint = {
          x:
            expandedBounds.minX +
            ((column + 0.5) / columns) * Math.max(0.001, expandedBounds.maxX - expandedBounds.minX),
          y:
            expandedBounds.minY +
            ((row + 0.5) / rows) * Math.max(0.001, expandedBounds.maxY - expandedBounds.minY),
        };
        const nearestSite = voronoiSites.reduce((bestSite, candidate) => {
          if (!bestSite) {
            return candidate;
          }
          const candidateDistance = bregmanStyleDistance(
            chartPoint,
            candidate,
            labView.selectedGeometryMode,
            labView.selectedChartKind,
          );
          const bestDistance = bregmanStyleDistance(
            chartPoint,
            bestSite,
            labView.selectedGeometryMode,
            labView.selectedChartKind,
          );
          return candidateDistance < bestDistance ? candidate : bestSite;
        }, voronoiSites[0]);
        const scalarValue = scalarValueForSite(nearestSite, labView.selectedScalarField);

        return {
          id: `voronoi-${column}-${row}`,
          siteId: nearestSite.id,
          x: column * cellWidth,
          y: row * cellHeight,
          color: scalarFieldColor(scalarValue, scalarMin, scalarMax, labView.colorScaleMode),
          scalarValue,
        };
      });

      const boundaries: Array<{ x1: number; y1: number; x2: number; y2: number; unstable: boolean }> = [];
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const index = row * columns + column;
          const cell = cells[index];
          const right = column < columns - 1 ? cells[index + 1] : undefined;
          const bottom = row < rows - 1 ? cells[index + columns] : undefined;

          if (right && right.siteId !== cell.siteId) {
            const leftSignal = siteSignals.get(cell.siteId);
            const rightSignal = siteSignals.get(right.siteId);
            boundaries.push({
              x1: (column + 1) * cellWidth,
              y1: row * cellHeight,
              x2: (column + 1) * cellWidth,
              y2: (row + 1) * cellHeight,
              unstable:
                Boolean(leftSignal?.projectionSpike || rightSignal?.projectionSpike) ||
                Boolean(leftSignal?.asymmetryUnstable || rightSignal?.asymmetryUnstable),
            });
          }

          if (bottom && bottom.siteId !== cell.siteId) {
            const topSignal = siteSignals.get(cell.siteId);
            const bottomSignal = siteSignals.get(bottom.siteId);
            boundaries.push({
              x1: column * cellWidth,
              y1: (row + 1) * cellHeight,
              x2: (column + 1) * cellWidth,
              y2: (row + 1) * cellHeight,
              unstable:
                Boolean(topSignal?.projectionSpike || bottomSignal?.projectionSpike) ||
                Boolean(topSignal?.asymmetryUnstable || bottomSignal?.asymmetryUnstable),
            });
          }
        }
      }

      const comparisonBoundaries: typeof boundaries =
        labView.compareWithPreviousTick && comparisonSites.length > 1
          ? (() => {
              const comparisonCells = Array.from({ length: columns * rows }, (_, index) => {
                const column = index % columns;
                const row = Math.floor(index / columns);
                const chartPoint = {
                  x:
                    expandedBounds.minX +
                    ((column + 0.5) / columns) * Math.max(0.001, expandedBounds.maxX - expandedBounds.minX),
                  y:
                    expandedBounds.minY +
                    ((row + 0.5) / rows) * Math.max(0.001, expandedBounds.maxY - expandedBounds.minY),
                };

                const nearestSite = comparisonSites.reduce((bestSite, candidate) => {
                  if (!bestSite) {
                    return candidate;
                  }

                  const candidateDistance = bregmanStyleDistance(
                    chartPoint,
                    candidate,
                    labView.selectedGeometryMode,
                    labView.selectedChartKind,
                  );
                  const bestDistance = bregmanStyleDistance(
                    chartPoint,
                    bestSite,
                    labView.selectedGeometryMode,
                    labView.selectedChartKind,
                  );
                  return candidateDistance < bestDistance ? candidate : bestSite;
                }, comparisonSites[0]);

                return { siteId: nearestSite.id };
              });

              const ghostBoundaries: typeof boundaries = [];
              for (let row = 0; row < rows; row += 1) {
                for (let column = 0; column < columns; column += 1) {
                  const index = row * columns + column;
                  const cell = comparisonCells[index];
                  const right = column < columns - 1 ? comparisonCells[index + 1] : undefined;
                  const bottom = row < rows - 1 ? comparisonCells[index + columns] : undefined;

                  if (right && right.siteId !== cell.siteId) {
                    ghostBoundaries.push({
                      x1: (column + 1) * cellWidth,
                      y1: row * cellHeight,
                      x2: (column + 1) * cellWidth,
                      y2: (row + 1) * cellHeight,
                      unstable: false,
                    });
                  }

                  if (bottom && bottom.siteId !== cell.siteId) {
                    ghostBoundaries.push({
                      x1: column * cellWidth,
                      y1: (row + 1) * cellHeight,
                      x2: (column + 1) * cellWidth,
                      y2: (row + 1) * cellHeight,
                      unstable: false,
                    });
                  }
                }
              }

              return ghostBoundaries;
            })()
          : [];

      return (
        <svg className="htt-lab-module-canvas" viewBox="0 0 520 320" role="img" aria-label="Bregman-style Voronoi partition">
          <defs>
            <linearGradient id="ig-voronoi-sheen" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="rgba(255,255,255,0.08)" />
              <stop offset="100%" stopColor="rgba(142,174,212,0.03)" />
            </linearGradient>
          </defs>
          <rect x="0" y="0" width="520" height="320" fill="rgba(5, 7, 9, 0.24)" />
          <rect x="0" y="0" width="520" height="320" className="htt-ig-scene__surface" fill="url(#ig-voronoi-sheen)" />
          {cells.map((cell) => (
            <rect
              key={cell.id}
              x={cell.x}
              y={cell.y}
              width={cellWidth + 0.35}
              height={cellHeight + 0.35}
              fill={cell.color}
              opacity={0.7}
            >
              <title>{`${scalarFieldLabel(labView.selectedScalarField)} ${formatMetric(cell.scalarValue)}`}</title>
            </rect>
          ))}

          {labView.compareWithPreviousTick && labView.showVoronoiBoundaries
            ? comparisonBoundaries.map((boundary, index) => (
                <line
                  key={`voronoi-boundary-ghost-${index}`}
                  className="htt-ig-scene__boundary-ghost"
                  x1={boundary.x1}
                  y1={boundary.y1}
                  x2={boundary.x2}
                  y2={boundary.y2}
                  stroke="rgba(245, 237, 225, 0.14)"
                  strokeWidth="0.9"
                  strokeDasharray="5 5"
                />
              ))
            : null}

          {labView.showVoronoiBoundaries
            ? boundaries.map((boundary, index) => (
                <line
                  key={`voronoi-boundary-${index}`}
                  x1={boundary.x1}
                  y1={boundary.y1}
                  x2={boundary.x2}
                  y2={boundary.y2}
                  stroke={boundary.unstable && labView.showCatastropheMarkers ? instabilityStroke("boundary") : "rgba(16, 18, 22, 0.68)"}
                  strokeWidth={boundary.unstable && labView.showCatastropheMarkers ? 1.9 : 1.05}
                />
              ))
            : null}

          {siteMotionSegments.map((segment) => (
            <path
              key={`site-motion-${segment.id}`}
              className="htt-ig-scene__motion"
              d={smoothLinePath([segment.from, segment.to])}
              fill="none"
              stroke="rgba(245, 237, 225, 0.22)"
              strokeWidth="1.2"
              strokeDasharray="4 4"
            />
          ))}

          {voronoiBarycenterTrailPoints.length > 1 ? (
            <g>
              <path
                className="htt-ig-scene__trail"
                d={smoothLinePath(voronoiBarycenterTrailPoints)}
                fill="none"
                stroke="rgba(255, 196, 120, 0.74)"
                strokeWidth="1.7"
                strokeDasharray="5 4"
              />
              {barycenterTrailRecords.map((record, index) => (
                <circle
                  key={`voronoi-barycenter-trail-${record.tick}`}
                  cx={voronoiBarycenterTrailPoints[index].x}
                  cy={voronoiBarycenterTrailPoints[index].y}
                  r={record.tick === activeBarycenterRecord?.tick ? 4.6 : 3.2}
                  fill="rgba(255, 214, 158, 0.92)"
                  stroke="rgba(119, 66, 18, 0.88)"
                  strokeWidth="1"
                  onMouseEnter={() => setHoveredBarycenterTick(record.tick)}
                  onMouseLeave={() => setHoveredBarycenterTick((current) => (current === record.tick ? undefined : current))}
                  onClick={() => focusBarycenterRecord(record)}
                  style={{ cursor: "pointer" }}
                />
              ))}
            </g>
          ) : null}

          {labView.showVoronoiSites
            ? labView.compareWithPreviousTick
              ? comparisonSites.map((site) => {
                  const point = mapPointToFrame(
                    siteChartPoint(site, labView.selectedGeometryMode, labView.selectedChartKind),
                    expandedBounds,
                    520,
                    320,
                    18,
                  );
                  return (
                    <circle
                      key={`previous-${site.id}`}
                      cx={point.x}
                      cy={point.y}
                      r="11"
                      fill="none"
                      stroke="rgba(245, 237, 225, 0.28)"
                      strokeWidth="1"
                      strokeDasharray="4 4"
                    />
                  );
                })
              : null
            : null}

          {labView.showVoronoiSites
            ? voronoiSites.map((site, index) => {
                const point = mapPointToFrame(
                  siteChartPoint(site, labView.selectedGeometryMode, labView.selectedChartKind),
                  expandedBounds,
                  520,
                  320,
                  18,
                );
                const siteColor = scalarFieldColor(
                  scalarValueForSite(site, labView.selectedScalarField),
                  scalarMin,
                  scalarMax,
                  labView.colorScaleMode,
                );
                const signal = siteSignals.get(site.id);
                return (
                  <g
                    key={site.id}
                    onClick={() => focusIGSite(site)}
                    style={{ cursor: "pointer" }}
                  >
                    <circle cx={point.x} cy={point.y} r="8.5" fill={siteColor} stroke="rgba(12, 16, 18, 0.92)" strokeWidth="1.2" />
                    <circle cx={point.x} cy={point.y} r="2.2" fill="rgba(255, 255, 255, 0.88)" />
                    {activeBarycenterSiteIds.has(site.id) ? (
                      <circle
                        cx={point.x}
                        cy={point.y}
                        r="12.5"
                        fill="none"
                        stroke="rgba(255, 214, 158, 0.84)"
                        strokeWidth="1.4"
                        strokeDasharray="3 3"
                      />
                    ) : null}
                    {labView.showCatastropheMarkers && signal?.highCurvature ? (
                      <circle
                        cx={point.x}
                        cy={point.y}
                        r={11 + signal.instability * 8}
                        fill="none"
                        stroke={instabilityStroke("curvature")}
                        strokeWidth="1.3"
                      />
                    ) : null}
                    {labView.showCatastropheMarkers && signal?.catastropheCandidate ? (
                      <circle
                        cx={point.x}
                        cy={point.y}
                        r={15 + signal.instability * 8}
                        fill="none"
                        stroke={instabilityStroke("catastrophe")}
                        strokeWidth="2"
                        strokeDasharray="5 4"
                      />
                    ) : null}
                    {labView.showCatastropheMarkers && signal?.singularityCandidate ? (
                      <path
                        d={crossMarkerPath(point, 6 + signal.instability * 4)}
                        fill="none"
                        stroke={instabilityStroke("singularity")}
                        strokeWidth="1.9"
                        strokeLinecap="round"
                      />
                    ) : null}
                    <text className="htt-lab-svg-label" x={point.x} y={point.y - 14}>
                      {site.sourceKind === "proposal" ? `p${index + 1}` : `f${index + 1}`}
                    </text>
                    <title>{`${site.label} / ${scalarFieldLabel(labView.selectedScalarField)} ${formatMetric(scalarValueForSite(site, labView.selectedScalarField))}`}</title>
                  </g>
                );
              })
            : null}

          {voronoiBarycenterPoint && activeBarycenterRecord ? (
            <g
              onMouseEnter={() => setHoveredBarycenterTick(activeBarycenterRecord.tick)}
              onMouseLeave={() => setHoveredBarycenterTick((current) => (current === activeBarycenterRecord.tick ? undefined : current))}
              onClick={() => focusBarycenterRecord(activeBarycenterRecord)}
              style={{ cursor: "pointer" }}
            >
              <circle
                cx={voronoiBarycenterPoint.x}
                cy={voronoiBarycenterPoint.y}
                r="12"
                fill="rgba(255, 196, 120, 0.24)"
                stroke="rgba(255, 214, 158, 0.98)"
                strokeWidth="2.2"
              />
              <circle cx={voronoiBarycenterPoint.x} cy={voronoiBarycenterPoint.y} r="4.2" fill="rgba(255, 237, 211, 0.98)" />
              <path
                d={crossMarkerPath(voronoiBarycenterPoint, 6)}
                fill="none"
                stroke="rgba(119, 66, 18, 0.92)"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
              <text className="htt-lab-svg-label" x={voronoiBarycenterPoint.x} y={voronoiBarycenterPoint.y - 16}>
                {`barycenter / ${activeBarycenterRecord.inputs.sites.length}`}
              </text>
              <title>{`${barycenterSourceModeLabel(activeBarycenterRecord.inputs.sourceMode)} / ${barycenterWeightModeLabel(activeBarycenterRecord.inputs.weightMode)} / ${activeBarycenterRecord.result.method}`}</title>
            </g>
          ) : null}

          <text className="htt-lab-svg-title" x="20" y="24">
            {`Bregman-style Voronoi / ${getGeometryModeLabel(labView.selectedGeometryMode)} / ${labView.selectedChartKind} / ${labView.voronoiSiteSource}`}
          </text>
          <text className="htt-lab-svg-label" x="20" y="302">
            {`${columns} x ${rows} grid / ${scalarFieldLabel(labView.selectedScalarField)} / ${labView.colorScaleMode} / ${labView.normalizationMode}${
              labView.compareWithPreviousTick ? ` / compare ${previousAvailableTick}` : ""
            }`}
          </text>
        </svg>
      );
    }

    if (currentTab === "charts") {
      const thetaPoints = dualChartSnapshot.thetaPoints;
      const etaPoints = dualChartSnapshot.etaPoints;
      if (thetaPoints.length === 0 && etaPoints.length === 0) {
        return <p className="htt-empty">No dual-chart sites are available for the active neighborhood.</p>;
      }

      const scalarValues = [...thetaPoints, ...etaPoints].map((point) => chartPointMetric(point, labView.selectedScalarField));
      const comparisonScalarValues = [
        ...comparisonDualChartSnapshot.thetaPoints,
        ...comparisonDualChartSnapshot.etaPoints,
      ].map((point) => chartPointMetric(point, labView.selectedScalarField));
      const { minValue: scalarMin, maxValue: scalarMax } = resolveScalarBounds(
        scalarValues,
        labView.normalizationMode,
        labView.compareWithPreviousTick ? comparisonScalarValues : [],
      );
      const thetaBounds = pointBounds(thetaPoints.map((point) => point.point));
      const etaBounds = pointBounds(etaPoints.map((point) => point.point));
      const activeThetaPoint = thetaPoints.find((point) => pointSignature(point) === activePointSignature);
      const activeEtaPoint = etaPoints.find((point) => pointSignature(point) === activePointSignature);
      const chartSeparation =
        activeThetaPoint && activeEtaPoint
          ? Math.sqrt(pointDistanceSquared(activeThetaPoint.point, activeEtaPoint.point))
          : undefined;

      const renderChartPanel = (
        title: string,
        chartKind: InformationGeometryLabChartKind,
        points: typeof thetaPoints,
        bounds: ReturnType<typeof pointBounds>,
      ) => {
        const activePoint = chartKind === "theta" ? activeThetaPoint : activeEtaPoint;
        const comparisonPoints =
          chartKind === "theta"
            ? comparisonDualChartSnapshot.thetaPoints
            : comparisonDualChartSnapshot.etaPoints;
        const pointSignals = new Map(
          points.map((point) => [
            point.id,
            geometryInstabilitySignal({
              curvature: point.curvature,
              asymmetry: point.asymmetry,
              projection: point.projection,
              promiseConstructive: point.promiseConstructive,
              promiseObstructive: point.promiseObstructive,
              catastrophe: selectedFragment.catastrophe,
            }),
          ]),
        );
        const geodesicSegments =
          labView.showGeodesics && labView.selectedChartKind === chartKind && activePoint
            ? points
                .filter((point) => point.id !== activePoint.id)
                .map((point) => ({
                  from: mapPointToFrame(activePoint.point, bounds, 520, 320, 20),
                  to: mapPointToFrame(point.point, bounds, 520, 320, 20),
                }))
            : [];
        const motionSegments =
          labView.compareWithPreviousTick && labView.showVoronoiSites
            ? buildMotionSegments(
                points,
                comparisonPoints,
                (point) => mapPointToFrame(point.point, bounds, 520, 320, 20),
              )
            : [];
        const chartBarycenterTrailPoints =
          labView.showBarycenterTrail && barycenterTrailRecords.length > 1
            ? barycenterTrailRecords.map((record) =>
                mapPointToFrame(
                  barycenterChartPoint(labView.selectedGeometryMode, chartKind, record.result.point),
                  bounds,
                  520,
                  320,
                  20,
                ),
              )
            : [];
        const chartBarycenterPoint =
          labView.showBarycenter && activeBarycenterRecord
            ? mapPointToFrame(
                barycenterChartPoint(labView.selectedGeometryMode, chartKind, activeBarycenterRecord.result.point),
                bounds,
                520,
                320,
                20,
              )
            : undefined;
        const chartFlowTrailPoints =
          labView.showFlowTrails && selectedFlowTrailRecords.length > 1
            ? selectedFlowTrailRecords.map((record) =>
                mapPointToFrame(
                  barycenterChartPoint(labView.selectedGeometryMode, chartKind, record.point),
                  bounds,
                  520,
                  320,
                  20,
                ),
              )
            : [];
        const chartFlowVectors =
          labView.showFlowVectors
            ? points
                .filter((_, index) => index % Math.max(1, 5 - labView.flowVectorDensity) === 0)
                .map((point) => {
                  const flowPoint: GeometryFlowPoint = {
                    theta: [...point.coordinates],
                    eta: [...point.coordinates],
                    divergence: point.divergence,
                    projection: point.projection,
                    constructivePromise: point.promiseConstructive,
                    obstructivePromise: point.promiseObstructive,
                    curvature: point.curvature,
                  };
                  const result = flowDirectionResultForMode(
                    labView.selectedFlowMode,
                    {
                      theta: [...point.coordinates],
                      eta: [...point.coordinates],
                      divergence: point.divergence,
                      projection: point.projection,
                      constructivePromise: point.promiseConstructive,
                      obstructivePromise: point.promiseObstructive,
                      curvature: point.curvature,
                    },
                    activeFlowNeighborhood,
                    labView.selectedGeometryMode,
                  );
                  const from = mapPointToFrame(point.point, bounds, 520, 320, 20);
                  const to = mapPointToFrame(
                    flowArrowEndpoint(flowPoint, result, labView.selectedGeometryMode, chartKind, labView.flowVectorScale),
                    bounds,
                    520,
                    320,
                    20,
                  );
                  return {
                    point,
                    result,
                    paths: arrowPath(from, to, 5),
                  };
                })
            : [];
        const chartTrajectoryActualPoints =
          trajectoryDiagnostics && trajectoryDiagnostics.samples.length > 1
            ? trajectoryDiagnostics.samples.map((sample) =>
                mapPointToFrame(
                  barycenterChartPoint(labView.selectedGeometryMode, chartKind, sample.point),
                  bounds,
                  520,
                  320,
                  20,
                ),
              )
            : [];
        const chartTrajectoryFittedPoints =
          trajectoryDiagnostics && trajectoryDiagnostics.fit.fittedSamples.length > 1
            ? trajectoryDiagnostics.fit.fittedSamples.map((sample) =>
                mapPointToFrame(
                  barycenterChartPoint(labView.selectedGeometryMode, chartKind, sample.point),
                  bounds,
                  520,
                  320,
                  20,
                ),
              )
            : [];
        const chartTrajectoryResidualSegments =
          trajectoryDiagnostics && labView.showResidualMarkers
            ? trajectoryDiagnostics.residuals.map((residual) => ({
                actual: mapPointToFrame(
                  barycenterChartPoint(labView.selectedGeometryMode, chartKind, residual.actualPoint),
                  bounds,
                  520,
                  320,
                  20,
                ),
                fitted: mapPointToFrame(
                  barycenterChartPoint(labView.selectedGeometryMode, chartKind, residual.fittedPoint),
                  bounds,
                  520,
                  320,
                  20,
                ),
                residual,
              }))
            : [];
        const chartTrajectoryVelocityPaths =
          trajectoryDiagnostics && labView.regressionDisplayMode === "velocity"
            ? trajectoryVelocityPaths(chartTrajectoryFittedPoints, 4.5)
            : [];
        const chartTrajectoryStatus = trajectoryStatusLabel(trajectoryDiagnostics?.indicators);

        return (
          <svg className="htt-lab-module-canvas" viewBox="0 0 520 320" role="img" aria-label={`${title} chart`}>
            <rect x="0" y="0" width="520" height="320" fill="rgba(5, 7, 9, 0.24)" />
            <path
              className="htt-ig-scene__surface"
              d="M 26 42 L 494 42 L 494 278 L 26 278 Z"
              fill="none"
              stroke="rgba(245, 237, 225, 0.08)"
              strokeWidth="0.9"
            />
            {geodesicSegments.map((segment, index) => (
              <line
                key={`${chartKind}-geodesic-${index}`}
                x1={segment.from.x}
                y1={segment.from.y}
                x2={segment.to.x}
                y2={segment.to.y}
                stroke="rgba(245, 237, 225, 0.24)"
                strokeWidth="1.2"
                strokeDasharray="4 4"
              />
            ))}
            {motionSegments.map((segment) => (
              <path
                key={`${chartKind}-motion-${segment.id}`}
                className="htt-ig-scene__motion"
                d={smoothLinePath([segment.from, segment.to])}
                fill="none"
                stroke="rgba(238, 213, 155, 0.2)"
                strokeWidth="1.1"
                strokeDasharray="4 4"
              />
            ))}
            {chartBarycenterTrailPoints.length > 1 ? (
              <g>
                <path
                  className="htt-ig-scene__trail"
                  d={smoothLinePath(chartBarycenterTrailPoints)}
                  fill="none"
                  stroke="rgba(255, 196, 120, 0.74)"
                  strokeWidth="1.7"
                  strokeDasharray="5 4"
                />
                {barycenterTrailRecords.map((record, index) => (
                  <circle
                    key={`${chartKind}-barycenter-trail-${record.tick}`}
                    cx={chartBarycenterTrailPoints[index].x}
                    cy={chartBarycenterTrailPoints[index].y}
                    r={record.tick === activeBarycenterRecord?.tick ? 4.6 : 3.2}
                    fill="rgba(255, 214, 158, 0.92)"
                    stroke="rgba(119, 66, 18, 0.88)"
                    strokeWidth="1"
                    onMouseEnter={() => setHoveredBarycenterTick(record.tick)}
                    onMouseLeave={() => setHoveredBarycenterTick((current) => (current === record.tick ? undefined : current))}
                    onClick={() => focusBarycenterRecord(record)}
                    style={{ cursor: "pointer" }}
                  />
                ))}
              </g>
            ) : null}
            {chartFlowTrailPoints.length > 1 ? (
              <path
                className="htt-ig-scene__motion"
                d={smoothLinePath(chartFlowTrailPoints)}
                fill="none"
                stroke="rgba(142, 214, 220, 0.66)"
                strokeWidth="1.45"
                strokeDasharray="6 4"
                style={flowAnimationStyle}
              />
            ) : null}
            {chartFlowVectors.map((entry) => (
              <g
                key={`${chartKind}-flow-${entry.point.id}`}
                opacity={labView.animateFlowOverTicks ? 0.64 : 0.8}
                style={flowAnimationStyle}
              >
                <path
                  d={entry.paths.shaft}
                  fill="none"
                  stroke="rgba(142, 214, 220, 0.78)"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
                <path
                  d={entry.paths.head}
                  fill="none"
                  stroke="rgba(142, 214, 220, 0.78)"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <title>{`${flowModeLabel(labView.selectedFlowMode)} / ${entry.result.method}`}</title>
              </g>
            ))}
            {trajectoryDiagnostics && chartTrajectoryFittedPoints.length > 1 ? (
              <g>
                <path
                  className="htt-ig-scene__trace"
                  d={smoothLinePath(chartTrajectoryFittedPoints)}
                  fill="none"
                  stroke="rgba(208, 190, 244, 0.9)"
                  strokeWidth={labView.regressionDisplayMode === "fittedCurve" ? 2.4 : 2}
                  strokeDasharray={labView.regressionDisplayMode === "convergence" ? "7 4" : undefined}
                />
                {labView.regressionDisplayMode === "velocity"
                  ? chartTrajectoryVelocityPaths.map((path, index) => (
                      <g key={`${chartKind}-trajectory-velocity-${index}`}>
                        <path d={path.shaft} fill="none" stroke="rgba(208, 190, 244, 0.76)" strokeWidth="1.2" />
                        <path d={path.head} fill="none" stroke="rgba(208, 190, 244, 0.76)" strokeWidth="1.2" />
                      </g>
                    ))
                  : null}
              </g>
            ) : null}
            {chartTrajectoryActualPoints.length > 0
              ? chartTrajectoryActualPoints.map((point, index) => (
                  <circle
                    key={`${chartKind}-trajectory-sample-${index}`}
                    cx={point.x}
                    cy={point.y}
                    r={index === chartTrajectoryActualPoints.length - 1 ? 4.6 : 3.2}
                    fill="rgba(245, 237, 225, 0.92)"
                    stroke="rgba(91, 72, 124, 0.78)"
                    strokeWidth="1"
                    onClick={() => {
                      const sample = trajectoryDiagnostics?.samples[index];
                      if (sample) {
                        focusTrajectorySample(sample);
                      }
                    }}
                    style={{ cursor: trajectoryDiagnostics?.samples[index] ? "pointer" : "default" }}
                  />
                ))
              : null}
            {chartTrajectoryResidualSegments.map((segment, index) => (
              <g key={`${chartKind}-trajectory-residual-${index}`}>
                <path
                  d={linePath([segment.actual, segment.fitted])}
                  fill="none"
                  stroke="rgba(228, 150, 138, 0.62)"
                  strokeWidth="1.15"
                  strokeDasharray="4 3"
                />
                <circle
                  cx={segment.fitted.x}
                  cy={segment.fitted.y}
                  r={2.1 + Math.min(4.8, segment.residual.combinedResidual * 6)}
                  fill="rgba(228, 150, 138, 0.2)"
                  stroke="rgba(228, 150, 138, 0.66)"
                  strokeWidth="0.9"
                />
              </g>
            ))}
            {labView.showVoronoiSites && labView.compareWithPreviousTick
              ? comparisonPoints.map((point) => {
                  const mapped = mapPointToFrame(point.point, bounds, 520, 320, 20);
                  return (
                    <circle
                      key={`compare-${point.id}`}
                      cx={mapped.x}
                      cy={mapped.y}
                      r="10.5"
                      fill="none"
                      stroke="rgba(245, 237, 225, 0.22)"
                      strokeWidth="1"
                      strokeDasharray="4 4"
                    />
                  );
                })
              : null}
            {labView.showVoronoiSites
              ? points.map((point, index) => {
              const mapped = mapPointToFrame(point.point, bounds, 520, 320, 20);
              const value = chartPointMetric(point, labView.selectedScalarField);
              const color = scalarFieldColor(value, scalarMin, scalarMax, labView.colorScaleMode);
              const isActive = pointSignature(point) === activePointSignature;
              const signal = pointSignals.get(point.id);
              return (
                <g
                  key={point.id}
                  onClick={() => {
                    focusIGSite(point);
                    updateInformationGeometryLabState({
                      selectedChartKind: chartKind,
                    });
                  }}
                  style={{ cursor: "pointer" }}
                  >
                    <circle
                      cx={mapped.x}
                      cy={mapped.y}
                      r={isActive ? 9 : 7}
                      fill={color}
                      stroke={isActive ? "rgba(255, 255, 255, 0.96)" : "rgba(16, 18, 22, 0.88)"}
                      strokeWidth={isActive ? 2 : 1.2}
                    />
                    {activeBarycenterSiteIds.has(point.id) ? (
                      <circle
                        cx={mapped.x}
                        cy={mapped.y}
                        r="11.5"
                        fill="none"
                        stroke="rgba(255, 214, 158, 0.84)"
                        strokeWidth="1.35"
                        strokeDasharray="3 3"
                      />
                    ) : null}
                    {labView.showCatastropheMarkers && signal?.highCurvature ? (
                      <circle
                        cx={mapped.x}
                        cy={mapped.y}
                        r={12 + signal.instability * 8}
                        fill="none"
                        stroke={instabilityStroke("curvature")}
                        strokeWidth="1.3"
                      />
                    ) : null}
                    {labView.showCatastropheMarkers && signal?.catastropheCandidate ? (
                      <circle
                        cx={mapped.x}
                        cy={mapped.y}
                        r={15 + signal.instability * 8}
                        fill="none"
                        stroke={instabilityStroke("catastrophe")}
                        strokeWidth="2"
                        strokeDasharray="5 4"
                      />
                    ) : null}
                    {labView.showCatastropheMarkers && signal?.singularityCandidate ? (
                      <path
                        d={crossMarkerPath(mapped, 6 + signal.instability * 4)}
                        fill="none"
                        stroke={instabilityStroke("singularity")}
                        strokeWidth="1.9"
                        strokeLinecap="round"
                      />
                    ) : null}
                    <text className="htt-lab-svg-label" x={mapped.x} y={mapped.y - 14}>
                      {point.sourceKind === "proposal" ? `p${index + 1}` : `f${index + 1}`}
                    </text>
                  <title>{`${title} / ${scalarFieldLabel(labView.selectedScalarField)} ${formatMetric(value)} / ${point.phase ?? "latent"}`}</title>
                </g>
              );
            })
              : null}
            {chartBarycenterPoint && activeBarycenterRecord ? (
              <g
                onMouseEnter={() => setHoveredBarycenterTick(activeBarycenterRecord.tick)}
                onMouseLeave={() => setHoveredBarycenterTick((current) => (current === activeBarycenterRecord.tick ? undefined : current))}
                onClick={() => focusBarycenterRecord(activeBarycenterRecord)}
                style={{ cursor: "pointer" }}
              >
                <circle
                  cx={chartBarycenterPoint.x}
                  cy={chartBarycenterPoint.y}
                  r="11.5"
                  fill="rgba(255, 196, 120, 0.24)"
                  stroke="rgba(255, 214, 158, 0.98)"
                  strokeWidth="2.1"
                />
                <circle cx={chartBarycenterPoint.x} cy={chartBarycenterPoint.y} r="4.1" fill="rgba(255, 237, 211, 0.98)" />
                <path
                  d={crossMarkerPath(chartBarycenterPoint, 6)}
                  fill="none"
                  stroke="rgba(119, 66, 18, 0.92)"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                />
                <title>{`${title} barycenter / ${barycenterSourceModeLabel(activeBarycenterRecord.inputs.sourceMode)} / tick ${activeBarycenterRecord.tick}`}</title>
              </g>
            ) : null}
            <text className="htt-lab-svg-title" x="20" y="24">{`${title} / ${getGeometryModeLabel(labView.selectedGeometryMode)} / ${labView.selectedScalarField}`}</text>
            {trajectoryDiagnostics ? (
              <text className="htt-lab-svg-label" x="500" y="24" textAnchor="end">
                {`trajectory / ${chartTrajectoryStatus}`}
              </text>
            ) : null}
            <text className="htt-lab-svg-label" x="20" y="302">
              {labView.selectedChartKind === chartKind && labView.showGeodesics
                ? "straight-line geodesics shown from selected site"
                : `selection is shared / ${labView.colorScaleMode} / ${labView.normalizationMode}${
                    labView.compareWithPreviousTick ? ` / compare ${previousAvailableTick}` : ""
                  }`}
            </text>
          </svg>
        );
      };

      return (
        <div className="htt-lab-module-chart-grid">
          {renderChartPanel("theta chart", "theta", thetaPoints, thetaBounds)}
          {renderChartPanel("eta chart", "eta", etaPoints, etaBounds)}
          <div className="htt-lab-module-chart-note">
            <p className="htt-lab-module-chart-note__title">Dual chart comparison</p>
            <p className="htt-lab-module-chart-note__body">
              {selectedFragment
                ? `Active fragment ${fragmentTitle(selectedFragment)} is rendered in both coordinate systems.`
                : "Select a fragment to compare the local neighborhood in dual coordinates."}
            </p>
            <p className="htt-lab-module-chart-note__body">
              {chartSeparation != null
                ? `Selected-site theta/eta chart separation: ${chartSeparation.toFixed(3)}`
                : "Click a site in either chart to inspect the same site in both coordinates."}
            </p>
          </div>
        </div>
      );
    }

    if (currentTab === "potential") {
      if (labView.selectedIGViewMode !== "liftedSurface") {
        return (
          <div className="htt-empty">
            {`${labView.selectedIGViewMode} is not implemented here yet. Switch the IG mode to liftedSurface to inspect the convex-potential lift.`}
          </div>
        );
      }

      if (liftedPoints.length === 0) {
        return <p className="htt-empty">No lifted sites are available for the active neighborhood.</p>;
      }

      const baseBounds = pointBounds(liftedPoints.map((point) => point.basePoint));
      const scalarValues = liftedPoints.map((point) => liftedPointMetric(point, labView.selectedScalarField));
      const comparisonScalarValues = comparisonLiftedPoints.map((point) =>
        liftedPointMetric(point, labView.selectedScalarField),
      );
      const { minValue: scalarMin, maxValue: scalarMax } = resolveScalarBounds(
        scalarValues,
        labView.normalizationMode,
        labView.compareWithPreviousTick ? comparisonScalarValues : [],
      );
      const heightValues = liftedPoints.map((point) =>
        labView.showLiftedSurface ? point.height * labView.liftedHeightScale : liftedPointMetric(point, labView.selectedScalarField),
      );
      const maxHeight = Math.max(0.001, ...heightValues);
      const projectedPoints = liftedPoints.map((point) => {
        const liftedHeight =
          (labView.showLiftedSurface
            ? point.height * labView.liftedHeightScale
            : liftedPointMetric(point, labView.selectedScalarField) * labView.liftedHeightScale) /
          maxHeight;
        return {
          point,
          base: mapPointToFrame(point.basePoint, baseBounds, 520, 320, 28),
          lifted: projectLiftedPoint(
            point.basePoint,
            liftedHeight,
            baseBounds,
            520,
            320,
            labView.liftedProjectionAngle,
            28,
          ),
          liftedHeight,
        };
      });
      const comparisonProjectedPoints = comparisonLiftedPoints.map((point) => {
        const liftedHeight =
          (labView.showLiftedSurface
            ? point.height * labView.liftedHeightScale
            : liftedPointMetric(point, labView.selectedScalarField) * labView.liftedHeightScale) /
          maxHeight;
        return {
          point,
          base: mapPointToFrame(point.basePoint, baseBounds, 520, 320, 28),
          lifted: projectLiftedPoint(
            point.basePoint,
            liftedHeight,
            baseBounds,
            520,
            320,
            labView.liftedProjectionAngle,
            28,
          ),
          liftedHeight,
        };
      });
      const orderedProjectedPoints = [...projectedPoints].sort(
        (left, right) => left.base.y + right.liftedHeight - (right.base.y + left.liftedHeight),
      );
      const liftedMotionSegments =
        labView.compareWithPreviousTick && labView.showVoronoiSites
          ? buildMotionSegments(
              projectedPoints.map((entry) => entry.point),
              comparisonProjectedPoints.map((entry) => entry.point),
              (point) => {
                const currentProjection = projectedPoints.find((entry) => entry.point.id === point.id);
                if (currentProjection) {
                  return currentProjection.lifted;
                }
                const previousProjection = comparisonProjectedPoints.find((entry) => entry.point.id === point.id);
                return previousProjection?.lifted ?? { x: 0, y: 0 };
              },
            )
          : [];

      return (
        <svg className="htt-lab-module-canvas" viewBox="0 0 520 320" role="img" aria-label="Lifted convex-potential surface">
          <rect x="0" y="0" width="520" height="320" fill="rgba(5, 7, 9, 0.24)" />

          {labView.showLiftedFootprint ? (
            <>
              {projectedPoints.map(({ point, base }) => (
                <circle
                  key={`${point.id}-footprint`}
                  cx={base.x}
                  cy={base.y}
                  r="5.5"
                  fill={scalarFieldColor(
                    liftedPointMetric(point, labView.selectedScalarField),
                    scalarMin,
                    scalarMax,
                    labView.colorScaleMode,
                  )}
                  opacity="0.28"
                />
              ))}
              {projectedPoints.map(({ base }, index) => {
                const next = projectedPoints[(index + 1) % projectedPoints.length];
                return (
                  <line
                    key={`footprint-line-${index}`}
                    x1={base.x}
                    y1={base.y}
                    x2={next.base.x}
                    y2={next.base.y}
                    stroke="rgba(245, 237, 225, 0.12)"
                    strokeWidth="1"
                  />
                );
              })}
            </>
          ) : null}

          {labView.compareWithPreviousTick && comparisonProjectedPoints.length >= 3 ? (
            <path
              d={polygonPath(comparisonProjectedPoints.map(({ lifted }) => lifted))}
              className="htt-ig-scene__boundary-ghost"
              fill="rgba(245, 237, 225, 0.018)"
              stroke="rgba(245, 237, 225, 0.14)"
              strokeWidth="0.9"
              strokeDasharray="5 4"
            />
          ) : null}

          {labView.showVoronoiSites
            ? orderedProjectedPoints.map(({ point, base, lifted, liftedHeight }) => {
                const scalarValue = liftedPointMetric(point, labView.selectedScalarField);
                const color = scalarFieldColor(scalarValue, scalarMin, scalarMax, labView.colorScaleMode);
                const isActive = pointSignature(point) === activePointSignature;
                const signal = geometryInstabilitySignal({
                  curvature: point.curvature,
                  asymmetry: point.asymmetry,
                  projection: point.projection,
                  promiseConstructive: point.promiseConstructive,
                  promiseObstructive: point.promiseObstructive,
                  catastrophe: selectedFragment.catastrophe,
                });
                return (
                  <g
                    key={point.id}
                    onClick={() => focusIGSite(point)}
                    style={{ cursor: "pointer" }}
                  >
                    {labView.showLiftedStems ? (
                      <line
                        x1={base.x}
                        y1={base.y}
                        x2={lifted.x}
                        y2={lifted.y}
                        stroke="rgba(245, 237, 225, 0.22)"
                        strokeWidth={isActive ? 1.8 : 1.1}
                      />
                    ) : null}
                    <ellipse
                      cx={lifted.x}
                      cy={lifted.y}
                      rx={10 + liftedHeight * 4}
                      ry={6 + liftedHeight * 2}
                      fill={color}
                      stroke={isActive ? "rgba(255, 255, 255, 0.96)" : "rgba(16, 18, 22, 0.88)"}
                      strokeWidth={isActive ? 2 : 1.2}
                    />
                    {labView.showCatastropheMarkers && signal.highCurvature ? (
                      <ellipse
                        cx={lifted.x}
                        cy={lifted.y}
                        rx={14 + liftedHeight * 4}
                        ry={8 + liftedHeight * 2.4}
                        fill="none"
                        stroke={instabilityStroke("curvature")}
                        strokeWidth="1.25"
                      />
                    ) : null}
                    {labView.showCatastropheMarkers && signal.catastropheCandidate ? (
                      <ellipse
                        cx={lifted.x}
                        cy={lifted.y}
                        rx={16 + liftedHeight * 4}
                        ry={10 + liftedHeight * 2.6}
                        fill="none"
                        stroke={instabilityStroke("catastrophe")}
                        strokeWidth="2"
                        strokeDasharray="5 4"
                      />
                    ) : null}
                    {labView.showCatastropheMarkers && signal.singularityCandidate ? (
                      <path
                        d={crossMarkerPath(lifted, 6 + signal.instability * 4)}
                        fill="none"
                        stroke={instabilityStroke("singularity")}
                        strokeWidth="1.9"
                        strokeLinecap="round"
                      />
                    ) : null}
                    <title>{`${point.sourceKind} / scalar ${formatMetric(scalarValue)} / lifted height ${formatMetric(point.height)}`}</title>
                  </g>
                );
              })
            : null}

          {projectedPoints.length >= 3 ? (
            <path
              d={polygonPath(projectedPoints.map(({ lifted }) => lifted))}
              className="htt-ig-scene__surface-shell"
              fill="rgba(245, 237, 225, 0.035)"
              stroke="rgba(245, 237, 225, 0.16)"
              strokeWidth="1"
            />
          ) : null}

          {orderedProjectedPoints.length >= 3
            ? Array.from({ length: liftedSurfaceContourCount }, (_, index) => index).map((index) => (
                <path
                  key={`surface-contour-${index}`}
                  className="htt-ig-scene__contour"
                  d={smoothLinePath(
                    orderedProjectedPoints.map(({ lifted }) => ({
                      x: lifted.x,
                      y: lifted.y + 6 + index * 7,
                    })),
                  )}
                  fill="none"
                  stroke="rgba(245, 237, 225, 0.14)"
                  strokeWidth="0.85"
                  opacity={0.18 + index * 0.08}
                />
              ))
            : null}

          {liftedMotionSegments.map((segment) => (
            <path
              key={`lifted-motion-${segment.id}`}
              className="htt-ig-scene__motion"
              d={smoothLinePath([segment.from, segment.to])}
              fill="none"
              stroke="rgba(245, 237, 225, 0.18)"
              strokeWidth="1.05"
              strokeDasharray="4 4"
            />
          ))}

          <text className="htt-lab-svg-title" x="20" y="24">
            {`lifted surface / ${getGeometryModeLabel(labView.selectedGeometryMode)} / ${scalarFieldLabel(labView.selectedScalarField)} / angle ${labView.liftedProjectionAngle.toFixed(0)} deg`}
          </text>
          <text className="htt-lab-svg-label" x="20" y="302">
            {`${labView.showLiftedSurface ? "convex potential height" : "scalar height"} / scale ${labView.liftedHeightScale.toFixed(2)} / quality ${runtimeConfig.liftedSurfaceQuality} / ${labView.selectedChartKind} footprint / ${labView.colorScaleMode}${
              labView.compareWithPreviousTick ? ` / compare ${previousAvailableTick}` : ""
            }`}
          </text>
        </svg>
      );
    }

    if (labView.selectedIGViewMode !== "accumulation") {
      return (
        <div className="htt-empty">
          {`${labView.selectedIGViewMode} is not implemented here yet. Switch the IG mode to accumulation to inspect the run's geometric archaeology.`}
        </div>
      );
    }

    if (!selectedFragment) {
      return <p className="htt-empty">Select a fragment to accumulate its local geometry over time.</p>;
    }

    const trailTicks = availableTicks
      .filter((tick) => tick <= accumulationTick)
      .slice(-effectiveAccumulationTrailLength);
    const persistedFrames = persistedAccumulationSnapshots.map((snapshot) => ({
      tick: snapshot.tick,
      sites: snapshot.sitePositions,
    }));
    const inMemoryFrames = trailTicks.map((tick) => ({
      tick,
      sites: getVoronoiSites(
        {
          simulation,
          view: {
            ...view,
            informationGeometryLab: {
              ...view.informationGeometryLab,
              selectedTick: tick,
            },
          },
        },
        tick,
        selectedFragment.id,
      ),
    }));
    const accumulationFrames = Array.from(
      [...persistedFrames, ...inMemoryFrames].reduce((map, frame) => {
        if (frame.sites.length > 0 || !map.has(frame.tick)) {
          map.set(frame.tick, frame);
        }
        return map;
      }, new Map<number, { tick: number; sites: IGSite[] }>()),
    ).map(([, frame]) => frame);
    const nonEmptyFrames = accumulationFrames.filter((frame) => frame.sites.length > 0);
    if (nonEmptyFrames.length === 0) {
      return <p className="htt-empty">No accumulated sites are available for the selected fragment.</p>;
    }

    const allFrameSites = nonEmptyFrames.flatMap((frame) => frame.sites);
    const chartBounds = pointBounds(
      allFrameSites.map((site) => siteChartPoint(site, labView.selectedGeometryMode, labView.selectedChartKind)),
    );
    const spanX = Math.max(0.12, chartBounds.maxX - chartBounds.minX);
    const spanY = Math.max(0.12, chartBounds.maxY - chartBounds.minY);
    const expandedBounds = {
      minX: chartBounds.minX - spanX * 0.18,
      maxX: chartBounds.maxX + spanX * 0.18,
      minY: chartBounds.minY - spanY * 0.18,
      maxY: chartBounds.maxY + spanY * 0.18,
    };
    const scalarValues = allFrameSites.map((site) => scalarValueForSite(site, labView.selectedScalarField));
    const comparisonScalarValues = comparisonSites.map((site) =>
      scalarValueForSite(site, labView.selectedScalarField),
    );
    const { minValue: scalarMin, maxValue: scalarMax } = resolveScalarBounds(
      scalarValues,
      labView.normalizationMode,
      labView.compareWithPreviousTick ? comparisonScalarValues : [],
    );
    const columns = Math.max(8, Math.min(26, Math.round(labView.voronoiGridResolution)));
    const rows = Math.max(6, Math.round(columns * (320 / 520)));
    const cellWidth = 520 / columns;
    const cellHeight = 320 / rows;

    const renderFieldFrame = (sites: typeof allFrameSites, opacity: number, suffix: string) => {
      if (sites.length === 0) {
        return null;
      }

      const siteSignals = new Map(
        sites.map((site) => [
          site.id,
          geometryInstabilitySignal({
            curvature: site.curvature,
            asymmetry: site.asymmetry,
            projection: site.projection,
            promiseConstructive: site.promiseConstructive,
            promiseObstructive: site.promiseObstructive,
            catastrophe: selectedFragment.catastrophe,
          }),
        ]),
      );

      const cells = Array.from({ length: columns * rows }, (_, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        const chartPoint = {
          x:
            expandedBounds.minX +
            ((column + 0.5) / columns) * Math.max(0.001, expandedBounds.maxX - expandedBounds.minX),
          y:
            expandedBounds.minY +
            ((row + 0.5) / rows) * Math.max(0.001, expandedBounds.maxY - expandedBounds.minY),
        };
        const nearestSite = sites.reduce((bestSite, candidate) => {
          if (!bestSite) {
            return candidate;
          }
          const candidateDistance = bregmanStyleDistance(
            chartPoint,
            candidate,
            labView.selectedGeometryMode,
            labView.selectedChartKind,
          );
          const bestDistance = bregmanStyleDistance(
            chartPoint,
            bestSite,
            labView.selectedGeometryMode,
            labView.selectedChartKind,
          );
          return candidateDistance < bestDistance ? candidate : bestSite;
        }, sites[0]);
        return {
          id: `${suffix}-${column}-${row}`,
          siteId: nearestSite.id,
          x: column * cellWidth,
          y: row * cellHeight,
          color: scalarFieldColor(
            scalarValueForSite(nearestSite, labView.selectedScalarField),
            scalarMin,
            scalarMax,
            labView.colorScaleMode,
          ),
        };
      });

      const boundaries: Array<{ x1: number; y1: number; x2: number; y2: number; unstable: boolean }> = [];
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const index = row * columns + column;
          const cell = cells[index];
          const right = column < columns - 1 ? cells[index + 1] : undefined;
          const bottom = row < rows - 1 ? cells[index + columns] : undefined;
          if (right && right.siteId !== cell.siteId) {
            const leftSignal = siteSignals.get(cell.siteId);
            const rightSignal = siteSignals.get(right.siteId);
            boundaries.push({
              x1: (column + 1) * cellWidth,
              y1: row * cellHeight,
              x2: (column + 1) * cellWidth,
              y2: (row + 1) * cellHeight,
              unstable:
                Boolean(leftSignal?.projectionSpike || rightSignal?.projectionSpike) ||
                Boolean(leftSignal?.asymmetryUnstable || rightSignal?.asymmetryUnstable),
            });
          }
          if (bottom && bottom.siteId !== cell.siteId) {
            const topSignal = siteSignals.get(cell.siteId);
            const bottomSignal = siteSignals.get(bottom.siteId);
            boundaries.push({
              x1: column * cellWidth,
              y1: (row + 1) * cellHeight,
              x2: (column + 1) * cellWidth,
              y2: (row + 1) * cellHeight,
              unstable:
                Boolean(topSignal?.projectionSpike || bottomSignal?.projectionSpike) ||
                Boolean(topSignal?.asymmetryUnstable || bottomSignal?.asymmetryUnstable),
            });
          }
        }
      }

      return (
        <g key={`field-${suffix}`} opacity={opacity}>
          {cells.map((cell) => (
            <rect
              key={cell.id}
              x={cell.x}
              y={cell.y}
              width={cellWidth + 0.35}
              height={cellHeight + 0.35}
              fill={cell.color}
            />
          ))}
          {labView.showVoronoiBoundaries
            ? boundaries.map((boundary, index) => (
                <line
                  key={`${suffix}-boundary-${index}`}
                  x1={boundary.x1}
                  y1={boundary.y1}
                  x2={boundary.x2}
                  y2={boundary.y2}
                  stroke={boundary.unstable && labView.showCatastropheMarkers ? instabilityStroke("boundary") : "rgba(16, 18, 22, 0.46)"}
                  strokeWidth={boundary.unstable && labView.showCatastropheMarkers ? 1.5 : 0.9}
                />
              ))
            : null}
        </g>
      );
    };

    const siteTrails = new Map<string, Array<{ tick: number; point: Point2D; site: (typeof allFrameSites)[number] }>>();
    for (const frame of nonEmptyFrames) {
      for (const site of frame.sites) {
        const signature = pointSignature(site);
        const series = siteTrails.get(signature) ?? [];
        series.push({
          tick: frame.tick,
          point: mapPointToFrame(
            siteChartPoint(site, labView.selectedGeometryMode, labView.selectedChartKind),
            expandedBounds,
            520,
            320,
            18,
          ),
          site,
        });
        siteTrails.set(signature, series);
      }
    }
    const accumulationBarycenterTrailPoints =
      labView.showBarycenterTrail && barycenterTrailRecords.length > 1
        ? barycenterTrailRecords.map((record) =>
            mapPointToFrame(
              barycenterChartPoint(
                labView.selectedGeometryMode,
                labView.selectedChartKind,
                record.result.point,
              ),
              expandedBounds,
              520,
              320,
              18,
            ),
          )
        : [];
    const accumulationBarycenterPoint =
      labView.showBarycenter && activeBarycenterRecord
        ? mapPointToFrame(
            barycenterChartPoint(
              labView.selectedGeometryMode,
              labView.selectedChartKind,
              activeBarycenterRecord.result.point,
            ),
            expandedBounds,
            520,
            320,
            18,
          )
        : undefined;
    const accumulationFlowTrailPoints =
      labView.showFlowTrails && selectedFlowTrailRecords.length > 1
        ? selectedFlowTrailRecords.map((record) =>
            mapPointToFrame(
              barycenterChartPoint(
                labView.selectedGeometryMode,
                labView.selectedChartKind,
                record.point,
              ),
              expandedBounds,
              520,
              320,
              18,
            ),
          )
        : [];
    const accumulationFlowVectors =
      labView.showFlowVectors
        ? accumulationSites
            .filter((_, index) => index % Math.max(1, 5 - labView.flowVectorDensity) === 0)
            .map((site) => {
              const point: GeometryFlowPoint = {
                theta: [...site.theta],
                eta: [...site.eta],
                divergence: site.divergence,
                projection: site.projection,
                constructivePromise: site.promiseConstructive,
                obstructivePromise: site.promiseObstructive,
                curvature: site.curvature,
              };
              const result = flowDirectionResultForMode(
                labView.selectedFlowMode,
                point,
                {
                  fragmentId: selectedFragment.id,
                  tick: accumulationTick,
                  sites: accumulationSites,
                },
                labView.selectedGeometryMode,
              );
              const from = mapPointToFrame(
                siteChartPoint(site, labView.selectedGeometryMode, labView.selectedChartKind),
                expandedBounds,
                520,
                320,
                18,
              );
              const to = mapPointToFrame(
                flowArrowEndpoint(point, result, labView.selectedGeometryMode, labView.selectedChartKind, labView.flowVectorScale),
                expandedBounds,
                520,
                320,
                18,
              );
              return {
                site,
                result,
                paths: arrowPath(from, to, 5),
              };
            })
        : [];
    const accumulationTrajectoryActualPoints =
      trajectoryDiagnostics && trajectoryDiagnostics.samples.length > 1
        ? trajectoryDiagnostics.samples.map((sample) =>
            mapPointToFrame(
              barycenterChartPoint(
                labView.selectedGeometryMode,
                labView.selectedChartKind,
                sample.point,
              ),
              expandedBounds,
              520,
              320,
              18,
            ),
          )
        : [];
    const accumulationTrajectoryFittedPoints =
      trajectoryDiagnostics && trajectoryDiagnostics.fit.fittedSamples.length > 1
        ? trajectoryDiagnostics.fit.fittedSamples.map((sample) =>
            mapPointToFrame(
              barycenterChartPoint(
                labView.selectedGeometryMode,
                labView.selectedChartKind,
                sample.point,
              ),
              expandedBounds,
              520,
              320,
              18,
            ),
          )
        : [];
    const accumulationTrajectoryResidualSegments =
      trajectoryDiagnostics && labView.showResidualMarkers
        ? trajectoryDiagnostics.residuals.map((residual) => ({
            actual: mapPointToFrame(
              barycenterChartPoint(
                labView.selectedGeometryMode,
                labView.selectedChartKind,
                residual.actualPoint,
              ),
              expandedBounds,
              520,
              320,
              18,
            ),
            fitted: mapPointToFrame(
              barycenterChartPoint(
                labView.selectedGeometryMode,
                labView.selectedChartKind,
                residual.fittedPoint,
              ),
              expandedBounds,
              520,
              320,
              18,
            ),
            residual,
          }))
        : [];
    const accumulationTrajectoryVelocityPaths =
      trajectoryDiagnostics && labView.regressionDisplayMode === "velocity"
        ? trajectoryVelocityPaths(accumulationTrajectoryFittedPoints, 4.5)
        : [];
    const accumulationTrajectoryStatus = trajectoryStatusLabel(trajectoryDiagnostics?.indicators);

    const traceMax = Math.max(
      0.001,
      ...nonEmptyFrames.map((frame) =>
        frame.sites.length === 0
          ? 0
          : frame.sites.reduce((sum, site) => sum + scalarValueForSite(site, labView.selectedScalarField), 0) / frame.sites.length,
      ),
    );
    const tracePoints = nonEmptyFrames.map((frame) => ({
      x: 20 + ((frame.tick - trailTicks[0]) / Math.max(1, accumulationTick - trailTicks[0] || 1)) * 480,
      y:
        292 -
        ((frame.sites.reduce((sum, site) => sum + scalarValueForSite(site, labView.selectedScalarField), 0) /
          Math.max(1, frame.sites.length)) /
          traceMax) *
          54,
    }));

    return (
      <svg className="htt-lab-module-canvas" viewBox="0 0 520 320" role="img" aria-label="Accumulated geometry">
        <rect x="0" y="0" width="520" height="320" fill="rgba(5, 7, 9, 0.24)" />

        {(labView.accumulationMode === "fieldsOnly" || labView.accumulationMode === "both") && labView.showAccumulationHistory
          ? nonEmptyFrames.map((frame, index) =>
              renderFieldFrame(
                frame.sites,
                0.12 + ((index + 1) / nonEmptyFrames.length) * 0.26,
                `trail-${frame.tick}`,
              ),
            )
          : null}

        {(labView.accumulationMode === "fieldsOnly" || labView.accumulationMode === "both")
          ? renderFieldFrame(accumulationSites, 0.34, `current-${accumulationTick}`)
          : null}

        {(labView.accumulationMode === "sitesOnly" || labView.accumulationMode === "both") &&
        labView.showAccumulationHistory &&
        labView.showVoronoiSites
          ? Array.from(siteTrails.entries()).map(([signature, trail]) => (
              <g key={`trail-${signature}`}>
                <path
                  className="htt-ig-scene__trail"
                  d={smoothLinePath(trail.map((entry) => entry.point))}
                  fill="none"
                  stroke="rgba(245, 237, 225, 0.2)"
                  strokeWidth="1.3"
                  strokeDasharray="4 4"
                />
                {trail.map((entry, index) => (
                  <circle
                    key={`${signature}-${entry.tick}`}
                    cx={entry.point.x}
                    cy={entry.point.y}
                    r={2.4 + (index / Math.max(1, trail.length - 1)) * 2.6}
                    fill={scalarFieldColor(
                      scalarValueForSite(entry.site, labView.selectedScalarField),
                      scalarMin,
                      scalarMax,
                      labView.colorScaleMode,
                    )}
                    opacity={0.2 + (index / Math.max(1, trail.length - 1)) * 0.45}
                  />
                ))}
              </g>
            ))
          : null}

        {accumulationBarycenterTrailPoints.length > 1 ? (
          <g>
            <path
              className="htt-ig-scene__trail"
              d={smoothLinePath(accumulationBarycenterTrailPoints)}
              fill="none"
              stroke="rgba(255, 196, 120, 0.78)"
              strokeWidth="1.8"
              strokeDasharray="5 4"
            />
            {barycenterTrailRecords.map((record, index) => (
              <circle
                key={`accumulation-barycenter-trail-${record.tick}`}
                cx={accumulationBarycenterTrailPoints[index].x}
                cy={accumulationBarycenterTrailPoints[index].y}
                r={record.tick === activeBarycenterRecord?.tick ? 4.8 : 3.2}
                fill="rgba(255, 214, 158, 0.92)"
                stroke="rgba(119, 66, 18, 0.88)"
                strokeWidth="1"
                onMouseEnter={() => setHoveredBarycenterTick(record.tick)}
                onMouseLeave={() => setHoveredBarycenterTick((current) => (current === record.tick ? undefined : current))}
                onClick={() => focusBarycenterRecord(record)}
                style={{ cursor: "pointer" }}
              />
            ))}
          </g>
        ) : null}

        {accumulationFlowTrailPoints.length > 1 ? (
          <path
            className="htt-ig-scene__motion"
            d={smoothLinePath(accumulationFlowTrailPoints)}
            fill="none"
            stroke="rgba(142, 214, 220, 0.66)"
            strokeWidth="1.45"
            strokeDasharray="6 4"
            style={flowAnimationStyle}
          />
        ) : null}

        {(labView.accumulationMode === "sitesOnly" || labView.accumulationMode === "both") &&
        labView.showVoronoiSites
          ? accumulationSites.map((site, index) => {
              const mapped = mapPointToFrame(
                siteChartPoint(site, labView.selectedGeometryMode, labView.selectedChartKind),
                expandedBounds,
                520,
                320,
                18,
              );
              const isActive = pointSignature(site) === activePointSignature;
              const signal = geometryInstabilitySignal({
                curvature: site.curvature,
                asymmetry: site.asymmetry,
                projection: site.projection,
                promiseConstructive: site.promiseConstructive,
                promiseObstructive: site.promiseObstructive,
                catastrophe: selectedFragment.catastrophe,
              });
              return (
                <g
                  key={`accumulation-site-${site.id}`}
                  onClick={() => focusIGSite(site)}
                  style={{ cursor: "pointer" }}
                >
                  <circle
                    cx={mapped.x}
                    cy={mapped.y}
                    r={isActive ? 8.8 : 6.8}
                    fill={scalarFieldColor(
                      scalarValueForSite(site, labView.selectedScalarField),
                      scalarMin,
                      scalarMax,
                      labView.colorScaleMode,
                    )}
                    stroke={isActive ? "rgba(255, 255, 255, 0.96)" : "rgba(16, 18, 22, 0.88)"}
                    strokeWidth={isActive ? 2 : 1.2}
                  />
                  {activeBarycenterSiteIds.has(site.id) ? (
                    <circle
                      cx={mapped.x}
                      cy={mapped.y}
                      r="11.8"
                      fill="none"
                      stroke="rgba(255, 214, 158, 0.84)"
                      strokeWidth="1.35"
                      strokeDasharray="3 3"
                    />
                  ) : null}
                  {labView.showCatastropheMarkers && signal.highCurvature ? (
                    <circle
                      cx={mapped.x}
                      cy={mapped.y}
                      r={12 + signal.instability * 8}
                      fill="none"
                      stroke={instabilityStroke("curvature")}
                      strokeWidth="1.3"
                    />
                  ) : null}
                  {labView.showCatastropheMarkers && signal.catastropheCandidate ? (
                    <circle
                      cx={mapped.x}
                      cy={mapped.y}
                      r={15 + signal.instability * 8}
                      fill="none"
                      stroke={instabilityStroke("catastrophe")}
                      strokeWidth="2"
                      strokeDasharray="5 4"
                    />
                  ) : null}
                  {labView.showCatastropheMarkers && signal.singularityCandidate ? (
                    <path
                      d={crossMarkerPath(mapped, 6 + signal.instability * 4)}
                      fill="none"
                      stroke={instabilityStroke("singularity")}
                      strokeWidth="1.9"
                      strokeLinecap="round"
                    />
                  ) : null}
                  {labView.showCatastropheMarkers && topologyRelatedSiteSignatures.has(pointSignature(site)) ? (
                    <circle
                      cx={mapped.x}
                      cy={mapped.y}
                      r="13.4"
                      fill="none"
                      stroke="rgba(188, 164, 238, 0.82)"
                      strokeWidth="1.5"
                      strokeDasharray="3 3"
                    />
                  ) : null}
                  <text className="htt-lab-svg-label" x={mapped.x} y={mapped.y - 14}>
                    {site.sourceKind === "proposal" ? `p${index + 1}` : `f${index + 1}`}
                  </text>
                </g>
              );
            })
          : null}

        {accumulationFlowVectors.map((entry) => (
          <g
            key={`accumulation-flow-${entry.site.id}`}
            opacity={labView.animateFlowOverTicks ? 0.64 : 0.8}
            style={flowAnimationStyle}
          >
            <path
              d={entry.paths.shaft}
              fill="none"
              stroke="rgba(142, 214, 220, 0.78)"
              strokeWidth="1.18"
              strokeLinecap="round"
            />
            <path
              d={entry.paths.head}
              fill="none"
              stroke="rgba(142, 214, 220, 0.78)"
              strokeWidth="1.18"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <title>{`${flowModeLabel(labView.selectedFlowMode)} / ${entry.result.method}`}</title>
          </g>
        ))}

        {trajectoryDiagnostics && accumulationTrajectoryFittedPoints.length > 1 ? (
          <g>
            <path
              className="htt-ig-scene__trace"
              d={smoothLinePath(accumulationTrajectoryFittedPoints)}
              fill="none"
              stroke="rgba(208, 190, 244, 0.9)"
              strokeWidth={labView.regressionDisplayMode === "fittedCurve" ? 2.4 : 2}
              strokeDasharray={labView.regressionDisplayMode === "convergence" ? "7 4" : undefined}
            />
            {labView.regressionDisplayMode === "velocity"
              ? accumulationTrajectoryVelocityPaths.map((path, index) => (
                  <g key={`accumulation-trajectory-velocity-${index}`}>
                    <path d={path.shaft} fill="none" stroke="rgba(208, 190, 244, 0.76)" strokeWidth="1.2" />
                    <path d={path.head} fill="none" stroke="rgba(208, 190, 244, 0.76)" strokeWidth="1.2" />
                  </g>
                ))
              : null}
          </g>
        ) : null}

        {accumulationTrajectoryActualPoints.length > 0
          ? accumulationTrajectoryActualPoints.map((point, index) => (
              <circle
                key={`accumulation-trajectory-sample-${index}`}
                cx={point.x}
                cy={point.y}
                r={index === accumulationTrajectoryActualPoints.length - 1 ? 4.6 : 3.2}
                fill="rgba(245, 237, 225, 0.92)"
                stroke="rgba(91, 72, 124, 0.78)"
                strokeWidth="1"
                onClick={() => {
                  const sample = trajectoryDiagnostics?.samples[index];
                  if (sample) {
                    focusTrajectorySample(sample);
                  }
                }}
                style={{ cursor: trajectoryDiagnostics?.samples[index] ? "pointer" : "default" }}
              />
            ))
          : null}

        {accumulationTrajectoryResidualSegments.map((segment, index) => (
          <g key={`accumulation-trajectory-residual-${index}`}>
            <path
              d={linePath([segment.actual, segment.fitted])}
              fill="none"
              stroke="rgba(228, 150, 138, 0.62)"
              strokeWidth="1.15"
              strokeDasharray="4 3"
            />
            <circle
              cx={segment.fitted.x}
              cy={segment.fitted.y}
              r={2.1 + Math.min(4.8, segment.residual.combinedResidual * 6)}
              fill="rgba(228, 150, 138, 0.2)"
              stroke="rgba(228, 150, 138, 0.66)"
              strokeWidth="0.9"
            />
          </g>
        ))}

        {accumulationBarycenterPoint && activeBarycenterRecord ? (
          <g
            onMouseEnter={() => setHoveredBarycenterTick(activeBarycenterRecord.tick)}
            onMouseLeave={() => setHoveredBarycenterTick((current) => (current === activeBarycenterRecord.tick ? undefined : current))}
            onClick={() => focusBarycenterRecord(activeBarycenterRecord)}
            style={{ cursor: "pointer" }}
          >
            <circle
              cx={accumulationBarycenterPoint.x}
              cy={accumulationBarycenterPoint.y}
              r="12"
              fill="rgba(255, 196, 120, 0.24)"
              stroke="rgba(255, 214, 158, 0.98)"
              strokeWidth="2.1"
            />
            <circle cx={accumulationBarycenterPoint.x} cy={accumulationBarycenterPoint.y} r="4.2" fill="rgba(255, 237, 211, 0.98)" />
            <path
              d={crossMarkerPath(accumulationBarycenterPoint, 6)}
              fill="none"
              stroke="rgba(119, 66, 18, 0.92)"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
            <title>{`barycenter / ${barycenterSourceModeLabel(activeBarycenterRecord.inputs.sourceMode)} / tick ${activeBarycenterRecord.tick}`}</title>
          </g>
        ) : null}

        <rect x="16" y="246" width="488" height="58" fill="rgba(0, 0, 0, 0.18)" rx="10" />
        <path
          className="htt-ig-scene__trace"
          d={smoothLinePath(tracePoints)}
          fill="none"
          stroke="rgba(245, 237, 225, 0.92)"
          strokeWidth="2.1"
        />

        <text className="htt-lab-svg-title" x="20" y="24">
          {`accumulation / ${getGeometryModeLabel(labView.selectedGeometryMode)} / tick ${accumulationTick} / ${accumulationModeLabel(labView.accumulationMode)}`}
        </text>
        {trajectoryDiagnostics ? (
          <text className="htt-lab-svg-label" x="500" y="24" textAnchor="end">
            {`trajectory / ${accumulationTrajectoryStatus}`}
          </text>
        ) : null}
        <text className="htt-lab-svg-label" x="20" y="302">
          {`${trailTicks.length} ticks / ${scalarFieldLabel(labView.selectedScalarField)} trace / ${labView.selectedChartKind} chart / ${labView.colorScaleMode} / ${labView.normalizationMode}${
            labView.compareWithPreviousTick ? ` / compare ${previousAvailableTick}` : ""
          }`}
        </text>
      </svg>
    );
  };

  return (
    <section className={`htt-module-shell htt-module-shell--${mode}`}>
      <div className="htt-module-shell__workspace">
        <aside className="htt-app__panel">
          <section className="htt-section">
            <p className="htt-app__eyebrow">Module</p>
            <h2 className="htt-section__title">Information Geometry Lab</h2>
            <div className="htt-lab-tab-row">
              {LAB_TABS.map((tab) => (
                <button
                  key={tab.id}
                  className={`htt-button ${currentTab === tab.id ? "htt-button--primary" : "htt-button--ghost"}`}
                  type="button"
                  onClick={() => {
                    setInformationGeometryLabTab(tab.id);
                    if (tab.id === "patches") {
                      setInformationGeometryLabViewMode("localPatch");
                    } else if (tab.id === "voronoi") {
                      setInformationGeometryLabViewMode("voronoi");
                    } else if (tab.id === "charts") {
                      setInformationGeometryLabViewMode("dualCharts");
                    } else if (tab.id === "potential") {
                      setInformationGeometryLabViewMode("liftedSurface");
                    } else if (tab.id === "history") {
                      setInformationGeometryLabViewMode("accumulation");
                    }
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </section>

          <section className="htt-section">
            <h2 className="htt-section__title">Controls</h2>
            <dl className="htt-detail-list">
              <div className="htt-detail-row">
                <dt>View mode</dt>
                <dd>
                  <select
                    className="htt-select"
                    value={labView.selectedIGViewMode}
                    onChange={(event) =>
                      setInformationGeometryLabViewMode(
                        event.target.value as typeof labView.selectedIGViewMode,
                      )
                    }
                  >
                    <option value="localPatch">localPatch</option>
                    <option value="voronoi">voronoi</option>
                    <option value="dualCharts">dualCharts</option>
                    <option value="liftedSurface">liftedSurface</option>
                    <option value="accumulation">accumulation</option>
                  </select>
                </dd>
              </div>
              <div className="htt-detail-row">
                <dt>Chart</dt>
                <dd>
                  <select
                    className="htt-select"
                    value={labView.selectedChartKind}
                    onChange={(event) =>
                      updateInformationGeometryLabState({
                        selectedChartKind: event.target.value as InformationGeometryLabChartKind,
                      })
                    }
                  >
                    <option value="theta">theta</option>
                    <option value="eta">eta</option>
                  </select>
                </dd>
              </div>
              <div className="htt-detail-row">
                <dt>Geometry</dt>
                <dd>
                  <select
                    className="htt-select"
                    value={labView.selectedGeometryMode}
                    onChange={(event) =>
                      setInformationGeometryMode(
                        event.target.value as InformationGeometryMode,
                      )
                    }
                  >
                    {GEOMETRY_MODE_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>
                        {`${option.label}${option.implementationStatus === "scaffold" ? " (scaffold)" : ""}`}
                      </option>
                    ))}
                  </select>
                </dd>
              </div>
              <div className="htt-detail-row">
                <dt>Fragment</dt>
                <dd>{selectedFragment ? fragmentTitle(selectedFragment) : "none"}</dd>
              </div>
              <div className="htt-detail-row">
                <dt>Proposal</dt>
                <dd>{selectedProposal?.title ?? "none"}</dd>
              </div>
              <div className="htt-detail-row">
                <dt>Lean</dt>
                <dd>{lean?.status ?? "TS fallback"}</dd>
              </div>
              <div className="htt-detail-row">
                <dt>Atlas</dt>
                <dd>{getGeometryModeLabel(labView.selectedGeometryMode)}</dd>
              </div>
            </dl>

            <p className="htt-app__eyebrow">Display</p>
            <div className="htt-toggle-list">
              <label className="htt-toggle">
                <span>Show sites</span>
                <input
                  type="checkbox"
                  checked={labView.showVoronoiSites}
                  onChange={(event) =>
                    updateInformationGeometryLabState({
                      showVoronoiSites: event.target.checked,
                    })
                  }
                />
              </label>
              <label className="htt-toggle">
                <span>Show boundaries</span>
                <input
                  type="checkbox"
                  checked={labView.showVoronoiBoundaries}
                  onChange={(event) =>
                    updateInformationGeometryLabState({
                      showVoronoiBoundaries: event.target.checked,
                    })
                  }
                />
              </label>
              <label className="htt-toggle">
                <span>Show geodesics</span>
                <input
                  type="checkbox"
                  checked={labView.showGeodesics}
                  onChange={(event) =>
                    updateInformationGeometryLabState({
                      showGeodesics: event.target.checked,
                    })
                  }
                />
              </label>
              <label className="htt-toggle">
                <span>Show nucleation</span>
                <input
                  type="checkbox"
                  checked={labView.showNucleation}
                  onChange={(event) =>
                    updateInformationGeometryLabState({
                      showNucleation: event.target.checked,
                    })
                  }
                />
              </label>
              <label className="htt-toggle">
                <span>Show catastrophe markers</span>
                <input
                  type="checkbox"
                  checked={labView.showCatastropheMarkers}
                  onChange={(event) =>
                    updateInformationGeometryLabState({
                      showCatastropheMarkers: event.target.checked,
                    })
                  }
                />
              </label>
              <label className="htt-toggle">
                <span>Show accumulated history</span>
                <input
                  type="checkbox"
                  checked={labView.showAccumulationHistory}
                  onChange={(event) =>
                    updateInformationGeometryLabState({
                      showAccumulationHistory: event.target.checked,
                    })
                  }
                />
              </label>
            </div>

            <p className="htt-app__eyebrow">Field</p>
            <dl className="htt-detail-list">
              <div className="htt-detail-row">
                <dt>Scalar field</dt>
                <dd>
                  <select
                    className="htt-select"
                    value={labView.selectedScalarField}
                    onChange={(event) =>
                      setInformationGeometryLabScalarField(
                        event.target.value as InformationGeometryLabScalarField,
                      )
                    }
                  >
                    {SCALAR_FIELD_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </dd>
              </div>
              <div className="htt-detail-row">
                <dt>Color scale</dt>
                <dd>
                  <select
                    className="htt-select"
                    value={labView.colorScaleMode}
                    onChange={(event) =>
                      updateInformationGeometryLabState({
                        colorScaleMode: event.target.value as InformationGeometryLabColorScaleMode,
                      })
                    }
                  >
                    {COLOR_SCALE_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </dd>
              </div>
              <div className="htt-detail-row">
                <dt>Normalize</dt>
                <dd>
                  <select
                    className="htt-select"
                    value={labView.normalizationMode}
                    onChange={(event) =>
                      updateInformationGeometryLabState({
                        normalizationMode: event.target.value as InformationGeometryLabNormalizationMode,
                      })
                    }
                  >
                    {NORMALIZATION_MODE_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </dd>
              </div>
            </dl>

            <p className="htt-app__eyebrow">Barycenter</p>
            <div className="htt-toggle-list">
              <label className="htt-toggle">
                <span>Show barycenter</span>
                <input
                  type="checkbox"
                  checked={labView.showBarycenter}
                  onChange={(event) =>
                    updateInformationGeometryLabState({
                      showBarycenter: event.target.checked,
                    })
                  }
                />
              </label>
              <label className="htt-toggle">
                <span>Show barycenter trail</span>
                <input
                  type="checkbox"
                  checked={labView.showBarycenterTrail}
                  onChange={(event) =>
                    updateInformationGeometryLabState({
                      showBarycenterTrail: event.target.checked,
                    })
                  }
                />
              </label>
            </div>
            <dl className="htt-detail-list">
              <div className="htt-detail-row">
                <dt>Source set</dt>
                <dd>
                  <select
                    className="htt-select"
                    value={labView.barycenterSourceMode}
                    onChange={(event) =>
                      updateInformationGeometryLabState({
                        barycenterSourceMode: event.target.value as InformationGeometryLabBarycenterSourceMode,
                      })
                    }
                  >
                    {BARYCENTER_SOURCE_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </dd>
              </div>
              <div className="htt-detail-row">
                <dt>Weight mode</dt>
                <dd>
                  <select
                    className="htt-select"
                    value={labView.barycenterWeightMode}
                    onChange={(event) =>
                      updateInformationGeometryLabState({
                        barycenterWeightMode: event.target.value as InformationGeometryLabBarycenterWeightMode,
                      })
                    }
                  >
                    {BARYCENTER_WEIGHT_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </dd>
              </div>
              <div className="htt-detail-row">
                <dt>Tick window</dt>
                <dd>
                  <input
                    className="htt-slider"
                    type="range"
                    min="1"
                    max="24"
                    step="1"
                    value={labView.barycenterTickWindow}
                    onChange={(event) =>
                      updateInformationGeometryLabState({
                        barycenterTickWindow: Number(event.target.value),
                      })
                    }
                  />
                  <span className="htt-detail-mono">{labView.barycenterTickWindow}</span>
                </dd>
              </div>
              <div className="htt-detail-row">
                <dt>Active mode</dt>
                <dd className="htt-detail-mono">
                  {`${barycenterSourceModeLabel(labView.barycenterSourceMode)} / ${barycenterWeightModeLabel(labView.barycenterWeightMode)}`}
                </dd>
              </div>
            </dl>

            <p className="htt-app__eyebrow">Flow</p>
            <div className="htt-toggle-list">
              <label className="htt-toggle">
                <span>Show flow vectors</span>
                <input
                  type="checkbox"
                  checked={labView.showFlowVectors}
                  onChange={(event) =>
                    updateInformationGeometryLabState({
                      showFlowVectors: event.target.checked,
                    })
                  }
                />
              </label>
              <label className="htt-toggle">
                <span>Show flow trails</span>
                <input
                  type="checkbox"
                  checked={labView.showFlowTrails}
                  onChange={(event) =>
                    updateInformationGeometryLabState({
                      showFlowTrails: event.target.checked,
                    })
                  }
                />
              </label>
              <label className="htt-toggle">
                <span>Animate over ticks</span>
                <input
                  type="checkbox"
                  checked={labView.animateFlowOverTicks}
                  onChange={(event) =>
                    updateInformationGeometryLabState({
                      animateFlowOverTicks: event.target.checked,
                    })
                  }
                />
              </label>
            </div>
            <dl className="htt-detail-list">
              <div className="htt-detail-row">
                <dt>Flow mode</dt>
                <dd>
                  <select
                    className="htt-select"
                    value={labView.selectedFlowMode}
                    onChange={(event) =>
                      updateInformationGeometryLabState({
                        selectedFlowMode: event.target.value as InformationGeometryLabFlowMode,
                      })
                    }
                  >
                    {FLOW_MODE_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </dd>
              </div>
              <div className="htt-detail-row">
                <dt>Density</dt>
                <dd>
                  <input
                    className="htt-slider"
                    type="range"
                    min="1"
                    max="5"
                    step="1"
                    value={labView.flowVectorDensity}
                    onChange={(event) =>
                      updateInformationGeometryLabState({
                        flowVectorDensity: Number(event.target.value),
                      })
                    }
                  />
                  <span className="htt-detail-mono">{labView.flowVectorDensity}</span>
                </dd>
              </div>
              <div className="htt-detail-row">
                <dt>Vector scale</dt>
                <dd>
                  <input
                    className="htt-slider"
                    type="range"
                    min="0.4"
                    max="2.5"
                    step="0.1"
                    value={labView.flowVectorScale}
                    onChange={(event) =>
                      updateInformationGeometryLabState({
                        flowVectorScale: Number(event.target.value),
                      })
                    }
                  />
                  <span className="htt-detail-mono">{labView.flowVectorScale.toFixed(1)}</span>
                </dd>
              </div>
            </dl>

            <p className="htt-app__eyebrow">Regression</p>
            <div className="htt-toggle-list">
              <label className="htt-toggle">
                <span>Enable regression diagnostics</span>
                <input
                  type="checkbox"
                  checked={labView.regressionEnabled}
                  onChange={(event) =>
                    updateInformationGeometryLabState({
                      regressionEnabled: event.target.checked,
                    })
                  }
                />
              </label>
              <label className="htt-toggle">
                <span>Show residual markers</span>
                <input
                  type="checkbox"
                  checked={labView.showResidualMarkers}
                  onChange={(event) =>
                    updateInformationGeometryLabState({
                      showResidualMarkers: event.target.checked,
                    })
                  }
                />
              </label>
            </div>
            <dl className="htt-detail-list">
              <div className="htt-detail-row">
                <dt>Target history</dt>
                <dd>
                  <select
                    className="htt-select"
                    value={labView.regressionTargetMode}
                    onChange={(event) =>
                      updateInformationGeometryLabState({
                        regressionTargetMode: event.target.value as InformationGeometryLabRegressionTargetMode,
                      })
                    }
                  >
                    {REGRESSION_TARGET_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </dd>
              </div>
              <div className="htt-detail-row">
                <dt>Display mode</dt>
                <dd>
                  <select
                    className="htt-select"
                    value={labView.regressionDisplayMode}
                    onChange={(event) =>
                      updateInformationGeometryLabState({
                        regressionDisplayMode: event.target.value as InformationGeometryLabRegressionDisplayMode,
                      })
                    }
                  >
                    {REGRESSION_DISPLAY_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </dd>
              </div>
              <div className="htt-detail-row">
                <dt>Tick window</dt>
                <dd>
                  <input
                    className="htt-slider"
                    type="range"
                    min="2"
                    max="32"
                    step="1"
                    value={labView.regressionTickWindow}
                    onChange={(event) =>
                      updateInformationGeometryLabState({
                        regressionTickWindow: Number(event.target.value),
                      })
                    }
                  />
                  <span className="htt-detail-mono">{labView.regressionTickWindow}</span>
                </dd>
              </div>
              <div className="htt-detail-row">
                <dt>Active mode</dt>
                <dd className="htt-detail-mono">
                  {`${regressionTargetModeLabel(labView.regressionTargetMode)} / ${regressionDisplayModeLabel(
                    labView.regressionDisplayMode,
                  )}`}
                </dd>
              </div>
            </dl>

            <p className="htt-app__eyebrow">Interaction</p>
            <div className="htt-toggle-list">
              <label className="htt-toggle">
                <span>Auto-follow active fragment</span>
                <input
                  type="checkbox"
                  checked={labView.autoFollowActiveFragment}
                  onChange={(event) =>
                    updateInformationGeometryLabState({
                      autoFollowActiveFragment: event.target.checked,
                      ...(event.target.checked ? { freezeCurrentSnapshot: false } : {}),
                    })
                  }
                />
              </label>
              <label className="htt-toggle">
                <span>Freeze current snapshot</span>
                <input
                  type="checkbox"
                  checked={labView.freezeCurrentSnapshot}
                  onChange={(event) =>
                    updateInformationGeometryLabState(
                      event.target.checked
                        ? {
                            freezeCurrentSnapshot: true,
                            autoFollowActiveFragment: false,
                            selectedTick: simulation.activeTick,
                            selectedFragmentId: selectedFragment?.id,
                            selectedProposalId: selectedProposal?.id,
                          }
                        : {
                            freezeCurrentSnapshot: false,
                          },
                    )
                  }
                />
              </label>
              <label className="htt-toggle">
                <span>Compare current vs previous tick</span>
                <input
                  type="checkbox"
                  checked={labView.compareWithPreviousTick}
                  onChange={(event) =>
                    updateInformationGeometryLabState({
                      compareWithPreviousTick: event.target.checked,
                    })
                  }
                />
              </label>
            </div>
            <dl className="htt-detail-list">
              <div className="htt-detail-row">
                <dt>Tick scrubber</dt>
                <dd>
                  <input
                    className="htt-slider"
                    type="range"
                    min={minAvailableTick}
                    max={maxAvailableTick}
                    step="1"
                    value={accumulationTick}
                    onChange={(event) =>
                      updateInformationGeometryLabState({
                        autoFollowActiveFragment: false,
                        freezeCurrentSnapshot: true,
                        selectedTick: Number(event.target.value),
                      })
                    }
                  />
                  <span className="htt-detail-mono">
                    {`${accumulationTick} / ${maxAvailableTick}${
                      labView.compareWithPreviousTick ? ` / prev ${previousAvailableTick}` : ""
                    }`}
                  </span>
                </dd>
              </div>
            </dl>
            <p className="htt-app__eyebrow">Snapshots</p>
            <div className="htt-lab-control-row">
              <button className="htt-button htt-button--primary" type="button" onClick={() => void handleSaveSnapshot()}>
                Save Snapshot
              </button>
              <button
                className="htt-button htt-button--ghost"
                type="button"
                onClick={() => void handleLoadSnapshot()}
                disabled={!selectedSnapshotRecord}
              >
                Load Snapshot
              </button>
            </div>
            <dl className="htt-detail-list">
              <div className="htt-detail-row">
                <dt>Browse</dt>
                <dd>
                  <select
                    className="htt-select"
                    value={selectedSnapshotId ?? ""}
                    onChange={(event) => setSelectedSnapshotId(event.target.value || undefined)}
                  >
                    <option value="">select snapshot</option>
                    {snapshotRecords.map((record) => (
                      <option key={record.id} value={record.id}>
                        {`tick ${record.tick} / ${record.viewMode} / ${record.fragmentId ?? "no fragment"}`}
                      </option>
                    ))}
                  </select>
                </dd>
              </div>
              <div className="htt-detail-row">
                <dt>Loaded</dt>
                <dd className="htt-detail-mono">
                  {loadedSnapshot
                    ? `${loadedSnapshot.moduleTab} / ${loadedSnapshot.viewMode} / ${loadedSnapshot.label ?? loadedSnapshot.fragmentId ?? "snapshot"}`
                    : "none"}
                </dd>
              </div>
              <div className="htt-detail-row">
                <dt>Status</dt>
                <dd className="htt-detail-mono">
                  {snapshotStatus ??
                    (selectedSnapshotRecord
                      ? `${selectedSnapshotRecord.siteCount} sites / ${selectedSnapshotRecord.sampleCount} samples / ${selectedSnapshotRecord.artifactPath}`
                      : "no snapshots yet")}
                </dd>
              </div>
            </dl>
            {currentTab === "voronoi" ? (
              <dl className="htt-detail-list">
                <div className="htt-detail-row">
                  <dt>Grid</dt>
                  <dd>
                    <input
                      className="htt-slider"
                      type="range"
                      min="8"
                      max="36"
                      step="1"
                      value={labView.voronoiGridResolution}
                      onChange={(event) =>
                        updateInformationGeometryLabState({
                          voronoiGridResolution: Number(event.target.value),
                        })
                      }
                    />
                    <span className="htt-detail-mono">{labView.voronoiGridResolution}</span>
                  </dd>
                </div>
                <div className="htt-detail-row">
                  <dt>Site source</dt>
                  <dd>
                    <select
                      className="htt-select"
                      value={labView.voronoiSiteSource}
                      onChange={(event) =>
                        updateInformationGeometryLabState({
                          voronoiSiteSource: event.target.value as InformationGeometryLabVoronoiSiteSource,
                        })
                      }
                    >
                      <option value="nearbyFragments">nearby fragments</option>
                      <option value="activeProposals">active proposals</option>
                      <option value="persistentNodes">promoted persistent nodes</option>
                    </select>
                  </dd>
                </div>
              </dl>
            ) : null}
            {currentTab === "potential" ? (
              <>
                <div className="htt-toggle-list">
                  <label className="htt-toggle">
                    <span>Lift by convex surface</span>
                    <input
                      type="checkbox"
                      checked={labView.showLiftedSurface}
                      onChange={(event) =>
                        updateInformationGeometryLabState({
                          showLiftedSurface: event.target.checked,
                        })
                      }
                    />
                  </label>
                  <label className="htt-toggle">
                    <span>Show stems</span>
                    <input
                      type="checkbox"
                      checked={labView.showLiftedStems}
                      onChange={(event) =>
                        updateInformationGeometryLabState({
                          showLiftedStems: event.target.checked,
                        })
                      }
                    />
                  </label>
                  <label className="htt-toggle">
                    <span>Show footprint</span>
                    <input
                      type="checkbox"
                      checked={labView.showLiftedFootprint}
                      onChange={(event) =>
                        updateInformationGeometryLabState({
                          showLiftedFootprint: event.target.checked,
                        })
                      }
                    />
                  </label>
                </div>
                <dl className="htt-detail-list">
                  <div className="htt-detail-row">
                    <dt>Projection angle</dt>
                    <dd>
                      <input
                        className="htt-slider"
                        type="range"
                        min="8"
                        max="72"
                        step="1"
                        value={labView.liftedProjectionAngle}
                        onChange={(event) =>
                          updateInformationGeometryLabState({
                            liftedProjectionAngle: Number(event.target.value),
                          })
                        }
                      />
                      <span className="htt-detail-mono">{`${labView.liftedProjectionAngle.toFixed(0)} deg`}</span>
                    </dd>
                  </div>
                  <div className="htt-detail-row">
                    <dt>Height scale</dt>
                    <dd>
                      <input
                        className="htt-slider"
                        type="range"
                        min="0.25"
                        max="2.5"
                        step="0.05"
                        value={labView.liftedHeightScale}
                        onChange={(event) =>
                          updateInformationGeometryLabState({
                            liftedHeightScale: Number(event.target.value),
                          })
                        }
                      />
                      <span className="htt-detail-mono">{labView.liftedHeightScale.toFixed(2)}</span>
                    </dd>
                  </div>
                </dl>
              </>
            ) : null}
            {currentTab === "history" ? (
              <>
                <div className="htt-toggle-list">
                  <label className="htt-toggle">
                    <span>Show fading history</span>
                    <input
                      type="checkbox"
                      checked={labView.showAccumulationHistory}
                      onChange={(event) =>
                        updateInformationGeometryLabState({
                          showAccumulationHistory: event.target.checked,
                        })
                      }
                    />
                  </label>
                </div>
                <div className="htt-lab-control-row">
                  <button
                    className={`htt-button ${accumulationPlaying ? "htt-button--primary" : "htt-button--ghost"}`}
                    type="button"
                    onClick={() => setAccumulationPlaying((current) => !current)}
                  >
                    {accumulationPlaying ? "Pause" : "Play"}
                  </button>
                  <span className="htt-badge">{`tick ${accumulationTick}`}</span>
                </div>
                <dl className="htt-detail-list">
                  <div className="htt-detail-row">
                    <dt>Tick scrubber</dt>
                    <dd>
                      <input
                        className="htt-slider"
                        type="range"
                        min={minAvailableTick}
                        max={maxAvailableTick}
                        step="1"
                        value={accumulationTick}
                        onChange={(event) => {
                          setAccumulationPlaying(false);
                          updateInformationGeometryLabState({
                            selectedTick: Number(event.target.value),
                          });
                        }}
                      />
                      <span className="htt-detail-mono">{`${accumulationTick} / ${maxAvailableTick}`}</span>
                    </dd>
                  </div>
                  <div className="htt-detail-row">
                    <dt>Trail length</dt>
                    <dd>
                      <input
                        className="htt-slider"
                        type="range"
                        min="2"
                        max={Math.max(2, runtimeConfig.accumulationTrailLimit)}
                        step="1"
                        value={effectiveAccumulationTrailLength}
                        onChange={(event) =>
                          updateInformationGeometryLabState({
                            accumulationTrailLength: Number(event.target.value),
                          })
                        }
                      />
                      <span className="htt-detail-mono">
                        {`${effectiveAccumulationTrailLength} / ${runtimeConfig.accumulationTrailLimit}`}
                      </span>
                    </dd>
                  </div>
                  <div className="htt-detail-row">
                    <dt>Accumulation mode</dt>
                    <dd>
                      <select
                        className="htt-select"
                        value={labView.accumulationMode}
                        onChange={(event) =>
                          updateInformationGeometryLabState({
                            accumulationMode: event.target.value as InformationGeometryLabAccumulationMode,
                          })
                        }
                      >
                        <option value="sitesOnly">sites only</option>
                        <option value="fieldsOnly">fields only</option>
                        <option value="both">both</option>
                      </select>
                    </dd>
                  </div>
                </dl>
              </>
            ) : null}
            {visibleSiteList.length > 0 ? (
              <div className="htt-lab-sample-list">
                {visibleSiteList.map((site, index) => (
                  <button
                    key={site.id}
                    className="htt-lab-sample-card"
                    type="button"
                    onClick={() => focusIGSite(site)}
                  >
                    <span className="htt-lab-sample-card__title">{site.label}</span>
                    <span className="htt-lab-sample-card__meta">
                      {`site ${index + 1} / ${site.phase ?? "latent"} / ${scalarFieldLabel(labView.selectedScalarField)} ${formatMetric(scalarValueForSite(site, labView.selectedScalarField))}`}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="htt-empty">Sites appear here once the lab has an active fragment and site source.</p>
            )}
          </section>
        </aside>

        <main className="htt-app__panel">
          <section className="htt-section">
            <h2 className="htt-section__title">
              {LAB_TABS.find((tab) => tab.id === currentTab)?.label ?? "Visualization"}
            </h2>
            {renderCanvas()}
          </section>
        </main>

        <aside className="htt-app__panel">
          <section className="htt-section">
            <div className="htt-lab__header">
              <div>
                <p className="htt-app__eyebrow">IG Selection</p>
                <h2 className="htt-section__title">Inspector</h2>
              </div>
              <span className="htt-status-pill" data-tone={statusTone(lean?.status ?? promise?.classification)}>
                {lean?.status ?? promise?.classification ?? "tracked"}
              </span>
            </div>
            {selectedFragment ? (
              <>
                <div className="htt-lab-module-chart-note htt-lab-inspector-group">
                  <p className="htt-lab-module-chart-note__title">{inspectorSelectionLabel ?? "active geometry target"}</p>
                  <p className="htt-lab-module-chart-note__body">
                    {`${labView.selectedIGViewMode} / ${getGeometryModeLabel(labView.selectedGeometryMode)} / ${labView.selectedChartKind} / ${scalarFieldLabel(labView.selectedScalarField)} / tick ${inspectorTick}`}
                  </p>
                  <p className="htt-lab-module-chart-note__body">
                    {`${currentTab} tab / ${selectedSite?.sourceKind ?? (selectedProposal ? "proposal" : "fragment")} focus / phase ${phase ?? selectedFragment.phase}`}
                  </p>
                  {activeBarycenterRecord ? (
                    <p className="htt-lab-module-chart-note__body">
                      {`barycenter / ${barycenterSourceModeLabel(activeBarycenterRecord.inputs.sourceMode)} / ${barycenterWeightModeLabel(activeBarycenterRecord.inputs.weightMode)} / cluster ${activeBarycenterRecord.inputs.sites.length}`}
                    </p>
                  ) : null}
                </div>

                <details className="htt-lab-inspector-group" open>
                  <summary className="htt-lab-module-chart-note__title">Geometry Grammar</summary>
                  <div className="htt-lab-metric-grid" style={{ marginTop: "0.85rem" }}>
                    <div className="htt-lab-metric-card">
                      <p className="htt-lab-metric-card__label">Mode</p>
                      <p className="htt-lab-metric-card__value">{geometryModeDefinition.label}</p>
                    </div>
                    <div className="htt-lab-metric-card">
                      <p className="htt-lab-metric-card__label">Divergence</p>
                      <p className="htt-lab-metric-card__value">
                        {geometryModeDefinition.divergenceKinds.join(", ")}
                      </p>
                    </div>
                    <div className="htt-lab-metric-card">
                      <p className="htt-lab-metric-card__label">Implementation</p>
                      <p className="htt-lab-metric-card__value">
                        {implementationStatusLabel(geometryModeDefinition.implementationStatus)}
                      </p>
                    </div>
                    <div className="htt-lab-metric-card">
                      <p className="htt-lab-metric-card__label">Projection / Lean</p>
                      <p className="htt-lab-metric-card__value">{grammarProjectionMode}</p>
                    </div>
                  </div>

                  <dl className="htt-detail-list" style={{ marginTop: "0.85rem" }}>
                    <div className="htt-detail-row">
                      <dt>Geometry mode</dt>
                      <dd>{geometryModeDefinition.label}</dd>
                    </div>
                    <div className="htt-detail-row">
                      <dt>Description</dt>
                      <dd>{geometryModeDefinition.description}</dd>
                    </div>
                    <div className="htt-detail-row">
                      <dt>Chart kind</dt>
                      <dd>{labView.selectedChartKind}</dd>
                    </div>
                    <div className="htt-detail-row">
                      <dt>Coordinate kinds</dt>
                      <dd className="htt-detail-mono">{geometryModeDefinition.coordinateKinds.join(" / ")}</dd>
                    </div>
                    <div className="htt-detail-row">
                      <dt>Divergence kind</dt>
                      <dd className="htt-detail-mono">{geometryModeDefinition.divergenceKinds.join(" / ")}</dd>
                    </div>
                    <div className="htt-detail-row">
                      <dt>Barycenter mode</dt>
                      <dd>
                        {`${barycenterSourceModeLabel(grammarBarycenterSourceMode)} / ${barycenterWeightModeLabel(
                          grammarWeightMode,
                        )}`}
                      </dd>
                    </div>
                    <div className="htt-detail-row">
                      <dt>Flow mode</dt>
                      <dd>{flowModeLabel(labView.selectedFlowMode)}</dd>
                    </div>
                    <div className="htt-detail-row">
                      <dt>Projection / Lean</dt>
                      <dd className="htt-detail-mono">{grammarProjectionMode}</dd>
                    </div>
                    <div className="htt-detail-row">
                      <dt>Scalar field</dt>
                      <dd>{scalarFieldLabel(labView.selectedScalarField)}</dd>
                    </div>
                    <div className="htt-detail-row">
                      <dt>Weight mode</dt>
                      <dd>{barycenterWeightModeLabel(grammarWeightMode)}</dd>
                    </div>
                    <div className="htt-detail-row">
                      <dt>Support profile</dt>
                      <dd className="htt-detail-mono">
                        {`barycenter ${supportLevelLabel(geometryModeDefinition.barycenterSupport)} / flow ${supportLevelLabel(
                          geometryModeDefinition.flowSupport,
                        )} / regression ${supportLevelLabel(geometryModeDefinition.regressionSupport)}`}
                      </dd>
                    </div>
                    <div className="htt-detail-row">
                      <dt>Singularity flags</dt>
                      <dd className="htt-detail-mono">
                        {[
                          selectedFragment?.catastrophe ? "catastrophe-flagged" : undefined,
                          grammarInstability.catastropheCandidate ? "catastrophe-candidate" : undefined,
                          grammarInstability.singularityCandidate ? "singularity-candidate" : undefined,
                          grammarInstability.highCurvature ? "high-curvature" : undefined,
                          grammarInstability.projectionSpike ? "projection-spike" : undefined,
                        ]
                          .filter(Boolean)
                          .join(" / ") || "none"}
                      </dd>
                    </div>
                    <div className="htt-detail-row">
                      <dt>Invariance assumptions</dt>
                      <dd className="htt-detail-mono">{grammarAssumptions.join(" / ")}</dd>
                    </div>
                  </dl>
                </details>

                <dl className="htt-detail-list htt-lab-inspector-group">
                  <div className="htt-detail-row">
                    <dt>Fragment</dt>
                    <dd className="htt-detail-mono">{selectedFragment.id}</dd>
                  </div>
                  <div className="htt-detail-row">
                    <dt>Proposal</dt>
                    <dd className="htt-detail-mono">{selectedProposal?.id ?? "none"}</dd>
                  </div>
                  <div className="htt-detail-row">
                    <dt>Tick</dt>
                    <dd className="htt-detail-mono">{inspectorTick}</dd>
                  </div>
                  <div className="htt-detail-row">
                    <dt>theta</dt>
                    <dd className="htt-detail-mono">{formatVectorCompact(inspectorTheta, 10)}</dd>
                  </div>
                  <div className="htt-detail-row">
                    <dt>eta</dt>
                    <dd className="htt-detail-mono">{formatVectorCompact(inspectorEta, 10)}</dd>
                  </div>
                  <div className="htt-detail-row">
                    <dt>Lean</dt>
                    <dd>
                      <span className="htt-status-pill" data-tone={statusTone(lean?.status)}>
                        {lean?.status ?? "TS fallback"}
                      </span>
                    </dd>
                  </div>
                </dl>

                {activeBarycenterRecord ? (
                  <dl className="htt-detail-list htt-lab-inspector-group">
                    <div className="htt-detail-row">
                      <dt>Barycenter</dt>
                      <dd className="htt-detail-mono">{activeBarycenterRecord.result.method}</dd>
                    </div>
                    <div className="htt-detail-row">
                      <dt>Source mode</dt>
                      <dd>{barycenterSourceModeLabel(activeBarycenterRecord.inputs.sourceMode)}</dd>
                    </div>
                    <div className="htt-detail-row">
                      <dt>Weight mode</dt>
                      <dd>{barycenterWeightModeLabel(activeBarycenterRecord.inputs.weightMode)}</dd>
                    </div>
                    <div className="htt-detail-row">
                      <dt>Cluster size</dt>
                      <dd className="htt-detail-mono">{activeBarycenterRecord.inputs.sites.length}</dd>
                    </div>
                    <div className="htt-detail-row">
                      <dt>bary theta</dt>
                      <dd className="htt-detail-mono">{formatVectorCompact(inspectorBarycenterTheta, 10)}</dd>
                    </div>
                    <div className="htt-detail-row">
                      <dt>bary eta</dt>
                      <dd className="htt-detail-mono">{formatVectorCompact(inspectorBarycenterEta, 10)}</dd>
                    </div>
                  </dl>
                ) : null}

                <div className="htt-lab-metric-grid htt-lab-inspector-group">
                  <div className="htt-lab-metric-card">
                    <p className="htt-lab-metric-card__label">Forward</p>
                    <p className="htt-lab-metric-card__value">{formatMetric(field?.forward)}</p>
                  </div>
                  <div className="htt-lab-metric-card">
                    <p className="htt-lab-metric-card__label">Reverse</p>
                    <p className="htt-lab-metric-card__value">{formatMetric(field?.reverse)}</p>
                  </div>
                  <div className="htt-lab-metric-card">
                    <p className="htt-lab-metric-card__label">Asymmetry</p>
                    <p className="htt-lab-metric-card__value">{formatMetric(field?.asymmetry)}</p>
                  </div>
                  <div className="htt-lab-metric-card">
                    <p className="htt-lab-metric-card__label">Curvature</p>
                    <p className="htt-lab-metric-card__value">{formatMetric(field?.curvature)}</p>
                  </div>
                  <div className="htt-lab-metric-card">
                    <p className="htt-lab-metric-card__label">Projection</p>
                    <p className="htt-lab-metric-card__value">{formatMetric(field?.projection)}</p>
                  </div>
                  <div className="htt-lab-metric-card">
                    <p className="htt-lab-metric-card__label">Divergence</p>
                    <p className="htt-lab-metric-card__value">{formatMetric(field?.total)}</p>
                  </div>
                </div>

                <dl className="htt-detail-list htt-lab-inspector-group">
                  <div className="htt-detail-row">
                    <dt>Selected view</dt>
                    <dd>{labView.selectedIGViewMode}</dd>
                  </div>
                  <div className="htt-detail-row">
                    <dt>Chart kind</dt>
                    <dd>{labView.selectedChartKind}</dd>
                  </div>
                  <div className="htt-detail-row">
                    <dt>Sample</dt>
                    <dd className="htt-detail-mono">
                      {activeSample
                        ? `${scalarFieldLabel(labView.selectedScalarField)} ${formatMetric(scalarSampleMetric(activeSample, labView.selectedScalarField))}`
                        : "none"}
                    </dd>
                  </div>
                  <div className="htt-detail-row">
                    <dt>Flow mode</dt>
                    <dd>{flowModeLabel(labView.selectedFlowMode)}</dd>
                  </div>
                  <div className="htt-detail-row">
                    <dt>Flow</dt>
                    <dd className="htt-detail-mono">
                      {activeFlowRecord
                        ? `${activeFlowRecord.result.method} / neighborhood ${activeFlowRecord.neighborhood.sites.length}`
                        : "none"}
                    </dd>
                  </div>
                  <div className="htt-detail-row">
                    <dt>Trajectory</dt>
                    <dd>
                      <span
                        className="htt-status-pill"
                        data-tone={trajectoryStatusTone(trajectoryDiagnostics?.indicators)}
                      >
                        {trajectoryStatusLabel(trajectoryDiagnostics?.indicators)}
                      </span>
                    </dd>
                  </div>
                  <div className="htt-detail-row">
                    <dt>Regression</dt>
                    <dd className="htt-detail-mono">
                      {trajectoryDiagnostics
                        ? `${regressionTargetModeLabel(labView.regressionTargetMode)} / ${regressionDisplayModeLabel(
                            labView.regressionDisplayMode,
                          )} / ${trajectoryDiagnostics.fit.method}`
                        : "disabled or insufficient history"}
                    </dd>
                  </div>
                  <div className="htt-detail-row">
                    <dt>Nearest context</dt>
                    <dd className="htt-detail-mono">
                      {nearestInspectorSites.length > 0
                        ? `${nearestInspectorSites.length} ${currentTab === "voronoi" ? "cells" : "sites"} in local neighborhood`
                        : "none"}
                    </dd>
                  </div>
                </dl>

                <div className="htt-lab-metric-grid htt-lab-inspector-group">
                  <div className="htt-lab-metric-card">
                    <p className="htt-lab-metric-card__label">Constructive</p>
                    <p className="htt-lab-metric-card__value">{formatMetric(promise?.constructivePromise)}</p>
                  </div>
                  <div className="htt-lab-metric-card">
                    <p className="htt-lab-metric-card__label">Obstructive</p>
                    <p className="htt-lab-metric-card__value">{formatMetric(promise?.obstructivePromise)}</p>
                  </div>
                  <div className="htt-lab-metric-card">
                    <p className="htt-lab-metric-card__label">Corpus relevance</p>
                    <p className="htt-lab-metric-card__value">
                      {formatMetric(orchestrationSignals?.corpusRelevance ?? corpusSignals?.relevance)}
                    </p>
                  </div>
                  <div className="htt-lab-metric-card">
                    <p className="htt-lab-metric-card__label">Refinement legality</p>
                    <p className="htt-lab-metric-card__value">
                      {formatMetric(orchestrationSignals?.refinementLegality)}
                    </p>
                  </div>
                  <div className="htt-lab-metric-card">
                    <p className="htt-lab-metric-card__label">Gluing fitness</p>
                    <p className="htt-lab-metric-card__value">
                      {formatMetric(orchestrationSignals?.gluingFitness)}
                    </p>
                  </div>
                  <div className="htt-lab-metric-card">
                    <p className="htt-lab-metric-card__label">Holonomy proxy</p>
                    <p className="htt-lab-metric-card__value">
                      {formatMetric(orchestrationSignals?.holonomyProxy)}
                    </p>
                  </div>
                </div>

                {trajectoryDiagnostics ? (
                  <>
                    <div className="htt-lab-metric-grid htt-lab-inspector-group">
                      <div className="htt-lab-metric-card">
                        <p className="htt-lab-metric-card__label">Fit score</p>
                        <p className="htt-lab-metric-card__value">{formatMetric(trajectoryDiagnostics.fit.score)}</p>
                      </div>
                      <div className="htt-lab-metric-card">
                        <p className="htt-lab-metric-card__label">Residual mean</p>
                        <p className="htt-lab-metric-card__value">
                          {formatMetric(trajectoryDiagnostics.indicators.residualMean)}
                        </p>
                      </div>
                      <div className="htt-lab-metric-card">
                        <p className="htt-lab-metric-card__label">Tail residual</p>
                        <p className="htt-lab-metric-card__value">
                          {formatMetric(trajectoryDiagnostics.indicators.residualTailMean)}
                        </p>
                      </div>
                      <div className="htt-lab-metric-card">
                        <p className="htt-lab-metric-card__label">Velocity</p>
                        <p className="htt-lab-metric-card__value">
                          {formatMetric(trajectoryDiagnostics.indicators.velocityMean)}
                        </p>
                      </div>
                      <div className="htt-lab-metric-card">
                        <p className="htt-lab-metric-card__label">Convergence</p>
                        <p className="htt-lab-metric-card__value">
                          {formatMetric(trajectoryDiagnostics.indicators.convergenceRatio)}
                        </p>
                      </div>
                      <div className="htt-lab-metric-card">
                        <p className="htt-lab-metric-card__label">Path efficiency</p>
                        <p className="htt-lab-metric-card__value">
                          {formatMetric(trajectoryDiagnostics.indicators.pathEfficiency)}
                        </p>
                      </div>
                    </div>

                    <dl className="htt-detail-list htt-lab-inspector-group">
                      <div className="htt-detail-row">
                        <dt>Trajectory samples</dt>
                        <dd className="htt-detail-mono">{trajectoryDiagnostics.samples.length}</dd>
                      </div>
                      <div className="htt-detail-row">
                        <dt>Oscillation ratio</dt>
                        <dd className="htt-detail-mono">
                          {formatMetric(trajectoryDiagnostics.indicators.oscillationRatio)}
                        </dd>
                      </div>
                      <div className="htt-detail-row">
                        <dt>Acceleration</dt>
                        <dd className="htt-detail-mono">
                          {formatMetric(trajectoryDiagnostics.indicators.accelerationMean)}
                        </dd>
                      </div>
                      <div className="htt-detail-row">
                        <dt>Drift</dt>
                        <dd className="htt-detail-mono">
                          {`${trajectoryDiagnostics.indicators.drifting ? "yes" : "no"} / net ${formatMetric(
                            trajectoryDiagnostics.indicators.netDisplacement,
                          )} / path ${formatMetric(trajectoryDiagnostics.indicators.pathLength)}`}
                        </dd>
                      </div>
                      <div className="htt-detail-row">
                        <dt>Singularity</dt>
                        <dd className="htt-detail-mono">
                          {trajectoryDiagnostics.indicators.singularityApproachCandidate
                            ? "approach candidate"
                            : "no candidate"}
                        </dd>
                      </div>
                    </dl>
                  </>
                ) : null}

                <dl className="htt-detail-list htt-lab-inspector-group">
                  <div className="htt-detail-row">
                    <dt>DEC</dt>
                    <dd className="htt-detail-mono">
                      {`boundary ${formatMetric(orchestrationSignals?.boundaryCompatibility)} / coface ${formatMetric(orchestrationSignals?.cofaceCompatibility)} / gluing ${formatMetric(orchestrationSignals?.gluingFitness)}`}
                    </dd>
                  </div>
                  <div className="htt-detail-row">
                    <dt>Refinement</dt>
                    <dd className="htt-detail-mono">
                      {`legal ${formatMetric(orchestrationSignals?.refinementLegality)} / consistency ${formatMetric(orchestrationSignals?.projectionConsistency)} / branch ${formatMetric(orchestrationSignals?.branchAdmissibility)} / compression ${formatMetric(orchestrationSignals?.metricCompressionGain)}`}
                    </dd>
                  </div>
                  <div className="htt-detail-row">
                    <dt>Control</dt>
                    <dd className="htt-detail-mono">
                      {`reset ${formatMetric(orchestrationSignals?.resetBurden)} / group ${formatMetric(orchestrationSignals?.groupLikeStability)} / generator ${formatMetric(orchestrationSignals?.generatorComplexity)} / cascade ${formatMetric(orchestrationSignals?.cascadeDepth)}`}
                    </dd>
                  </div>
                  <div className="htt-detail-row">
                    <dt>Spectral</dt>
                    <dd className="htt-detail-mono">
                      {typeof orchestrationSignals?.kernelConsistency === "number" ||
                      typeof orchestrationSignals?.spectralStability === "number" ||
                      typeof orchestrationSignals?.toeplitzCoherence === "number" ||
                      typeof orchestrationSignals?.smearletFitness === "number" ||
                      typeof orchestrationSignals?.rkhsGrowthTendency === "number"
                        ? `kernel ${formatMetric(orchestrationSignals?.kernelConsistency)} / stability ${formatMetric(orchestrationSignals?.spectralStability)} / toeplitz ${formatMetric(orchestrationSignals?.toeplitzCoherence)} / smearlet ${formatMetric(orchestrationSignals?.smearletFitness)} / rkhs ${formatMetric(orchestrationSignals?.rkhsGrowthTendency)}`
                        : "not persisted for this proposal"}
                    </dd>
                  </div>
                  <div className="htt-detail-row">
                    <dt>Lean paths</dt>
                    <dd className="htt-detail-mono">
                      {compactText(lean?.snippetPath, 68) ?? "snippet not generated"}
                      {lean?.stderrPath ? ` / ${compactText(lean.stderrPath, 42)}` : ""}
                    </dd>
                  </div>
                </dl>

                <dl className="htt-detail-list htt-lab-inspector-group">
                  <div className="htt-detail-row">
                    <dt>Cycle participation</dt>
                    <dd className="htt-detail-mono">
                      {topologyExplorer.unresolvedCycle.length > 0
                        ? `${topologyExplorer.unresolvedCycle.length} unresolved cycle links`
                        : "none detected"}
                    </dd>
                  </div>
                  <div className="htt-detail-row">
                    <dt>Obstruction chain</dt>
                    <dd className="htt-detail-mono">
                      {topologyExplorer.obstructionChain.length > 0
                        ? `${topologyExplorer.obstructionChain.length} obstruction steps`
                        : "none detected"}
                    </dd>
                  </div>
                  <div className="htt-detail-row">
                    <dt>Repair chain</dt>
                    <dd className="htt-detail-mono">
                      {topologyExplorer.repairChain.length > 0
                        ? `${topologyExplorer.repairChain.length} repair steps`
                        : "none detected"}
                    </dd>
                  </div>
                  <div className="htt-detail-row">
                    <dt>Resolution chain</dt>
                    <dd className="htt-detail-mono">
                      {topologyExplorer.cancellationChain.length > 0
                        ? `${topologyExplorer.cancellationChain.length} cancellation / resolution steps`
                        : "none detected"}
                    </dd>
                  </div>
                </dl>

                {topologyExplorer.unresolvedCycle.length > 0 ? (
                  <>
                    <p className="htt-app__eyebrow">Unresolved Cycles</p>
                    <div className="htt-lab-sample-list">
                      {topologyExplorer.unresolvedCycle.map((entry) => (
                        <button
                          key={entry.id}
                          className="htt-lab-sample-card"
                          type="button"
                          onClick={() =>
                            focusSharedGeometrySelection({
                              fragmentId: entry.fragmentId,
                              proposalId: entry.proposalId,
                            })
                          }
                        >
                          <span className="htt-lab-sample-card__title">{entry.label}</span>
                          <span className="htt-lab-sample-card__meta">{`${entry.source} / ${entry.detail}`}</span>
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}

                {topologyExplorer.obstructionChain.length > 0 ? (
                  <>
                    <p className="htt-app__eyebrow">Obstruction Chain</p>
                    <div className="htt-lab-sample-list">
                      {topologyExplorer.obstructionChain.map((entry) => (
                        <button
                          key={entry.id}
                          className="htt-lab-sample-card"
                          type="button"
                          onClick={() =>
                            focusSharedGeometrySelection({
                              fragmentId: entry.fragmentId,
                              proposalId: entry.proposalId,
                            })
                          }
                        >
                          <span className="htt-lab-sample-card__title">{entry.label}</span>
                          <span className="htt-lab-sample-card__meta">{`${entry.source} / ${entry.detail}`}</span>
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}

                {topologyExplorer.repairChain.length > 0 ? (
                  <>
                    <p className="htt-app__eyebrow">Repair Chain</p>
                    <div className="htt-lab-sample-list">
                      {topologyExplorer.repairChain.map((entry) => (
                        <button
                          key={entry.id}
                          className="htt-lab-sample-card"
                          type="button"
                          onClick={() =>
                            focusSharedGeometrySelection({
                              fragmentId: entry.fragmentId,
                              proposalId: entry.proposalId,
                            })
                          }
                        >
                          <span className="htt-lab-sample-card__title">{entry.label}</span>
                          <span className="htt-lab-sample-card__meta">{`${entry.source} / ${entry.detail}`}</span>
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}

                {topologyExplorer.cancellationChain.length > 0 ? (
                  <>
                    <p className="htt-app__eyebrow">Cancellation / Resolution</p>
                    <div className="htt-lab-sample-list">
                      {topologyExplorer.cancellationChain.map((entry) => (
                        <button
                          key={entry.id}
                          className="htt-lab-sample-card"
                          type="button"
                          onClick={() =>
                            focusSharedGeometrySelection({
                              fragmentId: entry.fragmentId,
                              proposalId: entry.proposalId,
                            })
                          }
                        >
                          <span className="htt-lab-sample-card__title">{entry.label}</span>
                          <span className="htt-lab-sample-card__meta">{`${entry.source} / ${entry.detail}`}</span>
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}

                {corpusSignals?.sources?.length ? (
                  <>
                    <p className="htt-app__eyebrow">Corpus Support</p>
                    <div className="htt-lab-sample-list">
                      {corpusSignals.sources.map((source, index) => (
                        <div key={`${source.source}_${index}`} className="htt-lab-sample-card">
                          <span className="htt-lab-sample-card__title">{source.source}</span>
                          <span className="htt-lab-sample-card__meta">
                            {`support ${formatMetric(source.similarity)} / ${source.passage ?? "passage unavailable"}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : null}

                {nearestInspectorSites.length > 0 ? (
                  <>
                    <p className="htt-app__eyebrow">{neighborSectionTitle}</p>
                    <div className="htt-lab-sample-list">
                      {nearestInspectorSites.map((site) => (
                        <button
                          key={site.id}
                          className="htt-lab-sample-card"
                          type="button"
                          onClick={() => focusIGSite(site)}
                        >
                          <span className="htt-lab-sample-card__title">{site.label}</span>
                          <span className="htt-lab-sample-card__meta">
                            {`${neighborSectionTitle.slice(0, -1).toLowerCase()} / d ${site.distance.toFixed(2)} / ${site.phase ?? "latent"}`}
                          </span>
                          <span className="htt-lab-sample-card__meta">
                            {`D ${formatMetric(site.divergence)} / A ${formatMetric(site.asymmetry)} / K ${formatMetric(site.curvature)} / P ${formatMetric(site.projection)}`}
                          </span>
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}

                {activeBarycenterWeights.length > 0 ? (
                  <>
                    <p className="htt-app__eyebrow">Barycenter Cluster</p>
                    <div className="htt-lab-sample-list">
                      {activeBarycenterWeights.slice(0, 6).map(({ site, weight }) => (
                        <button
                          key={`barycenter-cluster-${site.id}`}
                          className="htt-lab-sample-card"
                          type="button"
                          onClick={() => focusIGSite(site)}
                        >
                          <span className="htt-lab-sample-card__title">{site.label}</span>
                          <span className="htt-lab-sample-card__meta">
                            {`weight ${formatMetric(weight)} / ${site.sourceKind} / tick ${site.tick}`}
                          </span>
                          <span className="htt-lab-sample-card__meta">
                            {`D ${formatMetric(site.divergence)} / C+ ${formatMetric(site.promiseConstructive)} / C- ${formatMetric(site.promiseObstructive)}`}
                          </span>
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}
              </>
            ) : (
              <p className="htt-empty">Inspector values appear once the lab has an active fragment.</p>
            )}
          </section>

          <section className="htt-section">
            <h2 className="htt-section__title">Providers</h2>
            <div className="htt-provider-chip-row">
              {(["personal-open-llm", "chatgpt", "claude", "lean-verifier"] as ProviderId[]).map((providerId) => (
                <span key={providerId} className="htt-provider-chip" data-provider={providerId}>
                  <span className="htt-provider-chip__glyph">{providerGlyph(providerId)}</span>
                  {providerLabel(providerId)}
                </span>
              ))}
            </div>
          </section>
        </aside>
      </div>

      <section className="htt-app__log htt-log htt-module-shell__history">
        <div className="htt-log__header">
          <div>
            <p className="htt-app__eyebrow">IG History</p>
            <h2 className="htt-section__title">Information Geometry Event Trace</h2>
          </div>
          <span className="htt-badge">{igHistoryFeed.length} entries</span>
        </div>
        <div className="htt-lab-history-filter-row">
          {IG_EVENT_FILTERS.map((filter) => (
            <button
              key={filter.id}
              className={`htt-button ${igEventFilter === filter.id ? "htt-button--primary" : "htt-button--ghost"}`}
              type="button"
              onClick={() => setIgEventFilter(filter.id)}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <div className="htt-log__stream">
          {igHistoryFeed.length > 0 ? (
            igHistoryFeed.slice(0, 16).map((event) => (
              <button
                key={event.id}
                className="htt-log-entry htt-log-entry--interactive"
                data-event-type={event.eventType}
                type="button"
                onClick={() => {
                  setAccumulationPlaying(false);
                  focusSharedGeometrySelection({
                    tick: event.tick,
                    fragmentId: event.fragmentId,
                    proposalId: event.proposalId,
                    freezeCurrentSnapshot: true,
                  });
                  if (event.replayEventId) {
                    selectReplayEvent(event.replayEventId);
                  }
                }}
              >
                <div className="htt-log-entry__tick">Tick {event.tick}</div>
                <div>
                  <p className="htt-log-entry__message">{event.message}</p>
                  <p className="htt-log-entry__meta">
                    {`${event.eventType} / ${event.source}`}
                    {event.proposalId ? ` / ${event.proposalId}` : ""}
                  </p>
                  {event.detail ? <p className="htt-log-entry__metrics">{event.detail}</p> : null}
                </div>
              </button>
            ))
          ) : (
            <p className="htt-empty">IG history will appear here once replay or module events accumulate.</p>
          )}
        </div>
      </section>
    </section>
  );
}
