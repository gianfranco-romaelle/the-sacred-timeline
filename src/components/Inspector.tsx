import {
  getCitationsForEntity,
  getEntityDateLabel,
  getEntityTypeLabel,
} from "@/data/entity-index";
import { useHistoricalRuntime } from "@/historical/runtime-context";
import { useExplorerStore } from "@/state/explorer-store";
import type { JsonObject } from "@/types";

const isLatexString = (v: unknown): v is string =>
  typeof v === "string" && /\$|\\\(|\\\[/.test(v);

function MetadataValue({ value }: { value: unknown }) {
  if (isLatexString(value)) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-xs font-mono text-slate-600 uppercase tracking-wider">TeX</span>
        <code className="font-mono text-cyan-300 text-xs whitespace-pre-wrap bg-slate-900 border border-slate-800 p-2 rounded block leading-relaxed">
          {value}
        </code>
      </div>
    );
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return <span className="text-xs text-slate-300 font-mono">{String(value)}</span>;
  }
  return (
    <code className="text-xs text-slate-500 font-mono break-all">
      {JSON.stringify(value)}
    </code>
  );
}

export function Inspector() {
  const { seed, index, getEffectiveCanonicalEntity } = useHistoricalRuntime();
  const selectedEntityId = useExplorerStore((s) => s.selectedEntityId);

  const entity = selectedEntityId ? index.entitiesById.get(selectedEntityId) : undefined;
  const citations = entity ? getCitationsForEntity(entity.id, seed) : [];
  const historicalEntity = getEffectiveCanonicalEntity(entity?.id);
  const metadataEntries =
    entity?.metadata
      ? Object.entries(entity.metadata as JsonObject).filter(
          ([, v]) => v !== null && v !== undefined,
        )
      : [];

  return (
    <aside className="w-80 flex-shrink-0 flex flex-col overflow-hidden bg-slate-950">
      <div className="px-4 pt-4 pb-3 border-b border-slate-800 flex-shrink-0">
        <p className="font-mono text-xs text-cyan-400 tracking-widest uppercase">Inspector</p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {!entity ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6 gap-2">
            <p className="text-slate-700 text-xs font-mono uppercase tracking-wider">
              No selection
            </p>
            <p className="text-slate-600 text-xs leading-relaxed">
              Click any entity in the River or Constellation view to inspect its record.
            </p>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-slate-800">
            <section className="px-4 py-4 flex flex-col gap-2">
              <h2 className="text-base font-semibold text-slate-100 leading-tight">
                {entity.label}
              </h2>
              <p className="font-mono text-xs text-slate-500">
                {getEntityTypeLabel(entity.entityType)} · {getEntityDateLabel(entity)}
              </p>
              {entity.description ? (
                <p className="text-sm text-slate-300 leading-relaxed mt-1">{entity.description}</p>
              ) : null}
            </section>

            <section className="px-4 py-4 flex flex-col gap-2">
              <h3 className="font-mono text-xs text-amber-500 uppercase tracking-wider">
                Provenance
              </h3>
              {citations.length > 0 ? (
                <ul className="flex flex-col gap-1.5">
                  {citations.slice(0, 5).map((citation) => (
                    <li
                      key={citation.id}
                      className="text-xs text-slate-400 leading-snug pl-2 border-l border-slate-700"
                    >
                      {citation.label}
                    </li>
                  ))}
                  {citations.length > 5 && (
                    <li className="text-xs text-slate-600 font-mono pl-2">
                      +{citations.length - 5} more
                    </li>
                  )}
                </ul>
              ) : (
                <p className="text-xs text-slate-600">No citations linked.</p>
              )}
              {historicalEntity ? (
                <div className="mt-2 flex flex-col gap-1">
                  <p className="text-xs text-slate-500">
                    {historicalEntity.contributingSourceRecords.length} contributing source
                    {historicalEntity.contributingSourceRecords.length === 1 ? "" : "s"} — merge:{" "}
                    <span className="text-slate-400 font-mono">
                      {historicalEntity.canonical.mergeStatus.replaceAll("_", " ")}
                    </span>
                  </p>
                  {historicalEntity.effectiveAliases.length > 0 ? (
                    <p className="text-xs text-slate-600">
                      Aliases: {historicalEntity.effectiveAliases.join(", ")}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </section>

            {metadataEntries.length > 0 ? (
              <section className="px-4 py-4 flex flex-col gap-3">
                <h3 className="font-mono text-xs text-amber-500 uppercase tracking-wider">
                  Metadata
                </h3>
                {metadataEntries.map(([key, value]) => (
                  <div key={key} className="flex flex-col gap-1">
                    <span className="text-xs text-slate-500 font-mono">
                      {key.replaceAll("_", " ")}
                    </span>
                    <MetadataValue value={value} />
                  </div>
                ))}
              </section>
            ) : null}
          </div>
        )}
      </div>
    </aside>
  );
}
