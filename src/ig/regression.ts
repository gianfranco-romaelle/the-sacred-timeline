import type { StatisticalPoint } from "@/features/hegel-triangle-transform/information-geometry";
import type { FragmentId, InformationGeometryMode, SemanticProposalId } from "@/types/hegel-triangle";
import { getGeometryModeDefinition } from "./geometryRegistry";

export interface GeometricTrajectorySample {
  id?: string;
  tick?: number;
  t: number;
  fragmentId?: FragmentId;
  proposalId?: SemanticProposalId;
  point: StatisticalPoint;
}

export interface GeometricTrajectoryFittedSample extends GeometricTrajectorySample {
  thetaChart: number[];
  etaChart: number[];
}

export interface GeometricTrajectoryFit {
  geometryMode: InformationGeometryMode;
  method: string;
  score: number;
  aggregateResidual: number;
  fittedSamples: GeometricTrajectoryFittedSample[];
}

export interface GeometricTrajectoryResidual {
  id?: string;
  tick?: number;
  t: number;
  fragmentId?: FragmentId;
  proposalId?: SemanticProposalId;
  actualPoint: StatisticalPoint;
  fittedPoint: StatisticalPoint;
  thetaResidual: number;
  etaResidual: number;
  chartThetaResidual: number;
  chartEtaResidual: number;
  combinedResidual: number;
}

export interface GeometricTrajectoryConvergenceIndicators {
  converging: boolean;
  oscillating: boolean;
  drifting: boolean;
  singularityApproachCandidate: boolean;
  residualMean: number;
  residualTailMean: number;
  velocityMean: number;
  velocityTailMean: number;
  accelerationMean: number;
  oscillationRatio: number;
  netDisplacement: number;
  pathLength: number;
  pathEfficiency: number;
  convergenceRatio: number;
}

function roundMetric(value: number) {
  return Number(value.toFixed(6));
}

function clampUnit(value: number) {
  return Math.max(0, Math.min(1, value));
}

function squaredDistance(left: number[], right: number[]) {
  const dimension = Math.max(left.length, right.length);
  let total = 0;

  for (let index = 0; index < dimension; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    total += delta * delta;
  }

  return total;
}

function euclideanDistance(left: number[], right: number[]) {
  return Math.sqrt(squaredDistance(left, right));
}

function combinedPointDistance(left: StatisticalPoint, right: StatisticalPoint) {
  return Math.sqrt(squaredDistance(left.theta, right.theta) + squaredDistance(left.eta, right.eta));
}

function mean(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function tailWindow<T>(values: T[]) {
  return values.slice(-Math.max(2, Math.ceil(values.length / 3)));
}

function orderedSamples(samples: GeometricTrajectorySample[]) {
  return [...samples].sort((left, right) => left.t - right.t);
}

function chartProjection(
  mode: InformationGeometryMode,
  point: StatisticalPoint,
  chartKind: "theta" | "eta",
) {
  return getGeometryModeDefinition(mode).hooks.computeChartProjection({
    theta: point.theta,
    eta: point.eta,
    chartKind,
  });
}

function vectorDifference(left: number[], right: number[]) {
  const dimension = Math.max(left.length, right.length);
  return Array.from({ length: dimension }, (_, index) => roundMetric((left[index] ?? 0) - (right[index] ?? 0)));
}

function vectorNorm(vector: number[]) {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}

function flattenVelocity(sample: StatisticalPoint) {
  return [...sample.theta, ...sample.eta];
}

export function fitGeometricTrajectory(
  samples: GeometricTrajectorySample[],
  geometryMode: InformationGeometryMode,
): GeometricTrajectoryFit {
  const ordered = orderedSamples(samples);
  const definition = getGeometryModeDefinition(geometryMode);
  const fit = definition.hooks.computeRegressionFit({
    samples: ordered.map((sample) => ({
      t: sample.t,
      point: {
        theta: [...sample.point.theta],
        eta: [...sample.point.eta],
      },
    })),
  });

  const fittedSamples: GeometricTrajectoryFittedSample[] = fit.fitted.map((fittedSample, index) => {
    const source = ordered[index];
    return {
      id: source?.id,
      tick: source?.tick,
      t: fittedSample.t,
      fragmentId: source?.fragmentId,
      proposalId: source?.proposalId,
      point: {
        theta: [...fittedSample.point.theta],
        eta: [...fittedSample.point.eta],
      },
      thetaChart: chartProjection(geometryMode, fittedSample.point, "theta"),
      etaChart: chartProjection(geometryMode, fittedSample.point, "eta"),
    };
  });

  return {
    geometryMode,
    method: fit.method,
    score: roundMetric(fit.score),
    aggregateResidual: roundMetric(fit.residual),
    fittedSamples,
  };
}

export function computeTrajectoryResiduals(
  samples: GeometricTrajectorySample[],
  fit: GeometricTrajectoryFit,
): GeometricTrajectoryResidual[] {
  const ordered = orderedSamples(samples);
  const fittedByT = new Map(fit.fittedSamples.map((sample) => [sample.t, sample]));
  const residuals: GeometricTrajectoryResidual[] = [];

  ordered.forEach((sample) => {
    const fitted = fittedByT.get(sample.t);
    if (!fitted) {
      return;
    }

    const thetaResidual = euclideanDistance(sample.point.theta, fitted.point.theta);
    const etaResidual = euclideanDistance(sample.point.eta, fitted.point.eta);
    const chartThetaResidual = euclideanDistance(
      chartProjection(fit.geometryMode, sample.point, "theta"),
      fitted.thetaChart,
    );
    const chartEtaResidual = euclideanDistance(
      chartProjection(fit.geometryMode, sample.point, "eta"),
      fitted.etaChart,
    );
    const combinedResidual = combinedPointDistance(sample.point, fitted.point);

    residuals.push({
      id: sample.id,
      tick: sample.tick,
      t: sample.t,
      fragmentId: sample.fragmentId,
      proposalId: sample.proposalId,
      actualPoint: {
        theta: [...sample.point.theta],
        eta: [...sample.point.eta],
      },
      fittedPoint: {
        theta: [...fitted.point.theta],
        eta: [...fitted.point.eta],
      },
      thetaResidual: roundMetric(thetaResidual),
      etaResidual: roundMetric(etaResidual),
      chartThetaResidual: roundMetric(chartThetaResidual),
      chartEtaResidual: roundMetric(chartEtaResidual),
      combinedResidual: roundMetric(combinedResidual),
    });
  });

  return residuals;
}

export function computeConvergenceIndicators(
  samples: GeometricTrajectorySample[],
  fit: GeometricTrajectoryFit,
): GeometricTrajectoryConvergenceIndicators {
  const ordered = orderedSamples(samples);
  const residuals = computeTrajectoryResiduals(ordered, fit);

  if (ordered.length <= 1) {
    return {
      converging: false,
      oscillating: false,
      drifting: false,
      singularityApproachCandidate: false,
      residualMean: roundMetric(mean(residuals.map((residual) => residual.combinedResidual))),
      residualTailMean: roundMetric(mean(tailWindow(residuals).map((residual) => residual.combinedResidual))),
      velocityMean: 0,
      velocityTailMean: 0,
      accelerationMean: 0,
      oscillationRatio: 0,
      netDisplacement: 0,
      pathLength: 0,
      pathEfficiency: 0,
      convergenceRatio: 0,
    };
  }

  const actualPoints = ordered.map((sample) => sample.point);
  const velocities = actualPoints.slice(1).map((point, index) =>
    vectorDifference(flattenVelocity(point), flattenVelocity(actualPoints[index])),
  );
  const velocityMagnitudes = velocities.map((velocity) => vectorNorm(velocity));
  const accelerations = velocities.slice(1).map((velocity, index) => vectorDifference(velocity, velocities[index]));
  const accelerationMagnitudes = accelerations.map((acceleration) => vectorNorm(acceleration));

  const directionReversals =
    velocities.length <= 1
      ? 0
      : velocities.slice(1).reduce((count, velocity, index) => {
          const previous = velocities[index];
          const dot = velocity.reduce((sum, value, valueIndex) => sum + value * (previous[valueIndex] ?? 0), 0);
          return dot < 0 ? count + 1 : count;
        }, 0);

  const firstPoint = actualPoints[0];
  const lastPoint = actualPoints[actualPoints.length - 1];
  const pathLength = velocityMagnitudes.reduce((sum, value) => sum + value, 0);
  const netDisplacement = combinedPointDistance(firstPoint, lastPoint);
  const pathEfficiency = pathLength <= Number.EPSILON ? 1 : netDisplacement / pathLength;

  const distancesToTerminal = actualPoints.map((point) => combinedPointDistance(point, lastPoint));
  const firstDistanceMean = mean(distancesToTerminal.slice(0, Math.max(1, Math.floor(distancesToTerminal.length / 3))));
  const tailDistances = tailWindow(distancesToTerminal);
  const tailDistanceMean = mean(tailDistances);
  const convergenceRatio = firstDistanceMean <= Number.EPSILON ? 1 : tailDistanceMean / firstDistanceMean;

  const residualValues = residuals.map((residual) => residual.combinedResidual);
  const residualMean = mean(residualValues);
  const residualTailMean = mean(tailWindow(residualValues));
  const velocityMean = mean(velocityMagnitudes);
  const velocityTailMean = mean(tailWindow(velocityMagnitudes));
  const accelerationMean = mean(accelerationMagnitudes);
  const oscillationRatio = velocities.length <= 1 ? 0 : directionReversals / (velocities.length - 1);

  const converging =
    convergenceRatio < 0.72 &&
    velocityTailMean <= velocityMean * 0.92 &&
    residualTailMean <= Math.max(0.000001, residualMean * 1.08);
  const oscillating = oscillationRatio >= 0.34 || (velocityTailMean > velocityMean * 1.08 && pathEfficiency < 0.72);
  const drifting =
    !converging &&
    pathLength > 0.18 &&
    pathEfficiency >= 0.58 &&
    tailDistanceMean > Math.max(0.000001, firstDistanceMean * 0.82);
  const singularityApproachCandidate =
    (residualTailMean > residualMean * 1.2 && accelerationMean > velocityMean * 0.78) ||
    (oscillating && residualTailMean > residualMean * 1.12) ||
    (drifting && clampUnit(velocityTailMean / Math.max(0.000001, velocityMean)) > 1.18);

  return {
    converging,
    oscillating,
    drifting,
    singularityApproachCandidate,
    residualMean: roundMetric(residualMean),
    residualTailMean: roundMetric(residualTailMean),
    velocityMean: roundMetric(velocityMean),
    velocityTailMean: roundMetric(velocityTailMean),
    accelerationMean: roundMetric(accelerationMean),
    oscillationRatio: roundMetric(oscillationRatio),
    netDisplacement: roundMetric(netDisplacement),
    pathLength: roundMetric(pathLength),
    pathEfficiency: roundMetric(pathEfficiency),
    convergenceRatio: roundMetric(convergenceRatio),
  };
}
