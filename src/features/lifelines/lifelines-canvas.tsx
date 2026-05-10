import {
  type CSSProperties,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { LifelinesGroup, LifelinesProjection, LifespanBar } from "./types";

// ── Layout constants ────────────────────────────────────────────────────────

export const LEFT_GUTTER = 160; // px — sticky group-label column
const MIN_BAR_PX = 3;           // floor bar width in pixels
const RENDER_BUFFER_PX = 400;   // px beyond visible edge to pre-render
const DIAMOND_THRESHOLD = 18;   // spans ≤ this (years) render as a diamond point

function getDiamondSize(laneHeight: number): number {
  return Math.max(8, Math.round(laneHeight * 0.52));
}

// ── Axis helpers ────────────────────────────────────────────────────────────

function getTickConfig(pxPerYear: number): { step: number; labelEvery: number } {
  if (pxPerYear >= 4)   return { step: 10,  labelEvery: 1 };
  if (pxPerYear >= 1.5) return { step: 25,  labelEvery: 2 };
  if (pxPerYear >= 0.5) return { step: 50,  labelEvery: 2 };
  return                       { step: 100, labelEvery: 1 };
}

function buildTicks(start: number, end: number, step: number): number[] {
  const ticks: number[] = [];
  const first = Math.ceil(start / step) * step;
  for (let y = first; y <= end; y += step) ticks.push(y);
  return ticks;
}

// ── GroupTrack ──────────────────────────────────────────────────────────────

interface GroupTrackProps {
  group: LifelinesGroup;
  color: string;
  globalStartYear: number;
  pxPerYear: number;
  laneHeight: number;
  barHeight: number;
  visibleStartYear: number;
  visibleEndYear: number;
  selectedBarId: string | null;
  onBarClick: (bar: LifespanBar) => void;
}

const GroupTrack = memo(function GroupTrack({
  group,
  color,
  globalStartYear,
  pxPerYear,
  laneHeight,
  barHeight,
  visibleStartYear,
  visibleEndYear,
  selectedBarId,
  onBarClick,
}: GroupTrackProps) {
  const diamondSize = getDiamondSize(laneHeight);
  const barTopOffset = (laneHeight - barHeight) / 2;

  const visibleBars = group.bars.filter(
    (b) => b.endYear >= visibleStartYear && b.startYear <= visibleEndYear,
  );

  return (
    <div
      className="lifelines-group"
      style={{ "--group-color": color } as CSSProperties}
    >
      <div className="lifelines-group__header">
        <span className="lifelines-group__name">{group.calculusName ?? "Unassigned"}</span>
        <span className="lifelines-group__count">{group.bars.length}</span>
      </div>

      <div
        className="lifelines-group__track"
        style={{ height: group.laneCount * laneHeight }}
      >
        {visibleBars.map((bar) => {
          const isPoint = bar.endYear - bar.startYear <= DIAMOND_THRESHOLD;
          const isSelected = bar.id === selectedBarId;
          const centerX = (bar.startYear - globalStartYear) * pxPerYear;

          const left = isPoint ? centerX - diamondSize / 2 : centerX;
          const width = isPoint
            ? diamondSize
            : Math.max((bar.endYear - bar.startYear) * pxPerYear, MIN_BAR_PX);
          const top = isPoint
            ? bar.lane * laneHeight + (laneHeight - diamondSize) / 2
            : bar.lane * laneHeight + barTopOffset;
          const height = isPoint ? diamondSize : barHeight;

          return (
            <button
              key={bar.id}
              type="button"
              className={[
                "lifeline-bar",
                isPoint ? "is-point" : "",
                isSelected ? "is-selected" : "",
                bar.isOpenEnded && !isPoint ? "is-open-ended" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={
                {
                  left,
                  width,
                  top,
                  height,
                  "--bar-color": color,
                } as CSSProperties
              }
              title={`${bar.name} · ${bar.displayText}`}
              aria-label={`${bar.name}, ${bar.displayText}`}
              aria-pressed={isSelected}
              onClick={(e) => {
                e.stopPropagation();
                onBarClick(bar);
              }}
            >
              {!isPoint && width >= 40 ? (
                <span className="lifeline-bar__label">{bar.name}</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
});

// ── LifelinesCanvas ─────────────────────────────────────────────────────────

interface LifelinesCanvasProps {
  projection: LifelinesProjection;
  groupColors: Map<string, string>;
  pxPerYear: number;
  laneHeight: number;
  barHeight: number;
  selectedBarId: string | null;
  onSelectBar: (bar: LifespanBar | null) => void;
}

export function LifelinesCanvas({
  projection,
  groupColors,
  pxPerYear,
  laneHeight,
  barHeight,
  selectedBarId,
  onSelectBar,
}: LifelinesCanvasProps) {
  const { groups, globalStartYear, globalEndYear } = projection;
  const canvasRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(-1);

  // ── Viewport tracking (RAF-throttled, no state on scroll) ───────────────
  const [viewport, setViewport] = useState({ scrollLeft: 0, width: 1200 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let scrollEl: HTMLElement | null = canvas.parentElement;
    while (scrollEl && !scrollEl.classList.contains("lifelines-scroll-area")) {
      scrollEl = scrollEl.parentElement;
    }
    if (!scrollEl) return;

    const flush = () =>
      setViewport({ scrollLeft: scrollEl!.scrollLeft, width: scrollEl!.clientWidth });

    const onScroll = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(flush);
    };

    flush();
    scrollEl.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(flush);
    ro.observe(scrollEl);

    return () => {
      scrollEl!.removeEventListener("scroll", onScroll);
      ro.disconnect();
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // ── Visible year range ──────────────────────────────────────────────────
  const contentScrollLeft = Math.max(0, viewport.scrollLeft - LEFT_GUTTER);
  const visibleStartYear =
    globalStartYear + (contentScrollLeft - RENDER_BUFFER_PX) / pxPerYear;
  const visibleEndYear =
    globalStartYear + (contentScrollLeft + viewport.width + RENDER_BUFFER_PX) / pxPerYear;

  // ── Axis ────────────────────────────────────────────────────────────────
  const totalYearSpan = Math.max(globalEndYear - globalStartYear, 1);
  const trackWidth = Math.ceil(totalYearSpan * pxPerYear);
  const { step: tickStep, labelEvery } = getTickConfig(pxPerYear);
  const ticks = useMemo(
    () => buildTicks(globalStartYear, globalEndYear, tickStep),
    [globalStartYear, globalEndYear, tickStep],
  );

  const handleSelectBar = useCallback(
    (bar: LifespanBar) => onSelectBar(bar.id === selectedBarId ? null : bar),
    [onSelectBar, selectedBarId],
  );

  const contentWidth = trackWidth + LEFT_GUTTER;

  return (
    <div
      ref={canvasRef}
      className="lifelines-canvas"
      onClick={() => onSelectBar(null)}
    >
      <div className="lifelines-axis-row" style={{ minWidth: contentWidth }}>
        <div className="lifelines-axis-gutter" aria-hidden="true" />
        <div className="lifelines-axis" style={{ width: trackWidth }}>
          {ticks.map((year, i) => (
            <div
              key={year}
              className="lifelines-tick"
              style={{ left: (year - globalStartYear) * pxPerYear }}
            >
              <div className="lifelines-tick__line" />
              {i % labelEvery === 0 ? (
                <span className="lifelines-tick__label">
                  {year < 0 ? `${Math.abs(year)} BCE` : year}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <div className="lifelines-groups" style={{ minWidth: contentWidth }}>
        {groups.map((group, i) => {
          const color = groupColors.get(String(group.calculusNumber ?? `g${i}`)) ?? "#64748b";
          return (
            <GroupTrack
              key={`${group.calculusName}-${i}`}
              group={group}
              color={color}
              globalStartYear={globalStartYear}
              pxPerYear={pxPerYear}
              laneHeight={laneHeight}
              barHeight={barHeight}
              visibleStartYear={visibleStartYear}
              visibleEndYear={visibleEndYear}
              selectedBarId={selectedBarId}
              onBarClick={handleSelectBar}
            />
          );
        })}
      </div>
    </div>
  );
}
