export interface KernelSample {
  embedding?: number[];
  theta?: number[];
}

export interface SpectralKernelField {
  kernelMatrix: number[][];
  similarityMatrix: number[][];
  kernelConsistency: number;
  spectralStability: number;
}

function roundMetric(value: number) {
  return Number(value.toFixed(6));
}

function clampUnit(value: number) {
  return roundMetric(Math.max(0, Math.min(1, value)));
}

function normalizeVarianceToUnit(variance: number) {
  return clampUnit(variance / (1 + variance));
}

function average(values: number[], fallback = 0) {
  if (values.length === 0) {
    return fallback;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
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

function squaredDistance(left: number[], right: number[]) {
  assertMatchingDimension(left, right, "Squared distance");
  return left.reduce((sum, value, index) => {
    const delta = value - right[index];
    return sum + delta * delta;
  }, 0);
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

function vectorForSample(sample: KernelSample) {
  return sample.embedding ?? sample.theta ?? [];
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
    let pivotMagnitude = Math.abs(working[pivotRow]?.[pivotColumn] ?? 0);

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

    if (pivotMagnitude <= 1e-3 || offDiagonalNorm(working) <= 1e-3) {
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
        working[index][pivotRow] = roundMetric(cosine * aip - sine * aiq);
        working[pivotRow][index] = working[index][pivotRow];
        working[index][pivotColumn] = roundMetric(sine * aip + cosine * aiq);
        working[pivotColumn][index] = working[index][pivotColumn];
      }
    }

    working[pivotRow][pivotRow] = roundMetric(
      cosine * cosine * app - 2 * sine * cosine * apq + sine * sine * aqq,
    );
    working[pivotColumn][pivotColumn] = roundMetric(
      sine * sine * app + 2 * sine * cosine * apq + cosine * cosine * aqq,
    );
    working[pivotRow][pivotColumn] = 0;
    working[pivotColumn][pivotRow] = 0;

    for (let index = 0; index < size; index += 1) {
      const vip = eigenvectors[index][pivotRow];
      const viq = eigenvectors[index][pivotColumn];
      eigenvectors[index][pivotRow] = roundMetric(cosine * vip - sine * viq);
      eigenvectors[index][pivotColumn] = roundMetric(sine * vip + cosine * viq);
    }
  }

  return working
    .map((row, index) => roundMetric(row[index]))
    .sort((left, right) => left - right);
}

function pairwiseSquaredDistances(vectors: number[][]) {
  const distances: number[] = [];
  for (let leftIndex = 0; leftIndex < vectors.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < vectors.length; rightIndex += 1) {
      distances.push(squaredDistance(vectors[leftIndex], vectors[rightIndex]));
    }
  }
  return distances;
}

function resolveBandwidth(vectors: number[][], bandwidth?: number) {
  if (typeof bandwidth === "number" && Number.isFinite(bandwidth) && bandwidth > 0) {
    return bandwidth;
  }

  const distances = pairwiseSquaredDistances(vectors)
    .filter((value) => Number.isFinite(value) && value > Number.EPSILON)
    .sort((left, right) => left - right);
  if (distances.length === 0) {
    return 1;
  }

  const medianSquaredDistance = distances[Math.floor(distances.length / 2)];
  return Math.max(Math.sqrt(medianSquaredDistance), 1e-3);
}

function rowSums(matrix: number[][]) {
  return matrix.map((row) => row.reduce((sum, value) => sum + value, 0));
}

function variance(values: number[]) {
  if (values.length <= 1) {
    return 0;
  }
  const mean = average(values);
  return values.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / values.length;
}

function symmetrize(matrix: number[][]) {
  return matrix.map((row, rowIndex) =>
    row.map((value, columnIndex) => roundMetric((value + (matrix[columnIndex]?.[rowIndex] ?? value)) / 2)),
  );
}

export function computeSimilarityMatrix(samples: KernelSample[]) {
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

export function computePositiveDefiniteKernelApprox(samples: KernelSample[], bandwidth?: number) {
  const vectors = samples.map(vectorForSample);
  if (vectors.length === 0) {
    return [];
  }

  const resolvedBandwidth = resolveBandwidth(vectors, bandwidth);
  const denominator = Math.max(2 * resolvedBandwidth * resolvedBandwidth, 1e-6);

  return vectors.map((left, rowIndex) =>
    vectors.map((right, columnIndex) => {
      if (rowIndex === columnIndex) {
        return 1;
      }
      return roundMetric(Math.exp(-squaredDistance(left, right) / denominator));
    }),
  );
}

export function computeKernelConsistency(kernelMatrix: number[][], similarityMatrix: number[][]) {
  if (kernelMatrix.length === 0 || similarityMatrix.length === 0) {
    return 0;
  }

  const symmetryResiduals: number[] = [];
  const alignmentResiduals: number[] = [];
  const diagonalResiduals: number[] = [];

  for (let rowIndex = 0; rowIndex < kernelMatrix.length; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < kernelMatrix[rowIndex].length; columnIndex += 1) {
      if (rowIndex === columnIndex) {
        diagonalResiduals.push(Math.abs(1 - kernelMatrix[rowIndex][columnIndex]));
        continue;
      }

      symmetryResiduals.push(Math.abs(kernelMatrix[rowIndex][columnIndex] - kernelMatrix[columnIndex][rowIndex]));
      alignmentResiduals.push(Math.abs(kernelMatrix[rowIndex][columnIndex] - similarityMatrix[rowIndex][columnIndex]));
    }
  }

  const eigenvalues = jacobiEigenvalues(symmetrize(kernelMatrix));
  const smallestEigenvalue = eigenvalues[0] ?? 0;
  const positiveSpectrumScore = clampUnit(1 - Math.max(0, -smallestEigenvalue) / (1 + Math.abs(smallestEigenvalue)));
  const symmetryScore = clampUnit(1 - average(symmetryResiduals));
  const diagonalScore = clampUnit(1 - average(diagonalResiduals));
  const alignmentScore = clampUnit(1 - average(alignmentResiduals));

  return clampUnit(average([symmetryScore, diagonalScore, alignmentScore, positiveSpectrumScore]));
}

export function computeSpectralStability(kernelMatrix: number[][]) {
  if (kernelMatrix.length === 0) {
    return 0;
  }

  const symmetricKernel = symmetrize(kernelMatrix);
  const eigenvalues = jacobiEigenvalues(symmetricKernel);
  const nonNegativeEigenvalues = eigenvalues.map((value) => Math.max(0, value));
  const rowEnergyVariance = variance(rowSums(symmetricKernel));
  const eigenvalueVariance = variance(nonNegativeEigenvalues);
  const smallestEigenvalue = eigenvalues[0] ?? 0;
  const positiveSpectrumScore = clampUnit(1 - Math.max(0, -smallestEigenvalue) / (1 + Math.abs(smallestEigenvalue)));
  const rowEnergyStability = clampUnit(1 - normalizeVarianceToUnit(rowEnergyVariance));
  const eigenvalueStability = clampUnit(1 - normalizeVarianceToUnit(eigenvalueVariance));

  return clampUnit(average([positiveSpectrumScore, rowEnergyStability, eigenvalueStability]));
}

export function computeSpectralKernelField(samples: KernelSample[], bandwidth?: number): SpectralKernelField {
  const kernelMatrix = computePositiveDefiniteKernelApprox(samples, bandwidth);
  const similarityMatrix = computeSimilarityMatrix(samples);

  return {
    kernelMatrix,
    similarityMatrix,
    kernelConsistency: computeKernelConsistency(kernelMatrix, similarityMatrix),
    spectralStability: computeSpectralStability(kernelMatrix),
  };
}
