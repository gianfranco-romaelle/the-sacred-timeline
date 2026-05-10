import {
  computeNegAdjunctionField,
  interpolateDualSimplexPoint,
  interpolatePrimalSimplexPoint,
  type NegAdjunctionField,
} from "@/features/hegel-triangle-transform/information-geometry";
import { selectLocalGraphNeighborhood } from "@/features/hegel-triangle-transform/sample-data";
import type {
  FragmentId,
  FragmentPhase,
  InformationGeometryMode,
  InformationGeometryLabScalarField,
  InformationGeometryLabVoronoiSiteSource,
  SemanticProposal,
  SimulationState,
  TriangleFragment,
} from "@/types/hegel-triangle";
import type {
  IGAdapterState,
  IGChartPoint,
  IGChartSnapshot,
  IGLiftedPoint,
  IGScalarFieldSample,
  IGSite,
  IGTrianglePatch,
} from "./types";
import {
  computeGeometryModeLiftedHeight,
  getGeometryModeDefinition,
} from "./geometryRegistry";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function resolveTick(state: IGAdapterState, tick?: number) {
  if (typeof tick === "number") {
    return tick;
  }

  if (typeof state.view.informationGeometryLab?.selectedTick === "number") {
    return state.view.informationGeometryLab.selectedTick;
  }

  return state.view.replay.mode === "history" ? state.view.replay.tick : state.simulation.activeTick;
}

function selectedGeometryMode(state: IGAdapterState): InformationGeometryMode {
  return state.view.informationGeometryLab.selectedGeometryMode;
}

function geometryRuntime(state: IGAdapterState) {
  const geometryMode = selectedGeometryMode(state);
  const definition = getGeometryModeDefinition(geometryMode);
  return {
    geometryMode,
    definition,
    geometrySource:
      definition.implementationStatus === "working"
        ? ("native" as const)
        : ("quadratic-surrogate" as const),
  };
}

export function getGeometryAtlasRuntime(state: IGAdapterState) {
  return geometryRuntime(state);
}

function scalarPoint(values: number[]) {
  return {
    x: values[0] ?? 0,
    y: values[1] ?? 0,
  };
}

function fieldPhase(proposal?: SemanticProposal, fragment?: TriangleFragment): FragmentPhase | string | undefined {
  const payload = asRecord(proposal?.payload);
  const orchestration = asRecord(payload?.orchestration);
  const leanBridge = asRecord(orchestration?.leanBridge);
  return (typeof leanBridge?.phase === "string" ? leanBridge.phase : undefined) ?? fragment?.phase;
}

function promiseScores(proposal?: SemanticProposal) {
  const payload = asRecord(proposal?.payload);
  const orchestration = asRecord(payload?.orchestration);
  const promiseProfile = asRecord(orchestration?.promiseProfile);
  return {
    constructive: asNumber(promiseProfile?.constructivePromise) ?? 0,
    obstructive: asNumber(promiseProfile?.obstructivePromise) ?? 0,
  };
}

function divergenceFieldSignal(
  proposal?: SemanticProposal,
  fragment?: TriangleFragment,
): (Partial<NegAdjunctionField> & { phase?: FragmentPhase | string }) | undefined {
  const payload = asRecord(proposal?.payload);
  const orchestration = asRecord(payload?.orchestration);
  const divergenceField = asRecord(orchestration?.divergenceField);

  if (!divergenceField && !fragment) {
    return undefined;
  }

  const forward = asNumber(divergenceField?.forward);
  const reverse = asNumber(divergenceField?.reverse);
  const asymmetry = asNumber(divergenceField?.asymmetry);
  const curvature = asNumber(divergenceField?.curvature);
  const projection = asNumber(divergenceField?.projection) ?? asNumber(divergenceField?.projectionDivergence);
  const total =
    asNumber(divergenceField?.total) ??
    (typeof forward === "number" || typeof reverse === "number" || typeof projection === "number"
      ? (forward ?? 0) + (reverse ?? 0) + (projection ?? 0)
      : undefined);

  if (
    typeof forward !== "number" &&
    typeof reverse !== "number" &&
    typeof asymmetry !== "number" &&
    typeof curvature !== "number" &&
    typeof projection !== "number" &&
    typeof total !== "number" &&
    !fragment?.phase
  ) {
    return undefined;
  }

  return {
    forward,
    reverse,
    asymmetry,
    curvature,
    projection,
    projectionDivergence: projection,
    total,
    phase: fieldPhase(proposal, fragment),
  };
}

function fallbackField(
  geometryMode: InformationGeometryMode,
  fragment: TriangleFragment,
  proposal?: SemanticProposal,
): NegAdjunctionField {
  if (!proposal) {
    return {
      forward: 0,
      reverse: 0,
      asymmetry: 0,
      curvature: 0,
      projection: 0,
      projectionDivergence: 0,
      total: 0,
    };
  }

  const definition = getGeometryModeDefinition(geometryMode);
  const forward = definition.hooks.computeDivergence({
    p: { theta: proposal.theta, eta: proposal.eta },
    q: { theta: fragment.theta, eta: fragment.eta },
  });
  const reverse = definition.hooks.computeDivergence({
    p: { theta: fragment.theta, eta: fragment.eta },
    q: { theta: proposal.theta, eta: proposal.eta },
  });

  return {
    forward,
    reverse,
    asymmetry: Math.abs(forward - reverse),
    curvature: 0,
    projection: 0,
    projectionDivergence: 0,
    total: forward + reverse,
  };
}

function authoritativeField(
  geometryMode: InformationGeometryMode,
  fragment: TriangleFragment,
  proposal?: SemanticProposal,
): NegAdjunctionField {
  const signal = divergenceFieldSignal(proposal, fragment);
  const fallback = fallbackField(geometryMode, fragment, proposal);
  const projection = signal?.projection ?? signal?.projectionDivergence ?? fallback.projection;
  return {
    forward: signal?.forward ?? fallback.forward,
    reverse: signal?.reverse ?? fallback.reverse,
    asymmetry: signal?.asymmetry ?? fallback.asymmetry,
    curvature: signal?.curvature ?? fallback.curvature,
    projection,
    projectionDivergence: projection,
    total:
      signal?.total ??
      (signal?.forward ?? fallback.forward) + (signal?.reverse ?? fallback.reverse) + projection,
  };
}

function computeGeometryAwareField(
  state: IGAdapterState,
  fragment: TriangleFragment,
  proposal?: SemanticProposal,
): NegAdjunctionField {
  const runtime = geometryRuntime(state);

  return authoritativeField(runtime.geometryMode, fragment, proposal);
}

function proposalLabel(proposal: SemanticProposal, fragment: TriangleFragment) {
  return proposal.title || fragment.labels.title || fragment.labels.short;
}

function isProposalVisibleAtTick(proposal: SemanticProposal, tick: number) {
  return proposal.createdAtTick <= tick;
}

function latestProposalForFragmentAtTick(
  simulation: SimulationState,
  fragment: TriangleFragment,
  tick: number,
): SemanticProposal | undefined {
  const allProposals = Object.values(simulation.proposals)
    .filter((proposal) => proposal.fragmentId === fragment.id && isProposalVisibleAtTick(proposal, tick))
    .sort((left, right) => right.updatedAtTick - left.updatedAtTick);

  return allProposals[0];
}

function activeProposalSitesForTick(state: IGAdapterState, tick: number, fragmentId?: FragmentId) {
  const fragmentScope =
    fragmentId ??
    state.view.informationGeometryLab.selectedFragmentId ??
    state.view.selectedFragmentId ??
    state.simulation.activeFragmentId;

  const fragmentIds =
    fragmentScope && state.simulation.fragments[fragmentScope]
      ? Array.from(selectLocalGraphNeighborhood(state.simulation, fragmentScope, 1).fragmentIds)
      : Object.keys(state.simulation.fragments);

  return Object.values(state.simulation.proposals)
    .filter(
      (proposal) =>
        proposal.createdAtTick <= tick &&
        proposal.updatedAtTick <= tick &&
        fragmentIds.includes(proposal.fragmentId),
    )
    .map((proposal) => {
      const fragment = state.simulation.fragments[proposal.fragmentId];
      return fragment ? fragmentSite(state, fragment, proposal, tick) : undefined;
    })
    .filter((site): site is IGSite => Boolean(site));
}

function persistentSitesForTick(state: IGAdapterState, tick: number) {
  const fragmentSites = state.simulation.persistent.promotedFragmentIds
    .map((fragmentId) => state.simulation.fragments[fragmentId])
    .filter((fragment): fragment is TriangleFragment => Boolean(fragment))
    .map((fragment) =>
      fragmentSite(state, fragment, latestProposalForFragmentAtTick(state.simulation, fragment, tick), tick),
    );

  const proposalSites = state.simulation.persistent.promotedProposalIds
    .map((proposalId) => state.simulation.proposals[proposalId])
    .filter((proposal): proposal is SemanticProposal => Boolean(proposal) && proposal.createdAtTick <= tick)
    .map((proposal) => {
      const fragment = state.simulation.fragments[proposal.fragmentId];
      return fragment ? fragmentSite(state, fragment, proposal, tick) : undefined;
    })
    .filter((site): site is IGSite => Boolean(site));

  return [...fragmentSites, ...proposalSites];
}

function selectedVoronoiSiteSource(state: IGAdapterState): InformationGeometryLabVoronoiSiteSource {
  return state.view.informationGeometryLab.voronoiSiteSource;
}

function fragmentSite(
  state: IGAdapterState,
  fragment: TriangleFragment,
  proposal: SemanticProposal | undefined,
  tick: number,
): IGSite {
  const runtime = geometryRuntime(state);
  const field = computeGeometryAwareField(state, fragment, proposal);
  const promise = promiseScores(proposal);
  const sourceEmbedding = proposal?.embedding ?? fragment.embedding;
  const sourceTheta = proposal?.theta ?? fragment.theta;
  const sourceEta = proposal?.eta ?? fragment.eta;

  return {
    id: proposal ? `ig_site_${fragment.id}_${proposal.id}` : `ig_site_${fragment.id}`,
    fragmentId: fragment.id,
    proposalId: proposal?.id,
    tick,
    geometryMode: runtime.geometryMode,
    geometrySource: runtime.geometrySource,
    label: proposal ? proposalLabel(proposal, fragment) : fragment.labels.title ?? fragment.labels.short,
    point: fragment.centroid,
    embedding: [...sourceEmbedding],
    theta: [...sourceTheta],
    eta: [...sourceEta],
    divergence: field.total,
    asymmetry: field.asymmetry,
    curvature: field.curvature,
    projection: field.projection,
    promiseConstructive: promise.constructive,
    promiseObstructive: promise.obstructive,
    phase: fieldPhase(proposal, fragment),
    sourceKind: proposal ? "proposal" : "fragment",
  };
}

function scalarValueForSite(site: IGSite, fieldKind: InformationGeometryLabScalarField) {
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

const PATCH_WEIGHTS = [
  [0.72, 0.14, 0.14],
  [0.14, 0.72, 0.14],
  [0.14, 0.14, 0.72],
  [1 / 3, 1 / 3, 1 / 3],
  [0.52, 0.24, 0.24],
  [0.24, 0.52, 0.24],
  [0.24, 0.24, 0.52],
] as const;

function patchVertices(simulation: SimulationState, fragment: TriangleFragment) {
  return fragment.vertexIds
    .map((vertexId) => simulation.vertices[vertexId])
    .filter((vertex): vertex is SimulationState["vertices"][keyof SimulationState["vertices"]] => Boolean(vertex));
}

export function getActiveTrianglePatch(state: IGAdapterState, fragmentId: FragmentId): IGTrianglePatch | undefined {
  const tick = resolveTick(state);
  const fragment = state.simulation.fragments[fragmentId];
  if (!fragment) {
    return undefined;
  }

  const runtime = geometryRuntime(state);
  const proposal = latestProposalForFragmentAtTick(state.simulation, fragment, tick);
  const centerField = computeGeometryAwareField(state, fragment, proposal);
  const promise = promiseScores(proposal);
  const vertices = patchVertices(state.simulation, fragment);
  if (vertices.length !== 3) {
    return undefined;
  }

  const statisticalVertices = vertices.map((vertex) => ({
    theta: vertex.theta,
    eta: vertex.eta,
  }));

  const scalarSamples: IGScalarFieldSample[] = PATCH_WEIGHTS.map((weights, index) => {
    const primal = interpolatePrimalSimplexPoint(statisticalVertices, [...weights]);
    const dual = interpolateDualSimplexPoint(statisticalVertices, [...weights]);
    const field = computeNegAdjunctionField(
      { F: primal, G: dual },
      undefined,
      centerField.projection,
      centerField.curvature,
    );
    const point = {
      x: weights.reduce((sum, weight, weightIndex) => sum + vertices[weightIndex].point.x * weight, 0),
      y: weights.reduce((sum, weight, weightIndex) => sum + vertices[weightIndex].point.y * weight, 0),
    };

    return {
      id: `ig_patch_${fragment.id}_${index}`,
      fragmentId: fragment.id,
      proposalId: proposal?.id,
      tick,
      geometryMode: runtime.geometryMode,
      geometrySource: runtime.geometrySource,
      point,
      fieldKind: "divergence",
      value: field.total,
      divergence: field.total,
      asymmetry: field.asymmetry,
      curvature: field.curvature,
      projection: field.projection,
      promiseConstructive: promise.constructive,
      promiseObstructive: promise.obstructive,
    };
  });

  return {
    fragmentId: fragment.id,
    proposalId: proposal?.id,
    tick,
    geometryMode: runtime.geometryMode,
    geometrySource: runtime.geometrySource,
    centroid: fragment.centroid,
    phase: fieldPhase(proposal, fragment),
    centerField,
    vertices: vertices.map((vertex) => ({
      id: vertex.id,
      point: vertex.point,
      embedding: [...vertex.embedding],
      theta: [...vertex.theta],
      eta: [...vertex.eta],
    })),
    scalarSamples,
  };
}

export function getNearbyIGSites(state: IGAdapterState, fragmentId: FragmentId, tick?: number): IGSite[] {
  const resolvedTick = resolveTick(state, tick);
  const fragment = state.simulation.fragments[fragmentId];
  if (!fragment) {
    return [];
  }

  const neighborhood = selectLocalGraphNeighborhood(state.simulation, fragmentId, 1);
  return Array.from(neighborhood.fragmentIds)
    .map((neighborId) => state.simulation.fragments[neighborId])
    .filter((candidate): candidate is TriangleFragment => Boolean(candidate))
    .map((neighbor) =>
      fragmentSite(state, neighbor, latestProposalForFragmentAtTick(state.simulation, neighbor, resolvedTick), resolvedTick),
    )
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function getScalarFieldSamples(
  state: IGAdapterState,
  fragmentId: FragmentId,
  fieldKind: InformationGeometryLabScalarField,
): IGScalarFieldSample[] {
  const patch = getActiveTrianglePatch(state, fragmentId);
  if (!patch) {
    return [];
  }

  return patch.scalarSamples.map((sample) => ({
    ...sample,
    fieldKind,
    value:
      fieldKind === "asymmetry"
        ? sample.asymmetry
        : fieldKind === "curvature"
          ? sample.curvature
          : fieldKind === "projection"
            ? sample.projection
            : fieldKind === "promiseConstructive"
              ? sample.promiseConstructive
              : fieldKind === "promiseObstructive"
                ? sample.promiseObstructive
                : sample.divergence,
  }));
}

export function getVoronoiSites(state: IGAdapterState, tick?: number, fragmentId?: FragmentId): IGSite[] {
  const resolvedTick = resolveTick(state, tick);
  const source = selectedVoronoiSiteSource(state);

  const sites =
    source === "activeProposals"
      ? activeProposalSitesForTick(state, resolvedTick, fragmentId)
      : source === "persistentNodes"
        ? persistentSitesForTick(state, resolvedTick)
        : fragmentId
          ? getNearbyIGSites(state, fragmentId, resolvedTick)
          : Object.values(state.simulation.fragments)
              .filter((fragment) => fragment.status !== "archived")
              .map((fragment) =>
                fragmentSite(
                  state,
                  fragment,
                  latestProposalForFragmentAtTick(state.simulation, fragment, resolvedTick),
                  resolvedTick,
                ),
              );

  return sites
    .sort((left, right) => {
      const divergenceDelta = right.divergence - left.divergence;
      if (Math.abs(divergenceDelta) > Number.EPSILON) {
        return divergenceDelta;
      }
      return left.label.localeCompare(right.label);
    });
}

export function getDualChartPoints(state: IGAdapterState, tick?: number, fragmentId?: FragmentId): IGChartSnapshot {
  const resolvedTick = resolveTick(state, tick);
  const sites = getVoronoiSites(state, resolvedTick, fragmentId);
  const runtime = geometryRuntime(state);

  const toChartPoint = (site: IGSite, chartKind: "theta" | "eta"): IGChartPoint => ({
    id: `${site.id}_${chartKind}`,
    fragmentId: site.fragmentId,
    proposalId: site.proposalId,
    tick: resolvedTick,
    geometryMode: runtime.geometryMode,
    geometrySource: runtime.geometrySource,
    chartKind,
    point: scalarPoint(
      runtime.definition.hooks.computeChartProjection({
        theta: site.theta,
        eta: site.eta,
        chartKind,
      }),
    ),
    coordinates: [
      ...runtime.definition.hooks.computeChartProjection({
        theta: site.theta,
        eta: site.eta,
        chartKind,
      }),
    ],
    divergence: site.divergence,
    asymmetry: site.asymmetry,
    curvature: site.curvature,
    projection: site.projection,
    promiseConstructive: site.promiseConstructive,
    promiseObstructive: site.promiseObstructive,
    phase: site.phase,
    sourceKind: site.sourceKind,
  });

  return {
    tick: resolvedTick,
    geometryMode: runtime.geometryMode,
    geometrySource: runtime.geometrySource,
    thetaPoints: sites.map((site) => toChartPoint(site, "theta")),
    etaPoints: sites.map((site) => toChartPoint(site, "eta")),
  };
}

export function getLiftedSurfacePoints(state: IGAdapterState, tick?: number, fragmentId?: FragmentId): IGLiftedPoint[] {
  const resolvedTick = resolveTick(state, tick);
  const runtime = geometryRuntime(state);
  return getVoronoiSites(state, resolvedTick, fragmentId).map((site) => ({
    id: `${site.id}_lifted`,
    fragmentId: site.fragmentId,
    proposalId: site.proposalId,
    tick: resolvedTick,
    geometryMode: runtime.geometryMode,
    geometrySource: runtime.geometrySource,
    basePoint: scalarPoint(site.theta),
    height: computeGeometryModeLiftedHeight(runtime.geometryMode, {
      theta: site.theta,
      eta: site.eta,
    }),
    embedding: [...site.embedding],
    theta: [...site.theta],
    eta: [...site.eta],
    divergence: site.divergence,
    asymmetry: site.asymmetry,
    curvature: site.curvature,
    projection: site.projection,
    promiseConstructive: site.promiseConstructive,
    promiseObstructive: site.promiseObstructive,
    phase: site.phase,
    sourceKind: site.sourceKind,
  }));
}
