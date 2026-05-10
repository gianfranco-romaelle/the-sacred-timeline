import { InMemoryProviderRegistry } from "./provider-registry";
import { credentialsPlaceholderFromLocalSources } from "./local-credential-source";
import {
  ConfigurableChatGptProvider,
  ConfigurableClaudeProvider,
  ConfigurableLeanRunnerProvider,
  ConfigurablePersonalOpenLlmProvider,
  defaultAnthropicRequestShaper,
  defaultAnthropicResponseNormalizer,
  defaultLeanRunnerRequestShaper,
  defaultLeanRunnerResponseNormalizer,
  defaultLocalOpenLlmRequestShaper,
  defaultLocalOpenLlmResponseNormalizer,
  defaultOpenAiRequestShaper,
  defaultOpenAiResponseNormalizer,
} from "./live-providers";
import type { AdjunctorProviderMode } from "./provider-types";

export interface ProviderRuntimeModes {
  chatgpt: AdjunctorProviderMode;
  claude: AdjunctorProviderMode;
  personalOpenLlm: AdjunctorProviderMode;
  lean: AdjunctorProviderMode;
}

export interface ProviderRuntimeFactoryConfig {
  modes?: Partial<ProviderRuntimeModes>;
}

export function createProviderRegistryFromRuntime(config: ProviderRuntimeFactoryConfig = {}) {
  const modes: ProviderRuntimeModes = {
    chatgpt: config.modes?.chatgpt ?? "mock",
    claude: config.modes?.claude ?? "mock",
    personalOpenLlm: config.modes?.personalOpenLlm ?? "mock",
    lean: config.modes?.lean ?? "mock",
  };

  return new InMemoryProviderRegistry([
    new ConfigurableChatGptProvider({
      mode: modes.chatgpt,
      endpointLabel: "OpenAI Responses API",
      credentials: credentialsPlaceholderFromLocalSources("OPENAI_API_KEY", "env-var", ["OPENAI_API_KEY"]),
      requestShaper: defaultOpenAiRequestShaper,
      responseNormalizer: defaultOpenAiResponseNormalizer,
    }),
    new ConfigurableClaudeProvider({
      mode: modes.claude,
      endpointLabel: "Anthropic Messages API",
      credentials: credentialsPlaceholderFromLocalSources("ANTHROPIC_API_KEY", "env-var", ["ANTHROPIC_API_KEY"]),
      requestShaper: defaultAnthropicRequestShaper,
      responseNormalizer: defaultAnthropicResponseNormalizer,
    }),
    new ConfigurablePersonalOpenLlmProvider({
      mode: modes.personalOpenLlm,
      endpointLabel: "Local LLM endpoint",
      credentials: credentialsPlaceholderFromLocalSources(
        "LOCAL_LLM_ENDPOINT",
        "local-endpoint",
        ["LOCAL_LLM_ENDPOINT"],
      ),
      requestShaper: defaultLocalOpenLlmRequestShaper,
      responseNormalizer: defaultLocalOpenLlmResponseNormalizer,
    }),
    new ConfigurableLeanRunnerProvider({
      mode: modes.lean,
      endpointLabel: "Lean runner",
      credentials: credentialsPlaceholderFromLocalSources("LEAN_RUNNER_PATH", "local-process", ["LEAN_RUNNER_PATH"]),
      requestShaper: defaultLeanRunnerRequestShaper,
      responseNormalizer: defaultLeanRunnerResponseNormalizer,
    }),
  ]);
}

export const defaultLiveReadyProviderRegistry = createProviderRegistryFromRuntime();
