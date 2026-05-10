import { createContext, useContext } from "react";
import type { PropsWithChildren } from "react";
import {
  type UnifiedHistoricalRuntimeData,
  useUnifiedHistoricalRuntime,
} from "@/historical/unified-runtime";

const HistoricalRuntimeContext = createContext<UnifiedHistoricalRuntimeData | undefined>(undefined);

export function HistoricalRuntimeProvider({ children }: PropsWithChildren) {
  const runtime = useUnifiedHistoricalRuntime();

  return (
    <HistoricalRuntimeContext.Provider value={runtime}>
      {children}
    </HistoricalRuntimeContext.Provider>
  );
}

export function useHistoricalRuntime() {
  const runtime = useContext(HistoricalRuntimeContext);
  if (!runtime) {
    throw new Error("useHistoricalRuntime must be used inside HistoricalRuntimeProvider");
  }

  return runtime;
}
