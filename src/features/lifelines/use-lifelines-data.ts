import { useEffect, useState } from "react";
import type { RawLifespanEntry } from "./types";

const DATA_URL = "/sacred_timeline_current.json";

export type LifelinesDataState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; raw: RawLifespanEntry[] }
  | { status: "error"; message: string };

// Module-level cache: fetch only once per session.
let cachedRaw: RawLifespanEntry[] | null = null;

export function useLifelinesData(): LifelinesDataState {
  const [state, setState] = useState<LifelinesDataState>(
    cachedRaw ? { status: "ready", raw: cachedRaw } : { status: "idle" },
  );

  useEffect(() => {
    if (cachedRaw) {
      setState({ status: "ready", raw: cachedRaw });
      return;
    }

    setState({ status: "loading" });
    let cancelled = false;

    fetch(DATA_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status} loading ${DATA_URL}`);
        return res.json() as Promise<RawLifespanEntry[]>;
      })
      .then((raw) => {
        setTimeout(() => {
          if (cancelled) return;
          cachedRaw = raw;
          setState({ status: "ready", raw });
        }, 0);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setState({ status: "error", message });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
