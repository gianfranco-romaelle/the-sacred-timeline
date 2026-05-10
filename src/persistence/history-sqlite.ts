import { importNodeModule } from "@/lib/node-dynamic-import";

export const HISTORY_SQLITE_PATH = "data/history.sqlite";

export const HISTORY_SQLITE_SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ticks (
  id TEXT PRIMARY KEY,
  parentId TEXT,
  fragmentId TEXT,
  tick INTEGER NOT NULL,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  runState TEXT,
  activeFragmentId TEXT,
  activeProposalId TEXT,
  replayEventCount INTEGER NOT NULL DEFAULT 0,
  metadataJson TEXT
);

CREATE TABLE IF NOT EXISTS fragments (
  id TEXT PRIMARY KEY,
  parentId TEXT,
  fragmentId TEXT NOT NULL,
  tick INTEGER NOT NULL,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  generationDepth INTEGER NOT NULL DEFAULT 0,
  status TEXT,
  phase TEXT,
  promotionLayer TEXT,
  proposalCount INTEGER NOT NULL DEFAULT 0,
  childCount INTEGER NOT NULL DEFAULT 0,
  embeddingJson TEXT,
  thetaJson TEXT,
  etaJson TEXT,
  labelsJson TEXT,
  payloadJson TEXT,
  FOREIGN KEY (parentId) REFERENCES fragments(id)
);

CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY,
  parentId TEXT,
  fragmentId TEXT NOT NULL,
  tick INTEGER NOT NULL,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  proposalKind TEXT,
  title TEXT,
  summary TEXT,
  verificationState TEXT,
  outcomeState TEXT,
  leanRunId TEXT,
  sourceProviderIdsJson TEXT,
  embeddingJson TEXT,
  thetaJson TEXT,
  etaJson TEXT,
  divergenceJson TEXT,
  relationType TEXT,
  sourceNodeId TEXT,
  targetNodeId TEXT,
  cycleHint TEXT,
  obstructionKind TEXT,
  cochainRole TEXT,
  cancellationRole TEXT,
  resolutionStatus TEXT,
  semeioticObjectTerm TEXT,
  semeioticSignTerm TEXT,
  semeioticInterpretantTerm TEXT,
  semeioticConfidence REAL,
  payloadJson TEXT,
  FOREIGN KEY (fragmentId) REFERENCES fragments(id),
  FOREIGN KEY (parentId) REFERENCES proposals(id),
  FOREIGN KEY (leanRunId) REFERENCES lean_runs(id)
);

CREATE TABLE IF NOT EXISTS dialectic_moves (
  id TEXT PRIMARY KEY,
  parentId TEXT,
  fragmentId TEXT NOT NULL,
  tick INTEGER NOT NULL,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  proposalId TEXT,
  targetProposalId TEXT,
  sourceFragmentId TEXT,
  targetFragmentId TEXT,
  moveType TEXT NOT NULL,
  provider TEXT,
  role TEXT,
  actorProviderId TEXT,
  counterpartyProviderId TEXT,
  eventType TEXT,
  fromPhase TEXT,
  toPhase TEXT,
  summary TEXT,
  extractedClaimsJson TEXT,
  extractedObjectionsJson TEXT,
  extractedRepairsJson TEXT,
  rawArtifactPath TEXT,
  relationType TEXT,
  sourceNodeId TEXT,
  targetNodeId TEXT,
  cycleHint TEXT,
  obstructionKind TEXT,
  cochainRole TEXT,
  cancellationRole TEXT,
  resolutionStatus TEXT,
  semeioticObjectTerm TEXT,
  semeioticSignTerm TEXT,
  semeioticInterpretantTerm TEXT,
  semeioticConfidence REAL,
  forward REAL,
  reverse REAL,
  asymmetry REAL,
  curvature REAL,
  projection REAL,
  total REAL,
  metadataJson TEXT,
  FOREIGN KEY (fragmentId) REFERENCES fragments(id),
  FOREIGN KEY (proposalId) REFERENCES proposals(id),
  FOREIGN KEY (parentId) REFERENCES dialectic_moves(id)
);

CREATE TABLE IF NOT EXISTS lean_runs (
  id TEXT PRIMARY KEY,
  parentId TEXT,
  fragmentId TEXT NOT NULL,
  tick INTEGER NOT NULL,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  proposalId TEXT NOT NULL,
  taskId TEXT,
  theoremKind TEXT,
  status TEXT,
  accepted INTEGER NOT NULL DEFAULT 0,
  blocked INTEGER NOT NULL DEFAULT 0,
  rejected INTEGER NOT NULL DEFAULT 0,
  command TEXT,
  snippetPath TEXT,
  moduleName TEXT,
  stdoutPath TEXT,
  stderrPath TEXT,
  forward REAL,
  reverse REAL,
  asymmetry REAL,
  projection REAL,
  total REAL,
  phase TEXT,
  sourceVectorJson TEXT,
  targetVectorJson TEXT,
  repairedVectorJson TEXT,
  relationType TEXT,
  sourceNodeId TEXT,
  targetNodeId TEXT,
  cycleHint TEXT,
  obstructionKind TEXT,
  cochainRole TEXT,
  cancellationRole TEXT,
  resolutionStatus TEXT,
  semeioticObjectTerm TEXT,
  semeioticSignTerm TEXT,
  semeioticInterpretantTerm TEXT,
  semeioticConfidence REAL,
  payloadJson TEXT,
  FOREIGN KEY (fragmentId) REFERENCES fragments(id),
  FOREIGN KEY (proposalId) REFERENCES proposals(id),
  FOREIGN KEY (parentId) REFERENCES lean_runs(id)
);

CREATE TABLE IF NOT EXISTS persistent_nodes (
  id TEXT PRIMARY KEY,
  parentId TEXT,
  fragmentId TEXT NOT NULL,
  tick INTEGER NOT NULL,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  proposalId TEXT,
  nodeKind TEXT,
  layer TEXT,
  title TEXT,
  summary TEXT,
  leanSnippet TEXT,
  relationType TEXT,
  sourceNodeId TEXT,
  targetNodeId TEXT,
  cycleHint TEXT,
  obstructionKind TEXT,
  cochainRole TEXT,
  cancellationRole TEXT,
  resolutionStatus TEXT,
  semeioticObjectTerm TEXT,
  semeioticSignTerm TEXT,
  semeioticInterpretantTerm TEXT,
  semeioticConfidence REAL,
  payloadJson TEXT,
  FOREIGN KEY (fragmentId) REFERENCES fragments(id),
  FOREIGN KEY (proposalId) REFERENCES proposals(id),
  FOREIGN KEY (parentId) REFERENCES persistent_nodes(id)
);

CREATE TABLE IF NOT EXISTS ig_lab_snapshots (
  id TEXT PRIMARY KEY,
  parentId TEXT,
  fragmentId TEXT,
  proposalId TEXT,
  tick INTEGER NOT NULL,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  geometryMode TEXT,
  viewMode TEXT NOT NULL,
  moduleTab TEXT,
  chartKind TEXT,
  scalarField TEXT,
  colorScaleMode TEXT,
  normalizationMode TEXT,
  artifactPath TEXT NOT NULL,
  siteCount INTEGER NOT NULL DEFAULT 0,
  sampleCount INTEGER NOT NULL DEFAULT 0,
  summaryJson TEXT,
  FOREIGN KEY (fragmentId) REFERENCES fragments(id),
  FOREIGN KEY (proposalId) REFERENCES proposals(id),
  FOREIGN KEY (parentId) REFERENCES ig_lab_snapshots(id)
);

CREATE TABLE IF NOT EXISTS ig_lab_events (
  id TEXT PRIMARY KEY,
  parentId TEXT,
  fragmentId TEXT,
  tick INTEGER NOT NULL,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  proposalId TEXT,
  eventType TEXT NOT NULL,
  message TEXT,
  payloadJson TEXT,
  FOREIGN KEY (fragmentId) REFERENCES fragments(id),
  FOREIGN KEY (proposalId) REFERENCES proposals(id),
  FOREIGN KEY (parentId) REFERENCES ig_lab_events(id)
);

CREATE INDEX IF NOT EXISTS idx_ticks_tick ON ticks(tick);
CREATE INDEX IF NOT EXISTS idx_ticks_parent ON ticks(parentId);
CREATE INDEX IF NOT EXISTS idx_fragments_tick ON fragments(tick);
CREATE INDEX IF NOT EXISTS idx_fragments_parent ON fragments(parentId);
CREATE INDEX IF NOT EXISTS idx_fragments_fragment ON fragments(fragmentId);
CREATE INDEX IF NOT EXISTS idx_proposals_fragment_tick ON proposals(fragmentId, tick);
CREATE INDEX IF NOT EXISTS idx_proposals_parent ON proposals(parentId);
CREATE INDEX IF NOT EXISTS idx_proposals_lean_run ON proposals(leanRunId);
CREATE INDEX IF NOT EXISTS idx_proposals_source_target ON proposals(sourceNodeId, targetNodeId);
CREATE INDEX IF NOT EXISTS idx_proposals_resolution_status ON proposals(resolutionStatus);
CREATE INDEX IF NOT EXISTS idx_moves_fragment_tick ON dialectic_moves(fragmentId, tick);
CREATE INDEX IF NOT EXISTS idx_moves_proposal ON dialectic_moves(proposalId);
CREATE INDEX IF NOT EXISTS idx_moves_source_target ON dialectic_moves(sourceFragmentId, targetFragmentId);
CREATE INDEX IF NOT EXISTS idx_moves_topology_source_target ON dialectic_moves(sourceNodeId, targetNodeId);
CREATE INDEX IF NOT EXISTS idx_moves_resolution_status ON dialectic_moves(resolutionStatus);
CREATE INDEX IF NOT EXISTS idx_lean_runs_proposal_tick ON lean_runs(proposalId, tick);
CREATE INDEX IF NOT EXISTS idx_lean_runs_fragment ON lean_runs(fragmentId);
CREATE INDEX IF NOT EXISTS idx_lean_runs_task ON lean_runs(taskId);
CREATE INDEX IF NOT EXISTS idx_lean_runs_source_target ON lean_runs(sourceNodeId, targetNodeId);
CREATE INDEX IF NOT EXISTS idx_lean_runs_resolution_status ON lean_runs(resolutionStatus);
CREATE INDEX IF NOT EXISTS idx_persistent_nodes_tick ON persistent_nodes(tick);
CREATE INDEX IF NOT EXISTS idx_persistent_nodes_fragment ON persistent_nodes(fragmentId);
CREATE INDEX IF NOT EXISTS idx_persistent_nodes_proposal ON persistent_nodes(proposalId);
CREATE INDEX IF NOT EXISTS idx_persistent_nodes_source_target ON persistent_nodes(sourceNodeId, targetNodeId);
CREATE INDEX IF NOT EXISTS idx_persistent_nodes_resolution_status ON persistent_nodes(resolutionStatus);
CREATE INDEX IF NOT EXISTS idx_ig_snapshots_tick ON ig_lab_snapshots(tick);
CREATE INDEX IF NOT EXISTS idx_ig_snapshots_fragment ON ig_lab_snapshots(fragmentId);
CREATE INDEX IF NOT EXISTS idx_ig_snapshots_proposal ON ig_lab_snapshots(proposalId);
CREATE INDEX IF NOT EXISTS idx_ig_snapshots_view ON ig_lab_snapshots(viewMode);
CREATE INDEX IF NOT EXISTS idx_ig_events_tick ON ig_lab_events(tick);
CREATE INDEX IF NOT EXISTS idx_ig_events_fragment ON ig_lab_events(fragmentId);
CREATE INDEX IF NOT EXISTS idx_ig_events_proposal ON ig_lab_events(proposalId);
CREATE INDEX IF NOT EXISTS idx_ig_events_type ON ig_lab_events(eventType);

CREATE TABLE IF NOT EXISTS semeiotic_events (
  id TEXT PRIMARY KEY,
  parentId TEXT,
  fragmentId TEXT,
  tick INTEGER NOT NULL,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  proposalId TEXT,
  eventType TEXT NOT NULL,
  message TEXT,
  payloadJson TEXT,
  FOREIGN KEY (fragmentId) REFERENCES fragments(id),
  FOREIGN KEY (proposalId) REFERENCES proposals(id),
  FOREIGN KEY (parentId) REFERENCES semeiotic_events(id)
);

CREATE INDEX IF NOT EXISTS idx_semeiotic_events_tick ON semeiotic_events(tick);
CREATE INDEX IF NOT EXISTS idx_semeiotic_events_fragment ON semeiotic_events(fragmentId);
CREATE INDEX IF NOT EXISTS idx_semeiotic_events_proposal ON semeiotic_events(proposalId);
CREATE INDEX IF NOT EXISTS idx_semeiotic_events_type ON semeiotic_events(eventType);

CREATE TABLE IF NOT EXISTS dialectical_moments (
  id TEXT PRIMARY KEY,
  parentId TEXT,
  fragmentId TEXT,
  proposalId TEXT,
  dialecticMoveId TEXT,
  tick INTEGER NOT NULL,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  provider TEXT,
  role TEXT NOT NULL,
  source TEXT,
  summary TEXT,
  rawArtifactPointer TEXT,
  structuredArtifactPath TEXT,
  providerOutputLinksJson TEXT,
  rawSourcesJson TEXT,
  linkedMomentIdsJson TEXT,
  notesJson TEXT,
  semeioticObjectTerm TEXT,
  semeioticSignTerm TEXT,
  semeioticInterpretantTerm TEXT,
  semeioticConfidence REAL,
  mismatchCount INTEGER NOT NULL DEFAULT 0,
  mismatchesJson TEXT,
  claimCount INTEGER NOT NULL DEFAULT 0,
  objectionCount INTEGER NOT NULL DEFAULT 0,
  repairCount INTEGER NOT NULL DEFAULT 0,
  branchCount INTEGER NOT NULL DEFAULT 0,
  triadicEntropy REAL,
  annotationDensity REAL,
  confidenceSpread REAL,
  ontologyAlignmentStrength REAL,
  interpretantInstability REAL,
  objectSignMismatch REAL,
  triadicImbalance REAL,
  internalAmbiguity REAL,
  signEventBranchingComplexity REAL,
  critiqueInducedReinterpretationDepth REAL,
  overallComplexity REAL,
  payloadJson TEXT,
  FOREIGN KEY (fragmentId) REFERENCES fragments(id),
  FOREIGN KEY (proposalId) REFERENCES proposals(id),
  FOREIGN KEY (dialecticMoveId) REFERENCES dialectic_moves(id),
  FOREIGN KEY (parentId) REFERENCES dialectical_moments(id)
);

CREATE TABLE IF NOT EXISTS semeiotic_links (
  id TEXT PRIMARY KEY,
  parentId TEXT,
  fragmentId TEXT,
  proposalId TEXT,
  tick INTEGER NOT NULL,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sourceMomentId TEXT,
  targetMomentId TEXT,
  sourceNodeId TEXT,
  targetNodeId TEXT,
  relationType TEXT NOT NULL,
  chainKind TEXT,
  mismatchKind TEXT,
  summary TEXT,
  strength REAL,
  metadataJson TEXT,
  FOREIGN KEY (fragmentId) REFERENCES fragments(id),
  FOREIGN KEY (proposalId) REFERENCES proposals(id),
  FOREIGN KEY (sourceMomentId) REFERENCES dialectical_moments(id),
  FOREIGN KEY (targetMomentId) REFERENCES dialectical_moments(id),
  FOREIGN KEY (parentId) REFERENCES semeiotic_links(id)
);

CREATE TABLE IF NOT EXISTS semeiotic_summaries (
  id TEXT PRIMARY KEY,
  parentId TEXT,
  fragmentId TEXT,
  proposalId TEXT,
  tick INTEGER NOT NULL,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sourceKind TEXT,
  objectTerm TEXT,
  signTerm TEXT,
  interpretantTerm TEXT,
  confidence REAL,
  momentCount INTEGER NOT NULL DEFAULT 0,
  mismatchCount INTEGER NOT NULL DEFAULT 0,
  artifactPath TEXT,
  providerOutputLinksJson TEXT,
  summariesJson TEXT,
  payloadJson TEXT,
  FOREIGN KEY (fragmentId) REFERENCES fragments(id),
  FOREIGN KEY (proposalId) REFERENCES proposals(id),
  FOREIGN KEY (parentId) REFERENCES semeiotic_summaries(id)
);

CREATE INDEX IF NOT EXISTS idx_dialectical_moments_tick ON dialectical_moments(tick);
CREATE INDEX IF NOT EXISTS idx_dialectical_moments_fragment ON dialectical_moments(fragmentId);
CREATE INDEX IF NOT EXISTS idx_dialectical_moments_proposal ON dialectical_moments(proposalId);
CREATE INDEX IF NOT EXISTS idx_dialectical_moments_move ON dialectical_moments(dialecticMoveId);
CREATE INDEX IF NOT EXISTS idx_dialectical_moments_parent ON dialectical_moments(parentId);
CREATE INDEX IF NOT EXISTS idx_dialectical_moments_terms ON dialectical_moments(semeioticObjectTerm, semeioticSignTerm, semeioticInterpretantTerm);
CREATE INDEX IF NOT EXISTS idx_semeiotic_links_tick ON semeiotic_links(tick);
CREATE INDEX IF NOT EXISTS idx_semeiotic_links_fragment ON semeiotic_links(fragmentId);
CREATE INDEX IF NOT EXISTS idx_semeiotic_links_proposal ON semeiotic_links(proposalId);
CREATE INDEX IF NOT EXISTS idx_semeiotic_links_source_target_moment ON semeiotic_links(sourceMomentId, targetMomentId);
CREATE INDEX IF NOT EXISTS idx_semeiotic_links_relation_type ON semeiotic_links(relationType);
CREATE INDEX IF NOT EXISTS idx_semeiotic_summaries_tick ON semeiotic_summaries(tick);
CREATE INDEX IF NOT EXISTS idx_semeiotic_summaries_fragment ON semeiotic_summaries(fragmentId);
CREATE INDEX IF NOT EXISTS idx_semeiotic_summaries_proposal ON semeiotic_summaries(proposalId);
`;

const HISTORY_SQLITE_MIGRATIONS = [
  "ALTER TABLE dialectic_moves ADD COLUMN targetProposalId TEXT",
  "ALTER TABLE dialectic_moves ADD COLUMN provider TEXT",
  "ALTER TABLE dialectic_moves ADD COLUMN role TEXT",
  "ALTER TABLE dialectic_moves ADD COLUMN summary TEXT",
  "ALTER TABLE dialectic_moves ADD COLUMN extractedClaimsJson TEXT",
  "ALTER TABLE dialectic_moves ADD COLUMN extractedObjectionsJson TEXT",
  "ALTER TABLE dialectic_moves ADD COLUMN extractedRepairsJson TEXT",
  "ALTER TABLE dialectic_moves ADD COLUMN rawArtifactPath TEXT",
  "ALTER TABLE proposals ADD COLUMN relationType TEXT",
  "ALTER TABLE proposals ADD COLUMN sourceNodeId TEXT",
  "ALTER TABLE proposals ADD COLUMN targetNodeId TEXT",
  "ALTER TABLE proposals ADD COLUMN cycleHint TEXT",
  "ALTER TABLE proposals ADD COLUMN obstructionKind TEXT",
  "ALTER TABLE proposals ADD COLUMN cochainRole TEXT",
  "ALTER TABLE proposals ADD COLUMN cancellationRole TEXT",
  "ALTER TABLE proposals ADD COLUMN resolutionStatus TEXT",
  "ALTER TABLE proposals ADD COLUMN semeioticObjectTerm TEXT",
  "ALTER TABLE proposals ADD COLUMN semeioticSignTerm TEXT",
  "ALTER TABLE proposals ADD COLUMN semeioticInterpretantTerm TEXT",
  "ALTER TABLE proposals ADD COLUMN semeioticConfidence REAL",
  "ALTER TABLE dialectic_moves ADD COLUMN relationType TEXT",
  "ALTER TABLE dialectic_moves ADD COLUMN sourceNodeId TEXT",
  "ALTER TABLE dialectic_moves ADD COLUMN targetNodeId TEXT",
  "ALTER TABLE dialectic_moves ADD COLUMN cycleHint TEXT",
  "ALTER TABLE dialectic_moves ADD COLUMN obstructionKind TEXT",
  "ALTER TABLE dialectic_moves ADD COLUMN cochainRole TEXT",
  "ALTER TABLE dialectic_moves ADD COLUMN cancellationRole TEXT",
  "ALTER TABLE dialectic_moves ADD COLUMN resolutionStatus TEXT",
  "ALTER TABLE dialectic_moves ADD COLUMN semeioticObjectTerm TEXT",
  "ALTER TABLE dialectic_moves ADD COLUMN semeioticSignTerm TEXT",
  "ALTER TABLE dialectic_moves ADD COLUMN semeioticInterpretantTerm TEXT",
  "ALTER TABLE dialectic_moves ADD COLUMN semeioticConfidence REAL",
  "ALTER TABLE lean_runs ADD COLUMN relationType TEXT",
  "ALTER TABLE lean_runs ADD COLUMN sourceNodeId TEXT",
  "ALTER TABLE lean_runs ADD COLUMN targetNodeId TEXT",
  "ALTER TABLE lean_runs ADD COLUMN cycleHint TEXT",
  "ALTER TABLE lean_runs ADD COLUMN obstructionKind TEXT",
  "ALTER TABLE lean_runs ADD COLUMN cochainRole TEXT",
  "ALTER TABLE lean_runs ADD COLUMN cancellationRole TEXT",
  "ALTER TABLE lean_runs ADD COLUMN resolutionStatus TEXT",
  "ALTER TABLE lean_runs ADD COLUMN semeioticObjectTerm TEXT",
  "ALTER TABLE lean_runs ADD COLUMN semeioticSignTerm TEXT",
  "ALTER TABLE lean_runs ADD COLUMN semeioticInterpretantTerm TEXT",
  "ALTER TABLE lean_runs ADD COLUMN semeioticConfidence REAL",
  "CREATE INDEX IF NOT EXISTS idx_moves_target_proposal ON dialectic_moves(targetProposalId)",
  "CREATE INDEX IF NOT EXISTS idx_moves_provider_role ON dialectic_moves(provider, role)",
  "CREATE INDEX IF NOT EXISTS idx_proposals_source_target ON proposals(sourceNodeId, targetNodeId)",
  "CREATE INDEX IF NOT EXISTS idx_proposals_resolution_status ON proposals(resolutionStatus)",
  "CREATE INDEX IF NOT EXISTS idx_moves_topology_source_target ON dialectic_moves(sourceNodeId, targetNodeId)",
  "CREATE INDEX IF NOT EXISTS idx_moves_resolution_status ON dialectic_moves(resolutionStatus)",
  "CREATE INDEX IF NOT EXISTS idx_lean_runs_source_target ON lean_runs(sourceNodeId, targetNodeId)",
  "CREATE INDEX IF NOT EXISTS idx_lean_runs_resolution_status ON lean_runs(resolutionStatus)",
  `CREATE TABLE IF NOT EXISTS persistent_nodes (
    id TEXT PRIMARY KEY,
    parentId TEXT,
    fragmentId TEXT NOT NULL,
    tick INTEGER NOT NULL,
    createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    proposalId TEXT,
    nodeKind TEXT,
    layer TEXT,
    title TEXT,
    summary TEXT,
    leanSnippet TEXT,
    relationType TEXT,
    sourceNodeId TEXT,
    targetNodeId TEXT,
    cycleHint TEXT,
    obstructionKind TEXT,
    cochainRole TEXT,
    cancellationRole TEXT,
    resolutionStatus TEXT,
    semeioticObjectTerm TEXT,
    semeioticSignTerm TEXT,
    semeioticInterpretantTerm TEXT,
    semeioticConfidence REAL,
    payloadJson TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS idx_persistent_nodes_tick ON persistent_nodes(tick)",
  "CREATE INDEX IF NOT EXISTS idx_persistent_nodes_fragment ON persistent_nodes(fragmentId)",
  "CREATE INDEX IF NOT EXISTS idx_persistent_nodes_proposal ON persistent_nodes(proposalId)",
  "CREATE INDEX IF NOT EXISTS idx_persistent_nodes_source_target ON persistent_nodes(sourceNodeId, targetNodeId)",
  "CREATE INDEX IF NOT EXISTS idx_persistent_nodes_resolution_status ON persistent_nodes(resolutionStatus)",
  `CREATE TABLE IF NOT EXISTS ig_lab_snapshots (
    id TEXT PRIMARY KEY,
    parentId TEXT,
    fragmentId TEXT,
    proposalId TEXT,
    tick INTEGER NOT NULL,
    createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    geometryMode TEXT,
    viewMode TEXT NOT NULL,
    moduleTab TEXT,
    chartKind TEXT,
    scalarField TEXT,
    colorScaleMode TEXT,
    normalizationMode TEXT,
    artifactPath TEXT NOT NULL,
    siteCount INTEGER NOT NULL DEFAULT 0,
    sampleCount INTEGER NOT NULL DEFAULT 0,
    summaryJson TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS idx_ig_snapshots_tick ON ig_lab_snapshots(tick)",
  "CREATE INDEX IF NOT EXISTS idx_ig_snapshots_fragment ON ig_lab_snapshots(fragmentId)",
  "CREATE INDEX IF NOT EXISTS idx_ig_snapshots_proposal ON ig_lab_snapshots(proposalId)",
  "CREATE INDEX IF NOT EXISTS idx_ig_snapshots_view ON ig_lab_snapshots(viewMode)",
  "ALTER TABLE ig_lab_snapshots ADD COLUMN geometryMode TEXT",
  `CREATE TABLE IF NOT EXISTS ig_lab_events (
    id TEXT PRIMARY KEY,
    parentId TEXT,
    fragmentId TEXT,
    tick INTEGER NOT NULL,
    createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    proposalId TEXT,
    eventType TEXT NOT NULL,
    message TEXT,
    payloadJson TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS idx_ig_events_tick ON ig_lab_events(tick)",
  "CREATE INDEX IF NOT EXISTS idx_ig_events_fragment ON ig_lab_events(fragmentId)",
  "CREATE INDEX IF NOT EXISTS idx_ig_events_proposal ON ig_lab_events(proposalId)",
  "CREATE INDEX IF NOT EXISTS idx_ig_events_type ON ig_lab_events(eventType)",
  `CREATE TABLE IF NOT EXISTS semeiotic_events (
    id TEXT PRIMARY KEY,
    parentId TEXT,
    fragmentId TEXT,
    tick INTEGER NOT NULL,
    createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    proposalId TEXT,
    eventType TEXT NOT NULL,
    message TEXT,
    payloadJson TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS idx_semeiotic_events_tick ON semeiotic_events(tick)",
  "CREATE INDEX IF NOT EXISTS idx_semeiotic_events_fragment ON semeiotic_events(fragmentId)",
  "CREATE INDEX IF NOT EXISTS idx_semeiotic_events_proposal ON semeiotic_events(proposalId)",
  "CREATE INDEX IF NOT EXISTS idx_semeiotic_events_type ON semeiotic_events(eventType)",
  `CREATE TABLE IF NOT EXISTS dialectical_moments (
    id TEXT PRIMARY KEY,
    parentId TEXT,
    fragmentId TEXT,
    proposalId TEXT,
    dialecticMoveId TEXT,
    tick INTEGER NOT NULL,
    createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    provider TEXT,
    role TEXT NOT NULL,
    source TEXT,
    summary TEXT,
    rawArtifactPointer TEXT,
    structuredArtifactPath TEXT,
    providerOutputLinksJson TEXT,
    rawSourcesJson TEXT,
    linkedMomentIdsJson TEXT,
    notesJson TEXT,
    semeioticObjectTerm TEXT,
    semeioticSignTerm TEXT,
    semeioticInterpretantTerm TEXT,
    semeioticConfidence REAL,
    mismatchCount INTEGER NOT NULL DEFAULT 0,
    mismatchesJson TEXT,
    claimCount INTEGER NOT NULL DEFAULT 0,
    objectionCount INTEGER NOT NULL DEFAULT 0,
    repairCount INTEGER NOT NULL DEFAULT 0,
    branchCount INTEGER NOT NULL DEFAULT 0,
    triadicEntropy REAL,
    annotationDensity REAL,
    confidenceSpread REAL,
    ontologyAlignmentStrength REAL,
    interpretantInstability REAL,
    objectSignMismatch REAL,
    triadicImbalance REAL,
    internalAmbiguity REAL,
    signEventBranchingComplexity REAL,
    critiqueInducedReinterpretationDepth REAL,
    overallComplexity REAL,
    payloadJson TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dialectical_moments_tick ON dialectical_moments(tick)",
  "CREATE INDEX IF NOT EXISTS idx_dialectical_moments_fragment ON dialectical_moments(fragmentId)",
  "CREATE INDEX IF NOT EXISTS idx_dialectical_moments_proposal ON dialectical_moments(proposalId)",
  "CREATE INDEX IF NOT EXISTS idx_dialectical_moments_move ON dialectical_moments(dialecticMoveId)",
  "CREATE INDEX IF NOT EXISTS idx_dialectical_moments_parent ON dialectical_moments(parentId)",
  "CREATE INDEX IF NOT EXISTS idx_dialectical_moments_terms ON dialectical_moments(semeioticObjectTerm, semeioticSignTerm, semeioticInterpretantTerm)",
  "ALTER TABLE dialectical_moments ADD COLUMN dialecticMoveId TEXT",
  "ALTER TABLE dialectical_moments ADD COLUMN rawArtifactPointer TEXT",
  "ALTER TABLE dialectical_moments ADD COLUMN structuredArtifactPath TEXT",
  "ALTER TABLE dialectical_moments ADD COLUMN providerOutputLinksJson TEXT",
  "ALTER TABLE dialectical_moments ADD COLUMN rawSourcesJson TEXT",
  "ALTER TABLE dialectical_moments ADD COLUMN linkedMomentIdsJson TEXT",
  "ALTER TABLE dialectical_moments ADD COLUMN notesJson TEXT",
  "ALTER TABLE dialectical_moments ADD COLUMN semeioticObjectTerm TEXT",
  "ALTER TABLE dialectical_moments ADD COLUMN semeioticSignTerm TEXT",
  "ALTER TABLE dialectical_moments ADD COLUMN semeioticInterpretantTerm TEXT",
  "ALTER TABLE dialectical_moments ADD COLUMN semeioticConfidence REAL",
  "ALTER TABLE dialectical_moments ADD COLUMN mismatchCount INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE dialectical_moments ADD COLUMN mismatchesJson TEXT",
  "ALTER TABLE dialectical_moments ADD COLUMN claimCount INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE dialectical_moments ADD COLUMN objectionCount INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE dialectical_moments ADD COLUMN repairCount INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE dialectical_moments ADD COLUMN branchCount INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE dialectical_moments ADD COLUMN triadicEntropy REAL",
  "ALTER TABLE dialectical_moments ADD COLUMN annotationDensity REAL",
  "ALTER TABLE dialectical_moments ADD COLUMN confidenceSpread REAL",
  "ALTER TABLE dialectical_moments ADD COLUMN ontologyAlignmentStrength REAL",
  "ALTER TABLE dialectical_moments ADD COLUMN interpretantInstability REAL",
  "ALTER TABLE dialectical_moments ADD COLUMN objectSignMismatch REAL",
  "ALTER TABLE dialectical_moments ADD COLUMN triadicImbalance REAL",
  "ALTER TABLE dialectical_moments ADD COLUMN internalAmbiguity REAL",
  "ALTER TABLE dialectical_moments ADD COLUMN signEventBranchingComplexity REAL",
  "ALTER TABLE dialectical_moments ADD COLUMN critiqueInducedReinterpretationDepth REAL",
  "ALTER TABLE dialectical_moments ADD COLUMN overallComplexity REAL",
  "ALTER TABLE dialectical_moments ADD COLUMN payloadJson TEXT",
  `CREATE TABLE IF NOT EXISTS semeiotic_links (
    id TEXT PRIMARY KEY,
    parentId TEXT,
    fragmentId TEXT,
    proposalId TEXT,
    tick INTEGER NOT NULL,
    createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sourceMomentId TEXT,
    targetMomentId TEXT,
    sourceNodeId TEXT,
    targetNodeId TEXT,
    relationType TEXT NOT NULL,
    chainKind TEXT,
    mismatchKind TEXT,
    summary TEXT,
    strength REAL,
    metadataJson TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS idx_semeiotic_links_tick ON semeiotic_links(tick)",
  "CREATE INDEX IF NOT EXISTS idx_semeiotic_links_fragment ON semeiotic_links(fragmentId)",
  "CREATE INDEX IF NOT EXISTS idx_semeiotic_links_proposal ON semeiotic_links(proposalId)",
  "CREATE INDEX IF NOT EXISTS idx_semeiotic_links_source_target_moment ON semeiotic_links(sourceMomentId, targetMomentId)",
  "CREATE INDEX IF NOT EXISTS idx_semeiotic_links_relation_type ON semeiotic_links(relationType)",
  `CREATE TABLE IF NOT EXISTS semeiotic_summaries (
    id TEXT PRIMARY KEY,
    parentId TEXT,
    fragmentId TEXT,
    proposalId TEXT,
    tick INTEGER NOT NULL,
    createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sourceKind TEXT,
    objectTerm TEXT,
    signTerm TEXT,
    interpretantTerm TEXT,
    confidence REAL,
    momentCount INTEGER NOT NULL DEFAULT 0,
    mismatchCount INTEGER NOT NULL DEFAULT 0,
    artifactPath TEXT,
    providerOutputLinksJson TEXT,
    summariesJson TEXT,
    payloadJson TEXT
  )`,
  "ALTER TABLE semeiotic_summaries ADD COLUMN artifactPath TEXT",
  "ALTER TABLE semeiotic_summaries ADD COLUMN providerOutputLinksJson TEXT",
  "CREATE INDEX IF NOT EXISTS idx_semeiotic_summaries_tick ON semeiotic_summaries(tick)",
  "CREATE INDEX IF NOT EXISTS idx_semeiotic_summaries_fragment ON semeiotic_summaries(fragmentId)",
  "CREATE INDEX IF NOT EXISTS idx_semeiotic_summaries_proposal ON semeiotic_summaries(proposalId)",
];

type PythonCommand = {
  command: string;
  args: string[];
};

export interface HistorySqliteInitializationResult {
  available: boolean;
  initialized: boolean;
  databasePath: string;
  attemptedCommands: string[];
  stdout: string;
  stderr: string;
  error?: string;
}

function isNodeRuntime() {
  const runtime = globalThis as { process?: { versions?: { node?: string } } };
  return typeof runtime.process?.versions?.node === "string";
}

function pythonCommandCandidates(
  databasePath: string,
  schemaBase64: string,
  migrationsBase64: string,
): PythonCommand[] {
  const script = [
    "import base64, json, pathlib, sqlite3, sys",
    "db_path = pathlib.Path(sys.argv[1])",
    "schema = base64.b64decode(sys.argv[2]).decode('utf-8')",
    "migrations = json.loads(base64.b64decode(sys.argv[3]).decode('utf-8'))",
    "db_path.parent.mkdir(parents=True, exist_ok=True)",
    "conn = sqlite3.connect(str(db_path))",
    "try:",
    "    conn.executescript(schema)",
    "    for statement in migrations:",
    "        try:",
    "            conn.execute(statement)",
    "        except sqlite3.OperationalError as exc:",
    "            if 'duplicate column name' not in str(exc).lower():",
    "                raise",
    "    conn.commit()",
    "finally:",
    "    conn.close()",
  ].join("\n");

  const sharedArgs = ["-c", script, databasePath, schemaBase64, migrationsBase64];
  const commands: PythonCommand[] = [{ command: "python", args: sharedArgs }];

  if (process.platform === "win32") {
    commands.push({
      command: "py",
      args: ["-3", ...sharedArgs],
    });
  } else {
    commands.push({
      command: "python3",
      args: sharedArgs,
    });
  }

  return commands;
}

async function runPythonInitializer(candidate: PythonCommand, workingDirectory: string) {
  const { spawn } = await importNodeModule<typeof import("node:child_process")>("node:child_process");

  return await new Promise<{
    exitCode: number | null;
    stdout: string;
    stderr: string;
    error?: string;
  }>((resolve) => {
    let stdout = "";
    let stderr = "";

    const child = spawn(candidate.command, candidate.args, {
      cwd: workingDirectory,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      resolve({
        exitCode: null,
        stdout,
        stderr,
        error: error.message,
      });
    });

    child.on("close", (exitCode) => {
      resolve({
        exitCode,
        stdout,
        stderr,
      });
    });
  });
}

export async function initializeHistorySqlite(databasePath = HISTORY_SQLITE_PATH): Promise<HistorySqliteInitializationResult> {
  if (!isNodeRuntime()) {
    return {
      available: false,
      initialized: false,
      databasePath,
      attemptedCommands: [],
      stdout: "",
      stderr: "",
      error: "SQLite initialization requires a Node runtime.",
    };
  }

  const path = await importNodeModule<typeof import("node:path")>("node:path");
  const fs = await importNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
  const resolvedDatabasePath = path.resolve(process.cwd(), databasePath);
  const schemaBase64 = Buffer.from(HISTORY_SQLITE_SCHEMA, "utf8").toString("base64");
  const migrationsBase64 = Buffer.from(JSON.stringify(HISTORY_SQLITE_MIGRATIONS), "utf8").toString("base64");
  const attemptedCommands: string[] = [];

  await fs.mkdir(path.dirname(resolvedDatabasePath), { recursive: true });

  let combinedStdout = "";
  let combinedStderr = "";

  for (const candidate of pythonCommandCandidates(resolvedDatabasePath, schemaBase64, migrationsBase64)) {
    attemptedCommands.push([candidate.command, ...candidate.args.slice(0, 2)].join(" "));
    const result = await runPythonInitializer(candidate, process.cwd());
    combinedStdout += result.stdout;
    combinedStderr += result.stderr;

    if (result.exitCode === 0) {
      return {
        available: true,
        initialized: true,
        databasePath: resolvedDatabasePath,
        attemptedCommands,
        stdout: combinedStdout,
        stderr: combinedStderr,
      };
    }

    if (result.error) {
      combinedStderr += `${combinedStderr.endsWith("\n") || combinedStderr.length === 0 ? "" : "\n"}${result.error}`;
    }
  }

  return {
    available: false,
    initialized: false,
    databasePath: resolvedDatabasePath,
    attemptedCommands,
    stdout: combinedStdout,
    stderr: combinedStderr,
    error: "Unable to initialize SQLite history database with an available Python runtime.",
  };
}
