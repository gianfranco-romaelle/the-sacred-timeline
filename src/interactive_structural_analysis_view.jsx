import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  formatStructuralGraphYearRange,
  getStructuralGraphBundleLayout,
  loadStructuralGraphState,
  normalizeStructuralGraphStatePayload,
  parseStructuralGraphDataItemId,
  saveStructuralGraphState,
} from "@/features/graph/structural_graph_loader";
import {
  getGraphTextureBackgroundStyle,
  getStructuralGraphNodeGeometry,
  getStructuralGraphSeedLayout,
  hexToRgba,
  makeSelectionRect,
  rectsIntersect,
} from "@/features/graph/structural_graph_layout";
import { EMPTY_GRAPH_STATE, GRAPH_ZOOM_RANGE } from "@/features/timeline/timeline_constants";
import { useActivityCenter } from "@/features/activity/activity_center";
import { buildStructuralGraph } from "@/projective_scene";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clampScale(value, range) {
  return clamp(value, range.min, range.max);
}

export default function InteractiveStructuralAnalysisView({ sceneModel, items, bundleMode, backgroundOpacity = 0.9, onUpdateItem }) {
  const { reportSignals } = useActivityCenter();
  const viewportRef = useRef(null);
  const dragStateRef = useRef(null);
  const appliedBundleRef = useRef("");
  const lastSavedGraphStateRef = useRef("");
  const [graphState, setGraphState] = useState(EMPTY_GRAPH_STATE);
  const [graphLoaded, setGraphLoaded] = useState(false);
  const [graphSaveStatus, setGraphSaveStatus] = useState("idle");
  const [graphSaveError, setGraphSaveError] = useState("");
  const [selectionBox, setSelectionBox] = useState(null);
  const [spacePressed, setSpacePressed] = useState(false);
  const [inspectorDraft, setInspectorDraft] = useState(null);
  const [itemSaveStatus, setItemSaveStatus] = useState("idle");
  const graph = useMemo(() => buildStructuralGraph(sceneModel, items, bundleMode), [sceneModel, items, bundleMode]);
  const isCalculusMode = bundleMode === "calculus";

  useEffect(() => {
    let alive = true;

    reportSignals({
      id: "activity:timeline:graph-load",
      source_module: "timeline",
      source_kind: "graph_state_load",
      title: "Structural graph state load",
      summary: "Loading structural_graph_state.json for the nodegraph workspace.",
      severity: "info",
      signal_state: "loading",
      visibility: "public",
    });

    loadStructuralGraphState()
      .then((payload) => {
        if (!alive) return;
        setGraphState(payload);
        lastSavedGraphStateRef.current = JSON.stringify(payload);
        reportSignals({
          id: "activity:timeline:graph-load",
          source_module: "timeline",
          source_kind: "graph_state_load",
          title: "Structural graph state load",
          summary: "Structural graph state loaded into the nodegraph workspace.",
          severity: "success",
          signal_state: "ready",
          visibility: "public",
        });
      })
      .catch((error) => {
        if (!alive) return;
        setGraphSaveError(error instanceof Error ? error.message : "Failed to load graph state.");
        setGraphState(EMPTY_GRAPH_STATE);
        lastSavedGraphStateRef.current = JSON.stringify(EMPTY_GRAPH_STATE);
        reportSignals({
          id: "activity:timeline:graph-load",
          source_module: "timeline",
          source_kind: "graph_state_load",
          title: "Structural graph state load",
          summary: error instanceof Error ? error.message : "Failed to load structural graph state.",
          severity: "error",
          signal_state: "failed",
          visibility: "public",
        });
      })
      .finally(() => {
        if (alive) setGraphLoaded(true);
      });

    return () => {
      alive = false;
    };
  }, [reportSignals]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.code !== "Space") return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      setSpacePressed(true);
    }

    function handleKeyUp(event) {
      if (event.code === "Space") {
        setSpacePressed(false);
      }
    }

    function handleWindowBlur() {
      setSpacePressed(false);
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, []);

  const seedLayout = useMemo(() => getStructuralGraphSeedLayout(graph, isCalculusMode), [graph, isCalculusMode]);
  const activeBundleLayout = useMemo(() => getStructuralGraphBundleLayout(graphState, bundleMode), [graphState, bundleMode]);
  const activeZoom = activeBundleLayout.view.zoom || 1;

  function updateActiveBundleLayout(mutator) {
    setGraphState((current) => {
      const normalized = normalizeStructuralGraphStatePayload(current);
      const layout = getStructuralGraphBundleLayout(normalized, bundleMode);
      return normalizeStructuralGraphStatePayload({
        ...normalized,
        bundleLayouts: {
          ...normalized.bundleLayouts,
          [bundleMode]: mutator({
            view: { ...layout.view },
            selection: [...layout.selection],
            nodes: { ...layout.nodes },
          }),
        },
      });
    });
    setGraphSaveError("");
    setGraphSaveStatus("dirty");
  }

  const interactiveNodes = useMemo(() => (
    seedLayout.nodes.map((node) => {
      const override = activeBundleLayout.nodes[node.id] || {};
      return {
        ...node,
        x: Number.isFinite(override.x) ? override.x : node.x,
        y: Number.isFinite(override.y) ? override.y : node.y,
        title: node.group === "data" ? node.title : (typeof override.title === "string" ? override.title : node.title),
        subtitle: node.group === "data" ? node.subtitle : (typeof override.subtitle === "string" ? override.subtitle : node.subtitle),
      };
    })
  ), [seedLayout.nodes, activeBundleLayout.nodes]);

  const nodeById = useMemo(() => new Map(interactiveNodes.map((node) => [node.id, node])), [interactiveNodes]);
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const selectedNodeIds = useMemo(
    () => activeBundleLayout.selection.filter((nodeId) => nodeById.has(nodeId)),
    [activeBundleLayout.selection, nodeById]
  );
  const selectedNodes = useMemo(
    () => selectedNodeIds.map((nodeId) => nodeById.get(nodeId)).filter(Boolean),
    [selectedNodeIds, nodeById]
  );
  const primarySelectedNode = selectedNodes.length === 1 ? selectedNodes[0] : null;
  const primarySelectedItem = useMemo(() => {
    const itemId = parseStructuralGraphDataItemId(primarySelectedNode?.id);
    return itemId ? itemById.get(itemId) || null : null;
  }, [itemById, primarySelectedNode]);

  const interactiveClusterHalos = useMemo(() => {
    if (!isCalculusMode) return seedLayout.clusterHalos;
    const grouped = new Map();
    interactiveNodes.forEach((node) => {
      const key = node.clusterKey || node.id;
      if (!grouped.has(key)) {
        grouped.set(key, { members: [], classification: null, color: node.color || "#94a3b8" });
      }
      const bucket = grouped.get(key);
      bucket.members.push(node);
      if (node.group === "classification") {
        bucket.classification = node;
        bucket.color = node.color || bucket.color;
      }
    });

    return [...grouped.entries()]
      .filter(([, bucket]) => bucket.classification)
      .map(([key, bucket]) => {
        const centerX = bucket.classification.x;
        const centerY = bucket.classification.y;
        const maxDistance = bucket.members.reduce((best, node) => Math.max(best, Math.hypot(node.x - centerX, node.y - centerY)), 0);
        return {
          key,
          x: centerX,
          y: centerY,
          radius: Math.max(72, maxDistance + 42),
          color: bucket.color,
        };
      });
  }, [interactiveNodes, isCalculusMode, seedLayout.clusterHalos]);

  const worldMetrics = useMemo(() => {
    const geometryBounds = interactiveNodes.reduce((bounds, node) => {
      const geometry = getStructuralGraphNodeGeometry(node, isCalculusMode);
      return {
        minX: Math.min(bounds.minX, geometry.x),
        minY: Math.min(bounds.minY, geometry.y),
        maxX: Math.max(bounds.maxX, geometry.x + geometry.width),
        maxY: Math.max(bounds.maxY, geometry.y + geometry.height),
      };
    }, { minX: Number.POSITIVE_INFINITY, minY: Number.POSITIVE_INFINITY, maxX: 0, maxY: 0 });

    const haloBounds = interactiveClusterHalos.reduce((bounds, halo) => ({
      minX: Math.min(bounds.minX, halo.x - halo.radius),
      minY: Math.min(bounds.minY, halo.y - halo.radius),
      maxX: Math.max(bounds.maxX, halo.x + halo.radius),
      maxY: Math.max(bounds.maxY, halo.y + halo.radius),
    }), geometryBounds);

    return {
      width: Math.max(seedLayout.width, Math.ceil((haloBounds.maxX || seedLayout.width) + 220)),
      height: Math.max(seedLayout.height, Math.ceil((haloBounds.maxY || seedLayout.height) + 220)),
    };
  }, [interactiveNodes, interactiveClusterHalos, isCalculusMode, seedLayout.width, seedLayout.height]);

  useLayoutEffect(() => {
    if (!graphLoaded || !viewportRef.current) return;
    if (appliedBundleRef.current === bundleMode) return;
    viewportRef.current.scrollLeft = activeBundleLayout.view.scrollLeft || 0;
    viewportRef.current.scrollTop = activeBundleLayout.view.scrollTop || 0;
    appliedBundleRef.current = bundleMode;
  }, [graphLoaded, bundleMode, activeBundleLayout.view.scrollLeft, activeBundleLayout.view.scrollTop]);

  useEffect(() => {
    if (!graphLoaded) return;
    const serialized = JSON.stringify(graphState);
    if (serialized === lastSavedGraphStateRef.current) return;

    const timeoutId = window.setTimeout(async () => {
      try {
        setGraphSaveStatus("saving");
        reportSignals({
          id: "activity:timeline:graph-save",
          source_module: "timeline",
          source_kind: "graph_state_save",
          title: "Structural graph state save",
          summary: "Saving current nodegraph layout to structural_graph_state.json.",
          severity: "info",
          signal_state: "saving",
          visibility: "public",
        });
        await saveStructuralGraphState(graphState);
        lastSavedGraphStateRef.current = serialized;
        setGraphSaveStatus("saved");
        reportSignals({
          id: "activity:timeline:graph-save",
          source_module: "timeline",
          source_kind: "graph_state_save",
          title: "Structural graph state save",
          summary: "Structural graph layout saved.",
          severity: "success",
          signal_state: "saved",
          visibility: "public",
        });
      } catch (error) {
        setGraphSaveStatus("error");
        setGraphSaveError(error instanceof Error ? error.message : "Failed to save graph state.");
        reportSignals({
          id: "activity:timeline:graph-save",
          source_module: "timeline",
          source_kind: "graph_state_save",
          title: "Structural graph state save",
          summary: error instanceof Error ? error.message : "Failed to save structural graph state.",
          severity: "error",
          signal_state: "failed",
          visibility: "public",
        });
      }
    }, 320);

    return () => window.clearTimeout(timeoutId);
  }, [graphLoaded, graphState, reportSignals]);

  useEffect(() => {
    setItemSaveStatus("idle");
    if (!primarySelectedNode) {
      setInspectorDraft(null);
      return;
    }

    if (primarySelectedItem) {
      setInspectorDraft({
        kind: "data",
        id: primarySelectedNode.id,
        name: primarySelectedItem.name,
        title: primarySelectedItem.title || "",
        startYear: String(primarySelectedItem.startYear),
        endYear: String(primarySelectedItem.endYear),
      });
      return;
    }

    setInspectorDraft({
      kind: "graph",
      id: primarySelectedNode.id,
      title: primarySelectedNode.title || "",
      subtitle: primarySelectedNode.subtitle || "",
    });
  }, [
    primarySelectedNode?.id,
    primarySelectedNode?.title,
    primarySelectedNode?.subtitle,
    primarySelectedItem?.id,
    primarySelectedItem?.name,
    primarySelectedItem?.title,
    primarySelectedItem?.startYear,
    primarySelectedItem?.endYear,
  ]);

  useEffect(() => {
    if (itemSaveStatus === "idle") return;
    reportSignals({
      id: "activity:timeline:graph-item-save",
      source_module: "timeline",
      source_kind: "graph_item_save",
      title: "Node inspector save",
      summary:
        itemSaveStatus === "saving"
          ? "Saving inspector changes back into the timeline dataset."
          : itemSaveStatus === "saved"
            ? "Inspector changes were saved."
            : "Inspector save failed.",
      severity: itemSaveStatus === "error" ? "error" : itemSaveStatus === "saved" ? "success" : "info",
      signal_state: itemSaveStatus,
      visibility: "public",
    });
  }, [itemSaveStatus, reportSignals]);

  useEffect(() => {
    if (!inspectorDraft || inspectorDraft.kind !== "data" || !primarySelectedItem || !onUpdateItem) return;

    const patch = {};
    const nextName = inspectorDraft.name.trim();
    if (nextName && nextName !== primarySelectedItem.name) patch.name = nextName;

    const nextTitle = inspectorDraft.title.trim();
    if (nextTitle !== (primarySelectedItem.title || "")) patch.title = nextTitle;

    const nextStartYear = Number(inspectorDraft.startYear);
    const nextEndYear = Number(inspectorDraft.endYear);
    if (Number.isFinite(nextStartYear) && Number.isFinite(nextEndYear)) {
      if (nextStartYear !== primarySelectedItem.startYear || nextEndYear !== primarySelectedItem.endYear) {
        patch.startYear = nextStartYear;
        patch.endYear = nextEndYear;
      }
    }

    if (Object.keys(patch).length === 0) {
      setItemSaveStatus("idle");
      return;
    }

    const timeoutId = window.setTimeout(async () => {
      setItemSaveStatus("saving");
      const saved = await onUpdateItem(primarySelectedItem.id, patch, { persist: true });
      setItemSaveStatus(saved ? "saved" : "error");
    }, 420);

    return () => window.clearTimeout(timeoutId);
  }, [inspectorDraft, primarySelectedItem, onUpdateItem]);

  function setSelectedNodeIds(nextSelection) {
    updateActiveBundleLayout((layout) => ({
      ...layout,
      selection: [...new Set(nextSelection)].filter((nodeId) => nodeById.has(nodeId)),
    }));
  }

  function getWorldPointFromClient(clientX, clientY) {
    const viewport = viewportRef.current;
    if (!viewport) return { x: 0, y: 0 };
    const rect = viewport.getBoundingClientRect();
    return {
      x: (clientX - rect.left + viewport.scrollLeft) / activeZoom,
      y: (clientY - rect.top + viewport.scrollTop) / activeZoom,
    };
  }

  function handleViewportScroll(event) {
    const viewport = event.currentTarget;
    updateActiveBundleLayout((layout) => ({
      ...layout,
      view: {
        ...layout.view,
        zoom: activeZoom,
        scrollLeft: viewport.scrollLeft,
        scrollTop: viewport.scrollTop,
      },
    }));
  }

  function handleViewportWheel(event) {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const wantsZoom = event.shiftKey;
    if (!wantsZoom) {
      return;
    }

    if (event.cancelable) {
      event.preventDefault();
    }
    event.stopPropagation();

    const rect = viewport.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    const worldX = (viewport.scrollLeft + offsetX) / activeZoom;
    const worldY = (viewport.scrollTop + offsetY) / activeZoom;
    const nativeWheelDelta = event.nativeEvent?.wheelDelta ?? 0;
    const dominantDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    const wheelDelta = dominantDelta || (nativeWheelDelta ? -nativeWheelDelta : 0);
    if (!wheelDelta) return;
    const zoomFactor = Math.exp(-wheelDelta / 240);
    const nextZoom = clampScale(activeZoom * zoomFactor, GRAPH_ZOOM_RANGE);
    if (nextZoom === activeZoom) return;

    const nextScrollLeft = clamp(worldX * nextZoom - offsetX, 0, Math.max(0, worldMetrics.width * nextZoom - viewport.clientWidth));
    const nextScrollTop = clamp(worldY * nextZoom - offsetY, 0, Math.max(0, worldMetrics.height * nextZoom - viewport.clientHeight));
    viewport.scrollLeft = nextScrollLeft;
    viewport.scrollTop = nextScrollTop;

    updateActiveBundleLayout((layout) => ({
      ...layout,
      view: {
        zoom: nextZoom,
        scrollLeft: nextScrollLeft,
        scrollTop: nextScrollTop,
      },
    }));
  }

  function handleBackgroundPointerDown(event) {
    if (event.button !== 0) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const startWorld = getWorldPointFromClient(event.clientX, event.clientY);

    if (spacePressed) {
      event.preventDefault();
      viewport.setPointerCapture?.(event.pointerId);
      document.body.style.userSelect = "none";
      document.body.style.cursor = "grabbing";
      dragStateRef.current = {
        mode: "pan",
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startScrollLeft: viewport.scrollLeft,
        startScrollTop: viewport.scrollTop,
      };
      return;
    }

    event.preventDefault();
    dragStateRef.current = {
      mode: "select",
      pointerId: event.pointerId,
      startWorld,
      additive: event.metaKey || event.ctrlKey,
      initialSelection: selectedNodeIds,
    };
    setSelectionBox(makeSelectionRect(startWorld, startWorld));
  }

  function handleNodePointerDown(event, nodeId) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    if (spacePressed) {
      handleBackgroundPointerDown(event);
      return;
    }

    const isToggle = event.metaKey || event.ctrlKey;
    if (isToggle) {
      setSelectedNodeIds(
        selectedNodeIds.includes(nodeId)
          ? selectedNodeIds.filter((value) => value !== nodeId)
          : [...selectedNodeIds, nodeId]
      );
      return;
    }

    const dragIds = selectedNodeIds.includes(nodeId) ? selectedNodeIds : [nodeId];
    if (!selectedNodeIds.includes(nodeId) || selectedNodeIds.length !== 1) {
      setSelectedNodeIds(dragIds);
    }

    dragStateRef.current = {
      mode: "drag",
      pointerId: event.pointerId,
      startWorld: getWorldPointFromClient(event.clientX, event.clientY),
      dragIds,
      initialPositions: Object.fromEntries(
        dragIds
          .map((id) => {
            const node = nodeById.get(id);
            return node ? [id, { x: node.x, y: node.y }] : null;
          })
          .filter(Boolean)
      ),
    };
  }

  function endGraphPointerGesture(pointerId) {
    const viewport = viewportRef.current;
    if (viewport) {
      viewport.releasePointerCapture?.(pointerId);
    }
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    dragStateRef.current = null;
    setSelectionBox(null);
  }

  useEffect(() => {
    function handleWindowPointerMove(event) {
      const state = dragStateRef.current;
      const viewport = viewportRef.current;
      if (!state || !viewport || state.pointerId !== event.pointerId) return;

      if (state.mode === "pan") {
        event.preventDefault();
        viewport.scrollLeft = clamp(
          state.startScrollLeft - (event.clientX - state.startClientX),
          0,
          Math.max(0, viewport.scrollWidth - viewport.clientWidth)
        );
        viewport.scrollTop = clamp(
          state.startScrollTop - (event.clientY - state.startClientY),
          0,
          Math.max(0, viewport.scrollHeight - viewport.clientHeight)
        );
        updateActiveBundleLayout((layout) => ({
          ...layout,
          view: {
            ...layout.view,
            zoom: activeZoom,
            scrollLeft: viewport.scrollLeft,
            scrollTop: viewport.scrollTop,
          },
        }));
        return;
      }

      const world = getWorldPointFromClient(event.clientX, event.clientY);
      if (state.mode === "select") {
        event.preventDefault();
        setSelectionBox(makeSelectionRect(state.startWorld, world));
        return;
      }

      if (state.mode === "drag") {
        event.preventDefault();
        const deltaX = world.x - state.startWorld.x;
        const deltaY = world.y - state.startWorld.y;
        updateActiveBundleLayout((layout) => {
          const nextNodes = { ...layout.nodes };
          state.dragIds.forEach((id) => {
            const initial = state.initialPositions[id];
            if (!initial) return;
            nextNodes[id] = {
              ...nextNodes[id],
              x: clamp(initial.x + deltaX, 60, worldMetrics.width - 60),
              y: clamp(initial.y + deltaY, 72, worldMetrics.height - 60),
            };
          });
          return {
            ...layout,
            selection: state.dragIds,
            nodes: nextNodes,
          };
        });
      }
    }

    function handleWindowPointerUp(event) {
      const state = dragStateRef.current;
      if (!state || state.pointerId !== event.pointerId) return;

      if (state.mode === "select") {
        const rect = selectionBox || makeSelectionRect(state.startWorld, state.startWorld);
        const hitNodeIds = interactiveNodes
          .filter((node) => rectsIntersect(rect, getStructuralGraphNodeGeometry(node, isCalculusMode)))
          .map((node) => node.id);

        if (rect.width < 4 && rect.height < 4) {
          setSelectedNodeIds(state.additive ? state.initialSelection : []);
        } else {
          setSelectedNodeIds(state.additive ? [...state.initialSelection, ...hitNodeIds] : hitNodeIds);
        }
      }

      endGraphPointerGesture(event.pointerId);
    }

    window.addEventListener("pointermove", handleWindowPointerMove, { passive: false });
    window.addEventListener("pointerup", handleWindowPointerUp);
    window.addEventListener("pointercancel", handleWindowPointerUp);
    return () => {
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("pointerup", handleWindowPointerUp);
      window.removeEventListener("pointercancel", handleWindowPointerUp);
    };
  }, [activeZoom, interactiveNodes, isCalculusMode, selectionBox, selectedNodeIds, worldMetrics.height, worldMetrics.width]);

  async function handleExportGraphState() {
    try {
      setGraphSaveStatus("saving");
      await saveStructuralGraphState(graphState);
      lastSavedGraphStateRef.current = JSON.stringify(graphState);
      setGraphSaveStatus("saved");
      setGraphSaveError("");
    } catch (error) {
      setGraphSaveStatus("error");
      setGraphSaveError(error instanceof Error ? error.message : "Failed to export graph state.");
    }
  }

  function handleGraphInspectorChange(field, value) {
    if (!inspectorDraft) return;
    const nextDraft = { ...inspectorDraft, [field]: value };
    setInspectorDraft(nextDraft);

    if (nextDraft.kind === "graph") {
      updateActiveBundleLayout((layout) => ({
        ...layout,
        nodes: {
          ...layout.nodes,
          [nextDraft.id]: {
            ...layout.nodes[nextDraft.id],
            title: nextDraft.title,
            subtitle: nextDraft.subtitle,
          },
        },
      }));
    }
  }

  function resetGraphView() {
    const viewport = viewportRef.current;
    const availableWidth = viewport?.clientWidth || worldMetrics.width;
    const availableHeight = viewport?.clientHeight || worldMetrics.height;
    const fitZoom = clampScale(
      Math.min(
        availableWidth / Math.max(1, worldMetrics.width),
        availableHeight / Math.max(1, worldMetrics.height)
      ),
      GRAPH_ZOOM_RANGE
    );
    if (viewport) {
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
    }
    updateActiveBundleLayout((layout) => ({
      ...layout,
      view: {
        zoom: fitZoom,
        scrollLeft: 0,
        scrollTop: 0,
      },
    }));
  }

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

  if (!graphLoaded) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center text-slate-500">
        Loading nodegraph workspace...
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-slate-200 bg-[radial-gradient(circle_at_top_left,_#f8fafc,_#ffffff_62%)] p-4">
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary" className="rounded-full bg-slate-900 text-white">
            {isCalculusMode ? "Calculus-class point clusters" : "Widgets + timeline data"}
          </Badge>
          <Badge variant="outline" className="rounded-full border-slate-300 bg-white text-slate-700">Drag-select, space-pan, shift + wheel zoom</Badge>
          <Badge variant="outline" className="rounded-full border-slate-300 bg-white text-slate-700">Auto-save: {graphSaveStatus}</Badge>
          {graphSaveError ? <Badge variant="outline" className="rounded-full border-rose-200 text-rose-700">{graphSaveError}</Badge> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="rounded-full" onClick={resetGraphView}>Reset view</Button>
          <Button variant="outline" className="rounded-full" onClick={handleExportGraphState}>Export graph state</Button>
        </div>
      </div>

      <div
        className="grid min-w-0 min-h-0 flex-1 gap-4"
        style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, clamp(220px, 24vw, 320px))" }}
      >
        <div className="flex min-w-0 min-h-0 flex-col rounded-3xl border border-slate-200 shadow-sm" style={getGraphTextureBackgroundStyle(backgroundOpacity)}>
          <div className="border-b border-slate-100 px-4 py-3 text-sm text-slate-600">
            {spacePressed
              ? "Space held: drag to pan"
              : "Drag empty space to box-select. Wheel scrolls vertically. Hold Shift and wheel to zoom."}
          </div>
          <div
            ref={viewportRef}
            className={`relative min-h-0 flex-1 overflow-auto overscroll-none rounded-b-3xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${spacePressed ? "cursor-grab" : "cursor-crosshair"}`}
            style={{ ...getGraphTextureBackgroundStyle(backgroundOpacity), scrollbarWidth: "none", msOverflowStyle: "none" }}
            onScroll={handleViewportScroll}
            onWheel={handleViewportWheel}
          >
            <div
              className="relative"
              style={{
                width: `${worldMetrics.width * activeZoom}px`,
                height: `${worldMetrics.height * activeZoom}px`,
                minWidth: "100%",
              }}
              onPointerDown={handleBackgroundPointerDown}
            >
              <svg
                width={worldMetrics.width}
                height={worldMetrics.height}
                className="absolute left-0 top-0 block overflow-visible"
                style={{
                  transform: `scale(${activeZoom})`,
                  transformOrigin: "top left",
                }}
              >
                {seedLayout.groupLabels.map((group) => (
                  <g key={group.key}>
                    <text x={group.x} y={36} textAnchor="middle" fontSize="12" fontWeight="700" fill="#475569">{group.title}</text>
                  </g>
                ))}

                {interactiveClusterHalos.map((halo) => (
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
                ))}

                {renderedEdges.map((edge) => {
                  const source = nodeById.get(edge.source);
                  const target = nodeById.get(edge.target);
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

                {interactiveNodes.map((node) => {
                  const isSelected = selectedNodeIds.includes(node.id);
                  const geometry = getStructuralGraphNodeGeometry(node, isCalculusMode);
                  const graphItem = node.group === "data" ? itemById.get(parseStructuralGraphDataItemId(node.id)) : null;

                  if (isCalculusMode && node.group === "data") {
                    const previewImage = graphItem?.images?.[0];
                    const yearsLabel = formatStructuralGraphYearRange(graphItem);
                    const imageSize = 40;
                    const imageX = geometry.x + 8;
                    const imageY = geometry.y + 8;
                    const textX = imageX + imageSize + 10;
                    return (
                      <g key={node.id} onPointerDown={(event) => handleNodePointerDown(event, node.id)}>
                        <title>{`${node.title}${yearsLabel ? ` (${yearsLabel})` : ""}`}</title>
                        <rect
                          x={geometry.x}
                          y={geometry.y}
                          width={geometry.width}
                          height={geometry.height}
                          rx="16"
                          fill="#ffffff"
                          stroke={isSelected ? "#0f172a" : (node.color || "#cbd5e1")}
                          strokeWidth={isSelected ? "2.2" : "1.2"}
                        />
                        <rect
                          x={imageX}
                          y={imageY}
                          width={imageSize}
                          height={imageSize}
                          rx="10"
                          fill={hexToRgba(node.color || "#334155", 0.12)}
                          stroke={hexToRgba(node.color || "#334155", 0.2)}
                        />
                        {previewImage ? (
                          <foreignObject x={imageX} y={imageY} width={imageSize} height={imageSize}>
                            <div xmlns="http://www.w3.org/1999/xhtml" style={{ width: "100%", height: "100%", borderRadius: "10px", overflow: "hidden" }}>
                              <img
                                src={previewImage}
                                alt={node.title}
                                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                              />
                            </div>
                          </foreignObject>
                        ) : (
                          <circle
                            cx={imageX + imageSize / 2}
                            cy={imageY + imageSize / 2}
                            r="7"
                            fill={node.color || "#334155"}
                            stroke="#ffffff"
                            strokeWidth="1.5"
                          />
                        )}
                        <text x={textX} y={node.y - 3} fontSize="11.5" fontWeight="700" fill="#0f172a">
                          {node.title}
                        </text>
                        <text x={textX} y={node.y + 13} fontSize="10.5" fill="#64748b">
                          {yearsLabel}
                        </text>
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
                  const stroke = isSelected ? "#0f172a" : (node.color || (node.group === "data" ? "#cbd5e1" : "#bfdbfe"));
                  const textAnchor = isCalculusMode && node.group === "classification" ? "middle" : "start";
                  const titleX = textAnchor === "middle" ? node.x : geometry.x + 34;
                  const subtitleX = textAnchor === "middle" ? node.x : geometry.x + 34;
                  const markerX = geometry.x + 18;

                  return (
                    <g key={node.id} onPointerDown={(event) => handleNodePointerDown(event, node.id)}>
                      <rect
                        x={geometry.x}
                        y={geometry.y}
                        width={geometry.width}
                        height={geometry.height}
                        rx={isCalculusMode && node.group === "classification" ? "22" : "18"}
                        fill={fill}
                        stroke={stroke}
                        strokeWidth={isSelected ? "2.2" : "1"}
                      />
                      {node.color ? <circle cx={textAnchor === "middle" ? node.x : markerX} cy={node.y} r="5" fill={node.color} /> : null}
                      <text x={titleX} y={node.y - 4} textAnchor={textAnchor} fontSize="12" fontWeight="700" fill="#0f172a">{node.title}</text>
                      <text x={subtitleX} y={node.y + 12} textAnchor={textAnchor} fontSize="10.5" fill="#64748b">{node.subtitle}</text>
                    </g>
                  );
                })}
              </svg>

              {selectionBox ? (
                <div
                  className="pointer-events-none absolute border border-dashed border-sky-500 bg-sky-200/30"
                  style={{
                    left: selectionBox.x * activeZoom,
                    top: selectionBox.y * activeZoom,
                    width: selectionBox.width * activeZoom,
                    height: selectionBox.height * activeZoom,
                  }}
                />
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex min-w-0 min-h-0 flex-col rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3">
            <div className="text-sm font-semibold text-slate-800">Node inspector</div>
            <div className="text-xs text-slate-500">
              {selectedNodes.length === 0 ? "No selection" : selectedNodes.length === 1 ? primarySelectedNode.id : `${selectedNodes.length} nodes selected`}
            </div>
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="rounded-full">Zoom {activeZoom.toFixed(2)}x</Badge>
              <Badge variant="outline" className="rounded-full">Selected {selectedNodes.length}</Badge>
              <Badge variant="outline" className="rounded-full">Item save {itemSaveStatus}</Badge>
            </div>

            {selectedNodes.length > 1 ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                Drag any selected node to move the whole selection as one group.
              </div>
            ) : null}

            {selectedNodes.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 p-5 text-sm text-slate-500">
                Click or box-select nodes in the graph to inspect and edit them.
              </div>
            ) : null}

            {inspectorDraft?.kind === "data" ? (
              <div className="space-y-3">
                <label className="space-y-1">
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">Name</div>
                  <Input value={inspectorDraft.name} onChange={(event) => handleGraphInspectorChange("name", event.target.value)} />
                </label>
                <label className="space-y-1">
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">Title</div>
                  <Input value={inspectorDraft.title} onChange={(event) => handleGraphInspectorChange("title", event.target.value)} />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1">
                    <div className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">Start year</div>
                    <Input type="number" value={inspectorDraft.startYear} onChange={(event) => handleGraphInspectorChange("startYear", event.target.value)} />
                  </label>
                  <label className="space-y-1">
                    <div className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">End year</div>
                    <Input type="number" value={inspectorDraft.endYear} onChange={(event) => handleGraphInspectorChange("endYear", event.target.value)} />
                  </label>
                </div>
              </div>
            ) : null}

            {inspectorDraft?.kind === "graph" ? (
              <div className="space-y-3">
                <label className="space-y-1">
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">Graph title</div>
                  <Input value={inspectorDraft.title} onChange={(event) => handleGraphInspectorChange("title", event.target.value)} />
                </label>
                <label className="space-y-1">
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">Graph subtitle</div>
                  <Input value={inspectorDraft.subtitle} onChange={(event) => handleGraphInspectorChange("subtitle", event.target.value)} />
                </label>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
