import { Suspense, lazy, startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  BookMarked,
  FileClock,
  Files,
  LibraryBig,
  LockKeyhole,
  NotebookPen,
  Power,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Telescope,
  Waypoints,
} from "lucide-react";
import backgroundTexture from "@/assets/background.png";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ActivityModuleStrip, useActivityCenter } from "@/features/activity/activity_center";
import { cn } from "@/lib/utils";
import {
  clearLocalDemoSession,
  createImportJob,
  createNote,
  createResearchMap,
  createWatchFolder,
  enterDemoMode,
  fetchLawvereCollection,
  fetchLawvereFormalizationCandidates,
  fetchWebsiteToposExport,
  fetchDossierAssertions,
  fetchDossierSignalWindows,
  fetchBackendBootStatus,
  fetchDocuments,
  fetchImportJobs,
  fetchNotes,
  fetchPharmaCycles,
  fetchPharmaEvents,
  fetchPharmaHomologations,
  fetchPharmaLeaderboard,
  fetchResearchBundle,
  fetchResearchMaps,
  fetchSavedQueries,
  fetchSystemStatus,
  fetchWatchFolders,
  materializeWebsiteToposMap,
  materializeLawvereMap,
  getLocalDemoSession,
  getSession,
  loginAccount,
  logoutAccount,
  pinResearchEntity,
  registerAccount,
  resetImportJobs,
  subscribeBackendEvents,
  runLibraryQuery,
  runMarketAnalysis,
  runPharmaCycle,
  runResearchQuery,
  saveQuery,
  startBackendServices,
  syncDossiers,
  syncPharmaEvents,
} from "./library_api";

const LazyLensSwitcher = lazy(async () => {
  const module = await import("./research_visualizations");
  return { default: module.LensSwitcher };
});

const LazyResearchVisualizationCanvas = lazy(async () => {
  const module = await import("./research_visualizations");
  return { default: module.ResearchVisualizationCanvas };
});

const SCREENS = [
  { id: "ask", label: "Ask", icon: Sparkles },
  { id: "research", label: "Research", icon: Telescope },
  { id: "lawvere", label: "Lawvere", icon: BookMarked },
  { id: "market", label: "Market", icon: Waypoints },
  { id: "imports", label: "Imports", icon: FileClock },
  { id: "documents", label: "Documents", icon: LibraryBig },
  { id: "saved", label: "Saved", icon: NotebookPen },
];

const SCREEN_CACHE_TTL_MS = 45_000;
const EMPTY_ITEMS = [];
const LAWVERE_SCOPE = { collection: "lawvere" };

const BACKEND_LAUNCH_COMMANDS = [
  {
    id: "api",
    role: "API server",
    script: "backend/run_api.py",
    command: "python backend/run_api.py",
  },
  {
    id: "worker",
    role: "Background worker",
    script: "backend/run_worker.py",
    command: "python backend/run_worker.py",
  },
  {
    id: "import_monitor",
    role: "Import monitor",
    script: "scripts/watch-import-progress.ps1",
    command: "powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/watch-import-progress.ps1",
  },
];

const DEFAULT_BOOT_STAGES = [
  { id: "offline", label: "Offline", status: "active" },
  { id: "api_started", label: "API process detected", status: "pending" },
  { id: "worker_started", label: "Worker process detected", status: "pending" },
  { id: "healthy", label: "Backend health check passed", status: "pending" },
];

const VAPNIK_SOURCE_PROFILE = {
  title: "Vladimir N. Vapnik - Statistical Learning Theory",
  localPath: "G:\\Other computers\\My Laptop\\THE AUGUSTE LAURENT SOCIETY\\Mathematics PhD\\[Adaptive and learning systems for signal processing, communications, and control] Vladimir N. Vapnik - Statistical Learning Theory (1998, Wi.djvu",
  localFileSize: "5.38 MB DJVU",
  pageCount: 740,
  extractionStatus: "Native DJVU text extraction now works on this Windows setup through auto-discovered DjVuLibre tools, so the book can be ingested without manual PATH fixes.",
  usableIdeas: [
    "empirical risk minimization",
    "structural risk minimization",
    "controlling generalization ability",
    "uniform convergence and consistency",
    "constructing learning algorithms from empirical data",
  ],
};

const VAPNIK_RUNTIME_PROMPTS = [
  "Explain Vapnik's capacity control in plain language and tell me what the interface should expose to reduce user error.",
  "Translate empirical risk, generalization control, and structural risk into runtime guidance for HungryTopos and /library.",
  "Build a trust protocol for when a research answer should be accepted, revised, or widened before acting on it.",
];

function getLibraryBackgroundStyle() {
  return {
    backgroundColor: "#f1efe7",
    backgroundImage: `linear-gradient(140deg, rgba(255,255,255,0.92), rgba(248,245,236,0.82)), url(${backgroundTexture})`,
    backgroundSize: "100% 100%, 320px 320px",
    backgroundRepeat: "no-repeat, repeat",
    backgroundBlendMode: "normal, multiply",
  };
}

function buildLibraryBootSignal(bootStatus, bootError) {
  const state = bootStatus?.state || "offline";
  const severity = bootError
    ? "error"
    : state === "healthy" || state === "ready"
      ? "success"
      : state === "failed" || state === "offline"
        ? "error"
        : "warning";
  return {
    id: "activity:library:backend-boot",
    source_module: "library",
    source_kind: "backend_boot",
    title: "Library backend runtime",
    summary: bootError || bootStatus?.message || "Checking local API and worker readiness.",
    severity,
    visibility: "public",
    signal_state: state,
    payload: {
      health: bootStatus?.health || null,
      api: bootStatus?.api || null,
      worker: bootStatus?.worker || null,
      import_monitor: bootStatus?.import_monitor || null,
      stages: bootStatus?.stages || [],
    },
  };
}

function formatDate(value) {
  if (!value) return "Pending";
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatStatusLabel(value) {
  return String(value || "unknown")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function StatusBadge({ value }) {
  const tone = value === "completed" || value === "indexed" || value === "healthy" || value === "enabled"
    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : value === "running" || value === "processing" || value === "starting"
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : value === "failed" || value === "offline" || value === "disabled"
        ? "bg-rose-50 text-rose-700 border-rose-200"
        : "bg-slate-100 text-slate-700 border-slate-200";
  return <Badge className={cn("rounded-full border", tone)}>{formatStatusLabel(value)}</Badge>;
}

function formatDecimal(value, digits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "n/a";
  return numeric.toFixed(digits);
}

function formatKernelTrace(summary) {
  if (!summary?.trace) return "n/a";
  const real = formatDecimal(summary.trace.re, 2);
  const imag = formatDecimal(summary.trace.im, 2);
  return `${real} + ${imag}i`;
}

function getImportProgress(job) {
  const completed = Number(job?.progress_completed || 0);
  const total = Number(job?.progress_total || 0);
  if (total > 0) {
    return {
      completed,
      total,
      percent: Math.max(0, Math.min(100, Math.round((completed / total) * 100))),
    };
  }
  const tasks = Array.isArray(job?.tasks) ? job.tasks : [];
  const completedTasks = tasks.filter((task) => task.status === "completed").length;
  const totalTasks = tasks.length;
  return {
    completed: completedTasks,
    total: totalTasks,
    percent: totalTasks ? Math.max(0, Math.min(100, Math.round((completedTasks / totalTasks) * 100))) : 0,
  };
}

function ImportProgressBar({ percent }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-stone-200">
      <div className="h-full rounded-full bg-stone-900 transition-all" style={{ width: `${percent}%` }} />
    </div>
  );
}

function normalizeImportFileCounts(job) {
  const counts = job?.file_counts || {};
  return {
    discovered: Number(counts.discovered || 0),
    processed: Number(counts.processed || 0),
    succeeded: Number(counts.succeeded || 0),
    failed: Number(counts.failed || 0),
    deferredToOcr: Number(counts.deferred_to_ocr || 0),
  };
}

function describeWatchFolderIntent(folder) {
  const path = String(folder?.path || "").toLowerCase();
  if (!path) return null;
  if (path.includes("\\pictures\\images") || path.includes("\\documents\\amscope") || path.includes("\\pictures\\screenshots") || path.includes("\\paintings")) {
    return folder?.enabled
      ? "Image-heavy source root is live."
      : "Image-heavy source root is staged for later parsing.";
  }
  if (path.includes("\\ufcop")) {
    return folder?.enabled
      ? "UFCOP is being watched live."
      : "UFCOP is registered in the library and can be imported without duplicating watch-sync jobs.";
  }
  return null;
}

function ImportTaskRow({ task }) {
  const hasProgress = Number(task?.progress_total || 0) > 0;
  const taskPercent = hasProgress
    ? Math.max(0, Math.min(100, Math.round(((Number(task?.progress_completed || 0)) / Number(task.progress_total)) * 100)))
    : 0;
  const payload = task?.payload || {};
  const isExtractStage = task?.stage === "extract";
  const isMathStage = task?.stage === "math_extract";
  const sampleFailures = Array.isArray(payload.sample_failures) ? payload.sample_failures : [];
  const extractCounts = {
    processed: Number(payload.processed || 0),
    succeeded: Number(payload.succeeded || 0),
    failed: Number(payload.failed || 0),
    deferredToOcr: Number(payload.deferred_to_ocr || 0),
  };
  const activeItemName = payload.current_item_name || "";
  const activeItemPath = payload.current_item_path || "";

  return (
    <div className="rounded-[18px] border border-stone-200 bg-white/80 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-medium text-stone-900">{formatStatusLabel(task.stage)}</div>
        <StatusBadge value={task.status} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-stone-500">
        <span>
          {hasProgress ? `${task.progress_completed}/${task.progress_total}` : "Waiting for work"}
        </span>
        {payload.current_item_index && payload.current_item_total ? <span>Item {payload.current_item_index}/{payload.current_item_total}</span> : null}
        {task.error_code ? <span>Error: {task.error_code}</span> : null}
      </div>
      {hasProgress ? <div className="mt-2"><ImportProgressBar percent={taskPercent} /></div> : null}
      {task.warnings?.length ? <div className="mt-2 text-xs text-amber-700">{task.warnings.join(" ")}</div> : null}
      {activeItemName ? (
        <div className="mt-3 rounded-2xl border border-stone-200 bg-stone-50 px-3 py-3 text-xs text-stone-700">
          <div className="font-semibold uppercase tracking-[0.14em] text-stone-500">Current item</div>
          <div className="mt-2 font-medium text-stone-900">{activeItemName}</div>
          {activeItemPath ? <div className="mt-1 break-all font-mono text-[11px] text-stone-600">{activeItemPath}</div> : null}
        </div>
      ) : null}
      {isExtractStage ? (
        <div className="mt-3 space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-600">
              <div className="font-semibold uppercase tracking-[0.14em] text-stone-500">Processed</div>
              <div className="mt-1 text-sm text-stone-900">{extractCounts.processed}</div>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-600">
              <div className="font-semibold uppercase tracking-[0.14em] text-stone-500">Succeeded</div>
              <div className="mt-1 text-sm text-stone-900">{extractCounts.succeeded}</div>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-600">
              <div className="font-semibold uppercase tracking-[0.14em] text-stone-500">Failed</div>
              <div className="mt-1 text-sm text-stone-900">{extractCounts.failed}</div>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-600">
              <div className="font-semibold uppercase tracking-[0.14em] text-stone-500">Deferred to OCR</div>
              <div className="mt-1 text-sm text-stone-900">{extractCounts.deferredToOcr}</div>
            </div>
          </div>
          {sampleFailures.length ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-900">
              <div className="font-semibold uppercase tracking-[0.14em] text-amber-800">Sample failures</div>
              <div className="mt-2 space-y-2">
                {sampleFailures.slice(0, 3).map((failure, index) => (
                  <div key={`${task.id}-failure-${index}`} className="rounded-xl border border-amber-200 bg-white/70 px-3 py-2">
                    <div className="font-medium text-stone-900">{failure.path || "Unknown file"}</div>
                    <div className="mt-1 text-amber-800">
                      {failure.code ? `${failure.code}: ` : ""}
                      {failure.message || "Extraction failed."}
                    </div>
                  </div>
                ))}
              </div>
              {payload.manifest_path ? (
                <div className="mt-2 text-[11px] text-amber-800">
                  Full manifest: <span className="font-mono">{payload.manifest_path}</span>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {isMathStage ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-600">
            <div className="font-semibold uppercase tracking-[0.14em] text-stone-500">Pages scanned</div>
            <div className="mt-1 text-sm text-stone-900">{Number(payload.math_pages_scanned || 0)}</div>
          </div>
          <div className="rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-600">
            <div className="font-semibold uppercase tracking-[0.14em] text-stone-500">Regions</div>
            <div className="mt-1 text-sm text-stone-900">{Number(payload.math_regions_detected || 0)}</div>
          </div>
          <div className="rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-600">
            <div className="font-semibold uppercase tracking-[0.14em] text-stone-500">Formulae</div>
            <div className="mt-1 text-sm text-stone-900">{Number(payload.math_formula_count || 0)}</div>
          </div>
          <div className="rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-600">
            <div className="font-semibold uppercase tracking-[0.14em] text-stone-500">Recognized</div>
            <div className="mt-1 text-sm text-stone-900">{Number(payload.math_formula_recognized || 0)}</div>
          </div>
          <div className="rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-600">
            <div className="font-semibold uppercase tracking-[0.14em] text-stone-500">Pending</div>
            <div className="mt-1 text-sm text-stone-900">{Number(payload.math_formula_pending || 0)}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ImportJobCard({ job }) {
  const progress = getImportProgress(job);
  const fileCounts = normalizeImportFileCounts(job);
  const tasks = Array.isArray(job?.tasks) ? job.tasks : [];
  const visibleTasks = tasks.slice(0, 5);
  const extraTaskCount = Math.max(0, tasks.length - visibleTasks.length);
  const warningList = [...(job.stage_warnings || []), ...(job.warnings || [])];
  const uniqueWarnings = Array.from(new Set(warningList.filter(Boolean)));
  const hasPartialExtractIssues = job.status !== "failed" && (fileCounts.failed > 0 || fileCounts.deferredToOcr > 0);
  const extractTask = tasks.find((task) => task.stage === "extract");
  const extractFailures = Array.isArray(extractTask?.payload?.sample_failures) ? extractTask.payload.sample_failures : [];
  const currentItemLabel = job.current_item_name || extractTask?.payload?.current_item_name || "";
  const currentItemPath = job.current_item_path || extractTask?.payload?.current_item_path || "";
  const currentItemIndex = Number(job.current_item_index || extractTask?.payload?.current_item_index || 0);
  const currentItemTotal = Number(job.current_item_total || extractTask?.payload?.current_item_total || 0);

  return (
    <div className="rounded-[22px] border border-stone-200 bg-stone-50/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-stone-900">{job.source_path}</div>
          <div className="mt-1 text-sm text-stone-500">{formatDate(job.created_at)}</div>
        </div>
        <StatusBadge value={job.status} />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-[18px] border border-stone-200 bg-white/80 px-3 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">Scope</div>
          <div className="mt-2 text-sm text-stone-700">{job.options?.recursive === false ? "Top level only" : "Whole folder tree"}</div>
        </div>
        <div className="rounded-[18px] border border-stone-200 bg-white/80 px-3 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">Current stage</div>
          <div className="mt-2 text-sm text-stone-700">{job.current_stage ? formatStatusLabel(job.current_stage) : "Queued"}</div>
        </div>
        <div className="rounded-[18px] border border-stone-200 bg-white/80 px-3 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">Output</div>
          <div className="mt-2 text-sm text-stone-700">{job.document_count || 0} documents</div>
        </div>
      </div>

      <div className="mt-4 rounded-[18px] border border-stone-200 bg-white/80 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">Pipeline progress</div>
          <div className="text-sm text-stone-700">{progress.completed}/{progress.total || 0} / {progress.percent}%</div>
        </div>
        <div className="mt-3">
          <ImportProgressBar percent={progress.percent} />
        </div>
        {currentItemLabel ? (
          <div className="mt-4 rounded-[16px] border border-stone-200 bg-stone-50 px-3 py-3 text-sm text-stone-700">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">Working on now</div>
            <div className="mt-2 font-medium text-stone-900">{currentItemLabel}</div>
            {currentItemPath ? <div className="mt-1 break-all font-mono text-[11px] text-stone-600">{currentItemPath}</div> : null}
            {currentItemIndex > 0 && currentItemTotal > 0 ? <div className="mt-2 text-xs text-stone-500">Stage item {currentItemIndex}/{currentItemTotal}</div> : null}
            {job.recovered_after_restart ? <div className="mt-2 text-xs text-amber-700">Recovered after restart and marked resumable.</div> : null}
          </div>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-[18px] border border-stone-200 bg-white/80 px-3 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">Discovered</div>
          <div className="mt-2 text-sm text-stone-700">{fileCounts.discovered}</div>
        </div>
        <div className="rounded-[18px] border border-stone-200 bg-white/80 px-3 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">Processed</div>
          <div className="mt-2 text-sm text-stone-700">{fileCounts.processed}</div>
        </div>
        <div className="rounded-[18px] border border-stone-200 bg-white/80 px-3 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">Succeeded</div>
          <div className="mt-2 text-sm text-stone-700">{fileCounts.succeeded}</div>
        </div>
        <div className="rounded-[18px] border border-stone-200 bg-white/80 px-3 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">Failed</div>
          <div className="mt-2 text-sm text-stone-700">{fileCounts.failed}</div>
        </div>
        <div className="rounded-[18px] border border-stone-200 bg-white/80 px-3 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">Deferred to OCR</div>
          <div className="mt-2 text-sm text-stone-700">{fileCounts.deferredToOcr}</div>
        </div>
      </div>

      {job.error_code || job.error_text ? (
        <div className="mt-4 rounded-[18px] border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-700">
          <div className="font-semibold text-rose-800">Import failure</div>
          <div className="mt-1">{job.error_code ? `${job.error_code}: ` : ""}{job.error_text || "The job reported a pipeline failure."}</div>
        </div>
      ) : null}

      {hasPartialExtractIssues ? (
        <div className="mt-4 rounded-[18px] border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
          <div className="font-semibold text-amber-950">Extract stage continued past file-level issues</div>
          <div className="mt-1">
            {fileCounts.failed > 0 ? `${fileCounts.failed} file${fileCounts.failed === 1 ? "" : "s"} failed during extract. ` : ""}
            {fileCounts.deferredToOcr > 0 ? `${fileCounts.deferredToOcr} PDF file${fileCounts.deferredToOcr === 1 ? "" : "s"} moved forward for OCR recovery.` : ""}
          </div>
          {extractFailures.length ? (
            <div className="mt-3 space-y-2">
              {extractFailures.slice(0, 3).map((failure, index) => (
                <div key={`${job.id}-extract-failure-${index}`} className="rounded-xl border border-amber-200 bg-white/70 px-3 py-2 text-xs">
                  <div className="font-medium text-stone-900">{failure.path || "Unknown file"}</div>
                  <div className="mt-1 text-amber-800">
                    {failure.code ? `${failure.code}: ` : ""}
                    {failure.message || "Extraction failed."}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {uniqueWarnings.length ? (
        <div className="mt-4 rounded-[18px] border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
          <div className="font-semibold text-amber-900">Warnings</div>
          <div className="mt-1 space-y-1">
            {uniqueWarnings.slice(0, 3).map((warning, index) => (
              <div key={`${job.id}-warning-${index}`}>{warning}</div>
            ))}
          </div>
        </div>
      ) : null}

      {tasks.length ? (
        <div className="mt-4 space-y-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">Pipeline tasks</div>
          <div className="space-y-2">
            {visibleTasks.map((task) => <ImportTaskRow key={task.id} task={task} />)}
          </div>
          {extraTaskCount ? <div className="text-xs text-stone-500">+ {extraTaskCount} more stages in the pipeline</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function MarketMetricTile({ label, value, hint }) {
  return (
    <div className="rounded-[18px] border border-stone-200 bg-stone-50/80 px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">{label}</div>
      <div className="mt-2 text-lg font-semibold text-stone-900">{value}</div>
      {hint ? <div className="mt-1 text-xs text-stone-500">{hint}</div> : null}
    </div>
  );
}

function MarketGeometryCard({ title, section }) {
  const deRham = section?.de_rham || {};
  const kernels = section?.kernels || {};
  const signals = section?.signals || {};
  return (
    <div className="rounded-[24px] border border-stone-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-stone-900">{title}</div>
          <div className="mt-1 text-sm text-stone-500">
            {section?.vertex_count || 0} vertices · {section?.edge_count || 0} edges · {section?.triangle_count || 0} triangles
          </div>
        </div>
        <Badge className="rounded-full border border-stone-200 bg-stone-50 text-stone-700">
          β0 {deRham.beta0 ?? 0} · β1 {deRham.beta1 ?? 0}
        </Badge>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MarketMetricTile label="Partition" value={formatDecimal(section?.thermodynamics?.partition_function, 2)} />
        <MarketMetricTile label="Free Energy" value={formatDecimal(section?.thermodynamics?.free_energy, 2)} />
        <MarketMetricTile label="Circulation" value={formatDecimal(signals.circulation_score, 2)} />
        <MarketMetricTile label="Divergence" value={formatDecimal(signals.divergence_stress, 2)} />
      </div>
      <div className="mt-4 grid gap-3 xl:grid-cols-2">
        <div className="rounded-[18px] border border-stone-200 bg-stone-50/70 p-4 text-sm text-stone-700">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">Kernel traces</div>
          <div className="mt-3 space-y-2">
            <div>Thermal: {formatKernelTrace(kernels.thermal_green)}</div>
            <div>Retarded: {formatKernelTrace(kernels.retarded_green)}</div>
            <div>Static: {formatKernelTrace(kernels.static_green)}</div>
          </div>
        </div>
        <div className="rounded-[18px] border border-stone-200 bg-stone-50/70 p-4 text-sm text-stone-700">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">Top anomalies</div>
          <div className="mt-3 space-y-2">
            {(signals.top_vertex_anomalies || []).slice(0, 3).map((item) => (
              <div key={item.snapshot_id || item.label} className="flex items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate font-medium text-stone-900">{item.label || item.snapshot_id}</div>
                  <div className="text-xs text-stone-500">{item.symbol || "state"}</div>
                </div>
                <div className="text-sm text-stone-700">{formatDecimal(item.score, 2)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {section?.warnings?.length ? (
        <div className="mt-4 rounded-[18px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {section.warnings.join(" ")}
        </div>
      ) : null}
    </div>
  );
}

function SectionShell({ title, description, actions, children, className = "" }) {
  return (
    <Card className={cn("rounded-[28px] border-stone-200/80 bg-white/85 shadow-[0_28px_80px_rgba(43,35,22,0.08)] backdrop-blur", className)}>
      <CardHeader className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <CardTitle className="font-serif text-2xl text-stone-900">{title}</CardTitle>
          {description ? <CardDescription className="max-w-2xl text-stone-600">{description}</CardDescription> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function FeaturePill({ icon, title, description }) {
  const IconComponent = icon;
  return (
    <div className="rounded-[22px] border border-stone-200/80 bg-white/75 p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-stone-900 text-white">
          <IconComponent className="h-5 w-5" />
        </div>
        <div className="font-semibold text-stone-900">{title}</div>
      </div>
      <div className="mt-3 text-sm text-stone-600">{description}</div>
    </div>
  );
}

function buildHumanRuntimeAssessment({ citations = [], warnings = [], validation = [], relatedDocuments = [], coverage = null, trace = null }) {
  const citationCount = citations.length;
  const validationWarnings = validation.filter((item) => item.status !== "pass").length;
  const validationPasses = validation.filter((item) => item.status === "pass").length;
  const retrievedDocumentCount = Array.isArray(trace?.retrieved_documents) ? trace.retrieved_documents.length : relatedDocuments.length;
  const totalWarnings = warnings.length + validationWarnings;

  const evidenceLabel = citationCount >= 3 ? "Grounded" : citationCount >= 1 ? "Partial" : "Thin";
  const riskLabel = totalWarnings === 0 ? "Low" : totalWarnings === 1 ? "Watch" : "Elevated";
  const scopeLabel = retrievedDocumentCount >= 3 ? "Broad enough" : retrievedDocumentCount >= 1 ? "Narrow" : "Unproven";

  let nextMove = "Gather more evidence before acting on this result.";
  if (citationCount >= 3 && totalWarnings === 0) {
    nextMove = "Safe to extend this into research maps or a saved dossier.";
  } else if (citationCount >= 2 && totalWarnings <= 1) {
    nextMove = "Useful working answer; validate one more source before treating it as settled.";
  } else if (citationCount >= 1) {
    nextMove = "Refine the query or widen the corpus before trusting the synthesis.";
  }

  const summary = totalWarnings === 0
    ? "Vapnik frame: empirical support is visible and the current answer is operating within a manageable risk envelope."
    : "Vapnik frame: the interface should slow trust down here because support and likely error are not yet comfortably separated.";

  return {
    evidenceLabel,
    riskLabel,
    scopeLabel,
    nextMove,
    summary,
    citationCount,
    warningCount: totalWarnings,
    validationPasses,
    validationWarnings,
    retrievedDocumentCount,
    coverageSummary: coverage?.summary || "No explicit coverage note was returned.",
  };
}

function HumanRuntimePanel({ title = "Human runtime protocol", payload, validation = [] }) {
  if (!payload) {
    return (
      <div className="rounded-[24px] border border-dashed border-emerald-300 bg-emerald-50/60 p-5 text-sm text-emerald-900">
        <div className="font-semibold">{title}</div>
        <div className="mt-2 leading-6">No bundle is loaded yet, so the interface cannot estimate empirical support or likely error. Run a query first.</div>
      </div>
    );
  }

  const assessment = buildHumanRuntimeAssessment({
    citations: payload?.citations || [],
    warnings: payload?.warnings || [],
    validation,
    relatedDocuments: payload?.related_documents || [],
    coverage: payload?.coverage || null,
    trace: payload?.trace || null,
  });

  return (
    <div className="rounded-[24px] border border-emerald-200 bg-emerald-50/80 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium uppercase tracking-[0.14em] text-emerald-700">{title}</div>
          <div className="mt-2 text-sm leading-6 text-emerald-950">{assessment.summary}</div>
        </div>
        <Badge className="rounded-full border border-emerald-200 bg-white text-emerald-800">Next move: {assessment.nextMove}</Badge>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <div className="rounded-[18px] border border-emerald-200 bg-white/85 px-3 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700">Evidence</div>
          <div className="mt-2 text-sm text-emerald-950">{assessment.evidenceLabel}</div>
          <div className="mt-1 text-xs text-emerald-800">{assessment.citationCount} citation{assessment.citationCount === 1 ? "" : "s"}</div>
        </div>
        <div className="rounded-[18px] border border-emerald-200 bg-white/85 px-3 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700">Risk</div>
          <div className="mt-2 text-sm text-emerald-950">{assessment.riskLabel}</div>
          <div className="mt-1 text-xs text-emerald-800">{assessment.warningCount} active warning signal{assessment.warningCount === 1 ? "" : "s"}</div>
        </div>
        <div className="rounded-[18px] border border-emerald-200 bg-white/85 px-3 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700">Scope fit</div>
          <div className="mt-2 text-sm text-emerald-950">{assessment.scopeLabel}</div>
          <div className="mt-1 text-xs text-emerald-800">{assessment.retrievedDocumentCount} document signal{assessment.retrievedDocumentCount === 1 ? "" : "s"}</div>
        </div>
        <div className="rounded-[18px] border border-emerald-200 bg-white/85 px-3 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700">Validation</div>
          <div className="mt-2 text-sm text-emerald-950">{assessment.validationWarnings ? "Needs review" : "Clean"}</div>
          <div className="mt-1 text-xs text-emerald-800">{assessment.validationPasses} pass, {assessment.validationWarnings} review flag{assessment.validationWarnings === 1 ? "" : "s"}</div>
        </div>
      </div>
      <div className="mt-4 rounded-[18px] border border-emerald-200 bg-white/80 px-4 py-3 text-sm leading-6 text-emerald-950">
        <span className="font-semibold">Coverage note:</span> {assessment.coverageSummary}
      </div>
    </div>
  );
}

function VapnikSourceCard({ onUseImportPath, onQueueImport, queueing = false, onRunPrompt }) {
  return (
    <div className="rounded-[24px] border border-sky-200 bg-sky-50/80 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <div className="text-sm font-medium uppercase tracking-[0.14em] text-sky-700">Vapnik source profile</div>
          <div className="mt-2 font-serif text-2xl text-sky-950">{VAPNIK_SOURCE_PROFILE.title}</div>
          <div className="mt-2 text-sm leading-6 text-sky-950">{VAPNIK_SOURCE_PROFILE.extractionStatus}</div>
        </div>
        <Badge className="rounded-full border border-sky-200 bg-white text-sky-800">{VAPNIK_SOURCE_PROFILE.localFileSize}</Badge>
      </div>
      <div className="mt-4 rounded-[18px] border border-sky-200 bg-white/80 px-4 py-3 text-xs leading-6 text-sky-900">
        <div className="font-semibold uppercase tracking-[0.14em] text-sky-700">Detected local source</div>
        <div className="mt-2 break-all font-mono">{VAPNIK_SOURCE_PROFILE.localPath}</div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {VAPNIK_SOURCE_PROFILE.usableIdeas.map((idea) => (
          <Badge key={idea} className="rounded-full border border-sky-200 bg-white text-sky-800">{idea}</Badge>
        ))}
      </div>
      <div className="mt-4 rounded-[18px] border border-sky-200 bg-white/80 px-4 py-3 text-sm leading-6 text-sky-950">
        Extracted signal: {VAPNIK_SOURCE_PROFILE.pageCount} pages detected with chapter-level hits for generalization, structural risk minimization, convergence, and consistency.
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {onUseImportPath ? (
          <Button type="button" variant="outline" className="rounded-full border-sky-300 bg-white text-sky-900 hover:bg-sky-100" onClick={onUseImportPath}>
            Use Vapnik import path
          </Button>
        ) : null}
        {onQueueImport ? (
          <Button type="button" className="rounded-full bg-sky-900 text-white hover:bg-sky-800" onClick={onQueueImport} disabled={queueing}>
            {queueing ? "Queueing import..." : "Queue Vapnik import"}
          </Button>
        ) : null}
      </div>
      {onRunPrompt ? (
        <div className="mt-5 space-y-3">
          <div className="text-sm font-medium uppercase tracking-[0.14em] text-sky-700">One-click prompts</div>
          <div className="flex flex-wrap gap-2">
            {VAPNIK_RUNTIME_PROMPTS.map((prompt) => (
              <Button
                key={prompt}
                type="button"
                variant="outline"
                className="h-auto whitespace-normal rounded-full border-sky-300 bg-white px-4 py-2 text-left text-sky-900 hover:bg-sky-100"
                onClick={() => onRunPrompt(prompt)}
              >
                {prompt}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function LawvereCollectionCard({
  collection,
  loading = false,
  error = "",
  onRefresh,
  onQueueImport,
  onMaterializeMap,
  onRunPrompt,
  materializing = false,
}) {
  const stats = collection?.collection_stats || {};
  const chronology = Array.isArray(collection?.chronology) ? collection.chronology : [];
  const themes = Array.isArray(collection?.theme_clusters) ? collection.theme_clusters.filter((item) => (item?.count || 0) > 0).slice(0, 4) : [];
  const candidates = Array.isArray(collection?.formalization_candidates) ? collection.formalization_candidates.slice(0, 4) : [];
  const canonicalDocuments = Array.isArray(collection?.canonical_documents) ? collection.canonical_documents.slice(0, 6) : [];
  const duplicateGroups = Array.isArray(collection?.canonical_documents) ? collection.canonical_documents.filter((item) => (item?.duplicate_count || 0) > 0).slice(0, 4) : [];
  const intents = Array.isArray(collection?.website_design_intents) ? collection.website_design_intents.slice(0, 3) : [];
  const motifs = Array.isArray(collection?.visual_motifs) ? collection.visual_motifs.slice(0, 4) : [];
  const presets = Array.isArray(collection?.prompt_presets) ? collection.prompt_presets.slice(0, 3) : [];

  return (
    <div className="rounded-[24px] border border-amber-200 bg-[linear-gradient(135deg,rgba(255,248,235,0.96),rgba(255,255,255,0.92))] p-5 shadow-[0_24px_70px_rgba(112,73,17,0.10)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-4xl">
          <div className="text-sm font-medium uppercase tracking-[0.14em] text-amber-700">Lawvere collection spine</div>
          <div className="mt-2 font-serif text-2xl text-stone-950">{collection?.collection_label || "Lawvere Collection"}</div>
          <div className="mt-2 text-sm leading-6 text-stone-700">
            Whole-collection category-theory substrate for scoped retrieval, chronology, reviewed website intents, and Lean-facing formalization candidates.
          </div>
        </div>
        <Badge className="rounded-full border border-amber-200 bg-white text-amber-800">
          {loading ? "Loading" : collection?.reviewed ? "Reviewed collection" : "Waiting"}
        </Badge>
      </div>
      {collection?.import_path ? (
        <div className="mt-4 rounded-[18px] border border-amber-200 bg-white/80 px-4 py-3 text-xs leading-6 text-stone-800">
          <div className="font-semibold uppercase tracking-[0.14em] text-amber-700">Canonical import path</div>
          <div className="mt-2 break-all font-mono">{collection.import_path}</div>
        </div>
      ) : null}
      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <div className="rounded-[18px] border border-amber-200 bg-white/85 px-3 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700">Files</div>
          <div className="mt-2 text-sm text-stone-950">{stats.file_count || 0}</div>
        </div>
        <div className="rounded-[18px] border border-amber-200 bg-white/85 px-3 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700">Canonical</div>
          <div className="mt-2 text-sm text-stone-950">{stats.canonical_document_count || 0}</div>
        </div>
        <div className="rounded-[18px] border border-amber-200 bg-white/85 px-3 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700">Collapsed copies</div>
          <div className="mt-2 text-sm text-stone-950">{stats.duplicate_variant_count || 0}</div>
        </div>
        <div className="rounded-[18px] border border-amber-200 bg-white/85 px-3 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700">Imported now</div>
          <div className="mt-2 text-sm text-stone-950">{stats.imported_document_count || 0}</div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" variant="outline" className="rounded-full border-amber-300 bg-white text-amber-900 hover:bg-amber-100" onClick={onRefresh} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh collection"}
        </Button>
        <Button type="button" variant="outline" className="rounded-full border-amber-300 bg-white text-amber-900 hover:bg-amber-100" onClick={onQueueImport}>
          Queue collection import
        </Button>
        <Button type="button" className="rounded-full bg-amber-900 text-white hover:bg-amber-800" onClick={onMaterializeMap} disabled={materializing}>
          {materializing ? "Materializing map..." : "Materialize Lawvere map"}
        </Button>
      </div>
      {presets.length ? (
        <div className="mt-5 space-y-3">
          <div className="text-sm font-medium uppercase tracking-[0.14em] text-amber-700">Quick prompts</div>
          <div className="flex flex-wrap gap-2">
            {presets.map((prompt) => (
              <Button
                key={prompt}
                type="button"
                variant="outline"
                className="h-auto whitespace-normal rounded-full border-amber-300 bg-white px-4 py-2 text-left text-amber-950 hover:bg-amber-100"
                onClick={() => onRunPrompt?.(prompt)}
              >
                {prompt}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="mt-5 grid gap-4 xl:grid-cols-3">
        <div className="rounded-[20px] border border-amber-200 bg-white/80 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-700">Timeline slices</div>
          <div className="mt-3 space-y-3">
            {chronology.slice(0, 4).map((item) => (
              <div key={item.id} className="rounded-[16px] border border-stone-200 bg-stone-50/70 px-3 py-3">
                <div className="font-medium text-stone-950">{item.label}</div>
                <div className="mt-1 text-sm text-stone-600">{item.count || 0} canonical works</div>
                <div className="mt-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-full border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
                    onClick={() => onRunPrompt?.(`Explain the ${item.label} phase in the Lawvere collection and why it matters for the website.`)}
                  >
                    Open timeline slice
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-[20px] border border-amber-200 bg-white/80 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-700">Theme clusters</div>
          <div className="mt-3 space-y-3">
            {themes.map((item) => (
              <div key={item.id} className="rounded-[16px] border border-stone-200 bg-stone-50/70 px-3 py-3">
                <div className="font-medium text-stone-950">{item.label}</div>
                <div className="mt-1 text-sm text-stone-600">{item.summary}</div>
                <div className="mt-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-full border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
                    onClick={() => onRunPrompt?.(`Run a Lawvere-scoped query for ${item.label} and connect it to the website topos.`)}
                  >
                    Run scoped query
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-[20px] border border-amber-200 bg-white/80 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-700">Formalization candidates</div>
          <div className="mt-3 space-y-3">
            {candidates.map((item) => (
              <div key={item.id} className="rounded-[16px] border border-stone-200 bg-stone-50/70 px-3 py-3">
                <div className="font-medium text-stone-950">{item.label}</div>
                <div className="mt-1 text-sm text-stone-600">{item.lean_module}</div>
                <div className="mt-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-full border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
                    onClick={() => onRunPrompt?.(`Open formalization candidates for ${item.label} and explain the Lean bridge.`)}
                  >
                    Open formalization candidates
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {canonicalDocuments.length ? (
        <div className="mt-5 grid gap-4 xl:grid-cols-[1.7fr_1fr]">
          <div className="rounded-[20px] border border-amber-200 bg-white/80 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-700">Canonical works</div>
            <div className="mt-3 space-y-3">
              {canonicalDocuments.map((item) => (
                <div key={item.id} className="rounded-[16px] border border-stone-200 bg-stone-50/70 px-3 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-medium text-stone-950">{item.title}</div>
                      <div className="mt-1 text-sm text-stone-600">
                        {item.year || "Undated"} • {item.duplicate_count ? `${item.duplicate_count} collapsed copies` : "Canonical only"}
                      </div>
                    </div>
                    <Badge className={item.imported ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-stone-200 bg-white text-stone-600"}>
                      {item.imported ? "Imported" : "Not imported"}
                    </Badge>
                  </div>
                  {item.themes?.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {item.themes.slice(0, 3).map((theme) => (
                        <Badge key={`${item.id}-${theme}`} className="border border-stone-200 bg-white text-stone-700">
                          {theme.replace(/_/g, " ")}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-full border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
                      onClick={() => onRunPrompt?.(`Explain ${item.title} in plain language and relate it to the website.`)}
                    >
                      Query this work
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-full border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
                      onClick={() => onRunPrompt?.(`Find Lean-facing formalization opportunities in ${item.title}.`)}
                    >
                      Formalize from this work
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-[20px] border border-amber-200 bg-white/80 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-700">Duplicate collapse visibility</div>
            <div className="mt-3 space-y-3">
              {duplicateGroups.length ? duplicateGroups.map((item) => (
                <div key={`dup-${item.id}`} className="rounded-[16px] border border-stone-200 bg-stone-50/70 px-3 py-3">
                  <div className="font-medium text-stone-950">{item.title}</div>
                  <div className="mt-1 text-sm text-stone-600">{item.duplicate_count} duplicate variants collapsed into one canonical source.</div>
                  <div className="mt-2 text-xs leading-5 text-stone-500">{item.variant_paths?.slice(0, 2).join(" • ")}</div>
                </div>
              )) : (
                <div className="rounded-[16px] border border-stone-200 bg-stone-50/70 px-3 py-3 text-sm text-stone-600">
                  No duplicate variants are visible in the current canonical set.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
      {intents.length ? (
        <div className="mt-5 rounded-[20px] border border-sky-200 bg-sky-50/70 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-sky-700">Reviewed website intents</div>
          <div className="mt-3 space-y-3">
            {intents.map((item) => (
              <div key={item.id} className="rounded-[16px] border border-sky-200 bg-white/80 px-3 py-3 text-sm leading-6 text-sky-950">
                {item.summary}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {motifs.length ? (
        <div className="mt-5 rounded-[20px] border border-violet-200 bg-violet-50/60 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-violet-700">Visual motifs from operator references</div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {motifs.map((item) => (
              <div key={item.id} className="rounded-[16px] border border-violet-200 bg-white/85 px-3 py-3">
                <div className="font-medium text-stone-950">{item.label}</div>
                <div className="mt-1 text-sm leading-6 text-stone-700">{item.summary}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {error ? <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
    </div>
  );
}

function formatBootState(value) {
  return String(value || "checking")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function getBackendProcessCards(bootStatus) {
  const processMap = {
    api: {
      role: "api",
      label: "API server",
      window_title: "Sacred Timeline API",
      script: "backend/run_api.py",
      command: "python backend/run_api.py",
    },
    worker: {
      role: "worker",
      label: "Background worker",
      window_title: "Sacred Timeline Worker",
      script: "backend/run_worker.py",
      command: "python backend/run_worker.py",
    },
    import_monitor: {
      role: "import_monitor",
      label: "Import monitor",
      window_title: "Sacred Timeline Import Monitor",
      script: "scripts/watch-import-progress.ps1",
      command: "powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/watch-import-progress.ps1",
    },
  };

  return ["api", "worker", "import_monitor"].map((key) => ({
    ...processMap[key],
    ...(bootStatus?.[key] || {}),
  }));
}

function BackendProcessCard({ process, compact = false }) {
  return (
    <div className="rounded-[20px] border border-stone-200 bg-white/85 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-semibold text-stone-900">{process.label || process.window_title || "Backend process"}</div>
          <div className="mt-1 text-xs uppercase tracking-[0.14em] text-stone-500">{process.window_title || process.role}</div>
        </div>
        <StatusBadge value={process.running ? (process.healthy ? "running" : "starting") : "offline"} />
      </div>
      <div className="mt-3 space-y-2 text-xs text-stone-600">
        <div>
          Script: <span className="font-mono text-stone-700">{process.script || "unknown"}</span>
        </div>
        <div>
          Command: <span className="font-mono text-stone-700">{process.command || "unknown"}</span>
        </div>
        {process.target_source_path ? (
          <div>
            Target: <span className="font-mono break-all text-stone-700">{process.target_source_path}</span>
          </div>
        ) : null}
        {process.target_job_id ? (
          <div>
            Job: <span className="font-mono text-stone-700">{process.target_job_id}</span>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-3 text-[11px] uppercase tracking-[0.14em] text-stone-500">
          <span>{process.pid ? `PID ${process.pid}` : "PID pending"}</span>
          <span>{process.running ? "Detected locally" : "Not detected"}</span>
          {process.log_path ? <span>{compact ? "Log linked" : process.log_path}</span> : null}
        </div>
      </div>
    </div>
  );
}

function BackendStageRail({ stages = DEFAULT_BOOT_STAGES }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {stages.map((stage) => (
        <div
          key={stage.id}
          className={cn(
            "rounded-[18px] border px-4 py-3 text-sm",
            stage.status === "completed"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : stage.status === "active"
                ? "border-amber-200 bg-amber-50 text-amber-800"
                : "border-stone-200 bg-white/80 text-stone-500"
          )}
        >
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em]">{stage.label}</div>
          <div className="mt-2 font-medium">{formatStatusLabel(stage.status)}</div>
        </div>
      ))}
    </div>
  );
}

function BackendLogPanel({ title, lines = [] }) {
  return (
    <div className="rounded-[22px] border border-stone-200 bg-stone-950 p-4 text-stone-100 shadow-[0_18px_50px_rgba(36,27,13,0.18)]">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-400">{title}</div>
      <div className="mt-3 max-h-48 overflow-auto rounded-[16px] bg-stone-900/70 p-3 font-mono text-[11px] leading-5 text-stone-200">
        {lines.length ? lines.join("\n") : "No console output yet."}
      </div>
    </div>
  );
}

function BackendBootDashboard({
  bootStatus,
  bootLoading = false,
  bootError = "",
  onStart,
  onRetry,
  onUseDemo,
  allowDemo = true,
  starting = false,
}) {
  const processCards = getBackendProcessCards(bootStatus);
  const stages = bootStatus?.stages?.length ? bootStatus.stages : DEFAULT_BOOT_STAGES;
  const apiLogs = bootStatus?.recent_logs?.api || [];
  const workerLogs = bootStatus?.recent_logs?.worker || [];
  const importMonitorLogs = bootStatus?.recent_logs?.import_monitor || [];

  return (
    <div className="mx-auto flex min-h-[calc(100vh-9rem)] max-w-6xl items-center px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full rounded-[34px] border border-stone-200/80 bg-white/94 p-6 shadow-[0_30px_100px_rgba(53,41,18,0.12)] sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl space-y-3">
            <Badge className="w-fit rounded-full border border-stone-200 bg-stone-50 text-stone-700">
              {bootLoading ? "Checking local backend" : formatBootState(bootStatus?.state)}
            </Badge>
            <div className="font-serif text-4xl leading-tight text-stone-950">Library backend startup</div>
            <div className="text-base leading-7 text-stone-600">
              {bootError || bootStatus?.message || "Inspecting the local API server and background worker before the library workspace loads."}
            </div>
            <div className="flex flex-wrap gap-3">
              <Button type="button" className="rounded-full bg-stone-900 text-white hover:bg-stone-800" onClick={onStart} disabled={starting || bootLoading}>
                <Power className={cn("mr-2 h-4 w-4", starting ? "animate-pulse" : "")} />
                {starting ? "Starting backend..." : "Start backend"}
              </Button>
              <Button type="button" variant="outline" className="rounded-full border-stone-300 bg-white" onClick={onRetry} disabled={bootLoading}>
                <RefreshCw className={cn("mr-2 h-4 w-4", bootLoading ? "animate-spin" : "")} />
                Refresh status
              </Button>
              {allowDemo ? (
                <Button type="button" variant="outline" className="rounded-full border-stone-300 bg-white" onClick={onUseDemo}>
                  Open demo mode
                </Button>
              ) : null}
            </div>
          </div>
          <div className="min-w-[220px] rounded-[24px] border border-stone-200 bg-stone-50/80 p-4 text-sm text-stone-700">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">Health check</div>
            <div className="mt-3 flex items-center gap-2">
              <StatusBadge value={bootStatus?.health?.ready ? "healthy" : "offline"} />
              <span>{bootStatus?.health?.ready ? "API responded successfully." : "API health check has not passed yet."}</span>
            </div>
            <div className="mt-3 text-xs text-stone-500">
              {bootStatus?.health?.url || "http://127.0.0.1:8000/api/health"}
            </div>
          </div>
        </div>

        <div className="mt-6">
          <BackendStageRail stages={stages} />
        </div>

        <div className="mt-6 grid gap-4 xl:grid-cols-2">
          {processCards.map((process) => (
            <BackendProcessCard key={process.role} process={process} />
          ))}
        </div>

        <div className="mt-6 grid gap-4 xl:grid-cols-3">
          <BackendLogPanel title="API console" lines={apiLogs} />
          <BackendLogPanel title="Worker console" lines={workerLogs} />
          <BackendLogPanel title="Import monitor" lines={importMonitorLogs} />
        </div>
      </div>
    </div>
  );
}

function BackendPowerControl({ label = "Power on backend", reloadToLive = false, className = "" }) {
  const [starting, setStarting] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [bootStatus, setBootStatus] = useState(null);
  const [checkingStatus, setCheckingStatus] = useState(true);
  const [pendingLiveReload, setPendingLiveReload] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadStatus() {
      try {
        const nextStatus = await fetchBackendBootStatus();
        if (!active) return;
        setBootStatus(nextStatus);
      } catch (error) {
        if (!active) return;
        setFeedback({
          tone: "error",
          message: error instanceof Error ? error.message : "Unable to inspect backend status.",
        });
      } finally {
        if (active) setCheckingStatus(false);
      }
    }

    void loadStatus();

    const unsubscribe = subscribeBackendEvents(
      (nextStatus) => {
        if (!active) return;
        setBootStatus(nextStatus);
        setCheckingStatus(false);
      },
      () => {
        if (!active) return;
        setCheckingStatus(false);
      }
    );

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (!reloadToLive || !pendingLiveReload || !bootStatus?.health?.ready) return;
    clearLocalDemoSession();
    window.location.reload();
  }, [bootStatus?.health?.ready, pendingLiveReload, reloadToLive]);

  async function handlePowerOn() {
    setStarting(true);
    setFeedback(null);

    try {
      const result = await startBackendServices();
      setBootStatus(result);
      if (reloadToLive && result?.health?.ready) {
        clearLocalDemoSession();
        window.location.reload();
        return;
      }
      setPendingLiveReload(Boolean(reloadToLive));
      setFeedback({
        tone: result?.health?.ready ? "success" : "warning",
        message: result?.message || "Launch command ran, but the backend is still offline.",
        launcher: result?.launcher || null,
        scripts: result?.scripts || BACKEND_LAUNCH_COMMANDS,
      });
    } catch (error) {
      setFeedback({ tone: "error", message: error instanceof Error ? error.message : "Unable to start backend services." });
    } finally {
      setStarting(false);
    }
  }

  const processCards = getBackendProcessCards(bootStatus);
  const backendDetected = Boolean(bootStatus?.api?.running || bootStatus?.worker?.running);
  const buttonLabel = starting
    ? "Starting backend..."
    : bootStatus?.health?.ready
      ? "Backend running locally"
      : backendDetected
        ? "Backend processes detected"
        : label;

  return (
    <div className={cn("space-y-2", className)}>
      <Button type="button" className="rounded-full bg-stone-900 text-white hover:bg-stone-800" onClick={() => void handlePowerOn()} disabled={starting}>
        <Power className={cn("mr-2 h-4 w-4", starting ? "animate-pulse" : "")} />
        {buttonLabel}
      </Button>
      <div className="rounded-2xl border border-stone-200 bg-stone-50/80 px-4 py-3 text-xs text-stone-600">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="font-medium uppercase tracking-[0.14em] text-stone-500">Local backend</div>
          {checkingStatus ? (
            <Badge className="rounded-full border border-stone-200 bg-white text-stone-700">Checking...</Badge>
          ) : (
            <Badge className="rounded-full border border-stone-200 bg-white text-stone-700">
              {bootStatus?.health?.ready ? "Healthy" : backendDetected ? "Detected locally" : "Offline"}
            </Badge>
          )}
        </div>
        <div className="mt-3 space-y-2">
          {processCards.map((item) => (
            <div key={item.role} className="rounded-xl border border-stone-200 bg-white px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">{item.label}</div>
                <StatusBadge value={item.running ? (item.healthy ? "running" : "starting") : "offline"} />
              </div>
              <div className="mt-1 font-mono text-[11px] text-stone-700">{item.command || item.script}</div>
              <div className="mt-1 text-[11px] uppercase tracking-[0.14em] text-stone-500">
                {item.window_title || item.role}
                {item.pid ? ` • PID ${item.pid}` : ""}
              </div>
            </div>
          ))}
        </div>
      </div>
      {feedback ? (
        <div
          className={cn(
            "rounded-2xl border px-4 py-3 text-sm",
            feedback.tone === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : feedback.tone === "warning"
                ? "border-amber-200 bg-amber-50 text-amber-800"
                : "border-rose-200 bg-rose-50 text-rose-700"
          )}
        >
          <div>{feedback.message}</div>
          {feedback.launcher?.command ? (
            <div className="mt-3 text-xs text-current/80">
              Wrapper: <span className="font-mono">{feedback.launcher.command}</span>
            </div>
          ) : null}
          {feedback.scripts?.length ? (
            <div className="mt-3 space-y-2">
              {feedback.scripts.map((item, index) => (
                <div key={`${item.script || item.command || "script"}-${index}`} className="rounded-xl border border-current/15 bg-white/60 px-3 py-2 text-xs text-stone-700">
                  <div className="font-semibold text-stone-900">{item.role || item.script || "Python process"}</div>
                  <div className="mt-1 font-mono">{item.command || item.script}</div>
                  <div className="mt-1 text-[11px] uppercase tracking-[0.14em] text-stone-500">
                    {item.pid ? `PID ${item.pid}` : "PID pending"}
                    {item.started ? " • started now" : ""}
                    {item.healthy ? " • healthy" : item.running ? " • running" : ""}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function LibraryAuthGateway({ onAuthenticated }) {
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("librarian");
  const [displayName, setDisplayName] = useState("Local Librarian");
  const [password, setPassword] = useState("library");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const session = mode === "login"
        ? await loginAccount({ username, password })
        : await registerAccount({ username, password, displayName });
      onAuthenticated(session);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Authentication failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[calc(100vh-9rem)] max-w-6xl items-center px-4 py-12 sm:px-6 lg:px-8">
      <div className="grid w-full gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(340px,420px)]">
        <Card className="rounded-[34px] border-stone-200/80 bg-[radial-gradient(circle_at_top_left,_rgba(190,169,108,0.18),_rgba(255,255,255,0.95)_48%)] shadow-[0_30px_100px_rgba(53,41,18,0.12)]">
          <CardHeader className="space-y-5">
            <Badge className="w-fit rounded-full border border-stone-200 bg-white/80 px-3 py-1 text-stone-700">Formal semeiotics workspace</Badge>
            <div className="space-y-3">
              <CardTitle className="max-w-3xl font-serif text-4xl leading-tight text-stone-950">Ask your library, then inspect how the interpretation glues together.</CardTitle>
              <CardDescription className="max-w-2xl text-base text-stone-600">
                This workspace keeps OCR, indexing, retrieval, and citations local. Sign in to move from quick answers into a formal research canvas with triads, diagrams, sheaf checks, simplices, and regime shifts.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <FeaturePill icon={ShieldCheck} title="Local accounts" description="Shared corpus, user-specific notes, maps, and saved investigations." />
            <FeaturePill icon={Waypoints} title="Formal lenses" description="Peircean, Grothendieck, sheaf, simplicial, and catastrophe views run over the same evidence bundle." />
            <FeaturePill icon={BookMarked} title="Citation discipline" description="Answers surface page-level evidence and formal validation warnings by default." />
          </CardContent>
        </Card>

        <Card className="rounded-[30px] border-stone-200/80 bg-white/92 shadow-[0_30px_100px_rgba(53,41,18,0.12)]">
          <CardHeader>
            <CardTitle className="font-serif text-3xl text-stone-900">{mode === "login" ? "Sign in" : "Create local account"}</CardTitle>
            <CardDescription>Use the local backend controls below to detect or start the API server and background worker.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleSubmit}>
              {mode === "register" ? (
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-stone-700">Display name</span>
                  <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
                </label>
              ) : null}
              <label className="block space-y-2">
                <span className="text-sm font-medium text-stone-700">Username</span>
                <Input value={username} onChange={(event) => setUsername(event.target.value)} />
              </label>
              <label className="block space-y-2">
                <span className="text-sm font-medium text-stone-700">Password</span>
                <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
              </label>
              {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
              <Button type="submit" className="h-11 w-full rounded-full bg-stone-900 text-white hover:bg-stone-800" disabled={loading}>
                {loading ? "Working..." : mode === "login" ? "Enter library" : "Create account"}
              </Button>
            </form>
            <div className="mt-6 text-sm text-stone-600">
              {mode === "login" ? "Need a local account?" : "Already have an account?"}{" "}
              <button type="button" className="font-semibold text-stone-900 underline decoration-stone-300 underline-offset-4" onClick={() => setMode((current) => (current === "login" ? "register" : "login"))}>
                {mode === "login" ? "Create one" : "Sign in"}
              </button>
            </div>
            <div className="mt-6 rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-4 py-3 text-sm text-stone-600">
              <div>
                Default local/demo credentials: <span className="font-semibold text-stone-900">librarian / library</span>
              </div>
              <div className="mt-4">
                <div className="mb-3 text-sm text-stone-600">Need the local API and worker online first? Start them here.</div>
                <BackendPowerControl label="Start backend locally" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function QueryResultCard({ result, onSave, onOpenResearch, saving }) {
  if (!result) {
    return (
      <div className="rounded-[24px] border border-dashed border-stone-300 bg-stone-50/80 p-10 text-center text-sm text-stone-500">
        Run a question to populate the evidence pack and unlock the research workspace.
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge value={result.coverage?.status || "ready"} />
        <Badge className="rounded-full border border-stone-200 bg-white text-stone-700">Mode: {formatStatusLabel(result.mode)}</Badge>
        {result.warnings?.length ? <Badge className="rounded-full border border-amber-200 bg-amber-50 text-amber-700">{result.warnings.length} warning{result.warnings.length === 1 ? "" : "s"}</Badge> : null}
      </div>
      <HumanRuntimePanel title="Human runtime protocol" payload={result} />
      <div className="rounded-[24px] border border-stone-200 bg-white p-5">
        <div className="text-sm font-medium uppercase tracking-[0.14em] text-stone-500">Synthesis</div>
        <div className="mt-3 text-base leading-7 text-stone-800">{result.answer}</div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_320px]">
        <div className="rounded-[24px] border border-stone-200 bg-white p-5">
          <div className="text-sm font-medium uppercase tracking-[0.14em] text-stone-500">Citations</div>
          <div className="mt-4 space-y-3">
            {result.citations?.map((citation) => (
              <div key={citation.id} className="rounded-[20px] border border-stone-200 bg-stone-50/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold text-stone-900">{citation.document_title}</div>
                  <Badge className="rounded-full border border-stone-200 bg-white text-stone-700">pp. {citation.page_start}-{citation.page_end}</Badge>
                </div>
                <div className="mt-2 text-sm leading-6 text-stone-700">{citation.quote}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-4">
          <div className="rounded-[24px] border border-stone-200 bg-white p-5">
            <div className="text-sm font-medium uppercase tracking-[0.14em] text-stone-500">Coverage</div>
            <div className="mt-3 text-sm leading-6 text-stone-700">{result.coverage?.summary || "Evidence pack assembled."}</div>
          </div>
          <div className="rounded-[24px] border border-stone-200 bg-white p-5">
            <div className="text-sm font-medium uppercase tracking-[0.14em] text-stone-500">Related documents</div>
            <div className="mt-4 space-y-3">
              {result.related_documents?.map((document) => (
                <div key={document.id} className="flex items-center justify-between gap-3 rounded-2xl bg-stone-50 px-3 py-3 text-sm text-stone-700">
                  <span className="min-w-0 flex-1 truncate">{document.title}</span>
                  <Badge className="rounded-full border border-stone-200 bg-white text-stone-700">{(document.score * 100).toFixed(0)}%</Badge>
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Button className="w-full rounded-full bg-stone-900 text-white hover:bg-stone-800" onClick={onOpenResearch}>Open in Research</Button>
            <Button variant="outline" className="w-full rounded-full border-stone-300 bg-white" onClick={onSave} disabled={saving}>{saving ? "Saving..." : "Save query to dossier"}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ResearchInspector({ bundle, selectedEntity }) {
  const metadataEntries = Object.entries(selectedEntity?.metadata || {});

  return (
    <div className="space-y-4">
      <HumanRuntimePanel title="Research trust protocol" payload={bundle} validation={bundle?.validation || []} />
      <div className="rounded-[24px] border border-stone-200 bg-white p-5">
        <div className="text-sm font-medium uppercase tracking-[0.14em] text-stone-500">Evidence inspector</div>
        <div className="mt-4 space-y-3">
          {bundle?.citations?.map((citation) => (
            <div key={citation.id} className="rounded-[20px] border border-stone-200 bg-stone-50/80 p-4">
              <div className="font-semibold text-stone-900">{citation.document_title}</div>
              <div className="mt-2 text-xs uppercase tracking-[0.14em] text-stone-400">pp. {citation.page_start}-{citation.page_end}</div>
              <div className="mt-2 text-sm leading-6 text-stone-700">{citation.quote}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-[24px] border border-stone-200 bg-white p-5">
        <div className="text-sm font-medium uppercase tracking-[0.14em] text-stone-500">Selected entity</div>
        {selectedEntity ? (
          <div className="mt-4 space-y-3 text-sm text-stone-700">
            <div className="font-semibold text-stone-900">{selectedEntity.label}</div>
            <div className="flex flex-wrap gap-2">
              <Badge className="rounded-full border border-stone-200 bg-stone-50 text-stone-700">{selectedEntity.type}</Badge>
              {selectedEntity.document_id ? <Badge className="rounded-full border border-stone-200 bg-stone-50 text-stone-700">{selectedEntity.document_id}</Badge> : null}
            </div>
            {metadataEntries.length ? (
              <div className="rounded-[20px] border border-stone-200 bg-stone-50/80 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">Operator view</div>
                <div className="mt-3 space-y-2">
                  {metadataEntries.slice(0, 6).map(([key, value]) => (
                    <div key={key} className="flex items-start justify-between gap-3 text-sm">
                      <div className="font-medium text-stone-900">{formatStatusLabel(key)}</div>
                      <div className="max-w-[60%] break-words text-right text-stone-600">
                        {typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : JSON.stringify(value)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <pre className="overflow-x-auto rounded-2xl bg-stone-50 p-3 text-xs text-stone-600">{JSON.stringify(selectedEntity.metadata || {}, null, 2)}</pre>
          </div>
        ) : <div className="mt-4 text-sm text-stone-500">Select a node in the canvas to inspect its formal payload.</div>}
      </div>
    </div>
  );
}

function ResearchNotebook({ bundle, selectedEntity, validation, mapTitle, setMapTitle, onCreateMap, onPinEntity, creatingMap, pinningEntity, maps }) {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_340px]">
      <SectionShell title="Synthesis notebook" description="The research bundle reuses the retrieval evidence but exposes the formal structure and validation trace.">
        {bundle ? (
          <div className="space-y-4">
            <div className="rounded-[24px] border border-sky-200 bg-sky-50/75 p-5 text-sm leading-6 text-sky-950">
              <div className="font-semibold uppercase tracking-[0.14em] text-sky-700">Vapnik operator note</div>
              <div className="mt-3">
                Prefer answers where the evidence count, scope, and validation state all move together. If one grows much faster than the others, widen the corpus or narrow the claim before treating the synthesis as stable.
              </div>
            </div>
            <div className="rounded-[24px] border border-stone-200 bg-stone-50/70 p-5 text-base leading-7 text-stone-800">{bundle.answer}</div>
            <div className="grid gap-3 md:grid-cols-2">
              {validation?.map((item) => (
                <div key={item.id} className={cn("rounded-[22px] border p-4 text-sm", item.status === "pass" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800")}>
                  <div className="font-semibold">{item.title}</div>
                  <div className="mt-2 leading-6">{item.details}</div>
                </div>
              ))}
            </div>
          </div>
        ) : <div className="rounded-[24px] border border-dashed border-stone-300 bg-stone-50/80 p-8 text-sm text-stone-500">No research bundle loaded yet.</div>}
      </SectionShell>

      <SectionShell title="Map pins" description="Persist a user-curated map and pin the current entity into it.">
        <div className="space-y-4">
          <Input value={mapTitle} onChange={(event) => setMapTitle(event.target.value)} placeholder="Continuity map" className="h-12 rounded-full border-stone-300 bg-stone-50/80 px-5" />
          <Button className="w-full rounded-full bg-stone-900 text-white hover:bg-stone-800" onClick={onCreateMap} disabled={creatingMap || !bundle}>{creatingMap ? "Creating map..." : "Create research map"}</Button>
          <Button variant="outline" className="w-full rounded-full border-stone-300 bg-white" onClick={onPinEntity} disabled={pinningEntity || !selectedEntity || !maps.length}>
            {pinningEntity ? "Pinning..." : selectedEntity ? `Pin ${selectedEntity.label}` : "Select an entity to pin"}
          </Button>
          <div className="space-y-3">
            {maps.map((map) => (
              <div key={map.id} className="rounded-[22px] border border-stone-200 bg-stone-50/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-semibold text-stone-900">{map.title}</div>
                  <Badge className="rounded-full border border-stone-200 bg-white text-stone-700">{map.pin_count} pins</Badge>
                </div>
                <div className="mt-2 text-sm text-stone-600">{map.description || "No description yet."}</div>
              </div>
            ))}
          </div>
        </div>
      </SectionShell>
    </div>
  );
}

function LibraryWorkspaceInner({ session, onLogout, bootStatus }) {
  const { gitProfile } = useActivityCenter();
  const [screen, setScreen] = useState("ask");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [documents, setDocuments] = useState([]);
  const [importJobs, setImportJobs] = useState([]);
  const [watchFolders, setWatchFolders] = useState([]);
  const [savedQueries, setSavedQueries] = useState([]);
  const [notes, setNotes] = useState([]);
  const [researchMaps, setResearchMaps] = useState([]);
  const [systemStatus, setSystemStatus] = useState(null);
  const [demoMode, setDemoMode] = useState(false);
  const [query, setQuery] = useState("Compare continuity across Euclid, Peirce, and Thom.");
  const [institutePrompt, setInstitutePrompt] = useState(null);
  const [instituteStatus, setInstituteStatus] = useState("idle");
  const [queryResult, setQueryResult] = useState(null);
  const [researchResult, setResearchResult] = useState(null);
  const [lawvereCollection, setLawvereCollection] = useState(null);
  const [lawvereCollectionError, setLawvereCollectionError] = useState("");
  const [loadingLawvereCollection, setLoadingLawvereCollection] = useState(false);
  const [materializingLawvereCollection, setMaterializingLawvereCollection] = useState(false);
  const [websiteToposExport, setWebsiteToposExport] = useState(null);
  const [websiteToposError, setWebsiteToposError] = useState("");
  const [loadingWebsiteTopos, setLoadingWebsiteTopos] = useState(false);
  const [materializingWebsiteTopos, setMaterializingWebsiteTopos] = useState(false);
  const [activeLens, setActiveLens] = useState("triad");
  const [selectedEntity, setSelectedEntity] = useState(null);
  const [querying, setQuerying] = useState(false);
  const [researching, setResearching] = useState(false);
  const [queryError, setQueryError] = useState("");
  const [researchError, setResearchError] = useState("");
  const [savingQuery, setSavingQuery] = useState(false);
  const [creatingMap, setCreatingMap] = useState(false);
  const [pinningEntity, setPinningEntity] = useState(false);
  const [sourcePath, setSourcePath] = useState("");
  const [importRecursive, setImportRecursive] = useState(true);
  const [watchPath, setWatchPath] = useState("");
  const [importError, setImportError] = useState("");
  const [resettingImportJobs, setResettingImportJobs] = useState(false);
  const [watchError, setWatchError] = useState("");
  const [noteTitle, setNoteTitle] = useState("Research note");
  const [noteContent, setNoteContent] = useState("");
  const [mapTitle, setMapTitle] = useState("Continuity map");
  const [documentsFilter, setDocumentsFilter] = useState("");
  const [marketSymbols, setMarketSymbols] = useState("SPY, QQQ");
  const [marketBenchmark, setMarketBenchmark] = useState("SPY");
  const [marketPeriod, setMarketPeriod] = useState("6mo");
  const [marketInterval, setMarketInterval] = useState("1d");
  const [marketMode, setMarketMode] = useState("auto");
  const [marketRollingWindow, setMarketRollingWindow] = useState("20");
  const [marketMaxExpiries, setMarketMaxExpiries] = useState("2");
  const [marketMaxStrikes, setMarketMaxStrikes] = useState("7");
  const [marketResult, setMarketResult] = useState(null);
  const [marketError, setMarketError] = useState("");
  const [marketLoading, setMarketLoading] = useState(false);
  const [pharmaSymbols, setPharmaSymbols] = useState("VRTX, MRNA, ALNY");
  const [pharmaSyncLimit, setPharmaSyncLimit] = useState("25");
  const [pharmaEvents, setPharmaEvents] = useState([]);
  const [pharmaCycles, setPharmaCycles] = useState([]);
  const [pharmaLeaderboard, setPharmaLeaderboard] = useState([]);
  const [pharmaHomologations, setPharmaHomologations] = useState([]);
  const [pharmaCycleResult, setPharmaCycleResult] = useState(null);
  const [pharmaSyncLoading, setPharmaSyncLoading] = useState(false);
  const [pharmaCycleLoading, setPharmaCycleLoading] = useState(false);
  const [pharmaError, setPharmaError] = useState("");
  const [pharmaBenchmark, setPharmaBenchmark] = useState("XBI");
  const [pharmaTrainWindow, setPharmaTrainWindow] = useState("60");
  const [pharmaTestWindow, setPharmaTestWindow] = useState("20");
  const [pharmaStepSize, setPharmaStepSize] = useState("20");
  const [includeDossierSignals, setIncludeDossierSignals] = useState(true);
  const [dossierAssertions, setDossierAssertions] = useState([]);
  const [dossierSignalWindows, setDossierSignalWindows] = useState([]);
  const [dossierSyncLoading, setDossierSyncLoading] = useState(false);
  const [loadingResources, setLoadingResources] = useState({
    system: false,
    imports: false,
    documents: false,
    saved: false,
    research: false,
    market: false,
  });
  const [loadedResources, setLoadedResources] = useState({
    system: false,
    imports: false,
    documents: false,
    saved: false,
    research: false,
    market: false,
  });
  const deferredDocumentsFilter = useDeferredValue(documentsFilter);
  const releaseTimersRef = useRef({});
  const initializedRef = useRef(false);

  const setResourceLoading = useCallback((resourceKey, value) => {
    setLoadingResources((current) => (current[resourceKey] === value ? current : { ...current, [resourceKey]: value }));
  }, []);

  const setResourceLoaded = useCallback((resourceKey, value) => {
    setLoadedResources((current) => (current[resourceKey] === value ? current : { ...current, [resourceKey]: value }));
  }, []);

  const markDemoFromPayloads = useCallback((...payloads) => {
    const shouldMarkDemo = payloads.some((payload) => Boolean(payload?.demo)) || session?.mode === "demo";
    if (shouldMarkDemo) {
      setDemoMode(true);
    }
  }, [session?.mode]);

  const clearReleaseTimer = useCallback((resourceKey) => {
    const handle = releaseTimersRef.current[resourceKey];
    if (handle) {
      window.clearTimeout(handle);
      delete releaseTimersRef.current[resourceKey];
    }
  }, []);

  const scheduleReleaseTimer = useCallback((resourceKey, releaseFn) => {
    clearReleaseTimer(resourceKey);
    releaseTimersRef.current[resourceKey] = window.setTimeout(() => {
      delete releaseTimersRef.current[resourceKey];
      releaseFn();
    }, SCREEN_CACHE_TTL_MS);
  }, [clearReleaseTimer]);

  const loadSystemData = useCallback(async ({ soft = false } = {}) => {
    if (loadedResources.system && !soft) return systemStatus;
    setResourceLoading("system", true);
    try {
      const nextSystemStatus = await fetchSystemStatus();
      startTransition(() => {
        setSystemStatus(nextSystemStatus);
        markDemoFromPayloads(nextSystemStatus);
        setResourceLoaded("system", true);
      });
      return nextSystemStatus;
    } finally {
      setResourceLoading("system", false);
    }
  }, [loadedResources.system, markDemoFromPayloads, setResourceLoaded, setResourceLoading, systemStatus]);

  const loadImportsData = useCallback(async ({ soft = false } = {}) => {
    if (loadedResources.imports && !soft) return;
    setResourceLoading("imports", true);
    try {
      const [nextJobs, nextWatchFolders] = await Promise.all([
        fetchImportJobs(),
        fetchWatchFolders(),
      ]);
      startTransition(() => {
        setImportJobs(nextJobs.items || EMPTY_ITEMS);
        setWatchFolders(nextWatchFolders.items || EMPTY_ITEMS);
        markDemoFromPayloads(nextJobs, nextWatchFolders);
        setResourceLoaded("imports", true);
      });
    } finally {
      setResourceLoading("imports", false);
    }
  }, [loadedResources.imports, markDemoFromPayloads, setResourceLoaded, setResourceLoading]);

  const loadDocumentsData = useCallback(async ({ soft = false } = {}) => {
    if (loadedResources.documents && !soft) return;
    setResourceLoading("documents", true);
    try {
      const nextDocuments = await fetchDocuments();
      startTransition(() => {
        setDocuments(nextDocuments.items || EMPTY_ITEMS);
        markDemoFromPayloads(nextDocuments);
        setResourceLoaded("documents", true);
      });
    } finally {
      setResourceLoading("documents", false);
    }
  }, [loadedResources.documents, markDemoFromPayloads, setResourceLoaded, setResourceLoading]);

  const loadSavedData = useCallback(async ({ soft = false } = {}) => {
    if (loadedResources.saved && !soft) return;
    setResourceLoading("saved", true);
    try {
      const [nextSavedQueries, nextNotes] = await Promise.all([
        fetchSavedQueries(),
        fetchNotes(),
      ]);
      startTransition(() => {
        setSavedQueries(nextSavedQueries.items || EMPTY_ITEMS);
        setNotes(nextNotes.items || EMPTY_ITEMS);
        markDemoFromPayloads(nextSavedQueries, nextNotes);
        setResourceLoaded("saved", true);
      });
    } finally {
      setResourceLoading("saved", false);
    }
  }, [loadedResources.saved, markDemoFromPayloads, setResourceLoaded, setResourceLoading]);

  const loadResearchData = useCallback(async ({ soft = false } = {}) => {
    if (loadedResources.research && !soft) return;
    setResourceLoading("research", true);
    try {
      const nextResearchMaps = await fetchResearchMaps();
      startTransition(() => {
        setResearchMaps(nextResearchMaps.items || EMPTY_ITEMS);
        markDemoFromPayloads(nextResearchMaps);
        setResourceLoaded("research", true);
      });
    } finally {
      setResourceLoading("research", false);
    }
  }, [loadedResources.research, markDemoFromPayloads, setResourceLoaded, setResourceLoading]);

  const loadLawvereCollectionData = useCallback(async ({ soft = false } = {}) => {
    if (lawvereCollection && !soft) return lawvereCollection;
    setLoadingLawvereCollection(true);
    setLawvereCollectionError("");
    try {
      const [collectionPayload, candidatesPayload] = await Promise.all([
        fetchLawvereCollection(),
        fetchLawvereFormalizationCandidates(),
      ]);
      const nextCollection = {
        ...collectionPayload,
        formalization_candidates: candidatesPayload.items || collectionPayload.formalization_candidates || [],
      };
      startTransition(() => {
        setLawvereCollection(nextCollection);
        markDemoFromPayloads(nextCollection, candidatesPayload);
      });
      return nextCollection;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load the Lawvere collection spine.";
      setLawvereCollectionError(message);
      return null;
    } finally {
      setLoadingLawvereCollection(false);
    }
  }, [lawvereCollection, markDemoFromPayloads]);

  const loadWebsiteToposData = useCallback(async ({ soft = false } = {}) => {
    if (websiteToposExport && !soft) return websiteToposExport;
    setLoadingWebsiteTopos(true);
    setWebsiteToposError("");
    try {
      const nextWebsiteTopos = await fetchWebsiteToposExport();
      startTransition(() => {
        setWebsiteToposExport(nextWebsiteTopos);
        markDemoFromPayloads(nextWebsiteTopos);
      });
      return nextWebsiteTopos;
    } catch (error) {
      setWebsiteToposError(error instanceof Error ? error.message : "Unable to load the reviewed website topos export.");
      return null;
    } finally {
      setLoadingWebsiteTopos(false);
    }
  }, [markDemoFromPayloads, websiteToposExport]);

  const loadMarketData = useCallback(async ({ soft = false } = {}) => {
    if (loadedResources.market && !soft) return;
    setResourceLoading("market", true);
    try {
      const [
        nextSystemStatus,
        nextDossierAssertions,
        nextDossierSignalWindows,
        nextPharmaEvents,
        nextPharmaCycles,
        nextPharmaLeaderboard,
        nextPharmaHomologations,
      ] = await Promise.all([
        loadSystemData({ soft }),
        fetchDossierAssertions({ limit: 24 }),
        fetchDossierSignalWindows({ limit: 24 }),
        fetchPharmaEvents({ limit: 50 }),
        fetchPharmaCycles(),
        fetchPharmaLeaderboard(),
        fetchPharmaHomologations(),
      ]);
      startTransition(() => {
        setSystemStatus(nextSystemStatus || null);
        setDossierAssertions(nextDossierAssertions.items || EMPTY_ITEMS);
        setDossierSignalWindows(nextDossierSignalWindows.items || EMPTY_ITEMS);
        setPharmaEvents(nextPharmaEvents.items || EMPTY_ITEMS);
        setPharmaCycles(nextPharmaCycles.items || EMPTY_ITEMS);
        setPharmaLeaderboard(nextPharmaLeaderboard.items || EMPTY_ITEMS);
        setPharmaHomologations(nextPharmaHomologations.items || EMPTY_ITEMS);
        markDemoFromPayloads(
          nextSystemStatus,
          nextDossierAssertions,
          nextDossierSignalWindows,
          nextPharmaEvents,
          nextPharmaCycles,
          nextPharmaLeaderboard,
          nextPharmaHomologations,
        );
        setResourceLoaded("market", true);
      });
    } finally {
      setResourceLoading("market", false);
    }
  }, [loadedResources.market, loadSystemData, markDemoFromPayloads, setResourceLoaded, setResourceLoading]);

  const loadScreenData = useCallback(async (targetScreen, { soft = false } = {}) => {
    if (soft) setRefreshing(true);
    try {
      if (targetScreen === "ask") {
        await loadSystemData({ soft });
        return;
      }
      if (targetScreen === "imports") {
        await loadImportsData({ soft });
        return;
      }
      if (targetScreen === "documents") {
        await loadDocumentsData({ soft });
        return;
      }
      if (targetScreen === "saved") {
        await loadSavedData({ soft });
        return;
      }
      if (targetScreen === "research") {
        await Promise.all([loadSystemData({ soft }), loadResearchData({ soft })]);
        return;
      }
      if (targetScreen === "lawvere") {
        await Promise.all([loadSystemData({ soft }), loadResearchData({ soft }), loadLawvereCollectionData({ soft })]);
        return;
      }
      if (targetScreen === "market") {
        await loadMarketData({ soft });
      }
    } finally {
      setRefreshing(false);
    }
  }, [loadDocumentsData, loadImportsData, loadLawvereCollectionData, loadMarketData, loadResearchData, loadSavedData, loadSystemData]);

  useEffect(() => {
    if (initializedRef.current) return undefined;
    initializedRef.current = true;
    let active = true;
    setLoading(true);
    loadScreenData("ask")
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [loadScreenData]);

  useEffect(() => {
    if (loading) return;
    void loadScreenData(screen);
  }, [loading, loadScreenData, screen]);

  useEffect(() => {
    if (screen !== "research") return;
    if (websiteToposExport || loadingWebsiteTopos) return;
    void loadWebsiteToposData();
  }, [loadWebsiteToposData, loadingWebsiteTopos, screen, websiteToposExport]);

  useEffect(() => {
    setDemoMode(session?.mode === "demo");
  }, [session?.mode]);

  useEffect(() => {
    const releasePolicies = [
      {
        key: "imports",
        active: screen === "imports",
        release: () => {
          setImportJobs(EMPTY_ITEMS);
          setWatchFolders(EMPTY_ITEMS);
          setResourceLoaded("imports", false);
        },
      },
      {
        key: "documents",
        active: screen === "documents",
        release: () => {
          setDocuments(EMPTY_ITEMS);
          setDocumentsFilter("");
          setResourceLoaded("documents", false);
        },
      },
      {
        key: "saved",
        active: screen === "saved",
        release: () => {
          setSavedQueries(EMPTY_ITEMS);
          setNotes(EMPTY_ITEMS);
          setResourceLoaded("saved", false);
        },
      },
      {
        key: "research",
        active: screen === "research",
        release: () => {
          setResearchMaps(EMPTY_ITEMS);
          setResearchResult(null);
          setSelectedEntity(null);
          setResourceLoaded("research", false);
        },
      },
      {
        key: "market",
        active: screen === "market",
        release: () => {
          setDossierAssertions(EMPTY_ITEMS);
          setDossierSignalWindows(EMPTY_ITEMS);
          setPharmaEvents(EMPTY_ITEMS);
          setPharmaCycles(EMPTY_ITEMS);
          setPharmaLeaderboard(EMPTY_ITEMS);
          setPharmaHomologations(EMPTY_ITEMS);
          setMarketResult(null);
          setPharmaCycleResult(null);
          setResourceLoaded("market", false);
        },
      },
    ];

    for (const policy of releasePolicies) {
      if (policy.active) {
        clearReleaseTimer(policy.key);
        continue;
      }
      scheduleReleaseTimer(policy.key, policy.release);
    }
  }, [clearReleaseTimer, scheduleReleaseTimer, screen, setResourceLoaded]);

  useEffect(() => () => {
    Object.values(releaseTimersRef.current).forEach((handle) => window.clearTimeout(handle));
  }, []);

  const filteredDocuments = useMemo(() => {
    const normalized = deferredDocumentsFilter.trim().toLowerCase();
    if (!normalized) return documents;
    return documents.filter((document) =>
      [document.title, document.summary, document.source_path, document.file_type, document.language]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
      .includes(normalized)
    );
  }, [deferredDocumentsFilter, documents]);
  const marketProvider = systemStatus?.providers?.market_data || null;
  const pharmaProvider = systemStatus?.providers?.pharma_news || null;
  const dossierProvider = systemStatus?.providers?.dossier_news || null;

  const runLibraryAsk = useCallback(async (nextQuery = query, options = {}) => {
    const scope = options?.scope || {};
    setQuerying(true);
    setQueryError("");
    try {
      const result = await runLibraryQuery({ query: nextQuery, scope });
      setQueryResult(result);
      setScreen("ask");
      return result;
    } catch (error) {
      setQueryError(error instanceof Error ? error.message : "Query failed.");
      return null;
    } finally {
      setQuerying(false);
    }
  }, [query]);

  const runFormalResearch = useCallback(async (nextQuery = query, options = {}) => {
    const scope = options?.scope || {};
    setResearching(true);
    setResearchError("");
    try {
      const result = await runResearchQuery({ query: nextQuery, preferredLens: activeLens, scope });
      setResearchResult(result);
      setActiveLens(result.lens_payloads?.[0]?.key || "triad");
      setSelectedEntity(result.entities?.[0] || null);
      setResourceLoaded("research", true);
      clearReleaseTimer("research");
      setScreen("research");
      return result;
    } catch (error) {
      setResearchError(error instanceof Error ? error.message : "Research query failed.");
      return null;
    } finally {
      setResearching(false);
    }
  }, [activeLens, clearReleaseTimer, query, setResourceLoaded]);

  const runSuggestedAskPrompt = useCallback(async (nextQuery) => {
    if (!nextQuery) return;
    setQuery(nextQuery);
    await loadSystemData();
    await runLibraryAsk(nextQuery);
  }, [loadSystemData, runLibraryAsk]);

  const runSuggestedResearchPrompt = useCallback(async (nextQuery) => {
    if (!nextQuery) return;
    setQuery(nextQuery);
    await Promise.all([loadSystemData(), loadResearchData()]);
    await runFormalResearch(nextQuery);
  }, [loadResearchData, loadSystemData, runFormalResearch]);

  const runSuggestedLawverePrompt = useCallback(async (nextQuery) => {
    if (!nextQuery) return;
    setQuery(nextQuery);
    await Promise.all([loadSystemData(), loadResearchData(), loadLawvereCollectionData({ soft: true })]);
    await runFormalResearch(nextQuery, { scope: LAWVERE_SCOPE });
    setScreen("lawvere");
  }, [loadLawvereCollectionData, loadResearchData, loadSystemData, runFormalResearch]);

  const applyInstitutePrompt = useCallback(async (prompt) => {
    if (!prompt?.query) return;
    setInstitutePrompt(prompt);
    setInstituteStatus("routing");
    setQuery(prompt.query);

    if (prompt.mode === "ask") {
      await loadSystemData();
      await runLibraryAsk(prompt.query);
      setInstituteStatus("routed");
      return;
    }

    if (prompt.mode === "topos") {
      await Promise.all([loadSystemData(), loadResearchData(), loadWebsiteToposData({ soft: true })]);
      await runFormalResearch(prompt.query);
      setInstituteStatus("topos_routed");
      return;
    }

    if (prompt.mode === "lawvere") {
      await Promise.all([loadSystemData(), loadResearchData(), loadLawvereCollectionData({ soft: true })]);
      await runFormalResearch(prompt.query, { scope: LAWVERE_SCOPE });
      setScreen("lawvere");
      setInstituteStatus("lawvere_routed");
      return;
    }

    await Promise.all([loadSystemData(), loadResearchData()]);
    await runFormalResearch(prompt.query);
    setInstituteStatus("routed");
  }, [loadLawvereCollectionData, loadResearchData, loadSystemData, loadWebsiteToposData, runFormalResearch, runLibraryAsk]);

  async function handleQuerySubmit(event) {
    event.preventDefault();
    await runLibraryAsk(query);
  }

  async function handleResearchSubmit(event) {
    event.preventDefault();
    await runFormalResearch(query);
  }

  async function handleMarketSubmit(event) {
    event.preventDefault();
    setMarketLoading(true);
    setMarketError("");
    try {
      const symbols = marketSymbols
        .split(",")
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean);
      const result = await runMarketAnalysis({
        symbols,
        benchmark_symbol: marketBenchmark.trim().toUpperCase() || "SPY",
        period: marketPeriod,
        interval: marketInterval,
        mode: marketMode,
        max_expiries: Number(marketMaxExpiries || 2),
        max_strikes_per_expiry: Number(marketMaxStrikes || 7),
        rolling_window: Number(marketRollingWindow || 20),
        k_neighbors: 4,
        risk_free_rate: 0,
      });
      setMarketResult(result);
      setResourceLoaded("market", true);
      clearReleaseTimer("market");
      setScreen("market");
    } catch (error) {
      setMarketError(error instanceof Error ? error.message : "Market analysis failed.");
    } finally {
      setMarketLoading(false);
    }
  }

  async function handlePharmaSync(event) {
    event.preventDefault();
    setPharmaSyncLoading(true);
    setPharmaError("");
    try {
      const symbols = pharmaSymbols
        .split(",")
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean);
      const result = await syncPharmaEvents({
        symbols,
        limit: Number(pharmaSyncLimit || 25),
      });
      setPharmaEvents(result.items || []);
      setResourceLoaded("market", true);
      clearReleaseTimer("market");
    } catch (error) {
      setPharmaError(error instanceof Error ? error.message : "Pharma sync failed.");
    } finally {
      setPharmaSyncLoading(false);
    }
  }

  async function handleDossierSync() {
    setDossierSyncLoading(true);
    setPharmaError("");
    try {
      const result = await syncDossiers({
        document_limit: 100,
        assertion_limit_per_document: 24,
      });
      setDossierAssertions(result.assertions || []);
      setDossierSignalWindows(result.signal_windows || []);
      setResourceLoaded("market", true);
      clearReleaseTimer("market");
    } catch (error) {
      setPharmaError(error instanceof Error ? error.message : "Dossier sync failed.");
    } finally {
      setDossierSyncLoading(false);
    }
  }

  async function handlePharmaCycle(event) {
    event.preventDefault();
    setPharmaCycleLoading(true);
    setPharmaError("");
    try {
      const symbols = pharmaSymbols
        .split(",")
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean);
      const result = await runPharmaCycle({
        symbols,
        benchmark_symbol: pharmaBenchmark.trim().toUpperCase() || "XBI",
        period: "1y",
        interval: "1d",
        train_window: Number(pharmaTrainWindow || 60),
        test_window: Number(pharmaTestWindow || 20),
        step_size: Number(pharmaStepSize || 20),
        pre_window: 20,
        post_window: 1,
        max_events: Number(pharmaSyncLimit || 25),
        max_expiries: 2,
        max_strikes_per_expiry: 7,
        rolling_window: 20,
        k_neighbors: 4,
        risk_free_rate: 0,
        include_dossier_signals: includeDossierSignals,
      });
      setPharmaCycleResult(result);
      setPharmaCycles((current) => [result.cycle, ...current.filter((item) => item.id !== result.cycle?.id)]);
      setPharmaLeaderboard(result.leaderboard || []);
      const refreshedHomologations = await fetchPharmaHomologations();
      setPharmaHomologations(refreshedHomologations.items || []);
      setResourceLoaded("market", true);
      clearReleaseTimer("market");
    } catch (error) {
      setPharmaError(error instanceof Error ? error.message : "Pharma cycle failed.");
    } finally {
      setPharmaCycleLoading(false);
    }
  }

  async function openResearchFromAsk() {
    if (!queryResult?.research_bundle_id) {
      setScreen("research");
      return;
    }
    setResearching(true);
    setResearchError("");
    try {
      const result = await fetchResearchBundle(queryResult.research_bundle_id);
      setResearchResult(result);
      setActiveLens(result.lens_payloads?.[0]?.key || "triad");
      setSelectedEntity(result.entities?.[0] || null);
      setResourceLoaded("research", true);
      clearReleaseTimer("research");
      setScreen("research");
    } catch (error) {
      setResearchError(error instanceof Error ? error.message : "Unable to load research bundle.");
      setScreen("research");
    } finally {
      setResearching(false);
    }
  }

  const queueImportJobForPath = useCallback(async (path) => {
    if (!String(path || "").trim()) {
      setImportError("Choose a local file or folder before queueing an import.");
      return;
    }
    setImportError("");
    try {
      const normalizedPath = String(path).trim();
      const nextJob = await createImportJob({ sourcePath: normalizedPath, recursive: importRecursive });
      setImportJobs((current) => [nextJob, ...current]);
      setResourceLoaded("imports", true);
      clearReleaseTimer("imports");
      setSourcePath("");
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Unable to queue import job.");
    }
  }, [clearReleaseTimer, importRecursive, setResourceLoaded]);

  function useDetectedVapnikImportPath() {
    setScreen("imports");
    setImportError("");
    setSourcePath(VAPNIK_SOURCE_PROFILE.localPath);
  }

  async function handleQueueDetectedVapnikImport() {
    setScreen("imports");
    setSourcePath(VAPNIK_SOURCE_PROFILE.localPath);
    await queueImportJobForPath(VAPNIK_SOURCE_PROFILE.localPath);
  }

  async function handleQueueLawvereCollectionImport() {
    const importPath = lawvereCollection?.import_path;
    if (!importPath) {
      setLawvereCollectionError("Lawvere import path is unavailable.");
      return;
    }
    setScreen("imports");
    setSourcePath(importPath);
    await queueImportJobForPath(importPath);
  }

  async function handleMaterializeLawvereCollectionMap() {
    setMaterializingLawvereCollection(true);
    setLawvereCollectionError("");
    try {
      const result = await materializeLawvereMap({
        title: lawvereCollection?.research_map_seed?.title || "Lawvere Collection Spine",
        description: lawvereCollection?.research_map_seed?.description || "Lawvere chronology, themes, and reviewed formalization candidates.",
      });
      setResearchMaps((current) => [result.map, ...current.filter((item) => item.id !== result.map.id)]);
      setScreen("lawvere");
    } catch (error) {
      setLawvereCollectionError(error instanceof Error ? error.message : "Unable to materialize the Lawvere collection map.");
    } finally {
      setMaterializingLawvereCollection(false);
    }
  }

  async function handleCreateImportJob(event) {
    event.preventDefault();
    await queueImportJobForPath(sourcePath);
  }

  async function handleResetImportJobs() {
    if (!importJobs.length) return;
    const confirmed = window.confirm("Reset import jobs? This clears import job history and job artifacts, but keeps indexed documents.");
    if (!confirmed) return;
    setResettingImportJobs(true);
    setImportError("");
    try {
      await resetImportJobs();
      setImportJobs([]);
      setResourceLoaded("imports", true);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Unable to reset import jobs.");
    } finally {
      setResettingImportJobs(false);
    }
  }

  async function handleCreateWatchFolder(event) {
    event.preventDefault();
    setWatchError("");
    try {
      const nextWatchFolder = await createWatchFolder({ path: watchPath });
      setWatchFolders((current) => [nextWatchFolder, ...current]);
      setResourceLoaded("imports", true);
      clearReleaseTimer("imports");
      setWatchPath("");
    } catch (error) {
      setWatchError(error instanceof Error ? error.message : "Unable to create watch folder.");
    }
  }

  async function handleSaveQuery() {
    if (!queryResult) return;
    setSavingQuery(true);
    try {
      const saved = await saveQuery({
        title: query.slice(0, 72),
        query_text: query,
        mode: queryResult.mode,
        research_bundle_id: queryResult.research_bundle_id || null,
        response: queryResult,
      });
      setSavedQueries((current) => [saved, ...current]);
      setResourceLoaded("saved", true);
      clearReleaseTimer("saved");
      setScreen("saved");
    } finally {
      setSavingQuery(false);
    }
  }

  async function handleCreateNote(event) {
    event.preventDefault();
    const nextNote = await createNote({
      title: noteTitle,
      content: noteContent,
      document_id: queryResult?.citations?.[0]?.document_id || selectedEntity?.document_id || null,
      entity_id: selectedEntity?.id || null,
    });
    setNotes((current) => [nextNote, ...current]);
    setResourceLoaded("saved", true);
    clearReleaseTimer("saved");
    setNoteContent("");
  }

  async function handleCreateResearchMap() {
    if (!researchResult) return;
    setCreatingMap(true);
    try {
      const nextMap = await createResearchMap({
        title: mapTitle,
        description: `Pinned from ${researchResult.mode} bundle.`,
        bundle_id: researchResult.id,
        layout: { lens: activeLens },
      });
      setResearchMaps((current) => [nextMap, ...current]);
      setResourceLoaded("research", true);
      clearReleaseTimer("research");
    } finally {
      setCreatingMap(false);
    }
  }

  async function handleMaterializeWebsiteToposMap() {
    setMaterializingWebsiteTopos(true);
    setWebsiteToposError("");
    try {
      const result = await materializeWebsiteToposMap({
        title: websiteToposExport?.research_map_seed?.title || "Website Topos - Canonical Shell",
      });
      if (result?.map) {
        setResearchMaps((current) => {
          const remaining = current.filter((item) => item.id !== result.map.id);
          return [result.map, ...remaining];
        });
        setMapTitle(result.map.title || "Website Topos - Canonical Shell");
        setResourceLoaded("research", true);
        clearReleaseTimer("research");
      }
      markDemoFromPayloads(result);
    } catch (error) {
      setWebsiteToposError(error instanceof Error ? error.message : "Unable to materialize the website topos map.");
    } finally {
      setMaterializingWebsiteTopos(false);
    }
  }

  async function handlePinSelectedEntity() {
    if (!selectedEntity || !researchMaps.length) return;
    setPinningEntity(true);
    try {
      const targetMap = researchMaps[0];
      await pinResearchEntity(targetMap.id, {
        entity_id: selectedEntity.id,
        pin_type: selectedEntity.type,
        payload: { label: selectedEntity.label, lens: activeLens },
      });
      setResearchMaps((current) => current.map((item) => item.id === targetMap.id ? { ...item, pin_count: (item.pin_count || 0) + 1 } : item));
    } finally {
      setPinningEntity(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto flex min-h-[calc(100vh-9rem)] max-w-6xl items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
        <div className="w-full max-w-4xl rounded-[28px] border border-stone-200 bg-white/92 p-6 text-stone-700 shadow-[0_30px_80px_rgba(53,41,18,0.12)]">
          <div className="font-serif text-3xl text-stone-900">Loading semantic workspace...</div>
          <div className="mt-2 text-sm leading-6 text-stone-600">
            Backend session is ready. Loading only the minimum workspace state first, then deferring heavier data until each screen is opened.
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {getBackendProcessCards(bootStatus).map((process) => (
              <BackendProcessCard key={process.role} process={process} compact />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-[calc(100vh-5rem)] max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <Card className="rounded-[28px] border-stone-200/80 bg-stone-950 text-stone-50 shadow-[0_28px_70px_rgba(36,27,13,0.26)]">
            <CardHeader className="space-y-4">
              <Badge className="w-fit rounded-full border border-stone-700 bg-stone-900 text-stone-100">{demoMode ? "Demo-backed" : "Live backend"}</Badge>
              <div>
                <CardTitle className="font-serif text-3xl">Library</CardTitle>
                <CardDescription className="mt-2 text-stone-300">Signed in as {session?.user?.display_name || session?.user?.username || "operator"}.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {SCREENS.map((item) => {
                const Icon = item.icon;
                return (
                  <button key={item.id} type="button" onClick={() => setScreen(item.id)} className={cn("flex w-full items-center gap-3 rounded-[18px] px-4 py-3 text-left transition", screen === item.id ? "bg-white text-stone-900" : "bg-stone-900/40 text-stone-200 hover:bg-stone-800/70")}>
                    <Icon className="h-4 w-4" />
                    <span className="font-medium">{item.label}</span>
                  </button>
                );
              })}
            </CardContent>
          </Card>
          <Card className="rounded-[28px] border-stone-200/80 bg-white/85">
            <CardContent className="pt-6">
              <div className="space-y-3 text-sm text-stone-700">
                <div className="flex items-center gap-2"><Files className="h-4 w-4 text-stone-500" /><span>{loadedResources.documents ? `${documents.length} documents tracked` : "Documents load on demand"}</span></div>
                <div className="flex items-center gap-2"><Waypoints className="h-4 w-4 text-stone-500" /><span>{loadedResources.imports ? `${watchFolders.length} watch folders` : "Import state loads on demand"}</span></div>
                <div className="flex items-center gap-2"><LockKeyhole className="h-4 w-4 text-stone-500" /><span>{loadedResources.saved ? `${savedQueries.length} saved dossiers` : "Saved dossiers load on demand"}</span></div>
                <div className="flex items-center gap-2"><Telescope className="h-4 w-4 text-stone-500" /><span>{loadedResources.research ? `${researchMaps.length} research maps` : "Research maps load on demand"}</span></div>
              </div>
              {!demoMode ? (
                <div className="mt-5 space-y-3">
                  {getBackendProcessCards(bootStatus).map((process) => (
                    <div key={process.role} className="rounded-[18px] border border-stone-200 bg-stone-50/80 px-3 py-3 text-xs text-stone-600">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-stone-900">{process.label}</span>
                        <StatusBadge value={process.running ? (process.healthy ? "running" : "starting") : "offline"} />
                      </div>
                      <div className="mt-2 font-mono text-[11px] text-stone-700">{process.command || process.script}</div>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="mt-5 flex flex-wrap gap-2">
                <Button variant="outline" className="rounded-full border-stone-300 bg-white" onClick={() => void loadScreenData(screen, { soft: true })}>
                  <RefreshCw className={cn("mr-2 h-4 w-4", refreshing ? "animate-spin" : "")} />
                  Refresh
                </Button>
                <Button variant="outline" className="rounded-full border-stone-300 bg-white" onClick={onLogout}>Sign out</Button>
              </div>
            </CardContent>
          </Card>
        </aside>

        <ScrollArea className="min-h-[calc(100vh-8rem)] rounded-[32px]">
          <div className="space-y-6 pb-8">
            <ActivityModuleStrip
              module="library"
              title="Library activity"
              description="Connection state, provider readiness, import pipeline warnings, and unfinished research/runtime ticks all land here."
            />
            {!demoMode && session?.mode === "live" && !gitProfile?.repo_path ? (
              <div className="rounded-[26px] border border-sky-200 bg-sky-50/90 px-5 py-4 text-sm text-sky-900 shadow-[0_20px_50px_rgba(65,137,211,0.10)]">
                Private approvals are ready in the shared Activity Center. Configure a local git repo there once, and future private reviews will export and auto-commit from inside the interface.
              </div>
            ) : null}
            {demoMode ? (
              <div className="rounded-[26px] border border-amber-200 bg-amber-50/90 px-5 py-4 text-sm text-amber-800 shadow-[0_20px_50px_rgba(186,128,25,0.12)]">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="max-w-3xl">
                    Backend API is unavailable, so the workspace is using built-in demo data and mock auth. Power on the local backend to return to live retrieval, real jobs, and persisted sessions.
                  </div>
                  <BackendPowerControl label="Power on backend" reloadToLive className="shrink-0" />
                </div>
              </div>
            ) : null}
            {institutePrompt ? (
              <div className="rounded-[26px] border border-sky-200 bg-sky-50/90 px-5 py-4 text-sm text-sky-900 shadow-[0_20px_50px_rgba(65,137,211,0.10)]">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="max-w-4xl">
                    <div className="font-semibold">HungryTopos institute intake</div>
                    <div className="mt-1">
                      Routed from <span className="font-mono">{institutePrompt.sourcePathname}</span> into <span className="font-semibold">{institutePrompt.mode}</span> mode.
                    </div>
                    <div className="mt-2 rounded-2xl border border-sky-200 bg-white/70 px-4 py-3 text-sky-950">
                      {institutePrompt.query}
                    </div>
                  </div>
                  <Badge className="w-fit rounded-full border border-sky-200 bg-white text-sky-800">
                    {instituteStatus === "topos_routed" ? "Topos routed" : instituteStatus === "lawvere_routed" ? "Lawvere routed" : instituteStatus === "routed" ? "Routed" : "Routing"}
                  </Badge>
                </div>
              </div>
            ) : null}
            {screen === "ask" ? (
              <>
                <SectionShell title="Ask with citations" description="Route questions to passage, section, book, or cross-book synthesis and always keep the supporting evidence visible.">
                  <div className="mb-6">
                    <VapnikSourceCard onRunPrompt={(prompt) => void runSuggestedAskPrompt(prompt)} />
                  </div>
                  <form className="space-y-4" onSubmit={handleQuerySubmit}>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-4 top-6 h-4 w-4 text-stone-400" />
                      <textarea className="min-h-32 w-full rounded-[24px] border border-stone-200 bg-stone-50/80 px-12 py-4 text-base text-stone-800 outline-none focus:border-stone-400" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Compare the metaphysics of continuity across Peirce, Thom, and Grothendieck." />
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <Button type="submit" className="rounded-full bg-stone-900 text-white hover:bg-stone-800" disabled={querying}>{querying ? "Querying..." : "Run synthesis"}</Button>
                      <Badge className="rounded-full border border-stone-200 bg-white text-stone-700">Retrieval: hybrid coarse-to-fine</Badge>
                      <Badge className="rounded-full border border-stone-200 bg-white text-stone-700">Research link: persisted bundle</Badge>
                    </div>
                    {queryError ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{queryError}</div> : null}
                  </form>
                </SectionShell>
                <QueryResultCard result={queryResult} onSave={handleSaveQuery} onOpenResearch={() => void openResearchFromAsk()} saving={savingQuery} />
              </>
            ) : null}
            {screen === "research" ? (
              <div className="space-y-6">
                <SectionShell title="Research workspace" description="Drive the same evidence bundle through all five formal lenses, pin durable entities, and inspect validation traces.">
                  {loadingResources.research && !researchMaps.length && !researchResult ? (
                    <div className="mb-6 rounded-[24px] border border-dashed border-stone-300 bg-stone-50/80 p-8 text-sm text-stone-500">
                      Loading research maps and formal workspace tools only when the research screen is opened.
                    </div>
                  ) : null}
                  <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)_320px]">
                    <div className="space-y-4">
                      <VapnikSourceCard onRunPrompt={(prompt) => void runSuggestedResearchPrompt(prompt)} />
                      <form className="space-y-4" onSubmit={handleResearchSubmit}>
                        <textarea className="min-h-40 w-full rounded-[24px] border border-stone-200 bg-stone-50/80 px-5 py-4 text-base text-stone-800 outline-none focus:border-stone-400" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ask for a formal comparison across your corpus." />
                        <Button type="submit" className="w-full rounded-full bg-stone-900 text-white hover:bg-stone-800" disabled={researching}>{researching ? "Building bundle..." : "Run research query"}</Button>
                        {researchError ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{researchError}</div> : null}
                      </form>
                      <div className="rounded-[24px] border border-stone-200 bg-stone-50/70 p-4">
                        <div className="text-sm font-medium uppercase tracking-[0.14em] text-stone-500">Lens switcher</div>
                        <div className="mt-4">
                          <Suspense fallback={<div className="rounded-2xl border border-dashed border-stone-300 bg-white/80 px-4 py-5 text-sm text-stone-500">Loading lens tools...</div>}>
                            <LazyLensSwitcher activeLens={activeLens} onChange={setActiveLens} lensPayloads={researchResult?.lens_payloads || []} />
                          </Suspense>
                        </div>
                      </div>
                      <div className="rounded-[24px] border border-stone-200 bg-stone-50/70 p-4">
                        <div className="text-sm font-medium uppercase tracking-[0.14em] text-stone-500">Bundle state</div>
                        <div className="mt-3 text-sm leading-6 text-stone-700">{researchResult ? `Loaded ${researchResult.mode} bundle ${researchResult.id}.` : "No research bundle loaded yet."}</div>
                      </div>
                      <div className="rounded-[24px] border border-sky-200 bg-sky-50/75 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-medium uppercase tracking-[0.14em] text-sky-700">HungryTopos institute</div>
                            <div className="mt-2 text-sm leading-6 text-sky-950">
                              Keep the reviewed website topos and its research-map projection inside the library so global prompts can feed back into a canonical category-theory substrate.
                            </div>
                          </div>
                          <Badge className="rounded-full border border-sky-200 bg-white text-sky-800">
                            {loadingWebsiteTopos ? "Loading export" : websiteToposExport?.reviewed ? "Reviewed export" : "Waiting"}
                          </Badge>
                        </div>
                        <div className="mt-4 grid gap-3 sm:grid-cols-3">
                          <div className="rounded-[18px] border border-sky-200 bg-white/80 px-3 py-3">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-700">Objects</div>
                            <div className="mt-2 text-sm text-sky-950">{websiteToposExport?.objects?.length || 0}</div>
                          </div>
                          <div className="rounded-[18px] border border-sky-200 bg-white/80 px-3 py-3">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-700">Morphisms</div>
                            <div className="mt-2 text-sm text-sky-950">{websiteToposExport?.morphisms?.length || 0}</div>
                          </div>
                          <div className="rounded-[18px] border border-sky-200 bg-white/80 px-3 py-3">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-700">Cycle rank</div>
                            <div className="mt-2 text-sm text-sky-950">{websiteToposExport?.cohomology_summary?.cycle_rank_estimate ?? "n/a"}</div>
                          </div>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            className="rounded-full border-sky-300 bg-white text-sky-900 hover:bg-sky-100"
                            onClick={() => void loadWebsiteToposData({ soft: true })}
                            disabled={loadingWebsiteTopos}
                          >
                            {loadingWebsiteTopos ? "Refreshing export..." : "Refresh website topos"}
                          </Button>
                          <Button
                            type="button"
                            className="rounded-full bg-sky-900 text-white hover:bg-sky-800"
                            onClick={() => void handleMaterializeWebsiteToposMap()}
                            disabled={materializingWebsiteTopos}
                          >
                            {materializingWebsiteTopos ? "Materializing map..." : "Materialize website topos map"}
                          </Button>
                        </div>
                        {websiteToposExport?.source_ref ? (
                          <div className="mt-4 text-xs uppercase tracking-[0.14em] text-sky-700">
                            Source ref: {websiteToposExport.source_ref}
                          </div>
                        ) : null}
                        {lawvereCollection?.website_design_intents?.length ? (
                          <div className="mt-4 rounded-[18px] border border-amber-200 bg-amber-50/70 px-4 py-4 text-sm text-amber-950">
                            <div className="font-semibold uppercase tracking-[0.14em] text-amber-700">Lawvere design review</div>
                            <div className="mt-3 space-y-2">
                              {lawvereCollection.website_design_intents.slice(0, 2).map((intent) => (
                                <div key={intent.id}>{intent.summary}</div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        {websiteToposError ? <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{websiteToposError}</div> : null}
                      </div>
                    </div>
                    <Suspense fallback={<div className="min-h-[420px] rounded-[28px] border border-dashed border-stone-300 bg-stone-50/80 p-8 text-sm text-stone-500">Loading the active research lens only when the formal workspace is open.</div>}>
                      <LazyResearchVisualizationCanvas bundle={researchResult} activeLens={activeLens} selectedEntityId={selectedEntity?.id} onSelectEntity={setSelectedEntity} />
                    </Suspense>
                    <ResearchInspector bundle={researchResult} selectedEntity={selectedEntity} />
                  </div>
                </SectionShell>
                <ResearchNotebook bundle={researchResult} selectedEntity={selectedEntity} validation={researchResult?.validation || []} mapTitle={mapTitle} setMapTitle={setMapTitle} onCreateMap={() => void handleCreateResearchMap()} onPinEntity={() => void handlePinSelectedEntity()} creatingMap={creatingMap} pinningEntity={pinningEntity} maps={researchMaps} />
              </div>
            ) : null}
            {screen === "lawvere" ? (
              <div className="space-y-6">
                <SectionShell title="Lawvere collection" description="Use the whole Lawvere corpus as a scoped website spine for chronology, themes, topos-facing prompts, and reviewed formalization candidates.">
                  <div className="space-y-6">
                    <LawvereCollectionCard
                      collection={lawvereCollection}
                      loading={loadingLawvereCollection}
                      error={lawvereCollectionError}
                      onRefresh={() => void loadLawvereCollectionData({ soft: true })}
                      onQueueImport={() => void handleQueueLawvereCollectionImport()}
                      onMaterializeMap={() => void handleMaterializeLawvereCollectionMap()}
                      onRunPrompt={(prompt) => void runSuggestedLawverePrompt(prompt)}
                      materializing={materializingLawvereCollection}
                    />
                    <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
                      <form className="space-y-4" onSubmit={(event) => {
                        event.preventDefault();
                        void runSuggestedLawverePrompt(query);
                      }}>
                        <textarea className="min-h-40 w-full rounded-[24px] border border-amber-200 bg-amber-50/60 px-5 py-4 text-base text-stone-800 outline-none focus:border-amber-400" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ask a Lawvere-scoped question about adjointness, ETCS, toposes, cohesion, or categorical dynamics." />
                        <Button type="submit" className="w-full rounded-full bg-amber-900 text-white hover:bg-amber-800" disabled={researching}>
                          {researching ? "Building Lawvere bundle..." : "Run Lawvere-scoped research"}
                        </Button>
                      </form>
                      <div className="space-y-4">
                        <HumanRuntimePanel title="Lawvere runtime protocol" payload={researchResult} validation={researchResult?.validation || []} />
                        <div className="rounded-[24px] border border-stone-200 bg-white p-5">
                          <div className="text-sm font-medium uppercase tracking-[0.14em] text-stone-500">Latest scoped answer</div>
                          <div className="mt-3 text-base leading-7 text-stone-800">{researchResult?.answer || "Run a Lawvere-scoped prompt to build a reviewed bundle from the collection."}</div>
                        </div>
                        {researchResult?.citations?.length ? (
                          <div className="rounded-[24px] border border-stone-200 bg-white p-5">
                            <div className="text-sm font-medium uppercase tracking-[0.14em] text-stone-500">Scoped citations</div>
                            <div className="mt-4 space-y-3">
                              {researchResult.citations.slice(0, 4).map((citation) => (
                                <div key={citation.id} className="rounded-[20px] border border-stone-200 bg-stone-50/70 p-4">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="font-semibold text-stone-900">{citation.document_title}</div>
                                    <Badge className="rounded-full border border-stone-200 bg-white text-stone-700">pp. {citation.page_start}-{citation.page_end}</Badge>
                                  </div>
                                  <div className="mt-2 text-sm leading-6 text-stone-700">{citation.quote}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </SectionShell>
              </div>
            ) : null}
            {screen === "market" ? (
              <div className="space-y-6">
                {loadingResources.market && !marketResult && !pharmaEvents.length && !dossierAssertions.length ? (
                  <div className="rounded-[24px] border border-dashed border-stone-300 bg-stone-50/80 p-8 text-sm text-stone-500">
                    Loading market, pharma, and dossier data only now that the market screen is open.
                  </div>
                ) : null}
                <SectionShell title="Market geometry and Green triad" description="Run the equal-triad market bridge across options surfaces, temporal regimes, and cross-symbol structure using the live yfinance provider when it is available.">
                  <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
                    <div className="space-y-4">
                      <form className="space-y-4" onSubmit={handleMarketSubmit}>
                        <Input value={marketSymbols} onChange={(event) => setMarketSymbols(event.target.value)} placeholder="SPY, QQQ, IWM" className="h-12 rounded-full border-stone-300 bg-stone-50/80 px-5" />
                        <div className="grid gap-3 md:grid-cols-2">
                          <Input value={marketBenchmark} onChange={(event) => setMarketBenchmark(event.target.value)} placeholder="Benchmark" className="h-12 rounded-full border-stone-300 bg-stone-50/80 px-5" />
                          <Input value={marketMode} onChange={(event) => setMarketMode(event.target.value)} placeholder="auto" className="h-12 rounded-full border-stone-300 bg-stone-50/80 px-5" />
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          <Input value={marketPeriod} onChange={(event) => setMarketPeriod(event.target.value)} placeholder="6mo" className="h-12 rounded-full border-stone-300 bg-stone-50/80 px-5" />
                          <Input value={marketInterval} onChange={(event) => setMarketInterval(event.target.value)} placeholder="1d" className="h-12 rounded-full border-stone-300 bg-stone-50/80 px-5" />
                        </div>
                        <div className="grid gap-3 md:grid-cols-3">
                          <Input value={marketRollingWindow} onChange={(event) => setMarketRollingWindow(event.target.value)} placeholder="Rolling window" className="h-12 rounded-full border-stone-300 bg-stone-50/80 px-5" />
                          <Input value={marketMaxExpiries} onChange={(event) => setMarketMaxExpiries(event.target.value)} placeholder="Expiries" className="h-12 rounded-full border-stone-300 bg-stone-50/80 px-5" />
                          <Input value={marketMaxStrikes} onChange={(event) => setMarketMaxStrikes(event.target.value)} placeholder="Strikes" className="h-12 rounded-full border-stone-300 bg-stone-50/80 px-5" />
                        </div>
                        <Button type="submit" className="w-full rounded-full bg-stone-900 text-white hover:bg-stone-800" disabled={marketLoading}>
                          {marketLoading ? "Analyzing market geometry..." : "Run market analysis"}
                        </Button>
                        {marketError ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{marketError}</div> : null}
                      </form>
                      <div className="rounded-[24px] border border-stone-200 bg-stone-50/70 p-4">
                        <div className="text-sm font-medium uppercase tracking-[0.14em] text-stone-500">Provider readiness</div>
                        <div className="mt-3 flex items-center gap-3">
                          <StatusBadge value={marketProvider?.ready ? "ready" : "offline"} />
                          <div className="text-sm text-stone-700">
                            {marketProvider?.name || "market_data"}{marketProvider?.detail ? ` · ${marketProvider.detail}` : ""}
                          </div>
                        </div>
                      </div>
                      <div className="rounded-[24px] border border-stone-200 bg-stone-50/70 p-4 text-sm text-stone-700">
                        <div className="font-medium uppercase tracking-[0.14em] text-stone-500">Request policy</div>
                        <div className="mt-3 leading-6">
                          Options chains are preferred when available. Otherwise the analysis falls back to temporal history and cross-symbol state clouds, with Greeks reconstructed locally.
                        </div>
                      </div>
                    </div>
                    <div className="space-y-4">
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        <MarketMetricTile label="Partition Function" value={formatDecimal(marketResult?.thermodynamics?.aggregate?.partition_function, 2)} />
                        <MarketMetricTile label="Free Energy" value={formatDecimal(marketResult?.thermodynamics?.aggregate?.free_energy, 2)} />
                        <MarketMetricTile label="Entropy Proxy" value={formatDecimal(marketResult?.thermodynamics?.aggregate?.entropy_proxy, 2)} />
                        <MarketMetricTile label="Casimir Mass" value={formatDecimal(marketResult?.casimir_euler?.aggregate?.casimir_weighted_state_mass, 2)} />
                        <MarketMetricTile label="Euler Grade" value={formatDecimal(marketResult?.casimir_euler?.aggregate?.euler_grade, 2)} />
                        <MarketMetricTile label="Fragmentation" value={formatDecimal(marketResult?.signals?.aggregate?.fragmentation, 0)} />
                      </div>
                      {marketResult ? (
                        <>
                          <MarketGeometryCard title="Options surface" section={marketResult.options_surface} />
                          <MarketGeometryCard title="Temporal regime" section={marketResult.temporal_regime} />
                          <MarketGeometryCard title="Cross symbol" section={marketResult.cross_symbol} />
                          {marketResult?.warnings?.length ? (
                            <div className="rounded-[22px] border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
                              <div className="font-semibold text-amber-900">Warnings</div>
                              <div className="mt-2 space-y-1">
                                {marketResult.warnings.map((warning, index) => <div key={`market-warning-${index}`}>{warning}</div>)}
                              </div>
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <div className="rounded-[24px] border border-stone-200 bg-stone-50/70 p-6 text-sm text-stone-600">
                          Run a market analysis to inspect the thermal, retarded, and static kernels for the three geometry branches.
                        </div>
                      )}
                    </div>
                  </div>
                </SectionShell>
                <SectionShell title="Pharma event lab" description="Sync BioPharmCatalyst catalysts, keep DrugHunter visible as WIP, and spar the crown GRT^DEC stack against curated technique challengers on biotech/pharma event response.">
                  <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
                    <div className="space-y-4">
                      <form className="space-y-4" onSubmit={handlePharmaSync}>
                        <Input value={pharmaSymbols} onChange={(event) => setPharmaSymbols(event.target.value)} placeholder="VRTX, MRNA, ALNY" className="h-12 rounded-full border-stone-300 bg-stone-50/80 px-5" />
                        <div className="grid gap-3 md:grid-cols-2">
                          <Input value={pharmaSyncLimit} onChange={(event) => setPharmaSyncLimit(event.target.value)} placeholder="Event limit" className="h-12 rounded-full border-stone-300 bg-stone-50/80 px-5" />
                          <Button type="submit" variant="outline" className="h-12 rounded-full border-stone-300 bg-white" disabled={pharmaSyncLoading}>
                            {pharmaSyncLoading ? "Syncing..." : "Sync pharma events"}
                          </Button>
                        </div>
                      </form>
                      <form className="space-y-4" onSubmit={handlePharmaCycle}>
                        <div className="grid gap-3 md:grid-cols-2">
                          <Input value={pharmaBenchmark} onChange={(event) => setPharmaBenchmark(event.target.value)} placeholder="Benchmark" className="h-12 rounded-full border-stone-300 bg-stone-50/80 px-5" />
                          <Input value={pharmaTrainWindow} onChange={(event) => setPharmaTrainWindow(event.target.value)} placeholder="Train window" className="h-12 rounded-full border-stone-300 bg-stone-50/80 px-5" />
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          <Input value={pharmaTestWindow} onChange={(event) => setPharmaTestWindow(event.target.value)} placeholder="Test window" className="h-12 rounded-full border-stone-300 bg-stone-50/80 px-5" />
                          <Input value={pharmaStepSize} onChange={(event) => setPharmaStepSize(event.target.value)} placeholder="Step size" className="h-12 rounded-full border-stone-300 bg-stone-50/80 px-5" />
                        </div>
                        <label className="flex items-center gap-3 rounded-[22px] border border-stone-200 bg-stone-50/70 px-4 py-3 text-sm text-stone-700">
                          <input
                            type="checkbox"
                            checked={includeDossierSignals}
                            onChange={(event) => setIncludeDossierSignals(event.target.checked)}
                            className="h-4 w-4 rounded border-stone-300 text-stone-900"
                          />
                          <span>Include dossier overlays in the cycle, but keep non-triangulated claims as weak priors.</span>
                        </label>
                        <Button type="submit" className="w-full rounded-full bg-stone-900 text-white hover:bg-stone-800" disabled={pharmaCycleLoading}>
                          {pharmaCycleLoading ? "Running pharma cycle..." : "Run pharma cycle"}
                        </Button>
                      </form>
                      {pharmaError ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{pharmaError}</div> : null}
                      <div className="rounded-[24px] border border-stone-200 bg-stone-50/70 p-4">
                        <div className="text-sm font-medium uppercase tracking-[0.14em] text-stone-500">Pharma provider</div>
                        <div className="mt-3 flex items-center gap-3">
                          <StatusBadge value={pharmaProvider?.ready ? "ready" : "offline"} />
                          <div className="text-sm text-stone-700">
                            {pharmaProvider?.name || "pharma_news"}{pharmaProvider?.detail ? ` · ${pharmaProvider.detail}` : ""}
                          </div>
                        </div>
                        <div className="mt-3 space-y-2 text-sm text-stone-600">
                          {Object.entries(pharmaProvider?.sources || {}).map(([key, value]) => (
                            <div key={key} className="flex items-center justify-between rounded-2xl border border-stone-200 bg-white px-3 py-2">
                              <div>{value?.name || key}</div>
                              <div>{value?.detail || ""}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="rounded-[24px] border border-stone-200 bg-stone-50/70 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-medium uppercase tracking-[0.14em] text-stone-500">Dossier overlays</div>
                          <Button type="button" variant="outline" className="rounded-full border-stone-300 bg-white" onClick={() => void handleDossierSync()} disabled={dossierSyncLoading}>
                            {dossierSyncLoading ? "Syncing..." : "Sync dossiers"}
                          </Button>
                        </div>
                        <div className="mt-3 flex items-center gap-3">
                          <StatusBadge value={dossierProvider?.ready ? "ready" : "offline"} />
                          <div className="text-sm text-stone-700">
                            {dossierProvider?.name || "dossier_news"}{dossierProvider?.detail ? ` · ${dossierProvider.detail}` : ""}
                          </div>
                        </div>
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          <MarketMetricTile label="Assertions" value={dossierAssertions.length} />
                          <MarketMetricTile label="Signal windows" value={dossierSignalWindows.length} />
                        </div>
                        <div className="mt-3 space-y-2 text-sm text-stone-600">
                          {Object.entries(dossierProvider?.sources || {}).map(([key, value]) => (
                            <div key={key} className="flex items-center justify-between rounded-2xl border border-stone-200 bg-white px-3 py-2">
                              <div>{value?.name || key}</div>
                              <div>{value?.detail || ""}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="space-y-4">
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <MarketMetricTile label="Events" value={pharmaEvents.length} />
                        <MarketMetricTile label="Cycles" value={pharmaCycles.length} />
                        <MarketMetricTile label="Leaders" value={pharmaLeaderboard.length} />
                        <MarketMetricTile label="Homologated" value={pharmaHomologations.filter((item) => item.status === "homologated").length} />
                      </div>
                      <div className="rounded-[24px] border border-stone-200 bg-white/85 p-5">
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-serif text-2xl text-stone-900">Pharma Events</div>
                          <Badge className="rounded-full border border-stone-200 bg-stone-50 text-stone-700">DrugHunter WIP</Badge>
                        </div>
                        <div className="mt-4 space-y-3">
                          {pharmaEvents.slice(0, 6).map((eventItem) => (
                            <div key={eventItem.id} className="rounded-[20px] border border-stone-200 bg-stone-50/70 p-4">
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                  <div className="font-semibold text-stone-900">{eventItem.ticker} · {eventItem.title}</div>
                                  <div className="text-sm text-stone-500">{eventItem.company} · {eventItem.event_type} · {eventItem.trial_phase || "No phase"}</div>
                                </div>
                                <Badge className="rounded-full border border-stone-200 bg-white text-stone-700">{formatDate(eventItem.event_at)}</Badge>
                              </div>
                              <div className="mt-2 text-sm leading-6 text-stone-700">{eventItem.summary}</div>
                            </div>
                          ))}
                          {!pharmaEvents.length ? (
                            <div className="rounded-[20px] border border-stone-200 bg-stone-50/70 p-4 text-sm text-stone-600">
                              Sync pharma events to populate the biotech/pharma catalyst table.
                            </div>
                          ) : null}
                        </div>
                      </div>
                      <div className="rounded-[24px] border border-stone-200 bg-white/85 p-5">
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-serif text-2xl text-stone-900">Dossier Assertions</div>
                          <Badge className="rounded-full border border-stone-200 bg-stone-50 text-stone-700">OSINT leads, not verified facts</Badge>
                        </div>
                        <div className="mt-4 space-y-3">
                          {dossierAssertions.slice(0, 4).map((item) => (
                            <div key={item.id} className="rounded-[20px] border border-stone-200 bg-stone-50/70 p-4">
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="font-semibold text-stone-900">{item.actor || item.institution || "Attributed assertion"}</div>
                                <Badge className="rounded-full border border-stone-200 bg-white text-stone-700">
                                  {item.is_dated ? formatDate(item.asserted_at) : "Undated prior"}
                                </Badge>
                              </div>
                              <div className="mt-2 text-sm leading-6 text-stone-700">{item.summary || item.assertion_text}</div>
                              <div className="mt-3 flex flex-wrap gap-2 text-xs text-stone-500">
                                {(item.topic_tags || []).slice(0, 4).map((tag) => (
                                  <Badge key={`${item.id}-${tag}`} className="rounded-full border border-stone-200 bg-white text-stone-700">{tag}</Badge>
                                ))}
                                <Badge className="rounded-full border border-stone-200 bg-white text-stone-700">
                                  backing {formatDecimal(item.payload?.primary_backing_score, 2)}
                                </Badge>
                              </div>
                            </div>
                          ))}
                          {!dossierAssertions.length ? (
                            <div className="rounded-[20px] border border-stone-200 bg-stone-50/70 p-4 text-sm text-stone-600">
                              Sync dossiers to build attributed assertions, evidence tags, and controversy windows from the indexed narrative corpus.
                            </div>
                          ) : null}
                        </div>
                      </div>
                      <div className="grid gap-4 xl:grid-cols-2">
                        <div className="rounded-[24px] border border-stone-200 bg-white/85 p-5">
                          <div className="font-serif text-2xl text-stone-900">Leaderboard</div>
                          <div className="mt-4 space-y-3 text-sm text-stone-700">
                            {pharmaLeaderboard.slice(0, 6).map((item) => (
                              <div key={item.candidate_key} className="rounded-[18px] border border-stone-200 bg-stone-50/70 p-4">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="font-semibold text-stone-900">{item.candidate_key}</div>
                                  <StatusBadge value={item.status || "candidate"} />
                                </div>
                                <div className="mt-2 grid gap-2 md:grid-cols-2">
                                  <div>Return {formatDecimal(item.mean_strategy_return, 3)}</div>
                                  <div>IC {formatDecimal(item.information_coefficient, 2)}</div>
                                  <div>RMSE {formatDecimal(item.rmse, 3)}</div>
                                  <div>Pass {formatDecimal(item.fold_pass_rate, 2)}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="rounded-[24px] border border-stone-200 bg-white/85 p-5">
                          <div className="font-serif text-2xl text-stone-900">Homologation</div>
                          <div className="mt-4 space-y-3 text-sm text-stone-700">
                            {pharmaHomologations.slice(0, 6).map((item) => (
                              <div key={item.candidate_key} className="rounded-[18px] border border-stone-200 bg-stone-50/70 p-4">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="font-semibold text-stone-900">{item.candidate_key}</div>
                                  <StatusBadge value={item.status || "candidate"} />
                                </div>
                                <div className="mt-2 text-stone-600">{item.reasons?.[0] || "Awaiting homologation history."}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                      {pharmaCycleResult ? (
                        <div className="rounded-[24px] border border-stone-200 bg-white/85 p-5">
                          <div className="font-serif text-2xl text-stone-900">Latest Cycle</div>
                          <div className="mt-3 text-sm text-stone-600">
                            {pharmaCycleResult.cycle?.id} · benchmark {pharmaCycleResult.cycle?.benchmark_symbol || pharmaBenchmark}
                          </div>
                          <div className="mt-4 grid gap-3 md:grid-cols-3">
                            <MarketMetricTile label="Candidates" value={pharmaCycleResult.candidates?.length || 0} />
                            <MarketMetricTile label="Rows" value={pharmaCycleResult.cycle?.dataset_summary?.row_count || 0} />
                            <MarketMetricTile label="Leader" value={pharmaCycleResult.leaderboard?.[0]?.candidate_key || "n/a"} hint="Primary return head" />
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </SectionShell>
              </div>
            ) : null}
            {screen === "imports" ? (
              <div className="space-y-6">
                {loadingResources.imports && !importJobs.length && !watchFolders.length ? (
                  <div className="rounded-[24px] border border-dashed border-stone-300 bg-stone-50/80 p-8 text-sm text-stone-500">
                    Loading import jobs and watch folders only when the imports screen is open.
                  </div>
                ) : null}
                <SectionShell
                  title="Manual imports"
                  description="Queue folders or single files for OCR, extraction, chunking, summarization, and indexing."
                  actions={(
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-full border-stone-300 bg-white"
                      onClick={() => void handleResetImportJobs()}
                      disabled={resettingImportJobs || !importJobs.length}
                    >
                      {resettingImportJobs ? "Resetting jobs..." : "Reset import jobs"}
                    </Button>
                  )}
                >
                  <div className="mb-5">
                    <VapnikSourceCard
                      onUseImportPath={useDetectedVapnikImportPath}
                      onQueueImport={() => void handleQueueDetectedVapnikImport()}
                      queueing={false}
                    />
                  </div>
                  <form className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]" onSubmit={handleCreateImportJob}>
                    <Input value={sourcePath} onChange={(event) => setSourcePath(event.target.value)} placeholder="C:/Library/Incoming or C:/Books/Scan.pdf" className="h-12 rounded-full border-stone-300 bg-stone-50/80 px-5" />
                    <Button type="submit" className="h-12 rounded-full bg-stone-900 text-white hover:bg-stone-800">Queue import job</Button>
                  </form>
                  {importError ? <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{importError}</div> : null}
                  <label className="mt-4 flex items-center gap-3 rounded-[22px] border border-stone-200 bg-stone-50/70 px-4 py-3 text-sm text-stone-700">
                    <input
                      type="checkbox"
                      checked={importRecursive}
                      onChange={(event) => setImportRecursive(event.target.checked)}
                      className="h-4 w-4 rounded border-stone-300 text-stone-900"
                    />
                    <span>Search all subfolders in this directory automatically</span>
                  </label>
                  <div className="mt-4 rounded-[22px] border border-stone-200 bg-white/80 px-4 py-4 text-sm text-stone-600">
                    Import paths must already exist on this machine. For directories, the backend now validates that at least one supported document is present before the job is queued.
                  </div>
                  <div className="mt-4 rounded-[22px] border border-stone-200 bg-white/80 px-4 py-4 text-sm text-stone-600">
                    Each job shows the active pipeline stage, total progress, warnings, output count, and the per-stage task runner state for discovery, extraction, OCR, chunking, summarization, embedding, indexing, and research materialization.
                  </div>
                  <div className="mt-5 grid gap-4 xl:grid-cols-2">
                    {importJobs.map((job) => <ImportJobCard key={job.id} job={job} />)}
                  </div>
                </SectionShell>
                <SectionShell title="Watch folders" description="Keep a local directory under observation so new or changed files feed the import queue.">
                  <form className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]" onSubmit={handleCreateWatchFolder}>
                    <Input value={watchPath} onChange={(event) => setWatchPath(event.target.value)} placeholder="C:/Library" className="h-12 rounded-full border-stone-300 bg-stone-50/80 px-5" />
                    <Button type="submit" variant="outline" className="h-12 rounded-full border-stone-300 bg-white">Add watch folder</Button>
                  </form>
                  {watchError ? <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{watchError}</div> : null}
                  <div className="mt-5 space-y-3">
                    {watchFolders.map((folder) => (
                      <div key={folder.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[22px] border border-stone-200 bg-stone-50/70 p-4">
                        <div>
                          <div className="font-semibold text-stone-900">{folder.path}</div>
                          <div className="text-sm text-stone-500">{folder.recursive ? "Recursive" : "Single level"} • Last scan {formatDate(folder.last_scanned_at)}</div>
                          {describeWatchFolderIntent(folder) ? <div className="mt-2 text-sm text-stone-600">{describeWatchFolderIntent(folder)}</div> : null}
                        </div>
                        <StatusBadge value={folder.enabled ? "enabled" : "disabled"} />
                      </div>
                    ))}
                  </div>
                </SectionShell>
              </div>
            ) : null}
            {screen === "documents" ? (
              <SectionShell title="Indexed documents" description="Inspect the corpus, monitor ingestion state, and filter by title, format, or summary keywords." actions={<Input value={documentsFilter} onChange={(event) => setDocumentsFilter(event.target.value)} placeholder="Filter documents" className="h-11 w-full max-w-xs rounded-full border-stone-300 bg-stone-50/80 px-4" />}>
                {loadingResources.documents && !documents.length ? (
                  <div className="mb-5 rounded-[24px] border border-dashed border-stone-300 bg-stone-50/80 p-8 text-sm text-stone-500">
                    Loading indexed documents only when the documents screen is open.
                  </div>
                ) : null}
                <div className="grid gap-4 xl:grid-cols-2">
                  {filteredDocuments.map((document) => (
                    <div key={document.id} className="rounded-[24px] border border-stone-200 bg-white p-5 shadow-sm">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="font-serif text-2xl text-stone-900">{document.title}</div>
                          <div className="mt-1 text-sm text-stone-500">{document.source_path}</div>
                        </div>
                        <StatusBadge value={document.status} />
                      </div>
                      <div className="mt-4 text-sm leading-6 text-stone-700">{document.summary}</div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Badge className="rounded-full border border-stone-200 bg-stone-50 text-stone-700">{document.file_type}</Badge>
                        <Badge className="rounded-full border border-stone-200 bg-stone-50 text-stone-700">{document.language}</Badge>
                        <Badge className="rounded-full border border-stone-200 bg-stone-50 text-stone-700">{document.page_count} pages</Badge>
                        <Badge className="rounded-full border border-stone-200 bg-stone-50 text-stone-700">{document.node_count} nodes</Badge>
                      </div>
                      {document.metadata?.author ? <div className="mt-4 text-sm text-stone-500">{document.metadata.author} • {document.metadata.formalism || "general"}{document.metadata.year ? ` • ${document.metadata.year}` : ""}</div> : null}
                    </div>
                  ))}
                </div>
              </SectionShell>
            ) : null}
            {screen === "saved" ? (
              <div className="space-y-6">
                {loadingResources.saved && !savedQueries.length && !notes.length ? (
                  <div className="rounded-[24px] border border-dashed border-stone-300 bg-stone-50/80 p-8 text-sm text-stone-500">
                    Loading saved dossiers and notes only when the saved screen is open.
                  </div>
                ) : null}
                <SectionShell title="Saved dossiers" description="Persist high-value query paths so they can be resumed, extended into research maps, or turned into notes.">
                  <div className="space-y-4">
                    {savedQueries.map((savedQuery) => (
                      <div key={savedQuery.id} className="rounded-[24px] border border-stone-200 bg-white p-5">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="font-semibold text-stone-900">{savedQuery.title}</div>
                          <Badge className="rounded-full border border-stone-200 bg-stone-50 text-stone-700">{formatStatusLabel(savedQuery.mode)}</Badge>
                        </div>
                        <div className="mt-2 text-sm text-stone-600">{savedQuery.query_text}</div>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          {savedQuery.research_bundle_id ? <Badge className="rounded-full border border-stone-200 bg-white text-stone-700">{savedQuery.research_bundle_id}</Badge> : null}
                          <div className="text-xs uppercase tracking-[0.14em] text-stone-400">{formatDate(savedQuery.created_at)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </SectionShell>
                <SectionShell title="Research notes" description="Attach notes to the current synthesis trail, a document anchor, or a formal entity.">
                  <form className="space-y-4" onSubmit={handleCreateNote}>
                    <Input value={noteTitle} onChange={(event) => setNoteTitle(event.target.value)} className="h-12 rounded-full border-stone-300 bg-stone-50/80 px-5" />
                    <textarea className="min-h-28 w-full rounded-[24px] border border-stone-200 bg-stone-50/80 px-5 py-4 text-base text-stone-800 outline-none focus:border-stone-400" value={noteContent} onChange={(event) => setNoteContent(event.target.value)} placeholder="Capture the comparative frame, disagreement, or follow-up query." />
                    <Button type="submit" className="rounded-full bg-stone-900 text-white hover:bg-stone-800">Save note</Button>
                  </form>
                  <div className="mt-5 space-y-3">
                    {notes.map((note) => (
                      <div key={note.id} className="rounded-[22px] border border-stone-200 bg-stone-50/70 p-4">
                        <div className="font-semibold text-stone-900">{note.title}</div>
                        <div className="mt-2 text-sm leading-6 text-stone-700">{note.content}</div>
                        <div className="mt-3 flex flex-wrap gap-2 text-xs uppercase tracking-[0.14em] text-stone-400">
                          {note.entity_id ? <span>{note.entity_id}</span> : null}
                          <span>{formatDate(note.created_at)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </SectionShell>
              </div>
            ) : null}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

export default function LibraryWorkspace() {
  const [session, setSession] = useState(() => getLocalDemoSession());
  const [checkingSession, setCheckingSession] = useState(false);
  const [bootStatus, setBootStatus] = useState(null);
  const [bootLoading, setBootLoading] = useState(true);
  const [bootError, setBootError] = useState("");
  const [startingBackend, setStartingBackend] = useState(false);
  const { reportSignals, setLibraryActivitySession } = useActivityCenter();
  const shouldWatchBoot = startingBackend || checkingSession || ((!session || session?.mode !== "demo") && !bootStatus?.health?.ready);

  useEffect(() => {
    let active = true;

    async function loadBootStatus() {
      try {
        const nextStatus = await fetchBackendBootStatus();
        if (!active) return;
        setBootStatus(nextStatus);
        setBootError("");
      } catch (error) {
        if (!active) return;
        setBootError(error instanceof Error ? error.message : "Unable to inspect local backend status.");
      } finally {
        if (active) setBootLoading(false);
      }
    }

    void loadBootStatus();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!shouldWatchBoot) return undefined;
    let active = true;

    const unsubscribe = subscribeBackendEvents(
      (nextStatus) => {
        if (!active) return;
        setBootStatus(nextStatus);
        setBootLoading(false);
        setBootError("");
        if (nextStatus?.health?.ready) {
          setStartingBackend(false);
        }
      },
      (error) => {
        if (!active) return;
        if (error instanceof Error) {
          setBootError(error.message);
        }
      }
    );

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [shouldWatchBoot]);

  useEffect(() => {
    reportSignals(buildLibraryBootSignal(bootStatus, bootError));
  }, [bootError, bootStatus, reportSignals]);

  useEffect(() => {
    setLibraryActivitySession(session?.mode === "live" ? session : null);
  }, [session, setLibraryActivitySession]);

  useEffect(() => {
    let active = true;

    if (session?.mode === "demo") {
      setCheckingSession(false);
      return () => {
        active = false;
      };
    }

    if (!bootStatus?.health?.ready) {
      setCheckingSession(false);
      return () => {
        active = false;
      };
    }

    setCheckingSession(true);
    getSession()
      .then((nextSession) => {
        if (!active) return;
        setSession(nextSession);
      })
      .finally(() => {
        if (active) setCheckingSession(false);
      });

    return () => {
      active = false;
    };
  }, [bootStatus?.health?.ready, session?.mode]);

  async function handleLogout() {
    await logoutAccount();
    setSession(null);
  }

  async function handleStartBackend() {
    setStartingBackend(true);
    setBootError("");
    try {
      const nextStatus = await startBackendServices();
      setBootStatus(nextStatus);
    } catch (error) {
      setBootError(error instanceof Error ? error.message : "Unable to start backend services.");
    } finally {
      setStartingBackend(false);
    }
  }

  async function handleRefreshBootStatus() {
    setBootLoading(true);
    setBootError("");
    try {
      const nextStatus = await fetchBackendBootStatus();
      setBootStatus(nextStatus);
    } catch (error) {
      setBootError(error instanceof Error ? error.message : "Unable to refresh backend status.");
    } finally {
      setBootLoading(false);
    }
  }

  function handleOpenDemoMode() {
    const demoSession = enterDemoMode();
    setSession(demoSession);
    setCheckingSession(false);
  }

  if ((bootLoading && session?.mode !== "demo") || (checkingSession && session?.mode !== "demo")) {
    return (
      <BackendBootDashboard
        bootStatus={{
          ...bootStatus,
          state: checkingSession ? "workspace_loading" : bootStatus?.state,
          message: checkingSession
            ? "Backend is up. Loading the local session before we enter the library workspace."
            : bootStatus?.message,
        }}
        bootLoading={bootLoading}
        bootError={bootError}
        onStart={() => void handleStartBackend()}
        onRetry={() => void handleRefreshBootStatus()}
        onUseDemo={handleOpenDemoMode}
        starting={startingBackend}
      />
    );
  }

  if (!bootStatus?.health?.ready && session?.mode !== "demo") {
    return (
      <BackendBootDashboard
        bootStatus={bootStatus}
        bootLoading={bootLoading}
        bootError={bootError}
        onStart={() => void handleStartBackend()}
        onRetry={() => void handleRefreshBootStatus()}
        onUseDemo={handleOpenDemoMode}
        starting={startingBackend}
      />
    );
  }

  if (!session) {
    return <LibraryAuthGateway onAuthenticated={setSession} />;
  }

  return <LibraryWorkspaceInner session={session} onLogout={() => void handleLogout()} bootStatus={bootStatus} />;
}

export function LibraryWorkspacePage() {
  return (
    <div className="min-h-screen pt-[13rem]" style={getLibraryBackgroundStyle()}>
      <LibraryWorkspace />
    </div>
  );
}
