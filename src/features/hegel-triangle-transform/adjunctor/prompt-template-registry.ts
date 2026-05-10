import type { StatisticalPoint } from "../information-geometry";
import type { AdjunctorProviderId } from "./provider-types";
import type { PromptCoordinateChartCandidate } from "./prompt-coordinate-charts";
import { buildPromptVariantSelection } from "./prompt-coordinate-charts";

export type PromptTemplateScope =
  | "localMutation"
  | "formalization"
  | "critique"
  | "leanVerification"
  | "semeioticAnnotation"
  | "semeioticRefinement"
  | "semeioticMismatchAnalysis"
  | "semeioticSummary";

export type PromptTemplateProviderTarget = AdjunctorProviderId | "default";
export type PromptTemplateImplementationStatus = "active" | "placeholder";

export interface PromptTemplateDefinition {
  id: string;
  scope: PromptTemplateScope;
  label: string;
  description: string;
  providerTarget: PromptTemplateProviderTarget;
  modelHint?: string;
  prompt: string;
  canonicalOntologyLocked: boolean;
  status: PromptTemplateImplementationStatus;
}

const SEMEIOTIC_CANONICAL_ONTOLOGY_BLOCK = [
  "Preserve canonical ontology terms exactly.",
  "OBJECT: firstness -> icon; secondness -> index; thirdness -> symbol.",
  "SIGN: firstness -> qualisign; secondness -> sinsign; thirdness -> legisign.",
  "INTERPRETANT: firstness -> rheme; secondness -> dicent; thirdness -> delome.",
  'Normalize "argument" to "delome" and treat "argument" only as an alias.',
].join(" ");

const DEFAULT_PROMPT_TEMPLATES: PromptTemplateDefinition[] = [
  {
    id: "local-mutation-seam-explorer",
    scope: "localMutation",
    label: "Seam Explorer",
    description: "Enumerate cheap local moves around exposed seams and anchors.",
    providerTarget: "personal-open-llm",
    prompt: "Enumerate cheap local moves around exposed seams and inherited anchors.",
    canonicalOntologyLocked: false,
    status: "active",
  },
  {
    id: "local-mutation-neighborhood-perturbation",
    scope: "localMutation",
    label: "Neighborhood Perturbation",
    description: "Generate narrow bridge, obstruction, and refinement mutations.",
    providerTarget: "personal-open-llm",
    prompt: "Mutate the neighborhood by proposing many narrow bridge, obstruction, and refinement steps.",
    canonicalOntologyLocked: false,
    status: "active",
  },
  {
    id: "local-mutation-embedding-surfacer",
    scope: "localMutation",
    label: "Embedding Surfacer",
    description: "Surface latent neighborhood relations as cheap mutations.",
    providerTarget: "personal-open-llm",
    prompt: "Surface latent proprietary neighborhood relations as low-cost candidate mutations.",
    canonicalOntologyLocked: false,
    status: "active",
  },
  {
    id: "formalization-minimal-lean-bridge",
    scope: "formalization",
    label: "Minimal Lean Bridge",
    description: "Rewrite candidate moves into crisp Lean-facing statements.",
    providerTarget: "chatgpt",
    prompt: "Rewrite candidate moves into mathematically crisp statements with explicit Lean-facing structure.",
    canonicalOntologyLocked: false,
    status: "active",
  },
  {
    id: "formalization-hessian-compatibility",
    scope: "formalization",
    label: "Compatibility Tightening",
    description: "Preserve intent while tightening assumptions and interfaces.",
    providerTarget: "chatgpt",
    prompt: "Preserve local semantic intent while tightening formal assumptions and interface compatibility.",
    canonicalOntologyLocked: false,
    status: "active",
  },
  {
    id: "formalization-adjunction-normal-form",
    scope: "formalization",
    label: "Adjunction Normal Form",
    description: "Normalize candidates into theorem/definition objects.",
    providerTarget: "chatgpt",
    prompt: "Normalize candidate adjunction-like claims into theorem or definition objects suitable for verification.",
    canonicalOntologyLocked: false,
    status: "active",
  },
  {
    id: "critique-ambiguity-scan",
    scope: "critique",
    label: "Ambiguity Scan",
    description: "Interrogate ambiguity, hidden assumptions, and drift.",
    providerTarget: "claude",
    prompt: "Interrogate ambiguity, hidden assumptions, and conceptual drift in candidate formal proposals.",
    canonicalOntologyLocked: false,
    status: "active",
  },
  {
    id: "critique-vacuity-pressure",
    scope: "critique",
    label: "Vacuity Pressure",
    description: "Stress-test whether candidates collapse into vacuity.",
    providerTarget: "claude",
    prompt: "Stress-test whether the candidates collapse into vacuous or merely restated boundary conditions.",
    canonicalOntologyLocked: false,
    status: "active",
  },
  {
    id: "critique-contrastive-expansion",
    scope: "critique",
    label: "Contrastive Expansion",
    description: "Use contrasts to reveal overscope or weakness.",
    providerTarget: "claude",
    prompt: "Provide contrastive alternatives that reveal whether the semantic claim is too broad or too weak.",
    canonicalOntologyLocked: false,
    status: "active",
  },
  {
    id: "lean-projection-check",
    scope: "leanVerification",
    label: "Projection Check",
    description: "Project toward the constraint manifold and report legality.",
    providerTarget: "lean-verifier",
    prompt: "Project the candidate toward the constraint submanifold and report legality, redundancy, or obstruction.",
    canonicalOntologyLocked: false,
    status: "active",
  },
  {
    id: "lean-constraint-boundary",
    scope: "leanVerification",
    label: "Constraint Boundary",
    description: "Check interface constraints and proof boundary compatibility.",
    providerTarget: "lean-verifier",
    prompt: "Check whether the candidate satisfies the local interface constraints and admissible proof boundary.",
    canonicalOntologyLocked: false,
    status: "active",
  },
  {
    id: "lean-diagnostic-surface",
    scope: "leanVerification",
    label: "Diagnostic Surface",
    description: "Emit repair-relevant rejection surfaces and diagnostics.",
    providerTarget: "lean-verifier",
    prompt: "Emit structured rejection surfaces and repair-relevant diagnostics for the candidate artifact.",
    canonicalOntologyLocked: false,
    status: "active",
  },
  {
    id: "semeiotic-annotation-chatgpt",
    scope: "semeioticAnnotation",
    label: "Semeiotic Annotation",
    description: "Annotate proposals or moves using the canonical triadic ontology.",
    providerTarget: "chatgpt",
    modelHint: "formal-synthesizer",
    prompt:
      "Produce a semeiotic annotation pass over the input using the canonical triadic ontology. " +
      SEMEIOTIC_CANONICAL_ONTOLOGY_BLOCK,
    canonicalOntologyLocked: true,
    status: "active",
  },
  {
    id: "semeiotic-refinement-claude",
    scope: "semeioticRefinement",
    label: "Semeiotic Refinement",
    description: "Refine a provisional semeiotic reading while preserving ontology names.",
    providerTarget: "claude",
    modelHint: "semantic-critic",
    prompt:
      "Perform a semeiotic refinement pass. Preserve canonical ontology names exactly, tighten ambiguous assignments, and note where assignments remain weak. " +
      SEMEIOTIC_CANONICAL_ONTOLOGY_BLOCK,
    canonicalOntologyLocked: true,
    status: "active",
  },
  {
    id: "semeiotic-mismatch-claude",
    scope: "semeioticMismatchAnalysis",
    label: "Semeiotic Mismatch Analysis",
    description: "Analyze contradiction, mismatch, and ontology drift.",
    providerTarget: "claude",
    modelHint: "semantic-critic",
    prompt:
      "Analyze semeiotic contradiction and mismatch. Identify ontology drift, alias resolution, valence conflict, and contact gaps without renaming canonical terms. " +
      SEMEIOTIC_CANONICAL_ONTOLOGY_BLOCK,
    canonicalOntologyLocked: true,
    status: "active",
  },
  {
    id: "semeiotic-summary-chatgpt",
    scope: "semeioticSummary",
    label: "Semeiotic Summary",
    description: "Generate compact inspector/tree-ready semeiotic summaries.",
    providerTarget: "chatgpt",
    modelHint: "formal-synthesizer",
    prompt:
      "Generate a compact semeiotic summary for inspector/tree display. Use the canonical terms exactly and prefer short, dense summaries over prose. " +
      SEMEIOTIC_CANONICAL_ONTOLOGY_BLOCK,
    canonicalOntologyLocked: true,
    status: "active",
  },
];

const templateRegistry = new Map<string, PromptTemplateDefinition>(
  DEFAULT_PROMPT_TEMPLATES.map((template) => [template.id, template]),
);

export function registerPromptTemplate(template: PromptTemplateDefinition) {
  templateRegistry.set(template.id, template);
}

export function getPromptTemplate(templateId: string) {
  return templateRegistry.get(templateId);
}

export function listPromptTemplates(scope?: PromptTemplateScope, providerTarget?: PromptTemplateProviderTarget) {
  return [...templateRegistry.values()]
    .filter((template) => (scope ? template.scope === scope : true))
    .filter((template) => (providerTarget ? template.providerTarget === providerTarget : true))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function resolvePromptTemplateCandidates(
  scope: PromptTemplateScope,
  providerId?: AdjunctorProviderId,
): PromptCoordinateChartCandidate[] {
  const templates = listPromptTemplates(scope).filter(
    (template) => template.providerTarget === "default" || template.providerTarget === providerId,
  );

  const providerSpecific = templates.filter((template) => template.providerTarget === providerId);
  const selected = providerSpecific.length > 0 ? providerSpecific : templates.filter((template) => template.providerTarget === "default");
  const fallback = selected.length > 0 ? selected : templates;

  return fallback.map((template) => ({
    id: template.id,
    prompt: template.prompt,
  }));
}

export function buildRegistryPromptVariantSelection(
  scope: PromptTemplateScope,
  target: StatisticalPoint,
  providerId?: AdjunctorProviderId,
) {
  const candidates = resolvePromptTemplateCandidates(scope, providerId);
  return buildPromptVariantSelection(candidates, target);
}

