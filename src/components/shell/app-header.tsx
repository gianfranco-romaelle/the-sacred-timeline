import { motion } from "motion/react";
import { AdminModeToggle } from "@/components/admin/admin-mode-toggle";
import { useHistoricalRuntime } from "@/historical/runtime-context";
import { ViewNavigation } from "./view-navigation";


export function AppHeader() {
  const { loading, snapshot } = useHistoricalRuntime();

  return (
    <motion.header
      className="app-header"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: "easeOut" }}
    >
      <div className="app-header__intro">
        <div className="app-header__brand">
          <img
            className="app-header__logo"
            src="/geist-quest-logo.jpg"
            alt="Geist Quest"
          />
          <div>
            <h1><span className="app-header__brand-name">Geist Quest</span> Presents: The&nbsp;Sacred&nbsp;Timeline</h1>
          </div>
        </div>
        <p className="app-header__subtitle">History of science and religion as one coordinated knowledge space.</p>
        <p className="app-header__summary">
          A coordinated scholarly graph for historical ontology, semantic evidence, and curated
          projection work.
        </p>
        <div className="app-header__meta">
          <span>Zeroth-Sixth Calculi active</span>
          <span>Genesis ontology loaded</span>
          <span>{snapshot ? "Historical ingest connected" : "Seed graph active"}</span>
          {loading ? <span>Historical ingest loading</span> : null}
        </div>
      </div>
      <div className="app-header__controls">
        <AdminModeToggle />
        <ViewNavigation />
      </div>
    </motion.header>
  );
}
