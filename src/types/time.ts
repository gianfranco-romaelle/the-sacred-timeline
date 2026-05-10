export type HistoricalDatePrecision = "year" | "month" | "day";

export type HistoricalDateQualifier =
  | "exact"
  | "approximate"
  | "circa"
  | "before"
  | "after"
  | "inferred"
  | "disputed";

export type TimeRangeKind = "instant" | "range" | "lifespan" | "floruit";
export type TimeCertainty = "certain" | "probable" | "possible" | "disputed";

export interface HistoricalDatePoint {
  year: number;
  month?: number;
  day?: number;
  precision: HistoricalDatePrecision;
  qualifier?: HistoricalDateQualifier;
  label?: string;
}

export interface HistoricalDateBound {
  date?: HistoricalDatePoint;
  qualifier?: HistoricalDateQualifier;
  note?: string;
}

export interface HistoricalDateRange {
  kind: TimeRangeKind;
  start?: HistoricalDateBound;
  end?: HistoricalDateBound;
  isOngoing?: boolean;
  certainty?: TimeCertainty;
  displayLabel?: string;
  note?: string;
  sortStartYear?: number;
  sortEndYear?: number;
}
