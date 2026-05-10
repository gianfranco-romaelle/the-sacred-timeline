import type { NegAdjunctionField } from "@/features/hegel-triangle-transform/information-geometry";
import type {
  FragmentId,
  FragmentPhase,
  HegelTriangleFragmentTransformSnapshot,
  InformationGeometryLabBarycenterSourceMode,
  InformationGeometryLabBarycenterWeightMode,
  InformationGeometryLabChartKind,
  InformationGeometryLabColorScaleMode,
  InformationGeometryLabRegressionDisplayMode,
  InformationGeometryLabRegressionTargetMode,
  InformationGeometryLabFlowMode,
  InformationGeometryMode,
  InformationGeometryLabNormalizationMode,
  InformationGeometryLabScalarField,
  InformationGeometryLabTab,
  InformationGeometryLabViewMode,
  Point2D,
  SemanticProposalId,
} from "@/types/hegel-triangle";

export type IGAdapterState = Pick<HegelTriangleFragmentTransformSnapshot, "simulation" | "view">;

export interface IGSite {
  id: string;
  fragmentId: FragmentId;
  proposalId?: SemanticProposalId;
  tick: number;
  geometryMode: InformationGeometryMode;
  geometrySource: "native" | "quadratic-surrogate";
  label: string;
  point: Point2D;
  embedding: number[];
  theta: number[];
  eta: number[];
  divergence: number;
  asymmetry: number;
  curvature: number;
  projection: number;
  promiseConstructive: number;
  promiseObstructive: number;
  phase?: FragmentPhase | string;
  sourceKind: "fragment" | "proposal";
}

export interface IGScalarFieldSample {
  id: string;
  fragmentId: FragmentId;
  proposalId?: SemanticProposalId;
  tick: number;
  geometryMode: InformationGeometryMode;
  geometrySource: "native" | "quadratic-surrogate";
  point: Point2D;
  fieldKind: InformationGeometryLabScalarField;
  value: number;
  divergence: number;
  asymmetry: number;
  curvature: number;
  projection: number;
  promiseConstructive: number;
  promiseObstructive: number;
}

export interface IGTrianglePatch {
  fragmentId: FragmentId;
  proposalId?: SemanticProposalId;
  tick: number;
  geometryMode: InformationGeometryMode;
  geometrySource: "native" | "quadratic-surrogate";
  centroid: Point2D;
  phase?: FragmentPhase | string;
  centerField: NegAdjunctionField;
  vertices: Array<{
    id: string;
    point: Point2D;
    embedding: number[];
    theta: number[];
    eta: number[];
  }>;
  scalarSamples: IGScalarFieldSample[];
}

export interface IGVoronoiCell {
  siteId: string;
  fragmentId: FragmentId;
  proposalId?: SemanticProposalId;
  sitePoint: Point2D;
  polygon: Point2D[];
  scalarValue: number;
}

export interface IGChartPoint {
  id: string;
  fragmentId: FragmentId;
  proposalId?: SemanticProposalId;
  tick: number;
  geometryMode: InformationGeometryMode;
  geometrySource: "native" | "quadratic-surrogate";
  chartKind: InformationGeometryLabChartKind;
  point: Point2D;
  coordinates: number[];
  divergence: number;
  asymmetry: number;
  curvature: number;
  projection: number;
  promiseConstructive: number;
  promiseObstructive: number;
  phase?: FragmentPhase | string;
  sourceKind: "fragment" | "proposal";
}

export interface IGChartSnapshot {
  tick: number;
  geometryMode: InformationGeometryMode;
  geometrySource: "native" | "quadratic-surrogate";
  thetaPoints: IGChartPoint[];
  etaPoints: IGChartPoint[];
}

export interface IGLiftedPoint {
  id: string;
  fragmentId: FragmentId;
  proposalId?: SemanticProposalId;
  tick: number;
  geometryMode: InformationGeometryMode;
  geometrySource: "native" | "quadratic-surrogate";
  basePoint: Point2D;
  height: number;
  embedding: number[];
  theta: number[];
  eta: number[];
  divergence: number;
  asymmetry: number;
  curvature: number;
  projection: number;
  promiseConstructive: number;
  promiseObstructive: number;
  phase?: FragmentPhase | string;
  sourceKind: "fragment" | "proposal";
}

export interface IGLabSnapshotArtifact {
  id: string;
  savedAt: string;
  tick: number;
  fragmentId?: FragmentId;
  proposalId?: SemanticProposalId;
  geometryMode: InformationGeometryMode;
  viewMode: InformationGeometryLabViewMode;
  moduleTab: InformationGeometryLabTab;
  chartKind: InformationGeometryLabChartKind;
  scalarField: InformationGeometryLabScalarField;
  colorScaleMode: InformationGeometryLabColorScaleMode;
  normalizationMode: InformationGeometryLabNormalizationMode;
  label?: string;
  phase?: FragmentPhase | string;
  compareWithPreviousTick: boolean;
  metadata: {
    autoFollowActiveFragment: boolean;
    freezeCurrentSnapshot: boolean;
    voronoiGridResolution: number;
    voronoiSiteSource: string;
    accumulationTrailLength: number;
    accumulationMode: string;
    barycenterSourceMode: InformationGeometryLabBarycenterSourceMode | string;
    barycenterWeightMode: InformationGeometryLabBarycenterWeightMode | string;
    barycenterTickWindow: number;
    selectedFlowMode: InformationGeometryLabFlowMode | string;
    regressionEnabled: boolean;
    regressionTargetMode: InformationGeometryLabRegressionTargetMode | string;
    regressionDisplayMode: InformationGeometryLabRegressionDisplayMode | string;
    regressionTickWindow: number;
    flowVectorDensity: number;
    flowVectorScale: number;
    showVoronoiSites: boolean;
    showVoronoiBoundaries: boolean;
    showLiftedSurface: boolean;
    showLiftedStems: boolean;
    showLiftedFootprint: boolean;
    showGeodesics: boolean;
    showNucleation: boolean;
    showCatastropheMarkers: boolean;
    showBarycenter: boolean;
    showBarycenterTrail: boolean;
    showFlowVectors: boolean;
    showFlowTrails: boolean;
    animateFlowOverTicks: boolean;
    showResidualMarkers: boolean;
    showAccumulationHistory: boolean;
  };
  sitePositions: IGSite[];
  scalarSamples: IGScalarFieldSample[];
  patch?: IGTrianglePatch;
  dualChart?: IGChartSnapshot;
  liftedPoints?: IGLiftedPoint[];
}

export interface IGLabSnapshotIndexRecord {
  id: string;
  parentId?: string;
  fragmentId?: FragmentId;
  proposalId?: SemanticProposalId;
  tick: number;
  createdAt: string;
  updatedAt: string;
  geometryMode?: InformationGeometryMode | string;
  viewMode: InformationGeometryLabViewMode | string;
  moduleTab?: InformationGeometryLabTab | string;
  chartKind?: InformationGeometryLabChartKind | string;
  scalarField?: InformationGeometryLabScalarField | string;
  colorScaleMode?: InformationGeometryLabColorScaleMode | string;
  normalizationMode?: InformationGeometryLabNormalizationMode | string;
  artifactPath: string;
  siteCount: number;
  sampleCount: number;
  summary?: {
    label?: string;
    phase?: string;
  };
}
