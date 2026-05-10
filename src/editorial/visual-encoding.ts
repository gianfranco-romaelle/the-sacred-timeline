import type {
  CalculusStage,
  EditorialScopeMode,
  EntityEditorialMetadata,
  QuantumStage,
} from "./types";

type EditorialLens = "calculus" | "quantum";

const calculusStageAccents: Record<CalculusStage, string> = {
  0: "#8a6a44",
  1: "#7d6b4f",
  2: "#6f7657",
  3: "#587486",
  4: "#76648d",
  5: "#8a5f77",
  6: "#4f7f78",
};

const quantumStageAccents: Record<QuantumStage, string> = {
  0: "#8b714a",
  1: "#7d7358",
  2: "#5f7a66",
  3: "#4f7287",
  4: "#6d6594",
  5: "#8a5f77",
  6: "#4f7f78",
};

export interface EditorialVisualAccent {
  stage?: CalculusStage | QuantumStage;
  lens: EditorialLens;
  color?: string;
}

export const getEditorialVisualAccent = (
  editorial: EntityEditorialMetadata | undefined,
  editorialScopeMode: EditorialScopeMode,
): EditorialVisualAccent | undefined => {
  if (!editorial) {
    return undefined;
  }

  if (editorialScopeMode === "quantum-stages") {
    return editorial.quantumStage !== undefined
      ? {
          stage: editorial.quantumStage,
          lens: "quantum",
          color: quantumStageAccents[editorial.quantumStage],
        }
      : undefined;
  }

  return editorial.calculusStage !== undefined
    ? {
        stage: editorial.calculusStage,
        lens: "calculus",
        color: calculusStageAccents[editorial.calculusStage],
      }
    : editorial.quantumStage !== undefined
      ? {
          stage: editorial.quantumStage,
          lens: "quantum",
          color: quantumStageAccents[editorial.quantumStage],
        }
      : undefined;
};
