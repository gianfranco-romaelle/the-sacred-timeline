import {
  computeBregmanDivergence,
  resolveStatisticalEmbeddingState,
  type ConvexPotential,
  type StatisticalPoint,
  defaultConvexPotential,
} from "../information-geometry";

export interface PromptCoordinateChartCandidate {
  id: string;
  prompt: string;
}

export interface PromptCoordinateChart {
  id: string;
  prompt: string;
  representation: StatisticalPoint;
  divergence: number;
}

export interface PromptChartSelection {
  selected: PromptCoordinateChart;
  charts: PromptCoordinateChart[];
}

export interface PromptVariantSelection {
  selected: PromptCoordinateChart;
  charts: PromptCoordinateChart[];
  variants: Array<{
    id: string;
    prompt: string;
    chartDivergence: number;
  }>;
}

export function representPromptAsChart(
  prompt: string,
  dimension?: number,
): StatisticalPoint {
  const embedding = resolveStatisticalEmbeddingState({
    key: `prompt-chart:${prompt}`,
    dimension,
  });

  return {
    theta: embedding.theta,
    eta: embedding.eta,
  };
}

export function selectPromptCoordinateChart(
  candidates: PromptCoordinateChartCandidate[],
  target: StatisticalPoint,
  psi: ConvexPotential = defaultConvexPotential,
): PromptChartSelection {
  if (candidates.length === 0) {
    throw new Error("Prompt chart selection requires at least one candidate prompt.");
  }

  const charts = candidates
    .map((candidate) => {
      const representation = representPromptAsChart(candidate.prompt, target.theta.length);
      return {
        id: candidate.id,
        prompt: candidate.prompt,
        representation,
        divergence: computeBregmanDivergence(representation, target, psi),
      } satisfies PromptCoordinateChart;
    })
    .sort((left, right) => left.divergence - right.divergence);

  return {
    selected: charts[0],
    charts,
  };
}

export function buildPromptVariantSelection(
  candidates: PromptCoordinateChartCandidate[],
  target: StatisticalPoint,
  psi: ConvexPotential = defaultConvexPotential,
): PromptVariantSelection {
  const selection = selectPromptCoordinateChart(candidates, target, psi);
  return {
    ...selection,
    variants: selection.charts.map((chart) => ({
      id: chart.id,
      prompt: chart.prompt,
      chartDivergence: chart.divergence,
    })),
  };
}
