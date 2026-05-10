import type { NegAdjunctionField } from "@/features/hegel-triangle-transform/information-geometry";
import type {
  ExtractedNegAdjValues,
  LeanDiagnostic,
  LeanParsedClassification,
  LeanParsedResult,
  LeanRunResult,
} from "./types";

function parseNumber(value: string | undefined) {
  if (typeof value !== "string") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeLines(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
}

function collectMessages(lines: string[], pattern: RegExp) {
  return lines.filter((line) => pattern.test(line));
}

function unwrapLeanEval(line: string) {
  return line.replace(/^"(.*)"$/, "$1");
}

function parseDiagnostics(lines: string[]): LeanDiagnostic[] {
  const diagnostics: LeanDiagnostic[] = [];

  for (const rawLine of lines) {
    const line = unwrapLeanEval(rawLine).trim();

    const fileLineMatch = line.match(
      /^(?<file>(?:[A-Za-z]:)?[^:]+):(?<line>\d+)(?::(?<column>\d+))?:\s*(?<severity>warning|error|info):\s*(?<message>.+)$/i,
    );
    if (fileLineMatch?.groups) {
      diagnostics.push({
        file: fileLineMatch.groups.file,
        line: parseNumber(fileLineMatch.groups.line),
        severity: fileLineMatch.groups.severity.toLowerCase() as LeanDiagnostic["severity"],
        message: fileLineMatch.groups.message.trim(),
      });
      continue;
    }

    const genericMatch = line.match(/^(?<severity>warning|error|info):\s*(?<message>.+)$/i);
    if (genericMatch?.groups) {
      diagnostics.push({
        severity: genericMatch.groups.severity.toLowerCase() as LeanDiagnostic["severity"],
        message: genericMatch.groups.message.trim(),
      });
      continue;
    }

    if (/type mismatch/i.test(line) || /parse error/i.test(line)) {
      diagnostics.push({
        severity: "error",
        message: line,
      });
    }
  }

  return diagnostics;
}

function parseNegAdjValues(lines: string[]): ExtractedNegAdjValues | undefined {
  const normalizedLines = lines.map(unwrapLeanEval);
  const negAdjMatch = normalizedLines
    .map((line) =>
      line.match(
        /NEGADJ\s+forward=(?<forward>[-+]?\d*\.?\d+)\s+reverse=(?<reverse>[-+]?\d*\.?\d+)\s+asymmetry=(?<asymmetry>[-+]?\d*\.?\d+)\s+total=(?<total>[-+]?\d*\.?\d+)\s+projection=(?<projection>[-+]?\d*\.?\d+)/,
      ),
    )
    .find(Boolean);
  const phaseMatch = normalizedLines
    .map((line) => line.match(/^PHASE\s+(?<phase>\S+)$/))
    .find(Boolean);

  if (!negAdjMatch?.groups && !phaseMatch?.groups) {
    return undefined;
  }

  return {
    forward: parseNumber(negAdjMatch?.groups?.forward),
    reverse: parseNumber(negAdjMatch?.groups?.reverse),
    asymmetry: parseNumber(negAdjMatch?.groups?.asymmetry),
    total: parseNumber(negAdjMatch?.groups?.total),
    projection: parseNumber(negAdjMatch?.groups?.projection),
    phase: phaseMatch?.groups?.phase,
  };
}

function toNegAdjField(values?: ExtractedNegAdjValues): NegAdjunctionField | undefined {
  if (
    typeof values?.forward !== "number" &&
    typeof values?.reverse !== "number" &&
    typeof values?.asymmetry !== "number" &&
    typeof values?.total !== "number" &&
    typeof values?.projection !== "number"
  ) {
    return undefined;
  }

  const projection = values?.projection ?? 0;

  return {
    forward: values?.forward ?? 0,
    reverse: values?.reverse ?? 0,
    asymmetry: values?.asymmetry ?? 0,
    curvature: 0,
    projection,
    projectionDivergence: projection,
    total: values?.total ?? 0,
  };
}

function isWarningLine(line: string) {
  return /\bwarning\b/i.test(line);
}

function isErrorLine(line: string) {
  return /\berror\b/i.test(line) || /type mismatch/i.test(line) || /parse error/i.test(line);
}

function classifyParsedResult(input: {
  runResult: Pick<LeanRunResult, "exitCode" | "timedOut" | "spawnError">;
  lines: string[];
  diagnostics: LeanDiagnostic[];
  extractedNegAdjValues?: ExtractedNegAdjValues;
}): {
  accepted: boolean;
  blocked: boolean;
  rejected: boolean;
  vacuous: boolean;
  promising: boolean;
  classification: LeanParsedClassification;
} {
  const normalizedLines = input.lines.map(unwrapLeanEval);
  const theoremCheckPassed = normalizedLines.some((line) => /THEOREM_CHECK\s+\S+\s+passed/i.test(line));
  const blocked =
    input.runResult.timedOut === true ||
    normalizedLines.some((line) => /\bblocked\b/i.test(line)) ||
    normalizedLines.some((line) => /timed out/i.test(line));
  const rejected =
    blocked
      ? false
      : (input.runResult.exitCode != null && input.runResult.exitCode !== 0) ||
        Boolean(input.runResult.spawnError) ||
        input.diagnostics.some((diagnostic) => diagnostic.severity === "error");

  const total = input.extractedNegAdjValues?.total;
  const asymmetry = input.extractedNegAdjValues?.asymmetry ?? 0;
  const projection = input.extractedNegAdjValues?.projection ?? 0;
  const explicitVacuous = normalizedLines.some((line) => /\bvacuous\b/i.test(line));
  const explicitPromising = normalizedLines.some((line) => /\bpromising\b/i.test(line));
  const vacuous =
    !blocked &&
    !rejected &&
    (
      explicitVacuous ||
      (typeof total === "number" && total < 0.18 && asymmetry <= 1e-6 && projection <= 0.3)
    );
  const promising =
    !blocked &&
    !rejected &&
    !vacuous &&
    (
      explicitPromising ||
      theoremCheckPassed ||
      (typeof total === "number" && total >= 0.18 && projection < 0.62)
    );
  const accepted = !blocked && !rejected && !vacuous && !promising && (input.runResult.exitCode === 0 || input.runResult.exitCode == null);

  const classification: LeanParsedClassification =
    blocked
      ? "blocked"
      : rejected
        ? "rejected"
        : vacuous
          ? "vacuous"
          : promising
            ? "promising"
            : "accepted";

  return {
    accepted,
    blocked,
    rejected,
    vacuous,
    promising,
    classification,
  };
}

export class LeanResultParser {
  parse(
    runResult: Pick<LeanRunResult, "stdout" | "stderr" | "exitCode" | "timedOut" | "spawnError">,
  ): LeanParsedResult {
    const stdoutLines = normalizeLines(runResult.stdout);
    const stderrLines = normalizeLines(runResult.stderr);
    const allLines = [...stdoutLines, ...stderrLines];
    const extractedNegAdjValues = parseNegAdjValues(allLines);
    const negAdjField = toNegAdjField(extractedNegAdjValues);
    const diagnostics = parseDiagnostics(allLines);
    const warnings = diagnostics
      .filter((diagnostic) => diagnostic.severity === "warning")
      .map((diagnostic) => diagnostic.message);
    const errors = [
      ...diagnostics
        .filter((diagnostic) => diagnostic.severity === "error")
        .map((diagnostic) => diagnostic.message),
      ...(runResult.spawnError ? [runResult.spawnError] : []),
    ];
    const classification = classifyParsedResult({
      runResult,
      lines: allLines,
      diagnostics,
      extractedNegAdjValues,
    });

    return {
      accepted: classification.accepted,
      blocked: classification.blocked,
      rejected: classification.rejected,
      vacuous: classification.vacuous,
      promising: classification.promising,
      classification: classification.classification,
      warnings,
      errors,
      diagnostics,
      extractedNegAdjValues,
      negAdjField,
    };
  }
}

export const defaultLeanResultParser = new LeanResultParser();
