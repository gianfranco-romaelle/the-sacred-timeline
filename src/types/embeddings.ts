import type {
  EmbeddingDescriptorId,
  EmbeddingJobId,
  DomainId,
  JsonObject,
  RecordId,
  SemanticClusterId,
  StyleGroupId,
  TagId,
} from "./primitives";

export type EmbeddingModality =
  | "text"
  | "image"
  | "portrait"
  | "face"
  | "multimodal";

export type EmbeddingStatus =
  | "not_requested"
  | "queued"
  | "processing"
  | "ready"
  | "failed"
  | "stale";

export type EmbeddingStore = "postgres" | "vector-db" | "hybrid" | "unknown";

export interface EmbeddingStoreRef {
  store: EmbeddingStore;
  namespace?: string;
  collection?: string;
  key?: string;
}

export type EmbeddingTargetKind =
  | "entity"
  | "portrait"
  | "citation"
  | "source"
  | "edge";

export interface EmbeddingDescriptor {
  id: EmbeddingDescriptorId;
  targetId: RecordId;
  modality: EmbeddingModality;
  status: EmbeddingStatus;
  providerName: string;
  modelName: string;
  dimensions?: number;
  contentHash?: string;
  generatedAt?: string;
  storeRef?: EmbeddingStoreRef;
  metadata?: JsonObject;
}

export type SimilarityRelation =
  | "similar_portrait"
  | "nearby_face"
  | "related_text"
  | "related_concept"
  | "multimodal_neighbor";

export interface SimilarityLink {
  targetId: RecordId;
  score: number;
  relation: SimilarityRelation;
  descriptorId?: EmbeddingDescriptorId;
  clusterId?: SemanticClusterId;
  explanation?: string;
}

export interface EmbeddingMetadata {
  searchableText?: string;
  keywordText?: string;
  embeddingCandidate?: boolean;
  descriptors: EmbeddingDescriptor[];
  preferredDescriptorId?: EmbeddingDescriptorId;
  clusterIds?: SemanticClusterId[];
  styleGroupIds?: StyleGroupId[];
  similarityLinks?: SimilarityLink[];
}

export interface SemanticCluster {
  id: SemanticClusterId;
  label: string;
  description: string;
  modality: EmbeddingModality;
  memberIds: RecordId[];
  centroidDescriptorId?: EmbeddingDescriptorId;
  styleGroupIds?: StyleGroupId[];
  metadata?: JsonObject;
}

export interface EmbeddingGenerationRequest {
  targetId: RecordId;
  targetKind: EmbeddingTargetKind;
  modality: EmbeddingModality;
  forceRegenerate?: boolean;
  providerHint?: string;
  modelHint?: string;
  metadata?: JsonObject;
}

export interface EmbeddingGenerationReceipt {
  jobId: EmbeddingJobId;
  status: EmbeddingStatus;
  acceptedAt: string;
  targetId: RecordId;
  message?: string;
}

export interface SimilaritySearchQuery {
  anchorId: RecordId;
  limit: number;
  minScore?: number;
  modalities?: EmbeddingModality[];
  relations?: SimilarityRelation[];
  domainIds?: DomainId[];
  tagIds?: TagId[];
  includeClusters?: boolean;
}

export interface SimilaritySearchResult {
  targetId: RecordId;
  score: number;
  relation: SimilarityRelation;
  descriptorId?: EmbeddingDescriptorId;
  clusterIds?: SemanticClusterId[];
  styleGroupIds?: StyleGroupId[];
  summary?: string;
  source:
    | "seed_metadata"
    | "mock_index"
    | "placeholder_vector_search"
    | "backend_api";
}

export interface MultimodalRetrievalQuery {
  text?: string;
  anchorIds?: RecordId[];
  modalities?: EmbeddingModality[];
  domainIds?: DomainId[];
  tagIds?: TagId[];
  limit: number;
}

export interface MultimodalRetrievalResultGroup {
  kind:
    | "nearby_faces"
    | "related_concepts"
    | "related_texts"
    | "portrait_clusters"
    | "multimodal_neighbors";
  label: string;
  results: SimilaritySearchResult[];
}

export interface MultimodalRetrievalResponse {
  queryLabel: string;
  groups: MultimodalRetrievalResultGroup[];
}

export interface VectorSearchCapabilities {
  supportsTextEmbeddings: boolean;
  supportsImageEmbeddings: boolean;
  supportsFaceEmbeddings: boolean;
  supportsMultimodalRetrieval: boolean;
  supportsSimilaritySearch: boolean;
  backendKind: "seed-only" | "postgres" | "vector-db" | "hybrid" | "unknown";
  notes?: string;
}
