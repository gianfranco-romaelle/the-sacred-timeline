import type {
  StatisticalPoint,
} from "@/features/hegel-triangle-transform/information-geometry";
import type {
  InformationGeometryLabChartKind,
  InformationGeometryMode,
} from "@/types/hegel-triangle";

export type GeometryCoordinateKind = InformationGeometryLabChartKind | "lifted";

export type GeometryDivergenceKind =
  | "quadraticBregman"
  | "fisherRao"
  | "klRelativeEntropy"
  | "mixtureGeometry"
  | "alphaEmbedding"
  | "lieGroupInvariant"
  | "kahlerSignal"
  | "customExperimental";

export type GeometrySupportLevel = "native" | "surrogate" | "planned";
export type GeometryImplementationStatus = "working" | "scaffold";

export interface GeometryDivergenceInput {
  p: StatisticalPoint;
  q: StatisticalPoint;
  chartKind?: InformationGeometryLabChartKind;
}

export interface GeometryChartProjectionInput {
  theta: number[];
  eta: number[];
  chartKind: InformationGeometryLabChartKind;
}

export interface GeometryBarycenterInput {
  points: StatisticalPoint[];
  weights?: number[];
}

export interface GeometryFlowDirectionInput {
  point: StatisticalPoint;
  target?: StatisticalPoint;
  gradient?: number[];
  stepSize?: number;
}

export interface GeometryRegressionFitInput {
  samples: Array<{
    t: number;
    point: StatisticalPoint;
  }>;
}

export interface GeometryBarycenterResult {
  point: StatisticalPoint;
  iterations: number;
  method: string;
}

export interface GeometryFlowDirectionResult {
  thetaDirection: number[];
  etaDirection: number[];
  method: string;
}

export interface GeometryRegressionFitResult {
  fitted: Array<{
    t: number;
    point: StatisticalPoint;
  }>;
  residual: number;
  score: number;
  method: string;
}

export interface GeometryModeHooks {
  computeDivergence: (input: GeometryDivergenceInput) => number;
  computeChartProjection: (input: GeometryChartProjectionInput) => number[];
  computeBarycenter: (input: GeometryBarycenterInput) => GeometryBarycenterResult;
  computeFlowDirection: (input: GeometryFlowDirectionInput) => GeometryFlowDirectionResult;
  computeRegressionFit: (input: GeometryRegressionFitInput) => GeometryRegressionFitResult;
}

export interface GeometryModeDefinition {
  id: InformationGeometryMode;
  label: string;
  description: string;
  coordinateKinds: GeometryCoordinateKind[];
  divergenceKinds: GeometryDivergenceKind[];
  barycenterSupport: GeometrySupportLevel;
  flowSupport: GeometrySupportLevel;
  regressionSupport: GeometrySupportLevel;
  implementationStatus: GeometryImplementationStatus;
  hooks: GeometryModeHooks;
}
