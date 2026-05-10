import type { ProviderCredentialPlaceholder } from "./provider-types";

export const DEFAULT_LOCAL_KEYS_FILE = "keys/keys.txt";

function isNodeRuntime() {
  const runtime = globalThis as { process?: { versions?: { node?: string } } };
  return typeof runtime.process?.versions?.node === "string";
}

function parseLocalKeyFile(text: string) {
  const entries = new Map<string, string>();

  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.includes("=") ? line.indexOf("=") : line.indexOf(":");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (!key || !value) {
      continue;
    }

    entries.set(key, value);
  }

  return entries;
}

function readLocalKeyFileMap(filePath = DEFAULT_LOCAL_KEYS_FILE) {
  if (!isNodeRuntime()) {
    return new Map<string, string>();
  }

  try {
    const runtimeRequire = Function("return require")() as NodeJS.Require;
    const fs = runtimeRequire("node:fs") as typeof import("node:fs");
    const path = runtimeRequire("node:path") as typeof import("node:path");
    const absolutePath = path.resolve(process.cwd(), filePath);

    if (!fs.existsSync(absolutePath)) {
      return new Map<string, string>();
    }

    return parseLocalKeyFile(fs.readFileSync(absolutePath, "utf8"));
  } catch {
    return new Map<string, string>();
  }
}

export function resolveLocalCredentialValue(envVarNames?: string[], filePath = DEFAULT_LOCAL_KEYS_FILE) {
  if (!envVarNames || envVarNames.length === 0) {
    return undefined;
  }

  if (isNodeRuntime() && typeof process !== "undefined") {
    for (const envVarName of envVarNames) {
      const envValue = process.env?.[envVarName];
      if (typeof envValue === "string" && envValue.trim().length > 0) {
        return envValue.trim();
      }
    }
  }

  const localKeyMap = readLocalKeyFileMap(filePath);
  for (const envVarName of envVarNames) {
    const value = localKeyMap.get(envVarName);
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
}

export function credentialsPlaceholderFromLocalSources(
  label: string,
  strategy: ProviderCredentialPlaceholder["strategy"],
  envVarNames?: string[],
  filePath = DEFAULT_LOCAL_KEYS_FILE,
): ProviderCredentialPlaceholder {
  const configured = typeof resolveLocalCredentialValue(envVarNames, filePath) === "string";

  return {
    strategy,
    configured,
    redactedLabel: label,
    envVarNames,
    notes: configured
      ? ["Resolved from local env var or keys file."]
      : [`Provide ${label} via env var or ${filePath}.`],
  };
}
