import { useMemo, useState } from "react";
import {
  getDomainOptions,
  getTagOptions,
  getTraditionOptions,
} from "@/data/filter-controls";
import { useHistoricalRuntime } from "@/historical/runtime-context";
import type {
  CanonicalFieldKey,
  EffectiveCanonicalEntity,
  HistoricalEntityGraphSnapshot,
  ProvenanceEntry,
  SourceMediaCandidate,
} from "@/historical/types";
import { useAdminStore } from "@/state/admin-store";
import { useExplorerStore } from "@/state/explorer-store";
import type { KnowledgeEntity } from "@/types";
import { ProvenanceBadgeList } from "./provenance-badge-list";
import { EditorialAssignmentPanel } from "./editorial-assignment-panel";

interface HistoricalAdminPanelProps {
  historicalEntity?: EffectiveCanonicalEntity;
  selectedEntity?: KnowledgeEntity;
  snapshot?: HistoricalEntityGraphSnapshot;
}

interface TaxonomyChipGroupProps<T extends string> {
  label: string;
  activeIds: T[];
  options: Array<{ id: T; label: string }>;
  onToggle: (id: T) => void;
}

function TaxonomyChipGroup<T extends string>({
  label,
  activeIds,
  options,
  onToggle,
}: TaxonomyChipGroupProps<T>) {
  return (
    <div className="admin-panel__field">
      <span className="admin-panel__label">{label}</span>
      <div className="admin-panel__chip-row">
        {options.map((option) => (
          <button
            className={`filter-chip${activeIds.includes(option.id) ? " is-active" : ""}`}
            key={option.id}
            onClick={() => onToggle(option.id)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const toggleStringValue = (values: string[], nextValue: string) =>
  values.includes(nextValue)
    ? values.filter((value) => value !== nextValue)
    : [...values, nextValue];

const precedenceFields: CanonicalFieldKey[] = [
  "displayName",
  "aliases",
  "birthYear",
  "deathYear",
  "summary",
  "preferredPortrait",
];

const precedenceOptions = [
  { id: "merged", label: "Merged" },
  { id: "sacred_timeline_enriched", label: "Curated master" },
  { id: "wikipedia_jobs", label: "Wikipedia jobs" },
  { id: "manual_override", label: "Manual override" },
] as const;

const reviewQueueFilterLabels = {
  all: "All",
  needs_review: "Needs review",
  manually_overridden: "Manually overridden",
  unreviewed: "Unreviewed",
} as const;

const getFieldValueLabel = (value: unknown) => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.join(", ");
  if (value === null || value === undefined) return "null";
  return String(value);
};

const getPathLabel = (value: string | undefined) => {
  if (!value) {
    return "Unavailable";
  }

  const normalized = value.replaceAll("\\", "/");
  return normalized.split("/").filter(Boolean).slice(-3).join("/");
};

export function HistoricalAdminPanel({
  historicalEntity,
  selectedEntity,
  snapshot,
}: HistoricalAdminPanelProps) {
  const { seed } = useHistoricalRuntime();
  const updateOverride = useAdminStore((state) => state.updateOverride);
  const setFieldPrecedence = useAdminStore((state) => state.setFieldPrecedence);
  const setReviewStatus = useAdminStore((state) => state.setReviewStatus);
  const setVisibility = useAdminStore((state) => state.setVisibility);
  const setShowDraftEntities = useAdminStore((state) => state.setShowDraftEntities);
  const showDraftEntities = useAdminStore((state) => state.showDraftEntities);
  const reviewQueueFilter = useAdminStore((state) => state.reviewQueueFilter);
  const setReviewQueueFilter = useAdminStore((state) => state.setReviewQueueFilter);
  const mergeDirectives = useAdminStore((state) => state.mergeDirectives);
  const overridesByEntityId = useAdminStore((state) => state.overridesByEntityId);
  const stageMergeDirective = useAdminStore((state) => state.stageMergeDirective);
  const stageUnmergeSourceRecord = useAdminStore((state) => state.stageUnmergeSourceRecord);
  const removeMergeDirective = useAdminStore((state) => state.removeMergeDirective);
  const selectEntity = useExplorerStore((state) => state.selectEntity);
  const [mergeTargetId, setMergeTargetId] = useState("");

  const domainOptions = useMemo(() => getDomainOptions(seed), [seed]);
  const traditionOptions = useMemo(() => getTraditionOptions(seed), [seed]);
  const tagOptions = useMemo(() => getTagOptions(seed), [seed]);
  const reviewQueue = useMemo(
    () =>
      (snapshot?.canonicalEntities ?? [])
        .filter((entity) => {
          if (reviewQueueFilter === "needs_review") {
            return entity.mergeStatus === "needs_review" || entity.mergeStatus === "conflict";
          }
          if (reviewQueueFilter === "unreviewed") {
            return entity.reviewStatus === "unreviewed";
          }
          if (reviewQueueFilter === "manually_overridden") {
            return Boolean(overridesByEntityId[entity.id]);
          }
          return entity.reviewStatus !== "reviewed" || entity.mergeStatus === "needs_review";
        })
        .slice(0, 14),
    [overridesByEntityId, reviewQueueFilter, snapshot],
  );
  const entityMergeDirectives = historicalEntity
    ? mergeDirectives.filter((directive) => directive.canonicalEntityId === historicalEntity.canonical.id)
    : [];

  if (!historicalEntity) {
    return (
      <div className="admin-panel">
        <div className="details-panel__section">
          <h3>Editorial mode</h3>
          <p>
            Choose a merged historical person from any view to inspect provenance, source overlap,
            and manual overrides. The queue below highlights unresolved editorial work.
          </p>
          <label className="filter-toggle">
            <input
              checked={showDraftEntities}
              onChange={(event) => setShowDraftEntities(event.target.checked)}
              type="checkbox"
            />
            <span>Include draft imported people in shared views while editing</span>
          </label>
        </div>

      <div className="details-panel__section">
          <h3>Review queue</h3>
          <div className="admin-panel__queue-filters">
            {Object.entries(reviewQueueFilterLabels).map(([key, label]) => (
              <button
                className={`filter-chip${reviewQueueFilter === key ? " is-active" : ""}`}
                key={key}
                onClick={() =>
                  setReviewQueueFilter(
                    key as "all" | "needs_review" | "manually_overridden" | "unreviewed",
                  )
                }
                type="button"
              >
                {label}
              </button>
            ))}
          </div>

          {reviewQueue.length > 0 ? (
            <div className="admin-panel__queue">
              {reviewQueue.map((entity) => (
                <button
                  className="admin-panel__queue-item"
                  key={entity.id}
                  onClick={() => selectEntity(entity.id, "person", "river")}
                  type="button"
                >
                  <strong>{entity.displayName.mergedValue ?? entity.slug}</strong>
                  <span>
                    {entity.mergeStatus.replaceAll("_", " ")} · {entity.reviewStatus}
                  </span>
                  <span>
                    {entity.mergeConfidence}% confidence
                    {entity.fieldConflicts.length > 0
                      ? ` · ${entity.fieldConflicts.length} conflict${entity.fieldConflicts.length === 1 ? "" : "s"}`
                      : ""}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="admin-panel__muted">No records match the current review filter.</p>
          )}
        </div>

        {snapshot ? (
          <div className="details-panel__section">
            <h3>Ingestion sources</h3>
            <div className="admin-panel__summary-grid">
              <div>
                <span className="admin-panel__label">Curated master</span>
                <strong>{getPathLabel(snapshot.sourcePaths.curatedMasterPath)}</strong>
              </div>
              <div>
                <span className="admin-panel__label">Wikipedia jobs</span>
                <strong>{getPathLabel(snapshot.sourcePaths.wikipediaJobsPath)}</strong>
              </div>
              <div>
                <span className="admin-panel__label">Generated snapshot</span>
                <strong>{new Date(snapshot.generatedAt).toLocaleString()}</strong>
              </div>
            </div>
            <div className="admin-panel__source-compare-grid">
              <div>
                <span className="admin-panel__label">Records path</span>
                <strong>{getPathLabel(snapshot.sourcePaths.wikipediaRecordsPath)}</strong>
              </div>
              <div>
                <span className="admin-panel__label">Images path</span>
                <strong>{getPathLabel(snapshot.sourcePaths.wikipediaImagesPath)}</strong>
              </div>
              <div>
                <span className="admin-panel__label">Curated rows</span>
                <strong>{snapshot.summary.curatedRecordCount}</strong>
              </div>
              <div>
                <span className="admin-panel__label">Wikipedia rows</span>
                <strong>{snapshot.summary.wikipediaRecordCount}</strong>
              </div>
            </div>
            <p className="admin-panel__muted">
              Re-run <code>npm run ingest:historical</code> whenever the live jobs folder gains new
              records or images.
            </p>
          </div>
        ) : null}

        {selectedEntity ? (
          <div className="details-panel__section">
            <h3>Selected record</h3>
            <p className="admin-panel__muted">
              {selectedEntity.label} is part of the core curated seed and does not currently carry
              merged historical-source metadata.
            </p>
          </div>
        ) : null}

        {selectedEntity ? <EditorialAssignmentPanel selectedEntity={selectedEntity} /> : null}
      </div>
    );
  }

  const current = historicalEntity;
  const editableAliases = current.override?.aliases ?? current.effectiveAliases;

  const toggleDomain = (domainId: string) =>
    updateOverride(current.canonical.id, {
      domainIds: toggleStringValue(current.effectiveDomainIds, domainId) as typeof current.effectiveDomainIds,
    });

  const toggleTradition = (traditionId: string) =>
    updateOverride(current.canonical.id, {
      traditionIds: toggleStringValue(
        current.effectiveTraditionIds,
        traditionId,
      ) as typeof current.effectiveTraditionIds,
    });

  const toggleTag = (tagId: string) =>
    updateOverride(current.canonical.id, {
      tagIds: toggleStringValue(current.effectiveTagIds, tagId) as typeof current.effectiveTagIds,
    });

  const sourceComparisonEntries = current.contributingSourceRecords.map((record) => ({
    record,
    provenance: record.fieldValues
      .filter((value) =>
        ["displayName", "birthYear", "deathYear", "summary", "preferredPortrait"].includes(value.field),
      )
      .map(
        (value, index) =>
          ({
            id: `${record.id}-${value.field}-${index}`,
            field: value.field,
            layer: "normalized",
            sourceKind: value.sourceKind,
            sourceRecordId: value.sourceRecordId,
            valueLabel: getFieldValueLabel(value.value),
            confidence: value.confidence * 100,
            path: value.rawPath,
            note: value.note,
          }) satisfies ProvenanceEntry,
      ),
  }));

  return (
    <div className="admin-panel">
      <div className="details-panel__section">
        <h3>Editorial record</h3>
        <p className="admin-panel__muted">
          Overrides sit above raw source data and merged inference. Nothing here rewrites imported
          source files.
        </p>
        <div className="admin-panel__summary-grid">
          <div>
            <span className="admin-panel__label">Merge confidence</span>
            <strong>{current.canonical.mergeConfidence}%</strong>
          </div>
          <div>
            <span className="admin-panel__label">Merge status</span>
            <strong>{current.canonical.mergeStatus.replaceAll("_", " ")}</strong>
          </div>
          <div>
            <span className="admin-panel__label">Overrides</span>
            <strong>{current.hasOverrides ? "Present" : "None"}</strong>
          </div>
        </div>
        {current.canonical.mergeSignals.length > 0 ? (
          <div className="admin-panel__signal-list">
            {current.canonical.mergeSignals.slice(0, 8).map((signal, index) => (
              <span className="admin-panel__signal" key={`${signal.kind}-${index}`}>
                {signal.label}
              </span>
            ))}
          </div>
        ) : null}
        {current.fieldConflicts.length > 0 ? (
          <div className="admin-panel__conflicts">
            {current.fieldConflicts.map((conflict) => (
              <div className={`admin-panel__conflict is-${conflict.severity}`} key={conflict.field}>
                <strong>{conflict.field}</strong>
                <span>{conflict.distinctValueLabels.join(" / ")}</span>
              </div>
            ))}
          </div>
        ) : null}
        {snapshot ? (
          <p className="admin-panel__muted">
            Source roots: {getPathLabel(snapshot.sourcePaths.curatedMasterPath)} +{" "}
            {getPathLabel(snapshot.sourcePaths.wikipediaJobsPath)}
          </p>
        ) : null}
      </div>

      <div className="details-panel__section">
        <h3>Canonical fields</h3>
        <div className="admin-panel__field">
          <label className="admin-panel__label" htmlFor="admin-display-name">
            Display name
          </label>
          <input
            id="admin-display-name"
            onChange={(event) => updateOverride(current.canonical.id, { displayName: event.target.value })}
            type="text"
            value={current.override?.displayName ?? current.effectiveDisplayName}
          />
          <ProvenanceBadgeList entries={current.canonical.displayName.provenance} />
        </div>

        <div className="admin-panel__field">
          <label className="admin-panel__label" htmlFor="admin-summary">
            Summary
          </label>
          <textarea
            id="admin-summary"
            onChange={(event) => updateOverride(current.canonical.id, { summary: event.target.value })}
            rows={5}
            value={current.override?.summary ?? current.effectiveSummary}
          />
          <ProvenanceBadgeList entries={current.canonical.summary.provenance} />
        </div>

        <div className="admin-panel__inline-fields">
          <div className="admin-panel__field">
            <label className="admin-panel__label" htmlFor="admin-birth-year">
              Birth year
            </label>
            <input
              id="admin-birth-year"
              onChange={(event) =>
                updateOverride(current.canonical.id, {
                  birthYear:
                    event.target.value.trim().length > 0
                      ? Number.parseInt(event.target.value, 10)
                      : null,
                })
              }
              type="number"
              value={current.override?.birthYear ?? current.effectiveBirthYear ?? ""}
            />
            <ProvenanceBadgeList entries={current.canonical.birthYear.provenance} />
          </div>
          <div className="admin-panel__field">
            <label className="admin-panel__label" htmlFor="admin-death-year">
              Death year
            </label>
            <input
              id="admin-death-year"
              onChange={(event) =>
                updateOverride(current.canonical.id, {
                  deathYear:
                    event.target.value.trim().length > 0
                      ? Number.parseInt(event.target.value, 10)
                      : null,
                })
              }
              type="number"
              value={current.override?.deathYear ?? current.effectiveDeathYear ?? ""}
            />
            <ProvenanceBadgeList entries={current.canonical.deathYear.provenance} />
          </div>
        </div>
      </div>

      <div className="details-panel__section">
        <h3>Aliases</h3>
        <div className="admin-panel__alias-list">
          {editableAliases.map((alias, index) => (
            <div className="admin-panel__alias-row" key={`${current.canonical.id}-${index}`}>
              <input
                onChange={(event) => {
                  const nextAliases = [...editableAliases];
                  nextAliases[index] = event.target.value;
                  updateOverride(current.canonical.id, { aliases: nextAliases });
                }}
                type="text"
                value={alias}
              />
              <button
                onClick={() =>
                  updateOverride(current.canonical.id, {
                    aliases: editableAliases.filter((_, currentIndex) => currentIndex !== index),
                  })
                }
                type="button"
              >
                Remove
              </button>
            </div>
          ))}
          {editableAliases.length === 0 ? (
            <p className="admin-panel__muted">No aliases resolved yet.</p>
          ) : null}
        </div>
        <button
          className="admin-panel__secondary"
          onClick={() =>
            updateOverride(current.canonical.id, {
              aliases: [...editableAliases, ""],
            })
          }
          type="button"
        >
          Add alias
        </button>
        <ProvenanceBadgeList entries={current.canonical.aliases.provenance} />
      </div>

      <div className="details-panel__section">
        <h3>Taxonomy</h3>
        <TaxonomyChipGroup
          activeIds={current.effectiveDomainIds}
          label="Domains"
          onToggle={toggleDomain}
          options={domainOptions}
        />
        <TaxonomyChipGroup
          activeIds={current.effectiveTraditionIds}
          label="Traditions"
          onToggle={toggleTradition}
          options={traditionOptions}
        />
        {tagOptions.length > 0 ? (
          <TaxonomyChipGroup
            activeIds={current.effectiveTagIds}
            label="Tags"
            onToggle={toggleTag}
            options={tagOptions}
          />
        ) : null}
      </div>

      {selectedEntity ? <EditorialAssignmentPanel selectedEntity={selectedEntity} /> : null}

      <div className="details-panel__section">
        <h3>Curator notes</h3>
        <div className="admin-panel__field">
          <label className="admin-panel__label" htmlFor="admin-merge-notes">
            Merge notes
          </label>
          <textarea
            id="admin-merge-notes"
            onChange={(event) => updateOverride(current.canonical.id, { mergeNotes: event.target.value })}
            rows={3}
            value={current.override?.mergeNotes ?? current.canonical.mergeNotes ?? ""}
          />
        </div>
        <div className="admin-panel__field">
          <label className="admin-panel__label" htmlFor="admin-curator-notes">
            Curator notes
          </label>
          <textarea
            id="admin-curator-notes"
            onChange={(event) => updateOverride(current.canonical.id, { curatorNotes: event.target.value })}
            rows={4}
            value={current.override?.curatorNotes ?? current.canonical.curatorNotes ?? ""}
          />
        </div>
      </div>

      <div className="details-panel__section">
        <h3>Editorial status</h3>
        <div className="admin-panel__inline-fields">
          <div className="admin-panel__field">
            <label className="admin-panel__label" htmlFor="admin-review-status">
              Review status
            </label>
            <select
              id="admin-review-status"
              onChange={(event) =>
                setReviewStatus(current.canonical.id, event.target.value as "unreviewed" | "reviewed" | "draft" | "hidden")
              }
              value={current.override?.reviewStatus ?? current.effectiveReviewStatus}
            >
              <option value="unreviewed">Unreviewed</option>
              <option value="reviewed">Reviewed</option>
              <option value="draft">Draft</option>
              <option value="hidden">Hidden</option>
            </select>
          </div>
          <div className="admin-panel__field">
            <label className="admin-panel__label" htmlFor="admin-visibility">
              Visibility
            </label>
            <select
              id="admin-visibility"
              onChange={(event) =>
                setVisibility(current.canonical.id, event.target.value as "public" | "draft" | "hidden")
              }
              value={current.override?.visibility ?? current.effectiveVisibility}
            >
              <option value="public">Public</option>
              <option value="draft">Draft</option>
              <option value="hidden">Hidden</option>
            </select>
          </div>
        </div>
      </div>

      <div className="details-panel__section">
        <h3>Portrait preference</h3>
        {current.canonical.portraitCandidates.length > 0 ? (
          <div className="admin-panel__portrait-grid">
            {current.canonical.portraitCandidates.map((portrait: SourceMediaCandidate) => (
              <button
                className={`admin-panel__portrait-option${current.effectivePreferredPortrait?.id === portrait.id ? " is-active" : ""}`}
                key={portrait.id}
                onClick={() =>
                  updateOverride(current.canonical.id, {
                    preferredPortrait: portrait.id,
                  })
                }
                type="button"
              >
                <div className="admin-panel__portrait-preview">
                  {portrait.publicAssetPath ? (
                    <img alt={portrait.label} src={portrait.publicAssetPath} />
                  ) : (
                    <span className="admin-panel__portrait-placeholder">No image</span>
                  )}
                </div>
                <div className="admin-panel__portrait-meta">
                  <strong>{portrait.label}</strong>
                  <span>{portrait.sourceRecordId}</span>
                  {portrait.clusterIds?.length ? (
                    <span>{portrait.clusterIds.length} cluster link(s)</span>
                  ) : null}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <p className="admin-panel__muted">No portrait candidates imported yet.</p>
        )}
        <ProvenanceBadgeList entries={current.canonical.preferredPortrait.provenance} />
      </div>

      <div className="details-panel__section">
        <h3>Field precedence</h3>
        <div className="admin-panel__precedence-grid">
          {precedenceFields.map((field) => (
            <label className="admin-panel__field" key={field}>
              <span className="admin-panel__label">{field}</span>
              <select
                onChange={(event) =>
                  setFieldPrecedence(
                    current.canonical.id,
                    field,
                    event.target.value as
                      | "merged"
                      | "manual_override"
                      | "sacred_timeline_enriched"
                      | "wikipedia_jobs",
                  )
                }
                value={current.override?.fieldPrecedence?.[field] ?? "merged"}
              >
                {precedenceOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </div>

      <div className="details-panel__section">
        <h3>Source comparison</h3>
        <div className="admin-panel__source-list">
          {sourceComparisonEntries.map(({ record, provenance }) => (
            <article className="admin-panel__source-card" key={record.id}>
              <div className="admin-panel__source-card-header">
                <strong>{record.displayName}</strong>
                <span>{record.kind.replaceAll("_", " ")}</span>
              </div>
              <div className="admin-panel__source-compare-grid">
                <div>
                  <span className="admin-panel__label">Display name</span>
                  <strong>{record.displayName}</strong>
                </div>
                <div>
                  <span className="admin-panel__label">Dates</span>
                  <strong>
                    {typeof record.birthYear === "number" ? record.birthYear : "?"}-
                    {typeof record.deathYear === "number" ? record.deathYear : "?"}
                  </strong>
                </div>
                <div>
                  <span className="admin-panel__label">Aliases</span>
                  <strong>{record.aliases.length > 0 ? record.aliases.join(", ") : "None"}</strong>
                </div>
                <div>
                  <span className="admin-panel__label">Source confidence</span>
                  <strong>
                    {typeof record.confidence === "number"
                      ? `${Math.round(record.confidence * 100)}%`
                      : "N/A"}
                  </strong>
                </div>
              </div>
              <p className="admin-panel__muted">
                {record.summary ?? record.description ?? "No source summary available."}
              </p>
              <ProvenanceBadgeList entries={provenance} />
              <div className="admin-panel__source-meta">
                {record.wikipediaUrl ? (
                  <a href={record.wikipediaUrl} rel="noreferrer" target="_blank">
                    Wikipedia
                  </a>
                ) : null}
                {record.sourcePath ? <span>{record.sourcePath}</span> : null}
              </div>
              <button
                className="admin-panel__secondary"
                onClick={() => stageUnmergeSourceRecord(current.canonical.id, record.id)}
                type="button"
              >
                Exclude from canonical merge
              </button>
            </article>
          ))}
        </div>
      </div>

      <div className="details-panel__section">
        <h3>Merge controls</h3>
        <div className="admin-panel__inline-fields">
          <div className="admin-panel__field">
            <label className="admin-panel__label" htmlFor="admin-merge-target">
              Merge with canonical id
            </label>
            <input
              id="admin-merge-target"
              onChange={(event) => setMergeTargetId(event.target.value)}
              placeholder="person_imported_leo-szilard"
              type="text"
              value={mergeTargetId}
            />
          </div>
          <button
            className="admin-panel__secondary"
            onClick={() => {
              if (!mergeTargetId.trim()) return;
              stageMergeDirective({
                type: "mark_same_person",
                canonicalEntityId: current.canonical.id,
                relatedCanonicalEntityId: mergeTargetId as typeof current.canonical.id,
                note: "Manual same-person directive staged from admin panel.",
              });
              setMergeTargetId("");
            }}
            type="button"
          >
            Stage same-person merge
          </button>
        </div>
        {entityMergeDirectives.length > 0 ? (
          <div className="admin-panel__directive-list">
            {entityMergeDirectives.map((directive) => (
              <div className="admin-panel__directive" key={directive.id}>
                <span>{directive.type.replaceAll("_", " ")}</span>
                <button onClick={() => removeMergeDirective(directive.id)} type="button">
                  Remove
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="admin-panel__muted">
            Merge directives are staged locally for now. A future persistence layer can apply them
            during re-ingestion or reconciliation review.
          </p>
        )}
      </div>
    </div>
  );
}
