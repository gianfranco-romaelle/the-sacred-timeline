import type {
  MultimodalRetrievalQuery,
  MultimodalRetrievalResponse,
  SimilaritySearchQuery,
  SimilaritySearchResult,
  VectorSearchCapabilities,
} from "@/types";
import {
  mockMultimodalResponsesByQuery,
  mockSimilarityResultsByAnchor,
} from "./mock-semantic-index";
import type { VectorSearchAdapter } from "./semantic-search-contracts";

const normalizeQueryText = (query: string) => query.trim().toLowerCase();

export class PlaceholderVectorSearchAdapter implements VectorSearchAdapter {
  async describeCapabilities(): Promise<VectorSearchCapabilities> {
    return {
      supportsTextEmbeddings: true,
      supportsImageEmbeddings: true,
      supportsFaceEmbeddings: true,
      supportsMultimodalRetrieval: true,
      supportsSimilaritySearch: true,
      backendKind: "seed-only",
      notes:
        "Placeholder adapter backed by canonical seed metadata and mock semantic fixtures. Replace with API or vector backend later.",
    };
  }

  async searchSimilar(query: SimilaritySearchQuery): Promise<SimilaritySearchResult[]> {
    const seedResults = mockSimilarityResultsByAnchor[query.anchorId] ?? [];

    return seedResults
      .filter(
        (result) =>
          (query.minScore === undefined || result.score >= query.minScore) &&
          (query.relations === undefined ||
            query.relations.length === 0 ||
            query.relations.includes(result.relation)),
      )
      .slice(0, query.limit)
      .map((result) => ({
        ...result,
        source: "placeholder_vector_search",
      }));
  }

  async searchMultimodal(
    query: MultimodalRetrievalQuery,
  ): Promise<MultimodalRetrievalResponse> {
    const normalizedText = query.text ? normalizeQueryText(query.text) : undefined;

    if (normalizedText && mockMultimodalResponsesByQuery[normalizedText]) {
      return mockMultimodalResponsesByQuery[normalizedText];
    }

    return {
      queryLabel: normalizedText ?? "seed-backed multimodal query",
      groups: [],
    };
  }
}
