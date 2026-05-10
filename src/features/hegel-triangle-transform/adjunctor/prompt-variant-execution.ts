import { computeBregmanDivergence, type StatisticalPoint } from "../information-geometry";
import type {
  AdjunctorProviderResult,
  AdjunctorProviderTask,
  CandidateProposalArtifact,
  CritiqueProposalResult,
  FragmentNeighborhoodSnapshot,
  GenerateLocalProposalsResult,
  PromptSelectionSummary,
  PromptVariantDescriptor,
  ProviderRegistry,
  ProviderRouteMatch,
  RewriteForFormalizationResult,
  VerifyCandidateAgainstLeanResult,
} from "./provider-types";

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === "object" && value !== null && typeof (value as PromiseLike<unknown>).then === "function";
}

function resolveProviderOrThrow(registry: ProviderRegistry, task: AdjunctorProviderTask) {
  const match = registry.resolve(task)[0];
  if (!match) {
    throw new Error(`No provider available for task ${task.taskType}.`);
  }

  const provider = registry.get(match.providerId);
  if (!provider) {
    throw new Error(`Resolved provider ${match.providerId} is not registered.`);
  }

  return { provider, match };
}

function executeTaskSync<TResult extends AdjunctorProviderResult>(
  registry: ProviderRegistry,
  task: AdjunctorProviderTask,
): { result: TResult; match: ProviderRouteMatch } {
  const { provider, match } = resolveProviderOrThrow(registry, task);
  const result = provider.execute(task as never);
  if (isPromiseLike(result)) {
    throw new Error(
      `Provider ${provider.id} returned an async result for ${task.taskType}. Prompt-variant execution currently supports synchronous mock execution only.`,
    );
  }

  return {
    result: result as TResult,
    match,
  };
}

function taskTargetPoint(task: AdjunctorProviderTask): StatisticalPoint | undefined {
  switch (task.taskType) {
    case "generate_local_proposals":
    case "critique_proposal":
      return task.input.neighborhood;
    case "rewrite_for_formalization":
      return task.input.candidate;
    case "verify_candidate_against_lean":
      return task.input.request.candidate;
    default:
      return undefined;
  }
}

function meanCandidateDivergence(
  candidates: CandidateProposalArtifact[],
  target: StatisticalPoint,
) {
  if (candidates.length === 0) {
    return 0;
  }

  return (
    candidates.reduce(
      (sum, candidate) => sum + computeBregmanDivergence(candidate, target),
      0,
    ) / candidates.length
  );
}

function resultOutputDivergence(
  task: AdjunctorProviderTask,
  result: AdjunctorProviderResult,
  target: StatisticalPoint,
) {
  switch (task.taskType) {
    case "generate_local_proposals":
      return meanCandidateDivergence(
        (result as GenerateLocalProposalsResult).payload.candidates,
        target,
      );
    case "rewrite_for_formalization":
      return computeBregmanDivergence(result as RewriteForFormalizationResult, target);
    case "critique_proposal":
      return computeBregmanDivergence(result as CritiqueProposalResult, target);
    case "verify_candidate_against_lean":
      return computeBregmanDivergence(result as VerifyCandidateAgainstLeanResult, target);
    default:
      return computeBregmanDivergence(result as StatisticalPoint, target);
  }
}

function promptVariantsForTask(task: AdjunctorProviderTask) {
  switch (task.taskType) {
    case "generate_local_proposals":
    case "rewrite_for_formalization":
    case "critique_proposal":
    case "verify_candidate_against_lean":
      return task.input.providerPayload?.promptVariants ?? [];
    default:
      return [];
  }
}

function withPromptVariant<TTask extends AdjunctorProviderTask>(
  task: TTask,
  variant: PromptVariantDescriptor,
  index: number,
): TTask {
  const variantTaskId = `${task.taskId}_prompt_${variant.id}_${index}` as TTask["taskId"];

  switch (task.taskType) {
    case "generate_local_proposals":
    case "rewrite_for_formalization":
    case "critique_proposal":
    case "verify_candidate_against_lean":
      return {
        ...task,
        taskId: variantTaskId,
        input: {
          ...task.input,
          providerPayload: task.input.providerPayload
            ? {
                ...task.input.providerPayload,
                selectedChartId: variant.id,
                selectedPrompt: variant.prompt,
                chartDivergence: variant.chartDivergence,
              }
            : task.input.providerPayload,
        },
      } as TTask;
    default:
      return task;
  }
}

export function executePromptVariantTaskSync<TResult extends AdjunctorProviderResult>(
  registry: ProviderRegistry,
  task: AdjunctorProviderTask,
): { result: TResult; match: ProviderRouteMatch; promptSelection?: PromptSelectionSummary } {
  const promptVariants = promptVariantsForTask(task);
  const target = taskTargetPoint(task);

  if (promptVariants.length <= 1 || !target) {
    const execution = executeTaskSync<TResult>(registry, task);
    const selectedPrompt = promptVariants[0];
    const outputDivergence = resultOutputDivergence(task, execution.result, target ?? execution.result);
    return {
      ...execution,
      promptSelection:
        selectedPrompt || promptVariants.length > 0
          ? {
              bestPromptId: selectedPrompt?.id,
              bestPrompt: selectedPrompt?.prompt,
              bestInputDivergence: selectedPrompt?.chartDivergence,
              bestOutputDivergence: outputDivergence,
              promptVariants,
              promptScores: promptVariants.map((variant) => ({
                id: variant.id,
                prompt: variant.prompt,
                inputDivergence: variant.chartDivergence,
                outputDivergence,
              })),
            }
          : undefined,
    };
  }

  const executions = promptVariants.map((variant, index) => {
    const variantTask = withPromptVariant(task, variant, index);
    const execution = executeTaskSync<TResult>(registry, variantTask);
    return {
      ...execution,
      variant,
      outputDivergence: resultOutputDivergence(variantTask, execution.result, target),
    };
  });

  const best = [...executions].sort((left, right) => left.outputDivergence - right.outputDivergence)[0];

  return {
    result: best.result,
    match: best.match,
    promptSelection: {
      bestPromptId: best.variant.id,
      bestPrompt: best.variant.prompt,
      bestInputDivergence: best.variant.chartDivergence,
      bestOutputDivergence: best.outputDivergence,
      promptVariants,
      promptScores: executions.map((execution) => ({
        id: execution.variant.id,
        prompt: execution.variant.prompt,
        inputDivergence: execution.variant.chartDivergence,
        outputDivergence: execution.outputDivergence,
      })),
    },
  };
}
