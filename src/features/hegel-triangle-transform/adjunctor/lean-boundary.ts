import type {
  LeanDiagnostic as LegacyLeanDiagnostic,
  LeanDispatchReceipt,
  LeanProofAttemptRecord,
  LeanStructuredMessage as LegacyLeanStructuredMessage,
  LeanTaskId,
  LeanTranslationResult,
  LeanVerificationResult,
  ProposalOutcomeState,
  SemanticProposalId,
} from "@/types/hegel-triangle";
import { defaultLeanIntegrationService } from "../lean-integration";
import { buildLeanVerificationTask } from "./task-builders";
import { executePromptVariantTaskSync } from "./prompt-variant-execution";
import { normalizeLeanVerificationResult } from "./result-normalizers";
import { defaultMockProviderRegistry } from "./provider-registry";
import type {
  AdjunctorLeanBoundaryOutcome,
  AdjunctorLeanVerificationRequest,
  AdjunctorLeanVerificationResponse,
  AdjunctorProviderResult,
  AdjunctorProviderTask,
  AdjunctorTaskId,
  AdjunctorTraceId,
  CandidateProposalArtifact,
  LeanPromotionDecision,
  PromptSelectionSummary,
  ProviderRegistry,
  ProviderRouteMatch,
  VerifyCandidateAgainstLeanResult,
} from "./provider-types";

export interface LeanBoundaryVerificationInput {
  traceId: AdjunctorTraceId;
  taskId: AdjunctorTaskId;
  requestedAtTick: number;
  candidate: CandidateProposalArtifact;
  fragmentId: AdjunctorLeanVerificationRequest["fragmentId"];
  fragmentEmbedding: AdjunctorLeanVerificationRequest["fragmentEmbedding"];
  fragmentTheta: AdjunctorLeanVerificationRequest["fragmentTheta"];
  fragmentEta: AdjunctorLeanVerificationRequest["fragmentEta"];
  proposalId: SemanticProposalId;
  leanTaskId: LeanTaskId;
  generationDepth: number;
  localGraphComplexity: number;
  neighboringFragmentCount: number;
  exposedConnectionCount: number;
  verificationMode: AdjunctorLeanVerificationRequest["verificationMode"];
}

export interface PreparedLeanBoundaryTask {
  translation: LeanTranslationResult;
  request: AdjunctorLeanVerificationRequest;
  providerTask: Extract<AdjunctorProviderTask, { taskType: "verify_candidate_against_lean" }>;
}

export interface LeanBoundaryVerificationRecord extends PreparedLeanBoundaryTask {
  match: ProviderRouteMatch;
  rawProviderResult: VerifyCandidateAgainstLeanResult;
  promptSelection?: PromptSelectionSummary;
  boundaryResult: AdjunctorLeanVerificationResponse;
  simulationOutcome: ProposalOutcomeState;
  promotionDecision: LeanPromotionDecision;
  dispatch: LeanDispatchReceipt;
  verification: LeanVerificationResult;
  attempt: LeanProofAttemptRecord;
}

export interface LeanBoundaryVerifier {
  prepare(input: LeanBoundaryVerificationInput): PreparedLeanBoundaryTask;
  verify(input: LeanBoundaryVerificationInput, registry?: ProviderRegistry): LeanBoundaryVerificationRecord;
}

function backendForMode(mode: LeanBoundaryVerificationInput["verificationMode"]) {
  switch (mode) {
    case "subprocess":
      return "lean-process" as const;
    case "service":
      return "lean-service" as const;
    case "mock":
    default:
      return "mock-sync" as const;
  }
}

export function mapBoundaryOutcomeToSimulationOutcome(
  outcome: AdjunctorLeanBoundaryOutcome,
): ProposalOutcomeState {
  switch (outcome) {
    case "accepted":
      return "accepted";
    case "promising":
      return "promising";
    case "blocked":
      return "blocked";
    case "rejected":
      return "rejected";
    case "redundant":
    case "vacuous":
    default:
      return "vacuous";
  }
}

export function promotionDecisionForOutcome(
  outcome: AdjunctorLeanBoundaryOutcome,
): LeanPromotionDecision {
  switch (outcome) {
    case "accepted":
      return "promote";
    case "promising":
      return "hold";
    case "blocked":
    case "rejected":
    case "redundant":
    case "vacuous":
    default:
      return "discard";
  }
}

function toLegacyStructuredMessages(
  messages: AdjunctorLeanVerificationResponse["messages"],
  proposalId: SemanticProposalId,
): LegacyLeanStructuredMessage[] {
  return messages.map((message, index) => ({
    id: `${message.id}:${index}`,
    taskId: message.taskId,
    proposalId,
    kind: message.kind,
    level: message.level,
    text: message.text,
    createdAtTick: message.createdAtTick,
  }));
}

function toLegacyDiagnostics(
  diagnostics: AdjunctorLeanVerificationResponse["diagnostics"],
): LegacyLeanDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.message,
  }));
}

export class DefaultLeanBoundaryVerifier implements LeanBoundaryVerifier {
  prepare(input: LeanBoundaryVerificationInput): PreparedLeanBoundaryTask {
    const translation = defaultLeanIntegrationService.prepare({
      translation: {
        taskId: input.leanTaskId,
        proposalId: input.proposalId,
        fragmentId: input.fragmentId,
        proposalKind: input.candidate.proposalKind,
        title: input.candidate.title,
        theoremSummary: input.candidate.theoremOrDefinition,
        sourceText: input.candidate.mockLeanSnippet,
        requestedAtTick: input.requestedAtTick,
      },
      verification: {
        taskId: input.leanTaskId,
        proposalId: input.proposalId,
        fragmentId: input.fragmentId,
        proposalKind: input.candidate.proposalKind,
        requestedAtTick: input.requestedAtTick,
        generationDepth: input.generationDepth,
        localGraphComplexity: input.localGraphComplexity,
        neighborCount: input.neighboringFragmentCount,
        exposedConnectionCount: input.exposedConnectionCount,
        score: input.candidate.score,
        confidence: input.candidate.confidence.overall,
        priority: input.candidate.priority,
      },
    }).translation;

    const request: AdjunctorLeanVerificationRequest = {
      leanTaskId: input.leanTaskId,
      traceId: input.traceId,
      candidate: {
        ...input.candidate,
        mockLeanSnippet: translation.sourceText,
      },
      fragmentId: input.fragmentId,
      fragmentEmbedding: [...input.fragmentEmbedding],
      fragmentTheta: [...input.fragmentTheta],
      fragmentEta: [...input.fragmentEta],
      proposalId: input.proposalId,
      generationDepth: input.generationDepth,
      localGraphComplexity: input.localGraphComplexity,
      neighboringFragmentCount: input.neighboringFragmentCount,
      verificationMode: input.verificationMode,
      provenance: input.candidate.provenance,
    };

    const providerTask = buildLeanVerificationTask({
      taskId: input.taskId,
      traceId: input.traceId,
      requestedAtTick: input.requestedAtTick,
      request,
    });

    return {
      translation,
      request,
      providerTask,
    };
  }

  verify(
    input: LeanBoundaryVerificationInput,
    registry: ProviderRegistry = defaultMockProviderRegistry,
  ): LeanBoundaryVerificationRecord {
    const prepared = this.prepare(input);
    const execution = executePromptVariantTaskSync<VerifyCandidateAgainstLeanResult>(registry, prepared.providerTask);
    const normalizedProviderResult = normalizeLeanVerificationResult(execution.result);
    const simulationOutcome = mapBoundaryOutcomeToSimulationOutcome(
      normalizedProviderResult.payload.outcome,
    );
    const promotionDecision = promotionDecisionForOutcome(normalizedProviderResult.payload.outcome);

    const boundaryResult: AdjunctorLeanVerificationResponse = {
      ...normalizedProviderResult.payload,
      legacyOutcome: simulationOutcome,
      promotionDecision,
      translationSourceText: prepared.translation.sourceText,
      generatedArtifactPaths: prepared.translation.generatedFiles.map((file) => file.path),
      ingestionNotes: [
        `Prepared ${prepared.translation.exportMode} artifact ${prepared.translation.moduleName}.`,
        `Mapped boundary outcome ${normalizedProviderResult.payload.outcome} to simulation outcome ${simulationOutcome}.`,
        `projection-divergence:${normalizedProviderResult.payload.projectionDivergence}`,
      ],
    };

    const dispatch = {
      taskId: prepared.request.leanTaskId,
      proposalId: input.proposalId,
      backend: backendForMode(prepared.request.verificationMode),
      status: boundaryResult.status === "failed" ? "failed" : "completed",
      dispatchedAtTick: input.requestedAtTick,
      externalTaskRef: `${prepared.request.verificationMode}://${prepared.request.leanTaskId}`,
      messages: [
        {
          id: `${prepared.request.leanTaskId}:translation`,
          taskId: prepared.request.leanTaskId,
          proposalId: input.proposalId,
          kind: "translation" as const,
          level: "info" as const,
          text: prepared.translation.exportSummary,
          createdAtTick: input.requestedAtTick,
        },
        ...toLegacyStructuredMessages(
          boundaryResult.messages.filter((message) => message.kind === "dispatch" || message.kind === "translation"),
          input.proposalId,
        ),
      ],
    } satisfies LeanDispatchReceipt;

    const verification = {
      verifierKind:
        prepared.request.verificationMode === "mock"
          ? "mock"
          : prepared.request.verificationMode === "subprocess"
            ? "lean-process"
            : "lean-service",
      outcome: simulationOutcome,
      theoremAccepted: boundaryResult.theoremAccepted,
      summary: boundaryResult.summary,
      acceptanceMessage: boundaryResult.acceptanceMessage,
      warnings: boundaryResult.warningMessages,
      errors: boundaryResult.errorMessages,
      diagnostics: toLegacyDiagnostics(boundaryResult.diagnostics),
      generatedFiles: prepared.translation.generatedFiles,
      checkedAtTick: input.requestedAtTick,
      messages: toLegacyStructuredMessages(boundaryResult.messages, input.proposalId),
    } satisfies LeanVerificationResult;

    const attempt = {
      taskId: prepared.request.leanTaskId,
      proposalId: input.proposalId,
      fragmentId: input.fragmentId,
      translation: prepared.translation,
      request: {
        taskId: prepared.request.leanTaskId,
        proposalId: input.proposalId,
        fragmentId: input.fragmentId,
        proposalKind: input.candidate.proposalKind,
        sourceText: prepared.translation.sourceText,
        requestedAtTick: input.requestedAtTick,
        generationDepth: input.generationDepth,
        localGraphComplexity: input.localGraphComplexity,
        neighborCount: input.neighboringFragmentCount,
        exposedConnectionCount: input.exposedConnectionCount,
        score: input.candidate.score,
        confidence: input.candidate.confidence.overall,
        priority: input.candidate.priority,
        generatedFiles: prepared.translation.generatedFiles,
      },
      dispatch,
      result: verification,
      logLines: [
        prepared.translation.exportSummary,
        `boundary-outcome:${boundaryResult.outcome}`,
        `promotion-decision:${promotionDecision}`,
        ...dispatch.messages.map((message) => message.text),
        ...verification.messages.map((message) => message.text),
        ...verification.warnings,
        ...verification.errors,
        ...boundaryResult.structuredRejectionSurface.map((surface) => `rejection-surface:${surface}`),
        ...boundaryResult.ingestionNotes,
      ],
      lastUpdatedTick: input.requestedAtTick,
    } satisfies LeanProofAttemptRecord;

    return {
      ...prepared,
      match: execution.match,
      rawProviderResult: normalizedProviderResult,
      promptSelection: execution.promptSelection,
      boundaryResult,
      simulationOutcome,
      promotionDecision,
      dispatch,
      verification,
      attempt,
    };
  }
}

export const defaultLeanBoundaryVerifier = new DefaultLeanBoundaryVerifier();
