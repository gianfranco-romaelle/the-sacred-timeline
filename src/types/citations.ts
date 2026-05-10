import type {
  DomainId,
  JsonObject,
  KnowledgeEntityId,
  MediaAssetId,
  SourceId,
  TagId,
  CitationId,
} from "./primitives";
import type { EmbeddingMetadata } from "./embeddings";
import type { HistoricalDateRange } from "./time";

export type SourceType =
  | "primary"
  | "secondary"
  | "reference"
  | "edition"
  | "manuscript"
  | "article"
  | "book"
  | "letter"
  | "catalog";

export interface SourceRecord {
  id: SourceId;
  recordType: "source";
  slug: string;
  label: string;
  title?: string;
  description: string;
  sourceType: SourceType;
  authors: string[];
  editors?: string[];
  dateRange?: HistoricalDateRange;
  publisher?: string;
  publicationPlace?: string;
  languageCodes?: string[];
  url?: string;
  isbn?: string;
  doi?: string;
  domainIds: DomainId[];
  tagIds: TagId[];
  relatedEntityIds: KnowledgeEntityId[];
  mediaAssetIds: MediaAssetId[];
  embedding?: EmbeddingMetadata;
  metadata?: JsonObject;
}

export type CitationLocatorKind =
  | "page"
  | "pages"
  | "folio"
  | "chapter"
  | "section"
  | "line"
  | "paragraph"
  | "entry";

export interface CitationLocator {
  kind: CitationLocatorKind;
  value: string;
}

export interface CitationRecord {
  id: CitationId;
  recordType: "citation";
  sourceId: SourceId;
  label: string;
  description: string;
  quotedText?: string;
  locator?: CitationLocator;
  dateRange?: HistoricalDateRange;
  domainIds: DomainId[];
  tagIds: TagId[];
  relatedEntityIds: KnowledgeEntityId[];
  mediaAssetIds: MediaAssetId[];
  embedding?: EmbeddingMetadata;
  metadata?: JsonObject;
}
