import { useMemo, useState } from "react";
import { EmptyStateCard } from "@/components/shared/empty-state-card";
import {
  buildScriptoriumProjection,
  type ScriptoriumGalleryItem,
  type ScriptoriumMode,
} from "@/data/adapters/scriptorium-adapter";
import type { SeedIndex } from "@/data/entity-index";
import { useViewCoordination } from "@/features/shared/use-view-coordination";
import { useExplorerStore } from "@/state/explorer-store";
import type { CanonicalEntityType, KnowledgeEntityId, SacredTimelineSeedData } from "@/types";
import { ScriptoriumCanvas } from "./scriptorium-canvas";
import { ScriptoriumControls } from "./scriptorium-controls";
import { useScriptoriumAuthoring } from "./use-scriptorium-authoring";

interface ScriptoriumViewProps {
  seed: SacredTimelineSeedData;
  index: SeedIndex;
}

type ReviewFilter = "all" | "suggested" | "approved";

const entityTypes: CanonicalEntityType[] = ["text", "person", "tradition", "institution", "concept"];

function GalleryCard({
  item,
  isSelected,
  onSelect,
}: {
  item: ScriptoriumGalleryItem;
  isSelected: boolean;
  onSelect: (entityId: KnowledgeEntityId, entityType: CanonicalEntityType) => void;
}) {
  return (
    <button
      className={`scriptorium-gallery-card${isSelected ? " is-selected" : ""}`}
      onClick={() => onSelect(item.entityId, item.entityType)}
      type="button"
    >
      <div className="scriptorium-gallery-card__topline">
        <span>{item.entityType}</span>
        <span>{item.reviewState}</span>
      </div>
      <strong>{item.label}</strong>
      <p>{item.description}</p>
      <div className="scriptorium-gallery-card__meta">
        <span>{item.dateLabel}</span>
        <span>{item.relationCount} links</span>
        <span>{item.citationCount} citations</span>
        <span>{item.instagramReferenceCount} IG refs</span>
      </div>
      {item.drivePath ? <span className="scriptorium-gallery-card__path">{item.drivePath}</span> : null}
      <div className="scriptorium-gallery-card__chips">
        {[...item.traditionLabels, ...item.domainLabels].slice(0, 4).map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
    </button>
  );
}

export function ScriptoriumView({ seed, index }: ScriptoriumViewProps) {
  const [mode, setMode] = useState<ScriptoriumMode>("gallery");
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("all");
  const [mediaOnly, setMediaOnly] = useState(false);
  const [instagramPermalink, setInstagramPermalink] = useState("");
  const toggleEntityType = useExplorerStore((state) => state.toggleEntityType);

  const {
    filters,
    selectedEntityId,
    selectionSourceView,
    activeFilterSummary,
    resetFilters,
    selectFromView,
  } = useViewCoordination();

  const {
    overlay,
    createExhibitFromSelection,
    setExhibitReviewState,
    setSuggestionReviewState,
    addInstagramReference,
  } = useScriptoriumAuthoring();

  const projection = useMemo(
    () =>
      buildScriptoriumProjection(
        seed,
        index,
        filters,
        selectedEntityId,
        selectionSourceView,
        overlay,
      ),
    [filters, index, overlay, seed, selectedEntityId, selectionSourceView],
  );

  const galleryItems = useMemo(
    () =>
      projection.galleryItems.filter((item) => {
        if (reviewFilter !== "all" && item.reviewState !== reviewFilter) return false;
        if (mediaOnly && item.instagramReferenceCount === 0) return false;
        return true;
      }),
    [mediaOnly, projection.galleryItems, reviewFilter],
  );

  const selectedItem = projection.galleryItems.find((item) => item.entityId === selectedEntityId);
  const selectedEntityIds = selectedEntityId
    ? [selectedEntityId]
    : galleryItems.slice(0, 6).map((item) => item.entityId);

  const handleAddInstagramReference = () => {
    addInstagramReference(instagramPermalink);
    setInstagramPermalink("");
  };

  return (
    <div className="scriptorium-view">
      <ScriptoriumControls
        activeFilterSummary={activeFilterSummary}
        edgeCount={projection.visibleCounts.edges}
        exhibitCount={projection.visibleCounts.exhibits}
        galleryCount={projection.visibleCounts.galleryItems}
        mapDescription={projection.description}
        mapTitle={projection.title}
        mode={mode}
        onModeChange={setMode}
        reviewCount={projection.visibleCounts.reviewItems}
      />

      <div className="scriptorium-workspace">
        <aside className="scriptorium-rail">
          <p className="eyebrow">Filters</p>
          <div className="scriptorium-rail__group">
            {entityTypes.map((entityType) => (
              <button
                className={filters.entityTypes.includes(entityType) ? "is-active" : ""}
                key={entityType}
                onClick={() => toggleEntityType(entityType)}
                type="button"
              >
                {entityType}
              </button>
            ))}
          </div>
          <div className="scriptorium-rail__group">
            {(["all", "suggested", "approved"] as ReviewFilter[]).map((value) => (
              <button
                className={reviewFilter === value ? "is-active" : ""}
                key={value}
                onClick={() => setReviewFilter(value)}
                type="button"
              >
                {value}
              </button>
            ))}
          </div>
          <label className="scriptorium-rail__check">
            <input checked={mediaOnly} onChange={(event) => setMediaOnly(event.target.checked)} type="checkbox" />
            Media refs only
          </label>
          <button className="scriptorium-rail__reset" onClick={resetFilters} type="button">
            Clear global filters
          </button>
        </aside>

        <main className="scriptorium-main">
          {mode === "gallery" ? (
            galleryItems.length === 0 ? (
              <EmptyStateCard
                activeFilterSummary={activeFilterSummary}
                description="No Scriptorium records match the current gallery filters."
                eyebrow="Scriptorium"
                onResetFilters={resetFilters}
                title="No gallery records in scope."
              />
            ) : (
              <div className="scriptorium-gallery-grid">
                {galleryItems.map((item) => (
                  <GalleryCard
                    isSelected={selectedEntityId === item.entityId}
                    item={item}
                    key={item.id}
                    onSelect={(entityId, entityType) => selectFromView(entityId, entityType, "scriptorium")}
                  />
                ))}
              </div>
            )
          ) : null}

          {mode === "map" ? (
            projection.nodes.length === 0 ? (
              <EmptyStateCard
                activeFilterSummary={activeFilterSummary}
                description="The relationship map needs at least one visible canonical entity."
                eyebrow="Scriptorium"
                onResetFilters={resetFilters}
                title="No relationship nodes match the current scope."
              />
            ) : (
              <ScriptoriumCanvas
                onSelectEntity={(entityId, entityType) => selectFromView(entityId, entityType, "scriptorium")}
                projection={projection}
              />
            )
          ) : null}

          {mode === "exhibits" ? (
            <div className="scriptorium-authoring-panel">
              <div className="scriptorium-authoring-panel__toolbar">
                <div>
                  <p className="eyebrow">Exhibit Builder</p>
                  <h3>Narrative exhibits</h3>
                </div>
                <button onClick={() => createExhibitFromSelection(selectedEntityIds)} type="button">
                  Draft from current scope
                </button>
              </div>
              <div className="scriptorium-exhibit-list">
                {projection.exhibits.map((exhibit) => (
                  <article className="scriptorium-exhibit" key={exhibit.id}>
                    <div>
                      <span>{exhibit.reviewState}</span>
                      <h4>{exhibit.title}</h4>
                      <p>{exhibit.description}</p>
                    </div>
                    <div className="scriptorium-exhibit__sections">
                      {exhibit.sections.map((section) => (
                        <section key={section.id}>
                          <strong>{section.title}</strong>
                          <p>{section.body}</p>
                          <span>{section.pinnedEntityIds.length} pinned records</span>
                        </section>
                      ))}
                    </div>
                    <div className="scriptorium-exhibit__actions">
                      <button onClick={() => setExhibitReviewState(exhibit.id, "approved")} type="button">
                        Approve
                      </button>
                      <button onClick={() => setExhibitReviewState(exhibit.id, "rejected")} type="button">
                        Reject
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ) : null}

          {mode === "review" ? (
            <div className="scriptorium-review">
              <section className="scriptorium-review__section">
                <p className="eyebrow">Instagram manifest</p>
                <div className="scriptorium-review__input-row">
                  <input
                    onChange={(event) => setInstagramPermalink(event.target.value)}
                    placeholder="Paste public Instagram post permalink"
                    value={instagramPermalink}
                  />
                  <button onClick={handleAddInstagramReference} type="button">
                    Add reference
                  </button>
                </div>
                {projection.instagramReferences.map((reference) => (
                  <article className="scriptorium-review-item" key={reference.id}>
                    <span>{reference.reviewState}</span>
                    <strong>{reference.caption}</strong>
                    <a href={reference.permalink} rel="noreferrer" target="_blank">
                      Open Instagram reference
                    </a>
                  </article>
                ))}
              </section>

              <section className="scriptorium-review__section">
                <p className="eyebrow">AI relationship suggestions</p>
                {projection.relationshipSuggestions.length === 0 ? (
                  <p className="scriptorium-review__empty">
                    No AI suggestions are queued yet. Draft exhibits remain curator-approved before publication.
                  </p>
                ) : (
                  projection.relationshipSuggestions.map((suggestion) => (
                    <article className="scriptorium-review-item" key={suggestion.id}>
                      <span>{Math.round(suggestion.confidence * 100)}% confidence</span>
                      <strong>{suggestion.label}</strong>
                      <p>{suggestion.rationale}</p>
                      <div>
                        <button onClick={() => setSuggestionReviewState(suggestion.id, "approved")} type="button">
                          Approve
                        </button>
                        <button onClick={() => setSuggestionReviewState(suggestion.id, "rejected")} type="button">
                          Reject
                        </button>
                      </div>
                    </article>
                  ))
                )}
              </section>
            </div>
          ) : null}
        </main>

        <aside className="scriptorium-inspector">
          <p className="eyebrow">Inspector</p>
          {selectedItem ? (
            <>
              <h3>{selectedItem.label}</h3>
              <p>{selectedItem.description}</p>
              <div className="scriptorium-inspector__facts">
                <span>{selectedItem.entityType}</span>
                <span>{selectedItem.dateLabel}</span>
                <span>{selectedItem.reviewState}</span>
                <span>{selectedItem.relationCount} relations</span>
              </div>
              {selectedItem.drivePath ? (
                <p className="scriptorium-inspector__source">Drive: {selectedItem.drivePath}</p>
              ) : null}
              {selectedItem.sourceLabel ? (
                <p className="scriptorium-inspector__source">Source: {selectedItem.sourceLabel}</p>
              ) : null}
              <button onClick={() => createExhibitFromSelection([selectedItem.entityId])} type="button">
                Start exhibit from this record
              </button>
            </>
          ) : (
            <p>Select a gallery card or map node to inspect evidence, relations, and authoring actions.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
