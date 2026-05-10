import { motion } from "motion/react";
import type { FocusContext } from "@/data/focus-context";
import { getContextLabel } from "@/data/focus-context";

interface ContextRibbonProps {
  context: FocusContext;
  hasActiveFilters: boolean;
}

export function ContextRibbon({ context, hasActiveFilters }: ContextRibbonProps) {
  if (!context.hasContext && !hasActiveFilters) return null;

  if (!context.selectedEntity) {
    return (
      <motion.div
        className="context-ribbon"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: "easeOut" }}
      >
        <span className="context-ribbon__quiet">Shared filters are shaping all views together.</span>
      </motion.div>
    );
  }

  const sourceLabel = getContextLabel(context.selectionSourceView);

  return (
    <motion.div
      className="context-ribbon"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: "easeOut" }}
    >
      <div className="context-ribbon__primary">
        <span className="context-ribbon__badge">Shared context</span>
        <strong>{context.selectedEntity.label}</strong>
        {sourceLabel ? <span className="context-ribbon__quiet">from {sourceLabel}</span> : null}
      </div>

      <div className="context-ribbon__meta">
        <span>{context.neighborIds.length} related entities</span>
        {typeof context.timeAnchorYear === "number" ? <span>{context.timeAnchorYear} anchor</span> : null}
        {context.relatedPlaceIds.length > 0 ? <span>{context.relatedPlaceIds.length} place cues</span> : null}
        {context.relatedPortraitIds.length > 0 ? (
          <span>{context.relatedPortraitIds.length} portrait cues</span>
        ) : null}
        {hasActiveFilters ? <span>filters active</span> : null}
      </div>
    </motion.div>
  );
}
