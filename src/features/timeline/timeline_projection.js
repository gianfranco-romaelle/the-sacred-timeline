import { getSearchText, yearLabel } from "@/features/timeline/timeline_data_loader";

export function buildChronoSafeDate(item, yearOffset) {
  const safeYear = Math.max(1, item.startYear + yearOffset);
  return `${String(safeYear).padStart(4, "0")}-01-01`;
}

export function buildTicks(minYear, maxYear, step) {
  const ticks = [];
  const start = Math.floor(minYear / step) * step;
  for (let year = start; year <= maxYear; year += step) ticks.push(year);
  return ticks;
}

export function collectTimelineFilterOptions(items) {
  return {
    categories: [...new Set(items.map((item) => item.category))].sort(),
    schools: [...new Set(items.map((item) => item.school))].sort(),
    periods: [...new Set(items.map((item) => item.historicalPeriod))].sort(),
    eras: ["Ancient", "Classical / Late Antiquity", "Medieval", "Early Modern", "Modern", "Contemporary"],
  };
}

export function countActiveTimelineFilters(filters) {
  return filters.typeFilter.length
    + filters.eraFilter.length
    + filters.categoryFilter.length
    + filters.schoolFilter.length
    + filters.periodFilter.length;
}

export function buildFilteredTimelineItems(items, filters) {
  const normalizedQuery = filters.query.trim().toLowerCase();
  return items
    .filter((item) => {
      const queryOk = !normalizedQuery || getSearchText(item).includes(normalizedQuery);
      const typeOk = filters.typeFilter.length === 0 || filters.typeFilter.includes(item.type);
      const eraOk = filters.eraFilter.length === 0 || filters.eraFilter.includes(item.era);
      const categoryOk = filters.categoryFilter.length === 0 || filters.categoryFilter.includes(item.category);
      const schoolOk = filters.schoolFilter.length === 0 || filters.schoolFilter.includes(item.school);
      const periodOk = filters.periodFilter.length === 0 || filters.periodFilter.includes(item.historicalPeriod);
      return queryOk && typeOk && eraOk && categoryOk && schoolOk && periodOk;
    })
    .sort((a, b) => a.sortYear - b.sortYear || a.endYear - b.endYear);
}

export function getChronoYearOffset(items) {
  if (items.length === 0) return 1;
  const minYear = items.reduce((lowest, item) => Math.min(lowest, item.startYear), items[0].startYear);
  return minYear <= 0 ? Math.abs(minYear) + 1 : 0;
}

export function buildChronoItems(items, yearOffset, buildItemDetailText) {
  return items.map((item) => ({
    id: item.id,
    title: yearLabel(item.startYear),
    cardTitle: item.name,
    cardSubtitle: item.startYear === item.endYear || item.endYear == null
      ? yearLabel(item.startYear)
      : `${yearLabel(item.startYear)} -> ${yearLabel(item.endYear)}`,
    cardDetailedText: buildItemDetailText(item),
    media: item.images?.[0]
      ? {
          type: "IMAGE",
          source: {
            url: item.images[0],
          },
          name: item.name,
        }
      : undefined,
    date: buildChronoSafeDate(item, yearOffset),
  }));
}
