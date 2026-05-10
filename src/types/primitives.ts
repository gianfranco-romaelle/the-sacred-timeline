export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export type DomainId = `domain_${string}`;
export type TagId = `tag_${string}`;

export type PersonId = `person_${string}`;
export type TextId = `text_${string}`;
export type ConceptId = `concept_${string}`;
export type EventId = `event_${string}`;
export type PlaceId = `place_${string}`;
export type InstitutionId = `institution_${string}`;
export type TraditionId = `tradition_${string}`;

export type PortraitAssetId = `portrait_${string}`;
export type MediaAssetId = PortraitAssetId | `media_${string}`;

export type SourceId = `source_${string}`;
export type CitationId = `citation_${string}`;
export type EdgeId = `edge_${string}`;
export type EmbeddingDescriptorId = `embedding_${string}`;
export type EmbeddingJobId = `embedding_job_${string}`;
export type SemanticClusterId = `cluster_${string}`;
export type StyleGroupId = `style_${string}`;

export type CanonicalEntityType =
  | "person"
  | "text"
  | "concept"
  | "event"
  | "place"
  | "institution"
  | "tradition";

export type KnowledgeEntityId =
  | PersonId
  | TextId
  | ConceptId
  | EventId
  | PlaceId
  | InstitutionId
  | TraditionId;

export type RecordId =
  | KnowledgeEntityId
  | MediaAssetId
  | SourceId
  | CitationId
  | EdgeId;
