import type {
  CandidateProposalArtifact,
  CompressAcceptedStructureTask,
  CritiqueProposalTask,
  FragmentNeighborhoodSnapshot,
  GenerateLocalProposalsTask,
  RewriteForFormalizationTask,
  VerifyCandidateAgainstLeanTask,
} from "./provider-types";
import {
  shapeCritiquePayload,
  shapeFormalizationPayload,
  shapeLeanVerificationPayload,
  shapeLocalMutationPayload,
} from "./payload-shapers";

function providerIds<T extends string>(...ids: T[]) {
  return ids;
}

function providerRoles<T extends string>(...roles: T[]) {
  return roles;
}

export function buildLocalMutationTask(input: {
  taskId: GenerateLocalProposalsTask["taskId"];
  traceId: GenerateLocalProposalsTask["traceId"];
  requestedAtTick: number;
  neighborhood: FragmentNeighborhoodSnapshot;
  maxCandidates: number;
  seedSummary?: string;
}): GenerateLocalProposalsTask {
  return {
    taskId: input.taskId,
    traceId: input.traceId,
    taskType: "generate_local_proposals",
    priority: "normal",
    requestedAtTick: input.requestedAtTick,
    routingHint: {
      preferredProviderIds: providerIds("personal-open-llm"),
      preferredRoles: providerRoles("local_mutation_engine"),
      requireDeterminism: true,
      requireMockSafe: true,
      maxProviders: 1,
    },
    input: {
      neighborhood: input.neighborhood,
      maxCandidates: input.maxCandidates,
      seedSummary: input.seedSummary,
      providerPayload: shapeLocalMutationPayload(input.neighborhood, input.maxCandidates),
    },
  };
}

export function buildFormalizationTask(input: {
  taskId: RewriteForFormalizationTask["taskId"];
  traceId: RewriteForFormalizationTask["traceId"];
  requestedAtTick: number;
  neighborhood: FragmentNeighborhoodSnapshot;
  candidate: CandidateProposalArtifact;
  topCandidates: CandidateProposalArtifact[];
  critique?: RewriteForFormalizationTask["input"]["critique"];
}): RewriteForFormalizationTask {
  return {
    taskId: input.taskId,
    traceId: input.traceId,
    taskType: "rewrite_for_formalization",
    priority: "high",
    requestedAtTick: input.requestedAtTick,
    routingHint: {
      preferredProviderIds: providerIds("chatgpt"),
      preferredRoles: providerRoles("proposal_synthesizer"),
      requireDeterminism: true,
      requireMockSafe: true,
      maxProviders: 1,
    },
    input: {
      neighborhood: input.neighborhood,
      candidate: input.candidate,
      critique: input.critique,
      providerPayload: shapeFormalizationPayload(input.neighborhood, input.topCandidates),
    },
  };
}

export function buildCritiqueTask(input: {
  taskId: CritiqueProposalTask["taskId"];
  traceId: CritiqueProposalTask["traceId"];
  requestedAtTick: number;
  neighborhood: FragmentNeighborhoodSnapshot;
  candidates: CandidateProposalArtifact[];
}): CritiqueProposalTask {
  return {
    taskId: input.taskId,
    traceId: input.traceId,
    taskType: "critique_proposal",
    priority: "high",
    requestedAtTick: input.requestedAtTick,
    routingHint: {
      preferredProviderIds: providerIds("claude"),
      preferredRoles: providerRoles("semantic_critic"),
      requireDeterminism: true,
      requireMockSafe: true,
      maxProviders: 1,
    },
    input: {
      neighborhood: input.neighborhood,
      candidates: input.candidates,
      providerPayload: shapeCritiquePayload(input.neighborhood, input.candidates),
    },
  };
}

export function buildLeanVerificationTask(input: {
  taskId: VerifyCandidateAgainstLeanTask["taskId"];
  traceId: VerifyCandidateAgainstLeanTask["traceId"];
  requestedAtTick: number;
  request: VerifyCandidateAgainstLeanTask["input"]["request"];
}): VerifyCandidateAgainstLeanTask {
  return {
    taskId: input.taskId,
    traceId: input.traceId,
    taskType: "verify_candidate_against_lean",
    priority: "critical",
    requestedAtTick: input.requestedAtTick,
    routingHint: {
      preferredProviderIds: providerIds("lean-verifier"),
      preferredRoles: providerRoles("lean_legality_boundary"),
      requireDeterminism: true,
      requireMockSafe: true,
      maxProviders: 1,
    },
    input: {
      request: input.request,
      providerPayload: shapeLeanVerificationPayload(input.request.candidate),
    },
  };
}

export function buildCompressionTask(input: {
  taskId: CompressAcceptedStructureTask["taskId"];
  traceId: CompressAcceptedStructureTask["traceId"];
  requestedAtTick: number;
  neighborhood: FragmentNeighborhoodSnapshot;
  acceptedCandidates: CandidateProposalArtifact[];
}): CompressAcceptedStructureTask {
  return {
    taskId: input.taskId,
    traceId: input.traceId,
    taskType: "compress_accepted_structure",
    priority: "normal",
    requestedAtTick: input.requestedAtTick,
    routingHint: {
      preferredProviderIds: providerIds("chatgpt"),
      preferredRoles: providerRoles("proposal_synthesizer"),
      requireDeterminism: true,
      requireMockSafe: true,
      maxProviders: 1,
    },
    input: {
      neighborhood: input.neighborhood,
      acceptedCandidates: input.acceptedCandidates,
    },
  };
}
