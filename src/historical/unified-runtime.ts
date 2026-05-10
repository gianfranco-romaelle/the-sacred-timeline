import { useEffect, useMemo, useState } from "react";
import {
  buildSeedIndex,
  type SeedIndex,
} from "@/data/entity-index";
import {
  extendSeedWithDriveTrialData,
  type DriveIndexPayload,
  type DriveSemanticPayload,
  type DriveTrialData,
} from "@/data/drive-trial-adapter";
import { sacredTimelineSeed } from "@/data/sacred-timeline.seed";
import {
  buildEditorialCrosswalk,
  resolveEditorialMetadata,
  resolveEditorialStageProfile,
} from "@/editorial/stage-lens";
import type {
  EntityEditorialAssignmentOverride,
  EntityEditorialMetadata,
} from "@/editorial/types";
import type {
  DomainDefinition,
  DomainId,
  HistoricalDateRange,
  JsonObject,
  Person,
  PortraitAsset,
  SacredTimelineSeedData,
  TagId,
  TraditionId,
} from "@/types";
import { useAdminStore } from "@/state/admin-store";
import type {
  CanonicalEntity,
  CanonicalResolvedField,
  CanonicalEntityOverride,
  EffectiveCanonicalEntity,
  FieldPrecedence,
  HistoricalEntityGraphSnapshot,
  SourceRecord,
} from "@/historical/types";

const SNAPSHOT_URL = "/generated/historical-entity-graph.snapshot.json";
const DRIVE_INDEX_URL = "/generated/drive_index_WIP.json";
const DRIVE_SEMANTIC_URL = "/generated/drive_semantic_embeddings_WIP.json";
const GENERATED_HISTORY_DOMAIN_ID = "domain_history" as DomainId;
const SNAPSHOT_REFRESH_MS = 20_000;

export interface UnifiedHistoricalRuntimeData {
  seed: SacredTimelineSeedData;
  index: SeedIndex;
  loading: boolean;
  error?: string;
  snapshot?: HistoricalEntityGraphSnapshot;
  effectiveCanonicalEntitiesById: Map<string, EffectiveCanonicalEntity>;
  sourceRecordsById: Map<string, SourceRecord>;
  isHistoricalEntity: (entityId: string | undefined) => boolean;
  getEffectiveCanonicalEntity: (entityId: string | undefined) => EffectiveCanonicalEntity | undefined;
  getContributingSourceRecords: (entityId: string | undefined) => SourceRecord[];
}

const ensureHistoryDomain = (seed: SacredTimelineSeedData): DomainDefinition[] => {
  if (seed.domains.some((domain) => domain.id === GENERATED_HISTORY_DOMAIN_ID)) {
    return seed.domains;
  }

  return [
    ...seed.domains,
    {
      id: GENERATED_HISTORY_DOMAIN_ID,
      slug: "history",
      label: "History",
      description: "Imported historical biography and contextual records.",
      kind: "history",
      colorToken: "umber",
    },
  ];
};

const inferPersonDateRange = (
  birthYear?: number | null,
  deathYear?: number | null,
): HistoricalDateRange | undefined => {
  if (typeof birthYear !== "number" && typeof deathYear !== "number") {
    return undefined;
  }

  return {
    kind: "lifespan",
    start:
      typeof birthYear === "number"
        ? {
            date: {
              year: birthYear,
              precision: "year",
              qualifier: "exact",
            },
          }
        : undefined,
    end:
      typeof deathYear === "number"
        ? {
            date: {
              year: deathYear,
              precision: "year",
              qualifier: "exact",
            },
          }
        : undefined,
    certainty: "probable",
    displayLabel:
      typeof birthYear === "number" || typeof deathYear === "number"
        ? `${typeof birthYear === "number" ? birthYear : "?"}-${typeof deathYear === "number" ? deathYear : "?"}`
        : undefined,
    sortStartYear: typeof birthYear === "number" ? birthYear : deathYear ?? undefined,
    sortEndYear: typeof deathYear === "number" ? deathYear : birthYear ?? undefined,
  };
};

const getFieldValueByPrecedence = <TValue,>(
  canonicalField: CanonicalResolvedField<TValue>,
  precedence: FieldPrecedence | undefined,
): TValue | undefined => {
  if (!precedence || precedence === "merged") {
    return canonicalField.mergedValue as TValue | undefined;
  }

  if (precedence === "manual_override") {
    return canonicalField.effectiveValue as TValue | undefined;
  }

  const matchingSourceValue = canonicalField.values.find((value) => value.sourceKind === precedence);
  return matchingSourceValue?.value as TValue | undefined;
};

const applySourceExclusions = (
  canonicalEntity: CanonicalEntity,
  override: CanonicalEntityOverride | undefined,
) => {
  const excludedIds = new Set(override?.sourceExclusions ?? []);
  if (excludedIds.size === 0) {
    return canonicalEntity;
  }

  const filterField = <TValue,>(field: CanonicalResolvedField<TValue>): CanonicalResolvedField<TValue> => ({
    ...field,
    values: field.values.filter((value) => !excludedIds.has(value.sourceRecordId)),
    provenance: field.provenance.filter(
      (entry) => !entry.sourceRecordId || !excludedIds.has(entry.sourceRecordId),
    ),
  });

  return {
    ...canonicalEntity,
    sourceRecordIds: canonicalEntity.sourceRecordIds.filter((sourceRecordId) => !excludedIds.has(sourceRecordId)),
    displayName: filterField(canonicalEntity.displayName),
    aliases: filterField(canonicalEntity.aliases),
    birthYear: filterField(canonicalEntity.birthYear),
    deathYear: filterField(canonicalEntity.deathYear),
    summary: filterField(canonicalEntity.summary),
    domainIds: filterField(canonicalEntity.domainIds),
    traditionIds: filterField(canonicalEntity.traditionIds),
    tagIds: filterField(canonicalEntity.tagIds),
    preferredPortrait: filterField(canonicalEntity.preferredPortrait),
    portraitCandidates: canonicalEntity.portraitCandidates.filter(
      (portrait) => !excludedIds.has(portrait.sourceRecordId),
    ),
  } satisfies CanonicalEntity;
};

const resolveEffectiveCanonicalEntity = (
  canonicalEntity: CanonicalEntity,
  override: CanonicalEntityOverride | undefined,
  sourceRecordsById: Map<string, SourceRecord>,
): EffectiveCanonicalEntity => {
  const filteredEntity = applySourceExclusions(canonicalEntity, override);
  const displayName =
    override?.displayName ??
    getFieldValueByPrecedence<string>(
      filteredEntity.displayName,
      override?.fieldPrecedence?.displayName,
    ) ??
    filteredEntity.displayName.mergedValue ??
    filteredEntity.slug;

  const aliases =
    override?.aliases ??
    getFieldValueByPrecedence<string[]>(
      filteredEntity.aliases,
      override?.fieldPrecedence?.aliases,
    ) ??
    filteredEntity.aliases.mergedValue ??
    [];

  const birthYear =
    override?.birthYear ??
    getFieldValueByPrecedence<number | null>(
      filteredEntity.birthYear,
      override?.fieldPrecedence?.birthYear,
    ) ??
    filteredEntity.birthYear.mergedValue;

  const deathYear =
    override?.deathYear ??
    getFieldValueByPrecedence<number | null>(
      filteredEntity.deathYear,
      override?.fieldPrecedence?.deathYear,
    ) ??
    filteredEntity.deathYear.mergedValue;

  const summary =
    override?.summary ??
    getFieldValueByPrecedence<string>(
      filteredEntity.summary,
      override?.fieldPrecedence?.summary,
    ) ??
    filteredEntity.summary.mergedValue ??
    "Summary pending editorial review.";

  const domainIds =
    override?.domainIds ??
    getFieldValueByPrecedence<DomainId[]>(
      filteredEntity.domainIds,
      override?.fieldPrecedence?.domainIds,
    ) ??
    filteredEntity.domainIds.mergedValue ??
    [GENERATED_HISTORY_DOMAIN_ID];

  const traditionIds =
    override?.traditionIds ??
    getFieldValueByPrecedence<TraditionId[]>(
      filteredEntity.traditionIds,
      override?.fieldPrecedence?.traditionIds,
    ) ??
    filteredEntity.traditionIds.mergedValue ??
    [];

  const tagIds =
    override?.tagIds ??
    getFieldValueByPrecedence<TagId[]>(
      filteredEntity.tagIds,
      override?.fieldPrecedence?.tagIds,
    ) ??
    filteredEntity.tagIds.mergedValue ??
    [];

  const preferredPortraitId =
    override?.preferredPortrait ??
    getFieldValueByPrecedence<string | null>(
      filteredEntity.preferredPortrait,
      override?.fieldPrecedence?.preferredPortrait,
    ) ??
    filteredEntity.preferredPortrait.mergedValue ??
    undefined;

  const effectivePreferredPortrait = filteredEntity.portraitCandidates.find(
    (portrait) => portrait.id === preferredPortraitId,
  ) ?? filteredEntity.portraitCandidates.find((portrait) => portrait.isPreferred);

  const contributingSourceRecords = filteredEntity.sourceRecordIds
    .map((sourceRecordId) => sourceRecordsById.get(sourceRecordId))
    .filter((value): value is SourceRecord => Boolean(value));
  const hasOverrides = Boolean(
    override &&
      Object.entries(override).some(
        ([key, value]) => key !== "entityId" && key !== "updatedAt" && value !== undefined,
      ),
  );

  return {
    canonical: filteredEntity,
    override,
    effectiveDisplayName: displayName,
    effectiveAliases: aliases.filter((alias: string) => alias.trim().length > 0),
    effectiveBirthYear: birthYear,
    effectiveDeathYear: deathYear,
    effectiveSummary: summary,
    effectiveDomainIds: domainIds.length > 0 ? domainIds : [GENERATED_HISTORY_DOMAIN_ID],
    effectiveTraditionIds: traditionIds,
    effectiveTagIds: tagIds,
    effectivePreferredPortrait,
    effectiveVisibility: override?.visibility ?? filteredEntity.visibility,
    effectiveReviewStatus: override?.reviewStatus ?? filteredEntity.reviewStatus,
    hasOverrides,
    fieldConflicts: filteredEntity.fieldConflicts,
    contributingSourceRecords,
  };
};

const toImportedPerson = (entity: EffectiveCanonicalEntity): Person => {
  const metadata: JsonObject = {
    importedHistoricalEntity: true,
    mergeStatus: entity.canonical.mergeStatus,
    reviewStatus: entity.effectiveReviewStatus,
    visibility: entity.effectiveVisibility,
    sourceRecordIds: entity.canonical.sourceRecordIds,
    mergeConfidence: entity.canonical.mergeConfidence,
  };
  const editorialMetadata = entity.canonical.metadata?.editorial;
  if (editorialMetadata && typeof editorialMetadata === "object" && !Array.isArray(editorialMetadata)) {
    metadata.editorial = editorialMetadata;
  }

  return {
    id: entity.canonical.id,
    entityType: "person",
    slug: entity.canonical.slug,
    label: entity.effectiveDisplayName,
    title: entity.effectiveDisplayName,
    description: entity.effectiveSummary,
    alternateLabels: entity.effectiveAliases,
    dateRange: inferPersonDateRange(entity.effectiveBirthYear, entity.effectiveDeathYear),
    domainIds: entity.effectiveDomainIds,
    tagIds: entity.effectiveTagIds,
    citationIds: [],
    relatedEntityIds: [],
    mediaAssetIds: entity.effectivePreferredPortrait ? [`portrait_${entity.canonical.slug}`] : [],
    roles: [],
    institutionIds: [],
    traditionIds: entity.effectiveTraditionIds,
    textIds: [],
    metadata,
  };
};

const toEditorialAssignmentMetadata = (
  existingMetadata: EntityEditorialMetadata | undefined,
  assignment: EntityEditorialAssignmentOverride | undefined,
) => {
  if (!assignment) {
    return existingMetadata;
  }

  const stageProfile = resolveEditorialStageProfile({
    profileId: assignment.profileIds?.[0] ?? existingMetadata?.profileIds?.[0],
    calculusStage: assignment.calculusStage ?? existingMetadata?.calculusStage,
  });
  const stageProfiles = (assignment.profileIds ?? existingMetadata?.profileIds ?? [])
    .map((profileId) => resolveEditorialStageProfile({ profileId }))
    .filter((value): value is NonNullable<typeof value> => Boolean(value));

  return {
    ...existingMetadata,
    calculusStage: assignment.calculusStage ?? existingMetadata?.calculusStage,
    quantumStage: assignment.quantumStage ?? existingMetadata?.quantumStage,
    confidence: assignment.confidence ?? existingMetadata?.confidence,
    notes: assignment.notes ?? existingMetadata?.notes,
    source:
      assignment.assignmentState === "derived"
        ? "derived"
        : existingMetadata?.source ?? "manual",
    assignmentState: assignment.assignmentState ?? existingMetadata?.assignmentState,
    profileId: stageProfile?.id,
    profileIds:
      stageProfiles.length > 0
        ? stageProfiles.map((profile) => profile.id)
        : assignment.profileIds ?? existingMetadata?.profileIds,
    sourceLabel: assignment.sourceLabel ?? "manual editorial curation",
    stageTag: {
      ...(existingMetadata?.stageTag ?? {}),
      calculusStage: assignment.calculusStage ?? existingMetadata?.calculusStage,
      quantumStage: assignment.quantumStage ?? existingMetadata?.quantumStage,
      confidence: assignment.confidence ?? existingMetadata?.confidence,
      notes: assignment.notes ?? existingMetadata?.notes,
      source: assignment.assignmentState === "derived" ? "derived" : "manual",
      assignmentState: assignment.assignmentState ?? existingMetadata?.assignmentState,
    },
    stageProfile,
    stageProfiles,
    crosswalk: buildEditorialCrosswalk(stageProfile),
  };
};

const applyEditorialAssignmentsToCollection = <TEntity extends { id: string; metadata?: JsonObject }>(
  entities: TEntity[],
  assignmentsByEntityId: Partial<Record<string, EntityEditorialAssignmentOverride>>,
) =>
  entities.map((entity) => {
    const assignment = assignmentsByEntityId[entity.id];
    if (!assignment) {
      return entity;
    }

    const existingMetadata = resolveEditorialMetadata(entity.metadata?.editorial);

    return {
      ...entity,
      metadata: {
        ...(entity.metadata ?? {}),
        editorial: toEditorialAssignmentMetadata(existingMetadata, assignment),
      },
    };
  });

const toImportedPortrait = (
  entity: EffectiveCanonicalEntity,
): PortraitAsset | undefined => {
  const portrait = entity.effectivePreferredPortrait;
  if (!portrait?.publicAssetPath) {
    return undefined;
  }

  return {
    id: `portrait_${entity.canonical.slug}`,
    assetType: "portrait",
    slug: `${entity.canonical.slug}-portrait`,
    label: portrait.label,
    title: `${entity.effectiveDisplayName} portrait`,
    description: `Imported portrait asset for ${entity.effectiveDisplayName}.`,
    domainIds: entity.effectiveDomainIds,
    tagIds: entity.effectiveTagIds,
    citationIds: [],
    relatedEntityIds: [entity.canonical.id],
    mediaAssetIds: [],
    altText: `${entity.effectiveDisplayName} portrait`,
    file: {
      src: portrait.publicAssetPath,
      thumbnailSrc: portrait.publicAssetPath,
      mimeType: "image/png",
    },
    depictedEntityIds: [entity.canonical.id],
    depictionType: "photograph",
    isPrimaryPortrait: true,
    metadata: {
      importedHistoricalEntity: true,
      sourceRecordId: portrait.sourceRecordId,
    },
    embedding: {
      embeddingCandidate: true,
      descriptors: [],
      clusterIds: portrait.clusterIds,
      styleGroupIds: portrait.styleGroupIds,
      similarityLinks: (portrait.similarityNeighborIds ?? []).map((targetId) => ({
        targetId,
        score: 0.5,
        relation: "similar_portrait",
      })),
    },
  };
};

const buildUnifiedSeed = (
  snapshot: HistoricalEntityGraphSnapshot | undefined,
  driveTrialData: DriveTrialData | undefined,
  overridesByEntityId: Partial<Record<string, CanonicalEntityOverride>>,
  editorialAssignmentsByEntityId: Partial<Record<string, EntityEditorialAssignmentOverride>>,
  isAdminMode: boolean,
  showDraftEntities: boolean,
) => {
  const baseSeed = extendSeedWithDriveTrialData(sacredTimelineSeed, driveTrialData ?? {});

  if (!snapshot) {
    const fallbackIndex = buildSeedIndex(baseSeed);
    return {
      seed: baseSeed,
      index: fallbackIndex,
      effectiveCanonicalEntitiesById: new Map<string, EffectiveCanonicalEntity>(),
      sourceRecordsById: new Map<string, SourceRecord>(),
    };
  }

  const sourceRecordsById = new Map(snapshot.sourceRecords.map((record) => [record.id, record]));
  const effectiveCanonicalEntities = snapshot.canonicalEntities.map((canonicalEntity) =>
    resolveEffectiveCanonicalEntity(
      canonicalEntity,
      overridesByEntityId[canonicalEntity.id],
      sourceRecordsById,
    ),
  );

  // Public mode stays editorially conservative: only reviewed/public imported people
  // are folded into the shared exploration views. Admin mode can widen that aperture.
  const visibleHistoricalEntities = effectiveCanonicalEntities.filter((entity) => {
    if (entity.effectiveVisibility === "hidden") {
      return isAdminMode;
    }

    if (entity.effectiveVisibility === "draft") {
      return isAdminMode && showDraftEntities;
    }

    return true;
  });

  const importedPeople = visibleHistoricalEntities.map(toImportedPerson);
  const importedPortraits = visibleHistoricalEntities
    .map(toImportedPortrait)
    .filter((value): value is PortraitAsset => Boolean(value));

  const unifiedSeed: SacredTimelineSeedData = {
    ...baseSeed,
    domains: ensureHistoryDomain(baseSeed),
    people: [...baseSeed.people, ...importedPeople],
    portraitAssets: [...baseSeed.portraitAssets, ...importedPortraits],
  };

  const editorializedSeed: SacredTimelineSeedData = {
    ...unifiedSeed,
    people: applyEditorialAssignmentsToCollection(unifiedSeed.people, editorialAssignmentsByEntityId),
    texts: applyEditorialAssignmentsToCollection(unifiedSeed.texts, editorialAssignmentsByEntityId),
    concepts: applyEditorialAssignmentsToCollection(
      unifiedSeed.concepts,
      editorialAssignmentsByEntityId,
    ),
    events: applyEditorialAssignmentsToCollection(unifiedSeed.events, editorialAssignmentsByEntityId),
    places: applyEditorialAssignmentsToCollection(unifiedSeed.places, editorialAssignmentsByEntityId),
    institutions: applyEditorialAssignmentsToCollection(
      unifiedSeed.institutions,
      editorialAssignmentsByEntityId,
    ),
    traditions: applyEditorialAssignmentsToCollection(
      unifiedSeed.traditions,
      editorialAssignmentsByEntityId,
    ),
  };

  return {
    seed: editorializedSeed,
    index: buildSeedIndex(editorializedSeed),
    effectiveCanonicalEntitiesById: new Map(
      effectiveCanonicalEntities.map((entity) => [entity.canonical.id, entity]),
    ),
    sourceRecordsById,
  };
};

export function useUnifiedHistoricalRuntime(): UnifiedHistoricalRuntimeData {
  const [snapshot, setSnapshot] = useState<HistoricalEntityGraphSnapshot | undefined>(undefined);
  const [driveTrialData, setDriveTrialData] = useState<DriveTrialData | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const overridesByEntityId = useAdminStore((state) => state.overridesByEntityId);
  const editorialAssignmentsByEntityId = useAdminStore(
    (state) => state.editorialAssignmentsByEntityId,
  );
  const isAdminMode = useAdminStore((state) => state.isAdminMode);
  const showDraftEntities = useAdminStore((state) => state.showDraftEntities);

  useEffect(() => {
    let isMounted = true;

    const loadSnapshot = async () => {
      try {
        const response = await fetch(SNAPSHOT_URL, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Historical snapshot unavailable (${response.status})`);
        }

        const nextSnapshot = (await response.json()) as HistoricalEntityGraphSnapshot;
        if (isMounted) {
          setSnapshot(nextSnapshot);
          setError(undefined);
        }
      } catch (loadError) {
        if (isMounted) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load historical snapshot");
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    void loadSnapshot();
    const intervalId = window.setInterval(() => {
      void loadSnapshot();
    }, SNAPSHOT_REFRESH_MS);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadDriveTrialData = async () => {
      const [indexResult, semanticResult] = await Promise.allSettled([
        fetch(DRIVE_INDEX_URL, { cache: "no-store" }).then((response) =>
          response.ok ? (response.json() as Promise<DriveIndexPayload>) : undefined,
        ),
        fetch(DRIVE_SEMANTIC_URL, { cache: "no-store" }).then((response) =>
          response.ok ? (response.json() as Promise<DriveSemanticPayload>) : undefined,
        ),
      ]);

      if (!isMounted) return;

      setDriveTrialData({
        index: indexResult.status === "fulfilled" ? indexResult.value : undefined,
        semantic: semanticResult.status === "fulfilled" ? semanticResult.value : undefined,
      });
    };

    void loadDriveTrialData();

    return () => {
      isMounted = false;
    };
  }, []);

  return useMemo(() => {
    const { seed, index, effectiveCanonicalEntitiesById, sourceRecordsById } = buildUnifiedSeed(
      snapshot,
      driveTrialData,
      overridesByEntityId,
      editorialAssignmentsByEntityId,
      isAdminMode,
      showDraftEntities,
    );

    return {
      seed,
      index,
      loading,
      error,
      snapshot,
      effectiveCanonicalEntitiesById,
      sourceRecordsById,
      isHistoricalEntity: (entityId) => Boolean(entityId && effectiveCanonicalEntitiesById.has(entityId)),
      getEffectiveCanonicalEntity: (entityId) =>
        entityId ? effectiveCanonicalEntitiesById.get(entityId) : undefined,
      getContributingSourceRecords: (entityId) =>
        entityId
          ? effectiveCanonicalEntitiesById
              .get(entityId)
              ?.contributingSourceRecords ?? []
          : [],
    } satisfies UnifiedHistoricalRuntimeData;
  }, [
    editorialAssignmentsByEntityId,
    driveTrialData,
    error,
    isAdminMode,
    loading,
    overridesByEntityId,
    showDraftEntities,
    snapshot,
  ]);
}
