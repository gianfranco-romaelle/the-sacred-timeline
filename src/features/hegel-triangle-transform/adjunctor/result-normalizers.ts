import type {
  CandidateProposalArtifact,
  CritiqueProposalResult,
  GenerateLocalProposalsResult,
  RewriteForFormalizationResult,
  VerifyCandidateAgainstLeanResult,
} from "./provider-types";

function uniqueValues<T extends string>(values: T[]) {
  return Array.from(new Set(values));
}

export function normalizeLocalMutationResult(result: GenerateLocalProposalsResult) {
  return {
    ...result,
    payload: {
        ...result.payload,
        candidates: result.payload.candidates.map((candidate) => ({
          ...candidate,
          tags: uniqueValues([...candidate.tags, "normalized-mutation"]),
        })),
      keptCandidateIds: uniqueValues(result.payload.keptCandidateIds),
      discardedCandidateIds: uniqueValues(result.payload.discardedCandidateIds),
    },
  } satisfies GenerateLocalProposalsResult;
}

export function normalizeFormalizationResult(
  candidate: CandidateProposalArtifact,
  result: RewriteForFormalizationResult,
) {
  return {
    ...candidate,
    title: result.payload.rewrittenTitle,
    theoremOrDefinition: result.payload.rewrittenStatement,
    mockLeanSnippet: result.payload.rewrittenLeanSnippet,
    tags: uniqueValues([...candidate.tags, "formalized"]),
    provenance: [...candidate.provenance, ...result.provenance],
  } satisfies CandidateProposalArtifact;
}

export function normalizeCritiqueResult(result: CritiqueProposalResult) {
  return {
    ...result,
    payload: {
      ...result.payload,
      ambiguityFlags: uniqueValues(result.payload.ambiguityFlags),
      preferredCandidateIds: uniqueValues(result.payload.preferredCandidateIds),
      blockedCandidateIds: uniqueValues(result.payload.blockedCandidateIds),
    },
  } satisfies CritiqueProposalResult;
}

export function normalizeLeanVerificationResult(result: VerifyCandidateAgainstLeanResult) {
  return {
    ...result,
    payload: {
      ...result.payload,
      warningMessages: uniqueValues(result.payload.warningMessages),
      errorMessages: uniqueValues(result.payload.errorMessages),
      structuredRejectionSurface: uniqueValues(result.payload.structuredRejectionSurface),
      generatedArtifactPaths: uniqueValues(result.payload.generatedArtifactPaths),
      ingestionNotes: uniqueValues(result.payload.ingestionNotes),
    },
  } satisfies VerifyCandidateAgainstLeanResult;
}
