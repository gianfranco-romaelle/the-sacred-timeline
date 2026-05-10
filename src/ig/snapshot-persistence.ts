import type { RuntimeConfig } from "@/config/runtime-config";
import { readArtifactText, writeJsonArtifact } from "@/persistence/artifact-store";
import { initializeHistorySqlite } from "@/persistence/history-sqlite";
import { importNodeModule } from "@/lib/node-dynamic-import";
import type { IGLabSnapshotArtifact, IGLabSnapshotIndexRecord } from "./types";

function isNodeRuntime() {
  const runtime = globalThis as { process?: { versions?: { node?: string } } };
  return typeof runtime.process?.versions?.node === "string";
}

type PythonCommand = {
  command: string;
  args: string[];
};

function pythonCommandCandidates(sharedArgs: string[]): PythonCommand[] {
  const commands: PythonCommand[] = [{ command: "python", args: sharedArgs }];

  if (typeof process !== "undefined" && process.platform === "win32") {
    commands.push({
      command: "py",
      args: ["-3", ...sharedArgs],
    });
  } else {
    commands.push({
      command: "python3",
      args: sharedArgs,
    });
  }

  return commands;
}

async function runPython(candidate: PythonCommand, cwd: string) {
  const { spawn } = await importNodeModule<typeof import("node:child_process")>("node:child_process");

  return await new Promise<{
    exitCode: number | null;
    stdout: string;
    stderr: string;
    error?: string;
  }>((resolve) => {
    let stdout = "";
    let stderr = "";

    const child = spawn(candidate.command, candidate.args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      resolve({
        exitCode: null,
        stdout,
        stderr,
        error: error.message,
      });
    });

    child.on("close", (exitCode) => {
      resolve({
        exitCode,
        stdout,
        stderr,
      });
    });
  });
}

async function runSqliteJsonCommand(
  databasePath: string,
  script: string,
  payload?: unknown,
): Promise<{ ok: boolean; stdout: string; stderr: string; error?: string }> {
  if (!isNodeRuntime()) {
    return {
      ok: false,
      stdout: "",
      stderr: "",
      error: "IG snapshot persistence requires a Node runtime.",
    };
  }

  const schemaReady = await initializeHistorySqlite(databasePath);
  if (!schemaReady.initialized) {
    return {
      ok: false,
      stdout: schemaReady.stdout,
      stderr: schemaReady.stderr,
      error: schemaReady.error ?? "Unable to initialize SQLite database for IG snapshots.",
    };
  }

  const scriptBase64 = Buffer.from(script, "utf8").toString("base64");
  const payloadBase64 = Buffer.from(JSON.stringify(payload ?? null), "utf8").toString("base64");
  const bootstrap = [
    "import base64, json, pathlib, sqlite3, sys",
    "script = base64.b64decode(sys.argv[1]).decode('utf-8')",
    "db_path = pathlib.Path(sys.argv[2])",
    "payload = json.loads(base64.b64decode(sys.argv[3]).decode('utf-8'))",
    "namespace = {'db_path': db_path, 'payload': payload, 'sqlite3': sqlite3, 'json': json}",
    "exec(script, namespace)",
  ].join("\n");

  const sharedArgs = ["-c", bootstrap, scriptBase64, schemaReady.databasePath, payloadBase64];
  let combinedStdout = "";
  let combinedStderr = "";

  for (const candidate of pythonCommandCandidates(sharedArgs)) {
    const result = await runPython(candidate, process.cwd());
    combinedStdout += result.stdout;
    combinedStderr += result.stderr;

    if (result.exitCode === 0) {
      return {
        ok: true,
        stdout: combinedStdout,
        stderr: combinedStderr,
      };
    }

    if (result.error) {
      combinedStderr += `${combinedStderr.endsWith("\n") || combinedStderr.length === 0 ? "" : "\n"}${result.error}`;
    }
  }

  return {
    ok: false,
    stdout: combinedStdout,
    stderr: combinedStderr,
    error: "Unable to execute Python SQLite command for IG snapshots.",
  };
}

function sanitizeLabel(value?: string) {
  const normalized = (value ?? "snapshot").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized.length > 0 ? normalized : "snapshot";
}

async function deleteArtifactFile(artifactDirectory: string, artifactPath?: string) {
  if (!artifactPath || !isNodeRuntime()) {
    return;
  }

  const fs = await importNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
  const path = await importNodeModule<typeof import("node:path")>("node:path");
  const baseDirectory = path.resolve(process.cwd(), artifactDirectory);
  const absolutePath = path.isAbsolute(artifactPath)
    ? artifactPath
    : path.resolve(baseDirectory, artifactPath);

  try {
    await fs.unlink(absolutePath);
  } catch {
    // Ignore artifact cleanup failures and keep snapshot indexing resilient.
  }
}

async function pruneIGLabSnapshots(
  runtimeConfig: RuntimeConfig,
  retentionLimit: number,
) {
  const normalizedLimit = Math.max(1, Math.round(retentionLimit));
  const script = [
    "conn = sqlite3.connect(str(db_path))",
    "conn.row_factory = sqlite3.Row",
    "try:",
    "    rows = [dict(row) for row in conn.execute(",
    "        'SELECT id, artifactPath FROM ig_lab_snapshots ORDER BY tick DESC, createdAt DESC LIMIT -1 OFFSET ?',",
    "        (payload.get('limit', 64),),",
    "    ).fetchall()]",
    "    if rows:",
    "        conn.executemany('DELETE FROM ig_lab_snapshots WHERE id = ?', [(row['id'],) for row in rows])",
    "        conn.commit()",
    "finally:",
    "    conn.close()",
    "print(json.dumps(rows))",
  ].join("\n");

  const result = await runSqliteJsonCommand(runtimeConfig.databasePath, script, {
    limit: normalizedLimit,
  });
  if (!result.ok) {
    return;
  }

  try {
    const rows = JSON.parse(result.stdout) as Array<{ artifactPath?: string }>;
    await Promise.all(
      rows.map((row) => deleteArtifactFile(runtimeConfig.artifactDirectory, row.artifactPath)),
    );
  } catch {
    // Ignore pruning parse errors so snapshot writes remain non-fatal.
  }
}

export async function saveIGLabSnapshot(input: {
  runtimeConfig: RuntimeConfig;
  snapshot: IGLabSnapshotArtifact;
  retentionLimit?: number;
}): Promise<{
  saved: boolean;
  record?: IGLabSnapshotIndexRecord;
  error?: string;
}> {
  const artifact = await writeJsonArtifact({
    artifactDirectory: input.runtimeConfig.artifactDirectory,
    category: "snapshots",
    baseName: `ig_lab_${sanitizeLabel(input.snapshot.label)}_${input.snapshot.tick}`,
    value: input.snapshot,
  });

  if (!artifact) {
    return {
      saved: false,
      error: "Unable to write IG snapshot artifact.",
    };
  }

  const summary = {
    label: input.snapshot.label,
    phase: input.snapshot.phase,
  };

  const row: IGLabSnapshotIndexRecord = {
    id: input.snapshot.id,
    fragmentId: input.snapshot.fragmentId,
    proposalId: input.snapshot.proposalId,
    tick: input.snapshot.tick,
    createdAt: input.snapshot.savedAt,
    updatedAt: input.snapshot.savedAt,
    geometryMode: input.snapshot.geometryMode,
    viewMode: input.snapshot.viewMode,
    moduleTab: input.snapshot.moduleTab,
    chartKind: input.snapshot.chartKind,
    scalarField: input.snapshot.scalarField,
    colorScaleMode: input.snapshot.colorScaleMode,
    normalizationMode: input.snapshot.normalizationMode,
    artifactPath: artifact.relativePath,
    siteCount: input.snapshot.sitePositions.length,
    sampleCount: input.snapshot.scalarSamples.length,
    summary,
  };

  const insertScript = [
    "conn = sqlite3.connect(str(db_path))",
    "try:",
    "    conn.execute(",
    "        '''INSERT OR REPLACE INTO ig_lab_snapshots (",
    "            id, parentId, fragmentId, proposalId, tick, createdAt, updatedAt,",
    "            geometryMode, viewMode, moduleTab, chartKind, scalarField, colorScaleMode, normalizationMode,",
    "            artifactPath, siteCount, sampleCount, summaryJson",
    "        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',",
    "        (",
    "            payload['id'],",
    "            payload.get('parentId'),",
    "            payload.get('fragmentId'),",
    "            payload.get('proposalId'),",
    "            payload['tick'],",
    "            payload['createdAt'],",
    "            payload['updatedAt'],",
    "            payload.get('geometryMode'),",
    "            payload['viewMode'],",
    "            payload.get('moduleTab'),",
    "            payload.get('chartKind'),",
    "            payload.get('scalarField'),",
    "            payload.get('colorScaleMode'),",
    "            payload.get('normalizationMode'),",
    "            payload['artifactPath'],",
    "            payload['siteCount'],",
    "            payload['sampleCount'],",
    "            json.dumps(payload.get('summary'))",
    "        ),",
    "    )",
    "    conn.commit()",
    "finally:",
    "    conn.close()",
    "print(json.dumps({'saved': True}))",
  ].join("\n");

  const result = await runSqliteJsonCommand(input.runtimeConfig.databasePath, insertScript, row);
  if (!result.ok) {
    return {
      saved: false,
      error: result.error ?? (result.stderr || "Unable to index IG snapshot in SQLite."),
    };
  }

  if (typeof input.retentionLimit === "number") {
    await pruneIGLabSnapshots(input.runtimeConfig, input.retentionLimit);
  }

  return {
    saved: true,
    record: row,
  };
}

export async function listIGLabSnapshots(
  databasePath: string,
  limit = 64,
): Promise<{
  records: IGLabSnapshotIndexRecord[];
  error?: string;
}> {
  const script = [
    "conn = sqlite3.connect(str(db_path))",
    "conn.row_factory = sqlite3.Row",
    "try:",
    "    rows = [dict(row) for row in conn.execute(",
    "        'SELECT id, parentId, fragmentId, proposalId, tick, createdAt, updatedAt, geometryMode, viewMode, moduleTab, chartKind, scalarField, colorScaleMode, normalizationMode, artifactPath, siteCount, sampleCount, summaryJson FROM ig_lab_snapshots ORDER BY tick DESC, createdAt DESC LIMIT ?',",
    "        (payload.get('limit', 64),),",
    "    ).fetchall()]",
    "finally:",
    "    conn.close()",
    "for row in rows:",
    "    row['summary'] = json.loads(row['summaryJson']) if row.get('summaryJson') else None",
    "    row.pop('summaryJson', None)",
    "print(json.dumps(rows))",
  ].join("\n");

  const result = await runSqliteJsonCommand(databasePath, script, { limit });
  if (!result.ok) {
    return {
      records: [],
      error: result.error ?? (result.stderr || "Unable to load IG snapshots."),
    };
  }

  try {
    return {
      records: JSON.parse(result.stdout) as IGLabSnapshotIndexRecord[],
    };
  } catch {
    return {
      records: [],
      error: "Unable to parse IG snapshot index rows.",
    };
  }
}

export async function loadIGLabSnapshotArtifact(
  artifactDirectory: string,
  artifactPath?: string,
): Promise<IGLabSnapshotArtifact | undefined> {
  const sourceText = await readArtifactText(artifactDirectory, artifactPath);
  if (!sourceText) {
    return undefined;
  }

  try {
    return JSON.parse(sourceText) as IGLabSnapshotArtifact;
  } catch {
    return undefined;
  }
}
