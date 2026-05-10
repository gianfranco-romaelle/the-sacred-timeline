import type { ExplorerFilters, ExplorerView } from "@/state/explorer-store";
import type { SeedIndex } from "@/data/entity-index";
import type { KnowledgeEntityId, SacredTimelineSeedData } from "@/types";

export interface ProjectionInput {
  seed: SacredTimelineSeedData;
  index: SeedIndex;
  filters: ExplorerFilters;
  selectedEntityId?: KnowledgeEntityId;
  selectionSourceView?: ExplorerView;
}

export interface ProjectionCounts {
  [key: string]: number;
}

export type ProjectionDiagnosticSeverity = "info" | "warning";

export interface ProjectionDiagnostic {
  code: string;
  severity: ProjectionDiagnosticSeverity;
  message: string;
}

export interface ViewProjection<TCounts extends ProjectionCounts = ProjectionCounts> {
  projectionKind: ExplorerView;
  visibleCounts: TCounts;
  diagnostics?: ProjectionDiagnostic[];
}

export type ViewProjectionAdapter<
  TProjection extends ViewProjection,
  TInput extends ProjectionInput = ProjectionInput,
> = (
  input: TInput,
) => TProjection;
