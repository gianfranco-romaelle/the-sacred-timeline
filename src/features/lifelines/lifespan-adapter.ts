import type { SeedIndex } from "@/data/entity-index";
import type { KnowledgeEntity } from "@/types";
import type { GroupByMode, LifelinesGroup, LifelinesProjection, LifespanBar, RawLifespanEntry } from "./types";

const PRESENT_YEAR = new Date().getFullYear();

const normalizeNameKey = (value: string | null | undefined) =>
  (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();

const assertNever = (value: never): never => {
  throw new Error(`Unhandled lifelines grouping mode: ${String(value)}`);
};

function buildEntityNameIndex(index?: SeedIndex) {
  const map = new Map<string, KnowledgeEntity>();
  if (!index) return map;

  for (const entity of index.entitiesById.values()) {
    const labels = [entity.label, entity.title, ...(entity.alternateLabels ?? [])];
    for (const label of labels) {
      const key = normalizeNameKey(label);
      if (key && !map.has(key)) {
        map.set(key, entity);
      }
    }
  }

  return map;
}

function getDomainLabels(entity: KnowledgeEntity | undefined, index?: SeedIndex) {
  if (!entity || !index) return [];
  return entity.domainIds
    .map((id) => index.domainsById.get(id)?.label)
    .filter((label): label is string => Boolean(label));
}

function getTraditionLabels(entity: KnowledgeEntity | undefined, index?: SeedIndex) {
  if (!entity || !index) return [];
  const traditionIds = "traditionIds" in entity ? entity.traditionIds : [];
  return traditionIds
    .map((id) => index.entitiesById.get(id)?.label)
    .filter((label): label is string => Boolean(label));
}

/**
 * Tries to extract an approximate death year from a `lifespan_raw` string
 * such as "c. 170–c. 270" when `death_year` is null in the database.
 * Splits on en-dash / em-dash only (not hyphen, which appears in negative years).
 * Returns null if the death part contains "present", "ongoing", etc., or can't be parsed.
 */
function parseApproxDeathYear(raw: string | null | undefined, birthYear: number): number | null {
  if (!raw) return null;
  const clean = raw.trim();
  if (!clean || clean.toLowerCase() === "nan") return null;

  // Split on en-dash (–) or em-dash (—), NOT on hyphen-minus
  const parts = clean.split(/[–—]/).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;

  const deathPart = parts[parts.length - 1];

  if (/\b(present|ongoing|now|active|living)\b/i.test(deathPart)) return null;

  const bce = /\bBCE?\b|\bB\.C\b/i.test(deathPart);
  const match = deathPart.match(/\d+/);
  if (!match) return null;

  let year = parseInt(match[0], 10);
  if (!Number.isFinite(year)) return null;
  if (bce && year > 0) year = -year;

  return year > birthYear ? year : null;
}

/** Returns null when the entry lacks a usable birth year. */
function adaptEntry(
  entry: RawLifespanEntry,
  index: number,
  entityNameIndex: Map<string, KnowledgeEntity>,
  seedIndex?: SeedIndex,
): LifespanBar | null {
  if (entry.birth_year == null || !Number.isFinite(entry.birth_year)) return null;

  const startYear = entry.birth_year;

  let endYear: number;
  let isOpenEnded: boolean;

  if (entry.death_year != null && Number.isFinite(entry.death_year)) {
    endYear = entry.death_year;
    isOpenEnded = false;
  } else {
    // death_year absent — try to recover an approximate date from lifespan_raw
    const approx = parseApproxDeathYear(entry.lifespan_raw, startYear);
    if (approx !== null) {
      endYear = approx;
      isOpenEnded = false;
    } else {
      endYear = PRESENT_YEAR;
      isOpenEnded = true;
    }
  }

  if (endYear < startYear) return null;
  // Drop implausibly long modern lifespans (data error, not ancient uncertainty)
  if (!isOpenEnded && startYear > -1600 && endYear - startYear > 140) return null;

  const raw = entry.portrait_url;
  const portraitUrl =
    raw && raw.trim().length > 0 && raw.trim().toLowerCase() !== "picture" ? raw.trim() : null;

  const rawLifespan = entry.lifespan_raw?.trim() ?? "";
  const cleanedRaw =
    rawLifespan.length > 0 && rawLifespan.toLowerCase() !== "nan" ? rawLifespan : null;

  const displayText =
    cleanedRaw ??
    `${startYear < 0 ? `${Math.abs(startYear)} BCE` : startYear} – ${
      isOpenEnded ? "present" : endYear < 0 ? `${Math.abs(endYear)} BCE` : endYear
    }`;

  const name = entry.name?.trim() || `Unknown (b. ${startYear})`;
  const matchedEntity = entityNameIndex.get(normalizeNameKey(name));
  const domainIds = matchedEntity?.domainIds ?? [];
  const traditionIds =
    matchedEntity && "traditionIds" in matchedEntity ? matchedEntity.traditionIds : [];

  return {
    id: `ll-${index}`,
    name,
    startYear,
    endYear,
    isOpenEnded,
    displayText,
    country: entry.country?.trim() || null,
    field: entry.field?.trim() || null,
    calculusNumber: entry.calculus_number ?? null,
    calculusName: entry.calculus_name?.trim() || null,
    entityId: matchedEntity?.id,
    entityType: matchedEntity?.entityType,
    domainIds,
    domainLabels: getDomainLabels(matchedEntity, seedIndex),
    traditionIds,
    traditionLabels: getTraditionLabels(matchedEntity, seedIndex),
    portraitUrl,
    lane: 0,
  };
}

// ── Grouping helpers ──────────────────────────────────────────────────────────

function eraLabel(century: number): string {
  if (century < 0) return `${Math.abs(century)}–${Math.abs(century + 99)} BCE`;
  if (century === 0) return "1–99 CE";
  return `${century}s`;
}

interface GroupSpec {
  key: string;
  label: string;
  sortKey: number | string;
  calculusNumber: number | null;
}

function getGroupSpec(bar: LifespanBar, mode: GroupByMode): GroupSpec {
  switch (mode) {
    case "calculus": {
      const n = bar.calculusNumber;
      const k = String(n ?? "null");
      const label =
        n === null
          ? "Unassigned"
          : bar.calculusName
            ? `${bar.calculusName} (Stage ${n})`
            : `Stage ${n}`;
      return { key: k, label, sortKey: n ?? 999, calculusNumber: n };
    }
    case "era": {
      const century = Math.floor(bar.startYear / 100) * 100;
      return {
        key: String(century),
        label: eraLabel(century),
        sortKey: century,
        calculusNumber: null,
      };
    }
    case "field": {
      const f = bar.field || "Unknown field";
      return { key: f, label: f, sortKey: f, calculusNumber: null };
    }
    case "domain": {
      const domainId = bar.domainIds[0];
      const label = bar.domainLabels[0] ?? "Unknown domain";
      return { key: domainId ?? "unknown-domain", label, sortKey: label, calculusNumber: null };
    }
    case "tradition": {
      const traditionId = bar.traditionIds[0];
      const label = bar.traditionLabels[0] ?? "Unknown tradition";
      return { key: traditionId ?? "unknown-tradition", label, sortKey: label, calculusNumber: null };
    }
    case "country": {
      const c = bar.country || "Unknown country";
      return { key: c, label: c, sortKey: c, calculusNumber: null };
    }
    default:
      return assertNever(mode);
  }
}

/**
 * Converts raw JSON entries → a grouped `LifelinesProjection`.
 * Grouping mode is determined by `groupBy` (default: "calculus").
 * Within each group, bars are sorted by birth year and assigned sequential lanes.
 */
export function buildLifelinesProjection(
  raw: RawLifespanEntry[],
  groupBy: GroupByMode = "calculus",
  index?: SeedIndex,
): LifelinesProjection {
  const adapted: LifespanBar[] = [];
  const entityNameIndex = buildEntityNameIndex(index);
  for (let i = 0; i < raw.length; i++) {
    const bar = adaptEntry(raw[i], i, entityNameIndex, index);
    if (bar) adapted.push(bar);
  }

  const groupMap = new Map<string, { spec: GroupSpec; bars: LifespanBar[] }>();

  for (let i = 0; i < adapted.length; i++) {
    const bar = adapted[i];
    const spec = getGroupSpec(bar, groupBy);
    if (!groupMap.has(spec.key)) groupMap.set(spec.key, { spec, bars: [] });
    groupMap.get(spec.key)!.bars.push(bar);
  }

  const sortedKeys = [...groupMap.keys()].sort((a, b) => {
    const sa = groupMap.get(a)!.spec.sortKey;
    const sb = groupMap.get(b)!.spec.sortKey;
    if (typeof sa === "number" && typeof sb === "number") {
      // put "null" sentinel (999) at end
      if (sa === 999 && sb !== 999) return 1;
      if (sb === 999 && sa !== 999) return -1;
      return sa - sb;
    }
    return String(sa).localeCompare(String(sb));
  });

  const groups: LifelinesGroup[] = [];
  let globalStart = Infinity;
  let globalEnd = -Infinity;
  let totalBars = 0;

  for (const key of sortedKeys) {
    const { spec, bars } = groupMap.get(key)!;
    if (bars.length === 0) continue;

    bars.sort((a, b) => a.startYear - b.startYear);
    bars.forEach((bar, i) => { bar.lane = i; });

    const years = bars.flatMap((b) => [b.startYear, b.endYear]);
    const groupStart = Math.min(...years);
    const groupEnd = Math.max(...years);

    globalStart = Math.min(globalStart, groupStart);
    globalEnd = Math.max(globalEnd, groupEnd);
    totalBars += bars.length;

    groups.push({
      calculusNumber: spec.calculusNumber,
      calculusName: spec.label,
      bars,
      laneCount: bars.length,
      startYear: groupStart,
      endYear: groupEnd,
    });
  }

  return {
    groups,
    globalStartYear: Number.isFinite(globalStart) ? globalStart : -700,
    globalEndYear: Number.isFinite(globalEnd) ? globalEnd : PRESENT_YEAR,
    totalBars,
  };
}
