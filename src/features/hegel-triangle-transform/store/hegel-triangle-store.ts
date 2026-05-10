import { create } from "zustand";
import type { JsonObject } from "@/types/primitives";
import type {
  FragmentId,
  FragmentPhase,
  HegelTriangleFragmentTransformSnapshot,
  InformationGeometryLabChartKind,
  InformationGeometryMode,
  InformationGeometryLabScalarField,
  InformationGeometryLabTab,
  InformationGeometryLabViewMode,
  SemeioticLens,
  LeanTaskId,
  ProposalOutcomeState,
  ReplayEventId,
  ReplayFilter,
  ReplayProviderFilter,
  ReplayLogEntry,
  SemanticProposalId,
  SimulationState,
  WorkspaceMainView,
  AppViewState,
} from "@/types/hegel-triangle";
import { createSampleHegelTriangleSnapshot } from "../sample-data";
import {
  createNextSimulationTick,
  type SimulationTickResult,
} from "../simulation-engine";
import { defaultLeanBridge } from "@/lean/LeanBridge";
import type {
  LeanArtifactRefs,
  LeanParsedResult,
  LeanRunResult,
  LeanTask,
  LeanTheoremKind,
} from "@/lean/types";
import {
  DEFAULT_RUNTIME_CONFIG,
  isNodeRuntime,
  loadRuntimeConfigFile,
  normalizeRuntimeConfig,
  saveRuntimeConfigFile,
  type RuntimeConfig,
  type RuntimeConfigStatus,
} from "@/config/runtime-config";
import { persistSimulationHistorySnapshot } from "@/persistence/history-writer";
import {
  getActiveTrianglePatch,
  getDualChartPoints,
  getLiftedSurfacePoints,
  getScalarFieldSamples,
  getVoronoiSites,
} from "@/ig/adapters";
import { saveIGLabSnapshot } from "@/ig/snapshot-persistence";

export type SimulationSpeed = 0.5 | 1 | 2 | 4;

const IG_LAB_UI_STATE_STORAGE_KEY = "sacred-timeline:ig-lab-ui-state";

interface HegelTriangleStoreState extends HegelTriangleFragmentTransformSnapshot {
  speedMultiplier: SimulationSpeed;
  runtimeConfig: RuntimeConfig;
  runtimeConfigStatus: RuntimeConfigStatus;
  runtimeConfigDirty: boolean;
  runtimeConfigError?: string;
  play: () => void;
  pause: () => void;
  reset: () => void;
  stepSimulation: () => void;
  setSpeedMultiplier: (value: SimulationSpeed) => void;
  loadRuntimeConfig: () => Promise<void>;
  saveRuntimeConfig: () => Promise<void>;
  updateRuntimeConfig: (patch: Partial<RuntimeConfig>) => void;
  toggleLabels: () => void;
  toggleGraphEdges: () => void;
  togglePersistentLayerVisibility: () => void;
  toggleAcceptedOverlay: () => void;
  toggleRejectedOverlay: () => void;
  togglePromoteOnlyAccepted: () => void;
  toggleKeepPromisingItems: () => void;
  clearPersistentLayer: () => void;
  playReplay: () => void;
  pauseReplay: () => void;
  exitReplay: () => void;
  stepReplay: (delta: number) => void;
  stepPlayback: () => void;
  setReplayTick: (tick: number) => void;
  selectReplayEvent: (eventId: ReplayEventId) => void;
  setReplayFilter: (filter: ReplayFilter) => void;
  setReplayProviderFilter: (filter: ReplayProviderFilter) => void;
  selectFragment: (fragmentId: FragmentId) => void;
  selectProposal: (proposalId: SemanticProposalId) => void;
  setActiveMainView: (view: WorkspaceMainView) => void;
  toggleInformationGeometryLab: () => void;
  setInformationGeometryLabTab: (tab: InformationGeometryLabTab) => void;
  updateInformationGeometryLabState: (patch: Partial<AppViewState["informationGeometryLab"]>) => void;
  setInformationGeometryLabViewMode: (mode: InformationGeometryLabViewMode) => void;
  setInformationGeometryMode: (mode: InformationGeometryMode) => void;
  setInformationGeometryLabChartKind: (kind: InformationGeometryLabChartKind) => void;
  setInformationGeometryLabScalarField: (field: InformationGeometryLabScalarField) => void;
  updateSemeioticState: (patch: Partial<AppViewState["semeiotic"]>) => void;
  toggleSemeioticRuntime: () => void;
  setSemeioticLens: (lens: SemeioticLens) => void;
  recordInformationGeometryEvent: (entry: {
    eventType: ReplayLogEntry["eventType"];
    message: string;
    fragmentId?: FragmentId;
    proposalId?: SemanticProposalId;
    payload?: JsonObject;
    tick?: number;
  }) => void;
  rerunLeanTask: (proposalId?: SemanticProposalId) => void;
  hoverFragment: (fragmentId?: FragmentId) => void;
}

function buildInitialStoreState(): Pick<
  HegelTriangleStoreState,
  "simulation" | "view" | "speedMultiplier" | "runtimeConfig" | "runtimeConfigStatus" | "runtimeConfigDirty" | "runtimeConfigError"
> {
  const snapshot = createSampleHegelTriangleSnapshot();
  return {
    ...snapshot,
    view: loadPersistedIGLabViewState(applyRuntimeConfigToView(snapshot.view, DEFAULT_RUNTIME_CONFIG)),
    speedMultiplier: 1,
    runtimeConfig: DEFAULT_RUNTIME_CONFIG,
    runtimeConfigStatus: "idle",
    runtimeConfigDirty: false,
    runtimeConfigError: undefined,
  };
}

const REAL_LEAN_REPLAY_LOG_LIMIT = 120;
const pendingLeanBridgeTasks = new Set<LeanTaskId>();

function supportsLocalLeanBridge() {
  return typeof fetch === "function";
}

function supportsPersistentUiState() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function asObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function loadPersistedIGLabViewState(view: AppViewState): AppViewState {
  if (!supportsPersistentUiState()) {
    return view;
  }

  try {
    const raw = window.localStorage.getItem(IG_LAB_UI_STATE_STORAGE_KEY);
    if (!raw) {
      return view;
    }

    const parsed = asObject(JSON.parse(raw));
    if (!parsed) {
      return view;
    }

    const modulePanels = asObject(parsed.modulePanels);
    const informationGeometryLab = asObject(parsed.informationGeometryLab);
    const semeiotic = asObject(parsed.semeiotic);
    const activeMainView =
      parsed.activeMainView === "triangle" || parsed.activeMainView === "information-geometry-lab"
        ? parsed.activeMainView
        : view.activeMainView;

    const semeioticPatch = {
      ...(semeiotic as Partial<AppViewState["semeiotic"]> | undefined),
      ...(typeof semeiotic?.runtimeEnabled === "boolean"
        ? {
            semeioticsEnabled: semeiotic.runtimeEnabled,
          }
        : {}),
      ...(typeof semeiotic?.autoAnnotate === "boolean"
        ? {
            semeioticAutoAnnotate: semeiotic.autoAnnotate,
          }
        : {}),
      ...(typeof semeiotic?.showInspectorSection === "boolean"
        ? {
            semeioticGrammarPanelOpen: semeiotic.showInspectorSection,
          }
        : {}),
    };

    return {
      ...view,
      activeMainView,
      modulePanels: {
        ...view.modulePanels,
        ...(modulePanels as Partial<AppViewState["modulePanels"]> | undefined),
      },
      semeiotic: {
        ...view.semeiotic,
        ...semeioticPatch,
      },
      informationGeometryLab: {
        ...view.informationGeometryLab,
        ...(informationGeometryLab as Partial<AppViewState["informationGeometryLab"]> | undefined),
      },
    };
  } catch {
    return view;
  }
}

function persistIGLabViewState(view: AppViewState) {
  if (!supportsPersistentUiState()) {
    return;
  }

  try {
    window.localStorage.setItem(
      IG_LAB_UI_STATE_STORAGE_KEY,
      JSON.stringify({
        activeMainView: view.activeMainView,
        modulePanels: view.modulePanels,
        semeiotic: view.semeiotic,
        informationGeometryLab: view.informationGeometryLab,
      }),
    );
  } catch {
    // Ignore UI-state persistence failures and keep the app interactive.
  }
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asPhase(value: unknown): FragmentPhase | undefined {
  return value === "latent" ||
    value === "nucleating" ||
    value === "crystallizing" ||
    value === "externalized" ||
    value === "stabilized"
    ? value
    : undefined;
}

function appendReplayEvent(simulation: SimulationState, entry: ReplayLogEntry) {
  simulation.replayLog = [...simulation.replayLog, entry].slice(-REAL_LEAN_REPLAY_LOG_LIMIT);
}

function proposalHasSemeioticData(proposal: SimulationState["proposals"][SemanticProposalId] | undefined) {
  const payload = asObject(proposal?.payload);
  const orchestration = asObject(payload?.orchestration);
  const rawMoments = Array.isArray(orchestration?.semeioticMoments) ? orchestration.semeioticMoments : undefined;
  return Boolean(payload?.semeiotic) || Boolean(orchestration?.semeiotic) || Boolean(rawMoments?.length);
}

function simulationHasHistoricalSemeioticData(simulation: SimulationState) {
  return (
    simulation.replayLog.some((entry) => entry.eventType.startsWith("semeiotic_")) ||
    Object.values(simulation.proposals).some((proposal) => proposalHasSemeioticData(proposal))
  );
}

function appendReplayEventIfMissing(simulation: SimulationState, entry: ReplayLogEntry) {
  if (simulation.replayLog.some((candidate) => candidate.id === entry.id)) {
    return;
  }

  appendReplayEvent(simulation, entry);
}

function appendSemeioticReplayEventsForTick(simulation: SimulationState, tick: number) {
  const proposals = Object.values(simulation.proposals).filter(
    (proposal) => proposal.updatedAtTick === tick && proposalHasSemeioticData(proposal),
  );

  for (const proposal of proposals) {
    const payload = asObject(proposal.payload);
    const orchestration = asObject(payload?.orchestration);
    const rawMoments = Array.isArray(orchestration?.semeioticMoments) ? orchestration.semeioticMoments : [];
    const summary = asObject(orchestration?.semeioticMomentSummary);
    const mismatchCount = rawMoments.reduce((sum, rawMoment) => {
      const moment = asObject(rawMoment);
      const mismatches = Array.isArray(moment?.mismatches) ? moment.mismatches : [];
      return sum + mismatches.length;
    }, 0);
    const linkedCount = rawMoments.reduce((sum, rawMoment) => {
      const moment = asObject(rawMoment);
      const linkedMomentIds = Array.isArray(moment?.linkedMomentIds) ? moment.linkedMomentIds : [];
      return sum + linkedMomentIds.length;
    }, 0);

    if (rawMoments.length > 0) {
      appendReplayEventIfMissing(simulation, {
        id: `semeiotic_annotation_created_${proposal.id}_${tick}` as ReplayEventId,
        tick,
        eventType: "semeiotic_annotation_created",
        fragmentId: proposal.fragmentId,
        proposalId: proposal.id,
        message: `Created ${rawMoments.length} semeiotic moment annotations for ${proposal.title}.`,
        payload: {
          momentCount: rawMoments.length,
        },
      });
    }

    if (mismatchCount > 0) {
      appendReplayEventIfMissing(simulation, {
        id: `semeiotic_mismatch_detected_${proposal.id}_${tick}` as ReplayEventId,
        tick,
        eventType: "semeiotic_mismatch_detected",
        fragmentId: proposal.fragmentId,
        proposalId: proposal.id,
        message: `Detected ${mismatchCount} semeiotic mismatches for ${proposal.title}.`,
        payload: {
          mismatchCount,
        },
      });
    }

    if (summary) {
      const summaryPayload: JsonObject = {
        ...(typeof summary.object === "string" ? { object: summary.object } : {}),
        ...(typeof summary.signVehicle === "string" ? { signVehicle: summary.signVehicle } : {}),
        ...(typeof summary.interpretant === "string" ? { interpretant: summary.interpretant } : {}),
        ...(typeof summary.confidence === "number" ? { confidence: summary.confidence } : {}),
      };
      appendReplayEventIfMissing(simulation, {
        id: `semeiotic_summary_updated_${proposal.id}_${tick}` as ReplayEventId,
        tick,
        eventType: "semeiotic_summary_updated",
        fragmentId: proposal.fragmentId,
        proposalId: proposal.id,
        message: `Updated semeiotic summary for ${proposal.title}.`,
        payload: summaryPayload,
      });
    }

    if (linkedCount > 0) {
      appendReplayEventIfMissing(simulation, {
        id: `semeiotic_chain_linked_${proposal.id}_${tick}` as ReplayEventId,
        tick,
        eventType: "semeiotic_chain_linked",
        fragmentId: proposal.fragmentId,
        proposalId: proposal.id,
        message: `Linked ${linkedCount} semeiotic chain relations for ${proposal.title}.`,
        payload: {
          linkCount: linkedCount,
        },
      });
    }
  }
}

function syncInformationGeometryLabState(
  labState: AppViewState["informationGeometryLab"],
  simulation: SimulationState,
  patch?: Partial<AppViewState["informationGeometryLab"]>,
): AppViewState["informationGeometryLab"] {
  const nextState = {
    ...labState,
    ...patch,
  };

  if (!nextState.autoFollowActiveFragment || nextState.freezeCurrentSnapshot) {
    return nextState;
  }

  return {
    ...nextState,
    selectedFragmentId: simulation.activeFragmentId ?? nextState.selectedFragmentId,
    selectedProposalId: simulation.activeProposalId ?? nextState.selectedProposalId,
    selectedTick: simulation.activeTick,
  };
}

function syncInformationGeometryLabFromSimulation(
  labState: AppViewState["informationGeometryLab"],
  simulation: SimulationState,
  patch?: Partial<AppViewState["informationGeometryLab"]>,
): AppViewState["informationGeometryLab"] {
  if (!labState.autoFollowActiveFragment || labState.freezeCurrentSnapshot) {
    return labState;
  }

  return syncInformationGeometryLabState(labState, simulation, patch);
}

function semeioticRuntimeActive(state: Pick<HegelTriangleStoreState, "view">) {
  return state.view.semeiotic.semeioticsEnabled;
}

function applyRuntimeConfigToSimulation(
  simulation: SimulationState,
  runtimeConfig: RuntimeConfig,
  semeioticsEnabled = runtimeConfig.enableSemeiotics,
): SimulationState {
  const limit = Math.max(1, runtimeConfig.maxProposalsPerFragment);
  let changed = false;
  const nextFragments = { ...simulation.fragments };
  let nextProposals = simulation.proposals;

  if (!semeioticsEnabled) {
    const strippedEntries = Object.entries(simulation.proposals).map(([proposalId, proposal]) => {
      const payload = asObject(proposal.payload);
      const orchestration = asObject(payload?.orchestration);
      const rawMoves = Array.isArray(orchestration?.dialecticMoves) ? orchestration.dialecticMoves : undefined;
      const rawMoments = Array.isArray(orchestration?.semeioticMoments) ? orchestration.semeioticMoments : undefined;

      const hasSemeioticPayload =
        Boolean(payload?.semeiotic) ||
        Boolean(orchestration?.semeiotic) ||
        Boolean(orchestration?.semeioticMomentSummary) ||
        Boolean(rawMoments?.length) ||
        Boolean(rawMoves?.some((move) => Boolean(asObject(move)?.semeiotic)));

      if (!hasSemeioticPayload) {
        return [proposalId, proposal] as const;
      }

      changed = true;
      return [
        proposalId,
        {
          ...proposal,
          payload: {
            ...payload,
            ...(payload && "semeiotic" in payload ? { semeiotic: undefined } : {}),
            ...(orchestration
              ? {
                  orchestration: {
                    ...orchestration,
                    ...(orchestration && "semeiotic" in orchestration ? { semeiotic: undefined } : {}),
                    ...(orchestration && "semeioticMoments" in orchestration ? { semeioticMoments: undefined } : {}),
                    ...(orchestration && "semeioticMomentSummary" in orchestration
                      ? { semeioticMomentSummary: undefined }
                      : {}),
                    ...(rawMoves
                      ? {
                          dialecticMoves: rawMoves.map((move) => {
                            const record = asObject(move);
                            if (!record || !("semeiotic" in record)) {
                              return move;
                            }
                            return {
                              ...record,
                              semeiotic: undefined,
                              ...(record && "linkedDialecticalMomentId" in record
                                ? { linkedDialecticalMomentId: undefined }
                                : {}),
                              ...(record && "linkedDialecticalMoment" in record
                                ? { linkedDialecticalMoment: undefined }
                                : {}),
                            };
                          }),
                        }
                      : {}),
                  },
                }
              : {}),
          },
        },
      ] as const;
    });

    nextProposals = Object.fromEntries(strippedEntries) as SimulationState["proposals"];
  }

  for (const fragment of Object.values(simulation.fragments)) {
    if (fragment.activeProposalIds.length <= limit) {
      continue;
    }

    changed = true;
    nextFragments[fragment.id] = {
      ...fragment,
      activeProposalIds: fragment.activeProposalIds.slice(0, limit),
    };
  }

  if (!changed) {
    return simulation;
  }

  const nextActiveProposalId =
    simulation.activeProposalId &&
    Object.values(nextFragments).some((fragment) => fragment.activeProposalIds.includes(simulation.activeProposalId!))
      ? simulation.activeProposalId
      : simulation.activeFragmentId
        ? nextFragments[simulation.activeFragmentId]?.activeProposalIds[0]
        : simulation.activeProposalId;

  return {
    ...simulation,
    fragments: nextFragments,
    proposals: nextProposals,
    activeProposalId: nextActiveProposalId,
  };
}

function informationGeometryLabTabForViewMode(mode: InformationGeometryLabViewMode): InformationGeometryLabTab {
  switch (mode) {
    case "voronoi":
      return "voronoi";
    case "dualCharts":
      return "charts";
    case "liftedSurface":
      return "potential";
    case "accumulation":
      return "history";
    case "localPatch":
    default:
      return "patches";
  }
}

function applyRuntimeConfigToView(view: AppViewState, runtimeConfig: RuntimeConfig): AppViewState {
  const nextIGView: AppViewState["informationGeometryLab"] = {
    ...view.informationGeometryLab,
    selectedIGViewMode: runtimeConfig.defaultIGViewMode,
    selectedGeometryMode: runtimeConfig.defaultGeometryMode,
    selectedChartKind: runtimeConfig.defaultChartKind,
    voronoiGridResolution: runtimeConfig.voronoiGridResolution,
    accumulationTrailLength: Math.max(1, runtimeConfig.accumulationTrailLimit),
    barycenterSourceMode: runtimeConfig.defaultBarycenterMode,
    selectedFlowMode: runtimeConfig.defaultFlowMode,
    regressionDisplayMode: runtimeConfig.defaultRegressionMode,
    selectedScalarField: runtimeConfig.defaultScalarField,
  };

  return {
    ...view,
    modulePanels: {
      ...view.modulePanels,
      informationGeometryLabTab: informationGeometryLabTabForViewMode(runtimeConfig.defaultIGViewMode),
    },
    semeiotic: {
      ...view.semeiotic,
      semeioticsEnabled: runtimeConfig.enableSemeiotics,
      semeioticAutoAnnotate: runtimeConfig.semeioticAutoAnnotate,
      logRawOutputs: runtimeConfig.semeioticLogRawOutputs,
      influencesPromiseProfile: runtimeConfig.semeioticInfluencesPromiseProfile,
      selectedLens: runtimeConfig.defaultSemeioticLens,
      semeioticGrammarPanelOpen: runtimeConfig.semeioticInspectorVisibleByDefault,
    },
    informationGeometryLab: nextIGView,
  };
}

function pruneLiveMemoryState(state: HegelTriangleStoreState) {
  const liveWindow = Math.max(1, state.runtimeConfig.liveTickWindow);
  const cutoffTick = Math.max(0, state.simulation.activeTick - liveWindow + 1);
  const keptReplayLog = state.simulation.replayLog.filter((entry) => entry.tick >= cutoffTick);
  const replayProposalIds = new Set(
    keptReplayLog
      .map((entry) => entry.proposalId)
      .filter((proposalId): proposalId is SemanticProposalId => Boolean(proposalId)),
  );

  const protectedProposalIds = new Set<SemanticProposalId>();
  if (state.simulation.activeProposalId) {
    protectedProposalIds.add(state.simulation.activeProposalId);
  }
  if (state.view.selectedProposalId) {
    protectedProposalIds.add(state.view.selectedProposalId);
  }
  for (const proposalId of replayProposalIds) {
    protectedProposalIds.add(proposalId);
  }
  for (const fragment of Object.values(state.simulation.fragments)) {
    if (fragment.id === state.simulation.activeFragmentId || fragment.id === state.view.selectedFragmentId) {
      for (const proposalId of fragment.activeProposalIds) {
        protectedProposalIds.add(proposalId);
      }
    }
  }

  const nextProposals = Object.fromEntries(
    Object.entries(state.simulation.proposals).filter(([, proposal]) => {
      return proposal.updatedAtTick >= cutoffTick || protectedProposalIds.has(proposal.id);
    }),
  ) as SimulationState["proposals"];

  const keptProposalIds = new Set(Object.keys(nextProposals) as SemanticProposalId[]);

  const nextFragments = Object.fromEntries(
    Object.entries(state.simulation.fragments).map(([fragmentId, fragment]) => [
      fragmentId,
      {
        ...fragment,
        activeProposalIds: fragment.activeProposalIds.filter((proposalId) => keptProposalIds.has(proposalId)),
      },
    ]),
  ) as SimulationState["fragments"];

  const keptLeanTasks = Object.fromEntries(
    Object.entries(state.simulation.leanTasks).filter(([, leanTask]) => {
      const completedAtTick = leanTask.completedAtTick ?? leanTask.requestedAtTick;
      const linkedProposalRetained = Array.from(keptProposalIds).some(
        (proposalId) => state.simulation.proposals[proposalId]?.leanTask?.id === leanTask.id,
      );
      return completedAtTick >= cutoffTick || linkedProposalRetained;
    }),
  ) as SimulationState["leanTasks"];

  const keptLeanTaskIds = new Set(Object.keys(keptLeanTasks) as LeanTaskId[]);

  const nextProofAttempts = Object.fromEntries(
    Object.entries(state.simulation.proofAttempts).filter(([, attempt]) => {
      return attempt.lastUpdatedTick >= cutoffTick || keptLeanTaskIds.has(attempt.taskId);
    }),
  ) as SimulationState["proofAttempts"];

  const nextAcceptedHistory = state.simulation.acceptedHistory.filter((entry) => entry.recordedAtTick >= cutoffTick);
  const nextRejectedHistory = state.simulation.rejectedHistory.filter((entry) => entry.recordedAtTick >= cutoffTick);
  const nextProposalQueue = state.simulation.proposalQueue.filter((proposalId) => keptProposalIds.has(proposalId));

  const nextActiveProposalId =
    state.simulation.activeProposalId && keptProposalIds.has(state.simulation.activeProposalId)
      ? state.simulation.activeProposalId
      : state.simulation.activeFragmentId
        ? nextFragments[state.simulation.activeFragmentId]?.activeProposalIds[0]
        : undefined;

  const nextSelectedProposalId =
    state.view.selectedProposalId && keptProposalIds.has(state.view.selectedProposalId)
      ? state.view.selectedProposalId
      : nextActiveProposalId;

  const nextSelectedEventId =
    state.view.replay.selectedEventId && keptReplayLog.some((entry) => entry.id === state.view.replay.selectedEventId)
      ? state.view.replay.selectedEventId
      : keptReplayLog[keptReplayLog.length - 1]?.id;

  const nextLiveObservedEventId =
    state.view.replay.liveObservedEventId &&
    keptReplayLog.some((entry) => entry.id === state.view.replay.liveObservedEventId)
      ? state.view.replay.liveObservedEventId
      : entriesForTick(
          {
            ...state.simulation,
            replayLog: keptReplayLog,
          },
          state.simulation.activeTick,
        )[0]?.id;

  return {
    simulation: {
      ...state.simulation,
      proposals: nextProposals,
      fragments: nextFragments,
      leanTasks: keptLeanTasks,
      proofAttempts: nextProofAttempts,
      acceptedHistory: nextAcceptedHistory,
      rejectedHistory: nextRejectedHistory,
      replayLog: keptReplayLog,
      proposalQueue: nextProposalQueue,
      activeProposalId: nextActiveProposalId,
    },
    view: {
      ...state.view,
      selectedProposalId: nextSelectedProposalId,
      replay: {
        ...state.view.replay,
        selectedEventId: nextSelectedEventId,
        liveObservedEventId: nextLiveObservedEventId,
        tick: Math.max(cutoffTick, Math.min(state.view.replay.tick, state.simulation.activeTick)),
      },
    },
  };
}

async function persistAndPruneLiveMemory(
  set: (partial: Partial<HegelTriangleStoreState> | ((state: HegelTriangleStoreState) => Partial<HegelTriangleStoreState>)) => void,
  get: () => HegelTriangleStoreState,
) {
  const state = get();
  if (!supportsLocalLeanBridge()) {
    return;
  }

  const result = await persistSimulationHistorySnapshot(
    state.runtimeConfig.databasePath,
    state.runtimeConfig.artifactDirectory,
    state.simulation,
    {
      semeioticLogRawOutputs: semeioticRuntimeActive(state) && state.view.semeiotic.logRawOutputs,
    },
  );
  if (!result.persisted) {
    return;
  }

  await persistBackgroundIGSnapshot(state.simulation, state.view, state.runtimeConfig);
  set((current) => pruneLiveMemoryState(current));
}

function leanVectorPayload(task: LeanTask): JsonObject {
  const output: JsonObject = {
    sourceVector: [...task.sourceVectors.source],
    targetVector: [...task.sourceVectors.target],
    theoremKind: task.theoremKind,
  };

  if (task.sourceVectors.repaired) {
    output.repairedVector = [...task.sourceVectors.repaired];
  }

  return output;
}

function leanBridgeProjectionValue(simulation: SimulationState, proposalId: SemanticProposalId) {
  const payload = asRecord(simulation.proposals[proposalId]?.payload);
  const orchestration = asRecord(payload?.orchestration);
  const leanBoundary = asRecord(orchestration?.leanBoundary);
  return asNumber(leanBoundary?.projectionDivergence) ?? 0;
}

function theoremKindForProposalOutcome(proposal: SimulationState["proposals"][SemanticProposalId]): LeanTheoremKind {
  switch (proposal.proposalKind) {
    case "bridge_lemma":
      return "projection_skeleton_check";
    case "projection_rule":
    case "compatibility_claim":
      return "projection_skeleton_check";
    case "obstruction_claim":
      return "projection_skeleton_check";
    default:
      return "quadratic_nonnegativity_check";
  }
}

function buildLeanTask(
  simulation: SimulationState,
  proposalId: SemanticProposalId,
  runtimeConfig: RuntimeConfig,
): LeanTask | undefined {
  const proposal = simulation.proposals[proposalId];
  const fragment = proposal ? simulation.fragments[proposal.fragmentId] : undefined;
  const leanTaskId = proposal?.leanTask?.id;

  if (!proposal || !fragment || !leanTaskId) {
    return undefined;
  }

  return {
    taskId: leanTaskId,
    fragmentId: fragment.id,
    proposalId: proposal.id,
    theoremKind: theoremKindForProposalOutcome(proposal),
    sourceVectors: {
      source: [...fragment.theta],
      target: [...proposal.theta],
      repaired: [...proposal.eta],
    },
    projectionValue: leanBridgeProjectionValue(simulation, proposalId),
    outputPath: `${leanTaskId}.lean`,
    runtimeCommand:
      runtimeConfig.leanRuntimeMode === "external" ? runtimeConfig.leanRuntimeCommand : undefined,
  };
}

function runLeanBridgeForProposal(
  set: (partial: Partial<HegelTriangleStoreState> | ((state: HegelTriangleStoreState) => Partial<HegelTriangleStoreState>)) => void,
  get: () => HegelTriangleStoreState,
  proposalId: SemanticProposalId,
) {
  const state = get();
  const runtimeConfig = state.runtimeConfig;
  const task = buildLeanTask(state.simulation, proposalId, runtimeConfig);
  if (
    !task ||
    pendingLeanBridgeTasks.has(task.taskId) ||
    !supportsLocalLeanBridge() ||
    runtimeConfig.leanRuntimeMode !== "external"
  ) {
    return;
  }

  pendingLeanBridgeTasks.add(task.taskId);

  set((current) => {
    const proposal = current.simulation.proposals[proposalId];
    if (!proposal) {
      return {};
    }

    const nextSimulation: SimulationState = {
      ...current.simulation,
      proposals: { ...current.simulation.proposals },
      replayLog: [...current.simulation.replayLog],
    };
    const payload = asRecord(proposal.payload) ?? {};
    const orchestration = asRecord(payload.orchestration) ?? {};
    const currentLeanBridge = asRecord(orchestration.leanBridge) ?? {};

    nextSimulation.proposals[proposalId] = {
      ...proposal,
      payload: {
        ...payload,
        orchestration: {
          ...orchestration,
          leanBridge: {
            ...currentLeanBridge,
            status: "preparing",
            command: null,
            sourceVector: [...task.sourceVectors.source],
            targetVector: [...task.sourceVectors.target],
            theoremKind: task.theoremKind,
            ...(task.sourceVectors.repaired ? { repairedVector: [...task.sourceVectors.repaired] } : {}),
          } as JsonObject,
        },
      },
    };

    return { simulation: nextSimulation };
  });

  void (async () => {
    let snippetArtifactPath: string | undefined;

    try {
      const preparedResult = await defaultLeanBridge.writeSnippet(task, {
        artifactDirectory: runtimeConfig.artifactDirectory,
        persistSnippet: true,
      });
      const prepared = preparedResult.prepared;
      snippetArtifactPath = preparedResult.artifactRefs.snippetPath;

      set((current) => {
        const proposal = current.simulation.proposals[proposalId];
        if (!proposal) {
          return {};
        }

        const nextSimulation: SimulationState = {
          ...current.simulation,
          proposals: { ...current.simulation.proposals },
          replayLog: [...current.simulation.replayLog],
        };
        const payload = (asRecord(proposal.payload) ?? {}) as JsonObject;
        const orchestration = (asRecord(payload.orchestration) ?? {}) as JsonObject;
        const currentLeanBridge = (asRecord(orchestration.leanBridge) ?? {}) as JsonObject;

        nextSimulation.proposals[proposalId] = {
          ...proposal,
          payload: {
            ...payload,
            orchestration: {
              ...orchestration,
              leanBridge: {
                ...currentLeanBridge,
                status: "snippet_generated",
                command: prepared.command,
                snippetPath: snippetArtifactPath ?? prepared.snippet.filePath,
                moduleName: prepared.snippet.moduleName,
                importLine: prepared.snippet.importLine,
              },
            },
          },
        };

        appendReplayEvent(nextSimulation, {
          id: `replay_event_${current.simulation.activeTick}_${proposalId}_lean_snippet` as ReplayEventId,
          tick: current.simulation.activeTick,
          eventType: "lean_artifact_prepared",
          fragmentId: proposal.fragmentId,
          proposalId,
          message: `Generated Lean snippet for ${proposal.title}.`,
          payload: {
            sourceProviders: ["lean-verifier"],
            leanBridge: true,
            leanBridgeStage: "snippet_generated",
            leanStatus: "snippet_generated",
            snippetPath: snippetArtifactPath ?? prepared.snippet.filePath,
            command: prepared.command,
            ...leanVectorPayload(task),
            projection: task.projectionValue,
            phase: current.simulation.fragments[proposal.fragmentId]?.phase ?? "latent",
          },
        });

        appendReplayEvent(nextSimulation, {
          id: `replay_event_${current.simulation.activeTick}_${proposalId}_lean_start` as ReplayEventId,
          tick: current.simulation.activeTick,
          eventType: "lean_artifact_prepared",
          fragmentId: proposal.fragmentId,
          proposalId,
          message: `Started Lean run for ${proposal.title}.`,
          payload: {
            sourceProviders: ["lean-verifier"],
            leanBridge: true,
            leanBridgeStage: "run_started",
            leanStatus: "running",
            snippetPath: snippetArtifactPath ?? prepared.snippet.filePath,
            command: prepared.command,
            ...leanVectorPayload(task),
            projection: task.projectionValue,
            phase: current.simulation.fragments[proposal.fragmentId]?.phase ?? "latent",
          },
        });

        return { simulation: nextSimulation };
      });

      const execution = await defaultLeanBridge.runPreparedTask(prepared, {
        artifactDirectory: runtimeConfig.artifactDirectory,
        persistRawLeanStdout: runtimeConfig.persistRawLeanStdout,
        persistRawLeanStderr: runtimeConfig.persistRawLeanStderr,
        snippetPath: snippetArtifactPath,
      });
      const runResult = execution.runResult;
      const parsed = execution.parsed;
      const artifactRefs = execution.artifactRefs;

      set((current) => {
        const useFallback = Boolean(runResult.spawnError);
        return {
          simulation: useFallback
            ? applyLeanFallback(current.simulation, proposalId, runResult, artifactRefs)
            : applyLeanParsedResult(
                current.simulation,
                proposalId,
                parsed,
                runResult,
                artifactRefs,
              ),
        };
      });
      void persistAndPruneLiveMemory(set, get);
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);

      set((current) => {
        const proposal = current.simulation.proposals[proposalId];
        if (!proposal) {
          return {};
        }

        const nextSimulation: SimulationState = {
          ...current.simulation,
          proposals: { ...current.simulation.proposals },
          replayLog: [...current.simulation.replayLog],
        };
        const payload = (asRecord(proposal.payload) ?? {}) as JsonObject;
        const orchestration = (asRecord(payload.orchestration) ?? {}) as JsonObject;
        const currentLeanBridge = (asRecord(orchestration.leanBridge) ?? {}) as JsonObject;

        nextSimulation.proposals[proposalId] = {
          ...proposal,
          payload: {
            ...payload,
            orchestration: {
              ...orchestration,
              leanBridge: {
                ...currentLeanBridge,
                status: "failed",
                ...(snippetArtifactPath
                  ? { snippetPath: snippetArtifactPath }
                  : typeof currentLeanBridge.snippetPath === "string"
                    ? { snippetPath: currentLeanBridge.snippetPath }
                    : {}),
              } as JsonObject,
            },
          } as JsonObject,
        };

        appendReplayEvent(nextSimulation, {
          id: `replay_event_${current.simulation.activeTick}_${proposalId}_lean_error` as ReplayEventId,
          tick: current.simulation.activeTick,
          eventType: "proposal_verified",
          fragmentId: proposal.fragmentId,
          proposalId,
          message: `Real Lean bridge failed for ${proposal.title}; retained mock verification.`,
          payload: {
            sourceProviders: ["lean-verifier"],
            leanBridge: true,
            leanBridgeStage: "run_finished",
            leanStatus: "failed",
            errors: [errorText],
          } as JsonObject,
        });

        return { simulation: nextSimulation };
      });
      void persistAndPruneLiveMemory(set, get);
    } finally {
      pendingLeanBridgeTasks.delete(task.taskId);
    }
  })();
}

function outcomeFromParsedResult(
  parsed: LeanParsedResult,
  fallback: ProposalOutcomeState,
): ProposalOutcomeState {
  if (parsed.accepted) {
    return "accepted";
  }
  if (parsed.blocked) {
    return "blocked";
  }
  if (parsed.rejected) {
    return "rejected";
  }
  return fallback;
}

function projectionFromLeanParsedResult(
  parsed: LeanParsedResult,
  fallbackProjection?: number,
) {
  if (parsed.accepted) {
    return 0;
  }
  if (parsed.blocked) {
    return 0.48;
  }
  if (parsed.rejected) {
    return 0.82;
  }
  if (typeof parsed.negAdjField?.projectionDivergence === "number") {
    return parsed.negAdjField.projectionDivergence;
  }
  return fallbackProjection ?? 0;
}

function applyLeanParsedResult(
  simulation: SimulationState,
  proposalId: SemanticProposalId,
  parsed: LeanParsedResult,
  runResult: LeanRunResult,
  artifactRefs: LeanArtifactRefs = {},
) {
  const proposal = simulation.proposals[proposalId];
  if (!proposal) {
    return simulation;
  }

  const fragment = simulation.fragments[proposal.fragmentId];
  if (!fragment) {
    return simulation;
  }

  const nextSimulation: SimulationState = {
    ...simulation,
    fragments: { ...simulation.fragments },
    proposals: { ...simulation.proposals },
    leanTasks: { ...simulation.leanTasks },
    replayLog: [...simulation.replayLog],
  };

  const currentPayload = (asRecord(proposal.payload) ?? {}) as JsonObject;
  const currentOrchestration = (asRecord(currentPayload.orchestration) ?? {}) as JsonObject;
  const currentDivergenceField = (asRecord(currentOrchestration.divergenceField) ?? {}) as JsonObject;
  const currentLeanBoundary = (asRecord(currentOrchestration.leanBoundary) ?? {}) as JsonObject;
  const currentLeanBridge = (asRecord(currentOrchestration.leanBridge) ?? {}) as JsonObject;
  const nextProjection = projectionFromLeanParsedResult(
    parsed,
    asNumber(currentLeanBoundary.projectionDivergence),
  );
  const nextOutcome = outcomeFromParsedResult(parsed, proposal.verificationState);
  const nextPhase = asPhase(parsed.extractedNegAdjValues?.phase) ?? fragment.phase;
  const sourceVector =
    Array.isArray(currentLeanBridge.sourceVector) && currentLeanBridge.sourceVector.every((value) => typeof value === "number")
      ? [...(currentLeanBridge.sourceVector as number[])]
      : [...fragment.theta];
  const targetVector =
    Array.isArray(currentLeanBridge.targetVector) && currentLeanBridge.targetVector.every((value) => typeof value === "number")
      ? [...(currentLeanBridge.targetVector as number[])]
      : [...proposal.theta];
  const repairedVector =
    Array.isArray(currentLeanBridge.repairedVector) && currentLeanBridge.repairedVector.every((value) => typeof value === "number")
      ? [...(currentLeanBridge.repairedVector as number[])]
      : [...proposal.eta];

  const nextForward = parsed.negAdjField?.forward ?? asNumber(currentDivergenceField.forward) ?? 0;
  const nextReverse = parsed.negAdjField?.reverse ?? asNumber(currentDivergenceField.reverse) ?? 0;
  const nextAsymmetry =
    parsed.negAdjField?.asymmetry ?? asNumber(currentDivergenceField.asymmetry) ?? Math.abs(nextForward - nextReverse);
  const nextCurvature = asNumber(currentDivergenceField.curvature) ?? 0;
  const nextTotal = Number((nextForward + nextReverse + nextProjection).toFixed(6));
  const divergenceFieldPayload: JsonObject = {
    ...currentDivergenceField,
    forward: nextForward,
    reverse: nextReverse,
    asymmetry: nextAsymmetry,
    curvature: nextCurvature,
    projection: nextProjection,
    projectionDivergence: nextProjection,
    total: nextTotal,
  };
  const leanBoundaryPayload: JsonObject = {
    ...currentLeanBoundary,
    simulationOutcome: nextOutcome,
    projectionDivergence: nextProjection,
  };
  const leanBridgePayload: JsonObject = {
    ...currentLeanBridge,
    status: parsed.accepted ? "accepted" : parsed.blocked ? "blocked" : parsed.rejected ? "rejected" : "completed",
    command: runResult.command,
    executed: runResult.executed,
    timedOut: runResult.timedOut ?? false,
    durationMs: runResult.durationMs ?? null,
    exitCode: runResult.exitCode ?? null,
    signal: runResult.signal ?? null,
    snippetPath: artifactRefs.snippetPath ?? runResult.snippet.filePath,
    moduleName: runResult.snippet.moduleName,
    importLine: runResult.snippet.importLine,
    sourceVector,
    targetVector,
    repairedVector,
    ...(artifactRefs.stdoutPath ? { stdoutPath: artifactRefs.stdoutPath } : {}),
    ...(artifactRefs.stderrPath ? { stderrPath: artifactRefs.stderrPath } : {}),
    ...(artifactRefs.snapshotPath ? { snapshotPath: artifactRefs.snapshotPath } : {}),
    ...(parsed.extractedNegAdjValues?.phase ? { phase: parsed.extractedNegAdjValues.phase } : {}),
  };
  const nextPayload: JsonObject = {
    ...currentPayload,
    orchestration: {
      ...currentOrchestration,
      divergenceField: divergenceFieldPayload,
      leanBoundary: leanBoundaryPayload,
      leanBridge: leanBridgePayload,
    },
  };

  nextSimulation.proposals[proposalId] = {
    ...proposal,
    verificationState: nextOutcome,
    updatedAtTick: simulation.activeTick,
    payload: nextPayload,
    leanTask: proposal.leanTask
      ? {
          ...proposal.leanTask,
          status: parsed.accepted ? "succeeded" : parsed.blocked || parsed.rejected ? "failed" : proposal.leanTask.status,
          completedAtTick: simulation.activeTick,
          lastError: parsed.errors[0],
          diagnostics: [...parsed.warnings, ...parsed.errors],
          result: proposal.leanTask.result
            ? {
                ...proposal.leanTask.result,
                outcome: nextOutcome,
                theoremAccepted: parsed.accepted,
                summary: parsed.accepted
                  ? "Real Lean accepted the generated neg-adjunction snippet."
                  : parsed.blocked
                    ? "Real Lean blocked or timed out while checking the generated neg-adjunction snippet."
                    : parsed.rejected
                      ? "Real Lean rejected the generated neg-adjunction snippet."
                      : proposal.leanTask.result.summary,
                warnings: parsed.warnings,
                errors: parsed.errors,
                checkedAtTick: simulation.activeTick,
              }
            : proposal.leanTask.result,
        }
      : proposal.leanTask,
  };

  nextSimulation.fragments[fragment.id] = {
    ...fragment,
    phase: nextPhase,
  };

  appendReplayEvent(nextSimulation, {
    id: `replay_event_${simulation.activeTick}_${proposalId}_lean_bridge` as ReplayEventId,
    tick: simulation.activeTick,
    eventType: "proposal_verified",
    fragmentId: fragment.id,
    proposalId,
    message: `Real Lean updated ${proposal.title} as ${nextOutcome}.`,
    payload: {
      sourceProviders: ["lean-verifier"],
      leanBridge: true,
      leanBridgeStage: "run_finished",
      leanStatus: leanBridgePayload.status,
      snippetPath: artifactRefs.snippetPath ?? runResult.snippet.filePath,
      ...(artifactRefs.stdoutPath ? { stdoutPath: artifactRefs.stdoutPath } : {}),
      ...(artifactRefs.stderrPath ? { stderrPath: artifactRefs.stderrPath } : {}),
      ...(artifactRefs.snapshotPath ? { snapshotPath: artifactRefs.snapshotPath } : {}),
      command: runResult.command,
      sourceVector,
      targetVector,
      repairedVector,
      forward: nextForward,
      reverse: nextReverse,
      asymmetry: nextAsymmetry,
      curvature: nextCurvature,
      projection: nextProjection,
      total: nextTotal,
      phase: nextPhase,
    } as JsonObject,
  });

  return nextSimulation;
}

function applyLeanFallback(
  simulation: SimulationState,
  proposalId: SemanticProposalId,
  runResult: LeanRunResult,
  artifactRefs: LeanArtifactRefs = {},
) {
  const proposal = simulation.proposals[proposalId];
  if (!proposal) {
    return simulation;
  }

  const nextSimulation: SimulationState = {
    ...simulation,
    proposals: { ...simulation.proposals },
    replayLog: [...simulation.replayLog],
  };
  const payload = (asRecord(proposal.payload) ?? {}) as JsonObject;
  const orchestration = (asRecord(payload.orchestration) ?? {}) as JsonObject;
  const currentLeanBridge = (asRecord(orchestration.leanBridge) ?? {}) as JsonObject;
  const sourceVector =
    Array.isArray(currentLeanBridge.sourceVector) && currentLeanBridge.sourceVector.every((value) => typeof value === "number")
      ? [...(currentLeanBridge.sourceVector as number[])]
      : [...simulation.fragments[proposal.fragmentId]?.theta ?? []];
  const targetVector =
    Array.isArray(currentLeanBridge.targetVector) && currentLeanBridge.targetVector.every((value) => typeof value === "number")
      ? [...(currentLeanBridge.targetVector as number[])]
      : [...proposal.theta];
  const leanBridgePayload: JsonObject = {
    ...currentLeanBridge,
    status: "unavailable",
    command: runResult.command,
    executed: runResult.executed,
    timedOut: runResult.timedOut ?? false,
    durationMs: runResult.durationMs ?? null,
    exitCode: runResult.exitCode ?? null,
    signal: runResult.signal ?? null,
    snippetPath: artifactRefs.snippetPath ?? runResult.snippet.filePath,
    sourceVector,
    targetVector,
    ...(artifactRefs.stdoutPath ? { stdoutPath: artifactRefs.stdoutPath } : {}),
    ...(artifactRefs.stderrPath ? { stderrPath: artifactRefs.stderrPath } : {}),
    ...(artifactRefs.snapshotPath ? { snapshotPath: artifactRefs.snapshotPath } : {}),
  };

  nextSimulation.proposals[proposalId] = {
    ...proposal,
    payload: {
      ...payload,
      orchestration: {
        ...orchestration,
        leanBridge: leanBridgePayload,
      },
    } as JsonObject,
  };

  appendReplayEvent(nextSimulation, {
    id: `replay_event_${simulation.activeTick}_${proposalId}_lean_fallback` as ReplayEventId,
    tick: simulation.activeTick,
    eventType: "proposal_verified",
    fragmentId: proposal.fragmentId,
    proposalId,
    message: `Real Lean unavailable for ${proposal.title}; retained mock verification.`,
    payload: {
      sourceProviders: ["lean-verifier"],
      leanBridge: true,
      leanBridgeStage: "run_finished",
      leanStatus: "unavailable",
      snippetPath: artifactRefs.snippetPath ?? runResult.snippet.filePath,
      ...(artifactRefs.stdoutPath ? { stdoutPath: artifactRefs.stdoutPath } : {}),
      ...(artifactRefs.stderrPath ? { stderrPath: artifactRefs.stderrPath } : {}),
      ...(artifactRefs.snapshotPath ? { snapshotPath: artifactRefs.snapshotPath } : {}),
      command: runResult.command,
      sourceVector,
      targetVector,
    } as JsonObject,
  });

  return nextSimulation;
}

function preferredProposalId(
  proposalIds: SemanticProposalId[],
  selectedProposalId?: SemanticProposalId,
) {
  if (selectedProposalId && proposalIds.includes(selectedProposalId)) {
    return selectedProposalId;
  }

  return proposalIds[0];
}

function latestFragmentProposal(fragmentId: FragmentId, simulation: SimulationState) {
  const fragment = simulation.fragments[fragmentId];
  if (!fragment) {
    return undefined;
  }

  return fragment.activeProposalIds
    .map((proposalId) => simulation.proposals[proposalId])
    .filter((proposal): proposal is NonNullable<typeof proposal> => Boolean(proposal))
    .sort((left, right) => right.updatedAtTick - left.updatedAtTick)[0];
}

async function persistBackgroundIGSnapshot(
  simulation: SimulationState,
  view: AppViewState,
  runtimeConfig: RuntimeConfig,
) {
  if (!isNodeRuntime()) {
    return;
  }

  const igLabHidden =
    view.activeMainView !== "information-geometry-lab" && !view.modulePanels.informationGeometryLabOpen;
  if (igLabHidden && !runtimeConfig.igLabAccumulateWhileHidden) {
    return;
  }

  const fragmentId = simulation.activeFragmentId ?? view.selectedFragmentId;
  if (!fragmentId) {
    return;
  }

  const fragment = simulation.fragments[fragmentId];
  if (!fragment) {
    return;
  }

  const proposal =
    (simulation.activeProposalId ? simulation.proposals[simulation.activeProposalId] : undefined) ??
    latestFragmentProposal(fragmentId, simulation);

  const backgroundLabView = {
    ...view.informationGeometryLab,
    selectedIGViewMode: "accumulation" as const,
    selectedGeometryMode: view.informationGeometryLab.selectedGeometryMode,
    selectedFragmentId: fragment.id,
    selectedProposalId: proposal?.id,
    selectedTick: simulation.activeTick,
    autoFollowActiveFragment: true,
  };
  const backgroundView: AppViewState = {
    ...view,
    modulePanels: {
      ...view.modulePanels,
      informationGeometryLabTab: "history",
    },
    informationGeometryLab: backgroundLabView,
  };
  const adapterState = {
    simulation,
    view: backgroundView,
  };
  const patch = getActiveTrianglePatch(adapterState, fragment.id);
  const sites = getVoronoiSites(adapterState, simulation.activeTick, fragment.id);
  const samples = getScalarFieldSamples(adapterState, fragment.id, backgroundLabView.selectedScalarField);
  const dualChart = getDualChartPoints(adapterState, simulation.activeTick, fragment.id);
  const liftedPoints = getLiftedSurfacePoints(adapterState, simulation.activeTick, fragment.id);

  await saveIGLabSnapshot({
    runtimeConfig,
    retentionLimit: runtimeConfig.igLabSnapshotRetention,
    snapshot: {
      id: `ig_auto_${simulation.activeTick}_${fragment.id}_${proposal?.id ?? "none"}`,
      savedAt: new Date().toISOString(),
      tick: simulation.activeTick,
      fragmentId: fragment.id,
      proposalId: proposal?.id,
      geometryMode: backgroundLabView.selectedGeometryMode,
      viewMode: "accumulation",
      moduleTab: "history",
      chartKind: backgroundLabView.selectedChartKind,
      scalarField: backgroundLabView.selectedScalarField,
      colorScaleMode: backgroundLabView.colorScaleMode,
      normalizationMode: backgroundLabView.normalizationMode,
      label: `[auto] ${fragment.labels.short}`,
      phase: fragment.phase,
      compareWithPreviousTick: backgroundLabView.compareWithPreviousTick,
      metadata: {
        autoFollowActiveFragment: true,
        freezeCurrentSnapshot: false,
        voronoiGridResolution: backgroundLabView.voronoiGridResolution,
        voronoiSiteSource: backgroundLabView.voronoiSiteSource,
        accumulationTrailLength: backgroundLabView.accumulationTrailLength,
        accumulationMode: backgroundLabView.accumulationMode,
        barycenterSourceMode: backgroundLabView.barycenterSourceMode,
        barycenterWeightMode: backgroundLabView.barycenterWeightMode,
        barycenterTickWindow: backgroundLabView.barycenterTickWindow,
        selectedFlowMode: backgroundLabView.selectedFlowMode,
        regressionEnabled: backgroundLabView.regressionEnabled,
        regressionTargetMode: backgroundLabView.regressionTargetMode,
        regressionDisplayMode: backgroundLabView.regressionDisplayMode,
        regressionTickWindow: backgroundLabView.regressionTickWindow,
        flowVectorDensity: backgroundLabView.flowVectorDensity,
        flowVectorScale: backgroundLabView.flowVectorScale,
        showVoronoiSites: backgroundLabView.showVoronoiSites,
        showVoronoiBoundaries: backgroundLabView.showVoronoiBoundaries,
        showLiftedSurface: backgroundLabView.showLiftedSurface,
        showLiftedStems: backgroundLabView.showLiftedStems,
        showLiftedFootprint: backgroundLabView.showLiftedFootprint,
        showGeodesics: backgroundLabView.showGeodesics,
        showNucleation: backgroundLabView.showNucleation,
        showCatastropheMarkers: backgroundLabView.showCatastropheMarkers,
        showBarycenter: backgroundLabView.showBarycenter,
        showBarycenterTrail: backgroundLabView.showBarycenterTrail,
        showFlowVectors: backgroundLabView.showFlowVectors,
        showFlowTrails: backgroundLabView.showFlowTrails,
        animateFlowOverTicks: backgroundLabView.animateFlowOverTicks,
        showResidualMarkers: backgroundLabView.showResidualMarkers,
        showAccumulationHistory: backgroundLabView.showAccumulationHistory,
      },
      sitePositions: sites.map((site) => ({
        ...site,
        point: { ...site.point },
        embedding: [...site.embedding],
        theta: [...site.theta],
        eta: [...site.eta],
      })),
      scalarSamples: samples.map((sample) => ({
        ...sample,
        point: { ...sample.point },
      })),
      patch: patch
        ? {
            ...patch,
            centroid: { ...patch.centroid },
            centerField: { ...patch.centerField },
            vertices: patch.vertices.map((vertex) => ({
              ...vertex,
              point: { ...vertex.point },
              embedding: [...vertex.embedding],
              theta: [...vertex.theta],
              eta: [...vertex.eta],
            })),
            scalarSamples: patch.scalarSamples.map((sample) => ({
              ...sample,
              point: { ...sample.point },
            })),
          }
        : undefined,
      dualChart: {
        tick: dualChart.tick,
        geometryMode: dualChart.geometryMode,
        geometrySource: dualChart.geometrySource,
        thetaPoints: dualChart.thetaPoints.map((point) => ({
          ...point,
          point: { ...point.point },
          coordinates: [...point.coordinates],
        })),
        etaPoints: dualChart.etaPoints.map((point) => ({
          ...point,
          point: { ...point.point },
          coordinates: [...point.coordinates],
        })),
      },
      liftedPoints: liftedPoints.map((point) => ({
        ...point,
        basePoint: { ...point.basePoint },
        embedding: [...point.embedding],
        theta: [...point.theta],
        eta: [...point.eta],
      })),
    },
  });
}

function replayOutcomeForEntry(simulation: SimulationState, entry: ReplayLogEntry): ReplayFilter {
  if (entry.eventType === "fragment_promoted") {
    return "accepted";
  }
  if (entry.eventType === "fragment_externalized") {
    return "blocked";
  }
  if (entry.eventType === "fragment_persisted") {
    return "promising";
  }
  if (!entry.proposalId) {
    return "system";
  }
  return simulation.proposals[entry.proposalId]?.verificationState ?? "system";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function providerFilterForEntry(simulation: SimulationState, entry: ReplayLogEntry): ReplayProviderFilter[] {
  const eventPayload = asRecord(entry.payload);
  const payloadProviders = asStringArray(eventPayload?.sourceProviders).filter(
    (providerId): providerId is Exclude<ReplayProviderFilter, "all"> =>
      providerId === "chatgpt" ||
      providerId === "claude" ||
      providerId === "personal-open-llm" ||
      providerId === "lean-verifier",
  );

  const proposalPayload = entry.proposalId
    ? asRecord(simulation.proposals[entry.proposalId]?.payload)
    : undefined;
  const orchestration = asRecord(proposalPayload?.orchestration);
  const orchestrationProviders = asStringArray(orchestration?.sourceProviders).filter(
    (providerId): providerId is Exclude<ReplayProviderFilter, "all"> =>
      providerId === "chatgpt" ||
      providerId === "claude" ||
      providerId === "personal-open-llm" ||
      providerId === "lean-verifier",
  );
  const leanBoundary = asRecord(orchestration?.leanBoundary);
  const verifierProviderId = leanBoundary?.verifierProviderId;
  const inferredProviders =
    entry.eventType === "fragment_activated" || entry.eventType === "neighborhood_inspected"
      ? (["personal-open-llm"] as const)
      : entry.eventType === "lean_artifact_prepared" ||
          entry.eventType === "proposal_verified" ||
          entry.eventType === "fragment_promoted" ||
          entry.eventType === "fragment_persisted"
        ? (["lean-verifier"] as const)
        : [];

  const providers = [
    ...payloadProviders,
    ...orchestrationProviders,
    ...(verifierProviderId === "chatgpt" ||
    verifierProviderId === "claude" ||
    verifierProviderId === "personal-open-llm" ||
    verifierProviderId === "lean-verifier"
      ? [verifierProviderId]
      : []),
    ...inferredProviders,
  ];

  return Array.from(new Set(providers)) as ReplayProviderFilter[];
}

function filteredReplayEntries(
  simulation: SimulationState,
  filter: ReplayFilter,
  providerFilter: ReplayProviderFilter,
) {
  const entries = [...simulation.replayLog].sort((left, right) => left.tick - right.tick);
  return entries.filter((entry) => {
    const matchesOutcome = filter === "all" || replayOutcomeForEntry(simulation, entry) === filter;
    const matchesProvider =
      providerFilter === "all" || providerFilterForEntry(simulation, entry).includes(providerFilter);
    return matchesOutcome && matchesProvider;
  });
}

function maxReplayTick(simulation: SimulationState) {
  return simulation.replayLog.reduce((maxTick, entry) => Math.max(maxTick, entry.tick), simulation.activeTick);
}

function resolveReplaySelection(
  simulation: SimulationState,
  tick: number,
  filter: ReplayFilter,
  providerFilter: ReplayProviderFilter,
  preferredEventId?: ReplayEventId,
) {
  const entries = filteredReplayEntries(simulation, filter, providerFilter);
  if (entries.length === 0) {
    return {
      tick: 0,
      selectedEvent: undefined,
    };
  }

  const boundedTick = Math.max(0, Math.min(tick, maxReplayTick(simulation)));
  const preferredEntry =
    preferredEventId != null ? entries.find((entry) => entry.id === preferredEventId) : undefined;

  if (preferredEntry && preferredEntry.tick <= boundedTick) {
    return {
      tick: boundedTick,
      selectedEvent: preferredEntry,
    };
  }

  const latestEntry =
    [...entries].reverse().find((entry) => entry.tick <= boundedTick) ??
    entries[0];

  return {
    tick: boundedTick,
    selectedEvent: latestEntry,
  };
}

function entriesForTick(simulation: SimulationState, tick: number) {
  return [...simulation.replayLog]
    .filter((entry) => entry.tick === tick)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function nextLiveObservationState(state: HegelTriangleStoreState) {
  const currentTickEntries = entriesForTick(state.simulation, state.simulation.activeTick);
  const currentEventIndex = currentTickEntries.findIndex(
    (entry) => entry.id === state.view.replay.liveObservedEventId,
  );

  if (
    currentTickEntries.length > 0 &&
    currentEventIndex >= 0 &&
    currentEventIndex < currentTickEntries.length - 1
  ) {
    return {
      nextState: {
        simulation: state.simulation,
        view: {
          ...state.view,
          informationGeometryLab: syncInformationGeometryLabFromSimulation(
            state.view.informationGeometryLab,
            state.simulation,
            {
              selectedTick: state.simulation.activeTick,
            },
          ),
          replay: {
            ...state.view.replay,
            mode: "live" as const,
            isPlaying: state.view.replay.isPlaying,
            playbackGranularity: "event" as const,
            tick: state.simulation.activeTick,
            liveObservedEventId: currentTickEntries[currentEventIndex + 1]?.id,
          },
        },
      },
      tickResult: undefined,
    };
  }

  const result = createNextSimulationTick(state.simulation, {
    semeioticPromiseInfluenceEnabled:
      semeioticRuntimeActive(state) && state.view.semeiotic.influencesPromiseProfile,
    semeioticAnnotationEnabled:
      semeioticRuntimeActive(state) && state.view.semeiotic.semeioticAutoAnnotate,
  });
  const nextSimulation = applyRuntimeConfigToSimulation(
    result.simulation,
    state.runtimeConfig,
    semeioticRuntimeActive(state),
  );
  const nextTickEntries = entriesForTick(nextSimulation, nextSimulation.activeTick);
  const nextSelectedProposalId =
    state.view.selectedProposalId && nextSimulation.proposals[state.view.selectedProposalId]
      ? state.view.selectedProposalId
      : result.activeProposalId;
  const nextSelectedFragmentId =
    state.view.selectedFragmentId && nextSimulation.fragments[state.view.selectedFragmentId]
      ? state.view.selectedFragmentId
      : result.activeFragmentId;

  return {
    nextState: {
      simulation: nextSimulation,
      view: {
        ...state.view,
        selectedFragmentId: nextSelectedFragmentId,
        selectedProposalId: nextSelectedProposalId,
        informationGeometryLab: syncInformationGeometryLabFromSimulation(
          state.view.informationGeometryLab,
          nextSimulation,
          {
            selectedTick: nextSimulation.activeTick,
          },
        ),
        replay: {
          ...state.view.replay,
          mode: "live" as const,
          playbackGranularity: "event" as const,
          tick: nextSimulation.activeTick,
          liveObservedEventId: nextTickEntries[0]?.id,
        },
      },
    },
    tickResult: { ...result, simulation: nextSimulation },
  };
}

function syncReplayView(
  state: HegelTriangleStoreState,
  nextReplay: HegelTriangleStoreState["view"]["replay"],
) {
  const selectedEvent = nextReplay.selectedEventId
    ? state.simulation.replayLog.find((entry) => entry.id === nextReplay.selectedEventId)
    : undefined;
  const selectedProposalId = selectedEvent?.proposalId ?? state.view.selectedProposalId;
  const selectedFragmentId =
    selectedEvent?.fragmentId ??
    (selectedProposalId ? state.simulation.proposals[selectedProposalId]?.fragmentId : undefined) ??
    state.view.selectedFragmentId;

  return {
    ...state.view,
    selectedFragmentId,
    selectedProposalId,
    inspectorTab: selectedProposalId ? "proposal" : state.view.inspectorTab,
    replay: nextReplay,
  };
}

function launchLeanBridgeForTick(
  set: (partial: Partial<HegelTriangleStoreState> | ((state: HegelTriangleStoreState) => Partial<HegelTriangleStoreState>)) => void,
  get: () => HegelTriangleStoreState,
  tickResult?: SimulationTickResult,
) {
  if (!tickResult || tickResult.generatedProposalIds.length === 0 || !supportsLocalLeanBridge()) {
    return;
  }

  for (const proposalId of tickResult.generatedProposalIds) {
    runLeanBridgeForProposal(set, get, proposalId);
  }
}

function stripHoldingPersistence(simulation: SimulationState): SimulationState {
  const nextFragments = { ...simulation.fragments };
  const removableFragmentIds = new Set<FragmentId>();

  for (const fragment of Object.values(nextFragments)) {
    if (fragment.promotion.layer !== "candidate" || fragment.promotion.acceptedProposalIds.length > 0) {
      continue;
    }

    removableFragmentIds.add(fragment.id);
    nextFragments[fragment.id] = {
      ...fragment,
      promotion: {
        ...fragment.promotion,
        isPersistent: false,
        layer: "frontier",
        promotedAtTick: undefined,
      },
    };
  }

  return {
    ...simulation,
    fragments: nextFragments,
    persistent: {
      ...simulation.persistent,
      promotedFragmentIds: simulation.persistent.promotedFragmentIds.filter((fragmentId) => !removableFragmentIds.has(fragmentId)),
      keptPromisingProposalIds: [],
      theoremStubs: simulation.persistent.theoremStubs.filter((stub) => stub.layer === "canonical"),
      definitionStubs: simulation.persistent.definitionStubs.filter((stub) => stub.layer === "canonical"),
    },
  };
}

function clearPersistentStructure(simulation: SimulationState): SimulationState {
  const nextFragments = { ...simulation.fragments };

  for (const fragment of Object.values(nextFragments)) {
    if (!fragment.promotion.isPersistent && fragment.promotion.layer === "frontier") {
      continue;
    }

    nextFragments[fragment.id] = {
      ...fragment,
      status: fragment.status === "persistent" ? "accepted" : fragment.status,
      promotion: {
        ...fragment.promotion,
        isPersistent: false,
        layer: "frontier",
        promotedAtTick: undefined,
        reason: undefined,
        acceptedProposalIds: [],
      },
    };
  }

  return {
    ...simulation,
    fragments: nextFragments,
    persistent: {
      promotedFragmentIds: [],
      promotedProposalIds: [],
      keptPromisingProposalIds: [],
      acceptedConnectionIds: [],
      acceptedEdgeIds: [],
      theoremStubs: [],
      definitionStubs: [],
    },
  };
}

export const useHegelTriangleStore = create<HegelTriangleStoreState>((set, get) => ({
  ...buildInitialStoreState(),
  loadRuntimeConfig: async () => {
    set({
      runtimeConfigStatus: "loading",
      runtimeConfigError: undefined,
    });

    try {
      const config = await loadRuntimeConfigFile();
      set((state) => ({
        runtimeConfig: config,
        runtimeConfigStatus: "ready",
        runtimeConfigDirty: false,
        runtimeConfigError: undefined,
        simulation: applyRuntimeConfigToSimulation(state.simulation, config, config.enableSemeiotics),
        view: applyRuntimeConfigToView(state.view, config),
      }));
    } catch (error) {
      set({
        runtimeConfigStatus: "error",
        runtimeConfigError: error instanceof Error ? error.message : String(error),
      });
    }
  },
  saveRuntimeConfig: async () => {
    const state = get();
    set({
      runtimeConfigStatus: "saving",
      runtimeConfigError: undefined,
    });

    try {
      const config = await saveRuntimeConfigFile(state.runtimeConfig);
      set((current) => ({
        runtimeConfig: config,
        runtimeConfigStatus: "ready",
        runtimeConfigDirty: false,
        runtimeConfigError: undefined,
        simulation: applyRuntimeConfigToSimulation(current.simulation, config, config.enableSemeiotics),
        view: applyRuntimeConfigToView(current.view, config),
      }));
    } catch (error) {
      set({
        runtimeConfigStatus: "error",
        runtimeConfigError: error instanceof Error ? error.message : String(error),
      });
    }
  },
  updateRuntimeConfig: (patch) =>
    set((state) => {
      const nextConfig = normalizeRuntimeConfig({
        ...state.runtimeConfig,
        ...patch,
      });
      return {
        runtimeConfig: nextConfig,
        runtimeConfigDirty: true,
        runtimeConfigError: undefined,
        simulation: applyRuntimeConfigToSimulation(state.simulation, nextConfig, semeioticRuntimeActive(state)),
      };
    }),
  play: () =>
    set((state) => ({
      simulation: {
        ...state.simulation,
        runState: "playing",
      },
      view: {
        ...state.view,
        replay: {
          ...state.view.replay,
          mode: "live",
          isPlaying: false,
          playbackGranularity: "event",
          liveObservedEventId:
            entriesForTick(state.simulation, state.simulation.activeTick)[0]?.id,
        },
      },
    })),
  pause: () =>
    set((state) => ({
      simulation: {
        ...state.simulation,
        runState: "paused",
      },
    })),
  reset: () =>
    set((state) => {
      const nextState = buildInitialStoreState();
      return {
        ...nextState,
        runtimeConfig: state.runtimeConfig,
        runtimeConfigStatus: state.runtimeConfigStatus,
        runtimeConfigDirty: state.runtimeConfigDirty,
        runtimeConfigError: state.runtimeConfigError,
        simulation: applyRuntimeConfigToSimulation(
          nextState.simulation,
          state.runtimeConfig,
          semeioticRuntimeActive(state),
        ),
      };
    }),
  setSpeedMultiplier: (value) =>
    set((state) => ({
      speedMultiplier: [0.5, 1, 2, 4].includes(value) ? value : state.speedMultiplier,
    })),
  toggleLabels: () =>
    set((state) => ({
      view: {
        ...state.view,
        showFragmentLabels: !state.view.showFragmentLabels,
        showProposalLabels: !state.view.showProposalLabels,
      },
    })),
  toggleGraphEdges: () =>
    set((state) => ({
      view: {
        ...state.view,
        showGraphEdges: !state.view.showGraphEdges,
      },
    })),
  togglePersistentLayerVisibility: () =>
    set((state) => ({
      view: {
        ...state.view,
        showPersistentLayer: !state.view.showPersistentLayer,
      },
    })),
  toggleAcceptedOverlay: () =>
    set((state) => ({
      view: {
        ...state.view,
        showAcceptedOverlay: !state.view.showAcceptedOverlay,
      },
    })),
  toggleRejectedOverlay: () =>
    set((state) => ({
      view: {
        ...state.view,
        showRejectedOverlay: !state.view.showRejectedOverlay,
      },
    })),
  playReplay: () =>
    set((state) => {
      const { tick, selectedEvent } = resolveReplaySelection(
        state.simulation,
        state.view.replay.tick,
        state.view.replay.logFilter,
        state.view.replay.providerFilter,
        state.view.replay.selectedEventId,
      );

      return {
        simulation: {
          ...state.simulation,
          runState: "paused",
        },
        view: {
          ...syncReplayView(state, {
            ...state.view.replay,
            mode: "history",
            isPlaying: true,
            playbackGranularity: "event",
            tick,
            selectedEventId: selectedEvent?.id,
          }),
          informationGeometryLab: syncInformationGeometryLabFromSimulation(
            state.view.informationGeometryLab,
            state.simulation,
            {
              selectedFragmentId: selectedEvent?.fragmentId ?? state.view.informationGeometryLab.selectedFragmentId,
              selectedProposalId: selectedEvent?.proposalId ?? state.view.informationGeometryLab.selectedProposalId,
              selectedTick: tick,
            },
          ),
        },
      };
    }),
  pauseReplay: () =>
    set((state) => ({
      view: {
        ...state.view,
        informationGeometryLab: syncInformationGeometryLabFromSimulation(
          state.view.informationGeometryLab,
          state.simulation,
          {
            selectedTick: state.view.replay.tick,
          },
        ),
        replay: {
          ...state.view.replay,
          isPlaying: false,
        },
      },
    })),
  exitReplay: () =>
    set((state) => ({
      view: {
        ...state.view,
        informationGeometryLab: syncInformationGeometryLabFromSimulation(
          state.view.informationGeometryLab,
          state.simulation,
          {
            selectedTick: state.simulation.activeTick,
          },
        ),
        replay: {
          ...state.view.replay,
          mode: "live",
          isPlaying: false,
          tick: state.simulation.activeTick,
          selectedEventId: undefined,
          liveObservedEventId: undefined,
        },
      },
    })),
  stepReplay: (delta) =>
    set((state) => {
      const entries = filteredReplayEntries(
        state.simulation,
        state.view.replay.logFilter,
        state.view.replay.providerFilter,
      );
      const currentIndex = entries.findIndex((entry) => entry.id === state.view.replay.selectedEventId);
      const fallbackIndex = currentIndex >= 0 ? currentIndex : Math.max(0, entries.length - 1);
      const nextIndex = Math.max(0, Math.min(entries.length - 1, fallbackIndex + delta));
      const selectedEvent = entries[nextIndex];
      const tick = selectedEvent?.tick ?? state.view.replay.tick;
      return {
        simulation: {
          ...state.simulation,
          runState: "paused",
        },
        view: {
          ...syncReplayView(state, {
            ...state.view.replay,
            mode: "history",
            isPlaying: false,
            playbackGranularity: "event",
            tick,
            selectedEventId: selectedEvent?.id,
          }),
          informationGeometryLab: syncInformationGeometryLabFromSimulation(
            state.view.informationGeometryLab,
            state.simulation,
            {
              selectedFragmentId: selectedEvent?.fragmentId ?? state.view.informationGeometryLab.selectedFragmentId,
              selectedProposalId: selectedEvent?.proposalId ?? state.view.informationGeometryLab.selectedProposalId,
              selectedTick: tick,
            },
          ),
        },
      };
    }),
  stepPlayback: () => {
    const state = get();
    if (state.view.replay.mode === "history") {
      const entries = filteredReplayEntries(
        state.simulation,
        state.view.replay.logFilter,
        state.view.replay.providerFilter,
      );
      if (entries.length === 0) {
        return;
      }
      const currentIndex = entries.findIndex((entry) => entry.id === state.view.replay.selectedEventId);
      const nextIndex = currentIndex >= 0 && currentIndex < entries.length - 1 ? currentIndex + 1 : 0;
      const selectedEvent = entries[nextIndex];
      set({
        simulation: {
          ...state.simulation,
          runState: "paused",
        },
        view: {
          ...syncReplayView(state, {
            ...state.view.replay,
            mode: "history",
            isPlaying: false,
            playbackGranularity: "event",
            tick: selectedEvent.tick,
            selectedEventId: selectedEvent.id,
          }),
          informationGeometryLab: syncInformationGeometryLabFromSimulation(
            state.view.informationGeometryLab,
            state.simulation,
            {
              selectedFragmentId: selectedEvent.fragmentId ?? state.view.informationGeometryLab.selectedFragmentId,
              selectedProposalId: selectedEvent.proposalId ?? state.view.informationGeometryLab.selectedProposalId,
              selectedTick: selectedEvent.tick,
            },
          ),
        },
      });
      return;
    }

    const liveStep = nextLiveObservationState(state);
    set(liveStep.nextState);
    launchLeanBridgeForTick(set, get, liveStep.tickResult);
    if (liveStep.tickResult) {
      void persistAndPruneLiveMemory(set, get);
    }
  },
  setReplayTick: (requestedTick) =>
    set((state) => {
      const { tick, selectedEvent } = resolveReplaySelection(
        state.simulation,
        requestedTick,
        state.view.replay.logFilter,
        state.view.replay.providerFilter,
      );
      return {
        simulation: {
          ...state.simulation,
          runState: "paused",
        },
        view: {
          ...syncReplayView(state, {
            ...state.view.replay,
            mode: "history",
            isPlaying: false,
            playbackGranularity: "tick",
            tick,
            selectedEventId: selectedEvent?.id,
          }),
          informationGeometryLab: syncInformationGeometryLabFromSimulation(
            state.view.informationGeometryLab,
            state.simulation,
            {
              selectedFragmentId: selectedEvent?.fragmentId ?? state.view.informationGeometryLab.selectedFragmentId,
              selectedProposalId: selectedEvent?.proposalId ?? state.view.informationGeometryLab.selectedProposalId,
              selectedTick: tick,
            },
          ),
        },
      };
    }),
  selectReplayEvent: (eventId) =>
    set((state) => {
      const event = state.simulation.replayLog.find((entry) => entry.id === eventId);
      if (!event) {
        return {};
      }
      const { tick, selectedEvent } = resolveReplaySelection(
        state.simulation,
        event.tick,
        state.view.replay.logFilter,
        state.view.replay.providerFilter,
        eventId,
      );
      return {
        simulation: {
          ...state.simulation,
          runState: "paused",
        },
        view: {
          ...syncReplayView(state, {
            ...state.view.replay,
            mode: "history",
            isPlaying: false,
            playbackGranularity: "event",
            tick,
            selectedEventId: selectedEvent?.id,
          }),
          informationGeometryLab: syncInformationGeometryLabFromSimulation(
            state.view.informationGeometryLab,
            state.simulation,
            {
              selectedFragmentId: event.fragmentId ?? state.view.informationGeometryLab.selectedFragmentId,
              selectedProposalId: event.proposalId ?? state.view.informationGeometryLab.selectedProposalId,
              selectedTick: tick,
            },
          ),
        },
      };
    }),
  setReplayFilter: (filter) =>
    set((state) => {
      const { tick, selectedEvent } = resolveReplaySelection(
        state.simulation,
        state.view.replay.tick,
        filter,
        state.view.replay.providerFilter,
      );
      return {
        view: syncReplayView(state, {
          ...state.view.replay,
          isPlaying: false,
          tick,
          logFilter: filter,
          selectedEventId: selectedEvent?.id,
        }),
      };
    }),
  setReplayProviderFilter: (filter) =>
    set((state) => {
      const { tick, selectedEvent } = resolveReplaySelection(
        state.simulation,
        state.view.replay.tick,
        state.view.replay.logFilter,
        filter,
      );
      return {
        view: syncReplayView(state, {
          ...state.view.replay,
          isPlaying: false,
          tick,
          providerFilter: filter,
          selectedEventId: selectedEvent?.id,
        }),
      };
    }),
  togglePromoteOnlyAccepted: () =>
    set((state) => {
      const nextValue = !state.simulation.persistentConfig.promoteOnlyAccepted;
      const simulation = nextValue ? stripHoldingPersistence(state.simulation) : state.simulation;
      return {
        simulation: {
          ...simulation,
          persistentConfig: {
            ...simulation.persistentConfig,
            promoteOnlyAccepted: nextValue,
          },
        },
      };
    }),
  toggleKeepPromisingItems: () =>
    set((state) => {
      const nextValue = !state.simulation.persistentConfig.keepPromisingItems;
      const simulation = nextValue ? state.simulation : stripHoldingPersistence(state.simulation);
      return {
        simulation: {
          ...simulation,
          persistentConfig: {
            ...simulation.persistentConfig,
            keepPromisingItems: nextValue,
          },
        },
      };
    }),
  clearPersistentLayer: () =>
    set((state) => ({
      simulation: clearPersistentStructure(state.simulation),
    })),
  selectFragment: (fragmentId) =>
    set((state) => {
      const fragment = state.simulation.fragments[fragmentId];
      if (!fragment) {
        return {};
      }

      return {
        view: {
          ...state.view,
          selectedFragmentId: fragmentId,
          selectedProposalId: preferredProposalId(fragment.activeProposalIds, state.view.selectedProposalId),
          informationGeometryLab: syncInformationGeometryLabFromSimulation(
            state.view.informationGeometryLab,
            state.simulation,
            {
              selectedFragmentId: fragmentId,
              selectedProposalId: preferredProposalId(fragment.activeProposalIds, state.view.selectedProposalId),
              selectedTick: state.view.replay.mode === "history" ? state.view.replay.tick : state.simulation.activeTick,
            },
          ),
          selectionMode: "fragment",
          inspectorTab: "fragment",
        },
      };
    }),
  selectProposal: (proposalId) =>
    set((state) => {
      const proposal = state.simulation.proposals[proposalId];
      if (!proposal) {
        return {};
      }

      return {
        view: {
          ...state.view,
          selectedFragmentId: proposal.fragmentId,
          selectedProposalId: proposalId,
          informationGeometryLab: syncInformationGeometryLabFromSimulation(
            state.view.informationGeometryLab,
            state.simulation,
            {
              selectedFragmentId: proposal.fragmentId,
              selectedProposalId: proposalId,
              selectedTick: state.view.replay.mode === "history" ? state.view.replay.tick : state.simulation.activeTick,
            },
          ),
          selectionMode: "proposal",
          inspectorTab: "proposal",
        },
      };
    }),
  setActiveMainView: (view) =>
    set((state) => ({
      view: {
        ...state.view,
        activeMainView: view,
      },
    })),
  toggleInformationGeometryLab: () =>
    set((state) => ({
      view: {
        ...state.view,
        modulePanels: {
          ...state.view.modulePanels,
          informationGeometryLabOpen: !state.view.modulePanels.informationGeometryLabOpen,
        },
      },
    })),
  setInformationGeometryLabTab: (tab) =>
    set((state) => ({
      view: {
        ...state.view,
        modulePanels: {
          ...state.view.modulePanels,
          informationGeometryLabOpen: true,
          informationGeometryLabTab: tab,
        },
      },
    })),
  updateInformationGeometryLabState: (patch) =>
    set((state) => ({
      view: {
        ...state.view,
        informationGeometryLab: syncInformationGeometryLabState(
          state.view.informationGeometryLab,
          state.simulation,
          patch,
        ),
      },
    })),
  setInformationGeometryLabViewMode: (mode) =>
    set((state) => ({
      view: {
        ...state.view,
        informationGeometryLab: syncInformationGeometryLabState(
          state.view.informationGeometryLab,
          state.simulation,
          {
            selectedIGViewMode: mode,
          },
        ),
      },
    })),
  setInformationGeometryMode: (mode) =>
    set((state) => ({
      view: {
        ...state.view,
        informationGeometryLab: syncInformationGeometryLabState(
          state.view.informationGeometryLab,
          state.simulation,
          {
            selectedGeometryMode: mode,
          },
        ),
      },
    })),
  setInformationGeometryLabChartKind: (kind) =>
    set((state) => ({
      view: {
        ...state.view,
        informationGeometryLab: syncInformationGeometryLabState(
          state.view.informationGeometryLab,
          state.simulation,
          {
            selectedChartKind: kind,
          },
        ),
      },
    })),
  setInformationGeometryLabScalarField: (field) =>
    set((state) => ({
      view: {
        ...state.view,
        informationGeometryLab: syncInformationGeometryLabState(
          state.view.informationGeometryLab,
          state.simulation,
          {
            selectedScalarField: field,
          },
        ),
      },
    })),
  updateSemeioticState: (patch) => {
    set((state) => {
      const nextSimulation = {
        ...state.simulation,
        replayLog: [...state.simulation.replayLog],
      };
      const nextSemeiotic = {
        ...state.view.semeiotic,
        ...patch,
      };
      const historicalSemeioticData = simulationHasHistoricalSemeioticData(state.simulation);

      if (
        typeof patch.semeioticOverlayVisible === "boolean" &&
        patch.semeioticOverlayVisible !== state.view.semeiotic.semeioticOverlayVisible &&
        (nextSemeiotic.semeioticsEnabled || historicalSemeioticData)
      ) {
        appendReplayEvent(nextSimulation, {
          id: `semeiotic_overlay_toggled_${nextSimulation.activeTick}_${Date.now()}` as ReplayEventId,
          tick: state.view.replay.mode === "history" ? state.view.replay.tick : nextSimulation.activeTick,
          eventType: "semeiotic_overlay_toggled",
          fragmentId: state.view.selectedFragmentId ?? nextSimulation.activeFragmentId,
          proposalId: state.view.selectedProposalId ?? nextSimulation.activeProposalId,
          message: patch.semeioticOverlayVisible ? "Semeiotic overlay enabled" : "Semeiotic overlay disabled",
          payload: nextSemeiotic.logRawOutputs
            ? {
                overlayVisible: patch.semeioticOverlayVisible,
                treeFilter: nextSemeiotic.semeioticTreeFilter,
                showOnlyAnnotatedMoves: nextSemeiotic.showOnlyAnnotatedMoves,
              }
            : undefined,
        });
      }

      return {
        simulation: nextSimulation,
        view: {
          ...state.view,
          semeiotic: nextSemeiotic,
        },
      };
    });

    void persistAndPruneLiveMemory(set, get);
  },
  toggleSemeioticRuntime: () => {
    set((state) => {
      const semeioticsEnabled = !state.view.semeiotic.semeioticsEnabled;
      const nextSimulation = {
        ...state.simulation,
        replayLog: [...state.simulation.replayLog],
      };

      appendReplayEvent(nextSimulation, {
        id: `semeiotic_runtime_${semeioticsEnabled ? "enabled" : "disabled"}_${nextSimulation.activeTick}_${Date.now()}` as ReplayEventId,
        tick: state.view.replay.mode === "history" ? state.view.replay.tick : nextSimulation.activeTick,
        eventType: semeioticsEnabled ? "semeiotic_runtime_enabled" : "semeiotic_runtime_disabled",
        fragmentId: state.view.selectedFragmentId ?? nextSimulation.activeFragmentId,
        proposalId: state.view.selectedProposalId ?? nextSimulation.activeProposalId,
        message: semeioticsEnabled ? "Semeiotic runtime enabled" : "Semeiotic runtime disabled",
        payload: state.view.semeiotic.logRawOutputs
          ? {
              selectedLens: state.view.semeiotic.selectedLens,
              autoAnnotate: state.view.semeiotic.semeioticAutoAnnotate,
              influencesPromiseProfile: state.view.semeiotic.influencesPromiseProfile,
            }
          : undefined,
      });

      return {
        simulation: nextSimulation,
        view: {
          ...state.view,
          semeiotic: {
            ...state.view.semeiotic,
            semeioticsEnabled,
          },
        },
      };
    });

    void persistAndPruneLiveMemory(set, get);
  },
  setSemeioticLens: (lens) =>
    set((state) => ({
      view: {
        ...state.view,
        semeiotic: {
          ...state.view.semeiotic,
          selectedLens: lens,
        },
      },
    })),
  recordInformationGeometryEvent: (entry) => {
    set((state) => {
      const tick =
        typeof entry.tick === "number"
          ? entry.tick
          : state.view.replay.mode === "history"
            ? state.view.replay.tick
            : state.simulation.activeTick;
      const fragmentId =
        entry.fragmentId ??
        state.view.informationGeometryLab.selectedFragmentId ??
        state.view.selectedFragmentId ??
        state.simulation.activeFragmentId;
      const proposalId =
        entry.proposalId ??
        state.view.informationGeometryLab.selectedProposalId ??
        state.view.selectedProposalId ??
        state.simulation.activeProposalId;
      const nextSimulation = {
        ...state.simulation,
        replayLog: [...state.simulation.replayLog],
      };

      appendReplayEvent(nextSimulation, {
        id: `ig_${entry.eventType}_${tick}_${Date.now()}` as ReplayEventId,
        tick,
        eventType: entry.eventType,
        fragmentId,
        proposalId,
        message: entry.message,
        payload: entry.payload,
      });

      return {
        simulation: nextSimulation,
      };
    });

    void persistAndPruneLiveMemory(set, get);
  },
  rerunLeanTask: (proposalId) => {
    const state = get();
    const targetProposalId = proposalId ?? state.view.selectedProposalId ?? state.simulation.activeProposalId;
    if (!targetProposalId) {
      return;
    }
    runLeanBridgeForProposal(set, get, targetProposalId);
  },
  hoverFragment: (fragmentId) =>
    set((state) => ({
      view: {
        ...state.view,
        hoveredFragmentId: fragmentId,
      },
    })),
  stepSimulation: () => {
    const state = get();
    const result = createNextSimulationTick(state.simulation, {
      semeioticPromiseInfluenceEnabled:
        semeioticRuntimeActive(state) && state.view.semeiotic.influencesPromiseProfile,
      semeioticAnnotationEnabled:
        semeioticRuntimeActive(state) && state.view.semeiotic.semeioticAutoAnnotate,
    });
    const nextSimulation = applyRuntimeConfigToSimulation(
      result.simulation,
      state.runtimeConfig,
      semeioticRuntimeActive(state),
    );
    if (semeioticRuntimeActive(state) || simulationHasHistoricalSemeioticData(nextSimulation)) {
      appendSemeioticReplayEventsForTick(nextSimulation, nextSimulation.activeTick);
    }
    if (!result.activeFragmentId) {
      set({
        simulation: nextSimulation,
        view: {
          ...state.view,
          informationGeometryLab: syncInformationGeometryLabFromSimulation(
            state.view.informationGeometryLab,
            nextSimulation,
            {
              selectedTick: nextSimulation.activeTick,
            },
          ),
        },
      });
      launchLeanBridgeForTick(set, get, { ...result, simulation: nextSimulation });
      void persistAndPruneLiveMemory(set, get);
      return;
    }

    const preservedSelectedFragmentId =
      state.view.selectedFragmentId && nextSimulation.fragments[state.view.selectedFragmentId]
        ? state.view.selectedFragmentId
        : result.activeFragmentId;

    const preservedSelectedProposalId =
      state.view.selectedProposalId && nextSimulation.proposals[state.view.selectedProposalId]
        ? state.view.selectedProposalId
        : result.activeProposalId;

    set({
      simulation: nextSimulation,
      view: {
        ...state.view,
        selectedFragmentId: preservedSelectedFragmentId,
        selectedProposalId: preservedSelectedProposalId,
        informationGeometryLab: syncInformationGeometryLabFromSimulation(
          state.view.informationGeometryLab,
          nextSimulation,
          {
            selectedTick:
              state.view.replay.mode === "live" ? nextSimulation.activeTick : state.view.informationGeometryLab.selectedTick,
          },
        ),
        selectionMode: preservedSelectedProposalId ? "proposal" : state.view.selectionMode,
        inspectorTab: preservedSelectedProposalId ? state.view.inspectorTab : state.view.inspectorTab,
        replay: {
          ...state.view.replay,
          mode: state.view.replay.mode,
          tick: state.view.replay.mode === "live" ? nextSimulation.activeTick : state.view.replay.tick,
          liveObservedEventId:
            state.view.replay.mode === "live"
              ? [...nextSimulation.replayLog]
                  .filter((entry) => entry.tick === nextSimulation.activeTick)
                  .sort((left, right) => left.id.localeCompare(right.id))[0]?.id
              : state.view.replay.liveObservedEventId,
        },
      },
    });

    launchLeanBridgeForTick(set, get, { ...result, simulation: nextSimulation });
    void persistAndPruneLiveMemory(set, get);
  },
}));

if (supportsPersistentUiState()) {
  let previousSerialized = "";

  useHegelTriangleStore.subscribe((state) => {
    const nextSerialized = JSON.stringify({
      activeMainView: state.view.activeMainView,
      modulePanels: state.view.modulePanels,
      semeiotic: state.view.semeiotic,
      informationGeometryLab: state.view.informationGeometryLab,
    });

    if (nextSerialized === previousSerialized) {
      return;
    }

    previousSerialized = nextSerialized;
    persistIGLabViewState(state.view);
  });
}
