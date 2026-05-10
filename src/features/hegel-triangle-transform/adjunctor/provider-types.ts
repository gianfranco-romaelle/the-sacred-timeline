import type {
  ExposedConnectionId,
  FragmentId,
  FragmentVertexId,
  LeanTaskId,
  LocalGraphEdgeId,
  Point2D,
  ProposalEndpoint,
  ProposalKind,
  ProposalOutcomeState,
  CorpusSupportRecord,
  SemeioticOntologyProfile,
  SemanticProposalId,
  StatisticalEmbeddingState,
} from "@/types/hegel-triangle";
import type { DialecticalMoment, DialecticalMomentId, DialecticalRole } from "@/semeiotic/schema";
import type { DecCompatibilityMetrics } from "../dec-compatibility";
import type { ControlFeatureMetrics } from "../control-features";
import type { RefinementFeatureMetrics } from "../refinement-features";

export type AdjunctorProviderId =
  | "chatgpt"
  | "claude"
  | "personal-open-llm"
  | "lean-verifier"
  | (string & {});

export type AdjunctorProviderRole =
  | "proposal_synthesizer"
  | "semantic_critic"
  | "local_mutation_engine"
  | "lean_legality_boundary";

export type AdjunctorProviderMode = "mock" | "live";
export type ProviderVendor = "openai" | "anthropic" | "local-open-llm" | "lean";
export type ProviderAvailabilityStatus = "available" | "degraded" | "unavailable";
export type ProviderCostTier = "cheap" | "moderate" | "premium";
export type AdjunctorTaskType =
  | "generate_local_proposals"
  | "critique_proposal"
  | "rewrite_for_formalization"
  | "compress_accepted_structure"
  | "suggest_repair_after_failure"
  | "rank_candidates"
  | "verify_candidate_against_lean";

export type AdjunctorTaskPriority = "low" | "normal" | "high" | "critical";
export type ProviderExecutionStatus = "completed" | "failed" | "rejected" | "skipped";
export type ConfidenceBasis = "heuristic" | "provider-self-report" | "verifier-aligned" | "historical";
export type ReliabilityBasis = "configured" | "mock-observed" | "historical" | "human-judged";
export type ProposalArtifactKind =
  | "theorem"
  | "definition"
  | "lemma"
  | "corollary"
  | "obstruction"
  | "refinement";
export type CritiqueFindingKind =
  | "ambiguity"
  | "missing_bridge"
  | "terminology_drift"
  | "formalization_risk"
  | "scope_leak"
  | "unsupported_jump";
export type CritiqueFindingSeverity = "low" | "medium" | "high" | "blocking";
export type CandidateDisposition = "verify" | "revise" | "hold" | "discard";
export type DialecticMoveRole = DialecticalRole;
export type LeanStructuredMessageKind = "translation" | "dispatch" | "stdout" | "stderr" | "result";
export type LeanStructuredMessageLevel = "info" | "warning" | "error";
export type LeanDiagnosticSeverity = "info" | "warning" | "error";
export type LeanVerificationMode = "mock" | "subprocess" | "service";
export type LeanVerificationStatus = "queued" | "running" | "completed" | "failed";
export type AdjunctorLeanBoundaryOutcome =
  | "accepted"
  | "rejected"
  | "blocked"
  | "vacuous"
  | "promising"
  | "redundant";
export type LeanPromotionDecision = "promote" | "hold" | "discard";

export type AdjunctorTaskId = `adjunctor_task_${string}`;
export type AdjunctorTraceId = `adjunctor_trace_${string}`;
export type CandidateProposalId = `candidate_${string}`;
export type StructuredAttemptId = `structured_attempt_${string}`;
export type ProviderExecutionValue<T> = T | Promise<T>;

export type ProviderCredentialStrategy =
  | "env-var"
  | "api-key"
  | "service-account"
  | "local-process"
  | "local-endpoint";

export interface ProviderRetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  backoffMultiplier: number;
  retryableStatuses: Array<ProviderExecutionStatus | "timeout" | "transport_error">;
}

export interface ProviderTimeoutPolicy {
  requestTimeoutMs: number;
  connectTimeoutMs?: number;
  idleTimeoutMs?: number;
}

export interface ProviderCredentialPlaceholder {
  strategy: ProviderCredentialStrategy;
  configured: boolean;
  redactedLabel: string;
  envVarNames?: string[];
  notes: string[];
}

export interface ProviderHealthMetadata {
  status: ProviderAvailabilityStatus;
  checkedAt?: string;
  endpointLabel?: string;
  mode: AdjunctorProviderMode;
  vendor: ProviderVendor;
  configured: boolean;
  consecutiveFailures: number;
  lastLatencyMs?: number;
  notes: string[];
}

export interface ProviderServiceMetadata {
  vendor: ProviderVendor;
  requestShapeVersion: string;
  responseShapeVersion: string;
  retryPolicy: ProviderRetryPolicy;
  timeoutPolicy: ProviderTimeoutPolicy;
  credentials: ProviderCredentialPlaceholder;
  health: ProviderHealthMetadata;
}

export interface ProviderLatencyEstimate {
  typicalMs: number;
  p95Ms: number;
}

export interface ProviderCapabilityMetadata {
  supportedTaskTypes: AdjunctorTaskType[];
  maxBatchSize: number;
  costTier: ProviderCostTier;
  deterministicReplayFriendly: boolean;
  supportsStreaming: boolean;
  supportsFormalTranslation: boolean;
  supportsCritique: boolean;
  supportsRanking: boolean;
  supportsRepair: boolean;
  supportsEmbeddings: boolean;
  supportsLeanVerification: boolean;
  latencyEstimate: ProviderLatencyEstimate;
  notes: string[];
}

export interface ProviderAvailability {
  status: ProviderAvailabilityStatus;
  mode: AdjunctorProviderMode;
  canExecute: boolean;
  lastCheckedAt?: string;
  reason?: string;
}

export interface ConfidenceEstimate {
  overall: number;
  semantic: number;
  formal: number;
  novelty: number;
  basis: ConfidenceBasis;
  rationale: string[];
}

export interface ReliabilitySnapshot {
  score: number;
  basis: ReliabilityBasis;
  sampleSize?: number;
  verifierAlignment?: number;
  repairSuccessRate?: number;
  notes: string[];
}

export interface ProviderProvenanceRecord {
  traceId: AdjunctorTraceId;
  taskId: AdjunctorTaskId;
  providerId: AdjunctorProviderId;
  providerRole: AdjunctorProviderRole;
  providerMode: AdjunctorProviderMode;
  taskType: AdjunctorTaskType;
  fragmentId?: FragmentId;
  proposalId?: SemanticProposalId;
  candidateIds: CandidateProposalId[];
  parentTaskIds: AdjunctorTaskId[];
  summary: string;
  createdAtTick: number;
  inputSignature: string;
  outputSignature?: string;
}

export interface ProviderTransportRequest<TPayload> {
  providerId: AdjunctorProviderId;
  vendor: ProviderVendor;
  traceId: AdjunctorTraceId;
  taskId: AdjunctorTaskId;
  taskType: AdjunctorTaskType;
  payload: TPayload;
  timeoutMs: number;
  maxAttempts: number;
  metadata: Record<string, string | number | boolean>;
}

export interface ProviderTransportResponse<TPayload> {
  ok: boolean;
  statusText: string;
  latencyMs: number;
  receivedAtTick: number;
  payload: TPayload;
  warnings: string[];
  errors: string[];
  metadata: Record<string, string | number | boolean>;
}

export interface FragmentNeighborhoodSnapshot extends StatisticalEmbeddingState {
  fragmentId: FragmentId;
  generationDepth: number;
  inheritedAnchorId: FragmentVertexId;
  centroid?: Point2D;
  exposedConnectionIds: ExposedConnectionId[];
  neighboringFragmentIds: FragmentId[];
  localEdgeIds: LocalGraphEdgeId[];
  persistentFragmentIds: FragmentId[];
  activeProposalIds: SemanticProposalId[];
  semanticKeywords: string[];
  semanticSummary?: string;
  decCompatibility: DecCompatibilityMetrics;
  controlFeatures: ControlFeatureMetrics;
  refinementFeatures: RefinementFeatureMetrics;
}

export interface PromptVariantDescriptor {
  id: string;
  prompt: string;
  chartDivergence: number;
}

export interface PromptSelectionSummary {
  bestPromptId?: string;
  bestPrompt?: string;
  bestInputDivergence?: number;
  bestOutputDivergence?: number;
  promptVariants: PromptVariantDescriptor[];
  promptScores: Array<{
    id: string;
    prompt: string;
    inputDivergence: number;
    outputDivergence: number;
  }>;
}

export interface DialecticMove {
  id: string;
  provider: AdjunctorProviderId;
  providerRole?: AdjunctorProviderRole;
  role: DialecticMoveRole;
  parentId?: string;
  targetProposalId?: SemanticProposalId;
  summary: string;
  extractedClaims: string[];
  extractedObjections: string[];
  extractedRepairs: string[];
  semeiotic?: SemeioticOntologyProfile;
  linkedDialecticalMomentId?: DialecticalMomentId;
  linkedDialecticalMoment?: DialecticalMoment;
}

export interface LocalMutationTaskPayload {
  shape: "open_llm_local_mutation";
  neighborhoodSummary: string;
  exposedVertices: string[];
  nearbyGraphEdges: string[];
  requestedMoveCount: number;
  instructions: string[];
  promptVariants?: PromptVariantDescriptor[];
  selectedChartId?: string;
  selectedPrompt?: string;
  chartDivergence?: number;
  candidateChartIds?: string[];
  bestPromptId?: string;
  bestPrompt?: string;
  bestOutputDivergence?: number;
}

export interface FormalizationTaskPayload {
  shape: "chatgpt_formalization";
  structuralContext: string;
  topLocalProposalTitles: string[];
  leanFacingSummaryRequest: string;
  instructions: string[];
  promptVariants?: PromptVariantDescriptor[];
  selectedChartId?: string;
  selectedPrompt?: string;
  chartDivergence?: number;
  candidateChartIds?: string[];
  bestPromptId?: string;
  bestPrompt?: string;
  bestOutputDivergence?: number;
}

export interface CritiqueTaskPayload {
  shape: "claude_semantic_critique";
  ambiguityTargets: string[];
  vacuityChecks: string[];
  conceptualDriftChecks: string[];
  instructions: string[];
  promptVariants?: PromptVariantDescriptor[];
  selectedChartId?: string;
  selectedPrompt?: string;
  chartDivergence?: number;
  candidateChartIds?: string[];
  bestPromptId?: string;
  bestPrompt?: string;
  bestOutputDivergence?: number;
}

export interface LeanVerificationTaskPayload {
  shape: "lean_candidate_verification";
  artifactSummary: string;
  expectedChecks: string[];
  expectedOutputs: string[];
  promptVariants?: PromptVariantDescriptor[];
  selectedChartId?: string;
  selectedPrompt?: string;
  chartDivergence?: number;
  candidateChartIds?: string[];
  bestPromptId?: string;
  bestPrompt?: string;
  bestOutputDivergence?: number;
}

export interface TaskRoutingHint {
  preferredProviderIds?: AdjunctorProviderId[];
  preferredRoles?: AdjunctorProviderRole[];
  excludedProviderIds?: AdjunctorProviderId[];
  requireDeterminism?: boolean;
  requireMockSafe?: boolean;
  maxProviders?: number;
}

export interface CandidateProposalArtifact extends StatisticalEmbeddingState {
  candidateId: CandidateProposalId;
  fragmentId: FragmentId;
  basedOnProposalId?: SemanticProposalId;
  title: string;
  summary: string;
  proposalKind: ProposalKind;
  artifactKind: ProposalArtifactKind;
  source: ProposalEndpoint;
  target?: ProposalEndpoint;
  theoremOrDefinition: string;
  mockLeanSnippet: string;
  priority: number;
  score: number;
  confidence: ConfidenceEstimate;
  disposition: CandidateDisposition;
  tags: string[];
  corpusSupport: CorpusSupportRecord[];
  provenance: ProviderProvenanceRecord[];
}

export interface ProposalSynthesisPayload {
  candidates: CandidateProposalArtifact[];
  synthesisSummary: string;
  keptCandidateIds: CandidateProposalId[];
  discardedCandidateIds: CandidateProposalId[];
}

export interface ContrastiveExpansion {
  id: string;
  label: string;
  description: string;
  implication: string;
}

export interface CritiqueFinding {
  id: string;
  kind: CritiqueFindingKind;
  severity: CritiqueFindingSeverity;
  message: string;
  affectedCandidateIds: CandidateProposalId[];
  suggestedAction?: string;
}

export interface CritiquePayload {
  targetCandidateId?: CandidateProposalId;
  assessment: "usable" | "needs_revision" | "unsafe" | "interesting";
  ambiguityFlags: string[];
  findings: CritiqueFinding[];
  contrastiveExpansions: ContrastiveExpansion[];
  preferredCandidateIds: CandidateProposalId[];
  blockedCandidateIds: CandidateProposalId[];
  critiqueSummary: string;
}

export interface FormalizationRewritePayload {
  candidate: CandidateProposalArtifact;
  rewrittenTitle: string;
  rewrittenStatement: string;
  rewrittenLeanSnippet: string;
  translationNotes: string[];
}

export interface StructureCompressionPayload {
  compressedTitle: string;
  compressedSummary: string;
  canonicalTags: string[];
  recommendedArtifactKind: ProposalArtifactKind;
  supportingCandidateIds: CandidateProposalId[];
}

export interface RepairSuggestion {
  id: string;
  title: string;
  description: string;
  revisedStatement: string;
  revisedLeanSnippet: string;
  targetCandidateId: CandidateProposalId;
}

export interface RepairSuggestionPayload {
  suggestions: RepairSuggestion[];
  repairSummary: string;
}

export interface CandidateRankingEntry {
  candidateId: CandidateProposalId;
  rank: number;
  score: number;
  confidence: number;
  rationale: string;
}

export interface CandidateRankingPayload {
  orderedCandidates: CandidateRankingEntry[];
  rankingSummary: string;
}

export interface LeanStructuredMessage {
  id: string;
  taskId: LeanTaskId;
  kind: LeanStructuredMessageKind;
  level: LeanStructuredMessageLevel;
  text: string;
  createdAtTick: number;
}

export interface LeanDiagnostic {
  severity: LeanDiagnosticSeverity;
  code: string;
  message: string;
  relatedCandidateId?: CandidateProposalId;
  suggestedRepair?: string;
}

export interface AdjunctorLeanVerificationRequest {
  leanTaskId: LeanTaskId;
  traceId: AdjunctorTraceId;
  candidate: CandidateProposalArtifact;
  fragmentId: FragmentId;
  fragmentEmbedding: number[];
  fragmentTheta: number[];
  fragmentEta: number[];
  proposalId?: SemanticProposalId;
  generationDepth: number;
  localGraphComplexity: number;
  neighboringFragmentCount: number;
  verificationMode: LeanVerificationMode;
  provenance: ProviderProvenanceRecord[];
}

export interface AdjunctorLeanVerificationResponse {
  leanTaskId: LeanTaskId;
  traceId: AdjunctorTraceId;
  verifierProviderId: AdjunctorProviderId;
  fragmentId: FragmentId;
  proposalId?: SemanticProposalId;
  candidateId: CandidateProposalId;
  status: LeanVerificationStatus;
  outcome: AdjunctorLeanBoundaryOutcome;
  legacyOutcome: ProposalOutcomeState;
  promotionDecision: LeanPromotionDecision;
  theoremAccepted: boolean;
  summary: string;
  acceptanceMessage?: string;
  projectionDivergence: number;
  warningMessages: string[];
  errorMessages: string[];
  diagnostics: LeanDiagnostic[];
  structuredRejectionSurface: string[];
  messages: LeanStructuredMessage[];
  translationSourceText?: string;
  generatedArtifactPaths: string[];
  ingestionNotes: string[];
  confidence: ConfidenceEstimate;
  reliability: ReliabilitySnapshot;
  provenance: ProviderProvenanceRecord[];
}

export interface GenerateLocalProposalsTaskInput {
  neighborhood: FragmentNeighborhoodSnapshot;
  maxCandidates: number;
  seedSummary?: string;
  providerPayload?: LocalMutationTaskPayload;
}

export interface CritiqueProposalTaskInput {
  neighborhood: FragmentNeighborhoodSnapshot;
  candidates: CandidateProposalArtifact[];
  focalCandidateId?: CandidateProposalId;
  providerPayload?: CritiqueTaskPayload;
}

export interface RewriteForFormalizationTaskInput {
  neighborhood: FragmentNeighborhoodSnapshot;
  candidate: CandidateProposalArtifact;
  critique?: CritiquePayload;
  providerPayload?: FormalizationTaskPayload;
}

export interface CompressAcceptedStructureTaskInput {
  neighborhood: FragmentNeighborhoodSnapshot;
  acceptedCandidates: CandidateProposalArtifact[];
}

export interface SuggestRepairAfterFailureTaskInput {
  neighborhood: FragmentNeighborhoodSnapshot;
  candidate: CandidateProposalArtifact;
  leanResult: AdjunctorLeanVerificationResponse;
}

export interface RankCandidatesTaskInput {
  neighborhood: FragmentNeighborhoodSnapshot;
  candidates: CandidateProposalArtifact[];
  critique?: CritiquePayload;
}

export interface VerifyCandidateAgainstLeanTaskInput {
  request: AdjunctorLeanVerificationRequest;
  providerPayload?: LeanVerificationTaskPayload;
}

export interface BaseTaskEnvelope<TTaskType extends AdjunctorTaskType, TInput> {
  taskId: AdjunctorTaskId;
  traceId: AdjunctorTraceId;
  taskType: TTaskType;
  priority: AdjunctorTaskPriority;
  requestedAtTick: number;
  routingHint?: TaskRoutingHint;
  input: TInput;
}

export type GenerateLocalProposalsTask = BaseTaskEnvelope<"generate_local_proposals", GenerateLocalProposalsTaskInput>;
export type CritiqueProposalTask = BaseTaskEnvelope<"critique_proposal", CritiqueProposalTaskInput>;
export type RewriteForFormalizationTask = BaseTaskEnvelope<
  "rewrite_for_formalization",
  RewriteForFormalizationTaskInput
>;
export type CompressAcceptedStructureTask = BaseTaskEnvelope<
  "compress_accepted_structure",
  CompressAcceptedStructureTaskInput
>;
export type SuggestRepairAfterFailureTask = BaseTaskEnvelope<
  "suggest_repair_after_failure",
  SuggestRepairAfterFailureTaskInput
>;
export type RankCandidatesTask = BaseTaskEnvelope<"rank_candidates", RankCandidatesTaskInput>;
export type VerifyCandidateAgainstLeanTask = BaseTaskEnvelope<
  "verify_candidate_against_lean",
  VerifyCandidateAgainstLeanTaskInput
>;

export type AdjunctorProviderTask =
  | GenerateLocalProposalsTask
  | CritiqueProposalTask
  | RewriteForFormalizationTask
  | CompressAcceptedStructureTask
  | SuggestRepairAfterFailureTask
  | RankCandidatesTask
  | VerifyCandidateAgainstLeanTask;

export type LlmProviderTask =
  | GenerateLocalProposalsTask
  | CritiqueProposalTask
  | RewriteForFormalizationTask
  | CompressAcceptedStructureTask
  | SuggestRepairAfterFailureTask
  | RankCandidatesTask;

export interface BaseProviderExecutionResult<TTaskType extends AdjunctorTaskType, TPayload>
  extends StatisticalEmbeddingState
{
  taskId: AdjunctorTaskId;
  traceId: AdjunctorTraceId;
  taskType: TTaskType;
  providerId: AdjunctorProviderId;
  providerRole: AdjunctorProviderRole;
  providerMode: AdjunctorProviderMode;
  status: ProviderExecutionStatus;
  startedAtTick: number;
  completedAtTick: number;
  latencyMs: number;
  payload: TPayload;
  warnings: string[];
  errors: string[];
  confidence: ConfidenceEstimate;
  reliability: ReliabilitySnapshot;
  provenance: ProviderProvenanceRecord[];
}

export type GenerateLocalProposalsResult = BaseProviderExecutionResult<
  "generate_local_proposals",
  ProposalSynthesisPayload
>;
export type CritiqueProposalResult = BaseProviderExecutionResult<"critique_proposal", CritiquePayload>;
export type RewriteForFormalizationResult = BaseProviderExecutionResult<
  "rewrite_for_formalization",
  FormalizationRewritePayload
>;
export type CompressAcceptedStructureResult = BaseProviderExecutionResult<
  "compress_accepted_structure",
  StructureCompressionPayload
>;
export type SuggestRepairAfterFailureResult = BaseProviderExecutionResult<
  "suggest_repair_after_failure",
  RepairSuggestionPayload
>;
export type RankCandidatesResult = BaseProviderExecutionResult<"rank_candidates", CandidateRankingPayload>;
export type VerifyCandidateAgainstLeanResult = BaseProviderExecutionResult<
  "verify_candidate_against_lean",
  AdjunctorLeanVerificationResponse
>;

export type AdjunctorProviderResult =
  | GenerateLocalProposalsResult
  | CritiqueProposalResult
  | RewriteForFormalizationResult
  | CompressAcceptedStructureResult
  | SuggestRepairAfterFailureResult
  | RankCandidatesResult
  | VerifyCandidateAgainstLeanResult;

export type LlmProviderResult =
  | GenerateLocalProposalsResult
  | CritiqueProposalResult
  | RewriteForFormalizationResult
  | CompressAcceptedStructureResult
  | SuggestRepairAfterFailureResult
  | RankCandidatesResult;

export interface ProviderRouteMatch {
  providerId: AdjunctorProviderId;
  providerRole: AdjunctorProviderRole;
  taskType: AdjunctorTaskType;
  score: number;
  rationale: string;
}

export interface BaseProviderDescriptor {
  id: AdjunctorProviderId;
  displayName: string;
  role: AdjunctorProviderRole;
  mode: AdjunctorProviderMode;
  service: ProviderServiceMetadata;
  capabilities: ProviderCapabilityMetadata;
  availability: ProviderAvailability;
  reliability: ReliabilitySnapshot;
  supportsTask(taskType: AdjunctorTaskType): boolean;
}

export interface ProviderRequestShaper<TTask extends AdjunctorProviderTask, TRawPayload> {
  shape(task: TTask, provider: BaseProviderDescriptor): ProviderTransportRequest<TRawPayload>;
}

export interface ProviderResponseNormalizer<
  TTask extends AdjunctorProviderTask,
  TRawPayload,
  TResult extends AdjunctorProviderResult,
> {
  normalize(input: {
    task: TTask;
    provider: BaseProviderDescriptor;
    response: ProviderTransportResponse<TRawPayload>;
  }): TResult;
}

export interface ProviderHealthProbe {
  check(): ProviderExecutionValue<ProviderHealthMetadata>;
}

export interface OpenAiProviderRequestPayload {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  responseSchema: string;
}

export interface OpenAiProviderResponsePayload {
  model: string;
  content: string;
  finishReason: string;
}

export interface AnthropicProviderRequestPayload {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  responseSchema: string;
}

export interface AnthropicProviderResponsePayload {
  model: string;
  content: string;
  stopReason: string;
}

export interface LocalOpenLlmRequestPayload {
  model: string;
  prompt: string;
  batchSize: number;
  responseSchema: string;
}

export interface LocalOpenLlmResponsePayload {
  model: string;
  content: string;
  tokenCount?: number;
}

export interface LeanRunnerRequestPayload {
  moduleName: string;
  sourceText: string;
  generatedArtifactPaths: string[];
  verificationMode: LeanVerificationMode;
}

export interface LeanRunnerResponsePayload {
  status: LeanVerificationStatus;
  stdout: string[];
  stderr: string[];
  structuredOutcome?: AdjunctorLeanBoundaryOutcome;
}

export interface OpenAiProviderClient {
  execute(
    request: ProviderTransportRequest<OpenAiProviderRequestPayload>,
  ): ProviderExecutionValue<ProviderTransportResponse<OpenAiProviderResponsePayload>>;
}

export interface AnthropicProviderClient {
  execute(
    request: ProviderTransportRequest<AnthropicProviderRequestPayload>,
  ): ProviderExecutionValue<ProviderTransportResponse<AnthropicProviderResponsePayload>>;
}

export interface LocalOpenLlmClient {
  execute(
    request: ProviderTransportRequest<LocalOpenLlmRequestPayload>,
  ): ProviderExecutionValue<ProviderTransportResponse<LocalOpenLlmResponsePayload>>;
}

export interface LeanRunnerClient {
  execute(
    request: ProviderTransportRequest<LeanRunnerRequestPayload>,
  ): ProviderExecutionValue<ProviderTransportResponse<LeanRunnerResponsePayload>>;
}

export interface LlmProvider extends BaseProviderDescriptor {
  role: Exclude<AdjunctorProviderRole, "lean_legality_boundary">;
  execute(task: LlmProviderTask): ProviderExecutionValue<LlmProviderResult>;
}

export interface LeanVerifierProvider extends BaseProviderDescriptor {
  role: "lean_legality_boundary";
  execute(task: VerifyCandidateAgainstLeanTask): ProviderExecutionValue<VerifyCandidateAgainstLeanResult>;
}

export type AdjunctorProvider = LlmProvider | LeanVerifierProvider;

export interface ProviderRegistry {
  list(): AdjunctorProvider[];
  get(providerId: AdjunctorProviderId): AdjunctorProvider | undefined;
  listByRole(role: AdjunctorProviderRole): AdjunctorProvider[];
  resolve(task: AdjunctorProviderTask): ProviderRouteMatch[];
}
