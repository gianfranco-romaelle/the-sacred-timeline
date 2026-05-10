import { type CSSProperties, useRef, useState } from "react";
import {
  getCitationsForEntity,
  getDomainLabels,
  getEdgeById,
  getEdgesForEntity,
  getEntityDateLabel,
  getEntityTypeLabel,
  getIncomingEdgesForEntity,
  getOutgoingEdgesForEntity,
  getPrimaryPortraitForEntity,
  getRelatedEntities,
  getTagLabels,
  getTraditionsForEntity,
} from "@/data/entity-index";
import type { SeedIndex } from "@/data/entity-index";
import type { FocusContext } from "@/data/focus-context";
import { getCondensedActiveFilterSummary } from "@/data/filter-controls";
import {
  extractEntityEditorialMetadata,
  getEditorialStageLabel,
  getEditorialStageWindowLabel,
} from "@/editorial/stage-lens";
import { HistoricalAdminPanel } from "@/components/admin/historical-admin-panel";
import { useHistoricalRuntime } from "@/historical/runtime-context";
import type { EffectiveCanonicalEntity } from "@/historical/types";
import { useAdminStore } from "@/state/admin-store";
import { useExplorerStore } from "@/state/explorer-store";
import type { ExplorerView } from "@/state/explorer-store";
import { selectHasActiveFilters } from "@/state/selectors";
import type { KnowledgeEntity, KnowledgeEntityId, SacredTimelineSeedData } from "@/types";

const limitLabels = (values: string[] | undefined, maxItems = 3) =>
  (values ?? []).filter(Boolean).slice(0, maxItems);

const VIEW_LABELS: Record<string, string> = {
  river: "River",
  constellation: "Const.",
  atlas: "Atlas",
  "face-atlas": "Faces",
};

const JUMPABLE_VIEWS: ExplorerView[] = ["river", "constellation", "atlas", "face-atlas"];

interface DetailsPanelProps {
  seed: SacredTimelineSeedData;
  index: SeedIndex;
  selectedEntity?: KnowledgeEntity;
  selectedEntityIsVisible: boolean;
  focusContext: FocusContext;
}

export function DetailsPanel({
  seed,
  index,
  selectedEntity,
  selectedEntityIsVisible,
  focusContext,
}: DetailsPanelProps) {
  const [pinnedEntityId, setPinnedEntityId] = useState<KnowledgeEntityId | undefined>(undefined);
  const [expandedCitationIds, setExpandedCitationIds] = useState<Set<string>>(new Set());
  const [copyFeedback, setCopyFeedback] = useState(false);
  const dragRef = useRef({ active: false, startX: 0, startY: 0, px: 0, py: 0 });

  const onDragDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!detached) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { active: true, startX: e.clientX, startY: e.clientY, px: pos.x, py: pos.y };
  };
  const onDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    setInspectorPosition({
      x: dragRef.current.px + (e.clientX - dragRef.current.startX),
      y: dragRef.current.py + (e.clientY - dragRef.current.startY),
    });
  };
  const onDragUp = () => { dragRef.current.active = false; };

  const toggleDetach = () => {
    if (!detached) {
      setInspectorPosition({ x: Math.max(0, window.innerWidth - 440), y: 80 });
    }
    setInspectorDetached(!detached);
  };

  const primaryPortrait = getPrimaryPortraitForEntity(selectedEntity?.id, seed);
  const citations = getCitationsForEntity(selectedEntity?.id, seed);
  const relatedEntities = getRelatedEntities(selectedEntity, index);
  const traditions = getTraditionsForEntity(selectedEntity, seed);
  const relationEdges = getEdgesForEntity(selectedEntity?.id, index);
  const outgoingEdges = getOutgoingEdgesForEntity(selectedEntity?.id, index);
  const incomingEdges = getIncomingEdgesForEntity(selectedEntity?.id, index);

  const filters = useExplorerStore((state) => state.filters);
  const selectedRelationId = useExplorerStore((state) => state.selectedRelationId);
  const panels = useExplorerStore((state) => state.panels);
  const hasActiveFilters = useExplorerStore(selectHasActiveFilters);
  const resetFilters = useExplorerStore((state) => state.resetFilters);
  const selectEntity = useExplorerStore((state) => state.selectEntity);
  const setActiveView = useExplorerStore((state) => state.setActiveView);
  const setInspectorDetached = useExplorerStore((state) => state.setInspectorDetached);
  const setInspectorPosition = useExplorerStore((state) => state.setInspectorPosition);
  const focusEntityNeighborhood = useExplorerStore((state) => state.focusEntityNeighborhood);
  const activeView = useExplorerStore((state) => state.activeView);
  const detached = panels.inspectorDetached;
  const pos = panels.inspectorPosition;

  const selectedRelation = getEdgeById(selectedRelationId, index);
  const relationSourceEntity = selectedRelation
    ? index.entitiesById.get(selectedRelation.sourceId as KnowledgeEntityId)
    : undefined;
  const relationTargetEntity = selectedRelation
    ? index.entitiesById.get(selectedRelation.targetId as KnowledgeEntityId)
    : undefined;
  const { getEffectiveCanonicalEntity, snapshot } = useHistoricalRuntime();
  const isAdminMode = useAdminStore((state) => state.isAdminMode);
  const activeFilterSummary = getCondensedActiveFilterSummary(filters, index, 6);
  const historicalEntity = getEffectiveCanonicalEntity(selectedEntity?.id) as
    | EffectiveCanonicalEntity
    | undefined;
  const editorialMetadata = selectedEntity ? extractEntityEditorialMetadata(selectedEntity) : undefined;
  const editorialProfile = editorialMetadata?.stageProfile;
  const editorialProfiles =
    editorialMetadata?.stageProfiles?.length && editorialMetadata.stageProfiles.length > 0
      ? editorialMetadata.stageProfiles
      : editorialProfile
        ? [editorialProfile]
        : [];
  const structuralThemes = limitLabels(editorialMetadata?.crosswalk?.structuralThemes);
  const mentalModes = limitLabels(editorialMetadata?.crosswalk?.mentalModes, 2);
  const characteristicForms = limitLabels(editorialMetadata?.crosswalk?.characteristicForms, 2);
  const ontologicalFocus = limitLabels(editorialMetadata?.crosswalk?.ontologicalFocus, 2);
  const chemicalEpochs = limitLabels(editorialMetadata?.crosswalk?.chemicalEpochs, 2);
  const drugEpochs = limitLabels(editorialMetadata?.crosswalk?.drugEpochs, 2);
  const topRelationTypes = Array.from(
    new Set(relationEdges.map((edge) => edge.relationType.replaceAll("_", " "))),
  ).slice(0, 4);

  const pinnedEntity = pinnedEntityId ? index.entitiesById.get(pinnedEntityId) : undefined;
  const pinnedDomains = pinnedEntity ? getDomainLabels(pinnedEntity.domainIds, index) : [];
  const selectedDomains = selectedEntity ? getDomainLabels(selectedEntity.domainIds, index) : [];
  const sharedDomains = selectedDomains.filter((label) => pinnedDomains.includes(label));

  const handleSelectEntity = (entity: KnowledgeEntity) => {
    selectEntity(entity.id, entity.entityType);
  };

  const handleShowInView = (view: ExplorerView) => {
    if (selectedEntity) {
      selectEntity(selectedEntity.id, selectedEntity.entityType, view);
    }
    setActiveView(view);
  };

  const handleFocusNeighborhood = () => {
    if (!selectedEntity) return;
    focusEntityNeighborhood(
      [selectedEntity.id, ...focusContext.neighborIds],
      `${selectedEntity.label} neighborhood`,
    );
  };

  const handleCopyRecord = () => {
    if (!selectedEntity) return;
    const lines = [
      selectedEntity.label,
      `${getEntityTypeLabel(selectedEntity.entityType)} - ${getEntityDateLabel(selectedEntity)}`,
      "",
      selectedEntity.description,
    ];
    if (citations.length > 0) {
      lines.push("", "Citations:");
      citations.forEach((c) => lines.push(`  - ${c.label}`));
    }
    if (relatedEntities.length > 0) {
      lines.push("", "Related:");
      relatedEntities
        .slice(0, 6)
        .forEach((e) => lines.push(`  - ${e.label} (${getEntityTypeLabel(e.entityType)})`));
    }
    navigator.clipboard.writeText(lines.join("\n"));
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 1800);
  };

  const handlePinToggle = () => {
    if (!selectedEntity) return;
    setPinnedEntityId((prev) =>
      prev === selectedEntity.id ? undefined : selectedEntity.id,
    );
  };

  const handleToggleCitation = (citationId: string) => {
    setExpandedCitationIds((prev) => {
      const next = new Set(prev);
      if (next.has(citationId)) next.delete(citationId);
      else next.add(citationId);
      return next;
    });
  };

  const panelStyle: CSSProperties = detached
    ? { position: "fixed", top: pos.y, left: pos.x, zIndex: 200, width: 400 }
    : {};

  return (
    <aside className={`details-panel${detached ? " is-detached" : ""}`} style={panelStyle}>
      <div
        className={`details-panel__toolbar${detached ? " is-draggable" : ""}`}
        onPointerDown={onDragDown}
        onPointerMove={onDragMove}
        onPointerUp={onDragUp}
      >
        <span className="details-panel__drag-dots" aria-hidden="true">::</span>
        <span className="details-panel__toolbar-title">Inspector</span>
        <button type="button" className="details-panel__float-btn" onClick={toggleDetach}>
          {detached ? "Dock" : "Float"}
        </button>
      </div>

      {selectedRelation ? (
        <div className="details-panel__section details-panel__relation-focus">
          <p className="eyebrow">Focused relation</p>
          <h3>{selectedRelation.relationType.replaceAll("_", " ")}</h3>
          {selectedRelation.label ? (
            <p className="details-panel__type">{selectedRelation.label}</p>
          ) : null}
          <div className="token-list">
            {relationSourceEntity ? (
              <button
                type="button"
                className="token details-panel__entity-link"
                onClick={() => handleSelectEntity(relationSourceEntity)}
                title="Inspect this entity"
              >
                {relationSourceEntity.label}
              </button>
            ) : null}
            <span className="token token--muted">{selectedRelation.direction}</span>
            {relationTargetEntity ? (
              <button
                type="button"
                className="token details-panel__entity-link"
                onClick={() => handleSelectEntity(relationTargetEntity)}
                title="Inspect this entity"
              >
                {relationTargetEntity.label}
              </button>
            ) : null}
          </div>
          {selectedRelation.assertionLayer ? (
            <p className="details-panel__notice">
              Assertion layer:{" "}
              <strong>{selectedRelation.assertionLayer.replaceAll("_", " ")}</strong>
              {selectedRelation.certainty ? ` - ${selectedRelation.certainty}` : ""}
            </p>
          ) : null}
          {selectedRelation.description ? (
            <p>{selectedRelation.description}</p>
          ) : null}
        </div>
      ) : null}

      {!selectedEntity ? (
        <div className="details-panel__empty">
          <p className="eyebrow">Inspector</p>
          <h2>No selection yet</h2>
          <p>
            Choose an entity from any view to inspect its chronology, domains, citations, and
            relationships.
          </p>
        </div>
      ) : (
        <>
          {pinnedEntity && pinnedEntity.id !== selectedEntity.id ? (
            <div className="details-panel__section details-panel__pinned-banner">
              <div className="details-panel__pinned-header">
                <p className="eyebrow">Pinned for comparison</p>
                <button
                  type="button"
                  className="details-panel__icon-btn"
                  onClick={() => setPinnedEntityId(undefined)}
                  title="Unpin"
                >
                  x
                </button>
              </div>
              <p className="details-panel__pinned-label">{pinnedEntity.label}</p>
              <p className="details-panel__type">
                {getEntityTypeLabel(pinnedEntity.entityType)} - {getEntityDateLabel(pinnedEntity)}
              </p>
              <div className="details-panel__compare-grid">
                <div>
                  <strong>Current</strong>
                  <span>{getEntityTypeLabel(selectedEntity.entityType)}</span>
                  <span>{selectedDomains.slice(0, 2).join(", ") || "No domain"}</span>
                </div>
                <div>
                  <strong>Pinned</strong>
                  <span>{getEntityTypeLabel(pinnedEntity.entityType)}</span>
                  <span>{pinnedDomains.slice(0, 2).join(", ") || "No domain"}</span>
                </div>
              </div>
              {sharedDomains.length > 0 ? (
                <p className="details-panel__notice">
                  Shared domain: {sharedDomains.slice(0, 3).join(", ")}
                </p>
              ) : null}
              {pinnedEntity.description ? (
                <p className="details-panel__pinned-desc">{pinnedEntity.description}</p>
              ) : null}
              <button
                type="button"
                className="details-panel__clear"
                onClick={() => handleSelectEntity(pinnedEntity)}
              >
                Switch to pinned
              </button>
            </div>
          ) : null}

          <div className="details-panel__section">
            <p className="eyebrow">Selected entity</p>
            <h2>{selectedEntity.label}</h2>
            <p className="details-panel__type">
              {getEntityTypeLabel(selectedEntity.entityType)} - {getEntityDateLabel(selectedEntity)}
            </p>
            {!selectedEntityIsVisible ? (
              <p className="details-panel__notice">
                This entity is outside the current filtered view, but the shared selection is
                preserved.
              </p>
            ) : null}
            {!selectedEntityIsVisible && hasActiveFilters && activeFilterSummary.length > 0 ? (
              <div className="details-panel__filter-context">
                <div className="token-list">
                  {activeFilterSummary.map((label) => (
                    <span className="token token--muted" key={label}>
                      {label}
                    </span>
                  ))}
                </div>
                <button className="details-panel__clear" onClick={resetFilters} type="button">
                  Clear filters
                </button>
              </div>
            ) : null}
            <p>{selectedEntity.description}</p>

            <div className="details-panel__actions">
              <button
                type="button"
                className="details-panel__primary-action"
                onClick={handleFocusNeighborhood}
                disabled={focusContext.neighborIds.length === 0}
                title="Filter the workspace to this entity and its visible neighbors"
              >
                Focus neighborhood
              </button>
              <div className="details-panel__view-btns">
                {JUMPABLE_VIEWS.map((view) => (
                  <button
                    key={view}
                    type="button"
                    className={`details-panel__view-btn${activeView === view ? " is-active" : ""}`}
                    onClick={() => handleShowInView(view)}
                    title={`Open in ${view.replace("-", " ")}`}
                  >
                    {VIEW_LABELS[view]}
                  </button>
                ))}
              </div>
              <div className="details-panel__action-btns">
                <button
                  type="button"
                  className="details-panel__icon-btn"
                  onClick={handleCopyRecord}
                  title="Copy record to clipboard"
                >
                  {copyFeedback ? "OK" : "Copy"}
                </button>
                <button
                  type="button"
                  className={`details-panel__icon-btn${pinnedEntityId === selectedEntity.id ? " is-active" : ""}`}
                  onClick={handlePinToggle}
                  title={pinnedEntityId === selectedEntity.id ? "Unpin" : "Pin for comparison"}
                >
                  Pin
                </button>
              </div>
            </div>
          </div>

          <div className="details-panel__section">
            <h3>Scholarly framing</h3>
            <div className="token-list">
              {getDomainLabels(selectedEntity.domainIds, index).map((label) => (
                <span className="token" key={label}>
                  {label}
                </span>
              ))}
              {getTagLabels(selectedEntity.tagIds, index).map((label) => (
                <span className="token token--muted" key={label}>
                  {label}
                </span>
              ))}
              {traditions.map((tradition) => (
                <span className="token token--muted" key={tradition.id}>
                  {tradition.label}
                </span>
              ))}
            </div>
          </div>

          {editorialMetadata ? (
            <div className="details-panel__section">
              <h3>Editorial lens</h3>
              <div className="details-panel__editorial-chips">
                {editorialMetadata.calculusStage !== undefined ? (
                  <span className="details-panel__editorial-chip">
                    Calculus{" "}
                    {editorialProfile?.label ??
                      getEditorialStageLabel(editorialMetadata.calculusStage)}
                  </span>
                ) : null}
                {editorialMetadata.quantumStage !== undefined ? (
                  <span className="details-panel__editorial-chip is-muted">
                    Quantum {getEditorialStageLabel(editorialMetadata.quantumStage)}
                  </span>
                ) : null}
                {editorialProfile ? (
                  <span className="details-panel__editorial-chip is-muted">
                    Profile {editorialProfile.label}
                  </span>
                ) : null}
                {editorialProfiles.slice(1).map((profile) => (
                  <span className="details-panel__editorial-chip is-muted" key={profile.id}>
                    Profile {profile.label}
                  </span>
                ))}
                {editorialMetadata.assignmentState ? (
                  <span className="details-panel__editorial-chip is-muted">
                    {editorialMetadata.assignmentState}
                  </span>
                ) : null}
                {typeof editorialMetadata.confidence === "number" ? (
                  <span className="details-panel__editorial-chip is-muted">
                    {Math.round(editorialMetadata.confidence * 100)}% confidence
                  </span>
                ) : null}
              </div>
              <p className="details-panel__editorial-summary">
                {editorialMetadata.stageTag?.notes ??
                  editorialMetadata.crosswalk?.summary ??
                  editorialProfile?.summary ??
                  "This record carries editorial stage metadata as part of the interpretive layer."}
              </p>
              {editorialMetadata.sourceLabel ? (
                <p className="details-panel__editorial-source">
                  Curatorial source: {editorialMetadata.sourceLabel}
                </p>
              ) : null}
              <div className="details-panel__editorial-grid">
                {editorialProfile?.epochLabel ? (
                  <div>
                    <strong>Epoch</strong>
                    <span>{editorialProfile.epochLabel}</span>
                  </div>
                ) : null}
                {editorialProfile ? (
                  <div>
                    <strong>Stage window</strong>
                    <span>{getEditorialStageWindowLabel(editorialProfile) ?? "Unspecified"}</span>
                  </div>
                ) : null}
                {structuralThemes.length > 0 ? (
                  <div>
                    <strong>Structural themes</strong>
                    <span>{structuralThemes.join(", ")}</span>
                  </div>
                ) : null}
                {mentalModes.length > 0 ? (
                  <div>
                    <strong>Mental mode</strong>
                    <span>{mentalModes.join(", ")}</span>
                  </div>
                ) : null}
                {characteristicForms.length > 0 ? (
                  <div>
                    <strong>Characteristic form</strong>
                    <span>{characteristicForms.join(", ")}</span>
                  </div>
                ) : null}
                {ontologicalFocus.length > 0 ? (
                  <div>
                    <strong>Ontological focus</strong>
                    <span>{ontologicalFocus.join(", ")}</span>
                  </div>
                ) : null}
                {chemicalEpochs.length > 0 ? (
                  <div>
                    <strong>Chemical epoch</strong>
                    <span>{chemicalEpochs.join(", ")}</span>
                  </div>
                ) : null}
                {drugEpochs.length > 0 ? (
                  <div>
                    <strong>Drug epoch</strong>
                    <span>{drugEpochs.join(", ")}</span>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="details-panel__section">
            <h3>Evidence and media</h3>
            <p>{citations.length} citation{citations.length === 1 ? "" : "s"} linked.</p>
            {citations.length > 0 ? (
              <ul className="details-panel__list details-panel__citation-list">
                {citations.slice(0, 5).map((citation) => {
                  const isExpanded = expandedCitationIds.has(citation.id);
                  const source = index.sourcesById.get(citation.sourceId);
                  return (
                    <li
                      key={citation.id}
                      className={`details-panel__citation-item${isExpanded ? " is-expanded" : ""}`}
                    >
                      <button
                        type="button"
                        className="details-panel__citation-toggle"
                        onClick={() => handleToggleCitation(citation.id)}
                      >
                        <span className="details-panel__citation-chevron" aria-hidden="true">
                          {isExpanded ? "v" : ">"}
                        </span>
                        {citation.label}
                      </button>
                      {isExpanded ? (
                        <div className="details-panel__citation-body">
                          {citation.description ? <p>{citation.description}</p> : null}
                          {citation.quotedText ? (
                            <blockquote className="details-panel__citation-quote">
                              {citation.quotedText}
                            </blockquote>
                          ) : null}
                          {citation.locator ? (
                            <p className="details-panel__citation-locator">
                              {citation.locator.kind}: {citation.locator.value}
                            </p>
                          ) : null}
                          {source?.url ? (
                            <a
                              href={source.url}
                              target="_blank"
                              rel="noreferrer"
                              className="details-panel__citation-source-link"
                            >
                              Source
                            </a>
                          ) : source ? (
                            <p className="details-panel__citation-locator">{source.label}</p>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
                {citations.length > 5 ? (
                  <li className="details-panel__citation-more">
                    +{citations.length - 5} more
                  </li>
                ) : null}
              </ul>
            ) : null}
            {primaryPortrait ? (
              <div className="details-panel__portrait">
                <strong>{primaryPortrait.label}</strong>
                <span>{primaryPortrait.depictionType}</span>
              </div>
            ) : (
              <p>No portrait asset linked yet.</p>
            )}
          </div>

          <div className="details-panel__section">
            <h3>Relation summary</h3>
            <p>
              {relationEdges.length} typed relation{relationEdges.length === 1 ? "" : "s"} -{" "}
              {outgoingEdges.length} outgoing - {incomingEdges.length} incoming
            </p>
            {focusContext.selectionSourceView ? (
              <p className="details-panel__notice">
                Shared focus originated in {focusContext.selectionSourceView.replace("-", " ")} and
                currently spans {focusContext.neighborIds.length} neighboring records.
              </p>
            ) : null}
            {topRelationTypes.length > 0 ? (
              <div className="token-list">
                {topRelationTypes.map((relationType) => (
                  <span className="token token--muted" key={relationType}>
                    {relationType}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <div className="details-panel__section">
            <h3>Related context</h3>
            <ul className="details-panel__list details-panel__related-list">
              {relatedEntities.slice(0, 6).map((entity) => (
                <li key={entity.id}>
                  <button
                    type="button"
                    className="details-panel__entity-link"
                    onClick={() => handleSelectEntity(entity)}
                    title={`Inspect ${entity.label}`}
                  >
                    {entity.label}
                  </button>
                  <span className="details-panel__related-type">
                    {" "}- {getEntityTypeLabel(entity.entityType)}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {historicalEntity ? (
            <div className="details-panel__section">
              <h3>Historical provenance</h3>
              <p>
                {historicalEntity.contributingSourceRecords.length} contributing source
                {historicalEntity.contributingSourceRecords.length === 1 ? "" : "s"} - merge status{" "}
                {historicalEntity.canonical.mergeStatus.replaceAll("_", " ")}
              </p>
              <div className="token-list">
                {historicalEntity.contributingSourceRecords.map((record) => (
                  <span className="token token--muted" key={record.id}>
                    {record.kind.replaceAll("_", " ")}
                  </span>
                ))}
              </div>
              {historicalEntity.effectiveAliases.length > 0 ? (
                <p className="details-panel__notice">
                  Aliases: {historicalEntity.effectiveAliases.join(", ")}
                </p>
              ) : null}
              {historicalEntity.canonical.mergeNotes || historicalEntity.override?.mergeNotes ? (
                <p className="details-panel__notice">
                  Merge notes:{" "}
                  {historicalEntity.override?.mergeNotes ?? historicalEntity.canonical.mergeNotes}
                </p>
              ) : null}
              {historicalEntity.hasOverrides ? (
                <p className="details-panel__notice">
                  This merged entity currently has local editorial overrides.
                </p>
              ) : null}
              {historicalEntity.fieldConflicts.length > 0 ? (
                <p className="details-panel__notice">
                  {historicalEntity.fieldConflicts.length} field conflict
                  {historicalEntity.fieldConflicts.length === 1 ? "" : "s"} still need review.
                </p>
              ) : null}
              {historicalEntity.contributingSourceRecords.some(
                (record) => record.wikipediaUrl || record.sourcePath,
              ) ? (
                <ul className="details-panel__list">
                  {historicalEntity.contributingSourceRecords.map((record) => (
                    <li key={record.id}>
                      {record.displayName}
                      {record.wikipediaUrl ? (
                        <>
                          {" "}
                          -{" "}
                          <a href={record.wikipediaUrl} rel="noreferrer" target="_blank">
                            raw source
                          </a>
                        </>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {isAdminMode ? (
            <HistoricalAdminPanel
              historicalEntity={historicalEntity}
              selectedEntity={selectedEntity}
              snapshot={snapshot}
            />
          ) : null}
        </>
      )}
    </aside>
  );
}
