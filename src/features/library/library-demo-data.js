const DEMO_SESSION_STORAGE_KEY = "semantic-library-demo-session";
const DEMO_IMPORT_JOBS_STORAGE_KEY = "semantic-library-demo-import-jobs";
const NOW = "2026-03-15T14:15:00Z";

const demoUser = {
  id: "demo-user",
  username: "librarian",
  display_name: "Local Librarian",
  role: "admin",
  created_at: NOW,
};

export const demoDocuments = [
  {
    id: "doc-euclid",
    title: "The Elements, Book I",
    source_path: "C:/Library/Euclid/elements-book-1.html",
    file_type: "html",
    language: "en",
    status: "indexed",
    summary: "Foundational geometry definitions, common notions, and propositions used as a baseline for structural comparison.",
    page_count: 48,
    node_count: 64,
    metadata: { author: "Euclid", year: -300, edition_year: -300, formalism: "geometry", translation: false },
    updated_at: NOW,
  },
  {
    id: "doc-peirce",
    title: "Collected Papers on Continuity",
    source_path: "C:/Library/Peirce/continuity-notes.docx",
    file_type: "docx",
    language: "en",
    status: "indexed",
    summary: "Notes on continuity, generality, and formal relations with repeated emphasis on diagrammatic reasoning.",
    page_count: 22,
    node_count: 41,
    metadata: { author: "Charles Sanders Peirce", year: 1895, edition_year: 1895, formalism: "semiotics", translation: false },
    updated_at: NOW,
  },
  {
    id: "doc-thom",
    title: "Structural Morphogenesis Fragments",
    source_path: "C:/Library/Thom/morphogenesis.pdf",
    file_type: "pdf",
    language: "fr",
    status: "indexed",
    summary: "An OCR-heavy scan focused on catastrophe theory, structure, and qualitative transitions across systems.",
    page_count: 188,
    node_count: 219,
    metadata: { author: "Rene Thom", year: 1972, edition_year: 1972, formalism: "catastrophe theory", translation: true },
    updated_at: NOW,
  },
];

export const demoImportJobs = [
  {
    id: "job-1",
    kind: "manual_import",
    source_path: "C:/Library/Euclid",
    status: "completed",
    options: { recursive: true },
    current_stage: "complete",
    progress_completed: 10,
    progress_total: 10,
    stage_warnings: [],
    error_code: null,
    created_at: "2026-03-14T18:30:00Z",
    updated_at: NOW,
    document_count: 1,
    file_counts: { discovered: 1, processed: 1, succeeded: 1, failed: 0, deferred_to_ocr: 0 },
    warnings: [],
    tasks: [
      { id: "job-1-discover", stage: "discover", status: "completed", progress_completed: 1, progress_total: 1, warnings: [], error_code: null, payload: { discovered: 1 } },
      { id: "job-1-extract", stage: "extract", status: "completed", progress_completed: 1, progress_total: 1, warnings: [], error_code: null, payload: { processed: 1, succeeded: 1, failed: 0, deferred_to_ocr: 0, sample_failures: [] } },
      { id: "job-1-ocr", stage: "ocr", status: "completed", progress_completed: 1, progress_total: 1, warnings: [], error_code: null, payload: {} },
      { id: "job-1-structure", stage: "structure", status: "completed", progress_completed: 1, progress_total: 1, warnings: [], error_code: null, payload: {} },
      { id: "job-1-chunk", stage: "chunk", status: "completed", progress_completed: 1, progress_total: 1, warnings: [], error_code: null, payload: {} },
      { id: "job-1-summarize", stage: "summarize", status: "completed", progress_completed: 1, progress_total: 1, warnings: [], error_code: null, payload: {} },
      { id: "job-1-embed", stage: "embed", status: "completed", progress_completed: 12, progress_total: 12, warnings: [], error_code: null, payload: {} },
      { id: "job-1-index", stage: "index", status: "completed", progress_completed: 1, progress_total: 1, warnings: [], error_code: null, payload: {} },
      { id: "job-1-research", stage: "research_materialize", status: "completed", progress_completed: 1, progress_total: 1, warnings: [], error_code: null, payload: {} },
      { id: "job-1-complete", stage: "complete", status: "completed", progress_completed: 1, progress_total: 1, warnings: [], error_code: null, payload: {} },
    ],
  },
  {
    id: "job-2",
    kind: "manual_import",
    source_path: "C:/Library/Thom/morphogenesis.pdf",
    status: "running",
    options: { recursive: false },
    current_stage: "ocr",
    progress_completed: 3,
    progress_total: 10,
    stage_warnings: ["OCR fallback engaged on 137 pages."],
    error_code: null,
    created_at: "2026-03-15T13:41:00Z",
    updated_at: NOW,
    document_count: 1,
    file_counts: { discovered: 1, processed: 1, succeeded: 0, failed: 0, deferred_to_ocr: 1 },
    warnings: ["OCR fallback engaged on 137 pages."],
    tasks: [
      { id: "job-2-discover", stage: "discover", status: "completed", progress_completed: 1, progress_total: 1, warnings: [], error_code: null, payload: { discovered: 1 } },
      { id: "job-2-extract", stage: "extract", status: "completed", progress_completed: 1, progress_total: 1, warnings: ["morphogenesis.pdf: deferred to OCR because native extraction requires cryptography."], error_code: null, payload: { processed: 1, succeeded: 0, failed: 0, deferred_to_ocr: 1, sample_failures: [] } },
      { id: "job-2-ocr", stage: "ocr", status: "running", progress_completed: 137, progress_total: 188, warnings: ["Rendered-page OCR is active."], error_code: null, payload: {} },
      { id: "job-2-structure", stage: "structure", status: "queued", progress_completed: 0, progress_total: 0, warnings: [], error_code: null, payload: {} },
      { id: "job-2-chunk", stage: "chunk", status: "queued", progress_completed: 0, progress_total: 0, warnings: [], error_code: null, payload: {} },
      { id: "job-2-summarize", stage: "summarize", status: "queued", progress_completed: 0, progress_total: 0, warnings: [], error_code: null, payload: {} },
      { id: "job-2-embed", stage: "embed", status: "queued", progress_completed: 0, progress_total: 0, warnings: [], error_code: null, payload: {} },
      { id: "job-2-index", stage: "index", status: "queued", progress_completed: 0, progress_total: 0, warnings: [], error_code: null, payload: {} },
      { id: "job-2-research", stage: "research_materialize", status: "queued", progress_completed: 0, progress_total: 0, warnings: [], error_code: null, payload: {} },
      { id: "job-2-complete", stage: "complete", status: "queued", progress_completed: 0, progress_total: 0, warnings: [], error_code: null, payload: {} },
    ],
  },
];

function getStoredDemoImportJobs() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DEMO_IMPORT_JOBS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function persistDemoImportJobs(jobs) {
  if (typeof window === "undefined") return jobs;
  window.localStorage.setItem(DEMO_IMPORT_JOBS_STORAGE_KEY, JSON.stringify(jobs));
  return jobs;
}

export function getDemoImportJobs() {
  const stored = getStoredDemoImportJobs();
  if (stored) return stored;
  return demoImportJobs;
}

export function appendDemoImportJob(job) {
  const currentJobs = getStoredDemoImportJobs() || demoImportJobs;
  const nextJobs = [job, ...currentJobs];
  persistDemoImportJobs(nextJobs);
  return job;
}

export function resetDemoImportJobs() {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(DEMO_IMPORT_JOBS_STORAGE_KEY);
  }
  return [];
}

export const demoWatchFolders = [
  {
    id: "watch-1",
    path: "C:/Library",
    enabled: true,
    recursive: true,
    created_at: "2026-03-10T09:00:00Z",
    updated_at: NOW,
    last_scanned_at: NOW,
  },
];

export const demoSavedQueries = [
  {
    id: "saved-1",
    title: "Continuity across Euclid and Peirce",
    query_text: "Compare how continuity is framed in Euclid and Peirce.",
    created_at: "2026-03-15T12:10:00Z",
    mode: "cross_book",
    research_bundle_id: "bundle-demo",
  },
];

export const demoNotes = [
  {
    id: "note-1",
    title: "Use for synthesis prompts",
    content: "Peirce's vocabulary is closer to logical generality than Euclid's constructive sequence. Ask for terminology shifts explicitly.",
    created_at: "2026-03-15T12:22:00Z",
    document_id: "doc-peirce",
    entity_id: "interp-demo-2",
  },
];

export const demoResearchMaps = [
  {
    id: "map-demo-1",
    title: "Continuity map",
    description: "Pinned triads and gluing failures for continuity.",
    bundle_id: "bundle-demo",
    layout: { lens: "triad" },
    pin_count: 2,
    created_at: NOW,
    updated_at: NOW,
  },
];

export const demoSystemStatus = {
  runtime_mode: "demo",
  dev_fallbacks_enabled: true,
  pipeline_version: "demo",
  qdrant: { ready: false, detail: "Backend offline in demo mode." },
  providers: {
    embedding: { name: "demo", ready: false, fallback: true, detail: "Backend offline." },
    reranker: { name: "demo", ready: false, fallback: true, detail: "Backend offline." },
    reasoner: { name: "demo", ready: false, fallback: true, detail: "Backend offline." },
    ocr: { name: "demo", ready: false, fallback: true, detail: "Backend offline." },
    market_data: { name: "demo_market", ready: false, fallback: true, detail: "Backend offline; market analysis uses a deterministic demo response." },
    pharma_news: {
      name: "demo_pharma_news",
      ready: false,
      fallback: true,
      detail: "Backend offline; pharma event lab uses deterministic demo responses.",
      sources: {
        biopharmcatalyst: { name: "biopharmcatalyst", ready: false, fallback: true, detail: "Demo-only mode." },
        drughunter: { name: "drughunter", ready: false, fallback: false, detail: "WIP: not configured.", wip: true },
      },
    },
    dossier_news: {
      name: "demo_dossier_news",
      ready: false,
      fallback: true,
      detail: "Backend offline; dossier sync uses deterministic attributed-assertion demo responses.",
      sources: {
        coreydigs: { name: "coreydigs", ready: false, fallback: true, detail: "Demo-only indexed dossier corpus." },
        primary_triangulation: { name: "primary_triangulation", ready: false, fallback: true, detail: "Demo-only SEC, court, and government-reference classifier." },
      },
    },
  },
  jobs: { queued: 0, running: 0, completed: 0, failed: 0, pipeline_tasks: 0 },
  watch_folders: { count: demoWatchFolders.length, enabled: demoWatchFolders.filter((item) => item.enabled).length },
  demo: true,
};

function getStoredDemoSession() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DEMO_SESSION_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function getDemoSession() {
  return getStoredDemoSession();
}

export function setDemoSession(username = "librarian") {
  if (typeof window === "undefined") return null;
  const session = {
    user: {
      ...demoUser,
      username,
      display_name: username === "librarian" ? "Local Librarian" : username,
    },
    mode: "demo",
  };
  window.localStorage.setItem(DEMO_SESSION_STORAGE_KEY, JSON.stringify(session));
  return session;
}

export function clearDemoSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(DEMO_SESSION_STORAGE_KEY);
}

function createBaseCitations() {
  return [
    {
      id: "doc-euclid-chunk-3",
      document_id: "doc-euclid",
      document_title: "The Elements, Book I",
      page_start: 3,
      page_end: 4,
      quote: "Definition and construction are treated as the stable frame through which later propositions derive.",
      score: 0.92,
    },
    {
      id: "doc-peirce-chunk-8",
      document_id: "doc-peirce",
      document_title: "Collected Papers on Continuity",
      page_start: 8,
      page_end: 9,
      quote: "Peirce shifts the emphasis from a fixed constructive order to a richer notion of relation and continuity.",
      score: 0.88,
    },
    {
      id: "doc-thom-chunk-11",
      document_id: "doc-thom",
      document_title: "Structural Morphogenesis Fragments",
      page_start: 31,
      page_end: 33,
      quote: "Thom treats transitions as qualitative reorganizations driven by shifts in structural stability.",
      score: 0.81,
    },
  ];
}

export function createDemoResearchResponse(query) {
  const citations = createBaseCitations();
  return {
    id: "bundle-demo",
    mode: query.toLowerCase().includes("compare") ? "cross_book" : "book",
    answer: "Euclid supplies a constructive baseline, Peirce reframes continuity as mediation, and Thom introduces a threshold vocabulary for regime change. The formal workspace exposes those as triads, cross-book functors, gluing checks, simplices, and a time-ordered shift plot.",
    citations,
    evidence_bundle: {
      documents: demoDocuments.map((document) => ({ id: document.id, title: document.title, metadata: document.metadata })),
      nodes: citations.map((citation) => ({
        id: citation.id,
        document_id: citation.document_id,
        title: citation.document_title,
        page_start: citation.page_start,
        page_end: citation.page_end,
        heading_path: "Demo heading",
      })),
      node_ids: citations.map((citation) => citation.id),
      citation_ids: citations.map((citation) => citation.id),
    },
    entities: [
      { id: "obj-continuity", type: "ObjectOfReference", label: "Continuity", document_id: "doc-peirce", node_id: null, parent_id: null, metadata: { frequency: 9 } },
      { id: "obj-structure", type: "ObjectOfReference", label: "Structure", document_id: "doc-thom", node_id: null, parent_id: null, metadata: { frequency: 8 } },
      { id: "sign-euclid-definition", type: "SignToken", label: "Definition", document_id: "doc-euclid", node_id: "doc-euclid-chunk-3", parent_id: "obj-structure", metadata: { page_range: [3, 4] } },
      { id: "sign-peirce-continuity", type: "SignToken", label: "Continuity", document_id: "doc-peirce", node_id: "doc-peirce-chunk-8", parent_id: "obj-continuity", metadata: { page_range: [8, 9] } },
      { id: "interp-demo-1", type: "Interpretant", label: "Constructive baseline", document_id: "doc-euclid", node_id: "doc-euclid-chunk-3", parent_id: null, metadata: { summary: citations[0].quote, depth: 0 } },
      { id: "interp-demo-2", type: "Interpretant", label: "Relational mediation", document_id: "doc-peirce", node_id: "doc-peirce-chunk-8", parent_id: "interp-demo-1", metadata: { summary: citations[1].quote, depth: 1 } },
      { id: "interp-demo-3", type: "Interpretant", label: "Threshold shift", document_id: "doc-thom", node_id: "doc-thom-chunk-11", parent_id: "interp-demo-1", metadata: { summary: citations[2].quote, depth: 1 } },
      { id: "cat-demo-euclid", type: "Category", label: "The Elements, Book I", document_id: "doc-euclid", node_id: null, parent_id: null, metadata: { object_ids: ["geometry", "definition", "construction"] } },
      { id: "cat-demo-peirce", type: "Category", label: "Collected Papers on Continuity", document_id: "doc-peirce", node_id: null, parent_id: null, metadata: { object_ids: ["continuity", "generality", "relation"] } },
      { id: "functor-demo-1", type: "FunctorMapping", label: "Geometry -> Semiotics", document_id: null, node_id: null, parent_id: "cat-demo-euclid", metadata: { pairs: [{ source_object_id: "geometry", target_object_id: "relation" }] } },
      { id: "natural-demo-1", type: "NaturalTransformation", label: "Constructive vs relational", document_id: null, node_id: null, parent_id: "functor-demo-1", metadata: { components: [{ source_object_id: "construction", target_object_id: "generality" }] } },
      { id: "cover-demo-1", type: "Cover", label: "Continuity cover", document_id: "doc-peirce", node_id: "doc-peirce-chunk-8", parent_id: "obj-continuity", metadata: { node_ids: ["doc-peirce-chunk-8", "doc-thom-chunk-11"] } },
      { id: "obstruction-demo-1", type: "Obstruction", label: "Continuity cover", document_id: "doc-thom", node_id: "doc-thom-chunk-11", parent_id: "cover-demo-1", metadata: { average_overlap: 0.14, threshold: 0.2 } },
      { id: "simplex-demo-1", type: "Simplex", label: "2-simplex", document_id: "doc-peirce", node_id: "doc-peirce-chunk-8", parent_id: null, metadata: { dimension: 2, object_ids: ["obj-continuity", "obj-structure"], weight: 0.87 } },
      { id: "catastrophe-demo-1", type: "CatastropheEvent", label: "Cusp transition across retrieved sources", document_id: null, node_id: null, parent_id: null, metadata: { event_type: "cusp" } },
    ],
    relations: [
      { id: "triad-demo-1", type: "Triad", source_id: "sign-euclid-definition", target_id: "interp-demo-1", label: "Structure", evidence_ids: ["doc-euclid-chunk-3"], validation: { status: "grounded" }, metadata: { object_id: "obj-structure" } },
      { id: "triad-demo-2", type: "Triad", source_id: "sign-peirce-continuity", target_id: "interp-demo-2", label: "Continuity", evidence_ids: ["doc-peirce-chunk-8"], validation: { status: "grounded" }, metadata: { object_id: "obj-continuity" } },
      { id: "morphism-demo-1", type: "Morphism", source_id: "interp-demo-1", target_id: "interp-demo-2", label: "Analogy", evidence_ids: ["doc-euclid-chunk-3", "doc-peirce-chunk-8"], validation: { status: "pass" }, metadata: { kind: "analogy" } },
      { id: "restriction-demo-1", type: "RestrictionMap", source_id: "doc-peirce-chunk-8", target_id: "doc-thom-chunk-11", label: "restricts", evidence_ids: [], validation: { status: "seeded" }, metadata: {} },
      { id: "cover-rel-demo-1", type: "Cover", source_id: "obj-continuity", target_id: "cover-demo-1", label: "covered_by", evidence_ids: ["doc-peirce-chunk-8", "doc-thom-chunk-11"], validation: { status: "grounded" }, metadata: {} },
      { id: "obstruction-rel-demo-1", type: "Obstruction", source_id: "cover-demo-1", target_id: "obstruction-demo-1", label: "obstructs", evidence_ids: [], validation: { status: "warning" }, metadata: { average_overlap: 0.14, threshold: 0.2 } },
    ],
    lens_payloads: [
      { key: "triad", title: "Peircean Triad Lens", status: "ready", summary: "Three interpretants and two grounded triads assembled from the evidence bundle.", data: { interpretant_ids: ["interp-demo-1", "interp-demo-2", "interp-demo-3"], triad_ids: ["triad-demo-1", "triad-demo-2"] } },
      { key: "diagram", title: "Grothendieck Diagram Lens", status: "ready", summary: "One functor and one natural transformation align Euclid's constructive order with Peirce's relational vocabulary.", data: { category_ids: ["cat-demo-euclid", "cat-demo-peirce"], functor_ids: ["functor-demo-1"], natural_transformation_ids: ["natural-demo-1"] } },
      { key: "sheaf", title: "Sheaf Lens", status: "ready", summary: "Continuity glues across Euclid and Peirce but fails the threshold against Thom's catastrophe vocabulary.", data: { cover_ids: ["cover-demo-1"], restriction_map_ids: ["restriction-demo-1"], obstruction_ids: ["obstruction-demo-1"] } },
      { key: "simplicial", title: "Simplicial Lens", status: "ready", summary: "One higher-order concept constellation captures continuity, structure, and transition together.", data: { simplices: [{ id: "simplex-demo-1", dimension: 2, weight: 0.87, labels: ["Continuity", "Structure", "Transition"], node_id: "doc-peirce-chunk-8" }] } },
      { key: "catastrophe", title: "Catastrophe Lens", status: "ready", summary: "The time-ordered corpus produces a cusp-style shift from geometry to semiotics to catastrophe theory.", data: { points: [{ document_id: "doc-euclid", title: "Euclid", year: -300, formalism: "geometry", state_score: 0.55 }, { document_id: "doc-peirce", title: "Peirce", year: 1895, formalism: "semiotics", state_score: 0.88 }, { document_id: "doc-thom", title: "Thom", year: 1972, formalism: "catastrophe theory", state_score: 0.66 }], event_ids: ["catastrophe-demo-1"], event_type: "cusp" } },
    ],
    validation: [
      { id: "validation-demo-1", title: "Triad grounding", status: "pass", details: "Interpretants are grounded by sign/object pairs.", entity_ids: ["interp-demo-1", "interp-demo-2"] },
      { id: "validation-demo-2", title: "Functor commutativity", status: "warning", details: "Only one mapped relation preserved under the current correspondence.", entity_ids: ["functor-demo-1"] },
      { id: "validation-demo-3", title: "Gluing check", status: "warning", details: "The Thom section falls below the sheaf threshold and remains an obstruction.", entity_ids: ["obstruction-demo-1"] },
    ],
    warnings: ["backend_unavailable"],
    trace: { retrieved_documents: demoDocuments.map((document) => document.id), retrieved_nodes: citations.map((citation) => citation.id) },
  };
}

export function createDemoQueryResponse(query) {
  const research = createDemoResearchResponse(query);
  return {
    mode: research.mode,
    answer: research.answer,
    citations: research.citations,
    related_documents: demoDocuments.map((document, index) => ({
      id: document.id,
      title: document.title,
      score: Number((0.95 - (index * 0.08)).toFixed(2)),
    })),
    coverage: { status: "demo_mode", summary: "Running from built-in demo data because the backend is unavailable." },
    warnings: ["backend_unavailable"],
    trace: research.trace,
    research_bundle_id: research.id,
  };
}

export function createDemoMarketAnalysisResponse({
  symbols = ["SPY"],
  benchmarkSymbol = "SPY",
  period = "6mo",
  interval = "1d",
  mode = "auto",
  maxExpiries = 2,
  maxStrikesPerExpiry = 7,
  rollingWindow = 20,
  kNeighbors = 4,
  riskFreeRate = 0,
} = {}) {
  const normalizedSymbols = Array.isArray(symbols) && symbols.length ? symbols : ["SPY"];
  const lead = normalizedSymbols[0];
  const companion = normalizedSymbols[1] || benchmarkSymbol || "QQQ";
  const parameterRecord = {
    spotScale: 100,
    strikeScale: 100,
    timeScale: 1,
    volatilityScale: 1,
    deltaScale: 1,
    gammaScale: 1,
    thetaScale: 1,
    vegaScale: 1,
    volumeWeight: 0.1,
    liquidityWeight: 0.1,
    orderFlowWeight: 0.1,
    correlationWeight: 0.1,
    decWeight: 1,
    sl2Weight: 1,
    e8Weight: 1,
    potentialWeight: 1,
    baseDensity: 1,
  };

  function buildGeometry(name, vertexCount, edgeCount, triangleCount, beta0, beta1, partitionFunction, freeEnergy, entropyProxy, circulationScore) {
    return {
      name,
      vertex_count: vertexCount,
      edge_count: edgeCount,
      triangle_count: triangleCount,
      de_rham: {
        beta0,
        beta1,
        harmonic0_dim: beta0,
        harmonic1_dim: beta1,
        euler_characteristic: vertexCount - edgeCount + triangleCount,
        edge_lengths: [0.18, 0.24, 0.31],
        triangle_areas: triangleCount ? [0.03, 0.04] : [],
      },
      kernels: {
        thermal_green: { name: `${name}-thermal`, shape: [vertexCount, vertexCount], trace: { re: partitionFunction / 2, im: 0.12 }, frobenius_norm: 2.4, spectral_radius: 1.8, preview: [[{ re: 0.8, im: 0.1 }]] },
        retarded_green: { name: `${name}-retarded`, shape: [vertexCount, vertexCount], trace: { re: 0.62, im: 0.18 }, frobenius_norm: 2.1, spectral_radius: 1.5, preview: [[{ re: 0.62, im: 0.18 }]] },
        static_green: { name: `${name}-static`, shape: [vertexCount, vertexCount], trace: { re: 1.24, im: 0 }, frobenius_norm: 1.9, spectral_radius: 1.24, preview: [[{ re: 1.24, im: 0 }]] },
        unitary_evolution: { name: `${name}-unitary`, shape: [vertexCount, vertexCount], trace: { re: 0.91, im: -0.07 }, frobenius_norm: 2.0, spectral_radius: 1.0, preview: [[{ re: 0.91, im: -0.07 }]] },
      },
      thermodynamics: {
        inverse_temperature: 1,
        partition_function: partitionFunction,
        free_energy: freeEnergy,
        average_energy: 0.74,
        entropy_proxy: entropyProxy,
        heat_trace: 1.67,
      },
      casimir_euler: {
        casimir_weighted_state_mass: 0.81,
        euler_grade: 0.56,
        koszul_mass_proxy: 0.22,
        cartan_balance_proxy: 0,
      },
      signals: {
        fragmentation: beta0,
        circulation_score: circulationScore,
        divergence_stress: 0.41,
        harmonic_persistence: 0.29,
        liquidity_pressure: 0.53,
        top_vertex_anomalies: [
          { snapshot_id: `${lead}-${name}-0`, symbol: lead, label: `${lead} ${name} anomaly`, score: 1.18 },
          { snapshot_id: `${companion}-${name}-1`, symbol: companion, label: `${companion} ${name} anomaly`, score: 0.94 },
        ],
        top_edge_anomalies: [
          { edge: [0, 1], left: `${lead}-${name}-0`, right: `${companion}-${name}-1`, score: 0.77 },
        ],
        order_flow_split: {
          exact_energy: 0.31,
          coexact_energy: 0.22,
          harmonic_energy: 0.14,
          harmonic_ratio: 0.21,
          divergence_norm: 0.41,
        },
        vol_skew_split: {
          exact_energy: 0.17,
          coexact_energy: 0.11,
          harmonic_energy: 0.09,
          harmonic_ratio: 0.19,
          divergence_norm: 0.28,
        },
      },
      preview: {
        vertices: [
          { snapshot_id: `${lead}-${name}-0`, symbol: lead, label: `${lead} ${name}` },
          { snapshot_id: `${companion}-${name}-1`, symbol: companion, label: `${companion} ${name}` },
        ],
        edges: [[0, 1], [1, 2]].slice(0, Math.max(1, Math.min(2, edgeCount))),
        triangles: triangleCount ? [[0, 1, 2]] : [],
        periodic_edges: name === "options_surface" ? [[0, 2]] : [],
      },
      warnings: name === "cross_symbol" ? ["cross_symbol: demo geometry uses synthetic correlation links."] : [],
    };
  }

  const optionsSurface = buildGeometry("options_surface", 6, 8, 3, 1, 1, 4.18, -1.43, 0.62, 0.37);
  const temporalRegime = buildGeometry("temporal_regime", 7, 9, 2, 1, 0, 5.02, -1.61, 0.71, 0.18);
  const crossSymbol = buildGeometry("cross_symbol", Math.max(2, normalizedSymbols.length), Math.max(1, normalizedSymbols.length - 1), 0, 1, 0, 2.64, -0.97, 0.49, 0.12);

  return {
    provider: {
      name: "demo_market",
      ready: false,
      fallback: true,
      detail: "Backend offline; using deterministic demo market analysis.",
    },
    request: {
      symbols: normalizedSymbols,
      benchmark_symbol: benchmarkSymbol,
      period,
      interval,
      mode,
      max_expiries: maxExpiries,
      max_strikes_per_expiry: maxStrikesPerExpiry,
      rolling_window: rollingWindow,
      k_neighbors: kNeighbors,
      risk_free_rate: riskFreeRate,
      inverse_temperature: 1,
      bloch_phase: Math.PI / 6,
      retarded_eta: 0.15,
    },
    state_mapping: {
      parameter_record: parameterRecord,
      per_symbol_counts: Object.fromEntries(normalizedSymbols.map((symbol, index) => [symbol, { temporal: 5 + index, options: 4 }])),
      mapping: {
        primary_state: ["spot", "strike", "timeToExpiry", "volatility", "delta", "gamma", "theta", "vega"],
        auxiliary_fibers: ["volume", "liquidity", "orderFlow", "correlationContext"],
        options_policy: "options-first with spot/history fallback",
      },
    },
    options_surface: optionsSurface,
    temporal_regime: temporalRegime,
    cross_symbol: crossSymbol,
    thermodynamics: {
      by_geometry: {
        options_surface: optionsSurface.thermodynamics,
        temporal_regime: temporalRegime.thermodynamics,
        cross_symbol: crossSymbol.thermodynamics,
      },
      aggregate: {
        inverse_temperature: 1,
        partition_function: 3.95,
        free_energy: -1.33,
        average_energy: 0.74,
        entropy_proxy: 0.61,
        heat_trace: 1.63,
      },
    },
    casimir_euler: {
      by_geometry: {
        options_surface: optionsSurface.casimir_euler,
        temporal_regime: temporalRegime.casimir_euler,
        cross_symbol: crossSymbol.casimir_euler,
      },
      aggregate: {
        casimir_weighted_state_mass: 0.79,
        euler_grade: 0.54,
        koszul_mass_proxy: 0.19,
        cartan_balance_proxy: 0,
      },
    },
    signals: {
      by_geometry: {
        options_surface: optionsSurface.signals,
        temporal_regime: temporalRegime.signals,
        cross_symbol: crossSymbol.signals,
      },
      aggregate: {
        fragmentation: 1,
        circulation_score: 0.22,
        divergence_stress: 0.37,
        harmonic_persistence: 0.24,
        liquidity_pressure: 0.48,
      },
    },
    warnings: [
      "backend_unavailable",
      "Demo analysis uses synthetic kernels and cohomology summaries.",
    ],
  };
}

const demoPharmaEvents = [
  {
    id: "pharma-event-1",
    source: "biopharmcatalyst",
    external_id: "demo-bpc-1",
    ticker: "VRTX",
    company: "Vertex Pharmaceuticals",
    event_at: "2026-03-10T12:30:00Z",
    title: "Vertex reports positive Phase 3 data in rare disease program",
    summary: "Positive Phase 3 clinical readout with endpoint language and rare-disease framing.",
    event_type: "clinical",
    trial_phase: "Phase 3",
    indication: "rare disease",
    source_url: "https://www.biopharmcatalyst.com/demo/vrtx-phase3",
    press_release_url: "https://investors.vrtx.com/demo-release",
    press_release_text: "The study met its primary endpoint in a rare-disease cohort and provided dose-response detail.",
    ingest_hash: "demo-vrtx-phase3",
    confidence: 0.91,
    payload: { event_quality: { score: 0.83, components: { "positive:met primary endpoint": 0.26 } } },
  },
  {
    id: "pharma-event-2",
    source: "biopharmcatalyst",
    external_id: "demo-bpc-2",
    ticker: "MRNA",
    company: "Moderna",
    event_at: "2026-03-08T12:30:00Z",
    title: "Moderna announces strategic oncology collaboration update",
    summary: "Strategic update with oncology indication context and partnership language.",
    event_type: "strategic",
    trial_phase: "",
    indication: "oncology",
    source_url: "https://www.biopharmcatalyst.com/demo/mrna-collaboration",
    press_release_url: "https://investors.mrna.com/demo-release",
    press_release_text: "The collaboration expands the oncology platform and includes milestone language.",
    ingest_hash: "demo-mrna-strategic",
    confidence: 0.76,
    payload: { event_quality: { score: 0.62, components: { "positive:partnership": 0.08 } } },
  },
  {
    id: "pharma-event-3",
    source: "biopharmcatalyst",
    external_id: "demo-bpc-3",
    ticker: "ALNY",
    company: "Alnylam Pharmaceuticals",
    event_at: "2026-03-05T12:30:00Z",
    title: "Alnylam prices follow-on offering",
    summary: "Financing event with offering language and no clinical specificity.",
    event_type: "financing",
    trial_phase: "",
    indication: "",
    source_url: "https://www.biopharmcatalyst.com/demo/alny-offering",
    press_release_url: "https://investors.alnylam.com/demo-release",
    press_release_text: "The company announced a follow-on offering to support corporate purposes.",
    ingest_hash: "demo-alny-offering",
    confidence: 0.7,
    payload: { event_quality: { score: 0.28, components: { "negative:offering": -0.24 } } },
  },
];

const demoDossierAssertions = [
  {
    id: "dossier-assertion-demo-1",
    document_id: "doc-coreydigs-1",
    source_key: "misconceptions-clickbait|demo",
    normalized_title: "misconceptions and clickbait",
    dedupe_key: "misconceptions and clickbait|demo",
    source_node_id: "node-coreydigs-1",
    assertion_text: "According to a court filing dated 2024-08-17, several state-level legal challenges expanded after the vaccine-passport narrative intensified.",
    summary: "Court filing and passport-related legal challenge claim.",
    actor: "court filing",
    institution: "Courts",
    topic_tags: ["legal_rights", "public_health", "media_narrative"],
    evidence_tags: ["court_filing", "statute_policy", "reporting"],
    stance: "reported",
    is_dated: true,
    asserted_at: "2024-08-17T00:00:00+00:00",
    confidence: 0.71,
    payload: {
      document_title: "Misconceptions and Clickbait",
      document_track: "meta_method_navigation",
      headline_body_discrepancy: 0.46,
      evidence_density: 0.58,
      duplicate_document_ids: ["doc-coreydigs-1", "doc-coreydigs-1-copy"],
      primary_backing_score: 0.64,
      triangulation: {
        references: [
          { reference_type: "court_document", label: "court filing dated 2024-08-17", confidence: 0.6 },
          { reference_type: "government_or_ngo_record", label: "vaccine-passport policy material", confidence: 0.44 },
        ],
        counts: { sec_filing: 0, court_document: 1, government_or_ngo_record: 1 },
        primary_backing_score: 0.64,
        high_confidence_primary_backing: true,
      },
    },
  },
  {
    id: "dossier-assertion-demo-2",
    document_id: "doc-coreydigs-2",
    source_key: "investigations-battle-for-vaccine|demo",
    normalized_title: "investigations battle for vaccine",
    dedupe_key: "investigations battle for vaccine|demo",
    source_node_id: "node-coreydigs-2",
    assertion_text: "The article argues that vaccine-related investigations amplified distrust across health institutions and repeated several narrative clusters.",
    summary: "Narrative amplification and public-health distrust claim.",
    actor: "The article",
    institution: "Public Health Agencies",
    topic_tags: ["public_health", "institutional_distrust", "media_narrative"],
    evidence_tags: ["reporting", "named_source"],
    stance: "allegation",
    is_dated: false,
    asserted_at: null,
    confidence: 0.42,
    payload: {
      document_title: "Investigations Battle for Vaccine",
      document_track: "dossier_case_study",
      headline_body_discrepancy: 0.52,
      evidence_density: 0.31,
      duplicate_document_ids: ["doc-coreydigs-2"],
      primary_backing_score: 0.18,
      triangulation: {
        references: [{ reference_type: "unknown_reference", label: "investigations amplified distrust", confidence: 0.18 }],
        counts: { sec_filing: 0, court_document: 0, government_or_ngo_record: 0 },
        primary_backing_score: 0.18,
        high_confidence_primary_backing: false,
      },
    },
  },
];

const demoDossierSignalWindows = [
  {
    id: "dossier-window-demo-1",
    window_date: "2024-08-17",
    topic_key: "all",
    signal_key: "assertion_density",
    value: 2,
    support_count: 2,
    payload: { dominant_topic: "public_health", topic_count: 3 },
  },
  {
    id: "dossier-window-demo-2",
    window_date: "2024-08-17",
    topic_key: "all",
    signal_key: "evidence_density",
    value: 0.45,
    support_count: 2,
    payload: { dominant_topic: "public_health", topic_count: 3 },
  },
  {
    id: "dossier-window-demo-3",
    window_date: "2024-08-17",
    topic_key: "all",
    signal_key: "clickbait_risk",
    value: 0.49,
    support_count: 2,
    payload: { dominant_topic: "public_health", topic_count: 3 },
  },
  {
    id: "dossier-window-demo-4",
    window_date: "2024-08-17",
    topic_key: "all",
    signal_key: "primary_backing_score",
    value: 0.41,
    support_count: 2,
    payload: { dominant_topic: "public_health", topic_count: 3 },
  },
  {
    id: "dossier-window-demo-5",
    window_date: "2024-08-17",
    topic_key: "public_health",
    signal_key: "vaccine_public_health_pressure",
    value: 0.67,
    support_count: 2,
    payload: { dominant_topic: "public_health", topic_count: 3 },
  },
  {
    id: "dossier-window-demo-6",
    window_date: "2024-08-17",
    topic_key: "media_narrative",
    signal_key: "narrative_volatility",
    value: 0.54,
    support_count: 2,
    payload: { dominant_topic: "public_health", topic_count: 3 },
  },
];

export function createDemoPharmaSyncResponse({ symbols = [] } = {}) {
  const requested = new Set((symbols || []).map((symbol) => String(symbol).trim().toUpperCase()).filter(Boolean));
  const items = requested.size ? demoPharmaEvents.filter((item) => requested.has(item.ticker)) : demoPharmaEvents;
  return {
    provider: {
      name: "demo_pharma_news",
      ready: false,
      fallback: true,
      detail: "Backend offline; using deterministic demo pharma events.",
      sources: demoSystemStatus.providers.pharma_news.sources,
    },
    summary: { stored_count: items.length, source_count: items.length },
    items,
    warnings: ["backend_unavailable", "DrugHunter remains a WIP source in demo mode."],
  };
}

export function createDemoPharmaEventsResponse({ symbols = [] } = {}) {
  const requested = new Set((symbols || []).map((symbol) => String(symbol).trim().toUpperCase()).filter(Boolean));
  const items = requested.size ? demoPharmaEvents.filter((item) => requested.has(item.ticker)) : demoPharmaEvents;
  return { items, count: items.length };
}

export function createDemoPharmaCycleResponse() {
  const candidates = [
    {
      candidate_key: "crown:linear_ridge",
      family_key: "market_green_triad",
      candidate_type: "crown",
      status: "homologated",
      metrics: {
        post_release_response: { mean_strategy_return: 0.021, information_coefficient: 0.34, mae: 0.018, rmse: 0.025, fold_pass_rate: 0.75, dispersion: 0.11 },
        volatility_jump: { mean_strategy_return: 0.0, information_coefficient: 0.22, mae: 0.09, rmse: 0.12, fold_pass_rate: 0.5, dispersion: 0.07 },
        event_quality: { mean_strategy_return: 0.0, information_coefficient: 0.41, mae: 0.08, rmse: 0.1, fold_pass_rate: 0.75, dispersion: 0.05 },
      },
      folds: [],
      warnings: [],
    },
    {
      candidate_key: "challenger:information_theoretic_learning",
      family_key: "information_theoretic_learning",
      candidate_type: "challenger",
      status: "provisional",
      metrics: {
        post_release_response: { mean_strategy_return: 0.014, information_coefficient: 0.21, mae: 0.021, rmse: 0.03, fold_pass_rate: 0.62, dispersion: 0.14 },
        volatility_jump: { mean_strategy_return: 0.0, information_coefficient: 0.17, mae: 0.1, rmse: 0.13, fold_pass_rate: 0.5, dispersion: 0.08 },
        event_quality: { mean_strategy_return: 0.0, information_coefficient: 0.28, mae: 0.1, rmse: 0.12, fold_pass_rate: 0.62, dispersion: 0.07 },
      },
      folds: [],
      warnings: [],
    },
    {
      candidate_key: "feeder:dyson_spectral_statistics",
      family_key: "dyson_spectral_statistics",
      candidate_type: "feeder",
      status: "candidate",
      metrics: {
        post_release_response: { mean_strategy_return: 0.006, information_coefficient: 0.08, mae: 0.024, rmse: 0.032, fold_pass_rate: 0.5, dispersion: 0.18 },
        volatility_jump: { mean_strategy_return: 0.0, information_coefficient: 0.12, mae: 0.1, rmse: 0.14, fold_pass_rate: 0.5, dispersion: 0.08 },
        event_quality: { mean_strategy_return: 0.0, information_coefficient: 0.16, mae: 0.12, rmse: 0.14, fold_pass_rate: 0.5, dispersion: 0.08 },
      },
      folds: [],
      warnings: [],
    },
    {
      candidate_key: "challenger:coreydigs_investigative_dossiers",
      family_key: "coreydigs_investigative_dossiers",
      candidate_type: "challenger",
      status: "candidate",
      metrics: {
        post_release_response: { mean_strategy_return: 0.004, information_coefficient: 0.11, mae: 0.023, rmse: 0.031, fold_pass_rate: 0.5, dispersion: 0.16 },
        volatility_jump: { mean_strategy_return: 0.0, information_coefficient: 0.19, mae: 0.11, rmse: 0.14, fold_pass_rate: 0.5, dispersion: 0.09 },
        event_quality: { mean_strategy_return: 0.0, information_coefficient: 0.24, mae: 0.11, rmse: 0.13, fold_pass_rate: 0.5, dispersion: 0.08 },
      },
      folds: [],
      warnings: ["Narrative overlays stay weak when primary triangulation is sparse."],
    },
  ];
  return {
    cycle: {
      id: "pharma-cycle-demo-1",
      benchmark_symbol: "XBI",
      dataset_summary: { event_count: 3, row_count: 3, benchmark_symbol: "XBI", symbols: ["ALNY", "MRNA", "VRTX"], dossier_assertion_count: demoDossierAssertions.length, dossier_signal_window_count: demoDossierSignalWindows.length },
      summary: { candidate_count: candidates.length, leader: { candidate_key: "crown:linear_ridge" } },
      created_at: NOW,
    },
    candidates,
    leaderboard: candidates.map((item) => ({
      candidate_key: item.candidate_key,
      family_key: item.family_key,
      candidate_type: item.candidate_type,
      mean_strategy_return: item.metrics.post_release_response.mean_strategy_return,
      information_coefficient: item.metrics.post_release_response.information_coefficient,
      rmse: item.metrics.post_release_response.rmse,
      fold_pass_rate: item.metrics.post_release_response.fold_pass_rate,
      dispersion: item.metrics.post_release_response.dispersion,
      status: item.status,
    })),
    warnings: ["backend_unavailable", "Demo cycle metrics are deterministic placeholders."],
  };
}

export function createDemoPharmaLeaderboardResponse() {
  return { items: createDemoPharmaCycleResponse().leaderboard };
}

export function createDemoPharmaHomologationsResponse() {
  return {
    items: [
      {
        candidate_key: "crown:linear_ridge",
        family_key: "market_green_triad",
        status: "homologated",
        metrics: createDemoPharmaCycleResponse().candidates[0].metrics,
        reasons: ["Three persisted cycles cleared the primary return and stability gate."],
      },
      {
        candidate_key: "challenger:information_theoretic_learning",
        family_key: "information_theoretic_learning",
        status: "provisional",
        metrics: createDemoPharmaCycleResponse().candidates[1].metrics,
        reasons: ["At least one persisted cycle cleared the primary return and stability gate."],
      },
    ],
  };
}

export function createDemoDossierSyncResponse() {
  return {
    provider: {
      name: "demo_dossier_news",
      ready: false,
      fallback: true,
      detail: "Backend offline; using deterministic dossier assertions.",
      sources: demoSystemStatus.providers.dossier_news.sources,
    },
    summary: {
      document_count: 2,
      duplicate_group_count: 1,
      assertion_count: demoDossierAssertions.length,
      entity_count: 4,
      signal_window_count: demoDossierSignalWindows.length,
      triangulated_assertion_count: 1,
      stored_assertion_count: demoDossierAssertions.length,
      stored_entity_count: 4,
      stored_signal_window_count: demoDossierSignalWindows.length,
    },
    assertions: demoDossierAssertions,
    entities: [
      { id: "demo-dossier-entity-1", document_id: "doc-coreydigs-1", label: "Courts", entity_type: "institution", canonical_label: "courts", mention_count: 1, payload: {} },
      { id: "demo-dossier-entity-2", document_id: "doc-coreydigs-1", label: "public_health", entity_type: "topic", canonical_label: "public health", mention_count: 1, payload: {} },
      { id: "demo-dossier-entity-3", document_id: "doc-coreydigs-2", label: "Public Health Agencies", entity_type: "institution", canonical_label: "public health agencies", mention_count: 1, payload: {} },
      { id: "demo-dossier-entity-4", document_id: "doc-coreydigs-2", label: "media_narrative", entity_type: "topic", canonical_label: "media narrative", mention_count: 1, payload: {} },
    ],
    signal_windows: demoDossierSignalWindows,
    warnings: ["backend_unavailable", "Narrative sources are treated as attributed assertions and weak priors unless primary backing is strong."],
    context: {
      signals_by_date: {
        "2024-08-17": {
          all: {
            assertion_density: 2,
            evidence_density: 0.45,
            clickbait_risk: 0.49,
            primary_backing_score: 0.41,
          },
          public_health: {
            vaccine_public_health_pressure: 0.67,
          },
          media_narrative: {
            narrative_volatility: 0.54,
          },
        },
      },
      static_priors: {
        assertion_density: 1,
        evidence_density: 0.45,
        clickbait_risk: 0.49,
        duplication_amplification: 0.5,
        primary_backing_score: 0.41,
        legal_rights_pressure: 0.5,
        vaccine_public_health_pressure: 0.67,
        institutional_distrust_score: 0.5,
        narrative_volatility: 0.54,
      },
      topic_priors: {
        public_health: 0.4,
        media_narrative: 0.4,
        legal_rights: 0.2,
      },
      summary: {
        assertion_count: demoDossierAssertions.length,
        dated_assertion_count: 1,
        undated_assertion_count: 1,
        signal_window_count: demoDossierSignalWindows.length,
        triangulated_assertion_count: 1,
      },
    },
  };
}

export function createDemoDossierAssertionsResponse({ datedOnly = false } = {}) {
  const items = datedOnly ? demoDossierAssertions.filter((item) => item.is_dated) : demoDossierAssertions;
  return { items, count: items.length };
}

export function createDemoDossierSignalWindowsResponse() {
  return { items: demoDossierSignalWindows, count: demoDossierSignalWindows.length };
}
