import { useMemo, useState, type CSSProperties } from "react";
import { motion } from "motion/react";
import type { FaceAtlasItem } from "@/data/adapters/face-atlas-adapter";
import { getEditorialStageLabel } from "@/editorial/stage-lens";
import type { EditorialScopeMode } from "@/editorial/types";
import { getEditorialVisualAccent } from "@/editorial/visual-encoding";

interface FaceAtlasCardProps {
  item: FaceAtlasItem;
  editorialMode: boolean;
  editorialScopeMode: EditorialScopeMode;
  onSelect: (item: FaceAtlasItem) => void;
}

const getInitials = (label: string) =>
  label
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

export function FaceAtlasCard({
  item,
  editorialMode,
  editorialScopeMode,
  onSelect,
}: FaceAtlasCardProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const editorialAccent = getEditorialVisualAccent(item.editorial, editorialScopeMode);

  const metaTokens = useMemo(() => {
    const tokens = [item.depictionType.replaceAll("_", " ")];
    if (item.hasFaceRegion) tokens.push("face region");
    if (item.clusterHint.clusterIds.length > 0) tokens.push("clustered");
    if (item.clusterHint.styleGroupIds.length > 0) tokens.push("styled");
    if (item.contextReason) tokens.push(item.contextReason.replace("-", " "));
    if (editorialMode && editorialAccent?.stage !== undefined) {
      tokens.push(
        `${editorialAccent.lens} ${getEditorialStageLabel(editorialAccent.stage) ?? editorialAccent.stage}`,
      );
    }
    return tokens.slice(0, 3);
  }, [editorialAccent?.lens, editorialAccent?.stage, editorialMode, item]);

  return (
    <motion.button
      layout
      type="button"
      className={[
        "face-atlas-card",
        `is-${item.tone}`,
        item.isSelected ? "is-selected" : "",
        item.isNeighbor ? "is-neighbor" : "",
        item.isContextRelevant && !item.isSelected && !item.isNeighbor ? "is-context" : "",
        item.isPrimaryPortrait ? "is-primary" : "",
        editorialMode && editorialAccent?.stage !== undefined ? "has-editorial-accent" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-editorial-stage={editorialMode ? editorialAccent?.stage : undefined}
      data-editorial-lens={editorialMode ? editorialAccent?.lens : undefined}
      onClick={() => onSelect(item)}
      style={
        editorialMode && editorialAccent?.color
          ? ({ "--editorial-accent": editorialAccent.color } as CSSProperties)
          : undefined
      }
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.99 }}
      transition={{ type: "spring", stiffness: 240, damping: 22 }}
    >
      <div className="face-atlas-card__frame">
        {!imageFailed ? (
          <img
            alt={item.altText}
            className="face-atlas-card__image"
            loading="lazy"
            onError={() => setImageFailed(true)}
            src={item.thumbnailSrc ?? item.imageSrc}
          />
        ) : (
          <div className="face-atlas-card__placeholder" aria-hidden="true">
            <span>{getInitials(item.label)}</span>
          </div>
        )}
      </div>

      <div className="face-atlas-card__body">
        <p className="face-atlas-card__portrait-label">{item.portraitLabel}</p>
        <h3>{item.label}</h3>
        {item.subtitle ? <p className="face-atlas-card__subtitle">{item.subtitle}</p> : null}
        {editorialMode && editorialAccent?.stage !== undefined ? (
          <div className="face-atlas-card__editorial">
            <span className={`face-atlas-card__badge is-${editorialAccent.lens}`}>
              {editorialAccent.lens === "quantum" ? "Quantum" : "Calculus"}{" "}
              {getEditorialStageLabel(editorialAccent.stage)}
            </span>
          </div>
        ) : null}
        <p className="face-atlas-card__time">{item.timeLabel}</p>
        <p className="face-atlas-card__description">{item.description}</p>
        <div className="face-atlas-card__tokens">
          {metaTokens.map((token) => (
            <span key={token}>{token}</span>
          ))}
        </div>
      </div>
    </motion.button>
  );
}
