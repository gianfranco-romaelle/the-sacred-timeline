function cleanText(value) {
  return String(value || "").trim();
}

function isoYear(value, fallback = 2026) {
  const text = cleanText(value);
  if (!text) return fallback;
  const parsed = new Date(text);
  const year = parsed.getUTCFullYear();
  return Number.isFinite(year) ? year : fallback;
}

function buildTimelineItem({
  id,
  name,
  title,
  startYear,
  endYear = startYear,
  category,
  school,
  historicalPeriod = "Contemporary",
  description,
  tags = [],
  color = "#475569",
}) {
  return {
    id,
    type: "event",
    name,
    title,
    startYear,
    endYear,
    sortYear: startYear,
    category,
    region: "Market",
    school,
    historicalPeriod,
    era: "Contemporary",
    description,
    tags,
    color,
    images: [],
    isInstant: startYear === endYear,
  };
}

// These adapters keep operational or analysis outputs in the same broad shape
// as the timeline rows used by the legacy frontend, so bridge data can remain
// additive instead of teaching the UI multiple incompatible record formats.
export function projectMarketAnalysisToTimelineItems(payload) {
  if (!payload || !payload.request) return [];
  const symbols = Array.isArray(payload.request.symbols) ? payload.request.symbols : [];
  const benchmark = cleanText(payload.request.benchmark_symbol || "SPY");
  const year = 2026;
  return [
    buildTimelineItem({
      id: `market-analysis-${symbols.join("-").toLowerCase() || "market"}`,
      name: "Market Green Triad Analysis",
      title: `${symbols.join(", ") || "Market"} vs ${benchmark}`,
      startYear: year,
      category: "Market Analysis",
      school: "GRT^DEC + de Rham / Green / Bloch",
      description: `Partition ${Number(payload?.thermodynamics?.aggregate?.partition_function || 0).toFixed(2)}, divergence ${Number(payload?.signals?.aggregate?.divergence_stress || 0).toFixed(2)}, fragmentation ${Number(payload?.signals?.aggregate?.fragmentation || 0).toFixed(0)}.`,
      tags: ["market", "green-triad", "yfinance", ...symbols.slice(0, 3)],
      color: "#0f766e",
    }),
  ];
}

export function projectPharmaCycleToTimelineItems(payload) {
  if (!payload || !payload.cycle) return [];
  const cycle = payload.cycle;
  const leader = payload?.leaderboard?.[0]?.candidate_key || "n/a";
  const year = isoYear(cycle.created_at, 2026);
  return [
    buildTimelineItem({
      id: cleanText(cycle.id || "pharma-cycle"),
      name: "Pharma Cycle Run",
      title: `Leader ${leader}`,
      startYear: year,
      category: "Pharma Cycle",
      school: "Sacred Timeline",
      description: `Rows ${Number(cycle?.dataset_summary?.row_count || 0)}, benchmark ${cleanText(cycle.benchmark_symbol || "XBI")}, candidates ${Number(cycle?.summary?.candidate_count || 0)}.`,
      tags: ["pharma", "cycle", "sacred-timeline", cleanText(cycle.benchmark_symbol || "XBI")],
      color: "#7c3aed",
    }),
  ];
}

export function projectDossierWindowsToTimelineItems(windows) {
  const rows = Array.isArray(windows) ? windows : [];
  const grouped = new Map();
  for (const row of rows) {
    const date = cleanText(row.window_date);
    if (!date) continue;
    const current = grouped.get(date) || { assertionDensity: 0, evidenceDensity: 0, narrativeVolatility: 0, backing: 0 };
    if (row.signal_key === "assertion_density") current.assertionDensity = Number(row.value || 0);
    if (row.signal_key === "evidence_density") current.evidenceDensity = Number(row.value || 0);
    if (row.signal_key === "narrative_volatility") current.narrativeVolatility = Number(row.value || 0);
    if (row.signal_key === "primary_backing_score") current.backing = Number(row.value || 0);
    grouped.set(date, current);
  }
  return Array.from(grouped.entries())
    .map(([date, summary]) =>
      buildTimelineItem({
        id: `dossier-window-${date}`,
        name: "Dossier Controversy Window",
        title: date,
        startYear: isoYear(date, 2026),
        category: "Narrative Overlay",
        school: "Attributed Assertion Layer",
        description: `Assertion density ${summary.assertionDensity.toFixed(2)}, evidence ${summary.evidenceDensity.toFixed(2)}, narrative volatility ${summary.narrativeVolatility.toFixed(2)}, primary backing ${summary.backing.toFixed(2)}.`,
        tags: ["dossiers", "controversy-window", "osint", "triangulation"],
        color: "#b45309",
      })
    )
    .sort((left, right) => left.startYear - right.startYear);
}

export function buildMarketTimelineRows({ marketAnalysis = null, pharmaCycle = null, dossierWindows = [] } = {}) {
  return [
    ...projectMarketAnalysisToTimelineItems(marketAnalysis),
    ...projectPharmaCycleToTimelineItems(pharmaCycle),
    ...projectDossierWindowsToTimelineItems(dossierWindows),
  ];
}
