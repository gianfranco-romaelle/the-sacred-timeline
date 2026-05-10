import { initializeHistorySqlite } from "@/persistence/history-sqlite";
import { ensureArtifactDirectories } from "@/persistence/artifact-store";
import { importNodeModule } from "@/lib/node-dynamic-import";
import type {
  InformationGeometryLabBarycenterSourceMode,
  InformationGeometryLabChartKind,
  InformationGeometryLabRegressionDisplayMode,
  InformationGeometryLabScalarField,
  InformationGeometryLabViewMode,
  InformationGeometryLabFlowMode,
  InformationGeometryMode,
  SemeioticLens,
} from "@/types/hegel-triangle";

export type LeanRuntimeMode = "external" | "mock";

export interface RuntimeConfig {
  liveTickWindow: number;
  logDirectory: string;
  artifactDirectory: string;
  databasePath: string;
  leanRuntimeMode: LeanRuntimeMode;
  leanRuntimeCommand: string;
  persistRawLLM: boolean;
  persistRawLeanStdout: boolean;
  persistRawLeanStderr: boolean;
  maxProposalsPerFragment: number;
  defaultGeometryMode: InformationGeometryMode;
  defaultIGViewMode: InformationGeometryLabViewMode;
  defaultScalarField: InformationGeometryLabScalarField;
  defaultChartKind: InformationGeometryLabChartKind;
  defaultBarycenterMode: InformationGeometryLabBarycenterSourceMode;
  defaultFlowMode: InformationGeometryLabFlowMode;
  defaultRegressionMode: InformationGeometryLabRegressionDisplayMode;
  voronoiGridResolution: number;
  liftedSurfaceQuality: number;
  accumulationTrailLimit: number;
  igLabSnapshotRetention: number;
  igLabAccumulateWhileHidden: boolean;
  enableSemeiotics: boolean;
  semeioticAutoAnnotate: boolean;
  semeioticLogRawOutputs: boolean;
  semeioticInfluencesPromiseProfile: boolean;
  semeioticInspectorVisibleByDefault: boolean;
  defaultSemeioticLens: SemeioticLens;
}

export type RuntimeConfigStatus = "idle" | "loading" | "ready" | "saving" | "error";

export const RUNTIME_CONFIG_PATH = "config/runtime.json";

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  liveTickWindow: 1,
  logDirectory: "logs",
  artifactDirectory: "artifacts",
  databasePath: "data/history.sqlite",
  leanRuntimeMode: "external",
  leanRuntimeCommand: "lake env lean",
  persistRawLLM: false,
  persistRawLeanStdout: true,
  persistRawLeanStderr: true,
  maxProposalsPerFragment: 4,
  defaultGeometryMode: "quadraticBregman",
  defaultIGViewMode: "localPatch",
  defaultScalarField: "divergence",
  defaultChartKind: "theta",
  defaultBarycenterMode: "activeNeighborhood",
  defaultFlowMode: "proposalFlow",
  defaultRegressionMode: "fittedCurve",
  voronoiGridResolution: 18,
  liftedSurfaceQuality: 3,
  accumulationTrailLimit: 8,
  igLabSnapshotRetention: 64,
  igLabAccumulateWhileHidden: true,
  enableSemeiotics: false,
  semeioticAutoAnnotate: false,
  semeioticLogRawOutputs: true,
  semeioticInfluencesPromiseProfile: false,
  semeioticInspectorVisibleByDefault: false,
  defaultSemeioticLens: "triadic",
};

const GEOMETRY_MODE_VALUES = [
  "quadraticBregman",
  "fisherRao",
  "klRelativeEntropy",
  "mixtureGeometry",
  "alphaEmbedding",
  "lieGroupInvariant",
  "kahlerSignal",
  "customExperimental",
] as const satisfies InformationGeometryMode[];

const IG_VIEW_MODE_VALUES = [
  "localPatch",
  "voronoi",
  "dualCharts",
  "liftedSurface",
  "accumulation",
] as const satisfies InformationGeometryLabViewMode[];

const SCALAR_FIELD_VALUES = [
  "divergence",
  "asymmetry",
  "curvature",
  "projection",
  "promiseConstructive",
  "promiseObstructive",
] as const satisfies InformationGeometryLabScalarField[];

const CHART_KIND_VALUES = ["theta", "eta"] as const satisfies InformationGeometryLabChartKind[];
const BARYCENTER_MODE_VALUES = [
  "activeNeighborhood",
  "selectedVoronoiCell",
  "selectedProposalCluster",
  "selectedCorpusSupportCluster",
  "selectedPersistentBranch",
] as const satisfies InformationGeometryLabBarycenterSourceMode[];
const FLOW_MODE_VALUES = [
  "proposalFlow",
  "repairFlow",
  "obstructionFlow",
] as const satisfies InformationGeometryLabFlowMode[];
const REGRESSION_MODE_VALUES = [
  "fittedCurve",
  "residuals",
  "velocity",
  "convergence",
] as const satisfies InformationGeometryLabRegressionDisplayMode[];
const SEMEIOTIC_LENS_VALUES = [
  "triadic",
  "object",
  "sign_vehicle",
  "interpretant",
] as const satisfies SemeioticLens[];

function clampInteger(value: unknown, fallback: number, minimum: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(minimum, Math.round(parsed));
}

function normalizePath(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeEnumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T) {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}

export function isNodeRuntime() {
  const runtime = globalThis as { process?: { versions?: { node?: string } } };
  return typeof runtime.process?.versions?.node === "string";
}

export function normalizeRuntimeConfig(input: Partial<RuntimeConfig> = {}): RuntimeConfig {
  const legacyInput = input as Partial<RuntimeConfig> & {
    semeioticRuntimeEnabled?: boolean;
  };
  return {
    liveTickWindow: clampInteger(input.liveTickWindow, DEFAULT_RUNTIME_CONFIG.liveTickWindow, 1),
    logDirectory: normalizePath(input.logDirectory, DEFAULT_RUNTIME_CONFIG.logDirectory),
    artifactDirectory: normalizePath(input.artifactDirectory, DEFAULT_RUNTIME_CONFIG.artifactDirectory),
    databasePath: normalizePath(input.databasePath, DEFAULT_RUNTIME_CONFIG.databasePath),
    leanRuntimeMode:
      input.leanRuntimeMode === "mock" || input.leanRuntimeMode === "external"
        ? input.leanRuntimeMode
        : DEFAULT_RUNTIME_CONFIG.leanRuntimeMode,
    leanRuntimeCommand: normalizePath(input.leanRuntimeCommand, DEFAULT_RUNTIME_CONFIG.leanRuntimeCommand),
    persistRawLLM: normalizeBoolean(input.persistRawLLM, DEFAULT_RUNTIME_CONFIG.persistRawLLM),
    persistRawLeanStdout: normalizeBoolean(
      input.persistRawLeanStdout,
      DEFAULT_RUNTIME_CONFIG.persistRawLeanStdout,
    ),
    persistRawLeanStderr: normalizeBoolean(
      input.persistRawLeanStderr,
      DEFAULT_RUNTIME_CONFIG.persistRawLeanStderr,
    ),
    maxProposalsPerFragment: clampInteger(
      input.maxProposalsPerFragment,
      DEFAULT_RUNTIME_CONFIG.maxProposalsPerFragment,
      1,
    ),
    defaultGeometryMode: normalizeEnumValue(
      input.defaultGeometryMode,
      GEOMETRY_MODE_VALUES,
      DEFAULT_RUNTIME_CONFIG.defaultGeometryMode,
    ),
    defaultIGViewMode: normalizeEnumValue(
      input.defaultIGViewMode,
      IG_VIEW_MODE_VALUES,
      DEFAULT_RUNTIME_CONFIG.defaultIGViewMode,
    ),
    defaultScalarField: normalizeEnumValue(
      input.defaultScalarField,
      SCALAR_FIELD_VALUES,
      DEFAULT_RUNTIME_CONFIG.defaultScalarField,
    ),
    defaultChartKind: normalizeEnumValue(
      input.defaultChartKind,
      CHART_KIND_VALUES,
      DEFAULT_RUNTIME_CONFIG.defaultChartKind,
    ),
    defaultBarycenterMode: normalizeEnumValue(
      input.defaultBarycenterMode,
      BARYCENTER_MODE_VALUES,
      DEFAULT_RUNTIME_CONFIG.defaultBarycenterMode,
    ),
    defaultFlowMode: normalizeEnumValue(
      input.defaultFlowMode,
      FLOW_MODE_VALUES,
      DEFAULT_RUNTIME_CONFIG.defaultFlowMode,
    ),
    defaultRegressionMode: normalizeEnumValue(
      input.defaultRegressionMode,
      REGRESSION_MODE_VALUES,
      DEFAULT_RUNTIME_CONFIG.defaultRegressionMode,
    ),
    voronoiGridResolution: clampInteger(
      input.voronoiGridResolution,
      DEFAULT_RUNTIME_CONFIG.voronoiGridResolution,
      8,
    ),
    liftedSurfaceQuality: clampInteger(
      input.liftedSurfaceQuality,
      DEFAULT_RUNTIME_CONFIG.liftedSurfaceQuality,
      1,
    ),
    accumulationTrailLimit: clampInteger(
      input.accumulationTrailLimit,
      DEFAULT_RUNTIME_CONFIG.accumulationTrailLimit,
      1,
    ),
    igLabSnapshotRetention: clampInteger(
      input.igLabSnapshotRetention,
      DEFAULT_RUNTIME_CONFIG.igLabSnapshotRetention,
      1,
    ),
    igLabAccumulateWhileHidden: normalizeBoolean(
      input.igLabAccumulateWhileHidden,
      DEFAULT_RUNTIME_CONFIG.igLabAccumulateWhileHidden,
    ),
    enableSemeiotics: normalizeBoolean(
      input.enableSemeiotics ?? legacyInput.semeioticRuntimeEnabled,
      DEFAULT_RUNTIME_CONFIG.enableSemeiotics,
    ),
    semeioticAutoAnnotate: normalizeBoolean(
      input.semeioticAutoAnnotate,
      DEFAULT_RUNTIME_CONFIG.semeioticAutoAnnotate,
    ),
    semeioticLogRawOutputs: normalizeBoolean(
      input.semeioticLogRawOutputs,
      DEFAULT_RUNTIME_CONFIG.semeioticLogRawOutputs,
    ),
    semeioticInfluencesPromiseProfile: normalizeBoolean(
      input.semeioticInfluencesPromiseProfile,
      DEFAULT_RUNTIME_CONFIG.semeioticInfluencesPromiseProfile,
    ),
    semeioticInspectorVisibleByDefault: normalizeBoolean(
      input.semeioticInspectorVisibleByDefault,
      DEFAULT_RUNTIME_CONFIG.semeioticInspectorVisibleByDefault,
    ),
    defaultSemeioticLens: normalizeEnumValue(
      input.defaultSemeioticLens,
      SEMEIOTIC_LENS_VALUES,
      DEFAULT_RUNTIME_CONFIG.defaultSemeioticLens,
    ),
  };
}

async function resolvePaths(config: RuntimeConfig) {
  const path = await importNodeModule<typeof import("node:path")>("node:path");
  const cwd = process.cwd();
  const configPath = path.resolve(cwd, RUNTIME_CONFIG_PATH);
  const logsPath = path.resolve(cwd, "logs");
  const artifactsPath = path.resolve(cwd, "artifacts");
  const dataPath = path.resolve(cwd, "data");
  const resolvedLogDirectory = path.resolve(cwd, config.logDirectory);
  const resolvedArtifactDirectory = path.resolve(cwd, config.artifactDirectory);
  const resolvedDatabasePath = path.resolve(cwd, config.databasePath);

  return {
    configPath,
    logsPath,
    artifactsPath,
    dataPath,
    resolvedLogDirectory,
    resolvedArtifactDirectory,
    resolvedDatabasePath,
  };
}

export async function ensureRuntimeDirectories(config: RuntimeConfig) {
  if (!isNodeRuntime()) {
    return config;
  }

  const fs = await importNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
  const path = await importNodeModule<typeof import("node:path")>("node:path");
  const paths = await resolvePaths(config);

  await fs.mkdir(path.dirname(paths.configPath), { recursive: true });
  await fs.mkdir(paths.logsPath, { recursive: true });
  await fs.mkdir(paths.artifactsPath, { recursive: true });
  await fs.mkdir(paths.dataPath, { recursive: true });
  await fs.mkdir(paths.resolvedLogDirectory, { recursive: true });
  await fs.mkdir(paths.resolvedArtifactDirectory, { recursive: true });
  await ensureArtifactDirectories(config.artifactDirectory);
  await fs.mkdir(path.dirname(paths.resolvedDatabasePath), { recursive: true });
  await initializeHistorySqlite(config.databasePath);

  return config;
}

export async function loadRuntimeConfigFile() {
  const normalizedDefault = normalizeRuntimeConfig(DEFAULT_RUNTIME_CONFIG);
  if (!isNodeRuntime()) {
    return normalizedDefault;
  }

  const fs = await importNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
  const paths = await resolvePaths(normalizedDefault);

  const path = await importNodeModule<typeof import("node:path")>("node:path");
  await fs.mkdir(path.dirname(paths.configPath), { recursive: true });

  let loaded: Partial<RuntimeConfig> = normalizedDefault;
  try {
    const sourceText = await fs.readFile(paths.configPath, "utf8");
    loaded = JSON.parse(sourceText) as Partial<RuntimeConfig>;
  } catch (error) {
    const errno = error as NodeJS.ErrnoException;
    if (errno.code !== "ENOENT") {
      throw error;
    }
    await fs.writeFile(paths.configPath, `${JSON.stringify(normalizedDefault, null, 2)}\n`, "utf8");
  }

  const normalized = normalizeRuntimeConfig(loaded);
  await ensureRuntimeDirectories(normalized);
  return normalized;
}

export async function saveRuntimeConfigFile(config: RuntimeConfig) {
  const normalized = normalizeRuntimeConfig(config);
  if (!isNodeRuntime()) {
    return normalized;
  }

  const fs = await importNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
  const paths = await resolvePaths(normalized);

  await ensureRuntimeDirectories(normalized);
  await fs.writeFile(paths.configPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");

  return normalized;
}
