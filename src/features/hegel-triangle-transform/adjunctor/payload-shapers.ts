import type {
  CandidateProposalArtifact,
  CritiqueTaskPayload,
  FormalizationTaskPayload,
  FragmentNeighborhoodSnapshot,
  LeanVerificationTaskPayload,
  LocalMutationTaskPayload,
} from "./provider-types";
import { buildRegistryPromptVariantSelection } from "./prompt-template-registry";

function joinOrNone(values: string[]) {
  return values.length > 0 ? values.join(", ") : "none";
}

export function summarizeNeighborhood(neighborhood: FragmentNeighborhoodSnapshot) {
  return `Fragment ${neighborhood.fragmentId} at depth ${neighborhood.generationDepth} has inherited anchor ${neighborhood.inheritedAnchorId}, exposed seams ${joinOrNone(
    neighborhood.exposedConnectionIds,
  )}, neighboring fragments ${joinOrNone(neighborhood.neighboringFragmentIds)}, and local edges ${joinOrNone(
    neighborhood.localEdgeIds,
  )}.`;
}

export function shapeLocalMutationPayload(
  neighborhood: FragmentNeighborhoodSnapshot,
  requestedMoveCount: number,
): LocalMutationTaskPayload {
  const chartSelection = buildRegistryPromptVariantSelection(
    "localMutation",
    neighborhood,
    "personal-open-llm",
  );

  return {
    shape: "open_llm_local_mutation",
    neighborhoodSummary: summarizeNeighborhood(neighborhood),
    exposedVertices: [neighborhood.inheritedAnchorId, ...neighborhood.exposedConnectionIds].slice(0, 4),
    nearbyGraphEdges: neighborhood.localEdgeIds.slice(0, 6),
    requestedMoveCount,
    instructions: [
      chartSelection.selected.prompt,
      "Enumerate many cheap local candidate moves.",
      "Prefer neighborhood-sensitive bridge, projection, compatibility, obstruction, and refinement moves.",
      "Keep proposals narrow enough for downstream formalization.",
    ],
    promptVariants: chartSelection.variants,
    selectedChartId: chartSelection.selected.id,
    selectedPrompt: chartSelection.selected.prompt,
    chartDivergence: chartSelection.selected.divergence,
    candidateChartIds: chartSelection.charts.map((chart) => chart.id),
  };
}

export function shapeFormalizationPayload(
  neighborhood: FragmentNeighborhoodSnapshot,
  candidates: CandidateProposalArtifact[],
): FormalizationTaskPayload {
  const chartSelection = buildRegistryPromptVariantSelection(
    "formalization",
    neighborhood,
    "chatgpt",
  );

  return {
    shape: "chatgpt_formalization",
    structuralContext: summarizeNeighborhood(neighborhood),
    topLocalProposalTitles: candidates.map((candidate) => candidate.title),
    leanFacingSummaryRequest:
      "Rewrite these candidate moves into formal mathematical proposal objects with cleaner Lean-facing summaries.",
    instructions: [
      chartSelection.selected.prompt,
      "Preserve the mathematical intent but reduce ambiguity.",
      "Make hidden assumptions explicit where possible.",
      "Return something plausible for Lean translation, not just rhetorical polish.",
    ],
    promptVariants: chartSelection.variants,
    selectedChartId: chartSelection.selected.id,
    selectedPrompt: chartSelection.selected.prompt,
    chartDivergence: chartSelection.selected.divergence,
    candidateChartIds: chartSelection.charts.map((chart) => chart.id),
  };
}

export function shapeCritiquePayload(
  neighborhood: FragmentNeighborhoodSnapshot,
  candidates: CandidateProposalArtifact[],
): CritiqueTaskPayload {
  const chartSelection = buildRegistryPromptVariantSelection(
    "critique",
    neighborhood,
    "claude",
  );

  return {
    shape: "claude_semantic_critique",
    ambiguityTargets: candidates.map((candidate) => candidate.title),
    vacuityChecks: [
      `Check whether any candidate around ${neighborhood.fragmentId} collapses into a vacuous boundary condition.`,
      "Look for candidates that merely restate the neighborhood summary.",
    ],
    conceptualDriftChecks: [
      "Detect hidden shifts between local fragment claims and broader graph claims.",
      "Flag semantic drift between inherited anchor language and exposed connection language.",
    ],
    instructions: [
      chartSelection.selected.prompt,
      "Stress-test ambiguity, vacuity, hidden assumptions, and conceptual drift.",
      "Prefer clear objections and contrastive alternatives over vague negativity.",
    ],
    promptVariants: chartSelection.variants,
    selectedChartId: chartSelection.selected.id,
    selectedPrompt: chartSelection.selected.prompt,
    chartDivergence: chartSelection.selected.divergence,
    candidateChartIds: chartSelection.charts.map((chart) => chart.id),
  };
}

export function shapeLeanVerificationPayload(
  candidate: CandidateProposalArtifact,
): LeanVerificationTaskPayload {
  const chartSelection = buildRegistryPromptVariantSelection(
    "leanVerification",
    candidate,
    "lean-verifier",
  );

  return {
    shape: "lean_candidate_verification",
    artifactSummary: `${candidate.title} as ${candidate.artifactKind} with proposal kind ${candidate.proposalKind}.`,
    expectedChecks: [
      "type-correctness against fragment-local interfaces",
      "consistency with exposed seam structure",
      "absence of unsupported semantic jumps",
    ],
    expectedOutputs: [
      "accepted/rejected/blocked/vacuous/promising/redundant classification",
      "structured diagnostics",
      "repair-relevant rejection surface when available",
    ],
    promptVariants: chartSelection.variants,
    selectedChartId: chartSelection.selected.id,
    selectedPrompt: chartSelection.selected.prompt,
    chartDivergence: chartSelection.selected.divergence,
    candidateChartIds: chartSelection.charts.map((chart) => chart.id),
  };
}
