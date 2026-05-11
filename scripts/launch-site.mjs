import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const PORT = 4173;
const HOST = "127.0.0.1";
const URL = `http://${HOST}:${PORT}/`;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VITE_BIN = resolve(ROOT, "node_modules/vite/bin/vite.js");

function step(message) {
  const timestamp = new Date().toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  console.log(`[${timestamp}] ${message}`);
}

function getPortPids() {
  try {
    const output = execFileSync("netstat", ["-ano"], { encoding: "utf8" });
    return [
      ...new Set(
        output
          .split(/\r?\n/)
          .filter((line) => line.includes(`127.0.0.1:${PORT}`) && line.includes("LISTENING"))
          .map((line) => line.trim().split(/\s+/).at(-1))
          .filter(Boolean),
      ),
    ];
  } catch {
    return [];
  }
}

for (const pid of getPortPids()) {
  step(`Stopping existing listener on 127.0.0.1:${PORT} (PID ${pid})...`);
  try {
    execFileSync("taskkill", ["/PID", pid, "/F"], { stdio: "ignore" });
  } catch {
    step(`Could not stop PID ${pid}; preview may report that the port is already in use.`);
  }
}

step("Building site...");
const build = spawnSync(process.execPath, [VITE_BIN, "build"], {
  cwd: ROOT,
  stdio: "inherit",
});
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

step("Starting preview server...");
step(`Server host: ${HOST}`);
step(`Server port: ${PORT}`);
step(`Server URL:  ${URL}`);
step("Automatically opening the default browser...");

const preview = spawnSync(process.execPath, [VITE_BIN, "preview", "--host", HOST, "--open", URL], {
  cwd: ROOT,
  stdio: "inherit",
  shell: false,
});

if (preview.signal) {
  step(`Preview server stopped by ${preview.signal}.`);
  process.exit(0);
}

step(`Preview server exited with code ${preview.status ?? 0}.`);
process.exit(preview.status ?? 0);
