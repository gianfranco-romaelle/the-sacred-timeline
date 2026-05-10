import type {
  LeanDispatchReceipt,
  LeanProofAttemptRecord,
  LeanTaskId,
  LeanTranslationInput,
  LeanTranslationResult,
  LeanVerificationRequest,
  LeanVerificationResult,
} from "@/types/hegel-triangle";
import { createLeanVerificationRequest, mockLeanVerifier } from "./lean-verifier";

export interface LeanProposalTranslator {
  translate(input: LeanTranslationInput): LeanTranslationResult;
}

export interface LeanVerificationTaskDispatcher {
  dispatch(input: {
    translation: LeanTranslationResult;
    request: LeanVerificationRequest;
  }): LeanDispatchReceipt;
  run(input: {
    dispatch: LeanDispatchReceipt;
    request: LeanVerificationRequest;
  }): LeanVerificationResult;
}

export interface LeanResultIngestor {
  ingest(input: {
    translation: LeanTranslationResult;
    request: LeanVerificationRequest;
    dispatch: LeanDispatchReceipt;
    result: LeanVerificationResult;
  }): LeanProofAttemptRecord;
}

export interface LeanProofAttemptRepository {
  save(
    records: Record<LeanTaskId, LeanProofAttemptRecord>,
    attempt: LeanProofAttemptRecord,
  ): Record<LeanTaskId, LeanProofAttemptRecord>;
  get(
    records: Record<LeanTaskId, LeanProofAttemptRecord>,
    taskId: LeanTaskId,
  ): LeanProofAttemptRecord | undefined;
}

export interface PreparedLeanTask {
  translation: LeanTranslationResult;
  request: LeanVerificationRequest;
}

export interface ExecutedLeanTask extends PreparedLeanTask {
  dispatch: LeanDispatchReceipt;
  result: LeanVerificationResult;
  attempt: LeanProofAttemptRecord;
}

function declarationName(title: string, taskId: LeanTaskId) {
  const normalized = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${normalized || "fragment_claim"}_${taskId.replace("lean_task_", "")}`;
}

function moduleName(taskId: LeanTaskId) {
  return `HegelTriangle.${taskId.replace("lean_task_", "").replaceAll("_", ".")}`;
}

class MockProposalTranslator implements LeanProposalTranslator {
  translate(input: LeanTranslationInput): LeanTranslationResult {
    const declName = declarationName(input.title, input.taskId);
    const module = moduleName(input.taskId);

    return {
      taskId: input.taskId,
      proposalId: input.proposalId,
      fragmentId: input.fragmentId,
      translatorKind: "mock-proposal-translator",
      exportMode: "module",
      moduleName: module,
      declarationName: declName,
      sourceText: input.sourceText,
      generatedFiles: [
        {
          path: `.mock-lean/${input.taskId}/Main.lean`,
          kind: "source",
          contentPreview: input.sourceText.slice(0, 140),
        },
        {
          path: `.mock-lean/${input.taskId}/lakefile.lean`,
          kind: "lakefile",
          contentPreview: "require Mathlib",
        },
      ],
      exportSummary: `Prepared ${input.proposalKind.replaceAll("_", " ")} as Lean module ${module}.`,
    };
  }
}

class MockVerificationDispatcher implements LeanVerificationTaskDispatcher {
  dispatch(input: {
    translation: LeanTranslationResult;
    request: LeanVerificationRequest;
  }): LeanDispatchReceipt {
    return {
      taskId: input.request.taskId,
      proposalId: input.request.proposalId,
      backend: "mock-sync",
      status: "completed",
      dispatchedAtTick: input.request.requestedAtTick,
      externalTaskRef: `mock://${input.request.taskId}`,
      messages: [
        {
          id: `${input.request.taskId}:dispatch`,
          taskId: input.request.taskId,
          proposalId: input.request.proposalId,
          kind: "dispatch",
          level: "info",
          text: `Dispatched ${input.translation.moduleName} to mock Lean backend.`,
          createdAtTick: input.request.requestedAtTick,
        },
      ],
    };
  }

  run(input: {
    dispatch: LeanDispatchReceipt;
    request: LeanVerificationRequest;
  }): LeanVerificationResult {
    return mockLeanVerifier.verify(input.request);
  }
}

class DefaultLeanResultIngestor implements LeanResultIngestor {
  ingest(input: {
    translation: LeanTranslationResult;
    request: LeanVerificationRequest;
    dispatch: LeanDispatchReceipt;
    result: LeanVerificationResult;
  }): LeanProofAttemptRecord {
    return {
      taskId: input.request.taskId,
      proposalId: input.request.proposalId,
      fragmentId: input.request.fragmentId,
      translation: input.translation,
      request: input.request,
      dispatch: input.dispatch,
      result: input.result,
      logLines: [
        input.translation.exportSummary,
        ...input.dispatch.messages.map((message) => message.text),
        ...input.result.messages.map((message) => message.text),
        ...input.result.warnings,
        ...input.result.errors,
      ],
      lastUpdatedTick: input.result.checkedAtTick,
    };
  }
}

class InMemoryProofAttemptRepository implements LeanProofAttemptRepository {
  save(
    records: Record<LeanTaskId, LeanProofAttemptRecord>,
    attempt: LeanProofAttemptRecord,
  ): Record<LeanTaskId, LeanProofAttemptRecord> {
    return {
      ...records,
      [attempt.taskId]: attempt,
    };
  }

  get(
    records: Record<LeanTaskId, LeanProofAttemptRecord>,
    taskId: LeanTaskId,
  ) {
    return records[taskId];
  }
}

export interface LeanPreparationInput {
  translation: LeanTranslationInput;
  verification: Omit<LeanVerificationRequest, "generatedFiles" | "sourceText">;
}

export class DefaultLeanIntegrationService {
  constructor(
    readonly translator: LeanProposalTranslator,
    readonly dispatcher: LeanVerificationTaskDispatcher,
    readonly ingestor: LeanResultIngestor,
    readonly repository: LeanProofAttemptRepository,
  ) {}

  prepare(input: LeanPreparationInput): PreparedLeanTask {
    const translation = this.translator.translate(input.translation);
    const request = createLeanVerificationRequest({
      ...input.verification,
      sourceText: translation.sourceText,
    });

    return { translation, request };
  }

  execute(prepared: PreparedLeanTask): ExecutedLeanTask {
    const dispatch = this.dispatcher.dispatch(prepared);
    const result = this.dispatcher.run({
      dispatch,
      request: prepared.request,
    });
    const attempt = this.ingestor.ingest({
      translation: prepared.translation,
      request: prepared.request,
      dispatch,
      result,
    });

    return {
      ...prepared,
      dispatch,
      result,
      attempt,
    };
  }

  saveAttempt(
    records: Record<LeanTaskId, LeanProofAttemptRecord>,
    attempt: LeanProofAttemptRecord,
  ) {
    return this.repository.save(records, attempt);
  }
}

export const defaultLeanIntegrationService = new DefaultLeanIntegrationService(
  new MockProposalTranslator(),
  new MockVerificationDispatcher(),
  new DefaultLeanResultIngestor(),
  new InMemoryProofAttemptRepository(),
);
