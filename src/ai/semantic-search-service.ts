import type {
  MultimodalRetrievalQuery,
  RecordId,
  SimilarityRelation,
  SimilaritySearchResult,
  SacredTimelineSeedData,
} from "@/types";
import { sacredTimelineSeed } from "@/data/sacred-timeline.seed";
import { PlaceholderVectorSearchAdapter } from "./placeholder-vector-search-adapter";
import { SeedEmbeddingMetadataRepository } from "./seed-embedding-repository";
import type {
  EmbeddingMetadataRepository,
  SemanticSearchService,
  VectorSearchAdapter,
} from "./semantic-search-contracts";

const filterByRelation = (
  results: SimilaritySearchResult[],
  relations: SimilarityRelation[],
  limit: number,
) =>
  results.filter((result) => relations.includes(result.relation)).slice(0, limit);

export class SacredTimelineSemanticSearchService implements SemanticSearchService {
  constructor(
    private readonly repository: EmbeddingMetadataRepository,
    private readonly vectorAdapter: VectorSearchAdapter,
  ) {}

  async getSemanticContext(targetId: RecordId) {
    const [metadata, clusters, seededSimilarities, vectorSimilarities] = await Promise.all([
      this.repository.getMetadata(targetId),
      this.repository.listClusters([targetId]),
      this.repository.listSimilarityResults(targetId),
      this.vectorAdapter.searchSimilar({
        anchorId: targetId,
        limit: 8,
        includeClusters: true,
      }),
    ]);

    const mergedSimilarities = [...seededSimilarities];
    for (const result of vectorSimilarities) {
      if (!mergedSimilarities.some((existing) => existing.targetId === result.targetId)) {
        mergedSimilarities.push(result);
      }
    }

    return {
      metadata,
      clusters,
      similarities: mergedSimilarities,
    };
  }

  async findNearbyFaces(targetId: RecordId, limit = 6) {
    const context = await this.getSemanticContext(targetId);
    return filterByRelation(context.similarities, ["nearby_face", "similar_portrait"], limit);
  }

  async findRelatedConcepts(targetId: RecordId, limit = 6) {
    const context = await this.getSemanticContext(targetId);
    return filterByRelation(context.similarities, ["related_concept", "multimodal_neighbor"], limit);
  }

  async searchMultimodal(query: MultimodalRetrievalQuery) {
    return this.vectorAdapter.searchMultimodal(query);
  }
}

export const createSemanticSearchService = (
  seed: SacredTimelineSeedData = sacredTimelineSeed,
) =>
  new SacredTimelineSemanticSearchService(
    new SeedEmbeddingMetadataRepository(seed),
    new PlaceholderVectorSearchAdapter(),
  );
