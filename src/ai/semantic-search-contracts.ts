import type {
  EmbeddingGenerationReceipt,
  EmbeddingGenerationRequest,
  EmbeddingMetadata,
  MultimodalRetrievalQuery,
  MultimodalRetrievalResponse,
  RecordId,
  SemanticCluster,
  SimilaritySearchQuery,
  SimilaritySearchResult,
  VectorSearchCapabilities,
} from "@/types";

export interface EmbeddingMetadataRepository {
  getMetadata(targetId: RecordId): Promise<EmbeddingMetadata | undefined>;
  listMetadata(targetIds?: RecordId[]): Promise<EmbeddingMetadata[]>;
  listClusters(targetIds?: RecordId[]): Promise<SemanticCluster[]>;
  listSimilarityResults(targetId: RecordId): Promise<SimilaritySearchResult[]>;
  saveMetadata?(targetId: RecordId, metadata: EmbeddingMetadata): Promise<void>;
  // TODO: backend/API implementations should own writes, reindex orchestration, and audit trails.
}

export interface EmbeddingGenerationGateway {
  queueEmbedding(request: EmbeddingGenerationRequest): Promise<EmbeddingGenerationReceipt>;
  // TODO: a backend worker or API should materialize embeddings and update repository metadata.
}

export interface VectorSearchAdapter {
  describeCapabilities(): Promise<VectorSearchCapabilities>;
  searchSimilar(query: SimilaritySearchQuery): Promise<SimilaritySearchResult[]>;
  searchMultimodal(query: MultimodalRetrievalQuery): Promise<MultimodalRetrievalResponse>;
  // TODO: plug a vector store or PostgreSQL+pgvector backend in here without changing UI contracts.
}

export interface SemanticSearchService {
  getSemanticContext(targetId: RecordId): Promise<{
    metadata?: EmbeddingMetadata;
    clusters: SemanticCluster[];
    similarities: SimilaritySearchResult[];
  }>;
  findNearbyFaces(targetId: RecordId, limit?: number): Promise<SimilaritySearchResult[]>;
  findRelatedConcepts(targetId: RecordId, limit?: number): Promise<SimilaritySearchResult[]>;
  searchMultimodal(query: MultimodalRetrievalQuery): Promise<MultimodalRetrievalResponse>;
}
