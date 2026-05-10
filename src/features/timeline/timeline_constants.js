import { BookOpen, Landmark, MapPin, User } from "lucide-react";

export const SCENE_TUNING_STORAGE_KEY = "sacred-timeline-scene-tuning";
export const GRAPH_STATE_VERSION = 1;
export const GRAPH_ZOOM_RANGE = { min: 0.45, max: 2.25 };
export const EMPTY_GRAPH_STATE = {
  version: GRAPH_STATE_VERSION,
  bundleLayouts: {},
};

export const EMPTY_ITEMS = [];
export const CHRONO_RENDER_LIMIT = 400;
export const GRAPH_NODE_LIMIT = 900;
export const GRAPH_EDGE_LIMIT = 2400;

export const HORIZONTAL_ZOOM_OPTIONS = ["0.125", "0.25", "0.5", "1", "2", "4"];
export const VERTICAL_ZOOM_OPTIONS = ["0.75", "1", "1.2", "1.4"];
export const HORIZONTAL_ZOOM_RANGE = { min: 0.0625, max: 6 };
export const VERTICAL_ZOOM_RANGE = { min: 0.7, max: 1.8 };

export const CALCULUS_CLUSTER_ORDER = ["Zeroth", "First", "Second", "Third", "Fourth", "Fifth", "Unclassified"];

export const EDITABLE_TYPE_OPTIONS = [
  { value: "person", label: "Person", icon: User },
  { value: "event", label: "Event", icon: Landmark },
  { value: "place", label: "Place", icon: MapPin },
  { value: "book", label: "Book", icon: BookOpen },
];

export function parseTimelineYearBounds(rawText) {
  const result = { minYear: -700, maxYear: 2026, paddingYears: 50 };
  rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const [key, value] = line.split("=");
      const numericValue = Number.parseInt(value, 10);
      if (!Number.isFinite(numericValue)) return;
      if (key === "minYear") result.minYear = numericValue;
      if (key === "maxYear") result.maxYear = numericValue;
      if (key === "paddingYears") result.paddingYears = numericValue;
    });
  return result;
}
