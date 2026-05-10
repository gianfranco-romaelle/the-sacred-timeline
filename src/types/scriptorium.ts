import type {
  EdgeId,
  JsonObject,
  KnowledgeEntityId,
  MediaAssetId,
  SourceId,
} from "./primitives";

export type ScriptoriumReviewState = "suggested" | "approved" | "rejected";
export type ScriptoriumSourceKind = "drive" | "instagram" | "manual" | "ai";

export interface InstagramPostReference {
  id: `instagram_${string}`;
  permalink: string;
  caption: string;
  postedAt?: string;
  thumbnailSrc?: string;
  mediaAssetId?: MediaAssetId;
  linkedEntityIds: KnowledgeEntityId[];
  rightsStatus: "embed_only" | "permissioned" | "unknown";
  reviewState: ScriptoriumReviewState;
  provenance: {
    sourceKind: "instagram";
    importedAt: string;
    sourceUrl: string;
    note?: string;
  };
  metadata?: JsonObject;
}

export interface ScriptoriumExhibitSection {
  id: string;
  title: string;
  body: string;
  pinnedEntityIds: KnowledgeEntityId[];
  pinnedMediaIds: MediaAssetId[];
  instagramReferenceIds: InstagramPostReference["id"][];
}

export interface ScriptoriumExhibit {
  id: `exhibit_${string}`;
  title: string;
  description: string;
  reviewState: ScriptoriumReviewState;
  sourceKind: ScriptoriumSourceKind;
  createdAt: string;
  updatedAt: string;
  sections: ScriptoriumExhibitSection[];
  relationshipEmphasis: EdgeId[];
  metadata?: JsonObject;
}

export interface ScriptoriumRelationshipSuggestion {
  id: `scriptorium_suggestion_${string}`;
  sourceEntityId: KnowledgeEntityId;
  targetEntityId: KnowledgeEntityId;
  label: string;
  rationale: string;
  evidenceSnippets: string[];
  confidence: number;
  reviewState: ScriptoriumReviewState;
  sourceKind: "ai" | "drive";
  createdAt: string;
  sourceRecordIds: SourceId[];
}

export interface ScriptoriumAuthoringOverlay {
  instagramReferences: InstagramPostReference[];
  exhibits: ScriptoriumExhibit[];
  relationshipSuggestions: ScriptoriumRelationshipSuggestion[];
}
