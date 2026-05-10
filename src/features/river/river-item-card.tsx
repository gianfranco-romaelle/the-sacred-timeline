import { type CSSProperties } from "react";
import { motion } from "motion/react";
import type { TimelineItem } from "@/data/adapters/timeline-adapter";
import { getEditorialStageLabel } from "@/editorial/stage-lens";
import type { EditorialCrosswalkDimension, EditorialScopeMode } from "@/editorial/types";
import { getEditorialVisualAccent } from "@/editorial/visual-encoding";

interface RiverItemCardProps {
  item: TimelineItem;
  lane: "north" | "south";
  isDimmed: boolean;
  showEditorialLabels: boolean;
  editorialScopeMode: EditorialScopeMode;
  editorialCrosswalks: EditorialCrosswalkDimension[];
  onSelect: (item: TimelineItem) => void;
}

export function RiverItemCard({
  item,
  lane,
  isDimmed,
  showEditorialLabels,
  editorialScopeMode,
  editorialCrosswalks,
  onSelect,
}: RiverItemCardProps) {
  const editorialAccent = showEditorialLabels
    ? getEditorialVisualAccent(item.editorial, editorialScopeMode)
    : undefined;
  const crosswalkTokens = item.editorial?.crosswalk
    ? editorialCrosswalks
        .map((dimension) => {
          switch (dimension) {
            case "structural-theme":
              return item.editorial?.crosswalk?.structuralThemes?.[0];
            case "mental-mode":
              return item.editorial?.crosswalk?.mentalModes?.[0];
            case "characteristic-form":
              return item.editorial?.crosswalk?.characteristicForms?.[0];
            case "chemical-epoch":
              return item.editorial?.crosswalk?.chemicalEpochs?.[0];
            case "drug-epoch":
              return item.editorial?.crosswalk?.drugEpochs?.[0];
            case "ontological-focus":
              return item.editorial?.crosswalk?.ontologicalFocus?.[0];
            default:
              return undefined;
          }
        })
        .filter((value): value is string => Boolean(value))
        .slice(0, 2)
    : [];

  const cardClassName = [
    "river-item-card",
    `is-${lane}`,
    `is-${item.importance}`,
    item.isSelected ? "is-selected" : "",
    item.isNeighbor ? "is-neighbor" : "",
    item.isContextRelevant && !item.isSelected && !item.isNeighbor ? "is-context" : "",
    isDimmed ? "is-dimmed" : "",
    editorialAccent?.stage !== undefined ? "has-editorial-accent" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <motion.button
      layout
      type="button"
      className={cardClassName}
      data-entity-type={item.entityType}
      data-editorial-stage={editorialAccent?.stage}
      data-editorial-lens={editorialAccent?.lens}
      style={
        editorialAccent?.color
          ? ({ "--editorial-accent": editorialAccent.color } as CSSProperties)
          : undefined
      }
      onClick={() => onSelect(item)}
      whileHover={{ y: lane === "north" ? -4 : 4 }}
      whileTap={{ scale: 0.985 }}
      transition={{ type: "spring", stiffness: 250, damping: 24 }}
    >
      <span className="river-item-card__stem" aria-hidden="true" />
      <span className="river-item-card__date">{item.dateLabel}</span>
      <strong>{item.label}</strong>
      {item.subtitle ? <span className="river-item-card__subtitle">{item.subtitle}</span> : null}
      {showEditorialLabels && item.editorial?.calculusStage !== undefined ? (
        <div className="river-item-card__editorial">
          <span className="river-item-card__badge">
            Calculus{" "}
            {item.editorial.stageProfile?.label ??
              getEditorialStageLabel(item.editorial.calculusStage)}
          </span>
          {item.editorial.quantumStage !== undefined ? (
            <span
              className={`river-item-card__badge is-quiet${editorialScopeMode === "quantum-stages" ? " is-quantum" : ""}`}
            >
              Quantum {getEditorialStageLabel(item.editorial.quantumStage)}
            </span>
          ) : null}
        </div>
      ) : null}
      {crosswalkTokens.length > 0 ? (
        <div className="river-item-card__editorial">
          {crosswalkTokens.map((token) => (
            <span className="river-item-card__badge is-quiet" key={token}>
              {token}
            </span>
          ))}
        </div>
      ) : null}
      <span className="river-item-card__type">{item.entityType}</span>
      <p>{item.description}</p>
      <span className="river-item-card__meta">
        {item.citationCount} citation{item.citationCount === 1 ? "" : "s"} - {item.relationCount} relation
        {item.hasPortrait ? " - portrait" : ""}
        {item.contextReason ? ` - ${item.contextReason.replaceAll("_", " ").replaceAll("-", " ")}` : ""}
      </span>
    </motion.button>
  );
}
