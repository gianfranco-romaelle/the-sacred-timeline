import { AlertTriangle, ArrowRightLeft, Network, Orbit, Sigma, Waypoints } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const LENS_META = {
  triad: { icon: Orbit, title: "Triad" },
  diagram: { icon: Waypoints, title: "Diagram" },
  sheaf: { icon: Network, title: "Sheaf" },
  simplicial: { icon: Sigma, title: "Simplicial" },
  catastrophe: { icon: ArrowRightLeft, title: "Catastrophe" },
};

function getEntity(bundle, entityId) {
  return bundle?.entities?.find((entity) => entity.id === entityId) || null;
}

function LensStatus({ status }) {
  const tone = status === "ready"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : status === "warning" || status === "limited"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : "border-stone-200 bg-white text-stone-600";
  return <Badge className={cn("rounded-full border", tone)}>{status}</Badge>;
}

function NodeButton({ entity, selected, onSelect, className, style }) {
  if (!entity) return null;
  return (
    <button
      type="button"
      onClick={() => onSelect?.(entity)}
      className={cn(
        "absolute rounded-2xl border px-3 py-2 text-left text-xs shadow-sm transition",
        selected ? "border-stone-900 bg-stone-900 text-white" : "border-stone-200 bg-white text-stone-700 hover:border-stone-400",
        className
      )}
      style={style}
    >
      <div className="font-semibold">{entity.label}</div>
      <div className={cn("mt-1 text-[11px]", selected ? "text-stone-200" : "text-stone-500")}>{entity.type}</div>
    </button>
  );
}

function TriadLens({ bundle, payload, selectedEntityId, onSelectEntity }) {
  const triadRelations = bundle.relations.filter((relation) => relation.type === "Triad").slice(0, 4);
  const triads = triadRelations.map((relation, index) => {
    const sign = getEntity(bundle, relation.source_id);
    const interpretant = getEntity(bundle, relation.target_id);
    const object = getEntity(bundle, relation.metadata?.object_id);
    return { relation, sign, object, interpretant, index };
  });

  return (
    <div className="relative min-h-[420px] rounded-[28px] border border-stone-200 bg-[radial-gradient(circle_at_top,_rgba(202,176,110,0.18),_rgba(255,255,255,0.98)_48%)] p-6">
      <svg viewBox="0 0 900 420" className="h-[420px] w-full">
        {triads.map((triad) => {
          const baseY = 90 + (triad.index * 74);
          return (
            <g key={triad.relation.id}>
              <line x1="200" y1={baseY} x2="450" y2={baseY} stroke="#8f7d56" strokeWidth="2" strokeDasharray="5 7" />
              <line x1="450" y1={baseY} x2="700" y2={baseY} stroke="#8f7d56" strokeWidth="2" />
              <path d={`M 450 ${baseY} Q 450 ${Math.max(60, baseY - 60)} 700 ${baseY}`} fill="none" stroke="#d5c291" strokeWidth="1.5" />
            </g>
          );
        })}
      </svg>
      {triads.map((triad) => {
        const baseY = 52 + (triad.index * 74);
        return (
          <div key={`nodes-${triad.relation.id}`}>
            <NodeButton entity={triad.sign} selected={selectedEntityId === triad.sign?.id} onSelect={onSelectEntity} style={{ left: "4%", top: `${baseY}px`, width: "23%" }} />
            <NodeButton entity={triad.object} selected={selectedEntityId === triad.object?.id} onSelect={onSelectEntity} style={{ left: "38%", top: `${baseY}px`, width: "23%" }} />
            <NodeButton entity={triad.interpretant} selected={selectedEntityId === triad.interpretant?.id} onSelect={onSelectEntity} style={{ left: "72%", top: `${baseY}px`, width: "24%" }} />
          </div>
        );
      })}
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-stone-200 bg-white/90 px-4 py-3 text-sm text-stone-700">SignToken anchors concrete expressions in the retrieved passages.</div>
        <div className="rounded-2xl border border-stone-200 bg-white/90 px-4 py-3 text-sm text-stone-700">ObjectOfReference stabilizes what the sign is about across books.</div>
        <div className="rounded-2xl border border-stone-200 bg-white/90 px-4 py-3 text-sm text-stone-700">Interpretant records the current reading and can chain into further signs.</div>
      </div>
      <div className="mt-4 text-sm text-stone-600">{payload.summary}</div>
    </div>
  );
}

function DiagramLens({ bundle, payload, selectedEntityId, onSelectEntity }) {
  const categories = bundle.entities.filter((entity) => entity.type === "Category").slice(0, 2);
  const functors = bundle.entities.filter((entity) => entity.type === "FunctorMapping").slice(0, 2);
  const naturals = bundle.entities.filter((entity) => entity.type === "NaturalTransformation").slice(0, 2);

  return (
    <div className="rounded-[28px] border border-stone-200 bg-white p-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_160px_minmax(0,1fr)]">
        <div className="space-y-4">
          {categories.slice(0, 1).map((category) => (
            <button key={category.id} type="button" onClick={() => onSelectEntity?.(category)} className={cn("w-full rounded-[24px] border px-4 py-4 text-left", selectedEntityId === category.id ? "border-stone-900 bg-stone-900 text-white" : "border-stone-200 bg-stone-50/70 text-stone-800")}>
              <div className="text-xs uppercase tracking-[0.14em] opacity-70">Source category</div>
              <div className="mt-2 font-serif text-2xl">{category.label}</div>
              <div className={cn("mt-3 text-sm", selectedEntityId === category.id ? "text-stone-200" : "text-stone-600")}>
                {(category.metadata?.object_ids || []).slice(0, 5).join(", ") || "No mapped objects"}
              </div>
            </button>
          ))}
        </div>
        <div className="flex flex-col items-center justify-center gap-4">
          {functors.map((functor) => (
            <button key={functor.id} type="button" onClick={() => onSelectEntity?.(functor)} className={cn("w-full rounded-2xl border px-3 py-3 text-center text-sm", selectedEntityId === functor.id ? "border-stone-900 bg-stone-900 text-white" : "border-stone-200 bg-white text-stone-700")}>
              {functor.label}
            </button>
          ))}
          {naturals.map((natural) => (
            <button key={natural.id} type="button" onClick={() => onSelectEntity?.(natural)} className={cn("w-full rounded-2xl border px-3 py-3 text-center text-xs", selectedEntityId === natural.id ? "border-amber-700 bg-amber-600 text-white" : "border-amber-200 bg-amber-50 text-amber-800")}>
              {natural.label}
            </button>
          ))}
        </div>
        <div className="space-y-4">
          {categories.slice(1, 2).map((category) => (
            <button key={category.id} type="button" onClick={() => onSelectEntity?.(category)} className={cn("w-full rounded-[24px] border px-4 py-4 text-left", selectedEntityId === category.id ? "border-stone-900 bg-stone-900 text-white" : "border-stone-200 bg-stone-50/70 text-stone-800")}>
              <div className="text-xs uppercase tracking-[0.14em] opacity-70">Target category</div>
              <div className="mt-2 font-serif text-2xl">{category.label}</div>
              <div className={cn("mt-3 text-sm", selectedEntityId === category.id ? "text-stone-200" : "text-stone-600")}>
                {(category.metadata?.object_ids || []).slice(0, 5).join(", ") || "No mapped objects"}
              </div>
            </button>
          ))}
        </div>
      </div>
      <div className="mt-5 text-sm text-stone-600">{payload.summary}</div>
    </div>
  );
}

function SheafLens({ bundle, payload, selectedEntityId, onSelectEntity }) {
  const covers = bundle.entities.filter((entity) => entity.type === "Cover").slice(0, 4);
  const obstructions = bundle.entities.filter((entity) => entity.type === "Obstruction");
  return (
    <div className="rounded-[28px] border border-stone-200 bg-[linear-gradient(180deg,_rgba(247,244,237,0.9),_rgba(255,255,255,0.96))] p-6">
      <div className="grid gap-4 lg:grid-cols-2">
        {covers.map((cover) => (
          <button key={cover.id} type="button" onClick={() => onSelectEntity?.(cover)} className={cn("rounded-[24px] border px-4 py-4 text-left", selectedEntityId === cover.id ? "border-stone-900 bg-stone-900 text-white" : "border-stone-200 bg-white text-stone-800")}>
            <div className="flex items-center justify-between gap-3">
              <div className="font-semibold">{cover.label}</div>
              <Badge className="rounded-full border border-stone-200 bg-stone-50 text-stone-700">
                {(cover.metadata?.node_ids || []).length} locals
              </Badge>
            </div>
            <div className={cn("mt-3 text-sm", selectedEntityId === cover.id ? "text-stone-200" : "text-stone-600")}>
              {(cover.metadata?.node_ids || []).slice(0, 4).join(", ")}
            </div>
          </button>
        ))}
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {obstructions.length ? obstructions.map((obstruction) => (
          <button key={obstruction.id} type="button" onClick={() => onSelectEntity?.(obstruction)} className={cn("rounded-2xl border px-4 py-3 text-left text-sm", selectedEntityId === obstruction.id ? "border-amber-700 bg-amber-600 text-white" : "border-amber-200 bg-amber-50 text-amber-800")}>
            <div className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" /> {obstruction.label}</div>
            <div className={cn("mt-2", selectedEntityId === obstruction.id ? "text-amber-100" : "text-amber-800/80")}>
              Threshold {obstruction.metadata?.threshold} / overlap {obstruction.metadata?.average_overlap}
            </div>
          </button>
        )) : (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">No active obstructions in the current evidence bundle.</div>
        )}
      </div>
      <div className="mt-5 text-sm text-stone-600">{payload.summary}</div>
    </div>
  );
}

function SimplicialLens({ payload }) {
  const simplices = payload.data?.simplices || [];
  return (
    <div className="rounded-[28px] border border-stone-200 bg-white p-6">
      <div className="grid gap-4 lg:grid-cols-2">
        {simplices.map((simplex) => (
          <div key={simplex.id} className="rounded-[24px] border border-stone-200 bg-stone-50/70 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="font-semibold text-stone-900">{simplex.dimension}-simplex</div>
              <Badge className="rounded-full border border-stone-200 bg-white text-stone-700">w {Number(simplex.weight || 0).toFixed(2)}</Badge>
            </div>
            <svg viewBox="0 0 220 140" className="mt-4 h-36 w-full">
              <polygon points="40,110 110,24 180,110" fill="rgba(201,171,93,0.18)" stroke="#9f8651" strokeWidth="2" />
              {simplex.labels.slice(0, 3).map((label, index) => {
                const points = [{ x: 30, y: 112 }, { x: 110, y: 20 }, { x: 190, y: 112 }];
                return (
                  <g key={label}>
                    <circle cx={points[index].x} cy={points[index].y} r="10" fill="#231a0d" />
                    <text x={points[index].x} y={points[index].y - 16} textAnchor="middle" fill="#5f5133" fontSize="11">{label}</text>
                  </g>
                );
              })}
            </svg>
          </div>
        ))}
      </div>
      <div className="mt-5 text-sm text-stone-600">{payload.summary}</div>
    </div>
  );
}

function CatastropheLens({ payload }) {
  const points = payload.data?.points || [];
  if (!points.length) {
    return (
      <div className="rounded-[28px] border border-stone-200 bg-white p-8 text-sm text-stone-600">
        {payload.summary}
      </div>
    );
  }

  const minYear = Math.min(...points.map((point) => point.year));
  const maxYear = Math.max(...points.map((point) => point.year));
  const range = Math.max(1, maxYear - minYear);

  return (
    <div className="rounded-[28px] border border-stone-200 bg-white p-6">
      <svg viewBox="0 0 760 320" className="h-[320px] w-full">
        <line x1="60" y1="250" x2="700" y2="250" stroke="#c8bea8" strokeWidth="2" />
        <line x1="60" y1="40" x2="60" y2="250" stroke="#c8bea8" strokeWidth="2" />
        <polyline
          fill="none"
          stroke="#7f6530"
          strokeWidth="3"
          points={points.map((point) => {
            const x = 60 + (((point.year - minYear) / range) * 620);
            const y = 250 - ((point.state_score || 0) * 180);
            return `${x},${y}`;
          }).join(" ")}
        />
        {points.map((point) => {
          const x = 60 + (((point.year - minYear) / range) * 620);
          const y = 250 - ((point.state_score || 0) * 180);
          return (
            <g key={point.document_id}>
              <circle cx={x} cy={y} r="7" fill="#231a0d" />
              <text x={x} y={y - 16} textAnchor="middle" fontSize="11" fill="#5f5133">{point.title}</text>
            </g>
          );
        })}
      </svg>
      <div className="mt-5 text-sm text-stone-600">{payload.summary}</div>
    </div>
  );
}

export function ResearchVisualizationCanvas({ bundle, activeLens, selectedEntityId, onSelectEntity }) {
  if (!bundle) {
    return (
      <div className="rounded-[28px] border border-dashed border-stone-300 bg-stone-50/70 p-10 text-center text-sm text-stone-500">
        Run a research query to populate the formal workspace.
      </div>
    );
  }

  const payload = bundle.lens_payloads?.find((item) => item.key === activeLens) || bundle.lens_payloads?.[0];
  if (!payload) {
    return (
      <div className="rounded-[28px] border border-dashed border-stone-300 bg-stone-50/70 p-10 text-center text-sm text-stone-500">
        No lens payloads are available for this bundle.
      </div>
    );
  }

  const meta = LENS_META[payload.key] || { icon: Network, title: payload.title };
  const Icon = meta.icon;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-700">
          <Icon className="h-4 w-4" />
          {payload.title}
        </div>
        <LensStatus status={payload.status} />
        <div className="text-sm text-stone-500">{payload.summary}</div>
      </div>

      {payload.key === "triad" ? <TriadLens bundle={bundle} payload={payload} selectedEntityId={selectedEntityId} onSelectEntity={onSelectEntity} /> : null}
      {payload.key === "diagram" ? <DiagramLens bundle={bundle} payload={payload} selectedEntityId={selectedEntityId} onSelectEntity={onSelectEntity} /> : null}
      {payload.key === "sheaf" ? <SheafLens bundle={bundle} payload={payload} selectedEntityId={selectedEntityId} onSelectEntity={onSelectEntity} /> : null}
      {payload.key === "simplicial" ? <SimplicialLens payload={payload} /> : null}
      {payload.key === "catastrophe" ? <CatastropheLens payload={payload} /> : null}
    </div>
  );
}

export function LensSwitcher({ activeLens, onChange, lensPayloads }) {
  return (
    <div className="flex flex-wrap gap-2">
      {(lensPayloads || []).map((lens) => (
        <Button
          key={lens.key}
          type="button"
          variant="outline"
          className={cn(
            "rounded-full border-stone-300 bg-white",
            activeLens === lens.key ? "border-stone-900 bg-stone-900 text-white hover:bg-stone-800" : ""
          )}
          onClick={() => onChange(lens.key)}
        >
          {LENS_META[lens.key]?.title || lens.title}
        </Button>
      ))}
    </div>
  );
}
