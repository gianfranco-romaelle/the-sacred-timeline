import type {
  FragmentId,
  LeanTranslationResult,
  ProposalOutcomeState,
  SemanticProposalId,
} from "@/types/hegel-triangle";
import type { JsonObject } from "@/types/primitives";
import type {
  CandidateProposalArtifact,
  DialecticMove,
  PromptSelectionSummary,
} from "@/features/hegel-triangle-transform/adjunctor/provider-types";
import {
  inferDialecticMoveSemeioticProfile,
  inferLeanRunSemeioticProfile,
  inferProposalSemeioticProfile,
} from "./inference";
import type {
  ComplexityMetrics,
  DialecticalMoment,
  DialecticalMomentId,
  DialecticalMomentRawSource,
  DialecticalRole,
  PeirceProfile,
  SemeioticMismatch,
  SubjectiveContact,
} from "./schema";
import { peirceProfileFromOntologyProfile, triadicEntropy } from "./schema";

function compactText(value: string | undefined, limit = 220) {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return undefined;
  }

  return normalized.length <= limit ? normalized : `${normalized.slice(0, Math.max(0, limit - 1))}…`;
}

function uniqueNonEmpty(values: Array<string | undefined>, limit = 8) {
  const output: string[] = [];
  for (const value of values) {
    const normalized = value?.replace(/\s+/g, " ").trim();
    if (!normalized || output.includes(normalized)) {
      continue;
    }
    output.push(normalized);
    if (output.length >= limit) {
      break;
    }
  }
  return output;
}

function splitTextUnits(text: string | undefined, limit = 6) {
  if (!text) {
    return [];
  }

  return uniqueNonEmpty(
    text
      .split(/[\n\r]+|(?<=[.!?;:])\s+/)
      .map((part) => part.trim())
      .filter(Boolean),
    limit,
  );
}

function clampUnit(value: number) {
  return Math.max(0, Math.min(1, Number(value.toFixed(6))));
}

function average(values: number[]) {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function normalizedEntropy(entropy: number) {
  return clampUnit(entropy / Math.log2(3));
}

function triadicWeights(
  distribution: PeirceProfile["object"] | PeirceProfile["signVehicle"] | PeirceProfile["interpretant"],
) {
  return {
    firstness: distribution.firstness.weight,
    secondness: distribution.secondness.weight,
    thirdness: distribution.thirdness.weight,
  };
}

function distributionGap(
  left: PeirceProfile["object"] | PeirceProfile["signVehicle"] | PeirceProfile["interpretant"],
  right: PeirceProfile["object"] | PeirceProfile["signVehicle"] | PeirceProfile["interpretant"],
) {
  const leftWeights = triadicWeights(left);
  const rightWeights = triadicWeights(right);
  return clampUnit(
    average([
      Math.abs(leftWeights.firstness - rightWeights.firstness),
      Math.abs(leftWeights.secondness - rightWeights.secondness),
      Math.abs(leftWeights.thirdness - rightWeights.thirdness),
    ]),
  );
}

function dominanceSoftness(
  distribution: PeirceProfile["object"] | PeirceProfile["signVehicle"] | PeirceProfile["interpretant"],
) {
  const weights = [distribution.firstness.weight, distribution.secondness.weight, distribution.thirdness.weight]
    .sort((left, right) => right - left);
  return clampUnit(1 - (weights[0] - weights[1]));
}

function sourceIdsForEvidence(rawSources: DialecticalMomentRawSource[], limit = 4) {
  return rawSources.map((source) => source.id).slice(0, limit);
}

function dialecticalMomentId(proposalId: SemanticProposalId, role: DialecticalRole, suffix: string) {
  return `dialectical_moment_${proposalId}_${role}_${suffix}` as DialecticalMomentId;
}

function roleFromOutcome(outcome: ProposalOutcomeState): DialecticalRole {
  return outcome === "blocked" || outcome === "rejected" ? "repair" : "synthesize";
}

function branchCount(rawSources: DialecticalMomentRawSource[]) {
  return Math.max(1, rawSources.filter((source) => source.kind === "provider_output").length);
}

function softWeightsForRole(
  role: DialecticalRole,
  claimCount: number,
  objectionCount: number,
  repairCount: number,
  hasAliasResolution: boolean,
) {
  const claimBias = Math.min(0.2, claimCount * 0.03);
  const objectionBias = Math.min(0.22, objectionCount * 0.04);
  const repairBias = Math.min(0.22, repairCount * 0.04);

  switch (role) {
    case "criticize":
      return {
        object: { firstness: 0.18, secondness: 0.62 + objectionBias, thirdness: 0.2 },
        signVehicle: { firstness: 0.16, secondness: 0.68 + objectionBias, thirdness: 0.16 },
        interpretant: { firstness: 0.14, secondness: 0.64 + objectionBias, thirdness: 0.22 },
      };
    case "repair":
      return {
        object: { firstness: 0.12, secondness: 0.26, thirdness: 0.62 + repairBias },
        signVehicle: { firstness: 0.1, secondness: 0.2, thirdness: 0.7 + repairBias },
        interpretant: { firstness: 0.08, secondness: 0.22, thirdness: 0.7 + repairBias },
      };
    case "synthesize":
      return {
        object: { firstness: 0.08, secondness: 0.22, thirdness: 0.7 + claimBias },
        signVehicle: { firstness: 0.08, secondness: 0.18, thirdness: 0.74 + claimBias },
        interpretant: {
          firstness: hasAliasResolution ? 0.12 : 0.06,
          secondness: 0.16,
          thirdness: 0.78 + claimBias,
        },
      };
    case "propose":
    default:
      return {
        object: { firstness: 0.52, secondness: 0.22, thirdness: 0.26 + claimBias },
        signVehicle: { firstness: 0.56, secondness: 0.2, thirdness: 0.24 },
        interpretant: { firstness: 0.58, secondness: 0.18, thirdness: 0.24 + claimBias },
      };
  }
}

function mismatchesForMoment(input: {
  proposalId: SemanticProposalId;
  role: DialecticalRole;
  peirceProfile: PeirceProfile;
  rawSources: DialecticalMomentRawSource[];
  explicitAliases?: string[];
  objectionCount: number;
  repairCount: number;
  complexity: ComplexityMetrics;
}): SemeioticMismatch[] {
  const mismatches: SemeioticMismatch[] = [];
  const aliasObserved = input.rawSources.some((source) => source.textExcerpt?.toLowerCase().includes("argument"));
  const sourceIds = sourceIdsForEvidence(input.rawSources);

  if (aliasObserved || input.explicitAliases?.includes("argument")) {
    mismatches.push({
      id: `semeiotic_mismatch_${input.proposalId}_${input.role}_alias`,
      kind: "alias_resolution",
      dimension: "interpretant",
      metricKey: "interpretantInstability",
      expectedValence: "thirdness",
      observedValence: "thirdness",
      expectedTerm: "delome",
      observedTerm: "argument",
      severity: 0.14,
      measuredValue: input.complexity.interpretantInstability,
      threshold: 0.18,
      confidence: input.peirceProfile.hardSummary.confidence,
      summary: 'Argument was normalized to the canonical "delome" interpretant label.',
      repairHint: 'Store "delome" canonically and retain "argument" only as an alias.',
      evidence: ['raw source used "argument"', 'canonical interpretant requires "delome"'],
      relatedSourceIds: sourceIds,
    });
  }

  if (
    input.role === "criticize" &&
    input.peirceProfile.interpretant.dominantValence === "thirdness" &&
    input.objectionCount > 0
  ) {
    mismatches.push({
      id: `semeiotic_mismatch_${input.proposalId}_${input.role}_contact_gap`,
      kind: "contact_gap",
      dimension: "interpretant",
      metricKey: "critiqueInducedReinterpretationDepth",
      expectedValence: "secondness",
      observedValence: input.peirceProfile.interpretant.dominantValence,
      expectedTerm: "dicent",
      observedTerm: input.peirceProfile.interpretant.dominantTerm,
      severity: 0.24,
      measuredValue: input.complexity.critiqueInducedReinterpretationDepth,
      threshold: 0.3,
      confidence: input.peirceProfile.hardSummary.confidence,
      summary: "Critical contact is strong, but the interpretant remains overly stabilized.",
      repairHint: "Preserve contradiction exposure before collapsing into symbolic synthesis.",
      evidence: ["critique role produced objections", "interpretant still resolves into thirdness"],
      relatedSourceIds: sourceIds,
    });
  }

  if (
    input.role === "repair" &&
    input.repairCount > 0 &&
    input.peirceProfile.object.dominantValence === "secondness"
  ) {
    mismatches.push({
      id: `semeiotic_mismatch_${input.proposalId}_${input.role}_valence`,
      kind: "valence_shift",
      dimension: "object",
      metricKey: "objectSignMismatch",
      expectedValence: "thirdness",
      observedValence: "secondness",
      expectedTerm: "symbol",
      observedTerm: "index",
      severity: 0.21,
      measuredValue: input.complexity.objectSignMismatch,
      threshold: 0.2,
      confidence: input.peirceProfile.hardSummary.confidence,
      summary: "Repair content is active, but the object relation still reads as index-heavy rather than symbolic.",
      repairHint: "Tighten mediation so the repair stabilizes into a reusable symbolic form.",
      evidence: ["repair content extracted", "object channel remains secondness-heavy"],
      relatedSourceIds: sourceIds,
    });
  }

  if (input.complexity.ontologyAlignmentStrength <= 0.68) {
    mismatches.push({
      id: `semeiotic_mismatch_${input.proposalId}_${input.role}_ontology_alignment`,
      kind: "ontology_alignment_gap",
      dimension: "triadic",
      metricKey: "ontologyAlignmentStrength",
      severity: clampUnit(1 - input.complexity.ontologyAlignmentStrength),
      measuredValue: input.complexity.ontologyAlignmentStrength,
      threshold: 0.68,
      confidence: input.peirceProfile.hardSummary.confidence,
      summary: "Object, sign vehicle, and interpretant do not align cleanly across the active triadic profile.",
      repairHint: "Retighten mediation so the three channels converge on a more coherent ontology.",
      evidence: [
        `alignment ${input.complexity.ontologyAlignmentStrength.toFixed(2)}`,
        `object/sign mismatch ${input.complexity.objectSignMismatch.toFixed(2)}`,
        `triadic imbalance ${input.complexity.triadicImbalance.toFixed(2)}`,
      ],
      relatedSourceIds: sourceIds,
    });
  }

  if (input.complexity.interpretantInstability >= 0.55) {
    mismatches.push({
      id: `semeiotic_mismatch_${input.proposalId}_${input.role}_interpretant_instability`,
      kind: "interpretant_instability",
      dimension: "interpretant",
      metricKey: "interpretantInstability",
      severity: input.complexity.interpretantInstability,
      measuredValue: input.complexity.interpretantInstability,
      threshold: 0.55,
      confidence: input.peirceProfile.hardSummary.confidence,
      summary: "The interpretant channel remains unstable across competing readings or unresolved alias pressure.",
      repairHint: "Narrow the interpretant by resolving aliasing or reducing over-ambiguous synthesis.",
      evidence: [
        `instability ${input.complexity.interpretantInstability.toFixed(2)}`,
        `internal ambiguity ${input.complexity.internalAmbiguity.toFixed(2)}`,
      ],
      relatedSourceIds: sourceIds,
    });
  }

  if (input.complexity.objectSignMismatch >= 0.34) {
    mismatches.push({
      id: `semeiotic_mismatch_${input.proposalId}_${input.role}_object_sign`,
      kind: "object_sign_mismatch",
      dimension: "signVehicle",
      metricKey: "objectSignMismatch",
      severity: input.complexity.objectSignMismatch,
      measuredValue: input.complexity.objectSignMismatch,
      threshold: 0.34,
      confidence: input.peirceProfile.hardSummary.confidence,
      summary: "Object and sign vehicle channels are pulling in different triadic directions.",
      repairHint: "Align the vehicle form more closely with the intended object relation.",
      evidence: [
        `mismatch ${input.complexity.objectSignMismatch.toFixed(2)}`,
        `${input.peirceProfile.object.dominantTerm} vs ${input.peirceProfile.signVehicle.dominantTerm}`,
      ],
      relatedSourceIds: sourceIds,
    });
  }

  if (input.complexity.triadicImbalance >= 0.42) {
    mismatches.push({
      id: `semeiotic_mismatch_${input.proposalId}_${input.role}_imbalance`,
      kind: "triadic_imbalance",
      dimension: "triadic",
      metricKey: "triadicImbalance",
      severity: input.complexity.triadicImbalance,
      measuredValue: input.complexity.triadicImbalance,
      threshold: 0.42,
      confidence: input.peirceProfile.hardSummary.confidence,
      summary: "One triadic valence is dominating too strongly across the moment.",
      repairHint: "Recover countervailing firstness or secondness before over-collapsing into a single register.",
      evidence: [
        `imbalance ${input.complexity.triadicImbalance.toFixed(2)}`,
        `triadic entropy ${input.complexity.triadicEntropy.toFixed(2)}`,
      ],
      relatedSourceIds: sourceIds,
    });
  }

  if (input.complexity.internalAmbiguity >= 0.58) {
    mismatches.push({
      id: `semeiotic_mismatch_${input.proposalId}_${input.role}_ambiguity`,
      kind: "internal_ambiguity",
      dimension: "triadic",
      metricKey: "internalAmbiguity",
      severity: input.complexity.internalAmbiguity,
      measuredValue: input.complexity.internalAmbiguity,
      threshold: 0.58,
      confidence: input.peirceProfile.hardSummary.confidence,
      summary: "The internal semeiotic distribution is too ambiguous to read as a stable moment.",
      repairHint: "Reduce branching interpretations or sharpen the dominant interpretive channel.",
      evidence: [
        `ambiguity ${input.complexity.internalAmbiguity.toFixed(2)}`,
        `confidence spread ${input.complexity.confidenceSpread.toFixed(2)}`,
      ],
      relatedSourceIds: sourceIds,
    });
  }

  if (input.complexity.signEventBranchingComplexity >= 0.56) {
    mismatches.push({
      id: `semeiotic_mismatch_${input.proposalId}_${input.role}_branching`,
      kind: "branching_complexity",
      dimension: "signVehicle",
      metricKey: "signEventBranchingComplexity",
      severity: input.complexity.signEventBranchingComplexity,
      measuredValue: input.complexity.signEventBranchingComplexity,
      threshold: 0.56,
      confidence: input.peirceProfile.hardSummary.confidence,
      summary: "Too many sign-event branches are active for the current moment to stabilize cleanly.",
      repairHint: "Prune or rank source branches before further synthesis.",
      evidence: [
        `branching ${input.complexity.signEventBranchingComplexity.toFixed(2)}`,
        `${input.rawSources.length} raw source branches`,
      ],
      relatedSourceIds: sourceIds,
    });
  }

  if (input.complexity.critiqueInducedReinterpretationDepth >= 0.52 && input.objectionCount > 0) {
    mismatches.push({
      id: `semeiotic_mismatch_${input.proposalId}_${input.role}_reinterpretation`,
      kind: "reinterpretation_depth",
      dimension: "interpretant",
      metricKey: "critiqueInducedReinterpretationDepth",
      severity: input.complexity.critiqueInducedReinterpretationDepth,
      measuredValue: input.complexity.critiqueInducedReinterpretationDepth,
      threshold: 0.52,
      confidence: input.peirceProfile.hardSummary.confidence,
      summary: "Critique has forced a deep reinterpretation that has not yet settled into a stable reading.",
      repairHint: "Stage an explicit repair or synthesis pass before promoting the interpretation.",
      evidence: [
        `${input.objectionCount} objections`,
        `${input.repairCount} repairs`,
        `reinterpretation depth ${input.complexity.critiqueInducedReinterpretationDepth.toFixed(2)}`,
      ],
      relatedSourceIds: sourceIds,
    });
  }

  return mismatches;
}

function subjectiveContactForMoment(input: {
  role: DialecticalRole;
  claimCount: number;
  objectionCount: number;
  repairCount: number;
  mismatchCount: number;
}): SubjectiveContact {
  const immediacyBase = input.role === "propose" ? 0.62 : input.role === "criticize" ? 0.18 : 0.12;
  const encounterBase = input.role === "criticize" ? 0.72 : input.role === "repair" ? 0.34 : 0.2;
  const mediationBase = input.role === "synthesize" || input.role === "repair" ? 0.74 : 0.28;
  const immediacy = clampUnit(immediacyBase + Math.min(0.12, input.claimCount * 0.02) - Math.min(0.12, input.mismatchCount * 0.03));
  const encounter = clampUnit(encounterBase + Math.min(0.12, input.objectionCount * 0.03));
  const mediation = clampUnit(mediationBase + Math.min(0.14, input.repairCount * 0.03) + Math.min(0.08, input.claimCount * 0.01));
  const dominantValence =
    mediation >= encounter && mediation >= immediacy
      ? "thirdness"
      : encounter >= immediacy
        ? "secondness"
        : "firstness";

  return {
    immediacy,
    encounter,
    mediation,
    dominantValence,
    confidence: clampUnit(0.62 + input.claimCount * 0.02 + input.repairCount * 0.03),
    summary:
      dominantValence === "thirdness"
        ? "Mediated interpretive uptake dominates this moment."
        : dominantValence === "secondness"
          ? "Encounter and contradiction dominate this moment."
          : "Immediate qualitative surfacing dominates this moment.",
    notes: uniqueNonEmpty([
      input.claimCount > 0 ? `${input.claimCount} extracted claims` : undefined,
      input.objectionCount > 0 ? `${input.objectionCount} extracted objections` : undefined,
      input.repairCount > 0 ? `${input.repairCount} extracted repairs` : undefined,
    ]),
  };
}

function complexityForMoment(input: {
  peirceProfile: PeirceProfile;
  role: DialecticalRole;
  claimCount: number;
  objectionCount: number;
  repairCount: number;
  mismatchCount: number;
  rawSources: DialecticalMomentRawSource[];
}): ComplexityMetrics {
  const counts = [input.claimCount, input.objectionCount, input.repairCount].filter((count) => count > 0);
  const spread = counts.length > 0 ? Math.max(...counts) - Math.min(...counts) : 0;
  const objectSignMismatch = distributionGap(input.peirceProfile.object, input.peirceProfile.signVehicle);
  const signInterpretantMismatch = distributionGap(input.peirceProfile.signVehicle, input.peirceProfile.interpretant);
  const objectInterpretantMismatch = distributionGap(input.peirceProfile.object, input.peirceProfile.interpretant);
  const ontologyAlignmentStrength = clampUnit(
    1 - average([objectSignMismatch, signInterpretantMismatch, objectInterpretantMismatch]),
  );
  const interpretantInstability = clampUnit(
    normalizedEntropy(input.peirceProfile.interpretant.entropy) * 0.46 +
      dominanceSoftness(input.peirceProfile.interpretant) * 0.22 +
      clampUnit(input.objectionCount / 4) * 0.18 +
      clampUnit(
        input.rawSources.some((source) => source.textExcerpt?.toLowerCase().includes("argument")) ? 1 : 0,
      ) * 0.14,
  );
  const averagedWeights = {
    firstness: average([
      input.peirceProfile.object.firstness.weight,
      input.peirceProfile.signVehicle.firstness.weight,
      input.peirceProfile.interpretant.firstness.weight,
    ]),
    secondness: average([
      input.peirceProfile.object.secondness.weight,
      input.peirceProfile.signVehicle.secondness.weight,
      input.peirceProfile.interpretant.secondness.weight,
    ]),
    thirdness: average([
      input.peirceProfile.object.thirdness.weight,
      input.peirceProfile.signVehicle.thirdness.weight,
      input.peirceProfile.interpretant.thirdness.weight,
    ]),
  };
  const triadicImbalance = clampUnit(
    Math.max(averagedWeights.firstness, averagedWeights.secondness, averagedWeights.thirdness) -
      Math.min(averagedWeights.firstness, averagedWeights.secondness, averagedWeights.thirdness),
  );
  const internalAmbiguity = clampUnit(
    average([
      normalizedEntropy(input.peirceProfile.object.entropy),
      normalizedEntropy(input.peirceProfile.signVehicle.entropy),
      normalizedEntropy(input.peirceProfile.interpretant.entropy),
      dominanceSoftness(input.peirceProfile.object),
      dominanceSoftness(input.peirceProfile.signVehicle),
      dominanceSoftness(input.peirceProfile.interpretant),
    ]),
  );
  const providerBranches = input.rawSources.filter((source) => source.kind === "provider_output").length;
  const sourceKindDiversity = new Set(input.rawSources.map((source) => source.kind)).size;
  const signEventBranchingComplexity = clampUnit(
    clampUnit((branchCount(input.rawSources) - 1) / 4) * 0.42 +
      clampUnit(providerBranches / 4) * 0.24 +
      clampUnit(sourceKindDiversity / 6) * 0.16 +
      clampUnit((input.objectionCount + input.repairCount) / 6) * 0.18,
  );
  const critiqueInducedReinterpretationDepth = clampUnit(
    clampUnit(input.objectionCount / 4) * 0.42 +
      clampUnit(input.repairCount / 4) * 0.28 +
      signInterpretantMismatch * 0.18 +
      clampUnit(input.role === "criticize" || input.role === "repair" ? 1 : 0) * 0.12,
  );
  const overallComplexity = clampUnit(
    average([
      1 - ontologyAlignmentStrength,
      interpretantInstability,
      objectSignMismatch,
      triadicImbalance,
      internalAmbiguity,
      signEventBranchingComplexity,
      critiqueInducedReinterpretationDepth,
      clampUnit((input.claimCount + input.objectionCount + input.repairCount) / 10),
    ]),
  );

  return {
    claimCount: input.claimCount,
    objectionCount: input.objectionCount,
    repairCount: input.repairCount,
    branchCount: branchCount(input.rawSources),
    mismatchCount: input.mismatchCount,
    triadicEntropy: triadicEntropy(input.peirceProfile),
    annotationDensity: clampUnit(
      (input.claimCount + input.objectionCount + input.repairCount + input.rawSources.length) / 12,
    ),
    confidenceSpread: clampUnit(spread / 6),
    ontologyAlignmentStrength,
    interpretantInstability,
    objectSignMismatch,
    triadicImbalance,
    internalAmbiguity,
    signEventBranchingComplexity,
    critiqueInducedReinterpretationDepth,
    overallComplexity,
  };
}

function cleanRawSources(sources: DialecticalMomentRawSource[]) {
  return sources
    .map((source) => ({
      ...source,
      textExcerpt: compactText(source.textExcerpt),
    }))
    .filter((source) => Boolean(source.pointer || source.artifactPath || source.textExcerpt));
}

function buildMoment(input: {
  id: DialecticalMomentId;
  role: DialecticalRole;
  tick: number;
  provider?: string;
  fragmentId?: FragmentId;
  proposalId?: SemanticProposalId;
  dialecticMoveId?: string;
  source: DialecticalMoment["source"];
  summary: string;
  claims: string[];
  objections: string[];
  repairs: string[];
  rawSources: DialecticalMomentRawSource[];
  profile: ReturnType<typeof inferProposalSemeioticProfile>;
  linkedMomentIds?: DialecticalMomentId[];
}): DialecticalMoment {
  const sanitizedRawSources = cleanRawSources(input.rawSources);
  const roleWeights = softWeightsForRole(
    input.role,
    input.claims.length,
    input.objections.length,
    input.repairs.length,
    sanitizedRawSources.some((source) => source.textExcerpt?.toLowerCase().includes("argument")),
  );
  const peirceProfile = peirceProfileFromOntologyProfile(input.profile, roleWeights);
  const provisionalComplexity = complexityForMoment({
    peirceProfile,
    role: input.role,
    claimCount: input.claims.length,
    objectionCount: input.objections.length,
    repairCount: input.repairs.length,
    mismatchCount: 0,
    rawSources: sanitizedRawSources,
  });
  const mismatches = mismatchesForMoment({
    proposalId: input.proposalId ?? ("semantic_proposal_unknown" as SemanticProposalId),
    role: input.role,
    peirceProfile,
    rawSources: sanitizedRawSources,
    explicitAliases: peirceProfile.normalizedInterpretantAliases,
    objectionCount: input.objections.length,
    repairCount: input.repairs.length,
    complexity: provisionalComplexity,
  });
  const subjectiveContact = subjectiveContactForMoment({
    role: input.role,
    claimCount: input.claims.length,
    objectionCount: input.objections.length,
    repairCount: input.repairs.length,
    mismatchCount: mismatches.length,
  });
  const complexity = complexityForMoment({
    peirceProfile,
    role: input.role,
    claimCount: input.claims.length,
    objectionCount: input.objections.length,
    repairCount: input.repairs.length,
    mismatchCount: mismatches.length,
    rawSources: sanitizedRawSources,
  });

  return {
    id: input.id,
    role: input.role,
    tick: input.tick,
    provider: input.provider,
    fragmentId: input.fragmentId,
    proposalId: input.proposalId,
    dialecticMoveId: input.dialecticMoveId,
    source: input.source,
    summary: compactText(input.summary, 240) ?? input.summary,
    peirceProfile,
    subjectiveContact,
    mismatches,
    complexity,
    rawSources: sanitizedRawSources,
    linkedMomentIds: input.linkedMomentIds ?? [],
    notes: uniqueNonEmpty([
      input.claims.length > 0 ? `${input.claims.length} extracted claims` : undefined,
      input.objections.length > 0 ? `${input.objections.length} extracted objections` : undefined,
      input.repairs.length > 0 ? `${input.repairs.length} extracted repairs` : undefined,
    ]),
  };
}

function rawSource(kind: DialecticalMomentRawSource["kind"], label: string, options?: Partial<DialecticalMomentRawSource>): DialecticalMomentRawSource {
  return {
    id: options?.id ?? `${kind}:${label}`.replace(/\s+/g, "_").toLowerCase(),
    kind,
    label,
    provider: options?.provider,
    pointer: options?.pointer,
    artifactPath: options?.artifactPath,
    textExcerpt: options?.textExcerpt,
  };
}

export function buildDialecticalMomentFromMove(input: {
  move: DialecticMove;
  tick: number;
  fragmentId?: FragmentId;
  proposalId?: SemanticProposalId;
  linkedMomentIds?: DialecticalMomentId[];
}): DialecticalMoment {
  const profile = input.move.semeiotic ?? inferDialecticMoveSemeioticProfile(input.move);

  return buildMoment({
    id: dialecticalMomentId(input.proposalId ?? ("semantic_proposal_unknown" as SemanticProposalId), input.move.role, input.move.id),
    role: input.move.role,
    tick: input.tick,
    provider: input.move.provider,
    fragmentId: input.fragmentId,
    proposalId: input.proposalId,
    dialecticMoveId: input.move.id,
    source: "dialectic_move",
    summary: input.move.summary,
    claims: [...input.move.extractedClaims],
    objections: [...input.move.extractedObjections],
    repairs: [...input.move.extractedRepairs],
    profile,
    linkedMomentIds: input.linkedMomentIds,
    rawSources: [
      rawSource("dialectic_move", "move summary", {
        provider: input.move.provider,
        pointer: `dialecticMove:${input.move.id}`,
        textExcerpt: input.move.summary,
      }),
    ],
  });
}

function proposalProfileFromCandidate(
  candidate: CandidateProposalArtifact,
  outcome: ProposalOutcomeState,
) {
  return inferProposalSemeioticProfile({
    proposalKind: candidate.proposalKind,
    verificationState: outcome,
    corpusSupportCount: candidate.corpusSupport.length,
  });
}

function leanProfileForProposal(outcome: ProposalOutcomeState, theoremKind: string) {
  return inferLeanRunSemeioticProfile({
    outcome,
    theoremKind,
    status: outcome,
  });
}

export function buildProposalDialecticalMoments(input: {
  tick: number;
  fragmentId: FragmentId;
  proposalId: SemanticProposalId;
  candidate: CandidateProposalArtifact;
  proposalSummary: string;
  theoremSummary: string;
  verificationState: ProposalOutcomeState;
  dialecticMoves: DialecticMove[];
  promptSelections?: {
    mutation?: PromptSelectionSummary;
    formalization?: PromptSelectionSummary;
    critique?: PromptSelectionSummary;
    lean?: PromptSelectionSummary;
  };
  leanTranslation?: LeanTranslationResult;
}): DialecticalMoment[] {
  const proposalMomentId = dialecticalMomentId(input.proposalId, "propose", "proposal");
  const proposalMoment = buildMoment({
    id: proposalMomentId,
    role: "propose",
    tick: input.tick,
    provider: input.candidate.provenance[0]?.providerId,
    fragmentId: input.fragmentId,
    proposalId: input.proposalId,
    source: "proposal",
    summary: input.proposalSummary,
    claims: uniqueNonEmpty([
      input.candidate.title,
      ...splitTextUnits(input.theoremSummary, 2),
      ...splitTextUnits(input.proposalSummary, 2),
    ]),
    objections: [],
    repairs: [],
    profile: proposalProfileFromCandidate(input.candidate, input.verificationState),
    rawSources: [
      rawSource("proposal_summary", "proposal summary", {
        provider: input.candidate.provenance[0]?.providerId,
        pointer: `proposal:${input.proposalId}`,
        textExcerpt: input.proposalSummary,
      }),
      rawSource("provider_output", "candidate theorem/definition", {
        provider: input.candidate.provenance[0]?.providerId,
        textExcerpt: input.candidate.theoremOrDefinition,
      }),
      rawSource("prompt_template", "mutation prompt", {
        provider: input.candidate.provenance[0]?.providerId,
        pointer: input.promptSelections?.mutation?.bestPromptId,
        textExcerpt: input.promptSelections?.mutation?.bestPrompt,
      }),
    ],
  });

  const moveMoments = input.dialecticMoves.map((move, index) =>
    buildDialecticalMomentFromMove({
      move,
      tick: input.tick,
      fragmentId: input.fragmentId,
      proposalId: input.proposalId,
      linkedMomentIds: index === 0 ? [proposalMomentId] : undefined,
    }),
  );

  const auxiliaryMoments: DialecticalMoment[] = [];

  if (input.leanTranslation) {
    auxiliaryMoments.push(
      buildMoment({
        id: dialecticalMomentId(input.proposalId, roleFromOutcome(input.verificationState), "lean"),
        role: roleFromOutcome(input.verificationState),
        tick: input.tick,
        provider: "lean-verifier",
        fragmentId: input.fragmentId,
        proposalId: input.proposalId,
        source: "lean_run",
        summary: `${input.leanTranslation.moduleName}.${input.leanTranslation.declarationName}`,
        claims: splitTextUnits(input.leanTranslation.exportSummary, 3),
        objections: input.verificationState === "blocked" || input.verificationState === "rejected"
          ? ["Lean-linked boundary requires repair or admissibility narrowing."]
          : [],
        repairs: splitTextUnits(input.leanTranslation.sourceText, 2),
        profile: leanProfileForProposal(input.verificationState, input.candidate.proposalKind),
        linkedMomentIds: [proposalMomentId],
        rawSources: [
          rawSource("lean_description", "Lean export summary", {
            provider: "lean-verifier",
            pointer: `lean:${input.leanTranslation.moduleName}.${input.leanTranslation.declarationName}`,
            textExcerpt: input.leanTranslation.exportSummary,
          }),
          rawSource("lean_description", "Lean source text", {
            provider: "lean-verifier",
            textExcerpt: input.leanTranslation.sourceText,
          }),
          rawSource("prompt_template", "lean prompt", {
            provider: "lean-verifier",
            pointer: input.promptSelections?.lean?.bestPromptId,
            textExcerpt: input.promptSelections?.lean?.bestPrompt,
          }),
        ],
      }),
    );
  }

  return [proposalMoment, ...moveMoments, ...auxiliaryMoments].map((moment, index, moments) => ({
    ...moment,
    linkedMomentIds:
      moment.linkedMomentIds.length > 0
        ? moment.linkedMomentIds
        : index > 0
          ? [moments[index - 1].id]
          : [],
  }));
}

export function attachDialecticalMomentsToMoves(
  moves: DialecticMove[],
  moments: DialecticalMoment[],
  options?: {
    includeMomentPayload?: boolean;
  },
): DialecticMove[] {
  const includeMomentPayload = options?.includeMomentPayload ?? true;
  const momentsByMoveId = new Map(
    moments
      .filter((moment) => Boolean(moment.dialecticMoveId))
      .map((moment) => [moment.dialecticMoveId!, moment] as const),
  );

  return moves.map((move) => {
    const linkedMoment = momentsByMoveId.get(move.id);
    if (!linkedMoment) {
      return move;
    }

    return {
      ...move,
      linkedDialecticalMomentId: linkedMoment.id,
      ...(includeMomentPayload ? { linkedDialecticalMoment: linkedMoment } : {}),
    };
  });
}

export function serializeDialecticalMoment(moment: DialecticalMoment): JsonObject {
  return {
    id: moment.id,
    role: moment.role,
    tick: moment.tick,
    ...(moment.provider ? { provider: moment.provider } : {}),
    ...(moment.fragmentId ? { fragmentId: moment.fragmentId } : {}),
    ...(moment.proposalId ? { proposalId: moment.proposalId } : {}),
    ...(moment.dialecticMoveId ? { dialecticMoveId: moment.dialecticMoveId } : {}),
    source: moment.source,
    summary: moment.summary,
    peirceProfile: {
      object: { ...moment.peirceProfile.object },
      signVehicle: { ...moment.peirceProfile.signVehicle },
      interpretant: { ...moment.peirceProfile.interpretant },
      hardSummary: {
        object: { ...moment.peirceProfile.hardSummary.object },
        signVehicle: { ...moment.peirceProfile.hardSummary.signVehicle },
        interpretant: { ...moment.peirceProfile.hardSummary.interpretant },
        source: moment.peirceProfile.hardSummary.source,
        confidence: moment.peirceProfile.hardSummary.confidence,
        notes: [...moment.peirceProfile.hardSummary.notes],
      },
      acceptedInterpretantAliases: [...moment.peirceProfile.acceptedInterpretantAliases],
      normalizedInterpretantAliases: [...moment.peirceProfile.normalizedInterpretantAliases],
    },
    ...(moment.subjectiveContact
      ? {
          subjectiveContact: {
            ...moment.subjectiveContact,
            notes: [...moment.subjectiveContact.notes],
          },
        }
      : {}),
    mismatches: moment.mismatches.map((mismatch) => ({ ...mismatch })),
    complexity: { ...moment.complexity },
    rawSources: moment.rawSources.map((source) => ({ ...source })),
    linkedMomentIds: [...moment.linkedMomentIds],
    notes: [...moment.notes],
  } as unknown as JsonObject;
}

export function dialecticalMomentSummary(moment: DialecticalMoment) {
  return `${moment.role}: ${moment.peirceProfile.hardSummary.object.term} / ${moment.peirceProfile.hardSummary.signVehicle.term} / ${moment.peirceProfile.hardSummary.interpretant.term}`;
}

export function proposalSemeioticSummary(moments: DialecticalMoment[]) {
  const hard = moments.map((moment) => moment.peirceProfile.hardSummary);
  if (hard.length === 0) {
    return undefined;
  }

  return {
    object: hard[hard.length - 1].object.term,
    signVehicle: hard[hard.length - 1].signVehicle.term,
    interpretant: hard[hard.length - 1].interpretant.term,
    confidence: Number(average(hard.map((entry) => entry.confidence)).toFixed(3)),
    momentCount: moments.length,
    mismatchCount: moments.reduce((sum, moment) => sum + moment.mismatches.length, 0),
    summaries: uniqueNonEmpty(moments.map((moment) => dialecticalMomentSummary(moment)), 6),
  };
}
