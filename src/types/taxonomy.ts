import type { DomainId, TagId } from "./primitives";

export type DomainKind =
  | "science"
  | "religion"
  | "philosophy"
  | "mathematics"
  | "astronomy"
  | "medicine"
  | "theology"
  | "mysticism"
  | "transmission"
  | "history";

export interface DomainDefinition {
  id: DomainId;
  slug: string;
  label: string;
  description: string;
  kind: DomainKind;
  parentDomainId?: DomainId;
  colorToken?: string;
}

export type TagCategory =
  | "discipline"
  | "period"
  | "theme"
  | "tradition"
  | "method"
  | "language"
  | "region"
  | "institutional_type"
  | "event_type";

export interface TagDefinition {
  id: TagId;
  slug: string;
  label: string;
  description: string;
  category: TagCategory;
  parentTagId?: TagId;
  domainIds: DomainId[];
}
