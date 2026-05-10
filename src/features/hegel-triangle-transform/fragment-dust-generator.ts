import { createDefaultAppViewState, createInitialSimulationState } from "@/lib/hegel-triangle-model";
import type {
  AppViewState,
  ExposedConnection,
  ExposedConnectionId,
  FragmentId,
  FragmentPhase,
  FragmentLifecycleStatus,
  FragmentPromotion,
  FragmentVertex,
  FragmentVertexId,
  HegelTriangleFragmentTransformSnapshot,
  LeanTaskId,
  LeanTaskRef,
  LocalGraphEdge,
  LocalGraphEdgeId,
  Point2D,
  ProposalOutcomeRecord,
  ProposalOutcomeState,
  ReplayLogEntry,
  SemanticPayload,
  SemanticProposal,
  SemanticProposalId,
  SimulationState,
  TriangleFragment,
  TriangleFragmentLabels,
} from "@/types/hegel-triangle";
import {
  distanceBetween,
  generateTriangleGeometry,
  lerpPoint,
  pushAwayFrom,
  type TriangleBranch,
  type TriangleGeometryNode,
} from "./geometry";
import { resolveStatisticalEmbeddingState } from "./information-geometry";

export interface FragmentDustGeneratorOptions {
  depth: number;
  seed: string;
  activePath?: string;
}

export interface FragmentDustGenerationResult {
  seed: string;
  depth: number;
  activeFragmentId?: FragmentId;
  activeProposalId?: SemanticProposalId;
  simulation: SimulationState;
}

interface FragmentBuildRecord {
  geometry: TriangleGeometryNode;
  fragmentId: FragmentId;
  anchorVertexId: FragmentVertexId;
  cornerVertexIds: [FragmentVertexId, FragmentVertexId, FragmentVertexId];
  connectionVertexIds: [FragmentVertexId, FragmentVertexId];
  connectionIds: [ExposedConnectionId, ExposedConnectionId];
  edgeIds: [LocalGraphEdgeId, LocalGraphEdgeId, LocalGraphEdgeId];
  proposalId: SemanticProposalId;
  leanTaskId: LeanTaskId;
}

interface GraphBuildContext {
  seed: string;
  depth: number;
  activePath: string;
  fragments: Record<FragmentId, TriangleFragment>;
  vertices: Record<FragmentVertexId, FragmentVertex>;
  exposedConnections: Record<ExposedConnectionId, ExposedConnection>;
  edges: Record<LocalGraphEdgeId, LocalGraphEdge>;
  proposals: Record<SemanticProposalId, SemanticProposal>;
  leanTasks: Record<LeanTaskId, LeanTaskRef>;
  acceptedHistory: ProposalOutcomeRecord[];
  rejectedHistory: ProposalOutcomeRecord[];
  replayLog: ReplayLogEntry[];
  recordsByPath: Record<string, FragmentBuildRecord>;
}

function normalizeDepth(depth: number) {
  return Math.max(0, Math.floor(depth));
}

function slugFromPath(path: string): string {
  return path.replaceAll(".", "_");
}

function fragmentIdFor(path: string): FragmentId {
  return `fragment_${slugFromPath(path)}` as FragmentId;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function combineSeed(seed: string, path: string): number {
  return hashString(`${seed}:${path}`);
}

function pickSeedFloat(seed: string, key: string): number {
  const hash = hashString(`${seed}:${key}`);
  return (hash % 10000) / 10000;
}

function branchCode(branch: TriangleBranch): string {
  switch (branch) {
    case "top":
      return "T";
    case "left":
      return "L";
    case "right":
      return "R";
    case "root":
    default:
      return "O";
  }
}

function pathCode(path: string): string {
  const segments = path.split(".").slice(1);
  if (segments.length === 0) {
    return "ROOT";
  }
  return segments.map((segment) => branchCode(segment as TriangleBranch)).join("");
}

function branchPriority(branch: TriangleBranch) {
  switch (branch) {
    case "top":
      return 0;
    case "left":
      return 1;
    case "right":
      return 2;
    case "root":
    default:
      return -1;
  }
}

function defaultActivePath(depth: number): string {
  const segments: TriangleBranch[] = ["top", "right", "left", "top"];
  if (depth === 0) {
    return "root";
  }

  const trimmed = segments.slice(0, Math.min(depth, segments.length));
  return `root.${trimmed.join(".")}`;
}

function statusForNode(seed: string, node: TriangleGeometryNode, activePath: string): FragmentLifecycleStatus {
  if (node.path === "root") {
    return "persistent";
  }
  if (node.path === activePath) {
    return "verifying";
  }

  const hash = combineSeed(seed, node.path);
  if (node.depth === 1 && node.branch === "left") {
    return "persistent";
  }
  if (node.depth === 1 && node.branch === "right") {
    return "rejected";
  }
  if (node.depth === 2 && node.branch === "top") {
    return "proposing";
  }
  if (hash % 11 === 0) {
    return "persistent";
  }
  if (hash % 7 === 0) {
    return "rejected";
  }
  if (hash % 5 === 0) {
    return "blocked";
  }
  if (hash % 3 === 0) {
    return "inspecting";
  }
  return "active";
}

function outcomeForStatus(status: FragmentLifecycleStatus): ProposalOutcomeState {
  switch (status) {
    case "persistent":
    case "accepted":
      return "accepted";
    case "rejected":
      return "rejected";
    case "blocked":
      return "blocked";
    case "verifying":
      return "promising";
    case "archived":
      return "vacuous";
    default:
      return "pending";
  }
}

function edgeStatusForFragment(status: FragmentLifecycleStatus): LocalGraphEdge["status"] {
  switch (status) {
    case "persistent":
    case "accepted":
      return "accepted";
    case "rejected":
      return "rejected";
    case "blocked":
      return "blocked";
    case "verifying":
      return "highlighted";
    default:
      return "active";
  }
}

function graphEdgeStatusForOutcome(outcome: ProposalOutcomeState): LocalGraphEdge["status"] {
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

function leanTaskStatusForOutcome(outcome: ProposalOutcomeState): LeanTaskRef["status"] {
  switch (outcome) {
    case "accepted":
      return "succeeded";
    case "rejected":
    case "blocked":
      return "failed";
    case "promising":
      return "running";
    case "vacuous":
      return "canceled";
    case "pending":
    default:
      return "queued";
  }
}

function proposalKindForBranch(branch: TriangleBranch): SemanticProposal["proposalKind"] {
  switch (branch) {
    case "top":
      return "candidate_theorem";
    case "left":
      return "candidate_definition";
    case "right":
      return "bridge_lemma";
    case "root":
    default:
      return "refinement_law";
  }
}

function semanticPayloadForNode(node: TriangleGeometryNode, status: FragmentLifecycleStatus): SemanticPayload {
  return {
    summary: `Depth ${node.depth} ${node.branch} fragment along path ${pathCode(node.path)} participates in the recursive blow-up dust.`,
    keywords: [node.branch, `depth-${node.depth}`, status, pathCode(node.path).toLowerCase()],
    theoremSketch:
      node.branch === "top"
        ? "A bridge claim attempts to preserve coherence across the opened central void."
        : undefined,
    definitionSketch:
      node.branch !== "top"
        ? "A local interface names the exposed seam produced by recursive refinement."
        : undefined,
    notes: "Generated fragment payload for the recursive fragment dust generator.",
  };
}

function labelsForNode(node: TriangleGeometryNode, status: FragmentLifecycleStatus): TriangleFragmentLabels {
  return {
    short: pathCode(node.path),
    title: `${node.branch === "root" ? "Root" : `${node.branch[0].toUpperCase()}${node.branch.slice(1)}`} Triangle Fragment`,
    semantic: `Depth ${node.depth} / ${status}`,
    theorem: node.branch === "top" ? `Bridge theorem ${pathCode(node.path)}` : undefined,
    definition: node.branch !== "top" ? `Interface ${pathCode(node.path)}` : undefined,
    tags: [`depth-${node.depth}`, node.branch, status],
  };
}

function buildPromotion(
  fragmentId: FragmentId,
  status: FragmentLifecycleStatus,
  proposalId: SemanticProposalId,
  tick: number,
): FragmentPromotion {
  const isPersistent = status === "persistent" || status === "accepted";
  return {
    fragmentId,
    isPersistent,
    promotedAtTick: isPersistent ? tick : undefined,
    layer: isPersistent ? "persistent" : status === "verifying" ? "candidate" : "frontier",
    reason: isPersistent ? "accepted_proposal" : undefined,
    acceptedProposalIds: isPersistent ? [proposalId] : [],
  };
}

function phaseForStatus(status: FragmentLifecycleStatus): FragmentPhase {
  switch (status) {
    case "blocked":
    case "rejected":
    case "archived":
      return "externalized";
    case "verifying":
      return "crystallizing";
    case "persistent":
    case "accepted":
      return "stabilized";
    case "proposing":
    case "inspecting":
      return "nucleating";
    case "seed":
    case "active":
    default:
      return "latent";
  }
}

function createCornerVertex(
  id: FragmentVertexId,
  fragmentId: FragmentId,
  point: Point2D,
  role: FragmentVertex["role"],
  label: string,
): FragmentVertex {
  return {
    id,
    fragmentId,
    point,
    role,
    occupancy: role === "anchor" ? "claimed" : "shared",
    label,
    exposedConnectionIds: [],
    incidentEdgeIds: [],
    semanticTags: role === "anchor" ? ["anchor", "inherited"] : ["corner", "boundary"],
    ...resolveStatisticalEmbeddingState({
      key: `${fragmentId}:${id}:${role}:${Math.round(point.x)}:${Math.round(point.y)}`,
    }),
  };
}

function createConnectionVertex(
  id: FragmentVertexId,
  fragmentId: FragmentId,
  point: Point2D,
  label: string,
): FragmentVertex {
  return {
    id,
    fragmentId,
    point,
    role: "exposed",
    occupancy: "open",
    label,
    exposedConnectionIds: [],
    incidentEdgeIds: [],
    semanticTags: ["exposed", "interface"],
    ...resolveStatisticalEmbeddingState({
      key: `${fragmentId}:${id}:exposed:${Math.round(point.x)}:${Math.round(point.y)}`,
    }),
  };
}

function appendIncidentEdge(
  vertices: Record<FragmentVertexId, FragmentVertex>,
  vertexId: FragmentVertexId,
  edgeId: LocalGraphEdgeId,
) {
  const vertex = vertices[vertexId];
  vertices[vertexId] = {
    ...vertex,
    incidentEdgeIds: vertex.incidentEdgeIds.includes(edgeId)
      ? vertex.incidentEdgeIds
      : [...vertex.incidentEdgeIds, edgeId],
  };
}

function registerEdge(
  context: GraphBuildContext,
  id: LocalGraphEdgeId,
  fragmentId: FragmentId,
  sourceVertexId: FragmentVertexId,
  targetVertexId: FragmentVertexId,
  kind: LocalGraphEdge["kind"],
  status: LocalGraphEdge["status"],
  label: string,
  weight: number,
) {
  context.edges[id] = {
    id,
    fragmentId,
    sourceVertexId,
    targetVertexId,
    kind,
    status,
    label,
    weight,
  };
  appendIncidentEdge(context.vertices, sourceVertexId, id);
  appendIncidentEdge(context.vertices, targetVertexId, id);
}

function registerConnection(
  context: GraphBuildContext,
  id: ExposedConnectionId,
  fragmentId: FragmentId,
  vertexId: FragmentVertexId,
  kind: ExposedConnection["kind"],
  status: ExposedConnection["status"],
  label: string,
  semanticHint: string,
) {
  context.exposedConnections[id] = {
    id,
    fragmentId,
    vertexId,
    kind,
    status,
    label,
    semanticHint,
  };
  const vertex = context.vertices[vertexId];
  context.vertices[vertexId] = {
    ...vertex,
    exposedConnectionIds: [...vertex.exposedConnectionIds, id],
  };
}

function addConnectionBridge(
  context: GraphBuildContext,
  id: LocalGraphEdgeId,
  sourceVertexId: FragmentVertexId,
  targetVertexId: FragmentVertexId,
  fragmentId: FragmentId,
  label: string,
  status: LocalGraphEdge["status"],
  weight = 1.15,
) {
  registerEdge(
    context,
    id,
    fragmentId,
    sourceVertexId,
    targetVertexId,
    "semantic_relation",
    status,
    label,
    weight,
  );
}

function connectionPoint(anchor: Point2D, corner: Point2D, centroid: Point2D, depth: number): Point2D {
  const sidePoint = lerpPoint(anchor, corner, 0.72);
  const outwardDistance = 16 + depth * 5;
  return pushAwayFrom(centroid, sidePoint, outwardDistance);
}

function buildFragmentRecord(node: TriangleGeometryNode, context: GraphBuildContext): FragmentBuildRecord {
  const fragmentId = fragmentIdFor(node.path);
  const slug = slugFromPath(node.path);
  const status = statusForNode(context.seed, node, context.activePath);
  const outcome = outcomeForStatus(status);
  const proposalKind = proposalKindForBranch(node.branch);

  const anchorVertexId = `fragment_vertex_${slug}_anchor` as FragmentVertexId;
  const leftVertexId = `fragment_vertex_${slug}_left` as FragmentVertexId;
  const rightVertexId = `fragment_vertex_${slug}_right` as FragmentVertexId;
  const leftConnectionVertexId = `fragment_vertex_${slug}_exposed_left` as FragmentVertexId;
  const rightConnectionVertexId = `fragment_vertex_${slug}_exposed_right` as FragmentVertexId;

  const connectionPointLeft = connectionPoint(node.points[0], node.points[1], node.centroid, node.depth);
  const connectionPointRight = connectionPoint(node.points[0], node.points[2], node.centroid, node.depth);

  context.vertices[anchorVertexId] = createCornerVertex(anchorVertexId, fragmentId, node.points[0], "anchor", `${pathCode(node.path)} anchor`);
  context.vertices[leftVertexId] = createCornerVertex(leftVertexId, fragmentId, node.points[1], "internal", `${pathCode(node.path)} left`);
  context.vertices[rightVertexId] = createCornerVertex(rightVertexId, fragmentId, node.points[2], "internal", `${pathCode(node.path)} right`);
  context.vertices[leftConnectionVertexId] = createConnectionVertex(leftConnectionVertexId, fragmentId, connectionPointLeft, `${pathCode(node.path)} interface A`);
  context.vertices[rightConnectionVertexId] = createConnectionVertex(rightConnectionVertexId, fragmentId, connectionPointRight, `${pathCode(node.path)} interface B`);

  const edgeIds: [LocalGraphEdgeId, LocalGraphEdgeId, LocalGraphEdgeId] = [
    `local_edge_${slug}_anchor_left` as LocalGraphEdgeId,
    `local_edge_${slug}_anchor_right` as LocalGraphEdgeId,
    `local_edge_${slug}_left_right` as LocalGraphEdgeId,
  ];

  const edgeStatus = edgeStatusForFragment(status);
  registerEdge(context, edgeIds[0], fragmentId, anchorVertexId, leftVertexId, "fragment_boundary", edgeStatus, `${pathCode(node.path)} anchor-left`, 1);
  registerEdge(context, edgeIds[1], fragmentId, anchorVertexId, rightVertexId, "fragment_boundary", edgeStatus, `${pathCode(node.path)} anchor-right`, 1);
  registerEdge(context, edgeIds[2], fragmentId, leftVertexId, rightVertexId, "fragment_boundary", edgeStatus, `${pathCode(node.path)} base`, 1.08);

  registerEdge(
    context,
    `local_edge_${slug}_interface_left` as LocalGraphEdgeId,
    fragmentId,
    leftVertexId,
    leftConnectionVertexId,
    "proposal_dependency",
    graphEdgeStatusForOutcome(outcome),
    `${pathCode(node.path)} exposed hinge A`,
    1.1,
  );
  registerEdge(
    context,
    `local_edge_${slug}_interface_right` as LocalGraphEdgeId,
    fragmentId,
    rightVertexId,
    rightConnectionVertexId,
    "proposal_dependency",
    graphEdgeStatusForOutcome(outcome),
    `${pathCode(node.path)} exposed hinge B`,
    1.1,
  );

  const connectionIds: [ExposedConnectionId, ExposedConnectionId] = [
    `exposed_connection_${slug}_left` as ExposedConnectionId,
    `exposed_connection_${slug}_right` as ExposedConnectionId,
  ];
  registerConnection(
    context,
    connectionIds[0],
    fragmentId,
    leftConnectionVertexId,
    node.depth === 0 ? "inherited_anchor" : "fresh_interface",
    outcome === "blocked" ? "saturated" : outcome === "accepted" ? "engaged" : "available",
    `${pathCode(node.path)} exposed seam A`,
    "First exposed seam carried forward into the fragment dust.",
  );
  registerConnection(
    context,
    connectionIds[1],
    fragmentId,
    rightConnectionVertexId,
    outcome === "accepted" ? "persistent_bridge" : "candidate_bridge",
    outcome === "rejected" ? "retired" : outcome === "accepted" ? "engaged" : "available",
    `${pathCode(node.path)} exposed seam B`,
    "Second exposed seam available for bridge formation.",
  );

  const proposalId = `semantic_proposal_${slug}` as SemanticProposalId;
  const leanTaskId = `lean_task_${slug}` as LeanTaskId;
  const baseTick = Math.max(1, node.depth * 2 + (combineSeed(context.seed, node.path) % 3));
  const updatedAtTick = status === "verifying" ? baseTick + 1 : baseTick;

  context.leanTasks[leanTaskId] = {
    id: leanTaskId,
    status: leanTaskStatusForOutcome(outcome),
    requestedAtTick: baseTick,
    startedAtTick: baseTick,
    completedAtTick:
      outcome === "accepted" || outcome === "rejected" || outcome === "blocked" || outcome === "vacuous"
        ? updatedAtTick
        : undefined,
    attemptCount: 1,
    lastError: outcome === "rejected" ? `Mock proof failed along ${pathCode(node.path)} bridge alignment.` : undefined,
    diagnostics: [
      `depth ${node.depth} refinement`,
      `${node.branch} branch interface normalization`,
      `status ${status}`,
    ],
  };

  context.proposals[proposalId] = {
    id: proposalId,
    fragmentId,
    title: `${pathCode(node.path)} ${proposalKind.replaceAll("_", " ")}`,
    proposalKind,
    source: { entityType: "vertex", vertexId: leftConnectionVertexId },
    target: { entityType: "vertex", vertexId: rightConnectionVertexId },
    naturalLanguageSummary: `${pathCode(node.path)} proposes a local semantic move across its two exposed interfaces.`,
    theoremSummary:
      node.branch === "top"
        ? `Bridge theorem candidate for ${pathCode(node.path)}.`
        : `Interface refinement candidate for ${pathCode(node.path)}.`,
    mockLeanCode:
      node.branch === "top"
        ? `theorem ${slug}_bridge : FragmentBridge := by\n  admit`
        : `def ${slug}_interface : FragmentInterface := by\n  exact placeholderInterface`,
    verificationState: outcome,
    confidence: Number((0.48 + pickSeedFloat(context.seed, `${node.path}:confidence`) * 0.34).toFixed(2)),
    score: Number((0.42 + pickSeedFloat(context.seed, `${node.path}:score`) * 0.48).toFixed(2)),
    priority: Number((0.5 + pickSeedFloat(context.seed, `${node.path}:priority`) * 0.44).toFixed(2)),
    createdAtTick: baseTick,
    updatedAtTick,
    corpusSupport: [],
    leanTask: context.leanTasks[leanTaskId],
    ...resolveStatisticalEmbeddingState({
      key: `${context.seed}:${proposalId}`,
    }),
  };

  if (outcome === "accepted") {
    context.acceptedHistory.push({
      proposalId,
      fragmentId,
      outcome,
      recordedAtTick: updatedAtTick,
      summary: `${pathCode(node.path)} accepted into the persistent layer.`,
      leanTaskId,
    });
  }

  if (outcome === "rejected") {
    context.rejectedHistory.push({
      proposalId,
      fragmentId,
      outcome,
      recordedAtTick: updatedAtTick,
      summary: `${pathCode(node.path)} rejected during mock verification.`,
      leanTaskId,
    });
  }

  const childPaths = [`${node.path}.top`, `${node.path}.left`, `${node.path}.right`];
  context.fragments[fragmentId] = {
    id: fragmentId,
    generationDepth: node.depth,
    parentFragmentId: node.parentPath ? fragmentIdFor(node.parentPath) : undefined,
    childFragmentIds: node.depth < context.depth ? childPaths.map(fragmentIdFor) : [],
    inheritedAnchor: anchorVertexId,
    newlyExposedConnectionIds: connectionIds,
    position: node.centroid,
    centroid: node.centroid,
    vertexIds: [anchorVertexId, leftVertexId, rightVertexId],
    edgeIds,
    status,
    phase: phaseForStatus(status),
    catastrophe: false,
    catastropheScore: 0,
    labels: labelsForNode(node, status),
    semanticPayload: semanticPayloadForNode(node, status),
    promotion: buildPromotion(fragmentId, status, proposalId, updatedAtTick),
    activeProposalIds: [proposalId],
    ...resolveStatisticalEmbeddingState({
      key: `${context.seed}:${fragmentId}`,
    }),
  };

  return {
    geometry: node,
    fragmentId,
    anchorVertexId,
    cornerVertexIds: [anchorVertexId, leftVertexId, rightVertexId],
    connectionVertexIds: [leftConnectionVertexId, rightConnectionVertexId],
    connectionIds,
    edgeIds,
    proposalId,
    leanTaskId,
  };
}

function buildCrossLayerGraph(context: GraphBuildContext, geometryNodes: TriangleGeometryNode[]) {
  const nodesByParent = new Map<string, TriangleGeometryNode[]>();
  for (const node of geometryNodes) {
    if (!node.parentPath) {
      continue;
    }
    const siblings = nodesByParent.get(node.parentPath) ?? [];
    siblings.push(node);
    nodesByParent.set(node.parentPath, siblings);
  }

  for (const node of geometryNodes) {
    if (!node.parentPath) {
      continue;
    }
    const record = context.recordsByPath[node.path];
    const parent = context.recordsByPath[node.parentPath];
    if (!record || !parent) {
      continue;
    }

    const fragmentStatus = context.fragments[record.fragmentId].status;
    const bridgeStatus = graphEdgeStatusForOutcome(outcomeForStatus(fragmentStatus));
    const parentTarget =
      node.branch === "right"
        ? parent.connectionVertexIds[1]
        : parent.connectionVertexIds[0];
    const childSource =
      node.branch === "left"
        ? record.connectionVertexIds[1]
        : record.connectionVertexIds[0];

    addConnectionBridge(
      context,
      `local_edge_${slugFromPath(node.path)}_to_parent` as LocalGraphEdgeId,
      childSource,
      parentTarget,
      record.fragmentId,
      `${pathCode(node.path)} parent tether`,
      bridgeStatus,
      1.18,
    );
  }

  for (const [parentPath, siblingNodes] of nodesByParent.entries()) {
    if (siblingNodes.length !== 3) {
      continue;
    }

    const orderedSiblings = [...siblingNodes].sort((left, right) => branchPriority(left.branch) - branchPriority(right.branch));
    const [top, left, right] = orderedSiblings;
    if (!top || !left || !right) {
      continue;
    }

    const topRecord = context.recordsByPath[top.path];
    const leftRecord = context.recordsByPath[left.path];
    const rightRecord = context.recordsByPath[right.path];
    if (!topRecord || !leftRecord || !rightRecord) {
      continue;
    }

    const topStatus = graphEdgeStatusForOutcome(outcomeForStatus(context.fragments[topRecord.fragmentId].status));
    const leftStatus = graphEdgeStatusForOutcome(outcomeForStatus(context.fragments[leftRecord.fragmentId].status));
    const rightStatus = graphEdgeStatusForOutcome(outcomeForStatus(context.fragments[rightRecord.fragmentId].status));

    addConnectionBridge(
      context,
      `local_edge_${slugFromPath(parentPath)}_central_top_left` as LocalGraphEdgeId,
      topRecord.connectionVertexIds[0],
      leftRecord.connectionVertexIds[1],
      topRecord.fragmentId,
      `${pathCode(parentPath)} central seam A`,
      topStatus,
      1.22,
    );
    addConnectionBridge(
      context,
      `local_edge_${slugFromPath(parentPath)}_central_top_right` as LocalGraphEdgeId,
      topRecord.connectionVertexIds[1],
      rightRecord.connectionVertexIds[0],
      topRecord.fragmentId,
      `${pathCode(parentPath)} central seam B`,
      topStatus,
      1.22,
    );
    addConnectionBridge(
      context,
      `local_edge_${slugFromPath(parentPath)}_central_left_right` as LocalGraphEdgeId,
      leftRecord.connectionVertexIds[0],
      rightRecord.connectionVertexIds[1],
      leftRecord.fragmentId,
      `${pathCode(parentPath)} transverse seam`,
      leftStatus === "accepted" || rightStatus === "accepted" ? "accepted" : "active",
      1.12,
    );
  }
}

function createReplayLog(context: GraphBuildContext, records: FragmentBuildRecord[]): ReplayLogEntry[] {
  const metricsPayloadForRecord = (record?: FragmentBuildRecord) => {
    const phase = record ? context.fragments[record.fragmentId]?.phase ?? "latent" : "latent";
    const proposal = record ? context.proposals[record.proposalId] : undefined;
    return {
      forward: 0,
      reverse: 0,
      asymmetry: 0,
      curvature: 0,
      projection:
        proposal?.verificationState === "accepted"
          ? 0
          : proposal?.verificationState === "blocked"
            ? 0.48
            : proposal?.verificationState === "rejected"
              ? 0.82
              : proposal?.verificationState === "promising"
                ? 0.14
                : proposal?.verificationState === "vacuous"
                  ? 0.26
                  : 0,
      phase,
    };
  };

  const log: ReplayLogEntry[] = [
    {
      id: "replay_event_boot",
      tick: 0,
      eventType: "simulation_started",
      message: `Recursive fragment dust initialized from the root triangle and expanded through depth ${context.depth}.`,
      payload: metricsPayloadForRecord(),
    },
  ];

  const acceptedRecords = records
    .filter((record) => context.proposals[record.proposalId].verificationState === "accepted")
    .slice(0, 8);
  const rejectedRecords = records
    .filter((record) => context.proposals[record.proposalId].verificationState === "rejected")
    .slice(0, 6);

  for (const record of acceptedRecords) {
    const proposal = context.proposals[record.proposalId];
    log.push({
      id: `replay_event_${record.fragmentId}_accepted`,
      tick: proposal.updatedAtTick,
      eventType: "fragment_promoted",
      fragmentId: record.fragmentId,
      proposalId: record.proposalId,
      message: `${context.fragments[record.fragmentId].labels.short} stabilized and entered the persistent layer.`,
      payload: metricsPayloadForRecord(record),
    });
  }

  for (const record of rejectedRecords) {
    const proposal = context.proposals[record.proposalId];
    log.push({
      id: `replay_event_${record.fragmentId}_rejected`,
      tick: proposal.updatedAtTick,
      eventType: "proposal_verified",
      fragmentId: record.fragmentId,
      proposalId: record.proposalId,
      message: `${context.fragments[record.fragmentId].labels.short} failed to bridge its exposed interfaces.`,
      payload: metricsPayloadForRecord(record),
    });
  }

  const activeRecord = context.recordsByPath[context.activePath];
  if (activeRecord) {
    log.push({
      id: "replay_event_active_fragment",
      tick: context.proposals[activeRecord.proposalId].updatedAtTick,
      eventType: "fragment_activated",
      fragmentId: activeRecord.fragmentId,
      proposalId: activeRecord.proposalId,
      message: `${context.fragments[activeRecord.fragmentId].labels.short} is currently active for theorem refinement.`,
      payload: metricsPayloadForRecord(activeRecord),
    });
  }

  return log.sort((left, right) => left.tick - right.tick).slice(-24);
}

export function generateFragmentDust(options: FragmentDustGeneratorOptions): FragmentDustGenerationResult {
  const depth = normalizeDepth(options.depth);
  const seed = options.seed;
  const activePath = options.activePath ?? defaultActivePath(depth);
  const geometryNodes = generateTriangleGeometry(depth);
  const context: GraphBuildContext = {
    seed,
    depth,
    activePath,
    fragments: {},
    vertices: {},
    exposedConnections: {},
    edges: {},
    proposals: {},
    leanTasks: {},
    acceptedHistory: [],
    rejectedHistory: [],
    replayLog: [],
    recordsByPath: {},
  };

  for (const node of geometryNodes) {
    const record = buildFragmentRecord(node, context);
    context.recordsByPath[node.path] = record;
  }

  buildCrossLayerGraph(context, geometryNodes);
  context.replayLog = createReplayLog(context, Object.values(context.recordsByPath));

  const simulation = createInitialSimulationState();
  const activeRecord = context.recordsByPath[activePath];
  simulation.runState = "paused";
  simulation.activeTick = depth * 3;
  simulation.activeFragmentId = activeRecord?.fragmentId;
  simulation.activeProposalId = activeRecord?.proposalId;
  simulation.proposalQueue = activeRecord ? [activeRecord.proposalId] : [];
  simulation.acceptedHistory = [...context.acceptedHistory].sort((left, right) => left.recordedAtTick - right.recordedAtTick);
  simulation.rejectedHistory = [...context.rejectedHistory].sort((left, right) => left.recordedAtTick - right.recordedAtTick);
  simulation.replayLog = context.replayLog;
  simulation.fragments = context.fragments;
  simulation.vertices = context.vertices;
  simulation.exposedConnections = context.exposedConnections;
  simulation.edges = context.edges;
  simulation.proposals = context.proposals;
  simulation.leanTasks = context.leanTasks;
  simulation.persistent.promotedFragmentIds = Object.values(context.fragments)
    .filter((fragment) => fragment.promotion.isPersistent)
    .map((fragment) => fragment.id);
  simulation.persistent.promotedProposalIds = simulation.acceptedHistory.map((entry) => entry.proposalId);
  simulation.persistent.acceptedConnectionIds = Object.values(context.exposedConnections)
    .filter((connection) => connection.kind === "persistent_bridge" || connection.status === "engaged")
    .map((connection) => connection.id);
  simulation.persistent.acceptedEdgeIds = Object.values(context.edges)
    .filter((edge) => edge.status === "accepted" || edge.kind === "persistent_relation")
    .map((edge) => edge.id);
  simulation.persistent.theoremStubs = simulation.acceptedHistory
    .map((entry) => simulation.proposals[entry.proposalId])
    .filter((proposal): proposal is SemanticProposal => Boolean(proposal))
    .filter((proposal) => proposal.proposalKind === "candidate_theorem" || proposal.proposalKind === "bridge_lemma")
    .map((proposal) => ({
      id: `persistent_stub_${proposal.id.replace("semantic_proposal_", "")}` as const,
      proposalId: proposal.id,
      fragmentId: proposal.fragmentId,
      kind: "theorem" as const,
      title: proposal.title,
      summary: proposal.theoremSummary,
      leanSnippet: proposal.mockLeanCode,
      promotedAtTick: proposal.updatedAtTick,
      layer: "canonical" as const,
    }));
  simulation.persistent.definitionStubs = simulation.acceptedHistory
    .map((entry) => simulation.proposals[entry.proposalId])
    .filter((proposal): proposal is SemanticProposal => Boolean(proposal))
    .filter((proposal) => proposal.proposalKind !== "candidate_theorem" && proposal.proposalKind !== "bridge_lemma")
    .map((proposal) => ({
      id: `persistent_stub_${proposal.id.replace("semantic_proposal_", "")}` as const,
      proposalId: proposal.id,
      fragmentId: proposal.fragmentId,
      kind: proposal.proposalKind === "candidate_definition" ? "definition" as const : "relation" as const,
      title: proposal.title,
      summary: proposal.theoremSummary,
      leanSnippet: proposal.mockLeanCode,
      promotedAtTick: proposal.updatedAtTick,
      layer: "canonical" as const,
    }));

  return {
    seed,
    depth,
    activeFragmentId: activeRecord?.fragmentId,
    activeProposalId: activeRecord?.proposalId,
    simulation,
  };
}

export function createFragmentDustSnapshot(options: FragmentDustGeneratorOptions): HegelTriangleFragmentTransformSnapshot {
  const result = generateFragmentDust(options);
  const view: AppViewState = createDefaultAppViewState();
  view.selectedFragmentId = result.activeFragmentId;
  view.selectedProposalId = result.activeProposalId;
  view.selectionMode = result.activeProposalId ? "proposal" : "none";
  view.renderMode = "generation";
  view.inspectorTab = "proposal";
  return {
    simulation: result.simulation,
    view,
  };
}

export function getFragmentRecord(simulation: SimulationState, fragmentId: FragmentId) {
  return simulation.fragments[fragmentId];
}

export function traverseDescendants(simulation: SimulationState, fragmentId: FragmentId): FragmentId[] {
  const descendants: FragmentId[] = [];
  const queue = [...(simulation.fragments[fragmentId]?.childFragmentIds ?? [])];

  while (queue.length > 0) {
    const nextId = queue.shift();
    if (!nextId) {
      continue;
    }
    descendants.push(nextId);
    queue.push(...simulation.fragments[nextId].childFragmentIds);
  }

  return descendants;
}

export function traverseAncestors(simulation: SimulationState, fragmentId: FragmentId): FragmentId[] {
  const ancestors: FragmentId[] = [];
  let currentId = simulation.fragments[fragmentId]?.parentFragmentId;

  while (currentId) {
    ancestors.push(currentId);
    currentId = simulation.fragments[currentId]?.parentFragmentId;
  }

  return ancestors;
}

export function findExposedConnectionPoints(simulation: SimulationState, fragmentId: FragmentId): FragmentVertex[] {
  const fragment = simulation.fragments[fragmentId];
  if (!fragment) {
    return [];
  }

  return fragment.newlyExposedConnectionIds
    .map((connectionId) => simulation.exposedConnections[connectionId])
    .filter(Boolean)
    .map((connection) => simulation.vertices[connection.vertexId]);
}

export function findNeighboringFragments(simulation: SimulationState, fragmentId: FragmentId): FragmentId[] {
  const fragment = simulation.fragments[fragmentId];
  if (!fragment) {
    return [];
  }

  const neighbors = new Set<FragmentId>();
  if (fragment.parentFragmentId) {
    neighbors.add(fragment.parentFragmentId);
    for (const siblingId of simulation.fragments[fragment.parentFragmentId].childFragmentIds) {
      if (siblingId !== fragmentId) {
        neighbors.add(siblingId);
      }
    }
  }

  for (const childId of fragment.childFragmentIds) {
    neighbors.add(childId);
  }

  for (const connectionId of fragment.newlyExposedConnectionIds) {
    const connection = simulation.exposedConnections[connectionId];
    if (connection?.connectedToVertexId) {
      neighbors.add(simulation.vertices[connection.connectedToVertexId].fragmentId);
    }
  }

  neighbors.delete(fragmentId);
  return [...neighbors];
}

export function selectLocalGraphNeighborhood(simulation: SimulationState, fragmentId: FragmentId, depth = 1) {
  const fragmentIds = new Set<FragmentId>();
  const edgeIds = new Set<LocalGraphEdgeId>();
  const vertexIds = new Set<FragmentVertexId>();
  const queue: Array<{ fragmentId: FragmentId; depth: number }> = [{ fragmentId, depth: 0 }];

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) {
      continue;
    }

    const fragment = simulation.fragments[next.fragmentId];
    if (!fragment || fragmentIds.has(next.fragmentId)) {
      continue;
    }

    fragmentIds.add(next.fragmentId);
    for (const vertexId of fragment.vertexIds) {
      vertexIds.add(vertexId);
    }
    for (const connectionId of fragment.newlyExposedConnectionIds) {
      const connection = simulation.exposedConnections[connectionId];
      if (connection) {
        vertexIds.add(connection.vertexId);
      }
    }

    for (const edge of Object.values(simulation.edges)) {
      const sourceFragmentId = simulation.vertices[edge.sourceVertexId].fragmentId;
      const targetFragmentId = simulation.vertices[edge.targetVertexId].fragmentId;
      if (sourceFragmentId === next.fragmentId || targetFragmentId === next.fragmentId || edge.fragmentId === next.fragmentId) {
        edgeIds.add(edge.id);
        vertexIds.add(edge.sourceVertexId);
        vertexIds.add(edge.targetVertexId);
      }
    }

    if (next.depth >= depth) {
      continue;
    }

    for (const neighborId of findNeighboringFragments(simulation, next.fragmentId)) {
      queue.push({ fragmentId: neighborId, depth: next.depth + 1 });
    }
  }

  return { fragmentIds, edgeIds, vertexIds };
}

export function fragmentDepthSummary(simulation: SimulationState): number {
  return Object.values(simulation.fragments).reduce(
    (maxDepth, fragment) => Math.max(maxDepth, fragment.generationDepth),
    0,
  );
}

export function fragmentSceneSpan(simulation: SimulationState): number {
  const triangles = Object.values(simulation.fragments);
  if (triangles.length === 0) {
    return 0;
  }

  return triangles.reduce((span, fragment) => {
    const [a, b, c] = fragment.vertexIds.map((vertexId) => simulation.vertices[vertexId].point);
    return Math.max(span, distanceBetween(a, b), distanceBetween(a, c), distanceBetween(b, c));
  }, 0);
}
