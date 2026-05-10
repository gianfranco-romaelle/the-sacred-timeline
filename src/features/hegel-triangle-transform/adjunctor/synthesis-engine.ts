import type {
  CandidateProposalArtifact,
  CandidateProposalId,
  CritiquePayload,
  FragmentNeighborhoodSnapshot,
} from "./provider-types";
import {
  computeEmbeddingCurvature,
  computeNegAdjunctionField,
  computeProductiveScore,
  type NegAdjunctionField,
} from "../information-geometry";
import { computeSpectralKernelField } from "../spectral-kernel";
import { computeSmearletFeatureField } from "../smearlet-features";
import { computeToeplitzStructureField } from "../toeplitz-structure";
import {
  computePromiseProfile,
  type OptionalSemeioticFeatureBlock,
  type PromiseProfile,
} from "../promise-profile";

export type SynthesisAssessment =
  | "promising_but_risky"
  | "likely_vacuous"
  | "architecturally_central"
  | "likely_blocked"
  | "lean_worthy"
  | "nucleation_candidate";

export interface ProviderContributionSummary {
  sourceProviders: string[];
  mutationContributionCount: number;
  formalizationContributionCount: number;
  critiqueFindingCount: number;
}

export interface SynthesizedCandidateRecord {
  candidate: CandidateProposalArtifact;
  divergenceField: NegAdjunctionField;
  promiseProfile: PromiseProfile;
  productiveScore: number;
  vacuityPenalty: number;
  instabilityPenalty: number;
  combinedScore: number;
  mutationEnergy: number;
  formalizationStrength: number;
  critiquePressure: number;
  architectureCentrality: number;
  criticPreferred: boolean;
  criticBlocked: boolean;
  critiqueFindings: string[];
  disagreementSignals: string[];
  assessments: SynthesisAssessment[];
  contributionSummary: ProviderContributionSummary;
}

interface SynthesisOptions {
  semeioticPromiseInfluenceEnabled?: boolean;
}

function clampUnit(value: number) {
  return Math.min(0.99, Math.max(0, Number(value.toFixed(2))));
}

function clampPenalty(value: number) {
  return Math.min(0.95, Math.max(0, Number(value.toFixed(3))));
}

function severityWeight(message: string) {
  if (message.includes("overreaches") || message.includes("blocking")) {
    return 0.3;
  }
  if (message.includes("formal") || message.includes("ambigu")) {
    return 0.18;
  }
  return 0.12;
}

function providerSummary(
  candidate: CandidateProposalArtifact,
  critiqueFindings: string[],
): ProviderContributionSummary {
  const sourceProviders = Array.from(new Set(candidate.provenance.map((record) => record.providerId)));
  return {
    sourceProviders,
    mutationContributionCount: candidate.provenance.filter((record) => record.providerRole === "local_mutation_engine").length,
    formalizationContributionCount: candidate.provenance.filter((record) => record.providerRole === "proposal_synthesizer").length,
    critiqueFindingCount: critiqueFindings.length,
  };
}

function computeOptionalSemeioticFeatureBlock(
  candidate: CandidateProposalArtifact,
  contributionSummary: ProviderContributionSummary,
  critiqueFindings: string[],
  disagreementSignals: string[],
  options?: SynthesisOptions,
): OptionalSemeioticFeatureBlock {
  if (!options?.semeioticPromiseInfluenceEnabled) {
    return {
      enabled: false,
      interpretantStability: 0,
      mismatchRichness: 0,
      semeioticBranchingDepth: 0,
      dialecticalCompressionQuality: 0,
    };
  }

  const corpusSupportStrength = clampUnit(candidate.corpusSupport.length / 4);
  const provenanceBreadth = clampUnit(candidate.provenance.length / 4);
  const providerDiversity = clampUnit(contributionSummary.sourceProviders.length / 3);
  const critiqueDensity = clampUnit(critiqueFindings.length / 4);
  const disagreementDensity = clampUnit(disagreementSignals.length / 4);

  return {
    enabled: true,
    interpretantStability: clampUnit(
      candidate.confidence.overall * 0.28 +
        candidate.confidence.formal * 0.24 +
        corpusSupportStrength * 0.18 +
        (1 - critiqueDensity) * 0.18 +
        (1 - disagreementDensity) * 0.12,
    ),
    mismatchRichness: clampUnit(
      critiqueDensity * 0.55 +
        disagreementDensity * 0.25 +
        (candidate.proposalKind === "obstruction_claim" ? 0.2 : 0),
    ),
    semeioticBranchingDepth: clampUnit(
      providerDiversity * 0.34 + provenanceBreadth * 0.33 + disagreementDensity * 0.33,
    ),
    dialecticalCompressionQuality: clampUnit(
      candidate.confidence.formal * 0.34 +
        candidate.confidence.semantic * 0.22 +
        providerDiversity * 0.18 +
        (1 - critiqueDensity) * 0.16 +
        corpusSupportStrength * 0.1,
    ),
  };
}

function corpusRelevance(candidate: CandidateProposalArtifact) {
  if (candidate.corpusSupport.length === 0) {
    return 0;
  }

  const meanSimilarity =
    candidate.corpusSupport.reduce((sum, support) => sum + support.similarity, 0) / candidate.corpusSupport.length;
  return clampUnit(meanSimilarity);
}

function corpusDensity(candidate: CandidateProposalArtifact) {
  if (candidate.corpusSupport.length === 0) {
    return 0;
  }

  const coverage = Math.min(1, candidate.corpusSupport.length / 3);
  const meanSimilarity =
    candidate.corpusSupport.reduce((sum, support) => sum + support.similarity, 0) / candidate.corpusSupport.length;
  return clampUnit(coverage * 0.45 + meanSimilarity * 0.55);
}

function corpusNovelty(candidate: CandidateProposalArtifact, relevance: number) {
  return clampUnit(candidate.confidence.novelty * 0.72 + (1 - relevance) * 0.28);
}

function dialecticSupport(
  candidate: CandidateProposalArtifact,
  contributionSummary: ProviderContributionSummary,
  critiqueFindings: string[],
  criticBlocked: boolean,
) {
  return clampUnit(
    (contributionSummary.sourceProviders.length / 3) * 0.34 +
      Math.min(0.22, contributionSummary.formalizationContributionCount * 0.12) +
      Math.min(0.18, contributionSummary.mutationContributionCount * 0.08) +
      Math.min(0.14, candidate.corpusSupport.length * 0.05) +
      (critiqueFindings.length > 0 ? 0.08 : 0.14) +
      (criticBlocked ? 0 : 0.08),
  );
}

function mutationEnergy(candidate: CandidateProposalArtifact, contributionSummary: ProviderContributionSummary) {
  return clampUnit(
    (contributionSummary.mutationContributionCount > 0 ? 0.54 : 0.2) +
      (contributionSummary.mutationContributionCount > 0 ? 0.18 : 0) +
      (candidate.tags.includes("open-llm-mutation") ? 0.12 : 0),
  );
}

function formalizationStrength(candidate: CandidateProposalArtifact, contributionSummary: ProviderContributionSummary) {
  return clampUnit(
    (contributionSummary.formalizationContributionCount > 0 ? 0.56 : 0.2) +
      (contributionSummary.formalizationContributionCount > 0 ? 0.1 : 0) +
      (candidate.tags.includes("formalized") ? 0.12 : 0),
  );
}

function architectureCentrality(candidate: CandidateProposalArtifact) {
  const kindBase: Record<CandidateProposalArtifact["proposalKind"], number> = {
    candidate_theorem: 0.72,
    candidate_definition: 0.84,
    bridge_lemma: 0.79,
    projection_rule: 0.65,
    compatibility_claim: 0.68,
    obstruction_claim: 0.51,
    refinement_law: 0.77,
    refine_vertex: 0.62,
    refine_edge: 0.62,
    introduce_definition: 0.74,
    state_theorem: 0.72,
    merge_fragments: 0.58,
    split_fragment: 0.58,
    promote_fragment: 0.63,
    relabel_fragment: 0.48,
  };

  return clampUnit(
    kindBase[candidate.proposalKind] * 0.72 +
      (candidate.artifactKind === "definition" || candidate.artifactKind === "lemma" ? 0.12 : 0) +
      (candidate.tags.includes("formalized") ? 0.08 : 0),
  );
}

function critiquePressure(
  candidate: CandidateProposalArtifact,
  critique: CritiquePayload,
  critiqueFindings: string[],
) {
  const criticBlocked = critique.blockedCandidateIds.includes(candidate.candidateId);
  const findingWeight = critiqueFindings.reduce((total, message) => total + severityWeight(message), 0);
  return clampUnit(
    Math.min(0.72, findingWeight) +
      (criticBlocked ? 0.22 : 0) +
      (candidate.tags.includes("formalized") ? 0 : 0.06),
  );
}

function divergenceField(
  candidate: CandidateProposalArtifact,
  neighborhood: FragmentNeighborhoodSnapshot,
  curvature: number,
) {
  return computeNegAdjunctionField({
    F: { theta: candidate.theta, eta: candidate.eta },
    G: { theta: neighborhood.theta, eta: neighborhood.eta },
  }, undefined, 0, curvature);
}

function vacuityPenalty(
  candidate: CandidateProposalArtifact,
  critiqueFindings: string[],
  field: NegAdjunctionField,
) {
  let penalty = 0;

  if (critiqueFindings.some((message) => message.toLowerCase().includes("vacu"))) {
    penalty += 0.42;
  }
  if (field.total < 0.22) {
    penalty += 0.28;
  }
  if (field.asymmetry <= 1e-6) {
    penalty += 0.12;
  }
  if (candidate.artifactKind === "corollary" && field.total < 0.3) {
    penalty += 0.24;
  }

  return clampPenalty(penalty);
}

function instabilityPenalty(
  criticBlocked: boolean,
  critiquePressureScore: number,
  formalizationScore: number,
  field: NegAdjunctionField,
) {
  let penalty = critiquePressureScore * 0.45;

  if (criticBlocked) {
    penalty += 0.18;
  }
  if (formalizationScore < 0.55) {
    penalty += 0.12;
  }
  penalty += Math.min(0.18, field.curvature * 0.24);
  if (field.total > Number.EPSILON) {
    const asymmetryRatio = field.asymmetry / field.total;
    if (asymmetryRatio > 0.35) {
      penalty += Math.min(0.2, asymmetryRatio * 0.2);
    }
  }

  return clampPenalty(penalty);
}

function disagreementSignals(
  candidate: CandidateProposalArtifact,
  criticPreferred: boolean,
  criticBlocked: boolean,
  mutationEnergyScore: number,
  formalizationScore: number,
  critiquePressureScore: number,
  centralityScore: number,
) {
  const signals: string[] = [];

  if (criticBlocked && formalizationScore >= 0.65) {
    signals.push("critic_pressure_against_formal_strength");
  }
  if (mutationEnergyScore >= 0.7 && formalizationScore < 0.58) {
    signals.push("novel_but_underformalized");
  }
  if (!criticPreferred && formalizationScore >= 0.72) {
    signals.push("synthesizer_push_without_critic_support");
  }
  if (centralityScore >= 0.74 && critiquePressureScore >= 0.45) {
    signals.push("central_but_contested");
  }
  if (candidate.tags.includes("open-llm-mutation") && candidate.tags.includes("formalized")) {
    signals.push("mutation_survived_formalization");
  }

  return signals;
}

function assessments(
  candidate: CandidateProposalArtifact,
  field: NegAdjunctionField,
  criticBlocked: boolean,
  mutationEnergyScore: number,
  formalizationScore: number,
  critiquePressureScore: number,
  centralityScore: number,
  productiveScore: number,
  vacuityPenaltyScore: number,
  instabilityPenaltyScore: number,
  combinedScore: number,
  disagreementSignals: string[],
  critiqueFindings: string[],
) {
  const output: SynthesisAssessment[] = [];

  const vacuityLikely =
    vacuityPenaltyScore >= 0.35 ||
    critiqueFindings.some((message) => message.toLowerCase().includes("vacu")) ||
    (candidate.artifactKind === "corollary" &&
      candidate.confidence.novelty < 0.45 &&
      candidate.confidence.semantic < 0.58);
  const blockedLikely =
    criticBlocked ||
    instabilityPenaltyScore >= 0.42 ||
    critiquePressureScore >= 0.62 ||
    disagreementSignals.includes("critic_pressure_against_formal_strength");
  const centralLikely = centralityScore >= 0.72;
  const mediumHighTotal = field.total >= 0.35;
  const asymmetrySignal = field.asymmetry > 1e-6;
  const nucleationCandidate = field.curvature >= 0.08 && centralLikely && !vacuityLikely;
  const promisingRisky =
    productiveScore >= 0.28 &&
    mediumHighTotal &&
    (instabilityPenaltyScore >= 0.22 ||
      critiquePressureScore >= 0.36 ||
      disagreementSignals.length > 0 ||
      (mutationEnergyScore >= 0.7 && formalizationScore < 0.62));
  const leanWorthy =
    combinedScore >= 0.22 &&
    mediumHighTotal &&
    formalizationScore >= 0.63 &&
    !vacuityLikely &&
    (!blockedLikely || candidate.artifactKind === "definition") &&
    (asymmetrySignal || disagreementSignals.length > 0 || candidate.artifactKind === "definition");

  if (promisingRisky) {
    output.push("promising_but_risky");
  }
  if (vacuityLikely) {
    output.push("likely_vacuous");
  }
  if (centralLikely) {
    output.push("architecturally_central");
  }
  if (blockedLikely) {
    output.push("likely_blocked");
  }
  if (leanWorthy) {
    output.push("lean_worthy");
  }
  if (nucleationCandidate) {
    output.push("nucleation_candidate");
  }

  return output;
}

export function synthesizeMultiModelCandidates(
  candidates: CandidateProposalArtifact[],
  critique: CritiquePayload,
  neighborhood: FragmentNeighborhoodSnapshot,
  modelOutputSamples: Array<{ embedding?: number[]; theta: number[] }> = [],
  options?: SynthesisOptions,
): SynthesizedCandidateRecord[] {
  const curvature = computeEmbeddingCurvature(modelOutputSamples);
  return [...candidates]
    .map((candidate) => {
      const critiqueFindings = critique.findings
        .filter((finding) => finding.affectedCandidateIds.includes(candidate.candidateId))
        .map((finding) => finding.message);
      const criticPreferred = critique.preferredCandidateIds.includes(candidate.candidateId);
      const criticBlocked = critique.blockedCandidateIds.includes(candidate.candidateId);
      const contributionSummary = providerSummary(candidate, critiqueFindings);
      const mutationEnergyScore = mutationEnergy(candidate, contributionSummary);
      const formalizationScore = formalizationStrength(candidate, contributionSummary);
      const centralityScore = architectureCentrality(candidate);
      const critiquePressureScore = critiquePressure(candidate, critique, critiqueFindings);
      const field = divergenceField(candidate, neighborhood, curvature);
      const vacuityPenaltyScore = vacuityPenalty(candidate, critiqueFindings, field);
      const instabilityPenaltyScore = instabilityPenalty(
        criticBlocked,
        critiquePressureScore,
        formalizationScore,
        field,
      );
      const signals = disagreementSignals(
        candidate,
        criticPreferred,
        criticBlocked,
        mutationEnergyScore,
        formalizationScore,
        critiquePressureScore,
        centralityScore,
      );
      const spectralSamples = [
        { embedding: candidate.embedding, theta: candidate.theta },
        { embedding: neighborhood.embedding, theta: neighborhood.theta },
        ...modelOutputSamples,
      ];
      const kernelField = computeSpectralKernelField(spectralSamples);
      const toeplitzField = computeToeplitzStructureField(spectralSamples);
      const smearletField = computeSmearletFeatureField(spectralSamples);
      const relevance = corpusRelevance(candidate);
      const density = corpusDensity(candidate);
      const novelty = corpusNovelty(candidate, relevance);
      const support = dialecticSupport(candidate, contributionSummary, critiqueFindings, criticBlocked);
      const semeioticFeatureBlock = computeOptionalSemeioticFeatureBlock(
        candidate,
        contributionSummary,
        critiqueFindings,
        signals,
        options,
      );
      const promiseProfile = computePromiseProfile({
        corpusRelevance: relevance,
        corpusNovelty: novelty,
        corpusDensity: density,
        dialecticSupport: support,
        vacuityPenalty: vacuityPenaltyScore,
        divergence: field.total,
        asymmetry: field.asymmetry,
        projection: Math.max(field.projection, 0.18),
        curvature: field.curvature,
        centrality: centralityScore,
        decCompatibility: neighborhood.decCompatibility,
        refinementLegality: neighborhood.refinementFeatures.refinementLegality,
        projectionConsistency: neighborhood.refinementFeatures.projectionConsistency,
        branchAdmissibility: neighborhood.refinementFeatures.branchAdmissibility,
        metricCompressionGain: neighborhood.refinementFeatures.metricCompressionGain,
        krFeatures: neighborhood.controlFeatures,
        spectralFeatures: {
          kernelConsistency: kernelField.kernelConsistency,
          spectralStability: kernelField.spectralStability,
          toeplitzCoherence: toeplitzField.toeplitzCoherence,
          smearletFitness: smearletField.smearletFitness,
          rkhsGrowthTendency: smearletField.rkhsGrowthTendency,
        },
        semeioticFeatureBlock,
      });

      const productiveScore = computeProductiveScore(
        field,
        vacuityPenaltyScore,
        instabilityPenaltyScore,
      );
      const combinedScore = clampUnit(
        productiveScore +
          Math.min(0.2, field.curvature * 0.35) +
          Math.min(0.18, field.asymmetry * 0.6),
      );

      return {
        candidate,
        divergenceField: field,
        promiseProfile,
        productiveScore,
        vacuityPenalty: vacuityPenaltyScore,
        instabilityPenalty: instabilityPenaltyScore,
        combinedScore,
        mutationEnergy: mutationEnergyScore,
        formalizationStrength: formalizationScore,
        critiquePressure: critiquePressureScore,
        architectureCentrality: centralityScore,
        criticPreferred,
        criticBlocked,
        critiqueFindings,
        disagreementSignals: signals,
        assessments: assessments(
          candidate,
          field,
          criticBlocked,
          mutationEnergyScore,
          formalizationScore,
          critiquePressureScore,
          centralityScore,
          productiveScore,
          vacuityPenaltyScore,
          instabilityPenaltyScore,
          combinedScore,
          signals,
          critiqueFindings,
        ),
        contributionSummary,
      } satisfies SynthesizedCandidateRecord;
    })
    .sort((left, right) => {
      const scoreDelta = right.combinedScore - left.combinedScore;
      if (Math.abs(scoreDelta) > 1e-6) {
        return scoreDelta;
      }
      const totalDelta = right.divergenceField.total - left.divergenceField.total;
      if (Math.abs(totalDelta) > 1e-6) {
        return totalDelta;
      }
      return right.formalizationStrength - left.formalizationStrength;
    });
}

export function candidateIdMap(records: SynthesizedCandidateRecord[]) {
  return new Map<CandidateProposalId, SynthesizedCandidateRecord>(
    records.map((record) => [record.candidate.candidateId, record]),
  );
}
