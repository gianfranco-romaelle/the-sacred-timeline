import type {
  LeanArtifactFile,
  LeanDiagnostic,
  LeanStructuredMessage,
  LeanTaskStatus,
  LeanVerificationRequest,
  LeanVerificationResult,
  ProposalOutcomeState,
  ProposalKind,
} from "@/types/hegel-triangle";

export interface LeanVerifier {
  readonly kind: LeanVerificationResult["verifierKind"];
  verify(request: LeanVerificationRequest): LeanVerificationResult;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pickFloat(...parts: Array<string | number | undefined>) {
  return (hashString(parts.join("|")) % 10000) / 10000;
}

function artifactPath(base: string, suffix: string) {
  return `.mock-lean/${base}/${suffix}`;
}

function theoremAccepted(outcome: ProposalOutcomeState) {
  return outcome === "accepted" || outcome === "promising";
}

function warningsForOutcome(
  request: LeanVerificationRequest,
  outcome: ProposalOutcomeState,
): string[] {
  const warnings: string[] = [];

  if (request.generationDepth >= 3) {
    warnings.push("Deep fragment context may require additional local lemmas.");
  }
  if (request.localGraphComplexity >= 9) {
    warnings.push("Graph elaboration widened beyond the preferred MVP proof boundary.");
  }
  if (outcome === "promising") {
    warnings.push("Proof skeleton type-checks, but one or more obligations remain deferred.");
  }
  if (outcome === "vacuous") {
    warnings.push("Statement reduced to a vacuous boundary condition under current assumptions.");
  }

  return warnings;
}

function errorsForOutcome(
  request: LeanVerificationRequest,
  outcome: ProposalOutcomeState,
): string[] {
  switch (outcome) {
    case "rejected":
      return [
        `type mismatch: local witness for ${request.proposalKind} does not align with the exposed interface shape`,
      ];
    case "blocked":
      return [
        `blocked: missing compatibility lemma between ${request.exposedConnectionCount} exposed interfaces`,
      ];
    default:
      return [];
  }
}

function acceptanceMessage(
  request: LeanVerificationRequest,
  outcome: ProposalOutcomeState,
) {
  switch (outcome) {
    case "accepted":
      return `Lean accepted the ${request.proposalKind.replaceAll("_", " ")} for fragment ${request.fragmentId}.`;
    case "promising":
      return `Lean normalized the statement and retained a plausible proof path for ${request.fragmentId}.`;
    default:
      return undefined;
  }
}

function summaryForOutcome(
  request: LeanVerificationRequest,
  outcome: ProposalOutcomeState,
) {
  switch (outcome) {
    case "accepted":
      return `The statement compiled cleanly and its core obligations discharged under mock Lean heuristics.`;
    case "promising":
      return `The statement elaborated successfully, but the remaining proof obligations were left intentionally open.`;
    case "blocked":
      return `Compilation stopped at a structurally plausible point because a bridging lemma is still absent.`;
    case "vacuous":
      return `The proposition normalized, but the resulting claim contributes no new semantic content.`;
    case "rejected":
      return `The statement failed mock verification because the local graph relation could not be reconciled with the target interface.`;
    case "pending":
    default:
      return `The statement has not yet been classified.`;
  }
}

function diagnosticsForRequest(
  request: LeanVerificationRequest,
  outcome: ProposalOutcomeState,
  warnings: string[],
  errors: string[],
): LeanDiagnostic[] {
  const diagnostics: LeanDiagnostic[] = [
    {
      severity: "info",
      message: `Compiled ${request.generatedFiles[0]?.path ?? "fragment source"} under mock Lean verifier.`,
      code: "mock-elab",
    },
    {
      severity: "info",
      message: `Local graph complexity ${request.localGraphComplexity}; neighbor count ${request.neighborCount}.`,
      code: "mock-context",
    },
  ];

  for (const warning of warnings) {
    diagnostics.push({
      severity: "warning",
      message: warning,
      code: "mock-warning",
      line: 3,
      column: 5,
    });
  }

  for (const error of errors) {
    diagnostics.push({
      severity: "error",
      message: error,
      code: outcome === "blocked" ? "mock-blocked" : "mock-error",
      line: 5,
      column: 7,
    });
  }

  return diagnostics;
}

function messagesForOutcome(
  request: LeanVerificationRequest,
  outcome: ProposalOutcomeState,
  warnings: string[],
  errors: string[],
): LeanStructuredMessage[] {
  const messages: LeanStructuredMessage[] = [
    {
      id: `${request.taskId}:translation`,
      taskId: request.taskId,
      proposalId: request.proposalId,
      kind: "translation",
      level: "info",
      text: `Prepared Lean source for ${request.proposalKind.replaceAll("_", " ")}.`,
      createdAtTick: request.requestedAtTick,
    },
    {
      id: `${request.taskId}:result`,
      taskId: request.taskId,
      proposalId: request.proposalId,
      kind: "result",
      level: outcome === "rejected" || outcome === "blocked" ? "error" : "info",
      text: summaryForOutcome(request, outcome),
      createdAtTick: request.requestedAtTick,
    },
  ];

  warnings.forEach((warning, index) => {
    messages.push({
      id: `${request.taskId}:warning:${index}`,
      taskId: request.taskId,
      proposalId: request.proposalId,
      kind: "stdout",
      level: "warning",
      text: warning,
      createdAtTick: request.requestedAtTick,
    });
  });

  errors.forEach((error, index) => {
    messages.push({
      id: `${request.taskId}:error:${index}`,
      taskId: request.taskId,
      proposalId: request.proposalId,
      kind: "stderr",
      level: "error",
      text: error,
      createdAtTick: request.requestedAtTick,
    });
  });

  return messages;
}

function classifyOutcome(request: LeanVerificationRequest): ProposalOutcomeState {
  let viability =
    request.score * 0.31 +
    request.priority * 0.18 +
    request.confidence * 0.23 +
    Math.min(0.12, request.exposedConnectionCount * 0.04) +
    Math.min(0.08, request.neighborCount * 0.025) +
    Math.min(0.08, request.localGraphComplexity * 0.01) +
    pickFloat(request.proposalId, request.fragmentId, request.requestedAtTick, "verifier") * 0.16;

  viability -= Math.max(0, request.generationDepth - 2) * 0.045;

  switch (request.proposalKind) {
    case "bridge_lemma":
      viability += request.exposedConnectionCount >= 2 ? 0.08 : -0.16;
      break;
    case "candidate_definition":
      viability += 0.07;
      break;
    case "compatibility_claim":
      viability += request.localGraphComplexity >= 6 ? 0.06 : -0.03;
      break;
    case "obstruction_claim":
      viability += request.localGraphComplexity <= 6 ? 0.05 : -0.06;
      break;
    case "projection_rule":
      viability += request.neighborCount >= 2 ? 0.05 : -0.02;
      break;
    case "refinement_law":
      viability += request.generationDepth <= 2 ? 0.05 : -0.03;
      break;
    case "candidate_theorem":
    default:
      viability += 0.02;
      break;
  }

  if (request.proposalKind === "bridge_lemma" && request.exposedConnectionCount < 2) {
    return "blocked";
  }
  if (request.proposalKind === "obstruction_claim" && viability >= 0.55 && viability < 0.75) {
    return "blocked";
  }
  if (viability >= 0.82) {
    return "accepted";
  }
  if (viability >= 0.67) {
    return "promising";
  }
  if (viability >= 0.54) {
    return request.proposalKind === "obstruction_claim" ? "blocked" : "vacuous";
  }
  if (viability >= 0.38) {
    return "blocked";
  }
  return "rejected";
}

export function leanTaskStatusFromResult(outcome: ProposalOutcomeState): LeanTaskStatus {
  switch (outcome) {
    case "accepted":
      return "succeeded";
    case "promising":
      return "running";
    case "vacuous":
      return "canceled";
    case "blocked":
    case "rejected":
      return "failed";
    case "pending":
    default:
      return "queued";
  }
}

export function createLeanVerificationRequest(input: {
  taskId: LeanVerificationRequest["taskId"];
  proposalId: LeanVerificationRequest["proposalId"];
  fragmentId: LeanVerificationRequest["fragmentId"];
  proposalKind: ProposalKind;
  sourceText: string;
  requestedAtTick: number;
  generationDepth: number;
  localGraphComplexity: number;
  neighborCount: number;
  exposedConnectionCount: number;
  score: number;
  confidence: number;
  priority: number;
}): LeanVerificationRequest {
  const base = input.proposalId.replace("semantic_proposal_", "");
  const generatedFiles: LeanArtifactFile[] = [
    {
      path: artifactPath(base, "Main.lean"),
      kind: "source",
      contentPreview: input.sourceText.slice(0, 140),
    },
    {
      path: artifactPath(base, "lakefile.lean"),
      kind: "lakefile",
      contentPreview: "require Mathlib",
    },
    {
      path: artifactPath(base, "build-report.txt"),
      kind: "report",
      contentPreview: "mock lean build report",
    },
  ];

  return {
    ...input,
    generatedFiles,
  };
}

export class MockLeanVerifier implements LeanVerifier {
  readonly kind = "mock" as const;

  verify(request: LeanVerificationRequest): LeanVerificationResult {
    const outcome = classifyOutcome(request);
    const warnings = warningsForOutcome(request, outcome);
    const errors = errorsForOutcome(request, outcome);
    const acceptance = acceptanceMessage(request, outcome);
    const diagnostics = diagnosticsForRequest(request, outcome, warnings, errors);
    const messages = messagesForOutcome(request, outcome, warnings, errors);

    return {
      verifierKind: this.kind,
      outcome,
      theoremAccepted: theoremAccepted(outcome),
      summary: summaryForOutcome(request, outcome),
      acceptanceMessage: acceptance,
      warnings,
      errors,
      diagnostics,
      generatedFiles: request.generatedFiles,
      checkedAtTick: request.requestedAtTick,
      messages,
    };
  }
}

export const mockLeanVerifier = new MockLeanVerifier();
