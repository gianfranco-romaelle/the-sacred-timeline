import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  Filter,
  SlidersHorizontal,
  X,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Chrono } from "react-chrono";
import cytoscape from "cytoscape";
import "react-chrono/dist/style.css";
import { useActivityCenter } from "@/features/activity/activity_center";
import {
  CHRONO_RENDER_LIMIT,
  EDITABLE_TYPE_OPTIONS,
  EMPTY_ITEMS,
  GRAPH_EDGE_LIMIT,
  GRAPH_NODE_LIMIT,
  parseTimelineYearBounds,
  SCENE_TUNING_STORAGE_KEY,
} from "@/features/timeline/timeline_constants";
import {
  dateRangeLabel,
  editableYearRangeLabel,
  normalizeRecord,
  timelineDataRepository,
  yearLabel,
} from "@/features/timeline/timeline_data_loader";
import {
  buildTagGraphElements,
  compareTimelineItems,
  toggleListValue,
} from "@/features/timeline/timeline_filters";
import {
  buildChronoItems,
  buildFilteredTimelineItems,
  buildTicks,
  collectTimelineFilterOptions,
  countActiveTimelineFilters,
  getChronoYearOffset,
} from "@/features/timeline/timeline_projection";
import {
  clearMissingActiveTagId,
  clearMissingSelectionId,
} from "@/features/timeline/timeline_selection";
import { buildStructuralGraph } from "@/projective_scene";
import timelineYearBoundsText from "./timeline_year_bounds.txt?raw";

const DATASET_YEAR_BOUNDS = parseTimelineYearBounds(timelineYearBoundsText);
const PADDED_DATASET_YEAR_BOUNDS = {
  minYear: DATASET_YEAR_BOUNDS.minYear - DATASET_YEAR_BOUNDS.paddingYears,
  maxYear: DATASET_YEAR_BOUNDS.maxYear + DATASET_YEAR_BOUNDS.paddingYears,
};

/**
 * Historical Timeline + School/Period Nodegraph
 *
 * This file still owns the current timeline UI composition, but the heavier
 * data loading, filtering, and projection helpers now live under src/features/timeline.
 */

function getItemTypeMeta(type) {
  return EDITABLE_TYPE_OPTIONS.find((option) => option.value === type) || EDITABLE_TYPE_OPTIONS[0];
}

export default function HistoricalTimelineApp() {
  return (
    <AppErrorBoundary>
      <HistoricalTimelineAppInner />
    </AppErrorBoundary>
  );
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function _mergeSceneTuningState(current, incoming) {
  const next = { ...current, ...incoming };
  const keys = Object.keys(next);
  for (const key of keys) {
    if (next[key] !== current[key]) return next;
  }
  return current;
}

function isHexColor(value) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim());
}

function _normalizeSceneTuningPayload(incoming) {
  const next = { ...incoming };
  delete next.useVirtualization;
  if (next.labelGap == null || next.labelGap === 18) {
    next.labelGap = 40;
  }
  if (next.meshFade == null || next.meshFade === 3) {
    next.meshFade = 5;
  }
  if (next.majorTickYears == null || next.majorTickYears === 100) {
    next.majorTickYears = 50;
  }
  if (next.minorTickYears == null || next.minorTickYears === 25 || next.minorTickYears === 10) {
    next.minorTickYears = 5;
  }
  if (next.entryBoxScale == null) {
    next.entryBoxScale = 1;
  }
  if (next.entryGroupMargin == null || next.entryGroupMargin === 12) {
    next.entryGroupMargin = 16;
  }
  if (next.entryGroupRowGap == null || next.entryGroupRowGap === 16) {
    next.entryGroupRowGap = 24;
  }
  if (next.entrySquareSize == null || next.entrySquareSize === 56) {
    next.entrySquareSize = 72;
  }
  if (next.entryTileOpacity == null || next.entryTileOpacity === 0.18) {
    next.entryTileOpacity = 0.5;
  }
  if (!isHexColor(next.entryTileTint) || next.entryTileTint.toLowerCase() === "#d7bf8f") {
    next.entryTileTint = "#ffffff";
  }
  if (next.showTimelineGrid == null) {
    next.showTimelineGrid = true;
  }
  if (next.timelineBackgroundOpacity == null) {
    next.timelineBackgroundOpacity = 0.9;
  }
  if (next.nodegraphBackgroundOpacity == null) {
    next.nodegraphBackgroundOpacity = 0.9;
  }
  if (next.renderBufferRows == null) {
    next.renderBufferRows = 8;
  }
  delete next.preloadCount;
  delete next.showVirtualizationDebug;
  if (next.timelineMinYear == null) {
    next.timelineMinYear = PADDED_DATASET_YEAR_BOUNDS.minYear;
  }
  if (next.timelineMaxYear == null) {
    next.timelineMaxYear = PADDED_DATASET_YEAR_BOUNDS.maxYear;
  }
  return next;
}

function _getChartWidthForScale(minYear, maxYear, scale, gridOriginX, rightPadding = 240) {
  const domain = Math.max(1, maxYear - minYear);
  return domain * scale + gridOriginX + rightPadding;
}

function _getTimelinePanBounds(viewportWidth, contentMinX, contentMaxX) {
  const slack = Math.max(36, Math.round(viewportWidth * 0.06));
  const min = contentMinX - slack;
  const max = Math.max(min, contentMaxX - viewportWidth + slack);
  return {
    min,
    max,
  };
}

function _getTimelinePanBoundsForScale(viewportWidth, sceneModel, nextYearScale) {
  if (!sceneModel?.rows?.length) {
    return _getTimelinePanBounds(viewportWidth, 0, Math.max(0, viewportWidth));
  }

  let contentMinX = Number.POSITIVE_INFINITY;
  let contentMaxX = Number.NEGATIVE_INFINITY;

  for (const row of sceneModel.rows) {
    const startX = sceneModel.grid.originX + (sceneModel.items[row.itemIndex].startYear - sceneModel.minYear) * nextYearScale;
    const labelLeft = Math.max(16, startX - row.labelWidth - sceneModel.labelGap);
    const markRight = row.showAsPoint
      ? startX + row.dotSize / 2
      : startX + Math.max(sceneModel.grid.minor, (sceneModel.items[row.itemIndex].endYear - sceneModel.items[row.itemIndex].startYear) * nextYearScale);
    contentMinX = Math.min(contentMinX, labelLeft);
    contentMaxX = Math.max(contentMaxX, markRight);
  }

  if (sceneModel.ticks?.length) {
    const leftMajorTickX = sceneModel.grid.originX + (sceneModel.ticks[0] - sceneModel.minYear) * nextYearScale;
    const rightMajorTickX = sceneModel.grid.originX + (sceneModel.ticks[sceneModel.ticks.length - 1] - sceneModel.minYear) * nextYearScale;
    contentMinX = Math.min(contentMinX, leftMajorTickX);
    contentMaxX = Math.max(contentMaxX, rightMajorTickX);
  }

  if (sceneModel.minorTicks?.length) {
    const leftMinorTickX = sceneModel.grid.originX + (sceneModel.minorTicks[0] - sceneModel.minYear) * nextYearScale;
    const rightMinorTickX = sceneModel.grid.originX + (sceneModel.minorTicks[sceneModel.minorTicks.length - 1] - sceneModel.minYear) * nextYearScale;
    contentMinX = Math.min(contentMinX, leftMinorTickX);
    contentMaxX = Math.max(contentMaxX, rightMinorTickX);
  }

  return _getTimelinePanBounds(
    viewportWidth,
    Number.isFinite(contentMinX) ? contentMinX : sceneModel.contentMinX,
    Number.isFinite(contentMaxX) ? contentMaxX : sceneModel.contentMaxX
  );
}

function _measureTimelineViewport(scrollContainer, viewportElement, timefieldElement) {
  const fallbackWidth = viewportElement instanceof HTMLElement ? viewportElement.clientWidth : 0;
  const fallbackHeight = viewportElement instanceof HTMLElement ? viewportElement.clientHeight : 0;

  if (!(scrollContainer instanceof HTMLElement)) {
    return {
      valid: false,
      error: "Timeline scroll viewport was not found.",
      width: fallbackWidth,
      height: fallbackHeight,
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      scrollLeft: 0,
      scrollTop: 0,
      scrollTopWithinTimefield: 0,
    };
  }

  if (!(viewportElement instanceof HTMLElement) || !(timefieldElement instanceof HTMLElement)) {
    return {
      valid: false,
      error: "Timeline canvas is not mounted.",
      width: fallbackWidth,
      height: fallbackHeight,
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      scrollLeft: 0,
      scrollTop: 0,
      scrollTopWithinTimefield: 0,
    };
  }

  const width = scrollContainer.clientWidth || viewportElement.clientWidth;
  const height = scrollContainer.clientHeight || viewportElement.clientHeight;
  const timefieldHeight = Math.max(0, timefieldElement.clientHeight);
  const timefieldWidth = Math.max(0, timefieldElement.clientWidth);

  if (width <= 0 || height <= 0 || timefieldHeight <= 0 || timefieldWidth <= 0) {
    return {
      valid: false,
      error: "Timeline viewport dimensions are invalid.",
      width: width || fallbackWidth,
      height: height || fallbackHeight,
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      scrollLeft: 0,
      scrollTop: 0,
      scrollTopWithinTimefield: 0,
    };
  }

  const scrollRect = scrollContainer.getBoundingClientRect();
  const timefieldRect = timefieldElement.getBoundingClientRect();
  const viewportLeftInScroll = scrollContainer.scrollLeft;
  const viewportTopInScroll = scrollContainer.scrollTop;
  const viewportRightInScroll = viewportLeftInScroll + width;
  const viewportBottomInScroll = viewportTopInScroll + height;
  const timefieldLeftInScroll = viewportLeftInScroll + (timefieldRect.left - scrollRect.left);
  const timefieldTopInScroll = viewportTopInScroll + (timefieldRect.top - scrollRect.top);
  const left = clamp(viewportLeftInScroll - timefieldLeftInScroll, 0, timefieldWidth);
  const top = clamp(viewportTopInScroll - timefieldTopInScroll, 0, timefieldHeight);
  const right = clamp(viewportRightInScroll - timefieldLeftInScroll, left, timefieldWidth);
  const bottom = clamp(viewportBottomInScroll - timefieldTopInScroll, top, timefieldHeight);

  return {
    valid: true,
    error: "",
    width,
    height,
    left,
    right,
    top,
    bottom,
    scrollLeft: viewportLeftInScroll,
    scrollTop: viewportTopInScroll,
    scrollTopWithinTimefield: top,
  };
}

function _shouldStartTimelinePan(target) {
  if (!(target instanceof Element)) return false;
  if (!target.closest("[data-pan-surface='true']")) return false;
  if (target.closest("input, textarea, select")) return false;
  return true;
}

function _hexToHue(hexColor) {
  const hex = (hexColor || "#64748b").replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 0;
  if (max === r) return ((g - b) / delta) * 60 + (g < b ? 360 : 0);
  if (max === g) return ((b - r) / delta) * 60 + 120;
  return ((r - g) / delta) * 60 + 240;
}

function hexToRgba(hexColor, alpha) {
  const hex = (hexColor || "#64748b").replace("#", "").padEnd(6, "0");
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function EntryEditorForm({ item, items = [], variant = "panel", onChange, onClose }) {
  if (!item) return null;

  const shellClassName = variant === "window"
    ? "h-full rounded-none border-0 bg-[#f7f7f4]"
    : "rounded-2xl border border-slate-300/80 bg-[#f7f7f4] shadow-sm";
  const parentOptions = items
    .filter((candidate) => candidate.id !== item.id)
    .sort(compareTimelineItems);

  return (
    <div className={shellClassName}>
      <div className="flex items-center justify-between border-b border-slate-300/80 px-4 py-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Inspector</div>
          <div className="mt-1 text-sm font-semibold text-slate-900">{item.name}</div>
        </div>
        {onClose ? (
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </div>

      {item.images?.length ? (
        <div className="flex gap-2 overflow-x-auto border-b border-slate-300/80 px-4 py-3">
          {item.images.slice(0, 6).map((src, index) => (
            <img
              key={`${src}-${index}`}
              src={src}
              alt={`${item.name} media ${index + 1}`}
              className="h-12 w-12 rounded-lg border border-slate-300 object-cover"
            />
          ))}
        </div>
      ) : null}

      <div className="grid gap-4 p-4 md:grid-cols-2">
        <label className="space-y-1">
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Name</div>
          <Input className="border-slate-300 bg-white" value={item.name} onChange={(e) => onChange({ name: e.target.value })} />
        </label>

        <label className="space-y-1">
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Type</div>
          <Select value={item.type} onValueChange={(value) => onChange({ type: value })}>
            <SelectTrigger className="border-slate-300 bg-white"><SelectValue placeholder="Type" /></SelectTrigger>
            <SelectContent>
              {EDITABLE_TYPE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <label className="space-y-1">
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Start year</div>
          <Input
            className="border-slate-300 bg-white"
            type="number"
            value={item.startYear}
            onChange={(e) => onChange({ startYear: Number(e.target.value || item.startYear) })}
          />
        </label>

        <label className="space-y-1">
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">End year</div>
          <Input
            className="border-slate-300 bg-white"
            type="number"
            value={item.endYear}
            onChange={(e) => onChange({ endYear: Number(e.target.value || item.endYear) })}
          />
        </label>

        <label className="space-y-1">
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Category</div>
          <Input className="border-slate-300 bg-white" value={item.category} onChange={(e) => onChange({ category: e.target.value })} />
        </label>

        <label className="space-y-1">
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Region</div>
          <Input className="border-slate-300 bg-white" value={item.region} onChange={(e) => onChange({ region: e.target.value })} />
        </label>

        <label className="space-y-1">
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">School</div>
          <Input className="border-slate-300 bg-white" value={item.school} onChange={(e) => onChange({ school: e.target.value })} />
        </label>

        <label className="space-y-1">
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Historical period</div>
          <Input className="border-slate-300 bg-white" value={item.historicalPeriod} onChange={(e) => onChange({ historicalPeriod: e.target.value })} />
        </label>

        <label className="space-y-1">
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Parent</div>
          <Select value={item.parentId || "__none__"} onValueChange={(value) => onChange({ parentId: value === "__none__" ? null : value })}>
            <SelectTrigger className="border-slate-300 bg-white"><SelectValue placeholder="No parent" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">No parent</SelectItem>
              {parentOptions.map((candidate) => (
                <SelectItem key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <label className="space-y-1">
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Sort index</div>
          <Input
            className="border-slate-300 bg-white"
            type="number"
            value={item.sortIndex ?? 0}
            onChange={(e) => onChange({ sortIndex: Number(e.target.value || 0) })}
          />
        </label>

        <label className="space-y-1 md:col-span-2">
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Description</div>
          <textarea
            className="min-h-24 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-500"
            value={item.description || ""}
            onChange={(e) => onChange({ description: e.target.value })}
          />
        </label>
      </div>
    </div>
  );
}

function TagGraphPanel({
  elements,
  entryCount,
  tagCount,
  selectedEntryId,
  activeTagId,
  onSelectEntry,
  onActiveTagChange,
}) {
  const containerRef = useRef(null);
  const cyRef = useRef(null);
  const [labelsVisible, setLabelsVisible] = useState(true);
  const onSelectEntryRef = useRef(onSelectEntry);
  const onActiveTagChangeRef = useRef(onActiveTagChange);

  useEffect(() => {
    onSelectEntryRef.current = onSelectEntry;
  }, [onSelectEntry]);

  useEffect(() => {
    onActiveTagChangeRef.current = onActiveTagChange;
  }, [onActiveTagChange]);

  useEffect(() => {
    if (!containerRef.current || cyRef.current) return undefined;

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      layout: {
        name: "cose",
        animate: "end",
        animationDuration: 240,
        fit: true,
        padding: 32,
        nodeRepulsion: 240000,
        idealEdgeLength: 96,
        edgeElasticity: 120,
        gravity: 0.24,
      },
      style: [
        {
          selector: "core",
          style: {
            "selection-box-color": "#2563eb",
            "selection-box-opacity": 0.15,
            "selection-box-border-color": "#2563eb",
            "active-bg-opacity": 0,
          },
        },
        {
          selector: "node",
          style: {
            label: "data(label)",
            "font-family": "ui-sans-serif, system-ui, sans-serif",
            "font-size": 11,
            color: "#0f172a",
            "text-wrap": "wrap",
            "text-max-width": 140,
            "text-valign": "bottom",
            "text-halign": "center",
            "text-margin-y": 8,
            "overlay-opacity": 0,
            opacity: 1,
            "z-index-compare": "manual",
          },
        },
        {
          selector: 'node[kind = "entry"]',
          style: {
            width: 18,
            height: 18,
            shape: "ellipse",
            "background-color": "data(color)",
            "border-width": 2,
            "border-color": "#ffffff",
            "z-index": 12,
          },
        },
        {
          selector: 'node[kind = "tag"]',
          style: {
            width: "label",
            height: 34,
            shape: "round-rectangle",
            padding: "10px",
            "background-color": "#e2e8f0",
            "border-width": 1,
            "border-color": "#cbd5e1",
            color: "#334155",
            "font-size": 12,
            "font-weight": 600,
            "text-valign": "center",
            "text-margin-y": 0,
            "z-index": 8,
          },
        },
        {
          selector: "edge",
          style: {
            width: 1.25,
            "line-color": "#cbd5e1",
            opacity: 0.72,
            "curve-style": "bezier",
          },
        },
        {
          selector: ".labels-hidden",
          style: {
            label: "",
          },
        },
        {
          selector: ".is-selected",
          style: {
            "border-width": 4,
            "border-color": "#0f172a",
            width: 22,
            height: 22,
            "z-index": 24,
          },
        },
        {
          selector: ".is-active-tag",
          style: {
            "background-color": "#0f172a",
            "border-color": "#0f172a",
            color: "#ffffff",
            "z-index": 20,
          },
        },
        {
          selector: ".is-related",
          style: {
            opacity: 1,
          },
        },
        {
          selector: "edge.is-related",
          style: {
            width: 2.4,
            "line-color": "#2563eb",
            opacity: 0.95,
          },
        },
        {
          selector: ".is-dimmed",
          style: {
            opacity: 0.16,
          },
        },
      ],
    });

    cy.on("tap", "node", (event) => {
      const node = event.target;
      const data = node.data();
      if (data.kind === "entry") {
        onActiveTagChangeRef.current?.(null);
        onSelectEntryRef.current?.(data.itemId);
        return;
      }

      if (data.kind === "tag") {
        onActiveTagChangeRef.current?.(data.tagId);
      }
    });

    cy.on("tap", (event) => {
      if (event.target === cy) {
        onActiveTagChangeRef.current?.(null);
      }
    });

    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [elements]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.batch(() => {
      cy.elements().remove();
      cy.add(elements);
      cy.nodes().toggleClass("labels-hidden", !labelsVisible);
    });

    cy.layout({
      name: "cose",
      animate: "end",
      animationDuration: 240,
      fit: true,
      padding: 32,
      nodeRepulsion: 240000,
      idealEdgeLength: 96,
      edgeElasticity: 120,
      gravity: 0.24,
    }).run();
  }, [elements, labelsVisible]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.batch(() => {
      cy.elements().removeClass("is-selected is-active-tag is-related is-dimmed");

      if (activeTagId) {
        const tagNode = cy.getElementById(`tag:${activeTagId}`);
        if (tagNode.nonempty()) {
          cy.elements().addClass("is-dimmed");
          tagNode.removeClass("is-dimmed").addClass("is-active-tag");
          const connectedEdges = tagNode.connectedEdges();
          const connectedNodes = tagNode.closedNeighborhood();
          connectedEdges.removeClass("is-dimmed").addClass("is-related");
          connectedNodes.removeClass("is-dimmed").addClass("is-related");
        }
      }

      if (selectedEntryId) {
        const selectedNode = cy.getElementById(`entry:${selectedEntryId}`);
        if (selectedNode.nonempty()) {
          selectedNode.removeClass("is-dimmed").addClass("is-selected");
          selectedNode.connectedEdges().removeClass("is-dimmed");
          selectedNode.neighborhood().removeClass("is-dimmed");
        }
      }
    });
  }, [selectedEntryId, activeTagId]);

  useEffect(() => {
    const container = containerRef.current;
    const cy = cyRef.current;
    if (!container || !cy || typeof ResizeObserver === "undefined") return undefined;

    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        const liveCy = cyRef.current;
        if (!liveCy) return;
        liveCy.resize();
        if (liveCy.elements().length > 0) {
          liveCy.fit(liveCy.elements(), 32);
        }
      });
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [entryCount, tagCount]);

  const hasRenderableGraph = entryCount > 0 && tagCount > 0;

  function handleFitGraph() {
    const cy = cyRef.current;
    if (!cy) return;
    cy.fit(cy.elements(), 32);
  }

  function handleResetGraph() {
    const cy = cyRef.current;
    if (!cy) return;
    cy.zoom(1);
    cy.center();
    cy.fit(cy.elements(), 32);
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Tag Graph</div>
          <div className="mt-1 text-sm text-slate-700">{entryCount} entries linked across {tagCount} tags</div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="h-8 border-slate-300 bg-white px-3 text-xs"
            onClick={() => setLabelsVisible((current) => !current)}
          >
            {labelsVisible ? "Hide labels" : "Show labels"}
          </Button>
          <Button variant="outline" className="h-8 border-slate-300 bg-white px-3 text-xs" onClick={handleFitGraph}>
            Fit
          </Button>
          <Button variant="outline" className="h-8 border-slate-300 bg-white px-3 text-xs" onClick={handleResetGraph}>
            Reset
          </Button>
        </div>
      </div>

      {!hasRenderableGraph ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-slate-500">
          {entryCount === 0
            ? "No filtered entries are available for the tag graph."
            : "The current filtered entries do not have any tags to connect in the graph."}
        </div>
      ) : (
        <div className="relative min-h-[560px] flex-1 bg-[#f8fafc]">
          <div ref={containerRef} className="absolute inset-0 min-h-[560px]" />
        </div>
      )}
    </div>
  );
}

function TimelineGraphWorkspace({
  loading,
  loadError,
  query,
  setQuery,
  timelineItems,
  activeFilterCount,
  activeTagId,
  tagGraph,
  windowEditItem,
  items,
  updateItem,
  setWindowEditId,
  setActiveTagId,
  workspacePane,
  setWorkspacePane,
  resetWorkspace,
  chronoItems,
  activeChronoIndex,
  typeFilter,
  setTypeFilter,
  eraFilter,
  setEraFilter,
  categoryFilter,
  setCategoryFilter,
  schoolFilter,
  setSchoolFilter,
  periodFilter,
  setPeriodFilter,
  eras,
  categories,
  schools,
  periods,
  chronoReady,
  graphReady,
}) {
  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-[#e8edf3] text-slate-900">
      <div className="flex h-full min-w-0 flex-col">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-300/80 bg-[#f4f6fa] px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="rounded-full border border-slate-300 bg-white px-3 py-1 text-sm font-semibold text-slate-900">
              Sacred Timeline
            </div>
            <div className="hidden items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-slate-500 md:flex">
              <span>{timelineItems.length} items</span>
              <span>{tagGraph.tagCount} tags</span>
              <span>{activeFilterCount} filters</span>
              <span>vertical timeline</span>
            </div>
          </div>
          <div className="hidden text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500 sm:block">
            Timeline + tag graph workspace
          </div>
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="shrink-0 border-b border-slate-300/80 bg-[#f8fafc] px-3 py-3 sm:px-4">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Badge variant="outline" className="rounded-full border-slate-300 bg-white text-slate-700">
                    {timelineItems.length} items
                  </Badge>
                  <Badge variant="outline" className="rounded-full border-slate-300 bg-white text-slate-700">
                    {tagGraph.tagCount} tags
                  </Badge>
                  <Badge variant="outline" className="rounded-full border-slate-300 bg-white text-slate-700">
                    {activeFilterCount} filters
                  </Badge>
                  {activeTagId ? (
                    <Badge variant="outline" className="rounded-full border-blue-200 bg-blue-50 text-blue-700">
                      Tag focus: {activeTagId}
                    </Badge>
                  ) : null}
                  {windowEditItem ? (
                    <Badge variant="outline" className="rounded-full border-slate-300 bg-white text-slate-700">
                      Selected: {windowEditItem.name}
                    </Badge>
                  ) : null}
                </div>

                <div className="flex min-w-0 flex-wrap items-center gap-2 xl:justify-end">
                  <div className="relative min-w-[240px] flex-1 xl:w-[360px] xl:flex-none">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search names, periods, schools, tags..."
                      className="border-slate-300 bg-white pl-9"
                    />
                  </div>

                  <div className="flex items-center gap-2 lg:hidden">
                    <Button
                      variant={workspacePane === "timeline" ? "default" : "outline"}
                      className={workspacePane === "timeline" ? "" : "border-slate-300 bg-white"}
                      onClick={() => setWorkspacePane("timeline")}
                    >
                      Timeline
                    </Button>
                    <Button
                      variant={workspacePane === "graph" ? "default" : "outline"}
                      className={workspacePane === "graph" ? "" : "border-slate-300 bg-white"}
                      onClick={() => setWorkspacePane("graph")}
                    >
                      Graph
                    </Button>
                  </div>

                  <Button variant="outline" className="border-slate-300 bg-white" onClick={resetWorkspace}>
                    Reset
                  </Button>
                </div>
              </div>

              <details className="group rounded-2xl border border-slate-300/80 bg-[#f2f5f9]">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-slate-700 marker:content-none">
                  <span className="flex items-center gap-2">
                    <Filter className="h-4 w-4" /> Filters
                    {activeFilterCount > 0 ? <Badge variant="secondary" className="rounded-full">{activeFilterCount}</Badge> : null}
                  </span>
                  <span className="text-xs uppercase tracking-[0.16em] text-slate-500">Shared by timeline and graph</span>
                </summary>
                <div className="space-y-4 border-t border-slate-300/80 p-4">
                  <div className="grid max-h-[260px] grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-4 overflow-y-auto pr-1">
                    <div className="space-y-2">
                      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Type</div>
                      {EDITABLE_TYPE_OPTIONS.map((option) => (
                        <label key={option.value} className="flex items-center gap-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-slate-300 text-slate-900"
                            checked={typeFilter.includes(option.value)}
                            onChange={() => setTypeFilter((current) => toggleListValue(current, option.value))}
                          />
                          {option.label}
                        </label>
                      ))}
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Era</div>
                      {eras.map((era) => (
                        <label key={era} className="flex items-center gap-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-slate-300 text-slate-900"
                            checked={eraFilter.includes(era)}
                            onChange={() => setEraFilter((current) => toggleListValue(current, era))}
                          />
                          {era}
                        </label>
                      ))}
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Category</div>
                      {categories.map((category) => (
                        <label key={category} className="flex items-center gap-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-slate-300 text-slate-900"
                            checked={categoryFilter.includes(category)}
                            onChange={() => setCategoryFilter((current) => toggleListValue(current, category))}
                          />
                          {category}
                        </label>
                      ))}
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">School</div>
                      {schools.map((school) => (
                        <label key={school} className="flex items-center gap-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-slate-300 text-slate-900"
                            checked={schoolFilter.includes(school)}
                            onChange={() => setSchoolFilter((current) => toggleListValue(current, school))}
                          />
                          {school}
                        </label>
                      ))}
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Historical period</div>
                      {periods.map((period) => (
                        <label key={period} className="flex items-center gap-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-slate-300 text-slate-900"
                            checked={periodFilter.includes(period)}
                            onChange={() => setPeriodFilter((current) => toggleListValue(current, period))}
                          />
                          {period}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-600">
                      The vertical timeline and Cytoscape graph are both driven by this filtered dataset.
                    </div>
                    <Button
                      variant="outline"
                      className="border-slate-300 bg-white"
                      onClick={() => {
                        setTypeFilter([]);
                        setEraFilter([]);
                        setCategoryFilter([]);
                        setSchoolFilter([]);
                        setPeriodFilter([]);
                        setActiveTagId(null);
                      }}
                    >
                      Clear filters
                    </Button>
                  </div>
                </div>
              </details>
            </div>
          </div>

          <div className="relative min-h-0 min-w-0 flex-1 bg-[#edf2f7]">
            {loading ? (
              <div className="flex h-full items-center justify-center p-6">
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500 shadow-sm">
                  Loading timeline workspace...
                </div>
              </div>
            ) : loadError ? (
              <div className="flex h-full items-center justify-center p-6">
                <div className="rounded-2xl border border-dashed border-rose-200 bg-rose-50 p-8 text-center text-rose-700 shadow-sm">
                  {loadError}
                </div>
              </div>
            ) : timelineItems.length === 0 ? (
              <div className="flex h-full items-center justify-center p-6">
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500 shadow-sm">
                  No matching timeline entries.
                </div>
              </div>
            ) : (
              <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(360px,2fr)]">
                <section className={`min-h-0 min-w-0 flex-col border-b border-slate-300/80 bg-[#f5f7fb] lg:border-b-0 lg:border-r ${workspacePane === "timeline" ? "flex" : "hidden"} lg:flex`}>
                  <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Vertical Timeline</div>
                      <div className="mt-1 text-sm text-slate-700">React Chrono is the primary timeline surface for this workspace.</div>
                    </div>
                    <Badge variant="outline" className="rounded-full border-slate-300 bg-white text-slate-700">
                      {timelineItems.length} visible
                    </Badge>
                  </div>

                  <div className="min-h-0 flex-1 overflow-auto p-4">
                    {chronoReady ? (
                      <div className="chrono-shell h-full min-h-[720px] overflow-hidden rounded-[22px] border border-slate-200 bg-white p-4 shadow-[0_14px_34px_rgba(15,23,42,0.06)]">
                        <Chrono
                          key={`vertical-${timelineItems.length}`}
                          items={chronoItems}
                          mode="vertical"
                          activeItemIndex={activeChronoIndex >= 0 ? activeChronoIndex : undefined}
                          allowDynamicUpdate
                          onItemSelected={({ index }) => {
                            const item = timelineItems[index];
                            if (item) {
                              setActiveTagId(null);
                              setWindowEditId(item.id);
                            }
                          }}
                          layout={{
                            cardHeight: "auto",
                            cardWidth: 420,
                            itemWidth: 140,
                            pointSize: 14,
                            timelineHeight: "720px",
                            responsive: { enabled: true, breakpoint: 1100 },
                          }}
                          interaction={{
                            autoScroll: true,
                            keyboardNavigation: true,
                            pointClick: true,
                          }}
                          content={{
                            compactText: false,
                            alignment: { horizontal: "left", vertical: "top" },
                          }}
                          display={{
                            borderless: false,
                            toolbar: { enabled: false },
                            scrollable: { scrollbar: true },
                            pointShape: "diamond",
                          }}
                          media={{
                            height: 160,
                            fit: "cover",
                            align: "center",
                          }}
                          theme={{
                            primary: "#2563eb",
                            secondary: "#94a3b8",
                            titleColor: "#475569",
                            titleColorActive: "#0f172a",
                            cardBgColor: "#ffffff",
                            cardTitleColor: "#0f172a",
                            cardSubtitleColor: "#64748b",
                            cardDetailsColor: "#334155",
                            detailsColor: "#334155",
                            toolbarBgColor: "#f8fafc",
                            timelineBgColor: "#ffffff",
                          }}
                        />
                      </div>
                    ) : (
                      <div className="flex min-h-[720px] items-center justify-center rounded-[22px] border border-dashed border-amber-300 bg-amber-50/70 p-8 text-center text-sm text-amber-900 shadow-[0_14px_34px_rgba(15,23,42,0.04)]">
                        <div className="max-w-xl space-y-3">
                          <div className="text-base font-semibold text-amber-950">Timeline paused for performance</div>
                          <div>
                            The current dataset has {timelineItems.length.toLocaleString()} visible entries. `react-chrono` is not staying responsive at this volume in this browser session.
                          </div>
                          <div>
                            Narrow the dataset with search or filters until it drops to {CHRONO_RENDER_LIMIT.toLocaleString()} entries or fewer, and the vertical timeline will mount automatically.
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </section>

                <section className={`min-h-0 min-w-0 flex-col bg-white ${workspacePane === "graph" ? "flex" : "hidden"} lg:flex`}>
                  {graphReady ? (
                    <TagGraphPanel
                      elements={tagGraph.elements}
                      entryCount={tagGraph.entryCount}
                      tagCount={tagGraph.tagCount}
                      selectedEntryId={windowEditItem?.id || null}
                      activeTagId={activeTagId}
                      onSelectEntry={(itemId) => {
                        setActiveTagId(null);
                        setWindowEditId(itemId);
                      }}
                      onActiveTagChange={setActiveTagId}
                    />
                  ) : (
                    <div className="flex h-full min-h-[560px] items-center justify-center border-l border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
                      <div className="max-w-md space-y-3">
                        <div className="text-base font-semibold text-slate-900">Graph paused</div>
                        <div>
                          {tagGraph.tagCount === 0
                            ? "The current dataset does not contain any tags, so there is nothing tag-based to draw."
                            : `The current graph would mount ${tagGraph.nodeCount.toLocaleString()} nodes and ${tagGraph.edgeCount.toLocaleString()} edges, which is above the safe interactive limit.`}
                        </div>
                        <div>
                          Add or filter to tagged entries until the graph is smaller, and the Cytoscape panel will mount automatically.
                        </div>
                      </div>
                    </div>
                  )}
                </section>
              </div>
            )}

            {windowEditItem ? (
              <div className="absolute inset-0 z-40 flex justify-end">
                <button
                  type="button"
                  className="absolute inset-0 bg-slate-950/28 backdrop-blur-[1px]"
                  aria-label="Close inspector"
                  onClick={() => {
                    setWindowEditId(null);
                    setActiveTagId(null);
                  }}
                />
                <div className="relative h-full w-full overflow-y-auto border-l border-slate-300/80 bg-[#f7f7f4] shadow-[-24px_0_48px_rgba(15,23,42,0.22)] sm:max-w-[420px]">
                  <EntryEditorForm
                    item={windowEditItem}
                    items={items}
                    variant="window"
                    onChange={(patch) => updateItem(windowEditItem.id, patch)}
                    onClose={() => {
                      setWindowEditId(null);
                      setActiveTagId(null);
                    }}
                  />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function InlineEntryTextInput({ value, onChange, onCommit, onCancel, fontSize, color, className = "", letterSpacing, error = "" }) {
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select?.();
  }, []);

  async function handleBlur(event) {
    const committed = await onCommit?.();
    if (committed === false) {
      requestAnimationFrame(() => {
        event.target.focus();
        event.target.select?.();
      });
    }
  }

  function handleKeyDown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      void onCommit?.();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      onCancel?.();
    }
  }

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      className={`w-full border-0 bg-transparent px-0 py-0 outline-none ring-0 ${className}`}
      style={{
        fontSize,
        color,
        letterSpacing,
        boxShadow: error ? "inset 0 -1px 0 rgba(248,113,113,0.95)" : "inset 0 -1px 0 rgba(148,163,184,0.75)",
      }}
    />
  );
}

function _CompactThumbnailStrip({ item }) {
  const images = item.images?.slice(0, 3) || [];
  const fallbackLabel = (item.name || "?").trim().charAt(0).toUpperCase() || "?";

  if (images.length === 0) {
    return (
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-[9px] font-semibold text-slate-500">
        {fallbackLabel}
      </div>
    );
  }

  return (
    <div className="relative h-6 w-9 shrink-0">
      {images.map((src, index) => (
        <img
          key={`${src}-${index}`}
          src={src}
          alt={`${item.name} ${index + 1}`}
          className="absolute top-0 h-6 w-6 rounded-md border border-white object-cover"
          style={{ left: index * 6, zIndex: images.length - index }}
        />
      ))}
    </div>
  );
}

function buildVisibleTimelineBands(sceneModel, multiplier) {
  const step = Math.max(sceneModel.majorTickYears * multiplier, sceneModel.majorTickYears);
  return buildTicks(sceneModel.minYear, sceneModel.maxYear, step);
}

function _EntryLabelLayer({
  sceneModel,
  materializedRows,
  inlineEdit,
  onInlineEdit,
  onCommitInlineEdit,
  onCancelInlineEdit,
  onSelectItem,
  onToggleCollapsed,
  selectedItemId,
}) {
  const tableWidth = sceneModel.grid.originX - 12;

  return (
    <div className="absolute left-0 top-0 z-20 border-r border-slate-300/80 bg-[#fafaf8]" style={{ width: tableWidth, height: sceneModel.worldHeight }}>
      {materializedRows.map((row) => {
        const item = sceneModel.items[row.itemIndex];
        const isSelected = selectedItemId === item.id;
        const isEditingName = inlineEdit?.id === item.id && inlineEdit?.field === "name";
        const isEditingYears = inlineEdit?.id === item.id && inlineEdit?.field === "years";
        const typeMeta = getItemTypeMeta(item.type);
        const indent = 10 + row.depth * 14;
        const typeCode = typeMeta.label.slice(0, 3).toUpperCase();
        const mediaCount = item.images?.length || 0;

        return (
          <div
            key={`label-${item.id}`}
            className={`absolute left-0 right-0 border-b border-slate-200/80 transition-colors ${isSelected ? "bg-white" : "hover:bg-white/70"}`}
            style={{ top: row.rowTop, height: row.rowHeight }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onSelectItem?.(item.id)}
          >
            {isSelected ? <div className="absolute inset-y-0 left-0 w-[2px] bg-slate-900" /> : null}
            <div className="grid h-full grid-cols-[minmax(0,1fr)_48px_96px] items-center gap-3 pr-3" style={{ paddingLeft: indent }}>
              <div className="flex min-w-0 items-center gap-2">
                {row.hasChildren ? (
                  <button
                    type="button"
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-200"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleCollapsed?.(item.id);
                    }}
                    aria-label={row.isExpanded ? "Collapse row" : "Expand row"}
                  >
                    {row.isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  </button>
                ) : (
                  <div className="h-4 w-4 shrink-0" />
                )}

                <div className="min-w-0">
                  {isEditingName ? (
                    <InlineEntryTextInput
                      value={inlineEdit.value}
                      onChange={(value) => onInlineEdit((current) => current ? { ...current, value, error: "" } : current)}
                      onCommit={() => onCommitInlineEdit?.()}
                      onCancel={() => onCancelInlineEdit?.()}
                      fontSize={12}
                      color="#0f172a"
                      className="truncate font-medium"
                      error={inlineEdit.error}
                    />
                  ) : (
                    <button
                      type="button"
                      className="w-full truncate bg-transparent p-0 text-left text-[12px] font-medium text-slate-900 hover:text-slate-700"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        onInlineEdit({
                          id: item.id,
                          field: "name",
                          value: item.name || "",
                          error: "",
                        });
                      }}
                    >
                      {item.name}
                    </button>
                  )}
                </div>
              </div>

              <div className="min-w-0 text-center text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                <div>{typeCode}</div>
                {mediaCount > 0 ? <div className="mt-1 text-[9px] font-medium normal-case text-slate-400">{mediaCount} img</div> : null}
              </div>

              <div className="min-w-0 text-right text-[10px] font-medium tabular-nums text-slate-500">
                {isEditingYears ? (
                  <InlineEntryTextInput
                    value={inlineEdit.value}
                    onChange={(value) => onInlineEdit((current) => current ? { ...current, value, error: "" } : current)}
                    onCommit={() => onCommitInlineEdit?.()}
                    onCancel={() => onCancelInlineEdit?.()}
                    fontSize={10}
                    color="#64748b"
                    className="truncate font-medium text-right"
                    error={inlineEdit.error}
                  />
                ) : (
                  <button
                    type="button"
                    className="w-full truncate bg-transparent p-0 text-right font-medium hover:text-slate-700"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      onInlineEdit({
                        id: item.id,
                        field: "years",
                        value: editableYearRangeLabel(item),
                        error: "",
                      });
                    }}
                  >
                    {dateRangeLabel(item)}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function getRowPlacement(item, rowIndex, rowHeight, sceneModel, yearScale) {
  const startYear = item.startYear;
  const endYear = item.endYear ?? item.startYear;
  const startX = sceneModel.grid.originX + (startYear - sceneModel.minYear) * yearScale;
  const durationWidth = Math.max(0, (endYear - startYear) * yearScale);
  const dotSize = 10;
  const barHeight = 10;
  const showAsPoint = item.isInstant || durationWidth < 18;
  const barWidth = showAsPoint ? dotSize : Math.max(18, durationWidth);
  const rowTop = rowIndex * rowHeight;
  const trackTop = rowTop + 10;
  const captionTop = rowTop + 25;
  const captionX = showAsPoint ? startX + dotSize + 8 : startX + 4;
  const captionWidth = Math.max(96, Math.min(260, Math.max(barWidth, Math.ceil((item.name?.length || 0) * 6.2))));

  return {
    rowTop,
    startX,
    barWidth,
    showAsPoint,
    dotSize,
    barHeight,
    trackTop,
    captionTop,
    captionX,
    captionWidth,
  };
}

function TimelineOutlineRows({
  items,
  virtualWindow,
  rowHeight,
  scrollTop,
  selectedItemId,
  onSelectItem,
  collapsedItemIds,
  onToggleCollapsed,
}) {
  if (!virtualWindow.ready || virtualWindow.materializedRowEnd < virtualWindow.materializedRowStart) return null;
  const visibleItems = items.slice(virtualWindow.materializedRowStart, virtualWindow.materializedRowEnd + 1);

  return (
    <div className="relative flex-1 overflow-hidden bg-[#fbfbf8]">
      {visibleItems.map((item, index) => {
        const rowIndex = virtualWindow.materializedRowStart + index;
        const top = rowIndex * rowHeight - scrollTop;
        const isSelected = item.id === selectedItemId;
        const typeMeta = getItemTypeMeta(item.type);
        const isCollapsed = collapsedItemIds.includes(item.id);

        return (
          <div
            key={item.id}
            className={`absolute left-0 right-0 grid grid-cols-[minmax(0,1fr)_68px_118px] items-start gap-2 border-b px-3 text-left ${
              isSelected
                ? "border-sky-200 bg-sky-50/80"
                : "border-slate-200/80 bg-transparent hover:bg-slate-100/70"
            }`}
            style={{ top, height: rowHeight }}
            role="button"
            tabIndex={0}
            onClick={() => onSelectItem?.(item.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelectItem?.(item.id);
              }
            }}
          >
            <div className="min-w-0 pt-2.5" style={{ paddingLeft: 6 + item.depth * 16 }}>
              <div className="flex items-start gap-2">
                {item.hasChildren ? (
                  <button
                    type="button"
                    className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-slate-500 hover:bg-white"
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleCollapsed?.(item.id);
                    }}
                  >
                    {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>
                ) : (
                  <span className="mt-0.5 h-4 w-4 shrink-0" />
                )}
                <span className="mt-[5px] h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                <div className="min-w-0">
                  <div className={`truncate text-[13px] leading-4 ${isSelected ? "font-semibold text-slate-950" : "font-medium text-slate-800"}`}>
                    {item.name}
                  </div>
                  <div className="truncate pt-0.5 text-[11px] leading-4 text-slate-500">
                    {item.title || item.category || item.historicalPeriod || "Untitled"}
                  </div>
                </div>
              </div>
            </div>
            <div className="truncate pt-2.5 text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500">
              {typeMeta.label}
            </div>
            <div className="truncate pt-2.5 text-right text-[11px] text-slate-500">
              {dateRangeLabel(item)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TimefieldLayer({
  items,
  virtualWindow,
  rowHeight,
  sceneModel,
  yearScale,
  selectedItemId,
  onSelectItem,
  visibleLeft,
  visibleRight,
}) {
  if (!virtualWindow.ready || virtualWindow.materializedRowEnd < virtualWindow.materializedRowStart) return null;
  const visibleItems = items.slice(virtualWindow.materializedRowStart, virtualWindow.materializedRowEnd + 1);

  return (
    <div className="absolute inset-0">
      {visibleItems.map((item, index) => {
        const rowIndex = virtualWindow.materializedRowStart + index;
        const placement = getRowPlacement(item, rowIndex, rowHeight, sceneModel, yearScale);
        const isSelected = selectedItemId === item.id;
        const markLeft = placement.startX;
        const markRight = placement.startX + placement.barWidth;
        const captionRight = placement.captionX + placement.captionWidth;
        const visibleMark = markRight >= visibleLeft && markLeft <= visibleRight;
        const visibleCaption = captionRight >= visibleLeft && placement.captionX <= visibleRight;

        if (!visibleMark && !visibleCaption) return null;

        return (
          <button
            key={item.id}
            type="button"
            className={`absolute left-0 right-0 border-b text-left ${
              isSelected ? "border-sky-200 bg-sky-50/45" : "border-slate-200/80 hover:bg-slate-50"
            }`}
            style={{ top: placement.rowTop, height: rowHeight }}
            onClick={() => onSelectItem?.(item.id)}
          >
            <div className="absolute inset-x-0 top-[15px] h-px bg-slate-100" />
            {placement.showAsPoint ? (
              <div
                className={`absolute rotate-45 border border-white shadow-sm ${isSelected ? "ring-2 ring-sky-300" : ""}`}
                style={{
                  left: placement.startX,
                  top: placement.trackTop,
                  width: placement.dotSize,
                  height: placement.dotSize,
                  backgroundColor: item.color,
                }}
              />
            ) : (
              <div
                className={`absolute rounded-full ${isSelected ? "ring-2 ring-sky-300 ring-offset-1" : ""}`}
                style={{
                  left: placement.startX,
                  top: placement.trackTop,
                  width: placement.barWidth,
                  height: placement.barHeight,
                  backgroundColor: item.color,
                }}
              />
            )}
            <div
              className="absolute min-w-0"
              style={{
                left: placement.captionX,
                top: placement.captionTop,
                width: placement.captionWidth,
              }}
            >
              <div className={`truncate text-[11px] leading-4 ${isSelected ? "font-semibold text-slate-950" : "font-medium text-slate-700"}`}>
                {item.name}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function TimefieldGrid({ sceneModel, yearScale, visibleLeft, visibleRight, nowYear }) {
  const majorTickSet = new Set(sceneModel.ticks);
  const nowX = sceneModel.grid.originX + (nowYear - sceneModel.minYear) * yearScale;
  const showNow = nowX >= visibleLeft && nowX <= visibleRight;

  return (
    <div className="absolute inset-0 bg-white">
      {sceneModel.minorTicks.map((tick) => {
        const x = sceneModel.grid.originX + (tick - sceneModel.minYear) * yearScale;
        if (x < visibleLeft || x > visibleRight) return null;
        const isMajor = majorTickSet.has(tick);
        return (
          <div
            key={`grid-${tick}`}
            className={`absolute top-0 bottom-0 ${isMajor ? "bg-slate-300/85" : "bg-slate-200/65"}`}
            style={{ left: x, width: 1 }}
          />
        );
      })}

      {showNow ? (
        <div className="pointer-events-none absolute bottom-0 top-0 z-20 bg-rose-500/85" style={{ left: nowX, width: 1 }} />
      ) : null}
    </div>
  );
}

function TimelineCanvas({
  items,
  sceneModel,
  yearScale,
  rowHeight,
  worldHeight,
  viewMetrics,
  virtualWindow,
  viewportRef,
  timefieldRef,
  selectedItemId,
  onSelectItem,
  collapsedItemIds,
  onToggleCollapsed,
}) {
  const viewportWidth = Math.max(1, viewMetrics.width || 0);
  const overscanX = Math.max(180, Math.round(viewportWidth * 0.24));
  const visibleLeft = Math.max(0, viewMetrics.left - overscanX);
  const visibleRight = Math.min(sceneModel.chartWidth, viewMetrics.right + overscanX);
  const majorBandTicks = useMemo(() => buildVisibleTimelineBands(sceneModel, 4), [sceneModel]);
  const majorTickSet = useMemo(() => new Set(sceneModel.ticks), [sceneModel.ticks]);
  const nowYear = new Date().getFullYear();
  const nowX = sceneModel.grid.originX + (nowYear - sceneModel.minYear) * yearScale;

  return (
    <div className="flex h-full min-h-0 overflow-hidden rounded-[18px] border border-slate-300/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
      <div className="flex w-[360px] shrink-0 flex-col border-r border-slate-300/80 bg-[#fbfbf8]">
        <div className="flex h-[76px] shrink-0 flex-col justify-center border-b border-slate-300/80 bg-[#f6f6f2] px-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Outline</div>
          <div className="mt-2 grid grid-cols-[minmax(0,1fr)_68px_118px] gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
            <span>Entry</span>
            <span>Type</span>
            <span className="text-right">Years</span>
          </div>
        </div>
        <TimelineOutlineRows
          items={items}
          virtualWindow={virtualWindow}
          rowHeight={rowHeight}
          scrollTop={viewMetrics.top}
          selectedItemId={selectedItemId}
          onSelectItem={onSelectItem}
          collapsedItemIds={collapsedItemIds}
          onToggleCollapsed={onToggleCollapsed}
        />
      </div>

      <div
        ref={viewportRef}
        className="relative min-h-0 min-w-0 flex-1 overflow-auto bg-white"
        data-timeline-scroll-root="true"
      >
        <div className="relative min-w-max" style={{ width: sceneModel.chartWidth }}>
          <div className="sticky top-0 z-30 overflow-hidden border-b border-slate-300/80 bg-[#f6f6f2]">
            <div className="relative h-10 border-b border-slate-300/80">
              <div className="absolute left-4 top-0 flex h-full items-center gap-2 text-[11px] text-slate-500">
                <span className="font-semibold text-slate-900">{items.length} rows</span>
                <span>{virtualWindow.renderedRowCount} rendered</span>
                <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                  Virtualized
                </span>
              </div>

              {majorBandTicks.map((tick, index) => {
                const nextTick = majorBandTicks[index + 1] ?? (tick + sceneModel.majorTickYears * 4);
                const left = sceneModel.grid.originX + (tick - sceneModel.minYear) * yearScale;
                const right = sceneModel.grid.originX + (nextTick - sceneModel.minYear) * yearScale;
                if (right < visibleLeft || left > visibleRight) return null;
                return (
                  <div key={`band-${tick}`} className="absolute inset-y-0 border-l border-slate-300/80" style={{ left }}>
                    <div className="px-3 pt-2.5 text-[11px] font-semibold tracking-[0.02em] text-slate-700">
                      {yearLabel(tick)}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="relative h-9">
              {sceneModel.minorTicks.map((tick) => {
                const x = sceneModel.grid.originX + (tick - sceneModel.minYear) * yearScale;
                if (x < visibleLeft || x > visibleRight) return null;
                const isMajor = majorTickSet.has(tick);
                return (
                  <div key={`tick-${tick}`} className="absolute inset-y-0" style={{ left: x }}>
                    <div className={`absolute bottom-0 w-px ${isMajor ? "top-0 bg-slate-400/90" : "top-4 bg-slate-200/80"}`} />
                    {isMajor ? (
                      <div className="absolute left-2 top-1.5 whitespace-nowrap text-[10px] font-medium text-slate-600">
                        {yearLabel(tick)}
                      </div>
                    ) : null}
                  </div>
                );
              })}

              {nowX >= visibleLeft && nowX <= visibleRight ? (
                <div className="absolute inset-y-0" style={{ left: nowX }}>
                  <div className="absolute inset-y-0 w-px bg-rose-500" />
                  <div className="absolute left-2 top-1.5 rounded-sm bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600">
                    Now
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div
            ref={timefieldRef}
            className="relative"
            style={{ width: sceneModel.chartWidth, height: worldHeight }}
          >
            <TimefieldGrid
              sceneModel={sceneModel}
              yearScale={yearScale}
              visibleLeft={visibleLeft}
              visibleRight={visibleRight}
              nowYear={nowYear}
            />
            <TimefieldLayer
              items={items}
              virtualWindow={virtualWindow}
              rowHeight={rowHeight}
              sceneModel={sceneModel}
              yearScale={yearScale}
              selectedItemId={selectedItemId}
              onSelectItem={onSelectItem}
              visibleLeft={visibleLeft}
              visibleRight={visibleRight}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function StructuralAnalysisView({ sceneModel, items, bundleMode }) {
  const graph = useMemo(() => buildStructuralGraph(sceneModel, items, bundleMode), [sceneModel, items, bundleMode]);
  const isCalculusMode = bundleMode === "calculus";

  const layout = useMemo(() => {
    if (!isCalculusMode) {
      const groups = [
        { key: "scene", title: "Frame + Layers", x: 130 },
        { key: "widget", title: "Widgets", x: 430 },
        { key: "data", title: "Timeline Data", x: 760 },
        { key: "classification", title: "Relations", x: 1080 },
      ];

      const nodes = groups.flatMap((group) =>
        graph.nodes
          .filter((node) => node.group === group.key)
          .map((node, index) => ({
            ...node,
            x: group.x,
            y: 90 + index * 86,
          }))
      );

      return {
        width: 1360,
        height: Math.max(780, Math.max(...nodes.map((node) => node.y), 0) + 120),
        nodes,
        clusterHalos: [],
        groupLabels: groups.map((group) => ({ key: group.key, title: group.title, x: group.x })),
      };
    }

    const clusterSeeds = new Map([
      ["Zeroth", { x: 500, y: 190 }],
      ["First", { x: 810, y: 190 }],
      ["Second", { x: 1120, y: 190 }],
      ["Third", { x: 500, y: 490 }],
      ["Fourth", { x: 810, y: 490 }],
      ["Fifth", { x: 1120, y: 490 }],
      ["Unclassified", { x: 810, y: 760 }],
    ]);
    const nodes = [];
    const clusterHalos = [];

    const sceneNodes = graph.nodes.filter((node) => node.group === "scene");
    const classificationNodes = graph.nodes
      .filter((node) => node.group === "classification")
      .sort((a, b) => (a.clusterIndex ?? Number.MAX_SAFE_INTEGER) - (b.clusterIndex ?? Number.MAX_SAFE_INTEGER));
    const dataNodes = graph.nodes.filter((node) => node.group === "data");

    sceneNodes.forEach((node, index) => {
      nodes.push({
        ...node,
        x: 160,
        y: 120 + index * 92,
      });
    });

    const centerByCluster = new Map();
    classificationNodes.forEach((node, index) => {
      const seed = clusterSeeds.get(node.clusterKey || node.title) || {
        x: 1120,
        y: 760 + index * 70,
      };
      centerByCluster.set(node.clusterKey || node.title, {
        x: seed.x,
        y: seed.y,
        color: node.color || "#94a3b8",
      });
      nodes.push({
        ...node,
        x: seed.x,
        y: seed.y,
      });
    });

    const dataByCluster = new Map();
    dataNodes.forEach((node) => {
      const key = node.clusterKey || "Unclassified";
      if (!dataByCluster.has(key)) dataByCluster.set(key, []);
      dataByCluster.get(key).push(node);
    });

    dataByCluster.forEach((clusterNodes, key) => {
      const center = centerByCluster.get(key) || { x: 1120, y: 760, color: "#94a3b8" };
      const nodesPerRing = 14;
      const baseRadius = 82;
      const ringGap = 34;
      const ringCount = Math.max(1, Math.ceil(clusterNodes.length / nodesPerRing));
      const haloRadius = baseRadius + Math.max(0, ringCount - 1) * ringGap + 30;

      clusterHalos.push({
        key,
        x: center.x,
        y: center.y,
        radius: haloRadius,
        color: center.color,
      });

      clusterNodes.forEach((node, index) => {
        const ringIndex = Math.floor(index / nodesPerRing);
        const ringOffset = index % nodesPerRing;
        const ringSize = Math.min(nodesPerRing, clusterNodes.length - ringIndex * nodesPerRing);
        const angle = -Math.PI / 2 + (Math.PI * 2 * ringOffset) / Math.max(1, ringSize) + ringIndex * 0.22;
        const radius = baseRadius + ringIndex * ringGap;
        nodes.push({
          ...node,
          x: center.x + Math.cos(angle) * radius,
          y: center.y + Math.sin(angle) * radius,
        });
      });
    });

    return {
      width: 1460,
      height: 920,
      nodes,
      clusterHalos,
      groupLabels: [
        { key: "scene", title: "Frame + Layers", x: 160 },
        { key: "clusters", title: "Calculus Clusters", x: 810 },
      ],
    };
  }, [graph, isCalculusMode]);

  const byId = new Map(layout.nodes.map((node) => [node.id, node]));

  function edgePath(source, target, edge) {
    if (isCalculusMode && edge.kind === "classified-by") {
      return `M ${source.x} ${source.y} L ${target.x} ${target.y}`;
    }
    const dx = (target.x - source.x) * 0.45;
    return `M ${source.x} ${source.y} C ${source.x + dx} ${source.y}, ${target.x - dx} ${target.y}, ${target.x} ${target.y}`;
  }

  const renderedEdges = isCalculusMode
    ? graph.edges.filter((edge) => edge.kind === "contains" || edge.kind === "classified-by" || edge.kind === "bundles")
    : graph.edges;

  return (
    <div className="w-max min-w-full rounded-3xl border border-slate-200 bg-[radial-gradient(circle_at_top_left,_#f8fafc,_#ffffff_62%)] p-4">
      <div className="mb-4 flex flex-wrap gap-2">
        <Badge variant="secondary" className="rounded-full">
          {isCalculusMode ? "Calculus-class point clusters" : "Projective frame + widgets + data"}
        </Badge>
        <Badge variant="outline" className="rounded-full">
          {isCalculusMode ? "Points orbit their Zeroth-Sixth cluster centers" : "Hidden horizon defaults drive shadows and anchors"}
        </Badge>
      </div>
      <svg width={layout.width} height={layout.height} className="overflow-visible">
        {layout.groupLabels.map((group) => (
          <g key={group.key}>
            <text x={group.x} y={36} textAnchor="middle" fontSize="12" fontWeight="700" fill="#475569">{group.title}</text>
          </g>
        ))}

        {isCalculusMode ? layout.clusterHalos.map((halo) => (
          <g key={`halo-${halo.key}`}>
            <circle
              cx={halo.x}
              cy={halo.y}
              r={halo.radius}
              fill={hexToRgba(halo.color, 0.05)}
              stroke={hexToRgba(halo.color, 0.28)}
              strokeDasharray="7 9"
            />
          </g>
        )) : null}

        {renderedEdges.map((edge) => {
          const source = byId.get(edge.source);
          const target = byId.get(edge.target);
          if (!source || !target) return null;
          const strokeColor = edge.kind === "classified-by"
            ? target.color || source.color || "#94a3b8"
            : edge.kind === "contains"
              ? "#2563eb"
              : "#94a3b8";
          return (
            <path
              key={`${edge.source}-${edge.target}-${edge.kind}`}
              d={edgePath(source, target, edge)}
              fill="none"
              stroke={strokeColor}
              strokeOpacity={
                edge.kind === "contains"
                  ? "0.34"
                  : edge.kind === "bundles"
                    ? "0.22"
                    : isCalculusMode
                      ? "0.24"
                      : edge.kind === "anchors" || edge.kind === "represents"
                        ? "0.42"
                        : "0.34"
              }
              strokeWidth={edge.kind === "contains" ? "2.6" : edge.kind === "classified-by" && isCalculusMode ? "1.5" : "2"}
              strokeDasharray={edge.kind === "classified-by" || edge.kind === "bundles" ? "5 5" : undefined}
            />
          );
        })}

        {layout.nodes.map((node) => {
          if (isCalculusMode && node.group === "data") {
            return (
              <g key={node.id}>
                <title>{`${node.title}${node.subtitle ? ` - ${node.subtitle}` : ""}`}</title>
                <circle cx={node.x} cy={node.y} r="5.5" fill={node.color || "#334155"} stroke="#ffffff" strokeWidth="1.5" />
              </g>
            );
          }

          const fill = isCalculusMode && node.group === "classification"
            ? hexToRgba(node.color || "#94a3b8", 0.08)
            : node.group === "data"
              ? "#ffffff"
              : node.group === "classification"
                ? "#f8fafc"
                : "#eff6ff";
          const stroke = node.color || (node.group === "data" ? "#cbd5e1" : "#bfdbfe");
          const width = isCalculusMode && node.group === "classification" ? 172 : 196;
          const height = isCalculusMode && node.group === "classification" ? 56 : 52;
          const x = node.x - width / 2;
          const y = node.y - height / 2;
          const textAnchor = isCalculusMode && node.group === "classification" ? "middle" : "start";
          const titleX = textAnchor === "middle" ? node.x : x + 34;
          const subtitleX = textAnchor === "middle" ? node.x : x + 34;
          const markerX = x + 18;

          return (
            <g key={node.id}>
              <rect
                x={x}
                y={y}
                width={width}
                height={height}
                rx={isCalculusMode && node.group === "classification" ? "22" : "18"}
                fill={fill}
                stroke={stroke}
              />
              {node.color ? <circle cx={textAnchor === "middle" ? node.x : markerX} cy={node.y} r="5" fill={node.color} /> : null}
              <text x={titleX} y={node.y - 4} textAnchor={textAnchor} fontSize="12" fontWeight="700" fill="#0f172a">{node.title}</text>
              <text x={subtitleX} y={node.y + 12} textAnchor={textAnchor} fontSize="10.5" fill="#64748b">{node.subtitle}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function MotionDebugWidget({ motionDebug, panX, debugAnchor }) {
  const center = 44;
  const maxVector = 28;
  const xOffset = clamp(motionDebug.dx, -1, 1) * maxVector;
  const yOffset = clamp(motionDebug.dy, -1, 1) * maxVector;

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between text-xs font-medium text-slate-600">
        <span>Motion debug</span>
        <span>{motionDebug.kind}</span>
      </div>
      <div className="mt-3 flex items-start gap-3">
        <div
          className="relative h-[88px] w-[88px] overflow-hidden rounded-lg border border-slate-300 bg-white"
          style={{
            backgroundImage: [
              "linear-gradient(to right, rgba(148,163,184,0.2) 1px, transparent 1px)",
              "linear-gradient(to bottom, rgba(148,163,184,0.2) 1px, transparent 1px)",
              "linear-gradient(to right, rgba(100,116,139,0.28) 1px, transparent 1px)",
              "linear-gradient(to bottom, rgba(100,116,139,0.28) 1px, transparent 1px)",
            ].join(", "),
            backgroundSize: "11px 11px, 11px 11px, 22px 22px, 22px 22px",
          }}
        >
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-slate-300" />
          <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-slate-300" />
          <div
            className="absolute left-1/2 top-1/2 h-0.5 -translate-y-1/2 bg-rose-500"
            style={{ width: Math.abs(xOffset), transform: `translateY(-50%) translateX(${xOffset < 0 ? xOffset : 0}px)` }}
          />
          <div
            className="absolute top-1/2 left-1/2 w-0.5 -translate-x-1/2 bg-emerald-500"
            style={{ height: Math.abs(yOffset), transform: `translateX(-50%) translateY(${yOffset < 0 ? yOffset : 0}px)` }}
          />
          <div
            className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-slate-500 bg-white"
            style={{ left: center + xOffset, top: center + yOffset }}
          />
          {debugAnchor?.visible ? (
            <div
              className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-emerald-700 bg-emerald-400 shadow-[0_0_0_2px_rgba(16,185,129,0.16)]"
              style={{ left: clamp(debugAnchor.xRatio * 88, 6, 82), top: clamp(debugAnchor.yRatio * 88, 6, 82) }}
            />
          ) : null}
        </div>
        <div className="space-y-1 text-[11px] text-slate-600">
          <div><span className="font-medium text-slate-700">dx:</span> {motionDebug.rawDx.toFixed(1)}</div>
          <div><span className="font-medium text-slate-700">dy:</span> {motionDebug.rawDy.toFixed(1)}</div>
          <div><span className="font-medium text-slate-700">panX:</span> {Math.round(panX)}</div>
          <div><span className="font-medium text-slate-700">source:</span> {motionDebug.source}</div>
          {debugAnchor?.visible ? <div><span className="font-medium text-slate-700">focus:</span> {Math.round(debugAnchor.worldX)}</div> : null}
        </div>
      </div>
    </div>
  );
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) return "n/a";
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${Math.round(value)} B`;
}

function MemoryMapWidget({ memoryMap }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600">
      <div className="flex items-center justify-between text-xs font-medium text-slate-700">
        <span>Memory map</span>
        <span>{memoryMap.heapSupported ? "heap live" : "heap unavailable"}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-white px-2 py-1.5">
          <div className="font-medium text-slate-700">JS heap</div>
          <div>{formatBytes(memoryMap.heapUsed)}</div>
        </div>
        <div className="rounded-lg bg-white px-2 py-1.5">
          <div className="font-medium text-slate-700">Heap limit</div>
          <div>{formatBytes(memoryMap.heapLimit)}</div>
        </div>
        <div className="rounded-lg bg-white px-2 py-1.5">
          <div className="font-medium text-slate-700">Scene nodes</div>
          <div>{memoryMap.sceneNodes}</div>
        </div>
        <div className="rounded-lg bg-white px-2 py-1.5">
          <div className="font-medium text-slate-700">Visible entries</div>
          <div>{memoryMap.visibleItems}</div>
        </div>
        <div className="rounded-lg bg-white px-2 py-1.5">
          <div className="font-medium text-slate-700">Total items</div>
          <div>{memoryMap.totalItems}</div>
        </div>
        <div className="rounded-lg bg-white px-2 py-1.5">
          <div className="font-medium text-slate-700">Approx scene bytes</div>
          <div>{formatBytes(memoryMap.approxSceneBytes)}</div>
        </div>
      </div>
    </div>
  );
}

function ViewportSizeWidget({ browserSize, timelineViewport }) {
  const timelineWidth = Math.max(0, Math.round(timelineViewport.width || 0));
  const timelineHeight = Math.max(0, Math.round((timelineViewport.bottom || 0) - (timelineViewport.top || 0)));

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600">
      <div className="flex items-center justify-between text-xs font-medium text-slate-700">
        <span>Viewport</span>
        <span>live</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-white px-2 py-1.5">
          <div className="font-medium text-slate-700">Browser</div>
          <div>{Math.round(browserSize.width)} x {Math.round(browserSize.height)}</div>
        </div>
        <div className="rounded-lg bg-white px-2 py-1.5">
          <div className="font-medium text-slate-700">Timeline view</div>
          <div>{timelineWidth} x {timelineHeight}</div>
        </div>
      </div>
    </div>
  );
}

function ZoomSensitivityMeter({ sensitivity, currentScale }) {
  const ratio = clamp((sensitivity - 0.4) / (4 - 0.4), 0, 1);

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600">
      <div className="flex items-center justify-between text-xs font-medium text-slate-700">
        <span>Zoom speed</span>
        <span>{sensitivity.toFixed(2)}x</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-[linear-gradient(90deg,#22c55e,#84cc16,#f59e0b)]"
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] uppercase tracking-[0.12em] text-slate-500">
        <span>gentle</span>
        <span>timeline scale {currentScale.toFixed(3)}</span>
        <span>fast</span>
      </div>
    </div>
  );
}

function SceneTuningPanel({
  sceneTuning,
  setSceneTuning,
  yearScale,
  motionDebug,
  timelinePanX,
  debugAnchor,
  memoryMap,
  browserSize,
  timelineViewport,
  compact = false,
}) {
  return (
    <div className={`mx-auto w-full ${compact ? "max-w-sm space-y-2" : "max-w-md space-y-3"}`}>
      <label className="space-y-1">
        <div className="flex items-center justify-between text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
          <span>Horizon</span>
          <span>{sceneTuning.horizonY}</span>
        </div>
        <input
          type="range"
          min="64"
          max="220"
          value={sceneTuning.horizonY}
          onChange={(e) => setSceneTuning((current) => ({ ...current, horizonY: Number(e.target.value) }))}
          className="w-full"
        />
      </label>
      <label className="space-y-1">
        <div className="flex items-center justify-between text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
          <span>Vanishing X</span>
          <span>{sceneTuning.vanishingX}</span>
        </div>
        <input
          type="range"
          min="-420"
          max="140"
          value={sceneTuning.vanishingX}
          onChange={(e) => setSceneTuning((current) => ({ ...current, vanishingX: Number(e.target.value) }))}
          className="w-full"
        />
      </label>
      <label className="space-y-1">
        <div className="flex items-center justify-between text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
          <span>Timeline min year</span>
          <span>{sceneTuning.timelineMinYear}</span>
        </div>
        <Input
          type="number"
          step="1"
          value={sceneTuning.timelineMinYear}
          onChange={(e) => setSceneTuning((current) => {
            const nextMin = Number(e.target.value || current.timelineMinYear);
            return {
              ...current,
              timelineMinYear: nextMin,
              timelineMaxYear: Math.max(nextMin + 1, current.timelineMaxYear),
            };
          })}
        />
      </label>
      <label className="space-y-1">
        <div className="flex items-center justify-between text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
          <span>Timeline max year</span>
          <span>{sceneTuning.timelineMaxYear}</span>
        </div>
        <Input
          type="number"
          step="1"
          value={sceneTuning.timelineMaxYear}
          onChange={(e) => setSceneTuning((current) => {
            const nextMax = Number(e.target.value || current.timelineMaxYear);
            return {
              ...current,
              timelineMinYear: Math.min(current.timelineMinYear, nextMax - 1),
              timelineMaxYear: nextMax,
            };
          })}
        />
      </label>
      <label className="space-y-1">
        <div className="flex items-center justify-between text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
          <span>Label gap</span>
          <span>{sceneTuning.labelGap}</span>
        </div>
        <input
          type="range"
          min="6"
          max="80"
          value={sceneTuning.labelGap}
          onChange={(e) => setSceneTuning((current) => ({ ...current, labelGap: Number(e.target.value) }))}
          className="w-full"
        />
      </label>
      <label className="space-y-1">
        <div className="flex items-center justify-between text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
          <span>Group margin</span>
          <span>{sceneTuning.entryGroupMargin}</span>
        </div>
        <input
          type="range"
          min="6"
          max="28"
          step="1"
          value={sceneTuning.entryGroupMargin}
          onChange={(e) => setSceneTuning((current) => ({ ...current, entryGroupMargin: Number(e.target.value) }))}
          className="w-full"
        />
      </label>
      <label className="space-y-1">
        <div className="flex items-center justify-between text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
          <span>Box size</span>
          <span>{sceneTuning.entryBoxScale.toFixed(2)}</span>
        </div>
        <input
          type="range"
          min="0.65"
          max="1.5"
          step="0.05"
          value={sceneTuning.entryBoxScale}
          onChange={(e) => setSceneTuning((current) => ({ ...current, entryBoxScale: Number(e.target.value) }))}
          className="w-full"
        />
      </label>
      <label className="space-y-1">
        <div className="flex items-center justify-between text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
          <span>Group square</span>
          <span>{sceneTuning.entrySquareSize}</span>
        </div>
        <input
          type="range"
          min="36"
          max="112"
          step="4"
          value={sceneTuning.entrySquareSize}
          onChange={(e) => setSceneTuning((current) => ({ ...current, entrySquareSize: Number(e.target.value) }))}
          className="w-full"
        />
      </label>
      <label className="space-y-1">
        <div className="flex items-center justify-between text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
          <span>Group spacing</span>
          <span>{sceneTuning.entryGroupRowGap}</span>
        </div>
        <input
          type="range"
          min="0"
          max="48"
          step="1"
          value={sceneTuning.entryGroupRowGap}
          onChange={(e) => setSceneTuning((current) => ({ ...current, entryGroupRowGap: Number(e.target.value) }))}
          className="w-full"
        />
      </label>
      <label className="space-y-1">
        <div className="flex items-center justify-between text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
          <span>Tile opacity</span>
          <span>{sceneTuning.entryTileOpacity.toFixed(2)}</span>
        </div>
        <input
          type="range"
          min="0"
          max="0.65"
          step="0.01"
          value={sceneTuning.entryTileOpacity}
          onChange={(e) => setSceneTuning((current) => ({ ...current, entryTileOpacity: Number(e.target.value) }))}
          className="w-full"
        />
      </label>
      <label className="space-y-1">
        <div className="flex items-center justify-between text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
          <span>Timeline bg opacity</span>
          <span>{sceneTuning.timelineBackgroundOpacity.toFixed(2)}</span>
        </div>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={sceneTuning.timelineBackgroundOpacity}
          onChange={(e) => setSceneTuning((current) => ({ ...current, timelineBackgroundOpacity: Number(e.target.value) }))}
          className="w-full"
        />
      </label>
      <label className="space-y-1">
        <div className="flex items-center justify-between text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
          <span>Nodegraph bg opacity</span>
          <span>{sceneTuning.nodegraphBackgroundOpacity.toFixed(2)}</span>
        </div>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={sceneTuning.nodegraphBackgroundOpacity}
          onChange={(e) => setSceneTuning((current) => ({ ...current, nodegraphBackgroundOpacity: Number(e.target.value) }))}
          className="w-full"
        />
      </label>
      <label className="space-y-1">
        <div className="flex items-center justify-between text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
          <span>Tile tint</span>
          <span className="font-mono normal-case tracking-normal text-slate-400">{sceneTuning.entryTileTint}</span>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/80 px-3 py-2">
          <input
            type="color"
            value={sceneTuning.entryTileTint}
            onChange={(e) => setSceneTuning((current) => ({ ...current, entryTileTint: e.target.value }))}
            className="h-9 w-12 cursor-pointer rounded-md border-0 bg-transparent p-0"
          />
          <div
            className="h-9 w-full rounded-xl border border-slate-200"
            style={{ background: sceneTuning.entryTileTint }}
            aria-hidden="true"
          />
        </div>
      </label>
      <label className="space-y-1">
        <div className="flex items-center justify-between text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
          <span>Timeline grid</span>
          <span>{sceneTuning.showTimelineGrid ? "On" : "Off"}</span>
        </div>
        <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/80 px-3 py-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={sceneTuning.showTimelineGrid}
            onChange={(e) => setSceneTuning((current) => ({ ...current, showTimelineGrid: e.target.checked }))}
            className="h-4 w-4 rounded border-slate-300"
          />
          <span>Show timeline mesh grid</span>
        </label>
      </label>
      <label className="space-y-1">
        <div className="flex items-center justify-between text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
          <span>Render buffer rows</span>
          <span>{sceneTuning.renderBufferRows}</span>
        </div>
        <input
          type="range"
          min="0"
          max="24"
          step="1"
          value={sceneTuning.renderBufferRows}
          onChange={(e) => setSceneTuning((current) => ({ ...current, renderBufferRows: Number(e.target.value) }))}
          className="w-full"
        />
      </label>
      <label className="space-y-1">
        <div className="flex items-center justify-between text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
          <span>Mesh depth</span>
          <span>n={Math.round(sceneTuning.meshFade)}</span>
        </div>
        <input
          type="range"
          min="1"
          max="5"
          step="1"
          value={sceneTuning.meshFade}
          onChange={(e) => setSceneTuning((current) => ({ ...current, meshFade: Number(e.target.value) }))}
          className="w-full"
        />
      </label>
      <label className="space-y-1">
        <div className="flex items-center justify-between text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
          <span>Large tick years</span>
          <span>{sceneTuning.majorTickYears}</span>
        </div>
        <Input
          type="number"
          min="5"
          step="5"
          value={sceneTuning.majorTickYears}
          onChange={(e) => setSceneTuning((current) => ({ ...current, majorTickYears: Math.max(5, Number(e.target.value || current.majorTickYears)) }))}
        />
      </label>
      <label className="space-y-1">
        <div className="flex items-center justify-between text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
          <span>Small tick years</span>
          <span>{sceneTuning.minorTickYears}</span>
        </div>
        <Input
          type="number"
          min="1"
          step="1"
          value={sceneTuning.minorTickYears}
          onChange={(e) => setSceneTuning((current) => ({ ...current, minorTickYears: Math.max(1, Number(e.target.value || current.minorTickYears)) }))}
        />
      </label>
      <label className="space-y-1">
        <div className="flex items-center justify-between text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
          <span>Bar length</span>
          <span>{sceneTuning.barLengthScale.toFixed(2)}</span>
        </div>
        <input
          type="range"
          min="0.4"
          max="10"
          step="0.05"
          value={sceneTuning.barLengthScale}
          onChange={(e) => setSceneTuning((current) => ({ ...current, barLengthScale: Number(e.target.value) }))}
          className="w-full"
        />
      </label>
      <label className="space-y-1">
        <div className="flex items-center justify-between text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
          <span>Bar height</span>
          <span>{sceneTuning.barScale.toFixed(2)}</span>
        </div>
        <input
          type="range"
          min="0.8"
          max="2.4"
          step="0.05"
          value={sceneTuning.barScale}
          onChange={(e) => setSceneTuning((current) => ({ ...current, barScale: Number(e.target.value) }))}
          className="w-full"
        />
      </label>
      <label className="space-y-1">
        <div className="flex items-center justify-between text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
          <span>Bar name size</span>
          <span>{sceneTuning.nameScale.toFixed(2)}</span>
        </div>
        <input
          type="range"
          min="0.8"
          max="2.4"
          step="0.05"
          value={sceneTuning.nameScale}
          onChange={(e) => setSceneTuning((current) => ({ ...current, nameScale: Number(e.target.value) }))}
          className="w-full"
        />
      </label>
      <label className="space-y-1">
        <div className="flex items-center justify-between text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
          <span>Drag sensitivity</span>
          <span>{sceneTuning.dragSensitivity.toFixed(2)}</span>
        </div>
        <input
          type="range"
          min="0.2"
          max="8"
          step="0.05"
          value={sceneTuning.dragSensitivity}
          onChange={(e) => setSceneTuning((current) => ({ ...current, dragSensitivity: Number(e.target.value) }))}
          className="w-full"
        />
      </label>
      <label className="space-y-1">
        <div className="flex items-center justify-between text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
          <span>Zoom sensitivity</span>
          <span>{sceneTuning.zoomSensitivity.toFixed(2)}</span>
        </div>
        <input
          type="range"
          min="0.4"
          max="4"
          step="0.05"
          value={sceneTuning.zoomSensitivity}
          onChange={(e) => setSceneTuning((current) => ({ ...current, zoomSensitivity: Number(e.target.value) }))}
          className="w-full"
        />
      </label>
      <ZoomSensitivityMeter sensitivity={sceneTuning.zoomSensitivity} currentScale={yearScale} />
      <label className="space-y-1">
        <div className="flex items-center justify-between text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
          <span>Zoom approach</span>
          <span>{sceneTuning.zoomApproach.toFixed(2)}</span>
        </div>
        <input
          type="range"
          min="0.35"
          max="1.25"
          step="0.05"
          value={sceneTuning.zoomApproach}
          onChange={(e) => setSceneTuning((current) => ({ ...current, zoomApproach: Number(e.target.value) }))}
          className="w-full"
        />
      </label>
      <ViewportSizeWidget browserSize={browserSize} timelineViewport={timelineViewport} />
      {!compact ? <MotionDebugWidget motionDebug={motionDebug} panX={timelinePanX} debugAnchor={debugAnchor} /> : null}
      {!compact ? <MemoryMapWidget memoryMap={memoryMap} /> : null}
    </div>
  );
}

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-white p-6">
          <div className="mx-auto max-w-3xl rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-800 shadow-sm">
            <div className="text-sm font-semibold uppercase tracking-[0.14em] text-rose-600">App render failure</div>
            <div className="mt-2 text-base">{this.state.error.message || "Unknown runtime error."}</div>
            <pre className="mt-4 overflow-x-auto whitespace-pre-wrap rounded-xl bg-white/80 p-4 text-xs text-rose-900">
              {this.state.error.stack || "No stack available."}
            </pre>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function HistoricalTimelineAppInner() {
  const { reportSignals } = useActivityCenter();
  const [items, setItems] = useState([]);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [chronoMode, setChronoMode] = useState("horizontal");
  const [windowEditId, setWindowEditId] = useState(null);
  const [activeTagId, setActiveTagId] = useState(null);
  const [workspacePane, setWorkspacePane] = useState("timeline");
  const [typeFilter, setTypeFilter] = useState([]);
  const [eraFilter, setEraFilter] = useState([]);
  const [categoryFilter, setCategoryFilter] = useState([]);
  const [schoolFilter, setSchoolFilter] = useState([]);
  const [periodFilter, setPeriodFilter] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    async function load() {
      reportSignals({
        id: "activity:timeline:data-load",
        source_module: "timeline",
        source_kind: "dataset_load",
        title: "Timeline dataset load",
        summary: "Loading sacred timeline data and timeline workspace records.",
        severity: "info",
        signal_state: "loading",
        visibility: "public",
      });
      setLoading(true);
      setLoadError("");

      try {
        const result = await timelineDataRepository.getAllTimelineItems();
        if (!alive) return;
        setItems(result);
        const meta = timelineDataRepository.getLastLoadMeta() || {};
        reportSignals([
          {
            id: "activity:timeline:data-load",
            source_module: "timeline",
            source_kind: "dataset_load",
            title: "Timeline dataset load",
            summary: `Loaded ${result.length} total timeline entries into the timeline workspace.`,
            severity: "success",
            signal_state: "ready",
            visibility: "public",
            payload: { item_count: result.length },
          },
          {
            id: "activity:timeline:handoff-load",
            source_module: "timeline",
            source_kind: "market_handoff_load",
            title: "Market timeline handoff",
            summary: meta.handoff_detail || "Market handoff status unavailable.",
            severity: meta.handoff_status === "ready" ? "info" : meta.handoff_status === "unavailable" ? "warning" : "error",
            signal_state: meta.handoff_status || "unknown",
            visibility: "public",
            payload: meta,
          },
        ]);
      } catch (error) {
        if (!alive) return;
        setItems([]);
        setLoadError(error instanceof Error ? error.message : "Failed to load timeline data.");
        reportSignals({
          id: "activity:timeline:data-load",
          source_module: "timeline",
          source_kind: "dataset_load",
          title: "Timeline dataset load",
          summary: error instanceof Error ? error.message : "Failed to load timeline data.",
          severity: "error",
          signal_state: "failed",
          visibility: "public",
        });
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, [reportSignals]);

  const filterOptions = useMemo(() => collectTimelineFilterOptions(items), [items]);
  const { categories, schools, periods, eras } = filterOptions;
  const activeFilterCount = useMemo(
    () => countActiveTimelineFilters({ typeFilter, eraFilter, categoryFilter, schoolFilter, periodFilter }),
    [typeFilter, eraFilter, categoryFilter, schoolFilter, periodFilter]
  );
  const windowEditItem = useMemo(() => items.find((item) => item.id === windowEditId) || null, [items, windowEditId]);

  useEffect(() => {
    setWindowEditId((current) => clearMissingSelectionId(current, items));
  }, [items]);

  const timelineItems = useMemo(
    () => buildFilteredTimelineItems(items, {
      query: deferredQuery,
      typeFilter,
      eraFilter,
      categoryFilter,
      schoolFilter,
      periodFilter,
    }),
    [items, deferredQuery, typeFilter, eraFilter, categoryFilter, schoolFilter, periodFilter]
  );

  useEffect(() => {
    if (windowEditId && !timelineItems.some((item) => item.id === windowEditId)) {
      setWindowEditId(null);
    }
  }, [timelineItems, windowEditId]);

  const tagGraph = useMemo(() => buildTagGraphElements(timelineItems), [timelineItems]);

  const chronoYearOffset = useMemo(() => getChronoYearOffset(timelineItems), [timelineItems]);
  const chronoReady = timelineItems.length > 0 && timelineItems.length <= CHRONO_RENDER_LIMIT;
  const graphReady = tagGraph.tagCount > 0 && tagGraph.nodeCount <= GRAPH_NODE_LIMIT && tagGraph.edgeCount <= GRAPH_EDGE_LIMIT;

  useEffect(() => {
    setActiveTagId((current) => clearMissingActiveTagId(current, tagGraph.elements));
  }, [activeTagId, tagGraph.elements]);

  const chronoItems = useMemo(
    () => buildChronoItems(
      chronoReady ? timelineItems : [],
      chronoYearOffset,
      (item) => [
        item.description,
        item.category ? `Category: ${item.category}` : "",
        item.school ? `School: ${item.school}` : "",
        item.historicalPeriod ? `Period: ${item.historicalPeriod}` : "",
        item.region ? `Region: ${item.region}` : "",
      ].filter(Boolean).join("\n\n")
    ),
    [chronoReady, timelineItems, chronoYearOffset]
  );

  const activeChronoIndex = useMemo(
    () => timelineItems.findIndex((item) => item.id === windowEditId),
    [timelineItems, windowEditId]
  );

  useEffect(() => {
    if (!windowEditItem) return undefined;

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setWindowEditId(null);
        setActiveTagId(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [windowEditItem]);

  async function updateItem(itemId, patch, options = {}) {
    const previousItem = items.find((item) => item.id === itemId);
    if (!previousItem) return false;

    setItems((current) =>
      current.map((item) => (item.id === itemId ? normalizeRecord({ ...item, ...patch }) : item))
    );

    if (options.persist === false) {
      return true;
    }

    try {
      reportSignals({
        id: "activity:timeline:item-save",
        source_module: "timeline",
        source_kind: "timeline_item_save",
        title: "Timeline entry save",
        summary: `Saving ${previousItem.name}.`,
        severity: "info",
        signal_state: "saving",
        visibility: "public",
        payload: {
          item_id: previousItem.id,
          patch,
        },
      });
      await timelineDataRepository.saveTimelineItemPatch(previousItem, patch);
      reportSignals({
        id: "activity:timeline:item-save",
        source_module: "timeline",
        source_kind: "timeline_item_save",
        title: "Timeline entry save",
        summary: `Saved ${previousItem.name} to sacred_timeline_current.json.`,
        severity: "success",
        signal_state: "saved",
        visibility: "public",
        payload: {
          item_id: previousItem.id,
        },
      });
      return true;
    } catch (error) {
      console.error(error);
      setItems((current) =>
        current.map((item) => (item.id === itemId ? previousItem : item))
      );
      reportSignals({
        id: "activity:timeline:item-save",
        source_module: "timeline",
        source_kind: "timeline_item_save",
        title: "Timeline entry save",
        summary: error instanceof Error ? error.message : `Failed to save ${previousItem.name}.`,
        severity: "error",
        signal_state: "failed",
        visibility: "public",
        payload: {
          item_id: previousItem.id,
          patch,
        },
      });
      return false;
    }
  }

  function resetWorkspace() {
    setQuery("");
    setTypeFilter([]);
    setEraFilter([]);
    setCategoryFilter([]);
    setSchoolFilter([]);
    setPeriodFilter([]);
    setWindowEditId(null);
    setActiveTagId(null);
    setWorkspacePane("timeline");
  }

  if (workspacePane !== "__legacy__") {
    return (
      <TimelineGraphWorkspace
        loading={loading}
        loadError={loadError}
        query={query}
        setQuery={setQuery}
        timelineItems={timelineItems}
        activeFilterCount={activeFilterCount}
        activeTagId={activeTagId}
        tagGraph={tagGraph}
        windowEditItem={windowEditItem}
        items={items}
        updateItem={updateItem}
        setWindowEditId={setWindowEditId}
        setActiveTagId={setActiveTagId}
        workspacePane={workspacePane}
        setWorkspacePane={setWorkspacePane}
        resetWorkspace={resetWorkspace}
        chronoItems={chronoItems}
        activeChronoIndex={activeChronoIndex}
        typeFilter={typeFilter}
        setTypeFilter={setTypeFilter}
        eraFilter={eraFilter}
        setEraFilter={setEraFilter}
        categoryFilter={categoryFilter}
        setCategoryFilter={setCategoryFilter}
        schoolFilter={schoolFilter}
        setSchoolFilter={setSchoolFilter}
        periodFilter={periodFilter}
        setPeriodFilter={setPeriodFilter}
        eras={eras}
      categories={categories}
      schools={schools}
      periods={periods}
      chronoReady={chronoReady}
      graphReady={graphReady}
    />
  );
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#e5e8ee] p-3 sm:p-4">
      <div className="mx-auto flex h-[calc(100dvh-1.5rem)] w-full min-w-0 max-w-[1920px] overflow-hidden rounded-[24px] border border-slate-300/80 bg-[#f7f7f3] shadow-[0_22px_50px_rgba(15,23,42,0.12)]">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-300/80 bg-[#f3f3ef] px-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <div className="rounded-full border border-slate-300 bg-white px-3 py-1 text-sm font-semibold text-slate-900">
                Timeline
              </div>
              <div className="hidden items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-slate-500 md:flex">
                <span>{timelineItems.length} items</span>
                <span>{activeFilterCount} filters</span>
                <span>{chronoMode.replace("-", " ")} mode</span>
              </div>
            </div>
            <div className="hidden text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500 sm:block">
              Sacred Timeline Workspace
            </div>
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="shrink-0 border-b border-slate-300/80 bg-[#f7f7f4] px-3 py-3 sm:px-4">
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Badge variant="outline" className="rounded-full border-slate-300 bg-white text-slate-700">
                      {timelineItems.length} items
                    </Badge>
                    <Badge variant="outline" className="rounded-full border-slate-300 bg-white text-slate-700">
                      {activeFilterCount} filters
                    </Badge>
                  </div>

                  <div className="flex min-w-0 flex-wrap items-center gap-2 xl:justify-end">
                    <div className="relative min-w-[240px] flex-1 xl:w-[320px] xl:flex-none">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <Input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search names, periods, schools, tags..."
                        className="border-slate-300 bg-white pl-9"
                      />
                    </div>

                    <Select value={chronoMode} onValueChange={setChronoMode}>
                      <SelectTrigger className="w-[182px] border-slate-300 bg-white">
                        <SelectValue placeholder="Timeline mode" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="horizontal">Horizontal</SelectItem>
                        <SelectItem value="vertical">Vertical</SelectItem>
                        <SelectItem value="alternating">Alternating</SelectItem>
                        <SelectItem value="horizontal-all">Horizontal All</SelectItem>
                      </SelectContent>
                    </Select>

                    <Button
                      variant="outline"
                      className="border-slate-300 bg-white"
                      onClick={() => {
                        setQuery("");
                        setTypeFilter([]);
                        setEraFilter([]);
                        setCategoryFilter([]);
                        setSchoolFilter([]);
                        setPeriodFilter([]);
                        setChronoMode("horizontal");
                        setWindowEditId(null);
                      }}
                    >
                      Reset
                    </Button>
                  </div>
                </div>

                <details className="group rounded-2xl border border-slate-300/80 bg-[#f2f3ee]">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-slate-700 marker:content-none">
                    <span className="flex items-center gap-2">
                      <Filter className="h-4 w-4" /> Filters
                      {activeFilterCount > 0 ? <Badge variant="secondary" className="rounded-full">{activeFilterCount}</Badge> : null}
                    </span>
                    <span className="text-xs uppercase tracking-[0.16em] text-slate-500">Timeline only</span>
                  </summary>
                  <div className="space-y-4 border-t border-slate-300/80 p-4">
                    <div className="grid max-h-[260px] grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-4 overflow-y-auto pr-1">
                      <div className="space-y-2">
                        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Type</div>
                        {EDITABLE_TYPE_OPTIONS.map((option) => (
                          <label key={option.value} className="flex items-center gap-2 text-sm text-slate-700">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-slate-300 text-slate-900"
                              checked={typeFilter.includes(option.value)}
                              onChange={() => setTypeFilter((current) => toggleListValue(current, option.value))}
                            />
                            {option.label}
                          </label>
                        ))}
                      </div>

                      <div className="space-y-2">
                        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Era</div>
                        {eras.map((era) => (
                          <label key={era} className="flex items-center gap-2 text-sm text-slate-700">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-slate-300 text-slate-900"
                              checked={eraFilter.includes(era)}
                              onChange={() => setEraFilter((current) => toggleListValue(current, era))}
                            />
                            {era}
                          </label>
                        ))}
                      </div>

                      <div className="space-y-2">
                        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Category</div>
                        {categories.map((category) => (
                          <label key={category} className="flex items-center gap-2 text-sm text-slate-700">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-slate-300 text-slate-900"
                              checked={categoryFilter.includes(category)}
                              onChange={() => setCategoryFilter((current) => toggleListValue(current, category))}
                            />
                            {category}
                          </label>
                        ))}
                      </div>

                      <div className="space-y-2">
                        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">School</div>
                        {schools.map((school) => (
                          <label key={school} className="flex items-center gap-2 text-sm text-slate-700">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-slate-300 text-slate-900"
                              checked={schoolFilter.includes(school)}
                              onChange={() => setSchoolFilter((current) => toggleListValue(current, school))}
                            />
                            {school}
                          </label>
                        ))}
                      </div>

                      <div className="space-y-2">
                        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Historical period</div>
                        {periods.map((period) => (
                          <label key={period} className="flex items-center gap-2 text-sm text-slate-700">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-slate-300 text-slate-900"
                              checked={periodFilter.includes(period)}
                              onChange={() => setPeriodFilter((current) => toggleListValue(current, period))}
                            />
                            {period}
                          </label>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-600">
                        React Chrono is the only visible timeline surface right now. Filters stay local to this screen.
                      </div>
                      <Button
                        variant="outline"
                        className="border-slate-300 bg-white"
                        onClick={() => {
                          setTypeFilter([]);
                          setEraFilter([]);
                          setCategoryFilter([]);
                          setSchoolFilter([]);
                          setPeriodFilter([]);
                        }}
                      >
                        Clear filters
                      </Button>
                    </div>
                  </div>
                </details>
              </div>
            </div>

            <div className="min-h-0 min-w-0 flex-1 bg-[#eff1eb]">
              {loading ? (
                <div className="p-4">
                  <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">Loading timeline...</div>
                </div>
              ) : loadError ? (
                <div className="p-4">
                  <div className="rounded-2xl border border-dashed border-rose-200 bg-rose-50 p-8 text-center text-rose-700">{loadError}</div>
                </div>
              ) : timelineItems.length === 0 ? (
                <div className="p-4">
                  <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">No matching timeline entries.</div>
                </div>
              ) : (
                <div className="grid min-h-full min-w-0 gap-0 xl:grid-cols-[minmax(0,1fr)_320px]">
                  <div className="min-h-[720px] min-w-0 p-3 xl:pr-3">
                    <div className="h-full overflow-hidden rounded-[18px] border border-slate-300/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
                      <div className="flex items-center justify-between border-b border-slate-200 bg-[#f6f6f2] px-4 py-3">
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">React Chrono</div>
                          <div className="mt-1 text-sm text-slate-700">
                            {timelineItems.length} entries - {chronoMode.replace("-", " ")} mode
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="rounded-full border-slate-300 bg-white text-slate-700">
                            Library baseline
                          </Badge>
                          <Badge variant="outline" className="rounded-full border-slate-300 bg-white text-slate-700">
                            {activeFilterCount} filters
                          </Badge>
                        </div>
                      </div>

                      <div className="h-[calc(100%-69px)] overflow-auto bg-[#fcfcfa] p-4">
                        <div className="chrono-shell h-[760px] rounded-2xl border border-slate-200 bg-white p-4">
                          <Chrono
                            key={`${chronoMode}-${timelineItems.length}`}
                            items={chronoItems}
                            mode={chronoMode}
                            activeItemIndex={activeChronoIndex >= 0 ? activeChronoIndex : 0}
                            allowDynamicUpdate
                            onItemSelected={({ index }) => {
                              const item = timelineItems[index];
                              if (item) setWindowEditId(item.id);
                            }}
                            layout={{
                              cardHeight: "auto",
                              cardWidth: 320,
                              itemWidth: 120,
                              pointSize: 12,
                              timelineHeight: "100%",
                              responsive: { enabled: true, breakpoint: 1100 },
                            }}
                            interaction={{
                              autoScroll: true,
                              keyboardNavigation: true,
                              pointClick: true,
                            }}
                            content={{
                              compactText: true,
                              alignment: { horizontal: "left", vertical: "top" },
                            }}
                            display={{
                              borderless: false,
                              toolbar: { enabled: false },
                              scrollable: { scrollbar: true },
                              pointShape: "diamond",
                            }}
                            media={{
                              height: 180,
                              fit: "cover",
                              align: "center",
                            }}
                            theme={{
                              primary: "#2563eb",
                              secondary: "#94a3b8",
                              titleColor: "#475569",
                              titleColorActive: "#0f172a",
                              cardBgColor: "#ffffff",
                              cardTitleColor: "#0f172a",
                              cardSubtitleColor: "#64748b",
                              cardDetailsColor: "#334155",
                              detailsColor: "#334155",
                              toolbarBgColor: "#f8fafc",
                              timelineBgColor: "#ffffff",
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="min-w-0 border-t border-slate-300/80 bg-[#f7f7f4] xl:border-l xl:border-t-0">
                    {windowEditItem ? (
                      <div className="h-full">
                        <EntryEditorForm
                          item={windowEditItem}
                          items={items}
                          variant="window"
                          onChange={(patch) => updateItem(windowEditItem.id, patch)}
                          onClose={() => setWindowEditId(null)}
                        />
                      </div>
                    ) : (
                      <div className="flex h-full min-h-[220px] items-center justify-center p-6 text-center text-sm text-slate-500">
                        Select a timeline item to inspect media, edit hierarchy, and adjust metadata.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-300/80 bg-[#f5f5f2] px-4 py-2 text-[11px] text-slate-500">
              <div className="flex items-center gap-3">
                <span className="font-medium text-slate-700">{timelineItems.length} timeline items</span>
                <span>{windowEditItem ? `Selected: ${windowEditItem.name}` : "No item selected"}</span>
              </div>
              <div className="flex items-center gap-3">
                <span>Mode {chronoMode.replace("-", " ")}</span>
                <span>{activeFilterCount} active filters</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
