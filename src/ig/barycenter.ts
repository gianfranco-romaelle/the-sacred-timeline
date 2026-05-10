import type { StatisticalPoint } from "@/features/hegel-triangle-transform/information-geometry";
import type {
  FragmentId,
  InformationGeometryLabBarycenterSourceMode,
  InformationGeometryLabBarycenterWeightMode,
  InformationGeometryMode,
  SemanticProposal,
} from "@/types/hegel-triangle";
import { getNearbyIGSites, getVoronoiSites } from "./adapters";
import { getGeometryModeDefinition } from "./geometryRegistry";
import type { IGAdapterState, IGSite } from "./types";

export type BarycenterWeightStrategy =
  | InformationGeometryLabBarycenterWeightMode
  | "uniform"
  | "corpusRelevance"
  | "constructivePromise"
  | "obstructivePromise"
  | "divergence";

export interface BarycenterPoint extends StatisticalPoint {
  id: string;
  fragmentId?: FragmentId;
  proposalId?: string;
  tick?: number;
  sourceKind?: IGSite["sourceKind"];
  corpusRelevance: number;
  constructivePromise: number;
  obstructivePromise: number;
  divergence: number;
}

export interface BarycenterInputSet {
  geometryMode: InformationGeometryMode;
  sourceMode: InformationGeometryLabBarycenterSourceMode;
  weightMode: InformationGeometryLabBarycenterWeightMode;
  tick: number;
  fragmentId?: FragmentId;
  proposalId?: string;
  sites: IGSite[];
  points: BarycenterPoint[];
  weights: number[];
}

export interface BarycenterComputationResult {
  geometryMode: InformationGeometryMode;
  point: StatisticalPoint;
  points: BarycenterPoint[];
  weights: number[];
  method: string;
  iterations: number;
}

function roundMetric(value: number) {
  return Number(value.toFixed(6));
}

function clampPositive(value: number, fallback = 0.05) {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}

function resolveTick(state: IGAdapterState) {
  return (
    state.view.informationGeometryLab.selectedTick ??
    (state.view.replay.mode === "history" ? state.view.replay.tick : state.simulation.activeTick)
  );
}

function resolveFragmentId(state: IGAdapterState) {
  return (
    state.view.informationGeometryLab.selectedFragmentId ??
    state.view.selectedFragmentId ??
    state.simulation.activeFragmentId
  );
}

function resolveProposalId(state: IGAdapterState) {
  return (
    state.view.informationGeometryLab.selectedProposalId ??
    state.view.selectedProposalId ??
    state.simulation.activeProposalId
  );
}

function proposalCorpusRelevance(proposal?: SemanticProposal) {
  if (!proposal || proposal.corpusSupport.length === 0) {
    return 0;
  }
  const total = proposal.corpusSupport.reduce((sum, support) => sum + (support.similarity ?? 0), 0);
  return roundMetric(total / proposal.corpusSupport.length);
}

function latestProposalForFragmentAtTick(state: IGAdapterState, fragmentId: FragmentId, tick: number) {
  const fragment = state.simulation.fragments[fragmentId];
  if (!fragment) {
    return undefined;
  }

  return fragment.activeProposalIds
    .map((proposalId) => state.simulation.proposals[proposalId])
    .filter((proposal): proposal is SemanticProposal => Boolean(proposal) && proposal.createdAtTick <= tick)
    .sort((left, right) => right.updatedAtTick - left.updatedAtTick || left.id.localeCompare(right.id))[0];
}

function withVoronoiSource(
  state: IGAdapterState,
  source: "nearbyFragments" | "activeProposals" | "persistentNodes",
): IGAdapterState {
  return {
    ...state,
    view: {
      ...state.view,
      informationGeometryLab: {
        ...state.view.informationGeometryLab,
        voronoiSiteSource: source,
      },
    },
  };
}

function branchFragmentIds(state: IGAdapterState, fragmentId: FragmentId) {
  const visited = new Set<FragmentId>();
  const queue: FragmentId[] = [fragmentId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) {
      continue;
    }

    visited.add(currentId);
    const fragment = state.simulation.fragments[currentId];
    if (!fragment) {
      continue;
    }

    if (fragment.parentFragmentId) {
      queue.push(fragment.parentFragmentId);
    }
    queue.push(...fragment.childFragmentIds);
  }

  return visited;
}

function nearestSiteCluster(anchor: IGSite, sites: IGSite[], limit = 6) {
  return [...sites]
    .sort((left, right) => {
      const leftDistance = Math.hypot(left.point.x - anchor.point.x, left.point.y - anchor.point.y);
      const rightDistance = Math.hypot(right.point.x - anchor.point.x, right.point.y - anchor.point.y);
      return leftDistance - rightDistance;
    })
    .slice(0, Math.max(1, limit));
}

function enrichBarycenterPoint(state: IGAdapterState, site: IGSite, tick: number): BarycenterPoint {
  const proposal =
    (site.proposalId ? state.simulation.proposals[site.proposalId] : undefined) ??
    latestProposalForFragmentAtTick(state, site.fragmentId, tick);

  return {
    id: site.id,
    fragmentId: site.fragmentId,
    proposalId: site.proposalId,
    tick: site.tick,
    sourceKind: site.sourceKind,
    theta: [...site.theta],
    eta: [...site.eta],
    corpusRelevance: proposalCorpusRelevance(proposal),
    constructivePromise: site.promiseConstructive,
    obstructivePromise: site.promiseObstructive,
    divergence: site.divergence,
  };
}

function weightForPoint(point: BarycenterPoint, strategy: BarycenterWeightStrategy) {
  switch (strategy) {
    case "corpusWeighted":
    case "corpusRelevance":
      return clampPositive(point.corpusRelevance);
    case "constructivePromise":
      return clampPositive(point.constructivePromise);
    case "obstructivePromise":
      return clampPositive(point.obstructivePromise);
    case "promiseWeighted":
      return clampPositive(0.7 * point.constructivePromise + 0.3 * (1 - point.obstructivePromise));
    case "divergenceWeighted":
    case "divergence":
      return clampPositive(point.divergence);
    case "uniform":
    default:
      return 1;
  }
}

function normalizeWeights(weights: number[]) {
  if (weights.length === 0) {
    return [];
  }

  const positive = weights.map((value) => clampPositive(value));
  const total = positive.reduce((sum, value) => sum + value, 0);
  if (Math.abs(total) <= Number.EPSILON) {
    return Array.from({ length: weights.length }, () => roundMetric(1 / weights.length));
  }

  return positive.map((value) => roundMetric(value / total));
}

export function computeWeightedBarycenter(points: StatisticalPoint[], weights?: number[]) {
  if (points.length === 0) {
    return {
      point: { theta: [], eta: [] },
      iterations: 0,
      method: "empty-barycenter",
    };
  }

  const normalizedWeights = normalizeWeights(
    weights && weights.length === points.length ? weights : Array.from({ length: points.length }, () => 1),
  );

  const dimension = Math.max(...points.map((point) => point.theta.length));
  const theta = Array.from({ length: dimension }, (_, index) =>
    roundMetric(
      points.reduce((sum, point, pointIndex) => sum + (point.theta[index] ?? 0) * normalizedWeights[pointIndex], 0),
    ),
  );
  const eta = Array.from({ length: dimension }, (_, index) =>
    roundMetric(
      points.reduce((sum, point, pointIndex) => sum + (point.eta[index] ?? 0) * normalizedWeights[pointIndex], 0),
    ),
  );

  return {
    point: { theta, eta },
    iterations: 1,
    method: "weighted-euclidean-mean",
  };
}

export function computeBarycenter(
  points: StatisticalPoint[],
  mode: InformationGeometryMode,
  weights?: number[],
): BarycenterComputationResult {
  const normalizedWeights =
    weights && weights.length === points.length
      ? normalizeWeights(weights)
      : normalizeWeights(Array.from({ length: points.length }, () => 1));
  const definition = getGeometryModeDefinition(mode);
  const result = definition.hooks.computeBarycenter({
    points,
    weights: normalizedWeights,
  });

  return {
    geometryMode: mode,
    point: result.point,
    points: points.map((point, index) => ({
      id: `barycenter_point_${index}`,
      theta: [...point.theta],
      eta: [...point.eta],
      corpusRelevance: 0,
      constructivePromise: 0,
      obstructivePromise: 0,
      divergence: 0,
    })),
    weights: normalizedWeights,
    method: result.method,
    iterations: result.iterations,
  };
}

export function getBarycenterInputsFromState(state: IGAdapterState): BarycenterInputSet {
  const tick = resolveTick(state);
  const geometryMode = state.view.informationGeometryLab.selectedGeometryMode;
  const sourceMode = state.view.informationGeometryLab.barycenterSourceMode;
  const weightMode = state.view.informationGeometryLab.barycenterWeightMode;
  const fragmentId = resolveFragmentId(state);
  const proposalId = resolveProposalId(state);

  if (!fragmentId) {
    return {
      geometryMode,
      sourceMode,
      weightMode,
      tick,
      fragmentId,
      proposalId,
      sites: [],
      points: [],
      weights: [],
    };
  }

  const selectedProposalSite = proposalId
    ? getVoronoiSites(withVoronoiSource(state, "activeProposals"), tick, fragmentId).find(
        (site) => site.proposalId === proposalId,
      )
    : undefined;

  let sites: IGSite[] = [];

  switch (sourceMode) {
    case "activeNeighborhood":
      sites = getNearbyIGSites(state, fragmentId, tick);
      break;
    case "selectedVoronoiCell": {
      const voronoiSites = getVoronoiSites(state, tick, fragmentId);
      sites = selectedProposalSite ? nearestSiteCluster(selectedProposalSite, voronoiSites) : voronoiSites;
      break;
    }
    case "selectedProposalCluster":
      sites = getVoronoiSites(withVoronoiSource(state, "activeProposals"), tick, fragmentId);
      break;
    case "selectedCorpusSupportCluster": {
      const proposalSites = getVoronoiSites(withVoronoiSource(state, "activeProposals"), tick, fragmentId);
      const ranked = proposalSites
        .map((site) => ({
          site,
          relevance: proposalCorpusRelevance(
            site.proposalId ? state.simulation.proposals[site.proposalId] : undefined,
          ),
        }))
        .filter((entry) => entry.relevance > 0)
        .sort((left, right) => right.relevance - left.relevance)
        .slice(0, 6)
        .map((entry) => entry.site);
      sites = ranked.length > 0 ? ranked : proposalSites.slice(0, 6);
      break;
    }
    case "selectedPersistentBranch": {
      const branchIds = branchFragmentIds(state, fragmentId);
      sites = getVoronoiSites(withVoronoiSource(state, "persistentNodes"), tick, fragmentId).filter((site) =>
        branchIds.has(site.fragmentId),
      );
      break;
    }
    default:
      sites = getNearbyIGSites(state, fragmentId, tick);
      break;
  }

  const points = sites.map((site) => enrichBarycenterPoint(state, site, tick));
  const weights = normalizeWeights(points.map((point) => weightForPoint(point, weightMode)));

  return {
    geometryMode,
    sourceMode,
    weightMode,
    tick,
    fragmentId,
    proposalId,
    sites,
    points,
    weights,
  };
}
