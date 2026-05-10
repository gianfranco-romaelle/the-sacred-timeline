import {
  MockChatGptProvider,
  MockClaudeProvider,
  MockLeanVerifierAdapter,
  MockPersonalOpenLlmProvider,
} from "./mock-providers";
import type {
  AdjunctorProvider,
  AdjunctorProviderId,
  AdjunctorProviderRole,
  AdjunctorProviderTask,
  LlmProvider,
  LeanVerifierProvider,
  ProviderRegistry,
  ProviderRouteMatch,
} from "./provider-types";

function rolePreferenceScore(role: AdjunctorProviderRole, task: AdjunctorProviderTask["taskType"]) {
  switch (task) {
    case "generate_local_proposals":
      return role === "proposal_synthesizer" ? 1 : role === "local_mutation_engine" ? 0.95 : 0.2;
    case "critique_proposal":
      return role === "semantic_critic" ? 1 : 0.15;
    case "rewrite_for_formalization":
      return role === "proposal_synthesizer" ? 1 : 0.1;
    case "compress_accepted_structure":
      return role === "proposal_synthesizer" ? 0.85 : role === "semantic_critic" ? 0.8 : 0.1;
    case "suggest_repair_after_failure":
      return role === "proposal_synthesizer" ? 1 : role === "semantic_critic" ? 0.45 : 0.1;
    case "rank_candidates":
      return role === "semantic_critic" ? 1 : role === "proposal_synthesizer" ? 0.72 : role === "local_mutation_engine" ? 0.58 : 0.1;
    case "verify_candidate_against_lean":
      return role === "lean_legality_boundary" ? 1 : 0;
    default:
      return 0;
  }
}

export class InMemoryProviderRegistry implements ProviderRegistry {
  private readonly providersById = new Map<AdjunctorProviderId, AdjunctorProvider>();

  constructor(initialProviders: AdjunctorProvider[] = []) {
    for (const provider of initialProviders) {
      this.register(provider);
    }
  }

  register(provider: AdjunctorProvider) {
    this.providersById.set(provider.id, provider);
    return this;
  }

  list() {
    return Array.from(this.providersById.values());
  }

  get(providerId: AdjunctorProviderId) {
    return this.providersById.get(providerId);
  }

  listByRole(role: AdjunctorProviderRole) {
    return this.list().filter((provider) => provider.role === role);
  }

  resolve(task: AdjunctorProviderTask): ProviderRouteMatch[] {
    const matches = this.list()
      .filter((provider) => provider.supportsTask(task.taskType) && provider.availability.canExecute)
      .filter((provider) => !task.routingHint?.excludedProviderIds?.includes(provider.id))
      .filter((provider) => {
        if (task.routingHint?.preferredProviderIds?.length) {
          return task.routingHint.preferredProviderIds.includes(provider.id);
        }
        return true;
      })
      .filter((provider) => {
        if (task.routingHint?.preferredRoles?.length) {
          return task.routingHint.preferredRoles.includes(provider.role);
        }
        return true;
      })
      .filter((provider) => !task.routingHint?.requireMockSafe || provider.mode === "mock")
      .filter((provider) => !task.routingHint?.requireDeterminism || provider.capabilities.deterministicReplayFriendly)
      .map((provider) => {
        const base = rolePreferenceScore(provider.role, task.taskType);
        const reliabilityWeight = provider.reliability.score * 0.3;
        const availabilityWeight = provider.availability.status === "available" ? 0.1 : 0.04;
        const score = Number((base + reliabilityWeight + availabilityWeight).toFixed(3));
        return {
          providerId: provider.id,
          providerRole: provider.role,
          taskType: task.taskType,
          score,
          rationale: `${provider.displayName} matches ${task.taskType} as ${provider.role}.`,
        } satisfies ProviderRouteMatch;
      })
      .sort((left, right) => right.score - left.score);

    const maxProviders = task.routingHint?.maxProviders;
    return typeof maxProviders === "number" ? matches.slice(0, maxProviders) : matches;
  }

  listLlmProviders(): LlmProvider[] {
    return this.list().filter((provider): provider is LlmProvider => provider.role !== "lean_legality_boundary");
  }

  getLeanVerifier(): LeanVerifierProvider | undefined {
    return this.list().find(
      (provider): provider is LeanVerifierProvider => provider.role === "lean_legality_boundary",
    );
  }
}

export function createDefaultMockProviderRegistry() {
  return new InMemoryProviderRegistry([
    new MockChatGptProvider("mock"),
    new MockClaudeProvider("mock"),
    new MockPersonalOpenLlmProvider("mock"),
    new MockLeanVerifierAdapter("mock"),
  ]);
}

export const defaultMockProviderRegistry = createDefaultMockProviderRegistry();
