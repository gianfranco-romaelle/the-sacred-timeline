import { useEffect, useMemo, useState } from "react";
import {
  defaultScriptoriumAuthoringOverlay,
  mergeScriptoriumAuthoringOverlay,
} from "@/data/scriptorium-authoring";
import type {
  KnowledgeEntityId,
  ScriptoriumAuthoringOverlay,
  ScriptoriumExhibit,
  ScriptoriumRelationshipSuggestion,
} from "@/types";

const STORAGE_KEY = "sacred-timeline-scriptorium-authoring";

const readOverlay = (): ScriptoriumAuthoringOverlay => {
  if (typeof window === "undefined") {
    return defaultScriptoriumAuthoringOverlay;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultScriptoriumAuthoringOverlay;
    return mergeScriptoriumAuthoringOverlay(
      defaultScriptoriumAuthoringOverlay,
      JSON.parse(raw) as Partial<ScriptoriumAuthoringOverlay>,
    );
  } catch {
    return defaultScriptoriumAuthoringOverlay;
  }
};

export const useScriptoriumAuthoring = () => {
  const [overlay, setOverlay] = useState<ScriptoriumAuthoringOverlay>(() => readOverlay());

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(overlay));
  }, [overlay]);

  const actions = useMemo(
    () => ({
      createExhibitFromSelection: (entityIds: KnowledgeEntityId[]) => {
        const now = new Date().toISOString();
        const uniqueIds = Array.from(new Set(entityIds)).slice(0, 12);
        const exhibit: ScriptoriumExhibit = {
          id: `exhibit_${Date.now().toString(36)}`,
          title: `Curated path ${overlay.exhibits.length + 1}`,
          description:
            "Manual exhibit draft assembled from the current Scriptorium selection and visible gallery context.",
          reviewState: "suggested",
          sourceKind: "manual",
          createdAt: now,
          updatedAt: now,
          sections: [
            {
              id: `section_${Date.now().toString(36)}`,
              title: "Opening cluster",
              body:
                "Review the pinned records, add curatorial language, and approve when this path is ready for the gallery.",
              pinnedEntityIds: uniqueIds,
              pinnedMediaIds: [],
              instagramReferenceIds: overlay.instagramReferences.slice(0, 1).map((item) => item.id),
            },
          ],
          relationshipEmphasis: [],
        };
        setOverlay((current) => ({ ...current, exhibits: [exhibit, ...current.exhibits] }));
      },
      setExhibitReviewState: (
        exhibitId: ScriptoriumExhibit["id"],
        reviewState: ScriptoriumExhibit["reviewState"],
      ) => {
        const now = new Date().toISOString();
        setOverlay((current) => ({
          ...current,
          exhibits: current.exhibits.map((exhibit) =>
            exhibit.id === exhibitId ? { ...exhibit, reviewState, updatedAt: now } : exhibit,
          ),
        }));
      },
      setSuggestionReviewState: (
        suggestionId: ScriptoriumRelationshipSuggestion["id"],
        reviewState: ScriptoriumRelationshipSuggestion["reviewState"],
      ) => {
        setOverlay((current) => ({
          ...current,
          relationshipSuggestions: current.relationshipSuggestions.map((suggestion) =>
            suggestion.id === suggestionId ? { ...suggestion, reviewState } : suggestion,
          ),
        }));
      },
      addInstagramReference: (permalink: string) => {
        const clean = permalink.trim();
        if (!clean) return;
        const now = new Date().toISOString();
        setOverlay((current) => ({
          ...current,
          instagramReferences: [
            {
              id: `instagram_${Date.now().toString(36)}`,
              permalink: clean,
              caption: "Curator-added Instagram reference. Add caption and linked records during review.",
              linkedEntityIds: [],
              rightsStatus: "embed_only",
              reviewState: "suggested",
              provenance: {
                sourceKind: "instagram",
                importedAt: now,
                sourceUrl: clean,
                note: "Added from Scriptorium authoring workspace.",
              },
            },
            ...current.instagramReferences,
          ],
        }));
      },
      resetOverlay: () => setOverlay(defaultScriptoriumAuthoringOverlay),
    }),
    [overlay.exhibits.length, overlay.instagramReferences],
  );

  return { overlay, ...actions };
};
