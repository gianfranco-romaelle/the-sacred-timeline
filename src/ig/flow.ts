import type { StatisticalPoint } from "@/features/hegel-triangle-transform/information-geometry";
import type { FragmentId, InformationGeometryMode } from "@/types/hegel-triangle";
import { getGeometryModeDefinition } from "./geometryRegistry";
import type { IGSite } from "./types";

export type GeometryFlowMode = "proposalFlow" | "repairFlow" | "obstructionFlow";

export interface GeometryFlowPoint extends StatisticalPoint {
  divergence?: number;
  projection?: number;
  constructivePromise?: number;
  obstructivePromise?: number;
  curvature?: number;
}

export interface GeometryFlowNeighborhood {
  fragmentId?: FragmentId;
  tick?: number;
  sites: IGSite[];
}

export interface GeometryFlowWeight {
  siteId: string;
  fragmentId: FragmentId;
  proposalId?: string;
  weight: number;
}

export interface GeometryFlowDirectionResult {
  geometryMode: InformationGeometryMode;
  flowMode: GeometryFlowMode;
  target: StatisticalPoint;
  thetaDirection: number[];
  etaDirection: number[];
  weights: GeometryFlowWeight[];
  method: string;
}

function roundMetric(value: number) {
  return Number(value.toFixed(6));
}

function clampUnit(value: number) {
  return Math.max(0, Math.min(1, value));
}

function normalizeDivergence(value: number) {
  return clampUnit(value / (1 + value));
}

function positiveWeight(value: number, fallback = 0.02) {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}

function normalizeWeights(weights: number[]) {
  if (weights.length === 0) {
    return [];
  }

  const positive = weights.map((value) => positiveWeight(value));
  const total = positive.reduce((sum, value) => sum + value, 0);
  if (Math.abs(total) <= Number.EPSILON) {
    return Array.from({ length: weights.length }, () => roundMetric(1 / weights.length));
  }

  return positive.map((value) => roundMetric(value / total));
}

function neighborhoodTarget(
  neighborhood: GeometryFlowNeighborhood,
  geometryMode: InformationGeometryMode,
  scoring: (site: IGSite) => number,
) {
  const definition = getGeometryModeDefinition(geometryMode);
  const rawWeights = neighborhood.sites.map(scoring);
  const weights = normalizeWeights(rawWeights);
  const points = neighborhood.sites.map(
    (site) =>
      ({
        theta: [...site.theta],
        eta: [...site.eta],
      }) satisfies StatisticalPoint,
  );
  const barycenter = definition.hooks.computeBarycenter({
    points,
    weights,
  });

  return {
    target: barycenter.point,
    weights: neighborhood.sites.map((site, index) => ({
      siteId: site.id,
      fragmentId: site.fragmentId,
      proposalId: site.proposalId,
      weight: weights[index] ?? 0,
    })),
    method: barycenter.method,
  };
}

function proposalScore(site: IGSite) {
  const divergenceGain = 1 - normalizeDivergence(site.divergence);
  const projectionGain = 1 - clampUnit(site.projection);
  const constructiveGain = clampUnit(site.promiseConstructive);
  const obstructionPenalty = 1 - clampUnit(site.promiseObstructive);
  return positiveWeight(
    divergenceGain * 0.38 +
      projectionGain * 0.26 +
      constructiveGain * 0.26 +
      obstructionPenalty * 0.1,
  );
}

function repairScore(site: IGSite) {
  const divergenceGain = 1 - normalizeDivergence(site.divergence);
  const projectionGain = 1 - clampUnit(site.projection);
  const constructiveGain = clampUnit(site.promiseConstructive);
  const lowCurvature = 1 - clampUnit(site.curvature);
  return positiveWeight(
    projectionGain * 0.42 +
      divergenceGain * 0.28 +
      constructiveGain * 0.2 +
      lowCurvature * 0.1,
  );
}

function obstructionScore(site: IGSite) {
  const divergenceLoad = normalizeDivergence(site.divergence);
  const projectionLoad = clampUnit(site.projection);
  const obstructiveLoad = clampUnit(site.promiseObstructive);
  const curvatureLoad = clampUnit(site.curvature);
  return positiveWeight(
    obstructiveLoad * 0.38 +
      curvatureLoad * 0.24 +
      projectionLoad * 0.2 +
      divergenceLoad * 0.18,
  );
}

function fallbackDirection(
  point: GeometryFlowPoint,
  geometryMode: InformationGeometryMode,
  flowMode: GeometryFlowMode,
): GeometryFlowDirectionResult {
  const dimension = Math.max(point.theta.length, point.eta.length);
  const zeros = Array.from({ length: dimension }, () => 0);
  return {
    geometryMode,
    flowMode,
    target: {
      theta: [...point.theta],
      eta: [...point.eta],
    },
    thetaDirection: zeros,
    etaDirection: zeros,
    weights: [],
    method: `${flowMode}-empty-neighborhood`,
  };
}

function computeModeFlowDirection(
  point: GeometryFlowPoint,
  neighborhood: GeometryFlowNeighborhood,
  mode: InformationGeometryMode,
  flowMode: GeometryFlowMode,
  scoring: (site: IGSite) => number,
): GeometryFlowDirectionResult {
  if (neighborhood.sites.length === 0) {
    return fallbackDirection(point, mode, flowMode);
  }

  const definition = getGeometryModeDefinition(mode);
  const targetResult = neighborhoodTarget(neighborhood, mode, scoring);
  const flow = definition.hooks.computeFlowDirection({
    point: {
      theta: [...point.theta],
      eta: [...point.eta],
    },
    target: targetResult.target,
    stepSize: 1,
  });

  return {
    geometryMode: mode,
    flowMode,
    target: targetResult.target,
    thetaDirection: flow.thetaDirection.map((value) => roundMetric(value)),
    etaDirection: flow.etaDirection.map((value) => roundMetric(value)),
    weights: targetResult.weights,
    method: `${targetResult.method} -> ${flow.method}`,
  };
}

export function computeFlowDirection(
  point: GeometryFlowPoint,
  neighborhood: GeometryFlowNeighborhood,
  mode: InformationGeometryMode,
) {
  return computeModeFlowDirection(point, neighborhood, mode, "proposalFlow", proposalScore);
}

export function computeRepairFlowDirection(
  point: GeometryFlowPoint,
  neighborhood: GeometryFlowNeighborhood,
  mode: InformationGeometryMode,
) {
  return computeModeFlowDirection(point, neighborhood, mode, "repairFlow", repairScore);
}

export function computeObstructionFlowDirection(
  point: GeometryFlowPoint,
  neighborhood: GeometryFlowNeighborhood,
  mode: InformationGeometryMode,
) {
  return computeModeFlowDirection(point, neighborhood, mode, "obstructionFlow", obstructionScore);
}
