import type {
  ExposedConnection,
  ExposedConnectionId,
  FragmentId,
  FragmentLifecycleStatus,
  FragmentVertex,
  FragmentVertexId,
  LeanDispatchReceipt,
  LeanProofAttemptRecord,
  LeanTaskRef,
  LeanTranslationResult,
  LeanVerificationResult,
  LocalGraphEdge,
  LocalGraphEdgeId,
  Point2D,
  PersistentSemanticStub,
  ProposalOutcomeRecord,
  ProposalOutcomeState,
  ReplayLogEntry,
  SemanticProposal,
  SemanticProposalId,
  SimulationState,
  TriangleFragment,
} from "@/types/hegel-triangle";
import type { JsonObject } from "@/types/primitives";
import {
  findExposedConnectionPoints,
  findNeighboringFragments,
  selectLocalGraphNeighborhood,
} from "../fragment-dust-generator";
import {
  computeCatastropheApproximation,
  computeEmbeddingCurvature,
  computeNegAdjunctionField,
  computePhase,
  computeProductiveScore,
  resolveStatisticalEmbeddingState,
  type NegAdjunctionField,
} from "../information-geometry";
import { computeControlFeatureMetrics, type ControlFeatureMetrics } from "../control-features";
import { computeDecCompatibilityMetrics, type DecCompatibilityMetrics } from "../dec-compatibility";
import {
  computeRefinementFeatureMetrics,
  type RefinementFeatureMetrics,
} from "../refinement-features";
import {
  defaultMockProviderRegistry,
} from "./provider-registry";
import {
  buildCompressionTask,
  buildCritiqueTask,
  buildFormalizationTask,
  buildLocalMutationTask,
} from "./task-builders";
import {
  selectCandidatesForVerification as selectRankedCandidatesForVerification,
  selectTopLocalCandidatesForFormalization,
} from "./routing-policy";
import { synthesizeMultiModelCandidates } from "./synthesis-engine";
import {
  normalizeCritiqueResult,
  normalizeFormalizationResult,
  normalizeLocalMutationResult,
} from "./result-normalizers";
import { executePromptVariantTaskSync } from "./prompt-variant-execution";
import { buildProposalDialecticMoveChain, summarizeDialecticMoveChain } from "./dialectic-move-parser";
import type { ProviderContributionSummary, SynthesisAssessment } from "./synthesis-engine";
import type { PromiseProfile } from "../promise-profile";
import type {
  AdjunctorLeanBoundaryOutcome,
  AdjunctorProviderResult,
  AdjunctorProviderTask,
  AdjunctorTaskId,
  AdjunctorTraceId,
  CandidateProposalArtifact,
  CandidateProposalId,
  CompressAcceptedStructureResult,
  CritiqueProposalResult,
  CritiquePayload,
  DialecticMove,
  FragmentNeighborhoodSnapshot,
  GenerateLocalProposalsResult,
  PromptSelectionSummary,
  ProviderRegistry,
  ProviderRouteMatch,
  RewriteForFormalizationResult,
} from "./provider-types";
import { leanTaskStatusFromResult } from "../lean-verifier";
import { defaultLeanIntegrationService } from "../lean-integration";
import { defaultLeanBoundaryVerifier } from "./lean-boundary";
import { inferProposalSemeioticProfile, serializeSemeioticProfile } from "@/semeiotic/inference";
import {
  attachDialecticalMomentsToMoves,
  buildProposalDialecticalMoments,
  proposalSemeioticSummary,
  serializeDialecticalMoment,
} from "@/semeiotic/pipeline";

const ACTIVE_PROPOSAL_LIMIT = 4;
const REPLAY_LOG_LIMIT = 120;
const MAX_FORMALIZATION_CANDIDATES = 3;
const MAX_VERIFICATION_CANDIDATES = 2;

export interface SimulationTickResult {
  simulation: SimulationState;
  activeFragmentId?: FragmentId;
  activeProposalId?: SemanticProposalId;
  generatedProposalIds: SemanticProposalId[];
}

interface FragmentInspection {
  fragment: TriangleFragment;
  neighbors: FragmentId[];
  exposedPoints: FragmentVertex[];
  neighborhood: ReturnType<typeof selectLocalGraphNeighborhood>;
}

interface RankedCandidateRecord {
  candidate: CandidateProposalArtifact;
  divergenceField: NegAdjunctionField;
  promiseProfile: PromiseProfile;
  productiveScore: number;
  vacuityPenalty: number;
  instabilityPenalty: number;
  combinedScore: number;
  mutationEnergy: number;
  formalizationStrength: number;
  critiquePressure: number;
  architectureCentrality: number;
  criticPreferred: boolean;
  criticBlocked: boolean;
  critiqueFindings: string[];
  disagreementSignals: string[];
  assessments: SynthesisAssessment[];
  contributionSummary: ProviderContributionSummary;
}

interface OrchestratedProposalPlan extends RankedCandidateRecord {
  proposalId: SemanticProposalId;
  leanTaskId: LeanTaskRef["id"];
  title: string;
  kind: CandidateProposalArtifact["proposalKind"];
  source: CandidateProposalArtifact["source"];
  target?: CandidateProposalArtifact["target"];
  summary: string;
  theoremSummary: string;
  leanCode: string;
  confidence: number;
  score: number;
  priority: number;
  request: LeanTaskRef["request"];
  translation: LeanTranslationResult;
  dispatch: LeanDispatchReceipt;
  verification: LeanVerificationResult;
  attempt: LeanProofAttemptRecord;
  boundaryOutcome: AdjunctorLeanBoundaryOutcome;
  promotionDecision: "promote" | "hold" | "discard";
  verifierProviderId: string;
  projectionDivergence: number;
  outcome: ProposalOutcomeState;
  promptSelections: {
    mutation?: PromptSelectionSummary;
    formalization?: PromptSelectionSummary;
    critique?: PromptSelectionSummary;
    lean?: PromptSelectionSummary;
  };
  dialecticMoves: DialecticMove[];
  controlFeatures: ControlFeatureMetrics;
  decCompatibility: DecCompatibilityMetrics;
  refinementFeatures: RefinementFeatureMetrics;
}

interface OrchestrationWorkspace {
  traceId: AdjunctorTraceId;
  neighborhood: FragmentNeighborhoodSnapshot;
  mutationResult: GenerateLocalProposalsResult;
  mutationCandidateIndex: Partial<Record<CandidateProposalId, CandidateProposalArtifact>>;
  critiqueResult: CritiqueProposalResult;
  formalizationResults: Partial<Record<CandidateProposalId, RewriteForFormalizationResult>>;
  mutationCandidates: CandidateProposalArtifact[];
  synthesisCandidates: CandidateProposalArtifact[];
  critique: CritiquePayload;
  rankedCandidates: RankedCandidateRecord[];
  selectedCandidates: RankedCandidateRecord[];
  promptSelections: {
    mutation?: PromptSelectionSummary;
    formalization: Partial<Record<CandidateProposalId, PromptSelectionSummary>>;
    critique?: PromptSelectionSummary;
  };
}

interface SimulationTickOptions {
  semeioticPromiseInfluenceEnabled?: boolean;
  semeioticAnnotationEnabled?: boolean;
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

function asReplayId(value: string) {
  return `replay_event_${value}` as const;
}

function clampUnit(value: number) {
  return Math.min(0.99, Math.max(0.05, Number(value.toFixed(2))));
}

function makeTraceId(fragmentId: FragmentId, tick: number) {
  return `adjunctor_trace_${fragmentId.replace("fragment_", "")}_tick_${tick}` as AdjunctorTraceId;
}

function makeTaskId(traceId: AdjunctorTraceId, suffix: string) {
  return `adjunctor_task_${traceId.replace("adjunctor_trace_", "")}_${suffix}` as AdjunctorTaskId;
}

function semanticProposalIdFor(candidateId: CandidateProposalId) {
  return `semantic_proposal_${candidateId.replace("candidate_", "")}` as SemanticProposalId;
}

function leanTaskIdFor(candidateId: CandidateProposalId) {
  return `lean_task_${candidateId.replace("candidate_", "")}` as LeanTaskRef["id"];
}

function orderedFragmentIds(simulation: SimulationState): FragmentId[] {
  return Object.values(simulation.fragments)
    .sort((left, right) => {
      if (left.generationDepth !== right.generationDepth) {
        return left.generationDepth - right.generationDepth;
      }
      return left.id.localeCompare(right.id);
    })
    .map((fragment) => fragment.id);
}

function cloneSimulation(simulation: SimulationState): SimulationState {
  return {
    ...simulation,
    persistentConfig: { ...simulation.persistentConfig },
    persistent: {
      ...simulation.persistent,
      promotedFragmentIds: [...simulation.persistent.promotedFragmentIds],
      promotedProposalIds: [...simulation.persistent.promotedProposalIds],
      keptPromisingProposalIds: [...simulation.persistent.keptPromisingProposalIds],
      acceptedConnectionIds: [...simulation.persistent.acceptedConnectionIds],
      acceptedEdgeIds: [...simulation.persistent.acceptedEdgeIds],
      theoremStubs: [...simulation.persistent.theoremStubs],
      definitionStubs: [...simulation.persistent.definitionStubs],
    },
    fragments: { ...simulation.fragments },
    exposedConnections: { ...simulation.exposedConnections },
    edges: { ...simulation.edges },
    proposals: { ...simulation.proposals },
    leanTasks: { ...simulation.leanTasks },
    proofAttempts: { ...simulation.proofAttempts },
    proposalQueue: [...simulation.proposalQueue],
    acceptedHistory: [...simulation.acceptedHistory],
    rejectedHistory: [...simulation.rejectedHistory],
    replayLog: [...simulation.replayLog],
  };
}

function appendReplayEvent(simulation: SimulationState, event: ReplayLogEntry) {
  simulation.replayLog.push(event);
  simulation.replayLog = simulation.replayLog.slice(-REPLAY_LOG_LIMIT);
}

function appendHistory(history: ProposalOutcomeRecord[], record: ProposalOutcomeRecord) {
  if (history.some((entry) => entry.proposalId === record.proposalId && entry.outcome === record.outcome)) {
    return history;
  }
  return [...history, record];
}

function withUniqueProposalIds(proposalIds: SemanticProposalId[]) {
  return Array.from(new Set(proposalIds));
}

function withUniqueFragmentIds(fragmentIds: FragmentId[]) {
  return Array.from(new Set(fragmentIds));
}

function withUniqueConnectionIds(connectionIds: SimulationState["persistent"]["acceptedConnectionIds"]) {
  return Array.from(new Set(connectionIds));
}

function withUniqueEdgeIds(edgeIds: SimulationState["persistent"]["acceptedEdgeIds"]) {
  return Array.from(new Set(edgeIds));
}

function stubBucketForProposal(proposal: SemanticProposal) {
  return proposal.proposalKind === "candidate_theorem" || proposal.proposalKind === "bridge_lemma"
    ? "theoremStubs"
    : "definitionStubs";
}

function stubKindForProposal(proposal: SemanticProposal): PersistentSemanticStub["kind"] {
  switch (proposal.proposalKind) {
    case "candidate_definition":
      return "definition";
    case "candidate_theorem":
    case "bridge_lemma":
      return "theorem";
    default:
      return "relation";
  }
}

function createPersistentStub(
  proposal: SemanticProposal,
  layer: PersistentSemanticStub["layer"],
  promotedAtTick: number,
): PersistentSemanticStub {
  return {
    id: `persistent_stub_${proposal.id.replace("semantic_proposal_", "")}` as const,
    proposalId: proposal.id,
    fragmentId: proposal.fragmentId,
    kind: stubKindForProposal(proposal),
    title: proposal.title,
    summary: proposal.theoremSummary,
    leanSnippet: proposal.mockLeanCode,
    promotedAtTick,
    layer,
  };
}

function upsertPersistentStub(
  simulation: SimulationState,
  proposal: SemanticProposal,
  layer: PersistentSemanticStub["layer"],
  promotedAtTick: number,
) {
  const stub = createPersistentStub(proposal, layer, promotedAtTick);
  const bucket = stubBucketForProposal(proposal);
  const existingBucket = simulation.persistent[bucket];
  simulation.persistent[bucket] = [
    ...existingBucket.filter((existingStub) => existingStub.id !== stub.id),
    stub,
  ].sort((left, right) => left.promotedAtTick - right.promotedAtTick);
}

function markPersistentEdges(
  simulation: SimulationState,
  edgeIds: Iterable<LocalGraphEdge["id"]>,
  status: LocalGraphEdge["status"],
  kind?: LocalGraphEdge["kind"],
) {
  for (const edgeId of edgeIds) {
    const edge = simulation.edges[edgeId];
    if (!edge) {
      continue;
    }
    simulation.edges[edgeId] = {
      ...edge,
      status,
      kind: kind ?? edge.kind,
    };
  }
}

function persistCanonicalStructure(
  simulation: SimulationState,
  fragmentId: FragmentId,
  proposalIds: SemanticProposalId[],
  neighborhood: ReturnType<typeof selectLocalGraphNeighborhood>,
  promotedAtTick: number,
) {
  const fragment = simulation.fragments[fragmentId];
  if (!fragment) {
    return;
  }

  simulation.persistent.promotedFragmentIds = withUniqueFragmentIds([
    ...simulation.persistent.promotedFragmentIds,
    fragmentId,
  ]);
  simulation.persistent.promotedProposalIds = withUniqueProposalIds([
    ...simulation.persistent.promotedProposalIds,
    ...proposalIds,
  ]);
  simulation.persistent.acceptedConnectionIds = withUniqueConnectionIds([
    ...simulation.persistent.acceptedConnectionIds,
    ...fragment.newlyExposedConnectionIds,
  ]);
  simulation.persistent.acceptedEdgeIds = withUniqueEdgeIds([
    ...simulation.persistent.acceptedEdgeIds,
    ...fragment.edgeIds,
    ...Array.from(neighborhood.edgeIds),
  ]);

  markPersistentEdges(simulation, neighborhood.edgeIds, "accepted", "persistent_relation");

  for (const proposalId of proposalIds) {
    const proposal = simulation.proposals[proposalId];
    if (!proposal) {
      continue;
    }
    upsertPersistentStub(simulation, proposal, "canonical", promotedAtTick);
  }
}

function persistHoldingStructure(
  simulation: SimulationState,
  proposalIds: SemanticProposalId[],
  promotedAtTick: number,
  fragmentId?: FragmentId,
) {
  if (fragmentId) {
    simulation.persistent.promotedFragmentIds = withUniqueFragmentIds([
      ...simulation.persistent.promotedFragmentIds,
      fragmentId,
    ]);
  }

  simulation.persistent.keptPromisingProposalIds = withUniqueProposalIds([
    ...simulation.persistent.keptPromisingProposalIds,
    ...proposalIds,
  ]);

  for (const proposalId of proposalIds) {
    const proposal = simulation.proposals[proposalId];
    if (!proposal) {
      continue;
    }
    upsertPersistentStub(simulation, proposal, "holding", promotedAtTick);
  }
}

function setFragmentBoundaryStatus(
  simulation: SimulationState,
  fragmentId: FragmentId,
  status: LocalGraphEdge["status"],
) {
  const fragment = simulation.fragments[fragmentId];
  if (!fragment) {
    return;
  }

  for (const edgeId of fragment.edgeIds) {
    const edge = simulation.edges[edgeId];
    if (edge) {
      simulation.edges[edgeId] = { ...edge, status };
    }
  }
}

function setNeighborhoodEdgeStatus(
  simulation: SimulationState,
  neighborhood: ReturnType<typeof selectLocalGraphNeighborhood>,
  status: LocalGraphEdge["status"],
) {
  for (const edgeId of neighborhood.edgeIds) {
    const edge = simulation.edges[edgeId];
    if (!edge || edge.kind === "fragment_boundary") {
      continue;
    }
    simulation.edges[edgeId] = { ...edge, status };
  }
}

function fragmentProposalVacuityPenalty(proposal: SemanticProposal) {
  switch (proposal.verificationState) {
    case "vacuous":
      return 0.7;
    case "rejected":
      return 0.35;
    default:
      return 0;
  }
}

function fragmentProposalInstabilityPenalty(proposal: SemanticProposal) {
  switch (proposal.verificationState) {
    case "blocked":
      return 0.55;
    case "rejected":
      return 0.72;
    case "promising":
      return 0.18;
    case "pending":
      return 0.12;
    case "accepted":
      return 0.06;
    case "vacuous":
      return 0.22;
    default:
      return 0.1;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function projectionDivergenceForOutcome(outcome: ProposalOutcomeState) {
  switch (outcome) {
    case "accepted":
      return 0;
    case "blocked":
      return 0.48;
    case "promising":
      return 0.14;
    case "vacuous":
      return 0.26;
    case "rejected":
      return 0.82;
    case "pending":
    default:
      return 0.18;
  }
}

function projectionDivergenceForProposal(proposal?: SemanticProposal) {
  if (!proposal) {
    return undefined;
  }

  const payload = asRecord(proposal.payload);
  const orchestration = asRecord(payload?.orchestration);
  const leanBoundary = asRecord(orchestration?.leanBoundary);
  if (typeof leanBoundary?.projectionDivergence === "number") {
    return leanBoundary.projectionDivergence;
  }

  return projectionDivergenceForOutcome(proposal.verificationState);
}

function latestFragmentProposal(fragment: TriangleFragment, simulation: SimulationState) {
  return fragment.activeProposalIds
    .map((proposalId) => simulation.proposals[proposalId])
    .filter((proposal): proposal is SemanticProposal => Boolean(proposal))
    .sort(
      (left, right) => right.updatedAtTick - left.updatedAtTick || right.createdAtTick - left.createdAtTick || left.id.localeCompare(right.id),
    )[0];
}

function fieldWithProjection(
  field: NegAdjunctionField,
  projectionDivergence: number,
): NegAdjunctionField {
  const projection = Number(Math.max(0, projectionDivergence).toFixed(6));
  return {
    ...field,
    projection,
    projectionDivergence: projection,
    total: Number((field.forward + field.reverse + projection).toFixed(6)),
  };
}

function phasePlan(candidatePlans: OrchestratedProposalPlan[]) {
  return [...candidatePlans].sort((left, right) => {
    const outcomePriority = (plan: OrchestratedProposalPlan) =>
      plan.outcome === "accepted"
        ? 4
        : plan.outcome === "promising"
          ? 3
          : plan.outcome === "blocked"
            ? 2
            : plan.outcome === "rejected"
              ? 1
              : 0;

    const outcomeDelta = outcomePriority(right) - outcomePriority(left);
    if (outcomeDelta !== 0) {
      return outcomeDelta;
    }

    const productiveDelta = right.productiveScore - left.productiveScore;
    if (Math.abs(productiveDelta) > 0.0001) {
      return productiveDelta;
    }

    return right.combinedScore - left.combinedScore;
  })[0];
}

function eventMetricsPayload(field: NegAdjunctionField, phase: TriangleFragment["phase"]) {
  return {
    forward: field.forward,
    reverse: field.reverse,
    asymmetry: field.asymmetry,
    curvature: field.curvature,
    projection: field.projection,
    phase,
  };
}

function fallbackEventMetricsPayload(phase: TriangleFragment["phase"]) {
  return eventMetricsPayload(
    {
      forward: 0,
      reverse: 0,
      asymmetry: 0,
      curvature: 0,
      projection: 0,
      projectionDivergence: 0,
      total: 0,
    },
    phase,
  );
}

function jsonPromptSelection(selection?: PromptSelectionSummary) {
  if (!selection) {
    return undefined;
  }

  const output: JsonObject = {
    promptVariants: selection.promptVariants.map((variant) => ({
      id: variant.id,
      prompt: variant.prompt,
      chartDivergence: variant.chartDivergence,
    })),
    promptScores: selection.promptScores.map((score) => ({
      id: score.id,
      prompt: score.prompt,
      inputDivergence: score.inputDivergence,
      outputDivergence: score.outputDivergence,
    })),
  };

  if (selection.bestPromptId !== undefined) {
    output.bestPromptId = selection.bestPromptId;
  }
  if (selection.bestPrompt !== undefined) {
    output.bestPrompt = selection.bestPrompt;
  }
  if (selection.bestInputDivergence !== undefined) {
    output.bestInputDivergence = selection.bestInputDivergence;
  }
  if (selection.bestOutputDivergence !== undefined) {
    output.bestOutputDivergence = selection.bestOutputDivergence;
  }

  return output;
}

function jsonPromptSelectionMap(plan: OrchestratedProposalPlan["promptSelections"]) {
  const output: JsonObject = {};
  const mutation = jsonPromptSelection(plan.mutation);
  const formalization = jsonPromptSelection(plan.formalization);
  const critique = jsonPromptSelection(plan.critique);
  const lean = jsonPromptSelection(plan.lean);

  if (mutation) {
    output.mutation = mutation;
  }
  if (formalization) {
    output.formalization = formalization;
  }
  if (critique) {
    output.critique = critique;
  }
  if (lean) {
    output.lean = lean;
  }

  return output;
}

function eventMetricsForFragment(fragment: TriangleFragment, simulation: SimulationState) {
  const proposal = latestFragmentProposal(fragment, simulation);
  const payload = asRecord(proposal?.payload);
  const orchestration = asRecord(payload?.orchestration);
  const divergenceField = asRecord(orchestration?.divergenceField);
  if (
    typeof divergenceField?.forward === "number" &&
    typeof divergenceField?.reverse === "number" &&
    typeof divergenceField?.asymmetry === "number" &&
    typeof divergenceField?.curvature === "number"
  ) {
    return eventMetricsPayload(
      fieldWithProjection(
        {
          forward: divergenceField.forward,
          reverse: divergenceField.reverse,
          asymmetry: divergenceField.asymmetry,
          curvature: divergenceField.curvature,
          projection: typeof divergenceField.projection === "number" ? divergenceField.projection : 0,
          projectionDivergence:
            typeof divergenceField.projectionDivergence === "number" ? divergenceField.projectionDivergence : 0,
          total: typeof divergenceField.total === "number" ? divergenceField.total : 0,
        },
        projectionDivergenceForProposal(proposal) ?? 0,
      ),
      fragment.phase,
    );
  }

  return fallbackEventMetricsPayload(fragment.phase);
}

function eventMetricsForPlan(plan: OrchestratedProposalPlan, phase: TriangleFragment["phase"]) {
  return eventMetricsPayload(fieldWithProjection(plan.divergenceField, plan.projectionDivergence), phase);
}

function computeFragmentPhase(
  fragment: TriangleFragment,
  simulation: SimulationState,
  candidatePlans: OrchestratedProposalPlan[],
) {
  const plan = phasePlan(candidatePlans);
  if (!plan) {
    return fragment.phase;
  }

  const previousProjection = projectionDivergenceForProposal(latestFragmentProposal(fragment, simulation));
  return computePhase({
    field: fieldWithProjection(plan.divergenceField, plan.projectionDivergence),
    previousProjection,
  });
}

function computeFragmentCatastrophe(
  fragment: TriangleFragment,
  simulation: SimulationState,
  candidatePlans: OrchestratedProposalPlan[],
) {
  const plan = phasePlan(candidatePlans);
  if (!plan) {
    return {
      catastrophe: fragment.catastrophe,
      catastropheScore: fragment.catastropheScore,
    };
  }

  const field = fieldWithProjection(plan.divergenceField, plan.projectionDivergence);
  const catastrophe = computeCatastropheApproximation(field);
  return {
    catastrophe: catastrophe.active,
    catastropheScore: catastrophe.score,
  };
}

type PetalDirection = "north" | "east" | "south" | "west";

const PETAL_DIRECTIONS: PetalDirection[] = ["north", "east", "south", "west"];

function fragmentRadius(fragment: TriangleFragment, simulation: SimulationState) {
  const points = fragment.vertexIds.map((vertexId) => simulation.vertices[vertexId].point);
  return Math.max(
    ...points.map((point) => Math.hypot(point.x - fragment.centroid.x, point.y - fragment.centroid.y)),
  );
}

function pointForDirection(center: Point2D, direction: PetalDirection, radial: number, lateral = 0) {
  switch (direction) {
    case "north":
      return { x: center.x + lateral, y: center.y - radial };
    case "east":
      return { x: center.x + radial, y: center.y + lateral };
    case "south":
      return { x: center.x + lateral, y: center.y + radial };
    case "west":
    default:
      return { x: center.x - radial, y: center.y + lateral };
  }
}

function petalTone(direction: PetalDirection) {
  return direction === "north" || direction === "east" ? "white" : "black";
}

function baseStatusForPetal(direction: PetalDirection): FragmentLifecycleStatus {
  return petalTone(direction) === "white" ? "active" : "blocked";
}

function basePhaseForPetal(direction: PetalDirection): TriangleFragment["phase"] {
  return petalTone(direction) === "white" ? "stabilized" : "latent";
}

function createPetalTrianglePoints(
  fragment: TriangleFragment,
  simulation: SimulationState,
  direction: PetalDirection,
) {
  const radius = fragmentRadius(fragment, simulation);
  const tipDistance = radius * 0.78;
  const shoulderDistance = radius * 0.32;
  const breadth = radius * 0.28;

  return {
    anchor: pointForDirection(fragment.centroid, direction, tipDistance),
    left:
      direction === "north" || direction === "south"
        ? pointForDirection(fragment.centroid, direction, shoulderDistance, -breadth)
        : pointForDirection(fragment.centroid, direction, shoulderDistance, -breadth),
    right:
      direction === "north" || direction === "south"
        ? pointForDirection(fragment.centroid, direction, shoulderDistance, breadth)
        : pointForDirection(fragment.centroid, direction, shoulderDistance, breadth),
  };
}

function centroidForTriangle(points: [Point2D, Point2D, Point2D]): Point2D {
  return {
    x: (points[0].x + points[1].x + points[2].x) / 3,
    y: (points[0].y + points[1].y + points[2].y) / 3,
  };
}

function createPetalFragmentId(parentFragmentId: FragmentId, direction: PetalDirection) {
  return `${parentFragmentId}_petal_${direction}` as FragmentId;
}

function createPetalVertexId(parentFragmentId: FragmentId, direction: PetalDirection, role: string) {
  return `fragment_vertex_${parentFragmentId.replace("fragment_", "")}_petal_${direction}_${role}` as FragmentVertexId;
}

function createPetalConnectionId(parentFragmentId: FragmentId, direction: PetalDirection, side: "a" | "b") {
  return `exposed_connection_${parentFragmentId.replace("fragment_", "")}_petal_${direction}_${side}` as ExposedConnectionId;
}

function createPetalEdgeId(parentFragmentId: FragmentId, direction: PetalDirection, label: string) {
  return `local_edge_${parentFragmentId.replace("fragment_", "")}_petal_${direction}_${label}` as LocalGraphEdgeId;
}

function connectPetalAnchors(
  simulation: SimulationState,
  parentFragmentId: FragmentId,
  petalFragmentIds: FragmentId[],
) {
  for (let index = 0; index < petalFragmentIds.length; index += 1) {
    const current = simulation.fragments[petalFragmentIds[index]];
    const next = simulation.fragments[petalFragmentIds[(index + 1) % petalFragmentIds.length]];
    if (!current || !next) {
      continue;
    }

    const edgeId = createPetalEdgeId(parentFragmentId, PETAL_DIRECTIONS[index], `ring_${(index + 1) % petalFragmentIds.length}`);
    if (simulation.edges[edgeId]) {
      continue;
    }

    simulation.edges[edgeId] = {
      id: edgeId,
      fragmentId: current.id,
      sourceVertexId: current.inheritedAnchor,
      targetVertexId: next.inheritedAnchor,
      kind: "semantic_relation",
      status: "highlighted",
      weight: 1.08,
      label: `${current.labels.short} petal bridge`,
    };
  }
}

function externalizeFragmentIntoPetals(
  simulation: SimulationState,
  fragment: TriangleFragment,
  tick: number,
) {
  if (fragment.childFragmentIds.length >= PETAL_DIRECTIONS.length) {
    return {
      fragmentIds: fragment.childFragmentIds,
      primaryFragmentId: fragment.childFragmentIds[0],
      primaryProposalId: simulation.fragments[fragment.childFragmentIds[0]]?.activeProposalIds[0],
    };
  }

  const parentConnectionVertexIds = fragment.newlyExposedConnectionIds.map(
    (connectionId) => simulation.exposedConnections[connectionId]?.vertexId ?? fragment.inheritedAnchor,
  );
  const parentProposal = latestFragmentProposal(fragment, simulation);
  const childFragmentIds: FragmentId[] = [];
  const displacedQueue = [...fragment.childFragmentIds];

  while (displacedQueue.length > 0) {
    const displacedId = displacedQueue.shift();
    if (!displacedId) {
      continue;
    }

    const displacedFragment = simulation.fragments[displacedId];
    if (!displacedFragment || displacedFragment.status === "archived") {
      continue;
    }

    simulation.fragments[displacedId] = {
      ...displacedFragment,
      status: "archived",
    };
    displacedQueue.push(...displacedFragment.childFragmentIds);
  }

  for (const direction of PETAL_DIRECTIONS) {
    const childFragmentId = createPetalFragmentId(fragment.id, direction);
    const points = createPetalTrianglePoints(fragment, simulation, direction);
    const anchorVertexId = createPetalVertexId(fragment.id, direction, "anchor");
    const leftVertexId = createPetalVertexId(fragment.id, direction, "left");
    const rightVertexId = createPetalVertexId(fragment.id, direction, "right");
    const connectionAId = createPetalConnectionId(fragment.id, direction, "a");
    const connectionBId = createPetalConnectionId(fragment.id, direction, "b");
    const edgeIds: [LocalGraphEdgeId, LocalGraphEdgeId, LocalGraphEdgeId] = [
      createPetalEdgeId(fragment.id, direction, "anchor_left"),
      createPetalEdgeId(fragment.id, direction, "anchor_right"),
      createPetalEdgeId(fragment.id, direction, "base"),
    ];
    const status = baseStatusForPetal(direction);
    const phase = basePhaseForPetal(direction);
    const tone = petalTone(direction);
    const centroid = centroidForTriangle([points.anchor, points.left, points.right]);
    const childProposalId = `semantic_proposal_${childFragmentId.replace("fragment_", "")}` as SemanticProposalId;

    simulation.vertices[anchorVertexId] = {
      id: anchorVertexId,
      fragmentId: childFragmentId,
      point: points.anchor,
      role: "anchor",
      occupancy: "claimed",
      label: `${fragment.labels.short} ${direction} anchor`,
      exposedConnectionIds: [],
      incidentEdgeIds: [...edgeIds],
      semanticTags: ["petal", direction, tone, "anchor"],
      ...resolveStatisticalEmbeddingState({
        key: `${childFragmentId}:anchor`,
        existing: fragment,
      }),
    };

    simulation.vertices[leftVertexId] = {
      id: leftVertexId,
      fragmentId: childFragmentId,
      point: points.left,
      role: "internal",
      occupancy: "shared",
      label: `${fragment.labels.short} ${direction} left`,
      exposedConnectionIds: [connectionAId],
      incidentEdgeIds: [edgeIds[0], edgeIds[2]],
      semanticTags: ["petal", direction, tone, "left"],
      ...resolveStatisticalEmbeddingState({
        key: `${childFragmentId}:left`,
        existing: fragment,
      }),
    };

    simulation.vertices[rightVertexId] = {
      id: rightVertexId,
      fragmentId: childFragmentId,
      point: points.right,
      role: "internal",
      occupancy: "shared",
      label: `${fragment.labels.short} ${direction} right`,
      exposedConnectionIds: [connectionBId],
      incidentEdgeIds: [edgeIds[1], edgeIds[2]],
      semanticTags: ["petal", direction, tone, "right"],
      ...resolveStatisticalEmbeddingState({
        key: `${childFragmentId}:right`,
        existing: fragment,
      }),
    };

    simulation.edges[edgeIds[0]] = {
      id: edgeIds[0],
      fragmentId: childFragmentId,
      sourceVertexId: anchorVertexId,
      targetVertexId: leftVertexId,
      kind: "fragment_boundary",
      status: tone === "white" ? "accepted" : "blocked",
      weight: 0.96,
      label: `${fragment.labels.short} ${direction} seam A`,
    };
    simulation.edges[edgeIds[1]] = {
      id: edgeIds[1],
      fragmentId: childFragmentId,
      sourceVertexId: anchorVertexId,
      targetVertexId: rightVertexId,
      kind: "fragment_boundary",
      status: tone === "white" ? "accepted" : "blocked",
      weight: 0.96,
      label: `${fragment.labels.short} ${direction} seam B`,
    };
    simulation.edges[edgeIds[2]] = {
      id: edgeIds[2],
      fragmentId: childFragmentId,
      sourceVertexId: leftVertexId,
      targetVertexId: rightVertexId,
      kind: "fragment_boundary",
      status: tone === "white" ? "accepted" : "blocked",
      weight: 1.02,
      label: `${fragment.labels.short} ${direction} petal base`,
    };

    simulation.edges[createPetalEdgeId(fragment.id, direction, "parent_bridge")] = {
      id: createPetalEdgeId(fragment.id, direction, "parent_bridge"),
      fragmentId: childFragmentId,
      sourceVertexId: anchorVertexId,
      targetVertexId: fragment.inheritedAnchor,
      kind: "semantic_relation",
      status: "highlighted",
      weight: 1.12,
      label: `${fragment.labels.short} ${direction} inherited bridge`,
    };

    simulation.exposedConnections[connectionAId] = {
      id: connectionAId,
      fragmentId: childFragmentId,
      vertexId: leftVertexId,
      kind: tone === "white" ? "persistent_bridge" : "candidate_bridge",
      status: tone === "white" ? "engaged" : "available",
      label: `${fragment.labels.short} ${direction} interface A`,
      connectedToVertexId: parentConnectionVertexIds[0],
      semanticHint: `Inherited from ${fragment.labels.short}.`,
    };
    simulation.exposedConnections[connectionBId] = {
      id: connectionBId,
      fragmentId: childFragmentId,
      vertexId: rightVertexId,
      kind: tone === "white" ? "persistent_bridge" : "candidate_bridge",
      status: tone === "white" ? "engaged" : "available",
      label: `${fragment.labels.short} ${direction} interface B`,
      connectedToVertexId: parentConnectionVertexIds[1],
      semanticHint: `Inherited from ${fragment.labels.short}.`,
    };

    simulation.proposals[childProposalId] = {
      id: childProposalId,
      fragmentId: childFragmentId,
      title: `${fragment.labels.short} ${direction} petal`,
      proposalKind: parentProposal?.proposalKind ?? "refinement_law",
      source: { entityType: "vertex", vertexId: leftVertexId },
      target: { entityType: "vertex", vertexId: rightVertexId },
      naturalLanguageSummary: `${fragment.labels.short} externalized into a ${direction} petal inheriting the parent seam geometry.`,
      theoremSummary: `${fragment.labels.short} ${direction} petal inherits the parent externalization boundary.`,
      mockLeanCode: parentProposal?.mockLeanCode ?? `theorem ${childFragmentId.replace("fragment_", "")}_petal : FragmentPetal := by\n  admit`,
      verificationState: "pending",
      confidence: parentProposal?.confidence ?? 0.54,
      score: parentProposal?.score ?? 0.5,
      priority: parentProposal?.priority ?? 0.56,
      createdAtTick: tick,
      updatedAtTick: tick,
      corpusSupport: parentProposal?.corpusSupport.map((support) => ({ ...support })) ?? [],
      payload: {
        inheritedFromFragmentId: fragment.id,
        inheritedFromProposalId: parentProposal?.id,
        petalDirection: direction,
        petalTone: tone,
      },
      ...resolveStatisticalEmbeddingState({
        key: `${childProposalId}:${direction}`,
        existing: parentProposal ?? fragment,
      }),
    };

    simulation.fragments[childFragmentId] = {
      id: childFragmentId,
      generationDepth: fragment.generationDepth + 1,
      parentFragmentId: fragment.id,
      childFragmentIds: [],
      inheritedAnchor: anchorVertexId,
      newlyExposedConnectionIds: [connectionAId, connectionBId],
      position: centroid,
      centroid,
      vertexIds: [anchorVertexId, leftVertexId, rightVertexId],
      edgeIds,
      status,
      phase,
      catastrophe: false,
      catastropheScore: 0,
      labels: {
        short: `${fragment.labels.short}-${direction[0].toUpperCase()}`,
        title: `${fragment.labels.title ?? fragment.labels.short} ${direction} petal`,
        semantic: `${direction} petal / ${tone}`,
        theorem: undefined,
        definition: undefined,
        tags: [...fragment.labels.tags, "petal-child", `petal-${direction}`, `petal-${tone}`],
      },
      semanticPayload: {
        ...fragment.semanticPayload,
        summary: `${fragment.labels.short} externalized into a ${direction} petal node.`,
        keywords: Array.from(new Set([...fragment.semanticPayload.keywords, "petal", direction, tone])),
        notes: `Inherited from ${fragment.labels.short} during externalization at tick ${tick}.`,
      },
      promotion: {
        fragmentId: childFragmentId,
        isPersistent: tone === "white",
        promotedAtTick: tone === "white" ? tick : undefined,
        layer: tone === "white" ? "candidate" : "frontier",
        reason: fragment.promotion.reason,
        acceptedProposalIds: tone === "white" ? [childProposalId] : [],
      },
      activeProposalIds: [childProposalId],
      ...resolveStatisticalEmbeddingState({
        key: `${childFragmentId}:${direction}`,
        existing: fragment,
      }),
    };

    childFragmentIds.push(childFragmentId);
  }

  connectPetalAnchors(simulation, fragment.id, childFragmentIds);

  simulation.fragments[fragment.id] = {
    ...simulation.fragments[fragment.id],
    status: "archived",
    childFragmentIds,
    phase: "externalized",
  };

  return {
    fragmentIds: childFragmentIds,
    primaryFragmentId: childFragmentIds[0],
    primaryProposalId: simulation.fragments[childFragmentIds[0]]?.activeProposalIds[0],
  };
}

function fragmentProductiveDivergenceScore(fragment: TriangleFragment, simulation: SimulationState) {
  const fragmentPoint = { theta: fragment.theta, eta: fragment.eta };
  const proposalEmbeddings = fragment.activeProposalIds
    .map((proposalId) => simulation.proposals[proposalId])
    .filter((proposal): proposal is SemanticProposal => Boolean(proposal))
    .map((proposal) => ({ embedding: proposal.embedding, theta: proposal.theta }));
  const curvature = computeEmbeddingCurvature(proposalEmbeddings);
  const proposalScores = fragment.activeProposalIds
    .map((proposalId) => simulation.proposals[proposalId])
    .filter((proposal): proposal is SemanticProposal => Boolean(proposal))
    .map((proposal) => {
      const field = computeNegAdjunctionField({
        F: fragmentPoint,
        G: { theta: proposal.theta, eta: proposal.eta },
      }, undefined, 0, curvature);
      return computeProductiveScore(
        field,
        fragmentProposalVacuityPenalty(proposal),
        fragmentProposalInstabilityPenalty(proposal),
      ) + Math.min(0.24, field.curvature * 0.35);
    });

  if (proposalScores.length > 0) {
    return Math.max(...proposalScores);
  }

  const neighborScores = findNeighboringFragments(simulation, fragment.id)
    .map((neighborId) => simulation.fragments[neighborId])
    .filter((neighbor): neighbor is TriangleFragment => Boolean(neighbor))
    .map((neighbor) =>
      computeProductiveScore(
        computeNegAdjunctionField({
          F: fragmentPoint,
          G: { theta: neighbor.theta, eta: neighbor.eta },
        }, undefined, 0, curvature),
      ) + Math.min(0.24, curvature * 0.35),
    );

  return neighborScores.length > 0 ? Math.max(...neighborScores) : 0;
}

function chooseActiveFragment(simulation: SimulationState, tick: number) {
  const candidates = orderedFragmentIds(simulation)
    .map((fragmentId) => simulation.fragments[fragmentId])
    .filter((fragment) => fragment.status !== "archived");

  if (candidates.length === 0) {
    return undefined;
  }

  return [...candidates]
    .sort((left, right) => {
      const weightDelta =
        fragmentProductiveDivergenceScore(right, simulation) -
        fragmentProductiveDivergenceScore(left, simulation);
      if (Math.abs(weightDelta) > 0.0001) {
        return weightDelta;
      }
      if (left.generationDepth !== right.generationDepth) {
        return left.generationDepth - right.generationDepth;
      }
      return left.id.localeCompare(right.id);
    })[0]?.id;
}

function inspectFragment(simulation: SimulationState, fragmentId: FragmentId): FragmentInspection | undefined {
  const fragment = simulation.fragments[fragmentId];
  if (!fragment) {
    return undefined;
  }

  return {
    fragment,
    neighbors: findNeighboringFragments(simulation, fragmentId),
    exposedPoints: findExposedConnectionPoints(simulation, fragmentId),
    neighborhood: selectLocalGraphNeighborhood(simulation, fragmentId, 1),
  };
}

function proposalKindLabel(kind: CandidateProposalArtifact["proposalKind"]) {
  return kind.replaceAll("_", " ");
}

function buildNeighborhoodSnapshot(
  simulation: SimulationState,
  inspection: FragmentInspection,
): FragmentNeighborhoodSnapshot {
  const persistentFragmentSet = new Set(simulation.persistent.promotedFragmentIds);
  const neighborhoodFragmentIds = Array.from(inspection.neighborhood.fragmentIds);

  return {
    fragmentId: inspection.fragment.id,
    generationDepth: inspection.fragment.generationDepth,
    inheritedAnchorId: inspection.fragment.inheritedAnchor,
    centroid: inspection.fragment.centroid,
    exposedConnectionIds: [...inspection.fragment.newlyExposedConnectionIds],
    neighboringFragmentIds: inspection.neighbors,
    localEdgeIds: Array.from(inspection.neighborhood.edgeIds),
    persistentFragmentIds: neighborhoodFragmentIds.filter((fragmentId) => persistentFragmentSet.has(fragmentId)),
    activeProposalIds: [...inspection.fragment.activeProposalIds],
    semanticKeywords: [...inspection.fragment.semanticPayload.keywords],
    semanticSummary: inspection.fragment.semanticPayload.summary,
    decCompatibility: computeDecCompatibilityMetrics(simulation, inspection.fragment.id),
    controlFeatures: computeControlFeatureMetrics(simulation, inspection.fragment.id),
    refinementFeatures: computeRefinementFeatureMetrics(simulation, inspection.fragment.id),
    embedding: [...inspection.fragment.embedding],
    theta: [...inspection.fragment.theta],
    eta: [...inspection.fragment.eta],
  };
}

function resolveProviderOrThrow(registry: ProviderRegistry, task: AdjunctorProviderTask) {
  const match = registry.resolve(task)[0];
  if (!match) {
    throw new Error(`No provider available for task ${task.taskType}.`);
  }

  const provider = registry.get(match.providerId);
  if (!provider) {
    throw new Error(`Resolved provider ${match.providerId} is not registered.`);
  }

  return { provider, match };
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === "object" && value !== null && typeof (value as PromiseLike<unknown>).then === "function";
}

function executeTaskSync<TResult extends AdjunctorProviderResult>(
  registry: ProviderRegistry,
  task: AdjunctorProviderTask,
): { result: TResult; match: ProviderRouteMatch } {
  const { provider, match } = resolveProviderOrThrow(registry, task);
  const result = provider.execute(task as never);
  if (isPromiseLike(result)) {
    throw new Error(
      `Provider ${provider.id} returned an async result for ${task.taskType}. The current MVP orchestrator only supports synchronous mock execution.`,
    );
  }
  return {
    result: result as TResult,
    match,
  };
}

function mergeCandidatePools(...pools: CandidateProposalArtifact[][]) {
  const merged = new Map<CandidateProposalId, CandidateProposalArtifact>();
  for (const pool of pools) {
    for (const candidate of pool) {
      const existing = merged.get(candidate.candidateId);
      if (!existing) {
        merged.set(candidate.candidateId, candidate);
        continue;
      }

      merged.set(candidate.candidateId, {
        ...candidate,
        tags: Array.from(new Set([...existing.tags, ...candidate.tags])),
        provenance: [...existing.provenance, ...candidate.provenance],
        priority: Math.max(existing.priority, candidate.priority),
        score: Math.max(existing.score, candidate.score),
        confidence:
          candidate.confidence.overall >= existing.confidence.overall ? candidate.confidence : existing.confidence,
      });
    }
  }

  return Array.from(merged.values());
}

function selectFormalizationCandidates(
  candidates: CandidateProposalArtifact[],
  critique: CritiquePayload,
  neighborhood: FragmentNeighborhoodSnapshot,
) {
  const preferred = candidates.filter((candidate) => critique.preferredCandidateIds.includes(candidate.candidateId));
  return selectTopLocalCandidatesForFormalization(
    preferred.length > 0 ? preferred : candidates,
    neighborhood,
    MAX_FORMALIZATION_CANDIDATES,
  );
}

function formalizeCandidates(
  registry: ProviderRegistry,
  traceId: AdjunctorTraceId,
  tick: number,
  neighborhood: FragmentNeighborhoodSnapshot,
  candidates: CandidateProposalArtifact[],
  critique: CritiquePayload,
) {
  const rewrites = new Map<CandidateProposalId, RewriteForFormalizationResult>();
  const promptSelections = new Map<CandidateProposalId, PromptSelectionSummary>();
  const topCandidates = selectFormalizationCandidates(candidates, critique, neighborhood);

  for (const candidate of topCandidates) {
    const task = buildFormalizationTask({
      taskId: makeTaskId(traceId, `formalize_${candidate.candidateId.replace("candidate_", "")}`),
      traceId,
      requestedAtTick: tick,
      neighborhood,
      candidate,
      topCandidates,
      critique,
    });
    const execution = executePromptVariantTaskSync<RewriteForFormalizationResult>(registry, task);
    const result = execution.result;
    rewrites.set(candidate.candidateId, result);
    if (execution.promptSelection) {
      promptSelections.set(candidate.candidateId, execution.promptSelection);
    }
  }

  return {
    candidates: candidates.map((candidate) => {
      const rewrite = rewrites.get(candidate.candidateId);
      if (!rewrite) {
        return candidate;
      }
      const normalized = normalizeFormalizationResult(candidate, rewrite);
      const formal = clampUnit(candidate.confidence.formal + 0.14);
      const overall = clampUnit(
        formal * 0.4 + candidate.confidence.semantic * 0.35 + candidate.confidence.novelty * 0.25,
      );

      return {
        ...normalized,
        confidence: {
          ...candidate.confidence,
          formal,
          overall,
          rationale: Array.from(new Set([...candidate.confidence.rationale, ...rewrite.payload.translationNotes])),
        },
      };
    }),
    rewrites: Array.from(rewrites.values()),
    promptSelections,
  };
}

function collectCritiqueMessages(critique: CritiquePayload, candidateId: CandidateProposalId) {
  return critique.findings
    .filter((finding) => finding.affectedCandidateIds.includes(candidateId))
    .map((finding) => finding.message);
}

function buildRankedCandidates(
  candidates: CandidateProposalArtifact[],
  critique: CritiquePayload,
  neighborhood: FragmentNeighborhoodSnapshot,
  modelOutputSamples: Array<{ embedding?: number[]; theta: number[] }>,
  options?: SimulationTickOptions,
) {
  return synthesizeMultiModelCandidates(candidates, critique, neighborhood, modelOutputSamples, options).map((record) => ({
    candidate: record.candidate,
    divergenceField: record.divergenceField,
    promiseProfile: record.promiseProfile,
    productiveScore: record.productiveScore,
    vacuityPenalty: record.vacuityPenalty,
    instabilityPenalty: record.instabilityPenalty,
    combinedScore: record.combinedScore,
    mutationEnergy: record.mutationEnergy,
    formalizationStrength: record.formalizationStrength,
    critiquePressure: record.critiquePressure,
    architectureCentrality: record.architectureCentrality,
    criticPreferred: record.criticPreferred,
    criticBlocked: record.criticBlocked,
    critiqueFindings: collectCritiqueMessages(critique, record.candidate.candidateId),
    disagreementSignals: record.disagreementSignals,
    assessments: record.assessments,
    contributionSummary: record.contributionSummary,
  }));
}

function selectCandidatesForVerification(rankedCandidates: RankedCandidateRecord[]) {
  return selectRankedCandidatesForVerification(rankedCandidates, MAX_VERIFICATION_CANDIDATES);
}

function applyCompressionToPersistentStubs(
  simulation: SimulationState,
  proposalIds: SemanticProposalId[],
  compressedTitle: string,
  compressedSummary: string,
) {
  for (const bucket of ["theoremStubs", "definitionStubs"] as const) {
    simulation.persistent[bucket] = simulation.persistent[bucket].map((stub) =>
      proposalIds.includes(stub.proposalId)
        ? {
            ...stub,
            title: compressedTitle,
            summary: compressedSummary,
          }
        : stub,
    );
  }
}

function buildOrchestrationWorkspace(
  simulation: SimulationState,
  inspection: FragmentInspection,
  tick: number,
  registry: ProviderRegistry,
  options?: SimulationTickOptions,
): OrchestrationWorkspace {
  const traceId = makeTraceId(inspection.fragment.id, tick);
  const neighborhood = buildNeighborhoodSnapshot(simulation, inspection);

  const mutationTask = buildLocalMutationTask({
    taskId: makeTaskId(traceId, "local_mutations"),
    traceId,
    requestedAtTick: tick,
    neighborhood,
    maxCandidates: 5,
    seedSummary: inspection.fragment.semanticPayload.summary,
  });
  const mutationExecution = executePromptVariantTaskSync<GenerateLocalProposalsResult>(registry, mutationTask);
  const mutation = normalizeLocalMutationResult(mutationExecution.result);

  const topLocalCandidates = selectTopLocalCandidatesForFormalization(
    mutation.payload.candidates,
    neighborhood,
    MAX_FORMALIZATION_CANDIDATES,
  );

  const preCritique: CritiquePayload = {
    targetCandidateId: undefined,
    assessment: "interesting",
    ambiguityFlags: [],
    findings: [],
    contrastiveExpansions: [],
    preferredCandidateIds: topLocalCandidates.map((candidate) => candidate.candidateId) as CandidateProposalId[],
    blockedCandidateIds: [],
    critiqueSummary: "Pre-critique routing context for formalization.",
  };

  const formalization = formalizeCandidates(
    registry,
    traceId,
    tick,
    neighborhood,
    topLocalCandidates,
    preCritique,
  );
  const formalizedCandidates = formalization.candidates;

  const critiqueTask = buildCritiqueTask({
    taskId: makeTaskId(traceId, "critique"),
    traceId,
    requestedAtTick: tick,
    neighborhood,
    candidates: formalizedCandidates,
  });
  const critiqueExecution = executePromptVariantTaskSync<CritiqueProposalResult>(registry, critiqueTask);
  const critique = normalizeCritiqueResult(critiqueExecution.result);
  const modelOutputSamples = [
    { embedding: mutation.embedding, theta: mutation.theta },
    { embedding: critique.embedding, theta: critique.theta },
    ...formalization.rewrites.map((rewrite) => ({ embedding: rewrite.embedding, theta: rewrite.theta })),
  ];

  const rankedCandidates = buildRankedCandidates(
    formalizedCandidates,
    critique.payload,
    neighborhood,
    modelOutputSamples,
    options,
  );
  const mutationCandidateIndex = Object.fromEntries(
    mutation.payload.candidates.map((candidate) => [candidate.candidateId, candidate]),
  ) as Partial<Record<CandidateProposalId, CandidateProposalArtifact>>;
  const formalizationResults = Object.fromEntries(
    formalization.rewrites.map((rewrite) => [rewrite.payload.candidate.candidateId, rewrite]),
  ) as Partial<Record<CandidateProposalId, RewriteForFormalizationResult>>;

  return {
    traceId,
    neighborhood,
    mutationResult: mutation,
    mutationCandidateIndex,
    critiqueResult: critique,
    formalizationResults,
    mutationCandidates: mutation.payload.candidates,
    synthesisCandidates: formalizedCandidates,
    critique: critique.payload,
    rankedCandidates,
    selectedCandidates: selectCandidatesForVerification(rankedCandidates),
    promptSelections: {
      mutation: mutationExecution.promptSelection,
      formalization: Object.fromEntries(formalization.promptSelections),
      critique: critiqueExecution.promptSelection,
    },
  };
}

function buildCandidatePlans(
  simulation: SimulationState,
  inspection: FragmentInspection,
  tick: number,
  registry: ProviderRegistry = defaultMockProviderRegistry,
  options?: SimulationTickOptions,
): OrchestratedProposalPlan[] {
  const workspace = buildOrchestrationWorkspace(simulation, inspection, tick, registry, options);

  return workspace.selectedCandidates.map((candidateRecord) => {
    const scoredCandidate: CandidateProposalArtifact = {
      ...candidateRecord.candidate,
      score: candidateRecord.combinedScore,
      priority: candidateRecord.productiveScore,
    };
    const proposalId = semanticProposalIdFor(candidateRecord.candidate.candidateId);
    const leanTaskId = leanTaskIdFor(candidateRecord.candidate.candidateId);
    const boundaryVerification = defaultLeanBoundaryVerifier.verify(
      {
        traceId: workspace.traceId,
        taskId: makeTaskId(workspace.traceId, `lean_${candidateRecord.candidate.candidateId.replace("candidate_", "")}`),
        requestedAtTick: tick,
        candidate: scoredCandidate,
        fragmentId: inspection.fragment.id,
        fragmentEmbedding: inspection.fragment.embedding,
        fragmentTheta: inspection.fragment.theta,
        fragmentEta: inspection.fragment.eta,
        proposalId,
        leanTaskId,
        generationDepth: inspection.fragment.generationDepth,
        localGraphComplexity: inspection.neighborhood.edgeIds.size,
        neighboringFragmentCount: inspection.neighbors.length,
        exposedConnectionCount: inspection.fragment.newlyExposedConnectionIds.length,
        verificationMode: "mock",
      },
      registry,
    );
    const request = boundaryVerification.attempt.request satisfies LeanTaskRef["request"];
    const translation = boundaryVerification.translation satisfies LeanTranslationResult;
    const dispatch = boundaryVerification.dispatch;
    const verification = boundaryVerification.verification satisfies LeanVerificationResult;
    const attempt = boundaryVerification.attempt satisfies LeanProofAttemptRecord;
    const dialecticMoves = buildProposalDialecticMoveChain({
      targetProposalId: proposalId,
      candidate: candidateRecord.candidate,
      mutationResult: workspace.mutationResult,
      mutationCandidate: workspace.mutationCandidateIndex[candidateRecord.candidate.candidateId],
      formalizationResult: workspace.formalizationResults[candidateRecord.candidate.candidateId],
      critiqueResult: workspace.critiqueResult,
    });

    return {
      ...candidateRecord,
      proposalId,
      leanTaskId,
      title: candidateRecord.candidate.title,
      kind: candidateRecord.candidate.proposalKind,
      source: candidateRecord.candidate.source,
      target: candidateRecord.candidate.target,
      summary: candidateRecord.candidate.summary,
      theoremSummary: candidateRecord.candidate.theoremOrDefinition,
      leanCode: candidateRecord.candidate.mockLeanSnippet,
      confidence: candidateRecord.candidate.confidence.overall,
      score: scoredCandidate.score,
      priority: scoredCandidate.priority,
      request,
      translation,
      dispatch,
      verification,
      attempt,
      boundaryOutcome: boundaryVerification.boundaryResult.outcome,
      promotionDecision: boundaryVerification.promotionDecision,
      verifierProviderId: boundaryVerification.boundaryResult.verifierProviderId,
      projectionDivergence: boundaryVerification.boundaryResult.projectionDivergence,
      outcome: boundaryVerification.simulationOutcome,
      promptSelections: {
        mutation: workspace.promptSelections.mutation,
        formalization: workspace.promptSelections.formalization[candidateRecord.candidate.candidateId],
        critique: workspace.promptSelections.critique,
        lean: boundaryVerification.promptSelection,
      },
      dialecticMoves,
      controlFeatures: workspace.neighborhood.controlFeatures,
      decCompatibility: workspace.neighborhood.decCompatibility,
      refinementFeatures: workspace.neighborhood.refinementFeatures,
    } satisfies OrchestratedProposalPlan;
  });
}

function proposalToneStatus(outcomes: ProposalOutcomeState[], fragment: TriangleFragment): FragmentLifecycleStatus {
  if (fragment.promotion.isPersistent && !outcomes.includes("accepted")) {
    return "persistent";
  }
  if (outcomes.includes("accepted")) {
    return fragment.promotion.isPersistent ? "persistent" : "accepted";
  }
  if (outcomes.includes("promising")) {
    return "verifying";
  }
  if (outcomes.every((outcome) => outcome === "vacuous")) {
    return fragment.promotion.isPersistent ? "persistent" : "inspecting";
  }
  if (outcomes.includes("blocked")) {
    return "blocked";
  }
  if (outcomes.includes("rejected")) {
    return fragment.promotion.isPersistent ? "persistent" : "rejected";
  }
  return "active";
}

function connectionStatusForOutcome(outcome: ProposalOutcomeState): ExposedConnection["status"] {
  switch (outcome) {
    case "accepted":
      return "engaged";
    case "blocked":
      return "saturated";
    case "rejected":
      return "retired";
    case "promising":
      return "available";
    case "vacuous":
      return "available";
    case "pending":
    default:
      return "available";
  }
}

function edgeStatusForOutcome(outcome: ProposalOutcomeState): LocalGraphEdge["status"] {
  switch (outcome) {
    case "accepted":
      return "accepted";
    case "rejected":
      return "rejected";
    case "blocked":
      return "blocked";
    case "promising":
      return "highlighted";
    case "vacuous":
      return "dormant";
    case "pending":
    default:
      return "active";
  }
}

function shouldPromote(fragment: TriangleFragment, acceptedPlans: OrchestratedProposalPlan[]) {
  if (fragment.promotion.isPersistent || acceptedPlans.length === 0) {
    return false;
  }

  return acceptedPlans.some((plan) => {
    if (plan.candidate.priority >= 0.72) {
      return true;
    }
    return (
      plan.candidate.proposalKind === "candidate_definition" ||
      plan.candidate.proposalKind === "bridge_lemma" ||
      plan.candidate.proposalKind === "compatibility_claim" ||
      plan.candidate.proposalKind === "candidate_theorem"
    );
  });
}

function updateFragmentPayload(
  fragment: TriangleFragment,
  acceptedPlans: OrchestratedProposalPlan[],
  promisingPlans: OrchestratedProposalPlan[],
  tick: number,
) {
  const focusPlan = acceptedPlans[0] ?? promisingPlans[0];
  if (!focusPlan) {
    return fragment.semanticPayload;
  }

  return {
    ...fragment.semanticPayload,
    summary: focusPlan.candidate.summary,
    theoremSketch:
      focusPlan.candidate.proposalKind === "candidate_theorem" || focusPlan.candidate.proposalKind === "bridge_lemma"
        ? focusPlan.candidate.theoremOrDefinition
        : fragment.semanticPayload.theoremSketch,
    definitionSketch:
      focusPlan.candidate.proposalKind === "candidate_definition" || focusPlan.candidate.proposalKind === "projection_rule"
        ? focusPlan.candidate.theoremOrDefinition
        : fragment.semanticPayload.definitionSketch,
    keywords: Array.from(
      new Set([
        ...fragment.semanticPayload.keywords,
        focusPlan.candidate.proposalKind,
        acceptedPlans.length > 0 ? "accepted" : "in-flight",
      ]),
    ),
    notes: `Updated at tick ${tick} after adjunctor orchestration and ${proposalKindLabel(focusPlan.candidate.proposalKind)} evaluation.`,
  };
}

function updateConnectionStates(
  simulation: SimulationState,
  fragment: TriangleFragment,
  outcomes: ProposalOutcomeState[],
) {
  const dominantOutcome =
    outcomes.find((outcome) => outcome === "accepted") ??
    outcomes.find((outcome) => outcome === "promising") ??
    outcomes.find((outcome) => outcome === "blocked") ??
    outcomes.find((outcome) => outcome === "rejected") ??
    outcomes[0];

  if (!dominantOutcome) {
    return;
  }

  for (const connectionId of fragment.newlyExposedConnectionIds) {
    const connection = simulation.exposedConnections[connectionId];
    if (!connection) {
      continue;
    }
    simulation.exposedConnections[connectionId] = {
      ...connection,
      status: connectionStatusForOutcome(dominantOutcome),
      kind:
        dominantOutcome === "accepted"
          ? "persistent_bridge"
          : dominantOutcome === "promising"
            ? "candidate_bridge"
            : connection.kind,
    };
  }
}

export function createNextSimulationTick(
  simulation: SimulationState,
  options?: SimulationTickOptions,
): SimulationTickResult {
  const nextTick = simulation.activeTick + 1;
  const workingSimulation = cloneSimulation(simulation);
  workingSimulation.activeTick = nextTick;

  const activeFragmentId = chooseActiveFragment(workingSimulation, nextTick);
  if (!activeFragmentId) {
    return {
      simulation: workingSimulation,
      generatedProposalIds: [],
    };
  }

  const inspection = inspectFragment(workingSimulation, activeFragmentId);
  if (!inspection) {
    return {
      simulation: workingSimulation,
      generatedProposalIds: [],
    };
  }

  workingSimulation.activeFragmentId = activeFragmentId;
  workingSimulation.activeProposalId = undefined;
  workingSimulation.fragments[activeFragmentId] = {
    ...inspection.fragment,
    status: "inspecting",
  };

  appendReplayEvent(workingSimulation, {
    id: asReplayId(`${nextTick}_${activeFragmentId}_activated`),
    tick: nextTick,
    eventType: "fragment_activated",
    fragmentId: activeFragmentId,
    message: `Activated ${inspection.fragment.labels.short} for local semantic inspection.`,
    payload: {
      fragmentId: activeFragmentId,
      ...eventMetricsForFragment(inspection.fragment, workingSimulation),
    },
  });

  appendReplayEvent(workingSimulation, {
    id: asReplayId(`${nextTick}_${activeFragmentId}_inspected`),
    tick: nextTick,
    eventType: "neighborhood_inspected",
    fragmentId: activeFragmentId,
    message: `Inspected ${inspection.neighborhood.fragmentIds.size} fragments and ${inspection.neighborhood.edgeIds.size} graph edges near ${inspection.fragment.labels.short}.`,
    payload: {
      fragments: Array.from(inspection.neighborhood.fragmentIds),
      edges: Array.from(inspection.neighborhood.edgeIds),
      ...eventMetricsForFragment(inspection.fragment, workingSimulation),
    },
  });

  const candidatePlans = buildCandidatePlans(workingSimulation, inspection, nextTick, undefined, options);
  const generatedProposalIds: SemanticProposalId[] = [];
  const nextPhase = computeFragmentPhase(inspection.fragment, workingSimulation, candidatePlans);

  for (const plan of candidatePlans) {
    const verification = plan.verification;
    const leanTask: LeanTaskRef = {
      id: plan.leanTaskId,
      status: "preparing",
      requestedAtTick: nextTick,
      startedAtTick: nextTick,
      completedAtTick:
        plan.outcome === "accepted" ||
        plan.outcome === "rejected" ||
        plan.outcome === "blocked" ||
        plan.outcome === "vacuous"
          ? nextTick
          : undefined,
      attemptCount: 1,
      lastError: verification?.errors[0],
      diagnostics: verification?.diagnostics.map((diagnostic) => diagnostic.message),
      request: plan.request,
      result: verification,
    };
    const semeiotic = options?.semeioticAnnotationEnabled
      ? inferProposalSemeioticProfile({
          proposalKind: plan.kind,
          verificationState: plan.outcome,
          phase: nextPhase,
          corpusSupportCount: plan.candidate.corpusSupport.length,
        })
      : undefined;
    const semeioticMoments = options?.semeioticAnnotationEnabled
      ? buildProposalDialecticalMoments({
          tick: nextTick,
          fragmentId: activeFragmentId,
          proposalId: plan.proposalId,
          candidate: plan.candidate,
          proposalSummary: plan.summary,
          theoremSummary: plan.theoremSummary,
          verificationState: plan.outcome,
          dialecticMoves: plan.dialecticMoves,
          promptSelections: plan.promptSelections,
          leanTranslation: plan.translation,
        })
      : [];
    const annotatedDialecticMoves =
      options?.semeioticAnnotationEnabled && semeioticMoments.length > 0
        ? attachDialecticalMomentsToMoves(plan.dialecticMoves, semeioticMoments)
        : plan.dialecticMoves;
    const semeioticMomentSummary =
      options?.semeioticAnnotationEnabled && semeioticMoments.length > 0
        ? proposalSemeioticSummary(semeioticMoments)
        : undefined;
    const semeioticPromiseFeatureBlock = plan.promiseProfile.semeioticFeatureBlock
      ? {
          enabled: plan.promiseProfile.semeioticFeatureBlock.enabled,
          interpretantStability: plan.promiseProfile.semeioticFeatureBlock.interpretantStability,
          mismatchRichness: plan.promiseProfile.semeioticFeatureBlock.mismatchRichness,
          semeioticBranchingDepth: plan.promiseProfile.semeioticFeatureBlock.semeioticBranchingDepth,
          dialecticalCompressionQuality: plan.promiseProfile.semeioticFeatureBlock.dialecticalCompressionQuality,
        }
      : undefined;
    const proposal: SemanticProposal = {
      id: plan.proposalId,
      fragmentId: activeFragmentId,
      title: plan.title,
      proposalKind: plan.kind,
      source: plan.source,
      target: plan.target,
      naturalLanguageSummary: plan.summary,
      theoremSummary: plan.theoremSummary,
      mockLeanCode: plan.leanCode,
      verificationState: plan.outcome,
      confidence: plan.confidence,
      score: plan.score,
      priority: plan.priority,
      createdAtTick: nextTick,
      updatedAtTick: nextTick,
      embedding: [...plan.candidate.embedding],
      theta: [...plan.candidate.theta],
      eta: [...plan.candidate.eta],
      corpusSupport: plan.candidate.corpusSupport.map((support) => ({ ...support })),
      leanTask: {
        ...leanTask,
        status: leanTaskStatusFromResult(plan.outcome),
      },
      payload: {
        neighborhoodSize: inspection.neighborhood.fragmentIds.size,
        exposedCount: inspection.exposedPoints.length,
        localGraphComplexity: inspection.neighborhood.edgeIds.size,
        orchestration: {
          sourceProviders: plan.contributionSummary.sourceProviders,
          ...(semeiotic ? { semeiotic: serializeSemeioticProfile(semeiotic) } : {}),
          ...(semeioticMoments.length > 0
            ? { semeioticMoments: semeioticMoments.map((moment) => serializeDialecticalMoment(moment)) }
            : {}),
          ...(semeioticMomentSummary ? { semeioticMomentSummary } : {}),
          productiveScore: plan.productiveScore,
          divergenceField: plan.divergenceField,
          promiseProfile: {
            constructivePromise: plan.promiseProfile.constructivePromise,
            obstructivePromise: plan.promiseProfile.obstructivePromise,
            repairability: plan.promiseProfile.repairability,
            holonomyProxy: plan.promiseProfile.holonomyProxy,
            classification: plan.promiseProfile.classification,
            ...(semeioticPromiseFeatureBlock ? { semeioticFeatureBlock: semeioticPromiseFeatureBlock } : {}),
          },
          vacuityPenalty: plan.vacuityPenalty,
          instabilityPenalty: plan.instabilityPenalty,
          combinedScore: plan.combinedScore,
          mutationEnergy: plan.mutationEnergy,
          formalizationStrength: plan.formalizationStrength,
          critiquePressure: plan.critiquePressure,
          architectureCentrality: plan.architectureCentrality,
          criticPreferred: plan.criticPreferred,
          criticBlocked: plan.criticBlocked,
          disagreementSignals: plan.disagreementSignals,
          critiqueFindings: plan.critiqueFindings,
          assessments: plan.assessments,
          dialecticMoves: annotatedDialecticMoves.map((move) => ({
            id: move.id,
            provider: move.provider,
            ...(move.providerRole ? { providerRole: move.providerRole } : {}),
            role: move.role,
            ...(move.parentId ? { parentId: move.parentId } : {}),
            ...(move.targetProposalId ? { targetProposalId: move.targetProposalId } : {}),
            summary: move.summary,
            extractedClaims: [...move.extractedClaims],
            extractedObjections: [...move.extractedObjections],
            extractedRepairs: [...move.extractedRepairs],
            ...(move.semeiotic ? { semeiotic: serializeSemeioticProfile(move.semeiotic) } : {}),
            ...(move.linkedDialecticalMomentId
              ? { linkedDialecticalMomentId: move.linkedDialecticalMomentId }
              : {}),
            ...(move.linkedDialecticalMoment
              ? { linkedDialecticalMoment: serializeDialecticalMoment(move.linkedDialecticalMoment) }
              : {}),
          })),
          ...(summarizeDialecticMoveChain(annotatedDialecticMoves)
            ? { dialecticSummary: summarizeDialecticMoveChain(annotatedDialecticMoves) }
            : {}),
          decCompatibility: {
            boundaryCompatibility: plan.decCompatibility.boundaryCompatibility,
            cofaceCompatibility: plan.decCompatibility.cofaceCompatibility,
            gluingFitness: plan.decCompatibility.gluingFitness,
          },
          controlFeatures: {
            resetBurden: plan.controlFeatures.resetBurden,
            groupLikeStability: plan.controlFeatures.groupLikeStability,
            generatorComplexity: plan.controlFeatures.generatorComplexity,
            cascadeDepth: plan.controlFeatures.cascadeDepth,
          },
          refinementFeatures: {
            refinementLegality: plan.refinementFeatures.refinementLegality,
            projectionConsistency: plan.refinementFeatures.projectionConsistency,
            branchAdmissibility: plan.refinementFeatures.branchAdmissibility,
            metricCompressionGain: plan.refinementFeatures.metricCompressionGain,
          },
          leanBoundary: {
            outcome: plan.boundaryOutcome,
            simulationOutcome: plan.outcome,
            promotionDecision: plan.promotionDecision,
            verifierProviderId: plan.verifierProviderId,
            projectionDivergence: plan.projectionDivergence,
          },
          promptSelection: {
            ...jsonPromptSelectionMap(plan.promptSelections),
          },
          contributionSummary: {
            sourceProviders: plan.contributionSummary.sourceProviders,
            mutationContributionCount: plan.contributionSummary.mutationContributionCount,
            formalizationContributionCount: plan.contributionSummary.formalizationContributionCount,
            critiqueFindingCount: plan.contributionSummary.critiqueFindingCount,
          },
        },
      },
    };

    workingSimulation.leanTasks[leanTask.id] = proposal.leanTask!;
    workingSimulation.proofAttempts = defaultLeanIntegrationService.saveAttempt(
      workingSimulation.proofAttempts,
      plan.attempt,
    );
    workingSimulation.proposals[proposal.id] = proposal;
    generatedProposalIds.push(proposal.id);
    if (!workingSimulation.activeProposalId) {
      workingSimulation.activeProposalId = proposal.id;
    }

    appendReplayEvent(workingSimulation, {
      id: asReplayId(`${nextTick}_${proposal.id}_queued`),
      tick: nextTick,
      eventType: "proposal_enqueued",
      fragmentId: activeFragmentId,
      proposalId: proposal.id,
      message: `Queued ${plan.title} for ${inspection.fragment.labels.short} after adjunctor synthesis and critique.`,
      payload: {
        sourceProviders: plan.contributionSummary.sourceProviders,
        assessments: plan.assessments,
        disagreementSignals: plan.disagreementSignals,
        critiqueFindings: plan.critiqueFindings,
        leanBoundary: {
          outcome: plan.boundaryOutcome,
          simulationOutcome: plan.outcome,
          promotionDecision: plan.promotionDecision,
        },
        promptSelection: {
          ...jsonPromptSelectionMap(plan.promptSelections),
        },
        ...eventMetricsForPlan(plan, nextPhase),
      },
    });

    appendReplayEvent(workingSimulation, {
      id: asReplayId(`${nextTick}_${proposal.id}_artifact`),
      tick: nextTick,
      eventType: "lean_artifact_prepared",
      fragmentId: activeFragmentId,
      proposalId: proposal.id,
      message: `Prepared ${plan.translation.moduleName} and dispatched ${plan.dispatch.externalTaskRef ?? plan.leanTaskId}.`,
      payload: {
        ...eventMetricsForPlan(plan, nextPhase),
      },
    });

    appendReplayEvent(workingSimulation, {
      id: asReplayId(`${nextTick}_${proposal.id}_verified`),
      tick: nextTick,
      eventType: "proposal_verified",
      fragmentId: activeFragmentId,
      proposalId: proposal.id,
      message: `${plan.title} resolved as ${plan.outcome} on ${inspection.fragment.labels.short}.`,
      payload: {
        summary: plan.verification.summary,
        boundaryOutcome: plan.boundaryOutcome,
        promotionDecision: plan.promotionDecision,
        ...eventMetricsForPlan(plan, nextPhase),
      },
    });
  }

  const outcomes = candidatePlans.map((plan) => plan.outcome);
  const acceptedPlans = candidatePlans.filter((plan) => plan.outcome === "accepted");
  const promisingPlans = candidatePlans.filter((plan) => plan.outcome === "promising");
  const rejectedPlans = candidatePlans.filter((plan) => plan.outcome === "rejected");
  const shouldPromoteAccepted = shouldPromote(inspection.fragment, acceptedPlans);
  const shouldKeepPromisingArtifacts =
    workingSimulation.persistentConfig.keepPromisingItems && promisingPlans.length > 0;
  const shouldPersistPromisingFragment =
    shouldKeepPromisingArtifacts && !workingSimulation.persistentConfig.promoteOnlyAccepted;
  const fragmentStatus = shouldPromoteAccepted
    ? "persistent"
    : proposalToneStatus(outcomes, inspection.fragment);
  const dominantOutcome =
    acceptedPlans[0]?.outcome ??
    promisingPlans[0]?.outcome ??
    candidatePlans[0]?.outcome ??
    "pending";

  const nextFragment = workingSimulation.fragments[activeFragmentId];
  const catastropheState = computeFragmentCatastrophe(inspection.fragment, workingSimulation, candidatePlans);
  workingSimulation.fragments[activeFragmentId] = {
    ...nextFragment,
    status: fragmentStatus,
    phase: nextPhase,
    catastrophe: catastropheState.catastrophe,
    catastropheScore: catastropheState.catastropheScore,
    activeProposalIds: withUniqueProposalIds([
      ...generatedProposalIds,
      ...nextFragment.activeProposalIds,
    ]).slice(0, ACTIVE_PROPOSAL_LIMIT),
    semanticPayload: updateFragmentPayload(nextFragment, acceptedPlans, promisingPlans, nextTick),
    promotion: shouldPromoteAccepted
      ? {
          ...nextFragment.promotion,
          isPersistent: true,
          layer: "persistent",
          reason: "accepted_proposal",
          promotedAtTick: nextTick,
          acceptedProposalIds: withUniqueProposalIds([
            ...nextFragment.promotion.acceptedProposalIds,
            ...acceptedPlans.map((plan) => plan.proposalId),
          ]),
        }
      : shouldPersistPromisingFragment
        ? {
            ...nextFragment.promotion,
            isPersistent: true,
            layer: "candidate",
            reason: nextFragment.promotion.reason,
          }
        : nextFragment.promotion.isPersistent
          ? nextFragment.promotion
          : {
              ...nextFragment.promotion,
              layer: promisingPlans.length > 0 ? "candidate" : nextFragment.promotion.layer,
            },
  };

  if (nextPhase === "externalized" && !catastropheState.catastrophe) {
    const externalizationPlan = phasePlan(candidatePlans);
    const externalization = externalizeFragmentIntoPetals(
      workingSimulation,
      workingSimulation.fragments[activeFragmentId],
      nextTick,
    );
    workingSimulation.activeFragmentId = externalization.primaryFragmentId;
    workingSimulation.activeProposalId = externalization.primaryProposalId;
    appendReplayEvent(workingSimulation, {
      id: asReplayId(`${nextTick}_${activeFragmentId}_externalized`),
      tick: nextTick,
      eventType: "fragment_externalized",
      fragmentId: activeFragmentId,
      proposalId: externalization.primaryProposalId,
      message: `${inspection.fragment.labels.short} externalized into a four-petal structure.`,
      payload: {
        fragmentIds: externalization.fragmentIds,
        ...(externalizationPlan
          ? eventMetricsForPlan(externalizationPlan, "externalized")
          : fallbackEventMetricsPayload("externalized")),
      },
    });
  }

  updateConnectionStates(workingSimulation, workingSimulation.fragments[activeFragmentId], outcomes);
  setFragmentBoundaryStatus(workingSimulation, activeFragmentId, edgeStatusForOutcome(dominantOutcome));
  setNeighborhoodEdgeStatus(
    workingSimulation,
    inspection.neighborhood,
    promisingPlans.length > 0 ? "highlighted" : edgeStatusForOutcome(dominantOutcome),
  );

  workingSimulation.proposalQueue = withUniqueProposalIds([
    ...workingSimulation.proposalQueue.filter((proposalId) => workingSimulation.proposals[proposalId]?.verificationState === "promising"),
    ...promisingPlans.map((plan) => plan.proposalId),
  ]);

  for (const plan of acceptedPlans) {
    workingSimulation.acceptedHistory = appendHistory(workingSimulation.acceptedHistory, {
      proposalId: plan.proposalId,
      fragmentId: activeFragmentId,
      outcome: "accepted",
      recordedAtTick: nextTick,
      summary: `${inspection.fragment.labels.short} accepted ${proposalKindLabel(plan.kind)}.`,
      leanTaskId: plan.leanTaskId,
    });
  }

  for (const plan of rejectedPlans) {
    workingSimulation.rejectedHistory = appendHistory(workingSimulation.rejectedHistory, {
      proposalId: plan.proposalId,
      fragmentId: activeFragmentId,
      outcome: "rejected",
      recordedAtTick: nextTick,
      summary: `${inspection.fragment.labels.short} rejected ${proposalKindLabel(plan.kind)}.`,
      leanTaskId: plan.leanTaskId,
    });
  }

  if (shouldPromoteAccepted) {
    persistCanonicalStructure(
      workingSimulation,
      activeFragmentId,
      acceptedPlans.map((plan) => plan.proposalId),
      inspection.neighborhood,
      nextTick,
    );

    const compressionTraceId = makeTraceId(activeFragmentId, nextTick);
    const compressionTask = buildCompressionTask({
      taskId: makeTaskId(compressionTraceId, "compress_accepted"),
      traceId: compressionTraceId,
      requestedAtTick: nextTick,
      neighborhood: buildNeighborhoodSnapshot(workingSimulation, inspection),
      acceptedCandidates: acceptedPlans.map((plan) => plan.candidate),
    });
    const compression = executeTaskSync<CompressAcceptedStructureResult>(defaultMockProviderRegistry, compressionTask);
    applyCompressionToPersistentStubs(
      workingSimulation,
      acceptedPlans.map((plan) => plan.proposalId),
      compression.result.payload.compressedTitle,
      compression.result.payload.compressedSummary,
    );

    appendReplayEvent(workingSimulation, {
      id: asReplayId(`${nextTick}_${activeFragmentId}_promoted`),
      tick: nextTick,
      eventType: "fragment_promoted",
      fragmentId: activeFragmentId,
      proposalId: acceptedPlans[0]?.proposalId,
      message: `${inspection.fragment.labels.short} was promoted to the persistent layer.`,
      payload: {
        compressedTitle: compression.result.payload.compressedTitle,
        ...(acceptedPlans[0]
          ? eventMetricsForPlan(acceptedPlans[0], workingSimulation.fragments[activeFragmentId]?.phase ?? "stabilized")
          : fallbackEventMetricsPayload(workingSimulation.fragments[activeFragmentId]?.phase ?? "stabilized")),
      },
    });
  }

  if (shouldKeepPromisingArtifacts) {
    persistHoldingStructure(
      workingSimulation,
      promisingPlans.map((plan) => plan.proposalId),
      nextTick,
      shouldPersistPromisingFragment ? activeFragmentId : undefined,
    );
    appendReplayEvent(workingSimulation, {
      id: asReplayId(`${nextTick}_${activeFragmentId}_persisted`),
      tick: nextTick,
      eventType: "fragment_persisted",
      fragmentId: activeFragmentId,
      proposalId: promisingPlans[0]?.proposalId,
      message: `${inspection.fragment.labels.short} retained promising artifacts in the holding layer.`,
      payload: promisingPlans[0]
        ? eventMetricsForPlan(promisingPlans[0], workingSimulation.fragments[activeFragmentId]?.phase ?? "stabilized")
        : fallbackEventMetricsPayload(workingSimulation.fragments[activeFragmentId]?.phase ?? "stabilized"),
    });
  }

  const completionPlan = phasePlan(candidatePlans);
  appendReplayEvent(workingSimulation, {
    id: asReplayId(`${nextTick}_${activeFragmentId}_complete`),
    tick: nextTick,
    eventType: "tick_completed",
    fragmentId: activeFragmentId,
    proposalId: generatedProposalIds[0],
    message: `Tick ${nextTick} completed for ${inspection.fragment.labels.short} with ${generatedProposalIds.length} proposals.`,
    payload: completionPlan
      ? eventMetricsForPlan(
          completionPlan,
          workingSimulation.fragments[activeFragmentId]?.phase ?? nextPhase,
        )
      : fallbackEventMetricsPayload(workingSimulation.fragments[activeFragmentId]?.phase ?? nextPhase),
  });

  return {
    simulation: workingSimulation,
    activeFragmentId: workingSimulation.activeFragmentId,
    activeProposalId: workingSimulation.activeProposalId,
    generatedProposalIds,
  };
}
