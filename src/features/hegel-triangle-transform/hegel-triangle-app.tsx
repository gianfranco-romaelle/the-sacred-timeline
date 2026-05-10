import { useEffect, useEffectEvent, useState } from "react";
import "./hegel-triangle-app.css";
import type {
  AppViewState,
  FragmentId,
  FragmentVertex,
  FragmentVertexId,
  InformationGeometryLabBarycenterSourceMode,
  InformationGeometryLabChartKind,
  InformationGeometryLabFlowMode,
  InformationGeometryLabRegressionDisplayMode,
  InformationGeometryLabScalarField,
  InformationGeometryLabTab,
  InformationGeometryLabViewMode,
  InformationGeometryMode,
  SemeioticLens,
  SemeioticOntologyProfile,
  LocalGraphEdge,
  Point2D,
  ReplayFilter,
  ReplayEventId,
  ReplayProviderFilter,
  ReplayLogEntry,
  SemanticProposal,
  SemanticProposalId,
  SimulationState,
  TriangleFragment,
} from "@/types/hegel-triangle";
import { fragmentDepthSummary, selectLocalGraphNeighborhood } from "./sample-data";
import { useHegelTriangleStore } from "./store/hegel-triangle-store";
import {
  computeBregman,
  computeBregmanPythagoreanField,
  computeCatastropheField,
  computeCrystallizationField,
  computeCurvatureProxy,
  computeEta,
  computeNegAdjunctionField,
  interpolateDualSimplexPoint,
  interpolatePrimalSimplexPoint,
  type CrystallizationField,
  type NegAdjunctionField,
} from "./information-geometry";
import { readArtifactText } from "@/persistence/artifact-store";
import { InformationGeometryLabView } from "@/views/InformationGeometryLabView";
import {
  extractSemeioticProfile,
  inferDialecticMoveSemeioticProfile,
  inferProposalSemeioticFromProposal,
} from "@/semeiotic/inference";
import { semeioticLensLabel, semeioticLensValue, semeioticSignature } from "@/semeiotic/ontology";

const SPEED_OPTIONS = [0.5, 1, 2, 4] as const;
const INFORMATION_GEOMETRY_LAB_TABS: Array<{ id: InformationGeometryLabTab; label: string }> = [
  { id: "patches", label: "Patches" },
  { id: "divergence", label: "Divergence" },
  { id: "voronoi", label: "Voronoi" },
  { id: "charts", label: "Charts" },
  { id: "potential", label: "Potential" },
  { id: "history", label: "History" },
];
const INFORMATION_GEOMETRY_MODE_OPTIONS: Array<{ id: InformationGeometryMode; label: string }> = [
  { id: "quadraticBregman", label: "Quadratic Bregman" },
  { id: "fisherRao", label: "Fisher-Rao" },
  { id: "klRelativeEntropy", label: "KL Relative Entropy" },
  { id: "mixtureGeometry", label: "Mixture Geometry" },
  { id: "alphaEmbedding", label: "Alpha Embedding" },
  { id: "lieGroupInvariant", label: "Lie Group Invariant" },
  { id: "kahlerSignal", label: "Kahler Signal" },
  { id: "customExperimental", label: "Custom Experimental" },
];
const INFORMATION_GEOMETRY_VIEW_MODE_OPTIONS: Array<{ id: InformationGeometryLabViewMode; label: string }> = [
  { id: "localPatch", label: "Local Patch" },
  { id: "voronoi", label: "Voronoi" },
  { id: "dualCharts", label: "Dual Charts" },
  { id: "liftedSurface", label: "Lifted Surface" },
  { id: "accumulation", label: "Accumulation" },
];
const INFORMATION_GEOMETRY_SCALAR_OPTIONS: Array<{ id: InformationGeometryLabScalarField; label: string }> = [
  { id: "divergence", label: "Divergence" },
  { id: "asymmetry", label: "Asymmetry" },
  { id: "curvature", label: "Curvature" },
  { id: "projection", label: "Projection" },
  { id: "promiseConstructive", label: "Constructive Promise" },
  { id: "promiseObstructive", label: "Obstructive Promise" },
];
const INFORMATION_GEOMETRY_CHART_OPTIONS: Array<{ id: InformationGeometryLabChartKind; label: string }> = [
  { id: "theta", label: "theta" },
  { id: "eta", label: "eta" },
];
const INFORMATION_GEOMETRY_BARYCENTER_OPTIONS: Array<{
  id: InformationGeometryLabBarycenterSourceMode;
  label: string;
}> = [
  { id: "activeNeighborhood", label: "Active Neighborhood" },
  { id: "selectedVoronoiCell", label: "Selected Voronoi Cell" },
  { id: "selectedProposalCluster", label: "Selected Proposal Cluster" },
  { id: "selectedCorpusSupportCluster", label: "Corpus Support Cluster" },
  { id: "selectedPersistentBranch", label: "Selected Persistent Branch" },
];
const INFORMATION_GEOMETRY_FLOW_OPTIONS: Array<{ id: InformationGeometryLabFlowMode; label: string }> = [
  { id: "proposalFlow", label: "Proposal Flow" },
  { id: "repairFlow", label: "Repair Flow" },
  { id: "obstructionFlow", label: "Obstruction Flow" },
];
const INFORMATION_GEOMETRY_REGRESSION_OPTIONS: Array<{
  id: InformationGeometryLabRegressionDisplayMode;
  label: string;
}> = [
  { id: "fittedCurve", label: "Fitted Curve" },
  { id: "residuals", label: "Residuals" },
  { id: "velocity", label: "Velocity" },
  { id: "convergence", label: "Convergence" },
];
const SEMEIOTIC_LENS_OPTIONS: Array<{ id: SemeioticLens; label: string }> = [
  { id: "triadic", label: "Triadic" },
  { id: "object", label: "Object" },
  { id: "sign_vehicle", label: "Sign Vehicle" },
  { id: "interpretant", label: "Interpretant" },
];

function tone(value?: string) {
  return value ?? "idle";
}

function fragmentPalette(fragment: TriangleFragment) {
  if (fragment.labels.tags.includes("petal-white")) {
    return {
      fill: "rgba(244, 241, 233, 0.84)",
      stroke: "rgba(255, 248, 236, 0.94)",
      depthTint: "rgba(255, 248, 236, 0.18)",
    };
  }

  if (fragment.labels.tags.includes("petal-black")) {
    return {
      fill: "rgba(12, 13, 15, 0.82)",
      stroke: "rgba(112, 116, 124, 0.74)",
      depthTint: "rgba(73, 78, 86, 0.18)",
    };
  }

  const depthFade = Math.max(0.26, 0.58 - fragment.generationDepth * 0.08);

  switch (fragment.status) {
    case "accepted":
      return {
        fill: `rgba(110, 150, 118, ${depthFade})`,
        stroke: "rgba(152, 205, 160, 0.92)",
        depthTint: "rgba(152, 205, 160, 0.18)",
      };
    case "persistent":
      return {
        fill: `rgba(122, 156, 123, ${depthFade})`,
        stroke: "rgba(174, 217, 168, 0.94)",
        depthTint: "rgba(174, 217, 168, 0.2)",
      };
    case "rejected":
      return {
        fill: `rgba(158, 77, 68, ${depthFade})`,
        stroke: "rgba(217, 130, 120, 0.9)",
        depthTint: "rgba(217, 130, 120, 0.18)",
      };
    case "blocked":
      return {
        fill: `rgba(128, 104, 66, ${depthFade})`,
        stroke: "rgba(207, 173, 116, 0.9)",
        depthTint: "rgba(207, 173, 116, 0.18)",
      };
    case "verifying":
      return {
        fill: `rgba(133, 112, 76, ${depthFade})`,
        stroke: "rgba(239, 210, 146, 0.98)",
        depthTint: "rgba(239, 210, 146, 0.2)",
      };
    case "inspecting":
    case "proposing":
      return {
        fill: `rgba(80, 110, 144, ${depthFade})`,
        stroke: "rgba(165, 192, 224, 0.9)",
        depthTint: "rgba(165, 192, 224, 0.18)",
      };
    default:
      return {
        fill: `rgba(63, 87, 112, ${depthFade})`,
        stroke: "rgba(130, 165, 206, 0.84)",
        depthTint: "rgba(130, 165, 206, 0.16)",
      };
  }
}

function graphEdgeColor(edge: LocalGraphEdge) {
  switch (edge.status) {
    case "accepted":
      return "rgba(164, 216, 167, 0.88)";
    case "rejected":
      return "rgba(222, 131, 117, 0.84)";
    case "blocked":
      return "rgba(208, 172, 112, 0.82)";
    case "highlighted":
      return "rgba(240, 216, 154, 0.96)";
    case "dormant":
      return "rgba(126, 136, 145, 0.34)";
    default:
      return "rgba(126, 165, 208, 0.72)";
  }
}

function proposalOutcomeColor(proposal?: SemanticProposal) {
  switch (proposal?.verificationState) {
    case "accepted":
      return "rgba(163, 214, 165, 0.96)";
    case "rejected":
      return "rgba(219, 125, 111, 0.94)";
    case "blocked":
      return "rgba(206, 170, 112, 0.94)";
    case "promising":
      return "rgba(238, 213, 155, 0.98)";
    case "vacuous":
      return "rgba(138, 144, 152, 0.82)";
    case "pending":
    default:
      return "rgba(141, 176, 214, 0.86)";
  }
}

function persistentLayerColor(fragment: TriangleFragment) {
  if (fragment.promotion.layer === "candidate") {
    return "rgba(233, 205, 149, 0.78)";
  }
  return "rgba(170, 223, 175, 0.88)";
}

function latestStubs<T extends { promotedAtTick: number }>(stubs: T[], limit = 3) {
  return [...stubs].sort((left, right) => right.promotedAtTick - left.promotedAtTick).slice(0, limit);
}

function replayOutcomeForEntry(simulation: SimulationState, entry: ReplayLogEntry): ReplayFilter {
  if (entry.eventType === "fragment_promoted") {
    return "accepted";
  }
  if (entry.eventType === "fragment_externalized") {
    return "blocked";
  }
  if (entry.eventType === "fragment_persisted") {
    return "promising";
  }
  if (!entry.proposalId) {
    return "system";
  }
  return simulation.proposals[entry.proposalId]?.verificationState ?? "system";
}

function maxReplayTick(simulation: SimulationState) {
  return simulation.replayLog.reduce((maxTick, entry) => Math.max(maxTick, entry.tick), simulation.activeTick);
}

function filteredReplayEntries(
  simulation: SimulationState,
  filter: ReplayFilter,
  providerFilter: ReplayProviderFilter,
) {
  const entries = [...simulation.replayLog].sort((left, right) => left.tick - right.tick);
  return entries.filter((entry) => {
    const matchesOutcome = filter === "all" || replayOutcomeForEntry(simulation, entry) === filter;
    const matchesProvider =
      providerFilter === "all" || providerSequenceForEntry(entry, simulation).includes(providerFilter);
    return matchesOutcome && matchesProvider;
  });
}

type SemeioticLogFilter = "all" | "semeiotic" | "annotation" | "mismatch" | "summary" | "chain" | "overlay";

function proposalHasHistoricalSemeioticData(proposal?: SemanticProposal) {
  const payload = asRecord(proposal?.payload);
  const orchestration = asRecord(payload?.orchestration);
  const semeioticMoments = Array.isArray(orchestration?.semeioticMoments) ? orchestration.semeioticMoments : undefined;

  return Boolean(payload?.semeiotic) || Boolean(orchestration?.semeiotic) || Boolean(semeioticMoments?.length);
}

function hasHistoricalSemeioticData(simulation: SimulationState) {
  return (
    simulation.replayLog.some((entry) => entry.eventType.startsWith("semeiotic_")) ||
    Object.values(simulation.proposals).some((proposal) => proposalHasHistoricalSemeioticData(proposal))
  );
}

function matchesSemeioticEventFilter(entry: ReplayLogEntry, filter: SemeioticLogFilter) {
  switch (filter) {
    case "semeiotic":
      return entry.eventType.startsWith("semeiotic_");
    case "annotation":
      return (
        entry.eventType === "semeiotic_annotation_created" || entry.eventType === "semeiotic_annotation_updated"
      );
    case "mismatch":
      return entry.eventType === "semeiotic_mismatch_detected";
    case "summary":
      return entry.eventType === "semeiotic_summary_updated";
    case "chain":
      return entry.eventType === "semeiotic_chain_linked";
    case "overlay":
      return entry.eventType === "semeiotic_overlay_toggled";
    case "all":
    default:
      return true;
  }
}

function resolveReplayEvent(
  simulation: SimulationState,
  tick: number,
  filter: ReplayFilter,
  providerFilter: ReplayProviderFilter,
  eventId?: string,
) {
  const entries = filteredReplayEntries(simulation, filter, providerFilter);
  if (entries.length === 0) {
    return undefined;
  }

  if (eventId) {
    const preferred = entries.find((entry) => entry.id === eventId);
    if (preferred) {
      return preferred;
    }
  }

  return [...entries].reverse().find((entry) => entry.tick <= tick) ?? entries[0];
}

function eventChainForEntry(simulation: SimulationState, entry?: ReplayLogEntry) {
  if (!entry) {
    return [];
  }

  const baseEntries = [...simulation.replayLog]
    .filter((candidate) => candidate.tick === entry.tick)
    .sort((left, right) => left.id.localeCompare(right.id));

  if (!entry.proposalId) {
    return baseEntries;
  }

  const proposalChain = baseEntries.filter(
    (candidate) => candidate.proposalId === entry.proposalId || candidate.eventType === "fragment_activated" || candidate.eventType === "neighborhood_inspected" || candidate.eventType === "tick_completed",
  );

  return proposalChain.length > 0 ? proposalChain : baseEntries;
}

function polygonPoints(vertexIds: FragmentVertexId[], vertices: Record<FragmentVertexId, FragmentVertex>) {
  return vertexIds.map((vertexId) => `${vertices[vertexId].point.x},${vertices[vertexId].point.y}`).join(" ");
}

function barycentricPoint(points: Point2D[], weights: number[]) {
  const total = weights.reduce((sum, value) => sum + value, 0) || 1;
  const normalizedWeights = weights.map((value) => value / total);
  return {
    x: normalizedWeights.reduce((sum, weight, index) => sum + points[index].x * weight, 0),
    y: normalizedWeights.reduce((sum, weight, index) => sum + points[index].y * weight, 0),
  };
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function grayscaleColor(value: number) {
  const channel = Math.round(255 * (1 - clamp01(value)));
  return `rgb(${channel}, ${channel}, ${channel})`;
}

type ManifoldPatchSample = {
  point: Point2D;
  primal: { theta: number[]; eta: number[] };
  dual: { theta: number[]; eta: number[] };
  field: NegAdjunctionField;
  weights: [number, number, number];
};

type ManifoldPetalDescriptor = {
  path: string;
  fill: string;
  opacity: number;
  label: string;
};

type ManifoldPatchDescriptor = {
  gradientId: string;
  biasGradientId: string;
  coreGradientId: string;
  noisePatternId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  biasX1: number;
  biasY1: number;
  biasX2: number;
  biasY2: number;
  lowColor: string;
  midColor: string;
  highColor: string;
  skewOffset: number;
  biasOpacity: number;
  coreOpacity: number;
  coreCx: number;
  coreCy: number;
  coreRadius: number;
  coreScaleX: number;
  coreScaleY: number;
  noiseOpacity: number;
  noiseSpacing: number;
  noiseDotRadius: number;
  noiseRotation: number;
  phaseRegionPath?: string;
  phaseRegionMode?: "nucleating" | "crystallizing";
  phaseRegionOpacity: number;
  resolvedPhase: TriangleFragment["phase"];
  showPetals: boolean;
  centerField: NegAdjunctionField;
  crystallization: CrystallizationField;
  petals: ManifoldPetalDescriptor[];
};

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

function previousProjectionEstimate(current: number, fragment: TriangleFragment, proposal?: SemanticProposal) {
  switch (proposal?.verificationState ?? fragment.status) {
    case "accepted":
    case "persistent":
    case "promising":
    case "verifying":
    case "vacuous":
      return current + 0.08;
    case "blocked":
    case "rejected":
      return Math.max(0, current - 0.02);
    default:
      return current;
  }
}

function manifoldPatchSamples(fragment: TriangleFragment, simulation: SimulationState): ManifoldPatchSample[] {
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
      point: barycentricPoint(vertexPoints, sampleWeights),
      primal,
      dual,
      field: computeNegAdjunctionField({ F: primal, G: dual }, undefined, projectionDivergence),
      weights: sampleWeights,
    };
  });
}

function mergeVisualField(
  baseField: NegAdjunctionField,
  override?: DivergenceFieldSignal,
): NegAdjunctionField {
  if (!override) {
    return baseField;
  }

  const forward = override.forward ?? baseField.forward;
  const reverse = override.reverse ?? baseField.reverse;
  const projection =
    override.projection ?? baseField.projection ?? baseField.projectionDivergence ?? 0;

  return {
    forward,
    reverse,
    asymmetry: override.asymmetry ?? baseField.asymmetry ?? Math.abs(forward - reverse),
    curvature: override.curvature ?? baseField.curvature,
    projection,
    projectionDivergence: projection,
    total: override.total ?? baseField.total ?? forward + reverse + projection,
  };
}

function petalPath(center: Point2D, direction: "north" | "east" | "south" | "west", size: number, breadth: number) {
  switch (direction) {
    case "north":
      return `M ${center.x} ${center.y} Q ${center.x - breadth} ${center.y - size * 0.42} ${center.x} ${center.y - size} Q ${center.x + breadth} ${center.y - size * 0.42} ${center.x} ${center.y} Z`;
    case "south":
      return `M ${center.x} ${center.y} Q ${center.x - breadth} ${center.y + size * 0.42} ${center.x} ${center.y + size} Q ${center.x + breadth} ${center.y + size * 0.42} ${center.x} ${center.y} Z`;
    case "east":
      return `M ${center.x} ${center.y} Q ${center.x + size * 0.42} ${center.y - breadth} ${center.x + size} ${center.y} Q ${center.x + size * 0.42} ${center.y + breadth} ${center.x} ${center.y} Z`;
    case "west":
    default:
      return `M ${center.x} ${center.y} Q ${center.x - size * 0.42} ${center.y - breadth} ${center.x - size} ${center.y} Q ${center.x - size * 0.42} ${center.y + breadth} ${center.x} ${center.y} Z`;
  }
}

function gradientTransform(cx: number, cy: number, scaleX: number, scaleY: number) {
  return `translate(${cx} ${cy}) scale(${scaleX} ${scaleY}) translate(${-cx} ${-cy})`;
}

function pointDistanceSquared(left: Point2D, right: Point2D) {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return dx * dx + dy * dy;
}

function blendPoint(source: Point2D, target: Point2D, t: number): Point2D {
  return {
    x: source.x + (target.x - source.x) * t,
    y: source.y + (target.y - source.y) * t,
  };
}

function midpointPoint(left: Point2D, right: Point2D): Point2D {
  return {
    x: (left.x + right.x) / 2,
    y: (left.y + right.y) / 2,
  };
}

function polygonPath(points: Point2D[]) {
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ") + " Z";
}

function buildManifoldPatchDescriptors(fragments: TriangleFragment[], simulation: SimulationState) {
  const samplesByFragment = new Map<FragmentId, ManifoldPatchSample[]>();
  const visualFieldByFragment = new Map<FragmentId, NegAdjunctionField | undefined>();
  const phaseByFragment = new Map<FragmentId, TriangleFragment["phase"]>();
  let maxTotal = 0;
  let maxAsymmetry = 0;
  let maxForward = 0;
  let maxReverse = 0;

  for (const fragment of fragments) {
    const samples = manifoldPatchSamples(fragment, simulation);
    const fragmentProposal = latestFragmentProposal(fragment, simulation);
    const authoritativeField = divergenceFieldSignal(fragmentProposal, fragment);
    const centerSample = samples[3] ?? samples[samples.length - 1] ?? samples[0];
    const visualField = centerSample ? mergeVisualField(centerSample.field, authoritativeField) : undefined;
    const resolvedPhase =
      authoritativeField?.phase === "latent" ||
      authoritativeField?.phase === "nucleating" ||
      authoritativeField?.phase === "crystallizing" ||
      authoritativeField?.phase === "externalized" ||
      authoritativeField?.phase === "stabilized"
        ? authoritativeField.phase
        : fragment.phase;
    samplesByFragment.set(fragment.id, samples);
    visualFieldByFragment.set(fragment.id, visualField);
    phaseByFragment.set(fragment.id, resolvedPhase);
    for (const sample of samples) {
      maxTotal = Math.max(maxTotal, sample.field.total);
      maxAsymmetry = Math.max(maxAsymmetry, sample.field.asymmetry);
      maxForward = Math.max(maxForward, sample.field.forward);
      maxReverse = Math.max(maxReverse, sample.field.reverse);
    }
    if (visualField) {
      maxTotal = Math.max(maxTotal, visualField.total);
      maxAsymmetry = Math.max(maxAsymmetry, visualField.asymmetry);
      maxForward = Math.max(maxForward, visualField.forward);
      maxReverse = Math.max(maxReverse, visualField.reverse);
    }
  }

  const totalScale = maxTotal > 0 ? maxTotal : 1;
  const asymmetryScale = maxAsymmetry > 0 ? maxAsymmetry : 1;
  const forwardScale = maxForward > 0 ? maxForward : 1;
  const reverseScale = maxReverse > 0 ? maxReverse : 1;
  const descriptors = new Map<FragmentId, ManifoldPatchDescriptor>();

  for (const fragment of fragments) {
    const samples = samplesByFragment.get(fragment.id) ?? [];
    const rankedByTotal = [...samples].sort((left, right) => left.field.total - right.field.total);
    const lowest = rankedByTotal[0];
    const highest = rankedByTotal[rankedByTotal.length - 1];
    const center = samples[3] ?? highest ?? lowest;
    const resolvedField = visualFieldByFragment.get(fragment.id) ?? center?.field;
    const resolvedPhase = phaseByFragment.get(fragment.id) ?? fragment.phase;

    if (!lowest || !highest || !center || !resolvedField) {
      continue;
    }

    const normalizedLowest = clamp01(lowest.field.total / totalScale);
    const normalizedCenter = clamp01(resolvedField.total / totalScale);
    const normalizedHighest = clamp01(highest.field.total / totalScale);
    const normalizedAsymmetry = clamp01(resolvedField.asymmetry / asymmetryScale);
    const normalizedCurvature = clamp01(resolvedField.curvature / 0.18);
    const skewOffset = 50 + Math.round((resolvedField.asymmetry / asymmetryScale) * 24 - 12);
    const fragmentProposal = latestFragmentProposal(fragment, simulation);
    const vertices = fragment.vertexIds.map((vertexId) => simulation.vertices[vertexId]);
    const vertexPoints = vertices.map((vertex) => vertex.point);
    const referencePoints = vertices.map((vertex) => ({
      theta: vertex.theta,
      eta: vertex.eta,
      embedding: vertex.embedding,
    }));
    const curvature = computeCurvatureProxy([
      ...referencePoints,
      { ...center.primal, embedding: center.primal.theta },
      { ...center.dual, embedding: center.dual.theta },
    ]);
    const catastrophe = computeCatastropheField(center.primal.theta);
    const pythagorean = computeBregmanPythagoreanField(center.dual, center.primal, referencePoints[0] ?? center.primal);
    const projectionDivergence = estimateProjectionDivergence(fragment, fragmentProposal);
    const crystallization = computeCrystallizationField({
      previousProjectionDivergence: previousProjectionEstimate(projectionDivergence, fragment, fragmentProposal),
      currentProjectionDivergence: projectionDivergence,
      pythagorean,
      curvature,
      catastrophe,
    });
    const thetaStable = 1 - clamp01(resolvedField.forward / forwardScale);
    const etaStable = 1 - clamp01(resolvedField.reverse / reverseScale);
    const petals: ManifoldPetalDescriptor[] = [
      {
        path: petalPath(fragment.centroid, "north", 18, 7.2),
        fill: "rgb(255, 255, 255)",
        opacity: 0.12 + thetaStable * 0.58,
        label: "theta-stable",
      },
      {
        path: petalPath(fragment.centroid, "east", 18, 7.2),
        fill: "rgb(255, 255, 255)",
        opacity: 0.12 + etaStable * 0.58,
        label: "eta-stable",
      },
      {
        path: petalPath(fragment.centroid, "south", 18, 7.2),
        fill: "rgb(0, 0, 0)",
        opacity: 0.14 + (1 - thetaStable) * 0.62,
        label: "theta-unstable",
      },
      {
        path: petalPath(fragment.centroid, "west", 18, 7.2),
        fill: "rgb(0, 0, 0)",
        opacity: 0.14 + (1 - etaStable) * 0.62,
        label: "eta-unstable",
      },
    ];
    const biasOpacity = 0.06 + normalizedHighest * 0.22 + normalizedAsymmetry * 0.08;
    const coreOpacity =
      resolvedPhase === "nucleating"
        ? 0.28 + normalizedCenter * 0.34 + normalizedCurvature * 0.18
        : 0.08 + normalizedCenter * 0.16 + normalizedCurvature * 0.1;
    const coreShiftWeight = 0.12 + normalizedAsymmetry * 0.24 + normalizedCurvature * 0.12;
    const coreCx = fragment.centroid.x + (highest.point.x - fragment.centroid.x) * coreShiftWeight;
    const coreCy = fragment.centroid.y + (highest.point.y - fragment.centroid.y) * coreShiftWeight;
    const coreRadius = 30 + normalizedCenter * 24 + normalizedCurvature * 18;
    const coreScaleX = 1 + normalizedCurvature * 0.7 + normalizedAsymmetry * 0.28;
    const coreScaleY = Math.max(0.74, 1 - normalizedAsymmetry * 0.22 + normalizedCurvature * 0.18);
    const noiseOpacity = 0.05 + normalizedCurvature * 0.24 + normalizedCenter * 0.06;
    const noiseSpacing = Math.max(7, 15 - normalizedCurvature * 7);
    const noiseDotRadius = 0.8 + normalizedCurvature * 1.55;
    const noiseRotation = -18 + normalizedAsymmetry * 36;
    const dominantVertexIndex = vertexPoints.reduce(
      (bestIndex, point, index, points) =>
        pointDistanceSquared(point, highest.point) < pointDistanceSquared(points[bestIndex], highest.point)
          ? index
          : bestIndex,
      0,
    );
    const flankIndices = [0, 1, 2].filter((index) => index !== dominantVertexIndex);
    const nucleatingRegionPath = polygonPath([
      blendPoint(fragment.centroid, vertexPoints[dominantVertexIndex], 0.68),
      blendPoint(fragment.centroid, vertexPoints[flankIndices[0]], 0.3 + normalizedCurvature * 0.08),
      blendPoint(fragment.centroid, vertexPoints[flankIndices[1]], 0.3 + normalizedCurvature * 0.08),
    ]);
    const crystallizingRegionPath = polygonPath(
      [
        blendPoint(fragment.centroid, midpointPoint(vertexPoints[1], vertexPoints[2]), 0.86),
        blendPoint(fragment.centroid, midpointPoint(vertexPoints[0], vertexPoints[1]), 0.86),
        blendPoint(fragment.centroid, midpointPoint(vertexPoints[0], vertexPoints[2]), 0.86),
      ],
    );
    const phaseRegionMode =
      resolvedPhase === "nucleating"
        ? "nucleating"
        : resolvedPhase === "crystallizing"
          ? "crystallizing"
          : undefined;
    const phaseRegionPath =
      phaseRegionMode === "nucleating"
        ? nucleatingRegionPath
        : phaseRegionMode === "crystallizing"
          ? crystallizingRegionPath
          : undefined;
    const phaseRegionOpacity =
      phaseRegionMode === "nucleating"
        ? 0.24 + normalizedAsymmetry * 0.22 + normalizedCurvature * 0.1
        : phaseRegionMode === "crystallizing"
          ? 0.18 + normalizedCenter * 0.14
          : 0;

    descriptors.set(fragment.id, {
      gradientId: `htt-manifold-patch-${fragment.id}`,
      biasGradientId: `htt-manifold-bias-${fragment.id}`,
      coreGradientId: `htt-manifold-core-${fragment.id}`,
      noisePatternId: `htt-manifold-noise-${fragment.id}`,
      x1: lowest.point.x,
      y1: lowest.point.y,
      x2: highest.point.x,
      y2: highest.point.y,
      biasX1: fragment.centroid.x,
      biasY1: fragment.centroid.y,
      biasX2: highest.point.x,
      biasY2: highest.point.y,
      lowColor: grayscaleColor(normalizedLowest),
      midColor: grayscaleColor(normalizedCenter),
      highColor: grayscaleColor(normalizedHighest),
      skewOffset: Math.max(18, Math.min(82, skewOffset)),
      biasOpacity,
      coreOpacity,
      coreCx,
      coreCy,
      coreRadius,
      coreScaleX,
      coreScaleY,
      noiseOpacity,
      noiseSpacing,
      noiseDotRadius,
      noiseRotation,
      phaseRegionPath,
      phaseRegionMode,
      phaseRegionOpacity,
      resolvedPhase,
      showPetals: resolvedPhase === "externalized",
      centerField: resolvedField,
      crystallization,
      petals,
    });
  }

  return descriptors;
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

function mapPointToFrame(point: Point2D, bounds: ReturnType<typeof pointBounds>, width: number, height: number, padding = 16) {
  const spanX = Math.max(1, bounds.maxX - bounds.minX);
  const spanY = Math.max(1, bounds.maxY - bounds.minY);

  return {
    x: padding + ((point.x - bounds.minX) / spanX) * Math.max(1, width - padding * 2),
    y: height - padding - ((point.y - bounds.minY) / spanY) * Math.max(1, height - padding * 2),
  };
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

function linePath(points: Point2D[]) {
  if (points.length === 0) {
    return "";
  }

  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

function quadraticPotentialValue(theta: number[]) {
  return theta.reduce((sum, value) => sum + 0.5 * value * value, 0);
}

function resolvedFieldForFragment(fragment: TriangleFragment, simulation: SimulationState) {
  const patch = buildManifoldPatchDescriptors([fragment], simulation).get(fragment.id);
  if (patch) {
    return patch.centerField;
  }

  const proposal = latestFragmentProposal(fragment, simulation);
  return divergenceFieldSignal(proposal, fragment);
}

function midpoint(edge: LocalGraphEdge, vertices: SimulationState["vertices"]) {
  const source = vertices[edge.sourceVertexId];
  const target = vertices[edge.targetVertexId];
  return {
    x: (source.point.x + target.point.x) / 2,
    y: (source.point.y + target.point.y) / 2,
  };
}

function endpointPoint(endpoint: SemanticProposal["source"] | SemanticProposal["target"], simulation: SimulationState) {
  if (!endpoint) {
    return undefined;
  }
  if (endpoint.entityType === "vertex") {
    return simulation.vertices[endpoint.vertexId]?.point;
  }
  const edge = simulation.edges[endpoint.edgeId];
  return edge ? midpoint(edge, simulation.vertices) : undefined;
}

function diamondPath(point: Point2D, radius: number) {
  return [
    `M ${point.x} ${point.y - radius}`,
    `L ${point.x + radius} ${point.y}`,
    `L ${point.x} ${point.y + radius}`,
    `L ${point.x - radius} ${point.y}`,
    "Z",
  ].join(" ");
}

function depthLabel(fragment: TriangleFragment) {
  return `d${fragment.generationDepth} / ${fragment.status}`;
}

function latestFragmentProposal(fragment: TriangleFragment, simulation: SimulationState) {
  return fragment.activeProposalIds
    .map((proposalId) => simulation.proposals[proposalId])
    .filter(Boolean)
    .sort((left, right) => right.updatedAtTick - left.updatedAtTick || left.id.localeCompare(right.id))[0];
}

function proposalSymbol(proposal?: SemanticProposal) {
  switch (proposal?.proposalKind) {
    case "candidate_theorem":
      return { glyph: "T", label: "Theorem" };
    case "candidate_definition":
    case "introduce_definition":
      return { glyph: "D", label: "Definition" };
    case "bridge_lemma":
      return { glyph: "L", label: "Lemma" };
    case "projection_rule":
    case "compatibility_claim":
      return { glyph: "C", label: "Corollary" };
    case "obstruction_claim":
      return { glyph: "X", label: "Obstruction" };
    case "refinement_law":
    case "refine_edge":
    case "refine_vertex":
      return { glyph: "R", label: "Refinement" };
    default:
      return undefined;
  }
}

function modeIndicator(
  simulation: SimulationState,
  proposal: SemanticProposal | undefined,
  replayMode: boolean,
) {
  if (replayMode) {
    return { label: "Replay", tone: "replay" };
  }
  if (proposal?.verificationState === "accepted" || proposal?.verificationState === "vacuous") {
    return { label: "Promotion", tone: "promotion" };
  }
  if (
    proposal?.verificationState === "promising" ||
    simulation.runState === "playing" ||
    proposal?.leanTask?.status === "running"
  ) {
    return { label: "Verification", tone: "verification" };
  }
  return { label: "Conjecture", tone: "conjecture" };
}

function proposalKindLabel(proposal?: SemanticProposal) {
  return proposal?.proposalKind.replaceAll("_", " ") ?? "none";
}

type ProviderId = "chatgpt" | "claude" | "personal-open-llm" | "lean-verifier";

interface LeanBoundarySignal {
  outcome?: string;
  simulationOutcome?: string;
  promotionDecision?: string;
  verifierProviderId?: string;
}

interface LeanBridgeSignal {
  status?: string;
  command?: string;
  snippetPath?: string;
  moduleName?: string;
  importLine?: string;
  stdoutPath?: string;
  stderrPath?: string;
  snapshotPath?: string;
  exitCode?: number;
  signal?: string;
  durationMs?: number;
  phase?: string;
  theoremKind?: string;
  sourceVector: number[];
  targetVector: number[];
  repairedVector: number[];
}

interface DivergenceFieldSignal {
  forward?: number;
  reverse?: number;
  asymmetry?: number;
  curvature?: number;
  projection?: number;
  total?: number;
  phase?: string;
}

interface OrchestrationSignal {
  sourceProviders: ProviderId[];
  combinedScore?: number;
  mutationEnergy?: number;
  formalizationStrength?: number;
  critiquePressure?: number;
  architectureCentrality?: number;
  disagreementSignals: string[];
  critiqueFindings: string[];
  assessments: string[];
  leanBoundary?: LeanBoundarySignal;
}

interface SemeioticMismatchSignal {
  id: string;
  kind: string;
  metricKey?: string;
  severity?: number;
  summary: string;
  evidence: string[];
}

interface SemeioticDistributionSignal {
  dominantTerm?: string;
  dominantValence?: string;
  entropy?: number;
  firstness?: number;
  secondness?: number;
  thirdness?: number;
}

interface SemeioticHardSummarySignal {
  objectTerm?: string;
  signTerm?: string;
  interpretantTerm?: string;
  confidence?: number;
}

interface SemeioticRawSourceSignal {
  id: string;
  kind?: string;
  label?: string;
  pointer?: string;
  artifactPath?: string;
  textExcerpt?: string;
}

interface SemeioticComplexitySignal {
  claimCount?: number;
  objectionCount?: number;
  repairCount?: number;
  branchCount?: number;
  mismatchCount?: number;
  triadicEntropy?: number;
  annotationDensity?: number;
  confidenceSpread?: number;
  ontologyAlignmentStrength?: number;
  interpretantInstability?: number;
  objectSignMismatch?: number;
  triadicImbalance?: number;
  internalAmbiguity?: number;
  signEventBranchingComplexity?: number;
  critiqueInducedReinterpretationDepth?: number;
  overallComplexity?: number;
}

interface DialecticalMomentSignal {
  id: string;
  role: string;
  tick?: number;
  provider?: string;
  fragmentId?: string;
  proposalId?: string;
  dialecticMoveId?: string;
  linkedMomentIds: string[];
  hardSummary?: SemeioticHardSummarySignal;
  objectProfile?: SemeioticDistributionSignal;
  signProfile?: SemeioticDistributionSignal;
  interpretantProfile?: SemeioticDistributionSignal;
  summary?: string;
  complexity?: SemeioticComplexitySignal;
  mismatches: SemeioticMismatchSignal[];
  rawSources: SemeioticRawSourceSignal[];
}

interface SemeioticOverlaySignal {
  annotatedProposalIds: Set<SemanticProposalId>;
  annotatedDialecticIds: Set<string>;
  reinterpretationDialecticIds: Set<string>;
  mismatchDialecticIds: Set<string>;
  critiqueRepairDialecticIds: Set<string>;
  branchingDialecticIds: Set<string>;
  summaryByDialecticId: Map<string, string>;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function metricValue(value: unknown) {
  return typeof value === "number" ? value : undefined;
}

function average(values: number[]) {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function asNumberArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number") : [];
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

function formatMetric(value?: number) {
  return typeof value === "number" ? value.toFixed(3) : "0.000";
}

function formatVectorCompact(values?: number[], limit = 6) {
  if (!values || values.length === 0) {
    return "[]";
  }

  const head = values.slice(0, limit).map((value) => Number(value.toFixed(3)).toString());
  const suffix = values.length > limit ? ", ..." : "";
  return `[${head.join(", ")}${suffix}]`;
}

function compactText(value?: string, limit = 180) {
  if (!value) {
    return undefined;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, limit - 1)}...`;
}

function asNullableString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function topologicalHooksForTree(...values: unknown[]) {
  const hookCandidates: Array<Record<string, unknown>> = [];

  for (const value of values) {
    const record = asRecord(value);
    if (!record) {
      continue;
    }

    hookCandidates.push(record);

    const topology = asRecord(record.topology);
    if (topology) {
      hookCandidates.push(topology);
    }

    const homologicalHooks = asRecord(record.homologicalHooks);
    if (homologicalHooks) {
      hookCandidates.push(homologicalHooks);
    }

    const topologicalHooks = asRecord(record.topologicalHooks);
    if (topologicalHooks) {
      hookCandidates.push(topologicalHooks);
    }
  }

  const firstString = (key: string) =>
    hookCandidates.map((candidate) => asNullableString(candidate[key])).find(Boolean);

  return {
    relationType: firstString("relationType"),
    sourceNodeId: firstString("sourceNodeId"),
    targetNodeId: firstString("targetNodeId"),
    cycleHint: firstString("cycleHint"),
    obstructionKind: firstString("obstructionKind"),
    cochainRole: firstString("cochainRole"),
    cancellationRole: firstString("cancellationRole"),
    resolutionStatus: firstString("resolutionStatus"),
  };
}

function proposalTopologyTreeSignal(simulation: SimulationState, proposal?: SemanticProposal) {
  const relatedProposalIds = new Set<SemanticProposalId>();
  const relatedDialecticIds = new Set<string>();

  if (!proposal) {
    return {
      relatedProposalIds,
      relatedDialecticIds,
    };
  }

  const addProposalId = (proposalId?: string) => {
    if (proposalId && simulation.proposals[proposalId as SemanticProposalId]) {
      relatedProposalIds.add(proposalId as SemanticProposalId);
    }
  };

  addProposalId(proposal.id);

  const payload = asRecord(proposal.payload);
  const orchestration = asRecord(payload?.orchestration);
  const proposalHooks = topologicalHooksForTree(proposal, payload, orchestration);

  addProposalId(proposalHooks.sourceNodeId);
  addProposalId(proposalHooks.targetNodeId);

  const rawMoves = Array.isArray(orchestration?.dialecticMoves) ? orchestration.dialecticMoves : [];
  for (const rawMove of rawMoves) {
    const move = asRecord(rawMove);
    const moveId = asNullableString(move?.id);
    const moveRole = asNullableString(move?.role);
    const moveHooks = topologicalHooksForTree(move);
    const targetProposalId = asNullableString(move?.targetProposalId);

    if (
      moveId &&
      (moveHooks.cycleHint ||
        moveHooks.obstructionKind ||
        moveHooks.cancellationRole ||
        moveHooks.resolutionStatus ||
        moveRole === "criticize" ||
        moveRole === "repair" ||
        moveRole === "synthesize")
    ) {
      relatedDialecticIds.add(moveId);
    }

    addProposalId(targetProposalId);
    addProposalId(moveHooks.sourceNodeId);
    addProposalId(moveHooks.targetNodeId);
  }

  const leanHooks = topologicalHooksForTree(payload?.leanBoundary, payload?.leanBridge);
  if (
    leanHooks.cycleHint ||
    leanHooks.obstructionKind ||
    leanHooks.cancellationRole ||
    leanHooks.resolutionStatus
  ) {
    addProposalId(proposal.id);
  }

  return {
    relatedProposalIds,
    relatedDialecticIds,
  };
}

type InspectorTreeNodeKind = "fragment" | "proposal" | "dialectic" | "lean";

interface InspectorTreeNode {
  id: string;
  parentId?: string;
  kind: InspectorTreeNodeKind;
  label: string;
  meta?: string;
  detail?: string;
  metrics?: string;
  tone?: string;
  providerId?: ProviderId;
  fragmentId?: FragmentId;
  proposalId?: SemanticProposalId;
  dialecticalMomentId?: string;
  eventId?: ReplayEventId;
}

interface DialecticMoveSignal {
  id: string;
  providerId?: ProviderId;
  providerRole?: string;
  role: string;
  parentId?: string;
  summary: string;
  extractedClaims: string[];
  extractedObjections: string[];
  extractedRepairs: string[];
  semeiotic?: SemeioticOntologyProfile;
  linkedDialecticalMomentId?: string;
  linkedDialecticalMomentSummary?: string;
}

function fragmentTitle(fragment: TriangleFragment) {
  return fragment.labels.title ?? fragment.labels.short;
}

function fragmentSort(left: TriangleFragment, right: TriangleFragment) {
  if (left.generationDepth !== right.generationDepth) {
    return left.generationDepth - right.generationDepth;
  }
  return fragmentTitle(left).localeCompare(fragmentTitle(right));
}

function proposalSort(left: SemanticProposal, right: SemanticProposal) {
  if (left.createdAtTick !== right.createdAtTick) {
    return left.createdAtTick - right.createdAtTick;
  }
  return left.id.localeCompare(right.id);
}

function fragmentAncestorIds(simulation: SimulationState, fragmentId?: FragmentId) {
  const ids: FragmentId[] = [];
  let currentId = fragmentId;

  while (currentId) {
    const fragment = simulation.fragments[currentId];
    if (!fragment) {
      break;
    }
    ids.unshift(fragment.id);
    currentId = fragment.parentFragmentId;
  }

  return ids;
}

function buildProposalTreeNodes(
  simulation: SimulationState,
  semeioticState?: {
    semeioticsEnabled: boolean;
    selectedLens: SemeioticLens;
    showTreeBadges: boolean;
    semeioticAutoAnnotate: boolean;
    semeioticTreeFilter: AppViewState["semeiotic"]["semeioticTreeFilter"];
    showOnlyAnnotatedMoves: boolean;
  },
) {
  const nodes: InspectorTreeNode[] = [];
  const proposalsByFragment = new Map<FragmentId, SemanticProposal[]>();

  for (const proposal of Object.values(simulation.proposals)) {
    const proposals = proposalsByFragment.get(proposal.fragmentId) ?? [];
    proposals.push(proposal);
    proposalsByFragment.set(proposal.fragmentId, proposals);
  }

  for (const proposals of proposalsByFragment.values()) {
    proposals.sort(proposalSort);
  }

  const appendFragmentBranch = (fragment: TriangleFragment) => {
    nodes.push({
      id: `fragment:${fragment.id}`,
      parentId: fragment.parentFragmentId ? `fragment:${fragment.parentFragmentId}` : undefined,
      kind: "fragment",
      label: fragmentTitle(fragment),
      meta: `depth ${fragment.generationDepth} / ${fragment.phase}`,
      detail: `${fragment.status} / ${fragment.activeProposalIds.length} live proposals`,
      tone: fragment.status,
      fragmentId: fragment.id,
    });

    for (const proposal of proposalsByFragment.get(fragment.id) ?? []) {
      if (!semeioticFilterMatchesProposal(proposal, fragment, semeioticState)) {
        continue;
      }

      const semeioticLens = semeioticState?.selectedLens ?? "triadic";
      const semeiotic =
        semeioticState?.semeioticsEnabled && semeioticState.showTreeBadges
          ? semeioticProfileSignal(proposal, fragment, semeioticState.semeioticAutoAnnotate)
          : undefined;
      nodes.push({
        id: `proposal:${proposal.id}`,
        parentId: `fragment:${fragment.id}`,
        kind: "proposal",
        label: proposal.title,
        meta: `${proposalKindLabel(proposal)} / ${proposal.verificationState}${
          semeiotic ? ` / ${semeioticLensValue(semeiotic, semeioticLens)}` : ""
        }`,
        detail: compactText(proposal.naturalLanguageSummary, 110),
        tone: semeiotic ? semeioticTone(semeiotic) : proposal.verificationState,
        providerId: providerTrafficForProposal(proposal)[0],
        fragmentId: fragment.id,
        proposalId: proposal.id,
      });
    }

    const childFragments = fragment.childFragmentIds
      .map((childId) => simulation.fragments[childId])
      .filter((child): child is TriangleFragment => Boolean(child))
      .sort(fragmentSort);

    for (const childFragment of childFragments) {
      appendFragmentBranch(childFragment);
    }
  };

  const rootFragments = Object.values(simulation.fragments)
    .filter((fragment) => !fragment.parentFragmentId || !simulation.fragments[fragment.parentFragmentId])
    .sort(fragmentSort);

  for (const rootFragment of rootFragments) {
    appendFragmentBranch(rootFragment);
  }

  return nodes;
}

function proposalTreeHighlightIds(
  simulation: SimulationState,
  fragment?: TriangleFragment,
  proposal?: SemanticProposal,
  relatedProposalIds?: Set<SemanticProposalId>,
) {
  const highlightedIds = new Set<string>();
  const targetFragmentId = proposal?.fragmentId ?? fragment?.id;

  for (const ancestorId of fragmentAncestorIds(simulation, targetFragmentId)) {
    highlightedIds.add(`fragment:${ancestorId}`);
  }

  if (proposal) {
    highlightedIds.add(`proposal:${proposal.id}`);
  }

  for (const relatedProposalId of relatedProposalIds ?? []) {
    const relatedProposal = simulation.proposals[relatedProposalId];
    if (!relatedProposal) {
      continue;
    }

    highlightedIds.add(`proposal:${relatedProposalId}`);

    for (const ancestorId of fragmentAncestorIds(simulation, relatedProposal.fragmentId)) {
      highlightedIds.add(`fragment:${ancestorId}`);
    }
  }

  return highlightedIds;
}

function dialecticMoveSignals(proposal?: SemanticProposal, autoAnnotate = false): DialecticMoveSignal[] {
  const payload = asRecord(proposal?.payload);
  const orchestration = asRecord(payload?.orchestration);
  const rawMoves = Array.isArray(orchestration?.dialecticMoves) ? orchestration.dialecticMoves : [];
  const signals: DialecticMoveSignal[] = [];

  for (const rawMove of rawMoves) {
    const move = asRecord(rawMove);
    const id = typeof move?.id === "string" ? move.id : undefined;
    const role = typeof move?.role === "string" ? move.role : undefined;
    if (!move || !id || !role) {
      continue;
    }

    signals.push({
      id,
      providerId: normalizeProviderId(move.provider),
      providerRole: typeof move.providerRole === "string" ? move.providerRole : undefined,
      role,
      parentId: typeof move.parentId === "string" ? move.parentId : undefined,
      summary: typeof move.summary === "string" ? move.summary : `${role} move`,
      extractedClaims: asStringArray(move.extractedClaims),
      extractedObjections: asStringArray(move.extractedObjections),
      extractedRepairs: asStringArray(move.extractedRepairs),
      semeiotic: dialecticMoveSemeiotic(move, autoAnnotate),
      linkedDialecticalMomentId:
        typeof move.linkedDialecticalMomentId === "string" ? move.linkedDialecticalMomentId : undefined,
      linkedDialecticalMomentSummary:
        asNullableString(asRecord(move.linkedDialecticalMoment)?.summary) ??
        asNullableString(asRecord(move.linkedDialecticalMoment)?.id),
    });
  }

  return signals;
}

function dialecticTone(role: string) {
  switch (role) {
    case "propose":
      return "active";
    case "criticize":
      return "blocked";
    case "repair":
      return "accepted";
    case "synthesize":
      return "promising";
    default:
      return "idle";
  }
}

function buildDialecticTreeNodes(
  proposal?: SemanticProposal,
  semeioticState?: {
    semeioticsEnabled: boolean;
    selectedLens: SemeioticLens;
    showTreeBadges: boolean;
    semeioticAutoAnnotate: boolean;
    semeioticTreeFilter: AppViewState["semeiotic"]["semeioticTreeFilter"];
    showOnlyAnnotatedMoves: boolean;
    semeioticOverlayVisible: boolean;
  },
  overlaySignal?: SemeioticOverlaySignal,
) {
  const semeioticLens = semeioticState?.selectedLens ?? "triadic";
  const moves = dialecticMoveSignals(proposal, semeioticState?.semeioticAutoAnnotate ?? false);
  const filter = semeioticState?.semeioticTreeFilter ?? "all";
  const showOnlyAnnotated = semeioticState?.showOnlyAnnotatedMoves ?? false;

  return moves
    .filter((move) => {
      const hasAnnotated = Boolean(move.semeiotic || move.linkedDialecticalMomentId);
      if (showOnlyAnnotated && !hasAnnotated) {
        return false;
      }

      if (filter === "all") {
        return true;
      }

      if (filter === "annotated") {
        return hasAnnotated;
      }

      const objectTerm = move.semeiotic?.object.term;
      const signTerm = move.semeiotic?.signVehicle.term;
      const interpretantTerm = move.semeiotic?.interpretant.term;
      return objectTerm === filter || signTerm === filter || interpretantTerm === filter;
    })
    .map((move) => ({
      id: move.id,
      parentId: move.parentId,
      kind: "dialectic" as const,
      label: move.role,
      meta: `${move.providerRole ? adjunctorProviderRoleLabel(move.providerRole) : move.providerId ? providerLabel(move.providerId) : "provider"} / ${
        move.extractedClaims.length
      } claims / ${move.extractedObjections.length} objections / ${move.extractedRepairs.length} repairs${
        semeioticState?.semeioticsEnabled && semeioticState.showTreeBadges && move.semeiotic
          ? ` / ${semeioticLensValue(move.semeiotic, semeioticLens)}`
          : ""
      }${
        semeioticState?.semeioticOverlayVisible
          ? overlaySignal?.reinterpretationDialecticIds.has(move.id)
            ? " / reinterpret"
            : overlaySignal?.mismatchDialecticIds.has(move.id)
              ? " / mismatch"
              : overlaySignal?.critiqueRepairDialecticIds.has(move.id)
                ? " / critique-repair"
                : overlaySignal?.branchingDialecticIds.has(move.id)
                  ? " / branch"
                  : ""
          : ""
      }`,
      detail: compactText(
        [
          move.summary,
          move.linkedDialecticalMomentSummary ? `semeiotic ${move.linkedDialecticalMomentSummary}` : undefined,
          semeioticState?.semeioticOverlayVisible ? overlaySignal?.summaryByDialecticId.get(move.id) : undefined,
        ]
          .filter(Boolean)
          .join(" / "),
        120,
      ),
      tone:
        semeioticState?.semeioticsEnabled && move.semeiotic ? semeioticTone(move.semeiotic) : dialecticTone(move.role),
      providerId: move.providerId,
      proposalId: proposal?.id,
      fragmentId: proposal?.fragmentId,
      dialecticalMomentId: move.linkedDialecticalMomentId,
    }));
}

function buildLeanChainNodes(simulation: SimulationState, proposal?: SemanticProposal) {
  if (!proposal) {
    return [];
  }

  const leanEntries = [...simulation.replayLog]
    .filter((entry) => entry.proposalId === proposal.id)
    .filter((entry) => Boolean(asRecord(entry.payload)?.leanBridge))
    .sort((left, right) => {
      if (left.tick !== right.tick) {
        return left.tick - right.tick;
      }
      return left.id.localeCompare(right.id);
    });

  let previousNodeId: string | undefined;

  return leanEntries.map((entry) => {
    const leanSignal = leanEventSignal(entry, proposal);
    const geometry = eventGeometrySummary(entry);
    const stageLabel =
      leanSignal?.stage?.replaceAll("_", " ") ??
      entry.eventType.replaceAll("_", " ");
    const node: InspectorTreeNode = {
      id: `lean:${entry.id}`,
      parentId: previousNodeId,
      kind: "lean",
      label: stageLabel,
      meta: `${leanSignal?.status ?? "completed"}${
        leanSignal?.theoremKind ? ` / ${theoremKindLabel(leanSignal.theoremKind)}` : ""
      }`,
      detail: compactText(entry.message, 120),
      metrics: geometry
        ? `F ${formatMetric(geometry.forward)} / R ${formatMetric(geometry.reverse)} / A ${formatMetric(
            geometry.asymmetry,
          )} / T ${formatMetric(geometry.total)} / P ${formatMetric(geometry.projection)}`
        : undefined,
      tone: leanSignal?.status ?? "completed",
      providerId: "lean-verifier",
      proposalId: proposal.id,
      fragmentId: proposal.fragmentId,
      eventId: entry.id,
    };

    previousNodeId = node.id;
    return node;
  });
}

function branchHighlightIds(nodes: InspectorTreeNode[], targetId?: string) {
  const highlightedIds = new Set<string>();
  if (!targetId) {
    return highlightedIds;
  }

  const parentById = new Map(nodes.map((node) => [node.id, node.parentId]));
  let currentId: string | undefined = targetId;
  while (currentId) {
    highlightedIds.add(currentId);
    currentId = parentById.get(currentId);
  }

  return highlightedIds;
}

function treeNodeGlyph(kind: InspectorTreeNodeKind) {
  switch (kind) {
    case "fragment":
      return "F";
    case "proposal":
      return "P";
    case "dialectic":
      return "D";
    case "lean":
      return "L";
    default:
      return "?";
  }
}

function InspectorTreeBranch({
  node,
  nodes,
  highlightedIds,
  onNodeClick,
}: {
  node: InspectorTreeNode;
  nodes: InspectorTreeNode[];
  highlightedIds: Set<string>;
  onNodeClick: (node: InspectorTreeNode) => void;
}) {
  const children = nodes.filter((candidate) => candidate.parentId === node.id);

  return (
    <div className="htt-tree__branch">
      <button
        className="htt-tree-node"
        type="button"
        data-kind={node.kind}
        data-highlighted={highlightedIds.has(node.id)}
        data-tone={tone(node.tone)}
        onClick={() => onNodeClick(node)}
      >
        <span className="htt-tree-node__glyph">{treeNodeGlyph(node.kind)}</span>
        <span className="htt-tree-node__body">
          <span className="htt-tree-node__header">
            <span className="htt-tree-node__label">{node.label}</span>
            {node.providerId ? (
              <span className="htt-provider-chip" data-provider={node.providerId}>
                <span className="htt-provider-chip__glyph">{providerGlyph(node.providerId)}</span>
                {providerLabel(node.providerId)}
              </span>
            ) : null}
          </span>
          {node.meta ? <span className="htt-tree-node__meta">{node.meta}</span> : null}
          {node.detail ? <span className="htt-tree-node__detail">{node.detail}</span> : null}
          {node.metrics ? <span className="htt-tree-node__metrics">{node.metrics}</span> : null}
        </span>
      </button>
      {children.length > 0 ? (
        <div className="htt-tree__children">
          {children.map((child) => (
            <InspectorTreeBranch
              key={child.id}
              node={child}
              nodes={nodes}
              highlightedIds={highlightedIds}
              onNodeClick={onNodeClick}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function InspectorTree({
  nodes,
  highlightedIds,
  onNodeClick,
  emptyMessage,
}: {
  nodes: InspectorTreeNode[];
  highlightedIds: Set<string>;
  onNodeClick: (node: InspectorTreeNode) => void;
  emptyMessage: string;
}) {
  if (nodes.length === 0) {
    return <p className="htt-empty">{emptyMessage}</p>;
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  const roots = nodes.filter((node) => !node.parentId || !nodeIds.has(node.parentId));

  return (
    <div className="htt-tree">
      {roots.map((node) => (
        <InspectorTreeBranch
          key={node.id}
          node={node}
          nodes={nodes}
          highlightedIds={highlightedIds}
          onNodeClick={onNodeClick}
        />
      ))}
    </div>
  );
}

function useArtifactText(artifactDirectory: string, artifactPath?: string) {
  const [value, setValue] = useState<string>();

  useEffect(() => {
    let cancelled = false;

    if (!artifactPath) {
      setValue(undefined);
      return undefined;
    }

    void readArtifactText(artifactDirectory, artifactPath).then((nextValue) => {
      if (!cancelled) {
        setValue(nextValue);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [artifactDirectory, artifactPath]);

  return value;
}

function normalizeProviderId(value: unknown): ProviderId | undefined {
  switch (value) {
    case "chatgpt":
    case "claude":
    case "personal-open-llm":
    case "lean-verifier":
      return value;
    default:
      return undefined;
  }
}

function providerIdsFromUnknown(value: unknown) {
  return asStringArray(value)
    .map((entry) => normalizeProviderId(entry))
    .filter((entry): entry is ProviderId => Boolean(entry));
}

function uniqueProviders(providers: ProviderId[]) {
  return Array.from(new Set(providers));
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

function providerRoleLabel(providerId: ProviderId) {
  switch (providerId) {
    case "chatgpt":
      return "synthesis";
    case "claude":
      return "critique";
    case "personal-open-llm":
      return "library-conditioned proposer";
    case "lean-verifier":
      return "verification";
    default:
      return "provider";
  }
}

function adjunctorProviderRoleLabel(value?: string) {
  switch (value) {
    case "proposal_synthesizer":
      return "formal synthesizer";
    case "semantic_critic":
      return "semantic critic";
    case "local_mutation_engine":
      return "library-conditioned proposer";
    case "lean_legality_boundary":
      return "Lean outcome";
    default:
      return value?.replaceAll("_", " ") ?? "provider";
  }
}

function theoremKindLabel(value?: string) {
  switch (value) {
    case "quadratic_nonnegativity_check":
      return "quadratic nonnegativity";
    case "projection_skeleton_check":
      return "projection skeleton";
    case "bridge_lemma":
      return "bridge lemma";
    case "projection_rule":
      return "projection law";
    case "compatibility_claim":
      return "projection law";
    case "obstruction_claim":
      return "obstruction candidate";
    default:
      return value?.replaceAll("_", " ") ?? "lean artifact";
  }
}

function semeioticProfileSignal(
  proposal?: SemanticProposal,
  fragment?: TriangleFragment,
  autoAnnotate = false,
): SemeioticOntologyProfile | undefined {
  const payload = asRecord(proposal?.payload);
  const orchestration = asRecord(payload?.orchestration);
  const divergence = asRecord(orchestration?.divergenceField);
  const explicit = extractSemeioticProfile(orchestration?.semeiotic, payload?.semeiotic);

  if (explicit) {
    return explicit;
  }

  if (!autoAnnotate) {
    return undefined;
  }

  return inferProposalSemeioticFromProposal(
    proposal,
    typeof divergence?.phase === "string" ? divergence.phase : fragment?.phase,
  );
}

function dialecticMoveSemeiotic(rawMove: unknown, autoAnnotate = false) {
  const move = asRecord(rawMove);
  if (!move) {
    return undefined;
  }

  const explicit = extractSemeioticProfile(move?.semeiotic, move);
  if (explicit) {
    return explicit;
  }

  if (!autoAnnotate) {
    return undefined;
  }

  return inferDialecticMoveSemeioticProfile({
    role:
      move.role === "criticize" || move.role === "repair" || move.role === "synthesize"
        ? move.role
        : "propose",
    extractedClaims: asStringArray(move.extractedClaims),
    extractedObjections: asStringArray(move.extractedObjections),
    extractedRepairs: asStringArray(move.extractedRepairs),
  });
}

function semeioticTone(profile?: SemeioticOntologyProfile) {
  switch (profile?.interpretant.term) {
    case "delome":
      return "accepted";
    case "dicent":
      return "blocked";
    case "rheme":
    default:
      return "promising";
  }
}

function semeioticDistributionSignal(value: unknown): SemeioticDistributionSignal | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const firstness = metricValue(asRecord(record.firstness)?.weight);
  const secondness = metricValue(asRecord(record.secondness)?.weight);
  const thirdness = metricValue(asRecord(record.thirdness)?.weight);

  return {
    dominantTerm: asNullableString(record.dominantTerm),
    dominantValence: asNullableString(record.dominantValence),
    entropy: metricValue(record.entropy),
    firstness,
    secondness,
    thirdness,
  };
}

function semeioticMomentSignals(proposal?: SemanticProposal): DialecticalMomentSignal[] {
  const payload = asRecord(proposal?.payload);
  const orchestration = asRecord(payload?.orchestration);
  const rawMoments = Array.isArray(orchestration?.semeioticMoments) ? orchestration.semeioticMoments : [];
  const moments: DialecticalMomentSignal[] = [];

  for (const rawMoment of rawMoments) {
    const moment = asRecord(rawMoment);
    if (!moment) {
      continue;
    }

    const complexity = asRecord(moment.complexity);
    const rawMismatches = Array.isArray(moment.mismatches) ? moment.mismatches : [];
    const peirceProfile = asRecord(moment.peirceProfile);
    const hardSummary = asRecord(peirceProfile?.hardSummary);
    const objectSummary = asRecord(hardSummary?.object);
    const signSummary = asRecord(hardSummary?.signVehicle);
    const interpretantSummary = asRecord(hardSummary?.interpretant);
    const rawSources = Array.isArray(moment.rawSources) ? moment.rawSources : [];
    const mismatches: SemeioticMismatchSignal[] = [];
    const parsedRawSources: SemeioticRawSourceSignal[] = [];

    for (const rawMismatch of rawMismatches) {
      const mismatch = asRecord(rawMismatch);
      if (!mismatch) {
        continue;
      }

      mismatches.push({
        id: asNullableString(mismatch.id) ?? "semeiotic_mismatch_unknown",
        kind: asNullableString(mismatch.kind) ?? "unknown",
        ...(asNullableString(mismatch.metricKey) ? { metricKey: asNullableString(mismatch.metricKey) } : {}),
        ...(typeof mismatch.severity === "number" ? { severity: mismatch.severity } : {}),
        summary: asNullableString(mismatch.summary) ?? "Semeiotic mismatch",
        evidence: asStringArray(mismatch.evidence),
      });
    }

    for (const rawSource of rawSources) {
      const source = asRecord(rawSource);
      if (!source) {
        continue;
      }

      parsedRawSources.push({
        id: asNullableString(source.id) ?? "semeiotic_source_unknown",
        kind: asNullableString(source.kind) ?? undefined,
        label: asNullableString(source.label) ?? undefined,
        pointer: asNullableString(source.pointer) ?? undefined,
        artifactPath: asNullableString(source.artifactPath) ?? undefined,
        textExcerpt: asNullableString(source.textExcerpt) ?? undefined,
      });
    }

    moments.push({
      id: asNullableString(moment.id) ?? "dialectical_moment_unknown",
      role: asNullableString(moment.role) ?? "derived",
      ...(typeof moment.tick === "number" ? { tick: moment.tick } : {}),
      ...(asNullableString(moment.provider) ? { provider: asNullableString(moment.provider) } : {}),
      ...(asNullableString(moment.fragmentId) ? { fragmentId: asNullableString(moment.fragmentId) } : {}),
      ...(asNullableString(moment.proposalId) ? { proposalId: asNullableString(moment.proposalId) } : {}),
      ...(asNullableString(moment.dialecticMoveId)
        ? { dialecticMoveId: asNullableString(moment.dialecticMoveId) }
        : {}),
      linkedMomentIds: asStringArray(moment.linkedMomentIds),
      ...(hardSummary
        ? {
            hardSummary: {
              objectTerm: asNullableString(objectSummary?.term) ?? undefined,
              signTerm: asNullableString(signSummary?.term) ?? undefined,
              interpretantTerm: asNullableString(interpretantSummary?.term) ?? undefined,
              confidence: metricValue(hardSummary.confidence),
            },
          }
        : {}),
      ...(peirceProfile?.object ? { objectProfile: semeioticDistributionSignal(peirceProfile.object) } : {}),
      ...(peirceProfile?.signVehicle ? { signProfile: semeioticDistributionSignal(peirceProfile.signVehicle) } : {}),
      ...(peirceProfile?.interpretant
        ? { interpretantProfile: semeioticDistributionSignal(peirceProfile.interpretant) }
        : {}),
      ...(asNullableString(moment.summary) ? { summary: asNullableString(moment.summary) } : {}),
      ...(complexity
        ? {
            complexity: {
              claimCount: metricValue(complexity.claimCount),
              objectionCount: metricValue(complexity.objectionCount),
              repairCount: metricValue(complexity.repairCount),
              branchCount: metricValue(complexity.branchCount),
              mismatchCount: metricValue(complexity.mismatchCount),
              triadicEntropy: metricValue(complexity.triadicEntropy),
              annotationDensity: metricValue(complexity.annotationDensity),
              confidenceSpread: metricValue(complexity.confidenceSpread),
              ontologyAlignmentStrength: metricValue(complexity.ontologyAlignmentStrength),
              interpretantInstability: metricValue(complexity.interpretantInstability),
              objectSignMismatch: metricValue(complexity.objectSignMismatch),
              triadicImbalance: metricValue(complexity.triadicImbalance),
              internalAmbiguity: metricValue(complexity.internalAmbiguity),
              signEventBranchingComplexity: metricValue(complexity.signEventBranchingComplexity),
              critiqueInducedReinterpretationDepth: metricValue(complexity.critiqueInducedReinterpretationDepth),
              overallComplexity: metricValue(complexity.overallComplexity),
            },
          }
        : {}),
      mismatches,
      rawSources: parsedRawSources,
    });
  }

  return moments;
}

function averageDefinedMetrics(values: Array<number | undefined>) {
  const defined = values.filter((value): value is number => typeof value === "number");
  return defined.length > 0 ? average(defined) : undefined;
}

function semeioticMomentAggregate(moments: DialecticalMomentSignal[]) {
  if (moments.length === 0) {
    return undefined;
  }

  return {
    momentCount: moments.length,
    mismatchCount: moments.reduce((sum, moment) => sum + moment.mismatches.length, 0),
    ontologyAlignmentStrength: averageDefinedMetrics(
      moments.map((moment) => moment.complexity?.ontologyAlignmentStrength),
    ),
    interpretantInstability: averageDefinedMetrics(
      moments.map((moment) => moment.complexity?.interpretantInstability),
    ),
    objectSignMismatch: averageDefinedMetrics(moments.map((moment) => moment.complexity?.objectSignMismatch)),
    triadicImbalance: averageDefinedMetrics(moments.map((moment) => moment.complexity?.triadicImbalance)),
    internalAmbiguity: averageDefinedMetrics(moments.map((moment) => moment.complexity?.internalAmbiguity)),
    signEventBranchingComplexity: averageDefinedMetrics(
      moments.map((moment) => moment.complexity?.signEventBranchingComplexity),
    ),
    critiqueInducedReinterpretationDepth: averageDefinedMetrics(
      moments.map((moment) => moment.complexity?.critiqueInducedReinterpretationDepth),
    ),
    overallComplexity: averageDefinedMetrics(moments.map((moment) => moment.complexity?.overallComplexity)),
  };
}

function preferredDialecticalMoment(
  moments: DialecticalMomentSignal[],
  preferredId?: string,
): DialecticalMomentSignal | undefined {
  if (preferredId) {
    const matched = moments.find((moment) => moment.id === preferredId);
    if (matched) {
      return matched;
    }
  }

  return moments[moments.length - 1];
}

function semeioticFilterMatchesMoment(
  moment: DialecticalMomentSignal | undefined,
  filter: AppViewState["semeiotic"]["semeioticTreeFilter"],
) {
  if (!moment) {
    return filter === "all";
  }

  if (filter === "all" || filter === "annotated") {
    return true;
  }

  return (
    moment.hardSummary?.objectTerm === filter ||
    moment.hardSummary?.signTerm === filter ||
    moment.hardSummary?.interpretantTerm === filter
  );
}

function semeioticFilterMatchesProposal(
  proposal: SemanticProposal,
  fragment: TriangleFragment,
  semeioticState?: {
    semeioticsEnabled: boolean;
    semeioticAutoAnnotate: boolean;
    semeioticTreeFilter: AppViewState["semeiotic"]["semeioticTreeFilter"];
    showOnlyAnnotatedMoves: boolean;
  },
) {
  if (!semeioticState?.semeioticsEnabled) {
    return true;
  }

  const moments = semeioticMomentSignals(proposal);
  const explicit = semeioticProfileSignal(proposal, fragment, semeioticState.semeioticAutoAnnotate);
  const hasAnnotated = moments.length > 0 || Boolean(explicit);

  if (semeioticState.showOnlyAnnotatedMoves && !hasAnnotated) {
    return false;
  }

  if (semeioticState.semeioticTreeFilter === "all") {
    return true;
  }

  if (semeioticState.semeioticTreeFilter === "annotated") {
    return hasAnnotated;
  }

  if (moments.some((moment) => semeioticFilterMatchesMoment(moment, semeioticState.semeioticTreeFilter))) {
    return true;
  }

  return (
    explicit?.object.term === semeioticState.semeioticTreeFilter ||
    explicit?.signVehicle.term === semeioticState.semeioticTreeFilter ||
    explicit?.interpretant.term === semeioticState.semeioticTreeFilter
  );
}

function buildSemeioticOverlaySignal(
  proposal?: SemanticProposal,
  moments: DialecticalMomentSignal[] = [],
): SemeioticOverlaySignal {
  const annotatedProposalIds = new Set<SemanticProposalId>();
  const annotatedDialecticIds = new Set<string>();
  const reinterpretationDialecticIds = new Set<string>();
  const mismatchDialecticIds = new Set<string>();
  const critiqueRepairDialecticIds = new Set<string>();
  const branchingDialecticIds = new Set<string>();
  const summaryByDialecticId = new Map<string, string>();

  if (!proposal) {
    return {
      annotatedProposalIds,
      annotatedDialecticIds,
      reinterpretationDialecticIds,
      mismatchDialecticIds,
      critiqueRepairDialecticIds,
      branchingDialecticIds,
      summaryByDialecticId,
    };
  }

  if (moments.length > 0) {
    annotatedProposalIds.add(proposal.id);
  }

  const childCounts = new Map<string, number>();
  const momentsById = new Map(moments.map((moment) => [moment.id, moment] as const));

  for (const moment of moments) {
    for (const linkedId of moment.linkedMomentIds) {
      childCounts.set(linkedId, (childCounts.get(linkedId) ?? 0) + 1);
    }

    if (moment.dialecticMoveId) {
      annotatedDialecticIds.add(moment.dialecticMoveId);
      if (moment.hardSummary) {
        summaryByDialecticId.set(
          moment.dialecticMoveId,
          `${moment.hardSummary.objectTerm ?? "?"} / ${moment.hardSummary.signTerm ?? "?"} / ${moment.hardSummary.interpretantTerm ?? "?"}`,
        );
      }
    }

    if (moment.mismatches.length > 0 && moment.dialecticMoveId) {
      mismatchDialecticIds.add(moment.dialecticMoveId);
    }
  }

  for (const moment of moments) {
    const reinterpretation =
      (moment.complexity?.critiqueInducedReinterpretationDepth ?? 0) >= 0.3 ||
      ((moment.role === "repair" || moment.role === "synthesize") && moment.linkedMomentIds.length > 0);

    if (reinterpretation && moment.dialecticMoveId) {
      reinterpretationDialecticIds.add(moment.dialecticMoveId);
      for (const linkedId of moment.linkedMomentIds) {
        const parentMoment = momentsById.get(linkedId);
        if (parentMoment?.dialecticMoveId) {
          reinterpretationDialecticIds.add(parentMoment.dialecticMoveId);
        }
      }
    }

    if ((childCounts.get(moment.id) ?? 0) > 1 && moment.dialecticMoveId) {
      branchingDialecticIds.add(moment.dialecticMoveId);
    }

    if (moment.role === "repair" && moment.dialecticMoveId) {
      critiqueRepairDialecticIds.add(moment.dialecticMoveId);
      for (const linkedId of moment.linkedMomentIds) {
        const parentMoment = momentsById.get(linkedId);
        if (parentMoment?.role === "criticize" && parentMoment.dialecticMoveId) {
          critiqueRepairDialecticIds.add(parentMoment.dialecticMoveId);
        }
      }
    }
  }

  return {
    annotatedProposalIds,
    annotatedDialecticIds,
    reinterpretationDialecticIds,
    mismatchDialecticIds,
    critiqueRepairDialecticIds,
    branchingDialecticIds,
    summaryByDialecticId,
  };
}

function semeioticChainLabels(overlay: SemeioticOverlaySignal) {
  const labels: string[] = [];

  if (overlay.reinterpretationDialecticIds.size > 0) {
    labels.push("reinterpretation");
  }
  if (overlay.mismatchDialecticIds.size > 0) {
    labels.push("mismatch");
  }
  if (overlay.critiqueRepairDialecticIds.size > 0) {
    labels.push("critique-repair");
  }
  if (overlay.branchingDialecticIds.size > 0) {
    labels.push("branching");
  }

  return labels;
}

function orchestrationSignal(proposal?: SemanticProposal): OrchestrationSignal | undefined {
  const payload = asRecord(proposal?.payload);
  const orchestration = asRecord(payload?.orchestration);
  if (!orchestration) {
    return undefined;
  }

  const leanBoundary = asRecord(orchestration.leanBoundary);

  return {
    sourceProviders: uniqueProviders(providerIdsFromUnknown(orchestration.sourceProviders)),
    combinedScore: typeof orchestration.combinedScore === "number" ? orchestration.combinedScore : undefined,
    mutationEnergy: typeof orchestration.mutationEnergy === "number" ? orchestration.mutationEnergy : undefined,
    formalizationStrength:
      typeof orchestration.formalizationStrength === "number" ? orchestration.formalizationStrength : undefined,
    critiquePressure: typeof orchestration.critiquePressure === "number" ? orchestration.critiquePressure : undefined,
    architectureCentrality:
      typeof orchestration.architectureCentrality === "number" ? orchestration.architectureCentrality : undefined,
    disagreementSignals: asStringArray(orchestration.disagreementSignals),
    critiqueFindings: asStringArray(orchestration.critiqueFindings),
    assessments: asStringArray(orchestration.assessments),
    leanBoundary: leanBoundary
      ? {
          outcome: typeof leanBoundary.outcome === "string" ? leanBoundary.outcome : undefined,
          simulationOutcome:
            typeof leanBoundary.simulationOutcome === "string" ? leanBoundary.simulationOutcome : undefined,
          promotionDecision:
            typeof leanBoundary.promotionDecision === "string" ? leanBoundary.promotionDecision : undefined,
          verifierProviderId:
            typeof leanBoundary.verifierProviderId === "string" ? leanBoundary.verifierProviderId : undefined,
        }
      : undefined,
  };
}

function divergenceFieldSignal(
  proposal?: SemanticProposal,
  fragment?: TriangleFragment,
): DivergenceFieldSignal | undefined {
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

function leanBridgeSignal(proposal?: SemanticProposal): LeanBridgeSignal | undefined {
  const payload = asRecord(proposal?.payload);
  const orchestration = asRecord(payload?.orchestration);
  const leanBridge = asRecord(orchestration?.leanBridge);
  if (!leanBridge) {
    return undefined;
  }

  return {
    status: typeof leanBridge.status === "string" ? leanBridge.status : undefined,
    command: typeof leanBridge.command === "string" ? leanBridge.command : undefined,
    snippetPath: typeof leanBridge.snippetPath === "string" ? leanBridge.snippetPath : undefined,
    moduleName: typeof leanBridge.moduleName === "string" ? leanBridge.moduleName : undefined,
    importLine: typeof leanBridge.importLine === "string" ? leanBridge.importLine : undefined,
    stdoutPath: typeof leanBridge.stdoutPath === "string" ? leanBridge.stdoutPath : undefined,
    stderrPath: typeof leanBridge.stderrPath === "string" ? leanBridge.stderrPath : undefined,
    snapshotPath: typeof leanBridge.snapshotPath === "string" ? leanBridge.snapshotPath : undefined,
    exitCode: typeof leanBridge.exitCode === "number" ? leanBridge.exitCode : undefined,
    signal: typeof leanBridge.signal === "string" ? leanBridge.signal : undefined,
    durationMs: typeof leanBridge.durationMs === "number" ? leanBridge.durationMs : undefined,
    phase: typeof leanBridge.phase === "string" ? leanBridge.phase : undefined,
    theoremKind: typeof leanBridge.theoremKind === "string" ? leanBridge.theoremKind : undefined,
    sourceVector: asNumberArray(leanBridge.sourceVector),
    targetVector: asNumberArray(leanBridge.targetVector),
    repairedVector: asNumberArray(leanBridge.repairedVector),
  };
}

function leanEventSignal(entry: ReplayLogEntry, proposal?: SemanticProposal) {
  const payload = asRecord(entry.payload);
  const proposalSignal = leanBridgeSignal(proposal);
  const stage = typeof payload?.leanBridgeStage === "string" ? payload.leanBridgeStage : undefined;
  const status =
    (typeof payload?.leanStatus === "string" ? payload.leanStatus : undefined) ?? proposalSignal?.status;
  const theoremKind =
    (typeof payload?.theoremKind === "string" ? payload.theoremKind : undefined) ?? proposalSignal?.theoremKind;
  const snippetPath =
    (typeof payload?.snippetPath === "string" ? payload.snippetPath : undefined) ?? proposalSignal?.snippetPath;
  const command =
    (typeof payload?.command === "string" ? payload.command : undefined) ?? proposalSignal?.command;
  const stderrPath =
    (typeof payload?.stderrPath === "string" ? payload.stderrPath : undefined) ?? proposalSignal?.stderrPath;
  const sourceVector = asNumberArray(payload?.sourceVector);
  const targetVector = asNumberArray(payload?.targetVector);

  if (!stage && !status && !snippetPath && !command && !stderrPath && sourceVector.length === 0 && targetVector.length === 0) {
    return undefined;
  }

  return {
    stage,
    status,
    theoremKind,
    snippetPath,
    command,
    stderrPath,
    sourceVector: sourceVector.length > 0 ? sourceVector : proposalSignal?.sourceVector ?? [],
    targetVector: targetVector.length > 0 ? targetVector : proposalSignal?.targetVector ?? [],
  };
}

function providerTrafficForProposal(proposal?: SemanticProposal) {
  const signal = orchestrationSignal(proposal);
  const providers = [...(signal?.sourceProviders ?? [])];
  if (signal?.leanBoundary?.verifierProviderId) {
    const verifierProviderId = normalizeProviderId(signal.leanBoundary.verifierProviderId);
    if (verifierProviderId) {
      providers.push(verifierProviderId);
    }
  } else if (proposal?.leanTask) {
    providers.push("lean-verifier");
  }
  return uniqueProviders(providers);
}

function providerSequenceForEntry(entry: ReplayLogEntry, simulation: SimulationState) {
  const eventPayload = asRecord(entry.payload);
  const payloadProviders = providerIdsFromUnknown(eventPayload?.sourceProviders);
  const proposal = entry.proposalId ? simulation.proposals[entry.proposalId] : undefined;
  const proposalProviders = providerTrafficForProposal(proposal);

  switch (entry.eventType) {
    case "fragment_activated":
    case "neighborhood_inspected":
      return ["personal-open-llm"] as ProviderId[];
    case "proposal_enqueued":
      return uniqueProviders([...payloadProviders, ...proposalProviders]);
    case "geometry_mode_changed":
    case "barycenter_updated":
    case "flow_direction_updated":
    case "trajectory_fit_updated":
    case "voronoi_partition_updated":
    case "dual_chart_sync_updated":
    case "catastrophe_marker_detected":
    case "grammar_state_changed":
    case "ig_snapshot_saved":
      return proposalProviders;
    case "semeiotic_runtime_enabled":
    case "semeiotic_runtime_disabled":
    case "semeiotic_annotation_updated":
    case "semeiotic_annotation_created":
    case "semeiotic_mismatch_detected":
    case "semeiotic_summary_updated":
    case "semeiotic_chain_linked":
    case "semeiotic_overlay_toggled":
      return proposalProviders;
    case "lean_artifact_prepared":
    case "proposal_verified":
      return uniqueProviders([...proposalProviders, "lean-verifier"]);
    case "fragment_promoted":
    case "fragment_externalized":
    case "fragment_persisted":
      return uniqueProviders([...proposalProviders, "lean-verifier"]);
    default:
      return payloadProviders.length > 0 ? payloadProviders : proposalProviders;
  }
}

function stageStepLabel(entry?: ReplayLogEntry) {
  const payload = asRecord(entry?.payload);
  const leanBridgeStage = typeof payload?.leanBridgeStage === "string" ? payload.leanBridgeStage : undefined;

  switch (entry?.eventType) {
    case "fragment_activated":
      return "1 Select";
    case "neighborhood_inspected":
      return "2 Explore";
    case "proposal_enqueued":
      return "3 Synthesize";
    case "geometry_mode_changed":
    case "barycenter_updated":
    case "flow_direction_updated":
    case "trajectory_fit_updated":
    case "voronoi_partition_updated":
    case "dual_chart_sync_updated":
    case "catastrophe_marker_detected":
    case "grammar_state_changed":
    case "ig_snapshot_saved":
      return "IG Atlas";
    case "semeiotic_runtime_enabled":
    case "semeiotic_runtime_disabled":
    case "semeiotic_annotation_updated":
    case "semeiotic_annotation_created":
    case "semeiotic_mismatch_detected":
    case "semeiotic_summary_updated":
    case "semeiotic_chain_linked":
    case "semeiotic_overlay_toggled":
      return "Semeiotic";
    case "lean_artifact_prepared":
      return leanBridgeStage === "run_started" ? "5 Run" : "4 Snippet";
    case "proposal_verified":
      return payload?.leanBridge ? "6 Parse" : "5 Verify";
    case "fragment_promoted":
      return "7 Promote";
    case "fragment_externalized":
      return "7 Externalize";
    case "fragment_persisted":
      return "7 Hold";
    case "tick_completed":
      return "8 Commit";
    default:
      return "Live";
  }
}

function actingProviderSummary(
  simulation: SimulationState,
  replayEvent: ReplayLogEntry | undefined,
  proposal: SemanticProposal | undefined,
) {
  const referenceEvent =
    replayEvent ??
    [...simulation.replayLog].reverse().find((entry) => entry.tick === simulation.activeTick);
  const providers = referenceEvent
    ? providerSequenceForEntry(referenceEvent, simulation)
    : providerTrafficForProposal(proposal);
  const leadProvider = providers[providers.length - 1];

  return {
    stepLabel: stageStepLabel(referenceEvent),
    providers,
    leadProvider,
    label: leadProvider
      ? `${providerLabel(leadProvider)} ${providerRoleLabel(leadProvider)}`
      : "Adjunctor idle",
  };
}

function providerContributionSummary(proposal?: SemanticProposal) {
  const signal = orchestrationSignal(proposal);
  if (!signal) {
    return [];
  }

  return [
    signal.mutationEnergy != null ? `mutation ${signal.mutationEnergy.toFixed(2)}` : undefined,
    signal.formalizationStrength != null ? `formal ${signal.formalizationStrength.toFixed(2)}` : undefined,
    signal.critiquePressure != null ? `critique ${signal.critiquePressure.toFixed(2)}` : undefined,
    signal.architectureCentrality != null ? `central ${signal.architectureCentrality.toFixed(2)}` : undefined,
    signal.combinedScore != null ? `combined ${signal.combinedScore.toFixed(2)}` : undefined,
  ].filter((entry): entry is string => Boolean(entry));
}

function ControlPanel() {
  const simulation = useHegelTriangleStore((state) => state.simulation);
  const view = useHegelTriangleStore((state) => state.view);
  const speedMultiplier = useHegelTriangleStore((state) => state.speedMultiplier);
  const runtimeConfig = useHegelTriangleStore((state) => state.runtimeConfig);
  const runtimeConfigStatus = useHegelTriangleStore((state) => state.runtimeConfigStatus);
  const runtimeConfigDirty = useHegelTriangleStore((state) => state.runtimeConfigDirty);
  const runtimeConfigError = useHegelTriangleStore((state) => state.runtimeConfigError);
  const play = useHegelTriangleStore((state) => state.play);
  const pause = useHegelTriangleStore((state) => state.pause);
  const stepPlayback = useHegelTriangleStore((state) => state.stepPlayback);
  const stepSimulation = useHegelTriangleStore((state) => state.stepSimulation);
  const reset = useHegelTriangleStore((state) => state.reset);
  const setSpeedMultiplier = useHegelTriangleStore((state) => state.setSpeedMultiplier);
  const loadRuntimeConfig = useHegelTriangleStore((state) => state.loadRuntimeConfig);
  const saveRuntimeConfig = useHegelTriangleStore((state) => state.saveRuntimeConfig);
  const updateRuntimeConfig = useHegelTriangleStore((state) => state.updateRuntimeConfig);
  const toggleLabels = useHegelTriangleStore((state) => state.toggleLabels);
  const toggleGraphEdges = useHegelTriangleStore((state) => state.toggleGraphEdges);
  const togglePersistentLayerVisibility = useHegelTriangleStore((state) => state.togglePersistentLayerVisibility);
  const toggleAcceptedOverlay = useHegelTriangleStore((state) => state.toggleAcceptedOverlay);
  const toggleRejectedOverlay = useHegelTriangleStore((state) => state.toggleRejectedOverlay);
  const togglePromoteOnlyAccepted = useHegelTriangleStore((state) => state.togglePromoteOnlyAccepted);
  const toggleKeepPromisingItems = useHegelTriangleStore((state) => state.toggleKeepPromisingItems);
  const clearPersistentLayer = useHegelTriangleStore((state) => state.clearPersistentLayer);
  const toggleSemeioticRuntime = useHegelTriangleStore((state) => state.toggleSemeioticRuntime);
  const setSemeioticLens = useHegelTriangleStore((state) => state.setSemeioticLens);
  const updateSemeioticState = useHegelTriangleStore((state) => state.updateSemeioticState);

  const fragments = Object.values(simulation.fragments);
  const semeioticModuleVisible = view.semeiotic.semeioticsEnabled || hasHistoricalSemeioticData(simulation);

  return (
    <aside className="htt-app__panel">
      <section className="htt-section">
        <h2 className="htt-section__title">Simulation Controls</h2>
        <div className="htt-control-grid">
          <button className="htt-button htt-button--primary" type="button" onClick={play}>
            Play
          </button>
          <button className="htt-button htt-button--ghost" type="button" onClick={pause}>
            Pause
          </button>
          <button className="htt-button htt-button--ghost" type="button" onClick={stepPlayback}>
            Phase
          </button>
          <button className="htt-button htt-button--ghost" type="button" onClick={stepSimulation}>
            Tick
          </button>
          <button className="htt-button htt-button--ghost" type="button" onClick={reset}>
            Reset
          </button>
        </div>
      </section>

      <section className="htt-section">
        <h2 className="htt-section__title">Speed</h2>
        <select
          aria-label="Simulation speed"
          className="htt-select"
          value={speedMultiplier}
          onChange={(event) => setSpeedMultiplier(Number(event.target.value) as (typeof SPEED_OPTIONS)[number])}
        >
          {SPEED_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}x
            </option>
          ))}
        </select>
      </section>

      <section className="htt-section">
        <h2 className="htt-section__title">Runtime Config</h2>
        <div className="htt-form-grid">
          <label className="htt-field">
            <span className="htt-field__label">Live tick window</span>
            <input
              className="htt-input"
              type="number"
              min={1}
              value={runtimeConfig.liveTickWindow}
              onChange={(event) => updateRuntimeConfig({ liveTickWindow: Number(event.target.value) })}
            />
          </label>
          <label className="htt-field">
            <span className="htt-field__label">Max proposals</span>
            <input
              className="htt-input"
              type="number"
              min={1}
              value={runtimeConfig.maxProposalsPerFragment}
              onChange={(event) => updateRuntimeConfig({ maxProposalsPerFragment: Number(event.target.value) })}
            />
          </label>
          <label className="htt-field htt-field--full">
            <span className="htt-field__label">Log directory</span>
            <input
              className="htt-input htt-input--mono"
              type="text"
              value={runtimeConfig.logDirectory}
              onChange={(event) => updateRuntimeConfig({ logDirectory: event.target.value })}
            />
          </label>
          <label className="htt-field htt-field--full">
            <span className="htt-field__label">Artifact directory</span>
            <input
              className="htt-input htt-input--mono"
              type="text"
              value={runtimeConfig.artifactDirectory}
              onChange={(event) => updateRuntimeConfig({ artifactDirectory: event.target.value })}
            />
          </label>
          <label className="htt-field htt-field--full">
            <span className="htt-field__label">Database path</span>
            <input
              className="htt-input htt-input--mono"
              type="text"
              value={runtimeConfig.databasePath}
              onChange={(event) => updateRuntimeConfig({ databasePath: event.target.value })}
            />
          </label>
          <label className="htt-field">
            <span className="htt-field__label">Lean mode</span>
            <select
              className="htt-select"
              value={runtimeConfig.leanRuntimeMode}
              onChange={(event) =>
                updateRuntimeConfig({
                  leanRuntimeMode: event.target.value as "external" | "mock",
                })}
            >
              <option value="external">external</option>
              <option value="mock">mock</option>
            </select>
          </label>
          <label className="htt-field htt-field--full">
            <span className="htt-field__label">Lean command</span>
            <input
              className="htt-input htt-input--mono"
              type="text"
              value={runtimeConfig.leanRuntimeCommand}
              onChange={(event) => updateRuntimeConfig({ leanRuntimeCommand: event.target.value })}
            />
          </label>
        </div>
        <div className="htt-form-grid" style={{ marginTop: "0.9rem" }}>
          <label className="htt-field">
            <span className="htt-field__label">Default geometry mode</span>
            <select
              className="htt-select"
              value={runtimeConfig.defaultGeometryMode}
              onChange={(event) =>
                updateRuntimeConfig({
                  defaultGeometryMode: event.target.value as InformationGeometryMode,
                })}
            >
              {INFORMATION_GEOMETRY_MODE_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="htt-field">
            <span className="htt-field__label">Default IG view</span>
            <select
              className="htt-select"
              value={runtimeConfig.defaultIGViewMode}
              onChange={(event) =>
                updateRuntimeConfig({
                  defaultIGViewMode: event.target.value as InformationGeometryLabViewMode,
                })}
            >
              {INFORMATION_GEOMETRY_VIEW_MODE_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="htt-field">
            <span className="htt-field__label">Default scalar field</span>
            <select
              className="htt-select"
              value={runtimeConfig.defaultScalarField}
              onChange={(event) =>
                updateRuntimeConfig({
                  defaultScalarField: event.target.value as InformationGeometryLabScalarField,
                })}
            >
              {INFORMATION_GEOMETRY_SCALAR_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="htt-field">
            <span className="htt-field__label">Default chart kind</span>
            <select
              className="htt-select"
              value={runtimeConfig.defaultChartKind}
              onChange={(event) =>
                updateRuntimeConfig({
                  defaultChartKind: event.target.value as InformationGeometryLabChartKind,
                })}
            >
              {INFORMATION_GEOMETRY_CHART_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="htt-field">
            <span className="htt-field__label">Default barycenter mode</span>
            <select
              className="htt-select"
              value={runtimeConfig.defaultBarycenterMode}
              onChange={(event) =>
                updateRuntimeConfig({
                  defaultBarycenterMode: event.target.value as InformationGeometryLabBarycenterSourceMode,
                })}
            >
              {INFORMATION_GEOMETRY_BARYCENTER_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="htt-field">
            <span className="htt-field__label">Default flow mode</span>
            <select
              className="htt-select"
              value={runtimeConfig.defaultFlowMode}
              onChange={(event) =>
                updateRuntimeConfig({
                  defaultFlowMode: event.target.value as InformationGeometryLabFlowMode,
                })}
            >
              {INFORMATION_GEOMETRY_FLOW_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="htt-field">
            <span className="htt-field__label">Default regression mode</span>
            <select
              className="htt-select"
              value={runtimeConfig.defaultRegressionMode}
              onChange={(event) =>
                updateRuntimeConfig({
                  defaultRegressionMode: event.target.value as InformationGeometryLabRegressionDisplayMode,
                })}
            >
              {INFORMATION_GEOMETRY_REGRESSION_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="htt-field">
            <span className="htt-field__label">Default semeiotic lens</span>
            <select
              className="htt-select"
              value={runtimeConfig.defaultSemeioticLens}
              onChange={(event) =>
                updateRuntimeConfig({
                  defaultSemeioticLens: event.target.value as SemeioticLens,
                })}
            >
              {SEMEIOTIC_LENS_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="htt-field">
            <span className="htt-field__label">Voronoi grid</span>
            <input
              className="htt-input"
              type="number"
              min={8}
              value={runtimeConfig.voronoiGridResolution}
              onChange={(event) => updateRuntimeConfig({ voronoiGridResolution: Number(event.target.value) })}
            />
          </label>
          <label className="htt-field">
            <span className="htt-field__label">Lifted surface quality</span>
            <input
              className="htt-input"
              type="number"
              min={1}
              value={runtimeConfig.liftedSurfaceQuality}
              onChange={(event) => updateRuntimeConfig({ liftedSurfaceQuality: Number(event.target.value) })}
            />
          </label>
          <label className="htt-field">
            <span className="htt-field__label">Accumulation trail limit</span>
            <input
              className="htt-input"
              type="number"
              min={1}
              value={runtimeConfig.accumulationTrailLimit}
              onChange={(event) => updateRuntimeConfig({ accumulationTrailLimit: Number(event.target.value) })}
            />
          </label>
          <label className="htt-field">
            <span className="htt-field__label">IG snapshot retention</span>
            <input
              className="htt-input"
              type="number"
              min={1}
              value={runtimeConfig.igLabSnapshotRetention}
              onChange={(event) => updateRuntimeConfig({ igLabSnapshotRetention: Number(event.target.value) })}
            />
          </label>
        </div>
        <div className="htt-toggle-list">
          <label className="htt-toggle">
            <span>Semeiotic runtime default</span>
            <input
              checked={runtimeConfig.enableSemeiotics}
              type="checkbox"
              onChange={() =>
                updateRuntimeConfig({
                  enableSemeiotics: !runtimeConfig.enableSemeiotics,
                })}
            />
          </label>
          <label className="htt-toggle">
            <span>Semeiotic auto-annotate</span>
            <input
              checked={runtimeConfig.semeioticAutoAnnotate}
              type="checkbox"
              onChange={() =>
                updateRuntimeConfig({
                  semeioticAutoAnnotate: !runtimeConfig.semeioticAutoAnnotate,
                })}
            />
          </label>
          <label className="htt-toggle">
            <span>Semeiotic log raw outputs</span>
            <input
              checked={runtimeConfig.semeioticLogRawOutputs}
              type="checkbox"
              onChange={() =>
                updateRuntimeConfig({
                  semeioticLogRawOutputs: !runtimeConfig.semeioticLogRawOutputs,
                })}
            />
          </label>
          <label className="htt-toggle">
            <span>Semeiotics influence promise profile</span>
            <input
              checked={runtimeConfig.semeioticInfluencesPromiseProfile}
              type="checkbox"
              onChange={() =>
                updateRuntimeConfig({
                  semeioticInfluencesPromiseProfile: !runtimeConfig.semeioticInfluencesPromiseProfile,
                })}
            />
          </label>
          <label className="htt-toggle">
            <span>Semeiotic inspector visible by default</span>
            <input
              checked={runtimeConfig.semeioticInspectorVisibleByDefault}
              type="checkbox"
              onChange={() =>
                updateRuntimeConfig({
                  semeioticInspectorVisibleByDefault: !runtimeConfig.semeioticInspectorVisibleByDefault,
                })}
            />
          </label>
          <label className="htt-toggle">
            <span>Semeiotic runtime</span>
            <input checked={view.semeiotic.semeioticsEnabled} type="checkbox" onChange={toggleSemeioticRuntime} />
          </label>
          <label className="htt-field">
            <span className="htt-field__label">Active semeiotic lens</span>
            <select
              className="htt-select"
              value={view.semeiotic.selectedLens}
              onChange={(event) => setSemeioticLens(event.target.value as SemeioticLens)}
            >
              {SEMEIOTIC_LENS_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="htt-toggle">
            <span>Persist raw LLM</span>
            <input
              checked={runtimeConfig.persistRawLLM}
              type="checkbox"
              onChange={() => updateRuntimeConfig({ persistRawLLM: !runtimeConfig.persistRawLLM })}
            />
          </label>
          <label className="htt-toggle">
            <span>Persist Lean stdout</span>
            <input
              checked={runtimeConfig.persistRawLeanStdout}
              type="checkbox"
              onChange={() =>
                updateRuntimeConfig({ persistRawLeanStdout: !runtimeConfig.persistRawLeanStdout })}
            />
          </label>
          <label className="htt-toggle">
            <span>Persist Lean stderr</span>
            <input
              checked={runtimeConfig.persistRawLeanStderr}
              type="checkbox"
              onChange={() =>
                updateRuntimeConfig({ persistRawLeanStderr: !runtimeConfig.persistRawLeanStderr })}
            />
          </label>
          <label className="htt-toggle">
            <span>IG Lab accumulates while hidden</span>
            <input
              checked={runtimeConfig.igLabAccumulateWhileHidden}
              type="checkbox"
              onChange={() =>
                updateRuntimeConfig({
                  igLabAccumulateWhileHidden: !runtimeConfig.igLabAccumulateWhileHidden,
                })}
            />
          </label>
        </div>
        <div className="htt-config-actions">
          <button className="htt-button htt-button--ghost" type="button" onClick={() => void loadRuntimeConfig()}>
            Reload Config
          </button>
          <button className="htt-button htt-button--primary" type="button" onClick={() => void saveRuntimeConfig()}>
            Save Config
          </button>
        </div>
        <p className="htt-config-status">
          {runtimeConfigStatus}
          {runtimeConfigDirty ? " / unsaved" : ""}
          {runtimeConfigError ? ` / ${runtimeConfigError}` : ""}
        </p>
      </section>

      <section className="htt-section">
        <h2 className="htt-section__title">Semeiotic Module</h2>
        {semeioticModuleVisible ? (
          <>
            <div className="htt-control-grid">
              <button
                className={`htt-button ${view.semeiotic.semeioticGrammarPanelOpen ? "htt-button--primary" : "htt-button--ghost"}`}
                type="button"
                onClick={() =>
                  updateSemeioticState({
                    semeioticGrammarPanelOpen: !view.semeiotic.semeioticGrammarPanelOpen,
                  })
                }
              >
                {view.semeiotic.semeioticGrammarPanelOpen ? "Hide Semeiotic View" : "Open Semeiotic View"}
              </button>
            </div>
            <div className="htt-toggle-list" style={{ marginTop: "0.8rem" }}>
              <label className="htt-toggle">
                <span>Semeiotic overlay</span>
                <input
                  checked={view.semeiotic.semeioticOverlayVisible}
                  type="checkbox"
                  onChange={(event) =>
                    updateSemeioticState({
                      semeioticOverlayVisible: event.target.checked,
                    })
                  }
                />
              </label>
              <label className="htt-toggle">
                <span>Annotated moves only</span>
                <input
                  checked={view.semeiotic.showOnlyAnnotatedMoves}
                  type="checkbox"
                  onChange={(event) =>
                    updateSemeioticState({
                      showOnlyAnnotatedMoves: event.target.checked,
                    })
                  }
                />
              </label>
              <label className="htt-toggle">
                <span>Show tree badges</span>
                <input
                  checked={view.semeiotic.showTreeBadges}
                  type="checkbox"
                  onChange={(event) =>
                    updateSemeioticState({
                      showTreeBadges: event.target.checked,
                    })
                  }
                />
              </label>
              <label className="htt-toggle">
                <span>Show log badges</span>
                <input
                  checked={view.semeiotic.showLogBadges}
                  type="checkbox"
                  onChange={(event) =>
                    updateSemeioticState({
                      showLogBadges: event.target.checked,
                    })
                  }
                />
              </label>
            </div>
            <div className="htt-form-grid" style={{ marginTop: "0.8rem" }}>
              <label className="htt-field">
                <span className="htt-field__label">Summary mode</span>
                <select
                  className="htt-select"
                  value={view.semeiotic.semeioticSummaryMode}
                  onChange={(event) =>
                    updateSemeioticState({
                      semeioticSummaryMode: event.target.value as AppViewState["semeiotic"]["semeioticSummaryMode"],
                    })
                  }
                >
                  <option value="compact">compact</option>
                  <option value="full">full</option>
                </select>
              </label>
              <label className="htt-field">
                <span className="htt-field__label">Tree filter</span>
                <select
                  className="htt-select"
                  value={view.semeiotic.semeioticTreeFilter}
                  onChange={(event) =>
                    updateSemeioticState({
                      semeioticTreeFilter: event.target.value as AppViewState["semeiotic"]["semeioticTreeFilter"],
                    })
                  }
                >
                  <option value="all">all</option>
                  <option value="annotated">annotated</option>
                  <option value="icon">icon</option>
                  <option value="index">index</option>
                  <option value="symbol">symbol</option>
                  <option value="qualisign">qualisign</option>
                  <option value="sinsign">sinsign</option>
                  <option value="legisign">legisign</option>
                  <option value="rheme">rheme</option>
                  <option value="dicent">dicent</option>
                  <option value="delome">delome</option>
                </select>
              </label>
              <label className="htt-field">
                <span className="htt-field__label">Lens</span>
                <select
                  className="htt-select"
                  value={view.semeiotic.selectedLens}
                  onChange={(event) => setSemeioticLens(event.target.value as SemeioticLens)}
                >
                  {SEMEIOTIC_LENS_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="htt-field">
                <span className="htt-field__label">Tick window</span>
                <input
                  className="htt-input"
                  type="number"
                  min={1}
                  value={view.semeiotic.activeSemeioticTickWindow}
                  onChange={(event) =>
                    updateSemeioticState({
                      activeSemeioticTickWindow: Math.max(1, Number(event.target.value) || 1),
                    })
                  }
                />
              </label>
            </div>
          </>
        ) : (
          <p className="htt-empty">
            Enable semeiotics or reopen historical semeiotic data to access the semeiotic view.
          </p>
        )}
      </section>

      <section className="htt-section">
        <h2 className="htt-section__title">Overlays</h2>
        <div className="htt-toggle-list">
          <label className="htt-toggle">
            <span>Toggle labels</span>
            <input checked={view.showFragmentLabels} type="checkbox" onChange={toggleLabels} />
          </label>
          <label className="htt-toggle">
            <span>Toggle graph edges</span>
            <input checked={view.showGraphEdges} type="checkbox" onChange={toggleGraphEdges} />
          </label>
          <label className="htt-toggle">
            <span>Accepted overlay</span>
            <input checked={view.showAcceptedOverlay} type="checkbox" onChange={toggleAcceptedOverlay} />
          </label>
          <label className="htt-toggle">
            <span>Rejected overlay</span>
            <input checked={view.showRejectedOverlay} type="checkbox" onChange={toggleRejectedOverlay} />
          </label>
          <label className="htt-toggle">
            <span>Persistent layer</span>
            <input checked={view.showPersistentLayer} type="checkbox" onChange={togglePersistentLayerVisibility} />
          </label>
        </div>
      </section>

      <section className="htt-section">
        <h2 className="htt-section__title">Persistent Structure</h2>
        <div className="htt-toggle-list">
          <label className="htt-toggle">
            <span>Promote only accepted</span>
            <input
              checked={simulation.persistentConfig.promoteOnlyAccepted}
              type="checkbox"
              onChange={togglePromoteOnlyAccepted}
            />
          </label>
          <label className="htt-toggle">
            <span>Keep promising items</span>
            <input
              checked={simulation.persistentConfig.keepPromisingItems}
              type="checkbox"
              onChange={toggleKeepPromisingItems}
            />
          </label>
        </div>
        <div className="htt-stat-list">
          <div className="htt-stat">
            <span className="htt-stat__label">Promoted fragments</span>
            <span className="htt-stat__value">{simulation.persistent.promotedFragmentIds.length}</span>
          </div>
          <div className="htt-stat">
            <span className="htt-stat__label">Canonical artifacts</span>
            <span className="htt-stat__value">{simulation.persistent.promotedProposalIds.length}</span>
          </div>
          <div className="htt-stat">
            <span className="htt-stat__label">Holding artifacts</span>
            <span className="htt-stat__value">{simulation.persistent.keptPromisingProposalIds.length}</span>
          </div>
        </div>
        <button className="htt-button htt-button--ghost" type="button" onClick={clearPersistentLayer}>
          Clear persistent layer
        </button>
      </section>

      <section className="htt-section">
        <h2 className="htt-section__title">Simulation Snapshot</h2>
        <div className="htt-stat-list">
          <div className="htt-stat">
            <span className="htt-stat__label">Run state</span>
            <span className="htt-stat__value">{simulation.runState}</span>
          </div>
          <div className="htt-stat">
            <span className="htt-stat__label">Generation depth</span>
            <span className="htt-stat__value">{fragmentDepthSummary(simulation)}</span>
          </div>
          <div className="htt-stat">
            <span className="htt-stat__label">Fragment count</span>
            <span className="htt-stat__value">{fragments.length}</span>
          </div>
          <div className="htt-stat">
            <span className="htt-stat__label">Proposal count</span>
            <span className="htt-stat__value">{Object.keys(simulation.proposals).length}</span>
          </div>
          <div className="htt-stat">
            <span className="htt-stat__label">Accepted</span>
            <span className="htt-stat__value">{simulation.acceptedHistory.length}</span>
          </div>
          <div className="htt-stat">
            <span className="htt-stat__label">Rejected</span>
            <span className="htt-stat__value">{simulation.rejectedHistory.length}</span>
          </div>
        </div>
      </section>
    </aside>
  );
}

function StagePanel() {
  const simulation = useHegelTriangleStore((state) => state.simulation);
  const view = useHegelTriangleStore((state) => state.view);
  const selectFragment = useHegelTriangleStore((state) => state.selectFragment);
  const hoverFragment = useHegelTriangleStore((state) => state.hoverFragment);

  const fragments = Object.values(simulation.fragments).sort((left, right) => {
    if (left.generationDepth !== right.generationDepth) {
      return left.generationDepth - right.generationDepth;
    }
    return left.id.localeCompare(right.id);
  });

  const graphEdges = Object.values(simulation.edges)
    .filter((edge) => edge.kind !== "fragment_boundary")
    .sort((left, right) => left.weight - right.weight);

  const activeProposal = simulation.activeProposalId ? simulation.proposals[simulation.activeProposalId] : undefined;
  const observedEvent =
    view.replay.mode === "live"
      ? view.replay.liveObservedEventId
        ? simulation.replayLog.find((entry) => entry.id === view.replay.liveObservedEventId)
        : [...simulation.replayLog]
            .filter((entry) => entry.tick === simulation.activeTick)
            .sort((left, right) => left.id.localeCompare(right.id))[0]
      : undefined;
  const replayEvent =
    view.replay.mode === "history"
      ? resolveReplayEvent(
          simulation,
          view.replay.tick,
          view.replay.logFilter,
          view.replay.providerFilter,
          view.replay.selectedEventId,
        )
      : undefined;
  const effectiveEvent = replayEvent ?? observedEvent;
  const replayProposal = effectiveEvent?.proposalId ? simulation.proposals[effectiveEvent.proposalId] : undefined;
  const displayProposal = replayProposal ?? activeProposal;
  const selectedProposal = view.selectedProposalId ? simulation.proposals[view.selectedProposalId] : undefined;
  const proposalSourcePoint = displayProposal ? endpointPoint(displayProposal.source, simulation) : undefined;
  const proposalTargetPoint = displayProposal ? endpointPoint(displayProposal.target, simulation) : undefined;
  const stageMode = modeIndicator(simulation, displayProposal, view.replay.mode === "history");
  const actingSummary = actingProviderSummary(simulation, effectiveEvent, displayProposal);
  const persistentFragmentIds = new Set(simulation.persistent.promotedFragmentIds);
  const persistentEdgeIds = new Set(simulation.persistent.acceptedEdgeIds);
  const persistentConnectionIds = new Set(simulation.persistent.acceptedConnectionIds);
  const replayFragmentId = effectiveEvent?.fragmentId ?? replayProposal?.fragmentId;
  const focusFragmentId =
    view.replay.mode === "history"
      ? replayFragmentId ?? view.selectedFragmentId ?? simulation.activeFragmentId
      : view.hoveredFragmentId ?? view.selectedFragmentId ?? simulation.activeFragmentId;
  const neighborhood = focusFragmentId
    ? selectLocalGraphNeighborhood(simulation, focusFragmentId, 1)
    : { fragmentIds: new Set<FragmentId>(), edgeIds: new Set(), vertexIds: new Set<FragmentVertexId>() };
  const manifoldPatchDescriptors = buildManifoldPatchDescriptors(fragments, simulation);

  return (
    <main className="htt-stage">
      <div className="htt-stage__toolbar">
        <div className="htt-stage__badge-row">
          <span className="htt-badge">Fragment Dust</span>
          <span className="htt-badge">Recursive Triangles</span>
          <span className="htt-badge">Depth {fragmentDepthSummary(simulation)}</span>
          <span className={`htt-badge htt-badge--mode htt-badge--${stageMode.tone}`}>Mode {stageMode.label}</span>
          <span className="htt-badge htt-badge--step">{actingSummary.stepLabel}</span>
        </div>
        <div className="htt-stage__badge-row">
          <span className="htt-badge">Active {simulation.activeFragmentId ?? "none"}</span>
          <span className="htt-badge">
            Proposal {displayProposal?.title ?? "none"}
          </span>
          <span className="htt-badge">{actingSummary.label}</span>
          {actingSummary.providers.map((providerId) => (
            <span key={`toolbar-provider-${providerId}`} className="htt-provider-chip" data-provider={providerId}>
              <span className="htt-provider-chip__glyph">{providerGlyph(providerId)}</span>
              {providerLabel(providerId)}
            </span>
          ))}
          {view.replay.mode === "history" ? (
            <span className="htt-badge htt-badge--replay">Replay Tick {view.replay.tick}</span>
          ) : null}
          <span className="htt-badge">Hover {view.hoveredFragmentId ?? "none"}</span>
        </div>
      </div>

      <div className="htt-stage__viewport">
        <svg className="htt-stage__svg" viewBox="0 0 1000 780" role="img" aria-label="Recursive Hegel Triangle Fragment Transform scene">
          <defs>
            <radialGradient id="htt-stage-atmosphere" cx="50%" cy="42%" r="68%">
              <stop offset="0%" stopColor="rgba(231, 214, 182, 0.12)" />
              <stop offset="100%" stopColor="rgba(231, 214, 182, 0)" />
            </radialGradient>
            {fragments.map((fragment) => {
              const patch = manifoldPatchDescriptors.get(fragment.id);
              if (!patch) {
                return null;
              }
              return (
                <>
                  <linearGradient
                    key={patch.gradientId}
                    id={patch.gradientId}
                    gradientUnits="userSpaceOnUse"
                    x1={patch.x1}
                    y1={patch.y1}
                    x2={patch.x2}
                    y2={patch.y2}
                  >
                    <stop offset="0%" stopColor={patch.lowColor} />
                    <stop offset={`${patch.skewOffset}%`} stopColor={patch.midColor} />
                    <stop offset="100%" stopColor={patch.highColor} />
                  </linearGradient>
                  <linearGradient
                    key={patch.biasGradientId}
                    id={patch.biasGradientId}
                    gradientUnits="userSpaceOnUse"
                    x1={patch.biasX1}
                    y1={patch.biasY1}
                    x2={patch.biasX2}
                    y2={patch.biasY2}
                  >
                    <stop offset="0%" stopColor="rgba(255, 255, 255, 0)" />
                    <stop offset="55%" stopColor={`rgba(16, 16, 16, ${Math.min(0.32, patch.biasOpacity * 0.8)})`} />
                    <stop offset="100%" stopColor={`rgba(0, 0, 0, ${Math.min(0.56, patch.biasOpacity)})`} />
                  </linearGradient>
                  <radialGradient
                    key={patch.coreGradientId}
                    id={patch.coreGradientId}
                    gradientUnits="userSpaceOnUse"
                    cx={patch.coreCx}
                    cy={patch.coreCy}
                    r={patch.coreRadius}
                    fx={patch.coreCx}
                    fy={patch.coreCy}
                    gradientTransform={gradientTransform(
                      patch.coreCx,
                      patch.coreCy,
                      patch.coreScaleX,
                      patch.coreScaleY,
                    )}
                  >
                    <stop offset="0%" stopColor={`rgba(0, 0, 0, ${Math.min(0.86, patch.coreOpacity)})`} />
                    <stop offset="52%" stopColor={`rgba(16, 16, 16, ${Math.min(0.5, patch.coreOpacity * 0.7)})`} />
                    <stop offset="100%" stopColor="rgba(0, 0, 0, 0)" />
                  </radialGradient>
                  <pattern
                    key={patch.noisePatternId}
                    id={patch.noisePatternId}
                    patternUnits="userSpaceOnUse"
                    width={patch.noiseSpacing}
                    height={patch.noiseSpacing}
                    patternTransform={`rotate(${patch.noiseRotation})`}
                  >
                    <rect width={patch.noiseSpacing} height={patch.noiseSpacing} fill="rgba(0, 0, 0, 0)" />
                    <circle
                      cx={patch.noiseSpacing * 0.28}
                      cy={patch.noiseSpacing * 0.38}
                      r={patch.noiseDotRadius}
                      fill="rgba(12, 12, 12, 0.78)"
                    />
                    <circle
                      cx={patch.noiseSpacing * 0.76}
                      cy={patch.noiseSpacing * 0.68}
                      r={patch.noiseDotRadius * 0.78}
                      fill="rgba(24, 24, 24, 0.62)"
                    />
                    <path
                      d={`M 0 ${patch.noiseSpacing * 0.14} L ${patch.noiseSpacing * 0.42} 0`}
                      stroke="rgba(18, 18, 18, 0.42)"
                      strokeWidth="0.8"
                    />
                  </pattern>
                </>
              );
            })}
          </defs>

          <rect x="0" y="0" width="1000" height="780" fill="url(#htt-stage-atmosphere)" />

          {view.showPersistentLayer &&
            Array.from(persistentEdgeIds)
              .map((edgeId) => simulation.edges[edgeId])
              .filter(Boolean)
              .map((edge) => {
                const source = simulation.vertices[edge.sourceVertexId];
                const target = simulation.vertices[edge.targetVertexId];
                return (
                  <line
                    key={`persistent-edge-${edge.id}`}
                    className="htt-persistent-edge"
                    x1={source.point.x}
                    y1={source.point.y}
                    x2={target.point.x}
                    y2={target.point.y}
                  />
                );
              })}

          {view.showGraphEdges &&
            graphEdges.map((edge) => {
              const source = simulation.vertices[edge.sourceVertexId];
              const target = simulation.vertices[edge.targetVertexId];
              const center = midpoint(edge, simulation.vertices);
              const isFocused = neighborhood.edgeIds.has(edge.id);
              const isDimmed = focusFragmentId ? !isFocused : false;
              const isActiveFlow =
                view.replay.mode === "live" &&
                simulation.runState === "playing" &&
                isFocused &&
                (edge.status === "highlighted" || edge.status === "active");
              return (
                <g key={edge.id} opacity={isDimmed ? 0.15 : isFocused ? 1 : 0.58}>
                  <line
                    className={`htt-graph-edge ${isFocused ? "htt-graph-edge--focused" : ""} ${isActiveFlow ? "htt-graph-edge--active-flow" : ""}`}
                    x1={source.point.x}
                    y1={source.point.y}
                    x2={target.point.x}
                    y2={target.point.y}
                    stroke={graphEdgeColor(edge)}
                    strokeWidth={isFocused ? edge.weight * 2.8 : edge.weight * 1.85}
                  />
                  {view.showEdgeLabels && isFocused ? (
                    <text className="htt-edge-label" x={center.x} y={center.y - 8}>
                      {edge.label}
                    </text>
                  ) : null}
                </g>
              );
            })}

          {view.showPersistentLayer &&
            Array.from(persistentFragmentIds)
              .map((fragmentId) => simulation.fragments[fragmentId])
              .filter(Boolean)
              .map((fragment) => (
                <polygon
                  key={`persistent-fragment-${fragment.id}`}
                  className="htt-persistent-fragment"
                  points={polygonPoints(fragment.vertexIds, simulation.vertices)}
                  stroke={persistentLayerColor(fragment)}
                  data-layer={fragment.promotion.layer}
                />
              ))}

          {view.replay.mode === "history" && replayFragmentId ? (
            <polygon
              className="htt-replay-ring"
              points={polygonPoints(simulation.fragments[replayFragmentId].vertexIds, simulation.vertices)}
            />
          ) : null}

          {fragments.map((fragment) => {
            const palette = fragmentPalette(fragment);
            const patch = manifoldPatchDescriptors.get(fragment.id);
            const fragmentProposal = latestFragmentProposal(fragment, simulation);
            const fragmentProviders = providerTrafficForProposal(fragmentProposal);
            const fragmentSymbolData = proposalSymbol(fragmentProposal);
            const isSelected = fragment.id === view.selectedFragmentId;
            const isHovered = fragment.id === view.hoveredFragmentId;
            const isActive = fragment.id === simulation.activeFragmentId && view.replay.mode === "live";
            const isPersistent = fragment.promotion.isPersistent;
            const isRejected = fragment.status === "rejected";
            const isInNeighborhood = focusFragmentId ? neighborhood.fragmentIds.has(fragment.id) : true;
            const catastropheOpacity = fragment.catastrophe
              ? 0.34 + clamp01(fragment.catastropheScore) * 0.44
              : 0;
            const showSymbol =
              Boolean(fragmentSymbolData) &&
              (isSelected || isHovered || isActive || (isPersistent && fragment.generationDepth <= 2));

            if (
              fragment.status === "archived" ||
              (isPersistent && !view.showAcceptedOverlay) ||
              (isRejected && !view.showRejectedOverlay)
            ) {
              return null;
            }

            return (
              <g
                key={fragment.id}
                opacity={isInNeighborhood ? 1 : 0.16}
                onClick={() => selectFragment(fragment.id)}
                onMouseEnter={() => hoverFragment(fragment.id)}
                onMouseLeave={() => hoverFragment(undefined)}
              >
                {fragment.catastrophe ? (
                  <polygon
                    className="htt-catastrophe-ring"
                    points={polygonPoints(fragment.vertexIds, simulation.vertices)}
                    opacity={catastropheOpacity}
                  />
                ) : null}
                <polygon
                  className={`htt-fragment-polygon ${isActive && simulation.runState === "playing" ? "htt-fragment-polygon--active-live" : ""} ${fragment.catastrophe ? "htt-fragment-polygon--catastrophe" : ""}`}
                  points={polygonPoints(fragment.vertexIds, simulation.vertices)}
                  fill={patch ? `url(#${patch.gradientId})` : palette.fill}
                  fillOpacity={patch ? 0.94 : undefined}
                  stroke={palette.stroke}
                  strokeWidth={isSelected ? 3.8 : isHovered ? 3.1 : 1.65 + fragment.generationDepth * 0.1}
                >
                  {patch ? (
                    <title>
                      {`¬(⊣) total ${patch.centerField.total.toFixed(3)} / asymmetry ${patch.centerField.asymmetry.toFixed(3)} / ${patch.crystallization.state}`}
                    </title>
                  ) : null}
                </polygon>

                {patch ? (
                  <>
                    <polygon
                      className="htt-fragment-divergence-bias"
                      points={polygonPoints(fragment.vertexIds, simulation.vertices)}
                      fill={`url(#${patch.biasGradientId})`}
                      opacity={patch.biasOpacity}
                    />
                    <polygon
                      className="htt-fragment-divergence-core"
                      points={polygonPoints(fragment.vertexIds, simulation.vertices)}
                      fill={`url(#${patch.coreGradientId})`}
                      opacity={patch.coreOpacity}
                    />
                    <polygon
                      className="htt-fragment-divergence-noise"
                      points={polygonPoints(fragment.vertexIds, simulation.vertices)}
                      fill={`url(#${patch.noisePatternId})`}
                      opacity={patch.noiseOpacity}
                    />
                    {patch.phaseRegionPath && patch.phaseRegionMode ? (
                      <path
                        className="htt-fragment-phase-region"
                        data-phase={patch.phaseRegionMode}
                        d={patch.phaseRegionPath}
                        opacity={patch.phaseRegionOpacity}
                      />
                    ) : null}
                  </>
                ) : null}

                {patch && patch.showPetals && (isSelected || isHovered || isActive) ? (
                  <g className="htt-manifold-petal-group" data-state={patch.crystallization.state}>
                    {patch.petals.map((petal) => (
                      <path
                        key={`${fragment.id}-${petal.label}`}
                        className="htt-manifold-petal"
                        d={petal.path}
                        fill={petal.fill}
                        opacity={petal.opacity}
                      >
                        <title>{petal.label}</title>
                      </path>
                    ))}
                  </g>
                ) : null}

                <polygon
                  className="htt-fragment-depth-ghost"
                  points={polygonPoints(fragment.vertexIds, simulation.vertices)}
                  fill={patch ? palette.fill : "none"}
                  fillOpacity={patch ? 0.14 : undefined}
                  stroke={palette.depthTint}
                  strokeWidth={1 + fragment.generationDepth * 0.55}
                  strokeDasharray={fragment.generationDepth > 0 ? "4 10" : undefined}
                />

                {isSelected ? (
                  <polygon
                    className="htt-selection-ring"
                    points={polygonPoints(fragment.vertexIds, simulation.vertices)}
                  />
                ) : null}

                {isActive && simulation.runState === "playing" ? (
                  <polygon className="htt-active-ring" points={polygonPoints(fragment.vertexIds, simulation.vertices)} />
                ) : null}

                {showSymbol && fragmentSymbolData ? (
                  <g
                    className="htt-fragment-marker"
                    data-tone={tone(fragmentProposal?.verificationState ?? fragment.status)}
                    transform={`translate(${fragment.centroid.x + 18} ${fragment.centroid.y - 18})`}
                  >
                    <circle className="htt-fragment-marker__disc" cx="0" cy="0" r="11" />
                    <text className="htt-fragment-marker__glyph" x="0" y="4">
                      {fragmentSymbolData.glyph}
                    </text>
                    <title>{`${fragmentSymbolData.label}: ${proposalKindLabel(fragmentProposal)}`}</title>
                  </g>
                ) : null}

                {fragmentProviders.length > 0 && (isSelected || isHovered || isActive) ? (
                  <g
                    className="htt-provider-traffic"
                    transform={`translate(${fragment.centroid.x - ((fragmentProviders.length - 1) * 9) / 2} ${fragment.centroid.y + 28})`}
                  >
                    {fragmentProviders.map((providerId, index) => (
                      <g key={`fragment-provider-${fragment.id}-${providerId}`} transform={`translate(${index * 9} 0)`}>
                        <circle className="htt-provider-signal" data-provider={providerId} cx="0" cy="0" r="3.2" />
                      </g>
                    ))}
                  </g>
                ) : null}

                {view.showFragmentLabels ? (
                  <>
                    <text className="htt-fragment-label" x={fragment.centroid.x} y={fragment.centroid.y - 2}>
                      {fragment.labels.short}
                    </text>
                    <text className="htt-fragment-subtitle" x={fragment.centroid.x} y={fragment.centroid.y + 16}>
                      {depthLabel(fragment)}
                    </text>
                  </>
                ) : null}
              </g>
            );
          })}

          {focusFragmentId
            ? Array.from(neighborhood.fragmentIds)
                .map((fragmentId) => simulation.fragments[fragmentId])
                .filter(Boolean)
                .map((fragment) => (
                  <polygon
                    key={`focus-${fragment.id}`}
                    className="htt-neighborhood-outline"
                    points={polygonPoints(fragment.vertexIds, simulation.vertices)}
                  />
                ))
            : null}

          {proposalSourcePoint && proposalTargetPoint && view.showProposalLabels ? (
            <g>
              <line
                className={`htt-proposal-path ${view.replay.mode === "live" && simulation.runState === "playing" ? "htt-proposal-path--live" : ""}`}
                x1={proposalSourcePoint.x}
                y1={proposalSourcePoint.y}
                x2={proposalTargetPoint.x}
                y2={proposalTargetPoint.y}
                stroke={proposalOutcomeColor(displayProposal)}
              />
              <text
                className="htt-proposal-label"
                x={(proposalSourcePoint.x + proposalTargetPoint.x) / 2}
                y={(proposalSourcePoint.y + proposalTargetPoint.y) / 2 - 10}
              >
                {displayProposal?.proposalKind.replaceAll("_", " ")}
              </text>
            </g>
          ) : null}

          {selectedProposal && selectedProposal.id !== activeProposal?.id ? (
            (() => {
              const selectedSourcePoint = endpointPoint(selectedProposal.source, simulation);
              const selectedTargetPoint = endpointPoint(selectedProposal.target, simulation);
              if (!selectedSourcePoint || !selectedTargetPoint) {
                return null;
              }
              return (
                <g opacity={0.58}>
                  <line
                    className="htt-selected-proposal-path"
                    x1={selectedSourcePoint.x}
                    y1={selectedSourcePoint.y}
                    x2={selectedTargetPoint.x}
                    y2={selectedTargetPoint.y}
                    stroke={proposalOutcomeColor(selectedProposal)}
                  />
                </g>
              );
            })()
          ) : null}

          {Object.values(simulation.exposedConnections).map((connection) => {
            const vertex = simulation.vertices[connection.vertexId];
            const isFocused = neighborhood.vertexIds.has(connection.vertexId);
            const isDimmed = focusFragmentId ? !isFocused : false;
            const isPersistentConnection = persistentConnectionIds.has(connection.id);
            return (
              <g key={connection.id} opacity={isDimmed ? 0.14 : 1}>
                {view.showPersistentLayer && isPersistentConnection ? (
                  <circle className="htt-persistent-connection-ring" cx={vertex.point.x} cy={vertex.point.y} r={8.5} />
                ) : null}
                <circle
                  className={`htt-connection-node ${isFocused ? "htt-connection-node--focused" : ""}`}
                  cx={vertex.point.x}
                  cy={vertex.point.y}
                  r={isFocused ? 5.8 : 4.5}
                />
                {view.showFragmentLabels && isFocused ? (
                  <text className="htt-connection-label" x={vertex.point.x} y={vertex.point.y - 10}>
                    {connection.label}
                  </text>
                ) : null}
              </g>
            );
          })}

          {Object.values(simulation.fragments).map((fragment) => {
            const anchor = simulation.vertices[fragment.inheritedAnchor];
            const isFocused = neighborhood.vertexIds.has(anchor.id);
            const isDimmed = focusFragmentId ? !isFocused : false;
            return (
              <path
                key={`anchor-${fragment.id}`}
                className={`htt-anchor-marker ${isFocused ? "htt-anchor-marker--focused" : ""}`}
                d={diamondPath(anchor.point, isFocused ? 8 : 6)}
                opacity={isDimmed ? 0.16 : 1}
              />
            );
          })}
        </svg>
      </div>

      <div className="htt-stage__legend">
        <span className="htt-stage__legend-item">
          <span className="htt-stage__legend-swatch" style={{ background: "rgba(174, 217, 168, 0.86)" }} />
          Persistent
        </span>
        <span className="htt-stage__legend-item">
          <span className="htt-stage__legend-swatch" style={{ background: "rgba(233, 205, 149, 0.88)" }} />
          Holding layer
        </span>
        <span className="htt-stage__legend-item">
          <span className="htt-stage__legend-swatch" style={{ background: "rgba(239, 210, 146, 0.94)" }} />
          Verifying
        </span>
        <span className="htt-stage__legend-item">
          <span className="htt-stage__legend-swatch" style={{ background: "rgba(217, 130, 120, 0.9)" }} />
          Rejected
        </span>
        <span className="htt-stage__legend-item">
          <span className="htt-stage__legend-swatch" style={{ background: "rgba(215, 198, 166, 0.96)" }} />
          Inherited anchor
        </span>
        <span className="htt-stage__legend-item">
          <span className="htt-stage__legend-swatch" style={{ background: "rgba(122, 165, 212, 0.86)" }} />
          Exposed interface
        </span>
        <span className="htt-stage__legend-item">
          <span className="htt-provider-signal htt-provider-signal--legend" data-provider="personal-open-llm" />
          Library-conditioned proposer
        </span>
        <span className="htt-stage__legend-item">
          <span className="htt-provider-signal htt-provider-signal--legend" data-provider="chatgpt" />
          ChatGPT synthesis
        </span>
        <span className="htt-stage__legend-item">
          <span className="htt-provider-signal htt-provider-signal--legend" data-provider="claude" />
          Claude critique
        </span>
        <span className="htt-stage__legend-item">
          <span className="htt-provider-signal htt-provider-signal--legend" data-provider="lean-verifier" />
          Lean decision
        </span>
      </div>
    </main>
  );
}

function InspectorPanel() {
  const simulation = useHegelTriangleStore((state) => state.simulation);
  const view = useHegelTriangleStore((state) => state.view);
  const runtimeConfig = useHegelTriangleStore((state) => state.runtimeConfig);
  const selectFragment = useHegelTriangleStore((state) => state.selectFragment);
  const selectProposal = useHegelTriangleStore((state) => state.selectProposal);
  const selectReplayEvent = useHegelTriangleStore((state) => state.selectReplayEvent);
  const rerunLeanTask = useHegelTriangleStore((state) => state.rerunLeanTask);
  const updateSemeioticState = useHegelTriangleStore((state) => state.updateSemeioticState);
  const observedEvent =
    view.replay.mode === "live"
      ? view.replay.liveObservedEventId
        ? simulation.replayLog.find((entry) => entry.id === view.replay.liveObservedEventId)
        : [...simulation.replayLog]
            .filter((entry) => entry.tick === simulation.activeTick)
            .sort((left, right) => left.id.localeCompare(right.id))[0]
      : undefined;
  const replayEvent =
    view.replay.mode === "history"
      ? resolveReplayEvent(
          simulation,
          view.replay.tick,
          view.replay.logFilter,
          view.replay.providerFilter,
          view.replay.selectedEventId,
        )
      : undefined;
  const inspectionEvent = replayEvent ?? observedEvent;

  const selectedFragment = view.selectedFragmentId
    ? simulation.fragments[view.selectedFragmentId]
    : simulation.activeFragmentId
      ? simulation.fragments[simulation.activeFragmentId]
      : undefined;
  const activeSimulationFragment = simulation.activeFragmentId
    ? simulation.fragments[simulation.activeFragmentId]
    : undefined;
  const activeProposal = view.selectedProposalId
    ? simulation.proposals[view.selectedProposalId]
    : simulation.activeProposalId
      ? simulation.proposals[simulation.activeProposalId]
      : undefined;
  const activeProposalFragment = activeProposal ? simulation.fragments[activeProposal.fragmentId] : selectedFragment;
  const liveProposal = simulation.activeProposalId ? simulation.proposals[simulation.activeProposalId] : undefined;
  const leanTask = activeProposal?.leanTask ? simulation.leanTasks[activeProposal.leanTask.id] ?? activeProposal.leanTask : undefined;
  const proofAttempt = leanTask ? simulation.proofAttempts[leanTask.id] : undefined;
  const latestTheorems = latestStubs(simulation.persistent.theoremStubs);
  const latestDefinitions = latestStubs(simulation.persistent.definitionStubs);
  const replayProposal = inspectionEvent?.proposalId ? simulation.proposals[inspectionEvent.proposalId] : undefined;
  const replayFragment =
    inspectionEvent?.fragmentId
      ? simulation.fragments[inspectionEvent.fragmentId]
      : replayProposal
        ? simulation.fragments[replayProposal.fragmentId]
        : undefined;
  const replayLeanTask = replayProposal?.leanTask
    ? simulation.leanTasks[replayProposal.leanTask.id] ?? replayProposal.leanTask
    : undefined;
  const activeOrchestration = orchestrationSignal(activeProposal);
  const activeDivergence = divergenceFieldSignal(activeProposal, activeProposalFragment);
  const activeSemeiotic = view.semeiotic.semeioticsEnabled
    ? semeioticProfileSignal(activeProposal, activeProposalFragment, view.semeiotic.semeioticAutoAnnotate)
    : undefined;
  const activeSemeioticMoments = view.semeiotic.semeioticsEnabled ? semeioticMomentSignals(activeProposal) : [];
  const activeSemeioticMoment = preferredDialecticalMoment(
    activeSemeioticMoments,
    view.semeiotic.selectedDialecticalMomentId,
  );
  const activeSemeioticAggregate = semeioticMomentAggregate(activeSemeioticMoments);
  const activeSemeioticOverlay = buildSemeioticOverlaySignal(activeProposal, activeSemeioticMoments);
  const activeLeanBridge = leanBridgeSignal(activeProposal);
  const activeProviders = providerTrafficForProposal(activeProposal);
  const activeProviderStage = actingProviderSummary(simulation, inspectionEvent, liveProposal);
  const promotionLabel = selectedFragment?.promotion.isPersistent
    ? `${selectedFragment.promotion.layer} / ${selectedFragment.promotion.reason ?? "accepted"}`
    : selectedFragment?.promotion.layer ?? "frontier";
  const replayOrchestration = orchestrationSignal(replayProposal);
  const inspectionDivergence = divergenceFieldSignal(replayProposal, replayFragment);
  const inspectionSemeiotic = view.semeiotic.semeioticsEnabled
    ? semeioticProfileSignal(replayProposal, replayFragment, view.semeiotic.semeioticAutoAnnotate)
    : undefined;
  const inspectionSemeioticMoments = view.semeiotic.semeioticsEnabled ? semeioticMomentSignals(replayProposal) : [];
  const inspectionSemeioticMoment = preferredDialecticalMoment(
    inspectionSemeioticMoments,
    view.semeiotic.selectedDialecticalMomentId,
  );
  const inspectionSemeioticAggregate = semeioticMomentAggregate(inspectionSemeioticMoments);
  const inspectionSemeioticOverlay = buildSemeioticOverlaySignal(replayProposal, inspectionSemeioticMoments);
  const inspectionLeanBridge = inspectionEvent ? leanEventSignal(inspectionEvent, replayProposal) : undefined;
  const inspectionChain = eventChainForEntry(simulation, inspectionEvent);
  const semeioticInspectorMoment = inspectionEvent ? inspectionSemeioticMoment ?? activeSemeioticMoment : activeSemeioticMoment;
  const semeioticInspectorProposal = inspectionEvent ? replayProposal ?? activeProposal : activeProposal;
  const semeioticInspectorFragment =
    semeioticInspectorProposal
      ? simulation.fragments[semeioticInspectorProposal.fragmentId]
      : inspectionEvent
        ? replayFragment ?? activeProposalFragment
        : activeProposalFragment;
  const semeioticRawSource =
    semeioticInspectorMoment?.rawSources.find((source) => source.artifactPath || source.pointer || source.textExcerpt) ??
    semeioticInspectorMoment?.rawSources[0];
  const semeioticHistoryOverlay = inspectionEvent ? inspectionSemeioticOverlay : activeSemeioticOverlay;
  const semeioticHistoryLabels = semeioticChainLabels(semeioticHistoryOverlay);
  const displayedInspectionChain =
    view.semeiotic.semeioticsEnabled &&
    view.semeiotic.semeioticOverlayVisible &&
    view.semeiotic.showOnlyAnnotatedMoves
      ? inspectionChain.filter((entry) => {
          if (!entry.proposalId) {
            return false;
          }

          if (!semeioticHistoryOverlay.annotatedProposalIds.has(entry.proposalId)) {
            return false;
          }

          const eventText = `${entry.eventType} ${entry.message}`.toLowerCase();
          return (
            eventText.includes("proposal") ||
            eventText.includes("dialectic") ||
            eventText.includes("critique") ||
            eventText.includes("repair") ||
            eventText.includes("synth") ||
            eventText.includes("lean")
          );
        })
      : inspectionChain;
  const activeSourceVector =
    activeLeanBridge?.sourceVector.length ? activeLeanBridge.sourceVector : activeProposalFragment?.theta;
  const activeTargetVector =
    activeLeanBridge?.targetVector.length ? activeLeanBridge.targetVector : activeProposal?.theta;
  const activeLeanStatus = activeLeanBridge?.status ?? leanTask?.status ?? "idle";
  const activeLeanSnippet = useArtifactText(runtimeConfig.artifactDirectory, activeLeanBridge?.snippetPath);
  const activeLeanStdout = useArtifactText(runtimeConfig.artifactDirectory, activeLeanBridge?.stdoutPath);
  const activeLeanStderrArtifact = useArtifactText(runtimeConfig.artifactDirectory, activeLeanBridge?.stderrPath);
  const [focusedDialecticNodeId, setFocusedDialecticNodeId] = useState<string>();
  const [focusedLeanNodeId, setFocusedLeanNodeId] = useState<string>();
  const topologyTreeSignal = proposalTopologyTreeSignal(simulation, activeProposal);
  const proposalTreeNodes = buildProposalTreeNodes(simulation, view.semeiotic);
  const proposalTreeHighlights = proposalTreeHighlightIds(
    simulation,
    selectedFragment,
    activeProposal,
    new Set([
      ...Array.from(topologyTreeSignal.relatedProposalIds),
      ...(view.semeiotic.semeioticsEnabled && view.semeiotic.semeioticOverlayVisible
        ? Array.from(activeSemeioticOverlay.annotatedProposalIds)
        : []),
    ]),
  );
  const dialecticTreeNodes = buildDialecticTreeNodes(activeProposal, view.semeiotic, activeSemeioticOverlay);
  const resolvedFocusedDialecticNodeId =
    focusedDialecticNodeId && dialecticTreeNodes.some((node) => node.id === focusedDialecticNodeId)
      ? focusedDialecticNodeId
      : dialecticTreeNodes[dialecticTreeNodes.length - 1]?.id;
  const dialecticTreeHighlights = new Set([
    ...Array.from(branchHighlightIds(dialecticTreeNodes, resolvedFocusedDialecticNodeId)),
    ...Array.from(topologyTreeSignal.relatedDialecticIds),
    ...(view.semeiotic.semeioticOverlayVisible
      ? [
          ...Array.from(activeSemeioticOverlay.reinterpretationDialecticIds),
          ...Array.from(activeSemeioticOverlay.mismatchDialecticIds),
          ...Array.from(activeSemeioticOverlay.critiqueRepairDialecticIds),
          ...Array.from(activeSemeioticOverlay.branchingDialecticIds),
        ]
      : []),
  ]);
  const leanChainNodes = buildLeanChainNodes(simulation, activeProposal);
  const resolvedFocusedLeanNodeId =
    focusedLeanNodeId && leanChainNodes.some((node) => node.id === focusedLeanNodeId)
      ? focusedLeanNodeId
      : leanChainNodes[leanChainNodes.length - 1]?.id;
  const leanChainHighlights = branchHighlightIds(leanChainNodes, resolvedFocusedLeanNodeId);
  const activeLeanStderr = compactText(
    activeLeanStderrArtifact ??
      leanTask?.lastError ??
      (leanTask?.result?.errors.length ? leanTask.result.errors.join(" / ") : undefined),
    420,
  );
  const copyLeanSnippet = async () => {
    if (!activeLeanSnippet || !navigator?.clipboard?.writeText) {
      return;
    }
    await navigator.clipboard.writeText(activeLeanSnippet);
  };
  const handleProposalTreeNodeClick = (node: InspectorTreeNode) => {
    if (node.kind === "fragment" && node.fragmentId) {
      selectFragment(node.fragmentId);
      return;
    }

    if (node.kind === "proposal" && node.proposalId) {
      selectProposal(node.proposalId);
    }
  };
  const handleDialecticNodeClick = (node: InspectorTreeNode) => {
    setFocusedDialecticNodeId(node.id);
    if (node.dialecticalMomentId) {
      updateSemeioticState({
        selectedDialecticalMomentId: node.dialecticalMomentId,
        semeioticGrammarPanelOpen: true,
      });
    }
    if (node.proposalId) {
      selectProposal(node.proposalId);
    }
  };
  const handleLeanNodeClick = (node: InspectorTreeNode) => {
    setFocusedLeanNodeId(node.id);
    if (node.proposalId) {
      selectProposal(node.proposalId);
    }
    if (node.eventId) {
      selectReplayEvent(node.eventId);
    }
  };

  return (
    <aside className="htt-app__panel">
      <section className="htt-section">
        <h2 className="htt-section__title">Simulation Focus</h2>
        <dl className="htt-detail-list">
          <div className="htt-detail-row">
            <dt>Active Fragment</dt>
            <dd>{activeSimulationFragment?.labels.short ?? "None"}</dd>
          </div>
          <div className="htt-detail-row">
            <dt>Live Proposal</dt>
            <dd>{liveProposal?.title ?? "None"}</dd>
          </div>
          <div className="htt-detail-row">
            <dt>Live Outcome</dt>
            <dd>
              <span className="htt-status-pill" data-tone={tone(liveProposal?.verificationState)}>
                {liveProposal?.verificationState ?? "idle"}
              </span>
            </dd>
          </div>
          <div className="htt-detail-row">
            <dt>Acting</dt>
            <dd>{activeProviderStage.label}</dd>
          </div>
        </dl>
        {activeProviderStage.providers.length > 0 ? (
          <div className="htt-provider-chip-row">
            {activeProviderStage.providers.map((providerId) => (
              <span key={`focus-provider-${providerId}`} className="htt-provider-chip" data-provider={providerId}>
                <span className="htt-provider-chip__glyph">{providerGlyph(providerId)}</span>
                {providerLabel(providerId)}
              </span>
            ))}
          </div>
        ) : null}
      </section>

      <section className="htt-section">
        <h2 className="htt-section__title">
          {view.replay.mode === "history" ? "Replay Inspection" : "Observation Inspection"}
        </h2>
        {inspectionEvent ? (
          <dl className="htt-detail-list">
            <div className="htt-detail-row">
              <dt>Tick</dt>
              <dd>{inspectionEvent.tick}</dd>
            </div>
            <div className="htt-detail-row">
              <dt>Event</dt>
              <dd>{inspectionEvent.eventType}</dd>
            </div>
            <div className="htt-detail-row">
              <dt>Message</dt>
              <dd>{inspectionEvent.message}</dd>
            </div>
            <div className="htt-detail-row">
              <dt>Outcome</dt>
              <dd>
                <span className="htt-status-pill" data-tone={tone(replayProposal?.verificationState ?? replayOutcomeForEntry(simulation, inspectionEvent))}>
                  {replayProposal?.verificationState ?? replayOutcomeForEntry(simulation, inspectionEvent)}
                </span>
              </dd>
            </div>
            {providerSequenceForEntry(inspectionEvent, simulation).length > 0 ? (
              <div className="htt-detail-row">
                <dt>Providers</dt>
                <dd>
                  <div className="htt-provider-chip-row">
                    {providerSequenceForEntry(inspectionEvent, simulation).map((providerId) => (
                      <span key={`replay-provider-${providerId}`} className="htt-provider-chip" data-provider={providerId}>
                        <span className="htt-provider-chip__glyph">{providerGlyph(providerId)}</span>
                        {providerLabel(providerId)}
                      </span>
                    ))}
                  </div>
                </dd>
              </div>
            ) : null}
            {replayProposal ? (
              <div className="htt-detail-row">
                <dt>Proposal</dt>
                <dd>{replayProposal.title}</dd>
              </div>
            ) : null}
            {inspectionLeanBridge?.stage ? (
              <div className="htt-detail-row">
                <dt>Lean Stage</dt>
                <dd>{inspectionLeanBridge.stage.replaceAll("_", " ")}</dd>
              </div>
            ) : null}
            {inspectionLeanBridge?.status ? (
              <div className="htt-detail-row">
                <dt>Lean Status</dt>
                <dd>
                  <span className="htt-status-pill" data-tone={tone(inspectionLeanBridge.status)}>
                    {inspectionLeanBridge.status}
                  </span>
                </dd>
              </div>
            ) : null}
            {inspectionLeanBridge?.snippetPath ? (
              <div className="htt-detail-row">
                <dt>Snippet</dt>
                <dd className="htt-detail-mono">{inspectionLeanBridge.snippetPath}</dd>
              </div>
            ) : null}
            {inspectionDivergence ? (
              <div className="htt-detail-row">
                <dt>NegAdj</dt>
                <dd className="htt-detail-mono">
                  {`F ${formatMetric(inspectionDivergence.forward)} / R ${formatMetric(inspectionDivergence.reverse)} / A ${formatMetric(inspectionDivergence.asymmetry)} / T ${formatMetric(inspectionDivergence.total)} / P ${formatMetric(inspectionDivergence.projection)} / ${inspectionDivergence.phase ?? "latent"}`}
                </dd>
              </div>
            ) : null}
            {view.semeiotic.semeioticsEnabled && view.semeiotic.semeioticGrammarPanelOpen && inspectionSemeiotic ? (
              <>
                <div className="htt-detail-row">
                  <dt>{semeioticLensLabel(view.semeiotic.selectedLens)}</dt>
                  <dd className="htt-detail-mono">
                    {semeioticLensValue(inspectionSemeiotic, view.semeiotic.selectedLens)}
                  </dd>
                </div>
                {inspectionSemeioticAggregate ? (
                  <>
                    <div className="htt-detail-row">
                      <dt>Semeiotic Moments</dt>
                      <dd>
                        {inspectionSemeioticAggregate.momentCount} / mismatches{" "}
                        {inspectionSemeioticAggregate.mismatchCount}
                      </dd>
                    </div>
                    <div className="htt-detail-row">
                      <dt>Complexity</dt>
                      <dd className="htt-detail-mono">
                        {`align ${formatMetric(inspectionSemeioticAggregate.ontologyAlignmentStrength)} / inst ${formatMetric(inspectionSemeioticAggregate.interpretantInstability)} / obj-sign ${formatMetric(inspectionSemeioticAggregate.objectSignMismatch)} / imbalance ${formatMetric(inspectionSemeioticAggregate.triadicImbalance)}`}
                      </dd>
                    </div>
                    <div className="htt-detail-row">
                      <dt>Depth</dt>
                      <dd className="htt-detail-mono">
                        {`ambiguity ${formatMetric(inspectionSemeioticAggregate.internalAmbiguity)} / branching ${formatMetric(inspectionSemeioticAggregate.signEventBranchingComplexity)} / reinterpret ${formatMetric(inspectionSemeioticAggregate.critiqueInducedReinterpretationDepth)} / overall ${formatMetric(inspectionSemeioticAggregate.overallComplexity)}`}
                      </dd>
                    </div>
                  </>
                ) : null}
                {inspectionSemeioticMoment ? (
                  <>
                    <div className="htt-detail-row">
                      <dt>Active Moment</dt>
                      <dd>{`${inspectionSemeioticMoment.role} / ${inspectionSemeioticMoment.summary ?? inspectionSemeioticMoment.id}`}</dd>
                    </div>
                    {inspectionSemeioticMoment.mismatches.length > 0 ? (
                      <div className="htt-detail-row">
                        <dt>Mismatches</dt>
                        <dd>
                          {inspectionSemeioticMoment.mismatches
                            .slice(0, 2)
                            .map((mismatch) =>
                              `${mismatch.kind} ${typeof mismatch.severity === "number" ? `(${formatMetric(mismatch.severity)})` : ""}: ${mismatch.summary}`,
                            )
                            .join(" / ")}
                        </dd>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </>
            ) : null}
            {replayOrchestration?.assessments.length ? (
              <div className="htt-detail-row">
                <dt>Assessments</dt>
                <dd>{replayOrchestration.assessments.join(" / ")}</dd>
              </div>
            ) : null}
            {replayLeanTask?.result ? (
              <div className="htt-detail-row">
                <dt>Verifier</dt>
                <dd>{replayLeanTask.result.summary}</dd>
              </div>
            ) : null}
            {replayLeanTask?.result?.acceptanceMessage ? (
              <div className="htt-detail-row">
                <dt>Lean</dt>
                <dd>{replayLeanTask.result.acceptanceMessage}</dd>
              </div>
            ) : replayLeanTask?.lastError ? (
              <div className="htt-detail-row">
                <dt>Lean</dt>
                <dd>{replayLeanTask.lastError}</dd>
              </div>
            ) : null}
            {inspectionLeanBridge?.stderrPath ? (
              <div className="htt-detail-row">
                <dt>stderr</dt>
                <dd className="htt-detail-mono">{compactText(inspectionLeanBridge.stderrPath, 240)}</dd>
              </div>
            ) : null}
          </dl>
        ) : (
          <p className="htt-empty">Play the simulation or select a prior event to inspect the observed adjunctor chain.</p>
        )}
      </section>

      <section className="htt-section">
        <h2 className="htt-section__title">Observed Chain</h2>
        {view.semeiotic.semeioticsEnabled && view.semeiotic.semeioticOverlayVisible && semeioticHistoryLabels.length > 0 ? (
          <p className="htt-chain-item__metrics">{`Semeiotic overlay: ${semeioticHistoryLabels.join(" / ")}`}</p>
        ) : null}
        {displayedInspectionChain.length > 0 ? (
          <div className="htt-chain-list">
            {displayedInspectionChain.map((entry) => {
              const geometry = eventGeometrySummary(entry);
              const semeioticAnnotated = Boolean(
                entry.proposalId && semeioticHistoryOverlay.annotatedProposalIds.has(entry.proposalId),
              );
              return (
                <article
                  key={`chain-${entry.id}`}
                  className="htt-chain-item"
                  data-selected={entry.id === inspectionEvent?.id || (view.semeiotic.semeioticOverlayVisible && semeioticAnnotated)}
                >
                  <div className="htt-chain-item__header">
                    <span className="htt-log-step-chip">{stageStepLabel(entry)}</span>
                    <span className="htt-chain-item__tick">Tick {entry.tick}</span>
                  </div>
                  <p className="htt-chain-item__message">{entry.message}</p>
                  {view.semeiotic.semeioticsEnabled && view.semeiotic.semeioticOverlayVisible && semeioticAnnotated ? (
                    <p className="htt-chain-item__metrics">
                      {`semeiotic ${semeioticHistoryLabels.join(" / ") || "annotated"}`}
                    </p>
                  ) : null}
                  <div className="htt-provider-chip-row">
                    {providerSequenceForEntry(entry, simulation).map((providerId) => (
                      <span key={`chain-provider-${entry.id}-${providerId}`} className="htt-provider-chip" data-provider={providerId}>
                        <span className="htt-provider-chip__glyph">{providerGlyph(providerId)}</span>
                        {providerLabel(providerId)}
                      </span>
                    ))}
                  </div>
                  {geometry ? (
                    <p className="htt-chain-item__metrics">
                      {`F ${formatMetric(geometry.forward)} / R ${formatMetric(geometry.reverse)} / A ${formatMetric(geometry.asymmetry)} / T ${formatMetric(geometry.total)} / K ${formatMetric(geometry.curvature)} / P ${formatMetric(geometry.projection)} / ${geometry.phase ?? "latent"}`}
                    </p>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : (
          <p className="htt-empty">
            {view.semeiotic.semeioticsEnabled && view.semeiotic.semeioticOverlayVisible && view.semeiotic.showOnlyAnnotatedMoves
              ? "No semeiotically annotated chain entries match the current filter."
              : "Select a live or replayed event to inspect its full observed chain."}
          </p>
        )}
      </section>

      <section className="htt-section">
        <h2 className="htt-section__title">Lean Integration Hooks</h2>
        {proofAttempt ? (
          <dl className="htt-detail-list">
            <div className="htt-detail-row">
              <dt>Translator</dt>
              <dd>{proofAttempt.translation.translatorKind}</dd>
            </div>
            <div className="htt-detail-row">
              <dt>Export</dt>
              <dd>{proofAttempt.translation.exportMode} / {proofAttempt.translation.moduleName}</dd>
            </div>
            <div className="htt-detail-row">
              <dt>Dispatcher</dt>
              <dd>{proofAttempt.dispatch.backend}</dd>
            </div>
            <div className="htt-detail-row">
              <dt>Task Ref</dt>
              <dd>{proofAttempt.dispatch.externalTaskRef ?? proofAttempt.taskId}</dd>
            </div>
            <div className="htt-detail-row">
              <dt>Storage</dt>
              <dd>In-memory proof attempt repository</dd>
            </div>
            <div className="htt-detail-row">
              <dt>Logs</dt>
              <dd>{proofAttempt.logLines.slice(0, 4).join(" / ")}</dd>
            </div>
          </dl>
        ) : (
          <p className="htt-empty">Future Lean hooks are ready. A proof attempt record appears here once a proposal is translated and dispatched.</p>
        )}
      </section>

      <section className="htt-section">
        <h2 className="htt-section__title">Persistent Structure</h2>
        <dl className="htt-detail-list">
          <div className="htt-detail-row">
            <dt>Fragments</dt>
            <dd>{simulation.persistent.promotedFragmentIds.length}</dd>
          </div>
          <div className="htt-detail-row">
            <dt>Accepted edges</dt>
            <dd>{simulation.persistent.acceptedEdgeIds.length}</dd>
          </div>
          <div className="htt-detail-row">
            <dt>Accepted seams</dt>
            <dd>{simulation.persistent.acceptedConnectionIds.length}</dd>
          </div>
          <div className="htt-detail-row">
            <dt>Holding items</dt>
            <dd>{simulation.persistent.keptPromisingProposalIds.length}</dd>
          </div>
        </dl>
        <div className="htt-persistent-stub-grid">
          <div className="htt-persistent-stub-column">
            <h3 className="htt-section__title">Theorem Stubs</h3>
            {latestTheorems.length > 0 ? (
              latestTheorems.map((stub) => (
                <article key={stub.id} className="htt-stub-card" data-layer={stub.layer}>
                  <p className="htt-stub-card__title">{stub.title}</p>
                  <p className="htt-stub-card__meta">Tick {stub.promotedAtTick} / {stub.layer}</p>
                  <p className="htt-stub-card__summary">{stub.summary}</p>
                </article>
              ))
            ) : (
              <p className="htt-empty">No canonical theorem stubs yet.</p>
            )}
          </div>
          <div className="htt-persistent-stub-column">
            <h3 className="htt-section__title">Definitions & Relations</h3>
            {latestDefinitions.length > 0 ? (
              latestDefinitions.map((stub) => (
                <article key={stub.id} className="htt-stub-card" data-layer={stub.layer}>
                  <p className="htt-stub-card__title">{stub.title}</p>
                  <p className="htt-stub-card__meta">Tick {stub.promotedAtTick} / {stub.layer}</p>
                  <p className="htt-stub-card__summary">{stub.summary}</p>
                </article>
              ))
            ) : (
              <p className="htt-empty">No persistent definition stubs yet.</p>
            )}
          </div>
        </div>
      </section>

      <section className="htt-section">
        <h2 className="htt-section__title">Selected Fragment</h2>
        {selectedFragment ? (
          <dl className="htt-detail-list">
            <div className="htt-detail-row">
              <dt>Fragment</dt>
              <dd>{selectedFragment.labels.title ?? selectedFragment.labels.short}</dd>
            </div>
            <div className="htt-detail-row">
              <dt>Status</dt>
              <dd>
                <span className="htt-status-pill" data-tone={tone(selectedFragment.status)}>
                  {selectedFragment.status}
                </span>
              </dd>
            </div>
            <div className="htt-detail-row">
              <dt>Generation</dt>
              <dd>{selectedFragment.generationDepth}</dd>
            </div>
            <div className="htt-detail-row">
              <dt>Anchor</dt>
              <dd>{selectedFragment.inheritedAnchor}</dd>
            </div>
            <div className="htt-detail-row">
              <dt>Connections</dt>
              <dd>{selectedFragment.newlyExposedConnectionIds.join(" / ")}</dd>
            </div>
            <div className="htt-detail-row">
              <dt>Labels</dt>
              <dd>{selectedFragment.labels.tags.join(" / ")}</dd>
            </div>
            <div className="htt-detail-row">
              <dt>Promotion</dt>
              <dd>{promotionLabel}</dd>
            </div>
          </dl>
        ) : (
          <p className="htt-empty">Select a fragment to inspect its geometry and semantic payload.</p>
        )}
      </section>

      <section className="htt-section">
        <h2 className="htt-section__title">Active Proposal</h2>
        {selectedFragment ? (
          <div className="htt-proposal-list">
            {selectedFragment.activeProposalIds.map((proposalId) => {
              const proposal = simulation.proposals[proposalId];
              const selected = proposal.id === activeProposal?.id;
              const symbol = proposalSymbol(proposal);
              const isFresh = simulation.activeTick - proposal.updatedAtTick <= runtimeConfig.liveTickWindow;
              return (
                <button
                  key={proposal.id}
                  className={`htt-button htt-proposal-card ${selected ? "htt-button--primary" : "htt-button--ghost"}`}
                  data-fresh={isFresh}
                  data-tone={proposal.verificationState}
                  type="button"
                  onClick={() => selectProposal(proposal.id)}
                >
                  <span className="htt-proposal-card__title">
                    {symbol ? <span className="htt-proposal-card__symbol">{symbol.glyph}</span> : null}
                    <span>{proposal.title}</span>
                  </span>
                  <span className="htt-proposal-card__meta">
                    {proposalKindLabel(proposal)} / {proposal.verificationState}
                  </span>
                  {providerTrafficForProposal(proposal).length > 0 ? (
                    <span className="htt-proposal-card__providers">
                      {providerTrafficForProposal(proposal).map((providerId) => (
                        <span key={`proposal-provider-${proposal.id}-${providerId}`} className="htt-provider-chip" data-provider={providerId}>
                          <span className="htt-provider-chip__glyph">{providerGlyph(providerId)}</span>
                          {providerLabel(providerId)}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : null}

        {activeProposal ? (
          <>
            <dl className="htt-detail-list">
              <div className="htt-detail-row">
                <dt>Title</dt>
                <dd>{activeProposal.title}</dd>
              </div>
              <div className="htt-detail-row">
                <dt>Outcome</dt>
                <dd>
                  <span className="htt-status-pill" data-tone={tone(activeProposal.verificationState)}>
                    {activeProposal.verificationState}
                  </span>
                </dd>
              </div>
              <div className="htt-detail-row">
                <dt>Summary</dt>
                <dd>{activeProposal.naturalLanguageSummary}</dd>
              </div>
              <div className="htt-detail-row">
                <dt>Theorem</dt>
                <dd>{activeProposal.theoremSummary}</dd>
              </div>
              <div className="htt-detail-row">
                <dt>Priority</dt>
                <dd>
                  {activeProposal.priority.toFixed(2)} / score {activeProposal.score.toFixed(2)}
                </dd>
              </div>
              <div className="htt-detail-row">
                <dt>Confidence</dt>
                <dd>{activeProposal.confidence.toFixed(2)}</dd>
              </div>
              {view.semeiotic.semeioticsEnabled && view.semeiotic.semeioticGrammarPanelOpen && activeSemeiotic ? (
                <>
                  <div className="htt-detail-row">
                    <dt>Semeiotic</dt>
                    <dd className="htt-detail-mono">{semeioticSignature(activeSemeiotic)}</dd>
                  </div>
                  <div className="htt-detail-row">
                    <dt>{semeioticLensLabel(view.semeiotic.selectedLens)}</dt>
                    <dd>{semeioticLensValue(activeSemeiotic, view.semeiotic.selectedLens)}</dd>
                  </div>
                  <div className="htt-detail-row">
                    <dt>Interpretant</dt>
                    <dd>
                      {activeSemeiotic.interpretant.term}
                      {activeSemeiotic.interpretant.aliases?.length
                        ? ` / alias ${activeSemeiotic.interpretant.aliases.join(", ")}`
                        : ""}
                    </dd>
                  </div>
                  {activeSemeioticAggregate ? (
                    <>
                      <div className="htt-detail-row">
                        <dt>Semeiotic Moments</dt>
                        <dd>
                          {activeSemeioticAggregate.momentCount} / mismatches {activeSemeioticAggregate.mismatchCount}
                        </dd>
                      </div>
                      <div className="htt-detail-row">
                        <dt>Complexity</dt>
                        <dd className="htt-detail-mono">
                          {`align ${formatMetric(activeSemeioticAggregate.ontologyAlignmentStrength)} / inst ${formatMetric(activeSemeioticAggregate.interpretantInstability)} / obj-sign ${formatMetric(activeSemeioticAggregate.objectSignMismatch)} / imbalance ${formatMetric(activeSemeioticAggregate.triadicImbalance)}`}
                        </dd>
                      </div>
                      <div className="htt-detail-row">
                        <dt>Depth</dt>
                        <dd className="htt-detail-mono">
                          {`ambiguity ${formatMetric(activeSemeioticAggregate.internalAmbiguity)} / branching ${formatMetric(activeSemeioticAggregate.signEventBranchingComplexity)} / reinterpret ${formatMetric(activeSemeioticAggregate.critiqueInducedReinterpretationDepth)} / overall ${formatMetric(activeSemeioticAggregate.overallComplexity)}`}
                        </dd>
                      </div>
                    </>
                  ) : null}
                  {activeSemeioticMoment ? (
                    <>
                      <div className="htt-detail-row">
                        <dt>Active Moment</dt>
                        <dd>{`${activeSemeioticMoment.role} / ${activeSemeioticMoment.summary ?? activeSemeioticMoment.id}`}</dd>
                      </div>
                      {activeSemeioticMoment.mismatches.length > 0 ? (
                        <div className="htt-detail-row">
                          <dt>Mismatches</dt>
                          <dd>
                            {activeSemeioticMoment.mismatches
                              .slice(0, 3)
                              .map((mismatch) =>
                                `${mismatch.kind} ${typeof mismatch.severity === "number" ? `(${formatMetric(mismatch.severity)})` : ""}: ${mismatch.summary}`,
                              )
                              .join(" / ")}
                          </dd>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </>
              ) : null}
              {activeProposal.corpusSupport.length > 0 ? (
                <div className="htt-detail-row">
                  <dt>Corpus Support</dt>
                  <dd>
                    {activeProposal.corpusSupport
                      .map((support) => `${support.source} (${support.similarity.toFixed(2)})`)
                      .join(" / ")}
                  </dd>
                </div>
              ) : null}
              {activeProviders.length > 0 ? (
                <div className="htt-detail-row">
                  <dt>Providers</dt>
                  <dd>
                    <div className="htt-provider-chip-row">
                      {activeProviders.map((providerId) => (
                        <span key={`active-provider-${providerId}`} className="htt-provider-chip" data-provider={providerId}>
                          <span className="htt-provider-chip__glyph">{providerGlyph(providerId)}</span>
                          {providerLabel(providerId)}
                        </span>
                      ))}
                    </div>
                  </dd>
                </div>
              ) : null}
              {activeOrchestration?.assessments.length ? (
                <div className="htt-detail-row">
                  <dt>Synthesis</dt>
                  <dd>{activeOrchestration.assessments.join(" / ")}</dd>
                </div>
              ) : null}
              {activeOrchestration?.critiqueFindings.length ? (
                <div className="htt-detail-row">
                  <dt>Critique</dt>
                  <dd>{activeOrchestration.critiqueFindings.slice(0, 3).join(" / ")}</dd>
                </div>
              ) : null}
              {activeOrchestration?.disagreementSignals.length ? (
                <div className="htt-detail-row">
                  <dt>Disagreement</dt>
                  <dd>{activeOrchestration.disagreementSignals.slice(0, 3).join(" / ")}</dd>
                </div>
              ) : null}
              {providerContributionSummary(activeProposal).length ? (
                <div className="htt-detail-row">
                  <dt>Signals</dt>
                  <dd>{providerContributionSummary(activeProposal).join(" / ")}</dd>
                </div>
              ) : null}
            </dl>
            <pre className="htt-code">{activeProposal.mockLeanCode}</pre>
          </>
        ) : (
          <p className="htt-empty">No proposal is active for the current selection.</p>
        )}
      </section>

      {view.semeiotic.semeioticsEnabled && view.semeiotic.semeioticGrammarPanelOpen ? (
        <section className="htt-section">
          <h2 className="htt-section__title">Semeiotic Grammar</h2>
          <div className="htt-inline-actions">
            <label className="htt-toggle">
              <input
                type="checkbox"
                checked={view.semeiotic.semeioticOverlayVisible}
                onChange={(event) =>
                  updateSemeioticState({
                    semeioticOverlayVisible: event.target.checked,
                  })
                }
              />
              <span>Semeiotic Overlay</span>
            </label>
            <label className="htt-toggle">
              <input
                type="checkbox"
                checked={view.semeiotic.showOnlyAnnotatedMoves}
                onChange={(event) =>
                  updateSemeioticState({
                    showOnlyAnnotatedMoves: event.target.checked,
                  })
                }
              />
              <span>Annotated Only</span>
            </label>
            <label className="htt-field">
              <span className="htt-field__label">Tree Filter</span>
              <select
                className="htt-select"
                value={view.semeiotic.semeioticTreeFilter}
                onChange={(event) =>
                  updateSemeioticState({
                    semeioticTreeFilter: event.target.value as AppViewState["semeiotic"]["semeioticTreeFilter"],
                  })
                }
              >
                <option value="all">all</option>
                <option value="annotated">annotated</option>
                <option value="icon">icon</option>
                <option value="index">index</option>
                <option value="symbol">symbol</option>
                <option value="qualisign">qualisign</option>
                <option value="sinsign">sinsign</option>
                <option value="legisign">legisign</option>
                <option value="rheme">rheme</option>
                <option value="dicent">dicent</option>
                <option value="delome">delome</option>
              </select>
            </label>
          </div>
          {semeioticInspectorMoment ? (
            <>
              <dl className="htt-detail-list">
                <div className="htt-detail-row">
                  <dt>Moment</dt>
                  <dd>{semeioticInspectorMoment.id}</dd>
                </div>
                <div className="htt-detail-row">
                  <dt>Role</dt>
                  <dd>{semeioticInspectorMoment.role}</dd>
                </div>
                <div className="htt-detail-row">
                  <dt>Provider</dt>
                  <dd>{semeioticInspectorMoment.provider ?? "unknown"}</dd>
                </div>
                <div className="htt-detail-row">
                  <dt>Fragment</dt>
                  <dd>{semeioticInspectorMoment.fragmentId ?? semeioticInspectorFragment?.id ?? "none"}</dd>
                </div>
                <div className="htt-detail-row">
                  <dt>Proposal</dt>
                  <dd>{semeioticInspectorMoment.proposalId ?? semeioticInspectorProposal?.id ?? "none"}</dd>
                </div>
                <div className="htt-detail-row">
                  <dt>Move</dt>
                  <dd>{semeioticInspectorMoment.dialecticMoveId ?? "none"}</dd>
                </div>
                {typeof semeioticInspectorMoment.tick === "number" ? (
                  <div className="htt-detail-row">
                    <dt>Tick</dt>
                    <dd>{semeioticInspectorMoment.tick}</dd>
                  </div>
                ) : null}
                {semeioticInspectorMoment.summary ? (
                  <div className="htt-detail-row">
                    <dt>Summary</dt>
                    <dd>{semeioticInspectorMoment.summary}</dd>
                  </div>
                ) : null}
                {semeioticInspectorMoment.hardSummary ? (
                  <div className="htt-detail-row">
                    <dt>Hard Labels</dt>
                    <dd className="htt-detail-mono">
                      {`${semeioticInspectorMoment.hardSummary.objectTerm ?? "?"} / ${semeioticInspectorMoment.hardSummary.signTerm ?? "?"} / ${semeioticInspectorMoment.hardSummary.interpretantTerm ?? "?"} / c ${formatMetric(semeioticInspectorMoment.hardSummary.confidence)}`}
                    </dd>
                  </div>
                ) : null}
                {semeioticInspectorMoment.objectProfile ? (
                  <div className="htt-detail-row">
                    <dt>Object</dt>
                    <dd className="htt-detail-mono">
                      {`${semeioticInspectorMoment.objectProfile.dominantTerm ?? "?"} / ${semeioticInspectorMoment.objectProfile.dominantValence ?? "?"} / F ${formatMetric(semeioticInspectorMoment.objectProfile.firstness)} / S ${formatMetric(semeioticInspectorMoment.objectProfile.secondness)} / T ${formatMetric(semeioticInspectorMoment.objectProfile.thirdness)} / H ${formatMetric(semeioticInspectorMoment.objectProfile.entropy)}`}
                    </dd>
                  </div>
                ) : null}
                {semeioticInspectorMoment.signProfile ? (
                  <div className="htt-detail-row">
                    <dt>Sign</dt>
                    <dd className="htt-detail-mono">
                      {`${semeioticInspectorMoment.signProfile.dominantTerm ?? "?"} / ${semeioticInspectorMoment.signProfile.dominantValence ?? "?"} / F ${formatMetric(semeioticInspectorMoment.signProfile.firstness)} / S ${formatMetric(semeioticInspectorMoment.signProfile.secondness)} / T ${formatMetric(semeioticInspectorMoment.signProfile.thirdness)} / H ${formatMetric(semeioticInspectorMoment.signProfile.entropy)}`}
                    </dd>
                  </div>
                ) : null}
                {semeioticInspectorMoment.interpretantProfile ? (
                  <div className="htt-detail-row">
                    <dt>Interpretant</dt>
                    <dd className="htt-detail-mono">
                      {`${semeioticInspectorMoment.interpretantProfile.dominantTerm ?? "?"} / ${semeioticInspectorMoment.interpretantProfile.dominantValence ?? "?"} / F ${formatMetric(semeioticInspectorMoment.interpretantProfile.firstness)} / S ${formatMetric(semeioticInspectorMoment.interpretantProfile.secondness)} / T ${formatMetric(semeioticInspectorMoment.interpretantProfile.thirdness)} / H ${formatMetric(semeioticInspectorMoment.interpretantProfile.entropy)}`}
                    </dd>
                  </div>
                ) : null}
                {semeioticInspectorMoment.complexity ? (
                  <>
                    <div className="htt-detail-row">
                      <dt>Mismatch Metrics</dt>
                      <dd className="htt-detail-mono">
                        {`align ${formatMetric(semeioticInspectorMoment.complexity.ontologyAlignmentStrength)} / inst ${formatMetric(semeioticInspectorMoment.complexity.interpretantInstability)} / obj-sign ${formatMetric(semeioticInspectorMoment.complexity.objectSignMismatch)} / imbalance ${formatMetric(semeioticInspectorMoment.complexity.triadicImbalance)}`}
                      </dd>
                    </div>
                    <div className="htt-detail-row">
                      <dt>Complexity Metrics</dt>
                      <dd className="htt-detail-mono">
                        {`ambiguity ${formatMetric(semeioticInspectorMoment.complexity.internalAmbiguity)} / branching ${formatMetric(semeioticInspectorMoment.complexity.signEventBranchingComplexity)} / reinterpret ${formatMetric(semeioticInspectorMoment.complexity.critiqueInducedReinterpretationDepth)} / overall ${formatMetric(semeioticInspectorMoment.complexity.overallComplexity)}`}
                      </dd>
                    </div>
                    <div className="htt-detail-row">
                      <dt>Counts</dt>
                      <dd className="htt-detail-mono">
                        {`claims ${formatMetric(semeioticInspectorMoment.complexity.claimCount)} / objections ${formatMetric(semeioticInspectorMoment.complexity.objectionCount)} / repairs ${formatMetric(semeioticInspectorMoment.complexity.repairCount)} / branches ${formatMetric(semeioticInspectorMoment.complexity.branchCount)}`}
                      </dd>
                    </div>
                  </>
                ) : null}
                {semeioticInspectorMoment.linkedMomentIds.length > 0 ? (
                  <div className="htt-detail-row">
                    <dt>Linked Moments</dt>
                    <dd>{semeioticInspectorMoment.linkedMomentIds.join(" / ")}</dd>
                  </div>
                ) : null}
                {semeioticRawSource ? (
                  <>
                    {semeioticRawSource.pointer ? (
                      <div className="htt-detail-row">
                        <dt>Pointer</dt>
                        <dd className="htt-detail-mono">{semeioticRawSource.pointer}</dd>
                      </div>
                    ) : null}
                    {semeioticRawSource.artifactPath ? (
                      <div className="htt-detail-row">
                        <dt>Artifact</dt>
                        <dd className="htt-detail-mono">{semeioticRawSource.artifactPath}</dd>
                      </div>
                    ) : null}
                    {semeioticRawSource.textExcerpt ? (
                      <div className="htt-detail-row">
                        <dt>Raw Text</dt>
                        <dd>{semeioticRawSource.textExcerpt}</dd>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </dl>
              {semeioticInspectorMoment.mismatches.length > 0 ? (
                <div className="htt-chain-list">
                  {semeioticInspectorMoment.mismatches.map((mismatch) => (
                    <article key={mismatch.id} className="htt-chain-item">
                      <div className="htt-chain-item__header">
                        <span className="htt-log-step-chip">{mismatch.kind}</span>
                        {typeof mismatch.severity === "number" ? (
                          <span className="htt-chain-item__tick">{formatMetric(mismatch.severity)}</span>
                        ) : null}
                      </div>
                      <p className="htt-chain-item__message">{mismatch.summary}</p>
                      {mismatch.metricKey ? (
                        <p className="htt-chain-item__metrics">{mismatch.metricKey}</p>
                      ) : null}
                      {mismatch.evidence.length > 0 ? (
                        <p className="htt-chain-item__metrics">{mismatch.evidence.join(" / ")}</p>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <p className="htt-empty">Select a dialectical moment or an annotated move to inspect its semeiotic grammar.</p>
          )}
        </section>
      ) : null}

      <section className="htt-section">
        <h2 className="htt-section__title">Lean-backed Geometry</h2>
        {activeProposal ? (
          <>
            <dl className="htt-detail-list">
              <div className="htt-detail-row">
                <dt>Source Vec</dt>
                <dd className="htt-detail-mono">{formatVectorCompact(activeSourceVector)}</dd>
              </div>
              <div className="htt-detail-row">
                <dt>Target Vec</dt>
                <dd className="htt-detail-mono">{formatVectorCompact(activeTargetVector)}</dd>
              </div>
              <div className="htt-detail-row">
                <dt>Forward</dt>
                <dd>{formatMetric(activeDivergence?.forward)}</dd>
              </div>
              <div className="htt-detail-row">
                <dt>Reverse</dt>
                <dd>{formatMetric(activeDivergence?.reverse)}</dd>
              </div>
              <div className="htt-detail-row">
                <dt>Asymmetry</dt>
                <dd>{formatMetric(activeDivergence?.asymmetry)}</dd>
              </div>
              <div className="htt-detail-row">
                <dt>Total</dt>
                <dd>{formatMetric(activeDivergence?.total)}</dd>
              </div>
              <div className="htt-detail-row">
                <dt>Projection</dt>
                <dd>{formatMetric(activeDivergence?.projection)}</dd>
              </div>
              <div className="htt-detail-row">
                <dt>Phase</dt>
                <dd>{activeDivergence?.phase ?? selectedFragment?.phase ?? "latent"}</dd>
              </div>
              <div className="htt-detail-row">
                <dt>Lean Status</dt>
                <dd>
                  <span className="htt-status-pill" data-tone={tone(activeLeanStatus)}>
                    {activeLeanStatus}
                  </span>
                </dd>
              </div>
              {activeLeanBridge?.theoremKind ? (
                <div className="htt-detail-row">
                  <dt>Artifact</dt>
                  <dd>{theoremKindLabel(activeLeanBridge.theoremKind)}</dd>
                </div>
              ) : null}
              {activeLeanBridge?.snippetPath ? (
                <div className="htt-detail-row">
                  <dt>Snippet</dt>
                  <dd className="htt-detail-mono">{activeLeanBridge.snippetPath}</dd>
                </div>
              ) : null}
              {activeLeanBridge?.command ? (
                <div className="htt-detail-row">
                  <dt>Command</dt>
                  <dd className="htt-detail-mono">{compactText(activeLeanBridge.command, 180)}</dd>
                </div>
              ) : null}
              {activeLeanBridge?.stdoutPath ? (
                <div className="htt-detail-row">
                  <dt>stdout</dt>
                  <dd className="htt-detail-mono">{compactText(activeLeanBridge.stdoutPath, 180)}</dd>
                </div>
              ) : null}
              {activeLeanBridge?.stderrPath ? (
                <div className="htt-detail-row">
                  <dt>stderr</dt>
                  <dd className="htt-detail-mono">{compactText(activeLeanBridge.stderrPath, 180)}</dd>
                </div>
              ) : null}
              {activeLeanBridge?.snapshotPath ? (
                <div className="htt-detail-row">
                  <dt>Snapshot</dt>
                  <dd className="htt-detail-mono">{compactText(activeLeanBridge.snapshotPath, 180)}</dd>
                </div>
              ) : null}
            </dl>
            {activeLeanStderr ? (
              <pre className="htt-code htt-code--stderr">{activeLeanStderr}</pre>
            ) : null}
          </>
        ) : (
          <p className="htt-empty">Lean-backed vectors and divergence values appear here once a proposal is active.</p>
        )}
      </section>

      <section className="htt-section">
        <h2 className="htt-section__title">Lean Artifact</h2>
        {activeProposal && activeLeanBridge ? (
          <>
            <dl className="htt-detail-list">
              <div className="htt-detail-row">
                <dt>Task</dt>
                <dd>{leanTask?.id ?? activeProposal.leanTask?.id ?? "pending"}</dd>
              </div>
              <div className="htt-detail-row">
                <dt>Fragment</dt>
                <dd>{activeProposal.fragmentId}</dd>
              </div>
              <div className="htt-detail-row">
                <dt>Proposal</dt>
                <dd>{activeProposal.id}</dd>
              </div>
              <div className="htt-detail-row">
                <dt>Artifact</dt>
                <dd>{theoremKindLabel(activeLeanBridge.theoremKind)}</dd>
              </div>
              {activeLeanBridge?.moduleName ? (
                <div className="htt-detail-row">
                  <dt>Module</dt>
                  <dd className="htt-detail-mono">{activeLeanBridge.moduleName}</dd>
                </div>
              ) : null}
              {activeLeanBridge?.importLine ? (
                <div className="htt-detail-row">
                  <dt>Import</dt>
                  <dd className="htt-detail-mono">{activeLeanBridge.importLine}</dd>
                </div>
              ) : null}
              <div className="htt-detail-row">
                <dt>Run Result</dt>
                <dd>
                  {activeLeanStatus}
                  {typeof activeLeanBridge.exitCode === "number" ? ` / exit ${activeLeanBridge.exitCode}` : ""}
                  {typeof activeLeanBridge.durationMs === "number" ? ` / ${Math.round(activeLeanBridge.durationMs)}ms` : ""}
                  {activeLeanBridge.signal ? ` / ${activeLeanBridge.signal}` : ""}
                </dd>
              </div>
              <div className="htt-detail-row">
                <dt>Parsed</dt>
                <dd className="htt-detail-mono">
                  {`F ${formatMetric(activeDivergence?.forward)} / R ${formatMetric(activeDivergence?.reverse)} / A ${formatMetric(activeDivergence?.asymmetry)} / T ${formatMetric(activeDivergence?.total)} / P ${formatMetric(activeDivergence?.projection)} / ${activeDivergence?.phase ?? selectedFragment?.phase ?? "latent"}`}
                </dd>
              </div>
            </dl>
            <div className="htt-inline-actions">
              <button
                className="htt-button htt-button--ghost"
                type="button"
                onClick={() => void copyLeanSnippet()}
                disabled={!activeLeanSnippet}
              >
                Copy Snippet
              </button>
              <button
                className="htt-button htt-button--ghost"
                type="button"
                onClick={() => rerunLeanTask(activeProposal.id)}
              >
                Rerun Snippet
              </button>
            </div>
            {activeLeanSnippet ? (
              <pre className="htt-code">{activeLeanSnippet}</pre>
            ) : (
              <p className="htt-empty">The generated Lean module appears here after the bridge prepares a snippet.</p>
            )}
            {activeLeanStdout ? (
              <pre className="htt-code htt-code--stdout">{compactText(activeLeanStdout, 1200)}</pre>
            ) : null}
            {activeLeanStderrArtifact ? (
              <pre className="htt-code htt-code--stderr">{compactText(activeLeanStderrArtifact, 1200)}</pre>
            ) : null}
          </>
        ) : (
          <p className="htt-empty">Generated Lean modules appear here when the selected proposal reaches the Lean bridge.</p>
        )}
      </section>

      <section className="htt-section">
        <h2 className="htt-section__title">Tree Visualization</h2>
        <div className="htt-tree-panel">
          <div className="htt-tree-panel__group">
            <div className="htt-tree-panel__header">
              <h3 className="htt-tree-panel__title">Proposal Tree</h3>
              <span className="htt-badge">{proposalTreeNodes.length} nodes</span>
            </div>
            <InspectorTree
              nodes={proposalTreeNodes}
              highlightedIds={proposalTreeHighlights}
              onNodeClick={handleProposalTreeNodeClick}
              emptyMessage="Fragments and proposals appear here once the tree is initialized."
            />
          </div>

          <div className="htt-tree-panel__group">
            <div className="htt-tree-panel__header">
              <h3 className="htt-tree-panel__title">Dialectic Tree</h3>
              <span className="htt-badge">{dialecticTreeNodes.length} moves</span>
            </div>
            <InspectorTree
              nodes={dialecticTreeNodes}
              highlightedIds={dialecticTreeHighlights}
              onNodeClick={handleDialecticNodeClick}
              emptyMessage="Structured proposer, critic, repair, and synthesis moves appear here for the selected proposal."
            />
          </div>

          <div className="htt-tree-panel__group">
            <div className="htt-tree-panel__header">
              <h3 className="htt-tree-panel__title">Lean Chain</h3>
              <span className="htt-badge">{leanChainNodes.length} stages</span>
            </div>
            <InspectorTree
              nodes={leanChainNodes}
              highlightedIds={leanChainHighlights}
              onNodeClick={handleLeanNodeClick}
              emptyMessage="Snippet generation, Lean execution, and parse stages appear here after the bridge runs."
            />
          </div>
        </div>
      </section>

      <section className="htt-section">
        <h2 className="htt-section__title">Mock Lean Status</h2>
        {leanTask ? (
          <dl className="htt-detail-list">
            <div className="htt-detail-row">
              <dt>Task</dt>
              <dd>{leanTask.id}</dd>
            </div>
            <div className="htt-detail-row">
              <dt>Status</dt>
              <dd>
                <span className="htt-status-pill" data-tone={tone(leanTask.status)}>
                  {leanTask.status}
                </span>
              </dd>
            </div>
            <div className="htt-detail-row">
              <dt>Requested</dt>
              <dd>Tick {leanTask.requestedAtTick}</dd>
            </div>
            {leanTask.result ? (
              <div className="htt-detail-row">
                <dt>Verifier</dt>
                <dd>{leanTask.result.verifierKind}</dd>
              </div>
            ) : null}
            {leanTask.result ? (
              <div className="htt-detail-row">
                <dt>Summary</dt>
                <dd>{leanTask.result.summary}</dd>
              </div>
            ) : null}
            {activeOrchestration?.leanBoundary?.outcome ? (
              <div className="htt-detail-row">
                <dt>Boundary</dt>
                <dd>
                  <span className="htt-status-pill" data-tone={tone(activeOrchestration.leanBoundary.outcome)}>
                    {activeOrchestration.leanBoundary.outcome}
                  </span>
                </dd>
              </div>
            ) : null}
            {activeOrchestration?.leanBoundary?.promotionDecision ? (
              <div className="htt-detail-row">
                <dt>Promotion</dt>
                <dd>{activeOrchestration.leanBoundary.promotionDecision}</dd>
              </div>
            ) : null}
            {leanTask.result?.acceptanceMessage ? (
              <div className="htt-detail-row">
                <dt>Accepted</dt>
                <dd>{leanTask.result.acceptanceMessage}</dd>
              </div>
            ) : null}
            <div className="htt-detail-row">
              <dt>Diagnostics</dt>
              <dd>{leanTask.diagnostics?.join(" / ") ?? "No diagnostics yet."}</dd>
            </div>
            {leanTask.result?.warnings.length ? (
              <div className="htt-detail-row">
                <dt>Warnings</dt>
                <dd>{leanTask.result.warnings.join(" / ")}</dd>
              </div>
            ) : null}
            {leanTask.lastError ? (
              <div className="htt-detail-row">
                <dt>Error</dt>
                <dd>{leanTask.lastError}</dd>
              </div>
            ) : null}
            {leanTask.result?.errors.length ? (
              <div className="htt-detail-row">
                <dt>Errors</dt>
                <dd>{leanTask.result.errors.join(" / ")}</dd>
              </div>
            ) : null}
            {leanTask.result?.generatedFiles.length ? (
              <div className="htt-detail-row">
                <dt>Files</dt>
                <dd>{leanTask.result.generatedFiles.map((file) => file.path).join(" / ")}</dd>
              </div>
            ) : null}
          </dl>
        ) : (
          <p className="htt-empty">The selected proposal has not opened a verifier task yet.</p>
        )}
      </section>

      <section className="htt-section">
        <h2 className="htt-section__title">Semantic Payload</h2>
        {selectedFragment ? (
          <dl className="htt-detail-list">
            <div className="htt-detail-row">
              <dt>Summary</dt>
              <dd>{selectedFragment.semanticPayload.summary}</dd>
            </div>
            <div className="htt-detail-row">
              <dt>Keywords</dt>
              <dd>{selectedFragment.semanticPayload.keywords.join(" / ")}</dd>
            </div>
            <div className="htt-detail-row">
              <dt>Sketch</dt>
              <dd>
                {selectedFragment.semanticPayload.theoremSketch ??
                  selectedFragment.semanticPayload.definitionSketch ??
                  "None yet."}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="htt-empty">Semantic payload appears here when a fragment is selected.</p>
        )}
      </section>
    </aside>
  );
}

function InformationGeometryLabPanel() {
  const simulation = useHegelTriangleStore((state) => state.simulation);
  const view = useHegelTriangleStore((state) => state.view);
  const setInformationGeometryLabTab = useHegelTriangleStore((state) => state.setInformationGeometryLabTab);
  const selectFragment = useHegelTriangleStore((state) => state.selectFragment);
  const selectProposal = useHegelTriangleStore((state) => state.selectProposal);

  const referenceFragment = view.selectedFragmentId
    ? simulation.fragments[view.selectedFragmentId]
    : simulation.activeFragmentId
      ? simulation.fragments[simulation.activeFragmentId]
      : undefined;
  const referenceProposal = view.selectedProposalId
    ? simulation.proposals[view.selectedProposalId]
    : referenceFragment
      ? latestFragmentProposal(referenceFragment, simulation)
      : simulation.activeProposalId
        ? simulation.proposals[simulation.activeProposalId]
        : undefined;
  const referenceField = referenceFragment ? resolvedFieldForFragment(referenceFragment, simulation) : undefined;
  const referenceLean = leanBridgeSignal(referenceProposal);
  const patch = referenceFragment ? buildManifoldPatchDescriptors([referenceFragment], simulation).get(referenceFragment.id) : undefined;
  const patchSamples = referenceFragment ? manifoldPatchSamples(referenceFragment, simulation) : [];
  const neighborhood = referenceFragment
    ? selectLocalGraphNeighborhood(simulation, referenceFragment.id, 1)
    : { fragmentIds: new Set<FragmentId>(), edgeIds: new Set(), vertexIds: new Set<FragmentVertexId>() };
  const neighborhoodFragments = Array.from(neighborhood.fragmentIds)
    .map((fragmentId) => simulation.fragments[fragmentId])
    .filter((fragment): fragment is TriangleFragment => Boolean(fragment))
    .sort(fragmentSort);
  const siteFragments =
    neighborhoodFragments.length > 0
      ? neighborhoodFragments.slice(0, 7)
      : referenceFragment
        ? [referenceFragment]
        : [];
  const siteBounds = pointBounds(
    siteFragments.flatMap((fragment) =>
      fragment.vertexIds.map((vertexId) => simulation.vertices[vertexId].point),
    ),
  );
  const historyEntries = [...simulation.replayLog]
    .filter((entry) => {
      if (referenceProposal && entry.proposalId === referenceProposal.id) {
        return true;
      }
      if (referenceFragment && entry.fragmentId === referenceFragment.id) {
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
  const currentTab = view.modulePanels.informationGeometryLabTab;

  const renderPatchView = () => {
    if (!referenceFragment || !patch) {
      return <p className="htt-empty">Select a fragment to inspect its local manifold patch.</p>;
    }

    const fragmentPoints = referenceFragment.vertexIds.map((vertexId) => simulation.vertices[vertexId].point);
    const bounds = pointBounds(fragmentPoints);
    const polygon = fragmentPoints
      .map((point) => mapPointToFrame(point, bounds, 320, 220))
      .map((point) => `${point.x},${point.y}`)
      .join(" ");

    return (
      <div className="htt-lab-grid">
        <svg className="htt-lab-svg" viewBox="0 0 320 220" role="img" aria-label="Local manifold patch">
          <polygon points={polygon} fill="rgba(255, 255, 255, 0.04)" stroke="rgba(233, 225, 214, 0.28)" strokeWidth="1.4" />
          {patchSamples.map((sample, index) => {
            const mapped = mapPointToFrame(sample.point, bounds, 320, 220);
            const radius = 5 + clamp01(sample.field.curvature / 0.18) * 4;
            return (
              <g key={`lab-patch-sample-${index}`}>
                <circle
                  cx={mapped.x}
                  cy={mapped.y}
                  r={radius}
                  fill={grayscaleColor(clamp01(sample.field.total / Math.max(0.001, patch.centerField.total || 1)))}
                  stroke="rgba(245, 237, 225, 0.7)"
                  strokeWidth="1"
                  opacity={0.88}
                />
                <title>{`total ${sample.field.total.toFixed(3)} / asymmetry ${sample.field.asymmetry.toFixed(3)} / curvature ${sample.field.curvature.toFixed(3)}`}</title>
              </g>
            );
          })}
        </svg>
        <dl className="htt-detail-list">
          <div className="htt-detail-row">
            <dt>Fragment</dt>
            <dd>{fragmentTitle(referenceFragment)}</dd>
          </div>
          <div className="htt-detail-row">
            <dt>Field</dt>
            <dd className="htt-detail-mono">
              {`F ${formatMetric(referenceField?.forward)} / R ${formatMetric(referenceField?.reverse)} / A ${formatMetric(referenceField?.asymmetry)} / T ${formatMetric(referenceField?.total)} / K ${formatMetric(referenceField?.curvature)} / P ${formatMetric(referenceField?.projection)}`}
            </dd>
          </div>
          <div className="htt-detail-row">
            <dt>Phase</dt>
            <dd>{patch.resolvedPhase}</dd>
          </div>
          <div className="htt-detail-row">
            <dt>Crystallization</dt>
            <dd>{patch.crystallization.state}</dd>
          </div>
          <div className="htt-detail-row">
            <dt>Lean</dt>
            <dd>{referenceLean?.status ?? "fallback geometry"}</dd>
          </div>
        </dl>
      </div>
    );
  };

  const renderDivergenceView = () => {
    if (!referenceField) {
      return <p className="htt-empty">Divergence metrics appear here once a fragment or proposal is active.</p>;
    }

    const metrics = [
      { label: "forward", value: referenceField.forward ?? 0 },
      { label: "reverse", value: referenceField.reverse ?? 0 },
      { label: "asymmetry", value: referenceField.asymmetry ?? 0 },
      { label: "projection", value: referenceField.projection ?? 0 },
      { label: "curvature", value: referenceField.curvature ?? 0 },
      { label: "total", value: referenceField.total ?? 0 },
    ];
    const maxValue = Math.max(0.001, ...metrics.map((metric) => metric.value));

    return (
      <div className="htt-lab-stack">
        <div className="htt-lab-metric-grid">
          {metrics.map((metric, index) => (
            <article key={metric.label} className="htt-lab-metric-card">
              <p className="htt-lab-metric-card__label">{metric.label}</p>
              <p className="htt-lab-metric-card__value">{metric.value.toFixed(3)}</p>
              <div className="htt-lab-bar">
                <span
                  className="htt-lab-bar__fill"
                  style={{
                    width: `${clamp01(metric.value / maxValue) * 100}%`,
                    background: labColor(index),
                  }}
                />
              </div>
            </article>
          ))}
        </div>
        <div className="htt-lab-sample-list">
          {patchSamples.map((sample, index) => (
            <button
              key={`divergence-sample-${index}`}
              className="htt-lab-sample-card"
              type="button"
              onClick={() => referenceFragment && selectFragment(referenceFragment.id)}
            >
              <span className="htt-lab-sample-card__title">{`sample ${index + 1}`}</span>
              <span className="htt-lab-sample-card__meta">
                {`T ${sample.field.total.toFixed(3)} / A ${sample.field.asymmetry.toFixed(3)} / K ${sample.field.curvature.toFixed(3)}`}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  };

  const renderVoronoiView = () => {
    if (siteFragments.length === 0) {
      return <p className="htt-empty">A neighborhood is needed before the Bregman Voronoi approximation can be drawn.</p>;
    }

    const columns = 16;
    const rows = 10;
    const cellWidth = 320 / columns;
    const cellHeight = 220 / rows;
    const cells = Array.from({ length: columns * rows }, (_, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const point = {
        x: siteBounds.minX + ((column + 0.5) / columns) * Math.max(1, siteBounds.maxX - siteBounds.minX),
        y: siteBounds.minY + ((row + 0.5) / rows) * Math.max(1, siteBounds.maxY - siteBounds.minY),
      };
      const weights = inverseDistanceWeights(point, siteFragments.map((fragment) => fragment.centroid));
      const theta = weightedVector(
        siteFragments.map((fragment) => fragment.theta),
        weights,
      );
      const target = { theta, eta: computeEta(theta) };
      const closestSiteIndex = siteFragments.reduce((bestIndex, fragment, fragmentIndex, fragments) => {
        const current = computeBregman(target, {
          theta: fragment.theta,
          eta: fragment.eta,
        });
        const best = computeBregman(target, {
          theta: fragments[bestIndex].theta,
          eta: fragments[bestIndex].eta,
        });

        return current < best ? fragmentIndex : bestIndex;
      }, 0);

      return {
        x: column * cellWidth,
        y: row * cellHeight,
        color: labColor(closestSiteIndex),
      };
    });

    return (
      <div className="htt-lab-grid">
        <svg className="htt-lab-svg" viewBox="0 0 320 220" role="img" aria-label="Bregman Voronoi approximation">
          {cells.map((cell, index) => (
            <rect
              key={`voronoi-cell-${index}`}
              x={cell.x}
              y={cell.y}
              width={cellWidth + 0.4}
              height={cellHeight + 0.4}
              fill={cell.color}
              opacity={0.28}
            />
          ))}
          {siteFragments.map((fragment, index) => {
            const point = mapPointToFrame(fragment.centroid, siteBounds, 320, 220);
            return (
              <g key={`voronoi-site-${fragment.id}`} onClick={() => selectFragment(fragment.id)}>
                <circle cx={point.x} cy={point.y} r="7" fill={labColor(index)} stroke="rgba(12, 16, 18, 0.92)" strokeWidth="1.1" />
                <text className="htt-lab-svg-label" x={point.x} y={point.y - 12}>
                  {fragment.labels.short}
                </text>
              </g>
            );
          })}
        </svg>
        <p className="htt-detail-mono">
          Quadratic MVP Bregman Voronoi approximation over the current fragment neighborhood. Lean-backed projections still flow into the selected fragment field and phase.
        </p>
      </div>
    );
  };

  const renderChartsView = () => {
    if (!referenceFragment) {
      return <p className="htt-empty">Select a fragment to inspect primal and dual charts.</p>;
    }

    const chartSeries = [
      ...referenceFragment.vertexIds.map((vertexId, index) => {
        const vertex = simulation.vertices[vertexId];
        return {
          key: vertex.id,
          label: vertex.label ?? `vertex ${index + 1}`,
          theta: vertex.theta,
          eta: vertex.eta,
          color: labColor(index),
        };
      }),
      ...(referenceProposal
        ? [
            {
              key: referenceProposal.id,
              label: "proposal",
              theta: referenceProposal.theta,
              eta: referenceProposal.eta,
              color: "rgba(245, 237, 225, 0.9)",
            },
          ]
        : []),
    ];
    const dimension = Math.max(1, ...chartSeries.map((series) => Math.max(series.theta.length, series.eta.length)));
    const allValues = chartSeries.flatMap((series) => [...series.theta, ...series.eta]);
    const minValue = Math.min(...allValues, 0);
    const maxValue = Math.max(...allValues, 1);
    const valueSpan = Math.max(0.001, maxValue - minValue);
    const buildSeriesPath = (values: number[]) =>
      linePath(
        Array.from({ length: dimension }, (_, index) => ({
          x: 20 + (index / Math.max(1, dimension - 1)) * 280,
          y: 110 - (((values[index] ?? 0) - minValue) / valueSpan - 0.5) * 150,
        })),
      );

    return (
      <div className="htt-lab-grid">
        <svg className="htt-lab-svg" viewBox="0 0 320 220" role="img" aria-label="Primal coordinate chart">
          <text className="htt-lab-svg-title" x="20" y="24">theta chart</text>
          {chartSeries.map((series) => (
            <path key={`theta-${series.key}`} d={buildSeriesPath(series.theta)} fill="none" stroke={series.color} strokeWidth="2.1" />
          ))}
        </svg>
        <svg className="htt-lab-svg" viewBox="0 0 320 220" role="img" aria-label="Dual coordinate chart">
          <text className="htt-lab-svg-title" x="20" y="24">eta chart</text>
          {chartSeries.map((series) => (
            <path key={`eta-${series.key}`} d={buildSeriesPath(series.eta)} fill="none" stroke={series.color} strokeWidth="2.1" />
          ))}
        </svg>
      </div>
    );
  };

  const renderPotentialView = () => {
    if (!referenceFragment) {
      return <p className="htt-empty">Select a fragment to inspect the lifted convex potential view.</p>;
    }

    const potentials = [
      ...referenceFragment.vertexIds.map((vertexId, index) => {
        const vertex = simulation.vertices[vertexId];
        return {
          key: vertex.id,
          label: vertex.label ?? `vertex ${index + 1}`,
          value: quadraticPotentialValue(vertex.theta),
          color: labColor(index),
        };
      }),
      ...(referenceProposal
        ? [
            {
              key: referenceProposal.id,
              label: "proposal",
              value: quadraticPotentialValue(referenceProposal.theta),
              color: "rgba(245, 237, 225, 0.9)",
            },
          ]
        : []),
    ];
    const maxPotential = Math.max(0.001, ...potentials.map((potential) => potential.value));
    const thetaPreview = referenceProposal?.theta ?? referenceFragment.theta;
    const etaPreview = referenceProposal?.eta ?? referenceFragment.eta;

    return (
      <div className="htt-lab-stack">
        <svg className="htt-lab-svg" viewBox="0 0 320 220" role="img" aria-label="Lifted convex potential">
          <text className="htt-lab-svg-title" x="20" y="24">quadratic lift psi(theta)</text>
          {potentials.map((potential, index) => {
            const width = 44;
            const gap = 18;
            const height = (potential.value / maxPotential) * 140;
            const x = 28 + index * (width + gap);
            const y = 190 - height;
            return (
              <g key={`potential-${potential.key}`}>
                <rect x={x} y={y} width={width} height={height} fill={potential.color} opacity={0.82} rx="8" />
                <text className="htt-lab-svg-label" x={x + width / 2} y="206">
                  {potential.label}
                </text>
              </g>
            );
          })}
        </svg>
        <dl className="htt-detail-list">
          <div className="htt-detail-row">
            <dt>theta</dt>
            <dd className="htt-detail-mono">{formatVectorCompact(thetaPreview, 8)}</dd>
          </div>
          <div className="htt-detail-row">
            <dt>eta</dt>
            <dd className="htt-detail-mono">{formatVectorCompact(etaPreview, 8)}</dd>
          </div>
          <div className="htt-detail-row">
            <dt>psi</dt>
            <dd>{quadraticPotentialValue(thetaPreview).toFixed(3)}</dd>
          </div>
        </dl>
      </div>
    );
  };

  const renderHistoryView = () => {
    if (historyEntries.length === 0) {
      return <p className="htt-empty">Accumulated geometry appears here once replay/history entries exist for the current fragment or proposal.</p>;
    }

    const ticks = historyEntries.map((record) => record.entry.tick);
    const minTick = Math.min(...ticks);
    const maxTick = Math.max(...ticks);
    const maxMetric = Math.max(
      0.001,
      ...historyEntries.flatMap((record) => [
        record.geometry?.total ?? 0,
        record.geometry?.asymmetry ?? 0,
        record.geometry?.curvature ?? 0,
        record.geometry?.projection ?? 0,
      ]),
    );
    const toPoint = (tick: number, value: number) => ({
      x: 20 + ((tick - minTick) / Math.max(1, maxTick - minTick || 1)) * 280,
      y: 190 - (value / maxMetric) * 150,
    });
    const totalPath = linePath(historyEntries.map((record) => toPoint(record.entry.tick, record.geometry?.total ?? 0)));
    const asymmetryPath = linePath(historyEntries.map((record) => toPoint(record.entry.tick, record.geometry?.asymmetry ?? 0)));
    const curvaturePath = linePath(historyEntries.map((record) => toPoint(record.entry.tick, record.geometry?.curvature ?? 0)));
    const projectionPath = linePath(historyEntries.map((record) => toPoint(record.entry.tick, record.geometry?.projection ?? 0)));

    return (
      <div className="htt-lab-stack">
        <svg className="htt-lab-svg" viewBox="0 0 320 220" role="img" aria-label="Accumulated geometry over time">
          <text className="htt-lab-svg-title" x="20" y="24">accumulated geometry over time</text>
          <path d={totalPath} fill="none" stroke="rgba(245, 237, 225, 0.92)" strokeWidth="2.3" />
          <path d={asymmetryPath} fill="none" stroke={labColor(0)} strokeWidth="1.8" />
          <path d={curvaturePath} fill="none" stroke={labColor(1)} strokeWidth="1.8" />
          <path d={projectionPath} fill="none" stroke={labColor(3)} strokeWidth="1.8" />
        </svg>
        <div className="htt-lab-legend">
          <span className="htt-stage__legend-item"><span className="htt-stage__legend-swatch" style={{ background: "rgba(245, 237, 225, 0.92)" }} /> total</span>
          <span className="htt-stage__legend-item"><span className="htt-stage__legend-swatch" style={{ background: labColor(0) }} /> asymmetry</span>
          <span className="htt-stage__legend-item"><span className="htt-stage__legend-swatch" style={{ background: labColor(1) }} /> curvature</span>
          <span className="htt-stage__legend-item"><span className="htt-stage__legend-swatch" style={{ background: labColor(3) }} /> projection</span>
        </div>
      </div>
    );
  };

  return (
    <aside className="htt-app__panel htt-app__panel--lab">
      <section className="htt-section">
        <div className="htt-lab__header">
          <div>
            <p className="htt-app__eyebrow">Module</p>
            <h2 className="htt-section__title">Information Geometry Lab</h2>
          </div>
          <span className="htt-badge">{referenceLean?.status ?? "TS + Lean-backed"}</span>
        </div>
        <div className="htt-lab-tab-row">
          {INFORMATION_GEOMETRY_LAB_TABS.map((tab) => (
            <button
              key={tab.id}
              className={`htt-button ${currentTab === tab.id ? "htt-button--primary" : "htt-button--ghost"}`}
              type="button"
              onClick={() => setInformationGeometryLabTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      <section className="htt-section">
        <h2 className="htt-section__title">Geometry Context</h2>
        {referenceFragment ? (
          <dl className="htt-detail-list">
            <div className="htt-detail-row">
              <dt>Fragment</dt>
              <dd>
                <button className="htt-link-button" type="button" onClick={() => selectFragment(referenceFragment.id)}>
                  {fragmentTitle(referenceFragment)}
                </button>
              </dd>
            </div>
            <div className="htt-detail-row">
              <dt>Proposal</dt>
              <dd>
                {referenceProposal ? (
                  <button className="htt-link-button" type="button" onClick={() => selectProposal(referenceProposal.id)}>
                    {referenceProposal.title}
                  </button>
                ) : (
                  "none"
                )}
              </dd>
            </div>
            <div className="htt-detail-row">
              <dt>Neighborhood</dt>
              <dd>{siteFragments.length} sites</dd>
            </div>
            <div className="htt-detail-row">
              <dt>Field</dt>
              <dd className="htt-detail-mono">
                {`F ${formatMetric(referenceField?.forward)} / R ${formatMetric(referenceField?.reverse)} / A ${formatMetric(referenceField?.asymmetry)} / T ${formatMetric(referenceField?.total)} / K ${formatMetric(referenceField?.curvature)} / P ${formatMetric(referenceField?.projection)}`}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="htt-empty">Select a fragment or proposal to open the lab on a concrete local geometry.</p>
        )}
      </section>

      <section className="htt-section">
        <h2 className="htt-section__title">
          {INFORMATION_GEOMETRY_LAB_TABS.find((tab) => tab.id === currentTab)?.label ?? "Lab View"}
        </h2>
        {currentTab === "patches"
          ? renderPatchView()
          : currentTab === "divergence"
            ? renderDivergenceView()
            : currentTab === "voronoi"
              ? renderVoronoiView()
              : currentTab === "charts"
                ? renderChartsView()
                : currentTab === "potential"
                  ? renderPotentialView()
                  : renderHistoryView()}
      </section>
    </aside>
  );
}

function EventLogPanel() {
  const simulation = useHegelTriangleStore((state) => state.simulation);
  const view = useHegelTriangleStore((state) => state.view);
  const runtimeConfig = useHegelTriangleStore((state) => state.runtimeConfig);
  const playReplay = useHegelTriangleStore((state) => state.playReplay);
  const pauseReplay = useHegelTriangleStore((state) => state.pauseReplay);
  const exitReplay = useHegelTriangleStore((state) => state.exitReplay);
  const stepReplay = useHegelTriangleStore((state) => state.stepReplay);
  const stepPlayback = useHegelTriangleStore((state) => state.stepPlayback);
  const setReplayTick = useHegelTriangleStore((state) => state.setReplayTick);
  const selectReplayEvent = useHegelTriangleStore((state) => state.selectReplayEvent);
  const setReplayFilter = useHegelTriangleStore((state) => state.setReplayFilter);
  const setReplayProviderFilter = useHegelTriangleStore((state) => state.setReplayProviderFilter);
  const [semeioticEventFilter, setSemeioticEventFilter] = useState<SemeioticLogFilter>("all");
  const semeioticLogVisible = view.semeiotic.semeioticsEnabled || hasHistoricalSemeioticData(simulation);
  const entries = [
    ...filteredReplayEntries(simulation, view.replay.logFilter, view.replay.providerFilter).filter((entry) => {
      if (!semeioticLogVisible) {
        return !entry.eventType.startsWith("semeiotic_");
      }

      return matchesSemeioticEventFilter(entry, semeioticEventFilter);
    }),
  ].reverse();
  const replayMaxTick = maxReplayTick(simulation);

  return (
    <section className="htt-app__log htt-log">
      <div className="htt-log__header">
        <div>
          <p className="htt-app__eyebrow">Adjunctor Trace</p>
          <h2 className="htt-section__title">Chronological Event Log</h2>
        </div>
        <span className="htt-badge">{simulation.replayLog.length} entries</span>
      </div>
      <div className="htt-log__controls">
        <div className="htt-log__replay-row">
          <button className="htt-button htt-button--ghost" type="button" onClick={stepPlayback}>
            Phase
          </button>
          <button className="htt-button htt-button--ghost" type="button" onClick={exitReplay}>
            Live
          </button>
          <button className="htt-button htt-button--ghost" type="button" onClick={() => stepReplay(-1)}>
            Prev
          </button>
          <button
            className="htt-button htt-button--primary"
            type="button"
            onClick={view.replay.isPlaying ? pauseReplay : playReplay}
          >
            {view.replay.isPlaying ? "Pause Replay" : "Replay"}
          </button>
          <button className="htt-button htt-button--ghost" type="button" onClick={() => stepReplay(1)}>
            Next
          </button>
        </div>
        <div className="htt-log__replay-row">
          <label className="htt-log__scrubber">
            <span>Tick {view.replay.tick}</span>
            <input
              type="range"
              min={0}
              max={replayMaxTick}
              value={Math.min(view.replay.tick, replayMaxTick)}
              onChange={(event) => setReplayTick(Number(event.target.value))}
            />
          </label>
          <select
            aria-label="Replay log filter"
            className="htt-select htt-select--compact"
            value={view.replay.logFilter}
            onChange={(event) => setReplayFilter(event.target.value as ReplayFilter)}
          >
            <option value="all">All outcomes</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
            <option value="blocked">Blocked</option>
            <option value="promising">Promising</option>
            <option value="vacuous">Vacuous</option>
            <option value="system">System</option>
          </select>
          <select
            aria-label="Replay provider filter"
            className="htt-select htt-select--compact"
            value={view.replay.providerFilter}
            onChange={(event) => setReplayProviderFilter(event.target.value as ReplayProviderFilter)}
          >
            <option value="all">All providers</option>
            <option value="personal-open-llm">Library Proposer</option>
            <option value="chatgpt">ChatGPT</option>
            <option value="claude">Claude</option>
            <option value="lean-verifier">Lean</option>
          </select>
          {semeioticLogVisible ? (
            <select
              aria-label="Semeiotic event filter"
              className="htt-select htt-select--compact"
              value={semeioticEventFilter}
              onChange={(event) => setSemeioticEventFilter(event.target.value as SemeioticLogFilter)}
            >
              <option value="all">All log events</option>
              <option value="semeiotic">All semeiotic</option>
              <option value="annotation">Annotations</option>
              <option value="mismatch">Mismatches</option>
              <option value="summary">Summaries</option>
              <option value="chain">Chains</option>
              <option value="overlay">Overlay toggles</option>
            </select>
          ) : null}
        </div>
      </div>
      <div className="htt-log__stream">
        {entries.map((entry) => {
          const eventProposal = entry.proposalId ? simulation.proposals[entry.proposalId] : undefined;
          const eventProviders = providerSequenceForEntry(entry, simulation);
          const eventOrchestration = orchestrationSignal(eventProposal);
          const eventPayload = asRecord(entry.payload);
          const eventGeometry = eventGeometrySummary(entry);
          const eventSemeiotic = semeioticLogVisible
            ? semeioticProfileSignal(
                eventProposal,
                entry.fragmentId ? simulation.fragments[entry.fragmentId] : undefined,
                view.semeiotic.semeioticAutoAnnotate,
              )
            : undefined;
          const eventLean = leanEventSignal(entry, eventProposal);
          const eventAssessments = asStringArray(eventPayload?.assessments);
          const eventCritique = asStringArray(eventPayload?.critiqueFindings);
          const eventBoundary = asRecord(eventPayload?.leanBoundary);
          const stepLabel = stageStepLabel(entry);

          return (
            <article
              key={entry.id}
              className="htt-log-entry"
              data-event-type={entry.eventType}
              data-fresh={
                simulation.activeTick - entry.tick <= runtimeConfig.liveTickWindow && view.replay.mode === "live"
              }
              data-selected={entry.id === view.replay.selectedEventId}
              onClick={() => selectReplayEvent(entry.id)}
            >
              <div className="htt-log-entry__tick">Tick {entry.tick}</div>
              <div>
                <div className="htt-log-entry__chips">
                  <span className="htt-log-step-chip">{stepLabel}</span>
                  {eventProviders.map((providerId) => (
                    <span key={`${entry.id}-${providerId}`} className="htt-provider-chip" data-provider={providerId}>
                      <span className="htt-provider-chip__glyph">{providerGlyph(providerId)}</span>
                      {providerLabel(providerId)}
                    </span>
                  ))}
                  <span className="htt-log-entry__meta htt-log-entry__meta--outcome">
                    {replayOutcomeForEntry(simulation, entry)}
                  </span>
                  {typeof eventBoundary?.promotionDecision === "string" ? (
                    <span className="htt-log-entry__meta htt-log-entry__meta--decision">
                      {eventBoundary.promotionDecision}
                    </span>
                  ) : null}
                </div>
                <p className="htt-log-entry__message">{entry.message}</p>
                <p className="htt-log-entry__meta">
                  {entry.eventType}
                  {entry.fragmentId ? ` / ${entry.fragmentId}` : ""}
                  {entry.proposalId ? ` / ${entry.proposalId}` : ""}
                </p>
                {eventGeometry ? (
                  <p className="htt-log-entry__metrics">
                    {`F ${formatMetric(eventGeometry.forward)} / R ${formatMetric(eventGeometry.reverse)} / A ${formatMetric(eventGeometry.asymmetry)} / T ${formatMetric(eventGeometry.total)} / K ${formatMetric(eventGeometry.curvature)} / P ${formatMetric(eventGeometry.projection)} / ${eventGeometry.phase ?? "latent"}`}
                  </p>
                ) : null}
                {semeioticLogVisible && view.semeiotic.showLogBadges && eventSemeiotic ? (
                  <p className="htt-log-entry__detail">
                    {`Semeiotic: ${semeioticLensValue(eventSemeiotic, view.semeiotic.selectedLens)}`}
                  </p>
                ) : null}
                {eventLean?.stage === "snippet_generated" && eventLean.snippetPath ? (
                  <p className="htt-log-entry__detail">
                    Snippet: {compactText(eventLean.snippetPath, 120)}
                  </p>
                ) : null}
                {eventLean?.stage && eventLean.theoremKind ? (
                  <p className="htt-log-entry__detail">
                    Artifact: {theoremKindLabel(eventLean.theoremKind)}
                  </p>
                ) : null}
                {eventLean?.stage === "run_started" ? (
                  <p className="htt-log-entry__detail">
                    Lean run: {compactText(eventLean.command, 120) ?? "started"}
                  </p>
                ) : null}
                {eventLean?.stage === "run_finished" ? (
                  <p className="htt-log-entry__detail">
                    Lean finished: {eventLean.status ?? "completed"}
                  </p>
                ) : null}
                {eventLean?.stderrPath &&
                (eventLean.status === "failed" ||
                  eventLean.status === "rejected" ||
                  eventLean.status === "blocked" ||
                  eventLean.status === "unavailable") ? (
                  <p className="htt-log-entry__detail htt-log-entry__detail--error">
                    stderr: {compactText(eventLean.stderrPath, 160)}
                  </p>
                ) : null}
                {eventAssessments.length > 0 ? (
                  <p className="htt-log-entry__detail">
                    Synthesis: {eventAssessments.slice(0, 3).join(" / ")}
                  </p>
                ) : null}
                {eventCritique.length > 0 ? (
                  <p className="htt-log-entry__detail">
                    Critique: {eventCritique.slice(0, 2).join(" / ")}
                  </p>
                ) : null}
                {!eventCritique.length && eventOrchestration?.critiqueFindings.length ? (
                  <p className="htt-log-entry__detail">
                    Critique: {eventOrchestration.critiqueFindings.slice(0, 2).join(" / ")}
                  </p>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function HegelTriangleApp() {
  const simulation = useHegelTriangleStore((state) => state.simulation);
  const replay = useHegelTriangleStore((state) => state.view.replay);
  const activeMainView = useHegelTriangleStore((state) => state.view.activeMainView);
  const informationGeometryLabOpen = useHegelTriangleStore(
    (state) => state.view.modulePanels.informationGeometryLabOpen,
  );
  const informationGeometryLabTab = useHegelTriangleStore(
    (state) => state.view.modulePanels.informationGeometryLabTab,
  );
  const speedMultiplier = useHegelTriangleStore((state) => state.speedMultiplier);
  const stepPlayback = useHegelTriangleStore((state) => state.stepPlayback);
  const stepReplay = useHegelTriangleStore((state) => state.stepReplay);
  const pauseReplay = useHegelTriangleStore((state) => state.pauseReplay);
  const loadRuntimeConfig = useHegelTriangleStore((state) => state.loadRuntimeConfig);
  const setActiveMainView = useHegelTriangleStore((state) => state.setActiveMainView);
  const toggleInformationGeometryLab = useHegelTriangleStore((state) => state.toggleInformationGeometryLab);
  const semeioticRuntimeEnabled = useHegelTriangleStore((state) => state.view.semeiotic.semeioticsEnabled);
  const semeioticGrammarPanelOpen = useHegelTriangleStore((state) => state.view.semeiotic.semeioticGrammarPanelOpen);
  const toggleSemeioticRuntime = useHegelTriangleStore((state) => state.toggleSemeioticRuntime);
  const updateSemeioticState = useHegelTriangleStore((state) => state.updateSemeioticState);

  const playbackStep = useEffectEvent(() => {
    stepPlayback();
  });

  useEffect(() => {
    void loadRuntimeConfig();
  }, [loadRuntimeConfig]);

  useEffect(() => {
    if (simulation.runState !== "playing") {
      return undefined;
    }

    const intervalHandle = window.setInterval(() => {
      playbackStep();
    }, Math.max(220, 1200 / speedMultiplier));

    return () => {
      window.clearInterval(intervalHandle);
    };
  }, [playbackStep, simulation.runState, speedMultiplier]);

  useEffect(() => {
    if (replay.mode !== "history" || !replay.isPlaying) {
      return undefined;
    }

    const maxTick = maxReplayTick(simulation);
    if (replay.tick >= maxTick) {
      pauseReplay();
      return undefined;
    }

    const intervalHandle = window.setInterval(() => {
      stepReplay(1);
    }, Math.max(220, 1200 / speedMultiplier));

    return () => {
      window.clearInterval(intervalHandle);
    };
  }, [pauseReplay, replay.isPlaying, replay.mode, replay.tick, simulation, speedMultiplier, stepReplay]);

  const splitViewActive = informationGeometryLabOpen;
  const showingLabMainView = activeMainView === "information-geometry-lab" && !splitViewActive;
  const semeioticModuleAvailable = semeioticRuntimeEnabled || hasHistoricalSemeioticData(simulation);

  return (
    <div className="htt-app">
      <div className={`htt-app__shell ${showingLabMainView ? "htt-app__shell--single-module" : ""}`}>
        <header className="htt-app__header">
          <div>
            <p className="htt-app__eyebrow">Semantic Refinement Workbench</p>
            <h1 className="htt-app__title">Hegel Triangle Fragment Transform</h1>
            <p className="htt-app__subtitle">
              A recursive 2D rendering engine for recursive triangle blow-up, fragment selection, and semantic bridge
              inspection across the fragment dust.
            </p>
            <div className="htt-module-menu">
              <span className="htt-module-menu__label">Modules</span>
              <button
                className={`htt-button ${activeMainView === "triangle" && !splitViewActive ? "htt-button--primary" : "htt-button--ghost"}`}
                type="button"
                onClick={() => setActiveMainView("triangle")}
              >
                Triangle Interface
              </button>
              <button
                className={`htt-button ${activeMainView === "information-geometry-lab" && !splitViewActive ? "htt-button--primary" : "htt-button--ghost"}`}
                type="button"
                onClick={() => setActiveMainView("information-geometry-lab")}
              >
                Information Geometry Lab
              </button>
              <button
                className={`htt-button ${splitViewActive ? "htt-button--primary" : "htt-button--ghost"}`}
                type="button"
                onClick={toggleInformationGeometryLab}
              >
                {splitViewActive ? "Close Split View" : "Open Split View"}
              </button>
              <button
                className={`htt-button ${semeioticRuntimeEnabled ? "htt-button--primary" : "htt-button--ghost"}`}
                type="button"
                onClick={toggleSemeioticRuntime}
              >
                {semeioticRuntimeEnabled ? "Semeiotics On" : "Enable Semeiotics"}
              </button>
              <button
                className={`htt-button ${semeioticGrammarPanelOpen ? "htt-button--primary" : "htt-button--ghost"}`}
                type="button"
                disabled={!semeioticModuleAvailable}
                onClick={() =>
                  updateSemeioticState({
                    semeioticGrammarPanelOpen: !semeioticGrammarPanelOpen,
                  })
                }
              >
                {semeioticGrammarPanelOpen ? "Hide Semeiotic View" : "Open Semeiotic View"}
              </button>
              <span className="htt-badge">
                {`Lab tab: ${
                  INFORMATION_GEOMETRY_LAB_TABS.find((tab) => tab.id === informationGeometryLabTab)?.label ??
                  "Patches"
                }`}
              </span>
            </div>
          </div>
          <div className="htt-app__tick">
            <span className="htt-app__tick-value">{simulation.activeTick}</span>
            <span className="htt-app__tick-label">Active Tick</span>
          </div>
        </header>

        {showingLabMainView ? (
          <InformationGeometryLabView mode="main" />
        ) : (
          <>
            <section className={`htt-app__workspace ${splitViewActive ? "htt-app__workspace--with-lab" : ""}`}>
              <ControlPanel />
              <StagePanel />
              {splitViewActive ? <InformationGeometryLabView mode="split" /> : null}
              <InspectorPanel />
            </section>

            <EventLogPanel />
          </>
        )}
      </div>
    </div>
  );
}
