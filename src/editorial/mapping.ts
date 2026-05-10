import { getPrimaryYearFromDateRange } from "@/data/time-grouping";
import type { HistoricalDateRange, KnowledgeEntity } from "@/types";
import {
  editorialStageProfilesById,
  editorialStageProfilesByStage,
  editorialStages,
  quantumStages,
} from "./stage-profiles";
import type {
  CalculusStage,
  EditorialAssignmentState,
  EditorialCrosswalk,
  EditorialCrosswalkDimension,
  EditorialStageProfile,
  EditorialStageTag,
  EntityEditorialMetadata,
  QuantumStage,
} from "./types";

const calculusStageLabels: Record<CalculusStage, string> = {
  0: "Zeroth",
  1: "First",
  2: "Second",
  3: "Third",
  4: "Fourth",
  5: "Fifth",
  6: "Sixth",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const legacyCalculusStageAliases: Record<string, CalculusStage> = {
  "0": 0,
  zeroth: 0,
  zero: 0,
  "1": 1,
  first: 1,
  "2": 2,
  second: 2,
  "3": 3,
  third: 3,
  "4": 4,
  fourth: 4,
  "fourth a": 3,
  "4a": 3,
  "fourth b": 4,
  "4b": 4,
  "5": 5,
  fifth: 5,
  "6": 6,
  sixth: 6,
};

const quantumAliases: Record<string, QuantumStage> = {
  "0": 0,
  zeroth: 0,
  zero: 0,
  "1": 1,
  first: 1,
  "2": 2,
  second: 2,
  "3": 3,
  third: 3,
  "4": 4,
  fourth: 4,
  "4a": 3,
  "fourth a": 3,
  "4b": 4,
  "fourth b": 4,
  "5": 5,
  fifth: 5,
  "6": 6,
  sixth: 6,
};

const toUniqueArray = <T,>(values: Array<T | undefined>) =>
  Array.from(new Set(values.filter((value): value is T => value !== undefined)));

export const normalizeCalculusStage = (
  value: string | number | null | undefined,
): CalculusStage | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }

  return legacyCalculusStageAliases[String(value).trim().toLowerCase()];
};

export const normalizeQuantumStage = (
  value: string | number | null | undefined,
): QuantumStage | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }

  return quantumAliases[String(value).trim().toLowerCase()];
};

export const deriveQuantumStage = (
  calculusStage: CalculusStage | undefined,
): QuantumStage | undefined => {
  if (calculusStage === undefined) {
    return undefined;
  }

  return editorialStageProfilesByStage.get(calculusStage)?.quantumStage;
};

export const getEditorialStageProfile = (
  stage: CalculusStage | undefined,
): EditorialStageProfile | undefined =>
  stage === undefined ? undefined : editorialStageProfilesByStage.get(stage);

export const resolveEditorialStageProfile = (input: {
  profileId?: string;
  calculusStage?: CalculusStage;
}): EditorialStageProfile | undefined =>
  (input.profileId ? editorialStageProfilesById.get(input.profileId) : undefined) ??
  getEditorialStageProfile(input.calculusStage);

export const getEditorialStageLabel = (
  stage: CalculusStage | QuantumStage | undefined,
): string | undefined => (stage === undefined ? undefined : calculusStageLabels[stage as CalculusStage]);

export const getEditorialStageWindowLabel = (
  profile: EditorialStageProfile | undefined,
): string | undefined => {
  if (!profile) {
    return undefined;
  }

  if (profile.window?.kind === "pre-1600-continuum") {
    return "Pre-1600 continuum";
  }

  if (profile.window?.kind === "open-ended") {
    return `${profile.window.startYear}-Present`;
  }

  if (profile.window?.kind === "bounded") {
    return `${profile.window.startYear}-${profile.window.endYear}`;
  }

  if (profile.dateRange) {
    return `${profile.dateRange[0]}-${profile.dateRange[1]}`;
  }

  return undefined;
};

const matchesStageWindow = (
  year: number,
  profile: EditorialStageProfile | undefined,
) => {
  if (!profile?.window && !profile?.dateRange) {
    return false;
  }

  if (profile.window?.kind === "pre-1600-continuum") {
    return year < 1600;
  }

  if (profile.window?.kind === "open-ended") {
    return year >= profile.window.startYear;
  }

  if (profile.window?.kind === "bounded") {
    return year >= profile.window.startYear && year <= profile.window.endYear;
  }

  if (profile.dateRange) {
    return year >= profile.dateRange[0] && year <= profile.dateRange[1];
  }

  return false;
};

export const inferEditorialStageProfilesFromYear = (
  year: number | undefined,
): EditorialStageProfile[] => {
  if (typeof year !== "number") {
    return [];
  }

  return editorialStages
    .map((stage) => getEditorialStageProfile(stage))
    .filter((profile): profile is EditorialStageProfile => Boolean(profile))
    .filter((profile) => matchesStageWindow(year, profile));
};

const inferEditorialStageProfilesFromDateRange = (
  dateRange: HistoricalDateRange | undefined,
) => inferEditorialStageProfilesFromYear(getPrimaryYearFromDateRange(dateRange));

const getPrimaryInferredProfile = (profiles: EditorialStageProfile[]) =>
  [...profiles]
    .filter((profile) => profile.calculusStage !== undefined)
    .sort(
      (left, right) =>
        (right.calculusStage ?? Number.NEGATIVE_INFINITY) -
        (left.calculusStage ?? Number.NEGATIVE_INFINITY),
    )[0];

export const buildEditorialCrosswalk = (
  profile: EditorialStageProfile | undefined,
): EditorialCrosswalk | undefined => {
  if (!profile) {
    return undefined;
  }

  return {
    calculusStage: profile.calculusStage,
    quantumStage: profile.quantumStage,
    dateRange: profile.dateRange,
    epochLabel: profile.epochLabel,
    epochDescription: profile.epochDescription,
    pairingSummary: profile.pairingSummary,
    structuralThemes: profile.structuralThemes,
    characteristicForms: profile.characteristicForms,
    mentalModes: profile.mentalModes,
    ontologicalFocus: profile.ontologicalFocus,
    chemicalEpoch: profile.chemicalEpoch,
    chemicalEpochs: profile.chemicalEpochs,
    drugEpoch: profile.drugEpoch,
    drugEpochs: profile.drugEpochs,
    summary: profile.summary,
  };
};

const getInferredEditorialMetadata = (
  entity: KnowledgeEntity,
): EntityEditorialMetadata | undefined => {
  const inferredProfiles = inferEditorialStageProfilesFromDateRange(entity.dateRange);
  const primaryProfile = getPrimaryInferredProfile(inferredProfiles);

  if (!primaryProfile) {
    return undefined;
  }

  return {
    calculusStage: primaryProfile.calculusStage,
    quantumStage: primaryProfile.quantumStage,
    confidence: 0.56,
    source: "derived",
    stageTag: {
      calculusStage: primaryProfile.calculusStage,
      quantumStage: primaryProfile.quantumStage,
      confidence: 0.56,
      notes: `Derived from the canonical date range using the editorial periodization windows (${getEditorialStageWindowLabel(primaryProfile)}).`,
      source: "derived",
      assignmentState: "derived",
    },
    stageProfile: primaryProfile,
    stageProfiles: inferredProfiles,
    crosswalk: buildEditorialCrosswalk(primaryProfile),
    profileId: primaryProfile.id,
    profileIds: inferredProfiles.map((profile) => profile.id),
    sourceLabel: "derived from editorial date windows",
  };
};

export const buildEditorialStageTag = (
  value:
    | (Omit<Partial<EditorialStageTag>, "calculusStage" | "quantumStage"> & {
        calculusStage?: string | number;
        quantumStage?: string | number;
      })
    | undefined,
): EditorialStageTag | undefined => {
  if (!value) {
    return undefined;
  }

  const calculusStage = normalizeCalculusStage(value.calculusStage);
  const quantumStage =
    normalizeQuantumStage(value.quantumStage) ?? deriveQuantumStage(calculusStage);

  if (
    calculusStage === undefined &&
    quantumStage === undefined &&
    typeof value.confidence !== "number" &&
    !value.notes
  ) {
    return undefined;
  }

  return {
    calculusStage,
    quantumStage,
    confidence: typeof value.confidence === "number" ? value.confidence : undefined,
    notes: value.notes,
    source: value.source,
    assignmentState: value.assignmentState,
  };
};

export const resolveEditorialMetadata = (
  rawValue: unknown,
): EntityEditorialMetadata | undefined => {
  if (!isRecord(rawValue)) {
    return undefined;
  }

  const stageTag = buildEditorialStageTag({
    calculusStage:
      (rawValue.calculusStage as string | number | undefined) ??
      (rawValue.calculusName as string | number | undefined),
    quantumStage: rawValue.quantumStage as string | number | undefined,
    confidence: rawValue.confidence as number | undefined,
    notes: rawValue.notes as string | undefined,
    source: rawValue.source as EditorialStageTag["source"] | undefined,
    assignmentState: rawValue.assignmentState as EditorialAssignmentState | undefined,
  });
  const profileIds = Array.isArray(rawValue.profileIds)
    ? rawValue.profileIds.filter((value): value is string => typeof value === "string")
    : [];
  const profileId = typeof rawValue.profileId === "string" ? rawValue.profileId : profileIds[0];
  const stageProfile = resolveEditorialStageProfile({
    profileId,
    calculusStage: stageTag?.calculusStage,
  });
  const stageProfiles = Array.from(
    new Set([...(profileIds.length > 0 ? profileIds : profileId ? [profileId] : [])]),
  )
    .map((id) => resolveEditorialStageProfile({ profileId: id }))
    .filter((value): value is EditorialStageProfile => Boolean(value));

  if (!stageTag && !stageProfile && stageProfiles.length === 0) {
    return undefined;
  }

  const resolvedProfiles =
    stageProfiles.length > 0 ? stageProfiles : stageProfile ? [stageProfile] : [];
  const primaryProfile = stageProfile ?? resolvedProfiles[0];

  return {
    ...stageTag,
    calculusStage: stageTag?.calculusStage ?? primaryProfile?.calculusStage,
    quantumStage:
      stageTag?.quantumStage ??
      primaryProfile?.quantumStage ??
      deriveQuantumStage(stageTag?.calculusStage),
    stageTag,
    stageProfile: primaryProfile,
    stageProfiles: resolvedProfiles,
    crosswalk: buildEditorialCrosswalk(primaryProfile),
    profileId: primaryProfile?.id ?? profileId,
    profileIds:
      resolvedProfiles.length > 0
        ? resolvedProfiles.map((profile) => profile.id)
        : primaryProfile?.id
          ? [primaryProfile.id]
          : profileIds,
    sourceLabel:
      typeof rawValue.sourceLabel === "string"
        ? rawValue.sourceLabel
        : stageTag?.source ?? "editorial lens",
  };
};

export const extractEntityEditorialMetadata = (
  entity: KnowledgeEntity,
): EntityEditorialMetadata | undefined =>
  resolveEditorialMetadata(entity.metadata?.editorial) ??
  resolveEditorialMetadata(entity.metadata?.editorialStageTag) ??
  getInferredEditorialMetadata(entity);

export const mapEntityToEditorialProfile = (
  entity: KnowledgeEntity,
): EditorialStageProfile | undefined => extractEntityEditorialMetadata(entity)?.stageProfile;

export const assignEditorialStageTag = (
  entity: KnowledgeEntity,
  stageTag: Partial<EditorialStageTag>,
): EntityEditorialMetadata | undefined => {
  const resolvedTag = buildEditorialStageTag(stageTag);
  if (!resolvedTag) {
    return undefined;
  }

  const stageProfile = getEditorialStageProfile(resolvedTag.calculusStage);
  return {
    ...resolvedTag,
    stageTag: resolvedTag,
    stageProfile,
    stageProfiles: stageProfile ? [stageProfile] : [],
    crosswalk: buildEditorialCrosswalk(stageProfile),
    profileId: stageProfile?.id,
    profileIds: stageProfile?.id ? [stageProfile.id] : [],
    sourceLabel: resolvedTag.source ?? "manual editorial assignment",
  };
};

export const getEditorialStageOptions = () =>
  editorialStages.map((stage) => {
    const profile = getEditorialStageProfile(stage);
    const windowLabel = getEditorialStageWindowLabel(profile);

    return {
      id: stage,
      label: profile?.label ?? String(stage),
      description: [windowLabel, profile?.summary].filter(Boolean).join(" - "),
    };
  });

export const getQuantumStageOptions = () =>
  quantumStages.map((stage) => {
    const profile = getEditorialStageProfile(stage as CalculusStage);
    const windowLabel = getEditorialStageWindowLabel(profile);

    return {
      id: stage,
      label: profile ? `Q${profile.shortLabel} ${profile.label}` : `Q${stage}`,
      description: [windowLabel, profile?.epochDescription].filter(Boolean).join(" - "),
    };
  });

export const getEditorialCrosswalkValues = (
  crosswalk: EditorialCrosswalk | undefined,
  dimension: EditorialCrosswalkDimension,
) => {
  if (!crosswalk) {
    return [];
  }

  switch (dimension) {
    case "structural-theme":
      return crosswalk.structuralThemes ?? [];
    case "mental-mode":
      return crosswalk.mentalModes ?? [];
    case "characteristic-form":
      return crosswalk.characteristicForms ?? [];
    case "chemical-epoch":
      return crosswalk.chemicalEpochs ?? (crosswalk.chemicalEpoch ? [crosswalk.chemicalEpoch] : []);
    case "drug-epoch":
      return crosswalk.drugEpochs ?? (crosswalk.drugEpoch ? [crosswalk.drugEpoch] : []);
    case "ontological-focus":
      return crosswalk.ontologicalFocus ?? [];
  }
};

export const getEntityEditorialStageCoverage = (
  entity: KnowledgeEntity,
): {
  calculusStages: CalculusStage[];
  quantumStages: QuantumStage[];
  profiles: EditorialStageProfile[];
} => {
  const metadata = extractEntityEditorialMetadata(entity);
  const profiles =
    metadata?.stageProfiles && metadata.stageProfiles.length > 0
      ? metadata.stageProfiles
      : metadata?.stageProfile
        ? [metadata.stageProfile]
        : [];

  return {
    profiles,
    calculusStages: toUniqueArray([
      metadata?.calculusStage,
      ...profiles.map((profile) => profile.calculusStage),
    ]),
    quantumStages: toUniqueArray([
      metadata?.quantumStage,
      ...profiles.map((profile) => profile.quantumStage),
    ]),
  };
};

export const groupEntitiesByEditorialStage = (entities: KnowledgeEntity[]) => {
  const groups = new Map<CalculusStage | "unassigned", KnowledgeEntity[]>();

  for (const entity of entities) {
    const stage = extractEntityEditorialMetadata(entity)?.calculusStage ?? "unassigned";
    groups.set(stage, [...(groups.get(stage) ?? []), entity]);
  }

  return [
    ...editorialStages
      .filter((stage) => groups.has(stage))
      .map((stage) => ({
        key: `calculus-${stage}`,
        label: getEditorialStageProfile(stage)?.label ?? String(stage),
        profile: getEditorialStageProfile(stage),
        items: groups.get(stage) ?? [],
      })),
    ...(groups.has("unassigned")
      ? [
          {
            key: "calculus-unassigned",
            label: "Unassigned",
            profile: undefined,
            items: groups.get("unassigned") ?? [],
          },
        ]
      : []),
  ];
};

export const groupEntitiesByQuantumStage = (entities: KnowledgeEntity[]) => {
  const groups = new Map<QuantumStage | "unassigned", KnowledgeEntity[]>();

  for (const entity of entities) {
    const stage = extractEntityEditorialMetadata(entity)?.quantumStage ?? "unassigned";
    groups.set(stage, [...(groups.get(stage) ?? []), entity]);
  }

  return [
    ...quantumStages
      .filter((stage) => groups.has(stage))
      .map((stage) => ({
        key: `quantum-${stage}`,
        label: `Quantum ${getEditorialStageLabel(stage) ?? stage}`,
        profile: undefined,
        items: groups.get(stage) ?? [],
      })),
    ...(groups.has("unassigned")
      ? [
          {
            key: "quantum-unassigned",
            label: "Unassigned",
            profile: undefined,
            items: groups.get("unassigned") ?? [],
          },
        ]
      : []),
  ];
};
