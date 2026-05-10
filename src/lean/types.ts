import type {
  FragmentId,
  LeanTaskId,
  ProposalKind,
  SemanticProposalId,
} from "@/types/hegel-triangle";
import type { NegAdjunctionField } from "@/features/hegel-triangle-transform/information-geometry";

export type LeanTheoremKind =
  | ProposalKind
  | "neg_adjunction"
  | "projection"
  | "bregman_divergence"
  | "quadratic_nonnegativity_check"
  | "projection_skeleton_check";

export interface LeanSourceVectors {
  source: number[];
  target: number[];
  repaired?: number[];
}

export interface LeanTask {
  taskId: LeanTaskId;
  fragmentId: FragmentId;
  proposalId: SemanticProposalId;
  theoremKind: LeanTheoremKind;
  sourceVectors: LeanSourceVectors;
  projectionValue: number;
  outputPath: string;
  runtimeCommand?: string;
}

export interface LeanSnippet {
  taskId: LeanTaskId;
  moduleName: string;
  filePath: string;
  importLine: string;
  sourceText: string;
}

export interface LeanRunResult {
  taskId: LeanTaskId;
  command: string;
  workingDirectory: string;
  snippet: LeanSnippet;
  exitCode?: number | null;
  signal?: string | null;
  durationMs?: number;
  timedOut?: boolean;
  spawnError?: string;
  stdout: string;
  stderr: string;
  executed: boolean;
}

export interface ExtractedNegAdjValues {
  forward?: number;
  reverse?: number;
  asymmetry?: number;
  total?: number;
  projection?: number;
  phase?: string;
}

export type LeanDiagnosticSeverity = "info" | "warning" | "error";

export interface LeanDiagnostic {
  file?: string;
  line?: number;
  severity: LeanDiagnosticSeverity;
  message: string;
}

export type LeanParsedClassification =
  | "accepted"
  | "blocked"
  | "rejected"
  | "vacuous"
  | "promising";

export interface LeanParsedResult {
  accepted: boolean;
  blocked: boolean;
  rejected: boolean;
  vacuous: boolean;
  promising: boolean;
  classification: LeanParsedClassification;
  warnings: string[];
  errors: string[];
  diagnostics: LeanDiagnostic[];
  extractedNegAdjValues?: ExtractedNegAdjValues;
  negAdjField?: NegAdjunctionField;
}

export interface LeanBridgePreparedTask {
  task: LeanTask;
  snippet: LeanSnippet;
  command: string;
  workingDirectory: string;
}

export interface LeanArtifactRefs {
  snippetPath?: string;
  stdoutPath?: string;
  stderrPath?: string;
  snapshotPath?: string;
}

export interface LeanPrepareOptions {
  artifactDirectory?: string;
  persistSnippet?: boolean;
}

export interface LeanPreparedArtifact {
  prepared: LeanBridgePreparedTask;
  artifactRefs: LeanArtifactRefs;
}

export interface LeanRunPreparedOptions {
  artifactDirectory?: string;
  persistRawLeanStdout?: boolean;
  persistRawLeanStderr?: boolean;
  timeoutMs?: number;
  snippetPath?: string;
}

export interface LeanRunExecution {
  runResult: LeanRunResult;
  parsed: LeanParsedResult;
  artifactRefs: LeanArtifactRefs;
}
