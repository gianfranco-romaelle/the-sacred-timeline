import type { DecCompatibilityMetrics } from "./dec-compatibility";
import type { ControlFeatureMetrics } from "./control-features";
import { computeDynamicPromiseWeightSet, weightedAverage } from "./promise-weights";

export type PromiseProfileClassification =
  | "accepted"
  | "promisingConstructive"
  | "promisingObstructive"
  | "repairable"
  | "blocked"
  | "vacuous"
  | "rejected";

export interface PromiseProfileSpectralFeatures {
  kernelConsistency: number;
  spectralStability: number;
  toeplitzCoherence: number;
  smearletFitness: number;
  rkhsGrowthTendency: number;
}

export interface OptionalSemeioticFeatureBlock {
  enabled: boolean;
  interpretantStability: number;
  mismatchRichness: number;
  semeioticBranchingDepth: number;
  dialecticalCompressionQuality: number;
}

export interface PromiseProfileInput {
  corpusRelevance: number;
  corpusNovelty: number;
  corpusDensity: number;
  dialecticSupport: number;
  vacuityPenalty: number;
  divergence: number;
  asymmetry: number;
  projection: number;
  curvature: number;
  centrality: number;
  decCompatibility: DecCompatibilityMetrics;
  refinementLegality: number;
  projectionConsistency: number;
  branchAdmissibility: number;
  metricCompressionGain: number;
  krFeatures: ControlFeatureMetrics;
  spectralFeatures: PromiseProfileSpectralFeatures;
  semeioticFeatureBlock?: OptionalSemeioticFeatureBlock;
}

export interface PromiseProfile {
  constructivePromise: number;
  obstructivePromise: number;
  repairability: number;
  holonomyProxy: number;
  classification: PromiseProfileClassification;
  semeioticFeatureBlock?: OptionalSemeioticFeatureBlock;
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

function semeioticFeatureBlockOrDisabled(
  block?: OptionalSemeioticFeatureBlock,
): OptionalSemeioticFeatureBlock {
  return block ?? {
    enabled: false,
    interpretantStability: 0,
    mismatchRichness: 0,
    semeioticBranchingDepth: 0,
    dialecticalCompressionQuality: 0,
  };
}

export function computeHolonomyProxy(features: PromiseProfileSpectralFeatures) {
  return clampUnit(
    average([
      1 - features.kernelConsistency,
      1 - features.spectralStability,
      1 - features.toeplitzCoherence,
      features.rkhsGrowthTendency,
    ]),
  );
}

export function computeRepairability(input: PromiseProfileInput) {
  const semeiotic = semeioticFeatureBlockOrDisabled(input.semeioticFeatureBlock);
  const weights = computeDynamicPromiseWeightSet({
    corpusDensity: input.corpusDensity,
    curvature: input.curvature,
    projectionDistance: input.projection,
    centrality: input.centrality,
  }).repairability;

  return weightedAverage([
    { value: 1 - input.vacuityPenalty, weight: weights.antiVacuity },
    { value: 1 - input.projection, weight: weights.projectionRelief },
    { value: input.refinementLegality, weight: weights.refinementLegality },
    { value: input.projectionConsistency, weight: weights.projectionConsistency },
    { value: input.branchAdmissibility, weight: weights.branchAdmissibility },
    { value: input.metricCompressionGain, weight: weights.metricCompressionGain },
    { value: input.decCompatibility.gluingFitness, weight: weights.gluingFitness },
    { value: input.krFeatures.groupLikeStability, weight: weights.groupLikeStability },
    { value: 1 - input.krFeatures.resetBurden, weight: weights.antiResetBurden },
    { value: input.spectralFeatures.kernelConsistency, weight: weights.kernelConsistency },
    ...(semeiotic.enabled
      ? [
          { value: semeiotic.interpretantStability, weight: 0.22 },
          { value: semeiotic.dialecticalCompressionQuality, weight: 0.18 },
          { value: semeiotic.mismatchRichness, weight: 0.12 },
        ]
      : []),
  ]);
}

export function computeConstructivePromise(input: PromiseProfileInput, repairability: number) {
  const productiveDivergenceBand = clampUnit(1 - Math.min(1, Math.abs(input.divergence - 0.55) / 0.55));
  const semeiotic = semeioticFeatureBlockOrDisabled(input.semeioticFeatureBlock);
  const weights = computeDynamicPromiseWeightSet({
    corpusDensity: input.corpusDensity,
    curvature: input.curvature,
    projectionDistance: input.projection,
    centrality: input.centrality,
  }).constructive;

  return weightedAverage([
    { value: 1 - input.projection, weight: weights.antiProjection },
    { value: repairability, weight: weights.repairability },
    { value: input.decCompatibility.gluingFitness, weight: weights.gluingFitness },
    { value: input.decCompatibility.boundaryCompatibility, weight: weights.boundaryCompatibility },
    { value: input.refinementLegality, weight: weights.refinementLegality },
    { value: input.projectionConsistency, weight: weights.projectionConsistency },
    { value: 1 - input.krFeatures.resetBurden, weight: weights.antiResetBurden },
    { value: input.krFeatures.groupLikeStability, weight: weights.groupLikeStability },
    { value: input.corpusRelevance, weight: weights.corpusRelevance },
    { value: input.corpusNovelty, weight: weights.corpusNovelty },
    { value: input.dialecticSupport, weight: weights.dialecticSupport },
    { value: 1 - input.vacuityPenalty, weight: weights.antiVacuity },
    { value: productiveDivergenceBand, weight: weights.productiveDivergenceBand },
    { value: input.spectralFeatures.kernelConsistency, weight: weights.kernelConsistency },
    { value: input.spectralFeatures.spectralStability, weight: weights.spectralStability },
    { value: input.spectralFeatures.smearletFitness, weight: weights.smearletFitness },
    ...(semeiotic.enabled
      ? [
          { value: semeiotic.interpretantStability, weight: 0.28 },
          { value: semeiotic.dialecticalCompressionQuality, weight: 0.22 },
          { value: semeiotic.semeioticBranchingDepth, weight: 0.1 },
          { value: semeiotic.mismatchRichness, weight: 0.08 },
        ]
      : []),
  ]);
}

export function computeObstructivePromise(
  input: PromiseProfileInput,
  holonomyProxy: number,
) {
  const semeiotic = semeioticFeatureBlockOrDisabled(input.semeioticFeatureBlock);
  const structuralProjectionFailure = clampUnit(
    average([
      input.projection,
      1 - input.refinementLegality,
      1 - input.projectionConsistency,
      1 - input.decCompatibility.gluingFitness,
    ]),
  );

  const weights = computeDynamicPromiseWeightSet({
    corpusDensity: input.corpusDensity,
    curvature: input.curvature,
    projectionDistance: input.projection,
    centrality: input.centrality,
  }).obstructive;

  return weightedAverage([
    { value: clampUnit(input.divergence), weight: weights.divergence },
    { value: input.curvature, weight: weights.curvature },
    { value: holonomyProxy, weight: weights.holonomyProxy },
    { value: structuralProjectionFailure, weight: weights.structuralProjectionFailure },
    { value: input.asymmetry, weight: weights.asymmetry },
    { value: input.krFeatures.generatorComplexity, weight: weights.generatorComplexity },
    { value: input.krFeatures.cascadeDepth, weight: weights.cascadeDepth },
    { value: input.spectralFeatures.rkhsGrowthTendency, weight: weights.rkhsGrowthTendency },
    { value: 1 - input.spectralFeatures.spectralStability, weight: weights.antiSpectralStability },
    { value: 1 - input.spectralFeatures.smearletFitness, weight: weights.antiSmearletFitness },
    ...(semeiotic.enabled
      ? [
          { value: 1 - semeiotic.interpretantStability, weight: 0.24 },
          { value: semeiotic.mismatchRichness, weight: 0.2 },
          { value: semeiotic.semeioticBranchingDepth, weight: 0.16 },
        ]
      : []),
  ]);
}

export function classifyPromiseProfile(
  input: PromiseProfileInput,
  constructivePromise: number,
  obstructivePromise: number,
  repairability: number,
  holonomyProxy: number,
): PromiseProfileClassification {
  const structuralProjectionFailure =
    input.projection >= 0.72 &&
    input.refinementLegality < 0.36 &&
    input.decCompatibility.gluingFitness < 0.34;
  const veryLowSignal =
    input.divergence < 0.18 &&
    input.corpusRelevance < 0.42 &&
    input.dialecticSupport < 0.45;

  if (input.vacuityPenalty >= 0.65 || veryLowSignal) {
    return "vacuous";
  }

  if (structuralProjectionFailure && obstructivePromise >= 0.72 && repairability < 0.34) {
    return "rejected";
  }

  if (
    constructivePromise >= 0.76 &&
    input.projection <= 0.12 &&
    repairability >= 0.68 &&
    input.decCompatibility.gluingFitness >= 0.58 &&
    input.krFeatures.resetBurden <= 0.3 &&
    obstructivePromise < 0.45
  ) {
    return "accepted";
  }

  if (constructivePromise >= 0.58 && repairability >= 0.52 && input.projection < 0.54) {
    return "promisingConstructive";
  }

  if (obstructivePromise >= 0.58 && (input.curvature >= 0.32 || holonomyProxy >= 0.45 || structuralProjectionFailure)) {
    return "promisingObstructive";
  }

  if (repairability >= 0.46 && input.projection < 0.72) {
    return "repairable";
  }

  if (input.projection >= 0.62 || (obstructivePromise >= 0.62 && repairability < 0.42)) {
    return "blocked";
  }

  return constructivePromise >= obstructivePromise ? "promisingConstructive" : "promisingObstructive";
}

export function computePromiseProfile(input: PromiseProfileInput): PromiseProfile {
  const semeioticFeatureBlock = semeioticFeatureBlockOrDisabled(input.semeioticFeatureBlock);
  const holonomyProxy = computeHolonomyProxy(input.spectralFeatures);
  const repairability = computeRepairability(input);
  const constructivePromise = computeConstructivePromise(input, repairability);
  const obstructivePromise = computeObstructivePromise(input, holonomyProxy);

  return {
    constructivePromise,
    obstructivePromise,
    repairability,
    holonomyProxy,
    semeioticFeatureBlock,
    classification: classifyPromiseProfile(
      input,
      constructivePromise,
      obstructivePromise,
      repairability,
      holonomyProxy,
    ),
  };
}
