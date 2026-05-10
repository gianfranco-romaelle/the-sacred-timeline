import type { FragmentPhase, StatisticalEmbeddingState } from "@/types/hegel-triangle";

const DEFAULT_EMBEDDING_DIMENSION = 8;
const EPSILON = 1e-3;
const INVERSE_ITERATIONS = 6;

export type StatisticalPoint = {
  theta: number[];
  eta: number[];
};

export type ConvexPotential = {
  psi: (theta: number[]) => number;
  gradPsi: (theta: number[]) => number[];
  hessianPsi: (theta: number[]) => number[][];
};

export type LegendreDualPotential = {
  phi: (eta: number[]) => number;
  gradPhi: (eta: number[]) => number[];
  hessianPhi: (eta: number[]) => number[][];
};

export type AffineConnectionKind = "primal" | "dual";

export type CandidateAdjunctorPair = {
  F: StatisticalPoint;
  G: StatisticalPoint;
};

export type NegAdjunctionField = {
  forward: number;
  reverse: number;
  asymmetry: number;
  curvature: number;
  projection: number;
  projectionDivergence: number;
  total: number;
};

export type FisherMetricTensor = number[][];

export type CurvatureProxySample = StatisticalPoint & {
  embedding?: number[];
};

export type CurvatureProxyField = {
  divergenceMismatch: number;
  embeddingVariance: number;
  total: number;
  sampleSize: number;
};

export type BregmanPythagoreanField = {
  left: number;
  right: number;
  residual: number;
  holds: boolean;
};

export type CatastropheField = {
  eigenvalues: number[];
  determinant: number;
  smallestEigenvalue: number;
  isCatastropheRegion: boolean;
  epsilon: number;
};

export type CrystallizationState = "crystallized" | "externalized" | "metastable";

export type CrystallizationField = {
  state: CrystallizationState;
  projectionDivergenceDecreasing: boolean;
  pythagoreanHolds: boolean;
  lowCurvature: boolean;
  catastrophe: boolean;
  score: number;
};

export type CatastropheApproximationField = {
  active: boolean;
  score: number;
  curvatureHigh: boolean;
  projectionHigh: boolean;
  asymmetryUnstable: boolean;
};

export type PhaseComputationInput = {
  field: NegAdjunctionField;
  previousProjection?: number;
  smallThreshold?: number;
  asymmetryThreshold?: number;
  curvatureThreshold?: number;
  projectionStableTolerance?: number;
  projectionHighThreshold?: number;
};

function clampPenalty(value: number) {
  return roundCoordinate(Math.min(0.95, Math.max(0, value)));
}

function clampUnit(value: number) {
  return roundCoordinate(Math.max(0, Math.min(1, value)));
}

function normalizeVarianceToUnit(variance: number) {
  return clampUnit(variance / (1 + variance));
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function roundCoordinate(value: number) {
  return Number(value.toFixed(6));
}

function stableUnitValue(key: string, index: number) {
  const hash = hashString(`${key}:${index}`);
  return (hash % 10000) / 5000 - 1;
}

function ensureDimension(values: number[], dimension: number, seedKey: string) {
  return Array.from({ length: dimension }, (_, index) =>
    roundCoordinate(values[index] ?? stableUnitValue(`${seedKey}:pad`, index)),
  );
}

function stableVector(key: string, dimension = DEFAULT_EMBEDDING_DIMENSION) {
  return Array.from({ length: dimension }, (_, index) => {
    const center = stableUnitValue(key, index) * 0.72;
    const previous = index > 0 ? stableUnitValue(key, index - 1) * 0.1 : 0;
    const next = index < dimension - 1 ? stableUnitValue(key, index + 1) * 0.1 : 0;
    return roundCoordinate(center + previous - next);
  });
}

function assertMatchingDimension(left: number[], right: number[], label: string) {
  if (left.length !== right.length) {
    throw new Error(`${label} dimension mismatch: ${left.length} !== ${right.length}`);
  }
}

function dotProduct(left: number[], right: number[]) {
  assertMatchingDimension(left, right, "Dot product");
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function meanVector(vectors: number[][]) {
  if (vectors.length === 0) {
    return [];
  }

  const dimension = vectors[0].length;
  return Array.from({ length: dimension }, (_, index) =>
    roundCoordinate(vectors.reduce((sum, vector) => sum + vector[index], 0) / vectors.length),
  );
}

function squaredDistance(left: number[], right: number[]) {
  assertMatchingDimension(left, right, "Squared distance");
  return left.reduce((sum, value, index) => {
    const delta = value - right[index];
    return sum + delta * delta;
  }, 0);
}

function lerpScalar(left: number, right: number, t: number) {
  return left + (right - left) * t;
}

function interpolateCoordinates(left: number[], right: number[], t: number) {
  assertMatchingDimension(left, right, "Geodesic interpolation");
  return left.map((value, index) => roundCoordinate(lerpScalar(value, right[index], t)));
}

function normalizeWeights(weights: number[]) {
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (Math.abs(total) <= Number.EPSILON) {
    throw new Error("Interpolation weights must have non-zero total.");
  }
  return weights.map((value) => value / total);
}

function weightedCoordinates(vectors: number[][], weights: number[]) {
  if (vectors.length === 0) {
    return [];
  }

  if (vectors.length !== weights.length) {
    throw new Error(`Interpolation weight mismatch: ${vectors.length} vectors for ${weights.length} weights.`);
  }

  const normalizedWeights = normalizeWeights(weights);
  const dimension = vectors[0].length;
  for (const vector of vectors) {
    assertMatchingDimension(vector, vectors[0], "Simplex interpolation");
  }

  return Array.from({ length: dimension }, (_, index) =>
    roundCoordinate(
      vectors.reduce((sum, vector, vectorIndex) => sum + vector[index] * normalizedWeights[vectorIndex], 0),
    ),
  );
}

function identityHessian(dimension: number) {
  return Array.from({ length: dimension }, (_, rowIndex) =>
    Array.from({ length: dimension }, (_, columnIndex) =>
      roundCoordinate(rowIndex === columnIndex ? 1 : 0),
    ),
  );
}

function defaultPsi(theta: number[]) {
  return roundCoordinate(theta.reduce((sum, value) => sum + 0.5 * value * value, 0));
}

function finiteDifferenceGradient(theta: number[], psi: ConvexPotential["psi"]) {
  if (theta.length === 0) {
    return [];
  }

  return theta.map((_, index) => {
    const plus = [...theta];
    const minus = [...theta];
    plus[index] += EPSILON;
    minus[index] -= EPSILON;
    return roundCoordinate((psi(plus) - psi(minus)) / (2 * EPSILON));
  });
}

function finiteDifferenceHessian(theta: number[], gradPsi: ConvexPotential["gradPsi"]) {
  if (theta.length === 0) {
    return [];
  }

  return theta.map((_, rowIndex) => {
    const plus = [...theta];
    const minus = [...theta];
    plus[rowIndex] += EPSILON;
    minus[rowIndex] -= EPSILON;
    const gradPlus = gradPsi(plus);
    const gradMinus = gradPsi(minus);
    return gradPlus.map((value, columnIndex) =>
      roundCoordinate((value - gradMinus[columnIndex]) / (2 * EPSILON)),
    );
  });
}

function cloneMatrix(matrix: number[][]) {
  return matrix.map((row) => [...row]);
}

function identityMatrix(size: number) {
  return Array.from({ length: size }, (_, rowIndex) =>
    Array.from({ length: size }, (_, columnIndex): number => (rowIndex === columnIndex ? 1 : 0)),
  );
}

function offDiagonalNorm(matrix: number[][]) {
  let sum = 0;
  for (let rowIndex = 0; rowIndex < matrix.length; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < matrix[rowIndex].length; columnIndex += 1) {
      if (rowIndex !== columnIndex) {
        sum += matrix[rowIndex][columnIndex] * matrix[rowIndex][columnIndex];
      }
    }
  }
  return Math.sqrt(sum);
}

function jacobiEigenvalues(matrix: number[][], maxIterations = 32) {
  if (matrix.length === 0) {
    return [];
  }

  const size = matrix.length;
  const working = cloneMatrix(matrix);
  let eigenvectors = identityMatrix(size);

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    let pivotRow = 0;
    let pivotColumn = 1;
    let pivotMagnitude = Math.abs(working[pivotRow][pivotColumn] ?? 0);

    for (let rowIndex = 0; rowIndex < size; rowIndex += 1) {
      for (let columnIndex = rowIndex + 1; columnIndex < size; columnIndex += 1) {
        const magnitude = Math.abs(working[rowIndex][columnIndex]);
        if (magnitude > pivotMagnitude) {
          pivotMagnitude = magnitude;
          pivotRow = rowIndex;
          pivotColumn = columnIndex;
        }
      }
    }

    if (pivotMagnitude <= EPSILON || offDiagonalNorm(working) <= EPSILON) {
      break;
    }

    const app = working[pivotRow][pivotRow];
    const aqq = working[pivotColumn][pivotColumn];
    const apq = working[pivotRow][pivotColumn];
    const phi = 0.5 * Math.atan2(2 * apq, aqq - app);
    const cosine = Math.cos(phi);
    const sine = Math.sin(phi);

    for (let index = 0; index < size; index += 1) {
      if (index !== pivotRow && index !== pivotColumn) {
        const aip = working[index][pivotRow];
        const aiq = working[index][pivotColumn];
        working[index][pivotRow] = roundCoordinate(cosine * aip - sine * aiq);
        working[pivotRow][index] = working[index][pivotRow];
        working[index][pivotColumn] = roundCoordinate(sine * aip + cosine * aiq);
        working[pivotColumn][index] = working[index][pivotColumn];
      }
    }

    working[pivotRow][pivotRow] = roundCoordinate(
      cosine * cosine * app - 2 * sine * cosine * apq + sine * sine * aqq,
    );
    working[pivotColumn][pivotColumn] = roundCoordinate(
      sine * sine * app + 2 * sine * cosine * apq + cosine * cosine * aqq,
    );
    working[pivotRow][pivotColumn] = 0;
    working[pivotColumn][pivotRow] = 0;

    for (let index = 0; index < size; index += 1) {
      const vip = eigenvectors[index][pivotRow];
      const viq = eigenvectors[index][pivotColumn];
      eigenvectors[index][pivotRow] = roundCoordinate(cosine * vip - sine * viq);
      eigenvectors[index][pivotColumn] = roundCoordinate(sine * vip + cosine * viq);
    }
  }

  return working
    .map((row, index) => roundCoordinate(row[index]))
    .sort((left, right) => left - right);
}

export const defaultConvexPotential: ConvexPotential = {
  psi: defaultPsi,
  gradPsi(theta) {
    return theta.map((value) => roundCoordinate(value));
  },
  hessianPsi(theta) {
    return identityHessian(theta.length);
  },
};

function approximateThetaFromEta(eta: number[], psi: ConvexPotential) {
  if (eta.length === 0) {
    return [];
  }

  let theta = [...eta];
  for (let iteration = 0; iteration < INVERSE_ITERATIONS; iteration += 1) {
    const estimatedEta = computeEta(theta, psi);
    theta = theta.map((value, index) => roundCoordinate(value + (eta[index] - estimatedEta[index]) * 0.65));
  }
  return theta;
}

export function createLegendreDualPotential(psi: ConvexPotential): LegendreDualPotential {
  const phi: LegendreDualPotential["phi"] = (eta) => {
    const theta = approximateThetaFromEta(eta, psi);
    return roundCoordinate(dotProduct(theta, eta) - psi.psi(theta));
  };

  const gradPhi: LegendreDualPotential["gradPhi"] = (eta) => approximateThetaFromEta(eta, psi);

  const hessianPhi: LegendreDualPotential["hessianPhi"] = (eta) => {
    if (eta.length === 0) {
      return [];
    }

    return eta.map((_, rowIndex) => {
      const plus = [...eta];
      const minus = [...eta];
      plus[rowIndex] += EPSILON;
      minus[rowIndex] -= EPSILON;
      const gradPlus = gradPhi(plus);
      const gradMinus = gradPhi(minus);
      return gradPlus.map((value, columnIndex) =>
        roundCoordinate((value - gradMinus[columnIndex]) / (2 * EPSILON)),
      );
    });
  };

  return {
    phi,
    gradPhi,
    hessianPhi,
  };
}

export const defaultDualPotential = createLegendreDualPotential(defaultConvexPotential);

export function computeEta(theta: number[], psi: ConvexPotential = defaultConvexPotential) {
  return psi.gradPsi(theta);
}

export function computeTheta(eta: number[], psi: ConvexPotential = defaultConvexPotential) {
  return approximateThetaFromEta(eta, psi);
}

export function computeBregman(
  p: StatisticalPoint,
  q: StatisticalPoint,
  psi: ConvexPotential = defaultConvexPotential,
) {
  return computeBregmanDivergence(p, q, psi);
}

export function computeThetaFromEta(
  eta: number[],
  phi: LegendreDualPotential = defaultDualPotential,
) {
  return phi.gradPhi(eta);
}

export function computeFisherMetric(
  theta: number[],
  psi: ConvexPotential = defaultConvexPotential,
): FisherMetricTensor {
  return psi.hessianPsi(theta).map((row) => row.map((value) => roundCoordinate(value)));
}

export function computeEigenvalues(hessian: number[][]) {
  if (hessian.length === 0) {
    return [];
  }

  const size = hessian.length;
  for (const row of hessian) {
    if (row.length !== size) {
      throw new Error("Eigenvalue computation requires a square Hessian matrix.");
    }
  }

  return jacobiEigenvalues(hessian);
}

export function computeCatastropheField(
  theta: number[],
  psi: ConvexPotential = defaultConvexPotential,
  epsilon = 1e-3,
): CatastropheField {
  const hessian = computeFisherMetric(theta, psi);
  const eigenvalues = computeEigenvalues(hessian);
  const determinant = roundCoordinate(
    eigenvalues.length > 0 ? eigenvalues.reduce((product, eigenvalue) => product * eigenvalue, 1) : 0,
  );
  const smallestEigenvalue = eigenvalues[0] ?? 0;

  return {
    eigenvalues,
    determinant,
    smallestEigenvalue,
    isCatastropheRegion: Math.abs(determinant) <= epsilon || smallestEigenvalue < epsilon,
    epsilon: roundCoordinate(epsilon),
  };
}

export function computePrimalGeodesicPoint(
  start: StatisticalPoint,
  end: StatisticalPoint,
  t: number,
  psi: ConvexPotential = defaultConvexPotential,
): StatisticalPoint {
  const theta = interpolateCoordinates(start.theta, end.theta, t);
  return {
    theta,
    eta: computeEta(theta, psi),
  };
}

export function computeDualGeodesicPoint(
  start: StatisticalPoint,
  end: StatisticalPoint,
  t: number,
  phi: LegendreDualPotential = defaultDualPotential,
): StatisticalPoint {
  const eta = interpolateCoordinates(start.eta, end.eta, t);
  return {
    theta: computeThetaFromEta(eta, phi),
    eta,
  };
}

export function computeGeodesicPoint(
  connection: AffineConnectionKind,
  start: StatisticalPoint,
  end: StatisticalPoint,
  t: number,
  options?: {
    psi?: ConvexPotential;
    phi?: LegendreDualPotential;
  },
): StatisticalPoint {
  return connection === "primal"
    ? computePrimalGeodesicPoint(start, end, t, options?.psi)
    : computeDualGeodesicPoint(start, end, t, options?.phi);
}

export function interpolatePrimalSimplexPoint(
  vertices: StatisticalPoint[],
  weights: number[],
  psi: ConvexPotential = defaultConvexPotential,
): StatisticalPoint {
  const theta = weightedCoordinates(
    vertices.map((vertex) => vertex.theta),
    weights,
  );

  return {
    theta,
    eta: computeEta(theta, psi),
  };
}

export function interpolateDualSimplexPoint(
  vertices: StatisticalPoint[],
  weights: number[],
  phi: LegendreDualPotential = defaultDualPotential,
): StatisticalPoint {
  const eta = weightedCoordinates(
    vertices.map((vertex) => vertex.eta),
    weights,
  );

  return {
    theta: computeThetaFromEta(eta, phi),
    eta,
  };
}

export function computeCurvatureProxy(
  samples: CurvatureProxySample[],
  psi: ConvexPotential = defaultConvexPotential,
): CurvatureProxyField {
  if (samples.length <= 1) {
    return {
      divergenceMismatch: 0,
      embeddingVariance: 0,
      total: 0,
      sampleSize: samples.length,
    };
  }

  const coordinateSamples = samples.map((sample) => sample.embedding ?? sample.theta);
  const centroid = meanVector(coordinateSamples);
  const rawEmbeddingVariance =
    coordinateSamples.reduce((sum, vector) => sum + squaredDistance(vector, centroid), 0) /
    coordinateSamples.length;
  const embeddingVariance = normalizeVarianceToUnit(rawEmbeddingVariance);

  let mismatchSum = 0;
  let pairCount = 0;
  for (let leftIndex = 0; leftIndex < samples.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < samples.length; rightIndex += 1) {
      const forward = computeBregmanDivergence(samples[leftIndex], samples[rightIndex], psi);
      const reverse = computeBregmanDivergence(samples[rightIndex], samples[leftIndex], psi);
      mismatchSum += Math.abs(forward - reverse);
      pairCount += 1;
    }
  }

  const divergenceMismatch = roundCoordinate(pairCount > 0 ? mismatchSum / pairCount : 0);
  const total = roundCoordinate((embeddingVariance + divergenceMismatch) / 2);

  return {
    divergenceMismatch,
    embeddingVariance,
    total,
    sampleSize: samples.length,
  };
}

export function computeEmbeddingCurvature(samples: Array<{ embedding?: number[]; theta: number[] }>) {
  if (samples.length <= 1) {
    return 0;
  }

  const coordinateSamples = samples.map((sample) => sample.embedding ?? sample.theta);
  const centroid = meanVector(coordinateSamples);
  const variance =
    coordinateSamples.reduce((sum, vector) => sum + squaredDistance(vector, centroid), 0) /
    coordinateSamples.length;
  return normalizeVarianceToUnit(variance);
}

export function computeBregmanDivergence(
  p: StatisticalPoint,
  q: StatisticalPoint,
  psi: ConvexPotential = defaultConvexPotential,
) {
  assertMatchingDimension(p.theta, q.theta, "Bregman divergence");
  const delta = p.theta.map((value, index) => value - q.theta[index]);
  const gradAtQ = psi.gradPsi(q.theta);
  const divergence = psi.psi(p.theta) - psi.psi(q.theta) - dotProduct(gradAtQ, delta);
  return roundCoordinate(Math.max(0, divergence));
}

export function computeNegAdjunctionField(
  pair: CandidateAdjunctorPair,
  psi: ConvexPotential = defaultConvexPotential,
  projectionDivergence = 0,
  curvature = 0,
): NegAdjunctionField {
  const forward = computeBregman(pair.F, pair.G, psi);
  const reverse = computeBregman(pair.G, pair.F, psi);
  const asymmetry = roundCoordinate(Math.abs(forward - reverse));
  const normalizedCurvature = roundCoordinate(Math.max(0, curvature));
  const normalizedProjection = roundCoordinate(Math.max(0, projectionDivergence));
  const total = roundCoordinate(forward + reverse + normalizedProjection);

  return {
    forward,
    reverse,
    asymmetry,
    curvature: normalizedCurvature,
    projection: normalizedProjection,
    projectionDivergence: normalizedProjection,
    total,
  };
}

export function computeProductiveScore(
  field: NegAdjunctionField,
  vacuityPenalty = 0,
  instabilityPenalty = 0,
) {
  const normalizedVacuityPenalty = clampPenalty(vacuityPenalty);
  const normalizedInstabilityPenalty = clampPenalty(instabilityPenalty);
  return roundCoordinate(
    Math.max(
      0,
      field.total * (1 - normalizedVacuityPenalty) * (1 - normalizedInstabilityPenalty),
    ),
  );
}

export function computePhase(input: PhaseComputationInput): FragmentPhase {
  const smallThreshold = input.smallThreshold ?? 0.18;
  const asymmetryThreshold = input.asymmetryThreshold ?? 0.08;
  const curvatureThreshold = input.curvatureThreshold ?? 0.08;
  const projectionStableTolerance = input.projectionStableTolerance ?? 0.03;
  const projectionHighThreshold = input.projectionHighThreshold ?? 0.4;
  const previousProjection = input.previousProjection;
  const projectionDecreasing =
    typeof previousProjection === "number"
      ? input.field.projection < previousProjection - projectionStableTolerance
      : false;
  const projectionStable =
    typeof previousProjection === "number"
      ? Math.abs(input.field.projection - previousProjection) <= projectionStableTolerance
      : false;

  if (input.field.total < smallThreshold) {
    return "latent";
  }

  if (input.field.asymmetry >= asymmetryThreshold || input.field.curvature >= curvatureThreshold) {
    return "nucleating";
  }

  if (projectionDecreasing) {
    return "crystallizing";
  }

  if (projectionStable && input.field.projection >= projectionHighThreshold) {
    return "externalized";
  }

  return "stabilized";
}

export function computeCatastropheApproximation(
  field: NegAdjunctionField,
  thresholds?: {
    curvature?: number;
    projection?: number;
    asymmetry?: number;
  },
): CatastropheApproximationField {
  const curvatureThreshold = thresholds?.curvature ?? 0.12;
  const projectionThreshold = thresholds?.projection ?? 0.42;
  const asymmetryThreshold = thresholds?.asymmetry ?? 0.08;
  const curvatureHigh = field.curvature >= curvatureThreshold;
  const projectionHigh = field.projection >= projectionThreshold;
  const asymmetryUnstable = field.asymmetry >= asymmetryThreshold;
  const score = clampUnit(
    (field.curvature / curvatureThreshold) * 0.36 +
      (field.projection / projectionThreshold) * 0.36 +
      (field.asymmetry / asymmetryThreshold) * 0.28,
  );

  return {
    active: curvatureHigh && projectionHigh && asymmetryUnstable,
    score,
    curvatureHigh,
    projectionHigh,
    asymmetryUnstable,
  };
}

export function computeBregmanPythagoreanField(
  P: StatisticalPoint,
  Q: StatisticalPoint,
  R: StatisticalPoint,
  psi: ConvexPotential = defaultConvexPotential,
  tolerance = 1e-3,
): BregmanPythagoreanField {
  const left = computeBregmanDivergence(P, R, psi);
  const projectionDefect = computeBregmanDivergence(P, Q, psi);
  const projectedTail = computeBregmanDivergence(Q, R, psi);
  const right = roundCoordinate(projectionDefect + projectedTail);
  const residual = roundCoordinate(Math.abs(left - right));

  return {
    left,
    right,
    residual,
    holds: residual <= tolerance,
  };
}

export function isProperBregmanProjection(
  P: StatisticalPoint,
  Q: StatisticalPoint,
  references: StatisticalPoint[],
  psi: ConvexPotential = defaultConvexPotential,
  tolerance = 1e-3,
) {
  if (references.length === 0) {
    return true;
  }

  return references.every((R) => computeBregmanPythagoreanField(P, Q, R, psi, tolerance).holds);
}

export function computeCrystallizationField(input: {
  previousProjectionDivergence?: number;
  currentProjectionDivergence: number;
  pythagorean: BregmanPythagoreanField;
  curvature: CurvatureProxyField;
  catastrophe: CatastropheField;
  curvatureThreshold?: number;
}): CrystallizationField {
  const curvatureThreshold = input.curvatureThreshold ?? 0.12;
  const projectionDivergenceDecreasing =
    input.previousProjectionDivergence != null
      ? input.currentProjectionDivergence < input.previousProjectionDivergence
      : input.currentProjectionDivergence <= 1e-3;
  const lowCurvature = input.curvature.total <= curvatureThreshold;
  const catastrophe = input.catastrophe.isCatastropheRegion;
  const crystallized =
    projectionDivergenceDecreasing && input.pythagorean.holds && lowCurvature && !catastrophe;

  const score = roundCoordinate(
    (projectionDivergenceDecreasing ? 0.34 : 0) +
      (input.pythagorean.holds ? 0.33 : 0) +
      (lowCurvature ? 0.33 : 0),
  );

  return {
    state: catastrophe ? "externalized" : crystallized ? "crystallized" : "metastable",
    projectionDivergenceDecreasing,
    pythagoreanHolds: input.pythagorean.holds,
    lowCurvature,
    catastrophe,
    score,
  };
}

export function resolveStatisticalEmbeddingState(input: {
  key: string;
  dimension?: number;
  existing?: Partial<StatisticalEmbeddingState>;
}): StatisticalEmbeddingState {
  const dimension = Math.max(1, input.dimension ?? DEFAULT_EMBEDDING_DIMENSION);
  const existingEmbedding =
    input.existing?.embedding && input.existing.embedding.length > 0
      ? ensureDimension(input.existing.embedding, dimension, `${input.key}:embedding`)
      : undefined;
  const existingTheta =
    input.existing?.theta && input.existing.theta.length > 0
      ? ensureDimension(input.existing.theta, dimension, `${input.key}:theta`)
      : undefined;
  const existingEta =
    input.existing?.eta && input.existing.eta.length > 0
      ? ensureDimension(input.existing.eta, dimension, `${input.key}:eta`)
      : undefined;

  const theta =
    existingTheta ?? existingEmbedding ?? computeThetaFromEta(existingEta ?? stableVector(input.key, dimension));
  const eta = existingEta ?? computeEta(theta);
  const embedding = existingEmbedding ?? theta;

  return {
    embedding: ensureDimension(embedding, dimension, `${input.key}:resolved-embedding`),
    theta: ensureDimension(theta, dimension, `${input.key}:resolved-theta`),
    eta: ensureDimension(eta, dimension, `${input.key}:resolved-eta`),
  };
}
