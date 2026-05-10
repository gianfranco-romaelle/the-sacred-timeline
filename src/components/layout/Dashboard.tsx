import { useMemo } from "react";
import { filterEntities } from "@/data/entity-index";
import { useHistoricalRuntime } from "@/historical/runtime-context";
import { useExplorerStore } from "@/state/explorer-store";
import { Inspector } from "@/components/Inspector";
import { ManifoldViewport } from "./ManifoldViewport";
import { SieveControl } from "./SieveControl";

export function Dashboard() {
  const { seed, index } = useHistoricalRuntime();
  const filters = useExplorerStore((s) => s.filters);

  const entityCount = useMemo(
    () => filterEntities(seed, filters).length,
    [seed, filters],
  );

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-200 overflow-hidden">
      <header className="flex items-center justify-between h-10 px-6 border-b border-slate-800 flex-shrink-0 bg-slate-950/95 backdrop-blur-sm">
        <span className="font-mono text-xs text-amber-500 tracking-widest uppercase select-none">
          Sacred Timeline // Auguste Laurent Society
        </span>
        <span className="font-mono text-xs text-cyan-400 tabular-nums">
          Substrate Hydrated: {entityCount.toLocaleString()} Entities
        </span>
      </header>

      <div className="flex flex-1 min-h-0 divide-x divide-slate-800">
        <SieveControl />
        <ManifoldViewport seed={seed} index={index} />
        <Inspector />
      </div>
    </div>
  );
}
