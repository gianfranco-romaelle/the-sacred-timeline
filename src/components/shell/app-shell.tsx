import { useMemo } from "react";
import { motion } from "motion/react";
import { AppHeader } from "./app-header";
import { CommandPalette } from "./command-palette";
import { ContextRibbon } from "./context-ribbon";
import { EditorialControlsBar } from "./editorial-controls-bar";
import { FilterBar } from "./filter-bar";
import { MainStage } from "./main-stage";
import { DetailsPanel } from "@/components/inspector/details-panel";
import { buildFocusContext } from "@/data/focus-context";
import { filterEntities, getEntityById } from "@/data/entity-index";
import { useHistoricalRuntime } from "@/historical/runtime-context";
import { useExplorerStore } from "@/state/explorer-store";
import { hasActiveFilters } from "@/state/selectors";

export function AppShell() {
  const filters = useExplorerStore((state) => state.filters);
  const selectedEntityId = useExplorerStore((state) => state.selectedEntityId);
  const selectionSourceView = useExplorerStore((state) => state.selectionSourceView);
  const activeFilters = useExplorerStore(hasActiveFilters);
  const { seed, index, loading, error, snapshot } = useHistoricalRuntime();

  const visibleEntities = useMemo(
    () => filterEntities(seed, filters),
    [filters, seed],
  );
  const focusContext = useMemo(
    () => buildFocusContext(seed, index, filters, selectedEntityId, selectionSourceView),
    [filters, index, seed, selectedEntityId, selectionSourceView],
  );

  const selectedEntity = getEntityById(selectedEntityId, index);
  const selectedEntityIsVisible = Boolean(
    selectedEntityId && visibleEntities.some((entity) => entity.id === selectedEntityId),
  );

  return (
    <div className="app-shell">
      <CommandPalette />
      <div className="app-shell__background" />
      <motion.div
        className="app-shell__content"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
      >
        <AppHeader />
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.08, ease: "easeOut" }}
        >
          <FilterBar seed={seed} index={index} />
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1, ease: "easeOut" }}
        >
          <EditorialControlsBar />
        </motion.div>
        <ContextRibbon context={focusContext} hasActiveFilters={activeFilters} />
        {!loading && error && !snapshot ? (
          <div className="runtime-state-banner" role="status">
            Snapshot unavailable; using seed data. {error}
          </div>
        ) : null}
        <motion.div
          className="app-shell__workspace"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.42, delay: 0.12, ease: "easeOut" }}
        >
          <MainStage seed={seed} index={index} />
          <DetailsPanel
            seed={seed}
            index={index}
            selectedEntity={selectedEntity}
            selectedEntityIsVisible={selectedEntityIsVisible}
            focusContext={focusContext}
          />
        </motion.div>
      </motion.div>
    </div>
  );
}
