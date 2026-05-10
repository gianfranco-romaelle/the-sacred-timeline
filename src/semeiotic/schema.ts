import type {
  FragmentId,
  SemanticProposalId,
  SemeioticInterpretantAlias,
  SemeioticInterpretantTerm,
  SemeioticObjectTerm,
  SemeioticOntologyProfile,
  SemeioticSignVehicleTerm,
  SemeioticSourceKind,
  SemeioticValence,
} from "@/types/hegel-triangle";
import {
  interpretantAliasesForCanonicalTerm,
  SEMEIOTIC_INTERPRETANT_TERMS_BY_VALENCE,
  SEMEIOTIC_OBJECT_TERMS_BY_VALENCE,
  SEMEIOTIC_SIGN_TERMS_BY_VALENCE,
} from "./canonical";

export type DialecticalRole = "propose" | "criticize" | "repair" | "synthesize";
export type DialecticalMomentId = `dialectical_moment_${string}`;
export type SemeioticDimension = "object" | "signVehicle" | "interpretant" | "triadic";
export type DialecticalMomentRawSourceKind =
  | "provider_output"
  | "prompt_template"
  | "proposal_summary"
  | "dialectic_move"
  | "lean_description"
  | "artifact_pointer";
export type SemeioticMismatchKind =
  | "valence_shift"
  | "distribution_skew"
  | "alias_resolution"
  | "confidence_gap"
  | "contact_gap"
  | "ontology_alignment_gap"
  | "interpretant_instability"
  | "object_sign_mismatch"
  | "triadic_imbalance"
  | "internal_ambiguity"
  | "branching_complexity"
  | "reinterpretation_depth";
export type SemeioticMetricKey =
  | "ontologyAlignmentStrength"
  | "interpretantInstability"
  | "objectSignMismatch"
  | "triadicImbalance"
  | "internalAmbiguity"
  | "signEventBranchingComplexity"
  | "critiqueInducedReinterpretationDepth";
export type DialecticalMomentSource =
  | "proposal"
  | "dialectic_move"
  | "fragment"
  | "lean_run"
  | "persistent_node"
  | "derived";

export interface HardSemeioticSummary {
  object: SemeioticOntologyProfile["object"];
  signVehicle: SemeioticOntologyProfile["signVehicle"];
  interpretant: SemeioticOntologyProfile["interpretant"];
  source: SemeioticSourceKind;
  confidence: number;
  notes: string[];
}

export interface SoftTriadicAtom<TTerm extends string> {
  valence: SemeioticValence;
  term: TTerm;
  weight: number;
}

export interface SoftTriadicDistribution<TTerm extends string> {
  firstness: SoftTriadicAtom<TTerm>;
  secondness: SoftTriadicAtom<TTerm>;
  thirdness: SoftTriadicAtom<TTerm>;
  dominantValence: SemeioticValence;
  dominantTerm: TTerm;
  entropy: number;
}

export interface SubjectiveContact {
  immediacy: number;
  encounter: number;
  mediation: number;
  dominantValence: SemeioticValence;
  confidence: number;
  summary: string;
  notes: string[];
}

export interface SemeioticMismatch {
  id: `semeiotic_mismatch_${string}`;
  kind: SemeioticMismatchKind;
  dimension: SemeioticDimension;
  metricKey?: SemeioticMetricKey;
  expectedValence?: SemeioticValence;
  observedValence?: SemeioticValence;
  expectedTerm?: string;
  observedTerm?: string;
  severity: number;
  measuredValue?: number;
  threshold?: number;
  confidence?: number;
  summary: string;
  repairHint?: string;
  evidence: string[];
  relatedSourceIds: string[];
}

export interface ComplexityMetrics {
  claimCount: number;
  objectionCount: number;
  repairCount: number;
  branchCount: number;
  mismatchCount: number;
  triadicEntropy: number;
  annotationDensity: number;
  confidenceSpread: number;
  ontologyAlignmentStrength: number;
  interpretantInstability: number;
  objectSignMismatch: number;
  triadicImbalance: number;
  internalAmbiguity: number;
  signEventBranchingComplexity: number;
  critiqueInducedReinterpretationDepth: number;
  overallComplexity: number;
}

export interface DialecticalMomentRawSource {
  id: string;
  kind: DialecticalMomentRawSourceKind;
  label: string;
  provider?: string;
  pointer?: string;
  artifactPath?: string;
  textExcerpt?: string;
}

export interface PeirceProfile {
  object: SoftTriadicDistribution<SemeioticObjectTerm>;
  signVehicle: SoftTriadicDistribution<SemeioticSignVehicleTerm>;
  interpretant: SoftTriadicDistribution<SemeioticInterpretantTerm>;
  hardSummary: HardSemeioticSummary;
  acceptedInterpretantAliases: SemeioticInterpretantAlias[];
  normalizedInterpretantAliases: string[];
}

export interface DialecticalMoment {
  id: DialecticalMomentId;
  role: DialecticalRole;
  tick: number;
  provider?: string;
  fragmentId?: FragmentId;
  proposalId?: SemanticProposalId;
  dialecticMoveId?: string;
  source: DialecticalMomentSource;
  summary: string;
  peirceProfile: PeirceProfile;
  subjectiveContact?: SubjectiveContact;
  mismatches: SemeioticMismatch[];
  complexity: ComplexityMetrics;
  rawSources: DialecticalMomentRawSource[];
  linkedMomentIds: DialecticalMomentId[];
  notes: string[];
}

function clampUnit(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, Number(value.toFixed(6))));
}

function safeEntropy(weights: number[]) {
  return Number(
    weights
      .filter((weight) => weight > 0)
      .reduce((sum, weight) => sum - weight * Math.log2(weight), 0)
      .toFixed(6),
  );
}

function dominantValenceFromWeights(weights: Record<SemeioticValence, number>): SemeioticValence {
  if (weights.thirdness >= weights.secondness && weights.thirdness >= weights.firstness) {
    return "thirdness";
  }
  if (weights.secondness >= weights.firstness) {
    return "secondness";
  }
  return "firstness";
}

export function createSoftTriadicDistribution<TTerm extends string>(
  terms: Record<SemeioticValence, TTerm>,
  weights?: Partial<Record<SemeioticValence, number>>,
): SoftTriadicDistribution<TTerm> {
  const raw = {
    firstness: clampUnit(weights?.firstness ?? 0),
    secondness: clampUnit(weights?.secondness ?? 0),
    thirdness: clampUnit(weights?.thirdness ?? 0),
  } satisfies Record<SemeioticValence, number>;
  const total = raw.firstness + raw.secondness + raw.thirdness;
  const normalized =
    total > 0
      ? {
          firstness: raw.firstness / total,
          secondness: raw.secondness / total,
          thirdness: raw.thirdness / total,
        }
      : {
          firstness: 1 / 3,
          secondness: 1 / 3,
          thirdness: 1 / 3,
        };

  const dominantValence = dominantValenceFromWeights(normalized);
  return {
    firstness: {
      valence: "firstness",
      term: terms.firstness,
      weight: Number(normalized.firstness.toFixed(6)),
    },
    secondness: {
      valence: "secondness",
      term: terms.secondness,
      weight: Number(normalized.secondness.toFixed(6)),
    },
    thirdness: {
      valence: "thirdness",
      term: terms.thirdness,
      weight: Number(normalized.thirdness.toFixed(6)),
    },
    dominantValence,
    dominantTerm: terms[dominantValence],
    entropy: safeEntropy([normalized.firstness, normalized.secondness, normalized.thirdness]),
  };
}

export function hardSummaryFromOntologyProfile(profile: SemeioticOntologyProfile): HardSemeioticSummary {
  return {
    object: { ...profile.object },
    signVehicle: { ...profile.signVehicle },
    interpretant: {
      valence: profile.interpretant.valence,
      term: profile.interpretant.term,
      ...(profile.interpretant.aliases?.length ? { aliases: [...profile.interpretant.aliases] } : {}),
    },
    source: profile.source,
    confidence: profile.confidence,
    notes: [...profile.notes],
  };
}

export function peirceProfileFromOntologyProfile(
  profile: SemeioticOntologyProfile,
  softWeights?: {
    object?: Partial<Record<SemeioticValence, number>>;
    signVehicle?: Partial<Record<SemeioticValence, number>>;
    interpretant?: Partial<Record<SemeioticValence, number>>;
  },
): PeirceProfile {
  const object = createSoftTriadicDistribution(SEMEIOTIC_OBJECT_TERMS_BY_VALENCE, {
    firstness: profile.object.valence === "firstness" ? 0.7 : 0.15,
    secondness: profile.object.valence === "secondness" ? 0.7 : 0.15,
    thirdness: profile.object.valence === "thirdness" ? 0.7 : 0.15,
    ...softWeights?.object,
  });
  const signVehicle = createSoftTriadicDistribution(SEMEIOTIC_SIGN_TERMS_BY_VALENCE, {
    firstness: profile.signVehicle.valence === "firstness" ? 0.7 : 0.15,
    secondness: profile.signVehicle.valence === "secondness" ? 0.7 : 0.15,
    thirdness: profile.signVehicle.valence === "thirdness" ? 0.7 : 0.15,
    ...softWeights?.signVehicle,
  });
  const interpretant = createSoftTriadicDistribution(SEMEIOTIC_INTERPRETANT_TERMS_BY_VALENCE, {
    firstness: profile.interpretant.valence === "firstness" ? 0.7 : 0.15,
    secondness: profile.interpretant.valence === "secondness" ? 0.7 : 0.15,
    thirdness: profile.interpretant.valence === "thirdness" ? 0.7 : 0.15,
    ...softWeights?.interpretant,
  });

  return {
    object,
    signVehicle,
    interpretant,
    hardSummary: hardSummaryFromOntologyProfile(profile),
    acceptedInterpretantAliases: [...interpretantAliasesForCanonicalTerm(profile.interpretant.term)],
    normalizedInterpretantAliases: profile.interpretant.aliases ? [...profile.interpretant.aliases] : [],
  };
}

export function triadicEntropy(profile: PeirceProfile) {
  return Number(
    (
      (profile.object.entropy + profile.signVehicle.entropy + profile.interpretant.entropy) /
      3
    ).toFixed(6),
  );
}

export const EXAMPLE_DIALECTICAL_MOMENT: DialecticalMoment = {
  id: "dialectical_moment_example",
  role: "synthesize",
  tick: 14,
  provider: "chatgpt",
  fragmentId: "fragment_example",
  proposalId: "semantic_proposal_example",
  dialecticMoveId: "move_example",
  source: "dialectic_move",
  summary: "A synthesis move stabilizes a symbolic relation after objection and repair.",
  peirceProfile: {
    object: createSoftTriadicDistribution(SEMEIOTIC_OBJECT_TERMS_BY_VALENCE, {
      firstness: 0.08,
      secondness: 0.22,
      thirdness: 0.7,
    }),
    signVehicle: createSoftTriadicDistribution(SEMEIOTIC_SIGN_TERMS_BY_VALENCE, {
      firstness: 0.05,
      secondness: 0.15,
      thirdness: 0.8,
    }),
    interpretant: createSoftTriadicDistribution(SEMEIOTIC_INTERPRETANT_TERMS_BY_VALENCE, {
      firstness: 0.04,
      secondness: 0.18,
      thirdness: 0.78,
    }),
    hardSummary: {
      object: {
        valence: "thirdness",
        term: "symbol",
      },
      signVehicle: {
        valence: "thirdness",
        term: "legisign",
      },
      interpretant: {
        valence: "thirdness",
        term: "delome",
        aliases: ["argument"],
      },
      source: "derived",
      confidence: 0.84,
      notes: ["symbolic stabilization", "argument normalized to delome"],
    },
    acceptedInterpretantAliases: ["argument"],
    normalizedInterpretantAliases: ["argument"],
  },
  subjectiveContact: {
    immediacy: 0.12,
    encounter: 0.23,
    mediation: 0.81,
    dominantValence: "thirdness",
    confidence: 0.79,
    summary: "The moment is primarily mediated and rule-forming.",
    notes: ["repair integrated", "stable interpretive uptake"],
  },
  mismatches: [
    {
      id: "semeiotic_mismatch_example",
      kind: "alias_resolution",
      dimension: "interpretant",
      metricKey: "interpretantInstability",
      expectedValence: "thirdness",
      observedValence: "thirdness",
      expectedTerm: "delome",
      observedTerm: "argument",
      severity: 0.14,
      measuredValue: 0.22,
      threshold: 0.18,
      confidence: 0.84,
      summary: "Argument was normalized to the canonical delome term.",
      repairHint: "Store delome canonically and keep argument only as an alias.",
      evidence: ['raw source used "argument"', "canonical normalization applied"],
      relatedSourceIds: ["dialectic_move:move summary"],
    },
  ],
  complexity: {
    claimCount: 3,
    objectionCount: 1,
    repairCount: 1,
    branchCount: 2,
    mismatchCount: 1,
    triadicEntropy: triadicEntropy(
      peirceProfileFromOntologyProfile({
        object: { valence: "thirdness", term: "symbol" },
        signVehicle: { valence: "thirdness", term: "legisign" },
        interpretant: { valence: "thirdness", term: "delome", aliases: ["argument"] },
        source: "derived",
        confidence: 0.84,
        notes: ["example profile"],
      }),
    ),
    annotationDensity: 0.83,
    confidenceSpread: 0.12,
    ontologyAlignmentStrength: 0.82,
    interpretantInstability: 0.22,
    objectSignMismatch: 0.11,
    triadicImbalance: 0.18,
    internalAmbiguity: 0.19,
    signEventBranchingComplexity: 0.33,
    critiqueInducedReinterpretationDepth: 0.28,
    overallComplexity: 0.34,
  },
  rawSources: [
    {
      id: "example-summary",
      kind: "proposal_summary",
      label: "summary excerpt",
      provider: "chatgpt",
      pointer: "payload.orchestration.dialecticSummary",
      textExcerpt: "A synthesis move stabilizes a symbolic relation after objection and repair.",
    },
  ],
  linkedMomentIds: [],
  notes: ["example only", "links existing fragment/proposal/dialectic move ids by reference"],
};
