import { useMemo, useState } from "react";
import { LayoutGroup, motion } from "motion/react";
import type {
  TimelineGroup,
  TimelineItem,
  TimelineProjection,
} from "@/data/adapters/timeline-adapter";
import type { EditorialCrosswalkDimension, EditorialScopeMode } from "@/editorial/types";
import { RiverHoverCard } from "./river-hover-card";
import { RiverItemCard } from "./river-item-card";

interface RiverStageProps {
  projection: TimelineProjection;
  groupingMode: "era" | "century";
  isEditorialMode: boolean;
  editorialScopeMode: EditorialScopeMode;
  showEditorialLabels: boolean;
  editorialCrosswalks: EditorialCrosswalkDimension[];
  onSelect: (item: TimelineItem) => void;
}

const getLaneForIndex = (index: number) => (index % 2 === 0 ? "north" : "south");

const getGroupEditorialStage = (
  group: TimelineGroup,
  editorialScopeMode: EditorialScopeMode,
) => {
  if (editorialScopeMode === "quantum-stages") {
    const stage = Number.parseInt(group.key.replace("quantum-", ""), 10);
    return Number.isNaN(stage) ? undefined : stage;
  }

  return group.editorialProfile?.calculusStage;
};

export function RiverStage({
  projection,
  groupingMode,
  isEditorialMode,
  editorialScopeMode,
  showEditorialLabels,
  editorialCrosswalks,
  onSelect,
}: RiverStageProps) {
  const [inspectedItemId, setInspectedItemId] = useState<TimelineItem["id"] | undefined>(undefined);

  const groups = useMemo<TimelineGroup[]>(
    () =>
      !isEditorialMode || editorialScopeMode === "standard-chronology"
        ? groupingMode === "era"
          ? projection.byEra
          : projection.byCentury
        : editorialScopeMode === "quantum-stages"
          ? projection.byQuantumStage
          : projection.byEditorialStage,
    [
      groupingMode,
      isEditorialMode,
      editorialScopeMode,
      projection.byCentury,
      projection.byQuantumStage,
      projection.byEditorialStage,
      projection.byEra,
    ],
  );
  const selectedItem = useMemo(
    () => groups.flatMap((group) => group.items).find((item) => item.isSelected),
    [groups],
  );
  const inspectedItem = useMemo(
    () =>
      groups.flatMap((group) => group.items).find((item) => item.id === inspectedItemId) ??
      selectedItem,
    [groups, inspectedItemId, selectedItem],
  );

  return (
    <div className="river-stage">
      <div className="river-stage__rail">
        <RiverHoverCard crosswalks={editorialCrosswalks} item={inspectedItem} />
        <LayoutGroup>
          <div className="river-stage__bands">
            {groups.map((group) => {
              const groupStage = getGroupEditorialStage(group, editorialScopeMode);
              const groupLens = editorialScopeMode === "quantum-stages" ? "quantum" : "calculus";

              return (
                <motion.section
                  layout
                  key={group.key}
                  className={`river-band is-${group.density}${group.items.some((item) => item.isSelected) ? " has-selection" : ""}${isEditorialMode && groupStage !== undefined ? " has-editorial-accent" : ""}`}
                  data-editorial-stage={
                    isEditorialMode && groupStage !== undefined ? groupStage : undefined
                  }
                  data-editorial-lens={
                    isEditorialMode && groupStage !== undefined ? groupLens : undefined
                  }
                  transition={{ type: "spring", stiffness: 170, damping: 22 }}
                >
                <div className="river-band__wash" aria-hidden="true" />
                <div className="river-band__label">
                  <span className="eyebrow">
                    {group.itemCount} records - {group.density} density
                  </span>
                  <h3>{group.label}</h3>
                  {group.chronologyLabel ? (
                    <p className="river-band__chronology">Chronology: {group.chronologyLabel}</p>
                  ) : null}
                  {group.editorialProfile ? (
                    <p className="river-band__summary">{group.editorialProfile.summary}</p>
                  ) : null}
                </div>

                <div className="river-band__lane river-band__lane--north">
                  {group.items.map((item, index) =>
                    getLaneForIndex(index) === "north" ? (
                      <RiverItemCard
                        key={item.id}
                        item={item}
                        lane="north"
                        isDimmed={false}
                        showEditorialLabels={
                          showEditorialLabels ||
                          (isEditorialMode && editorialScopeMode !== "standard-chronology")
                        }
                        editorialScopeMode={editorialScopeMode}
                        editorialCrosswalks={editorialCrosswalks}
                        onSelect={(nextItem) => {
                          setInspectedItemId(nextItem.id);
                          onSelect(nextItem);
                        }}
                      />
                    ) : (
                      <div className="river-band__spacer" key={`${item.id}-north`} />
                    ),
                  )}
                </div>

                <div className="river-band__axis" aria-hidden="true">
                  <span className="river-band__axis-line" />
                  <span className="river-band__axis-marker" />
                </div>

                <div className="river-band__lane river-band__lane--south">
                  {group.items.map((item, index) =>
                    getLaneForIndex(index) === "south" ? (
                      <RiverItemCard
                        key={item.id}
                        item={item}
                        lane="south"
                        isDimmed={false}
                        showEditorialLabels={
                          showEditorialLabels ||
                          (isEditorialMode && editorialScopeMode !== "standard-chronology")
                        }
                        editorialScopeMode={editorialScopeMode}
                        editorialCrosswalks={editorialCrosswalks}
                        onSelect={(nextItem) => {
                          setInspectedItemId(nextItem.id);
                          onSelect(nextItem);
                        }}
                      />
                    ) : (
                      <div className="river-band__spacer" key={`${item.id}-south`} />
                    ),
                  )}
                </div>
                </motion.section>
              );
            })}
          </div>
        </LayoutGroup>
      </div>
    </div>
  );
}
