import type {
  CanonicalEntityType,
  CitationId,
  ConceptId,
  DomainId,
  EventId,
  InstitutionId,
  JsonObject,
  KnowledgeEntityId,
  MediaAssetId,
  PersonId,
  PlaceId,
  TagId,
  TextId,
  TraditionId,
} from "./primitives";
import type { EmbeddingMetadata } from "./embeddings";
import type { HistoricalDateRange } from "./time";

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface PlaceGeometry {
  point?: GeoPoint;
  bbox?: [number, number, number, number];
  note?: string;
}

export interface EntityBase<TType extends CanonicalEntityType, TId extends KnowledgeEntityId> {
  id: TId;
  entityType: TType;
  slug: string;
  label: string;
  title?: string;
  description: string;
  alternateLabels?: string[];
  dateRange?: HistoricalDateRange;
  domainIds: DomainId[];
  tagIds: TagId[];
  citationIds: CitationId[];
  relatedEntityIds: KnowledgeEntityId[];
  mediaAssetIds: MediaAssetId[];
  embedding?: EmbeddingMetadata;
  metadata?: JsonObject;
}

export type PersonRole =
  | "scientist"
  | "theologian"
  | "philosopher"
  | "mathematician"
  | "astronomer"
  | "physician"
  | "abbess"
  | "monk"
  | "translator"
  | "cleric";

export interface Person extends EntityBase<"person", PersonId> {
  roles: PersonRole[];
  birthPlaceId?: PlaceId;
  deathPlaceId?: PlaceId;
  institutionIds: InstitutionId[];
  traditionIds: TraditionId[];
  textIds: TextId[];
}

export type TextType =
  | "treatise"
  | "scripture"
  | "commentary"
  | "letter"
  | "translation"
  | "visionary_work"
  | "trial_record"
  | "book"
  | "manuscript";

export interface Text extends EntityBase<"text", TextId> {
  textType: TextType;
  authorIds: PersonId[];
  contributorIds: KnowledgeEntityId[];
  languageCodes: string[];
  institutionIds: InstitutionId[];
  traditionIds: TraditionId[];
  placeIds: PlaceId[];
  conceptIds: ConceptId[];
  sourceTextId?: TextId;
}

export type ConceptType =
  | "discipline"
  | "theory"
  | "doctrine"
  | "method"
  | "controversy"
  | "practice";

export interface Concept extends EntityBase<"concept", ConceptId> {
  conceptType: ConceptType;
  broaderConceptId?: ConceptId;
  traditionIds: TraditionId[];
  textIds: TextId[];
}

export type EventType =
  | "publication"
  | "discovery"
  | "trial"
  | "council"
  | "debate"
  | "foundation"
  | "translation"
  | "correspondence"
  | "observation";

export interface Event extends EntityBase<"event", EventId> {
  eventType: EventType;
  participantIds: KnowledgeEntityId[];
  placeIds: PlaceId[];
  institutionIds: InstitutionId[];
  textIds: TextId[];
  conceptIds: ConceptId[];
}

export type PlaceType =
  | "city"
  | "region"
  | "country"
  | "empire"
  | "site"
  | "monastery"
  | "court"
  | "observatory";

export interface Place extends EntityBase<"place", PlaceId> {
  placeType: PlaceType;
  geometry?: PlaceGeometry;
  parentPlaceId?: PlaceId;
}

export type InstitutionType =
  | "abbey"
  | "monastery"
  | "university"
  | "academy"
  | "court"
  | "library"
  | "school"
  | "observatory"
  | "church";

export interface Institution extends EntityBase<"institution", InstitutionId> {
  institutionType: InstitutionType;
  placeIds: PlaceId[];
  founderIds: KnowledgeEntityId[];
  traditionIds: TraditionId[];
}

export type TraditionType =
  | "religious"
  | "scientific"
  | "philosophical"
  | "intellectual"
  | "monastic";

export interface Tradition extends EntityBase<"tradition", TraditionId> {
  traditionType: TraditionType;
  parentTraditionId?: TraditionId;
  placeIds: PlaceId[];
  institutionIds: InstitutionId[];
  conceptIds: ConceptId[];
}

export type KnowledgeEntity =
  | Person
  | Text
  | Concept
  | Event
  | Place
  | Institution
  | Tradition;
