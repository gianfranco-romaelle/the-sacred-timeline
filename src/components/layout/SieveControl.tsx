import { useExplorerStore } from "@/state/explorer-store";
import type { CanonicalEntityType } from "@/types";

const ENTITY_TYPES: Array<{ id: CanonicalEntityType; label: string }> = [
  { id: "person", label: "Person" },
  { id: "text", label: "Text" },
  { id: "concept", label: "Concept" },
  { id: "institution", label: "Institution" },
  { id: "place", label: "Place" },
  { id: "tradition", label: "Tradition" },
  { id: "event", label: "Event" },
];

const parseYear = (value: string): number | undefined => {
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? undefined : n;
};

export function SieveControl() {
  const filters = useExplorerStore((s) => s.filters);
  const toggleEntityType = useExplorerStore((s) => s.toggleEntityType);
  const setShowAiHypotheses = useExplorerStore((s) => s.setShowAiHypotheses);
  const setTimeRange = useExplorerStore((s) => s.setTimeRange);
  const resetFilters = useExplorerStore((s) => s.resetFilters);

  return (
    <aside className="w-64 flex-shrink-0 overflow-y-auto bg-slate-950 flex flex-col gap-6 p-4">
      <div className="flex-shrink-0">
        <p className="font-mono text-xs text-cyan-400 tracking-widest uppercase">
          Sieve Control
        </p>
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="text-xs text-slate-500 uppercase tracking-wider">Entity Types</h3>
        <div className="flex flex-col gap-1.5">
          {ENTITY_TYPES.map((type) => {
            const isActive = filters.entityTypes.includes(type.id);
            return (
              <button
                key={type.id}
                onClick={() => toggleEntityType(type.id)}
                type="button"
                className={[
                  "text-left text-xs px-2.5 py-1.5 rounded border transition-colors font-mono",
                  isActive
                    ? "text-amber-400 border-amber-500/40 bg-amber-500/5"
                    : "text-slate-500 border-slate-800 hover:text-slate-300 hover:border-slate-600",
                ].join(" ")}
              >
                {type.label}
              </button>
            );
          })}
        </div>
        {filters.entityTypes.length > 0 && (
          <p className="text-xs text-slate-600 font-mono">
            {filters.entityTypes.length} type filter{filters.entityTypes.length > 1 ? "s" : ""} active
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-xs text-slate-500 uppercase tracking-wider">Min Confidence</h3>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={filters.showAiHypotheses}
            onChange={(e) => setShowAiHypotheses(e.target.checked)}
            className="accent-amber-500 w-3.5 h-3.5"
          />
          <span className="text-xs text-slate-400">Include AI hypotheses</span>
        </label>
        <p className="text-xs text-slate-600 font-mono">
          {filters.showAiHypotheses ? "All assertion layers" : "Canonical edges only"}
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-xs text-slate-500 uppercase tracking-wider">Date Range</h3>
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-600 font-mono">From year</span>
            <input
              type="number"
              value={filters.startYear ?? ""}
              onChange={(e) => setTimeRange(parseYear(e.target.value), filters.endYear)}
              placeholder="e.g. 1600"
              className="bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-200 font-mono placeholder-slate-700 focus:outline-none focus:border-slate-600 transition-colors"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-600 font-mono">To year</span>
            <input
              type="number"
              value={filters.endYear ?? ""}
              onChange={(e) => setTimeRange(filters.startYear, parseYear(e.target.value))}
              placeholder="e.g. 1900"
              className="bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-200 font-mono placeholder-slate-700 focus:outline-none focus:border-slate-600 transition-colors"
            />
          </label>
        </div>
      </section>

      <div className="mt-auto pt-2">
        <button
          onClick={resetFilters}
          type="button"
          className="w-full text-xs font-mono text-slate-600 border border-slate-800 rounded px-3 py-2 hover:text-slate-300 hover:border-slate-600 transition-colors"
        >
          Reset Scope
        </button>
      </div>
    </aside>
  );
}
