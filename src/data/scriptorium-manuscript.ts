import type { CanonicalEntityType, KnowledgeEntityId } from "@/types";

export type ScriptoriumZone = "revelation" | "transmission" | "inquiry";
export type ScriptoriumNodeEmphasis = "primary" | "secondary";

export interface ScriptoriumAuthoredNode {
  id: string;
  entityId: KnowledgeEntityId;
  entityType: CanonicalEntityType;
  position: { x: number; y: number };
  note: string;
  zone: ScriptoriumZone;
  emphasis: ScriptoriumNodeEmphasis;
}

export interface ScriptoriumAuthoredEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  note: string;
  tone: "authorship" | "institutional" | "conceptual" | "contested" | "transmission";
}

export interface ScriptoriumManuscript {
  id: string;
  title: string;
  description: string;
  zoneLabels: Record<ScriptoriumZone, string>;
  nodes: ScriptoriumAuthoredNode[];
  edges: ScriptoriumAuthoredEdge[];
}

export const sacredTimelineScriptoriumMap: ScriptoriumManuscript = {
  id: "scriptorium_seed_map",
  title: "Vision, transmission, and authority",
  description:
    "A first authored semantic map connecting visionary theology, optical inquiry, and the later contest over natural philosophy.",
  zoneLabels: {
    revelation: "Revelation and visionary authorship",
    transmission: "Transmission and conceptual bridges",
    inquiry: "Inquiry, authority, and contestation",
  },
  nodes: [
    {
      id: "scriptorium_hildegard",
      entityId: "person_hildegard_of_bingen",
      entityType: "person",
      position: { x: 80, y: 120 },
      note: "Visionary author whose theology, cosmology, and monastic authority anchor the left field.",
      zone: "revelation",
      emphasis: "primary",
    },
    {
      id: "scriptorium_scivias",
      entityId: "text_scivias",
      entityType: "text",
      position: { x: 330, y: 84 },
      note: "An authored visionary text that binds image, doctrine, and cosmic imagination.",
      zone: "revelation",
      emphasis: "primary",
    },
    {
      id: "scriptorium_rupertsberg",
      entityId: "institution_rupertsberg_abbey",
      entityType: "institution",
      position: { x: 320, y: 284 },
      note: "Institutional setting that stabilizes visionary authorship and manuscript life.",
      zone: "revelation",
      emphasis: "secondary",
    },
    {
      id: "scriptorium_monasticism",
      entityId: "tradition_latin_christian_monasticism",
      entityType: "tradition",
      position: { x: 560, y: 260 },
      note: "The larger monastic tradition in which authorship, devotion, and knowledge circulate.",
      zone: "transmission",
      emphasis: "secondary",
    },
    {
      id: "scriptorium_ibn_al_haytham",
      entityId: "person_ibn_al_haytham",
      entityType: "person",
      position: { x: 560, y: 54 },
      note: "Authorial center of optical inquiry and experimental reasoning.",
      zone: "transmission",
      emphasis: "primary",
    },
    {
      id: "scriptorium_optics",
      entityId: "text_book_of_optics",
      entityType: "text",
      position: { x: 810, y: 70 },
      note: "A transmission text through which optical thought enters broader conceptual circulation.",
      zone: "transmission",
      emphasis: "primary",
    },
    {
      id: "scriptorium_natural_philosophy",
      entityId: "concept_natural_philosophy",
      entityType: "concept",
      position: { x: 1070, y: 168 },
      note: "The shared conceptual field where science and theology repeatedly meet and strain.",
      zone: "inquiry",
      emphasis: "primary",
    },
    {
      id: "scriptorium_galileo",
      entityId: "person_galileo_galilei",
      entityType: "person",
      position: { x: 1310, y: 88 },
      note: "Later figure whose work sharpens the question of inquiry under authority.",
      zone: "inquiry",
      emphasis: "primary",
    },
    {
      id: "scriptorium_trial",
      entityId: "event_galileo_trial_1633",
      entityType: "event",
      position: { x: 1304, y: 304 },
      note: "A judicial and doctrinal flashpoint that reframes the whole map as a problem of authority.",
      zone: "inquiry",
      emphasis: "secondary",
    },
  ],
  edges: [
    {
      id: "scriptorium_edge_hildegard_scivias",
      source: "scriptorium_hildegard",
      target: "scriptorium_scivias",
      label: "authors",
      note: "Authored visionary text",
      tone: "authorship",
    },
    {
      id: "scriptorium_edge_hildegard_rupertsberg",
      source: "scriptorium_hildegard",
      target: "scriptorium_rupertsberg",
      label: "founds and leads",
      note: "Institutional footing",
      tone: "institutional",
    },
    {
      id: "scriptorium_edge_rupertsberg_monasticism",
      source: "scriptorium_rupertsberg",
      target: "scriptorium_monasticism",
      label: "embodies",
      note: "Monastic continuity",
      tone: "institutional",
    },
    {
      id: "scriptorium_edge_scivias_natural_philosophy",
      source: "scriptorium_scivias",
      target: "scriptorium_natural_philosophy",
      label: "cosmological resonance",
      note: "Visionary cosmology brushes the conceptual field of nature.",
      tone: "conceptual",
    },
    {
      id: "scriptorium_edge_ibn_optics",
      source: "scriptorium_ibn_al_haytham",
      target: "scriptorium_optics",
      label: "authors",
      note: "Optical text",
      tone: "authorship",
    },
    {
      id: "scriptorium_edge_optics_natural_philosophy",
      source: "scriptorium_optics",
      target: "scriptorium_natural_philosophy",
      label: "feeds",
      note: "Transmission into shared concept space",
      tone: "transmission",
    },
    {
      id: "scriptorium_edge_natural_philosophy_galileo",
      source: "scriptorium_natural_philosophy",
      target: "scriptorium_galileo",
      label: "frames",
      note: "Inquiry and observation",
      tone: "conceptual",
    },
    {
      id: "scriptorium_edge_natural_philosophy_trial",
      source: "scriptorium_natural_philosophy",
      target: "scriptorium_trial",
      label: "contested in",
      note: "Authority and cosmology collide",
      tone: "contested",
    },
    {
      id: "scriptorium_edge_trial_galileo",
      source: "scriptorium_trial",
      target: "scriptorium_galileo",
      label: "judges",
      note: "Person under institutional pressure",
      tone: "contested",
    },
  ],
};
