export interface SmearletSample {
  embedding?: number[];
  theta?: number[];
}

export interface SmearletFeatureField {
  gramMatrix: number[][];
  localFrameCoherence: number[][];
  smearletFitness: number;
  rkhsGrowthTendency: number;
}

function roundMetric(value: number) {
  return Number(value.toFixed(6));
}

function clampUnit(value: number) {
  return roundMetric(Math.max(0, Math.min(1, value)));
}

function normalizeVarianceToUnit(value: number) {
  return clampUnit(value / (1 + value));
}

function average(values: number[], fallback = 0) {
  if (values.length === 0) {
    return fallback;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function variance(values: number[]) {
  if (values.length <= 1) {
    return 0;
  }

  const mean = average(values);
  return values.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / values.length;
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

function norm(vector: number[]) {
  return Math.sqrt(dotProduct(vector, vector));
}

function vectorForSample(sample: SmearletSample) {
  return sample.embedding ?? sample.theta ?? [];
}

function diagonal(matrix: number[][]) {
  return matrix.map((row, index) => row[index] ?? 0);
}

function rowSums(matrix: number[][]) {
  return matrix.map((row) => row.reduce((sum, value) => sum + value, 0));
}

export function computeGramMatrix(samples: SmearletSample[]) {
  const vectors = samples.map(vectorForSample);
  if (vectors.length === 0) {
    return [];
  }

  return vectors.map((left) =>
    vectors.map((right) => roundMetric(dotProduct(left, right))),
  );
}

export function computeLocalFrameCoherence(samples: SmearletSample[]) {
  const vectors = samples.map(vectorForSample);
  if (vectors.length === 0) {
    return [];
  }

  return vectors.map((left, rowIndex) => {
    const leftNorm = norm(left);
    return vectors.map((right, columnIndex) => {
      if (rowIndex === columnIndex) {
        return 1;
      }

      const rightNorm = norm(right);
      if (leftNorm <= Number.EPSILON || rightNorm <= Number.EPSILON) {
        return 0;
      }

      return clampUnit(Math.abs(dotProduct(left, right)) / (leftNorm * rightNorm));
    });
  });
}

export function computeSmearletFitness(gramMatrix: number[][], localFrameCoherence: number[][]) {
  if (gramMatrix.length === 0 || localFrameCoherence.length === 0) {
    return 0;
  }

  const diagonalEnergy = diagonal(gramMatrix);
  const rowEnergy = rowSums(gramMatrix);
  const offDiagonalCoherence: number[] = [];

  for (let rowIndex = 0; rowIndex < localFrameCoherence.length; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < localFrameCoherence[rowIndex].length; columnIndex += 1) {
      if (rowIndex !== columnIndex) {
        offDiagonalCoherence.push(localFrameCoherence[rowIndex][columnIndex]);
      }
    }
  }

  const frameTightness = clampUnit(1 - normalizeVarianceToUnit(variance(diagonalEnergy)));
  const energyBalance = clampUnit(1 - normalizeVarianceToUnit(variance(rowEnergy)));
  const lowCrossTalk = clampUnit(1 - average(offDiagonalCoherence));

  return clampUnit(average([frameTightness, energyBalance, lowCrossTalk]));
}

export function computeRkhsGrowthTendency(gramMatrix: number[][]) {
  if (gramMatrix.length === 0) {
    return 0;
  }

  const diagonalEnergy = diagonal(gramMatrix);
  const totalDiagonal = diagonalEnergy.reduce((sum, value) => sum + Math.max(0, value), 0);
  const totalMass = gramMatrix.reduce(
    (sum, row) => sum + row.reduce((rowSum, value) => rowSum + Math.abs(value), 0),
    0,
  );
  const rowEnergyVariance = variance(rowSums(gramMatrix));
  const normalizedDiagonalMass = clampUnit(totalDiagonal / Math.max(1, totalMass));
  const energyDispersion = clampUnit(normalizeVarianceToUnit(rowEnergyVariance));

  return clampUnit(average([normalizedDiagonalMass, energyDispersion]));
}

export function computeSmearletFeatureField(samples: SmearletSample[]): SmearletFeatureField {
  const gramMatrix = computeGramMatrix(samples);
  const localFrameCoherence = computeLocalFrameCoherence(samples);

  return {
    gramMatrix,
    localFrameCoherence,
    smearletFitness: computeSmearletFitness(gramMatrix, localFrameCoherence),
    rkhsGrowthTendency: computeRkhsGrowthTendency(gramMatrix),
  };
}
