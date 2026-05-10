import { LayoutGroup, motion } from "motion/react";
import { useExplorerStore } from "@/state/explorer-store";

const views = [
  { id: "river", label: "River of Time" },
  { id: "constellation", label: "Constellation" },
  { id: "atlas", label: "Atlas" },
  { id: "face-atlas", label: "Face Atlas" },
  { id: "scriptorium", label: "Scriptorium", badge: "WIP" },
] as const;

export function ViewNavigation() {
  const activeView = useExplorerStore((state) => state.activeView);
  const setActiveView = useExplorerStore((state) => state.setActiveView);

  return (
    <nav className="view-navigation" aria-label="Primary views">
      <LayoutGroup>
        {views.map((view) => {
          const isActive = activeView === view.id;

          return (
            <motion.button
              key={view.id}
              className={`view-navigation__button${isActive ? " is-active" : ""}`}
              onClick={() => setActiveView(view.id)}
              type="button"
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.985 }}
              transition={{ type: "spring", stiffness: 260, damping: 22 }}
            >
              {isActive ? (
                <motion.span
                  aria-hidden="true"
                  className="view-navigation__pill"
                  layoutId="active-view-pill"
                  transition={{ type: "spring", stiffness: 320, damping: 28 }}
                />
              ) : null}
              <span className="view-navigation__label">{view.label}</span>
              {"badge" in view ? (
                <span className="view-navigation__badge">{view.badge}</span>
              ) : null}
            </motion.button>
          );
        })}
      </LayoutGroup>
    </nav>
  );
}
