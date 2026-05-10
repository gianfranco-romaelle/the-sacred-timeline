import type { CanonicalEntityType, DomainId, KnowledgeEntityId, TraditionId } from "@/types";

export type GroupByMode = "calculus" | "era" | "domain" | "tradition" | "field" | "country";

export interface RawLifespanEntry {
  name: string | null;
  birth_year: number | null;
  death_year: number | null;
  lifespan_raw: string | null;
  country: string | null;
  field: string | null;
  calculus_number: number | null;
  calculus_name: string | null;
  portrait_url: string | null;
}

/** Normalized, validated representation of a single lifespan bar. */
export interface LifespanBar {
  id: string;
  name: string;
  startYear: number;
  endYear: number;
  /** true when death_year was null — bar extends to present */
  isOpenEnded: boolean;
  displayText: string;
  country: string | null;
  field: string | null;
  calculusNumber: number | null;
  calculusName: string | null;
  entityId?: KnowledgeEntityId;
  entityType?: CanonicalEntityType;
  domainIds: DomainId[];
  domainLabels: string[];
  traditionIds: TraditionId[];
  traditionLabels: string[];
  portraitUrl: string | null;
  /** Assigned by lane-packing; 0 = topmost lane */
  lane: number;
}

export interface LifelinesGroup {
  calculusNumber: number | null;
  calculusName: string;
  bars: LifespanBar[];
  laneCount: number;
  startYear: number;
  endYear: number;
  /** Assigned by the view layer based on groupBy mode and palette. */
  color?: string;
}

export interface LifelinesProjection {
  groups: LifelinesGroup[];
  globalStartYear: number;
  globalEndYear: number;
  totalBars: number;
}
