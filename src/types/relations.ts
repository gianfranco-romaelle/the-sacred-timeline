import type {
  CitationId,
  DomainId,
  EdgeId,
  JsonObject,
  KnowledgeEntityId,
  MediaAssetId,
  RecordId,
  TagId,
} from "./primitives";
import type { EmbeddingMetadata } from "./embeddings";
import type { HistoricalDateRange } from "./time";
import type { AssertionLayer } from "./provenance";

export type EdgeRelationType =
  | "influenced"
  | "taught"
  | "commented_on"
  | "translated"
  | "debated"
  | "founded"
  | "discovered"
  | "published"
  | "corresponded_with"
  | "associated_with"
  | "member_of"
  | "cited_in"
  | "published_by"
  | "developed_concept"
  | "mathematical_generalization_of"
  | "philosophical_transformation_of"
  | "symbolic_analogue_of"
  | "preserved_in_tradition"
  | "part_of_series"
  | "opposed"
  | "located_at"
  | "active_during";

export type EdgeDirection = "directed" | "undirected" | "bidirectional";
export type EdgeCertainty = "certain" | "probable" | "possible" | "disputed";

export interface Edge {
  id: EdgeId;
  recordType: "edge";
  relationType: EdgeRelationType;
  label: string;
  description: string;
  sourceId: RecordId;
  targetId: RecordId;
  direction: EdgeDirection;
  dateRange?: HistoricalDateRange;
  domainIds: DomainId[];
  tagIds: TagId[];
  citationIds: CitationId[];
  relatedEntityIds: KnowledgeEntityId[];
  mediaAssetIds: MediaAssetId[];
  embedding?: EmbeddingMetadata;
  certainty?: EdgeCertainty;
  weight?: number;
  metadata?: JsonObject;
  assertionLayer?: AssertionLayer;
}
