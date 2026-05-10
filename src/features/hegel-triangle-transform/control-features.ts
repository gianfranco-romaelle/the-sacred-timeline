import type {
  FragmentId,
  ProposalOutcomeState,
  SemanticProposal,
  SimulationState,
  TriangleFragment,
} from "@/types/hegel-triangle";
import type { DialecticMove } from "./adjunctor/provider-types";

export interface ControlFeatureMetrics {
  resetBurden: number;
  groupLikeStability: number;
  generatorComplexity: number;
  cascadeDepth: number;
}

function roundMetric(value: number) {
  return Number(value.toFixed(6));
}

function clampUnit(value: number) {
  return roundMetric(Math.max(0, Math.min(1, value)));
}

function average(values: number[], fallback = 0) {
  if (values.length === 0) {
    return fallback;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function proposalsForFragment(simulation: SimulationState, fragment: TriangleFragment) {
  const active = fragment.activeProposalIds
    .map((proposalId) => simulation.proposals[proposalId])
    .filter((proposal): proposal is SemanticProposal => Boolean(proposal));

  if (active.length > 0) {
    return active;
  }

  return Object.values(simulation.proposals).filter((proposal) => proposal.fragmentId === fragment.id);
}

function latestProposalForFragment(simulation: SimulationState, fragment: TriangleFragment) {
  return proposalsForFragment(simulation, fragment).sort(
    (left, right) =>
      right.updatedAtTick - left.updatedAtTick ||
      right.createdAtTick - left.createdAtTick ||
      left.id.localeCompare(right.id),
  )[0];
}

function outcomeDiscardScore(outcome: ProposalOutcomeState) {
  switch (outcome) {
    case "rejected":
      return 1;
    case "blocked":
      return 0.8;
    case "vacuous":
      return 0.6;
    case "pending":
      return 0.25;
    case "promising":
      return 0.15;
    case "accepted":
      return 0;
    default:
      return 0.3;
  }
}

function fragmentDiscardScore(fragment: TriangleFragment) {
  switch (fragment.status) {
    case "archived":
    case "rejected":
      return 1;
    case "blocked":
      return 0.8;
    case "inspecting":
      return 0.35;
    case "verifying":
      return 0.25;
    case "accepted":
    case "persistent":
      return 0.05;
    default:
      return 0.2;
  }
}

function dialecticMovesForProposal(proposal?: SemanticProposal) {
  const payload = asRecord(proposal?.payload);
  const orchestration = asRecord(payload?.orchestration);
  const moves = Array.isArray(orchestration?.dialecticMoves) ? orchestration.dialecticMoves : [];
  return moves
    .map((move) => asRecord(move))
    .filter((move): move is Record<string, unknown> => Boolean(move))
    .map((move) => ({
      id: String(move.id ?? ""),
      role: String(move.role ?? ""),
      parentId: typeof move.parentId === "string" ? move.parentId : undefined,
    }));
}

function dialecticDepth(moves: Array<{ id: string; parentId?: string }>) {
  if (moves.length === 0) {
    return 0;
  }

  const parentById = new Map(moves.map((move) => [move.id, move.parentId]));
  let maxDepth = 0;

  for (const move of moves) {
    let depth = 1;
    let parentId = move.parentId;
    const seen = new Set<string>([move.id]);
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      depth += 1;
      parentId = parentById.get(parentId);
    }
    maxDepth = Math.max(maxDepth, depth);
  }

  return maxDepth;
}

function childTransformationSignature(simulation: SimulationState, childFragment: TriangleFragment) {
  const proposal = latestProposalForFragment(simulation, childFragment);
  return [
    childFragment.phase,
    childFragment.status,
    proposal?.proposalKind ?? "none",
    proposal?.verificationState ?? "pending",
  ].join("|");
}

function orchestrationAssessmentCount(proposal?: SemanticProposal) {
  const payload = asRecord(proposal?.payload);
  const orchestration = asRecord(payload?.orchestration);
  return asStringArray(orchestration?.assessments).length;
}

export function computeControlFeatureMetrics(
  simulation: SimulationState,
  fragmentId: FragmentId,
): ControlFeatureMetrics {
  const fragment = simulation.fragments[fragmentId];
  if (!fragment) {
    return {
      resetBurden: 0,
      groupLikeStability: 0,
      generatorComplexity: 0,
      cascadeDepth: 0,
    };
  }

  const fragmentProposal = latestProposalForFragment(simulation, fragment);
  const childFragments = fragment.childFragmentIds
    .map((childFragmentId) => simulation.fragments[childFragmentId])
    .filter((childFragment): childFragment is TriangleFragment => Boolean(childFragment));
  const childProposals = childFragments.map((childFragment) => latestProposalForFragment(simulation, childFragment));

  const discardedBranchScores = childFragments.map((childFragment, index) =>
    Math.max(
      fragmentDiscardScore(childFragment),
      outcomeDiscardScore(childProposals[index]?.verificationState ?? "pending"),
    ),
  );
  const selfDiscardPressure = fragmentProposal
    ? outcomeDiscardScore(fragmentProposal.verificationState) * 0.35
    : fragmentDiscardScore(fragment) * 0.2;
  const resetBurden = clampUnit(
    average(discardedBranchScores, selfDiscardPressure) + selfDiscardPressure,
  );

  const transformationSignatures = childFragments.map((childFragment) =>
    childTransformationSignature(simulation, childFragment),
  );
  const uniqueSignatures = new Set(transformationSignatures);
  const signatureConsistency =
    transformationSignatures.length > 0
      ? 1 - (uniqueSignatures.size - 1) / Math.max(1, transformationSignatures.length)
      : 0.7;
  const moveRoles = new Set(dialecticMovesForProposal(fragmentProposal).map((move) => move.role));
  const moveCoherence = clampUnit(1 - Math.max(0, moveRoles.size - 2) / 4);
  const groupLikeStability = clampUnit(average([signatureConsistency, moveCoherence], 0.65));

  const childKinds = childProposals
    .map((proposal) => proposal?.proposalKind)
    .filter((kind): kind is NonNullable<typeof kind> => typeof kind === "string");
  const uniqueKinds = new Set(childKinds);
  const branchingFactor = clampUnit(childFragments.length / 4);
  const kindDiversity = childKinds.length > 0 ? clampUnit(uniqueKinds.size / Math.max(1, childKinds.length)) : 0;
  const assessmentDiversity = clampUnit(orchestrationAssessmentCount(fragmentProposal) / 6);
  const generatorComplexity = clampUnit(
    average([branchingFactor, kindDiversity, assessmentDiversity], branchingFactor),
  );

  const moves = dialecticMovesForProposal(fragmentProposal);
  const moveDepth = dialecticDepth(moves);
  const treeDepth = fragment.generationDepth + childFragments.length;
  const cascadeDepth = clampUnit(
    average(
      [
        clampUnit(moveDepth / 4),
        clampUnit(treeDepth / 8),
      ],
      clampUnit(fragment.generationDepth / 8),
    ),
  );

  return {
    resetBurden,
    groupLikeStability,
    generatorComplexity,
    cascadeDepth,
  };
}
