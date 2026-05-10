import type { JsonValue } from "@/types/primitives";
import { importNodeModule } from "@/lib/node-dynamic-import";
import type { SemanticProposalId, SimulationState } from "@/types/hegel-triangle";
import { formatDialecticMoveRaw } from "@/features/hegel-triangle-transform/adjunctor/dialectic-move-parser";
import {
  extractSemeioticProfile,
  inferDialecticMoveSemeioticProfile,
  inferLeanRunSemeioticProfile,
  inferPersistentNodeSemeioticProfile,
  inferProposalSemeioticFromProposal,
} from "@/semeiotic/inference";
import { initializeHistorySqlite } from "./history-sqlite";
import { writeJsonArtifact, writeTextArtifact } from "./artifact-store";

type HistoryRow = Record<string, JsonValue>;

interface HistoryWritePayload {
  ticks: HistoryRow[];
  fragments: HistoryRow[];
  proposals: HistoryRow[];
  dialectic_moves: HistoryRow[];
  dialectical_moments: HistoryRow[];
  semeiotic_links: HistoryRow[];
  semeiotic_summaries: HistoryRow[];
  lean_runs: HistoryRow[];
  persistent_nodes: HistoryRow[];
  ig_lab_events: HistoryRow[];
  semeiotic_events: HistoryRow[];
}

export interface HistoryPersistenceResult {
  persisted: boolean;
  databasePath: string;
  stdout: string;
  stderr: string;
  error?: string;
}

function isNodeRuntime() {
  const runtime = globalThis as { process?: { versions?: { node?: string } } };
  return typeof runtime.process?.versions?.node === "string";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asNullableNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Number(value) : null;
}

function asNullableString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function jsonText(value: unknown) {
  return JSON.stringify(value ?? null);
}

function nowIsoString() {
  return new Date().toISOString();
}

function endpointNodeId(endpoint: unknown) {
  const record = asRecord(endpoint);
  if (!record) {
    return null;
  }

  return asNullableString(record.vertexId) ?? asNullableString(record.edgeId);
}

function asTopologicalRecord(value: unknown) {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  return (
    asRecord(record.topology) ??
    asRecord(record.topologicalHooks) ??
    asRecord(record.homologicalHooks) ??
    asRecord(record.obstructionHooks) ??
    record
  );
}

function extractTopologicalHooks(...values: unknown[]) {
  const sources = values
    .map((value) => asTopologicalRecord(value))
    .filter((value): value is Record<string, unknown> => Boolean(value));

  const firstString = (...keys: string[]) => {
    for (const source of sources) {
      for (const key of keys) {
        const candidate = asNullableString(source[key]);
        if (candidate) {
          return candidate;
        }
      }
    }
    return null;
  };

  return {
    relationType: firstString("relationType", "relation_kind", "edgeType"),
    sourceNodeId: firstString("sourceNodeId", "sourceId", "fromNodeId"),
    targetNodeId: firstString("targetNodeId", "targetId", "toNodeId"),
    cycleHint: firstString("cycleHint", "cycle_hint", "loopHint"),
    obstructionKind: firstString("obstructionKind", "obstruction_kind"),
    cochainRole: firstString("cochainRole", "cochain_role"),
    cancellationRole: firstString("cancellationRole", "cancellation_role"),
    resolutionStatus: firstString("resolutionStatus", "resolution_status"),
  };
}

function proposalTopologyHooks(proposal: SimulationState["proposals"][SemanticProposalId]) {
  const payload = asRecord(proposal.payload);
  const orchestration = asRecord(payload?.orchestration);
  const promiseProfile = asRecord(orchestration?.promiseProfile);
  const extracted = extractTopologicalHooks(payload, orchestration, promiseProfile);

  return {
    relationType: extracted.relationType ?? proposal.proposalKind,
    sourceNodeId: extracted.sourceNodeId ?? endpointNodeId(proposal.source),
    targetNodeId: extracted.targetNodeId ?? endpointNodeId(proposal.target),
    cycleHint: extracted.cycleHint,
    obstructionKind:
      extracted.obstructionKind ?? (proposal.proposalKind === "obstruction_claim" ? "proposal_obstruction" : null),
    cochainRole: extracted.cochainRole,
    cancellationRole: extracted.cancellationRole,
    resolutionStatus: extracted.resolutionStatus ?? proposal.verificationState,
  };
}

function semeioticColumns(profile?: ReturnType<typeof extractSemeioticProfile>) {
  return {
    semeioticObjectTerm: profile?.object.term ?? null,
    semeioticSignTerm: profile?.signVehicle.term ?? null,
    semeioticInterpretantTerm: profile?.interpretant.term ?? null,
    semeioticConfidence: typeof profile?.confidence === "number" ? profile.confidence : null,
  };
}

function firstRawArtifactPointer(rawSources: unknown) {
  const items = Array.isArray(rawSources) ? rawSources : [];

  for (const item of items) {
    const record = asRecord(item);
    if (!record) {
      continue;
    }

    const artifactPath = asNullableString(record.artifactPath);
    if (artifactPath) {
      return artifactPath;
    }

    const pointer = asNullableString(record.pointer);
    if (pointer) {
      return pointer;
    }
  }

  return null;
}

function semeioticProviderOutputLinks(rawSources: unknown) {
  const items = Array.isArray(rawSources) ? rawSources : [];

  return items
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .filter((item) => {
      const kind = asNullableString(item.kind);
      return kind === "provider_output" || Boolean(asNullableString(item.provider)) || Boolean(asNullableString(item.pointer));
    })
    .map((item) => ({
      id: asNullableString(item.id),
      kind: asNullableString(item.kind),
      label: asNullableString(item.label),
      provider: asNullableString(item.provider),
      pointer: asNullableString(item.pointer),
      artifactPath: asNullableString(item.artifactPath),
    }));
}

function semeioticRawArtifactContent(rawSources: unknown) {
  const items = Array.isArray(rawSources) ? rawSources : [];
  const lines: string[] = [];

  for (const item of items) {
    const record = asRecord(item);
    if (!record) {
      continue;
    }

    const label = asNullableString(record.label) ?? "source";
    const provider = asNullableString(record.provider);
    const pointer = asNullableString(record.pointer);
    const artifactPath = asNullableString(record.artifactPath);
    const excerpt = asNullableString(record.textExcerpt);

    if (!excerpt && !pointer && !artifactPath) {
      continue;
    }

    lines.push(`[${label}]`);
    if (provider) {
      lines.push(`provider: ${provider}`);
    }
    if (pointer) {
      lines.push(`pointer: ${pointer}`);
    }
    if (artifactPath) {
      lines.push(`artifact: ${artifactPath}`);
    }
    if (excerpt) {
      lines.push(excerpt);
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}

function semeioticMomentRole(record: Record<string, unknown>) {
  const role = asNullableString(record.role);
  return role ?? "derived";
}

function semeioticHardSummaryTerms(rawMoment: Record<string, unknown>) {
  const peirceProfile = asRecord(rawMoment.peirceProfile);
  const hardSummary = asRecord(peirceProfile?.hardSummary);
  const object = asRecord(hardSummary?.object);
  const signVehicle = asRecord(hardSummary?.signVehicle);
  const interpretant = asRecord(hardSummary?.interpretant);

  return {
    objectTerm: asNullableString(object?.term),
    signTerm: asNullableString(signVehicle?.term),
    interpretantTerm: asNullableString(interpretant?.term),
    confidence: asNullableNumber(hardSummary?.confidence),
  };
}

async function buildSemeioticRows(
  simulation: SimulationState,
  artifactDirectory: string,
  timestamp: string,
  options?: { logRawOutputs?: boolean },
) {
  const dialectical_moments: HistoryRow[] = [];
  const semeiotic_links: HistoryRow[] = [];
  const semeiotic_summaries: HistoryRow[] = [];

  for (const proposal of Object.values(simulation.proposals)) {
    const payload = asRecord(proposal.payload);
    const orchestration = asRecord(payload?.orchestration);
    const rawMoments = Array.isArray(orchestration?.semeioticMoments) ? orchestration.semeioticMoments : [];
    const summary = asRecord(orchestration?.semeioticMomentSummary);
    const proposalMomentIds: string[] = [];
    const parsedMoments = rawMoments
      .map((entry) => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry));

    for (const rawMoment of parsedMoments) {
      const momentId = asNullableString(rawMoment.id);
      if (!momentId) {
        continue;
      }

      proposalMomentIds.push(momentId);
      const complexity = asRecord(rawMoment.complexity);
      const linkedMomentIds = asStringArray(rawMoment.linkedMomentIds);
      const mismatches = Array.isArray(rawMoment.mismatches) ? rawMoment.mismatches : [];
      const terms = semeioticHardSummaryTerms(rawMoment);
      const providerOutputLinks = semeioticProviderOutputLinks(rawMoment.rawSources);
      const rawContent = semeioticRawArtifactContent(rawMoment.rawSources);
      const rawArtifact =
        options?.logRawOutputs && rawContent
          ? await writeTextArtifact({
              artifactDirectory,
              category: "semeiotic_raw",
              baseName: `semeiotic_moment_raw_${proposal.id}_${momentId}`,
              content: `${rawContent}\n`,
              extension: ".txt",
            })
          : undefined;
      const structuredArtifact = await writeJsonArtifact({
        artifactDirectory,
        category: "semeiotic_structured",
        baseName: `semeiotic_moment_${proposal.id}_${momentId}`,
        value: {
          kind: "dialectical_moment",
          proposalId: proposal.id,
          fragmentId: proposal.fragmentId,
          momentId,
          rawSources: rawMoment.rawSources ?? null,
          providerOutputLinks,
          moment: rawMoment,
        },
      });

      dialectical_moments.push({
        id: momentId,
        parentId: linkedMomentIds[0] ?? null,
        fragmentId: asNullableString(rawMoment.fragmentId) ?? proposal.fragmentId,
        proposalId: asNullableString(rawMoment.proposalId) ?? proposal.id,
        dialecticMoveId: asNullableString(rawMoment.dialecticMoveId),
        tick: asNullableNumber(rawMoment.tick) ?? proposal.updatedAtTick,
        createdAt: timestamp,
        updatedAt: timestamp,
        provider: asNullableString(rawMoment.provider),
        role: semeioticMomentRole(rawMoment),
        source: asNullableString(rawMoment.source),
        summary: asNullableString(rawMoment.summary),
        rawArtifactPointer: rawArtifact?.relativePath ?? firstRawArtifactPointer(rawMoment.rawSources),
        structuredArtifactPath: structuredArtifact?.relativePath ?? null,
        providerOutputLinksJson: jsonText(providerOutputLinks),
        rawSourcesJson: jsonText(rawMoment.rawSources ?? null),
        linkedMomentIdsJson: jsonText(linkedMomentIds),
        notesJson: jsonText(rawMoment.notes ?? null),
        semeioticObjectTerm: terms.objectTerm,
        semeioticSignTerm: terms.signTerm,
        semeioticInterpretantTerm: terms.interpretantTerm,
        semeioticConfidence: terms.confidence,
        mismatchCount: mismatches.length,
        mismatchesJson: jsonText(mismatches),
        claimCount: asNullableNumber(complexity?.claimCount) ?? 0,
        objectionCount: asNullableNumber(complexity?.objectionCount) ?? 0,
        repairCount: asNullableNumber(complexity?.repairCount) ?? 0,
        branchCount: asNullableNumber(complexity?.branchCount) ?? 0,
        triadicEntropy: asNullableNumber(complexity?.triadicEntropy),
        annotationDensity: asNullableNumber(complexity?.annotationDensity),
        confidenceSpread: asNullableNumber(complexity?.confidenceSpread),
        ontologyAlignmentStrength: asNullableNumber(complexity?.ontologyAlignmentStrength),
        interpretantInstability: asNullableNumber(complexity?.interpretantInstability),
        objectSignMismatch: asNullableNumber(complexity?.objectSignMismatch),
        triadicImbalance: asNullableNumber(complexity?.triadicImbalance),
        internalAmbiguity: asNullableNumber(complexity?.internalAmbiguity),
        signEventBranchingComplexity: asNullableNumber(complexity?.signEventBranchingComplexity),
        critiqueInducedReinterpretationDepth: asNullableNumber(complexity?.critiqueInducedReinterpretationDepth),
        overallComplexity: asNullableNumber(complexity?.overallComplexity),
        payloadJson: jsonText(rawMoment),
      });
    }

    for (let index = 0; index < parsedMoments.length; index += 1) {
      const currentMoment = parsedMoments[index];
      const currentId = asNullableString(currentMoment.id);
      if (!currentId) {
        continue;
      }

      const currentRole = semeioticMomentRole(currentMoment);
      const currentComplexity = asRecord(currentMoment.complexity);
      const currentMismatches = Array.isArray(currentMoment.mismatches) ? currentMoment.mismatches : [];
      const linkedMomentIds = asStringArray(currentMoment.linkedMomentIds);

      for (const linkedMomentId of linkedMomentIds) {
        semeiotic_links.push({
          id: `semeiotic_link_${linkedMomentId}_${currentId}_tree`,
          parentId: null,
          fragmentId: proposal.fragmentId,
          proposalId: proposal.id,
          tick: asNullableNumber(currentMoment.tick) ?? proposal.updatedAtTick,
          createdAt: timestamp,
          updatedAt: timestamp,
          sourceMomentId: linkedMomentId,
          targetMomentId: currentId,
          sourceNodeId: linkedMomentId,
          targetNodeId: currentId,
          relationType: "parent_child",
          chainKind: "semeiotic_tree",
          mismatchKind: null,
          summary: "Semeiotic parent-child relation.",
          strength: 1,
          metadataJson: jsonText({
            sourceRole: undefined,
            targetRole: currentRole,
          }),
        });
      }

      if (index === 0) {
        continue;
      }

      const previousMoment = parsedMoments[index - 1];
      const previousId = asNullableString(previousMoment.id);
      if (!previousId) {
        continue;
      }
      const previousRole = semeioticMomentRole(previousMoment);
      const previousComplexity = asRecord(previousMoment.complexity);
      const previousTerms = semeioticHardSummaryTerms(previousMoment);
      const currentTerms = semeioticHardSummaryTerms(currentMoment);

      if (previousRole === "criticize" && currentRole === "repair") {
        semeiotic_links.push({
          id: `semeiotic_link_${previousId}_${currentId}_critique_repair`,
          parentId: null,
          fragmentId: proposal.fragmentId,
          proposalId: proposal.id,
          tick: asNullableNumber(currentMoment.tick) ?? proposal.updatedAtTick,
          createdAt: timestamp,
          updatedAt: timestamp,
          sourceMomentId: previousId,
          targetMomentId: currentId,
          sourceNodeId: previousId,
          targetNodeId: currentId,
          relationType: "critique_to_repair",
          chainKind: "repair_chain",
          mismatchKind: null,
          summary: "Critique-to-repair semeiotic transition.",
          strength: 0.92,
          metadataJson: jsonText({
            sourceRole: previousRole,
            targetRole: currentRole,
          }),
        });
      }

      const reinterpretationDepth = asNullableNumber(currentComplexity?.critiqueInducedReinterpretationDepth) ?? 0;
      if (
        reinterpretationDepth > 0.2 ||
        currentRole === "repair" ||
        currentRole === "synthesize"
      ) {
        semeiotic_links.push({
          id: `semeiotic_link_${previousId}_${currentId}_reinterpretation`,
          parentId: null,
          fragmentId: proposal.fragmentId,
          proposalId: proposal.id,
          tick: asNullableNumber(currentMoment.tick) ?? proposal.updatedAtTick,
          createdAt: timestamp,
          updatedAt: timestamp,
          sourceMomentId: previousId,
          targetMomentId: currentId,
          sourceNodeId: previousId,
          targetNodeId: currentId,
          relationType: "reinterpretation",
          chainKind: "reinterpretation_chain",
          mismatchKind: null,
          summary: "Semeiotic reinterpretation transition.",
          strength: reinterpretationDepth > 0 ? reinterpretationDepth : 0.5,
          metadataJson: jsonText({
            sourceRole: previousRole,
            targetRole: currentRole,
            critiqueInducedReinterpretationDepth: reinterpretationDepth,
          }),
        });
      }

      if (currentMismatches.length > 0) {
        for (const rawMismatch of currentMismatches) {
          const mismatch = asRecord(rawMismatch);
          const mismatchKind = asNullableString(mismatch?.kind);
          semeiotic_links.push({
            id: `semeiotic_link_${previousId}_${currentId}_${mismatchKind ?? "mismatch"}`,
            parentId: null,
            fragmentId: proposal.fragmentId,
            proposalId: proposal.id,
            tick: asNullableNumber(currentMoment.tick) ?? proposal.updatedAtTick,
            createdAt: timestamp,
            updatedAt: timestamp,
            sourceMomentId: previousId,
            targetMomentId: currentId,
            sourceNodeId: previousId,
            targetNodeId: currentId,
            relationType: "alignment_mismatch",
            chainKind: "mismatch_chain",
            mismatchKind,
            summary: asNullableString(mismatch?.summary) ?? "Semeiotic mismatch transition.",
            strength: asNullableNumber(mismatch?.severity) ?? asNullableNumber(currentComplexity?.overallComplexity) ?? 0.5,
            metadataJson: jsonText(mismatch),
          });
        }
      } else if (
        previousTerms.objectTerm &&
        previousTerms.signTerm &&
        previousTerms.interpretantTerm &&
        previousTerms.objectTerm === currentTerms.objectTerm &&
        previousTerms.signTerm === currentTerms.signTerm &&
        previousTerms.interpretantTerm === currentTerms.interpretantTerm
      ) {
        semeiotic_links.push({
          id: `semeiotic_link_${previousId}_${currentId}_alignment`,
          parentId: null,
          fragmentId: proposal.fragmentId,
          proposalId: proposal.id,
          tick: asNullableNumber(currentMoment.tick) ?? proposal.updatedAtTick,
          createdAt: timestamp,
          updatedAt: timestamp,
          sourceMomentId: previousId,
          targetMomentId: currentId,
          sourceNodeId: previousId,
          targetNodeId: currentId,
          relationType: "alignment",
          chainKind: "alignment_chain",
          mismatchKind: null,
          summary: "Stable semeiotic alignment across adjacent moments.",
          strength: asNullableNumber(currentComplexity?.ontologyAlignmentStrength) ?? asNullableNumber(previousComplexity?.ontologyAlignmentStrength) ?? 0.75,
          metadataJson: jsonText({
            objectTerm: currentTerms.objectTerm,
            signTerm: currentTerms.signTerm,
            interpretantTerm: currentTerms.interpretantTerm,
          }),
        });
      }
    }

    if (summary) {
      const providerOutputLinks = parsedMoments.flatMap((moment) => semeioticProviderOutputLinks(moment.rawSources));
      const summaryArtifact = await writeJsonArtifact({
        artifactDirectory,
        category: "semeiotic_structured",
        baseName: `semeiotic_summary_${proposal.id}`,
        value: {
          kind: "semeiotic_summary",
          proposalId: proposal.id,
          fragmentId: proposal.fragmentId,
          summary,
          momentIds: proposalMomentIds,
          providerOutputLinks,
        },
      });
      semeiotic_summaries.push({
        id: `semeiotic_summary_${proposal.id}`,
        parentId: null,
        fragmentId: proposal.fragmentId,
        proposalId: proposal.id,
        tick: proposal.updatedAtTick,
        createdAt: timestamp,
        updatedAt: timestamp,
        sourceKind: "proposal_orchestration",
        objectTerm: asNullableString(summary.object),
        signTerm: asNullableString(summary.signVehicle),
        interpretantTerm: asNullableString(summary.interpretant),
        confidence: asNullableNumber(summary.confidence),
        momentCount: asNullableNumber(summary.momentCount) ?? proposalMomentIds.length,
        mismatchCount: asNullableNumber(summary.mismatchCount) ?? 0,
        artifactPath: summaryArtifact?.relativePath ?? null,
        providerOutputLinksJson: jsonText(providerOutputLinks),
        summariesJson: jsonText(summary.summaries ?? null),
        payloadJson: jsonText(summary),
      });
    }
  }

  return {
    dialectical_moments,
    semeiotic_links,
    semeiotic_summaries,
  };
}

async function buildDialecticMoveRows(
  simulation: SimulationState,
  artifactDirectory: string,
  timestamp: string,
) {
  const rows: HistoryRow[] = [];

  for (const proposal of Object.values(simulation.proposals)) {
    const payload = asRecord(proposal.payload);
    const orchestration = asRecord(payload?.orchestration);
    const divergenceField = asRecord(orchestration?.divergenceField);
    const leanBridge = asRecord(orchestration?.leanBridge);
    const sourceProviders = asStringArray(orchestration?.sourceProviders);
    const dialecticMoves = Array.isArray(orchestration?.dialecticMoves)
      ? orchestration.dialecticMoves.map((move) => asRecord(move)).filter(Boolean)
      : [];

    for (const move of dialecticMoves) {
      const moveId = typeof move?.id === "string" ? move.id : undefined;
      const provider = typeof move?.provider === "string" ? move.provider : sourceProviders[0] ?? null;
      const role = typeof move?.role === "string" ? move.role : "propose";
      const summary = typeof move?.summary === "string" ? move.summary : proposal.naturalLanguageSummary;
      const extractedClaims = asStringArray(move?.extractedClaims);
      const extractedObjections = asStringArray(move?.extractedObjections);
      const extractedRepairs = asStringArray(move?.extractedRepairs);
      const topological = extractTopologicalHooks(move);
      const semeiotic =
        extractSemeioticProfile(move) ??
        inferDialecticMoveSemeioticProfile({
          role: role === "criticize" || role === "repair" || role === "synthesize" ? role : "propose",
          extractedClaims,
          extractedObjections,
          extractedRepairs,
        });

      if (!moveId) {
        continue;
      }

      const rawArtifact = await writeTextArtifact({
        artifactDirectory,
        category: "llm_outputs",
        baseName: `${proposal.id}_${moveId}`,
        content: formatDialecticMoveRaw({
          id: moveId,
          provider: provider ?? "unknown-provider",
          role: role === "criticize" || role === "repair" || role === "synthesize" ? role : "propose",
          parentId: typeof move?.parentId === "string" ? move.parentId : undefined,
          targetProposalId:
            typeof move?.targetProposalId === "string"
              ? (move.targetProposalId as SemanticProposalId)
              : proposal.id,
          summary,
          extractedClaims,
          extractedObjections,
          extractedRepairs,
        }),
        extension: ".txt",
      });

      rows.push({
        id: moveId,
        parentId: typeof move?.parentId === "string" ? move.parentId : null,
        fragmentId: proposal.fragmentId,
        tick: proposal.updatedAtTick,
        createdAt: timestamp,
        updatedAt: timestamp,
        proposalId: proposal.id,
        targetProposalId: typeof move?.targetProposalId === "string" ? move.targetProposalId : proposal.id,
        sourceFragmentId: proposal.fragmentId,
        targetFragmentId: proposal.fragmentId,
        moveType: role,
        provider,
        role,
        actorProviderId: provider,
        counterpartyProviderId: null,
        eventType: `dialectic_${role}`,
        fromPhase: null,
        toPhase: typeof leanBridge?.phase === "string" ? leanBridge.phase : null,
        summary,
        extractedClaimsJson: jsonText(extractedClaims),
        extractedObjectionsJson: jsonText(extractedObjections),
        extractedRepairsJson: jsonText(extractedRepairs),
        rawArtifactPath: rawArtifact?.relativePath ?? null,
        relationType: topological.relationType ?? role,
        sourceNodeId: topological.sourceNodeId ?? (typeof move?.parentId === "string" ? move.parentId : proposal.id),
        targetNodeId:
          topological.targetNodeId ??
          (typeof move?.targetProposalId === "string" ? move.targetProposalId : proposal.id),
        cycleHint: topological.cycleHint,
        obstructionKind:
          topological.obstructionKind ??
          (role === "criticize" || proposal.proposalKind === "obstruction_claim" ? "dialectic_obstruction" : null),
        cochainRole: topological.cochainRole,
        cancellationRole: topological.cancellationRole,
        resolutionStatus: topological.resolutionStatus ?? proposal.verificationState,
        ...semeioticColumns(semeiotic),
        forward: asNullableNumber(divergenceField?.forward),
        reverse: asNullableNumber(divergenceField?.reverse),
        asymmetry: asNullableNumber(divergenceField?.asymmetry),
        curvature: asNullableNumber(divergenceField?.curvature),
        projection:
          asNullableNumber(divergenceField?.projection) ??
          asNullableNumber(divergenceField?.projectionDivergence),
        total: asNullableNumber(divergenceField?.total),
        metadataJson: jsonText({
          structuredMove: move,
          proposalTitle: proposal.title,
          verificationState: proposal.verificationState,
        }),
      });
    }
  }

  return rows;
}

async function buildHistoryWritePayload(
  simulation: SimulationState,
  artifactDirectory: string,
  options?: { semeioticLogRawOutputs?: boolean },
): Promise<HistoryWritePayload> {
  const timestamp = nowIsoString();
  const orderedReplayLog = [...simulation.replayLog].sort(
    (left, right) => left.tick - right.tick || left.id.localeCompare(right.id),
  );
  const igLabEventTypes = new Set([
    "geometry_mode_changed",
    "barycenter_updated",
    "flow_direction_updated",
    "trajectory_fit_updated",
    "voronoi_partition_updated",
    "dual_chart_sync_updated",
    "catastrophe_marker_detected",
    "grammar_state_changed",
    "ig_snapshot_saved",
  ]);
  const semeioticEventTypes = new Set([
    "semeiotic_runtime_enabled",
    "semeiotic_runtime_disabled",
    "semeiotic_annotation_updated",
    "semeiotic_annotation_created",
    "semeiotic_mismatch_detected",
    "semeiotic_summary_updated",
    "semeiotic_chain_linked",
    "semeiotic_overlay_toggled",
  ]);
  const semeioticStructures = await buildSemeioticRows(simulation, artifactDirectory, timestamp, {
    logRawOutputs: options?.semeioticLogRawOutputs,
  });

  const ticks: HistoryRow[] = [
    {
      id: `tick_${simulation.activeTick}`,
      parentId: simulation.activeTick > 0 ? `tick_${simulation.activeTick - 1}` : null,
      fragmentId: simulation.activeFragmentId ?? null,
      tick: simulation.activeTick,
      createdAt: timestamp,
      updatedAt: timestamp,
      runState: simulation.runState,
      activeFragmentId: simulation.activeFragmentId ?? null,
      activeProposalId: simulation.activeProposalId ?? null,
      replayEventCount: orderedReplayLog.filter((entry) => entry.tick === simulation.activeTick).length,
      metadataJson: jsonText({
        proposalQueue: simulation.proposalQueue,
        persistentConfig: simulation.persistentConfig,
      }),
    },
  ];

  const fragments = Object.values(simulation.fragments).map((fragment) => ({
    id: fragment.id,
    parentId: fragment.parentFragmentId ?? null,
    fragmentId: fragment.id,
    tick: simulation.activeTick,
    createdAt: timestamp,
    updatedAt: timestamp,
    generationDepth: fragment.generationDepth,
    status: fragment.status,
    phase: fragment.phase,
    promotionLayer: fragment.promotion.layer,
    proposalCount: fragment.activeProposalIds.length,
    childCount: fragment.childFragmentIds.length,
    embeddingJson: jsonText(fragment.embedding),
    thetaJson: jsonText(fragment.theta),
    etaJson: jsonText(fragment.eta),
    labelsJson: jsonText(fragment.labels),
    payloadJson: jsonText({
      semanticPayload: fragment.semanticPayload,
      promotion: fragment.promotion,
      catastrophe: fragment.catastrophe,
      catastropheScore: fragment.catastropheScore,
      activeProposalIds: fragment.activeProposalIds,
    }),
  }));

  const proposals = Object.values(simulation.proposals).map((proposal) => {
    const payload = asRecord(proposal.payload);
    const orchestration = asRecord(payload?.orchestration);
    const divergenceField = asRecord(orchestration?.divergenceField);
    const sourceProviders = Array.isArray(orchestration?.sourceProviders) ? orchestration?.sourceProviders : [];
    const topological = proposalTopologyHooks(proposal);
    const semeiotic =
      extractSemeioticProfile(orchestration?.semeiotic, payload?.semeiotic) ??
      inferProposalSemeioticFromProposal(proposal, typeof divergenceField?.phase === "string" ? divergenceField.phase : undefined);

    return {
      id: proposal.id,
      parentId: null,
      fragmentId: proposal.fragmentId,
      tick: proposal.updatedAtTick,
      createdAt: timestamp,
      updatedAt: timestamp,
      proposalKind: proposal.proposalKind,
      title: proposal.title,
      summary: proposal.naturalLanguageSummary,
      verificationState: proposal.verificationState,
      outcomeState: proposal.verificationState,
      leanRunId: null,
      sourceProviderIdsJson: jsonText(sourceProviders),
      embeddingJson: jsonText(proposal.embedding),
      thetaJson: jsonText(proposal.theta),
      etaJson: jsonText(proposal.eta),
      divergenceJson: jsonText(divergenceField ?? null),
      relationType: topological.relationType,
      sourceNodeId: topological.sourceNodeId,
      targetNodeId: topological.targetNodeId,
      cycleHint: topological.cycleHint,
      obstructionKind: topological.obstructionKind,
      cochainRole: topological.cochainRole,
      cancellationRole: topological.cancellationRole,
      resolutionStatus: topological.resolutionStatus,
      ...semeioticColumns(semeiotic),
      payloadJson: jsonText(proposal.payload ?? null),
    };
  });

  const dialectic_moves = await buildDialecticMoveRows(simulation, artifactDirectory, timestamp);

  const lean_runs = Object.values(simulation.proposals)
    .filter((proposal) => proposal.leanTask)
    .map((proposal) => {
      const payload = asRecord(proposal.payload);
      const orchestration = asRecord(payload?.orchestration);
      const leanBridge = asRecord(orchestration?.leanBridge);
      const divergenceField = asRecord(orchestration?.divergenceField);
      const topological = extractTopologicalHooks(leanBridge, orchestration, payload);
      const semeiotic =
        extractSemeioticProfile(leanBridge, orchestration?.semeiotic, payload?.semeiotic) ??
        inferLeanRunSemeioticProfile({
          outcome: proposal.verificationState,
          theoremKind: typeof leanBridge?.theoremKind === "string" ? leanBridge.theoremKind : proposal.proposalKind,
          status: typeof leanBridge?.status === "string" ? leanBridge.status : proposal.leanTask?.status,
        });

      return {
        id: proposal.leanTask?.id ?? `${proposal.id}_lean`,
        parentId: null,
        fragmentId: proposal.fragmentId,
        tick: proposal.updatedAtTick,
        createdAt: timestamp,
        updatedAt: timestamp,
        proposalId: proposal.id,
        taskId: proposal.leanTask?.id ?? null,
        theoremKind: typeof leanBridge?.theoremKind === "string" ? leanBridge.theoremKind : proposal.proposalKind,
        status: typeof leanBridge?.status === "string" ? leanBridge.status : proposal.leanTask?.status ?? null,
        accepted: proposal.verificationState === "accepted" ? 1 : 0,
        blocked: proposal.verificationState === "blocked" ? 1 : 0,
        rejected: proposal.verificationState === "rejected" ? 1 : 0,
        command: typeof leanBridge?.command === "string" ? leanBridge.command : null,
        snippetPath: typeof leanBridge?.snippetPath === "string" ? leanBridge.snippetPath : null,
        moduleName: typeof leanBridge?.moduleName === "string" ? leanBridge.moduleName : null,
        stdoutPath: typeof leanBridge?.stdoutPath === "string" ? leanBridge.stdoutPath : null,
        stderrPath: typeof leanBridge?.stderrPath === "string" ? leanBridge.stderrPath : null,
        forward: typeof divergenceField?.forward === "number" ? Number(divergenceField.forward) : null,
        reverse: typeof divergenceField?.reverse === "number" ? Number(divergenceField.reverse) : null,
        asymmetry: typeof divergenceField?.asymmetry === "number" ? Number(divergenceField.asymmetry) : null,
        projection:
          typeof divergenceField?.projection === "number"
            ? Number(divergenceField.projection)
            : typeof divergenceField?.projectionDivergence === "number"
              ? Number(divergenceField.projectionDivergence)
              : null,
        total: typeof divergenceField?.total === "number" ? Number(divergenceField.total) : null,
        phase: typeof leanBridge?.phase === "string" ? leanBridge.phase : null,
        sourceVectorJson: jsonText(leanBridge?.sourceVector ?? null),
        targetVectorJson: jsonText(leanBridge?.targetVector ?? null),
        repairedVectorJson: jsonText(leanBridge?.repairedVector ?? null),
        relationType: topological.relationType ?? (typeof leanBridge?.theoremKind === "string" ? leanBridge.theoremKind : proposal.proposalKind),
        sourceNodeId: topological.sourceNodeId ?? proposal.id,
        targetNodeId: topological.targetNodeId ?? proposal.fragmentId,
        cycleHint: topological.cycleHint,
        obstructionKind:
          topological.obstructionKind ??
          (proposal.proposalKind === "obstruction_claim" || proposal.verificationState === "blocked"
            ? "lean_obstruction_candidate"
            : null),
        cochainRole: topological.cochainRole,
        cancellationRole: topological.cancellationRole,
        resolutionStatus: topological.resolutionStatus ?? proposal.verificationState,
        ...semeioticColumns(semeiotic),
        payloadJson: jsonText({
          leanTask: proposal.leanTask ?? null,
          proofAttempt: proposal.leanTask ? simulation.proofAttempts[proposal.leanTask.id] ?? null : null,
        }),
      };
    });

  const persistent_nodes = [...simulation.persistent.theoremStubs, ...simulation.persistent.definitionStubs].map((stub) => {
    const proposal = simulation.proposals[stub.proposalId];
    const topological = proposal ? proposalTopologyHooks(proposal) : extractTopologicalHooks(undefined);
    const semeiotic =
      extractSemeioticProfile(proposal?.payload) ??
      inferPersistentNodeSemeioticProfile({
        kind: stub.kind,
        layer: stub.layer,
      });

    return {
      id: stub.id,
      parentId: proposal?.id ?? null,
      fragmentId: stub.fragmentId,
      tick: stub.promotedAtTick,
      createdAt: timestamp,
      updatedAt: timestamp,
      proposalId: stub.proposalId,
      nodeKind: stub.kind,
      layer: stub.layer,
      title: stub.title,
      summary: stub.summary,
      leanSnippet: stub.leanSnippet,
      relationType: topological.relationType ?? stub.kind,
      sourceNodeId: topological.sourceNodeId ?? stub.proposalId,
      targetNodeId: topological.targetNodeId ?? stub.fragmentId,
      cycleHint: topological.cycleHint,
      obstructionKind: topological.obstructionKind,
      cochainRole: topological.cochainRole,
      cancellationRole: topological.cancellationRole,
      resolutionStatus: topological.resolutionStatus ?? stub.layer,
      ...semeioticColumns(semeiotic),
      payloadJson: jsonText({
        promotedAtTick: stub.promotedAtTick,
        proposalKind: proposal?.proposalKind ?? null,
        promotionLayer: proposal ? simulation.fragments[stub.fragmentId]?.promotion.layer ?? null : null,
      }),
    };
  });

  const ig_lab_events = orderedReplayLog
    .filter((entry) => igLabEventTypes.has(entry.eventType))
    .map((entry) => ({
      id: entry.id,
      parentId: null,
      fragmentId: entry.fragmentId ?? null,
      tick: entry.tick,
      createdAt: timestamp,
      updatedAt: timestamp,
      proposalId: entry.proposalId ?? null,
      eventType: entry.eventType,
      message: entry.message,
      payloadJson: jsonText(entry.payload ?? null),
    }));

  const semeiotic_events = orderedReplayLog
    .filter((entry) => semeioticEventTypes.has(entry.eventType))
    .map((entry) => ({
      id: entry.id,
      parentId: null,
      fragmentId: entry.fragmentId ?? null,
      tick: entry.tick,
      createdAt: timestamp,
      updatedAt: timestamp,
      proposalId: entry.proposalId ?? null,
      eventType: entry.eventType,
      message: entry.message,
      payloadJson: jsonText(entry.payload ?? null),
    }));

  return {
    ticks,
    fragments,
    proposals,
    dialectic_moves,
    dialectical_moments: semeioticStructures.dialectical_moments,
    semeiotic_links: semeioticStructures.semeiotic_links,
    semeiotic_summaries: semeioticStructures.semeiotic_summaries,
    lean_runs,
    persistent_nodes,
    ig_lab_events,
    semeiotic_events,
  };
}

async function runHistoryWriter(databasePath: string, payload: HistoryWritePayload) {
  const { spawn } = await importNodeModule<typeof import("node:child_process")>("node:child_process");
  const fs = await importNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
  const path = await importNodeModule<typeof import("node:path")>("node:path");
  const payloadPath = path.resolve(process.cwd(), "data", `history_payload_${Date.now()}.json`);
  const script = [
    "import json, pathlib, sqlite3, sys",
    "db_path = pathlib.Path(sys.argv[1])",
    "payload_path = pathlib.Path(sys.argv[2])",
    "payload = json.loads(payload_path.read_text(encoding='utf-8'))",
    "db_path.parent.mkdir(parents=True, exist_ok=True)",
    "conn = sqlite3.connect(str(db_path))",
    "def upsert(table, columns, rows):",
    "    if not rows:",
    "        return",
    "    placeholders = ', '.join('?' for _ in columns)",
    "    assignments = ', '.join(f\"{column}=excluded.{column}\" for column in columns if column != 'id')",
    "    sql = f\"INSERT INTO {table} ({', '.join(columns)}) VALUES ({placeholders}) ON CONFLICT(id) DO UPDATE SET {assignments}\"",
    "    conn.executemany(sql, ([row.get(column) for column in columns] for row in rows))",
    "tables = {",
    "    'ticks': ['id','parentId','fragmentId','tick','createdAt','updatedAt','runState','activeFragmentId','activeProposalId','replayEventCount','metadataJson'],",
    "    'fragments': ['id','parentId','fragmentId','tick','createdAt','updatedAt','generationDepth','status','phase','promotionLayer','proposalCount','childCount','embeddingJson','thetaJson','etaJson','labelsJson','payloadJson'],",
    "    'proposals': ['id','parentId','fragmentId','tick','createdAt','updatedAt','proposalKind','title','summary','verificationState','outcomeState','leanRunId','sourceProviderIdsJson','embeddingJson','thetaJson','etaJson','divergenceJson','relationType','sourceNodeId','targetNodeId','cycleHint','obstructionKind','cochainRole','cancellationRole','resolutionStatus','semeioticObjectTerm','semeioticSignTerm','semeioticInterpretantTerm','semeioticConfidence','payloadJson'],",
    "    'dialectic_moves': ['id','parentId','fragmentId','tick','createdAt','updatedAt','proposalId','targetProposalId','sourceFragmentId','targetFragmentId','moveType','provider','role','actorProviderId','counterpartyProviderId','eventType','fromPhase','toPhase','summary','extractedClaimsJson','extractedObjectionsJson','extractedRepairsJson','rawArtifactPath','relationType','sourceNodeId','targetNodeId','cycleHint','obstructionKind','cochainRole','cancellationRole','resolutionStatus','semeioticObjectTerm','semeioticSignTerm','semeioticInterpretantTerm','semeioticConfidence','forward','reverse','asymmetry','curvature','projection','total','metadataJson'],",
    "    'dialectical_moments': ['id','parentId','fragmentId','proposalId','dialecticMoveId','tick','createdAt','updatedAt','provider','role','source','summary','rawArtifactPointer','structuredArtifactPath','providerOutputLinksJson','rawSourcesJson','linkedMomentIdsJson','notesJson','semeioticObjectTerm','semeioticSignTerm','semeioticInterpretantTerm','semeioticConfidence','mismatchCount','mismatchesJson','claimCount','objectionCount','repairCount','branchCount','triadicEntropy','annotationDensity','confidenceSpread','ontologyAlignmentStrength','interpretantInstability','objectSignMismatch','triadicImbalance','internalAmbiguity','signEventBranchingComplexity','critiqueInducedReinterpretationDepth','overallComplexity','payloadJson'],",
    "    'semeiotic_links': ['id','parentId','fragmentId','proposalId','tick','createdAt','updatedAt','sourceMomentId','targetMomentId','sourceNodeId','targetNodeId','relationType','chainKind','mismatchKind','summary','strength','metadataJson'],",
    "    'semeiotic_summaries': ['id','parentId','fragmentId','proposalId','tick','createdAt','updatedAt','sourceKind','objectTerm','signTerm','interpretantTerm','confidence','momentCount','mismatchCount','artifactPath','providerOutputLinksJson','summariesJson','payloadJson'],",
    "    'lean_runs': ['id','parentId','fragmentId','tick','createdAt','updatedAt','proposalId','taskId','theoremKind','status','accepted','blocked','rejected','command','snippetPath','moduleName','stdoutPath','stderrPath','forward','reverse','asymmetry','projection','total','phase','sourceVectorJson','targetVectorJson','repairedVectorJson','relationType','sourceNodeId','targetNodeId','cycleHint','obstructionKind','cochainRole','cancellationRole','resolutionStatus','semeioticObjectTerm','semeioticSignTerm','semeioticInterpretantTerm','semeioticConfidence','payloadJson'],",
    "    'persistent_nodes': ['id','parentId','fragmentId','tick','createdAt','updatedAt','proposalId','nodeKind','layer','title','summary','leanSnippet','relationType','sourceNodeId','targetNodeId','cycleHint','obstructionKind','cochainRole','cancellationRole','resolutionStatus','semeioticObjectTerm','semeioticSignTerm','semeioticInterpretantTerm','semeioticConfidence','payloadJson'],",
    "    'ig_lab_events': ['id','parentId','fragmentId','tick','createdAt','updatedAt','proposalId','eventType','message','payloadJson'],",
    "    'semeiotic_events': ['id','parentId','fragmentId','tick','createdAt','updatedAt','proposalId','eventType','message','payloadJson'],",
  "}",
    "try:",
    "    for table_name, columns in tables.items():",
    "        upsert(table_name, columns, payload.get(table_name, []))",
    "    conn.commit()",
    "finally:",
    "    conn.close()",
  ].join("\n");

  await fs.mkdir(path.dirname(payloadPath), { recursive: true });
  await fs.writeFile(payloadPath, JSON.stringify(payload), "utf8");

  return await new Promise<HistoryPersistenceResult>((resolve) => {
    let stdout = "";
    let stderr = "";

    const child = spawn("python", ["-c", script, databasePath, payloadPath], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      void fs.rm(payloadPath, { force: true });
      resolve({
        persisted: false,
        databasePath,
        stdout,
        stderr,
        error: error.message,
      });
    });

    child.on("close", (exitCode) => {
      void fs.rm(payloadPath, { force: true });
      resolve({
        persisted: exitCode === 0,
        databasePath,
        stdout,
        stderr,
        error: exitCode === 0 ? undefined : `History writer exited with code ${exitCode}.`,
      });
    });
  });
}

export async function persistSimulationHistorySnapshot(
  databasePath: string,
  artifactDirectory: string,
  simulation: SimulationState,
  options?: { semeioticLogRawOutputs?: boolean },
): Promise<HistoryPersistenceResult> {
  if (!isNodeRuntime()) {
    return {
      persisted: false,
      databasePath,
      stdout: "",
      stderr: "",
      error: "History persistence requires a Node runtime.",
    };
  }

  const path = await importNodeModule<typeof import("node:path")>("node:path");
  const resolvedDatabasePath = path.resolve(process.cwd(), databasePath);
  const initialization = await initializeHistorySqlite(databasePath);
  if (!initialization.initialized) {
    return {
      persisted: false,
      databasePath: resolvedDatabasePath,
      stdout: initialization.stdout,
      stderr: initialization.stderr,
      error: initialization.error,
    };
  }
  return runHistoryWriter(
    resolvedDatabasePath,
    await buildHistoryWritePayload(simulation, artifactDirectory, options),
  );
}
