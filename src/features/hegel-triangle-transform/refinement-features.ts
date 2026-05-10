import type {
  FragmentId,
  FragmentLifecycleStatus,
  ProposalOutcomeState,
  SemanticProposal,
  SimulationState,
  TriangleFragment,
} from "@/types/hegel-triangle";

export interface RefinementFeatureMetrics {
  refinementLegality: number;
  projectionConsistency: number;
  branchAdmissibility: number;
  metricCompressionGain: number;
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

function outcomeProjectionFallback(outcome: ProposalOutcomeState) {
  switch (outcome) {
    case "accepted":
      return 0;
    case "promising":
      return 0.14;
    case "blocked":
      return 0.48;
    case "vacuous":
      return 0.26;
    case "rejected":
      return 0.82;
    case "pending":
    default:
      return 0.18;
  }
}

function outcomeLegalityScore(outcome: ProposalOutcomeState) {
  switch (outcome) {
    case "accepted":
      return 0.98;
    case "promising":
      return 0.78;
    case "pending":
      return 0.58;
    case "blocked":
      return 0.34;
    case "vacuous":
      return 0.26;
    case "rejected":
      return 0.1;
    default:
      return 0.4;
  }
}

function fragmentStatusAdmissibility(status: FragmentLifecycleStatus) {
  switch (status) {
    case "accepted":
    case "persistent":
      return 0.96;
    case "verifying":
      return 0.72;
    case "inspecting":
    case "active":
    case "seed":
      return 0.56;
    case "proposing":
      return 0.6;
    case "blocked":
      return 0.28;
    case "rejected":
    case "archived":
      return 0.12;
    default:
      return 0.45;
  }
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

function proposalProjection(proposal?: SemanticProposal) {
  if (!proposal) {
    return undefined;
  }

  const payload = asRecord(proposal.payload);
  const orchestration = asRecord(payload?.orchestration);
  const leanBoundary = asRecord(orchestration?.leanBoundary);
  if (typeof leanBoundary?.projectionDivergence === "number") {
    return leanBoundary.projectionDivergence;
  }

  const divergenceField = asRecord(orchestration?.divergenceField);
  if (typeof divergenceField?.projection === "number") {
    return divergenceField.projection;
  }
  if (typeof divergenceField?.projectionDivergence === "number") {
    return divergenceField.projectionDivergence;
  }

  return outcomeProjectionFallback(proposal.verificationState);
}

function proposalTotalDivergence(proposal?: SemanticProposal) {
  if (!proposal) {
    return undefined;
  }

  const payload = asRecord(proposal.payload);
  const orchestration = asRecord(payload?.orchestration);
  const divergenceField = asRecord(orchestration?.divergenceField);
  if (typeof divergenceField?.total === "number") {
    return divergenceField.total;
  }
  if (typeof divergenceField?.forward === "number" && typeof divergenceField?.reverse === "number") {
    const projection =
      typeof divergenceField?.projection === "number"
        ? divergenceField.projection
        : typeof divergenceField?.projectionDivergence === "number"
          ? divergenceField.projectionDivergence
          : proposalProjection(proposal) ?? 0;
    return divergenceField.forward + divergenceField.reverse + projection;
  }

  return undefined;
}

function proposalLegality(proposal?: SemanticProposal) {
  if (!proposal) {
    return undefined;
  }

  const projection = proposalProjection(proposal) ?? outcomeProjectionFallback(proposal.verificationState);
  const legality = 0.62 * (1 - clampUnit(projection)) + 0.38 * outcomeLegalityScore(proposal.verificationState);
  return clampUnit(legality);
}

function fragmentLegality(simulation: SimulationState, fragment?: TriangleFragment) {
  if (!fragment) {
    return undefined;
  }

  const proposal = latestProposalForFragment(simulation, fragment);
  const proposalScore = proposalLegality(proposal);
  const statusScore = fragmentStatusAdmissibility(fragment.status);
  return clampUnit(average([proposalScore ?? statusScore, statusScore], statusScore));
}

export function computeRefinementFeatureMetrics(
  simulation: SimulationState,
  fragmentId: FragmentId,
): RefinementFeatureMetrics {
  const fragment = simulation.fragments[fragmentId];
  if (!fragment) {
    return {
      refinementLegality: 0,
      projectionConsistency: 0,
      branchAdmissibility: 0,
      metricCompressionGain: 0,
    };
  }

  const parentFragment = fragment.parentFragmentId ? simulation.fragments[fragment.parentFragmentId] : undefined;
  const childFragments = fragment.childFragmentIds
    .map((childFragmentId) => simulation.fragments[childFragmentId])
    .filter((childFragment): childFragment is TriangleFragment => Boolean(childFragment));

  const fragmentProposal = latestProposalForFragment(simulation, fragment);
  const parentProposal = parentFragment ? latestProposalForFragment(simulation, parentFragment) : undefined;
  const childProposals = childFragments.map((childFragment) => latestProposalForFragment(simulation, childFragment));

  const currentLegality = fragmentLegality(simulation, fragment) ?? 0.5;
  const parentLegality = fragmentLegality(simulation, parentFragment);
  const childLegalities = childFragments.map((childFragment) => fragmentLegality(simulation, childFragment));
  const refinementLegality = clampUnit(
    average(
      [
        currentLegality,
        ...(parentLegality !== undefined ? [parentLegality] : []),
        ...childLegalities.filter((value): value is number => typeof value === "number"),
      ],
      currentLegality,
    ),
  );

  const currentProjection = proposalProjection(fragmentProposal) ?? 0.18;
  const parentProjection = proposalProjection(parentProposal);
  const childProjectionValues = childProposals
    .map((proposal) => proposalProjection(proposal))
    .filter((value): value is number => typeof value === "number");
  const projectionPairScores: number[] = [];
  if (typeof parentProjection === "number") {
    projectionPairScores.push(clampUnit(1 - Math.abs(currentProjection - parentProjection)));
  }
  if (childProjectionValues.length > 0) {
    projectionPairScores.push(
      average(childProjectionValues.map((projection) => clampUnit(1 - Math.abs(projection - currentProjection))), 0.5),
    );
  }
  const childProjectionMean = average(childProjectionValues, currentProjection);
  const projectionImprovementBias =
    childProjectionValues.length > 0 ? clampUnit(0.5 + (currentProjection - childProjectionMean) / 2) : 1 - currentProjection;
  const projectionConsistency = clampUnit(
    average([...projectionPairScores, projectionImprovementBias], 1 - currentProjection),
  );

  const branchScores = childFragments.map((childFragment, index) => {
    const childLegality = childLegalities[index] ?? 0.5;
    const childProjection = childProjectionValues[index] ?? proposalProjection(childProposals[index]) ?? 0.18;
    return clampUnit(
      average(
        [
          childLegality,
          1 - clampUnit(childProjection),
          fragmentStatusAdmissibility(childFragment.status),
        ],
        childLegality,
      ),
    );
  });
  const branchAdmissibility = clampUnit(average(branchScores, currentLegality));

  const fragmentTotal = proposalTotalDivergence(fragmentProposal) ?? 0;
  const parentTotal = proposalTotalDivergence(parentProposal);
  const childTotals = childProposals
    .map((proposal) => proposalTotalDivergence(proposal))
    .filter((value): value is number => typeof value === "number");
  const baselineTotal =
    childTotals.length > 0 ? fragmentTotal : typeof parentTotal === "number" ? parentTotal : fragmentTotal;
  const refinedTotal =
    childTotals.length > 0 ? average(childTotals, fragmentTotal) : fragmentTotal;
  const positiveReduction = Math.max(0, baselineTotal - refinedTotal);
  const metricCompressionGain = clampUnit(
    positiveReduction / Math.max(1, baselineTotal + refinedTotal * 0.5),
  );

  return {
    refinementLegality,
    projectionConsistency,
    branchAdmissibility,
    metricCompressionGain,
  };
}
