from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


# Authentication and operator session payloads -----------------------------------
class UserOut(BaseModel):
  id: str
  username: str
  display_name: str
  role: str
  created_at: str


class SessionResponse(BaseModel):
  user: UserOut
  mode: str = "live"


class RegisterRequest(BaseModel):
  username: str = Field(min_length=2, max_length=64)
  display_name: str = Field(min_length=2, max_length=120)
  password: str = Field(min_length=4, max_length=256)


class LoginRequest(BaseModel):
  username: str = Field(min_length=2, max_length=64)
  password: str = Field(min_length=4, max_length=256)


class ImportJobCreate(BaseModel):
  source_path: str = Field(min_length=1, max_length=512)
  kind: str = "manual_import"
  options: dict[str, Any] = Field(default_factory=dict)


class ImportJobOut(BaseModel):
  id: str
  kind: str
  source_path: str
  status: str
  document_count: int = 0
  options: dict[str, Any] = Field(default_factory=dict)
  warnings: list[str] = Field(default_factory=list)
  current_stage: str | None = None
  progress_completed: int = 0
  progress_total: int = 0
  file_counts: dict[str, int] = Field(default_factory=dict)
  current_item_name: str | None = None
  current_item_path: str | None = None
  current_item_index: int | None = None
  current_item_total: int | None = None
  resumable: bool = False
  recovered_after_restart: bool = False
  stage_state: str | None = None
  throughput_per_minute: float | None = None
  stall_minutes: float | None = None
  awaiting_refinement: bool = False
  recommended_action: str | None = None
  next_check: str | None = None
  retry_hint: str | None = None
  semantic_stats: dict[str, Any] = Field(default_factory=dict)
  stage_warnings: list[str] = Field(default_factory=list)
  error_code: str | None = None
  tasks: list[dict[str, Any]] = Field(default_factory=list)
  error_text: str | None = None
  created_at: str
  updated_at: str
  started_at: str | None = None
  finished_at: str | None = None


class WatchFolderCreate(BaseModel):
  path: str = Field(min_length=1, max_length=512)
  recursive: bool = True
  include_extensions: list[str] = Field(default_factory=list)
  exclude_globs: list[str] = Field(default_factory=list)


class WatchFolderOut(BaseModel):
  id: str
  path: str
  enabled: bool
  recursive: bool
  include_extensions: list[str] = Field(default_factory=list)
  exclude_globs: list[str] = Field(default_factory=list)
  created_at: str
  updated_at: str
  last_scanned_at: str | None = None
  last_scan_started_at: str | None = None
  last_scan_finished_at: str | None = None
  files_seen: int = 0
  files_added: int = 0
  files_changed: int = 0
  files_deleted: int = 0
  scan_errors: int = 0
  watch_backend: str = "polling"
  last_event_at: str | None = None
  last_event_summary: dict[str, Any] = Field(default_factory=dict)


class TrackedFileEventOut(BaseModel):
  id: str
  tracked_file_id: str
  import_job_id: str | None = None
  stage: str
  status: str
  message: str | None = None
  payload_json: dict[str, Any] = Field(default_factory=dict)
  created_at: str
  updated_at: str


class TrackedFileOut(BaseModel):
  id: str
  root_watch_folder_id: str | None = None
  absolute_path: str
  relative_path: str
  extension: str
  size_bytes: int = 0
  mtime: str | None = None
  checksum_sha1: str | None = None
  discovered_at: str
  last_seen_at: str
  last_import_job_id: str | None = None
  extraction_status: str = "pending"
  ocr_status: str = "pending"
  chunk_status: str = "pending"
  embedding_status: str = "pending"
  index_status: str = "pending"
  overall_status: str = "discovered"
  stale: bool = False
  error_message: str | None = None
  metadata_json: dict[str, Any] = Field(default_factory=dict)
  created_at: str
  updated_at: str


class TrackedFileDetailOut(TrackedFileOut):
  history: list[TrackedFileEventOut] = Field(default_factory=list)


class TrackedFilesResponse(BaseModel):
  items: list[TrackedFileOut] = Field(default_factory=list)


class TrackedFileEventsResponse(BaseModel):
  items: list[TrackedFileEventOut] = Field(default_factory=list)


class TrackedFileArtifactPathsResponse(BaseModel):
  tracked_file_id: str
  absolute_path: str
  last_import_job_id: str | None = None
  items: list[str] = Field(default_factory=list)


class OperatorRuntimeStateOut(BaseModel):
  paused: bool = False
  pause_reason: str | None = None
  updated_at: str | None = None
  source: str = "default"


class OperatorRuntimeStateRequest(BaseModel):
  paused: bool
  pause_reason: str | None = None


class OperatorActionResponse(BaseModel):
  ok: bool = True
  message: str


# Core document and extraction payloads ------------------------------------------
class DocumentOut(BaseModel):
  id: str
  title: str
  source_path: str
  file_type: str
  language: str
  status: str
  extraction_status: str = "pending"
  index_status: str = "pending"
  summary: str
  page_count: int
  node_count: int
  warnings: list[str] = Field(default_factory=list)
  metadata: dict[str, Any] = Field(default_factory=dict)
  extraction_metadata: dict[str, Any] = Field(default_factory=dict)
  pipeline_version: str | None = None
  last_indexed_at: str | None = None
  updated_at: str


class MathRegionOut(BaseModel):
  id: str
  artifact_id: str
  page_number: int
  region_index: int
  bbox: dict[str, Any] | None = None
  image_path: str | None = None
  raw_text: str = ""
  confidence: float = 0.0
  status: str = "pending"
  warnings: list[str] = Field(default_factory=list)


class MathFormulaLinkOut(BaseModel):
  id: str
  formula_id: str
  artifact_id: str
  region_id: str | None = None
  document_id: str
  node_id: str | None = None
  link_type: str = "page"
  payload: dict[str, Any] = Field(default_factory=dict)


class MathFormulaOut(BaseModel):
  id: str
  artifact_id: str
  region_id: str | None = None
  document_id: str
  node_id: str | None = None
  page_number: int
  label: str
  raw_text: str = ""
  latex: str | None = None
  confidence: float = 0.0
  provider_name: str = ""
  selected_provider: str = ""
  model_name: str | None = None
  extraction_mode: str = "native_math"
  provider_attempts: list[dict[str, Any]] = Field(default_factory=list)
  normalized_latex: str | None = None
  mathml: str | None = None
  handwriting_likelihood: float = 0.0
  quality_tier: str = "heuristic"
  retry_state: str = "idle"
  validation_status: str = "pending"
  warnings: list[str] = Field(default_factory=list)
  artifact: dict[str, Any] | None = None
  region: MathRegionOut | None = None
  links: list[MathFormulaLinkOut] = Field(default_factory=list)


class DocumentMathResponse(BaseModel):
  document_id: str
  items: list[MathFormulaOut] = Field(default_factory=list)
  summary: dict[str, Any] = Field(default_factory=dict)


class MathRetryRequest(BaseModel):
  formula_ids: list[str] = Field(default_factory=list)
  document_id: str | None = None


class MathRetryResponse(BaseModel):
  ok: bool = True
  requested: int = 0
  updated: int = 0


# Citation, footnote, and reference extraction payloads --------------------------
class CitationMentionOut(BaseModel):
  id: str
  document_id: str
  node_id: str | None = None
  page_number: int = 1
  mention_text: str = ""
  normalized_text: str = ""
  mention_type: str = "inline"
  target_label: str | None = None
  target_year: str | None = None
  raw_marker: str | None = None
  confidence: float = 0.0
  match_status: str = "unresolved"
  warnings: list[str] = Field(default_factory=list)


class CitationEntryOut(BaseModel):
  id: str
  document_id: str
  node_id: str | None = None
  page_number: int = 1
  section_label: str = ""
  raw_text: str = ""
  normalized_text: str = ""
  entry_type: str = "bibliography"
  authors: list[str] = Field(default_factory=list)
  title: str | None = None
  year: str | None = None
  container_title: str | None = None
  publisher: str | None = None
  volume: str | None = None
  issue: str | None = None
  pages: str | None = None
  doi: str | None = None
  url: str | None = None
  isbn: str | None = None
  confidence: float = 0.0
  parse_status: str = "parsed"
  warnings: list[str] = Field(default_factory=list)
  links: list[dict[str, Any]] = Field(default_factory=list)


class FootnoteSpanOut(BaseModel):
  id: str
  footnote_id: str
  span_index: int
  span_kind: str = "unknown"
  text: str = ""
  normalized_text: str = ""
  confidence: float = 0.0
  citation_entry_id: str | None = None
  citation_mention_id: str | None = None


class FootnoteArtifactOut(BaseModel):
  id: str
  document_id: str
  node_id: str | None = None
  page_number: int = 1
  note_label: str = ""
  raw_text: str = ""
  normalized_text: str = ""
  kind: str = "mixed"
  confidence: float = 0.0
  citations_detected: int = 0
  commentary_detected: int = 0
  warnings: list[str] = Field(default_factory=list)
  spans: list[FootnoteSpanOut] = Field(default_factory=list)


class DocumentCitationsResponse(BaseModel):
  document_id: str
  items: list[CitationEntryOut] = Field(default_factory=list)
  mentions: list[CitationMentionOut] = Field(default_factory=list)
  summary: dict[str, Any] = Field(default_factory=dict)


class DocumentFootnotesResponse(BaseModel):
  document_id: str
  items: list[FootnoteArtifactOut] = Field(default_factory=list)
  summary: dict[str, Any] = Field(default_factory=dict)


class CitationReviewQueueCreate(BaseModel):
  queue_type: str = Field(min_length=1, max_length=64)
  summary_text: str = Field(min_length=1, max_length=1000)
  normalized_record_id: str | None = None
  resolution_link_id: str | None = None
  work_id: str | None = None
  edition_id: str | None = None
  manifestation_id: str | None = None
  acquisition_candidate_id: str | None = None
  assigned_to_user_id: str | None = None
  priority: int = Field(default=100, ge=0, le=1000)
  due_at: str | None = None
  metadata: dict[str, Any] = Field(default_factory=dict)


class CitationReviewDecisionRequest(BaseModel):
  action: str = Field(min_length=1, max_length=128)
  note: str | None = Field(default=None, max_length=4000)
  payload: dict[str, Any] = Field(default_factory=dict)


class CitationReviewDecisionNoteOut(BaseModel):
  acted_at: str
  actor_user_id: str | None = None
  action: str
  note: str | None = None


class CitationWorkReviewOut(BaseModel):
  id: str
  preferred_title: str
  subtitle: str | None = None
  work_type: str
  canonical_author_string: str | None = None
  original_year: str | None = None
  language: str | None = None
  work_status: str
  cluster_confidence: float = 0.0
  summary_text: str | None = None
  semantic_status: str
  graph_status: str
  metadata: dict[str, Any] = Field(default_factory=dict)
  created_at: str
  updated_at: str
  superseded_by_work_id: str | None = None


class CitationEditionReviewOut(BaseModel):
  id: str
  work_id: str
  edition_status: str
  preferred_title: str | None = None
  format_hint: str | None = None
  publisher: str | None = None
  place_of_publication: str | None = None
  publication_year: str | None = None
  edition_statement: str | None = None
  volume: str | None = None
  issue: str | None = None
  language: str | None = None
  page_count: int | None = None
  cluster_confidence: float = 0.0
  metadata: dict[str, Any] = Field(default_factory=dict)
  created_at: str
  updated_at: str
  superseded_by_edition_id: str | None = None


class CitationManifestationReviewOut(BaseModel):
  id: str
  edition_id: str
  source_candidate_id: str | None = None
  manifestation_type: str
  media_type: str | None = None
  file_format: str | None = None
  storage_uri: str | None = None
  local_path: str | None = None
  checksum_sha256: str | None = None
  size_bytes: int | None = None
  page_count: int | None = None
  source_provider: str | None = None
  source_url: str | None = None
  acquisition_status: str
  ocr_status: str
  text_extraction_status: str
  embedding_status: str
  graph_enrichment_status: str
  metadata: dict[str, Any] = Field(default_factory=dict)
  created_at: str
  updated_at: str


class CitationAcquisitionCandidateReviewOut(BaseModel):
  id: str
  lookup_job_id: str
  work_id: str
  edition_id: str | None = None
  provider: str
  provider_record_id: str
  candidate_status: str
  title: str | None = None
  author_string: str | None = None
  publication_year: str | None = None
  publisher: str | None = None
  language: str | None = None
  file_format: str | None = None
  file_size_bytes: int | None = None
  page_count: int | None = None
  match_confidence: float = 0.0
  normalized_score: float = 0.0
  availability_status: str
  source_url: str | None = None
  preview_url: str | None = None
  download_url: str | None = None
  access_notes: str | None = None
  risk_flags: list[str] = Field(default_factory=list)
  raw_payload: dict[str, Any] = Field(default_factory=dict)
  metadata: dict[str, Any] = Field(default_factory=dict)
  created_at: str
  updated_at: str


class CitationProvenanceLinkOut(BaseModel):
  resolution_link_id: str
  resolution_status: str
  resolution_confidence: float = 0.0
  normalized_record_id: str
  title: str | None = None
  author_string: str | None = None
  year: str | None = None
  parse_confidence: float = 0.0
  observation_id: str
  source_system: str
  source_record_type: str | None = None
  source_record_id: str | None = None
  source_document_id: str | None = None
  source_url: str | None = None
  source_locator: str | None = None
  raw_citation_text: str
  raw_context_text: str | None = None
  provenance: dict[str, Any] = Field(default_factory=dict)


class CitationReviewEventOut(BaseModel):
  id: str
  approval_queue_id: str
  actor_user_id: str | None = None
  action: str
  from_status: str | None = None
  to_status: str | None = None
  event_notes: str | None = None
  payload: dict[str, Any] = Field(default_factory=dict)
  created_at: str


class CitationProvenanceEventOut(BaseModel):
  id: str
  entity_type: str
  entity_id: str
  event_type: str
  source_system: str | None = None
  source_record_type: str | None = None
  source_record_id: str | None = None
  processing_run_id: str | None = None
  approval_queue_id: str | None = None
  actor_user_id: str | None = None
  event_summary: str | None = None
  payload: dict[str, Any] = Field(default_factory=dict)
  created_at: str


class CitationReviewQueueItemOut(BaseModel):
  id: str
  queue_type: str
  status: str
  priority: int = 100
  summary_text: str
  normalized_record_id: str | None = None
  resolution_link_id: str | None = None
  work_id: str | None = None
  edition_id: str | None = None
  manifestation_id: str | None = None
  acquisition_candidate_id: str | None = None
  requested_by_user_id: str | None = None
  assigned_to_user_id: str | None = None
  due_at: str | None = None
  resolved_at: str | None = None
  decision_notes: list[CitationReviewDecisionNoteOut] = Field(default_factory=list)
  metadata: dict[str, Any] = Field(default_factory=dict)
  created_at: str
  updated_at: str
  work_title: str | None = None
  work_status: str | None = None
  candidate_title: str | None = None
  candidate_provider: str | None = None
  candidate_score: float | None = None


class CitationReviewQueueResponse(BaseModel):
  items: list[CitationReviewQueueItemOut] = Field(default_factory=list)


class CitationDownloadJobOut(BaseModel):
  id: str
  acquisition_candidate_id: str
  approval_queue_id: str | None = None
  manifestation_id: str | None = None
  requested_by_user_id: str | None = None
  approved_by_user_id: str | None = None
  status: str
  download_policy: str
  retry_count: int = 0
  last_attempt_at: str | None = None
  started_at: str | None = None
  finished_at: str | None = None
  output_uri: str | None = None
  checksum_sha256: str | None = None
  error_text: str | None = None
  metadata: dict[str, Any] = Field(default_factory=dict)
  created_at: str
  updated_at: str
  candidate_title: str | None = None
  candidate_provider: str | None = None


class CitationDownloadJobsResponse(BaseModel):
  items: list[CitationDownloadJobOut] = Field(default_factory=list)


class CitationManualProcurementCreate(BaseModel):
  work_id: str
  edition_id: str | None = None
  approval_queue_id: str | None = None
  owner_user_id: str | None = None
  reason_code: str = Field(min_length=1, max_length=128)
  unresolved_reasons: list[dict[str, Any]] = Field(default_factory=list)
  priority: int = Field(default=100, ge=0, le=1000)
  vendor_hint: str | None = Field(default=None, max_length=255)
  due_at: str | None = None
  notes: list[str] = Field(default_factory=list)
  future_workflow: dict[str, Any] = Field(default_factory=dict)
  metadata: dict[str, Any] = Field(default_factory=dict)


class CitationManualProcurementActionRequest(BaseModel):
  action: str = Field(min_length=1, max_length=128)
  note: str | None = Field(default=None, max_length=4000)
  payload: dict[str, Any] = Field(default_factory=dict)


class CitationManualProcurementEventOut(BaseModel):
  id: str
  procurement_queue_id: str
  actor_user_id: str | None = None
  action: str
  from_status: str | None = None
  to_status: str | None = None
  note_text: str | None = None
  payload: dict[str, Any] = Field(default_factory=dict)
  created_at: str


class CitationManualProcurementItemOut(BaseModel):
  id: str
  work_id: str
  edition_id: str | None = None
  approval_queue_id: str | None = None
  owner_user_id: str | None = None
  requested_by_user_id: str | None = None
  status: str
  reason_code: str
  priority: int = 100
  vendor_hint: str | None = None
  estimated_cost_cents: int | None = None
  due_at: str | None = None
  notes: list[str] = Field(default_factory=list)
  canonical_snapshot: dict[str, Any] = Field(default_factory=dict)
  unresolved_reasons: list[dict[str, Any]] = Field(default_factory=list)
  suggested_identifiers: list[dict[str, Any]] = Field(default_factory=list)
  provenance_snapshot: list[dict[str, Any]] = Field(default_factory=list)
  future_workflow: dict[str, Any] = Field(default_factory=dict)
  metadata: dict[str, Any] = Field(default_factory=dict)
  created_at: str
  updated_at: str
  resolved_at: str | None = None
  work_title: str | None = None


class CitationManualProcurementResponse(BaseModel):
  items: list[CitationManualProcurementItemOut] = Field(default_factory=list)


class CitationManualProcurementDetailOut(BaseModel):
  item: CitationManualProcurementItemOut
  work: CitationWorkReviewOut | None = None
  edition: CitationEditionReviewOut | None = None
  provenance_links: list[CitationProvenanceLinkOut] = Field(default_factory=list)
  events: list[CitationManualProcurementEventOut] = Field(default_factory=list)


class CitationManualProcurementExportItemOut(BaseModel):
  queue_item: CitationManualProcurementItemOut
  search_hints: list[str] = Field(default_factory=list)


class CitationManualProcurementExportResponse(BaseModel):
  schema_version: str
  exported_at: str
  filters: dict[str, Any] = Field(default_factory=dict)
  count: int = 0
  items: list[CitationManualProcurementExportItemOut] = Field(default_factory=list)


class CitationReviewQueueDetailOut(BaseModel):
  item: CitationReviewQueueItemOut
  work: CitationWorkReviewOut | None = None
  edition: CitationEditionReviewOut | None = None
  candidate: CitationAcquisitionCandidateReviewOut | None = None
  editions: list[CitationEditionReviewOut] = Field(default_factory=list)
  candidates: list[CitationAcquisitionCandidateReviewOut] = Field(default_factory=list)
  manifestations: list[CitationManifestationReviewOut] = Field(default_factory=list)
  provenance_links: list[CitationProvenanceLinkOut] = Field(default_factory=list)
  events: list[CitationReviewEventOut] = Field(default_factory=list)
  work_events: list[CitationProvenanceEventOut] = Field(default_factory=list)
  candidate_events: list[CitationProvenanceEventOut] = Field(default_factory=list)
  download_jobs: list[CitationDownloadJobOut] = Field(default_factory=list)
  manual_procurement_items: list[CitationManualProcurementItemOut] = Field(default_factory=list)


# Forecasting, market, dossier, and cycle response payloads ----------------------
class ForecastTechniqueSourceOut(BaseModel):
  id: str
  technique_id: str
  document_id: str
  node_id: str | None = None
  source_label: str
  section_title: str = ""
  page_start: int
  page_end: int
  reference_text: str
  source_reference: str
  variation_type: str
  evidence_score: float


class ForecastTechniqueAssetOut(BaseModel):
  id: str
  technique_id: str
  asset_type: str
  label: str
  path: str
  symbol: str | None = None
  payload: dict[str, Any] = Field(default_factory=dict)


class ForecastTechniqueAdaptationOut(BaseModel):
  id: str
  technique_id: str
  name: str
  category: str
  summary: str
  forecast_targets: list[str] = Field(default_factory=list)


class ForecastTechniqueValidationCaseOut(BaseModel):
  id: str
  technique_id: str
  name: str
  description: str
  expected_outcome: str


class ForecastTechniqueOut(BaseModel):
  id: str
  family_key: str = "polynomial"
  family_title: str = "Polynomial Forecasting Methods"
  technique: str
  category: str
  forecast_target: str
  difficulty: str
  short_definition: str
  purpose: str
  required_inputs: list[str] = Field(default_factory=list)
  optional_inputs: list[str] = Field(default_factory=list)
  outputs: list[str] = Field(default_factory=list)
  time_horizon: str
  frequency_assumptions: str
  mathematical_logic: str
  algorithm: list[str] = Field(default_factory=list)
  assumptions: list[str] = Field(default_factory=list)
  strengths: list[str] = Field(default_factory=list)
  weaknesses: list[str] = Field(default_factory=list)
  failure_modes: list[str] = Field(default_factory=list)
  common_mistakes: list[str] = Field(default_factory=list)
  minimum_viable_version: str
  advanced_version: str
  implementation_status: str
  adaptation_status: str
  best_use_case: str
  key_limitation: str
  confidence_level: str
  source_reference_hint: str
  pseudocode: str
  implementation_notes: list[str] = Field(default_factory=list)
  validation_checks: list[str] = Field(default_factory=list)
  unit_test_ideas: list[str] = Field(default_factory=list)
  backtesting_procedure: list[str] = Field(default_factory=list)
  spreadsheet_logic: str
  connections: list[str] = Field(default_factory=list)
  inputs_summary: str
  outputs_summary: str
  sources: list[ForecastTechniqueSourceOut] = Field(default_factory=list)
  assets: list[ForecastTechniqueAssetOut] = Field(default_factory=list)
  adaptations: list[ForecastTechniqueAdaptationOut] = Field(default_factory=list)
  validation_cases: list[ForecastTechniqueValidationCaseOut] = Field(default_factory=list)


class ForecastTechniquePackOut(BaseModel):
  document_id: str
  document_title: str
  family_key: str | None = None
  family_title: str | None = None
  part1_master_technique_index: list[dict[str, Any]] = Field(default_factory=list)
  part2_technique_cards: list[dict[str, Any]] = Field(default_factory=list)
  markdown: str


class QueryRequest(BaseModel):
  query: str = Field(min_length=2, max_length=2000)
  scope: dict[str, Any] = Field(default_factory=dict)


class MarketAnalysisRequest(BaseModel):
  symbols: list[str] = Field(min_length=1)
  benchmark_symbol: str = Field(default="SPY", min_length=1, max_length=16)
  period: str = Field(default="6mo", min_length=1, max_length=16)
  interval: str = Field(default="1d", min_length=1, max_length=16)
  mode: str = Field(default="auto", min_length=1, max_length=32)
  max_expiries: int = Field(default=2, ge=0, le=12)
  max_strikes_per_expiry: int = Field(default=7, ge=1, le=50)
  rolling_window: int = Field(default=20, ge=3, le=252)
  k_neighbors: int = Field(default=4, ge=1, le=32)
  risk_free_rate: float = 0.0
  inverse_temperature: float = Field(default=1.0, gt=0.0)
  bloch_phase: float = 0.5235987755982988
  retarded_eta: float = Field(default=0.15, gt=0.0)


class MarketAnalysisResponse(BaseModel):
  provider: dict[str, Any] = Field(default_factory=dict)
  request: dict[str, Any] = Field(default_factory=dict)
  state_mapping: dict[str, Any] = Field(default_factory=dict)
  options_surface: dict[str, Any] = Field(default_factory=dict)
  temporal_regime: dict[str, Any] = Field(default_factory=dict)
  cross_symbol: dict[str, Any] = Field(default_factory=dict)
  thermodynamics: dict[str, Any] = Field(default_factory=dict)
  casimir_euler: dict[str, Any] = Field(default_factory=dict)
  signals: dict[str, Any] = Field(default_factory=dict)
  warnings: list[str] = Field(default_factory=list)


class PharmaSyncRequest(BaseModel):
  symbols: list[str] = Field(default_factory=list)
  limit: int = Field(default=25, ge=1, le=200)


class PharmaSyncResponse(BaseModel):
  provider: dict[str, Any] = Field(default_factory=dict)
  summary: dict[str, Any] = Field(default_factory=dict)
  items: list[dict[str, Any]] = Field(default_factory=list)
  warnings: list[str] = Field(default_factory=list)


class PharmaEventsResponse(BaseModel):
  items: list[dict[str, Any]] = Field(default_factory=list)
  count: int = 0


class DossierSyncRequest(BaseModel):
  document_limit: int = Field(default=100, ge=1, le=500)
  assertion_limit_per_document: int = Field(default=24, ge=1, le=200)


class DossierSyncResponse(BaseModel):
  provider: dict[str, Any] = Field(default_factory=dict)
  summary: dict[str, Any] = Field(default_factory=dict)
  assertions: list[dict[str, Any]] = Field(default_factory=list)
  entities: list[dict[str, Any]] = Field(default_factory=list)
  signal_windows: list[dict[str, Any]] = Field(default_factory=list)
  warnings: list[str] = Field(default_factory=list)
  context: dict[str, Any] = Field(default_factory=dict)


class DossierAssertionsResponse(BaseModel):
  items: list[dict[str, Any]] = Field(default_factory=list)
  count: int = 0


class DossierSignalWindowsResponse(BaseModel):
  items: list[dict[str, Any]] = Field(default_factory=list)
  count: int = 0


class PharmaCycleRequest(BaseModel):
  symbols: list[str] = Field(default_factory=list)
  benchmark_symbol: str = Field(default="XBI", min_length=1, max_length=16)
  period: str = Field(default="1y", min_length=1, max_length=16)
  interval: str = Field(default="1d", min_length=1, max_length=16)
  train_window: int = Field(default=60, ge=1, le=500)
  test_window: int = Field(default=20, ge=1, le=200)
  step_size: int = Field(default=20, ge=1, le=200)
  pre_window: int = Field(default=20, ge=5, le=252)
  post_window: int = Field(default=1, ge=1, le=60)
  max_events: int = Field(default=150, ge=5, le=1000)
  max_expiries: int = Field(default=2, ge=0, le=12)
  max_strikes_per_expiry: int = Field(default=7, ge=1, le=50)
  rolling_window: int = Field(default=20, ge=4, le=252)
  k_neighbors: int = Field(default=4, ge=1, le=32)
  risk_free_rate: float = 0.0
  inverse_temperature: float = Field(default=1.0, gt=0.0)
  bloch_phase: float = 0.5235987755982988
  retarded_eta: float = Field(default=0.15, gt=0.0)
  include_dossier_signals: bool = True


class PharmaCycleResponse(BaseModel):
  cycle: dict[str, Any] = Field(default_factory=dict)
  candidates: list[dict[str, Any]] = Field(default_factory=list)
  leaderboard: list[dict[str, Any]] = Field(default_factory=list)
  warnings: list[str] = Field(default_factory=list)


class PharmaLeaderboardResponse(BaseModel):
  items: list[dict[str, Any]] = Field(default_factory=list)


class PharmaHomologationsResponse(BaseModel):
  items: list[dict[str, Any]] = Field(default_factory=list)


# Research bundles and curator-map payloads --------------------------------------
class CitationOut(BaseModel):
  id: str
  document_id: str
  document_title: str
  page_start: int
  page_end: int
  quote: str
  score: float


class RelatedDocumentOut(BaseModel):
  id: str
  title: str
  score: float


class QueryResponse(BaseModel):
  mode: str
  answer: str
  citations: list[CitationOut]
  related_documents: list[RelatedDocumentOut]
  coverage: dict[str, Any]
  warnings: list[str] = Field(default_factory=list)
  trace: dict[str, Any] = Field(default_factory=dict)
  research_bundle_id: str | None = None


class SavedQueryCreate(BaseModel):
  title: str = Field(min_length=1, max_length=160)
  query_text: str = Field(min_length=2, max_length=2000)
  mode: str = Field(min_length=2, max_length=64)
  research_bundle_id: str | None = None
  response: dict[str, Any]


class SavedQueryOut(BaseModel):
  id: str
  title: str
  query_text: str
  mode: str
  research_bundle_id: str | None = None
  created_at: str


class NoteCreate(BaseModel):
  title: str = Field(min_length=1, max_length=160)
  content: str = Field(min_length=1, max_length=4000)
  document_id: str | None = None
  node_id: str | None = None
  entity_id: str | None = None


class NoteOut(BaseModel):
  id: str
  title: str
  content: str
  document_id: str | None = None
  node_id: str | None = None
  entity_id: str | None = None
  created_at: str


class ResearchQueryRequest(BaseModel):
  query: str = Field(min_length=2, max_length=2000)
  preferred_lens: str | None = Field(default=None, max_length=64)
  scope: dict[str, Any] = Field(default_factory=dict)


class ResearchEntityOut(BaseModel):
  id: str
  type: str
  label: str
  document_id: str | None = None
  node_id: str | None = None
  parent_id: str | None = None
  metadata: dict[str, Any] = Field(default_factory=dict)


class ResearchRelationOut(BaseModel):
  id: str
  type: str
  source_id: str
  target_id: str
  label: str
  evidence_ids: list[str] = Field(default_factory=list)
  validation: dict[str, Any] = Field(default_factory=dict)
  metadata: dict[str, Any] = Field(default_factory=dict)


class LensPayloadOut(BaseModel):
  key: str
  title: str
  status: str
  summary: str
  data: dict[str, Any] = Field(default_factory=dict)


class ValidationResultOut(BaseModel):
  id: str
  title: str
  status: str
  details: str
  entity_ids: list[str] = Field(default_factory=list)


class ResearchBundleEvidenceOut(BaseModel):
  documents: list[dict[str, Any]] = Field(default_factory=list)
  nodes: list[dict[str, Any]] = Field(default_factory=list)
  node_ids: list[str] = Field(default_factory=list)
  citation_ids: list[str] = Field(default_factory=list)


class ResearchQueryResponse(BaseModel):
  id: str
  mode: str
  answer: str
  citations: list[CitationOut]
  evidence_bundle: ResearchBundleEvidenceOut
  entities: list[ResearchEntityOut]
  relations: list[ResearchRelationOut]
  lens_payloads: list[LensPayloadOut]
  validation: list[ValidationResultOut]
  warnings: list[str] = Field(default_factory=list)
  trace: dict[str, Any] = Field(default_factory=dict)


class ResearchMapCreate(BaseModel):
  title: str = Field(min_length=1, max_length=160)
  description: str = ""
  bundle_id: str | None = None
  layout: dict[str, Any] = Field(default_factory=dict)


class ResearchMapOut(BaseModel):
  id: str
  title: str
  description: str
  bundle_id: str | None = None
  source_kind: str | None = None
  source_ref: str | None = None
  layout: dict[str, Any] = Field(default_factory=dict)
  pin_count: int = 0
  created_at: str
  updated_at: str


class ResearchMapPinCreate(BaseModel):
  entity_id: str
  pin_type: str = "interpretant"
  position: dict[str, Any] = Field(default_factory=dict)
  payload: dict[str, Any] = Field(default_factory=dict)


class ResearchMapPinOut(BaseModel):
  id: str
  map_id: str
  entity_id: str
  pin_type: str
  position: dict[str, Any] = Field(default_factory=dict)
  payload: dict[str, Any] = Field(default_factory=dict)
  created_at: str


# System and activity-center diagnostics -----------------------------------------
class WebsiteToposMaterializeRequest(BaseModel):
  title: str | None = Field(default=None, min_length=1, max_length=160)
  description: str | None = None


class WebsiteToposMaterializeResponse(BaseModel):
  map: ResearchMapOut
  pins_created: int
  source_kind: str
  source_ref: str


class LawvereCollectionMaterializeRequest(BaseModel):
  title: str | None = Field(default=None, max_length=160)
  description: str | None = Field(default=None, max_length=500)


class LawvereCollectionMaterializeResponse(BaseModel):
  map: ResearchMapOut
  pins_created: int
  source_kind: str
  source_ref: str


class CognitiveInvariantsMaterializeRequest(BaseModel):
  title: str | None = Field(default=None, max_length=160)
  description: str | None = Field(default=None, max_length=500)


class CognitiveInvariantsMaterializeResponse(BaseModel):
  map: ResearchMapOut
  pins_created: int
  source_kind: str
  source_ref: str


class SystemProviderStatusOut(BaseModel):
  name: str
  ready: bool
  fallback: bool = False
  detail: str | None = None
  sources: dict[str, Any] = Field(default_factory=dict)


class SystemStatusOut(BaseModel):
  runtime_mode: str
  dev_fallbacks_enabled: bool
  pipeline_version: str
  compute: dict[str, Any] = Field(default_factory=dict)
  qdrant: dict[str, Any] = Field(default_factory=dict)
  providers: dict[str, SystemProviderStatusOut] = Field(default_factory=dict)
  import_runtime: dict[str, Any] = Field(default_factory=dict)
  query_runtime: dict[str, Any] = Field(default_factory=dict)
  jobs: dict[str, Any] = Field(default_factory=dict)
  watch_folders: dict[str, Any] = Field(default_factory=dict)
  profiling: dict[str, Any] = Field(default_factory=dict)


class ActivityGitExportOut(BaseModel):
  id: str
  status: str
  file_relpath: str | None = None
  commit_hash: str | None = None
  error_text: str | None = None
  updated_at: str | None = None


class ActivitySignalOut(BaseModel):
  id: str
  source_module: str
  source_kind: str
  entity_id: str | None = None
  title: str
  summary: str
  severity: str
  visibility: str = "public"
  signal_state: str = "active"
  review_state: str = "pending"
  note: str = ""
  snooze_until: str | None = None
  created_at: str
  updated_at: str
  payload: dict[str, Any] = Field(default_factory=dict)
  git_export: ActivityGitExportOut | None = None


class ActivitySignalsResponse(BaseModel):
  items: list[ActivitySignalOut] = Field(default_factory=list)
  mode: str = "live"


class ActivitySignalInput(BaseModel):
  id: str = Field(min_length=1, max_length=200)
  source_module: str = Field(min_length=1, max_length=64)
  source_kind: str = Field(min_length=1, max_length=64)
  entity_id: str | None = Field(default=None, max_length=200)
  title: str = Field(min_length=1, max_length=200)
  summary: str = Field(default="", max_length=1000)
  severity: str = Field(default="info", max_length=32)
  visibility: str = Field(default="public", max_length=32)
  signal_state: str = Field(default="active", max_length=64)
  review_state: str | None = Field(default=None, max_length=64)
  note: str | None = Field(default=None, max_length=4000)
  snooze_until: str | None = None
  payload: dict[str, Any] = Field(default_factory=dict)


class ActivitySignalSyncRequest(BaseModel):
  items: list[ActivitySignalInput] = Field(default_factory=list)


class ActivityReviewRequest(BaseModel):
  action: str = Field(min_length=1, max_length=32)
  review_state: str = Field(min_length=1, max_length=32)
  visibility: str = Field(default="public", min_length=1, max_length=32)
  note: str = Field(default="", max_length=4000)
  snooze_until: str | None = None
  payload: dict[str, Any] = Field(default_factory=dict)


class ActivityReviewOut(BaseModel):
  id: str
  signal_id: str
  action: str
  review_state: str
  visibility: str
  note: str = ""
  snooze_until: str | None = None
  created_at: str
  payload: dict[str, Any] = Field(default_factory=dict)


class ActivityReviewHistoryResponse(BaseModel):
  items: list[ActivityReviewOut] = Field(default_factory=list)


class ActivityGitProfileRequest(BaseModel):
  repo_path: str = Field(min_length=1, max_length=1000)
  export_subdir: str = Field(default="activity-exports", min_length=1, max_length=200)
  branch_name: str | None = Field(default=None, max_length=120)
  valid: bool = False
  last_validated_at: str | None = None
  last_error: str | None = Field(default=None, max_length=2000)


class ActivityGitProfileOut(BaseModel):
  repo_path: str
  export_subdir: str
  branch_name: str | None = None
  valid: bool = False
  last_validated_at: str | None = None
  last_error: str | None = None
  created_at: str
  updated_at: str


class ActivityGitProfileResponse(BaseModel):
  item: ActivityGitProfileOut | None = None


class ActivityPrivateExportOut(BaseModel):
  id: str
  signal_id: str
  status: str
  visibility: str
  file_relpath: str | None = None
  commit_hash: str | None = None
  error_text: str | None = None
  content: dict[str, Any] = Field(default_factory=dict)
  created_at: str
  updated_at: str
  committed_at: str | None = None


class ActivityGitExportsResponse(BaseModel):
  items: list[ActivityPrivateExportOut] = Field(default_factory=list)


class ActivityExportCommitRequest(BaseModel):
  commit_hash: str = Field(min_length=1, max_length=200)
  file_relpath: str = Field(min_length=1, max_length=1000)


class ActivityExportFailureRequest(BaseModel):
  error_text: str = Field(min_length=1, max_length=4000)
