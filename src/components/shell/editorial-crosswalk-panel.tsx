import { useMemo } from "react";
import { getEditorialCrosswalkLabel } from "@/data/filter-controls";
import {
  getEditorialStageLabel,
  getEditorialStageProfile,
  getEditorialStageWindowLabel,
  editorialStages,
} from "@/editorial/stage-lens";
import type { CalculusStage, EditorialCrosswalkDimension } from "@/editorial/types";
import { useExplorerStore } from "@/state/explorer-store";

interface CrosswalkValueRowProps {
  label: string;
  values: string[];
  isActive?: boolean;
  onActivate: () => void;
}

function CrosswalkValueRow({
  label,
  values,
  isActive = false,
  onActivate,
}: CrosswalkValueRowProps) {
  if (values.length === 0) {
    return null;
  }

  return (
    <div className="editorial-crosswalk__row">
      <span className="editorial-crosswalk__row-label">{label}</span>
      <div className="editorial-crosswalk__row-values">
        {values.map((value) => (
          <button
            key={`${label}-${value}`}
            className={`editorial-crosswalk__value${isActive ? " is-active" : ""}`}
            onClick={onActivate}
            type="button"
          >
            {value}
          </button>
        ))}
      </div>
    </div>
  );
}

export function EditorialCrosswalkPanel() {
  const filters = useExplorerStore((state) => state.filters);
  const editorialFocusedStage = useExplorerStore((state) => state.editorialFocusedStage);
  const focusEditorialStage = useExplorerStore((state) => state.focusEditorialStage);
  const setCalculusStages = useExplorerStore((state) => state.setCalculusStages);
  const setQuantumStages = useExplorerStore((state) => state.setQuantumStages);
  const setEditorialCrosswalks = useExplorerStore((state) => state.setEditorialCrosswalks);

  const stageOptions = useMemo(
    () =>
      editorialStages.map((stage) => ({
        id: stage,
        label: getEditorialStageProfile(stage)?.label ?? String(stage),
      })),
    [],
  );

  const inspectedStage =
    editorialFocusedStage ?? filters.calculusStages[0] ?? stageOptions[0]?.id ?? 0;
  const profile = getEditorialStageProfile(inspectedStage);

  if (!profile || profile.calculusStage === undefined) {
    return null;
  }

  const focusStage = (stage: CalculusStage) => {
    focusEditorialStage(stage, "crosswalk");
  };

  const applyStagePairFilter = (stage: CalculusStage) => {
    const nextProfile = getEditorialStageProfile(stage);
    focusStage(stage);
    // Crosswalk focus should produce a coherent stage lens, not stack on stale stage filters.
    setCalculusStages([stage]);
    setQuantumStages(
      nextProfile?.quantumStage !== undefined ? [nextProfile.quantumStage] : [],
    );
  };

  const applyCrosswalkDimension = (dimension: EditorialCrosswalkDimension) => {
    applyStagePairFilter(profile.calculusStage as CalculusStage);
    setEditorialCrosswalks([dimension]);
  };

  const formatRange = () => getEditorialStageWindowLabel(profile) ?? "Date span unspecified";

  return (
    <section className="editorial-crosswalk" aria-label="Editorial crosswalk panel">
      <div className="editorial-crosswalk__header">
        <div>
          <p className="eyebrow">Crosswalk</p>
          <h3>Stage correspondences</h3>
        </div>
        <span className="editorial-crosswalk__hint">
          Select a stage to inspect its curated correspondences, then click any chip to focus the
          current archive through that lens.
        </span>
      </div>

      <div className="editorial-crosswalk__stage-picker" role="tablist" aria-label="Editorial stages">
        {stageOptions.map((option) => (
          <button
            key={option.id}
            aria-pressed={inspectedStage === option.id}
            className={`editorial-crosswalk__stage${inspectedStage === option.id ? " is-active" : ""}`}
            onClick={() => focusStage(option.id)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="editorial-crosswalk__summary">
        <div className="editorial-crosswalk__summary-head">
          <div className="editorial-crosswalk__summary-chips">
            <button
              className={`editorial-crosswalk__value${filters.calculusStages.includes(profile.calculusStage) ? " is-active" : ""}`}
              onClick={() => applyStagePairFilter(profile.calculusStage as CalculusStage)}
              type="button"
            >
              Calculus {profile.label}
            </button>
            {profile.quantumStage !== undefined ? (
              <button
                className={`editorial-crosswalk__value${filters.quantumStages.includes(profile.quantumStage) ? " is-active" : ""}`}
                onClick={() => applyStagePairFilter(profile.calculusStage as CalculusStage)}
                type="button"
              >
                Quantum {getEditorialStageLabel(profile.quantumStage)}
              </button>
            ) : null}
            {profile.epochLabel ? (
              <button
                className="editorial-crosswalk__value"
                onClick={() => applyStagePairFilter(profile.calculusStage as CalculusStage)}
                type="button"
              >
                {profile.epochLabel}
              </button>
            ) : null}
          </div>
          <span className="editorial-crosswalk__range">{formatRange()}</span>
        </div>

        <p className="editorial-crosswalk__summary-copy">
          {profile.pairingSummary ?? profile.summary}
        </p>
      </div>

      <div className="editorial-crosswalk__rows">
        <CrosswalkValueRow
          label="Structural theme"
          values={profile.structuralThemes ?? []}
          isActive={filters.editorialCrosswalks.includes("structural-theme")}
          onActivate={() => applyCrosswalkDimension("structural-theme")}
        />
        <CrosswalkValueRow
          label="Characteristic form"
          values={profile.characteristicForms ?? []}
          isActive={filters.editorialCrosswalks.includes("characteristic-form")}
          onActivate={() => applyCrosswalkDimension("characteristic-form")}
        />
        <CrosswalkValueRow
          label="Mental mode"
          values={profile.mentalModes ?? []}
          isActive={filters.editorialCrosswalks.includes("mental-mode")}
          onActivate={() => applyCrosswalkDimension("mental-mode")}
        />
        <CrosswalkValueRow
          label="Ontological focus"
          values={profile.ontologicalFocus ?? []}
          isActive={filters.editorialCrosswalks.includes("ontological-focus")}
          onActivate={() => applyCrosswalkDimension("ontological-focus")}
        />
        <CrosswalkValueRow
          label="Chemical epoch"
          values={profile.chemicalEpochs ?? []}
          isActive={filters.editorialCrosswalks.includes("chemical-epoch")}
          onActivate={() => applyCrosswalkDimension("chemical-epoch")}
        />
        <CrosswalkValueRow
          label="Drug epoch"
          values={profile.drugEpochs ?? []}
          isActive={filters.editorialCrosswalks.includes("drug-epoch")}
          onActivate={() => applyCrosswalkDimension("drug-epoch")}
        />
      </div>

      <div className="editorial-crosswalk__footer">
        <span>
          Active interpretation:{" "}
          {filters.editorialCrosswalks.length > 0
            ? getEditorialCrosswalkLabel(filters.editorialCrosswalks[0])
            : "stage pair only"}
        </span>
        <button
          className="editorial-crosswalk__action"
          onClick={() => {
            applyStagePairFilter(profile.calculusStage as CalculusStage);
            setEditorialCrosswalks([]);
          }}
          type="button"
        >
          Filter to this stage
        </button>
      </div>
    </section>
  );
}
