import type { GraphEdge, GraphNode } from "@/data/adapters/graph-adapter";
import { getEditorialVisualAccent } from "@/editorial/visual-encoding";
import type { EditorialScopeMode } from "@/editorial/types";
import type { EdgeRelationType } from "@/types";

export type ConstellationRelationFamilyId =
  | "transmission"
  | "affiliation"
  | "conceptual"
  | "contest"
  | "semantic"
  | "relation";

export const constellationRelationFamilies: {
  id: ConstellationRelationFamilyId;
  label: string;
  description: string;
  color: string;
}[] = [
  {
    id: "transmission",
    label: "Transmission",
    description: "Influence, teaching, citation, translation, publication, and preservation.",
    color: "#6f7482",
  },
  {
    id: "affiliation",
    label: "Affiliation",
    description: "Membership, founding, correspondence, association, location, and active periods.",
    color: "#7b7259",
  },
  {
    id: "conceptual",
    label: "Conceptual",
    description: "Discovery, concept development, analogues, generalizations, and transformations.",
    color: "#57768b",
  },
  {
    id: "contest",
    label: "Contest",
    description: "Debate and opposition relations.",
    color: "#94615e",
  },
  {
    id: "semantic",
    label: "Semantic",
    description: "Projection-only shared ontology, tag, school, stage, and embedding-neighbor hints.",
    color: "#7c6fa3",
  },
  {
    id: "relation",
    label: "Other",
    description: "Relations outside the main graph families.",
    color: "#9d8f7f",
  },
];

const nodeTypeAccent: Record<GraphNode["entityType"], string> = {
  person: "#b78252",
  text: "#8f6d47",
  concept: "#56708b",
  institution: "#6f7f63",
  place: "#5d7f7d",
};

export const getEdgeRelationFamily = (edge: GraphEdge): ConstellationRelationFamilyId =>
  edge.isSemantic ? "semantic" : getRelationFamily(edge.relationType);

const toneFill: Record<GraphNode["tone"], string> = {
  science: "#7290ac",
  religion: "#9a6763",
  hybrid: "#9c7e56",
  neutral: "#857766",
};

export const getNodeColor = (node: GraphNode) => toneFill[node.tone];

export const getNodeBorderColor = (node: GraphNode) =>
  node.isSelected ? "#3a2a16" : nodeTypeAccent[node.entityType];

export const getEditorialNodeBorderColor = (
  node: GraphNode,
  editorialScopeMode: EditorialScopeMode,
) => getEditorialVisualAccent(node.editorial, editorialScopeMode)?.color;

export const getNodeLabelColor = (node: GraphNode) =>
  node.isSelected || node.isNeighbor ? "#1f1710" : "#4f4438";

export const getNodeGlyph = (node: GraphNode) =>
  ({
    person: "P",
    text: "T",
    concept: "C",
    institution: "I",
    place: "L",
  })[node.entityType];

export const getRelationFamily = (
  relationType: EdgeRelationType,
): ConstellationRelationFamilyId => {
  switch (relationType) {
    case "influenced":
    case "taught":
    case "commented_on":
    case "translated":
    case "cited_in":
    case "published":
    case "published_by":
    case "preserved_in_tradition":
    case "part_of_series":
      return "transmission";
    case "member_of":
    case "founded":
    case "corresponded_with":
    case "associated_with":
    case "located_at":
    case "active_during":
      return "affiliation";
    case "discovered":
    case "developed_concept":
    case "mathematical_generalization_of":
    case "philosophical_transformation_of":
    case "symbolic_analogue_of":
      return "conceptual";
    case "debated":
    case "opposed":
      return "contest";
    default:
      return "relation";
  }
};

export const getRelationFamilyColor = (relationType: EdgeRelationType) =>
  constellationRelationFamilies.find((family) => family.id === getRelationFamily(relationType))
    ?.color ?? "#9d8f7f";

export const getEdgeColor = (edge: GraphEdge) => {
  if (edge.isSemantic) return edge.semanticKind === "embedding_neighbor" ? "#7c6fa3" : "#9a8f79";
  if (edge.isSelectionAdjacent) return "#6d5637";

  return getRelationFamilyColor(edge.relationType);
};

export const getEdgeSize = (edge: GraphEdge) =>
  edge.isSemantic ? 0.8 : edge.isSelectionAdjacent ? 2.8 : 1.6;

export const dimHex = (hex: string) => {
  if (!hex.startsWith("#") || (hex.length !== 7 && hex.length !== 4)) return hex;
  if (hex.length === 4) {
    const [r, g, b] = hex.slice(1).split("");
    return `#${r}${r}${g}${g}${b}${b}66`;
  }
  return `${hex}66`;
};
