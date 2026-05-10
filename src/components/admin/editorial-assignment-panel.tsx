import { useMemo } from "react";
import {
  getCalculusStageOptions,
  getQuantumStageOptions,
} from "@/data/filter-controls";
import { extractEntityEditorialMetadata } from "@/editorial/stage-lens";
import { editorialStageProfiles } from "@/editorial/stage-profiles";
import type {
  EditorialAssignmentState,
  EntityEditorialAssignmentOverride,
} from "@/editorial/types";
import { useAdminStore } from "@/state/admin-store";
import type { KnowledgeEntity } from "@/types";

interface EditorialAssignmentPanelProps {
  selectedEntity: KnowledgeEntity;
}

const assignmentStateOptions: Array<{
  id: EditorialAssignmentState;
  label: string;
}> = [
  { id: "curated", label: "Curated" },
  { id: "derived", label: "Derived" },
  { id: "provisional", label: "Provisional" },
];

const toggleStringValue = (values: string[], nextValue: string) =>
  values.includes(nextValue)
    ? values.filter((value) => value !== nextValue)
    : [...values, nextValue];

export function EditorialAssignmentPanel({
  selectedEntity,
}: EditorialAssignmentPanelProps) {
  const updateEditorialAssignment = useAdminStore((state) => state.updateEditorialAssignment);
  const clearEditorialAssignment = useAdminStore((state) => state.clearEditorialAssignment);
  const editorialAssignmentsByEntityId = useAdminStore(
    (state) => state.editorialAssignmentsByEntityId,
  );

  const existingMetadata = extractEntityEditorialMetadata(selectedEntity);
  const override = editorialAssignmentsByEntityId[selectedEntity.id];

  const currentAssignment = useMemo(
    () =>
      ({
        entityId: selectedEntity.id,
        calculusStage: override?.calculusStage ?? existingMetadata?.calculusStage,
        quantumStage: override?.quantumStage ?? existingMetadata?.quantumStage,
        profileIds:
          override?.profileIds ??
          existingMetadata?.profileIds ??
          existingMetadata?.stageProfiles?.map((profile) => profile.id) ??
          [],
        notes: override?.notes ?? existingMetadata?.stageTag?.notes ?? "",
        confidence: override?.confidence ?? existingMetadata?.confidence ?? 0.75,
        assignmentState:
          override?.assignmentState ?? existingMetadata?.assignmentState ?? "curated",
      }) satisfies Omit<EntityEditorialAssignmentOverride, "updatedAt">,
    [existingMetadata, override, selectedEntity.id],
  );

  return (
    <div className="details-panel__section">
      <h3>Editorial assignment</h3>
      <p className="admin-panel__muted">
        This writes a local editorial annotation layer only. Imported records and raw source data
        remain untouched.
      </p>

      <div className="admin-panel__field">
        <span className="admin-panel__label">Calculus stage</span>
        <div className="admin-panel__chip-row">
          {getCalculusStageOptions().map((option) => (
            <button
              className={`filter-chip${currentAssignment.calculusStage === option.id ? " is-active" : ""}`}
              key={option.id}
              onClick={() =>
                updateEditorialAssignment(selectedEntity.id, {
                  calculusStage:
                    currentAssignment.calculusStage === option.id ? undefined : option.id,
                })
              }
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="admin-panel__field">
        <span className="admin-panel__label">Quantum stage</span>
        <div className="admin-panel__chip-row">
          {getQuantumStageOptions().map((option) => (
            <button
              className={`filter-chip${currentAssignment.quantumStage === option.id ? " is-active" : ""}`}
              key={option.id}
              onClick={() =>
                updateEditorialAssignment(selectedEntity.id, {
                  quantumStage:
                    currentAssignment.quantumStage === option.id ? undefined : option.id,
                })
              }
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="admin-panel__field">
        <span className="admin-panel__label">Editorial profiles</span>
        <div className="admin-panel__chip-row">
          {editorialStageProfiles.map((profile) => (
            <button
              className={`filter-chip${currentAssignment.profileIds?.includes(profile.id) ? " is-active" : ""}`}
              key={profile.id}
              onClick={() =>
                updateEditorialAssignment(selectedEntity.id, {
                  profileIds: toggleStringValue(currentAssignment.profileIds ?? [], profile.id),
                })
              }
              type="button"
            >
              {profile.label}
            </button>
          ))}
        </div>
      </div>

      <div className="admin-panel__inline-fields">
        <div className="admin-panel__field">
          <label className="admin-panel__label" htmlFor="admin-editorial-assignment-state">
            Assignment type
          </label>
          <select
            id="admin-editorial-assignment-state"
            onChange={(event) =>
              updateEditorialAssignment(selectedEntity.id, {
                assignmentState: event.target.value as EditorialAssignmentState,
              })
            }
            value={currentAssignment.assignmentState}
          >
            {assignmentStateOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="admin-panel__field">
          <label className="admin-panel__label" htmlFor="admin-editorial-confidence">
            Confidence
          </label>
          <input
            id="admin-editorial-confidence"
            max={1}
            min={0}
            onChange={(event) =>
              updateEditorialAssignment(selectedEntity.id, {
                confidence: Number.parseFloat(event.target.value),
              })
            }
            step={0.05}
            type="range"
            value={currentAssignment.confidence ?? 0.75}
          />
          <span className="admin-panel__muted">
            {Math.round((currentAssignment.confidence ?? 0.75) * 100)}%
          </span>
        </div>
      </div>

      <div className="admin-panel__field">
        <label className="admin-panel__label" htmlFor="admin-editorial-notes">
          Stage notes
        </label>
        <textarea
          id="admin-editorial-notes"
          onChange={(event) =>
            updateEditorialAssignment(selectedEntity.id, {
              notes: event.target.value,
            })
          }
          rows={4}
          value={currentAssignment.notes ?? ""}
        />
      </div>

      <div className="admin-panel__chip-row">
        {override ? (
          <button
            className="admin-panel__secondary"
            onClick={() => clearEditorialAssignment(selectedEntity.id)}
            type="button"
          >
            Clear editorial override
          </button>
        ) : null}
        <span className="admin-panel__muted">
          Profiles and stages resolve immediately into the shared editorial lens.
        </span>
      </div>
    </div>
  );
}
