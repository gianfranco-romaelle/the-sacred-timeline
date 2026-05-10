import type { EdgeRelationType } from "@/types";
import type { ConstellationClusterKind } from "@/data/adapters/graph-adapter";
import type { ConstellationLayoutMode } from "./constellation-canvas";
import type { ConstellationRelationFamilyId } from "./constellation-styles";

export type ConstellationViewMode = "regions" | "story" | "network";
export type ConstellationDensity = "exhibit" | "readable" | "full";

export interface ConstellationClusterChip {
  id: string;
  label: string;
  kind: ConstellationClusterKind;
  nodeCount: number;
  hiddenCount: number;
}

interface ConstellationControlsProps {
  visibleNodeCount: number;
  visibleEdgeCount: number;
  selectedNeighborCount: number;
  hoveredLabel?: string;
  selectedLabel?: string;
  activeFilterSummary: string[];
  activeRelationTypes: EdgeRelationType[];
  visibleRelationTypes: EdgeRelationType[];
  viewMode?: ConstellationViewMode;
  density?: ConstellationDensity;
  focusedClusterId?: string;
  clusterChips?: ConstellationClusterChip[];
  enabledClusterKinds?: ConstellationClusterKind[];
  availableRelationFamilies?: {
    id: ConstellationRelationFamilyId;
    label: string;
  }[];
  hiddenRelationFamilies?: ConstellationRelationFamilyId[];
  layoutMode?: ConstellationLayoutMode;
  neighborhoodDepth?: number;
  isolateNeighborhood?: boolean;
  hasSelectedNode?: boolean;
  pinnedNodeCount?: number;
  canPinFocusedNode?: boolean;
  focusedNodePinned?: boolean;
  searchQuery?: string;
  searchMatchCount?: number;
  onViewModeChange?: (mode: ConstellationViewMode) => void;
  onDensityChange?: (density: ConstellationDensity) => void;
  onFocusCluster?: (clusterId?: string) => void;
  onToggleClusterKind?: (kind: ConstellationClusterKind) => void;
  onLayoutModeChange?: (layoutMode: ConstellationLayoutMode) => void;
  onDepthChange?: (depth: number) => void;
  onToggleIsolateNeighborhood?: () => void;
  onToggleRelationType: (relationType: EdgeRelationType) => void;
  onToggleHiddenRelationFamily?: (familyId: ConstellationRelationFamilyId) => void;
  onToggleFocusedPin?: () => void;
  onClearPinnedNodes?: () => void;
  onSearchQueryChange?: (query: string) => void;
  onFocusSearchResult?: () => void;
}

const layoutOptions: { id: ConstellationLayoutMode; label: string }[] = [
  { id: "force", label: "All relations" },
  { id: "radial", label: "Radial" },
  { id: "circle", label: "Circle" },
  { id: "degree", label: "Degree" },
];

const viewModeOptions: { id: ConstellationViewMode; label: string }[] = [
  { id: "regions", label: "Regions" },
  { id: "story", label: "Story" },
  { id: "network", label: "Network" },
];

const densityOptions: { id: ConstellationDensity; label: string }[] = [
  { id: "exhibit", label: "Exhibit" },
  { id: "readable", label: "Readable" },
  { id: "full", label: "Full" },
];

const clusterKindOptions: { id: ConstellationClusterKind; label: string }[] = [
  { id: "embedding_cluster", label: "Stories" },
  { id: "school", label: "Schools" },
  { id: "math_tag", label: "Math" },
  { id: "scientific_domain", label: "Science" },
  { id: "cognitive_tag", label: "Cognitive" },
  { id: "calculus", label: "Calculi" },
  { id: "domain", label: "Domains" },
];

export function ConstellationControls({
  visibleNodeCount,
  visibleEdgeCount,
  selectedNeighborCount,
  hoveredLabel,
  selectedLabel,
  activeFilterSummary,
  activeRelationTypes,
  visibleRelationTypes,
  viewMode = "regions",
  density = "readable",
  focusedClusterId,
  clusterChips = [],
  enabledClusterKinds = clusterKindOptions.map((option) => option.id),
  availableRelationFamilies = [],
  hiddenRelationFamilies = [],
  layoutMode = "force",
  neighborhoodDepth = 1,
  isolateNeighborhood = false,
  hasSelectedNode = false,
  pinnedNodeCount = 0,
  canPinFocusedNode = false,
  focusedNodePinned = false,
  searchQuery = "",
  searchMatchCount = 0,
  onViewModeChange = () => {},
  onDensityChange = () => {},
  onFocusCluster = () => {},
  onToggleClusterKind = () => {},
  onLayoutModeChange = () => {},
  onDepthChange = () => {},
  onToggleIsolateNeighborhood = () => {},
  onToggleRelationType,
  onToggleHiddenRelationFamily = () => {},
  onToggleFocusedPin = () => {},
  onClearPinnedNodes = () => {},
  onSearchQueryChange = () => {},
  onFocusSearchResult = () => {},
}: ConstellationControlsProps) {
  return (
    <div className="constellation-controls">
      <div className="constellation-controls__intro">
        <p className="eyebrow">Constellation</p>
        <h2>Knowledge field</h2>
        <p>
          Typed relations gather people, texts, concepts, institutions, and places into one
          navigable intellectual sky.
        </p>
      </div>

      <div className="constellation-controls__summary">
        <span>{visibleNodeCount} visible nodes</span>
        <span>{visibleEdgeCount} visible relations</span>
        <span>{clusterChips.length} semantic regions</span>
        <span>{selectedNeighborCount} selected neighbors</span>
        {selectedLabel ? <span>Selected: {selectedLabel}</span> : null}
        {hoveredLabel ? <span>Hovering: {hoveredLabel}</span> : null}
      </div>

      {activeFilterSummary.length > 0 ? (
        <div className="constellation-controls__summary constellation-controls__summary--chips">
          {activeFilterSummary.map((item) => (
            <span className="constellation-controls__chip" key={item}>
              {item}
            </span>
          ))}
        </div>
      ) : null}

      <div className="constellation-controls__panel">
        <div className="constellation-controls__segmented" role="tablist" aria-label="Constellation mode">
          {viewModeOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`filter-chip${viewMode === option.id ? " is-active" : ""}`}
              onClick={() => onViewModeChange(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="constellation-controls__segmented" role="tablist" aria-label="Constellation density">
          {densityOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`filter-chip${density === option.id ? " is-active" : ""}`}
              onClick={() => onDensityChange(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <label className="constellation-controls__field">
          <span className="constellation-controls__label">Layout mode</span>
          <select
            value={layoutMode}
            onChange={(event) => onLayoutModeChange(event.target.value as ConstellationLayoutMode)}
          >
            {layoutOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="constellation-controls__field">
          <span className="constellation-controls__label">
            Depth from selection: {neighborhoodDepth}
          </span>
          <input
            type="range"
            min="1"
            max="4"
            step="1"
            value={neighborhoodDepth}
            disabled={!hasSelectedNode}
            onChange={(event) => onDepthChange(Number(event.target.value))}
          />
        </label>

        <label className="constellation-controls__toggle">
          <input
            type="checkbox"
            checked={isolateNeighborhood}
            disabled={!hasSelectedNode}
            onChange={onToggleIsolateNeighborhood}
          />
          <span>Isolate neighborhood</span>
        </label>
      </div>

      <div className="constellation-controls__filters">
        <span className="constellation-controls__label">Semantic region kinds</span>
        <div className="constellation-controls__chips">
          {clusterKindOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`filter-chip${enabledClusterKinds.includes(option.id) ? " is-active" : ""}`}
              onClick={() => onToggleClusterKind(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {clusterChips.length > 0 ? (
        <div className="constellation-controls__filters">
          <span className="constellation-controls__label">Local semantic regions</span>
          <div className="constellation-controls__chips constellation-controls__chips--regions">
            {clusterChips.map((cluster) => (
              <button
                key={cluster.id}
                type="button"
                className={`filter-chip${focusedClusterId === cluster.id ? " is-active" : ""}`}
                onClick={() => onFocusCluster(focusedClusterId === cluster.id ? undefined : cluster.id)}
                title={cluster.kind.replaceAll("_", " ")}
              >
                {cluster.label}
                <span className="constellation-controls__chip-count">
                  {cluster.nodeCount}
                  {cluster.hiddenCount > 0 ? ` +${cluster.hiddenCount}` : ""}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="constellation-controls__panel constellation-controls__panel--search">
        <label className="constellation-controls__field">
          <span className="constellation-controls__label">Search graph</span>
          <input
            type="search"
            value={searchQuery}
            placeholder="Find nodes by name, type, or description"
            onChange={(event) => onSearchQueryChange(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="filter-chip"
          disabled={searchMatchCount === 0}
          onClick={onFocusSearchResult}
        >
          {searchMatchCount === 0 ? "No matches" : `Focus ${searchMatchCount} match${searchMatchCount === 1 ? "" : "es"}`}
        </button>
      </div>

      <div className="constellation-controls__panel">
        <button
          type="button"
          className={`filter-chip${focusedNodePinned ? " is-active" : ""}`}
          disabled={!canPinFocusedNode}
          onClick={onToggleFocusedPin}
        >
          {focusedNodePinned ? "Unpin focused node" : "Pin focused node"}
        </button>
        <button
          type="button"
          className="filter-chip"
          disabled={pinnedNodeCount === 0}
          onClick={onClearPinnedNodes}
        >
          Clear pinned ({pinnedNodeCount})
        </button>
      </div>

      <div className="constellation-controls__filters">
        <span className="constellation-controls__label">Global relation filters</span>
        <div className="constellation-controls__chips">
          {visibleRelationTypes.map((relationType) => {
            const isActive =
              activeRelationTypes.length === 0 || activeRelationTypes.includes(relationType);

            return (
              <button
                key={relationType}
                type="button"
                className={`filter-chip${isActive ? " is-active" : ""}`}
                onClick={() => onToggleRelationType(relationType)}
              >
                {relationType.replaceAll("_", " ")}
              </button>
            );
          })}
        </div>
      </div>

      <div className="constellation-controls__filters">
        <span className="constellation-controls__label">Show relation families</span>
        <div className="constellation-controls__chips">
          {availableRelationFamilies.map((family) => {
            const isVisible = !hiddenRelationFamilies.includes(family.id);

            return (
              <button
                key={family.id}
                type="button"
                className={`filter-chip${isVisible ? " is-active" : ""}`}
                onClick={() => onToggleHiddenRelationFamily(family.id)}
              >
                {family.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
