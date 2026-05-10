import { useMemo } from "react";
import {
  getCondensedActiveFilterSummary,
  getDomainOptions,
  getEntityTypeOptions,
  getExpandedActiveFilterTokens,
  getFilterScopeLabel,
  getGeographyOptions,
  getRelationTypeOptions,
  getTagOptions,
  getTimePresetOptions,
  getTraditionOptions,
} from "@/data/filter-controls";
import type { SeedIndex } from "@/data/entity-index";
import { useExplorerStore } from "@/state/explorer-store";
import { selectActiveFilterCount } from "@/state/selectors";
import { CommandPaletteTrigger } from "./command-palette";
import type {
  CanonicalEntityType,
  DomainId,
  EdgeRelationType,
  PlaceId,
  TagId,
  TraditionId,
} from "@/types";
import type { SacredTimelineSeedData } from "@/types";

interface FilterChipGroupProps<T extends string> {
  label: string;
  options: Array<{ id: T; label: string; description?: string }>;
  activeIds: T[];
  onToggle: (id: T) => void;
  collapsible?: boolean;
  defaultOpen?: boolean;
}

function FilterChipGroup<T extends string>({
  label,
  options,
  activeIds,
  onToggle,
  collapsible = options.length > 24,
  defaultOpen = false,
}: FilterChipGroupProps<T>) {
  const chips = (
      <div className="filter-group__chips">
        {options.map((option) => (
          <button
            key={option.id}
            className={`filter-chip${activeIds.includes(option.id) ? " is-active" : ""}`}
            onClick={() => onToggle(option.id)}
            title={option.description}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
  );

  if (collapsible) {
    return (
      <details className="filter-group filter-group--collapsible" open={defaultOpen || activeIds.length > 0}>
        <summary className="filter-group__summary">
          <span className="filter-group__label">{label}</span>
          <span className="filter-group__count">
            {activeIds.length > 0 ? `${activeIds.length} selected / ` : ""}
            {options.length} total
          </span>
        </summary>
        {chips}
      </details>
    );
  }

  return (
    <div className="filter-group">
      <span className="filter-group__label">{label}</span>
      {chips}
    </div>
  );
}

const parseOptionalYear = (value: string) => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const parsed = Number.parseInt(trimmed, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
};

interface FilterBarProps {
  seed: SacredTimelineSeedData;
  index: SeedIndex;
}

export function FilterBar({ seed, index }: FilterBarProps) {
  const filters = useExplorerStore((state) => state.filters);
  const savedLocalScopes = useExplorerStore((state) => state.savedLocalScopes);
  const filtersCollapsed = useExplorerStore((state) => state.panels.filtersCollapsed);
  const setTimePreset = useExplorerStore((state) => state.setTimePreset);
  const setTimeRange = useExplorerStore((state) => state.setTimeRange);
  const setIncludeUndated = useExplorerStore((state) => state.setIncludeUndated);
  const toggleEntityType = useExplorerStore((state) => state.toggleEntityType);
  const toggleDomain = useExplorerStore((state) => state.toggleDomain);
  const toggleTradition = useExplorerStore((state) => state.toggleTradition);
  const toggleTag = useExplorerStore((state) => state.toggleTag);
  const toggleRelationType = useExplorerStore((state) => state.toggleRelationType);
  const toggleGeographyPlace = useExplorerStore((state) => state.toggleGeographyPlace);
  const setShowAiHypotheses = useExplorerStore((state) => state.setShowAiHypotheses);
  const saveCurrentScope = useExplorerStore((state) => state.saveCurrentScope);
  const applySavedScope = useExplorerStore((state) => state.applySavedScope);
  const removeSavedScope = useExplorerStore((state) => state.removeSavedScope);
  const setFiltersCollapsed = useExplorerStore((state) => state.setFiltersCollapsed);
  const resetFilters = useExplorerStore((state) => state.resetFilters);
  const activeFilterCount = useExplorerStore(selectActiveFilterCount);

  const expandedActiveFilters = useMemo(
    () => getExpandedActiveFilterTokens(filters, index),
    [filters, index],
  );
  const condensedSummary = useMemo(
    () => getCondensedActiveFilterSummary(filters, index, 8),
    [filters, index],
  );

  const timePresetOptions = useMemo(() => getTimePresetOptions(), []);
  const entityTypeOptions = useMemo(() => getEntityTypeOptions(), []);
  const domainOptions = useMemo(() => getDomainOptions(seed), [seed]);
  const traditionOptions = useMemo(() => getTraditionOptions(seed), [seed]);
  const tagOptions = useMemo(() => getTagOptions(seed), [seed]);
  const relationTypeOptions = useMemo(() => getRelationTypeOptions(seed), [seed]);
  const geographyOptions = useMemo(() => getGeographyOptions(seed), [seed]);

  const saveScope = () => {
    const label = getFilterScopeLabel(filters, index);
    saveCurrentScope(label === "All records" ? undefined : label);
  };

  return (
    <section className={`filter-bar${filtersCollapsed ? " is-collapsed" : ""}`} aria-label="Global filters">
      <div className="filter-bar__header">
        <div className="filter-bar__intro">
          <p className="eyebrow">Global scope</p>
          <h2>Shared filters</h2>
          <p>
            Set the shared historical scope once, then let every view respond together without
            losing the current selection.
          </p>
        </div>

        <div className="filter-bar__status">
          <span className="filter-bar__scope">{getFilterScopeLabel(filters, index)}</span>
          <span className="filter-bar__count">
            {activeFilterCount} applied control{activeFilterCount === 1 ? "" : "s"}
          </span>
          <CommandPaletteTrigger />
          <button className="filter-bar__reset" onClick={saveScope} type="button">
            Save local scope
          </button>
          <button className="filter-bar__reset" onClick={resetFilters} type="button">
            Reset scope
          </button>
          <button
            className="filter-bar__reset"
            onClick={() => setFiltersCollapsed(!filtersCollapsed)}
            type="button"
          >
            {filtersCollapsed ? "Expand filters" : "Collapse filters"}
          </button>
        </div>
      </div>

      <div className="filter-bar__body">
      {savedLocalScopes.length > 0 ? (
        <div className="filter-bar__saved-scopes">
          <span className="filter-group__label">Saved local scopes</span>
          <div className="filter-bar__saved-list">
            {savedLocalScopes.map((scope) => (
              <span className="filter-bar__saved-scope" key={scope.id}>
                <button
                  className="filter-bar__saved-apply"
                  onClick={() => applySavedScope(scope.id)}
                  title={`Apply ${scope.label}`}
                  type="button"
                >
                  {scope.label}
                </button>
                <button
                  aria-label={`Remove ${scope.label}`}
                  className="filter-bar__saved-remove"
                  onClick={() => removeSavedScope(scope.id)}
                  type="button"
                >
                  x
                </button>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="filter-bar__time">
        <div className="filter-group">
          <span className="filter-group__label">Era</span>
          <div className="filter-group__chips">
            {timePresetOptions.map((option) => (
              <button
                key={option.id}
                className={`filter-chip${filters.timePreset === option.id ? " is-active" : ""}`}
                onClick={() => setTimePreset(option.id)}
                title={option.description}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="filter-bar__time-range">
          <label className="filter-bar__field">
            <span>From year</span>
            <input
              inputMode="numeric"
              onChange={(event) =>
                setTimeRange(parseOptionalYear(event.target.value), filters.endYear)
              }
              placeholder="e.g. 500"
              type="number"
              value={filters.startYear ?? ""}
            />
          </label>

          <label className="filter-bar__field">
            <span>To year</span>
            <input
              inputMode="numeric"
              onChange={(event) =>
                setTimeRange(filters.startYear, parseOptionalYear(event.target.value))
              }
              placeholder="e.g. 1800"
              type="number"
              value={filters.endYear ?? ""}
            />
          </label>

          <label className="filter-toggle">
            <input
              checked={filters.includeUndated}
              onChange={(event) => setIncludeUndated(event.target.checked)}
              type="checkbox"
            />
            <span>Include undated records</span>
          </label>
        </div>
      </div>

      {condensedSummary.length > 0 ? (
        <div className="filter-bar__summary">
          {condensedSummary.map((item) => (
            <span className="filter-bar__summary-chip" key={item}>
              {item}
            </span>
          ))}
        </div>
      ) : null}

      <div className="filter-bar__groups">
        <FilterChipGroup<CanonicalEntityType>
          activeIds={filters.entityTypes}
          label="Entity type"
          onToggle={toggleEntityType}
          options={entityTypeOptions}
        />

        <FilterChipGroup<DomainId>
          activeIds={filters.domainIds}
          label="Domain"
          onToggle={toggleDomain}
          options={domainOptions}
        />

        <FilterChipGroup<TraditionId>
          activeIds={filters.traditionIds}
          label="Tradition"
          onToggle={toggleTradition}
          options={traditionOptions}
        />

        <FilterChipGroup<TagId>
          activeIds={filters.tagIds}
          label="Tag"
          onToggle={toggleTag}
          options={tagOptions}
        />

        <FilterChipGroup<EdgeRelationType>
          activeIds={filters.relationTypes}
          label="Relation type"
          onToggle={toggleRelationType}
          options={relationTypeOptions}
        />

        {geographyOptions.length > 0 ? (
          <FilterChipGroup<PlaceId>
            activeIds={filters.geographyPlaceIds}
            label="Geography"
            onToggle={toggleGeographyPlace}
            options={geographyOptions}
          />
        ) : null}

        <div className="filter-group">
          <span className="filter-group__label">Assertion layer</span>
          <div className="filter-group__chips">
            <label className="filter-toggle">
              <input
                checked={filters.showAiHypotheses}
                onChange={(event) => setShowAiHypotheses(event.target.checked)}
                type="checkbox"
              />
              <span>Show AI-generated hypotheses</span>
            </label>
          </div>
        </div>
      </div>

      {expandedActiveFilters.length > 0 ? (
        <div className="filter-bar__active">
          <span className="filter-group__label">Active scope</span>
          <div className="filter-group__chips">
            {expandedActiveFilters.map((filter) => (
              <span className="filter-bar__active-chip" key={filter.key}>
                {filter.label}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      </div>
    </section>
  );
}
