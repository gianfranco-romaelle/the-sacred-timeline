export type ArtifactCategory =
  | "lean_snippets"
  | "lean_stdout"
  | "lean_stderr"
  | "llm_outputs"
  | "semeiotic_raw"
  | "semeiotic_structured"
  | "snapshots";

export interface ArtifactPointer {
  category: ArtifactCategory;
  relativePath: string;
  absolutePath: string;
}

interface WriteArtifactInput {
  artifactDirectory: string;
  category: ArtifactCategory;
  baseName: string;
  content: string;
  extension: string;
}

const ARTIFACT_SUBDIRECTORIES: Record<ArtifactCategory, string> = {
  lean_snippets: "lean_snippets",
  lean_stdout: "lean_stdout",
  lean_stderr: "lean_stderr",
  llm_outputs: "llm_outputs",
  semeiotic_raw: "semeiotic_raw",
  semeiotic_structured: "semeiotic_structured",
  snapshots: "snapshots",
};

function isNodeRuntime() {
  const runtime = globalThis as { process?: { versions?: { node?: string } } };
  return typeof runtime.process?.versions?.node === "string";
}

function sanitizeFileSegment(value: string) {
  const normalized = value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized.length > 0 ? normalized : "artifact";
}

function timestampStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function resolveArtifactBaseDirectory(artifactDirectory: string) {
  const path = await importNodeModule<typeof import("node:path")>("node:path");
  return path.resolve(process.cwd(), artifactDirectory);
}

export async function ensureArtifactDirectories(artifactDirectory: string) {
  if (!isNodeRuntime()) {
    return;
  }

  const fs = await importNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
  const path = await importNodeModule<typeof import("node:path")>("node:path");
  const baseDirectory = await resolveArtifactBaseDirectory(artifactDirectory);

  await fs.mkdir(baseDirectory, { recursive: true });
  for (const relativeDirectory of Object.values(ARTIFACT_SUBDIRECTORIES)) {
    await fs.mkdir(path.resolve(baseDirectory, relativeDirectory), { recursive: true });
  }
}

export async function writeTextArtifact(input: WriteArtifactInput): Promise<ArtifactPointer | undefined> {
  if (!isNodeRuntime()) {
    return undefined;
  }

  const fs = await importNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
  const path = await importNodeModule<typeof import("node:path")>("node:path");
  const baseDirectory = await resolveArtifactBaseDirectory(input.artifactDirectory);
  await ensureArtifactDirectories(input.artifactDirectory);

  const safeBaseName = sanitizeFileSegment(input.baseName);
  const safeExtension = input.extension.startsWith(".") ? input.extension : `.${input.extension}`;
  const fileName = `${safeBaseName}_${timestampStamp()}${safeExtension}`;
  const relativePath = path.join(ARTIFACT_SUBDIRECTORIES[input.category], fileName);
  const absolutePath = path.resolve(baseDirectory, relativePath);

  await fs.writeFile(absolutePath, input.content, "utf8");

  return {
    category: input.category,
    relativePath,
    absolutePath,
  };
}

export async function writeJsonArtifact(input: {
  artifactDirectory: string;
  category: ArtifactCategory;
  baseName: string;
  value: unknown;
}) {
  return writeTextArtifact({
    artifactDirectory: input.artifactDirectory,
    category: input.category,
    baseName: input.baseName,
    content: `${JSON.stringify(input.value, null, 2)}\n`,
    extension: ".json",
  });
}

export async function readArtifactText(
  artifactDirectory: string,
  artifactPath?: string,
): Promise<string | undefined> {
  if (!artifactPath) {
    return undefined;
  }

  if (!isNodeRuntime()) {
    try {
      const query = new URLSearchParams({
        artifactDirectory,
        artifactPath,
      });
      const response = await fetch(`/api/lean/artifact?${query.toString()}`, {
        method: "GET",
      });
      if (!response.ok) {
        return undefined;
      }
      return response.text();
    } catch {
      return undefined;
    }
  }

  const fs = await importNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
  const path = await importNodeModule<typeof import("node:path")>("node:path");
  const baseDirectory = await resolveArtifactBaseDirectory(artifactDirectory);
  const absolutePath = path.isAbsolute(artifactPath)
    ? artifactPath
    : path.resolve(baseDirectory, artifactPath);

  try {
    return await fs.readFile(absolutePath, "utf8");
  } catch {
    return undefined;
  }
}
import { importNodeModule } from "@/lib/node-dynamic-import";
