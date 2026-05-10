/* eslint-disable react-refresh/only-export-components */

import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AlertTriangle, BellDot, CheckCircle2, Clock3, GitBranch, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  commitActivityGitExportLocal,
  completeActivityGitExport,
  failActivityGitExport,
  fetchActivityGitExports,
  fetchActivityGitProfile,
  fetchActivityReviewHistory,
  fetchActivitySignals,
  reviewActivitySignal,
  saveActivityGitProfile,
  syncActivitySignals,
  validateActivityGitProfileLocal,
  isAuthFailure,
} from "./activity_api";

const STORAGE_KEY = "sacred-timeline-activity-center-v1";
const MAX_STORED_SIGNALS = 180;
const MAX_REMOTE_SIGNALS = 120;
const MAX_REMOTE_EXPORTS = 40;
const MAX_REVIEW_HISTORY_PER_SIGNAL = 20;
const MAX_ARRAY_PAYLOAD_ITEMS = 12;
const MAX_OBJECT_PAYLOAD_KEYS = 24;
const MAX_STRING_PAYLOAD_LENGTH = 320;
const ActivityCenterContext = createContext(null);

function nowIso() {
  return new Date().toISOString();
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function trimString(value) {
  if (typeof value !== "string") return value;
  if (value.length <= MAX_STRING_PAYLOAD_LENGTH) return value;
  return `${value.slice(0, MAX_STRING_PAYLOAD_LENGTH - 1)}…`;
}

function sanitizePayload(value, depth = 0) {
  if (depth > 4) return "[trimmed]";
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_PAYLOAD_ITEMS).map((item) => sanitizePayload(item, depth + 1));
  }
  if (!value || typeof value !== "object") {
    return trimString(value);
  }
  const entries = Object.entries(value).slice(0, MAX_OBJECT_PAYLOAD_KEYS);
  return Object.fromEntries(entries.map(([key, payloadValue]) => [key, sanitizePayload(payloadValue, depth + 1)]));
}

function capSignalMap(signalMap) {
  return Object.fromEntries(
    Object.values(signalMap || {})
      .sort((left, right) => new Date(right.updated_at || 0) - new Date(left.updated_at || 0))
      .slice(0, MAX_STORED_SIGNALS)
      .map((signal) => [signal.id, signal])
  );
}

function capReviewHistoryMap(reviewHistoryMap) {
  return Object.fromEntries(
    Object.entries(reviewHistoryMap || {}).map(([signalId, entries]) => [
      signalId,
      Array.isArray(entries) ? entries.slice(0, MAX_REVIEW_HISTORY_PER_SIGNAL) : [],
    ])
  );
}

function loadLocalState() {
  if (typeof window === "undefined") {
    return { signals: {}, reviewHistory: {}, gitProfile: null };
  }
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return { signals: {}, reviewHistory: {}, gitProfile: null };
  }
  const parsed = safeJsonParse(raw, {});
  return {
    signals: capSignalMap(parsed.signals && typeof parsed.signals === "object" ? parsed.signals : {}),
    reviewHistory: capReviewHistoryMap(parsed.reviewHistory && typeof parsed.reviewHistory === "object" ? parsed.reviewHistory : {}),
    gitProfile: parsed.gitProfile && typeof parsed.gitProfile === "object" ? parsed.gitProfile : null,
  };
}

function persistLocalState(state) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
    signals: capSignalMap(state.signals),
    reviewHistory: capReviewHistoryMap(state.reviewHistory),
    gitProfile: state.gitProfile || null,
  }));
}

function toIsoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function formatDateTime(value) {
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

function normalizeSeverity(value) {
  const normalized = String(value || "info").trim().toLowerCase();
  return ["error", "warning", "info", "success"].includes(normalized) ? normalized : "info";
}

function normalizeSignal(signal, previous = {}) {
  return {
    id: signal.id,
    source_module: signal.source_module || previous.source_module || "library",
    source_kind: signal.source_kind || previous.source_kind || "runtime",
    entity_id: signal.entity_id ?? previous.entity_id ?? null,
    title: signal.title || previous.title || signal.id,
    summary: signal.summary ?? previous.summary ?? "",
    severity: normalizeSeverity(signal.severity ?? previous.severity),
    visibility: signal.visibility || previous.visibility || "public",
    signal_state: signal.signal_state || previous.signal_state || "active",
    review_state: signal.review_state || previous.review_state || "pending",
    note: signal.note ?? previous.note ?? "",
    snooze_until: toIsoOrNull(signal.snooze_until ?? previous.snooze_until),
    created_at: previous.created_at || signal.created_at || nowIso(),
    updated_at: signal.updated_at || nowIso(),
    payload: signal.payload && typeof signal.payload === "object" ? sanitizePayload(signal.payload) : previous.payload || {},
    git_export: signal.git_export || previous.git_export || null,
    origin: signal.origin || previous.origin || "client",
  };
}

function isSnoozed(signal) {
  if (!signal?.snooze_until) return false;
  const timestamp = Date.parse(signal.snooze_until);
  return Number.isFinite(timestamp) && timestamp > Date.now();
}

function mergeSignals(remoteSignals, localSignals) {
  const merged = new Map();
  for (const signal of (remoteSignals || []).slice(0, MAX_REMOTE_SIGNALS)) {
    merged.set(signal.id, normalizeSignal({ ...signal, origin: "server" }));
  }
  for (const signal of Object.values(localSignals || {})) {
    const normalized = normalizeSignal(signal);
    const existing = merged.get(normalized.id);
    if (!existing) {
      merged.set(normalized.id, normalized);
      continue;
    }
    if (new Date(normalized.updated_at).getTime() >= new Date(existing.updated_at).getTime()) {
      merged.set(normalized.id, {
        ...normalized,
        visibility: existing.visibility,
        review_state: existing.review_state,
        note: existing.note,
        snooze_until: existing.snooze_until,
        git_export: existing.git_export,
      });
    }
  }
  return [...merged.values()]
    .sort((left, right) => new Date(right.updated_at) - new Date(left.updated_at))
    .slice(0, MAX_STORED_SIGNALS);
}

function buildSignalCounts(signals) {
  return signals.reduce((accumulator, signal) => {
    if (!isSnoozed(signal) && !["approved", "rejected"].includes(signal.review_state)) {
      accumulator.unread += 1;
    }
    accumulator.bySeverity[signal.severity] = (accumulator.bySeverity[signal.severity] || 0) + 1;
    accumulator.byModule[signal.source_module] = (accumulator.byModule[signal.source_module] || 0) + 1;
    return accumulator;
  }, {
    unread: 0,
    bySeverity: { error: 0, warning: 0, info: 0, success: 0 },
    byModule: {},
  });
}

function toSyncPayload(signal) {
  return {
    id: signal.id,
    source_module: signal.source_module,
    source_kind: signal.source_kind,
    entity_id: signal.entity_id,
    title: signal.title,
    summary: signal.summary,
    severity: signal.severity,
    visibility: signal.visibility,
    signal_state: signal.signal_state,
    review_state: signal.review_state,
    note: signal.note,
    snooze_until: signal.snooze_until,
    payload: signal.payload,
  };
}

export function ActivityCenterProvider({ children }) {
  const initialLocalState = useMemo(() => loadLocalState(), []);
  const [localSignals, setLocalSignals] = useState(initialLocalState.signals);
  const [localReviewHistory, setLocalReviewHistory] = useState(initialLocalState.reviewHistory);
  const [localGitProfile, setLocalGitProfile] = useState(initialLocalState.gitProfile);
  const [remoteSignals, setRemoteSignals] = useState([]);
  const [remoteGitProfile, setRemoteGitProfile] = useState(null);
  const [remoteExports, setRemoteExports] = useState([]);
  const [librarySession, setLibrarySession] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [filters, setFilters] = useState({
    module: "all",
    severity: "all",
    visibility: "all",
    sourceKind: "all",
    reviewState: "all",
  });
  const [selectedSignalId, setSelectedSignalId] = useState(null);
  const [reviewHistory, setReviewHistory] = useState([]);
  const [activityError, setActivityError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [submittingReview, setSubmittingReview] = useState(false);
  const [savingGitProfile, setSavingGitProfile] = useState(false);
  const refreshTimerRef = useRef(null);

  useEffect(() => {
    persistLocalState({
      signals: localSignals,
      reviewHistory: localReviewHistory,
      gitProfile: localGitProfile,
    });
  }, [localSignals, localReviewHistory, localGitProfile]);

  const liveUserId = librarySession?.mode === "live" ? librarySession.user?.id : null;
  const gitProfile = liveUserId ? remoteGitProfile : localGitProfile;

  const signals = useMemo(() => mergeSignals(remoteSignals, localSignals), [remoteSignals, localSignals]);
  const counts = useMemo(() => buildSignalCounts(signals), [signals]);
  const filteredSignals = useMemo(() => {
    return signals.filter((signal) => {
      if (filters.module !== "all" && signal.source_module !== filters.module) return false;
      if (filters.severity !== "all" && signal.severity !== filters.severity) return false;
      if (filters.visibility !== "all" && signal.visibility !== filters.visibility) return false;
      if (filters.sourceKind !== "all" && signal.source_kind !== filters.sourceKind) return false;
      if (filters.reviewState !== "all" && signal.review_state !== filters.reviewState) return false;
      if (filters.reviewState === "all" && signal.review_state === "deferred" && isSnoozed(signal)) return false;
      return true;
    });
  }, [filters, signals]);

  const selectedSignal = useMemo(
    () => signals.find((signal) => signal.id === selectedSignalId) || null,
    [signals, selectedSignalId]
  );

  useEffect(() => {
    if (!selectedSignalId && filteredSignals.length) {
      setSelectedSignalId(filteredSignals[0].id);
      return;
    }
    if (selectedSignalId && !filteredSignals.some((signal) => signal.id === selectedSignalId)) {
      setSelectedSignalId(filteredSignals[0]?.id || null);
    }
  }, [filteredSignals, selectedSignalId]);

  const refreshRemoteActivity = useCallback(async ({ silent = false } = {}) => {
    if (!liveUserId) {
      setRemoteSignals([]);
      setRemoteGitProfile(null);
      setRemoteExports([]);
      return;
    }
    if (!silent) {
      setRefreshing(true);
    }
    try {
      const [signalsResponse, profileResponse, exportsResponse] = await Promise.all([
        fetchActivitySignals(),
        fetchActivityGitProfile().catch((error) => (isAuthFailure(error) ? null : Promise.reject(error))),
        fetchActivityGitExports().catch((error) => (isAuthFailure(error) ? { items: [] } : Promise.reject(error))),
      ]);
      setRemoteSignals(Array.isArray(signalsResponse?.items) ? signalsResponse.items.slice(0, MAX_REMOTE_SIGNALS) : []);
      setRemoteGitProfile(profileResponse || null);
      setRemoteExports(Array.isArray(exportsResponse?.items) ? exportsResponse.items.slice(0, MAX_REMOTE_EXPORTS) : []);
      setActivityError("");
    } catch (error) {
      if (!isAuthFailure(error)) {
        setActivityError(error instanceof Error ? error.message : "Unable to refresh activity signals.");
      }
    } finally {
      if (!silent) {
        setRefreshing(false);
      }
    }
  }, [liveUserId]);

  useEffect(() => {
    void refreshRemoteActivity();
  }, [liveUserId, refreshRemoteActivity]);

  useEffect(() => {
    if (refreshTimerRef.current) {
      window.clearInterval(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    if (!liveUserId) return undefined;
    refreshTimerRef.current = window.setInterval(() => {
      if (document.hidden && !drawerOpen) {
        return;
      }
      void refreshRemoteActivity({ silent: true });
    }, drawerOpen ? 25000 : 60000);
    return () => {
      if (refreshTimerRef.current) {
        window.clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [drawerOpen, liveUserId, refreshRemoteActivity]);

  useEffect(() => {
    if (!liveUserId) return;
    const clientSignals = Object.values(localSignals).filter((signal) => signal.origin !== "server");
    if (!clientSignals.length) return;
    startTransition(() => {
      void syncActivitySignals(clientSignals.map(toSyncPayload))
        .then((response) => {
          setRemoteSignals(Array.isArray(response?.items) ? response.items.slice(0, MAX_REMOTE_SIGNALS) : []);
        })
        .catch((error) => {
          if (!isAuthFailure(error)) {
            setActivityError(error instanceof Error ? error.message : "Unable to sync local activity signals.");
          }
        });
    });
  }, [liveUserId, localSignals]);

  useEffect(() => {
    if (!selectedSignal) {
      setReviewHistory([]);
      return;
    }
    if (!liveUserId) {
      setReviewHistory(localReviewHistory[selectedSignal.id] || []);
      return;
    }
    setHistoryLoading(true);
    fetchActivityReviewHistory(selectedSignal.id)
      .then((response) => {
        setReviewHistory(Array.isArray(response?.items) ? response.items.slice(0, MAX_REVIEW_HISTORY_PER_SIGNAL) : []);
      })
      .catch((error) => {
        if (!isAuthFailure(error)) {
          setActivityError(error instanceof Error ? error.message : "Unable to load activity review history.");
        }
      })
      .finally(() => {
        setHistoryLoading(false);
      });
  }, [liveUserId, localReviewHistory, selectedSignal]);

  const setLibraryActivitySession = useCallback((session) => {
    setLibrarySession(session || null);
  }, []);

  const reportSignals = useCallback((items) => {
    const nextItems = Array.isArray(items) ? items : [items];
    setLocalSignals((current) => {
      const next = { ...current };
      for (const item of nextItems) {
        if (!item?.id) continue;
        next[item.id] = normalizeSignal({ ...item, origin: item.origin || "client" }, current[item.id]);
      }
      return capSignalMap(next);
    });
  }, []);

  const dismissSignal = useCallback((signalId) => {
    setLocalSignals((current) => {
      if (!current[signalId]) return current;
      const next = { ...current };
      delete next[signalId];
      return next;
    });
  }, []);

  const updateLocalReviewHistory = useCallback((signalId, entry) => {
    setLocalReviewHistory((current) => ({
      ...current,
      [signalId]: [entry, ...(current[signalId] || [])].slice(0, MAX_REVIEW_HISTORY_PER_SIGNAL),
    }));
  }, []);

  const configureGitProfile = useCallback(async (payload) => {
    setSavingGitProfile(true);
    try {
      const validation = await validateActivityGitProfileLocal(payload);
      const normalizedProfile = {
        repo_path: payload.repo_path,
        export_subdir: payload.export_subdir || "activity-exports",
        branch_name: payload.branch_name || null,
        valid: Boolean(validation?.valid),
        last_validated_at: validation?.validated_at || nowIso(),
        last_error: validation?.error || null,
      };
      if (liveUserId) {
        const saved = await saveActivityGitProfile(normalizedProfile);
        setRemoteGitProfile(saved);
      } else {
        setLocalGitProfile({
          ...normalizedProfile,
          created_at: localGitProfile?.created_at || nowIso(),
          updated_at: nowIso(),
        });
      }
      setActivityError("");
      return validation;
    } finally {
      setSavingGitProfile(false);
    }
  }, [liveUserId, localGitProfile]);

  const submitReview = useCallback(async (signalId, payload) => {
    const signal = signals.find((item) => item.id === signalId);
    if (!signal) {
      throw new Error("Activity signal not found.");
    }
    setSubmittingReview(true);
    try {
      if (!liveUserId) {
        const nextSignal = normalizeSignal(
          {
            ...signal,
            visibility: payload.visibility,
            review_state: payload.review_state,
            note: payload.note,
            snooze_until: payload.snooze_until,
            updated_at: nowIso(),
          },
          signal
        );
        setLocalSignals((current) => capSignalMap({ ...current, [signalId]: nextSignal }));
        updateLocalReviewHistory(signalId, {
          id: `local-review-${signalId}-${Date.now()}`,
          signal_id: signalId,
          action: payload.action,
          review_state: payload.review_state,
          visibility: payload.visibility,
          note: payload.note,
          snooze_until: payload.snooze_until,
          created_at: nowIso(),
          payload: payload.payload || {},
        });
        if (payload.visibility === "private" && !localGitProfile?.repo_path) {
          setActivityError("Private approvals need a local repo profile before they can be committed.");
        } else {
          setActivityError("");
        }
        return nextSignal;
      }
      const response = await reviewActivitySignal(signalId, payload);
      if (response?.export) {
        const profile = remoteGitProfile || localGitProfile;
        if (!profile?.repo_path) {
          setActivityError("Private approvals need a configured local repo before the review can auto-commit.");
          await refreshRemoteActivity({ silent: true });
          return response.signal;
        }
        try {
          const commitResult = await commitActivityGitExportLocal({
            repo_path: profile.repo_path,
            export_subdir: profile.export_subdir,
            branch_name: profile.branch_name,
            export: response.export,
            signal: response.signal,
          });
          await completeActivityGitExport(response.export.id, {
            commit_hash: commitResult.commit_hash,
            file_relpath: commitResult.file_relpath,
          });
        } catch (error) {
          await failActivityGitExport(response.export.id, {
            error_text: error instanceof Error ? error.message : "Local git export failed.",
          });
          throw error;
        }
      }
      await refreshRemoteActivity({ silent: true });
      setActivityError("");
      return response?.signal;
    } finally {
      setSubmittingReview(false);
    }
  }, [signals, liveUserId, localGitProfile, remoteGitProfile, refreshRemoteActivity, updateLocalReviewHistory]);

  const openActivityCenter = useCallback((nextFilters = {}) => {
    setDrawerOpen(true);
    setFilters((current) => ({ ...current, ...nextFilters }));
  }, []);

  const contextValue = useMemo(() => ({
    signals,
    filteredSignals,
    counts,
    drawerOpen,
    filters,
    selectedSignalId,
    selectedSignal,
    reviewHistory,
    historyLoading,
    activityError,
    refreshing,
    submittingReview,
    savingGitProfile,
    gitProfile,
    liveUserId,
    remoteExports,
    setLibraryActivitySession,
    reportSignals,
    dismissSignal,
    openActivityCenter,
    closeActivityCenter: () => setDrawerOpen(false),
    setSelectedSignalId,
    setFilters,
    refreshSignals: refreshRemoteActivity,
    submitReview,
    configureGitProfile,
  }), [
    signals,
    filteredSignals,
    counts,
    drawerOpen,
    filters,
    selectedSignalId,
    selectedSignal,
    reviewHistory,
    historyLoading,
    activityError,
    refreshing,
    submittingReview,
    savingGitProfile,
    gitProfile,
    liveUserId,
    remoteExports,
    setLibraryActivitySession,
    reportSignals,
    dismissSignal,
    openActivityCenter,
    refreshRemoteActivity,
    submitReview,
    configureGitProfile,
  ]);

  return (
    <ActivityCenterContext.Provider value={contextValue}>
      {children}
      <ActivityCenterDrawer />
    </ActivityCenterContext.Provider>
  );
}

export function useActivityCenter() {
  const context = useContext(ActivityCenterContext);
  if (!context) {
    throw new Error("useActivityCenter must be used within an ActivityCenterProvider.");
  }
  return context;
}

export function ActivityCenterButton() {
  const { counts, openActivityCenter } = useActivityCenter();
  return (
    <button
      type="button"
      onClick={() => openActivityCenter()}
      className="inline-flex items-center gap-2 rounded-full border border-stone-200/80 bg-white px-4 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-100"
    >
      <BellDot className="h-4 w-4" />
      <span>Activity</span>
      <span className="rounded-full bg-stone-900 px-2 py-0.5 text-xs font-semibold text-white">{counts.unread}</span>
      {counts.bySeverity.error ? <Badge className="rounded-full border border-rose-200 bg-rose-50 text-rose-700">{counts.bySeverity.error} errors</Badge> : null}
    </button>
  );
}

export function ActivityModuleStrip({ module, title, description }) {
  const { signals, openActivityCenter } = useActivityCenter();
  const moduleSignals = signals.filter((signal) => signal.source_module === module && !isSnoozed(signal));
  const errorCount = moduleSignals.filter((signal) => signal.severity === "error").length;
  const warningCount = moduleSignals.filter((signal) => signal.severity === "warning").length;
  return (
    <div className="rounded-[24px] border border-stone-200 bg-white/85 px-4 py-4 shadow-[0_18px_60px_rgba(43,35,22,0.08)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">{title || `${module} activity`}</div>
          <div className="mt-1 text-sm text-stone-700">
            {description || `${moduleSignals.length} active signals, ${errorCount} errors, ${warningCount} warnings.`}
          </div>
        </div>
        <Button type="button" variant="outline" className="rounded-full border-stone-300 bg-white" onClick={() => openActivityCenter({ module })}>
          Open activity
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Badge className="rounded-full border border-stone-200 bg-stone-50 text-stone-700">{moduleSignals.length} active</Badge>
        <Badge className="rounded-full border border-rose-200 bg-rose-50 text-rose-700">{errorCount} errors</Badge>
        <Badge className="rounded-full border border-amber-200 bg-amber-50 text-amber-800">{warningCount} warnings</Badge>
      </div>
    </div>
  );
}

function getSeverityTone(severity) {
  if (severity === "error") return "border-rose-200 bg-rose-50 text-rose-700";
  if (severity === "warning") return "border-amber-200 bg-amber-50 text-amber-800";
  if (severity === "success") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-slate-200 bg-slate-100 text-slate-700";
}

function SeverityIcon({ severity, className }) {
  if (severity === "error") {
    return <AlertTriangle className={className} />;
  }
  if (severity === "success") {
    return <CheckCircle2 className={className} />;
  }
  return <Clock3 className={className} />;
}

function buildSnoozeValue(defaultHours = 24) {
  const date = new Date(Date.now() + defaultHours * 60 * 60 * 1000);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hour = `${date.getHours()}`.padStart(2, "0");
  const minute = `${date.getMinutes()}`.padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function toLocalDateTimeInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hour = `${date.getHours()}`.padStart(2, "0");
  const minute = `${date.getMinutes()}`.padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function FilterSelect({ label, value, onChange, options }) {
  return (
    <label className="space-y-2 text-sm text-stone-700">
      <div className="font-medium text-stone-900">{label}</div>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-full border border-stone-300 bg-stone-50/80 px-4 text-sm outline-none focus:border-stone-400"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function ActivitySignalCard({ signal, selected, onSelect }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-[24px] border px-4 py-4 text-left transition ${
        selected
          ? "border-stone-900 bg-stone-900 text-white shadow-[0_20px_60px_rgba(20,16,8,0.22)]"
          : "border-stone-200 bg-stone-50/80 text-stone-900 hover:bg-white"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityIcon severity={signal.severity} className="h-4 w-4" />
            <span className="text-sm font-semibold">{signal.title}</span>
          </div>
          <div className={`mt-2 text-sm ${selected ? "text-white/82" : "text-stone-600"}`}>{signal.summary}</div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Badge className={`rounded-full border ${selected ? "border-white/20 bg-white/10 text-white" : getSeverityTone(signal.severity)}`}>{signal.severity}</Badge>
          <Badge className={`rounded-full border ${selected ? "border-white/20 bg-white/10 text-white" : "border-stone-200 bg-white text-stone-700"}`}>{signal.visibility}</Badge>
        </div>
      </div>
      <div className={`mt-3 flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.14em] ${selected ? "text-white/65" : "text-stone-400"}`}>
        <span>{signal.source_module}</span>
        <span>{signal.source_kind}</span>
        <span>{signal.review_state}</span>
        <span>{formatDateTime(signal.updated_at)}</span>
      </div>
    </button>
  );
}

function ActivityCenterDrawer() {
  const {
    drawerOpen,
    closeActivityCenter,
    filteredSignals,
    signals,
    selectedSignal,
    selectedSignalId,
    setSelectedSignalId,
    filters,
    setFilters,
    reviewHistory,
    historyLoading,
    activityError,
    refreshing,
    refreshSignals,
    submitReview,
    configureGitProfile,
    savingGitProfile,
    submittingReview,
    gitProfile,
    liveUserId,
    remoteExports,
  } = useActivityCenter();

  if (!drawerOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/28 backdrop-blur-[1px]">
      <button type="button" className="flex-1 cursor-default" onClick={closeActivityCenter} aria-label="Close activity center" />
      <div className="flex h-full w-full max-w-[1120px] flex-col border-l border-stone-200 bg-[#f6f3eb] shadow-[0_28px_120px_rgba(20,16,8,0.28)]">
        <div className="flex items-center justify-between gap-3 border-b border-stone-200 bg-white/88 px-6 py-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">Shared activity center</div>
            <div className="mt-1 text-lg font-semibold text-stone-900">{signals.length} tracked signals</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" className="rounded-full border-stone-300 bg-white" onClick={() => void refreshSignals()}>
              <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button type="button" variant="outline" className="rounded-full border-stone-300 bg-white" onClick={closeActivityCenter}>
              Close
            </Button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.1fr)]">
          <div className="flex min-h-0 flex-col border-r border-stone-200 bg-white/80">
            <div className="space-y-3 border-b border-stone-200 px-5 py-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <FilterSelect label="Module" value={filters.module} onChange={(value) => setFilters((current) => ({ ...current, module: value }))} options={[
                  { value: "all", label: "All modules" },
                  { value: "library", label: "Library" },
                  { value: "timeline", label: "Timeline" },
                ]} />
                <FilterSelect label="Severity" value={filters.severity} onChange={(value) => setFilters((current) => ({ ...current, severity: value }))} options={[
                  { value: "all", label: "All severities" },
                  { value: "error", label: "Errors" },
                  { value: "warning", label: "Warnings" },
                  { value: "info", label: "Info" },
                  { value: "success", label: "Success" },
                ]} />
                <FilterSelect label="Visibility" value={filters.visibility} onChange={(value) => setFilters((current) => ({ ...current, visibility: value }))} options={[
                  { value: "all", label: "Public + private" },
                  { value: "public", label: "Public" },
                  { value: "private", label: "Private" },
                ]} />
                <FilterSelect label="Review" value={filters.reviewState} onChange={(value) => setFilters((current) => ({ ...current, reviewState: value }))} options={[
                  { value: "all", label: "All review states" },
                  { value: "pending", label: "Pending" },
                  { value: "approved", label: "Approved" },
                  { value: "rejected", label: "Rejected" },
                  { value: "deferred", label: "Deferred" },
                ]} />
              </div>
              {activityError ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{activityError}</div> : null}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              <div className="space-y-3">
                {filteredSignals.map((signal) => (
                  <ActivitySignalCard key={signal.id} signal={signal} selected={signal.id === selectedSignalId} onSelect={() => setSelectedSignalId(signal.id)} />
                ))}
                {!filteredSignals.length ? (
                  <div className="rounded-[22px] border border-dashed border-stone-300 bg-stone-50/80 px-4 py-8 text-center text-sm text-stone-500">
                    No signals match the current filters.
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto px-5 py-5">
            {selectedSignal ? (
              <ActivitySignalDetail
                key={`${selectedSignal.id}:${gitProfile?.updated_at || "no-profile"}`}
                signal={selectedSignal}
                pendingExport={selectedSignal?.git_export || remoteExports.find((item) => item.signal_id === selectedSignalId) || null}
                reviewHistory={reviewHistory}
                historyLoading={historyLoading}
                gitProfile={gitProfile}
                savingGitProfile={savingGitProfile}
                submittingReview={submittingReview}
                liveUserId={liveUserId}
                onSubmitReview={submitReview}
                onSaveGitProfile={configureGitProfile}
              />
            ) : (
              <div className="rounded-[28px] border border-dashed border-stone-300 bg-white/85 px-6 py-10 text-center text-stone-500">
                Select a signal to inspect its provenance, review state, and private export status.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ActivitySignalDetail({
  signal,
  pendingExport,
  reviewHistory,
  historyLoading,
  gitProfile,
  savingGitProfile,
  submittingReview,
  liveUserId,
  onSubmitReview,
  onSaveGitProfile,
}) {
  const [draftNote, setDraftNote] = useState(signal.note || "");
  const [draftVisibility, setDraftVisibility] = useState(signal.visibility || "public");
  const [draftSnoozeUntil, setDraftSnoozeUntil] = useState(toLocalDateTimeInput(signal.snooze_until));
  const [gitForm, setGitForm] = useState({
    repo_path: gitProfile?.repo_path || "",
    export_subdir: gitProfile?.export_subdir || "activity-exports",
    branch_name: gitProfile?.branch_name || "",
  });

  async function handleReview(action, reviewState) {
    await onSubmitReview(signal.id, {
      action,
      review_state: reviewState,
      visibility: draftVisibility,
      note: draftNote,
      snooze_until: reviewState === "deferred" ? toIsoOrNull(draftSnoozeUntil || buildSnoozeValue()) : null,
      payload: {
        module: signal.source_module,
        source_kind: signal.source_kind,
      },
    });
  }

  async function handleSaveGitProfile() {
    await onSaveGitProfile({
      repo_path: gitForm.repo_path,
      export_subdir: gitForm.export_subdir,
      branch_name: gitForm.branch_name || null,
    });
  }

  return (
    <div className="space-y-5">
      <Card className="rounded-[28px] border-stone-200 bg-white/90 shadow-sm">
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={`rounded-full border ${getSeverityTone(signal.severity)}`}>{signal.severity}</Badge>
            <Badge className="rounded-full border border-stone-200 bg-stone-50 text-stone-700">{signal.source_module}</Badge>
            <Badge className="rounded-full border border-stone-200 bg-stone-50 text-stone-700">{signal.source_kind}</Badge>
            <Badge className="rounded-full border border-stone-200 bg-stone-50 text-stone-700">{signal.visibility}</Badge>
          </div>
          <CardTitle className="text-2xl text-stone-900">{signal.title}</CardTitle>
          <CardDescription className="text-sm text-stone-600">{signal.summary}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-[22px] border border-stone-200 bg-stone-50/80 px-4 py-4 text-sm text-stone-700">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">Provenance</div>
              <div className="mt-2 space-y-1">
                <div>Signal id: {signal.id}</div>
                <div>Entity: {signal.entity_id || "n/a"}</div>
                <div>State: {signal.signal_state}</div>
                <div>Updated: {formatDateTime(signal.updated_at)}</div>
              </div>
            </div>
            <div className="rounded-[22px] border border-stone-200 bg-stone-50/80 px-4 py-4 text-sm text-stone-700">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">Git export</div>
              <div className="mt-2 space-y-1">
                <div>Status: {pendingExport?.status || "n/a"}</div>
                <div>File: {pendingExport?.file_relpath || "Pending local commit"}</div>
                <div>Commit: {pendingExport?.commit_hash || "n/a"}</div>
                {pendingExport?.error_text ? <div className="text-rose-700">{pendingExport.error_text}</div> : null}
              </div>
            </div>
          </div>

          <label className="space-y-2 text-sm text-stone-700">
            <div className="font-medium text-stone-900">Review note</div>
            <textarea
              value={draftNote}
              onChange={(event) => setDraftNote(event.target.value)}
              className="min-h-28 w-full rounded-[22px] border border-stone-200 bg-stone-50/80 px-4 py-3 outline-none focus:border-stone-400"
              placeholder="Explain why we are approving, rejecting, or deferring this signal."
            />
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <FilterSelect label="Visibility" value={draftVisibility} onChange={setDraftVisibility} options={[
              { value: "public", label: "Public" },
              { value: "private", label: "Private" },
            ]} />
            <label className="space-y-2 text-sm text-stone-700">
              <div className="font-medium text-stone-900">Defer until</div>
              <input
                type="datetime-local"
                value={draftSnoozeUntil}
                onChange={(event) => setDraftSnoozeUntil(event.target.value)}
                className="h-11 w-full rounded-full border border-stone-300 bg-stone-50/80 px-4 text-sm outline-none focus:border-stone-400"
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" className="rounded-full bg-stone-900 text-white hover:bg-stone-800" disabled={submittingReview} onClick={() => void handleReview("approve", "approved")}>
              Approve
            </Button>
            <Button type="button" variant="outline" className="rounded-full border-stone-300 bg-white" disabled={submittingReview} onClick={() => void handleReview("reject", "rejected")}>
              Reject
            </Button>
            <Button type="button" variant="outline" className="rounded-full border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100" disabled={submittingReview} onClick={() => void handleReview("defer", "deferred")}>
              Defer
            </Button>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,0.9fr)]">
            <Card className="rounded-[24px] border-stone-200 bg-stone-50/80">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2 text-stone-900">
                  <GitBranch className="h-4 w-4" />
                  <CardTitle className="text-lg">Private repo setup</CardTitle>
                </div>
                <CardDescription className="text-sm text-stone-600">
                  {liveUserId ? "Stored for this signed-in library user." : "Stored locally until a live library session exists."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Input value={gitForm.repo_path} onChange={(event) => setGitForm((current) => ({ ...current, repo_path: event.target.value }))} placeholder="C:/Users/Owner/Coding/private-notes" className="h-11 rounded-full border-stone-300 bg-white px-4" />
                <Input value={gitForm.export_subdir} onChange={(event) => setGitForm((current) => ({ ...current, export_subdir: event.target.value }))} placeholder="activity-exports" className="h-11 rounded-full border-stone-300 bg-white px-4" />
                <Input value={gitForm.branch_name} onChange={(event) => setGitForm((current) => ({ ...current, branch_name: event.target.value }))} placeholder="Optional branch override" className="h-11 rounded-full border-stone-300 bg-white px-4" />
                <Button type="button" variant="outline" className="w-full rounded-full border-stone-300 bg-white" onClick={() => void handleSaveGitProfile()} disabled={savingGitProfile}>
                  <GitBranch className="mr-2 h-4 w-4" />
                  {savingGitProfile ? "Validating repo..." : "Validate and save git profile"}
                </Button>
                {gitProfile?.valid ? <div className="text-xs text-emerald-700">Local repo validated {formatDateTime(gitProfile.last_validated_at)}</div> : null}
                {gitProfile?.last_error ? <div className="text-xs text-rose-700">{gitProfile.last_error}</div> : null}
              </CardContent>
            </Card>

            <Card className="rounded-[24px] border-stone-200 bg-stone-50/80">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg text-stone-900">Review history</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-stone-700">
                {historyLoading ? <div>Loading history...</div> : null}
                {!historyLoading && reviewHistory.map((entry) => (
                  <div key={entry.id} className="rounded-[18px] border border-stone-200 bg-white px-3 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-medium text-stone-900">{entry.action}</div>
                      <div className="text-xs uppercase tracking-[0.14em] text-stone-400">{formatDateTime(entry.created_at)}</div>
                    </div>
                    <div className="mt-1 text-xs text-stone-500">{entry.visibility} · {entry.review_state}</div>
                    {entry.note ? <div className="mt-2 text-sm text-stone-700">{entry.note}</div> : null}
                  </div>
                ))}
                {!historyLoading && !reviewHistory.length ? (
                  <div className="rounded-[18px] border border-dashed border-stone-300 bg-white px-3 py-4 text-stone-500">
                    No review history yet.
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>

          <details className="rounded-[22px] border border-stone-200 bg-stone-50/80 px-4 py-4">
            <summary className="cursor-pointer text-sm font-medium text-stone-900">Payload details</summary>
            <pre className="mt-3 overflow-x-auto rounded-[18px] bg-stone-950 px-4 py-4 text-xs text-stone-100">{JSON.stringify(signal.payload || {}, null, 2)}</pre>
          </details>
        </CardContent>
      </Card>
    </div>
  );
}
