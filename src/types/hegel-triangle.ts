import type { JsonObject, JsonValue } from "./primitives";

export type FragmentId = `fragment_${string}`;
export type FragmentVertexId = `fragment_vertex_${string}`;
export type ExposedConnectionId = `exposed_connection_${string}`;
export type LocalGraphEdgeId = `local_edge_${string}`;
export type SemanticProposalId = `semantic_proposal_${string}`;
export type LeanTaskId = `lean_task_${string}`;
export type ReplayEventId = `replay_event_${string}`;

export type ProposalKind =
  | "candidate_theorem"
  | "candidate_definition"
  | "bridge_lemma"
  | "projection_rule"
  | "compatibility_claim"
  | "obstruction_claim"
  | "refinement_law"
  | "refine_vertex"
  | "refine_edge"
  | "introduce_definition"
  | "state_theorem"
  | "merge_fragments"
  | "split_fragment"
  | "promote_fragment"
  | "relabel_fragment";

export type ProposalOutcomeState =
  | "pending"
  | "accepted"
  | "rejected"
  | "blocked"
  | "vacuous"
  | "promising";

export type LeanTaskStatus =
  | "idle"
  | "queued"
  | "preparing"
  | "running"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "canceled";

export type LeanVerifierKind = "mock" | "lean-process" | "lean-service";
export type LeanArtifactKind = "source" | "lakefile" | "compiled" | "report";
export type LeanDiagnosticSeverity = "info" | "warning" | "error";
export type LeanIntegrationBackend = "mock-sync" | "lean-process" | "lean-service";
export type LeanExportMode = "snippet" | "module";
export type LeanDispatchStatus = "queued" | "running" | "completed" | "failed";

export type FragmentLifecycleStatus =
  | "seed"
  | "active"
  | "inspecting"
  | "proposing"
  | "verifying"
  | "accepted"
  | "rejected"
  | "blocked"
  | "persistent"
  | "archived";

export type FragmentPhase =
  | "latent"
  | "nucleating"
  | "crystallizing"
  | "externalized"
  | "stabilized";

export type VertexRole = "anchor" | "exposed" | "internal";
export type VertexOccupancyState = "open" | "claimed" | "shared" | "sealed";

export type ExposedConnectionKind =
  | "inherited_anchor"
  | "fresh_interface"
  | "persistent_bridge"
  | "candidate_bridge";

export type ExposedConnectionStatus = "available" | "engaged" | "saturated" | "retired";

export type LocalGraphEdgeKind =
  | "fragment_boundary"
  | "semantic_relation"
  | "proposal_dependency"
  | "persistent_relation";

export type LocalGraphEdgeStatus =
  | "active"
  | "highlighted"
  | "accepted"
  | "rejected"
  | "blocked"
  | "dormant";

export type PersistenceLayer = "frontier" | "candidate" | "persistent" | "archived";
export type PromotionReason = "accepted_proposal" | "manual_lock" | "stability_threshold" | "imported";
export type PersistentStubKind = "theorem" | "definition" | "relation";
export type RunState = "playing" | "paused";
export type SelectionMode = "fragment" | "vertex" | "edge" | "proposal" | "none";
export type ViewportMode = "fit" | "follow-active" | "free-pan";
export type RenderMode = "status" | "generation" | "persistence" | "verification";
export type ReplayFilter = "all" | ProposalOutcomeState | "system";
export type ReplayProviderFilter =
  | "all"
  | "chatgpt"
  | "claude"
  | "personal-open-llm"
  | "lean-verifier";
export type InformationGeometryLabTab =
  | "patches"
  | "divergence"
  | "voronoi"
  | "charts"
  | "potential"
  | "history";
export type InformationGeometryLabViewMode =
  | "localPatch"
  | "voronoi"
  | "dualCharts"
  | "liftedSurface"
  | "accumulation";
export type InformationGeometryLabChartKind = "theta" | "eta";
export type InformationGeometryLabVoronoiSiteSource =
  | "nearbyFragments"
  | "activeProposals"
  | "persistentNodes";
export type InformationGeometryLabAccumulationMode = "sitesOnly" | "fieldsOnly" | "both";
export type InformationGeometryLabBarycenterSourceMode =
  | "activeNeighborhood"
  | "selectedVoronoiCell"
  | "selectedProposalCluster"
  | "selectedCorpusSupportCluster"
  | "selectedPersistentBranch";
export type InformationGeometryLabScalarField =
  | "divergence"
  | "asymmetry"
  | "curvature"
  | "projection"
  | "promiseConstructive"
  | "promiseObstructive";
export type InformationGeometryLabBarycenterWeightMode =
  | "uniform"
  | "corpusWeighted"
  | "promiseWeighted"
  | "divergenceWeighted";
export type InformationGeometryLabFlowMode = "proposalFlow" | "repairFlow" | "obstructionFlow";
export type InformationGeometryLabRegressionTargetMode =
  | "activeProposalHistory"
  | "activeFragmentHistory"
  | "selectedBranchHistory"
  | "selectedBarycenterHistory";
export type InformationGeometryLabRegressionDisplayMode =
  | "fittedCurve"
  | "residuals"
  | "velocity"
  | "convergence";
export type InformationGeometryMode =
  | "quadraticBregman"
  | "fisherRao"
  | "klRelativeEntropy"
  | "mixtureGeometry"
  | "alphaEmbedding"
  | "lieGroupInvariant"
  | "kahlerSignal"
  | "customExperimental";

export type InformationGeometryLabColorScaleMode = "sequential" | "diverging" | "spectral";

export type InformationGeometryLabNormalizationMode = "local" | "tickWindow" | "global";
export type WorkspaceMainView = "triangle" | "information-geometry-lab";
export type SemeioticValence = "firstness" | "secondness" | "thirdness";
export type SemeioticObjectTerm = "icon" | "index" | "symbol";
export type SemeioticSignVehicleTerm = "qualisign" | "sinsign" | "legisign";
export type SemeioticInterpretantTerm = "rheme" | "dicent" | "delome";
export type SemeioticInterpretantAlias = "argument";
export type SemeioticLens = "triadic" | "object" | "sign_vehicle" | "interpretant";
export type SemeioticSourceKind = "derived" | "payload" | "persisted";
export type SemeioticTreeFilter =
  | "all"
  | "annotated"
  | "icon"
  | "index"
  | "symbol"
  | "qualisign"
  | "sinsign"
  | "legisign"
  | "rheme"
  | "dicent"
  | "delome";
export type SemeioticSummaryMode = "compact" | "full";

export interface SemeioticAspect<TTerm extends string> {
  valence: SemeioticValence;
  term: TTerm;
}

export interface SemeioticOntologyProfile {
  object: SemeioticAspect<SemeioticObjectTerm>;
  signVehicle: SemeioticAspect<SemeioticSignVehicleTerm>;
  interpretant: SemeioticAspect<SemeioticInterpretantTerm> & {
    aliases?: SemeioticInterpretantAlias[];
  };
  source: SemeioticSourceKind;
  confidence: number;
  notes: string[];
}

export interface Point2D {
  x: number;
  y: number;
}

export interface TriangleFragmentLabels {
  short: string;
  title?: string;
  semantic?: string;
  theorem?: string;
  definition?: string;
  tags: string[];
}

export interface SemanticPayload {
  summary: string;
  keywords: string[];
  theoremSketch?: string;
  definitionSketch?: string;
  notes?: string;
  metadata?: JsonObject;
}

export interface StatisticalEmbeddingState {
  embedding: number[];
  theta: number[];
  eta: number[];
}

export interface CorpusSupportRecord {
  source: string;
  passage: string;
  similarity: number;
}

export interface FragmentVertex extends StatisticalEmbeddingState {
  id: FragmentVertexId;
  fragmentId: FragmentId;
  point: Point2D;
  role: VertexRole;
  occupancy: VertexOccupancyState;
  label?: string;
  exposedConnectionIds: ExposedConnectionId[];
  incidentEdgeIds: LocalGraphEdgeId[];
  semanticTags: string[];
  payload?: JsonObject;
}

export interface ExposedConnection {
  id: ExposedConnectionId;
  fragmentId: FragmentId;
  vertexId: FragmentVertexId;
  kind: ExposedConnectionKind;
  status: ExposedConnectionStatus;
  label: string;
  connectedToVertexId?: FragmentVertexId;
  connectedToEdgeId?: LocalGraphEdgeId;
  semanticHint?: string;
  payload?: JsonObject;
}

export interface LocalGraphEdge {
  id: LocalGraphEdgeId;
  fragmentId: FragmentId;
  sourceVertexId: FragmentVertexId;
  targetVertexId: FragmentVertexId;
  kind: LocalGraphEdgeKind;
  status: LocalGraphEdgeStatus;
  weight: number;
  label?: string;
  payload?: JsonObject;
}

export type ProposalEndpoint =
  | {
      entityType: "vertex";
      vertexId: FragmentVertexId;
    }
  | {
      entityType: "edge";
      edgeId: LocalGraphEdgeId;
    };

export interface LeanTaskRef {
  id: LeanTaskId;
  status: LeanTaskStatus;
  requestedAtTick: number;
  startedAtTick?: number;
  completedAtTick?: number;
  attemptCount: number;
  lastError?: string;
  diagnostics?: string[];
  request?: LeanVerificationRequest;
  result?: LeanVerificationResult;
}

export interface LeanStructuredMessage {
  id: string;
  taskId: LeanTaskId;
  proposalId: SemanticProposalId;
  kind: "translation" | "dispatch" | "stdout" | "stderr" | "result";
  level: "info" | "warning" | "error";
  text: string;
  createdAtTick: number;
}

export interface LeanArtifactFile {
  path: string;
  kind: LeanArtifactKind;
  contentPreview?: string;
}

export interface LeanDiagnostic {
  severity: LeanDiagnosticSeverity;
  message: string;
  code?: string;
  line?: number;
  column?: number;
}

export interface LeanVerificationRequest {
  taskId: LeanTaskId;
  proposalId: SemanticProposalId;
  fragmentId: FragmentId;
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
  generatedFiles: LeanArtifactFile[];
}

export interface LeanTranslationInput {
  taskId: LeanTaskId;
  proposalId: SemanticProposalId;
  fragmentId: FragmentId;
  proposalKind: ProposalKind;
  title: string;
  theoremSummary: string;
  sourceText: string;
  requestedAtTick: number;
}

export interface LeanTranslationResult {
  taskId: LeanTaskId;
  proposalId: SemanticProposalId;
  fragmentId: FragmentId;
  translatorKind: "mock-proposal-translator" | "lean-process-translator" | "lean-service-translator";
  exportMode: LeanExportMode;
  moduleName: string;
  declarationName: string;
  sourceText: string;
  generatedFiles: LeanArtifactFile[];
  exportSummary: string;
}

export interface LeanDispatchReceipt {
  taskId: LeanTaskId;
  proposalId: SemanticProposalId;
  backend: LeanIntegrationBackend;
  status: LeanDispatchStatus;
  dispatchedAtTick: number;
  externalTaskRef?: string;
  messages: LeanStructuredMessage[];
}

export interface LeanVerificationResult {
  verifierKind: LeanVerifierKind;
  outcome: ProposalOutcomeState;
  theoremAccepted: boolean;
  summary: string;
  acceptanceMessage?: string;
  warnings: string[];
  errors: string[];
  diagnostics: LeanDiagnostic[];
  generatedFiles: LeanArtifactFile[];
  checkedAtTick: number;
  messages: LeanStructuredMessage[];
}

export interface LeanProofAttemptRecord {
  taskId: LeanTaskId;
  proposalId: SemanticProposalId;
  fragmentId: FragmentId;
  translation: LeanTranslationResult;
  request: LeanVerificationRequest;
  dispatch: LeanDispatchReceipt;
  result?: LeanVerificationResult;
  logLines: string[];
  lastUpdatedTick: number;
}

export interface SemanticProposal extends StatisticalEmbeddingState {
  id: SemanticProposalId;
  fragmentId: FragmentId;
  title: string;
  proposalKind: ProposalKind;
  source: ProposalEndpoint;
  target?: ProposalEndpoint;
  naturalLanguageSummary: string;
  theoremSummary: string;
  mockLeanCode: string;
  verificationState: ProposalOutcomeState;
  confidence: number;
  score: number;
  priority: number;
  createdAtTick: number;
  updatedAtTick: number;
  createdAtMs?: number;
  corpusSupport: CorpusSupportRecord[];
  leanTask?: LeanTaskRef;
  payload?: JsonObject;
}

export interface FragmentPromotion {
  fragmentId: FragmentId;
  isPersistent: boolean;
  promotedAtTick?: number;
  demotedAtTick?: number;
  layer: PersistenceLayer;
  reason?: PromotionReason;
  acceptedProposalIds: SemanticProposalId[];
}

export interface PersistentSemanticStub {
  id: `persistent_stub_${string}`;
  proposalId: SemanticProposalId;
  fragmentId: FragmentId;
  kind: PersistentStubKind;
  title: string;
  summary: string;
  leanSnippet: string;
  promotedAtTick: number;
  layer: "canonical" | "holding";
}

export interface PersistentStructureConfig {
  promoteOnlyAccepted: boolean;
  keepPromisingItems: boolean;
}

export interface PersistentStructureState {
  promotedFragmentIds: FragmentId[];
  promotedProposalIds: SemanticProposalId[];
  keptPromisingProposalIds: SemanticProposalId[];
  acceptedConnectionIds: ExposedConnectionId[];
  acceptedEdgeIds: LocalGraphEdgeId[];
  theoremStubs: PersistentSemanticStub[];
  definitionStubs: PersistentSemanticStub[];
}

export interface TriangleFragment extends StatisticalEmbeddingState {
  id: FragmentId;
  generationDepth: number;
  parentFragmentId?: FragmentId;
  childFragmentIds: FragmentId[];
  inheritedAnchor: FragmentVertexId;
  newlyExposedConnectionIds: [ExposedConnectionId, ExposedConnectionId];
  position: Point2D;
  centroid: Point2D;
  vertexIds: [FragmentVertexId, FragmentVertexId, FragmentVertexId];
  edgeIds: [LocalGraphEdgeId, LocalGraphEdgeId, LocalGraphEdgeId];
  status: FragmentLifecycleStatus;
  phase: FragmentPhase;
  catastrophe: boolean;
  catastropheScore: number;
  labels: TriangleFragmentLabels;
  semanticPayload: SemanticPayload;
  promotion: FragmentPromotion;
  activeProposalIds: SemanticProposalId[];
}

export interface ProposalOutcomeRecord {
  proposalId: SemanticProposalId;
  fragmentId: FragmentId;
  outcome: ProposalOutcomeState;
  recordedAtTick: number;
  summary: string;
  leanTaskId?: LeanTaskId;
}

export interface ReplayLogEntry {
  id: ReplayEventId;
  tick: number;
  eventType:
    | "simulation_started"
    | "simulation_paused"
    | "fragment_activated"
    | "neighborhood_inspected"
    | "proposal_enqueued"
    | "geometry_mode_changed"
    | "barycenter_updated"
    | "flow_direction_updated"
    | "trajectory_fit_updated"
    | "voronoi_partition_updated"
    | "dual_chart_sync_updated"
    | "catastrophe_marker_detected"
    | "grammar_state_changed"
    | "ig_snapshot_saved"
    | "semeiotic_runtime_enabled"
    | "semeiotic_runtime_disabled"
    | "semeiotic_annotation_updated"
    | "semeiotic_annotation_created"
    | "semeiotic_mismatch_detected"
    | "semeiotic_summary_updated"
    | "semeiotic_chain_linked"
    | "semeiotic_overlay_toggled"
    | "lean_artifact_prepared"
    | "proposal_verified"
    | "fragment_promoted"
    | "fragment_externalized"
    | "fragment_persisted"
    | "tick_completed";
  fragmentId?: FragmentId;
  proposalId?: SemanticProposalId;
  message: string;
  payload?: JsonValue;
}

export interface SimulationState {
  runState: RunState;
  activeTick: number;
  activeFragmentId?: FragmentId;
  activeProposalId?: SemanticProposalId;
  persistentConfig: PersistentStructureConfig;
  persistent: PersistentStructureState;
  proposalQueue: SemanticProposalId[];
  acceptedHistory: ProposalOutcomeRecord[];
  rejectedHistory: ProposalOutcomeRecord[];
  replayLog: ReplayLogEntry[];
  fragments: Record<FragmentId, TriangleFragment>;
  vertices: Record<FragmentVertexId, FragmentVertex>;
  exposedConnections: Record<ExposedConnectionId, ExposedConnection>;
  edges: Record<LocalGraphEdgeId, LocalGraphEdge>;
  proposals: Record<SemanticProposalId, SemanticProposal>;
  leanTasks: Record<LeanTaskId, LeanTaskRef>;
  proofAttempts: Record<LeanTaskId, LeanProofAttemptRecord>;
}

export interface AppViewState {
  selectedFragmentId?: FragmentId;
  selectedVertexId?: FragmentVertexId;
  selectedEdgeId?: LocalGraphEdgeId;
  selectedProposalId?: SemanticProposalId;
  hoveredFragmentId?: FragmentId;
  selectionMode: SelectionMode;
  viewportMode: ViewportMode;
  renderMode: RenderMode;
  showFragmentLabels: boolean;
  showGraphEdges: boolean;
  showAcceptedOverlay: boolean;
  showRejectedOverlay: boolean;
  showPersistentLayer: boolean;
  showProposalLabels: boolean;
  showEdgeLabels: boolean;
  inspectorTab: "fragment" | "proposal" | "log" | "lean";
  activeMainView: WorkspaceMainView;
  modulePanels: {
    informationGeometryLabOpen: boolean;
    informationGeometryLabTab: InformationGeometryLabTab;
  };
  semeiotic: {
    semeioticsEnabled: boolean;
    semeioticAutoAnnotate: boolean;
    selectedDialecticalMomentId?: string;
    semeioticOverlayVisible: boolean;
    semeioticGrammarPanelOpen: boolean;
    semeioticTreeFilter: SemeioticTreeFilter;
    semeioticSummaryMode: SemeioticSummaryMode;
    showOnlyAnnotatedMoves: boolean;
    activeSemeioticTickWindow: number;
    logRawOutputs: boolean;
    influencesPromiseProfile: boolean;
    selectedLens: SemeioticLens;
    showTreeBadges: boolean;
    showLogBadges: boolean;
  };
  informationGeometryLab: {
    selectedIGViewMode: InformationGeometryLabViewMode;
    selectedGeometryMode: InformationGeometryMode;
    selectedFragmentId?: FragmentId;
    selectedProposalId?: SemanticProposalId;
    selectedTick?: number;
    selectedChartKind: InformationGeometryLabChartKind;
    voronoiGridResolution: number;
    voronoiSiteSource: InformationGeometryLabVoronoiSiteSource;
    liftedProjectionAngle: number;
    liftedHeightScale: number;
    accumulationTrailLength: number;
    accumulationMode: InformationGeometryLabAccumulationMode;
    barycenterSourceMode: InformationGeometryLabBarycenterSourceMode;
    barycenterWeightMode: InformationGeometryLabBarycenterWeightMode;
    barycenterTickWindow: number;
    selectedFlowMode: InformationGeometryLabFlowMode;
    regressionEnabled: boolean;
    regressionTargetMode: InformationGeometryLabRegressionTargetMode;
    regressionDisplayMode: InformationGeometryLabRegressionDisplayMode;
    regressionTickWindow: number;
    flowVectorDensity: number;
    flowVectorScale: number;
    selectedScalarField: InformationGeometryLabScalarField;
    colorScaleMode: InformationGeometryLabColorScaleMode;
    normalizationMode: InformationGeometryLabNormalizationMode;
    autoFollowActiveFragment: boolean;
    freezeCurrentSnapshot: boolean;
    compareWithPreviousTick: boolean;
    showVoronoiSites: boolean;
    showVoronoiBoundaries: boolean;
    showLiftedSurface: boolean;
    showLiftedStems: boolean;
    showLiftedFootprint: boolean;
    showGeodesics: boolean;
    showNucleation: boolean;
    showCatastropheMarkers: boolean;
    showBarycenter: boolean;
    showBarycenterTrail: boolean;
    showFlowVectors: boolean;
    showFlowTrails: boolean;
    animateFlowOverTicks: boolean;
    showResidualMarkers: boolean;
    showAccumulationHistory: boolean;
  };
  replay: {
    mode: "live" | "history";
    isPlaying: boolean;
    playbackGranularity: "event" | "tick";
    tick: number;
    selectedEventId?: ReplayEventId;
    logFilter: ReplayFilter;
    providerFilter: ReplayProviderFilter;
    liveObservedEventId?: ReplayEventId;
  };
}

export interface HegelTriangleFragmentTransformSnapshot {
  simulation: SimulationState;
  view: AppViewState;
}
