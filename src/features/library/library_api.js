import {
  createDemoDossierAssertionsResponse,
  createDemoDossierSignalWindowsResponse,
  createDemoDossierSyncResponse,
  appendDemoImportJob,
  clearDemoSession,
  createDemoMarketAnalysisResponse,
  createDemoPharmaCycleResponse,
  createDemoPharmaEventsResponse,
  createDemoPharmaHomologationsResponse,
  createDemoPharmaLeaderboardResponse,
  createDemoPharmaSyncResponse,
  createDemoQueryResponse,
  createDemoResearchResponse,
  demoDocuments,
  demoNotes,
  demoResearchMaps,
  demoSystemStatus,
  demoSavedQueries,
  demoWatchFolders,
  getDemoImportJobs,
  getDemoSession,
  resetDemoImportJobs,
  setDemoSession,
} from "./library-demo-data";

async function parseJsonResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  const text = await response.text();
  return text ? { message: text } : {};
}

async function request(pathname, options = {}) {
  const response = await fetch(pathname, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    const detail = payload?.detail;
    const message = typeof detail === "string"
      ? detail
      : detail?.message || payload?.error || payload?.message || "Request failed.";
    const error = new Error(message);
    error.status = response.status;
    error.code = typeof detail === "object" && detail ? detail.code : payload?.code;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function localRequest(pathname, options = {}) {
  try {
    const response = await fetch(pathname, {
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      ...options,
    });
    const payload = await parseJsonResponse(response);
    if (!response.ok) {
      const error = new Error(payload?.error || payload?.message || "Local request failed.");
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  } catch (error) {
    if (error?.status) throw error;
    const localError = new Error(
      pathname.startsWith("/__library/")
        ? "Local backend controls are unavailable. Restart the Vite dev server and reload /library."
        : (error instanceof Error ? error.message : "Local request failed.")
    );
    localError.cause = error;
    throw localError;
  }
}

function isExplicitDemoMode() {
  return Boolean(getDemoSession()?.mode === "demo");
}

async function withDemoFallback(action) {
  if (isExplicitDemoMode()) {
    return { __demo: true };
  }
  try {
    return await action();
  } catch (error) {
    if (error?.status && error.status < 500 && error.status !== 404) {
      throw error;
    }
    return { __demo: true };
  }
}

const DEMO_PIPELINE_STAGES = ["discover", "extract", "math_extract", "ocr", "structure", "chunk", "summarize", "embed", "index", "research_materialize", "complete"];

export async function getSession() {
  try {
    const result = await withDemoFallback(() => request("/api/auth/session"));
    if (result.__demo) return getDemoSession();
    return result;
  } catch (error) {
    if (error?.status === 401) return null;
    throw error;
  }
}

export async function registerAccount({ username, password, displayName }) {
  const result = await withDemoFallback(() =>
    request("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password, display_name: displayName }),
    })
  );
  if (result.__demo) return setDemoSession(username);
  return result;
}

export async function loginAccount({ username, password }) {
  const result = await withDemoFallback(() =>
    request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    })
  );
  if (result.__demo) return setDemoSession(username);
  return result;
}

export async function logoutAccount() {
  const result = await withDemoFallback(() =>
    request("/api/auth/logout", {
      method: "POST",
      body: JSON.stringify({}),
    })
  );
  clearDemoSession();
  return result.__demo ? { ok: true } : result;
}

export function clearLocalDemoSession() {
  clearDemoSession();
}

export function enterDemoMode(username = "librarian") {
  return setDemoSession(username);
}

export function getLocalDemoSession() {
  return getDemoSession();
}

export async function fetchBackendBootStatus() {
  return localRequest("/__library/backend/status");
}

export async function launchTextualInterface({ restartBackend = false } = {}) {
  return localRequest("/__library/pipeline-console/start", {
    method: "POST",
    body: JSON.stringify({ restart_backend: restartBackend }),
  });
}

export async function fetchBackendLogs({ target = "api", lines = 120 } = {}) {
  const params = new URLSearchParams({
    target,
    lines: String(lines),
  });
  return localRequest(`/__library/backend/logs?${params.toString()}`);
}

export function subscribeBackendEvents(onEvent, onError) {
  const source = new EventSource("/__library/backend/events");

  source.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data || "{}");
      onEvent?.(payload);
    } catch (error) {
      onError?.(error);
    }
  };

  source.onerror = (error) => {
    onError?.(error);
  };

  return () => {
    source.close();
  };
}

export async function fetchDocuments() {
  const result = await withDemoFallback(() => request("/api/documents"));
  return result.__demo ? { items: demoDocuments, demo: true } : result;
}

export async function fetchSystemStatus() {
  const result = await withDemoFallback(() => request("/api/system/status"));
  return result.__demo ? { ...demoSystemStatus, demo: true } : result;
}

export async function fetchImportJobs() {
  const result = await withDemoFallback(() => request("/api/import-jobs"));
  return result.__demo ? { items: getDemoImportJobs(), demo: true } : result;
}

export async function createImportJob({ sourcePath, recursive = true }) {
  const result = await withDemoFallback(() =>
    request("/api/import-jobs", {
      method: "POST",
      body: JSON.stringify({
        source_path: sourcePath,
        kind: "manual_import",
        options: { recursive },
      }),
    })
  );
  if (result.__demo) {
    const jobId = `job-${Date.now()}`;
    const now = new Date().toISOString();
    return appendDemoImportJob({
      id: jobId,
      kind: "manual_import",
      source_path: sourcePath,
      status: "queued",
      options: { recursive },
      current_stage: "discover",
      progress_completed: 0,
      progress_total: DEMO_PIPELINE_STAGES.length,
      stage_warnings: [],
      error_code: null,
      created_at: now,
      updated_at: now,
      document_count: 0,
      file_counts: { discovered: 0, processed: 0, succeeded: 0, failed: 0, deferred_to_ocr: 0 },
      warnings: ["Queued in demo mode; backend job runner is offline."],
      tasks: DEMO_PIPELINE_STAGES.map((stage) => ({
        id: `${jobId}-${stage}`,
        stage,
        status: "queued",
        progress_completed: 0,
        progress_total: 0,
        warnings: [],
        error_code: null,
        payload: stage === "extract"
          ? { processed: 0, succeeded: 0, failed: 0, deferred_to_ocr: 0, sample_failures: [] }
          : {},
      })),
    });
  }
  return result;
}

export async function resetImportJobs() {
  const result = await withDemoFallback(() =>
    request("/api/import-jobs", {
      method: "DELETE",
      body: JSON.stringify({}),
    })
  );
  if (result.__demo) {
    resetDemoImportJobs();
    return { ok: true, deleted_jobs: 0, deleted_tasks: 0, demo: true };
  }
  return result;
}

export async function startBackendServices() {
  try {
    return await localRequest("/__library/backend/start", {
      method: "POST",
      body: JSON.stringify({}),
    });
  } catch (error) {
    if (error?.status && error.status !== 404) {
      throw error;
    }
    return localRequest("/__library/start-backend", {
      method: "POST",
      body: JSON.stringify({}),
    });
  }
}

export async function fetchWatchFolders() {
  const result = await withDemoFallback(() => request("/api/watch-folders"));
  return result.__demo ? { items: demoWatchFolders, demo: true } : result;
}

export async function createWatchFolder({ path, recursive = true }) {
  const result = await withDemoFallback(() =>
    request("/api/watch-folders", {
      method: "POST",
      body: JSON.stringify({ path, recursive }),
    })
  );
  if (result.__demo) {
    return {
      id: `watch-${Date.now()}`,
      path,
      recursive,
      enabled: true,
      created_at: new Date().toISOString(),
      last_scanned_at: null,
    };
  }
  return result;
}

export async function runLibraryQuery({ query, scope = {} }) {
  const result = await withDemoFallback(() =>
    request("/api/query", {
      method: "POST",
      body: JSON.stringify({ query, scope }),
    })
  );
  return result.__demo ? createDemoQueryResponse(query) : result;
}

export async function runResearchQuery({ query, preferredLens, scope = {} }) {
  const result = await withDemoFallback(() =>
    request("/api/research/query", {
      method: "POST",
      body: JSON.stringify({ query, preferred_lens: preferredLens, scope }),
    })
  );
  return result.__demo ? createDemoResearchResponse(query) : result;
}

function createDemoLawvereCollectionResponse() {
  return {
    version: "demo.lawvere-collection.v1",
    source_kind: "lawvere_collection",
    source_ref: "demo:lawvere-collection",
    reviewed: true,
    collection_label: "Lawvere Collection",
    import_path: "G:/Other computers/My Laptop/THE AUGUSTE LAURENT SOCIETY/Mathematics PhD/Lawvere Collection",
    collection_stats: {
      file_count: 118,
      canonical_document_count: 92,
      duplicate_variant_count: 26,
      imported_document_count: 0,
    },
    canonical_documents: [
      { id: "lawvere.doc.demo.functorial", title: "1963 Functorial Semantics of Algebraic Theories", year: 1963, era: "foundational-1961-1969", themes: ["functorial_semantics", "foundations"], imported: false, duplicate_count: 0, source_path: "demo://lawvere/functorial-semantics.pdf" },
      { id: "lawvere.doc.demo.etcs", title: "1964 An Elementary Theory of the Category of Sets", year: 1964, era: "foundational-1961-1969", themes: ["etcs", "foundations"], imported: false, duplicate_count: 0, source_path: "demo://lawvere/etcs.pdf" },
      { id: "lawvere.doc.demo.adjointness", title: "1969 Adjointness in Foundations", year: 1969, era: "foundational-1961-1969", themes: ["adjointness", "hyperdoctrines"], imported: false, duplicate_count: 0, source_path: "demo://lawvere/adjointness.pdf" },
      { id: "lawvere.doc.demo.toposes", title: "1971 Introduction to Toposes, Algebraic Geometry and Logic", year: 1971, era: "toposes-1970-1979", themes: ["toposes_sheaves"], imported: false, duplicate_count: 0, source_path: "demo://lawvere/toposes.pdf" },
    ],
    chronology: [
      { id: "foundational-1961-1969", label: "1961-1969 Foundations and functorial semantics", count: 16, highlights: [] },
      { id: "toposes-1970-1979", label: "1970-1979 Toposes, sheaves, and generalized logic", count: 15, highlights: [] },
      { id: "continuum-1980-1989", label: "1980-1989 Continuum physics, dynamics, and graphic toposes", count: 18, highlights: [] },
    ],
    theme_clusters: [
      { id: "functorial_semantics", label: "Functorial semantics", summary: "Models and algebraic theories.", count: 12, highlights: [] },
      { id: "adjointness", label: "Adjointness", summary: "Adjoints across logic and structure.", count: 9, highlights: [] },
      { id: "toposes_sheaves", label: "Toposes and sheaves", summary: "Toposes, sheaves, and variable sets.", count: 14, highlights: [] },
      { id: "cohesion_space", label: "Cohesion and space", summary: "Cohesive toposes and categories of space.", count: 11, highlights: [] },
    ],
    formalization_candidates: [
      { id: "candidate.algebraic_theories", label: "Algebraic theories and functorial semantics", concept_family: "algebraic_theories", module: "Lawvere concepts", review_required: true, handoff_target: "library", target_systems: ["library"], prompt_seed: "Extract typed categorical interfaces for algebraic theories and functorial semantics into reviewed library-facing prompts.", source_family_ids: ["algebraic_theories"], source_document_ids: ["lawvere.doc.demo.functorial"] },
      { id: "candidate.toposes", label: "Toposes, sheaves, and variable sets", concept_family: "toposes", module: "Site information architecture", review_required: true, handoff_target: "library", target_systems: ["library"], prompt_seed: "Use reviewed topos and sheaf material to shape site interfaces without bypassing review.", source_family_ids: ["toposes"], source_document_ids: ["lawvere.doc.demo.toposes"] },
    ],
    website_design_intents: [
      { id: "intent.lawvere.global-mode", summary: "Keep a Lawvere-aware global prompt mode across the site.", review_required: true, handoff_target: "library", prompt_seed: "Keep Lawvere-aware retrieval and topos cues available globally while preserving human review gates.", source_family_ids: ["functorial_semantics", "toposes"], module: "Cognitive invariant architecture", target_systems: ["library", "site"], source_document_ids: ["lawvere.doc.demo.functorial", "lawvere.doc.demo.toposes"] },
    ],
    prompt_presets: [
      "Trace the evolution from functorial semantics to hyperdoctrines and explain the bridge in plain language.",
      "Show how Lawvere's adjointness and topos work should change the website's information architecture.",
    ],
    research_map_seed: {
      title: "Demo Lawvere Collection Spine",
      description: "Demo-only Lawvere materialization.",
      pins: [],
    },
    demo: true,
  };
}

function createDemoCognitiveInvariantsResponse() {
  return {
    version: "demo.cognitive-invariants.v1",
    source_kind: "cognitive_invariants_collection",
    source_ref: "demo:cognitive-invariants",
    reviewed: true,
    collection_label: "Cognitive Invariants Collection",
    import_path: "G:/Other computers/My Laptop/THE AUGUSTE LAURENT SOCIETY",
    source_families: [
      { id: "autopoiesis_agency", label: "Autopoiesis and agency", summary: "Operational closure, self-production, autonomy, and organizational identity." },
      { id: "biosemiotics", label: "Biosemiotics", summary: "Meaning, agency, and interpretation across living systems." },
      { id: "arbitrary_spaces", label: "Arbitrary spaces and competency", summary: "Competency across changing task spaces, morphospaces, and representational regimes." },
      { id: "erlangen_invariants", label: "Erlangen invariants", summary: "Transformation groups and invariant structure." },
      { id: "hegelian_support", label: "Hegelian and Newtonian support", summary: "Secondary support on motion and law-governed transformation." },
    ],
    collection_stats: {
      file_count: 10,
      canonical_document_count: 10,
      duplicate_variant_count: 0,
      imported_document_count: 0,
      existing_source_count: 10,
    },
    canonical_documents: [
      { id: "cognitive.doc.maturana_varela.autopoiesis", title: "Autopoiesis and Cognition: The Realization of the Living", year: 1980, era: "autopoiesis-1980-1993", themes: ["operational_closure", "agency_semiosis"], source_family_ids: ["autopoiesis_agency"], imported: false, source_path: "demo://cognitive/autopoiesis-and-cognition.pdf" },
      { id: "cognitive.doc.sharov.mind_agency_biosemiotics", title: "Mind, Agency, and Biosemiotics", year: 2010, era: "biosemiotics-1994-2012", themes: ["agency_semiosis", "operational_closure"], source_family_ids: ["biosemiotics", "autopoiesis_agency"], imported: false, source_path: "demo://cognitive/sharov-mind-agency-biosemiotics.pdf" },
      { id: "cognitive.doc.kisil.erlangen_programme_at_large", title: "Erlangen Programme at Large: An Overview", year: 2012, era: "biosemiotics-1994-2012", themes: ["erlangen_transformations", "competency_spaces"], source_family_ids: ["erlangen_invariants"], imported: false, source_path: "demo://cognitive/erlangen-at-large.pdf" },
      { id: "cognitive.doc.hegel.newtonianism", title: "Hegel and Newtonianism", year: 1993, era: "autopoiesis-1980-1993", themes: ["hegelian_dynamics", "erlangen_transformations"], source_family_ids: ["hegelian_support"], imported: false, source_path: "demo://cognitive/hegel-and-newtonianism.pdf" },
    ],
    chronology: [
      { id: "autopoiesis-1980-1993", label: "1980-1993 Autopoiesis, cognition, and early support texts", count: 2, highlights: [] },
      { id: "biosemiotics-1994-2012", label: "1994-2012 Agency, biosemiotics, and constructive system views", count: 4, highlights: [] },
      { id: "invariants-2013-2026", label: "2013-2026 Arbitrary spaces, competency, and invariant cognition", count: 4, highlights: [] },
    ],
    theme_clusters: [
      { id: "operational_closure", label: "Operational closure", summary: "Closure, self-production, and autonomous organization.", count: 4, highlights: [] },
      { id: "agency_semiosis", label: "Agency and semiosis", summary: "Agency, interpretation, purposiveness, and biosemiotic framing.", count: 3, highlights: [] },
      { id: "competency_spaces", label: "Competency in arbitrary spaces", summary: "Competency as the invariant across embodiments and task-space changes.", count: 3, highlights: [] },
      { id: "erlangen_transformations", label: "Erlangen transformations", summary: "Transformation groups and invariants under admissible changes of representation.", count: 4, highlights: [] },
      { id: "graphic_display_bridge", label: "Graphic display bridge", summary: "Bridges from invariants and agency to Lawvere-style graphics and display structure.", count: 2, highlights: [] },
      { id: "hegelian_dynamics", label: "Hegelian dynamics support", summary: "Secondary support around motion, laws, and reflective organization.", count: 1, highlights: [] },
    ],
    formalization_candidates: [
      { id: "candidate.autopoiesis_agency_hooks", label: "Autopoiesis and agency hooks", concept_family: "autopoiesis_agency", module: "Autopoiesis agency hooks", review_required: true, handoff_target: "hungry_topos", target_systems: ["hungry_topos"], prompt_seed: "Connect operational closure, autonomy, and biosemiotic agency to reviewed local adaptation hooks without enabling autonomous mutation.", source_family_ids: ["autopoiesis_agency", "biosemiotics"], source_document_ids: ["cognitive.doc.maturana_varela.autopoiesis", "cognitive.doc.sharov.mind_agency_biosemiotics"] },
      { id: "candidate.invariant_cognition_hooks", label: "Invariant cognition hooks", concept_family: "invariant_cognition", module: "Invariant cognition hooks", review_required: true, handoff_target: "site", target_systems: ["site"], prompt_seed: "Treat competency as an invariant across embodiment changes and expose reviewed representation-change hooks to the website substrate.", source_family_ids: ["arbitrary_spaces", "erlangen_invariants"], source_document_ids: ["cognitive.doc.kisil.erlangen_programme_at_large"] },
      { id: "candidate.lawvere_graphic_agency_hooks", label: "Lawvere graphic-agency bridge", concept_family: "graphic_display_bridge", module: "Lawvere graphic agency hooks", review_required: true, handoff_target: "site", target_systems: ["site"], prompt_seed: "Use invariant cognition and Hegelian support as reviewed scaffolding for Lawvere-style display and graphics interfaces.", source_family_ids: ["erlangen_invariants", "hegelian_support"], source_document_ids: ["cognitive.doc.kisil.erlangen_programme_at_large", "cognitive.doc.hegel.newtonianism"] },
      { id: "candidate.cognitive_invariant_topos", label: "Cognitive invariant topos registry", concept_family: "cognitive_invariant_topos", module: "Cognitive invariant topos", review_required: true, handoff_target: "library", target_systems: ["library"], prompt_seed: "Assemble a reviewed registry that routes cognitive invariants into library and site surfaces with explicit human review gates.", source_family_ids: ["autopoiesis_agency", "biosemiotics", "arbitrary_spaces", "erlangen_invariants", "hegelian_support"], source_document_ids: ["cognitive.doc.maturana_varela.autopoiesis", "cognitive.doc.kisil.erlangen_programme_at_large", "cognitive.doc.hegel.newtonianism"] },
    ],
    website_design_intents: [
      { id: "intent.cognitive.autopoiesis.hungry-topos", summary: "Expose autopoiesis and agency prompts as reviewed hungry_topos handoffs, not self-applying mutations.", review_required: true, handoff_target: "hungry_topos", target_systems: ["hungry_topos"], prompt_seed: "Use reviewed autopoiesis and agency anchors to propose local site adaptations while preserving explicit operator review.", source_family_ids: ["autopoiesis_agency", "biosemiotics"], module: "Autopoiesis agency hooks", source_document_ids: ["cognitive.doc.maturana_varela.autopoiesis", "cognitive.doc.sharov.mind_agency_biosemiotics"] },
      { id: "intent.cognitive.site.invariants", summary: "Route invariant cognition and graphic-display prompts into reviewed design intents.", review_required: true, handoff_target: "site", target_systems: ["site", "library"], prompt_seed: "Frame website changes as invariant-preserving transformations across representations and embodiments, with review gates left intact.", source_family_ids: ["arbitrary_spaces", "erlangen_invariants", "hegelian_support"], module: "Cognitive invariant architecture", source_document_ids: ["cognitive.doc.kisil.erlangen_programme_at_large", "cognitive.doc.hegel.newtonianism"] },
    ],
    prompt_presets: [
      "Explain autopoiesis, agency, and biosemiotics as reviewed hooks for site adaptation without collapsing review boundaries.",
      "Show how competency across arbitrary spaces can be modeled as invariants under representation changes.",
      "Bridge Erlangen-style invariants and Lawvere-style display structure into reviewed site design intents.",
    ],
    research_map_seed: {
      title: "Demo Cognitive Invariants Spine",
      description: "Demo-only cognitive-invariants materialization.",
      pins: [],
    },
    demo: true,
  };
}

export async function fetchLawvereCollection() {
  const result = await withDemoFallback(() => request("/api/research/lawvere"));
  return result.__demo ? createDemoLawvereCollectionResponse() : result;
}

export async function fetchLawvereFormalizationCandidates() {
  const result = await withDemoFallback(() => request("/api/research/lawvere/formalization-candidates"));
  return result.__demo ? { items: createDemoLawvereCollectionResponse().formalization_candidates, source_kind: "lawvere_collection", source_ref: "demo:lawvere-collection", demo: true } : result;
}

export async function materializeLawvereMap(payload = {}) {
  const result = await withDemoFallback(() =>
    request("/api/research/maps/from-lawvere", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  );
  if (result.__demo) {
    return {
      map: {
        id: `map-${Date.now()}`,
        title: payload.title || "Demo Lawvere Collection Spine",
        description: payload.description || "Demo-only Lawvere collection materialization.",
        source_kind: "lawvere_collection",
        source_ref: "demo:lawvere-collection",
        layout: {},
        pin_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      pins_created: 0,
      source_kind: "lawvere_collection",
      source_ref: "demo:lawvere-collection",
      demo: true,
    };
  }
  return result;
}

export async function fetchCognitiveInvariantsCollection() {
  const result = await withDemoFallback(() => request("/api/research/cognitive-invariants"));
  return result.__demo ? createDemoCognitiveInvariantsResponse() : result;
}

export async function fetchCognitiveInvariantsFormalizationCandidates() {
  const result = await withDemoFallback(() => request("/api/research/cognitive-invariants/formalization-candidates"));
  return result.__demo
    ? {
      items: createDemoCognitiveInvariantsResponse().formalization_candidates,
      source_kind: "cognitive_invariants_collection",
      source_ref: "demo:cognitive-invariants",
      demo: true,
    }
    : result;
}

export async function materializeCognitiveInvariantsMap(payload = {}) {
  const result = await withDemoFallback(() =>
    request("/api/research/maps/from-cognitive-invariants", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  );
  if (result.__demo) {
    return {
      map: {
        id: `map-${Date.now()}`,
        title: payload.title || "Demo Cognitive Invariants Spine",
        description: payload.description || "Demo-only cognitive-invariants materialization.",
        source_kind: "cognitive_invariants_collection",
        source_ref: "demo:cognitive-invariants",
        layout: {},
        pin_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      pins_created: 0,
      source_kind: "cognitive_invariants_collection",
      source_ref: "demo:cognitive-invariants",
      demo: true,
    };
  }
  return result;
}

export async function runMarketAnalysis(payload) {
  const result = await withDemoFallback(() =>
    request("/api/market/analysis", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  );
  if (result.__demo) {
    return createDemoMarketAnalysisResponse({
      symbols: payload?.symbols,
      benchmarkSymbol: payload?.benchmark_symbol,
      period: payload?.period,
      interval: payload?.interval,
      mode: payload?.mode,
      maxExpiries: payload?.max_expiries,
      maxStrikesPerExpiry: payload?.max_strikes_per_expiry,
      rollingWindow: payload?.rolling_window,
      kNeighbors: payload?.k_neighbors,
      riskFreeRate: payload?.risk_free_rate,
    });
  }
  return result;
}

export async function syncPharmaEvents(payload) {
  const result = await withDemoFallback(() =>
    request("/api/market/pharma/sync", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  );
  return result.__demo ? createDemoPharmaSyncResponse(payload) : result;
}

export async function syncDossiers(payload = {}) {
  const result = await withDemoFallback(() =>
    request("/api/market/dossiers/sync", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  );
  return result.__demo ? createDemoDossierSyncResponse() : result;
}

export async function fetchDossierAssertions({ limit = 100, datedOnly = false } = {}) {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  if (datedOnly) params.set("dated_only", "true");
  const result = await withDemoFallback(() => request(`/api/market/dossiers/assertions?${params.toString()}`));
  return result.__demo ? createDemoDossierAssertionsResponse({ datedOnly }) : result;
}

export async function fetchDossierSignalWindows({ limit = 500 } = {}) {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  const result = await withDemoFallback(() => request(`/api/market/dossiers/windows?${params.toString()}`));
  return result.__demo ? createDemoDossierSignalWindowsResponse() : result;
}

export async function fetchPharmaEvents({ symbols = [], limit = 100 } = {}) {
  const params = new URLSearchParams();
  if (symbols?.length) params.set("symbols", symbols.join(","));
  params.set("limit", String(limit));
  const result = await withDemoFallback(() => request(`/api/market/pharma/events?${params.toString()}`));
  return result.__demo ? createDemoPharmaEventsResponse({ symbols }) : result;
}

export async function runPharmaCycle(payload) {
  const result = await withDemoFallback(() =>
    request("/api/market/pharma/cycles", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  );
  return result.__demo ? createDemoPharmaCycleResponse() : result;
}

export async function fetchPharmaCycles() {
  const result = await withDemoFallback(() => request("/api/market/pharma/cycles"));
  return result.__demo ? { items: [createDemoPharmaCycleResponse().cycle], demo: true } : result;
}

export async function fetchPharmaLeaderboard() {
  const result = await withDemoFallback(() => request("/api/market/pharma/leaderboard"));
  return result.__demo ? createDemoPharmaLeaderboardResponse() : result;
}

export async function fetchPharmaHomologations() {
  const result = await withDemoFallback(() => request("/api/market/pharma/homologations"));
  return result.__demo ? createDemoPharmaHomologationsResponse() : result;
}

export async function fetchResearchBundle(bundleId) {
  const result = await withDemoFallback(() => request(`/api/research/bundles/${bundleId}`));
  return result.__demo ? createDemoResearchResponse("Compare continuity across the library.") : result;
}

export async function fetchResearchMaps() {
  const result = await withDemoFallback(() => request("/api/research/maps"));
  return result.__demo ? { items: demoResearchMaps, demo: true } : result;
}

export async function createResearchMap(payload) {
  const result = await withDemoFallback(() =>
    request("/api/research/maps", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  );
  if (result.__demo) {
    return {
      id: `map-${Date.now()}`,
      pin_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...payload,
    };
  }
  return result;
}

export async function pinResearchEntity(mapId, payload) {
  const result = await withDemoFallback(() =>
    request(`/api/research/maps/${mapId}/pins`, {
      method: "POST",
      body: JSON.stringify(payload),
    })
  );
  if (result.__demo) {
    return {
      id: `pin-${Date.now()}`,
      map_id: mapId,
      created_at: new Date().toISOString(),
      ...payload,
    };
  }
  return result;
}

export async function fetchResearchEntity(entityId) {
  const result = await withDemoFallback(() => request(`/api/research/entities/${entityId}`));
  if (result.__demo) {
    const bundle = createDemoResearchResponse("Compare continuity across the library.");
    return bundle.entities.find((entity) => entity.id === entityId) || null;
  }
  return result;
}

export async function fetchSavedQueries() {
  const result = await withDemoFallback(() => request("/api/saved-queries"));
  return result.__demo ? { items: demoSavedQueries, demo: true } : result;
}

export async function saveQuery(payload) {
  const result = await withDemoFallback(() =>
    request("/api/saved-queries", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  );
  if (result.__demo) {
    return {
      id: `saved-${Date.now()}`,
      created_at: new Date().toISOString(),
      ...payload,
    };
  }
  return result;
}

export async function fetchNotes() {
  const result = await withDemoFallback(() => request("/api/notes"));
  return result.__demo ? { items: demoNotes, demo: true } : result;
}

export async function createNote(payload) {
  const result = await withDemoFallback(() =>
    request("/api/notes", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  );
  if (result.__demo) {
    return {
      id: `note-${Date.now()}`,
      created_at: new Date().toISOString(),
      ...payload,
    };
  }
  return result;
}
