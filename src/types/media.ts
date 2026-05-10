import type {
  CitationId,
  DomainId,
  EmbeddingDescriptorId,
  JsonObject,
  KnowledgeEntityId,
  MediaAssetId,
  PortraitAssetId,
  RecordId,
  SemanticClusterId,
  StyleGroupId,
  TagId,
} from "./primitives";
import type { EmbeddingMetadata } from "./embeddings";
import type { HistoricalDateRange } from "./time";

export type MediaAssetType =
  | "portrait"
  | "image"
  | "manuscript"
  | "map"
  | "diagram";

export type DepictionType =
  | "painting"
  | "engraving"
  | "illumination"
  | "photograph"
  | "statue"
  | "icon"
  | "composite"
  | "unknown";

export interface MediaFileDescriptor {
  src: string;
  mimeType: string;
  width?: number;
  height?: number;
  bytes?: number;
  checksum?: string;
  thumbnailSrc?: string;
}

export interface MediaRights {
  usage: "public_domain" | "licensed" | "restricted" | "unknown";
  rightsHolder?: string;
  licenseLabel?: string;
  creditLine?: string;
  sourceUrl?: string;
}

export interface MediaCropRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FaceRegion extends MediaCropRegion {
  confidence?: number;
  label?: string;
  embeddingDescriptorIds?: EmbeddingDescriptorId[];
  clusterIds?: SemanticClusterId[];
  styleGroupIds?: StyleGroupId[];
  similarityNeighborIds?: RecordId[];
}

export interface MediaAssetBase<TId extends MediaAssetId, TType extends MediaAssetType> {
  id: TId;
  assetType: TType;
  slug: string;
  label: string;
  title?: string;
  description: string;
  dateRange?: HistoricalDateRange;
  domainIds: DomainId[];
  tagIds: TagId[];
  citationIds: CitationId[];
  relatedEntityIds: KnowledgeEntityId[];
  mediaAssetIds: MediaAssetId[];
  embedding?: EmbeddingMetadata;
  metadata?: JsonObject;
  altText: string;
  file: MediaFileDescriptor;
  rights?: MediaRights;
}

export interface PortraitAsset extends MediaAssetBase<PortraitAssetId, "portrait"> {
  depictedEntityIds: KnowledgeEntityId[];
  depictionType: DepictionType;
  sourceUrl?: string;
  faceRegions?: FaceRegion[];
  preferredCrop?: MediaCropRegion;
  isPrimaryPortrait?: boolean;
}

export type GeneralMediaAsset = MediaAssetBase<`media_${string}`, Exclude<MediaAssetType, "portrait">>;

export type MediaAsset = PortraitAsset | GeneralMediaAsset;
