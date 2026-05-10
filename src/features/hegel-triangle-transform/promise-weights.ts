export interface PromiseWeightContext {
  corpusDensity: number;
  curvature: number;
  projectionDistance: number;
  centrality: number;
}

export interface PromiseWeightSet {
  repairability: Record<string, number>;
  constructive: Record<string, number>;
  obstructive: Record<string, number>;
}

function roundMetric(value: number) {
  return Number(value.toFixed(6));
}

function clampUnit(value: number) {
  return roundMetric(Math.max(0, Math.min(1, value)));
}

function weight(base: number, ...adjustments: number[]) {
  return roundMetric(
    Math.max(
      0.05,
      base + adjustments.reduce((sum, value) => sum + value, 0),
    ),
  );
}

export function computeDynamicPromiseWeightSet(context: PromiseWeightContext): PromiseWeightSet {
  const corpusDensity = clampUnit(context.corpusDensity);
  const curvature = clampUnit(context.curvature);
  const projectionDistance = clampUnit(context.projectionDistance);
  const centrality = clampUnit(context.centrality);

  return {
    repairability: {
      antiVacuity: weight(0.8, corpusDensity * 0.1, centrality * 0.08),
      projectionRelief: weight(1.05, projectionDistance * 0.45),
      refinementLegality: weight(0.95, projectionDistance * 0.18, centrality * 0.12),
      projectionConsistency: weight(0.9, projectionDistance * 0.32),
      branchAdmissibility: weight(0.78, centrality * 0.12, curvature * 0.08),
      metricCompressionGain: weight(0.72, curvature * 0.1, projectionDistance * 0.12),
      gluingFitness: weight(0.92, centrality * 0.22, projectionDistance * 0.1),
      groupLikeStability: weight(0.78, centrality * 0.16, curvature * 0.08),
      antiResetBurden: weight(0.88, curvature * 0.18, centrality * 0.1),
      kernelConsistency: weight(0.7, corpusDensity * 0.12, centrality * 0.08),
    },
    constructive: {
      antiProjection: weight(1.15, projectionDistance * 0.42),
      repairability: weight(1.02, projectionDistance * 0.14, centrality * 0.08),
      gluingFitness: weight(0.98, centrality * 0.26, projectionDistance * 0.1),
      boundaryCompatibility: weight(0.82, centrality * 0.18),
      refinementLegality: weight(0.9, projectionDistance * 0.2, centrality * 0.1),
      projectionConsistency: weight(0.92, projectionDistance * 0.24),
      antiResetBurden: weight(0.86, curvature * 0.12, centrality * 0.08),
      groupLikeStability: weight(0.8, centrality * 0.2),
      corpusRelevance: weight(0.8, corpusDensity * 0.34),
      corpusNovelty: weight(0.68, corpusDensity * 0.08, curvature * 0.06),
      dialecticSupport: weight(0.76, centrality * 0.18, corpusDensity * 0.12),
      antiVacuity: weight(0.92, corpusDensity * 0.16),
      productiveDivergenceBand: weight(0.78, curvature * 0.08, centrality * 0.06),
      kernelConsistency: weight(0.72, corpusDensity * 0.18),
      spectralStability: weight(0.72, centrality * 0.12, projectionDistance * 0.08),
      smearletFitness: weight(0.66, corpusDensity * 0.18, centrality * 0.08),
    },
    obstructive: {
      divergence: weight(0.72, curvature * 0.16, centrality * 0.08),
      curvature: weight(1.08, curvature * 0.42),
      holonomyProxy: weight(1.02, curvature * 0.18, projectionDistance * 0.12),
      structuralProjectionFailure: weight(1.08, projectionDistance * 0.42),
      asymmetry: weight(0.76, curvature * 0.18, projectionDistance * 0.1),
      generatorComplexity: weight(0.8, centrality * 0.24, curvature * 0.08),
      cascadeDepth: weight(0.78, centrality * 0.28),
      rkhsGrowthTendency: weight(0.82, curvature * 0.16, corpusDensity * 0.1),
      antiSpectralStability: weight(0.74, curvature * 0.14),
      antiSmearletFitness: weight(0.7, curvature * 0.12, projectionDistance * 0.08),
    },
  };
}

export function weightedAverage(
  terms: Array<{ value: number; weight: number }>,
  fallback = 0,
) {
  if (terms.length === 0) {
    return clampUnit(fallback);
  }

  const totalWeight = terms.reduce((sum, term) => sum + Math.max(0, term.weight), 0);
  if (totalWeight <= Number.EPSILON) {
    return clampUnit(fallback);
  }

  const weightedSum = terms.reduce((sum, term) => sum + term.value * Math.max(0, term.weight), 0);
  return clampUnit(weightedSum / totalWeight);
}
