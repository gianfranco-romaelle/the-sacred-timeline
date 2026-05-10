import type {
  SemeioticInterpretantAlias,
  SemeioticInterpretantTerm,
  SemeioticObjectTerm,
  SemeioticSignVehicleTerm,
  SemeioticValence,
} from "@/types/hegel-triangle";

export const SEMEIOTIC_OBJECT_TERMS_BY_VALENCE: Record<SemeioticValence, SemeioticObjectTerm> = {
  firstness: "icon",
  secondness: "index",
  thirdness: "symbol",
};

export const SEMEIOTIC_SIGN_TERMS_BY_VALENCE: Record<SemeioticValence, SemeioticSignVehicleTerm> = {
  firstness: "qualisign",
  secondness: "sinsign",
  thirdness: "legisign",
};

export const SEMEIOTIC_INTERPRETANT_TERMS_BY_VALENCE: Record<SemeioticValence, SemeioticInterpretantTerm> = {
  firstness: "rheme",
  secondness: "dicent",
  thirdness: "delome",
};

export const CANONICAL_SEMEIOTIC_OBJECT_TERMS = Object.freeze(
  Object.values(SEMEIOTIC_OBJECT_TERMS_BY_VALENCE),
) as readonly SemeioticObjectTerm[];

export const CANONICAL_SEMEIOTIC_SIGN_TERMS = Object.freeze(
  Object.values(SEMEIOTIC_SIGN_TERMS_BY_VALENCE),
) as readonly SemeioticSignVehicleTerm[];

export const CANONICAL_SEMEIOTIC_INTERPRETANT_TERMS = Object.freeze(
  Object.values(SEMEIOTIC_INTERPRETANT_TERMS_BY_VALENCE),
) as readonly SemeioticInterpretantTerm[];

export const SEMEIOTIC_INTERPRETANT_ALIAS_MAP = Object.freeze({
  argument: "delome",
} satisfies Record<SemeioticInterpretantAlias, SemeioticInterpretantTerm>);

export const SEMEIOTIC_INTERPRETANT_ALIASES_BY_TERM = Object.freeze({
  rheme: [] as const,
  dicent: [] as const,
  delome: ["argument"] as const,
} satisfies Record<SemeioticInterpretantTerm, readonly SemeioticInterpretantAlias[]>);

function normalizeRawLabel(value: string | undefined) {
  return typeof value === "string" ? value.trim().toLowerCase() : undefined;
}

export function isCanonicalSemeioticObjectTerm(value: unknown): value is SemeioticObjectTerm {
  return typeof value === "string" && CANONICAL_SEMEIOTIC_OBJECT_TERMS.includes(value as SemeioticObjectTerm);
}

export function isCanonicalSemeioticSignTerm(value: unknown): value is SemeioticSignVehicleTerm {
  return typeof value === "string" && CANONICAL_SEMEIOTIC_SIGN_TERMS.includes(value as SemeioticSignVehicleTerm);
}

export function isCanonicalSemeioticInterpretantTerm(value: unknown): value is SemeioticInterpretantTerm {
  return (
    typeof value === "string" &&
    CANONICAL_SEMEIOTIC_INTERPRETANT_TERMS.includes(value as SemeioticInterpretantTerm)
  );
}

export function isSemeioticInterpretantAlias(value: unknown): value is SemeioticInterpretantAlias {
  return typeof value === "string" && value in SEMEIOTIC_INTERPRETANT_ALIAS_MAP;
}

export function normalizeSemeioticObjectTerm(value: string | undefined): SemeioticObjectTerm | undefined {
  const normalized = normalizeRawLabel(value);
  return isCanonicalSemeioticObjectTerm(normalized) ? normalized : undefined;
}

export function normalizeSemeioticSignTerm(value: string | undefined): SemeioticSignVehicleTerm | undefined {
  const normalized = normalizeRawLabel(value);
  return isCanonicalSemeioticSignTerm(normalized) ? normalized : undefined;
}

export function normalizeSemeioticInterpretantTerm(
  value: string | undefined,
): SemeioticInterpretantTerm | undefined {
  const normalized = normalizeRawLabel(value);
  if (!normalized) {
    return undefined;
  }

  if (isCanonicalSemeioticInterpretantTerm(normalized)) {
    return normalized;
  }

  if (isSemeioticInterpretantAlias(normalized)) {
    return SEMEIOTIC_INTERPRETANT_ALIAS_MAP[normalized];
  }

  return undefined;
}

export function interpretantAliasesForCanonicalTerm(
  term: SemeioticInterpretantTerm,
): readonly SemeioticInterpretantAlias[] {
  return SEMEIOTIC_INTERPRETANT_ALIASES_BY_TERM[term];
}

export function canonicalInterpretantAliasTarget(
  alias: string | undefined,
): SemeioticInterpretantTerm | undefined {
  const normalized = normalizeRawLabel(alias);
  return normalized && isSemeioticInterpretantAlias(normalized)
    ? SEMEIOTIC_INTERPRETANT_ALIAS_MAP[normalized]
    : undefined;
}

