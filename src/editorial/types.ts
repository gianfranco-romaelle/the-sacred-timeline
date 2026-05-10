export type CalculusStage = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type QuantumStage = 0 | 1 | 2 | 3 | 4 | 5 | 6;

// Backward-compatible alias used by the current UI layer.
export type EditorialStage = CalculusStage;

export type EditorialChronologyMode = "historical" | "editorial";

export type EditorialScopeMode =
  | "standard-chronology"
  | "calculus-stages"
  | "quantum-stages"
  | "crosswalk";

export type EditorialCrosswalkDimension =
  | "structural-theme"
  | "mental-mode"
  | "characteristic-form"
  | "chemical-epoch"
  | "drug-epoch"
  | "ontological-focus";

export type EditorialStageSource = "manual" | "derived" | "curated";
export type EditorialAssignmentState = "curated" | "derived" | "provisional";

export type EditorialStageWindow =
  | { kind: "pre-1600-continuum" }
  | { kind: "bounded"; startYear: number; endYear: number }
  | { kind: "open-ended"; startYear: number };

export interface EditorialStageTag {
  calculusStage?: CalculusStage;
  quantumStage?: QuantumStage;
  confidence?: number;
  notes?: string;
  source?: EditorialStageSource;
  assignmentState?: EditorialAssignmentState;
}

export interface EditorialCrosswalk {
  calculusStage?: CalculusStage;
  quantumStage?: QuantumStage;
  dateRange?: [number, number];
  epochLabel?: string;
  epochDescription?: string;
  pairingSummary?: string;
  structuralThemes?: string[];
  characteristicForms?: string[];
  mentalModes?: string[];
  ontologicalFocus?: string[];
  chemicalEpoch?: string;
  chemicalEpochs?: string[];
  drugEpoch?: string;
  drugEpochs?: string[];
  summary?: string;
}

export interface EditorialStageProfile {
  id: string;
  label: string;
  shortLabel: string;
  calculusStage?: CalculusStage;
  quantumStage?: QuantumStage;
  dateRange?: [number, number];
  window?: EditorialStageWindow;
  legacyAliases?: string[];
  internalNotes?: string;
  epochLabel?: string;
  epochDescription?: string;
  pairingSummary?: string;
  structuralThemes?: string[];
  characteristicForms?: string[];
  mentalModes?: string[];
  ontologicalFocus?: string[];
  chemicalEpoch?: string;
  chemicalEpochs?: string[];
  drugEpoch?: string;
  drugEpochs?: string[];
  summary?: string;
}

export interface EntityEditorialMetadata extends EditorialStageTag {
  stageTag?: EditorialStageTag;
  stageProfile?: EditorialStageProfile;
  stageProfiles?: EditorialStageProfile[];
  crosswalk?: EditorialCrosswalk;
  sourceLabel?: string;
  profileId?: string;
  profileIds?: string[];
}

export interface EntityEditorialAssignmentOverride {
  entityId: string;
  calculusStage?: CalculusStage;
  quantumStage?: QuantumStage;
  profileIds?: string[];
  notes?: string;
  confidence?: number;
  assignmentState?: EditorialAssignmentState;
  sourceLabel?: string;
  updatedAt: string;
}
