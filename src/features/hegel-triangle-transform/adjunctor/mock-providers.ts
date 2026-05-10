import type { CorpusSupportRecord, FragmentId } from "@/types/hegel-triangle";
import {
  computeEmbeddingCurvature,
  computeNegAdjunctionField,
  resolveStatisticalEmbeddingState,
} from "../information-geometry";
import type {
  AdjunctorLeanVerificationResponse,
  AdjunctorProviderMode,
  AdjunctorProviderRole,
  AdjunctorProviderTask,
  BaseProviderExecutionResult,
  CandidateProposalArtifact,
  CandidateProposalId,
  CandidateRankingEntry,
  ConfidenceEstimate,
  ContrastiveExpansion,
  CritiqueFinding,
  CritiquePayload,
  GenerateLocalProposalsResult,
  LlmProviderTask,
  LlmProvider,
  LeanDiagnostic,
  LeanStructuredMessage,
  LeanVerifierProvider,
  ProviderAvailability,
  ProviderCapabilityMetadata,
  ProviderExecutionStatus,
  ProviderProvenanceRecord,
  ReliabilitySnapshot,
  ProviderServiceMetadata,
  ProviderVendor,
  VerifyCandidateAgainstLeanResult,
} from "./provider-types";

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

function clampUnit(value: number) {
  return Math.min(0.99, Math.max(0.05, Number(value.toFixed(2))));
}

function proposalKindLabel(candidate: CandidateProposalArtifact) {
  return candidate.proposalKind.replaceAll("_", " ");
}

function candidateArtifactKind(proposalKind: CandidateProposalArtifact["proposalKind"]) {
  switch (proposalKind) {
    case "candidate_definition":
    case "introduce_definition":
      return "definition";
    case "bridge_lemma":
      return "lemma";
    case "compatibility_claim":
    case "projection_rule":
      return "corollary";
    case "obstruction_claim":
      return "obstruction";
    case "refinement_law":
    case "refine_edge":
    case "refine_vertex":
      return "refinement";
    case "candidate_theorem":
    case "state_theorem":
    default:
      return "theorem";
  }
}

type PrivateCorpusEntry = {
  source: string;
  passage: string;
  concepts: string[];
  embedding: number[];
};

const PRIVATE_LIBRARY_CORPUS: PrivateCorpusEntry[] = [
  {
    source: "Lawvere, Adjointness in Foundations (private corpus)",
    passage:
      "Adjoint situations recur when local construction preserves comparison while shifting the level of semantic description.",
    concepts: ["adjointness", "foundations", "comparison", "semantic"],
    embedding: [0.84, 0.26, 0.58, 0.31, 0.77, 0.42],
  },
  {
    source: "Lawvere, Introduction to Toposes (private corpus)",
    passage:
      "A topos holds geometric variation together with internal logical discipline for passage between viewpoints.",
    concepts: ["topos", "geometry", "logic", "viewpoint"],
    embedding: [0.61, 0.73, 0.48, 0.67, 0.54, 0.39],
  },
  {
    source: "Kisil, Erlangen Programme at Large (private corpus)",
    passage:
      "Invariant structure is surfaced by identifying transformations that preserve competency across representational changes.",
    concepts: ["invariance", "transformation", "competency", "representation"],
    embedding: [0.45, 0.81, 0.64, 0.52, 0.33, 0.71],
  },
  {
    source: "Maturana and Varela, Autopoiesis and Cognition (private corpus)",
    passage:
      "Operational closure marks recurrence: relations persist because the system keeps reproducing the distinctions that define it.",
    concepts: ["operational_closure", "recurrence", "relations", "distinction"],
    embedding: [0.58, 0.37, 0.79, 0.68, 0.41, 0.62],
  },
  {
    source: "Sharov, Mind, Agency, and Biosemiotics (private corpus)",
    passage:
      "Agency appears where recurrent interpretive distinctions support selective continuation across changing environments.",
    concepts: ["agency", "recurrence", "interpretation", "environment"],
    embedding: [0.49, 0.55, 0.71, 0.36, 0.69, 0.57],
  },
];

function paddedVectors(left: number[], right: number[]) {
  const length = Math.max(left.length, right.length);
  return {
    left: Array.from({ length }, (_, index) => left[index] ?? 0),
    right: Array.from({ length }, (_, index) => right[index] ?? 0),
  };
}

function cosineSimilarity(left: number[], right: number[]) {
  const vectors = paddedVectors(left, right);
  const dot = vectors.left.reduce((sum, value, index) => sum + value * vectors.right[index], 0);
  const leftNorm = Math.sqrt(vectors.left.reduce((sum, value) => sum + value * value, 0));
  const rightNorm = Math.sqrt(vectors.right.reduce((sum, value) => sum + value * value, 0));
  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }
  return dot / (leftNorm * rightNorm);
}

function corpusSupportForCandidate(
  embedding: number[],
  summary: string,
  theoremOrDefinition: string,
): CorpusSupportRecord[] {
  const supportText = `${summary} ${theoremOrDefinition}`.toLowerCase();
  const recurrentConcepts = new Set(
    PRIVATE_LIBRARY_CORPUS.flatMap((entry) =>
      entry.concepts.filter((concept) => supportText.includes(concept.replaceAll("_", " "))),
    ),
  );

  return [...PRIVATE_LIBRARY_CORPUS]
    .map((entry) => {
      const recurrenceBoost = entry.concepts.filter((concept) => recurrentConcepts.has(concept)).length * 0.04;
      const similarity = Math.max(0, Math.min(1, cosineSimilarity(embedding, entry.embedding) + recurrenceBoost));
      return {
        source: entry.source,
        passage: entry.passage,
        similarity: Number(similarity.toFixed(3)),
      } satisfies CorpusSupportRecord;
    })
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, 3);
}

function candidateEndpoints(
  inheritedAnchorId: string,
  localEdgeIds: string[],
  index: number,
) {
  const source = {
    entityType: "vertex" as const,
    vertexId: inheritedAnchorId as never,
  };

  if (localEdgeIds.length > 0 && index % 2 === 1) {
    return {
      source,
      target: {
        entityType: "edge" as const,
        edgeId: localEdgeIds[index % localEdgeIds.length] as never,
      },
    };
  }

  return {
    source,
    target: localEdgeIds[0]
      ? {
          entityType: "edge" as const,
          edgeId: localEdgeIds[0] as never,
        }
      : undefined,
  };
}

function makeConfidence(
  providerId: string,
  seed: string,
  basis: ConfidenceEstimate["basis"],
  boost = 0,
): ConfidenceEstimate {
  const semantic = clampUnit(0.5 + pickFloat(providerId, seed, "semantic") * 0.35 + boost);
  const formal = clampUnit(0.42 + pickFloat(providerId, seed, "formal") * 0.32 + boost / 2);
  const novelty = clampUnit(0.38 + pickFloat(providerId, seed, "novelty") * 0.4);
  return {
    overall: clampUnit(semantic * 0.45 + formal * 0.35 + novelty * 0.2 + boost / 3),
    semantic,
    formal,
    novelty,
    basis,
    rationale: [
      `semantic:${semantic.toFixed(2)}`,
      `formal:${formal.toFixed(2)}`,
      `novelty:${novelty.toFixed(2)}`,
    ],
  };
}

function makeProvenance(
  task: AdjunctorProviderTask,
  providerId: string,
  providerRole: AdjunctorProviderRole,
  providerMode: AdjunctorProviderMode,
  summary: string,
  candidateIds: CandidateProposalId[],
): ProviderProvenanceRecord[] {
  let fragmentId: FragmentId | undefined;
  switch (task.taskType) {
    case "generate_local_proposals":
    case "critique_proposal":
    case "rewrite_for_formalization":
    case "compress_accepted_structure":
    case "suggest_repair_after_failure":
    case "rank_candidates":
      fragmentId = task.input.neighborhood.fragmentId;
      break;
    case "verify_candidate_against_lean":
      fragmentId = task.input.request.fragmentId;
      break;
    default:
      fragmentId = undefined;
      break;
  }

  return [
    {
      traceId: task.traceId,
      taskId: task.taskId,
      providerId,
      providerRole,
      providerMode,
      taskType: task.taskType,
      fragmentId,
      candidateIds,
      parentTaskIds: [],
      summary,
      createdAtTick: task.requestedAtTick,
      inputSignature: `${providerId}:${task.taskType}:${task.requestedAtTick}`,
      outputSignature: `${providerId}:${task.taskType}:${candidateIds.join(",") || "none"}`,
    },
  ];
}

function makeLatency(providerId: string, taskType: AdjunctorProviderTask["taskType"]) {
  return 160 + Math.floor(pickFloat(providerId, taskType, "latency") * 420);
}

function makeReliability(
  score: number,
  notes: string[],
  overrides?: Partial<ReliabilitySnapshot>,
): ReliabilitySnapshot {
  return {
    score: clampUnit(score),
    basis: overrides?.basis ?? "configured",
    sampleSize: overrides?.sampleSize,
    verifierAlignment: overrides?.verifierAlignment,
    repairSuccessRate: overrides?.repairSuccessRate,
    notes,
  };
}

function defaultServiceMetadata(
  vendor: ProviderVendor,
  mode: AdjunctorProviderMode,
  credentialsLabel: string,
): ProviderServiceMetadata {
  return {
    vendor,
    requestShapeVersion: "v1",
    responseShapeVersion: "v1",
    retryPolicy: {
      maxAttempts: 1,
      baseDelayMs: 0,
      backoffMultiplier: 1,
      retryableStatuses: ["timeout", "transport_error"],
    },
    timeoutPolicy: {
      requestTimeoutMs: 30000,
      connectTimeoutMs: 1000,
    },
    credentials: {
      strategy: vendor === "lean" ? "local-process" : vendor === "local-open-llm" ? "local-endpoint" : "env-var",
      configured: mode === "mock",
      redactedLabel: credentialsLabel,
      envVarNames:
        vendor === "openai"
          ? ["OPENAI_API_KEY"]
          : vendor === "anthropic"
            ? ["ANTHROPIC_API_KEY"]
            : undefined,
      notes: ["Mock provider placeholder credentials."],
    },
    health: {
      status: "available",
      mode,
      vendor,
      configured: true,
      consecutiveFailures: 0,
      notes: ["Mock service health."],
    },
  };
}

abstract class BaseMockProvider<TRole extends AdjunctorProviderRole> {
  readonly availability: ProviderAvailability;
  readonly reliability: ReliabilitySnapshot;
  readonly service: ProviderServiceMetadata;

  protected constructor(
    readonly id: string,
    readonly displayName: string,
    readonly role: TRole,
    readonly mode: AdjunctorProviderMode,
    readonly serviceVendor: ProviderVendor,
    readonly capabilities: ProviderCapabilityMetadata,
    reliability: ReliabilitySnapshot,
  ) {
    this.availability = {
      status: "available",
      mode,
      canExecute: true,
      reason: mode === "mock" ? "Mock provider enabled for MVP orchestration." : undefined,
    };
    this.reliability = reliability;
    this.service = defaultServiceMetadata(serviceVendor, mode, `${displayName} mock credentials`);
  }

  supportsTask(taskType: AdjunctorProviderTask["taskType"]) {
    return this.capabilities.supportedTaskTypes.includes(taskType);
  }

  protected buildBaseResult<TTask extends AdjunctorProviderTask, TPayload>(
    task: TTask,
    status: ProviderExecutionStatus,
    payload: TPayload,
    confidence: ConfidenceEstimate,
    provenance: ProviderProvenanceRecord[],
    warnings: string[] = [],
    errors: string[] = [],
  ): BaseProviderExecutionResult<TTask["taskType"], TPayload> {
    return {
      taskId: task.taskId,
      traceId: task.traceId,
      taskType: task.taskType,
      providerId: this.id,
      providerRole: this.role,
      providerMode: this.mode,
      status,
      startedAtTick: task.requestedAtTick,
      completedAtTick: task.requestedAtTick,
      latencyMs: makeLatency(this.id, task.taskType),
      payload,
      warnings,
      errors,
      confidence,
      reliability: this.reliability,
      provenance,
      ...resolveStatisticalEmbeddingState({
        key: `${this.id}:${task.taskId}`,
      }),
    };
  }
}

export class MockChatGptProvider extends BaseMockProvider<"proposal_synthesizer"> implements LlmProvider {
  constructor(mode: AdjunctorProviderMode = "mock") {
    super(
      "chatgpt",
      "ChatGPT",
      "proposal_synthesizer",
      mode,
      "openai",
      {
        supportedTaskTypes: [
          "generate_local_proposals",
          "rewrite_for_formalization",
          "suggest_repair_after_failure",
          "compress_accepted_structure",
          "rank_candidates",
        ],
        maxBatchSize: 6,
        costTier: "premium",
        deterministicReplayFriendly: true,
        supportsStreaming: true,
        supportsFormalTranslation: true,
        supportsCritique: false,
        supportsRanking: true,
        supportsRepair: true,
        supportsEmbeddings: false,
        supportsLeanVerification: false,
        latencyEstimate: { typicalMs: 950, p95Ms: 2400 },
        notes: ["Best used for synthesis, formal rewriting, and verifier-informed repair."],
      },
      makeReliability(0.84, ["Configured as primary synthesis engine."], {
        verifierAlignment: 0.79,
        repairSuccessRate: 0.74,
      }),
    );
  }

  execute(task: LlmProviderTask) {
    switch (task.taskType) {
      case "generate_local_proposals":
        return this.generateLocalProposals(task);
      case "rewrite_for_formalization":
        return this.rewriteForFormalization(task);
      case "suggest_repair_after_failure":
        return this.suggestRepair(task);
      case "compress_accepted_structure":
        return this.compressAcceptedStructure(task);
      case "rank_candidates":
        return this.rankCandidates(task);
      default:
        throw new Error(`Unsupported task type ${task.taskType} for ${this.displayName}.`);
    }
  }

  private generateLocalProposals(task: Extract<AdjunctorProviderTask, { taskType: "generate_local_proposals" }>) {
    const { neighborhood, maxCandidates, seedSummary, providerPayload } = task.input;
    const kinds: CandidateProposalArtifact["proposalKind"][] = [
      "candidate_theorem",
      "candidate_definition",
      "bridge_lemma",
      "refinement_law",
    ];
    const count = Math.max(1, Math.min(maxCandidates, 2));
    const candidates = Array.from({ length: count }, (_, index) => {
      const proposalKind = kinds[(hashString(`${task.taskId}:${index}:kind`) + neighborhood.generationDepth) % kinds.length];
      const candidateId =
        `candidate_chatgpt_${neighborhood.fragmentId.replace("fragment_", "")}_${task.requestedAtTick}_${index}` as CandidateProposalId;
      const confidence = makeConfidence(this.id, candidateId, "provider-self-report", 0.08);
      const titlePrefix =
        proposalKind === "candidate_definition"
          ? "Definition of"
          : proposalKind === "bridge_lemma"
            ? "Bridge across"
            : proposalKind === "refinement_law"
              ? "Refinement law for"
              : "Coherence of";
      const title = `${titlePrefix} ${neighborhood.fragmentId.replace("fragment_", "").replaceAll("_", " ")}`;
      const theoremOrDefinition =
        proposalKind === "candidate_definition"
          ? `Define the exposed seam at ${neighborhood.fragmentId} by its inherited anchor and two visible interfaces.`
          : `Show that the inherited anchor of ${neighborhood.fragmentId} controls a coherent relation across ${neighborhood.exposedConnectionIds.length} exposed interfaces.`;
      const summary = seedSummary
        ? `${seedSummary} This synthesis isolates a formal move around ${neighborhood.fragmentId}.`
        : providerPayload
          ? `${providerPayload.neighborhoodSummary} Synthesize a serious ${proposalKindLabel({ proposalKind } as CandidateProposalArtifact)} around ${neighborhood.fragmentId}.`
          : `Synthesize a serious ${proposalKindLabel({ proposalKind } as CandidateProposalArtifact)} around ${neighborhood.fragmentId}.`;
      const endpoints = candidateEndpoints(
        neighborhood.inheritedAnchorId,
        neighborhood.localEdgeIds,
        index,
      );

      return {
        candidateId,
        fragmentId: neighborhood.fragmentId,
        title,
        summary,
        proposalKind,
        artifactKind: candidateArtifactKind(proposalKind),
        source: endpoints.source,
        target: endpoints.target,
        theoremOrDefinition,
        mockLeanSnippet:
          proposalKind === "candidate_definition"
            ? `def ${candidateId.replace("candidate_", "")} : FragmentInterface := by\n  exact placeholderInterface`
            : `theorem ${candidateId.replace("candidate_", "")} : FragmentClaim := by\n  admit`,
        priority: clampUnit(0.56 + pickFloat(this.id, candidateId, "priority") * 0.32),
        score: clampUnit(0.58 + pickFloat(this.id, candidateId, "score") * 0.28),
        confidence,
        disposition: "verify",
        tags: [proposalKind, `depth-${neighborhood.generationDepth}`, "chatgpt-synthesis"],
        corpusSupport: [],
        provenance: makeProvenance(
          task,
          this.id,
          this.role,
          this.mode,
          `Synthesized ${proposalKind.replaceAll("_", " ")} for ${neighborhood.fragmentId}.`,
          [candidateId],
        ),
        ...resolveStatisticalEmbeddingState({
          key: `${this.id}:${candidateId}`,
        }),
      } satisfies CandidateProposalArtifact;
    });

    return this.buildBaseResult(
      task,
      "completed",
      {
        candidates,
        synthesisSummary: `${this.displayName} produced ${candidates.length} formal-ready candidates.`,
        keptCandidateIds: candidates.map((candidate) => candidate.candidateId),
        discardedCandidateIds: [],
      },
      makeConfidence(this.id, task.taskId, "provider-self-report", 0.07),
      makeProvenance(task, this.id, this.role, this.mode, "Completed synthesis pass.", candidates.map((c) => c.candidateId)),
    ) as GenerateLocalProposalsResult;
  }

  private rewriteForFormalization(task: Extract<AdjunctorProviderTask, { taskType: "rewrite_for_formalization" }>) {
    const candidate = task.input.candidate;
    const rewrittenTitle = `${candidate.title} in formal normal form`;
    const rewrittenStatement = `${candidate.theoremOrDefinition} ${task.input.providerPayload?.leanFacingSummaryRequest ?? "The statement is rewritten to minimize semantic drift and expose proof obligations explicitly."}`;
    const rewrittenLeanSnippet =
      candidate.artifactKind === "definition"
        ? `def ${candidate.candidateId.replace("candidate_", "")}_formal : FragmentInterface := by\n  exact placeholderInterface`
        : `theorem ${candidate.candidateId.replace("candidate_", "")}_formal : FragmentClaim := by\n  admit`;

    return this.buildBaseResult(
      task,
      "completed",
      {
        candidate,
        rewrittenTitle,
        rewrittenStatement,
        rewrittenLeanSnippet,
        translationNotes: [
          "normalized binder language",
          "aligned terminology with inherited anchor and exposed interfaces",
          ...(task.input.providerPayload?.instructions ?? []),
        ],
      },
      makeConfidence(this.id, `${task.taskId}:formalization`, "verifier-aligned", 0.09),
      makeProvenance(task, this.id, this.role, this.mode, "Rewrote candidate for formalization.", [candidate.candidateId]),
    );
  }

  private suggestRepair(task: Extract<AdjunctorProviderTask, { taskType: "suggest_repair_after_failure" }>) {
    const { candidate, leanResult } = task.input;
    const suggestions = leanResult.diagnostics.slice(0, 2).map((diagnostic, index) => ({
      id: `${candidate.candidateId}:repair:${index}`,
      title: `Repair ${index + 1} for ${candidate.title}`,
      description: `Address Lean diagnostic ${diagnostic.code} by tightening the interface assumptions.`,
      revisedStatement: `${candidate.theoremOrDefinition} Add the missing compatibility premise identified by ${diagnostic.code}.`,
      revisedLeanSnippet:
        candidate.artifactKind === "definition"
          ? `def ${candidate.candidateId.replace("candidate_", "")}_repair_${index} : FragmentInterface := by\n  exact placeholderInterface`
          : `theorem ${candidate.candidateId.replace("candidate_", "")}_repair_${index} : FragmentClaim := by\n  admit`,
      targetCandidateId: candidate.candidateId,
    }));

    return this.buildBaseResult(
      task,
      "completed",
      {
        suggestions,
        repairSummary: `Prepared ${suggestions.length} repair attempts from Lean diagnostics.`,
      },
      makeConfidence(this.id, `${task.taskId}:repair`, "verifier-aligned", 0.06),
      makeProvenance(task, this.id, this.role, this.mode, "Generated repair suggestions.", [candidate.candidateId]),
      leanResult.warningMessages,
    );
  }

  private compressAcceptedStructure(task: Extract<AdjunctorProviderTask, { taskType: "compress_accepted_structure" }>) {
    const acceptedCandidates = task.input.acceptedCandidates;
    const title = acceptedCandidates[0]?.title ?? "Canonical fragment structure";

    return this.buildBaseResult(
      task,
      "completed",
      {
        compressedTitle: `${title} as canonical scaffold`,
        compressedSummary: `Compress ${acceptedCandidates.length} accepted artifacts into one persistent semantic scaffold.`,
        canonicalTags: ["canonical", "compressed", "chatgpt"],
        recommendedArtifactKind: acceptedCandidates[0]?.artifactKind ?? "theorem",
        supportingCandidateIds: acceptedCandidates.map((candidate) => candidate.candidateId),
      },
      makeConfidence(this.id, `${task.taskId}:compress`, "provider-self-report", 0.05),
      makeProvenance(
        task,
        this.id,
        this.role,
        this.mode,
        "Compressed accepted structure for persistence.",
        acceptedCandidates.map((candidate) => candidate.candidateId),
      ),
    );
  }

  private rankCandidates(task: Extract<AdjunctorProviderTask, { taskType: "rank_candidates" }>) {
    const orderedCandidates = [...task.input.candidates]
      .sort((left, right) => right.score + right.confidence.overall - (left.score + left.confidence.overall))
      .map((candidate, index) => ({
        candidateId: candidate.candidateId,
        rank: index + 1,
        score: clampUnit(candidate.score),
        confidence: clampUnit(candidate.confidence.overall),
        rationale: `${this.displayName} favors formal clarity and verifier alignment for ${candidate.title}.`,
      }));

    return this.buildBaseResult(
      task,
      "completed",
      {
        orderedCandidates,
        rankingSummary: `${this.displayName} ranked ${orderedCandidates.length} candidates by formal readiness.`,
      },
      makeConfidence(this.id, `${task.taskId}:rank`, "provider-self-report", 0.04),
      makeProvenance(
        task,
        this.id,
        this.role,
        this.mode,
        "Ranked candidates for Lean selection.",
        orderedCandidates.map((candidate) => candidate.candidateId),
      ),
    );
  }
}

export class MockClaudeProvider extends BaseMockProvider<"semantic_critic"> implements LlmProvider {
  constructor(mode: AdjunctorProviderMode = "mock") {
    super(
      "claude",
      "Claude",
      "semantic_critic",
      mode,
      "anthropic",
      {
        supportedTaskTypes: ["critique_proposal", "rank_candidates", "compress_accepted_structure"],
        maxBatchSize: 8,
        costTier: "premium",
        deterministicReplayFriendly: true,
        supportsStreaming: true,
        supportsFormalTranslation: false,
        supportsCritique: true,
        supportsRanking: true,
        supportsRepair: false,
        supportsEmbeddings: false,
        supportsLeanVerification: false,
        latencyEstimate: { typicalMs: 1050, p95Ms: 2600 },
        notes: ["Best used for ambiguity detection, contrastive expansion, and semantic criticism."],
      },
      makeReliability(0.82, ["Configured as semantic critic."], {
        verifierAlignment: 0.73,
      }),
    );
  }

  execute(task: LlmProviderTask) {
    switch (task.taskType) {
      case "critique_proposal":
        return this.critiqueProposal(task);
      case "rank_candidates":
        return this.rankCandidates(task);
      case "compress_accepted_structure":
        return this.compressAcceptedStructure(task);
      default:
        throw new Error(`Unsupported task type ${task.taskType} for ${this.displayName}.`);
    }
  }

  private critiqueProposal(task: Extract<AdjunctorProviderTask, { taskType: "critique_proposal" }>) {
    const focalCandidates = task.input.focalCandidateId
      ? task.input.candidates.filter((candidate) => candidate.candidateId === task.input.focalCandidateId)
      : task.input.candidates;
    const findings: CritiqueFinding[] = focalCandidates.flatMap((candidate, index) => {
      const issues: CritiqueFinding[] = [];
      if (candidate.artifactKind === "theorem" && task.input.neighborhood.exposedConnectionIds.length < 2) {
        issues.push({
          id: `${candidate.candidateId}:finding:${index}:bridge`,
          kind: "missing_bridge",
          severity: "high",
          message: `The theorem shape overreaches the visible interface count around ${candidate.fragmentId}.`,
          affectedCandidateIds: [candidate.candidateId],
          suggestedAction: "Downgrade to a local definition or add a bridge premise.",
        });
      }
      if (candidate.confidence.formal < 0.55) {
        issues.push({
          id: `${candidate.candidateId}:finding:${index}:formal`,
          kind: "formalization_risk",
          severity: "medium",
          message: `The candidate lacks enough formal discipline to pass smoothly into Lean.`,
          affectedCandidateIds: [candidate.candidateId],
          suggestedAction: "Request a formal rewrite before verification.",
        });
      }
      if (candidate.tags.includes("chatgpt-synthesis")) {
        issues.push({
          id: `${candidate.candidateId}:finding:${index}:ambiguity`,
          kind: "ambiguity",
          severity: "low",
          message: `Anchor language remains slightly ambiguous against neighboring fragment roles.`,
          affectedCandidateIds: [candidate.candidateId],
          suggestedAction: "Clarify which neighboring fragments are constrained and which are illustrative.",
        });
      }
      return issues;
    });

    const contrastiveExpansions: ContrastiveExpansion[] = focalCandidates.slice(0, 2).map((candidate, index) => ({
      id: `${candidate.candidateId}:contrast:${index}`,
      label: `${candidate.title} under a stricter boundary`,
      description: `Interpret ${candidate.title} as a boundary-preservation claim rather than a global theorem.`,
      implication: "This narrows semantic scope but improves verifier plausibility.",
    }));

    const preferredCandidateIds = focalCandidates
      .filter((candidate) => candidate.confidence.formal >= 0.55)
      .map((candidate) => candidate.candidateId);
    const blockedCandidateIds = findings
      .filter((finding) => finding.severity === "blocking" || finding.severity === "high")
      .flatMap((finding) => finding.affectedCandidateIds);
    const payload: CritiquePayload = {
      targetCandidateId: task.input.focalCandidateId,
      assessment: blockedCandidateIds.length > 0 ? "needs_revision" : "usable",
      ambiguityFlags: [
        ...findings.filter((finding) => finding.kind === "ambiguity").map((finding) => finding.message),
        ...(task.input.providerPayload?.ambiguityTargets ?? []),
      ],
      findings,
      contrastiveExpansions,
      preferredCandidateIds,
      blockedCandidateIds,
      critiqueSummary: `${this.displayName} found ${findings.length} semantic issues across ${focalCandidates.length} candidates.`,
    };

    return this.buildBaseResult(
      task,
      "completed",
      payload,
      makeConfidence(this.id, `${task.taskId}:critique`, "provider-self-report", 0.04),
      makeProvenance(
        task,
        this.id,
        this.role,
        this.mode,
        "Produced semantic critique and contrastive expansions.",
        focalCandidates.map((candidate) => candidate.candidateId),
      ),
    );
  }

  private rankCandidates(task: Extract<AdjunctorProviderTask, { taskType: "rank_candidates" }>) {
    const critiquePenalty = new Map<string, number>();
    for (const candidateId of task.input.critique?.blockedCandidateIds ?? []) {
      critiquePenalty.set(candidateId, 0.2);
    }

    const orderedCandidates: CandidateRankingEntry[] = [...task.input.candidates]
      .sort((left, right) => {
        const leftValue = left.confidence.semantic + left.score - (critiquePenalty.get(left.candidateId) ?? 0);
        const rightValue = right.confidence.semantic + right.score - (critiquePenalty.get(right.candidateId) ?? 0);
        return rightValue - leftValue;
      })
      .map((candidate, index) => ({
        candidateId: candidate.candidateId,
        rank: index + 1,
        score: clampUnit(candidate.score),
        confidence: clampUnit(candidate.confidence.semantic),
        rationale: "Claude prefers candidates with lower ambiguity and stronger semantic scope control.",
      }));

    return this.buildBaseResult(
      task,
      "completed",
      {
        orderedCandidates,
        rankingSummary: `${this.displayName} ranked candidates by semantic coherence and ambiguity risk.`,
      },
      makeConfidence(this.id, `${task.taskId}:rank`, "provider-self-report", 0.03),
      makeProvenance(
        task,
        this.id,
        this.role,
        this.mode,
        "Ranked candidates using critique-sensitive heuristics.",
        orderedCandidates.map((candidate) => candidate.candidateId),
      ),
    );
  }

  private compressAcceptedStructure(task: Extract<AdjunctorProviderTask, { taskType: "compress_accepted_structure" }>) {
    const accepted = task.input.acceptedCandidates;
    return this.buildBaseResult(
      task,
      "completed",
      {
        compressedTitle: "Canonical semantic compression",
        compressedSummary: `Interpret ${accepted.length} accepted artifacts as one contrastively stable persistent scaffold.`,
        canonicalTags: ["canonical", "contrastive", "claude"],
        recommendedArtifactKind: accepted[0]?.artifactKind ?? "relation",
        supportingCandidateIds: accepted.map((candidate) => candidate.candidateId),
      },
      makeConfidence(this.id, `${task.taskId}:compress`, "provider-self-report", 0.05),
      makeProvenance(
        task,
        this.id,
        this.role,
        this.mode,
        "Compressed accepted artifacts with contrastive framing.",
        accepted.map((candidate) => candidate.candidateId),
      ),
    );
  }
}

export class MockPersonalOpenLlmProvider extends BaseMockProvider<"local_mutation_engine"> implements LlmProvider {
  constructor(mode: AdjunctorProviderMode = "mock") {
    super(
      "personal-open-llm",
      "Library-Conditioned Proposer",
      "local_mutation_engine",
      mode,
      "local-open-llm",
      {
        supportedTaskTypes: ["generate_local_proposals", "rank_candidates"],
        maxBatchSize: 16,
        costTier: "cheap",
        deterministicReplayFriendly: true,
        supportsStreaming: false,
        supportsFormalTranslation: false,
        supportsCritique: false,
        supportsRanking: true,
        supportsRepair: false,
        supportsEmbeddings: true,
        supportsLeanVerification: false,
        latencyEstimate: { typicalMs: 220, p95Ms: 700 },
        notes: ["Uses private-corpus embeddings, nearest-passage retrieval, and recurrence cues for local proposal generation."],
      },
      makeReliability(0.74, ["Configured as library-conditioned proposer over local corpus embeddings."], {
        verifierAlignment: 0.58,
      }),
    );
  }

  execute(task: LlmProviderTask) {
    switch (task.taskType) {
      case "generate_local_proposals":
        return this.generateLocalProposals(task);
      case "rank_candidates":
        return this.rankCandidates(task);
      default:
        throw new Error(`Unsupported task type ${task.taskType} for ${this.displayName}.`);
    }
  }

  private generateLocalProposals(task: Extract<AdjunctorProviderTask, { taskType: "generate_local_proposals" }>) {
    const { neighborhood, maxCandidates, providerPayload } = task.input;
    const count = Math.max(2, Math.min(maxCandidates, 5));
    const kinds: CandidateProposalArtifact["proposalKind"][] = [
      "bridge_lemma",
      "projection_rule",
      "compatibility_claim",
      "obstruction_claim",
      "refinement_law",
    ];

    const candidates = Array.from({ length: count }, (_, index) => {
      const proposalKind = kinds[(hashString(`${this.id}:${task.taskId}:${index}`) + index) % kinds.length];
      const candidateId =
        `candidate_open_${neighborhood.fragmentId.replace("fragment_", "")}_${task.requestedAtTick}_${index}` as CandidateProposalId;
      const confidence = makeConfidence(this.id, candidateId, "heuristic");
      const endpoints = candidateEndpoints(
        neighborhood.inheritedAnchorId,
        neighborhood.localEdgeIds,
        index,
      );
      const embeddingState = resolveStatisticalEmbeddingState({
        key: `${this.id}:${candidateId}`,
      });
      const theoremOrDefinition = `Local mutation ${index + 1} relates the inherited anchor to ${neighborhood.exposedConnectionIds.length} exposed seams and ${neighborhood.neighboringFragmentIds.length} nearby fragments while tracking recurring concepts in the private library corpus.`;
      const summary = providerPayload
        ? `${providerPayload.neighborhoodSummary} Surface a ${proposalKind.replaceAll("_", " ")} grounded in private-corpus embeddings, recurrent concepts, and bibliographic support.`
        : `Mutate the local neighborhood of ${neighborhood.fragmentId} by surfacing a ${proposalKind.replaceAll("_", " ")} grounded in private-corpus embeddings, recurrent concepts, and bibliographic support.`;
      const corpusSupport = corpusSupportForCandidate(
        embeddingState.embedding,
        summary,
        theoremOrDefinition,
      );
      return {
        candidateId,
        fragmentId: neighborhood.fragmentId,
        title: `${proposalKind.replaceAll("_", " ")} around ${index + 1}`,
        summary,
        proposalKind,
        artifactKind: candidateArtifactKind(proposalKind),
        source: endpoints.source,
        target: endpoints.target,
        theoremOrDefinition,
        mockLeanSnippet: `theorem ${candidateId.replace("candidate_", "")} : FragmentClaim := by\n  admit`,
        priority: clampUnit(0.38 + pickFloat(this.id, candidateId, "priority") * 0.42),
        score: clampUnit(0.41 + pickFloat(this.id, candidateId, "score") * 0.36),
        confidence,
        disposition: proposalKind === "obstruction_claim" ? "hold" : "revise",
        tags: [proposalKind, "library-conditioned-proposal", "open-llm-mutation", `depth-${neighborhood.generationDepth}`],
        corpusSupport,
        provenance: makeProvenance(
          task,
          this.id,
          this.role,
          this.mode,
          `Generated library-conditioned proposal ${index + 1} for ${neighborhood.fragmentId}.`,
          [candidateId],
        ),
        ...embeddingState,
      } satisfies CandidateProposalArtifact;
    });

    return this.buildBaseResult(
      task,
      "completed",
      {
        candidates,
        synthesisSummary: `${this.displayName} surfaced ${candidates.length} corpus-backed local proposals.`,
        keptCandidateIds: candidates.map((candidate) => candidate.candidateId),
        discardedCandidateIds: [],
      },
      makeConfidence(this.id, `${task.taskId}:mutations`, "heuristic"),
      makeProvenance(task, this.id, this.role, this.mode, "Completed mutation sweep.", candidates.map((candidate) => candidate.candidateId)),
    );
  }

  private rankCandidates(task: Extract<AdjunctorProviderTask, { taskType: "rank_candidates" }>) {
    const orderedCandidates = [...task.input.candidates]
      .sort((left, right) => {
        const leftValue = left.confidence.novelty + left.priority;
        const rightValue = right.confidence.novelty + right.priority;
        return rightValue - leftValue;
      })
      .map((candidate, index) => ({
        candidateId: candidate.candidateId,
        rank: index + 1,
        score: clampUnit(candidate.priority),
        confidence: clampUnit(candidate.confidence.novelty),
        rationale: "Personal open LLM ranks by local novelty and mutation utility.",
      }));

    return this.buildBaseResult(
      task,
      "completed",
      {
        orderedCandidates,
        rankingSummary: `${this.displayName} ranked candidates by local novelty and mutation value.`,
      },
      makeConfidence(this.id, `${task.taskId}:rank`, "heuristic"),
      makeProvenance(
        task,
        this.id,
        this.role,
        this.mode,
        "Ranked mutations for downstream synthesis.",
        orderedCandidates.map((candidate) => candidate.candidateId),
      ),
    );
  }
}

export class MockLeanVerifierAdapter extends BaseMockProvider<"lean_legality_boundary"> implements LeanVerifierProvider {
  constructor(mode: AdjunctorProviderMode = "mock") {
    super(
      "lean-verifier",
      "Lean Verifier",
      "lean_legality_boundary",
      mode,
      "lean",
      {
        supportedTaskTypes: ["verify_candidate_against_lean"],
        maxBatchSize: 4,
        costTier: "moderate",
        deterministicReplayFriendly: true,
        supportsStreaming: false,
        supportsFormalTranslation: false,
        supportsCritique: false,
        supportsRanking: false,
        supportsRepair: false,
        supportsEmbeddings: false,
        supportsLeanVerification: true,
        latencyEstimate: { typicalMs: 340, p95Ms: 1100 },
        notes: ["Acts as the legality boundary and structured rejection surface."],
      },
      makeReliability(0.9, ["Configured as the canonical legality boundary."], {
        basis: "historical",
        verifierAlignment: 1,
      }),
    );
  }

  execute(task: Extract<AdjunctorProviderTask, { taskType: "verify_candidate_against_lean" }>) {
    const { request } = task.input;
    const candidate = request.candidate;
    const field = computeNegAdjunctionField(
      {
        F: { theta: candidate.theta, eta: candidate.eta },
        G: { theta: request.fragmentTheta, eta: request.fragmentEta },
      },
      undefined,
      0,
      computeEmbeddingCurvature([
        { embedding: candidate.embedding, theta: candidate.theta },
        { embedding: request.fragmentEmbedding, theta: request.fragmentTheta },
      ]),
    );
    const productiveBand = Math.max(0, 1 - Math.abs(field.total - 0.56) / 0.56);
    let viability =
      productiveBand * 0.44 +
      Math.min(0.18, field.asymmetry * 0.75) +
      Math.min(0.16, field.curvature * 0.34) +
      candidate.priority * 0.12 +
      candidate.score * 0.08 +
      Math.min(0.08, request.localGraphComplexity * 0.012) +
      Math.min(0.08, request.neighboringFragmentCount * 0.018) +
      pickFloat(this.id, task.taskId, candidate.candidateId, "viability") * 0.08;
    viability -= Math.max(0, request.generationDepth - 2) * 0.05;

    if (candidate.artifactKind === "definition") {
      viability += 0.07;
    }
    if (candidate.artifactKind === "obstruction") {
      viability -= 0.04;
    }
    if (request.localGraphComplexity <= 3 && candidate.artifactKind === "lemma") {
      viability -= 0.08;
    }
    if (field.total >= 1.02) {
      viability -= 0.18;
    }
    if (field.asymmetry <= 1e-6 && field.total < 0.28) {
      viability -= 0.14;
    }

    let outcome: AdjunctorLeanVerificationResponse["outcome"];
    const looksRedundant =
      field.total < 0.24 &&
      field.asymmetry <= 1e-6 &&
      candidate.artifactKind !== "obstruction" &&
      (candidate.artifactKind === "corollary" ||
        candidate.artifactKind === "definition" ||
        candidate.tags.includes("formalized"));

    if (looksRedundant && viability >= 0.58 && viability < 0.8) {
      outcome = "redundant";
    } else if (viability >= 0.82) {
      outcome = "accepted";
    } else if (viability >= 0.68) {
      outcome = "promising";
    } else if (viability >= 0.54) {
      outcome = candidate.artifactKind === "obstruction" ? "blocked" : "vacuous";
    } else if (viability >= 0.4) {
      outcome = "blocked";
    } else {
      outcome = "rejected";
    }

    const diagnostics: LeanDiagnostic[] = [
      {
        severity: "info",
        code: "mock-context",
        message: `Checked ${candidate.title} against a local graph complexity of ${request.localGraphComplexity}.`,
        relatedCandidateId: candidate.candidateId,
      },
    ];

    const warningMessages: string[] = [];
    const errorMessages: string[] = [];
    const structuredRejectionSurface: string[] = [];

    if (request.generationDepth >= 3) {
      warningMessages.push("Deep fragment context may require a stronger bridge hypothesis.");
    }
    if (outcome === "redundant") {
      diagnostics.push({
        severity: "warning",
        code: "mock-redundant",
        message: "The statement elaborates, but does not materially extend the accepted local semantic structure.",
        relatedCandidateId: candidate.candidateId,
        suggestedRepair: "Compress this into persistent structure instead of promoting it as a fresh theorem.",
      });
      warningMessages.push("Lean marked this attempt as redundant with respect to the current local structure.");
      structuredRejectionSurface.push("structural_redundancy");
    }
    if (outcome === "blocked") {
      diagnostics.push({
        severity: "warning",
        code: "mock-blocked",
        message: "A missing compatibility bridge prevents this statement from discharging cleanly.",
        relatedCandidateId: candidate.candidateId,
        suggestedRepair: "Introduce an explicit compatibility premise over the neighboring fragments.",
      });
      structuredRejectionSurface.push("missing_compatibility_bridge");
    }
    if (outcome === "rejected") {
      diagnostics.push({
        severity: "error",
        code: "mock-reject",
        message: "The target interface shape does not align with the current formalized neighborhood.",
        relatedCandidateId: candidate.candidateId,
        suggestedRepair: "Reduce the semantic scope or rewrite as a local definition.",
      });
      errorMessages.push("Lean rejected the current statement under the mock legality boundary.");
      structuredRejectionSurface.push("interface_shape_mismatch");
    }

    const messages: LeanStructuredMessage[] = [
      {
        id: `${request.leanTaskId}:dispatch`,
        taskId: request.leanTaskId,
        kind: "dispatch",
        level: "info",
        text: `Dispatched ${candidate.title} to mock Lean verification.`,
        createdAtTick: task.requestedAtTick,
      },
      {
        id: `${request.leanTaskId}:result`,
        taskId: request.leanTaskId,
        kind: "result",
        level:
          outcome === "accepted"
            ? "info"
            : outcome === "promising" || outcome === "redundant"
              ? "warning"
              : "error",
        text: `Verification completed with outcome ${outcome}.`,
        createdAtTick: task.requestedAtTick,
      },
    ];

    const projectionDivergence =
      outcome === "accepted"
        ? 0
        : outcome === "blocked"
          ? Math.max(0.48, Number((field.total * 0.52).toFixed(2)))
          : outcome === "promising"
            ? Math.max(0.14, Number((field.total * 0.18).toFixed(2)))
            : outcome === "redundant"
              ? Math.max(0.2, Number((field.total * 0.28).toFixed(2)))
              : outcome === "vacuous"
                ? Math.max(0.26, Number((field.total * 0.34).toFixed(2)))
                : Math.max(0.82, Number((field.total * 0.66).toFixed(2)));

    const payload: AdjunctorLeanVerificationResponse = {
      leanTaskId: request.leanTaskId,
      traceId: task.traceId,
      verifierProviderId: this.id,
      fragmentId: request.fragmentId,
      proposalId: request.proposalId,
      candidateId: candidate.candidateId,
      status: "completed",
      outcome,
      legacyOutcome:
        outcome === "redundant"
          ? "vacuous"
          : outcome,
      promotionDecision:
        outcome === "accepted"
          ? "promote"
          : outcome === "promising"
            ? "hold"
            : "discard",
      theoremAccepted: outcome === "accepted" || outcome === "promising",
      summary:
        outcome === "accepted"
          ? `${candidate.title} crosses the legality boundary and is fit for promotion.`
          : outcome === "promising"
            ? `${candidate.title} remains semantically plausible but underconstrained.`
            : outcome === "redundant"
              ? `${candidate.title} elaborates, but only restates structure already present in the local semantic neighborhood.`
            : `${task.input.providerPayload?.artifactSummary ?? candidate.title} failed the legality boundary and exposes structured rejection data.`,
      acceptanceMessage:
        outcome === "accepted" ? `Lean accepted ${candidate.title} under mock verification.` : undefined,
      projectionDivergence,
      warningMessages,
      errorMessages,
      diagnostics,
      structuredRejectionSurface,
      messages,
      translationSourceText: candidate.mockLeanSnippet,
      generatedArtifactPaths: [],
      ingestionNotes: [
        "Mock Lean verifier classified the candidate without running a real Lean backend.",
      ],
      confidence: makeConfidence(this.id, `${task.taskId}:lean`, "verifier-aligned", 0.1),
      reliability: this.reliability,
      provenance: makeProvenance(
        task,
        this.id,
        this.role,
        this.mode,
        `Verified candidate ${candidate.candidateId} with outcome ${outcome}.`,
        [candidate.candidateId],
      ),
    };

    return this.buildBaseResult(
      task,
      "completed",
      payload,
      payload.confidence,
      payload.provenance,
      warningMessages,
      errorMessages,
    ) as VerifyCandidateAgainstLeanResult;
  }
}
