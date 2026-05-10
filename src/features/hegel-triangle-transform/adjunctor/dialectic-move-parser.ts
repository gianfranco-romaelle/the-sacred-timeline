import type { SemanticProposalId } from "@/types/hegel-triangle";
import { inferDialecticMoveSemeioticProfile } from "@/semeiotic/inference";
import type {
  AdjunctorProviderRole,
  CandidateProposalArtifact,
  CritiqueProposalResult,
  DialecticMove,
  DialecticMoveRole,
  GenerateLocalProposalsResult,
  RewriteForFormalizationResult,
  SuggestRepairAfterFailureResult,
} from "./provider-types";

function uniqueNonEmpty(values: Array<string | undefined>, limit = 5) {
  const output: string[] = [];

  for (const value of values) {
    const normalized = value?.replace(/\s+/g, " ").trim();
    if (!normalized || output.includes(normalized)) {
      continue;
    }

    output.push(normalized);
    if (output.length >= limit) {
      break;
    }
  }

  return output;
}

function splitTextUnits(text: string | undefined, limit = 4) {
  if (!text) {
    return [];
  }

  return uniqueNonEmpty(
    text
      .split(/[\n\r]+|(?<=[.!?;:])\s+/)
      .map((part) => part.trim())
      .filter(Boolean),
    limit,
  );
}

function moveId(targetProposalId: SemanticProposalId, role: DialecticMoveRole) {
  return `dialectic_${targetProposalId}_${role}`;
}

function fallbackProviderRole(role: DialecticMoveRole): AdjunctorProviderRole {
  switch (role) {
    case "criticize":
      return "semantic_critic";
    case "synthesize":
      return "proposal_synthesizer";
    case "repair":
      return "proposal_synthesizer";
    case "propose":
    default:
      return "local_mutation_engine";
  }
}

function withSemeiotic(move: Omit<DialecticMove, "semeiotic">): DialecticMove {
  return {
    ...move,
    semeiotic: inferDialecticMoveSemeioticProfile(move),
  };
}

function summarizeCandidate(candidate: CandidateProposalArtifact) {
  return `${candidate.title}. ${candidate.summary}`;
}

function propositionClaims(candidate: CandidateProposalArtifact) {
  return uniqueNonEmpty(
    [
      candidate.title,
      ...splitTextUnits(candidate.theoremOrDefinition, 2),
      ...splitTextUnits(candidate.summary, 2),
      ...candidate.corpusSupport.map(
        (support) => `${support.source}: ${support.passage} (${support.similarity.toFixed(2)})`,
      ),
    ],
    5,
  );
}

function critiqueObjections(
  critique: CritiqueProposalResult,
  candidate: CandidateProposalArtifact,
) {
  const findings = critique.payload.findings.filter((finding) =>
    finding.affectedCandidateIds.includes(candidate.candidateId),
  );

  return uniqueNonEmpty(
    [
      ...findings.map((finding) => finding.message),
      ...critique.payload.ambiguityFlags,
      ...critique.payload.contrastiveExpansions.map((expansion) => expansion.implication),
    ],
    6,
  );
}

function critiqueRepairs(
  critique: CritiqueProposalResult,
  candidate: CandidateProposalArtifact,
) {
  const findings = critique.payload.findings.filter((finding) =>
    finding.affectedCandidateIds.includes(candidate.candidateId),
  );

  return uniqueNonEmpty(
    [
      ...findings.map((finding) => finding.suggestedAction),
      ...critique.payload.contrastiveExpansions.map((expansion) => expansion.description),
    ],
    5,
  );
}

export function buildProposalDialecticMoveChain(input: {
  targetProposalId: SemanticProposalId;
  candidate: CandidateProposalArtifact;
  mutationResult?: GenerateLocalProposalsResult;
  mutationCandidate?: CandidateProposalArtifact;
  formalizationResult?: RewriteForFormalizationResult;
  critiqueResult?: CritiqueProposalResult;
  repairResult?: SuggestRepairAfterFailureResult;
}): DialecticMove[] {
  const moves: DialecticMove[] = [];
  let parentId: string | undefined;
  const mutationCandidate = input.mutationCandidate ?? input.candidate;

  if (mutationCandidate) {
    const id = moveId(input.targetProposalId, "propose");
    moves.push(withSemeiotic({
      id,
      provider: input.mutationResult?.providerId ?? mutationCandidate.provenance[0]?.providerId ?? "personal-open-llm",
      providerRole:
        input.mutationResult?.providerRole ??
        mutationCandidate.provenance[0]?.providerRole ??
        fallbackProviderRole("propose"),
      role: "propose",
      targetProposalId: input.targetProposalId,
      summary:
        input.mutationResult?.payload.synthesisSummary ??
        `Proposed ${mutationCandidate.proposalKind.replaceAll("_", " ")} for ${mutationCandidate.fragmentId}.`,
      extractedClaims: propositionClaims(mutationCandidate),
      extractedObjections: [],
      extractedRepairs: [],
    }));
    parentId = id;
  }

  if (input.formalizationResult) {
    const id = moveId(input.targetProposalId, "synthesize");
    moves.push(withSemeiotic({
      id,
      provider: input.formalizationResult.providerId,
      providerRole: input.formalizationResult.providerRole ?? fallbackProviderRole("synthesize"),
      role: "synthesize",
      parentId,
      targetProposalId: input.targetProposalId,
      summary: `${input.formalizationResult.payload.rewrittenTitle}. ${splitTextUnits(
        input.formalizationResult.payload.rewrittenStatement,
        1,
      )[0] ?? ""}`.trim(),
      extractedClaims: uniqueNonEmpty(
        [
          input.formalizationResult.payload.rewrittenTitle,
          ...splitTextUnits(input.formalizationResult.payload.rewrittenStatement, 2),
        ],
        4,
      ),
      extractedObjections: [],
      extractedRepairs: uniqueNonEmpty(input.formalizationResult.payload.translationNotes, 4),
    }));
    parentId = id;
  }

  if (input.critiqueResult) {
    const id = moveId(input.targetProposalId, "criticize");
    moves.push(withSemeiotic({
      id,
      provider: input.critiqueResult.providerId,
      providerRole: input.critiqueResult.providerRole ?? fallbackProviderRole("criticize"),
      role: "criticize",
      parentId,
      targetProposalId: input.targetProposalId,
      summary: input.critiqueResult.payload.critiqueSummary,
      extractedClaims: uniqueNonEmpty(
        input.critiqueResult.payload.contrastiveExpansions.map(
          (expansion) => `${expansion.label}: ${expansion.description}`,
        ),
        4,
      ),
      extractedObjections: critiqueObjections(input.critiqueResult, input.candidate),
      extractedRepairs: critiqueRepairs(input.critiqueResult, input.candidate),
    }));
    parentId = id;
  }

  if (input.repairResult) {
    const id = moveId(input.targetProposalId, "repair");
    moves.push(withSemeiotic({
      id,
      provider: input.repairResult.providerId,
      providerRole: input.repairResult.providerRole ?? fallbackProviderRole("repair"),
      role: "repair",
      parentId,
      targetProposalId: input.targetProposalId,
      summary: input.repairResult.payload.repairSummary,
      extractedClaims: [],
      extractedObjections: [],
      extractedRepairs: uniqueNonEmpty(
        input.repairResult.payload.suggestions.flatMap((suggestion) => [
          suggestion.title,
          suggestion.description,
          suggestion.revisedStatement,
        ]),
        6,
      ),
    }));
  }

  return moves;
}

export function formatDialecticMoveRaw(move: DialecticMove) {
  const sections = [
    `Provider: ${move.provider}`,
    `Role: ${move.role}`,
    `Semeiotic: ${move.semeiotic?.object.term ?? "icon"} / ${move.semeiotic?.signVehicle.term ?? "qualisign"} / ${move.semeiotic?.interpretant.term ?? "rheme"}`,
    `Summary: ${move.summary}`,
    `Claims: ${move.extractedClaims.join(" | ") || "(none)"}`,
    `Objections: ${move.extractedObjections.join(" | ") || "(none)"}`,
    `Repairs: ${move.extractedRepairs.join(" | ") || "(none)"}`,
  ];

  return `${sections.join("\n")}\n`;
}

export function summarizeDialecticMoveChain(moves: DialecticMove[]) {
  if (moves.length === 0) {
    return undefined;
  }

  return uniqueNonEmpty(
    moves.map((move) => `${move.role}: ${move.summary}`),
    4,
  ).join(" / ");
}

export function describeRawCandidate(candidate: CandidateProposalArtifact) {
  return `${summarizeCandidate(candidate)}\n${candidate.theoremOrDefinition}`.trim();
}
