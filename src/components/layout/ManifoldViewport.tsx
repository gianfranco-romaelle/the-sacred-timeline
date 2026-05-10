import { Suspense, lazy } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { SeedIndex } from "@/data/entity-index";
import { useExplorerStore } from "@/state/explorer-store";
import type { SacredTimelineSeedData } from "@/types";

const RiverView = lazy(async () => {
  const m = await import("@/features/river/river-view");
  return { default: m.RiverView };
});

const ConstellationView = lazy(async () => {
  const m = await import("@/features/constellation/constellation-view");
  return { default: m.ConstellationView };
});

const MANIFOLDS = [
  { id: "river" as const, label: "River" },
  { id: "constellation" as const, label: "Constellation" },
];

interface ManifoldViewportProps {
  seed: SacredTimelineSeedData;
  index: SeedIndex;
}

export function ManifoldViewport({ seed, index }: ManifoldViewportProps) {
  const activeView = useExplorerStore((s) => s.activeView);
  const setActiveView = useExplorerStore((s) => s.setActiveView);

  const effectiveView =
    activeView === "river" || activeView === "constellation" ? activeView : "river";

  return (
    <div className="relative flex-1 min-w-0 overflow-hidden bg-slate-950">
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10">
        <div className="flex gap-1 bg-slate-900/90 backdrop-blur-sm border border-slate-700/60 rounded-lg p-1 shadow-lg shadow-black/40">
          {MANIFOLDS.map((m) => (
            <button
              key={m.id}
              onClick={() => setActiveView(m.id)}
              type="button"
              className={[
                "px-4 py-1.5 text-xs font-mono rounded-md transition-colors",
                effectiveView === m.id
                  ? "bg-slate-800 text-amber-400 shadow-sm"
                  : "text-slate-500 hover:text-slate-300",
              ].join(" ")}
            >
              {m.label.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={effectiveView}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.28, ease: "easeOut" }}
          className="absolute inset-0"
        >
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-full text-xs font-mono text-slate-600">
                Loading {effectiveView} projection...
              </div>
            }
          >
            {effectiveView === "river" ? (
              <RiverView seed={seed} index={index} />
            ) : (
              <ConstellationView seed={seed} index={index} />
            )}
          </Suspense>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
