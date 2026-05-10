import { MockChatGptProvider, MockClaudeProvider, MockLeanVerifierAdapter, MockPersonalOpenLlmProvider } from "./mock-providers";
import { resolveStatisticalEmbeddingState } from "../information-geometry";
import type {
  AdjunctorProviderTask,
  AdjunctorProviderMode,
  AnthropicProviderClient,
  AnthropicProviderRequestPayload,
  AnthropicProviderResponsePayload,
  BaseProviderDescriptor,
  CandidateProposalId,
  CandidateRankingPayload,
  CompressAcceptedStructureResult,
  CritiquePayload,
  CritiqueProposalResult,
  FormalizationRewritePayload,
  GenerateLocalProposalsResult,
  LeanRunnerClient,
  LeanRunnerRequestPayload,
  LeanRunnerResponsePayload,
  LeanVerifierProvider,
  LlmProvider,
  LlmProviderResult,
  LlmProviderTask,
  LocalOpenLlmClient,
  LocalOpenLlmRequestPayload,
  LocalOpenLlmResponsePayload,
  OpenAiProviderClient,
  OpenAiProviderRequestPayload,
  OpenAiProviderResponsePayload,
  ProposalSynthesisPayload,
  ProviderAvailability,
  ProviderCapabilityMetadata,
  ProviderCredentialPlaceholder,
  ProviderHealthMetadata,
  ProviderRequestShaper,
  ProviderResponseNormalizer,
  ProviderRetryPolicy,
  ProviderServiceMetadata,
  ProviderTimeoutPolicy,
  ProviderTransportResponse,
  RankCandidatesResult,
  ReliabilitySnapshot,
  RepairSuggestionPayload,
  RewriteForFormalizationResult,
  SuggestRepairAfterFailureResult,
  VerifyCandidateAgainstLeanResult,
} from "./provider-types";

export interface ProviderClientRuntimeConfig<
  TClient,
  TTask extends AdjunctorProviderTask,
  TRequestPayload,
  TResponsePayload,
  TResult extends import("./provider-types").AdjunctorProviderResult,
> {
  mode: AdjunctorProviderMode;
  endpointLabel: string;
  credentials: ProviderCredentialPlaceholder;
  retryPolicy?: Partial<ProviderRetryPolicy>;
  timeoutPolicy?: Partial<ProviderTimeoutPolicy>;
  health?: Partial<ProviderHealthMetadata>;
  client?: TClient;
  requestShaper: ProviderRequestShaper<TTask, TRequestPayload>;
  responseNormalizer: ProviderResponseNormalizer<TTask, TResponsePayload, TResult>;
}

export interface OpenAiProviderRuntimeConfig
  extends ProviderClientRuntimeConfig<
    OpenAiProviderClient,
    LlmProviderTask,
    OpenAiProviderRequestPayload,
    OpenAiProviderResponsePayload,
    LlmProviderResult
  > {}

export interface AnthropicProviderRuntimeConfig
  extends ProviderClientRuntimeConfig<
    AnthropicProviderClient,
    LlmProviderTask,
    AnthropicProviderRequestPayload,
    AnthropicProviderResponsePayload,
    LlmProviderResult
  > {}

export interface LocalOpenLlmProviderRuntimeConfig
  extends ProviderClientRuntimeConfig<
    LocalOpenLlmClient,
    LlmProviderTask,
    LocalOpenLlmRequestPayload,
    LocalOpenLlmResponsePayload,
    LlmProviderResult
  > {}

export interface LeanRunnerProviderRuntimeConfig
  extends ProviderClientRuntimeConfig<
    LeanRunnerClient,
    Extract<AdjunctorProviderTask, { taskType: "verify_candidate_against_lean" }>,
    LeanRunnerRequestPayload,
    LeanRunnerResponsePayload,
    VerifyCandidateAgainstLeanResult
  > {}

function defaultRetryPolicy(): ProviderRetryPolicy {
  return {
    maxAttempts: 2,
    baseDelayMs: 300,
    backoffMultiplier: 2,
    retryableStatuses: ["timeout", "transport_error", "failed"],
  };
}

function defaultTimeoutPolicy(): ProviderTimeoutPolicy {
  return {
    requestTimeoutMs: 45000,
    connectTimeoutMs: 2000,
    idleTimeoutMs: 10000,
  };
}

function serviceMetadata(
  vendor: ProviderServiceMetadata["vendor"],
  mode: AdjunctorProviderMode,
  endpointLabel: string,
  credentials: ProviderCredentialPlaceholder,
  retryPolicy?: Partial<ProviderRetryPolicy>,
  timeoutPolicy?: Partial<ProviderTimeoutPolicy>,
  health?: Partial<ProviderHealthMetadata>,
): ProviderServiceMetadata {
  return {
    vendor,
    requestShapeVersion: "v1",
    responseShapeVersion: "v1",
    retryPolicy: { ...defaultRetryPolicy(), ...retryPolicy },
    timeoutPolicy: { ...defaultTimeoutPolicy(), ...timeoutPolicy },
    credentials,
    health: {
      status: mode === "live" && !credentials.configured ? "degraded" : "available",
      mode,
      vendor,
      configured: credentials.configured,
      consecutiveFailures: 0,
      endpointLabel,
      notes: [mode === "live" ? "Live integration hook ready." : "Delegating to mock provider."],
      ...health,
    },
  };
}

function availabilityFromService(service: ProviderServiceMetadata): ProviderAvailability {
  return {
    status: service.health.status,
    mode: service.health.mode,
    canExecute: service.health.mode === "mock" || service.health.configured,
    lastCheckedAt: service.health.checkedAt,
    reason: service.health.configured ? undefined : "Credentials or endpoint are not configured yet.",
  };
}

function placeholderProvenance(task: AdjunctorProviderTask, provider: BaseProviderDescriptor, candidateIds: CandidateProposalId[] = []) {
  return [
    {
      traceId: task.traceId,
      taskId: task.taskId,
      providerId: provider.id,
      providerRole: provider.role,
      providerMode: provider.mode,
      taskType: task.taskType,
      fragmentId: task.taskType === "verify_candidate_against_lean" ? task.input.request.fragmentId : task.input.neighborhood.fragmentId,
      proposalId: task.taskType === "verify_candidate_against_lean" ? task.input.request.proposalId : undefined,
      candidateIds,
      parentTaskIds: [],
      summary: "Live provider placeholder result.",
      createdAtTick: task.requestedAtTick,
      inputSignature: `${provider.id}:${task.taskType}:${task.requestedAtTick}`,
      outputSignature: `${provider.id}:placeholder`,
    },
  ];
}

function placeholderLlmResult(task: LlmProviderTask, provider: BaseProviderDescriptor): LlmProviderResult {
  const base = {
    taskId: task.taskId,
    traceId: task.traceId,
    providerId: provider.id,
    providerRole: provider.role,
    providerMode: provider.mode,
    status: "skipped" as const,
    startedAtTick: task.requestedAtTick,
    completedAtTick: task.requestedAtTick,
    latencyMs: 0,
    warnings: ["Live provider selected, but no client is configured yet."],
    errors: ["Provider client unavailable."],
    confidence: {
      overall: 0.2,
      semantic: 0.2,
      formal: 0.2,
      novelty: 0.2,
      basis: "historical" as const,
      rationale: ["live-provider-placeholder"],
    },
    reliability: provider.reliability,
    provenance: placeholderProvenance(task, provider),
    ...resolveStatisticalEmbeddingState({
      key: `${provider.id}:${task.taskId}:live-placeholder`,
    }),
  };

  switch (task.taskType) {
    case "generate_local_proposals": {
      const result = {
        ...base,
        taskType: "generate_local_proposals" as const,
        payload: {
          candidates: [],
          synthesisSummary: `${provider.displayName} live hook is configured structurally but not connected yet.`,
          keptCandidateIds: [],
          discardedCandidateIds: [],
        } satisfies ProposalSynthesisPayload,
      } satisfies GenerateLocalProposalsResult;
      return result;
    }
    case "critique_proposal": {
      const result = {
        ...base,
        taskType: "critique_proposal" as const,
        payload: {
          targetCandidateId: task.input.focalCandidateId,
          assessment: "interesting",
          ambiguityFlags: ["Live critique provider unavailable."],
          findings: [],
          contrastiveExpansions: [],
          preferredCandidateIds: [],
          blockedCandidateIds: [],
          critiqueSummary: `${provider.displayName} critique hook is not connected.`,
        } satisfies CritiquePayload,
      } satisfies CritiqueProposalResult;
      return result;
    }
    case "rewrite_for_formalization": {
      const result = {
        ...base,
        taskType: "rewrite_for_formalization" as const,
        payload: {
          candidate: task.input.candidate,
          rewrittenTitle: task.input.candidate.title,
          rewrittenStatement: task.input.candidate.theoremOrDefinition,
          rewrittenLeanSnippet: task.input.candidate.mockLeanSnippet,
          translationNotes: ["Live formalization provider unavailable."],
        } satisfies FormalizationRewritePayload,
      } satisfies RewriteForFormalizationResult;
      return result;
    }
    case "compress_accepted_structure": {
      const result = {
        ...base,
        taskType: "compress_accepted_structure" as const,
        payload: {
          compressedTitle: "Pending live compression",
          compressedSummary: `${provider.displayName} compression hook is not connected.`,
          canonicalTags: ["live-placeholder"],
          recommendedArtifactKind: task.input.acceptedCandidates[0]?.artifactKind ?? "refinement",
          supportingCandidateIds: task.input.acceptedCandidates.map((candidate) => candidate.candidateId),
        },
      } satisfies CompressAcceptedStructureResult;
      return result;
    }
    case "suggest_repair_after_failure": {
      const result = {
        ...base,
        taskType: "suggest_repair_after_failure" as const,
        payload: {
          suggestions: [],
          repairSummary: `${provider.displayName} repair hook is not connected.`,
        } satisfies RepairSuggestionPayload,
      } satisfies SuggestRepairAfterFailureResult;
      return result;
    }
    case "rank_candidates": {
      const result = {
        ...base,
        taskType: "rank_candidates" as const,
        payload: {
          orderedCandidates: task.input.candidates.map((candidate, index) => ({
            candidateId: candidate.candidateId,
            rank: index + 1,
            score: candidate.score,
            confidence: candidate.confidence.overall,
            rationale: "Live ranking provider unavailable; preserving existing order.",
          })),
          rankingSummary: `${provider.displayName} ranking hook is not connected.`,
        } satisfies CandidateRankingPayload,
      } satisfies RankCandidatesResult;
      return result;
    }
    default: {
      const exhaustive: never = task;
      throw new Error(`Unsupported task ${exhaustive}`);
    }
  }
}

function placeholderLeanResult(
  task: Extract<AdjunctorProviderTask, { taskType: "verify_candidate_against_lean" }>,
  provider: BaseProviderDescriptor,
): VerifyCandidateAgainstLeanResult {
  return {
    taskId: task.taskId,
    traceId: task.traceId,
    taskType: task.taskType,
    providerId: provider.id,
    providerRole: provider.role,
    providerMode: provider.mode,
    status: "skipped",
    startedAtTick: task.requestedAtTick,
    completedAtTick: task.requestedAtTick,
    latencyMs: 0,
    payload: {
      leanTaskId: task.input.request.leanTaskId,
      traceId: task.traceId,
      verifierProviderId: provider.id,
      fragmentId: task.input.request.fragmentId,
      proposalId: task.input.request.proposalId,
      candidateId: task.input.request.candidate.candidateId,
      status: "failed",
      outcome: "blocked",
      legacyOutcome: "blocked",
      promotionDecision: "discard",
      theoremAccepted: false,
      summary: `${provider.displayName} live hook is configured structurally but not connected yet.`,
      projectionDivergence: 0.48,
      warningMessages: ["Lean runner unavailable."],
      errorMessages: ["Provider client unavailable."],
      diagnostics: [],
      structuredRejectionSurface: ["live_runner_unavailable"],
      messages: [],
      translationSourceText: task.input.request.candidate.mockLeanSnippet,
      generatedArtifactPaths: [],
      ingestionNotes: ["Returned placeholder Lean result."],
      confidence: {
        overall: 0.2,
        semantic: 0.2,
        formal: 0.2,
        novelty: 0.2,
        basis: "historical",
        rationale: ["live-provider-placeholder"],
      },
      reliability: provider.reliability,
      provenance: placeholderProvenance(task, provider, [task.input.request.candidate.candidateId]),
    },
    warnings: ["Live Lean runner selected, but no client is configured yet."],
    errors: ["Provider client unavailable."],
    confidence: {
      overall: 0.2,
      semantic: 0.2,
      formal: 0.2,
      novelty: 0.2,
      basis: "historical",
      rationale: ["live-provider-placeholder"],
    },
    reliability: provider.reliability,
    provenance: placeholderProvenance(task, provider, [task.input.request.candidate.candidateId]),
    ...resolveStatisticalEmbeddingState({
      key: `${provider.id}:${task.taskId}:lean-placeholder`,
    }),
  };
}

function llmPrompt(task: LlmProviderTask) {
  const selectedPrompt =
    task.taskType === "generate_local_proposals" ||
    task.taskType === "critique_proposal" ||
    task.taskType === "rewrite_for_formalization"
      ? task.input.providerPayload?.selectedPrompt
      : undefined;
  const instructionBlock =
    task.taskType === "generate_local_proposals" ||
    task.taskType === "critique_proposal" ||
    task.taskType === "rewrite_for_formalization"
      ? task.input.providerPayload?.instructions?.join("\n")
      : undefined;

  switch (task.taskType) {
    case "generate_local_proposals":
      return {
        systemPrompt: "Return structured local proposal candidates.",
        userPrompt: [
          selectedPrompt,
          task.input.providerPayload?.neighborhoodSummary,
          task.input.seedSummary,
          instructionBlock,
        ]
          .filter((value): value is string => typeof value === "string" && value.length > 0)
          .join("\n\n"),
        responseSchema: "proposal_synthesis_v1",
      };
    case "critique_proposal":
      return {
        systemPrompt: "Return structured critique findings.",
        userPrompt: [
          selectedPrompt,
          task.input.candidates.map((candidate) => candidate.title).join(" / "),
          instructionBlock,
        ]
          .filter((value): value is string => typeof value === "string" && value.length > 0)
          .join("\n\n"),
        responseSchema: "critique_v1",
      };
    case "rewrite_for_formalization":
      return {
        systemPrompt: "Rewrite proposal candidates into formal mathematical objects.",
        userPrompt: [selectedPrompt, task.input.candidate.title, instructionBlock]
          .filter((value): value is string => typeof value === "string" && value.length > 0)
          .join("\n\n"),
        responseSchema: "formalization_v1",
      };
    case "compress_accepted_structure":
      return {
        systemPrompt: "Compress accepted semantic structure.",
        userPrompt: task.input.acceptedCandidates.map((candidate) => candidate.title).join(" / "),
        responseSchema: "compression_v1",
      };
    case "suggest_repair_after_failure":
      return {
        systemPrompt: "Suggest repair attempts after failure.",
        userPrompt: task.input.candidate.title,
        responseSchema: "repair_v1",
      };
    case "rank_candidates":
      return {
        systemPrompt: "Rank candidates for downstream verification.",
        userPrompt: task.input.candidates.map((candidate) => candidate.title).join(" / "),
        responseSchema: "ranking_v1",
      };
  }
}

export const defaultOpenAiRequestShaper: ProviderRequestShaper<LlmProviderTask, OpenAiProviderRequestPayload> = {
  shape(task, provider) {
    const prompt = llmPrompt(task);
    return {
      providerId: provider.id,
      vendor: "openai",
      traceId: task.traceId,
      taskId: task.taskId,
      taskType: task.taskType,
      payload: {
        model: "configured-openai-model",
        ...prompt,
      },
      timeoutMs: provider.service.timeoutPolicy.requestTimeoutMs,
      maxAttempts: provider.service.retryPolicy.maxAttempts,
      metadata: { providerRole: provider.role },
    };
  },
};

export const defaultAnthropicRequestShaper: ProviderRequestShaper<LlmProviderTask, AnthropicProviderRequestPayload> = {
  shape(task, provider) {
    const prompt = llmPrompt(task);
    return {
      providerId: provider.id,
      vendor: "anthropic",
      traceId: task.traceId,
      taskId: task.taskId,
      taskType: task.taskType,
      payload: {
        model: "configured-anthropic-model",
        ...prompt,
      },
      timeoutMs: provider.service.timeoutPolicy.requestTimeoutMs,
      maxAttempts: provider.service.retryPolicy.maxAttempts,
      metadata: { providerRole: provider.role },
    };
  },
};

export const defaultLocalOpenLlmRequestShaper: ProviderRequestShaper<LlmProviderTask, LocalOpenLlmRequestPayload> = {
  shape(task, provider) {
    const prompt = llmPrompt(task);
    return {
      providerId: provider.id,
      vendor: "local-open-llm",
      traceId: task.traceId,
      taskId: task.taskId,
      taskType: task.taskType,
      payload: {
        model: "configured-local-model",
        prompt: `${prompt.systemPrompt}\n${prompt.userPrompt}`,
        batchSize: task.taskType === "generate_local_proposals" ? 8 : 1,
        responseSchema: prompt.responseSchema,
      },
      timeoutMs: provider.service.timeoutPolicy.requestTimeoutMs,
      maxAttempts: provider.service.retryPolicy.maxAttempts,
      metadata: { providerRole: provider.role },
    };
  },
};

export const defaultLeanRunnerRequestShaper: ProviderRequestShaper<
  Extract<AdjunctorProviderTask, { taskType: "verify_candidate_against_lean" }>,
  LeanRunnerRequestPayload
> = {
  shape(task, provider) {
    return {
      providerId: provider.id,
      vendor: "lean",
      traceId: task.traceId,
      taskId: task.taskId,
      taskType: task.taskType,
      payload: {
        moduleName: task.input.request.leanTaskId.replace("lean_task_", "HegelTriangle."),
        sourceText: task.input.request.candidate.mockLeanSnippet,
        generatedArtifactPaths: [],
        verificationMode: task.input.request.verificationMode,
      },
      timeoutMs: provider.service.timeoutPolicy.requestTimeoutMs,
      maxAttempts: provider.service.retryPolicy.maxAttempts,
      metadata: { providerRole: provider.role },
    };
  },
};

function liveLlmResult<TPayload extends { content: string }>(
  input: { task: LlmProviderTask; provider: BaseProviderDescriptor; response: ProviderTransportResponse<TPayload> },
) {
  const fallback = placeholderLlmResult(input.task, input.provider);
  return {
    ...fallback,
    status: input.response.ok ? "completed" : "failed",
    latencyMs: input.response.latencyMs,
    warnings: input.response.warnings,
    errors: input.response.errors,
  } as LlmProviderResult;
}

export const defaultOpenAiResponseNormalizer: ProviderResponseNormalizer<LlmProviderTask, OpenAiProviderResponsePayload, LlmProviderResult> = {
  normalize(input) {
    return liveLlmResult(input);
  },
};

export const defaultAnthropicResponseNormalizer: ProviderResponseNormalizer<LlmProviderTask, AnthropicProviderResponsePayload, LlmProviderResult> = {
  normalize(input) {
    return liveLlmResult(input);
  },
};

export const defaultLocalOpenLlmResponseNormalizer: ProviderResponseNormalizer<LlmProviderTask, LocalOpenLlmResponsePayload, LlmProviderResult> = {
  normalize(input) {
    return liveLlmResult(input);
  },
};

export const defaultLeanRunnerResponseNormalizer: ProviderResponseNormalizer<
  Extract<AdjunctorProviderTask, { taskType: "verify_candidate_against_lean" }>,
  LeanRunnerResponsePayload,
  VerifyCandidateAgainstLeanResult
> = {
  normalize(input) {
    const fallback = placeholderLeanResult(input.task, input.provider);
    return {
      ...fallback,
      status: input.response.ok ? "completed" : "failed",
      latencyMs: input.response.latencyMs,
      warnings: input.response.warnings,
      errors: [...input.response.errors, ...input.response.payload.stderr],
    };
  },
};

abstract class BaseConfiguredProvider<TRole extends BaseProviderDescriptor["role"]> {
  readonly availability: ProviderAvailability;
  readonly reliability: ReliabilitySnapshot;
  readonly service: ProviderServiceMetadata;

  protected constructor(
    readonly id: BaseProviderDescriptor["id"],
    readonly displayName: string,
    readonly role: TRole,
    readonly mode: AdjunctorProviderMode,
    readonly capabilities: ProviderCapabilityMetadata,
    service: ProviderServiceMetadata,
  ) {
    this.service = service;
    this.availability = availabilityFromService(service);
    this.reliability = {
      score: 0.72,
      basis: "configured",
      notes: [`${displayName} runtime adapter.`],
    };
  }

  supportsTask(taskType: AdjunctorProviderTask["taskType"]) {
    return this.capabilities.supportedTaskTypes.includes(taskType);
  }
}

export class ConfigurableChatGptProvider
  extends BaseConfiguredProvider<"proposal_synthesizer">
  implements LlmProvider
{
  private readonly mockDelegate = new MockChatGptProvider("mock");

  constructor(readonly config: OpenAiProviderRuntimeConfig) {
    super("chatgpt", "ChatGPT", "proposal_synthesizer", config.mode, thisMockCapabilities("chatgpt"), serviceMetadata("openai", config.mode, config.endpointLabel, config.credentials, config.retryPolicy, config.timeoutPolicy, config.health));
  }

  execute(task: LlmProviderTask) {
    if (this.mode === "mock") {
      return this.mockDelegate.execute(task);
    }
    if (!this.config.client) {
      return Promise.resolve(placeholderLlmResult(task, this));
    }
    const request = this.config.requestShaper.shape(task, this);
    return Promise.resolve(this.config.client.execute(request)).then((response) =>
      this.config.responseNormalizer.normalize({ task, provider: this, response }),
    );
  }
}

export class ConfigurableClaudeProvider
  extends BaseConfiguredProvider<"semantic_critic">
  implements LlmProvider
{
  private readonly mockDelegate = new MockClaudeProvider("mock");

  constructor(readonly config: AnthropicProviderRuntimeConfig) {
    super("claude", "Claude", "semantic_critic", config.mode, thisMockCapabilities("claude"), serviceMetadata("anthropic", config.mode, config.endpointLabel, config.credentials, config.retryPolicy, config.timeoutPolicy, config.health));
  }

  execute(task: LlmProviderTask) {
    if (this.mode === "mock") {
      return this.mockDelegate.execute(task);
    }
    if (!this.config.client) {
      return Promise.resolve(placeholderLlmResult(task, this));
    }
    const request = this.config.requestShaper.shape(task, this);
    return Promise.resolve(this.config.client.execute(request)).then((response) =>
      this.config.responseNormalizer.normalize({ task, provider: this, response }),
    );
  }
}

export class ConfigurablePersonalOpenLlmProvider
  extends BaseConfiguredProvider<"local_mutation_engine">
  implements LlmProvider
{
  private readonly mockDelegate = new MockPersonalOpenLlmProvider("mock");

  constructor(readonly config: LocalOpenLlmProviderRuntimeConfig) {
    super("personal-open-llm", "Library-Conditioned Proposer", "local_mutation_engine", config.mode, thisMockCapabilities("personal-open-llm"), serviceMetadata("local-open-llm", config.mode, config.endpointLabel, config.credentials, config.retryPolicy, config.timeoutPolicy, config.health));
  }

  execute(task: LlmProviderTask) {
    if (this.mode === "mock") {
      return this.mockDelegate.execute(task);
    }
    if (!this.config.client) {
      return Promise.resolve(placeholderLlmResult(task, this));
    }
    const request = this.config.requestShaper.shape(task, this);
    return Promise.resolve(this.config.client.execute(request)).then((response) =>
      this.config.responseNormalizer.normalize({ task, provider: this, response }),
    );
  }
}

export class ConfigurableLeanRunnerProvider
  extends BaseConfiguredProvider<"lean_legality_boundary">
  implements LeanVerifierProvider
{
  private readonly mockDelegate = new MockLeanVerifierAdapter("mock");

  constructor(readonly config: LeanRunnerProviderRuntimeConfig) {
    super("lean-verifier", "Lean Verifier", "lean_legality_boundary", config.mode, thisMockCapabilities("lean-verifier"), serviceMetadata("lean", config.mode, config.endpointLabel, config.credentials, config.retryPolicy, config.timeoutPolicy, config.health));
  }

  execute(task: Extract<AdjunctorProviderTask, { taskType: "verify_candidate_against_lean" }>) {
    if (this.mode === "mock") {
      return this.mockDelegate.execute(task);
    }
    if (!this.config.client) {
      return Promise.resolve(placeholderLeanResult(task, this));
    }
    const request = this.config.requestShaper.shape(task, this);
    return Promise.resolve(this.config.client.execute(request)).then((response) =>
      this.config.responseNormalizer.normalize({ task, provider: this, response }),
    );
  }
}

function thisMockCapabilities(providerId: "chatgpt" | "claude" | "personal-open-llm" | "lean-verifier") {
  switch (providerId) {
    case "chatgpt":
      return new MockChatGptProvider("mock").capabilities;
    case "claude":
      return new MockClaudeProvider("mock").capabilities;
    case "personal-open-llm":
      return new MockPersonalOpenLlmProvider("mock").capabilities;
    case "lean-verifier":
    default:
      return new MockLeanVerifierAdapter("mock").capabilities;
  }
}

export function defaultCredentialsPlaceholder(
  label: string,
  strategy: ProviderCredentialPlaceholder["strategy"],
  envVarNames?: string[],
): ProviderCredentialPlaceholder {
  return {
    strategy,
    configured: false,
    redactedLabel: label,
    envVarNames,
    notes: ["Fill this placeholder when wiring the real provider."],
  };
}
