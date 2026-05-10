import { computeNegAdjunctionField } from "../information-geometry";
import type { CandidateProposalArtifact, FragmentNeighborhoodSnapshot } from "./provider-types";
import type { SynthesizedCandidateRecord } from "./synthesis-engine";

const DEFAULT_FORMALIZATION_LIMIT = 3;
const DEFAULT_VERIFICATION_LIMIT = 2;

export function selectTopLocalCandidatesForFormalization(
  candidates: CandidateProposalArtifact[],
  neighborhood: FragmentNeighborhoodSnapshot,
  limit = DEFAULT_FORMALIZATION_LIMIT,
) {
  return [...candidates]
    .sort((left, right) => {
      const leftField = computeNegAdjunctionField({
        F: { theta: left.theta, eta: left.eta },
        G: { theta: neighborhood.theta, eta: neighborhood.eta },
      });
      const rightField = computeNegAdjunctionField({
        F: { theta: right.theta, eta: right.eta },
        G: { theta: neighborhood.theta, eta: neighborhood.eta },
      });
      const totalDelta = rightField.total - leftField.total;
      if (Math.abs(totalDelta) > 1e-6) {
        return totalDelta;
      }
      return rightField.asymmetry - leftField.asymmetry;
    })
    .slice(0, limit);
}

export function selectCandidatesForVerification(
  rankedCandidates: SynthesizedCandidateRecord[],
  limit = DEFAULT_VERIFICATION_LIMIT,
) {
  const preferred = rankedCandidates.filter(
    (record) =>
      record.divergenceField.total >= 0.35 &&
      record.productiveScore >= 0.22 &&
      !record.assessments.includes("likely_vacuous") &&
      (
        record.divergenceField.asymmetry > 1e-6 ||
        record.disagreementSignals.length > 0 ||
        record.candidate.artifactKind === "definition"
      ) &&
      (
      record.assessments.includes("lean_worthy") ||
      record.assessments.includes("nucleation_candidate") ||
      (record.assessments.includes("architecturally_central") && !record.assessments.includes("likely_vacuous")) ||
      !record.criticBlocked ||
      record.combinedScore >= 0.63 ||
      record.candidate.artifactKind === "definition"
      ),
  );

  return (preferred.length > 0 ? preferred : rankedCandidates).slice(0, limit);
}
