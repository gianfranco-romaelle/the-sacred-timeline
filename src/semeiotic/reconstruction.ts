import { initializeHistorySqlite } from "@/persistence/history-sqlite";
import type { FragmentId, SemanticProposalId } from "@/types/hegel-triangle";
import type {
  ComplexityMetrics,
  DialecticalMoment,
  DialecticalMomentId,
  DialecticalMomentRawSource,
  DialecticalRole,
  PeirceProfile,
  SemeioticMismatch,
  SubjectiveContact,
} from "./schema";

type PythonCommand = {
  command: string;
  args: string[];
};

export interface PersistedProviderOutputLink {
  id?: string;
  kind?: string;
  label?: string;
  provider?: string;
  pointer?: string;
  artifactPath?: string;
}

export interface PersistedDialecticalMomentRecord {
  id: DialecticalMomentId | string;
  parentId?: string;
  fragmentId?: FragmentId;
  proposalId?: SemanticProposalId;
  dialecticMoveId?: string;
  tick: number;
  provider?: string;
  role: DialecticalRole | string;
  source?: string;
  summary?: string;
  peirceProfile?: PeirceProfile;
  subjectiveContact?: SubjectiveContact;
  mismatches: SemeioticMismatch[];
  complexity?: ComplexityMetrics;
  rawSources: DialecticalMomentRawSource[];
  linkedMomentIds: string[];
  notes: string[];
  rawArtifactPointer?: string;
  structuredArtifactPath?: string;
  providerOutputLinks: PersistedProviderOutputLink[];
  normalizedTerms: {
    objectTerm?: string;
    signTerm?: string;
    interpretantTerm?: string;
    confidence?: number;
  };
  payload?: Record<string, unknown>;
}

export interface PersistedSemeioticLinkRecord {
  id: string;
  parentId?: string;
  fragmentId?: FragmentId;
  proposalId?: SemanticProposalId;
  tick: number;
  sourceMomentId?: string;
  targetMomentId?: string;
  sourceNodeId?: string;
  targetNodeId?: string;
  relationType: string;
  chainKind?: string;
  mismatchKind?: string;
  summary?: string;
  strength?: number;
  metadata?: Record<string, unknown>;
}

export interface PersistedSemeioticChain {
  seedMomentIds: string[];
  fragmentId?: FragmentId;
  proposalId?: SemanticProposalId;
  moments: PersistedDialecticalMomentRecord[];
  links: PersistedSemeioticLinkRecord[];
}

export interface InterpretantTransition {
  sourceMomentId: string;
  targetMomentId: string;
  sourceInterpretantTerm?: string;
  targetInterpretantTerm?: string;
  sourceRole?: string;
  targetRole?: string;
  relationType: string;
  chainKind?: string;
  changed: boolean;
  tick: number;
  fragmentId?: FragmentId;
  proposalId?: SemanticProposalId;
  strength?: number;
}

export interface SemeioticChainScope {
  fragmentId?: FragmentId;
  proposalId?: SemanticProposalId;
  momentId?: string;
}

function isNodeRuntime() {
  const runtime = globalThis as { process?: { versions?: { node?: string } } };
  return typeof runtime.process?.versions?.node === "string";
}

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
  const { spawn } = await import("node:child_process");

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

async function runSqliteRowsQuery(
  databasePath: string,
  sql: string,
  params: unknown[] = [],
): Promise<Record<string, unknown>[]> {
  if (!isNodeRuntime()) {
    return [];
  }

  const schemaReady = await initializeHistorySqlite(databasePath);
  if (!schemaReady.initialized) {
    return [];
  }

  const script = [
    "import base64, json, pathlib, sqlite3, sys",
    "payload = json.loads(base64.b64decode(sys.argv[1]).decode('utf-8'))",
    "db_path = pathlib.Path(sys.argv[2])",
    "conn = sqlite3.connect(str(db_path))",
    "conn.row_factory = sqlite3.Row",
    "try:",
    "    rows = [dict(row) for row in conn.execute(payload['sql'], tuple(payload.get('params', []))).fetchall()]",
    "finally:",
    "    conn.close()",
    "print(json.dumps(rows))",
  ].join("\n");

  const payloadBase64 = Buffer.from(JSON.stringify({ sql, params }), "utf8").toString("base64");
  const sharedArgs = ["-c", script, payloadBase64, schemaReady.databasePath];
  let stdout = "";

  for (const candidate of pythonCommandCandidates(sharedArgs)) {
    const result = await runPython(candidate, process.cwd());
    stdout += result.stdout;

    if (result.exitCode === 0) {
      try {
        const parsed = JSON.parse(result.stdout) as Record<string, unknown>[];
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
  }

  return [];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseJson<T>(value: unknown): T | undefined {
  if (typeof value === "string" && value.length > 0) {
    try {
      return JSON.parse(value) as T;
    } catch {
      return undefined;
    }
  }

  return value as T | undefined;
}

function parseStringArray(value: unknown) {
  const parsed = parseJson<unknown[]>(value);
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
}

function parseRawSources(value: unknown) {
  const parsed = parseJson<unknown[]>(value);
  return Array.isArray(parsed)
    ? parsed.filter((item): item is DialecticalMomentRawSource => Boolean(asRecord(item)))
    : [];
}

function parseMismatches(value: unknown) {
  const parsed = parseJson<unknown[]>(value);
  return Array.isArray(parsed)
    ? parsed.filter((item): item is SemeioticMismatch => Boolean(asRecord(item)))
    : [];
}

function parseNotes(value: unknown) {
  const parsed = parseJson<unknown[]>(value);
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
}

function parseProviderOutputLinks(value: unknown) {
  const parsed = parseJson<unknown[]>(value);
  return Array.isArray(parsed)
    ? parsed
        .map((item) => asRecord(item))
        .filter((item): item is Record<string, unknown> => Boolean(item))
        .map((item) => ({
          id: asString(item.id),
          kind: asString(item.kind),
          label: asString(item.label),
          provider: asString(item.provider),
          pointer: asString(item.pointer),
          artifactPath: asString(item.artifactPath),
        }))
    : [];
}

function complexityMetricNumber(
  payloadComplexity: Record<string, unknown> | undefined,
  row: Record<string, unknown>,
  key: keyof ComplexityMetrics,
  fallback = 0,
) {
  return asNumber(payloadComplexity?.[key]) ?? asNumber(row[key]) ?? fallback;
}

function reconstructComplexity(row: Record<string, unknown>, payload?: Record<string, unknown>): ComplexityMetrics {
  const payloadComplexity = asRecord(payload?.complexity);

  return {
    claimCount: complexityMetricNumber(payloadComplexity, row, "claimCount"),
    objectionCount: complexityMetricNumber(payloadComplexity, row, "objectionCount"),
    repairCount: complexityMetricNumber(payloadComplexity, row, "repairCount"),
    branchCount: complexityMetricNumber(payloadComplexity, row, "branchCount"),
    mismatchCount: complexityMetricNumber(payloadComplexity, row, "mismatchCount"),
    triadicEntropy: complexityMetricNumber(payloadComplexity, row, "triadicEntropy"),
    annotationDensity: complexityMetricNumber(payloadComplexity, row, "annotationDensity"),
    confidenceSpread: complexityMetricNumber(payloadComplexity, row, "confidenceSpread"),
    ontologyAlignmentStrength: complexityMetricNumber(payloadComplexity, row, "ontologyAlignmentStrength"),
    interpretantInstability: complexityMetricNumber(payloadComplexity, row, "interpretantInstability"),
    objectSignMismatch: complexityMetricNumber(payloadComplexity, row, "objectSignMismatch"),
    triadicImbalance: complexityMetricNumber(payloadComplexity, row, "triadicImbalance"),
    internalAmbiguity: complexityMetricNumber(payloadComplexity, row, "internalAmbiguity"),
    signEventBranchingComplexity: complexityMetricNumber(payloadComplexity, row, "signEventBranchingComplexity"),
    critiqueInducedReinterpretationDepth: complexityMetricNumber(
      payloadComplexity,
      row,
      "critiqueInducedReinterpretationDepth",
    ),
    overallComplexity: complexityMetricNumber(payloadComplexity, row, "overallComplexity"),
  } satisfies ComplexityMetrics;
}

function reconstructMoment(row: Record<string, unknown>): PersistedDialecticalMomentRecord | undefined {
  const payload = parseJson<Record<string, unknown>>(row.payloadJson);
  const rawSources = parseRawSources(row.rawSourcesJson ?? payload?.rawSources);
  const linkedMomentIds = parseStringArray(row.linkedMomentIdsJson ?? payload?.linkedMomentIds);
  const mismatches = parseMismatches(row.mismatchesJson ?? payload?.mismatches);
  const notes = parseNotes(row.notesJson ?? payload?.notes);

  const id = asString(row.id) ?? asString(payload?.id);
  const role = asString(row.role) ?? asString(payload?.role);
  const tick = asNumber(row.tick) ?? asNumber(payload?.tick);

  if (!id || !role || typeof tick !== "number") {
    return undefined;
  }

  return {
    id,
    parentId: asString(row.parentId),
    fragmentId: asString(row.fragmentId) as FragmentId | undefined,
    proposalId: asString(row.proposalId) as SemanticProposalId | undefined,
    dialecticMoveId: asString(row.dialecticMoveId) ?? asString(payload?.dialecticMoveId),
    tick,
    provider: asString(row.provider) ?? asString(payload?.provider),
    role,
    source: asString(row.source) ?? asString(payload?.source),
    summary: asString(row.summary) ?? asString(payload?.summary),
    peirceProfile: asRecord(payload?.peirceProfile) as PeirceProfile | undefined,
    subjectiveContact: asRecord(payload?.subjectiveContact) as SubjectiveContact | undefined,
    mismatches,
    complexity: reconstructComplexity(row, payload),
    rawSources,
    linkedMomentIds,
    notes,
    rawArtifactPointer: asString(row.rawArtifactPointer),
    structuredArtifactPath: asString(row.structuredArtifactPath),
    providerOutputLinks: parseProviderOutputLinks(row.providerOutputLinksJson),
    normalizedTerms: {
      objectTerm: asString(row.semeioticObjectTerm),
      signTerm: asString(row.semeioticSignTerm),
      interpretantTerm: asString(row.semeioticInterpretantTerm),
      confidence: asNumber(row.semeioticConfidence),
    },
    payload,
  };
}

function reconstructLink(row: Record<string, unknown>): PersistedSemeioticLinkRecord | undefined {
  const id = asString(row.id);
  const relationType = asString(row.relationType);
  const tick = asNumber(row.tick);

  if (!id || !relationType || typeof tick !== "number") {
    return undefined;
  }

  return {
    id,
    parentId: asString(row.parentId),
    fragmentId: asString(row.fragmentId) as FragmentId | undefined,
    proposalId: asString(row.proposalId) as SemanticProposalId | undefined,
    tick,
    sourceMomentId: asString(row.sourceMomentId),
    targetMomentId: asString(row.targetMomentId),
    sourceNodeId: asString(row.sourceNodeId),
    targetNodeId: asString(row.targetNodeId),
    relationType,
    chainKind: asString(row.chainKind),
    mismatchKind: asString(row.mismatchKind),
    summary: asString(row.summary),
    strength: asNumber(row.strength),
    metadata: parseJson<Record<string, unknown>>(row.metadataJson),
  };
}

function sortMoments(moments: PersistedDialecticalMomentRecord[]) {
  return [...moments].sort((left, right) => left.tick - right.tick || String(left.id).localeCompare(String(right.id)));
}

function sortLinks(links: PersistedSemeioticLinkRecord[]) {
  return [...links].sort((left, right) => left.tick - right.tick || left.id.localeCompare(right.id));
}

function buildChainFromSeedIds(
  seedMomentIds: string[],
  allMoments: PersistedDialecticalMomentRecord[],
  allLinks: PersistedSemeioticLinkRecord[],
): PersistedSemeioticChain | undefined {
  if (seedMomentIds.length === 0) {
    return undefined;
  }

  const momentMap = new Map(allMoments.map((moment) => [String(moment.id), moment]));
  const queue = [...seedMomentIds];
  const visited = new Set<string>(seedMomentIds);
  const chainLinkIds = new Set<string>();

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId) {
      continue;
    }

    for (const link of allLinks) {
      const touchesCurrent = link.sourceMomentId === currentId || link.targetMomentId === currentId;
      if (!touchesCurrent) {
        continue;
      }

      chainLinkIds.add(link.id);
      const neighborIds = [link.sourceMomentId, link.targetMomentId].filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      );

      for (const neighborId of neighborIds) {
        if (!visited.has(neighborId) && momentMap.has(neighborId)) {
          visited.add(neighborId);
          queue.push(neighborId);
        }
      }
    }
  }

  const moments = sortMoments(
    Array.from(visited)
      .map((id) => momentMap.get(id))
      .filter((moment): moment is PersistedDialecticalMomentRecord => Boolean(moment)),
  );
  const links = sortLinks(allLinks.filter((link) => chainLinkIds.has(link.id)));
  const anchorMoment = moments[0];

  return {
    seedMomentIds,
    fragmentId: anchorMoment?.fragmentId,
    proposalId: anchorMoment?.proposalId,
    moments,
    links,
  };
}

async function getLinksForScope(databasePath: string, scope?: SemeioticChainScope) {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (scope?.momentId) {
    clauses.push("(sourceMomentId = ? OR targetMomentId = ?)");
    params.push(scope.momentId, scope.momentId);
  }
  if (scope?.proposalId) {
    clauses.push("proposalId = ?");
    params.push(scope.proposalId);
  }
  if (scope?.fragmentId) {
    clauses.push("fragmentId = ?");
    params.push(scope.fragmentId);
  }

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await runSqliteRowsQuery(
    databasePath,
    `SELECT * FROM semeiotic_links ${whereClause} ORDER BY tick ASC, id ASC`,
    params,
  );

  return rows.map(reconstructLink).filter((link): link is PersistedSemeioticLinkRecord => Boolean(link));
}

export async function getDialecticalMomentById(databasePath: string, momentId: string) {
  const rows = await runSqliteRowsQuery(
    databasePath,
    "SELECT * FROM dialectical_moments WHERE id = ? LIMIT 1",
    [momentId],
  );

  return reconstructMoment(rows[0]);
}

export async function getMomentsForProposal(databasePath: string, proposalId: SemanticProposalId | string) {
  const rows = await runSqliteRowsQuery(
    databasePath,
    "SELECT * FROM dialectical_moments WHERE proposalId = ? ORDER BY tick ASC, id ASC",
    [proposalId],
  );

  return sortMoments(rows.map(reconstructMoment).filter((moment): moment is PersistedDialecticalMomentRecord => Boolean(moment)));
}

export async function getMomentsForFragment(databasePath: string, fragmentId: FragmentId | string) {
  const rows = await runSqliteRowsQuery(
    databasePath,
    "SELECT * FROM dialectical_moments WHERE fragmentId = ? ORDER BY tick ASC, id ASC",
    [fragmentId],
  );

  return sortMoments(rows.map(reconstructMoment).filter((moment): moment is PersistedDialecticalMomentRecord => Boolean(moment)));
}

export async function getSemeioticChainFromMove(databasePath: string, dialecticMoveId: string) {
  const momentRows = await runSqliteRowsQuery(
    databasePath,
    "SELECT * FROM dialectical_moments WHERE dialecticMoveId = ? ORDER BY tick ASC, id ASC",
    [dialecticMoveId],
  );
  const seedMoments = momentRows
    .map(reconstructMoment)
    .filter((moment): moment is PersistedDialecticalMomentRecord => Boolean(moment));

  if (seedMoments.length === 0) {
    return undefined;
  }

  const scope = {
    proposalId: seedMoments[0].proposalId,
    fragmentId: seedMoments[0].fragmentId,
  };
  const [allMoments, allLinks] = await Promise.all([
    scope.proposalId
      ? getMomentsForProposal(databasePath, scope.proposalId)
      : scope.fragmentId
        ? getMomentsForFragment(databasePath, scope.fragmentId)
        : Promise.resolve(seedMoments),
    getLinksForScope(databasePath, scope),
  ]);

  return buildChainFromSeedIds(
    seedMoments.map((moment) => String(moment.id)),
    allMoments,
    allLinks,
  );
}

export async function getMismatchChains(databasePath: string, scope?: SemeioticChainScope) {
  const [allMoments, allLinks] = await Promise.all([
    scope?.proposalId
      ? getMomentsForProposal(databasePath, scope.proposalId)
      : scope?.fragmentId
        ? getMomentsForFragment(databasePath, scope.fragmentId)
        : runSqliteRowsQuery(
            databasePath,
            "SELECT * FROM dialectical_moments ORDER BY tick ASC, id ASC",
          ).then((rows) =>
            sortMoments(rows.map(reconstructMoment).filter((moment): moment is PersistedDialecticalMomentRecord => Boolean(moment))),
          ),
    getLinksForScope(databasePath, scope),
  ]);

  const mismatchLinks = allLinks.filter(
    (link) => link.chainKind === "mismatch_chain" || link.relationType === "alignment_mismatch" || Boolean(link.mismatchKind),
  );
  const visited = new Set<string>();
  const chains: PersistedSemeioticChain[] = [];

  for (const link of mismatchLinks) {
    const seedIds = [link.sourceMomentId, link.targetMomentId].filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
    const unseenSeedIds = seedIds.filter((id) => !visited.has(id));
    if (unseenSeedIds.length === 0) {
      continue;
    }

    const chain = buildChainFromSeedIds(unseenSeedIds, allMoments, mismatchLinks);
    if (!chain) {
      continue;
    }

    for (const moment of chain.moments) {
      visited.add(String(moment.id));
    }
    chains.push(chain);
  }

  return chains;
}

export async function getInterpretantTransitions(databasePath: string, scope?: SemeioticChainScope) {
  const [allMoments, allLinks] = await Promise.all([
    scope?.proposalId
      ? getMomentsForProposal(databasePath, scope.proposalId)
      : scope?.fragmentId
        ? getMomentsForFragment(databasePath, scope.fragmentId)
        : runSqliteRowsQuery(
            databasePath,
            "SELECT * FROM dialectical_moments ORDER BY tick ASC, id ASC",
          ).then((rows) =>
            sortMoments(rows.map(reconstructMoment).filter((moment): moment is PersistedDialecticalMomentRecord => Boolean(moment))),
          ),
    getLinksForScope(databasePath, scope),
  ]);

  const momentMap = new Map(allMoments.map((moment) => [String(moment.id), moment]));

  return sortLinks(allLinks)
    .map((link): InterpretantTransition | undefined => {
      const sourceMoment = link.sourceMomentId ? momentMap.get(link.sourceMomentId) : undefined;
      const targetMoment = link.targetMomentId ? momentMap.get(link.targetMomentId) : undefined;
      const sourceInterpretantTerm = sourceMoment?.normalizedTerms.interpretantTerm;
      const targetInterpretantTerm = targetMoment?.normalizedTerms.interpretantTerm;

      if (!sourceMoment || !targetMoment || (!sourceInterpretantTerm && !targetInterpretantTerm)) {
        return undefined;
      }

      return {
        sourceMomentId: String(sourceMoment.id),
        targetMomentId: String(targetMoment.id),
        sourceInterpretantTerm,
        targetInterpretantTerm,
        sourceRole: String(sourceMoment.role),
        targetRole: String(targetMoment.role),
        relationType: link.relationType,
        chainKind: link.chainKind,
        changed: sourceInterpretantTerm !== targetInterpretantTerm,
        tick: link.tick,
        fragmentId: link.fragmentId,
        proposalId: link.proposalId,
        strength: link.strength,
      } satisfies InterpretantTransition;
    })
    .filter((transition): transition is InterpretantTransition => transition !== undefined);
}
