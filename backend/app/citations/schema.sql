PRAGMA foreign_keys = ON;

-- Bibliographic purification and acquisition schema.
-- This schema is designed for SQLite and is intentionally append-friendly:
-- raw observations, normalization output, matcher output, approvals, and
-- download/procurement actions are modeled as new rows rather than destructive updates.

-- ---------------------------------------------------------------------------
-- Processing runs
-- Why this table exists:
-- Tracks parser, matcher, clustering, lookup, and export runs so the system can
-- re-run logic without losing prior results.
--
-- Suggested statuses:
-- queued | running | completed | failed | cancelled
--
-- Suggested run_type values:
-- parse | match | cluster | lookup | export | remediation
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS citation_processing_runs (
  id TEXT PRIMARY KEY,
  parent_run_id TEXT,
  import_job_id TEXT,
  run_type TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  tool_version TEXT NOT NULL DEFAULT '',
  config_fingerprint TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued',
  triggered_by_user_id TEXT,
  settings_json TEXT NOT NULL DEFAULT '{}',
  notes_json TEXT NOT NULL DEFAULT '[]',
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (parent_run_id) REFERENCES citation_processing_runs(id) ON DELETE SET NULL,
  FOREIGN KEY (import_job_id) REFERENCES import_jobs(id) ON DELETE SET NULL,
  FOREIGN KEY (triggered_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_citation_processing_runs_type_status
  ON citation_processing_runs(run_type, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_citation_processing_runs_parent
  ON citation_processing_runs(parent_run_id, created_at DESC);


-- ---------------------------------------------------------------------------
-- Raw citation observations
-- Why this table exists:
-- Stores the immutable raw citation string and source context exactly as seen.
-- This is the permanent evidence layer.
--
-- Suggested statuses:
-- captured | quarantined | archived
--
-- Nullable guidance:
-- source_document_id/source_url/source_locator are nullable because not every
-- observation comes from a document page or stable URL.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS citation_observations (
  id TEXT PRIMARY KEY,
  source_system TEXT NOT NULL,
  source_record_type TEXT NOT NULL,
  source_record_id TEXT,
  source_document_id TEXT,
  source_url TEXT,
  source_locator TEXT,
  observed_at TEXT,
  raw_citation_text TEXT NOT NULL,
  raw_context_text TEXT,
  raw_context_json TEXT NOT NULL DEFAULT '{}',
  raw_status TEXT NOT NULL DEFAULT 'captured',
  language_hint TEXT,
  fingerprint_sha1 TEXT NOT NULL,
  provenance_json TEXT NOT NULL DEFAULT '{}',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  retired_at TEXT,
  FOREIGN KEY (source_document_id) REFERENCES documents(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_citation_observations_source_unique
  ON citation_observations(source_system, source_record_type, source_record_id, fingerprint_sha1);

CREATE INDEX IF NOT EXISTS idx_citation_observations_status_updated
  ON citation_observations(raw_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_citation_observations_document
  ON citation_observations(source_document_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_citation_observations_fingerprint
  ON citation_observations(fingerprint_sha1);

CREATE TRIGGER IF NOT EXISTS trg_citation_observations_no_raw_text_update
BEFORE UPDATE OF raw_citation_text ON citation_observations
FOR EACH ROW
WHEN NEW.raw_citation_text <> OLD.raw_citation_text
BEGIN
  SELECT RAISE(ABORT, 'raw_citation_text is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_citation_observations_no_delete
BEFORE DELETE ON citation_observations
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'citation_observations rows are permanent; retire instead of deleting');
END;


-- ---------------------------------------------------------------------------
-- Normalized citations
-- Why this table exists:
-- Holds versioned parser output for each raw observation.
-- Multiple rows per observation are allowed across parser reruns.
--
-- Suggested statuses:
-- parsed | partial | ambiguous | rejected
--
-- Nullable guidance:
-- Most bibliographic fields are nullable because a parser often cannot recover
-- every component from noisy source text.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS citation_normalized_records (
  id TEXT PRIMARY KEY,
  observation_id TEXT NOT NULL,
  processing_run_id TEXT NOT NULL,
  supersedes_normalized_id TEXT,
  is_current INTEGER NOT NULL DEFAULT 1,
  normalization_status TEXT NOT NULL DEFAULT 'parsed',
  title TEXT,
  title_key TEXT,
  subtitle TEXT,
  author_string TEXT,
  year TEXT,
  publisher TEXT,
  place_of_publication TEXT,
  container_title TEXT,
  edition_statement TEXT,
  volume TEXT,
  issue TEXT,
  page_range TEXT,
  language TEXT,
  publication_type TEXT,
  parse_confidence REAL NOT NULL DEFAULT 0,
  parser_warnings_json TEXT NOT NULL DEFAULT '[]',
  normalized_payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (observation_id) REFERENCES citation_observations(id) ON DELETE CASCADE,
  FOREIGN KEY (processing_run_id) REFERENCES citation_processing_runs(id) ON DELETE RESTRICT,
  FOREIGN KEY (supersedes_normalized_id) REFERENCES citation_normalized_records(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_citation_normalized_observation
  ON citation_normalized_records(observation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_citation_normalized_run
  ON citation_normalized_records(processing_run_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_citation_normalized_title_author_year
  ON citation_normalized_records(title_key, year, parse_confidence DESC);

CREATE INDEX IF NOT EXISTS idx_citation_normalized_status_current
  ON citation_normalized_records(normalization_status, is_current, updated_at DESC);


-- ---------------------------------------------------------------------------
-- Authors
-- Why this table exists:
-- Canonical person/collective-author records that can be reused across works,
-- editions, and eventually knowledge graph enrichment.
--
-- Suggested statuses:
-- active | merged | deprecated
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS citation_authors (
  id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  sort_name TEXT NOT NULL DEFAULT '',
  family_name TEXT,
  given_name TEXT,
  initials TEXT,
  display_name TEXT NOT NULL,
  author_type TEXT NOT NULL DEFAULT 'person',
  authority_status TEXT NOT NULL DEFAULT 'active',
  birth_year TEXT,
  death_year TEXT,
  orcid TEXT,
  viaf TEXT,
  wikidata_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_citation_authors_canonical_name
  ON citation_authors(canonical_name);

CREATE INDEX IF NOT EXISTS idx_citation_authors_sort_name
  ON citation_authors(sort_name);

CREATE INDEX IF NOT EXISTS idx_citation_authors_orcid
  ON citation_authors(orcid);


-- ---------------------------------------------------------------------------
-- Works
-- Why this table exists:
-- Canonical abstract bibliographic works. A work can have many noisy citations,
-- many editions, and many acquisition candidates.
--
-- Suggested statuses:
-- candidate | canonical | needs_review | merged | retired
--
-- Nullable guidance:
-- original_year and canonical_author_string are nullable because they may remain
-- uncertain until clustering and review converge.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS citation_works (
  id TEXT PRIMARY KEY,
  preferred_title TEXT NOT NULL,
  title_key TEXT NOT NULL,
  subtitle TEXT,
  work_type TEXT NOT NULL DEFAULT 'unknown',
  canonical_author_string TEXT,
  original_year TEXT,
  language TEXT,
  work_status TEXT NOT NULL DEFAULT 'candidate',
  cluster_confidence REAL NOT NULL DEFAULT 0,
  summary_text TEXT,
  semantic_status TEXT NOT NULL DEFAULT 'pending',
  graph_status TEXT NOT NULL DEFAULT 'pending',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  superseded_by_work_id TEXT,
  FOREIGN KEY (superseded_by_work_id) REFERENCES citation_works(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_citation_works_title_key
  ON citation_works(title_key, canonical_author_string, original_year);

CREATE INDEX IF NOT EXISTS idx_citation_works_status
  ON citation_works(work_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_citation_works_semantic_status
  ON citation_works(semantic_status, graph_status, updated_at DESC);


-- ---------------------------------------------------------------------------
-- Editions
-- Why this table exists:
-- Concrete bibliographic editions/manifests beneath a work.
-- Distinguishes an abstract work from a particular publication instance.
--
-- Suggested statuses:
-- candidate | canonical | ambiguous | retired
--
-- Nullable guidance:
-- Many bibliographic detail fields remain nullable because citations often only
-- resolve to work-level identity.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS citation_editions (
  id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL,
  preferred_title TEXT,
  edition_statement TEXT,
  publication_year TEXT,
  publisher TEXT,
  place_of_publication TEXT,
  language TEXT,
  format_hint TEXT,
  volume TEXT,
  issue TEXT,
  page_count INTEGER,
  edition_status TEXT NOT NULL DEFAULT 'candidate',
  cluster_confidence REAL NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  superseded_by_edition_id TEXT,
  FOREIGN KEY (work_id) REFERENCES citation_works(id) ON DELETE CASCADE,
  FOREIGN KEY (superseded_by_edition_id) REFERENCES citation_editions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_citation_editions_work
  ON citation_editions(work_id, publication_year, publisher);

CREATE INDEX IF NOT EXISTS idx_citation_editions_status
  ON citation_editions(edition_status, updated_at DESC);


-- ---------------------------------------------------------------------------
-- Acquisition candidates
-- Why this table exists:
-- Stores provider-returned candidate metadata without downloading content.
-- Multiple candidates can coexist for the same work/edition.
--
-- Suggested statuses:
-- candidate | shortlisted | approved | rejected | superseded | unavailable
--
-- Nullable guidance:
-- download_url and preview_url are nullable because some providers only expose
-- a landing page or identifier.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS citation_acquisition_candidates (
  id TEXT PRIMARY KEY,
  lookup_job_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  edition_id TEXT,
  provider TEXT NOT NULL,
  provider_record_id TEXT NOT NULL,
  candidate_status TEXT NOT NULL DEFAULT 'candidate',
  title TEXT,
  author_string TEXT,
  publication_year TEXT,
  publisher TEXT,
  language TEXT,
  file_format TEXT,
  file_size_bytes INTEGER,
  page_count INTEGER,
  match_confidence REAL NOT NULL DEFAULT 0,
  availability_status TEXT NOT NULL DEFAULT 'unknown',
  source_url TEXT,
  preview_url TEXT,
  download_url TEXT,
  access_notes TEXT,
  raw_payload_json TEXT NOT NULL DEFAULT '{}',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (lookup_job_id) REFERENCES citation_lookup_jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (work_id) REFERENCES citation_works(id) ON DELETE CASCADE,
  FOREIGN KEY (edition_id) REFERENCES citation_editions(id) ON DELETE SET NULL,
  UNIQUE(provider, provider_record_id)
);

CREATE INDEX IF NOT EXISTS idx_citation_acquisition_candidates_work
  ON citation_acquisition_candidates(work_id, provider, candidate_status, match_confidence DESC);

CREATE INDEX IF NOT EXISTS idx_citation_acquisition_candidates_edition
  ON citation_acquisition_candidates(edition_id, provider, candidate_status, match_confidence DESC);

CREATE INDEX IF NOT EXISTS idx_citation_acquisition_candidates_lookup_job
  ON citation_acquisition_candidates(lookup_job_id, created_at DESC);


-- ---------------------------------------------------------------------------
-- File manifestations
-- Why this table exists:
-- Represents concrete files or physical-digital artifacts tied to an edition.
-- This is where OCR, extraction, embedding, and KG hooks can attach later.
--
-- Suggested statuses:
-- planned | available | downloaded | extracted | ocr_pending | embedded | indexed | failed | quarantined
--
-- Nullable guidance:
-- storage_uri, checksum, and byte counts are nullable until a file is actually
-- acquired or ingested.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS citation_file_manifestations (
  id TEXT PRIMARY KEY,
  edition_id TEXT NOT NULL,
  source_candidate_id TEXT,
  manifestation_type TEXT NOT NULL DEFAULT 'digital_file',
  media_type TEXT,
  file_format TEXT,
  storage_uri TEXT,
  local_path TEXT,
  checksum_sha256 TEXT,
  size_bytes INTEGER,
  page_count INTEGER,
  source_provider TEXT,
  source_url TEXT,
  acquisition_status TEXT NOT NULL DEFAULT 'planned',
  ocr_status TEXT NOT NULL DEFAULT 'pending',
  text_extraction_status TEXT NOT NULL DEFAULT 'pending',
  embedding_status TEXT NOT NULL DEFAULT 'pending',
  graph_enrichment_status TEXT NOT NULL DEFAULT 'pending',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (edition_id) REFERENCES citation_editions(id) ON DELETE CASCADE,
  FOREIGN KEY (source_candidate_id) REFERENCES citation_acquisition_candidates(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_citation_manifestations_edition
  ON citation_file_manifestations(edition_id, acquisition_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_citation_manifestations_checksum
  ON citation_file_manifestations(checksum_sha256);

CREATE INDEX IF NOT EXISTS idx_citation_manifestations_pipeline_status
  ON citation_file_manifestations(ocr_status, text_extraction_status, embedding_status, graph_enrichment_status);


-- ---------------------------------------------------------------------------
-- Work author links
-- Why this table exists:
-- Many-to-many author ordering for canonical works.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS citation_work_authors (
  id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  author_role TEXT NOT NULL DEFAULT 'author',
  ordinal INTEGER NOT NULL DEFAULT 1,
  confidence REAL NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(work_id, author_id, author_role, ordinal),
  FOREIGN KEY (work_id) REFERENCES citation_works(id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES citation_authors(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_citation_work_authors_work
  ON citation_work_authors(work_id, ordinal);

CREATE INDEX IF NOT EXISTS idx_citation_work_authors_author
  ON citation_work_authors(author_id, updated_at DESC);


-- ---------------------------------------------------------------------------
-- Edition author links
-- Why this table exists:
-- Many-to-many author/editor/translator ordering for edition-specific roles.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS citation_edition_authors (
  id TEXT PRIMARY KEY,
  edition_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  author_role TEXT NOT NULL DEFAULT 'author',
  ordinal INTEGER NOT NULL DEFAULT 1,
  confidence REAL NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(edition_id, author_id, author_role, ordinal),
  FOREIGN KEY (edition_id) REFERENCES citation_editions(id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES citation_authors(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_citation_edition_authors_edition
  ON citation_edition_authors(edition_id, ordinal);

CREATE INDEX IF NOT EXISTS idx_citation_edition_authors_author
  ON citation_edition_authors(author_id, updated_at DESC);


-- ---------------------------------------------------------------------------
-- Resolution links
-- Why this table exists:
-- Connects messy normalized citations to canonical works, editions, or known
-- manifestations. Supports many-to-one mapping and rerunnable matching logic.
--
-- Suggested statuses:
-- proposed | accepted | rejected | superseded
--
-- Nullable guidance:
-- edition_id and manifestation_id are nullable because many citations only
-- resolve to work-level identity.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS citation_resolution_links (
  id TEXT PRIMARY KEY,
  normalized_record_id TEXT NOT NULL,
  processing_run_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  edition_id TEXT,
  manifestation_id TEXT,
  resolution_type TEXT NOT NULL DEFAULT 'canonical_match',
  resolution_status TEXT NOT NULL DEFAULT 'proposed',
  confidence REAL NOT NULL DEFAULT 0,
  rationale_json TEXT NOT NULL DEFAULT '{}',
  is_current INTEGER NOT NULL DEFAULT 1,
  supersedes_resolution_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (normalized_record_id) REFERENCES citation_normalized_records(id) ON DELETE CASCADE,
  FOREIGN KEY (processing_run_id) REFERENCES citation_processing_runs(id) ON DELETE RESTRICT,
  FOREIGN KEY (work_id) REFERENCES citation_works(id) ON DELETE CASCADE,
  FOREIGN KEY (edition_id) REFERENCES citation_editions(id) ON DELETE SET NULL,
  FOREIGN KEY (manifestation_id) REFERENCES citation_file_manifestations(id) ON DELETE SET NULL,
  FOREIGN KEY (supersedes_resolution_id) REFERENCES citation_resolution_links(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_citation_resolution_links_normalized
  ON citation_resolution_links(normalized_record_id, is_current, confidence DESC);

CREATE INDEX IF NOT EXISTS idx_citation_resolution_links_work
  ON citation_resolution_links(work_id, resolution_status, confidence DESC);

CREATE INDEX IF NOT EXISTS idx_citation_resolution_links_edition
  ON citation_resolution_links(edition_id, resolution_status, confidence DESC);

CREATE INDEX IF NOT EXISTS idx_citation_resolution_links_run
  ON citation_resolution_links(processing_run_id, created_at DESC);


-- ---------------------------------------------------------------------------
-- Lookup jobs
-- Why this table exists:
-- Tracks metadata-only external source probing against LibGen, Sci-Hub,
-- Internet Archive, or later providers.
--
-- Suggested statuses:
-- queued | running | completed | rate_limited | failed | cancelled
--
-- Suggested providers:
-- libgen | scihub | internet_archive | other
--
-- Nullable guidance:
-- target_edition_id is nullable because some lookups start from a work or
-- normalized citation before edition identity is stable.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS citation_lookup_jobs (
  id TEXT PRIMARY KEY,
  processing_run_id TEXT,
  normalized_record_id TEXT,
  work_id TEXT,
  edition_id TEXT,
  provider TEXT NOT NULL,
  query_text TEXT NOT NULL,
  query_fingerprint TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  status TEXT NOT NULL DEFAULT 'queued',
  rate_limit_bucket TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  started_at TEXT,
  finished_at TEXT,
  response_summary_json TEXT NOT NULL DEFAULT '{}',
  error_text TEXT,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    normalized_record_id IS NOT NULL OR work_id IS NOT NULL OR edition_id IS NOT NULL
  ),
  FOREIGN KEY (processing_run_id) REFERENCES citation_processing_runs(id) ON DELETE SET NULL,
  FOREIGN KEY (normalized_record_id) REFERENCES citation_normalized_records(id) ON DELETE SET NULL,
  FOREIGN KEY (work_id) REFERENCES citation_works(id) ON DELETE SET NULL,
  FOREIGN KEY (edition_id) REFERENCES citation_editions(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_citation_lookup_jobs_provider_status
  ON citation_lookup_jobs(provider, status, priority, created_at);

CREATE INDEX IF NOT EXISTS idx_citation_lookup_jobs_work
  ON citation_lookup_jobs(work_id, provider, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_citation_lookup_jobs_edition
  ON citation_lookup_jobs(edition_id, provider, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_citation_lookup_jobs_normalized
  ON citation_lookup_jobs(normalized_record_id, provider, created_at DESC);


-- ---------------------------------------------------------------------------
-- Identifiers
-- Why this table exists:
-- Normalizes DOI/ISBN/OCLC/MD5/provider identifiers across normalized citations,
-- works, editions, manifestations, and acquisition candidates.
--
-- Suggested identifier_type values:
-- doi | isbn10 | isbn13 | oclc | issn | libgen_id | scihub_id | ia_identifier | md5 | sha256 | url
--
-- Nullable guidance:
-- Exactly one owning entity should be populated; every identifier is otherwise
-- optional because not all sources expose machine-readable identifiers.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS citation_identifiers (
  id TEXT PRIMARY KEY,
  normalized_record_id TEXT,
  work_id TEXT,
  edition_id TEXT,
  manifestation_id TEXT,
  acquisition_candidate_id TEXT,
  identifier_type TEXT NOT NULL,
  normalized_value TEXT NOT NULL,
  raw_value TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  source_confidence REAL NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (CASE WHEN normalized_record_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN work_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN edition_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN manifestation_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN acquisition_candidate_id IS NOT NULL THEN 1 ELSE 0 END)
    = 1
  ),
  FOREIGN KEY (normalized_record_id) REFERENCES citation_normalized_records(id) ON DELETE CASCADE,
  FOREIGN KEY (work_id) REFERENCES citation_works(id) ON DELETE CASCADE,
  FOREIGN KEY (edition_id) REFERENCES citation_editions(id) ON DELETE CASCADE,
  FOREIGN KEY (manifestation_id) REFERENCES citation_file_manifestations(id) ON DELETE CASCADE,
  FOREIGN KEY (acquisition_candidate_id) REFERENCES citation_acquisition_candidates(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_citation_identifiers_unique_owner_value
  ON citation_identifiers(
    identifier_type,
    normalized_value,
    COALESCE(normalized_record_id, ''),
    COALESCE(work_id, ''),
    COALESCE(edition_id, ''),
    COALESCE(manifestation_id, ''),
    COALESCE(acquisition_candidate_id, '')
  );

CREATE INDEX IF NOT EXISTS idx_citation_identifiers_value
  ON citation_identifiers(identifier_type, normalized_value);

CREATE INDEX IF NOT EXISTS idx_citation_identifiers_edition
  ON citation_identifiers(edition_id, identifier_type, is_primary DESC);

CREATE INDEX IF NOT EXISTS idx_citation_identifiers_manifestation
  ON citation_identifiers(manifestation_id, identifier_type, is_primary DESC);


-- ---------------------------------------------------------------------------
-- Approval queue
-- Why this table exists:
-- Central operator inbox for candidate approval, merge/split review, download
-- authorization, and ambiguous matcher decisions.
--
-- Suggested statuses:
-- pending | in_review | approved | rejected | deferred | cancelled
--
-- Suggested queue_type values:
-- candidate_review | work_merge | edition_merge | match_review | download_authorization | procurement_review
--
-- Nullable guidance:
-- Different review tasks target different entities, so target columns are
-- nullable, but at least one target must be present.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS citation_approval_queue (
  id TEXT PRIMARY KEY,
  queue_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  priority INTEGER NOT NULL DEFAULT 100,
  summary_text TEXT NOT NULL,
  normalized_record_id TEXT,
  resolution_link_id TEXT,
  work_id TEXT,
  edition_id TEXT,
  manifestation_id TEXT,
  acquisition_candidate_id TEXT,
  requested_by_user_id TEXT,
  assigned_to_user_id TEXT,
  due_at TEXT,
  decision_notes_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT,
  CHECK (
    normalized_record_id IS NOT NULL OR
    resolution_link_id IS NOT NULL OR
    work_id IS NOT NULL OR
    edition_id IS NOT NULL OR
    manifestation_id IS NOT NULL OR
    acquisition_candidate_id IS NOT NULL
  ),
  FOREIGN KEY (normalized_record_id) REFERENCES citation_normalized_records(id) ON DELETE SET NULL,
  FOREIGN KEY (resolution_link_id) REFERENCES citation_resolution_links(id) ON DELETE SET NULL,
  FOREIGN KEY (work_id) REFERENCES citation_works(id) ON DELETE SET NULL,
  FOREIGN KEY (edition_id) REFERENCES citation_editions(id) ON DELETE SET NULL,
  FOREIGN KEY (manifestation_id) REFERENCES citation_file_manifestations(id) ON DELETE SET NULL,
  FOREIGN KEY (acquisition_candidate_id) REFERENCES citation_acquisition_candidates(id) ON DELETE SET NULL,
  FOREIGN KEY (requested_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (assigned_to_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_citation_approval_queue_status
  ON citation_approval_queue(status, priority, created_at);

CREATE INDEX IF NOT EXISTS idx_citation_approval_queue_candidate
  ON citation_approval_queue(acquisition_candidate_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_citation_approval_queue_assignment
  ON citation_approval_queue(assigned_to_user_id, status, due_at);


-- ---------------------------------------------------------------------------
-- Approval events
-- Why this table exists:
-- Append-only audit trail of every operator decision on the approval queue.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS citation_approval_events (
  id TEXT PRIMARY KEY,
  approval_queue_id TEXT NOT NULL,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  event_notes TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (approval_queue_id) REFERENCES citation_approval_queue(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_citation_approval_events_queue
  ON citation_approval_events(approval_queue_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_citation_approval_events_actor
  ON citation_approval_events(actor_user_id, created_at DESC);


-- ---------------------------------------------------------------------------
-- Download jobs
-- Why this table exists:
-- Explicitly separates approved download execution from lookup/probing.
-- This is where guarded, manual, rate-limited acquisition can happen later.
--
-- Suggested statuses:
-- planned | approved | queued | running | completed | failed | blocked | cancelled
--
-- Nullable guidance:
-- manifestation_id is nullable until a concrete local artifact is created.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS citation_download_jobs (
  id TEXT PRIMARY KEY,
  acquisition_candidate_id TEXT NOT NULL,
  approval_queue_id TEXT,
  manifestation_id TEXT,
  requested_by_user_id TEXT,
  approved_by_user_id TEXT,
  status TEXT NOT NULL DEFAULT 'planned',
  download_policy TEXT NOT NULL DEFAULT 'manual_only',
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  started_at TEXT,
  finished_at TEXT,
  output_uri TEXT,
  checksum_sha256 TEXT,
  error_text TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (acquisition_candidate_id) REFERENCES citation_acquisition_candidates(id) ON DELETE RESTRICT,
  FOREIGN KEY (approval_queue_id) REFERENCES citation_approval_queue(id) ON DELETE SET NULL,
  FOREIGN KEY (manifestation_id) REFERENCES citation_file_manifestations(id) ON DELETE SET NULL,
  FOREIGN KEY (requested_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (approved_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_citation_download_jobs_status
  ON citation_download_jobs(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_citation_download_jobs_candidate
  ON citation_download_jobs(acquisition_candidate_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_citation_download_jobs_manifestation
  ON citation_download_jobs(manifestation_id, created_at DESC);


-- ---------------------------------------------------------------------------
-- Manual procurement queue
-- Why this table exists:
-- Tracks works or editions that require ordering, scanning, or later upload when
-- digital acquisition fails or remains unresolved.
--
-- Suggested statuses:
-- queued | researching | ordered | awaiting_scan | awaiting_upload | completed | closed_unavailable
--
-- Nullable guidance:
-- edition_id is nullable because some unresolved requests are only known at the
-- work level.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS citation_manual_procurement_queue (
  id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL,
  edition_id TEXT,
  approval_queue_id TEXT,
  owner_user_id TEXT,
  requested_by_user_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  reason_code TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  vendor_hint TEXT,
  estimated_cost_cents INTEGER,
  due_at TEXT,
  notes_json TEXT NOT NULL DEFAULT '[]',
  canonical_snapshot_json TEXT NOT NULL DEFAULT '{}',
  unresolved_reasons_json TEXT NOT NULL DEFAULT '[]',
  suggested_identifiers_json TEXT NOT NULL DEFAULT '[]',
  provenance_snapshot_json TEXT NOT NULL DEFAULT '[]',
  future_workflow_json TEXT NOT NULL DEFAULT '{}',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY (work_id) REFERENCES citation_works(id) ON DELETE CASCADE,
  FOREIGN KEY (edition_id) REFERENCES citation_editions(id) ON DELETE SET NULL,
  FOREIGN KEY (approval_queue_id) REFERENCES citation_approval_queue(id) ON DELETE SET NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (requested_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_citation_manual_procurement_status
  ON citation_manual_procurement_queue(status, priority, created_at);

CREATE INDEX IF NOT EXISTS idx_citation_manual_procurement_work
  ON citation_manual_procurement_queue(work_id, edition_id, status);


-- ---------------------------------------------------------------------------
-- Manual procurement events
-- Why this table exists:
-- Append-only audit log for procurement queue updates, assignments, export
-- sessions, and future scan/upload workflow progress.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS citation_manual_procurement_events (
  id TEXT PRIMARY KEY,
  procurement_queue_id TEXT NOT NULL,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  note_text TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (procurement_queue_id) REFERENCES citation_manual_procurement_queue(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_citation_manual_procurement_events_queue
  ON citation_manual_procurement_events(procurement_queue_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_citation_manual_procurement_events_actor
  ON citation_manual_procurement_events(actor_user_id, created_at DESC);


-- ---------------------------------------------------------------------------
-- Provenance / audit events
-- Why this table exists:
-- Generic append-only history across subsystem entities for lineage, operator
-- actions, run output, and future KG/OCR/embedding hooks.
--
-- Suggested event_type values:
-- observed | normalized | matched | merged | split | looked_up | candidate_recorded | approved | rejected | downloaded | procured | ocr_completed | embedded | graph_enriched
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS citation_provenance_events (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  source_system TEXT,
  source_record_type TEXT,
  source_record_id TEXT,
  processing_run_id TEXT,
  approval_queue_id TEXT,
  actor_user_id TEXT,
  event_summary TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (processing_run_id) REFERENCES citation_processing_runs(id) ON DELETE SET NULL,
  FOREIGN KEY (approval_queue_id) REFERENCES citation_approval_queue(id) ON DELETE SET NULL,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_citation_provenance_entity
  ON citation_provenance_events(entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_citation_provenance_event_type
  ON citation_provenance_events(event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_citation_provenance_run
  ON citation_provenance_events(processing_run_id, created_at DESC);
