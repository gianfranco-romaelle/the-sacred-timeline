import type {
  DomainId,
  EmbeddingDescriptorId,
  JsonObject,
  JsonValue,
  PersonId,
  RecordId,
  SemanticClusterId,
  StyleGroupId,
  TagId,
  TraditionId,
} from "@/types";

export type HistoricalSourceKind =
  | "sacred_timeline_enriched"
  | "wikipedia_jobs"
  | "manual_override";

export type SourceRecordType =
  | "curated_person"
  | "wikipedia_person_job"
  | "manual_override";

export type CanonicalFieldKey =
  | "displayName"
  | "aliases"
  | "birthYear"
  | "deathYear"
  | "summary"
  | "domainIds"
  | "traditionIds"
  | "tagIds"
  | "preferredPortrait"
  | "mergeNotes"
  | "curatorNotes";

export type MergeStatus =
  | "singleton"
  | "auto_merged"
  | "needs_review"
  | "manual_merged"
  | "conflict";

export type ReviewStatus = "unreviewed" | "reviewed" | "draft" | "hidden";

export type CanonicalVisibility = "public" | "draft" | "hidden";

export type FieldPrecedence =
  | "merged"
  | "manual_override"
  | HistoricalSourceKind;

export type ProvenanceLayer = "raw" | "normalized" | "merged" | "override";

export type SourceRecordId = `source_record_${string}`;
export type CandidateId = `candidate_${string}`;
export type MergeDecisionId = `merge_${string}`;
export type MergeDirectiveId = `directive_${string}`;
export type SourceMediaId = `source_media_${string}`;
export type MergeSignalKind =
  | "exact_external_id"
  | "wikidata_match"
  | "exact_name"
  | "alias_overlap"
  | "surname_match"
  | "birth_year_match"
  | "death_year_match"
  | "date_near_match"
  | "domain_overlap"
  | "place_overlap"
  | "name_conflict"
  | "date_conflict";
export type ConflictSeverity = "low" | "medium" | "high";

export interface ProvenanceEntry {
  id: string;
  field: CanonicalFieldKey;
  layer: ProvenanceLayer;
  sourceKind: HistoricalSourceKind | "manual_override";
  sourceRecordId?: SourceRecordId;
  valueLabel?: string;
  confidence?: number;
  note?: string;
  path?: string;
  createdAt?: string;
}

export interface SourceFieldValue<TValue = JsonValue> {
  field: CanonicalFieldKey;
  value: TValue;
  sourceRecordId: SourceRecordId;
  sourceKind: HistoricalSourceKind;
  confidence: number;
  note?: string;
  rawPath?: string;
}

export interface MergeSignal {
  kind: MergeSignalKind;
  label: string;
  score: number;
}

export interface FieldConflict {
  field: CanonicalFieldKey;
  severity: ConflictSeverity;
  distinctValueLabels: string[];
  sourceRecordIds: SourceRecordId[];
  note?: string;
}

export interface SourceMediaCandidate {
  id: SourceMediaId;
  sourceRecordId: SourceRecordId;
  label: string;
  kind: "portrait";
  localAssetPath?: string;
  publicAssetPath?: string;
  originalUrl?: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  attribution?: string;
  isPreferred?: boolean;
  embeddingDescriptorIds?: EmbeddingDescriptorId[];
  clusterIds?: SemanticClusterId[];
  styleGroupIds?: StyleGroupId[];
  similarityNeighborIds?: RecordId[];
  metadata?: JsonObject;
}

export interface SourceRecord {
  id: SourceRecordId;
  kind: HistoricalSourceKind;
  recordType: SourceRecordType;
  externalId?: string;
  title: string;
  displayName: string;
  slug: string;
  sourcePath?: string;
  articlePath?: string;
  citationsPath?: string;
  imagePath?: string;
  wikipediaTitle?: string;
  wikipediaUrl?: string;
  wikidataId?: string;
  status?: string;
  description?: string;
  summary?: string;
  birthYear?: number | null;
  deathYear?: number | null;
  aliases: string[];
  normalizedDisplayName?: string;
  domainHints: string[];
  traditionHints: string[];
  placeHints: string[];
  rawFields: Record<string, JsonValue>;
  fieldValues: SourceFieldValue[];
  portraitCandidates: SourceMediaCandidate[];
  confidence?: number;
}

export interface EntityCandidate {
  id: CandidateId;
  entityType: "person";
  displayName: string;
  normalizedName: string;
  aliases: string[];
  normalizedAliases: string[];
  nameTokens: string[];
  birthYear?: number | null;
  deathYear?: number | null;
  summary?: string;
  wikipediaTitle?: string;
  wikipediaSlug?: string;
  wikidataId?: string;
  domainIds: DomainId[];
  traditionIds: TraditionId[];
  tagIds: TagId[];
  relatedTextLabels: string[];
  relatedPlaceLabels: string[];
  sourceRecordIds: SourceRecordId[];
  portraitCandidates: SourceMediaCandidate[];
  confidence: number;
  mergeSignals: MergeSignal[];
  metadata?: JsonObject;
}

export interface CanonicalResolvedField<TValue> {
  mergedValue?: TValue;
  effectiveValue?: TValue;
  precedence: FieldPrecedence;
  values: SourceFieldValue<TValue>[];
  provenance: ProvenanceEntry[];
  conflict?: boolean;
}

export interface CanonicalEntity {
  id: PersonId;
  entityType: "person";
  slug: string;
  mergeStatus: MergeStatus;
  reviewStatus: ReviewStatus;
  visibility: CanonicalVisibility;
  mergeConfidence: number;
  mergeSignals: MergeSignal[];
  fieldConflicts: FieldConflict[];
  displayName: CanonicalResolvedField<string>;
  aliases: CanonicalResolvedField<string[]>;
  birthYear: CanonicalResolvedField<number | null>;
  deathYear: CanonicalResolvedField<number | null>;
  summary: CanonicalResolvedField<string>;
  domainIds: CanonicalResolvedField<DomainId[]>;
  traditionIds: CanonicalResolvedField<TraditionId[]>;
  tagIds: CanonicalResolvedField<TagId[]>;
  preferredPortrait: CanonicalResolvedField<string | null>;
  sourceRecordIds: SourceRecordId[];
  relatedTextLabels: string[];
  relatedPlaceLabels: string[];
  portraitCandidates: SourceMediaCandidate[];
  mergeNotes?: string;
  curatorNotes?: string;
  rawCandidateIds: CandidateId[];
  updatedAt: string;
  metadata?: JsonObject;
}

export interface CanonicalEntityOverride {
  entityId: PersonId;
  displayName?: string;
  aliases?: string[];
  birthYear?: number | null;
  deathYear?: number | null;
  summary?: string;
  domainIds?: DomainId[];
  traditionIds?: TraditionId[];
  tagIds?: TagId[];
  preferredPortrait?: string | null;
  mergeNotes?: string;
  curatorNotes?: string;
  reviewStatus?: ReviewStatus;
  visibility?: CanonicalVisibility;
  fieldPrecedence?: Partial<Record<CanonicalFieldKey, FieldPrecedence>>;
  sourceInclusions?: SourceRecordId[];
  sourceExclusions?: SourceRecordId[];
  reviewed?: boolean;
  updatedAt: string;
}

export interface MergeDecision {
  id: MergeDecisionId;
  canonicalEntityId: PersonId;
  sourceRecordIds: SourceRecordId[];
  status: MergeStatus;
  confidence: number;
  rationale: string[];
  notes?: string;
  unresolvedFields: CanonicalFieldKey[];
}

export interface MergeDirective {
  id: MergeDirectiveId;
  type: "mark_same_person" | "unmerge_source_record";
  canonicalEntityId: PersonId;
  relatedCanonicalEntityId?: PersonId;
  sourceRecordId?: SourceRecordId;
  note?: string;
  status: "staged" | "applied";
  createdAt: string;
}

export interface HistoricalSnapshotSummary {
  curatedRecordCount: number;
  wikipediaRecordCount: number;
  candidateCount: number;
  canonicalEntityCount: number;
  publicEntityCount: number;
  draftEntityCount: number;
}

export interface HistoricalEntityGraphSnapshot {
  generatedAt: string;
  sourcePaths: {
    curatedMasterPath: string;
    wikipediaJobsPath: string;
    wikipediaRecordsPath: string;
    wikipediaImagesPath?: string;
    wikipediaArticlesPath?: string;
    wikipediaCitationsPath?: string;
    imageOutputDir: string;
  };
  summary: HistoricalSnapshotSummary;
  sourceRecords: SourceRecord[];
  candidates: EntityCandidate[];
  mergeDecisions: MergeDecision[];
  canonicalEntities: CanonicalEntity[];
}

export interface EffectiveCanonicalEntity {
  canonical: CanonicalEntity;
  override?: CanonicalEntityOverride;
  effectiveDisplayName: string;
  effectiveAliases: string[];
  effectiveBirthYear?: number | null;
  effectiveDeathYear?: number | null;
  effectiveSummary: string;
  effectiveDomainIds: DomainId[];
  effectiveTraditionIds: TraditionId[];
  effectiveTagIds: TagId[];
  effectivePreferredPortrait?: SourceMediaCandidate;
  effectiveVisibility: CanonicalVisibility;
  effectiveReviewStatus: ReviewStatus;
  hasOverrides: boolean;
  fieldConflicts: FieldConflict[];
  contributingSourceRecords: SourceRecord[];
}
