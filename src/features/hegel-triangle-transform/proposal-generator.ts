import type {
  ExposedConnection,
  FragmentId,
  FragmentVertex,
  LeanTaskId,
  LocalGraphEdge,
  ProposalEndpoint,
  ProposalKind,
  SemanticProposalId,
  SimulationState,
  StatisticalEmbeddingState,
  TriangleFragment,
} from "@/types/hegel-triangle";
import { resolveStatisticalEmbeddingState } from "./information-geometry";

const RULE_BASED_PROPOSAL_KINDS: readonly ProposalKind[] = [
  "candidate_theorem",
  "candidate_definition",
  "bridge_lemma",
  "projection_rule",
  "compatibility_claim",
  "obstruction_claim",
  "refinement_law",
];

export interface ProposalGenerationContext {
  simulation: SimulationState;
  fragment: TriangleFragment;
  tick: number;
  neighbors: TriangleFragment[];
  exposedConnections: ExposedConnection[];
  exposedPoints: FragmentVertex[];
  neighborhoodEdgeIds: Set<string>;
}

export interface GeneratedSemanticProposal extends StatisticalEmbeddingState {
  proposalId: SemanticProposalId;
  leanTaskId: LeanTaskId;
  title: string;
  kind: ProposalKind;
  source: ProposalEndpoint;
  target?: ProposalEndpoint;
  naturalLanguageSummary: string;
  theoremSummary: string;
  mockLeanCode: string;
  priority: number;
  score: number;
  confidence: number;
}

export interface SemanticProposalGenerator {
  generate(context: ProposalGenerationContext): GeneratedSemanticProposal[];
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

function proposalCount(fragmentId: FragmentId, tick: number) {
  return 1 + (hashString(`${fragmentId}:${tick}:proposal-count`) % 3);
}

function proposalKindPool(context: ProposalGenerationContext) {
  if (context.neighbors.length <= 1) {
    return ["candidate_definition", "obstruction_claim", "refinement_law"] satisfies ProposalKind[];
  }
  if (context.exposedConnections.length >= 2) {
    return ["bridge_lemma", "compatibility_claim", "candidate_theorem", "projection_rule"] satisfies ProposalKind[];
  }
  return [...RULE_BASED_PROPOSAL_KINDS];
}

function pickProposalKind(context: ProposalGenerationContext, index: number): ProposalKind {
  const pool = proposalKindPool(context);
  return pool[hashString(`${context.fragment.id}:${context.tick}:${index}:kind`) % pool.length];
}

function localGraphEdges(context: ProposalGenerationContext) {
  return Object.values(context.simulation.edges).filter(
    (edge) =>
      context.neighborhoodEdgeIds.has(edge.id) &&
      edge.kind !== "fragment_boundary" &&
      (edge.fragmentId === context.fragment.id ||
        context.simulation.vertices[edge.sourceVertexId]?.fragmentId === context.fragment.id ||
        context.simulation.vertices[edge.targetVertexId]?.fragmentId === context.fragment.id),
  );
}

function anchorLabel(context: ProposalGenerationContext) {
  return context.simulation.vertices[context.fragment.inheritedAnchor]?.label ?? context.fragment.inheritedAnchor;
}

function exposedLabel(connection: ExposedConnection, fallback: string) {
  return connection.label || fallback;
}

function neighboringLabels(context: ProposalGenerationContext) {
  if (context.neighbors.length === 0) {
    return "no immediate neighbors";
  }
  return context.neighbors
    .slice(0, 3)
    .map((neighbor) => neighbor.labels.short)
    .join(", ");
}

function graphRelationSummary(edges: LocalGraphEdge[]) {
  if (edges.length === 0) {
    return "no active local relations";
  }

  const ranked = [...edges]
    .sort((left, right) => right.weight - left.weight)
    .slice(0, 2)
    .map((edge) => edge.label ?? edge.id);

  return ranked.join(" and ");
}

function endpointPlan(
  context: ProposalGenerationContext,
  index: number,
): { source: ProposalEndpoint; target?: ProposalEndpoint } {
  const connections = context.exposedConnections;
  const localEdges = localGraphEdges(context);
  const sourceConnection = connections[index % Math.max(connections.length, 1)];
  const targetConnection = connections[(index + 1) % Math.max(connections.length, 1)];
  const localEdge = localEdges[index % Math.max(localEdges.length, 1)];

  const source: ProposalEndpoint = sourceConnection
    ? { entityType: "vertex", vertexId: sourceConnection.vertexId }
    : { entityType: "vertex", vertexId: context.fragment.inheritedAnchor };

  if (localEdge && index % 2 === 1) {
    return {
      source,
      target: { entityType: "edge", edgeId: localEdge.id },
    };
  }

  return {
    source,
    target: targetConnection
      ? { entityType: "vertex", vertexId: targetConnection.vertexId }
      : { entityType: "edge", edgeId: context.fragment.edgeIds[2] },
  };
}

function titleForKind(
  context: ProposalGenerationContext,
  kind: ProposalKind,
  leftConnection: ExposedConnection | undefined,
  rightConnection: ExposedConnection | undefined,
) {
  const anchor = anchorLabel(context);
  const left = leftConnection ? exposedLabel(leftConnection, "left seam") : "first seam";
  const right = rightConnection ? exposedLabel(rightConnection, "right seam") : "second seam";

  switch (kind) {
    case "candidate_theorem":
      return `Coherence of ${anchor}`;
    case "candidate_definition":
      return `Definition of ${left}`;
    case "bridge_lemma":
      return `Bridge ${left} to ${right}`;
    case "projection_rule":
      return `Projection from ${anchor}`;
    case "compatibility_claim":
      return `Compatibility at ${anchor}`;
    case "obstruction_claim":
      return `Obstruction near ${left}`;
    case "refinement_law":
    default:
      return `Refinement law for ${context.fragment.labels.short}`;
  }
}

function formalizationForKind(
  context: ProposalGenerationContext,
  kind: ProposalKind,
  leftConnection: ExposedConnection | undefined,
  rightConnection: ExposedConnection | undefined,
  relationSummary: string,
) {
  const anchor = anchorLabel(context);
  const left = leftConnection ? exposedLabel(leftConnection, "first seam") : "first seam";
  const right = rightConnection ? exposedLabel(rightConnection, "second seam") : "second seam";
  const neighborText = neighboringLabels(context);

  switch (kind) {
    case "candidate_theorem":
      return `The candidate theorem asserts that ${anchor} governs a coherent relation between ${left} and ${right} across ${neighborText}.`;
    case "candidate_definition":
      return `The candidate definition isolates ${left} as a stable interface determined by ${anchor} and the local relation ${relationSummary}.`;
    case "bridge_lemma":
      return `The bridge lemma states that ${left} and ${right} can be connected without leaving the local neighborhood of ${anchor}.`;
    case "projection_rule":
      return `The projection rule sends the local relation ${relationSummary} outward from ${anchor} into the adjacent fragments ${neighborText}.`;
    case "compatibility_claim":
      return `The compatibility claim requires the current graph relations ${relationSummary} to remain aligned with ${anchor}.`;
    case "obstruction_claim":
      return `The obstruction claim identifies a failure mode in which ${left} cannot be reconciled with ${right} under the present local relations.`;
    case "refinement_law":
    default:
      return `The refinement law describes how ${context.fragment.labels.short} should refine when anchored at ${anchor} and constrained by ${relationSummary}.`;
  }
}

function summaryForKind(
  context: ProposalGenerationContext,
  kind: ProposalKind,
  leftConnection: ExposedConnection | undefined,
  rightConnection: ExposedConnection | undefined,
  relationSummary: string,
) {
  const anchor = anchorLabel(context);
  const left = leftConnection ? exposedLabel(leftConnection, "first seam") : "first seam";
  const right = rightConnection ? exposedLabel(rightConnection, "second seam") : "second seam";
  const neighborText = neighboringLabels(context);

  switch (kind) {
    case "candidate_theorem":
      return `At depth ${context.fragment.generationDepth}, the fragment anchored at ${anchor} proposes a coherence theorem joining ${left} and ${right} through ${neighborText}.`;
    case "candidate_definition":
      return `At depth ${context.fragment.generationDepth}, the fragment anchored at ${anchor} proposes a definition that stabilizes ${left} against the local relation ${relationSummary}.`;
    case "bridge_lemma":
      return `At depth ${context.fragment.generationDepth}, the fragment anchored at ${anchor} proposes a bridge lemma between ${left} and ${right}, informed by ${neighborText}.`;
    case "projection_rule":
      return `At depth ${context.fragment.generationDepth}, the fragment anchored at ${anchor} proposes a projection rule carrying ${relationSummary} into ${neighborText}.`;
    case "compatibility_claim":
      return `At depth ${context.fragment.generationDepth}, the fragment anchored at ${anchor} proposes a compatibility claim for the current graph relations ${relationSummary}.`;
    case "obstruction_claim":
      return `At depth ${context.fragment.generationDepth}, the fragment anchored at ${anchor} records an obstruction preventing ${left} from aligning with ${right}.`;
    case "refinement_law":
    default:
      return `At depth ${context.fragment.generationDepth}, the fragment anchored at ${anchor} proposes a refinement law governing ${left}, ${right}, and the current relation ${relationSummary}.`;
  }
}

function leanSnippet(
  proposalId: SemanticProposalId,
  kind: ProposalKind,
  title: string,
  context: ProposalGenerationContext,
  endpoints: { source: ProposalEndpoint; target?: ProposalEndpoint },
) {
  const artifact = proposalId.replace("semantic_proposal_", `${kind}_`);
  const sourceRef =
    endpoints.source.entityType === "vertex" ? endpoints.source.vertexId : endpoints.source.edgeId;
  const targetRef =
    endpoints.target == null
      ? "none"
      : endpoints.target.entityType === "vertex"
        ? endpoints.target.vertexId
        : endpoints.target.edgeId;

  if (kind === "candidate_definition") {
    return `def ${artifact} : FragmentInterface := by\n  -- ${title}\n  -- anchor ${context.fragment.inheritedAnchor}\n  exact interface_${targetRef}`;
  }

  return `theorem ${artifact} : FragmentClaim := by\n  -- ${title}\n  -- source ${sourceRef}\n  -- target ${targetRef}\n  admit`;
}

function scoringForKind(context: ProposalGenerationContext, kind: ProposalKind, index: number) {
  const localEdges = localGraphEdges(context);
  const neighborCount = context.neighbors.length;
  const exposedCount = context.exposedConnections.length;
  let priority =
    0.4 +
    pickFloat(context.fragment.id, context.tick, index, kind, "priority") * 0.42 +
    Math.min(0.12, neighborCount * 0.03) +
    Math.min(0.1, exposedCount * 0.04);

  let score =
    0.44 +
    pickFloat(context.fragment.id, context.tick, index, kind, "score") * 0.4 +
    Math.min(0.12, localEdges.length * 0.02);

  let confidence =
    0.38 +
    pickFloat(context.fragment.id, context.tick, index, kind, "confidence") * 0.34 +
    Math.min(0.16, neighborCount * 0.03) +
    Math.min(0.12, exposedCount * 0.04);

  switch (kind) {
    case "bridge_lemma":
      priority += exposedCount >= 2 ? 0.09 : -0.08;
      confidence += exposedCount >= 2 ? 0.08 : -0.06;
      break;
    case "candidate_definition":
      priority += 0.05;
      confidence += 0.06;
      break;
    case "compatibility_claim":
      score += localEdges.length >= 3 ? 0.08 : -0.04;
      confidence += localEdges.length >= 3 ? 0.06 : -0.02;
      break;
    case "obstruction_claim":
      score += localEdges.length <= 4 ? 0.04 : -0.05;
      confidence += 0.02;
      break;
    case "projection_rule":
      priority += neighborCount >= 2 ? 0.05 : -0.03;
      break;
    case "refinement_law":
      score += context.fragment.generationDepth <= 2 ? 0.04 : -0.03;
      break;
    case "candidate_theorem":
    default:
      score += 0.03;
      break;
  }

  return {
    priority: Number(Math.min(0.99, Math.max(0.05, priority)).toFixed(2)),
    score: Number(Math.min(0.99, Math.max(0.05, score)).toFixed(2)),
    confidence: Number(Math.min(0.99, Math.max(0.05, confidence)).toFixed(2)),
  };
}

export class RuleBasedSemanticProposalGenerator implements SemanticProposalGenerator {
  generate(context: ProposalGenerationContext): GeneratedSemanticProposal[] {
    const count = proposalCount(context.fragment.id, context.tick);
    const connections = context.exposedConnections;
    const edges = localGraphEdges(context);
    const relationSummary = graphRelationSummary(edges);

    return Array.from({ length: count }, (_, index) => {
      const kind = pickProposalKind(context, index);
      const leftConnection = connections[index % Math.max(connections.length, 1)];
      const rightConnection = connections[(index + 1) % Math.max(connections.length, 1)];
      const proposalId = `semantic_proposal_${context.fragment.id.replace("fragment_", "")}_tick_${context.tick}_${index}` as SemanticProposalId;
      const leanTaskId = `lean_task_${context.fragment.id.replace("fragment_", "")}_tick_${context.tick}_${index}` as LeanTaskId;
      const endpoints = endpointPlan(context, index);
      const title = titleForKind(context, kind, leftConnection, rightConnection);
      const { priority, score, confidence } = scoringForKind(context, kind, index);

      return {
        proposalId,
        leanTaskId,
        title,
        kind,
        source: endpoints.source,
        target: endpoints.target,
        naturalLanguageSummary: summaryForKind(context, kind, leftConnection, rightConnection, relationSummary),
        theoremSummary: formalizationForKind(context, kind, leftConnection, rightConnection, relationSummary),
        mockLeanCode: leanSnippet(proposalId, kind, title, context, endpoints),
        priority,
        score,
        confidence,
        ...resolveStatisticalEmbeddingState({
          key: `${context.fragment.id}:${proposalId}`,
          existing: context.fragment,
        }),
      };
    });
  }
}

export const ruleBasedSemanticProposalGenerator = new RuleBasedSemanticProposalGenerator();
