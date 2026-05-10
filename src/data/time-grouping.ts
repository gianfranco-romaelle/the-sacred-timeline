import type { HistoricalDateRange, KnowledgeEntity } from "@/types";

export interface TimeGroup<TItem> {
  key: string;
  label: string;
  startYear?: number;
  endYear?: number;
  items: TItem[];
}

export const getPrimaryYearFromDateRange = (dateRange?: HistoricalDateRange) => {
  if (!dateRange) return undefined;
  if (typeof dateRange.sortStartYear === "number") return dateRange.sortStartYear;
  return dateRange.start?.date?.year ?? dateRange.end?.date?.year;
};

export const getRangeEndYear = (dateRange?: HistoricalDateRange) => {
  if (!dateRange) return undefined;
  if (typeof dateRange.sortEndYear === "number") return dateRange.sortEndYear;
  return dateRange.end?.date?.year ?? dateRange.start?.date?.year;
};

export const sortEntitiesChronologically = (entities: KnowledgeEntity[]) =>
  [...entities].sort((left, right) => {
    const leftYear = getPrimaryYearFromDateRange(left.dateRange) ?? Number.POSITIVE_INFINITY;
    const rightYear = getPrimaryYearFromDateRange(right.dateRange) ?? Number.POSITIVE_INFINITY;
    if (leftYear === rightYear) return left.label.localeCompare(right.label);
    return leftYear - rightYear;
  });

export const getCenturyLabel = (year: number) => {
  const absoluteYear = Math.abs(year);
  const century = Math.floor((absoluteYear - 1) / 100) + 1;
  return year <= 0 ? `${century}th century BCE` : `${century}th century`;
};

export const getEraBucket = (year: number) => {
  if (year < 500) return { key: "ancient", label: "Ancient World" };
  if (year < 1500) return { key: "medieval", label: "Medieval World" };
  if (year < 1800) return { key: "early-modern", label: "Early Modern" };
  return { key: "modern", label: "Modern World" };
};

export const groupEntitiesByCentury = (
  entities: KnowledgeEntity[],
): TimeGroup<KnowledgeEntity>[] => {
  const groups = new Map<string, TimeGroup<KnowledgeEntity>>();

  for (const entity of sortEntitiesChronologically(entities)) {
    const year = getPrimaryYearFromDateRange(entity.dateRange);
    const key = typeof year === "number" ? `century_${getCenturyLabel(year)}` : "undated";
    const label = typeof year === "number" ? getCenturyLabel(year) : "Undated";
    const current =
      groups.get(key) ??
      ({
        key,
        label,
        startYear: year,
        endYear: getRangeEndYear(entity.dateRange),
        items: [],
      } satisfies TimeGroup<KnowledgeEntity>);

    current.items.push(entity);
    groups.set(key, current);
  }

  return Array.from(groups.values());
};

export const groupEntitiesByEra = (entities: KnowledgeEntity[]): TimeGroup<KnowledgeEntity>[] => {
  const groups = new Map<string, TimeGroup<KnowledgeEntity>>();

  for (const entity of sortEntitiesChronologically(entities)) {
    const year = getPrimaryYearFromDateRange(entity.dateRange);
    const bucket =
      typeof year === "number"
        ? getEraBucket(year)
        : { key: "undated", label: "Undated" };
    const current =
      groups.get(bucket.key) ??
      ({
        key: bucket.key,
        label: bucket.label,
        startYear: year,
        endYear: getRangeEndYear(entity.dateRange),
        items: [],
      } satisfies TimeGroup<KnowledgeEntity>);

    current.items.push(entity);
    groups.set(bucket.key, current);
  }

  return Array.from(groups.values());
};
