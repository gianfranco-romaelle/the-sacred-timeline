import { useMemo } from "react";
import {
  getCalculusStageOptions,
  getEditorialCrosswalkOptions,
  getEditorialScopeOptions,
  getQuantumStageOptions,
} from "@/data/filter-controls";
import { getEditorialStageLabel, getEditorialStageProfile } from "@/editorial/stage-lens";
import { useExplorerStore } from "@/state/explorer-store";
import type {
  CalculusStage,
  EditorialCrosswalkDimension,
  EditorialScopeMode,
  QuantumStage,
} from "@/editorial/types";
import { EditorialCrosswalkPanel } from "./editorial-crosswalk-panel";

interface EditorialChipGroupProps<T extends string | number> {
  label: string;
  options: Array<{ id: T; label: string; description?: string }>;
  activeIds: T[];
  onToggle: (id: T) => void;
}

function EditorialChipGroup<T extends string | number>({
  label,
  options,
  activeIds,
  onToggle,
}: EditorialChipGroupProps<T>) {
  return (
    <div className="editorial-controls__group">
      <span className="editorial-controls__label">{label}</span>
      <div className="editorial-controls__chips">
        {options.map((option) => (
          <button
            key={option.id}
            className={`filter-chip${activeIds.includes(option.id) ? " is-active" : ""}`}
            onClick={() => onToggle(option.id)}
            title={option.description}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function EditorialControlsBar() {
  const filters = useExplorerStore((state) => state.filters);
  const editorialMode = useExplorerStore((state) => state.filters.editorialMode);
  const enableEditorialMode = useExplorerStore((state) => state.enableEditorialMode);
  const disableEditorialMode = useExplorerStore((state) => state.disableEditorialMode);
  const setEditorialScopeMode = useExplorerStore((state) => state.setEditorialScopeMode);
  const toggleCalculusStage = useExplorerStore((state) => state.toggleCalculusStage);
  const toggleQuantumStage = useExplorerStore((state) => state.toggleQuantumStage);
  const toggleEditorialCrosswalk = useExplorerStore((state) => state.toggleEditorialCrosswalk);

  const scopeOptions = useMemo(() => getEditorialScopeOptions(), []);
  const calculusStageOptions = useMemo(() => getCalculusStageOptions(), []);
  const quantumStageOptions = useMemo(() => getQuantumStageOptions(), []);
  const crosswalkOptions = useMemo(() => getEditorialCrosswalkOptions(), []);
  const activeStageProfiles = useMemo(
    () =>
      filters.calculusStages
        .map((stage) => getEditorialStageProfile(stage))
        .filter((value): value is NonNullable<typeof value> => Boolean(value)),
    [filters.calculusStages],
  );

  const handleScopeModeChange = (mode: EditorialScopeMode) => {
    if (!editorialMode) {
      enableEditorialMode(filters.calculusStages[0]);
    }

    setEditorialScopeMode(mode);
  };

  return (
    <section className="editorial-controls" aria-label="Global editorial controls">
      <div className="editorial-controls__header">
        <div className="editorial-controls__intro">
          <p className="eyebrow">Editorial lens</p>
          <h2>Curatorial periodization</h2>
          <p>
            Layer a custom interpretive scaffold over the archive without replacing the underlying
            chronology or entity structure.
          </p>
        </div>

        <div className="editorial-controls__mode" role="tablist" aria-label="Editorial mode">
          <button
            className={`editorial-controls__mode-button${!editorialMode ? " is-active" : ""}`}
            onClick={disableEditorialMode}
            type="button"
          >
            Off
          </button>
          <button
            className={`editorial-controls__mode-button${editorialMode ? " is-active" : ""}`}
            onClick={() => enableEditorialMode(filters.calculusStages[0])}
            type="button"
          >
            On
          </button>
        </div>
      </div>

      <div className="editorial-controls__scope">
        <span className="editorial-controls__label">Scope mode</span>
        <div className="editorial-controls__chips">
          {scopeOptions.map((option) => (
            <button
              key={option.id}
              className={`filter-chip${filters.editorialScopeMode === option.id ? " is-active" : ""}`}
              onClick={() => handleScopeModeChange(option.id as EditorialScopeMode)}
              title={option.description}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className={`editorial-controls__body${!editorialMode ? " is-disabled" : ""}`}>
        <EditorialChipGroup<CalculusStage>
          activeIds={filters.calculusStages}
          label="Calculus stages"
          onToggle={toggleCalculusStage}
          options={calculusStageOptions}
        />

        <EditorialChipGroup<QuantumStage>
          activeIds={filters.quantumStages}
          label="Quantum stages"
          onToggle={toggleQuantumStage}
          options={quantumStageOptions}
        />

        <EditorialChipGroup<EditorialCrosswalkDimension>
          activeIds={filters.editorialCrosswalks}
          label="Crosswalks"
          onToggle={toggleEditorialCrosswalk}
          options={crosswalkOptions}
        />
      </div>

      {editorialMode && filters.editorialScopeMode === "crosswalk" ? (
        <EditorialCrosswalkPanel />
      ) : null}

      {editorialMode && filters.editorialScopeMode !== "crosswalk" ? (
        <div className="editorial-controls__notes">
          {activeStageProfiles.length > 0 ? (
            activeStageProfiles.map((profile) => (
              <article className="editorial-controls__note" key={profile.id}>
                <p className="eyebrow">{profile.label}</p>
                <h3>{profile.structuralThemes?.[0] ?? profile.label}</h3>
                <p>{profile.summary}</p>
                <div className="editorial-controls__grid">
                  <span>Historical: {profile.epochLabel ?? "unspecified"}</span>
                  <span>
                    Quantum:{" "}
                    {profile.quantumStage !== undefined
                      ? getEditorialStageLabel(profile.quantumStage)
                      : "unspecified"}
                  </span>
                  <span>Form: {profile.characteristicForms?.[0] ?? "unspecified"}</span>
                  <span>Mental mode: {profile.mentalModes?.[0] ?? "unspecified"}</span>
                  <span>Chemical: {profile.chemicalEpochs?.[0] ?? "unspecified"}</span>
                  <span>Ontological: {profile.ontologicalFocus?.[0] ?? "unspecified"}</span>
                </div>
              </article>
            ))
          ) : (
            <article className="editorial-controls__note">
              <p className="eyebrow">Editorial mode</p>
              <h3>Interpretive scaffold active</h3>
              <p>
                The archive now supports stage-based grouping, labels, and crosswalk cues while the
                underlying shared selection and canonical records remain unchanged.
              </p>
            </article>
          )}
        </div>
      ) : null}
    </section>
  );
}
