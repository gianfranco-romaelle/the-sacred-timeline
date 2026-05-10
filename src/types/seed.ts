import type { CitationRecord, SourceRecord } from "./citations";
import type {
  Concept,
  Event,
  Institution,
  Person,
  Place,
  Text,
  Tradition,
} from "./entities";
import type { MediaAsset, PortraitAsset } from "./media";
import type { Edge } from "./relations";
import type { DomainDefinition, TagDefinition } from "./taxonomy";

export interface SeedMeta {
  datasetId: string;
  title: string;
  description: string;
  version: string;
  generatedAt: string;
  defaultLocale?: string;
  license?: string;
}

export interface SacredTimelineSeedData {
  meta: SeedMeta;
  domains: DomainDefinition[];
  tags: TagDefinition[];
  sources: SourceRecord[];
  citations: CitationRecord[];
  portraitAssets: PortraitAsset[];
  mediaAssets?: MediaAsset[];
  people: Person[];
  texts: Text[];
  concepts: Concept[];
  events: Event[];
  places: Place[];
  institutions: Institution[];
  traditions: Tradition[];
  edges: Edge[];
}
