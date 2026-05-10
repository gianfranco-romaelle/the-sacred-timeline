/**
 * Projective scene utilities for the historical timeline.
 * The UI stays in 2D, but every visible element is resolved through
 * a shared projective frame so depth, shadows, and anchoring are consistent.
 */

export function createDefaultProjectiveFrame() {
  return {
    originX: 0,
    originY: 0,
    horizonY: 132,
    vanishingX: -220,
    depthScale: 0.12,
    shadowCurve: 0.38,
    layerPitch: 26,
    labelGap: 24,
    meshFade: 3,
    majorTickYears: 25,
    minorTickYears: 5,
    entryBoxScale: 0.82,
    entryGroupMargin: 10,
    entryGroupRowGap: 8,
    entrySquareSize: 36,
    entryTileOpacity: 0.12,
    entryTileTint: "#ffffff",
    showTimelineGrid: true,
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function yearLabel(year) {
  if (year < 0) return `${Math.abs(year)} BCE`;
  return `${year} CE`;
}

function _dateRangeLabel(item) {
  if (item.startYear === item.endYear || item.endYear == null) {
    return yearLabel(item.startYear);
  }
  return `${yearLabel(item.startYear)} -> ${yearLabel(item.endYear)}`;
}

// Every visible mark is projected through the same frame so lane cards,
// duration bars, and labels share one depth vocabulary instead of drifting.
function projectPoint(x, y, depth, frame) {
  const depthFactor = depth * frame.depthScale;
  return {
    x: lerp(x, frame.vanishingX, depthFactor * 0.4),
    y: lerp(y, frame.horizonY, depthFactor * 0.24),
  };
}

export function projectRect({ x, y, width, height, depth }, frame) {
  const origin = projectPoint(x, y, depth, frame);
  const scale = 1 - depth * frame.depthScale * 0.12;
  const projectedWidth = width * scale;
  const projectedHeight = height * scale;
  const shadowLength = 10 + depth * 8 + Math.max(0, frame.horizonY - y) * frame.shadowCurve * 0.03;
  const shadowDx = clamp((x - frame.vanishingX) * 0.02, -18, 26);
  const shadowDy = shadowLength;

  return {
    rect: {
      x: origin.x,
      y: origin.y,
      width: projectedWidth,
      height: projectedHeight,
    },
    shadow: {
      dx: shadowDx,
      dy: shadowDy,
      blur: 10 + depth * 4,
      opacity: clamp(0.08 + depth * 0.04, 0.08, 0.28),
    },
    zIndex: Math.round(1000 - depth * 10 + y),
  };
}

function laneSortDuration(item) {
  return Math.max(0, (item.endYear ?? item.startYear) - item.startYear);
}

// Materialization is the boundary between abstract placement math and the
// concrete mark/caption bounds that the React layer actually renders.
function materializePlacement(sceneModel, placement) {
  const item = sceneModel.items[placement.itemIndex];
  const markNode = {
    id: `mark-${item.id}`,
    kind: placement.showAsPoint ? "event-dot" : "duration-bar",
    label: item.name,
    depth: placement.depth,
    bounds: placement.showAsPoint
      ? { x: placement.startX - placement.dotSize / 2, y: placement.trackTop, width: placement.dotSize, height: placement.trackHeight }
      : { x: placement.startX, y: placement.trackTop, width: placement.barWidth, height: placement.trackHeight },
    meta: {
      itemId: item.id,
      isInstant: item.isInstant,
      showAsPoint: placement.showAsPoint,
      color: item.color,
      laneIndex: placement.laneIndex,
    },
  };

  return {
    ...placement,
    zIndex: Math.round(markNode.bounds.y + 1000),
    markBounds: markNode.bounds,
    captionBounds: {
      x: placement.captionX,
      y: placement.captionTop,
      width: placement.captionWidth,
      height: placement.captionHeight,
    },
    markNode,
  };
}

export function materializeTimelineLanes(sceneModel, lanes) {
  return lanes.map((lane) => ({
    ...lane,
    placements: lane.placementIndexes.map((placementIndex) => (
      materializePlacement(sceneModel, sceneModel.placements[placementIndex])
    )),
  }));
}

export function materializeTimelineRows(sceneModel, rows) {
  return rows.map((row) => materializePlacement(sceneModel, row));
}

export function buildTimelineScene(items, frame, viewportState) {
  const yearScale = viewportState.yearScale;
  const rowScale = viewportState.rowScale;
  const domainMinYear = viewportState.domainMinYear;
  const domainMaxYear = viewportState.domainMaxYear;
  const labelGap = viewportState.labelGap ?? frame.labelGap ?? 40;
  const baseMajorTickYears = Math.max(5, Math.round(viewportState.majorTickYears ?? frame.majorTickYears ?? 50));
  const baseMinorTickYears = Math.max(1, Math.min(baseMajorTickYears, Math.round(viewportState.minorTickYears ?? frame.minorTickYears ?? 5)));
  const entryBoxScale = viewportState.entryBoxScale ?? frame.entryBoxScale ?? 1;
  const entryGroupMarginBase = viewportState.entryGroupMargin ?? frame.entryGroupMargin ?? 12;
  const entryGroupRowGapBase = viewportState.entryGroupRowGap ?? frame.entryGroupRowGap ?? 16;
  const entrySquareSizeBase = viewportState.entrySquareSize ?? frame.entrySquareSize ?? 56;
  const barScale = viewportState.barScale ?? 1;
  const barLengthScale = viewportState.barLengthScale ?? 1;
  const nameScale = viewportState.nameScale ?? 1;
  const includeStructure = viewportState.includeStructure ?? true;
  const majorTickRatio = Math.max(2, Math.round(baseMajorTickYears / baseMinorTickYears) || 2);
  const desiredMajorYears = 84 / Math.max(yearScale, 0.0001);
  const majorTickCandidates = [];
  for (let exp = -6; exp <= 8; exp += 1) {
    const scaleFactor = Math.pow(2, exp);
    const fromMajor = Math.round(baseMajorTickYears * scaleFactor);
    const fromMinor = Math.round(baseMinorTickYears * scaleFactor);
    if (fromMajor >= baseMinorTickYears) majorTickCandidates.push(fromMajor);
    if (fromMinor >= baseMinorTickYears) majorTickCandidates.push(fromMinor);
  }
  const uniqueMajorTickCandidates = [...new Set(majorTickCandidates)].sort((a, b) => a - b);
  const tickStep = uniqueMajorTickCandidates.reduce((best, candidate) => (
    Math.abs(candidate - desiredMajorYears) < Math.abs(best - desiredMajorYears) ? candidate : best
  ), uniqueMajorTickCandidates[0] ?? baseMajorTickYears);
  const minorTickStep = Math.max(1, Math.round(tickStep / majorTickRatio));
  const exactMajorGrid = Math.max(16, tickStep * yearScale);
  const exactMinorGrid = Math.max(4, minorTickStep * yearScale);
  const mediumGrid = Math.max(8, exactMajorGrid / 2);
  const fineGrid = Math.max(4, exactMinorGrid);
  const minorGrid = Math.max(2, exactMinorGrid / 2);
  const gridUnit = Math.max(1, exactMinorGrid / 2);
  const controlSnap = 2;
  const laneGrid = minorGrid;
  const entryGroupMargin = Math.max(6, Math.round(entryGroupMarginBase * entryBoxScale));
  const entryGroupRowGap = Math.max(0, Math.round(entryGroupRowGapBase));
  const entrySquareSize = Math.max(
    24,
    Math.ceil(Math.max(24, entrySquareSizeBase * 0.5) / controlSnap) * controlSnap
  );
  const timelineInset = Math.ceil(Math.max(48, 64 * entryBoxScale) / controlSnap) * controlSnap;
  const labelColumnWidth = timelineInset;
  const _labelHeight = Math.ceil(Math.max(38, 44 * rowScale) / controlSnap) * controlSnap;
  const estimatedLabelWidth = labelColumnWidth;
  const gridOriginX = timelineInset;
  const baseLaneHeight = Math.ceil(clamp(58 * rowScale, 52, 80) / laneGrid) * laneGrid;
  const laneHeight = baseLaneHeight;
  const headerHeight = 76;
  const firstLaneOffset = 0;
  const sceneTopOffset = 0;

  if (items.length === 0) {
    const emptyMinYear = Number.isFinite(domainMinYear) ? domainMinYear : 0;
    const emptyMaxYear = Number.isFinite(domainMaxYear) ? domainMaxYear : 0;
    const emptyDomain = Math.max(1, emptyMaxYear - emptyMinYear);
    const emptyContentMinX = Math.max(16, gridOriginX - labelGap - estimatedLabelWidth);
    const emptyContentMaxX = emptyDomain * yearScale + gridOriginX;
    return {
      frame,
      yearScale,
      minYear: emptyMinYear,
      maxYear: emptyMaxYear,
      chartWidth: emptyDomain * yearScale + gridOriginX + 240,
      items,
      rowHeight: laneHeight,
      laneHeight,
      barHeight: Math.max(18, Math.round(24 * rowScale * barScale)),
      dotSize: Math.max(10, Math.round(12 * rowScale)),
      barNameFontSize: Math.max(11, Math.round(12 * nameScale)),
      barNameMinWidth: Math.max(24, Math.round(40 * nameScale)),
      labelNameFontSize: Math.max(12, Math.round(13 * entryBoxScale)),
      labelMetaFontSize: Math.max(10, Math.round(11 * entryBoxScale)),
      labelTitleFontSize: Math.max(10, Math.round(11 * entryBoxScale)),
      labelColumnWidth,
      ticks: [],
      minorTicks: [],
      nodes: [],
      edges: [],
      labels: [],
      marks: [],
      placements: [],
      rows: [],
      lanes: [],
      layers: [],
      worldHeight: Math.max(180, laneHeight * 6),
      contentMinX: emptyContentMinX,
      contentMaxX: emptyContentMaxX,
      entryGroupMargin,
      entryGroupRowGap,
      entrySquareSize,
      labelGap,
      majorTickYears: tickStep,
      minorTickYears: minorTickStep,
      tickStep,
      tickSpan: exactMajorGrid,
      grid: {
        originX: gridOriginX,
        majorOriginX: gridOriginX,
        minorOriginX: gridOriginX,
        unit: gridUnit,
        minor: exactMinorGrid,
        fine: fineGrid,
        medium: mediumGrid,
        major: exactMajorGrid,
      },
      sceneTopOffset,
      headerHeight,
      firstLaneOffset,
      firstRowOffset: firstLaneOffset,
      laneCount: 0,
    };
  }
  const itemMinYear = Math.min(...items.map((item) => item.startYear));
  const itemMaxYear = Math.max(...items.map((item) => item.endYear));
  const minYear = Number.isFinite(domainMinYear) ? Math.min(domainMinYear, itemMinYear) : itemMinYear;
  const maxYear = Number.isFinite(domainMaxYear) ? Math.max(domainMaxYear, itemMaxYear) : itemMaxYear;
  const domain = Math.max(1, maxYear - minYear);
  const barHeight = Math.max(8, Math.round(10 * rowScale * Math.max(0.55, barScale)));
  const dotSize = Math.max(10, Math.round(11 * rowScale));
  const barNameFontSize = Math.max(10, Math.round(11 * Math.max(0.75, nameScale * 0.55)));
  const barNameMinWidth = Math.max(48, Math.round(68 * Math.max(0.75, nameScale * 0.55)));
  const barHorizontalPadding = Math.max(10, Math.round(12 * Math.max(0.75, nameScale * 0.55)));
  const labelNameFontSize = Math.max(12, Math.round(13 * entryBoxScale));
  const labelMetaFontSize = Math.max(10, Math.round(11 * entryBoxScale));
  const labelTitleFontSize = Math.max(10, Math.round(11 * entryBoxScale));
  const chartWidth = domain * yearScale + gridOriginX + 240;
  const ticks = [];
  const minorTicks = [];

  const majorTickPaddingYears = Math.max(tickStep * 12, 500);
  const minorTickPaddingYears = Math.max(minorTickStep * 96, 500);

  for (let year = Math.floor((minYear - majorTickPaddingYears) / tickStep) * tickStep; year <= maxYear + majorTickPaddingYears; year += tickStep) {
    ticks.push(year);
  }
  for (let year = Math.floor((minYear - minorTickPaddingYears) / minorTickStep) * minorTickStep; year <= maxYear + minorTickPaddingYears; year += minorTickStep) {
    minorTicks.push(year);
  }
  const majorTickOriginYear = ticks[0] ?? minYear;
  const minorTickOriginYear = minorTicks[0] ?? minYear;
  const leftMajorTickX = ticks.length > 0
    ? gridOriginX + (ticks[0] - minYear) * yearScale
    : gridOriginX;
  const rightMajorTickX = ticks.length > 0
    ? gridOriginX + (ticks[ticks.length - 1] - minYear) * yearScale
    : gridOriginX;
  const leftMinorTickX = minorTicks.length > 0
    ? gridOriginX + (minorTicks[0] - minYear) * yearScale
    : gridOriginX;
  const rightMinorTickX = minorTicks.length > 0
    ? gridOriginX + (minorTicks[minorTicks.length - 1] - minYear) * yearScale
    : gridOriginX;

  const layers = includeStructure ? [] : [];
  const nodes = includeStructure ? [] : [];
  const edges = includeStructure ? [] : [];
  const labels = [];
  const marks = [];
  const placements = [];
  const lanes = [];
  const rows = [];
  let contentMinX = Number.POSITIVE_INFINITY;
  let contentMaxX = Number.NEGATIVE_INFINITY;

  let frameNode;
  let labelLayer;
  let markLayer;
  let interactionLayer;

  if (includeStructure) {
    frameNode = {
      id: "frame",
      kind: "frame",
      label: "Projective Frame",
      depth: 0,
      meta: { horizonY: frame.horizonY, vanishingX: frame.vanishingX },
    };

    nodes.push(frameNode);

    labelLayer = { id: "layer-labels", kind: "layer", label: "EntryLabelLayer", depth: 1 };
    markLayer = { id: "layer-timefield", kind: "layer", label: "TimefieldLayer", depth: 1 };
    interactionLayer = { id: "layer-interaction", kind: "layer", label: "InteractionLayer", depth: 1 };

    layers.push(labelLayer, markLayer, interactionLayer);
    nodes.push(labelLayer, markLayer, interactionLayer);
    edges.push({ id: "edge-frame-labels", source: frameNode.id, target: labelLayer.id, kind: "contains" });
    edges.push({ id: "edge-frame-marks", source: frameNode.id, target: markLayer.id, kind: "contains" });
    edges.push({ id: "edge-frame-interaction", source: frameNode.id, target: interactionLayer.id, kind: "contains" });
  }

  const sortedEntries = items
    .map((item, index) => ({
      item,
      itemIndex: index,
      duration: laneSortDuration(item),
      stableIndex: index,
    }))
    .sort((a, b) => (
      (a.item.startYear - b.item.startYear) ||
      (b.duration - a.duration) ||
      (a.stableIndex - b.stableIndex)
    ));

  const laneEndYears = [];

  sortedEntries.forEach(({ item, itemIndex }) => {
    const depth = Math.max(0, item.depth || 0);
    const startYear = item.startYear;
    const endYear = item.endYear ?? item.startYear;
    let laneIndex = laneEndYears.findIndex((latestEndYear) => latestEndYear < startYear);
    if (laneIndex === -1) {
      laneIndex = laneEndYears.length;
      laneEndYears.push(endYear);
      lanes.push({
        laneIndex,
        laneTop: firstLaneOffset + laneIndex * laneHeight,
        laneHeight,
        placementIndexes: [],
      });
    } else {
      laneEndYears[laneIndex] = endYear;
    }

    const laneTop = firstLaneOffset + laneIndex * laneHeight;
    const laneCenterY = laneTop + laneHeight / 2;
    const startX = gridOriginX + (startYear - minYear) * yearScale;
    const endX = gridOriginX + (endYear - minYear) * yearScale;
    const rawDurationWidth = Math.max(0, (endX - startX) * barLengthScale);
    const snappedDurationWidth = Math.max(
      Math.max(1, exactMinorGrid),
      Math.ceil(rawDurationWidth / Math.max(1, exactMinorGrid)) * Math.max(1, exactMinorGrid)
    );
    const collapseThreshold = Math.max(dotSize * 1.2, exactMinorGrid * 1.25);
    const showAsPoint = item.isInstant || snappedDurationWidth <= collapseThreshold;
    const estimatedTextWidth = Math.ceil(((item.name?.length || 0) + 1) * barNameFontSize * 0.72 + barHorizontalPadding * 1.5);
    const barWidth = showAsPoint ? dotSize : Math.max(snappedDurationWidth, exactMinorGrid);
    const trackTop = laneTop + Math.round(laneHeight * 0.16);
    const trackHeight = showAsPoint ? dotSize : barHeight;
    const captionTop = trackTop + trackHeight + 7;
    const captionHeight = Math.max(16, Math.round(laneHeight * 0.28));
    const captionX = showAsPoint ? startX + dotSize + 8 : startX;
    const captionWidth = Math.max(96, Math.min(220, Math.max(barWidth, estimatedTextWidth)));
    const treeStartYear = Number.isFinite(item.treeStartYear) ? item.treeStartYear : startYear;
    const treeEndYear = Number.isFinite(item.treeEndYear) ? item.treeEndYear : endYear;
    const treeStartX = gridOriginX + (treeStartYear - minYear) * yearScale;
    const treeEndX = gridOriginX + (treeEndYear - minYear) * yearScale;
    const markRight = showAsPoint ? startX + dotSize / 2 : startX + barWidth;
    const captionRight = captionX + captionWidth;

    const placement = {
      placementIndex: placements.length,
      laneIndex,
      laneTop,
      laneHeight,
      itemIndex,
      itemId: item.id,
      laneCenterY,
      startX,
      endX,
      barWidth,
      anchorX: startX,
      anchorY: laneCenterY,
      estimatedTextWidth,
      barHeight,
      dotSize,
      trackTop,
      trackHeight,
      captionTop,
      captionHeight,
      captionX,
      captionWidth,
      isInstant: item.isInstant,
      showAsPoint,
      depth,
      hasChildren: Boolean(item.hasChildren),
      isExpanded: item.isExpanded !== false,
      visibleDescendantCount: item.visibleDescendantCount || 0,
      treeStartX,
      treeEndX,
    };

    placements.push(placement);
    rows.push({
      ...placement,
      rowIndex: placement.placementIndex,
      rowTop: placement.laneTop,
      rowHeight: placement.laneHeight,
      rowCenterY: placement.laneCenterY,
    });
    lanes[laneIndex].placementIndexes.push(placement.placementIndex);

    contentMinX = Math.min(contentMinX, startX - dotSize);
    contentMaxX = Math.max(contentMaxX, markRight, captionRight);

    if (includeStructure) {
      const materializedPlacement = materializePlacement({ frame, items, labelGap }, placement);
      const { markNode } = materializedPlacement;
      marks.push({
        itemIndex,
        node: markNode,
        startX,
        endX,
        estimatedTextWidth,
        laneTop,
        laneHeight,
        barHeight,
        dotSize,
      });
      nodes.push(markNode);
      edges.push({ id: `edge-mark-${item.id}`, source: markLayer.id, target: markNode.id, kind: "contains" });
    }
  });

  const resolvedContentMinX = Number.isFinite(contentMinX) ? contentMinX : Math.max(16, gridOriginX - labelGap - estimatedLabelWidth);
  const resolvedContentMaxX = Number.isFinite(contentMaxX) ? contentMaxX : gridOriginX + domain * yearScale;

  return {
    frame,
    yearScale,
    minYear,
    maxYear,
    chartWidth,
    items,
    rowHeight: laneHeight,
    laneHeight,
    barHeight,
    dotSize,
    barNameFontSize,
    barNameMinWidth,
    barHorizontalPadding,
    labelNameFontSize,
    labelMetaFontSize,
    labelTitleFontSize,
    ticks,
    minorTicks,
    entryGroupMargin,
    entryGroupRowGap,
    entrySquareSize,
    labelGap,
    majorTickYears: tickStep,
    minorTickYears: minorTickStep,
    tickStep,
    tickSpan: exactMajorGrid,
    grid: {
      originX: gridOriginX,
      majorOriginX: gridOriginX + (majorTickOriginYear - minYear) * yearScale,
      minorOriginX: gridOriginX + (minorTickOriginYear - minYear) * yearScale,
      unit: gridUnit,
      minor: exactMinorGrid,
      fine: fineGrid,
      medium: mediumGrid,
      major: exactMajorGrid,
    },
    nodes,
    edges,
    labels,
    marks,
    placements,
    rows,
    lanes,
    layers,
    labelColumnWidth,
    worldHeight: Math.max(laneHeight * lanes.length, laneHeight * 6),
    contentMinX: Math.min(resolvedContentMinX, leftMajorTickX, leftMinorTickX),
    contentMaxX: Math.max(resolvedContentMaxX, rightMajorTickX, rightMinorTickX),
    sceneTopOffset,
    headerHeight,
    firstLaneOffset,
    firstRowOffset: firstLaneOffset,
    laneCount: lanes.length,
  };
}

const calculusClusterOrder = ["Zeroth", "First", "Second", "Third", "Fourth", "Fifth", "Unclassified"];

function getStructuralClassification(item, bundleMode) {
  if (bundleMode === "historicalPeriod") return item.historicalPeriod;
  if (bundleMode === "tag") return item.tags?.[0];
  if (bundleMode === "calculus") return item.calculusName || item.school || "Unclassified";
  return item.school;
}

function getStructuralClassificationSubtitle(bundleMode) {
  if (bundleMode === "historicalPeriod") return "period";
  if (bundleMode === "calculus") return "calculus class";
  return bundleMode;
}

function getCalculusClusterIndex(value) {
  const index = calculusClusterOrder.indexOf(value);
  return index === -1 ? calculusClusterOrder.length : index;
}

export function buildStructuralGraph(sceneModel, items, bundleMode = "calculus") {
  // The graph is derived from the same timeline canon so layout experiments do
  // not silently fork into a second source of truth.
  const graphNodes = [];
  const graphEdges = [];
  const isCalculusMode = bundleMode === "calculus";

  const classifications = new Map();
  const classificationCounts = new Map();
  const sampledItems = items.slice(0, isCalculusMode ? 144 : 18);

  if (isCalculusMode) {
    const visibleClasses = new Set(
      sampledItems
        .map((item) => getStructuralClassification(item, bundleMode))
        .filter(Boolean)
    );

    calculusClusterOrder.forEach((classificationValue) => {
      if (!visibleClasses.has(classificationValue)) return;

      const classificationId = `g-classification-${bundleMode}-${classificationValue}`;
      const sample = sampledItems.find(
        (item) => getStructuralClassification(item, bundleMode) === classificationValue
      );
      const node = {
        id: classificationId,
        group: "classification",
        title: classificationValue,
        subtitle: "calculus class",
        color: sample?.color,
        clusterKey: classificationValue,
        clusterIndex: getCalculusClusterIndex(classificationValue),
      };
      classifications.set(classificationId, node);
      graphNodes.push(node);
    });
  }

  sampledItems.forEach((item, index) => {
    const classificationValue = getStructuralClassification(item, bundleMode);
    const fallbackClusterKey = classificationValue || "Unclassified";
    const dataId = `g-item-${item.id}`;
    graphNodes.push({
      id: dataId,
      group: "data",
      title: item.name,
      subtitle: item.title || item.category || item.historicalPeriod,
      color: item.color,
      clusterKey: fallbackClusterKey,
      clusterIndex: getCalculusClusterIndex(fallbackClusterKey),
    });

    if (classificationValue) {
      const classificationId = `g-classification-${bundleMode}-${classificationValue}`;
      if (!classifications.has(classificationId)) {
        const node = {
          id: classificationId,
          group: "classification",
          title: classificationValue,
          subtitle: getStructuralClassificationSubtitle(bundleMode),
          color: item.color,
          clusterKey: classificationValue,
          clusterIndex: getCalculusClusterIndex(classificationValue),
        };
        classifications.set(classificationId, node);
        graphNodes.push(node);
      }
      classificationCounts.set(classificationId, (classificationCounts.get(classificationId) || 0) + 1);
      graphEdges.push({ source: dataId, target: classificationId, kind: "classified-by" });
    }

    if (isCalculusMode) return;

    const widgetId = `g-widget-${index}`;
    graphNodes.push({ id: widgetId, group: "widget", title: `Widget ${index + 1}`, subtitle: "scene node pair" });
    graphEdges.push(
      { source: widgetId, target: dataId, kind: "represents" },
    );
  });

  classifications.forEach((node) => {
    const count = classificationCounts.get(node.id) || 0;
    node.subtitle = isCalculusMode
      ? `${count} visible`
      : `${getStructuralClassificationSubtitle(bundleMode)} • ${count} visible`;
  });

  return { nodes: graphNodes, edges: graphEdges };
}
