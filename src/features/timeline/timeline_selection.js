export function clearMissingSelectionId(currentId, items) {
  if (!currentId) return null;
  return items.some((item) => item.id === currentId) ? currentId : null;
}

export function clearMissingActiveTagId(activeTagId, tagElements) {
  if (!activeTagId) return null;
  const hasTag = tagElements.some((element) => element.data.kind === "tag" && element.data.tagId === activeTagId);
  return hasTag ? activeTagId : null;
}
