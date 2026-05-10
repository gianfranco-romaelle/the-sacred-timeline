import { Suspense, lazy } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { SeedIndex } from "@/data/entity-index";
import type { SacredTimelineSeedData } from "@/types";
import { useExplorerStore } from "@/state/explorer-store";

const RiverView = lazy(async () => {
  const module = await import("@/features/river/river-view");
  return { default: module.RiverView };
});

const ConstellationView = lazy(async () => {
  const module = await import("@/features/constellation/constellation-view");
  return { default: module.ConstellationView };
});

const AtlasView = lazy(async () => {
  const module = await import("@/features/atlas/atlas-view");
  return { default: module.AtlasView };
});

const FaceAtlasView = lazy(async () => {
  const module = await import("@/features/face-atlas/face-atlas-view");
  return { default: module.FaceAtlasView };
});

const ScriptoriumView = lazy(async () => {
  const module = await import("@/features/scriptorium/scriptorium-view");
  return { default: module.ScriptoriumView };
});

interface MainStageProps {
  seed: SacredTimelineSeedData;
  index: SeedIndex;
}

export function MainStage({ seed, index }: MainStageProps) {
  const activeView = useExplorerStore((state) => state.activeView);
  const shouldReduceMotion = useReducedMotion();

  const viewById = {
    river: <RiverView seed={seed} index={index} />,
    constellation: <ConstellationView seed={seed} index={index} />,
    atlas: <AtlasView seed={seed} index={index} />,
    "face-atlas": <FaceAtlasView seed={seed} index={index} />,
    scriptorium: <ScriptoriumView seed={seed} index={index} />,
  } as const;

  const loadingLabel = activeView.replace("-", " ");

  return (
    <section className="main-stage">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={activeView}
          className="main-stage__view"
          initial={shouldReduceMotion ? false : { opacity: 0, y: 18, scale: 0.992 }}
          animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
          exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -10, scale: 0.996 }}
          transition={{ duration: shouldReduceMotion ? 0.12 : 0.34, ease: "easeOut" }}
        >
          <Suspense
            fallback={
              <div className="main-stage__loading" role="status">
                Loading {loadingLabel} projection...
              </div>
            }
          >
            {viewById[activeView]}
          </Suspense>
        </motion.div>
      </AnimatePresence>
    </section>
  );
}
