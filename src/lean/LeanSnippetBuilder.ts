import type { LeanSnippet, LeanTask } from "./types";

function sanitizeName(value: string) {
  const normalized = value.replace(/[^a-zA-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized.length > 0 ? normalized : "lean_task";
}

function formatVector(values: number[]) {
  return `[${values.map((value) => Number(value.toFixed(6))).join(", ")}]`;
}

export function buildNegAdjunctionSnippet(task: LeanTask): string {
  const sourceVector = formatVector(task.sourceVectors.source);
  const targetVector = formatVector(task.sourceVectors.target);
  const repairedVector = formatVector(task.sourceVectors.repaired ?? task.sourceVectors.target);
  const projectionValue = Number(task.projectionValue.toFixed(6));

  return `import WebsiteToposIG.WebsiteToposIG
open WebsiteToposIG

def sourceFragmentId : String := "${task.fragmentId}"
def proposalId : String := "${task.proposalId}"
def theoremKind : String := "${task.theoremKind}"

def p : Vec := ${sourceVector}
def q : Vec := ${targetVector}
def repaired : Vec := ${repairedVector}

def negAdjField : NegAdjunctionField :=
  computeNegAdjunction quadraticPotential p q ${projectionValue}

#eval s!"NEGADJ forward={negAdjField.forward} reverse={negAdjField.reverse} asymmetry={negAdjField.asymmetry} total={negAdjField.total} projection={negAdjField.projection}"
#eval s!"PHASE {phaseTag negAdjField}"
#eval s!"FRAGMENT ${task.fragmentId}"
#eval s!"PROPOSAL ${task.proposalId}"
#eval s!"THEOREM_KIND ${task.theoremKind}"
`;
}

export function buildQuadraticNonnegativitySnippet(task: LeanTask): string {
  const sourceVector = formatVector(task.sourceVectors.source);
  const targetVector = formatVector(task.sourceVectors.target);
  const repairedVector = formatVector(task.sourceVectors.repaired ?? task.sourceVectors.target);
  const projectionValue = Number(task.projectionValue.toFixed(6));

  return `import WebsiteToposIG.WebsiteToposIG
open WebsiteToposIG

def sourceFragmentId : String := "${task.fragmentId}"
def proposalId : String := "${task.proposalId}"
def theoremKind : String := "${task.theoremKind}"

def p : Vec := ${sourceVector}
def q : Vec := ${targetVector}
def repaired : Vec := ${repairedVector}

def negAdjField : NegAdjunctionField :=
  computeNegAdjunction quadraticPotential p q ${projectionValue}

theorem quadraticNonnegativityWitness : 0.0 <= quadraticBregman p q := by
  simpa [quadraticBregman, projectionResidual] using quadratic_projection_nonnegative p q

#check quadraticNonnegativityWitness
#eval s!"THEOREM_CHECK quadratic_nonnegativity_check passed"
#eval s!"NEGADJ forward={negAdjField.forward} reverse={negAdjField.reverse} asymmetry={negAdjField.asymmetry} total={negAdjField.total} projection={negAdjField.projection}"
#eval s!"PHASE {phaseTag negAdjField}"
#eval s!"FRAGMENT ${task.fragmentId}"
#eval s!"PROPOSAL ${task.proposalId}"
#eval s!"THEOREM_KIND ${task.theoremKind}"
`;
}

export function buildProjectionSkeletonSnippet(task: LeanTask): string {
  const sourceVector = formatVector(task.sourceVectors.source);
  const targetVector = formatVector(task.sourceVectors.target);
  const repairedVector = formatVector(task.sourceVectors.repaired ?? task.sourceVectors.target);
  const projectionValue = Number(task.projectionValue.toFixed(6));

  return `import WebsiteToposIG.WebsiteToposIG
open WebsiteToposIG

def sourceFragmentId : String := "${task.fragmentId}"
def proposalId : String := "${task.proposalId}"
def theoremKind : String := "${task.theoremKind}"

def p : Vec := ${sourceVector}
def q : Vec := ${targetVector}
def repaired : Vec := ${repairedVector}

def negAdjField : NegAdjunctionField :=
  computeNegAdjunction quadraticPotential p q ${projectionValue}

theorem projectionSkeletonWitness :
    projectionResidual quadraticPotential p repaired =
      projectionResidual quadraticPotential p q + bregman quadraticPotential q repaired := by
  simpa using pythagorean_projection_skeleton quadraticPotential p q repaired

#check projectionSkeletonWitness
#eval s!"THEOREM_CHECK projection_skeleton_check passed"
#eval s!"NEGADJ forward={negAdjField.forward} reverse={negAdjField.reverse} asymmetry={negAdjField.asymmetry} total={negAdjField.total} projection={negAdjField.projection}"
#eval s!"PHASE {phaseTag negAdjField}"
#eval s!"FRAGMENT ${task.fragmentId}"
#eval s!"PROPOSAL ${task.proposalId}"
#eval s!"THEOREM_KIND ${task.theoremKind}"
`;
}

export class LeanSnippetBuilder {
  build(task: LeanTask): LeanSnippet {
    const moduleName = `Generated.${sanitizeName(task.taskId)}`;
    const sourceText =
      task.theoremKind === "quadratic_nonnegativity_check"
        ? buildQuadraticNonnegativitySnippet(task)
        : task.theoremKind === "projection_skeleton_check"
          ? buildProjectionSkeletonSnippet(task)
          : buildNegAdjunctionSnippet(task);

    return {
      taskId: task.taskId,
      moduleName,
      filePath: task.outputPath,
      importLine: "import WebsiteToposIG.WebsiteToposIG",
      sourceText,
    };
  }
}

export const defaultLeanSnippetBuilder = new LeanSnippetBuilder();
