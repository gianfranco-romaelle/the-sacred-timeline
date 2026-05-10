import { cleanTextValue, dateRangeLabel } from "@/features/timeline/timeline_data_loader";

export function compareTimelineItems(a, b) {
  const sortIndexA = Number.isFinite(Number(a.sortIndex)) ? Number(a.sortIndex) : Number.MAX_SAFE_INTEGER;
  const sortIndexB = Number.isFinite(Number(b.sortIndex)) ? Number(b.sortIndex) : Number.MAX_SAFE_INTEGER;
  if (sortIndexA !== sortIndexB) return sortIndexA - sortIndexB;

  const orderKeyA = cleanTextValue(a.orderKey);
  const orderKeyB = cleanTextValue(b.orderKey);
  if (orderKeyA && orderKeyB && orderKeyA !== orderKeyB) {
    return orderKeyA.localeCompare(orderKeyB);
  }

  const yearDelta = (a.sortYear ?? a.startYear ?? 0) - (b.sortYear ?? b.startYear ?? 0);
  if (yearDelta !== 0) return yearDelta;

  const endDelta = (a.endYear ?? a.startYear ?? 0) - (b.endYear ?? b.startYear ?? 0);
  if (endDelta !== 0) return endDelta;

  return String(a.name || "").localeCompare(String(b.name || ""));
}

export function buildVisibleTimelineItems(items, collapsedIds = []) {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const childrenByParentId = new Map();
  const parentById = new Map();

  items.forEach((item) => {
    const resolvedParentId = item.parentId && item.parentId !== item.id && itemById.has(item.parentId)
      ? item.parentId
      : null;
    parentById.set(item.id, resolvedParentId);
    if (!childrenByParentId.has(resolvedParentId)) {
      childrenByParentId.set(resolvedParentId, []);
    }
    childrenByParentId.get(resolvedParentId).push(item);
  });

  childrenByParentId.forEach((siblings) => siblings.sort(compareTimelineItems));

  const subtreeStats = new Map();
  const activeStack = new Set();

  function collectSubtreeStats(item) {
    if (subtreeStats.has(item.id)) return subtreeStats.get(item.id);
    if (activeStack.has(item.id)) {
      return {
        startYear: item.startYear,
        endYear: item.endYear ?? item.startYear,
        descendantCount: 0,
      };
    }

    activeStack.add(item.id);
    const children = childrenByParentId.get(item.id) || [];
    let startYear = item.startYear;
    let endYear = item.endYear ?? item.startYear;
    let descendantCount = 0;

    children.forEach((child) => {
      const childStats = collectSubtreeStats(child);
      startYear = Math.min(startYear, childStats.startYear);
      endYear = Math.max(endYear, childStats.endYear);
      descendantCount += 1 + childStats.descendantCount;
    });

    activeStack.delete(item.id);
    const stats = { startYear, endYear, descendantCount };
    subtreeStats.set(item.id, stats);
    return stats;
  }

  const collapsedSet = new Set(collapsedIds);
  const visibleItems = [];

  function visit(item, depth) {
    const stats = collectSubtreeStats(item);
    visibleItems.push({
      ...item,
      depth,
      subtreeStartYear: stats.startYear,
      subtreeEndYear: stats.endYear,
      descendantCount: stats.descendantCount,
      hasChildren: (childrenByParentId.get(item.id) || []).length > 0,
    });

    if (collapsedSet.has(item.id)) return;
    (childrenByParentId.get(item.id) || []).forEach((child) => visit(child, depth + 1));
  }

  (childrenByParentId.get(null) || []).forEach((item) => visit(item, 0));
  return visibleItems;
}

export function normalizeTagKey(tag) {
  return cleanTextValue(tag).toLowerCase();
}

export function buildTagGraphElements(items) {
  const elements = [];
  const tagMetaById = new Map();
  let edgeCount = 0;

  items.forEach((item) => {
    elements.push({
      data: {
        id: `entry:${item.id}`,
        kind: "entry",
        itemId: item.id,
        label: item.name,
        type: item.type,
        yearRange: dateRangeLabel(item),
        color: item.color || "#475569",
        image: item.images?.[0] || "",
      },
    });

    const normalizedTags = [...new Set((item.tags || []).map((tag) => cleanTextValue(tag)).filter(Boolean))];
    normalizedTags.forEach((tagLabel) => {
      const tagId = normalizeTagKey(tagLabel);
      const existing = tagMetaById.get(tagId);
      if (existing) {
        existing.count += 1;
      } else {
        tagMetaById.set(tagId, { id: tagId, label: tagLabel, count: 1 });
      }

      elements.push({
        data: {
          id: `edge:${item.id}:${tagId}`,
          source: `entry:${item.id}`,
          target: `tag:${tagId}`,
          kind: "tag-link",
          itemId: item.id,
          tagId,
        },
      });
      edgeCount += 1;
    });
  });

  [...tagMetaById.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .forEach((tag) => {
      elements.push({
        data: {
          id: `tag:${tag.id}`,
          kind: "tag",
          tagId: tag.id,
          label: tag.label,
          count: tag.count,
        },
      });
    });

  return {
    elements,
    entryCount: items.length,
    tagCount: tagMetaById.size,
    edgeCount,
    nodeCount: items.length + tagMetaById.size,
  };
}

export function toggleListValue(list, value) {
  return list.includes(value)
    ? list.filter((item) => item !== value)
    : [...list, value];
}
