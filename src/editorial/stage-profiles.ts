import type { CalculusStage } from "./types";
import {
  editorialStageFrameworkSeed,
  editorialStages,
  quantumStages,
} from "./stage-framework.seed";

export { editorialStageFrameworkSeed, editorialStages, quantumStages } from "./stage-framework.seed";

export const editorialStageProfiles = editorialStageFrameworkSeed;

export const editorialStageProfilesByStage = new Map(
  editorialStageProfiles
    .filter((profile) => profile.calculusStage !== undefined)
    .map((profile) => [profile.calculusStage as CalculusStage, profile]),
);

export const editorialStageProfilesById = new Map(
  editorialStageProfiles.map((profile) => [profile.id, profile]),
);
