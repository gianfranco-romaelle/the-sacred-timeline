import {
  computeBregman,
  type StatisticalPoint,
} from "@/features/hegel-triangle-transform/information-geometry";
import type {
  InformationGeometryLabChartKind,
  InformationGeometryMode,
} from "@/types/hegel-triangle";
import type {
  GeometryBarycenterInput,
  GeometryBarycenterResult,
  GeometryChartProjectionInput,
  GeometryDivergenceInput,
  GeometryFlowDirectionInput,
  GeometryFlowDirectionResult,
  GeometryModeDefinition,
  GeometryRegressionFitInput,
  GeometryRegressionFitResult,
} from "./geometryModes";

function roundMetric(value: number) {
  return Number(value.toFixed(6));
}

function chartCoordinates(chartKind: InformationGeometryLabChartKind, theta: number[], eta: number[]) {
  return chartKind === "eta" ? eta : theta;
}

function quadraticPotential(theta: number[]) {
  return theta.reduce((sum, value) => sum + 0.5 * value * value, 0);
}

function meanVector(vectors: number[][], weights?: number[]) {
  if (vectors.length === 0) {
    return [];
  }

  const normalizedWeights =
    weights && weights.length === vectors.length
      ? (() => {
          const total = weights.reduce((sum, value) => sum + value, 0);
          if (Math.abs(total) <= Number.EPSILON) {
            return Array.from({ length: weights.length }, () => 1 / weights.length);
          }
          return weights.map((value) => value / total);
        })()
      : Array.from({ length: vectors.length }, () => 1 / vectors.length);

  return Array.from({ length: vectors[0].length }, (_, index) =>
    roundMetric(
      vectors.reduce((sum, vector, vectorIndex) => sum + (vector[index] ?? 0) * normalizedWeights[vectorIndex], 0),
    ),
  );
}

function squaredDistance(left: number[], right: number[]) {
  const length = Math.max(left.length, right.length);
  let total = 0;
  for (let index = 0; index < length; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    total += delta * delta;
  }
  return total;
}

function quadraticBarycenter(input: GeometryBarycenterInput): GeometryBarycenterResult {
  const theta = meanVector(
    input.points.map((point) => point.theta),
    input.weights,
  );
  const eta = meanVector(
    input.points.map((point) => point.eta),
    input.weights,
  );

  return {
    point: { theta, eta },
    iterations: 1,
    method: "weighted-euclidean-mean",
  };
}

function quadraticFlowDirection(input: GeometryFlowDirectionInput): GeometryFlowDirectionResult {
  const stepSize = input.stepSize ?? 1;
  const targetTheta = input.target?.theta ?? input.gradient ?? input.point.theta.map(() => 0);
  const targetEta = input.target?.eta ?? input.gradient ?? input.point.eta.map(() => 0);

  const thetaDirection = input.point.theta.map((value, index) =>
    roundMetric(((targetTheta[index] ?? 0) - value) * stepSize),
  );
  const etaDirection = input.point.eta.map((value, index) =>
    roundMetric(((targetEta[index] ?? 0) - value) * stepSize),
  );

  return {
    thetaDirection,
    etaDirection,
    method: input.target ? "target-seeking-euclidean-flow" : "gradient-following-surrogate",
  };
}

function quadraticRegressionFit(input: GeometryRegressionFitInput): GeometryRegressionFitResult {
  if (input.samples.length === 0) {
    return {
      fitted: [],
      residual: 0,
      score: 1,
      method: "empty-fit",
    };
  }

  if (input.samples.length === 1) {
    return {
      fitted: [...input.samples],
      residual: 0,
      score: 1,
      method: "singleton-fit",
    };
  }

  const ordered = [...input.samples].sort((left, right) => left.t - right.t);
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const duration = Math.max(Number.EPSILON, last.t - first.t);

  const fitted = ordered.map((sample) => {
    const alpha = (sample.t - first.t) / duration;
    const theta = first.point.theta.map((value, index) =>
      roundMetric(value + ((last.point.theta[index] ?? value) - value) * alpha),
    );
    const eta = first.point.eta.map((value, index) =>
      roundMetric(value + ((last.point.eta[index] ?? value) - value) * alpha),
    );
    return {
      t: sample.t,
      point: { theta, eta },
    };
  });

  const residual = roundMetric(
    fitted.reduce(
      (sum, sample, index) =>
        sum +
        squaredDistance(sample.point.theta, ordered[index].point.theta) +
        squaredDistance(sample.point.eta, ordered[index].point.eta),
      0,
    ) / fitted.length,
  );

  return {
    fitted,
    residual,
    score: roundMetric(1 / (1 + residual)),
    method: "linear-chart-regression-surrogate",
  };
}

function placeholderBarycenter(label: string, input: GeometryBarycenterInput): GeometryBarycenterResult {
  const result = quadraticBarycenter(input);
  return {
    ...result,
    method: `${label}-surrogate`,
  };
}

function placeholderFlowDirection(label: string, input: GeometryFlowDirectionInput): GeometryFlowDirectionResult {
  const result = quadraticFlowDirection(input);
  return {
    ...result,
    method: `${label}-surrogate`,
  };
}

function placeholderRegressionFit(label: string, input: GeometryRegressionFitInput): GeometryRegressionFitResult {
  const result = quadraticRegressionFit(input);
  return {
    ...result,
    method: `${label}-surrogate`,
  };
}

function approximateDivergence(input: GeometryDivergenceInput) {
  return computeBregman(input.p, input.q);
}

function approximateProjection(
  input: GeometryChartProjectionInput,
  mode: InformationGeometryMode,
) {
  switch (mode) {
    case "quadraticBregman":
      return chartCoordinates(input.chartKind, input.theta, input.eta);
    case "mixtureGeometry":
      return chartCoordinates(input.chartKind, input.eta, input.theta);
    case "alphaEmbedding":
      return chartCoordinates(
        input.chartKind,
        input.theta.map((value, index) => roundMetric(0.5 * value + 0.5 * (input.eta[index] ?? 0))),
        input.eta.map((value, index) => roundMetric(0.5 * value + 0.5 * (input.theta[index] ?? 0))),
      );
    case "klRelativeEntropy":
    case "fisherRao":
    case "lieGroupInvariant":
    case "kahlerSignal":
    case "customExperimental":
    default:
      return chartCoordinates(input.chartKind, input.theta, input.eta);
  }
}

function definePlaceholderMode(
  id: Exclude<InformationGeometryMode, "quadraticBregman">,
  label: string,
  description: string,
  divergenceKinds: GeometryModeDefinition["divergenceKinds"],
  coordinateKinds: GeometryModeDefinition["coordinateKinds"] = ["theta", "eta", "lifted"],
): GeometryModeDefinition {
  return {
    id,
    label,
    description,
    coordinateKinds,
    divergenceKinds,
    barycenterSupport: "surrogate",
    flowSupport: "surrogate",
    regressionSupport: "surrogate",
    implementationStatus: "scaffold",
    hooks: {
      computeDivergence(input) {
        return approximateDivergence(input);
      },
      computeChartProjection(input) {
        return approximateProjection(input, id);
      },
      computeBarycenter(input) {
        return placeholderBarycenter(id, input);
      },
      computeFlowDirection(input) {
        return placeholderFlowDirection(id, input);
      },
      computeRegressionFit(input) {
        return placeholderRegressionFit(id, input);
      },
    },
  };
}

const quadraticBregmanMode: GeometryModeDefinition = {
  id: "quadraticBregman",
  label: "Quadratic Bregman",
  description: "Euclidean quadratic-potential geometry with working divergence, chart, barycenter, flow, and regression hooks.",
  coordinateKinds: ["theta", "eta", "lifted"],
  divergenceKinds: ["quadraticBregman"],
  barycenterSupport: "native",
  flowSupport: "native",
  regressionSupport: "native",
  implementationStatus: "working",
  hooks: {
    computeDivergence(input) {
      return computeBregman(input.p, input.q);
    },
    computeChartProjection(input) {
      return chartCoordinates(input.chartKind, input.theta, input.eta);
    },
    computeBarycenter(input) {
      return quadraticBarycenter(input);
    },
    computeFlowDirection(input) {
      return quadraticFlowDirection(input);
    },
    computeRegressionFit(input) {
      return quadraticRegressionFit(input);
    },
  },
};

const GEOMETRY_MODE_DEFINITIONS: GeometryModeDefinition[] = [
  quadraticBregmanMode,
  definePlaceholderMode(
    "fisherRao",
    "Fisher-Rao",
    "Statistical manifold metric geometry scaffolded through the quadratic surrogate until the Fisher metric layer is connected.",
    ["fisherRao"],
  ),
  definePlaceholderMode(
    "klRelativeEntropy",
    "KL Relative Entropy",
    "Relative-entropy divergence regime scaffolded through the quadratic surrogate while KL-specific coordinates are pending.",
    ["klRelativeEntropy"],
  ),
  definePlaceholderMode(
    "mixtureGeometry",
    "Mixture Geometry",
    "Mixture-coordinate chart regime scaffolded with eta-priority projections and quadratic divergence fallback.",
    ["mixtureGeometry"],
  ),
  definePlaceholderMode(
    "alphaEmbedding",
    "Alpha Embedding",
    "Alpha-family embedding scaffolded with blended theta/eta projections and quadratic divergence fallback.",
    ["alphaEmbedding"],
  ),
  definePlaceholderMode(
    "lieGroupInvariant",
    "Lie Group Invariant",
    "Invariant chart scaffold routed through quadratic approximations until group-aware transports are added.",
    ["lieGroupInvariant"],
  ),
  definePlaceholderMode(
    "kahlerSignal",
    "Kahler Signal",
    "Complex-signal/Kahler-inspired scaffold using quadratic projections until symplectic and potential hooks are implemented.",
    ["kahlerSignal"],
  ),
  definePlaceholderMode(
    "customExperimental",
    "Custom Experimental",
    "Reserved experimental atlas slot with stable quadratic fallback behavior.",
    ["customExperimental"],
  ),
];

const GEOMETRY_MODE_BY_ID = new Map<InformationGeometryMode, GeometryModeDefinition>(
  GEOMETRY_MODE_DEFINITIONS.map((definition) => [definition.id, definition]),
);

export function listGeometryModes() {
  return GEOMETRY_MODE_DEFINITIONS;
}

export function getGeometryModeDefinition(mode: InformationGeometryMode) {
  return GEOMETRY_MODE_BY_ID.get(mode) ?? quadraticBregmanMode;
}

export function getGeometryModeLabel(mode: InformationGeometryMode) {
  return getGeometryModeDefinition(mode).label;
}

export function geometryModeAvailability(mode: InformationGeometryMode) {
  return getGeometryModeDefinition(mode).implementationStatus;
}

export function computeGeometryModeLiftedHeight(mode: InformationGeometryMode, point: StatisticalPoint) {
  switch (mode) {
    case "quadraticBregman":
      return quadraticPotential(point.theta);
    case "mixtureGeometry":
      return quadraticPotential(point.eta);
    case "alphaEmbedding":
      return quadraticPotential(
        point.theta.map((value, index) => roundMetric(0.5 * value + 0.5 * (point.eta[index] ?? 0))),
      );
    case "fisherRao":
    case "klRelativeEntropy":
    case "lieGroupInvariant":
    case "kahlerSignal":
    case "customExperimental":
    default:
      return quadraticPotential(point.theta);
  }
}
