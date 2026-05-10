import { getAllEntities } from "@/data/entity-index";
import { sacredTimelineSeed } from "@/data/sacred-timeline.seed";
import type {
  EmbeddingMetadata,
  RecordId,
  SacredTimelineSeedData,
  SemanticCluster,
  SimilaritySearchResult,
} from "@/types";
import { mockSemanticClusters } from "./mock-semantic-index";
import type { EmbeddingMetadataRepository } from "./semantic-search-contracts";

const getEmbeddingRecords = (seed: SacredTimelineSeedData) => [
  ...getAllEntities(seed),
  ...seed.portraitAssets,
  ...seed.sources,
  ...seed.citations,
  ...seed.edges,
];

export class SeedEmbeddingMetadataRepository implements EmbeddingMetadataRepository {
  private readonly metadataByTargetId: Map<RecordId, EmbeddingMetadata>;

  constructor(
    private readonly seed: SacredTimelineSeedData = sacredTimelineSeed,
    private readonly clusters: SemanticCluster[] = mockSemanticClusters,
  ) {
    // The seed-backed repository is intentionally read-oriented. It gives the UI
    // and adapters a stable contract now, while real write/reindex behavior stays
    // a future backend concern.
    this.metadataByTargetId = new Map(
      getEmbeddingRecords(seed)
        .filter((record) => Boolean(record.embedding))
        .map((record) => [record.id as RecordId, record.embedding as EmbeddingMetadata]),
    );
  }

  async getMetadata(targetId: RecordId) {
    return this.metadataByTargetId.get(targetId);
  }

  async listMetadata(targetIds?: RecordId[]) {
    if (!targetIds || targetIds.length === 0) {
      return Array.from(this.metadataByTargetId.values());
    }

    return targetIds
      .map((targetId) => this.metadataByTargetId.get(targetId))
      .filter((metadata): metadata is EmbeddingMetadata => Boolean(metadata));
  }

  async listClusters(targetIds?: RecordId[]) {
    if (!targetIds || targetIds.length === 0) {
      return this.clusters;
    }

    const targetSet = new Set(targetIds);
    return this.clusters.filter((cluster) =>
      cluster.memberIds.some((memberId) => targetSet.has(memberId)),
    );
  }

  async listSimilarityResults(targetId: RecordId): Promise<SimilaritySearchResult[]> {
    const metadata = this.metadataByTargetId.get(targetId);

    if (!metadata?.similarityLinks) {
      return [];
    }

    return metadata.similarityLinks.map((link) => ({
      targetId: link.targetId,
      score: link.score,
      relation: link.relation,
      descriptorId: link.descriptorId,
      clusterIds: link.clusterId ? [link.clusterId] : undefined,
      summary: link.explanation,
      source: "seed_metadata",
    }));
  }
}
