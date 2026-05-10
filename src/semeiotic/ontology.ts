import type {
  SemeioticInterpretantAlias,
  SemeioticInterpretantTerm,
  SemeioticLens,
  SemeioticObjectTerm,
  SemeioticOntologyProfile,
  SemeioticSignVehicleTerm,
} from "@/types/hegel-triangle";
import {
  interpretantAliasesForCanonicalTerm,
  normalizeSemeioticInterpretantTerm,
  SEMEIOTIC_INTERPRETANT_TERMS_BY_VALENCE,
  SEMEIOTIC_OBJECT_TERMS_BY_VALENCE,
  SEMEIOTIC_SIGN_TERMS_BY_VALENCE,
} from "./canonical";

export const SEMEIOTIC_OBJECT_TERMS = SEMEIOTIC_OBJECT_TERMS_BY_VALENCE;
export const SEMEIOTIC_SIGN_VEHICLE_TERMS = SEMEIOTIC_SIGN_TERMS_BY_VALENCE;
export const SEMEIOTIC_INTERPRETANT_TERMS = SEMEIOTIC_INTERPRETANT_TERMS_BY_VALENCE;

export function canonicalInterpretantTerm(
  value: string | undefined,
): SemeioticInterpretantTerm | undefined {
  return normalizeSemeioticInterpretantTerm(value);
}

export function interpretantAliases(
  term: SemeioticInterpretantTerm,
): SemeioticInterpretantAlias[] | undefined {
  const aliases = interpretantAliasesForCanonicalTerm(term);
  return aliases.length > 0 ? [...aliases] : undefined;
}

export function semeioticLensLabel(lens: SemeioticLens) {
  switch (lens) {
    case "object":
      return "Object";
    case "sign_vehicle":
      return "Sign Vehicle";
    case "interpretant":
      return "Interpretant";
    case "triadic":
    default:
      return "Triadic";
  }
}

export function semeioticSignature(profile?: SemeioticOntologyProfile) {
  if (!profile) {
    return undefined;
  }

  return `${profile.object.term} / ${profile.signVehicle.term} / ${profile.interpretant.term}`;
}

export function semeioticLensValue(
  profile: SemeioticOntologyProfile | undefined,
  lens: SemeioticLens,
) {
  if (!profile) {
    return undefined;
  }

  switch (lens) {
    case "object":
      return `${profile.object.term} (${profile.object.valence})`;
    case "sign_vehicle":
      return `${profile.signVehicle.term} (${profile.signVehicle.valence})`;
    case "interpretant":
      return `${profile.interpretant.term} (${profile.interpretant.valence})`;
    case "triadic":
    default:
      return semeioticSignature(profile);
  }
}
