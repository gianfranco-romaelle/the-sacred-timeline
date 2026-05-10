import type {
  MultimodalRetrievalResponse,
  RecordId,
  SemanticCluster,
  SimilaritySearchResult,
} from "@/types";

export const mockSemanticClusters: SemanticCluster[] = [
  {
    id: "cluster_mystic_abbesses",
    label: "Mystic abbesses",
    description:
      "Portrait and devotional image material linked to visionary abbess traditions.",
    modality: "portrait",
    memberIds: ["portrait_hildegard_frontispiece", "person_hildegard_of_bingen"],
    styleGroupIds: ["style_medieval_illumination"],
  },
  {
    id: "cluster_scholarly_engraved_portraits",
    label: "Scholarly engraved portraits",
    description:
      "Portraits and face crops linked to early scholarly engraving traditions.",
    modality: "portrait",
    memberIds: ["portrait_ibn_al_haytham_scholar", "portrait_galileo_engraving"],
    styleGroupIds: ["style_scholarly_engraving"],
  },
  {
    id: "cluster_natural_philosophy_discourse",
    label: "Natural philosophy discourse",
    description:
      "Texts, concepts, and linked portraits clustered around natural philosophy and transmission.",
    modality: "multimodal",
    memberIds: [
      "text_book_of_optics",
      "concept_natural_philosophy",
      "portrait_ibn_al_haytham_scholar",
      "portrait_galileo_engraving",
    ],
  },
  {
    id: "cluster_visionary_cosmology_corpus",
    label: "Visionary cosmology corpus",
    description:
      "Portrait and text materials tied to visionary authorship, illumination, and cosmology.",
    modality: "multimodal",
    memberIds: ["portrait_hildegard_frontispiece", "text_scivias", "person_hildegard_of_bingen"],
    styleGroupIds: ["style_medieval_illumination"],
  },
];

export const mockSimilarityResultsByAnchor: Partial<Record<RecordId, SimilaritySearchResult[]>> = {
  portrait_hildegard_frontispiece: [
    {
      targetId: "text_scivias",
      score: 0.82,
      relation: "multimodal_neighbor",
      clusterIds: ["cluster_visionary_cosmology_corpus"],
      styleGroupIds: ["style_medieval_illumination"],
      summary: "Portrait illumination and visionary text belong to the same authored corpus.",
      source: "mock_index",
    },
  ],
  portrait_ibn_al_haytham_scholar: [
    {
      targetId: "portrait_galileo_engraving",
      score: 0.78,
      relation: "similar_portrait",
      clusterIds: ["cluster_scholarly_engraved_portraits"],
      styleGroupIds: ["style_scholarly_engraving"],
      summary: "Shared engraved portrait logic with neighboring scholarly likenesses.",
      source: "mock_index",
    },
    {
      targetId: "concept_natural_philosophy",
      score: 0.73,
      relation: "multimodal_neighbor",
      clusterIds: ["cluster_natural_philosophy_discourse"],
      summary: "Links portrait identity with the concept space of natural philosophy.",
      source: "mock_index",
    },
  ],
  portrait_galileo_engraving: [
    {
      targetId: "portrait_ibn_al_haytham_scholar",
      score: 0.78,
      relation: "similar_portrait",
      clusterIds: ["cluster_scholarly_engraved_portraits"],
      styleGroupIds: ["style_scholarly_engraving"],
      summary: "Nearby engraved scholarly portrait in the same visual cluster.",
      source: "mock_index",
    },
    {
      targetId: "concept_natural_philosophy",
      score: 0.8,
      relation: "multimodal_neighbor",
      clusterIds: ["cluster_natural_philosophy_discourse"],
      summary: "Portrait cues align with concept material around natural philosophy.",
      source: "mock_index",
    },
  ],
  text_book_of_optics: [
    {
      targetId: "concept_natural_philosophy",
      score: 0.86,
      relation: "related_concept",
      clusterIds: ["cluster_natural_philosophy_discourse"],
      summary: "Strong conceptual affinity through optical and natural-philosophical language.",
      source: "mock_index",
    },
    {
      targetId: "portrait_ibn_al_haytham_scholar",
      score: 0.69,
      relation: "multimodal_neighbor",
      clusterIds: ["cluster_natural_philosophy_discourse"],
      summary: "Text links outward to the portrait tradition attached to its authorial memory.",
      source: "mock_index",
    },
  ],
  concept_natural_philosophy: [
    {
      targetId: "text_book_of_optics",
      score: 0.86,
      relation: "related_text",
      clusterIds: ["cluster_natural_philosophy_discourse"],
      summary: "Core text in the natural philosophy discourse cluster.",
      source: "mock_index",
    },
    {
      targetId: "portrait_galileo_engraving",
      score: 0.8,
      relation: "multimodal_neighbor",
      clusterIds: ["cluster_natural_philosophy_discourse"],
      summary: "Concept reaches into portrait space through later scientific memory.",
      source: "mock_index",
    },
    {
      targetId: "portrait_ibn_al_haytham_scholar",
      score: 0.73,
      relation: "multimodal_neighbor",
      clusterIds: ["cluster_natural_philosophy_discourse"],
      summary: "Concept reaches portrait space through transmission history.",
      source: "mock_index",
    },
  ],
  text_scivias: [
    {
      targetId: "portrait_hildegard_frontispiece",
      score: 0.82,
      relation: "multimodal_neighbor",
      clusterIds: ["cluster_visionary_cosmology_corpus"],
      styleGroupIds: ["style_medieval_illumination"],
      summary: "Visionary text and illumination belong to the same authored cosmological field.",
      source: "mock_index",
    },
  ],
};

export const mockMultimodalResponsesByQuery: Record<string, MultimodalRetrievalResponse> = {
  "natural philosophy": {
    queryLabel: "natural philosophy",
    groups: [
      {
        kind: "related_concepts",
        label: "Related concepts",
        results: [
          {
            targetId: "concept_natural_philosophy",
            score: 0.92,
            relation: "related_concept",
            clusterIds: ["cluster_natural_philosophy_discourse"],
            summary: "Primary concept match in the seed semantic field.",
            source: "mock_index",
          },
        ],
      },
      {
        kind: "related_texts",
        label: "Related texts",
        results: [
          {
            targetId: "text_book_of_optics",
            score: 0.88,
            relation: "related_text",
            clusterIds: ["cluster_natural_philosophy_discourse"],
            summary: "Canonical text aligned with the concept query.",
            source: "mock_index",
          },
        ],
      },
      {
        kind: "multimodal_neighbors",
        label: "Portrait and media neighbors",
        results: [
          {
            targetId: "portrait_galileo_engraving",
            score: 0.76,
            relation: "multimodal_neighbor",
            clusterIds: ["cluster_natural_philosophy_discourse"],
            summary: "Portrait memory surface linked to the concept cluster.",
            source: "mock_index",
          },
          {
            targetId: "portrait_ibn_al_haytham_scholar",
            score: 0.74,
            relation: "multimodal_neighbor",
            clusterIds: ["cluster_natural_philosophy_discourse"],
            summary: "Portrait surface linked to the same transmission discourse.",
            source: "mock_index",
          },
        ],
      },
    ],
  },
  hildegard: {
    queryLabel: "hildegard",
    groups: [
      {
        kind: "nearby_faces",
        label: "Nearby faces",
        results: [
          {
            targetId: "portrait_hildegard_frontispiece",
            score: 0.89,
            relation: "nearby_face",
            clusterIds: ["cluster_visionary_cosmology_corpus"],
            styleGroupIds: ["style_medieval_illumination"],
            summary: "Primary portrait surface and face region cluster.",
            source: "mock_index",
          },
        ],
      },
      {
        kind: "related_texts",
        label: "Related texts",
        results: [
          {
            targetId: "text_scivias",
            score: 0.84,
            relation: "related_text",
            clusterIds: ["cluster_visionary_cosmology_corpus"],
            summary: "Visionary text linked through the same multimodal corpus.",
            source: "mock_index",
          },
        ],
      },
    ],
  },
};
