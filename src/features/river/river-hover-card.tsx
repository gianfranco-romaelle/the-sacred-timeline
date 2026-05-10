import { motion } from "motion/react";
import type { TimelineItem } from "@/data/adapters/timeline-adapter";
import { getEditorialStageLabel } from "@/editorial/stage-lens";
import type { EditorialCrosswalkDimension } from "@/editorial/types";

interface RiverHoverCardProps {
  item?: TimelineItem;
  crosswalks: EditorialCrosswalkDimension[];
}

export function RiverHoverCard({ item, crosswalks }: RiverHoverCardProps) {
  const crosswalkTokens = item?.editorial?.crosswalk
    ? crosswalks
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
        .slice(0, 3)
    : [];

  return (
    <motion.aside
      className="river-hover-card"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
    >
      {item ? (
        <>
          <p className="eyebrow">Focused record</p>
          <h3>{item.label}</h3>
          <p className="river-hover-card__type">
            {item.entityType} - {item.dateLabel}
          </p>
          {item.subtitle ? <p className="river-hover-card__subtitle">{item.subtitle}</p> : null}
          {item.editorial?.calculusStage !== undefined ? (
            <div className="river-hover-card__tokens">
              <span>
                Calculus{" "}
                {item.editorial.stageProfile?.label ??
                  getEditorialStageLabel(item.editorial.calculusStage)}
              </span>
              {item.editorial.quantumStage !== undefined ? (
                <span>Quantum {getEditorialStageLabel(item.editorial.quantumStage)}</span>
              ) : null}
            </div>
          ) : null}
          <p>{item.description}</p>
          <div className="river-hover-card__tokens">
            {item.domainIds.slice(0, 2).map((domainId) => (
              <span key={domainId}>{domainId.replace("domain_", "")}</span>
            ))}
            {item.traditionIds.slice(0, 2).map((traditionId) => (
              <span key={traditionId}>{traditionId.replace("tradition_", "")}</span>
            ))}
            {crosswalkTokens.map((token) => (
              <span key={token}>{token}</span>
            ))}
          </div>
          <p className="river-hover-card__hint">
            {item.citationCount} citation{item.citationCount === 1 ? "" : "s"} - {item.relationCount} relation
            {item.hasPortrait ? " - portrait-linked" : ""}
          </p>
          <p className="river-hover-card__hint">
            This panel follows click selection and stays stable while you inspect the river.
          </p>
        </>
      ) : (
        <>
          <p className="eyebrow">River Guide</p>
          <h3>Click a record to focus it here.</h3>
          <p>
            The side panel now follows click selection instead of hover, so the river stays calm
            while you inspect chronology, editorial framing, and shared context.
          </p>
          <p className="river-hover-card__hint">
            The shared details panel will update at the same time.
          </p>
        </>
      )}
    </motion.aside>
  );
}
