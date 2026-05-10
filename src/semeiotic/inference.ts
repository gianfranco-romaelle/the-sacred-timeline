import type {
  FragmentPhase,
  PersistentStubKind,
  ProposalKind,
  ProposalOutcomeState,
  SemeioticOntologyProfile,
  SemeioticValence,
  SemanticProposal,
} from "@/types/hegel-triangle";
import type { DialecticMove } from "@/features/hegel-triangle-transform/adjunctor/provider-types";
import {
  interpretantAliasesForCanonicalTerm,
  normalizeSemeioticInterpretantTerm,
  SEMEIOTIC_INTERPRETANT_TERMS_BY_VALENCE,
  SEMEIOTIC_OBJECT_TERMS_BY_VALENCE,
  SEMEIOTIC_SIGN_TERMS_BY_VALENCE,
} from "./canonical";

function clampConfidence(value: number) {
  return Math.max(0, Math.min(1, Number(value.toFixed(3))));
}

function valenceProfile(
  objectValence: SemeioticValence,
  signVehicleValence: SemeioticValence,
  interpretantValence: SemeioticValence,
  confidence: number,
  notes: string[],
  source: SemeioticOntologyProfile["source"] = "derived",
): SemeioticOntologyProfile {
  const interpretantTerm = SEMEIOTIC_INTERPRETANT_TERMS_BY_VALENCE[interpretantValence];
  return {
    object: {
      valence: objectValence,
      term: SEMEIOTIC_OBJECT_TERMS_BY_VALENCE[objectValence],
    },
    signVehicle: {
      valence: signVehicleValence,
      term: SEMEIOTIC_SIGN_TERMS_BY_VALENCE[signVehicleValence],
    },
    interpretant: {
      valence: interpretantValence,
      term: interpretantTerm,
      aliases: [...interpretantAliasesForCanonicalTerm(interpretantTerm)],
    },
    source,
    confidence: clampConfidence(confidence),
    notes,
  };
}

function proposalObjectValence(proposalKind: ProposalKind): SemeioticValence {
  switch (proposalKind) {
    case "obstruction_claim":
    case "refine_edge":
    case "refine_vertex":
    case "split_fragment":
    case "merge_fragments":
    case "promote_fragment":
    case "relabel_fragment":
      return "secondness";
    case "candidate_definition":
    case "introduce_definition":
    case "candidate_theorem":
    case "state_theorem":
    case "bridge_lemma":
    case "projection_rule":
    case "compatibility_claim":
    case "refinement_law":
    default:
      return "thirdness";
  }
}

function proposalSignVehicleValence(outcome: ProposalOutcomeState): SemeioticValence {
  switch (outcome) {
    case "accepted":
      return "thirdness";
    case "blocked":
    case "rejected":
      return "secondness";
    case "pending":
    case "promising":
    case "vacuous":
    default:
      return "firstness";
  }
}

function proposalInterpretantValence(
  outcome: ProposalOutcomeState,
  phase?: FragmentPhase | string,
): SemeioticValence {
  if (outcome === "accepted" || outcome === "promising" || phase === "stabilized") {
    return "thirdness";
  }
  if (outcome === "blocked" || outcome === "rejected" || phase === "externalized") {
    return "secondness";
  }
  return "firstness";
}

export function inferProposalSemeioticProfile(input: {
  proposalKind: ProposalKind;
  verificationState: ProposalOutcomeState;
  phase?: FragmentPhase | string;
  corpusSupportCount?: number;
}): SemeioticOntologyProfile {
  const objectValence = proposalObjectValence(input.proposalKind);
  const signVehicleValence = proposalSignVehicleValence(input.verificationState);
  const interpretantValence = proposalInterpretantValence(input.verificationState, input.phase);
  const corpusWeight = Math.min(0.12, (input.corpusSupportCount ?? 0) * 0.03);

  return valenceProfile(
    objectValence,
    signVehicleValence,
    interpretantValence,
    0.68 + corpusWeight,
    [
      `proposal kind ${input.proposalKind}`,
      `outcome ${input.verificationState}`,
      ...(input.phase ? [`phase ${input.phase}`] : []),
    ],
  );
}

export function inferProposalSemeioticFromProposal(proposal?: SemanticProposal, phase?: FragmentPhase | string) {
  if (!proposal) {
    return undefined;
  }

  return inferProposalSemeioticProfile({
    proposalKind: proposal.proposalKind,
    verificationState: proposal.verificationState,
    phase,
    corpusSupportCount: proposal.corpusSupport.length,
  });
}

export function inferDialecticMoveSemeioticProfile(move: Pick<
  DialecticMove,
  "role" | "extractedClaims" | "extractedObjections" | "extractedRepairs"
>): SemeioticOntologyProfile {
  switch (move.role) {
    case "criticize":
      return valenceProfile("secondness", "secondness", "secondness", 0.79, [
        `${move.extractedObjections.length} objections`,
        "critical dialectic move",
      ]);
    case "repair":
      return valenceProfile("thirdness", "thirdness", "thirdness", 0.82, [
        `${move.extractedRepairs.length} repairs`,
        "repair dialectic move",
      ]);
    case "synthesize":
      return valenceProfile("thirdness", "thirdness", "thirdness", 0.76, [
        `${move.extractedClaims.length} synthesized claims`,
        "synthesis dialectic move",
      ]);
    case "propose":
    default:
      return valenceProfile("firstness", "firstness", "firstness", 0.72, [
        `${move.extractedClaims.length} proposal claims`,
        "proposal dialectic move",
      ]);
  }
}

export function inferLeanRunSemeioticProfile(input: {
  outcome?: ProposalOutcomeState;
  theoremKind?: string;
  status?: string;
}) {
  if (input.outcome === "accepted") {
    return valenceProfile("thirdness", "thirdness", "thirdness", 0.86, [
      input.theoremKind ? `theorem ${input.theoremKind}` : "lean accepted",
      input.status ? `status ${input.status}` : "completed",
    ]);
  }

  if (input.outcome === "blocked" || input.outcome === "rejected") {
    return valenceProfile("secondness", "secondness", "secondness", 0.81, [
      input.theoremKind ? `theorem ${input.theoremKind}` : "lean boundary",
      input.status ? `status ${input.status}` : "boundary response",
    ]);
  }

  return valenceProfile("thirdness", "secondness", "secondness", 0.7, [
    input.theoremKind ? `theorem ${input.theoremKind}` : "lean run",
    input.status ? `status ${input.status}` : "pending",
  ]);
}

export function inferPersistentNodeSemeioticProfile(input: {
  kind: PersistentStubKind;
  layer: string;
}) {
  return valenceProfile("thirdness", "thirdness", "thirdness", 0.83, [
    `persistent ${input.kind}`,
    `layer ${input.layer}`,
  ]);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asValence(value: unknown): SemeioticValence | undefined {
  return value === "firstness" || value === "secondness" || value === "thirdness" ? value : undefined;
}

function asConfidence(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? clampConfidence(value) : undefined;
}

export function extractSemeioticProfile(...values: unknown[]): SemeioticOntologyProfile | undefined {
  for (const value of values) {
    const record = asRecord(value);
    const semeiotic = asRecord(record?.semeiotic ?? record);
    const object = asRecord(semeiotic?.object);
    const signVehicle = asRecord(semeiotic?.signVehicle);
    const interpretant = asRecord(semeiotic?.interpretant);

    const objectValence = asValence(object?.valence);
    const signVehicleValence = asValence(signVehicle?.valence);
    const interpretantValence = asValence(interpretant?.valence);
    const interpretantTerm = normalizeSemeioticInterpretantTerm(
      typeof interpretant?.term === "string" ? interpretant.term : undefined,
    );

    if (!objectValence || !signVehicleValence || !interpretantValence || !interpretantTerm) {
      continue;
    }

    return {
      object: {
        valence: objectValence,
        term: SEMEIOTIC_OBJECT_TERMS_BY_VALENCE[objectValence],
      },
      signVehicle: {
        valence: signVehicleValence,
        term: SEMEIOTIC_SIGN_TERMS_BY_VALENCE[signVehicleValence],
      },
      interpretant: {
        valence: interpretantValence,
        term: interpretantTerm,
        aliases: [...interpretantAliasesForCanonicalTerm(interpretantTerm)],
      },
      source:
        semeiotic?.source === "derived" || semeiotic?.source === "payload" || semeiotic?.source === "persisted"
          ? semeiotic.source
          : "payload",
      confidence: asConfidence(semeiotic?.confidence) ?? 0.72,
      notes: Array.isArray(semeiotic?.notes)
        ? semeiotic.notes.filter((note): note is string => typeof note === "string")
        : [],
    };
  }

  return undefined;
}

export function serializeSemeioticProfile(profile: SemeioticOntologyProfile) {
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
