import { EMPTY_GRAPH_STATE, GRAPH_STATE_VERSION, GRAPH_ZOOM_RANGE } from "@/features/timeline/timeline_constants";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clampScale(value, range) {
  return clamp(value, range.min, range.max);
}

export function getDefaultStructuralGraphBundleLayout() {
  return {
    view: {
      zoom: 1,
      scrollLeft: 0,
      scrollTop: 0,
    },
    selection: [],
    nodes: {},
  };
}

export function normalizeStructuralGraphStatePayload(incoming) {
  const next = {
    version: GRAPH_STATE_VERSION,
    bundleLayouts: {},
  };

  if (!incoming || typeof incoming !== "object") return next;

  const bundleLayouts = incoming.bundleLayouts && typeof incoming.bundleLayouts === "object"
    ? incoming.bundleLayouts
    : {};

  Object.entries(bundleLayouts).forEach(([bundleKey, layout]) => {
    const safeLayout = getDefaultStructuralGraphBundleLayout();
    if (layout?.view && typeof layout.view === "object") {
      safeLayout.view.zoom = clampScale(Number(layout.view.zoom) || 1, GRAPH_ZOOM_RANGE);
      safeLayout.view.scrollLeft = Math.max(0, Number(layout.view.scrollLeft) || 0);
      safeLayout.view.scrollTop = Math.max(0, Number(layout.view.scrollTop) || 0);
    }
    if (Array.isArray(layout?.selection)) {
      safeLayout.selection = layout.selection.filter((value) => typeof value === "string");
    }
    if (layout?.nodes && typeof layout.nodes === "object") {
      safeLayout.nodes = Object.fromEntries(
        Object.entries(layout.nodes)
          .filter(([nodeId, nodeValue]) => typeof nodeId === "string" && nodeValue && typeof nodeValue === "object")
          .map(([nodeId, nodeValue]) => [
            nodeId,
            {
              x: Number.isFinite(Number(nodeValue.x)) ? Number(nodeValue.x) : undefined,
              y: Number.isFinite(Number(nodeValue.y)) ? Number(nodeValue.y) : undefined,
              title: typeof nodeValue.title === "string" ? nodeValue.title : undefined,
              subtitle: typeof nodeValue.subtitle === "string" ? nodeValue.subtitle : undefined,
            },
          ])
      );
    }
    next.bundleLayouts[bundleKey] = safeLayout;
  });

  return next;
}

export function getStructuralGraphBundleLayout(graphState, bundleMode) {
  return graphState.bundleLayouts[bundleMode] || getDefaultStructuralGraphBundleLayout();
}

export function parseStructuralGraphDataItemId(nodeId) {
  return typeof nodeId === "string" && nodeId.startsWith("g-item-")
    ? nodeId.slice("g-item-".length)
    : null;
}

export function formatStructuralGraphYear(year) {
  if (!Number.isFinite(year)) return "";
  return year < 0 ? `${Math.abs(year)} BCE` : `${year} CE`;
}

export function formatStructuralGraphYearRange(item) {
  if (!item) return "";
  if (item.endYear == null || item.endYear === item.startYear) {
    return formatStructuralGraphYear(item.startYear);
  }
  return `${formatStructuralGraphYear(item.startYear)} - ${formatStructuralGraphYear(item.endYear)}`;
}

export async function loadStructuralGraphState() {
  const response = await fetch("/structural_graph_state.json");
  if (response.status === 404) return EMPTY_GRAPH_STATE;
  if (!response.ok) {
    throw new Error(`Failed to load structural_graph_state.json (${response.status})`);
  }
  return normalizeStructuralGraphStatePayload(await response.json());
}

export async function saveStructuralGraphState(graphState) {
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
      // Ignore malformed payloads.
    }
    throw new Error(errorMessage);
  }

  return response.json();
}
