import { defaultLeanResultParser } from "./LeanResultParser";
import { defaultLeanSnippetBuilder } from "./LeanSnippetBuilder";
import type {
  LeanArtifactRefs,
  LeanBridgePreparedTask,
  LeanParsedResult,
  LeanPreparedArtifact,
  LeanPrepareOptions,
  LeanRunExecution,
  LeanRunPreparedOptions,
  LeanRunResult,
  LeanSnippet,
  LeanTask,
} from "./types";

function quoteWindowsPath(value: string) {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function joinApiPath(baseUrl: string, suffix: string) {
  return `${baseUrl.replace(/\/+$/, "")}${suffix.startsWith("/") ? suffix : `/${suffix}`}`;
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Lean bridge request failed with ${response.status}.`);
  }
  return response.json() as Promise<T>;
}

export class LeanBridge {
  constructor(
    readonly apiBaseUrl = "/api/lean",
    readonly workspaceDirectory = "lean",
    readonly generatedDirectory = "generated",
    readonly snippetBuilder = defaultLeanSnippetBuilder,
    readonly resultParser = defaultLeanResultParser,
    readonly timeoutMs = 15000,
  ) {}

  buildSnippet(task: LeanTask): LeanSnippet {
    return this.snippetBuilder.build(task);
  }

  buildCommand(filePath: string, runtimeCommand?: string) {
    return `${runtimeCommand ?? "lake env lean"} ${quoteWindowsPath(filePath)}`;
  }

  prepareTask(task: LeanTask): LeanBridgePreparedTask {
    const snippet = this.buildSnippet(task);
    return {
      task,
      snippet,
      command: this.buildCommand(task.outputPath, task.runtimeCommand),
      workingDirectory: this.workspaceDirectory,
    };
  }

  parseResult(
    runResult: Pick<LeanRunResult, "stdout" | "stderr" | "exitCode" | "timedOut" | "spawnError">,
  ): LeanParsedResult {
    return this.resultParser.parse(runResult);
  }

  createUnexecutedRunResult(task: LeanTask): LeanRunResult {
    const prepared = this.prepareTask(task);
    return {
      taskId: task.taskId,
      command: prepared.command,
      workingDirectory: prepared.workingDirectory,
      snippet: prepared.snippet,
      stdout: "",
      stderr: "Lean process execution is delegated to the Node service API.",
      executed: false,
      exitCode: null,
      signal: null,
      timedOut: false,
    };
  }

  async writeSnippet(
    task: LeanTask,
    options: LeanPrepareOptions = {},
  ): Promise<LeanPreparedArtifact> {
    const response = await fetch(joinApiPath(this.apiBaseUrl, "/prepare"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        task,
        options: {
          artifactDirectory: options.artifactDirectory,
          persistSnippet: options.persistSnippet ?? true,
        },
      }),
    });

    return readJson<LeanPreparedArtifact>(response);
  }

  async runPreparedTask(
    prepared: LeanBridgePreparedTask,
    options: LeanRunPreparedOptions = {},
  ): Promise<LeanRunExecution> {
    const response = await fetch(joinApiPath(this.apiBaseUrl, "/run-prepared"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        prepared,
        options: {
          artifactDirectory: options.artifactDirectory,
          persistRawLeanStdout: options.persistRawLeanStdout ?? true,
          persistRawLeanStderr: options.persistRawLeanStderr ?? true,
          timeoutMs: options.timeoutMs ?? this.timeoutMs,
          snippetPath: options.snippetPath,
        },
      }),
    });

    return readJson<LeanRunExecution>(response);
  }

  async runTask(
    task: LeanTask,
    prepareOptions: LeanPrepareOptions = {},
    runOptions: LeanRunPreparedOptions = {},
  ) {
    const prepared = await this.writeSnippet(task, prepareOptions);
    return this.runPreparedTask(prepared.prepared, {
      ...runOptions,
      snippetPath: runOptions.snippetPath ?? prepared.artifactRefs.snippetPath,
      artifactDirectory: runOptions.artifactDirectory ?? prepareOptions.artifactDirectory,
    });
  }

  async readArtifactText(artifactDirectory: string, artifactPath?: string) {
    if (!artifactPath) {
      return undefined;
    }

    const query = new URLSearchParams({
      artifactDirectory,
      artifactPath,
    });
    const response = await fetch(joinApiPath(this.apiBaseUrl, `/artifact?${query.toString()}`), {
      method: "GET",
    });

    if (!response.ok) {
      return undefined;
    }

    return response.text();
  }
}

export const defaultLeanBridge = new LeanBridge();
