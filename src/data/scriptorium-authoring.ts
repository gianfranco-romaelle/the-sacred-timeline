import type {
  InstagramPostReference,
  ScriptoriumAuthoringOverlay,
  ScriptoriumExhibit,
  ScriptoriumRelationshipSuggestion,
} from "@/types";

export const defaultScriptoriumInstagramReferences: InstagramPostReference[] = [
  {
    id: "instagram_auguste_laurent_gallery_seed",
    permalink: "https://www.instagram.com/augustelaurentsociety/",
    caption:
      "Auguste Laurent Society public Instagram gallery reference. Add post permalinks through the curator manifest as specific records are reviewed.",
    linkedEntityIds: [],
    rightsStatus: "embed_only",
    reviewState: "suggested",
    provenance: {
      sourceKind: "instagram",
      importedAt: "2026-05-09T00:00:00.000Z",
      sourceUrl: "https://www.instagram.com/augustelaurentsociety/",
      note: "Reference-first placeholder; v1 does not scrape public Instagram media.",
    },
  },
];

export const defaultScriptoriumExhibits: ScriptoriumExhibit[] = [
  {
    id: "exhibit_drive_library_orientation",
    title: "Scriptorium Orientation",
    description:
      "A starter exhibit for arranging imported texts, schools, people, and Instagram references into a curator-approved research path.",
    reviewState: "approved",
    sourceKind: "manual",
    createdAt: "2026-05-09T00:00:00.000Z",
    updatedAt: "2026-05-09T00:00:00.000Z",
    sections: [
      {
        id: "section_drive_texts",
        title: "Texts as anchors",
        body:
          "Begin with Drive library texts, then attach schools, individuals, concepts, source records, and gallery references as evidence accumulates.",
        pinnedEntityIds: [],
        pinnedMediaIds: [],
        instagramReferenceIds: ["instagram_auguste_laurent_gallery_seed"],
      },
    ],
    relationshipEmphasis: [],
  },
];

export const defaultScriptoriumRelationshipSuggestions: ScriptoriumRelationshipSuggestion[] = [];

export const defaultScriptoriumAuthoringOverlay: ScriptoriumAuthoringOverlay = {
  instagramReferences: defaultScriptoriumInstagramReferences,
  exhibits: defaultScriptoriumExhibits,
  relationshipSuggestions: defaultScriptoriumRelationshipSuggestions,
};

export const mergeScriptoriumAuthoringOverlay = (
  base: ScriptoriumAuthoringOverlay,
  overlay?: Partial<ScriptoriumAuthoringOverlay>,
): ScriptoriumAuthoringOverlay => ({
  instagramReferences: overlay?.instagramReferences ?? base.instagramReferences,
  exhibits: overlay?.exhibits ?? base.exhibits,
  relationshipSuggestions: overlay?.relationshipSuggestions ?? base.relationshipSuggestions,
});
