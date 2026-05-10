import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useHistoricalRuntime } from "@/historical/runtime-context";
import { useExplorerStore } from "@/state/explorer-store";
import { buildLifelinesProjection } from "./lifespan-adapter";
import { LifelinesCanvas, LEFT_GUTTER } from "./lifelines-canvas";
import { useLifelinesData } from "./use-lifelines-data";
import type { GroupByMode, LifelinesProjection, LifespanBar, RawLifespanEntry } from "./types";

// ── Zoom ─────────────────────────────────────────────────────────────────────

const MIN_PX_PER_YEAR = 0.08;
const MAX_PX_PER_YEAR = 20;
const DEFAULT_PX_PER_YEAR = 0.5;
const ZOOM_FACTOR = 1.35;

function clampZoom(v: number) {
  return Math.min(MAX_PX_PER_YEAR, Math.max(MIN_PX_PER_YEAR, v));
}

// ── Density ───────────────────────────────────────────────────────────────────

type Density = "compact" | "standard" | "comfortable";

const DENSITY: Record<Density, { laneHeight: number; barHeight: number }> = {
  compact:     { laneHeight: 16, barHeight: 8  },
  standard:    { laneHeight: 22, barHeight: 12 },
  comfortable: { laneHeight: 30, barHeight: 18 },
};

const normalizeLifelineName = (value: string | null | undefined) =>
  (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();

const getCalculusForYear = (year: number): { number: number; name: string } => {
  if (year < 1600) return { number: 0, name: "Zeroth Calculus" };
  if (year < 1750) return { number: 1, name: "First Calculus" };
  if (year < 1850) return { number: 2, name: "Second Calculus" };
  if (year < 1900) return { number: 3, name: "Third Calculus" };
  if (year < 1950) return { number: 4, name: "Fourth Calculus" };
  if (year < 1980) return { number: 5, name: "Fifth Calculus" };
  return { number: 6, name: "Sixth Calculus" };
};

const formatLifelineYear = (year: number) => (year < 0 ? `${Math.abs(year)} BCE` : String(year));

const GROUP_OPTIONS: Array<{ value: GroupByMode; label: string }> = [
  { value: "calculus", label: "Editorial stage" },
  { value: "era", label: "Era" },
  { value: "domain", label: "Domain" },
  { value: "tradition", label: "Tradition" },
  { value: "field", label: "Field" },
  { value: "country", label: "Country" },
];

// ── Color palettes ────────────────────────────────────────────────────────────

const CALCULUS_COLORS: Record<string, string> = {
  "0": "#78716c", "1": "#d97706", "2": "#16a34a",
  "3": "#0ea5e9", "4": "#8b5cf6", "5": "#e11d48",
  "null": "#64748b",
};

const GROUP_PALETTE = [
  "#d97706", "#16a34a", "#0ea5e9", "#8b5cf6", "#e11d48", "#78716c",
  "#059669", "#7c3aed", "#dc2626", "#0891b2", "#65a30d", "#c2410c",
];

// ── Minimap ───────────────────────────────────────────────────────────────────

interface MinimapProps {
  projection: LifelinesProjection;
  groupColors: Map<string, string>;
  scrollLeft: number;
  clientWidth: number;
  pxPerYear: number;
  onJump: (year: number) => void;
}

function LifelinesMinimap({ projection, groupColors, scrollLeft, clientWidth, pxPerYear, onJump }: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { groups, globalStartYear, globalEndYear } = projection;
  const totalSpan = Math.max(1, globalEndYear - globalStartYear);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = canvas.clientWidth;
    if (W === 0) return;
    canvas.width = W;
    const H = canvas.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = "rgba(136, 111, 76, 0.06)";
    ctx.fillRect(0, 0, W, H);

    // Group bands
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      const color = groupColors.get(String(g.calculusNumber ?? `g${i}`)) ?? "#64748b";
      const x = ((g.startYear - globalStartYear) / totalSpan) * W;
      const w = Math.max(2, ((g.endYear - g.startYear) / totalSpan) * W);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.5;
      ctx.fillRect(x, 0, w, H);
    }
    ctx.globalAlpha = 1;

    // Viewport indicator
    const totalContentPx = totalSpan * pxPerYear;
    const contentScroll = Math.max(0, scrollLeft - LEFT_GUTTER);
    const vpX = Math.max(0, (contentScroll / totalContentPx) * W);
    const vpW = Math.max(8, Math.min(W - vpX, (clientWidth / totalContentPx) * W));

    ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
    ctx.fillRect(vpX, 0, vpW, H);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.75)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(vpX + 0.75, 0.75, Math.max(1, vpW - 1.5), H - 1.5);
  }, [groups, groupColors, globalStartYear, totalSpan, scrollLeft, clientWidth, pxPerYear]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    onJump(globalStartYear + ratio * totalSpan);
  };

  return (
    <canvas
      ref={canvasRef}
      className="lifelines-minimap"
      height={36}
      onClick={handleClick}
      title="Click to jump to any point in the timeline"
    />
  );
}

// ── Bar detail fallback (shown when bar has no entity match) ──────────────────

function BarInfoStrip({ bar, onClose }: { bar: LifespanBar; onClose: () => void }) {
  return (
    <div className="lifelines-bar-strip">
      <div className="lifelines-bar-strip__body">
        <strong className="lifelines-bar-strip__name">{bar.name}</strong>
        <span className="lifelines-bar-strip__date">{bar.displayText}</span>
        {bar.field ? <span className="lifelines-bar-strip__meta">{bar.field}</span> : null}
        {bar.country ? <span className="lifelines-bar-strip__meta">{bar.country}</span> : null}
        {bar.calculusName ? (
          <span className="lifelines-bar-strip__meta">{bar.calculusName}</span>
        ) : null}
        <span className="lifelines-bar-strip__notice">Not in canonical dataset</span>
      </div>
      <button type="button" className="lifelines-bar-strip__close" onClick={onClose}>×</button>
    </div>
  );
}

// ── LifelinesView ─────────────────────────────────────────────────────────────

export function LifelinesView() {
  const data = useLifelinesData();
  const { index, seed } = useHistoricalRuntime();
  const selectEntity = useExplorerStore((s) => s.selectEntity);
  const selectedEntityId = useExplorerStore((s) => s.selectedEntityId);

  const [groupBy, setGroupBy] = useState<GroupByMode>("calculus");
  const [density, setDensity] = useState<Density>("standard");
  const [pxPerYear, setPxPerYear] = useState(DEFAULT_PX_PER_YEAR);
  const [selectedBar, setSelectedBar] = useState<LifespanBar | null>(null);
  const [pinnedBars, setPinnedBars] = useState<LifespanBar[]>([]);
  const [unmatchedBar, setUnmatchedBar] = useState<LifespanBar | null>(null);
  const [jumpInput, setJumpInput] = useState("");
  const [scrollState, setScrollState] = useState({ scrollLeft: 0, clientWidth: 1200 });

  const scrollRef = useRef<HTMLDivElement>(null);
  const pxPerYearRef = useRef(DEFAULT_PX_PER_YEAR);
  const globalStartYearRef = useRef(0);
  pxPerYearRef.current = pxPerYear;

  const { laneHeight, barHeight } = DENSITY[density];

  const enrichedRaw = useMemo<RawLifespanEntry[] | null>(() => {
    if (data.status !== "ready") return null;

    const seenNames = new Set(data.raw.map((entry) => normalizeLifelineName(entry.name)));
    const canonicalPeople = seed.people.flatMap((person): RawLifespanEntry[] => {
      const birthYear = person.dateRange?.sortStartYear ?? person.dateRange?.start?.date?.year;
      if (typeof birthYear !== "number") return [];

      const nameKey = normalizeLifelineName(person.label);
      if (!nameKey || seenNames.has(nameKey)) return [];
      seenNames.add(nameKey);

      const deathYear = person.dateRange?.sortEndYear ?? person.dateRange?.end?.date?.year ?? null;
      const calculus = getCalculusForYear(birthYear);
      const primaryDomain = person.domainIds[0]
        ? index.domainsById.get(person.domainIds[0])?.label
        : undefined;
      const portrait = person.mediaAssetIds
        .filter((id): id is `portrait_${string}` => id.startsWith("portrait_"))
        .map((id) => index.portraitsById.get(id)?.file.thumbnailSrc ?? index.portraitsById.get(id)?.file.src)
        .find((src): src is string => Boolean(src));

      return [
        {
          name: person.label,
          birth_year: birthYear,
          death_year: deathYear,
          lifespan_raw:
            person.dateRange?.displayLabel ??
            `${formatLifelineYear(birthYear)}-${deathYear === null ? "present" : formatLifelineYear(deathYear)}`,
          country: null,
          field: person.roles[0]?.replaceAll("_", " ") ?? primaryDomain ?? null,
          calculus_number: calculus.number,
          calculus_name: calculus.name,
          portrait_url: portrait ?? null,
        },
      ];
    });

    return [...data.raw, ...canonicalPeople];
  }, [data, index, seed.people]);

  // ── Build projection on raw data + groupBy change ───────────────────────
  const projection = useMemo<LifelinesProjection | null>(() => {
    if (!enrichedRaw) return null;
    return buildLifelinesProjection(enrichedRaw, groupBy, index);
  }, [enrichedRaw, groupBy, index]);

  // ── Group color map ──────────────────────────────────────────────────────
  const groupColors = useMemo<Map<string, string>>(() => {
    const map = new Map<string, string>();
    if (!projection) return map;
    projection.groups.forEach((g, i) => {
      const key = String(g.calculusNumber ?? `g${i}`);
      const color =
        groupBy === "calculus"
          ? (CALCULUS_COLORS[String(g.calculusNumber)] ?? "#64748b")
          : GROUP_PALETTE[i % GROUP_PALETTE.length];
      map.set(key, color);
    });
    return map;
  }, [projection, groupBy]);

  // ── Entity name index for inspector connection ───────────────────────────
  const allBars = useMemo(
    () => projection?.groups.flatMap((group) => group.bars) ?? [],
    [projection],
  );

  const selectedEntityBar = useMemo(
    () => allBars.find((bar) => bar.entityId === selectedEntityId) ?? null,
    [allBars, selectedEntityId],
  );

  useEffect(() => {
    if (!selectedEntityId) return;
    const bar = allBars.find((item) => item.entityId === selectedEntityId);
    if (bar) {
      setSelectedBar(bar);
      setUnmatchedBar(null);
    }
  }, [allBars, selectedEntityId]);

  // ── Scroll state for minimap ─────────────────────────────────────────────
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () =>
      setScrollState({ scrollLeft: el.scrollLeft, clientWidth: el.clientWidth });
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(onScroll);
    ro.observe(el);
    onScroll();
    return () => { el.removeEventListener("scroll", onScroll); ro.disconnect(); };
  }, [data.status]);

  // ── Wheel zoom (non-passive so preventDefault works) ────────────────────
  const applyZoom = useCallback((factor: number) => {
    const el = scrollRef.current;
    const globalStartYear = globalStartYearRef.current;
    setPxPerYear((prev) => {
      const next = clampZoom(prev * factor);
      if (el) {
        const contentLeft = Math.max(0, el.scrollLeft - LEFT_GUTTER);
        const centerYear = globalStartYear + (contentLeft + el.clientWidth / 2) / prev;
        requestAnimationFrame(() => {
          el.scrollLeft = LEFT_GUTTER + (centerYear - globalStartYear) * next - el.clientWidth / 2;
        });
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      applyZoom(e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR);
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [applyZoom, data.status]);

  // ── Navigation helpers ───────────────────────────────────────────────────
  const jumpToYear = useCallback((year: number) => {
    const el = scrollRef.current;
    if (!el || !projection) return;
    const { globalStartYear } = projection;
    const targetX = LEFT_GUTTER + (year - globalStartYear) * pxPerYearRef.current - el.clientWidth / 2;
    el.scrollLeft = Math.max(0, targetX);
  }, [projection]);

  const centerOnBar = useCallback((bar: LifespanBar, nextPxPerYear = pxPerYearRef.current) => {
    const el = scrollRef.current;
    if (!el || !projection) return;
    const midYear = (bar.startYear + bar.endYear) / 2;
    const { globalStartYear } = projection;
    const targetX = LEFT_GUTTER + (midYear - globalStartYear) * nextPxPerYear - el.clientWidth / 2;
    el.scrollLeft = Math.max(0, targetX);
  }, [projection]);

  const fitToBar = useCallback((bar: LifespanBar) => {
    const el = scrollRef.current;
    if (!el) return;
    const span = Math.max(12, bar.endYear - bar.startYear);
    const targetZoom = clampZoom((el.clientWidth * 0.68) / span);
    setPxPerYear(targetZoom);
    requestAnimationFrame(() => centerOnBar(bar, targetZoom));
  }, [centerOnBar]);

  const handleJumpSubmit = () => {
    const year = parseInt(jumpInput, 10);
    if (Number.isFinite(year)) jumpToYear(year);
  };

  const handleZoomIn = () => applyZoom(ZOOM_FACTOR);
  const handleZoomOut = () => applyZoom(1 / ZOOM_FACTOR);
  const handleReset = () => {
    setPxPerYear(DEFAULT_PX_PER_YEAR);
    if (scrollRef.current) scrollRef.current.scrollLeft = 0;
  };

  const handleJumpToSelectedEntity = () => {
    if (selectedEntityBar) centerOnBar(selectedEntityBar);
  };

  const handleFitSelectedEntity = () => {
    if (selectedEntityBar) fitToBar(selectedEntityBar);
  };

  const togglePinnedBar = (bar: LifespanBar) => {
    setPinnedBars((current) =>
      current.some((item) => item.id === bar.id)
        ? current.filter((item) => item.id !== bar.id)
        : [...current, bar].slice(-6),
    );
  };

  // ── Bar click: connect to global inspector ───────────────────────────────
  const handleSelectBar = useCallback((bar: LifespanBar | null) => {
    if (!bar) {
      setSelectedBar(null);
      setUnmatchedBar(null);
      return;
    }
    setSelectedBar(bar);
    if (bar.entityId && bar.entityType) {
      selectEntity(bar.entityId, bar.entityType, "river");
      setUnmatchedBar(null);
    } else {
      setUnmatchedBar(bar);
    }
  }, [selectEntity]);

  // ── Loading / error states ───────────────────────────────────────────────
  if (data.status === "idle" || data.status === "loading") {
    return (
      <div className="lifelines-view lifelines-view--loading">
        <p>Loading River of Time…</p>
      </div>
    );
  }

  if (data.status === "error") {
    return (
      <div className="lifelines-view lifelines-view--error">
        <p>
          <strong>Failed to load River of Time data.</strong> {data.message}
        </p>
      </div>
    );
  }

  if (!projection) return null;

  globalStartYearRef.current = projection.globalStartYear;

  return (
    <div className="lifelines-view">
      {/* Controls */}
      <div className="lifelines-controls">
        <div className="lifelines-controls__row">
          <span className="lifelines-controls__label">
            River of Time · {projection.totalBars.toLocaleString()} figures · {projection.groups.length} groups
          </span>

          <div className="lifelines-controls__group">
            <label className="lifelines-controls__field">
              <span>Group by</span>
              <select
                className="lifelines-controls__select"
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value as GroupByMode)}
              >
                {GROUP_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="lifelines-controls__group">
            <span className="lifelines-controls__field-label">Density</span>
            <div className="lifelines-controls__density">
              {(["compact", "standard", "comfortable"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`lifelines-density-btn${density === d ? " is-active" : ""}`}
                  onClick={() => setDensity(d)}
                  title={d}
                >
                  {d === "compact" ? "S" : d === "standard" ? "M" : "L"}
                </button>
              ))}
            </div>
          </div>

          <div className="lifelines-controls__group">
            <label className="lifelines-controls__field">
              <span>Jump to</span>
              <input
                className="lifelines-controls__year-input"
                type="number"
                placeholder="year"
                value={jumpInput}
                onChange={(e) => setJumpInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleJumpSubmit()}
              />
            </label>
            <button
              type="button"
              className="lifelines-controls__btn"
              onClick={handleJumpSubmit}
              title="Jump to year"
            >
              →
            </button>
            {selectedBar ? (
              <button
                type="button"
                className="lifelines-controls__btn"
                onClick={() => fitToBar(selectedBar)}
                title="Fit to selected figure"
              >
                Fit
              </button>
            ) : null}
            {selectedEntityBar ? (
              <>
                <button
                  type="button"
                  className="lifelines-controls__btn"
                  onClick={handleJumpToSelectedEntity}
                  title="Jump to inspector selection"
                >
                  Sel
                </button>
                <button
                  type="button"
                  className="lifelines-controls__btn"
                  onClick={handleFitSelectedEntity}
                  title="Fit inspector selection"
                >
                  Fit sel
                </button>
              </>
            ) : null}
            {selectedBar ? (
              <button
                type="button"
                className={`lifelines-controls__btn${
                  pinnedBars.some((item) => item.id === selectedBar.id) ? " is-active" : ""
                }`}
                onClick={() => togglePinnedBar(selectedBar)}
                title="Pin selected figure for comparison"
              >
                Pin
              </button>
            ) : null}
          </div>

          <div className="lifelines-controls__zoom">
            <button type="button" className="lifelines-controls__btn" onClick={handleZoomOut}>−</button>
            <button
              type="button"
              className="lifelines-controls__zoom-level"
              onClick={handleReset}
              title="Reset zoom"
            >
              {pxPerYear < 1 ? `${(pxPerYear * 100).toFixed(0)}%` : `${pxPerYear.toFixed(1)}×`}
            </button>
            <button type="button" className="lifelines-controls__btn" onClick={handleZoomIn}>+</button>
          </div>
        </div>

        <span className="lifelines-controls__hint">
          Scroll to navigate · Ctrl+scroll or +/− to zoom · Click figure to inspect
        </span>
      </div>

      {/* Minimap */}
      <LifelinesMinimap
        projection={projection}
        groupColors={groupColors}
        scrollLeft={scrollState.scrollLeft}
        clientWidth={scrollState.clientWidth}
        pxPerYear={pxPerYear}
        onJump={jumpToYear}
      />

      {/* Unmatched bar info strip */}
      {unmatchedBar ? (
        <BarInfoStrip bar={unmatchedBar} onClose={() => { setUnmatchedBar(null); setSelectedBar(null); }} />
      ) : null}

      {pinnedBars.length > 0 ? (
        <div className="lifelines-pinned" aria-label="Pinned figures">
          <span className="lifelines-pinned__label">Pinned</span>
          {pinnedBars.map((bar) => (
            <button
              key={bar.id}
              type="button"
              className={`lifelines-pinned__chip${selectedBar?.id === bar.id ? " is-active" : ""}`}
              onClick={() => {
                setSelectedBar(bar);
                centerOnBar(bar);
                if (bar.entityId && bar.entityType) {
                  selectEntity(bar.entityId, bar.entityType, "river");
                }
              }}
              title={`${bar.name} - ${bar.displayText}`}
            >
              {bar.name}
            </button>
          ))}
          <button
            type="button"
            className="lifelines-pinned__clear"
            onClick={() => setPinnedBars([])}
          >
            Clear
          </button>
        </div>
      ) : null}

      {/* Main canvas */}
      <div className="lifelines-workspace">
        <div className="lifelines-scroll-area" ref={scrollRef}>
          <LifelinesCanvas
            projection={projection}
            groupColors={groupColors}
            pxPerYear={pxPerYear}
            laneHeight={laneHeight}
            barHeight={barHeight}
            selectedBarId={selectedBar?.id ?? null}
            onSelectBar={handleSelectBar}
          />
        </div>
      </div>
    </div>
  );
}
