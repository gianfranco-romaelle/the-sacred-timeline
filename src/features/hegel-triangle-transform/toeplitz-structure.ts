import type { FragmentId, SimulationState, TriangleFragment } from "@/types/hegel-triangle";

export interface ToeplitzSample {
  embedding?: number[];
  theta?: number[];
}

export interface ToeplitzStructureField {
  correlationMatrix: number[][];
  toeplitzCoherence: number;
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

function variance(values: number[]) {
  if (values.length <= 1) {
    return 0;
  }
  const mean = average(values);
  return values.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / values.length;
}

function normalizeVarianceToUnit(value: number) {
  return clampUnit(value / (1 + value));
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

function cosineSimilarity(left: number[], right: number[]) {
  const leftNorm = norm(left);
  const rightNorm = norm(right);
  if (leftNorm <= Number.EPSILON || rightNorm <= Number.EPSILON) {
    return 0;
  }
  return dotProduct(left, right) / (leftNorm * rightNorm);
}

function normalizeCosineToUnit(value: number) {
  return clampUnit((Math.max(-1, Math.min(1, value)) + 1) / 2);
}

function vectorForSample(sample: ToeplitzSample) {
  return sample.embedding ?? sample.theta ?? [];
}

export function computeCorrelationMatrix(samples: ToeplitzSample[]) {
  const vectors = samples.map(vectorForSample);
  if (vectors.length === 0) {
    return [];
  }

  return vectors.map((left, rowIndex) =>
    vectors.map((right, columnIndex) => {
      if (rowIndex === columnIndex) {
        return 1;
      }
      return normalizeCosineToUnit(cosineSimilarity(left, right));
    }),
  );
}

export function computeToeplitzCoherence(correlationMatrix: number[][]) {
  if (correlationMatrix.length <= 1) {
    return 1;
  }

  const diagonalScores: number[] = [];
  for (let offset = 0; offset < correlationMatrix.length; offset += 1) {
    const diagonal: number[] = [];
    for (let rowIndex = 0; rowIndex + offset < correlationMatrix.length; rowIndex += 1) {
      diagonal.push(correlationMatrix[rowIndex][rowIndex + offset]);
    }

    const diagonalVariance = variance(diagonal);
    const diagonalCoherence = 1 - normalizeVarianceToUnit(diagonalVariance);
    diagonalScores.push(clampUnit(diagonalCoherence));
  }

  const symmetryResiduals: number[] = [];
  for (let rowIndex = 0; rowIndex < correlationMatrix.length; rowIndex += 1) {
    for (let columnIndex = rowIndex + 1; columnIndex < correlationMatrix.length; columnIndex += 1) {
      symmetryResiduals.push(Math.abs(correlationMatrix[rowIndex][columnIndex] - correlationMatrix[columnIndex][rowIndex]));
    }
  }

  const symmetryScore = clampUnit(1 - average(symmetryResiduals));
  return clampUnit(average([...diagonalScores, symmetryScore], 1));
}

export function computeToeplitzStructureField(samples: ToeplitzSample[]): ToeplitzStructureField {
  const correlationMatrix = computeCorrelationMatrix(samples);
  return {
    correlationMatrix,
    toeplitzCoherence: computeToeplitzCoherence(correlationMatrix),
  };
}

export function computeFragmentSequenceToeplitzStructure(
  simulation: SimulationState,
  fragmentIds: FragmentId[],
): ToeplitzStructureField {
  const fragments = fragmentIds
    .map((fragmentId) => simulation.fragments[fragmentId])
    .filter((fragment): fragment is TriangleFragment => Boolean(fragment));

  return computeToeplitzStructureField(
    fragments.map((fragment) => ({
      embedding: fragment.embedding,
      theta: fragment.theta,
    })),
  );
}
