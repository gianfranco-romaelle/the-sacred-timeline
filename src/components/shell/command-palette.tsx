import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { useHistoricalRuntime } from "@/historical/runtime-context";
import { useExplorerStore } from "@/state/explorer-store";
import type { CanonicalEntityType, KnowledgeEntityId } from "@/types";

const TYPE_COLOR: Record<CanonicalEntityType, string> = {
  person:      "#38bdf8",
  text:        "#f59e0b",
  concept:     "#a78bfa",
  institution: "#fb923c",
  event:       "#fb7185",
  place:       "#34d399",
  tradition:   "#818cf8",
};

const TYPE_LABEL: Record<CanonicalEntityType, string> = {
  person:      "Person",
  text:        "Text",
  concept:     "Concept",
  institution: "Institution",
  event:       "Event",
  place:       "Place",
  tradition:   "Tradition",
};

interface SearchItem {
  id: KnowledgeEntityId;
  label: string;
  entityType: CanonicalEntityType;
  description: string;
  searchable: string; // pre-built lowercase search corpus
  yearLabel: string;
}

function fmtYear(y: number): string {
  return y < 0 ? `${Math.abs(y)} BCE` : String(y);
}

function score(item: SearchItem, q: string): number {
  const lbl = item.label.toLowerCase();
  if (lbl === q)           return 100;
  if (lbl.startsWith(q))  return 80;
  if (lbl.includes(q))    return 60;
  if (item.searchable.includes(q)) return 30;
  return 0;
}

export function CommandPalette() {
  const { index } = useHistoricalRuntime();
  const selectEntity = useExplorerStore((s) => s.selectEntity);

  const [open, setOpen]         = useState(false);
  const [query, setQuery]       = useState("");
  const [activeIdx, setActive]  = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef  = useRef<HTMLUListElement>(null);

  const items = useMemo<SearchItem[]>(() => {
    if (!index) return [];
    const out: SearchItem[] = [];
    for (const e of index.entitiesById.values()) {
      const start = e.dateRange?.sortStartYear;
      const end   = e.dateRange?.sortEndYear;
      const yearLabel =
        start != null
          ? end != null && end !== start
            ? `${fmtYear(start)} – ${fmtYear(end)}`
            : fmtYear(start)
          : "";

      const altLabels = (e as { alternateLabels?: string[] }).alternateLabels ?? [];
      const searchable = [
        e.label,
        ...altLabels,
        e.description ?? "",
      ].join(" ").toLowerCase();

      out.push({
        id: e.id,
        label: e.label,
        entityType: e.entityType,
        description: e.description ?? "",
        searchable,
        yearLabel,
      });
    }
    out.sort((a, b) => a.label.localeCompare(b.label));
    return out;
  }, [index]);

  const results = useMemo<SearchItem[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return items
      .map((item) => ({ item, s: score(item, q) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.item.label.localeCompare(b.item.label))
      .slice(0, 24)
      .map((x) => x.item);
  }, [items, query]);

  useEffect(() => { setActive(0); }, [results]);

  // Global Ctrl+K / Cmd+K and custom trigger event
  useEffect(() => {
    const openPalette = () => { setOpen(true); setQuery(""); };
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
        setQuery("");
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("cmd:open", openPalette);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("cmd:open", openPalette);
    };
  }, []);

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    const li = listRef.current?.children[activeIdx] as HTMLElement | undefined;
    li?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  const close = () => { setOpen(false); setQuery(""); };

  const commit = (item: SearchItem) => {
    selectEntity(item.id, item.entityType);
    close();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape")    { close(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    if (e.key === "Enter" && results[activeIdx]) commit(results[activeIdx]);
  };

  if (!open) return null;

  return (
    <div className="cmd-backdrop" onClick={close}>
      <div
        className="cmd-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cmd-palette__row">
          <svg className="cmd-palette__search-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.6"/>
            <line x1="12.5" y1="12.5" x2="17" y2="17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
          </svg>
          <input
            ref={inputRef}
            className="cmd-palette__input"
            type="search"
            placeholder="Search figures, texts, concepts, places…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="cmd-palette__esc" onClick={close}>Esc</kbd>
        </div>

        {results.length > 0 ? (
          <ul ref={listRef} className="cmd-palette__list" role="listbox">
            {results.map((item, i) => (
              <li
                key={item.id}
                className={`cmd-palette__item${i === activeIdx ? " is-active" : ""}`}
                role="option"
                aria-selected={i === activeIdx}
                onMouseEnter={() => setActive(i)}
                onClick={() => commit(item)}
              >
                <span
                  className="cmd-palette__badge"
                  style={{ "--badge": TYPE_COLOR[item.entityType] } as CSSProperties}
                >
                  {TYPE_LABEL[item.entityType]}
                </span>
                <span className="cmd-palette__body">
                  <span className="cmd-palette__name">{item.label}</span>
                  {item.description ? (
                    <span className="cmd-palette__desc">{item.description}</span>
                  ) : null}
                </span>
                {item.yearLabel ? (
                  <span className="cmd-palette__year">{item.yearLabel}</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : query.trim() ? (
          <p className="cmd-palette__empty">No results for "{query.trim()}"</p>
        ) : (
          <p className="cmd-palette__hint">
            {items.length.toLocaleString()} entries — type to search
          </p>
        )}
      </div>
    </div>
  );
}

/** Header trigger button — fires a custom event that CommandPalette listens for. */
export function CommandPaletteTrigger() {
  return (
    <button
      type="button"
      className="cmd-trigger"
      onClick={() => document.dispatchEvent(new CustomEvent("cmd:open"))}
      title="Search (Ctrl+K)"
    >
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" width="14" height="14">
        <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.6"/>
        <line x1="12.5" y1="12.5" x2="17" y2="17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
      </svg>
      <span>Search</span>
      <kbd>Ctrl K</kbd>
    </button>
  );
}
