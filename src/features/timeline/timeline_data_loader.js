import { EMPTY_GRAPH_STATE } from "@/features/timeline/timeline_constants";
import { normalizeStructuralGraphStatePayload } from "@/features/graph/structural_graph_loader";

export const calculusPalette = {
  Zeroth: "#64748b",
  First: "#2563eb",
  Second: "#0891b2",
  Third: "#7c3aed",
  Fourth: "#db2777",
  Fifth: "#ea580c",
  Sixth: "#0f766e",
};

export function yearLabel(year) {
  if (year < 0) return `${Math.abs(year)} BCE`;
  return `${year} CE`;
}

export function dateRangeLabel(item) {
  if (item.startYear === item.endYear || item.endYear == null) {
    return yearLabel(item.startYear);
  }
  return `${yearLabel(item.startYear)} -> ${yearLabel(item.endYear)}`;
}

export function eraFromYear(year) {
  if (year < -500) return "Ancient";
  if (year < 500) return "Classical / Late Antiquity";
  if (year < 1500) return "Medieval";
  if (year < 1800) return "Early Modern";
  if (year < 1945) return "Modern";
  return "Contemporary";
}

export function yearInputLabel(year) {
  return `${Math.abs(year)} ${year < 0 ? "BC" : "AD"}`;
}

export function editableYearRangeLabel(item) {
  if (item.startYear === item.endYear || item.endYear == null) {
    return yearInputLabel(item.startYear);
  }
  return `${yearInputLabel(item.startYear)} - ${yearInputLabel(item.endYear)}`;
}

export function parseYearToken(rawValue) {
  const match = rawValue.trim().match(/^(\d+)(?:\s*(AD|BC))?$/i);
  if (!match) return null;

  const year = Number(match[1]);
  if (!Number.isFinite(year) || year <= 0) return null;

  const era = (match[2] || "AD").toUpperCase();
  return era === "BC" ? -year : year;
}

export function parseYearRangeInput(rawValue) {
  const normalized = rawValue.trim().replace(/\s+/g, " ");
  const match = normalized.match(/^(.+?)(?:\s*-\s*(.+))?$/);
  if (!match) {
    return { ok: false, error: "Use 123 AD or 123 BC - 45 AD." };
  }

  const startYear = parseYearToken(match[1]);
  const endYear = parseYearToken(match[2] ?? match[1]);

  if (startYear == null || endYear == null) {
    return { ok: false, error: "Only numbers with optional AD/BC are allowed." };
  }

  return { ok: true, startYear, endYear };
}

export function cleanTextValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeLabelList(value) {
  if (Array.isArray(value)) {
    return value.map(cleanTextValue).filter(Boolean);
  }

  const cleaned = cleanTextValue(value);
  return cleaned ? [cleaned] : [];
}

export function isHttpUrl(value) {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

export function getSearchText(item) {
  return item.searchText || "";
}

const sixthCalculusPattern =
  /\b(category theory|categorical|topos|topoi|sheaf|sheaves|stack|stacks|distributed systems?|semantic computation|artificial intelligence|machine learning|deep learning|cybernetics|information geometry|network science|platform|database|computational ontology|self-modeling|symbolic ai|connectionism|ai nexus)\b/i;

export function getCalculusClassificationFromStartYear(startYear, context = {}) {
  const haystack = [
    context.name,
    context.title,
    context.category,
    context.field,
    context.region,
    context.country,
    context.description,
    context.summary,
    context.school,
    context.historicalPeriod,
    context.calculus_name,
    ...(context.tags || []),
    ...(context.schools || []),
    ...(context.scientific_domains || []),
    ...(context.cognitive_tags || []),
    ...(context.math_tags || []),
  ].filter(Boolean).join(" ");

  if (sixthCalculusPattern.test(haystack)) {
    return { calculusName: "Sixth", calculusNumber: 6 };
  }

  if (!Number.isFinite(startYear)) {
    return { calculusName: "Unclassified", calculusNumber: null };
  }
  if (startYear < 1600) return { calculusName: "Zeroth", calculusNumber: 0 };
  if (startYear < 1750) return { calculusName: "First", calculusNumber: 1 };
  if (startYear < 1850) return { calculusName: "Second", calculusNumber: 2 };
  if (startYear < 1900) return { calculusName: "Third", calculusNumber: 3 };
  if (startYear < 1950) return { calculusName: "Fourth", calculusNumber: 4 };
  return { calculusName: "Fifth", calculusNumber: 5 };
}

export function getBundleModeLabel(bundleMode) {
  if (bundleMode === "historicalPeriod") return "historical period";
  if (bundleMode === "calculus") return "calculus classification";
  return bundleMode;
}

export function normalizeRecord(item) {
  const resolvedEndYear = item.endYear ?? item.startYear;
  const calculusClassification = getCalculusClassificationFromStartYear(item.startYear, item);
  const schoolLabels = [
    ...normalizeLabelList(item.schools),
    ...normalizeLabelList(item.school),
  ];
  const primarySchool = schoolLabels[0] || "Ungrouped";
  const parsedSortIndex = Number(item.sortIndex);
  const normalized = {
    ...item,
    endYear: resolvedEndYear,
    era: eraFromYear(item.startYear),
    sortYear: item.startYear,
    duration: Math.max(0, resolvedEndYear - item.startYear),
    isInstant: resolvedEndYear === item.startYear,
    images: item.images || [],
    schools: schoolLabels,
    school: primarySchool,
    historicalPeriod: item.historicalPeriod || eraFromYear(item.startYear),
    calculusName: calculusClassification.calculusName,
    calculusNumber: calculusClassification.calculusNumber,
    color: calculusPalette[calculusClassification.calculusName] || item.color || "#334155",
    parentId: item.parentId || null,
    orderKey: cleanTextValue(item.orderKey),
    sortIndex: Number.isFinite(parsedSortIndex) ? parsedSortIndex : item.sourceIndex ?? 0,
  };
  normalized.searchText = [
    normalized.name,
    normalized.title,
    normalized.category,
    normalized.region,
    normalized.description,
    normalized.school,
    normalized.historicalPeriod,
    ...(normalized.tags || []),
    ...(normalized.schools || []),
  ].filter(Boolean).join(" ").toLowerCase();
  return normalized;
}

export function mapEnrichedPerson(record, index) {
  const startYear = Number(record.birth_year);
  const endYear = Number(record.death_year);
  const name = cleanTextValue(record.name) || `Unknown ${index + 1}`;
  const field = cleanTextValue(record.field) || "Biography";
  const country = cleanTextValue(record.country);
  const explicitTitle = cleanTextValue(record.title);
  const region = country || "Unknown region";
  const validStartYear = Number.isFinite(startYear) ? startYear : null;
  const validEndYear = Number.isFinite(endYear) ? endYear : validStartYear;

  if (validStartYear == null) return null;

  const schoolLabels = normalizeLabelList(record.schools);
  const { calculusName, calculusNumber } = getCalculusClassificationFromStartYear(validStartYear, record);
  const primarySchool = schoolLabels[0] || cleanTextValue(record.school) || calculusName;
  const descriptorParts = [
    cleanTextValue(record.lifespan_raw) || `${validStartYear} - ${validEndYear}`,
    country,
    field !== "Biography" ? field : "",
    Number.isFinite(calculusNumber) ? `Calculus ${calculusNumber}` : calculusName,
  ].filter(Boolean);

  return normalizeRecord({
    id: `person-${index}-${name}`,
    sourceIndex: index,
    type: "person",
    name,
    title: explicitTitle || [field, country].filter(Boolean).join(" | ") || calculusName,
    startYear: validStartYear,
    endYear: validEndYear,
    category: field,
    region,
    school: primarySchool,
    schools: schoolLabels,
    calculusName,
    calculusNumber,
    historicalPeriod: eraFromYear(validStartYear),
    description: `${name} | ${descriptorParts.join(" | ")}`,
    color: calculusPalette[calculusName] || "#334155",
    images: isHttpUrl(record.portrait_url) ? [record.portrait_url] : [],
    parentId: cleanTextValue(record.parent_id) || null,
    orderKey: cleanTextValue(record.order_key),
    sortIndex: Number.isFinite(Number(record.sort_index)) ? Number(record.sort_index) : index,
  });
}

export const timelineDataRepository = {
  cache: null,
  graphStateCache: null,
  lastLoadMeta: null,

  async getAllTimelineItems() {
    if (!this.cache) {
      this.cache = fetch("/sacred_timeline_current.json")
        .then((response) => {
          if (!response.ok) throw new Error(`Failed to load sacred_timeline_current.json (${response.status})`);
          return response.json();
        })
        .then((rawRecords) => rawRecords.map(mapEnrichedPerson).filter(Boolean))
        .then((baseItems) => {
        this.lastLoadMeta = {
          base_count: baseItems.length,
          source_status: "ready",
          source_detail: "Sacred Timeline current dataset loaded.",
        };
        return baseItems
          .filter(Boolean)
          .map(normalizeRecord)
          .sort((a, b) => (a.sortYear ?? a.startYear ?? 0) - (b.sortYear ?? b.startYear ?? 0));
      });
    }
    return this.cache;
  },

  getLastLoadMeta() {
    return this.lastLoadMeta;
  },

  async saveTimelineItemPatch(item, patch) {
    if (!Number.isInteger(item?.sourceIndex)) {
      throw new Error("This timeline item is not linked to a JSON source row.");
    }

    const response = await fetch("/__timeline/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceIndex: item.sourceIndex, patch }),
    });

    if (!response.ok) {
      let errorMessage = "Failed to save timeline entry.";
      try {
        const payload = await response.json();
        if (payload?.error) errorMessage = payload.error;
      } catch {
        // Ignore malformed error payloads.
      }
      throw new Error(errorMessage);
    }

    this.cache = null;
    return response.json();
  },

  async getStructuralGraphState() {
    if (!this.graphStateCache) {
      this.graphStateCache = fetch("/structural_graph_state.json")
        .then(async (response) => {
          if (response.status === 404) return EMPTY_GRAPH_STATE;
          if (!response.ok) throw new Error(`Failed to load structural_graph_state.json (${response.status})`);
          return response.json();
        })
        .then((payload) => normalizeStructuralGraphStatePayload(payload));
    }
    return this.graphStateCache;
  },

  async saveStructuralGraphState(graphState) {
    const response = await fetch("/__graph/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ graphState }),
    });

    if (!response.ok) {
      let errorMessage = "Failed to save graph state.";
      try {
        const payload = await response.json();
        if (payload?.error) errorMessage = payload.error;
      } catch {
        // Ignore malformed error payloads.
      }
      throw new Error(errorMessage);
    }

    this.graphStateCache = Promise.resolve(normalizeStructuralGraphStatePayload(graphState));
    return response.json();
  },
};
