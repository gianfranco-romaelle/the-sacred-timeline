from __future__ import annotations

import sqlite3
from contextlib import contextmanager
import os
from pathlib import Path
from typing import Callable


BASELINE_SCHEMA_SQL = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source_path TEXT NOT NULL UNIQUE,
  file_type TEXT NOT NULL,
  language TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  checksum TEXT NOT NULL,
  page_count INTEGER NOT NULL DEFAULT 0,
  node_count INTEGER NOT NULL DEFAULT 0,
  warnings_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS representation_nodes (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  parent_id TEXT,
  node_type TEXT NOT NULL,
  summary_level TEXT,
  title TEXT NOT NULL,
  heading_path TEXT NOT NULL,
  ordinal INTEGER NOT NULL DEFAULT 0,
  page_start INTEGER NOT NULL DEFAULT 1,
  page_end INTEGER NOT NULL DEFAULT 1,
  text TEXT NOT NULL,
  token_count INTEGER NOT NULL DEFAULT 0,
  language TEXT NOT NULL,
  checksum TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE VIRTUAL TABLE IF NOT EXISTS representation_nodes_fts
USING fts5(
  node_id UNINDEXED,
  document_id UNINDEXED,
  node_type UNINDEXED,
  summary_level UNINDEXED,
  title,
  heading_path,
  text,
  tokenize = 'porter unicode61'
);

CREATE TABLE IF NOT EXISTS import_jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  source_path TEXT NOT NULL,
  status TEXT NOT NULL,
  created_by TEXT,
  document_count INTEGER NOT NULL DEFAULT 0,
  options_json TEXT NOT NULL DEFAULT '{}',
  warnings_json TEXT NOT NULL DEFAULT '[]',
  error_text TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS watch_folders (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  recursive INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_scanned_at TEXT,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS research_bundles (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  query_text TEXT NOT NULL,
  mode TEXT NOT NULL,
  answer TEXT NOT NULL,
  citations_json TEXT NOT NULL DEFAULT '[]',
  evidence_json TEXT NOT NULL DEFAULT '{}',
  entities_json TEXT NOT NULL DEFAULT '[]',
  relations_json TEXT NOT NULL DEFAULT '[]',
  lens_payloads_json TEXT NOT NULL DEFAULT '{}',
  validation_json TEXT NOT NULL DEFAULT '[]',
  warnings_json TEXT NOT NULL DEFAULT '[]',
  trace_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS saved_queries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  query_text TEXT NOT NULL,
  mode TEXT NOT NULL,
  research_bundle_id TEXT,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (research_bundle_id) REFERENCES research_bundles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  document_id TEXT,
  node_id TEXT,
  entity_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS sign_tokens (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  node_id TEXT,
  label TEXT NOT NULL,
  canonical_label TEXT NOT NULL,
  frequency INTEGER NOT NULL DEFAULT 1,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sign_tokens_document ON sign_tokens(document_id);
CREATE INDEX IF NOT EXISTS idx_sign_tokens_canonical ON sign_tokens(canonical_label);

CREATE TABLE IF NOT EXISTS objects_of_reference (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  canonical_label TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_objects_canonical ON objects_of_reference(canonical_label);

CREATE TABLE IF NOT EXISTS interpretants (
  id TEXT PRIMARY KEY,
  bundle_id TEXT NOT NULL,
  user_id TEXT,
  node_id TEXT,
  parent_interpretant_id TEXT,
  depth INTEGER NOT NULL DEFAULT 0,
  summary TEXT NOT NULL,
  claims_json TEXT NOT NULL DEFAULT '[]',
  stance_json TEXT NOT NULL DEFAULT '{}',
  tone_json TEXT NOT NULL DEFAULT '{}',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (bundle_id) REFERENCES research_bundles(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_interpretants_bundle ON interpretants(bundle_id);

CREATE TABLE IF NOT EXISTS morphisms (
  id TEXT PRIMARY KEY,
  bundle_id TEXT NOT NULL,
  source_entity_id TEXT NOT NULL,
  target_entity_id TEXT NOT NULL,
  morphism_type TEXT NOT NULL,
  label TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  validation_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (bundle_id) REFERENCES research_bundles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS triads (
  id TEXT PRIMARY KEY,
  bundle_id TEXT NOT NULL,
  sign_token_id TEXT NOT NULL,
  object_id TEXT NOT NULL,
  interpretant_id TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (bundle_id) REFERENCES research_bundles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  node_id TEXT,
  label TEXT NOT NULL,
  scope TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_categories_document ON categories(document_id);

CREATE TABLE IF NOT EXISTS category_morphisms (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL,
  source_object_id TEXT NOT NULL,
  target_object_id TEXT NOT NULL,
  relation_label TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS functors (
  id TEXT PRIMARY KEY,
  bundle_id TEXT NOT NULL,
  source_category_id TEXT NOT NULL,
  target_category_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mapping_json TEXT NOT NULL DEFAULT '{}',
  validation_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (bundle_id) REFERENCES research_bundles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS natural_transformations (
  id TEXT PRIMARY KEY,
  bundle_id TEXT NOT NULL,
  source_functor_id TEXT NOT NULL,
  target_functor_id TEXT NOT NULL,
  label TEXT NOT NULL,
  components_json TEXT NOT NULL DEFAULT '[]',
  validation_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (bundle_id) REFERENCES research_bundles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS covers (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  object_id TEXT NOT NULL,
  label TEXT NOT NULL,
  node_ids_json TEXT NOT NULL DEFAULT '[]',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_covers_document ON covers(document_id);

CREATE TABLE IF NOT EXISTS restriction_maps (
  id TEXT PRIMARY KEY,
  cover_id TEXT NOT NULL,
  from_node_id TEXT NOT NULL,
  to_node_id TEXT NOT NULL,
  shared_object_id TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  validation_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (cover_id) REFERENCES covers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS gluing_constraints (
  id TEXT PRIMARY KEY,
  cover_id TEXT NOT NULL,
  object_id TEXT NOT NULL,
  label TEXT NOT NULL,
  rule_json TEXT NOT NULL DEFAULT '{}',
  validation_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (cover_id) REFERENCES covers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS obstructions (
  id TEXT PRIMARY KEY,
  cover_id TEXT NOT NULL,
  object_id TEXT NOT NULL,
  constraint_id TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'moderate',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (cover_id) REFERENCES covers(id) ON DELETE CASCADE,
  FOREIGN KEY (constraint_id) REFERENCES gluing_constraints(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS simplices (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  node_id TEXT,
  dimension INTEGER NOT NULL,
  object_ids_json TEXT NOT NULL DEFAULT '[]',
  weight REAL NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_simplices_document ON simplices(document_id);

CREATE TABLE IF NOT EXISTS catastrophe_events (
  id TEXT PRIMARY KEY,
  bundle_id TEXT NOT NULL,
  label TEXT NOT NULL,
  event_type TEXT NOT NULL,
  control_axis_json TEXT NOT NULL DEFAULT '{}',
  state_axis_json TEXT NOT NULL DEFAULT '{}',
  payload_json TEXT NOT NULL DEFAULT '{}',
  validation_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (bundle_id) REFERENCES research_bundles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS research_maps (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  bundle_id TEXT,
  source_kind TEXT,
  source_ref TEXT,
  layout_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (bundle_id) REFERENCES research_bundles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS research_map_pins (
  id TEXT PRIMARY KEY,
  map_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  pin_type TEXT NOT NULL,
  position_json TEXT NOT NULL DEFAULT '{}',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (map_id) REFERENCES research_maps(id) ON DELETE CASCADE
);
"""


PIPELINE_RUNTIME_SQL = """
CREATE TABLE IF NOT EXISTS pipeline_tasks (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  status TEXT NOT NULL,
  progress_completed INTEGER NOT NULL DEFAULT 0,
  progress_total INTEGER NOT NULL DEFAULT 0,
  warnings_json TEXT NOT NULL DEFAULT '[]',
  error_code TEXT,
  error_text TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  FOREIGN KEY (job_id) REFERENCES import_jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pipeline_tasks_job ON pipeline_tasks(job_id, sequence);
CREATE INDEX IF NOT EXISTS idx_pipeline_tasks_status ON pipeline_tasks(status);

CREATE TABLE IF NOT EXISTS watched_files (
  id TEXT PRIMARY KEY,
  watch_folder_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  modified_at TEXT,
  checksum TEXT,
  last_seen_at TEXT NOT NULL,
  last_import_job_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (watch_folder_id, file_path),
  FOREIGN KEY (watch_folder_id) REFERENCES watch_folders(id) ON DELETE CASCADE,
  FOREIGN KEY (last_import_job_id) REFERENCES import_jobs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_watched_files_folder ON watched_files(watch_folder_id);
"""


POLYNOMIAL_TECHNIQUE_SQL = """
CREATE TABLE IF NOT EXISTS forecast_techniques (
  id TEXT PRIMARY KEY,
  technique TEXT NOT NULL,
  category TEXT NOT NULL,
  forecast_target TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  short_definition TEXT NOT NULL,
  purpose TEXT NOT NULL,
  required_inputs_json TEXT NOT NULL DEFAULT '[]',
  optional_inputs_json TEXT NOT NULL DEFAULT '[]',
  outputs_json TEXT NOT NULL DEFAULT '[]',
  time_horizon TEXT NOT NULL DEFAULT '',
  frequency_assumptions TEXT NOT NULL DEFAULT '',
  mathematical_logic TEXT NOT NULL DEFAULT '',
  algorithm_json TEXT NOT NULL DEFAULT '[]',
  assumptions_json TEXT NOT NULL DEFAULT '[]',
  strengths_json TEXT NOT NULL DEFAULT '[]',
  weaknesses_json TEXT NOT NULL DEFAULT '[]',
  failure_modes_json TEXT NOT NULL DEFAULT '[]',
  common_mistakes_json TEXT NOT NULL DEFAULT '[]',
  minimum_viable_version TEXT NOT NULL DEFAULT '',
  advanced_version TEXT NOT NULL DEFAULT '',
  implementation_status TEXT NOT NULL DEFAULT 'template_only',
  adaptation_status TEXT NOT NULL DEFAULT 'unclassified',
  best_use_case TEXT NOT NULL DEFAULT '',
  key_limitation TEXT NOT NULL DEFAULT '',
  confidence_level TEXT NOT NULL DEFAULT 'medium',
  source_reference_hint TEXT NOT NULL DEFAULT '',
  pseudocode TEXT NOT NULL DEFAULT '',
  implementation_notes_json TEXT NOT NULL DEFAULT '[]',
  validation_checks_json TEXT NOT NULL DEFAULT '[]',
  unit_test_ideas_json TEXT NOT NULL DEFAULT '[]',
  backtesting_procedure_json TEXT NOT NULL DEFAULT '[]',
  spreadsheet_logic TEXT NOT NULL DEFAULT '',
  connections_json TEXT NOT NULL DEFAULT '[]',
  inputs_summary TEXT NOT NULL DEFAULT '',
  outputs_summary TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS forecast_technique_sources (
  id TEXT PRIMARY KEY,
  technique_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  node_id TEXT,
  source_label TEXT NOT NULL,
  page_start INTEGER NOT NULL DEFAULT 1,
  page_end INTEGER NOT NULL DEFAULT 1,
  reference_text TEXT NOT NULL DEFAULT '',
  source_reference TEXT NOT NULL DEFAULT '',
  variation_type TEXT NOT NULL DEFAULT 'conceptual',
  evidence_score REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (technique_id) REFERENCES forecast_techniques(id) ON DELETE CASCADE,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (node_id) REFERENCES representation_nodes(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_forecast_technique_sources_document ON forecast_technique_sources(document_id, technique_id);

CREATE TABLE IF NOT EXISTS forecast_technique_assets (
  id TEXT PRIMARY KEY,
  technique_id TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  label TEXT NOT NULL,
  path TEXT NOT NULL,
  symbol TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (technique_id) REFERENCES forecast_techniques(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_forecast_technique_assets_technique ON forecast_technique_assets(technique_id);

CREATE TABLE IF NOT EXISTS forecast_technique_adaptations (
  id TEXT PRIMARY KEY,
  technique_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  forecast_targets_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (technique_id) REFERENCES forecast_techniques(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_forecast_technique_adaptations_technique ON forecast_technique_adaptations(technique_id);

CREATE TABLE IF NOT EXISTS forecast_technique_validation_cases (
  id TEXT PRIMARY KEY,
  technique_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  expected_outcome TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (technique_id) REFERENCES forecast_techniques(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_forecast_technique_validation_cases_technique ON forecast_technique_validation_cases(technique_id);
"""


PHARMA_EVENT_TOPOS_SQL = """
CREATE TABLE IF NOT EXISTS pharma_events (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  ticker TEXT NOT NULL,
  company TEXT NOT NULL DEFAULT '',
  event_at TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL DEFAULT 'corporate',
  trial_phase TEXT NOT NULL DEFAULT '',
  indication TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  press_release_url TEXT NOT NULL DEFAULT '',
  press_release_text TEXT NOT NULL DEFAULT '',
  ingest_hash TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (source, ingest_hash)
);

CREATE INDEX IF NOT EXISTS idx_pharma_events_ticker ON pharma_events(ticker, event_at DESC);
CREATE INDEX IF NOT EXISTS idx_pharma_events_source ON pharma_events(source, event_at DESC);

CREATE TABLE IF NOT EXISTS pharma_cycles (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  benchmark_symbol TEXT NOT NULL DEFAULT 'XBI',
  scope_json TEXT NOT NULL DEFAULT '{}',
  request_json TEXT NOT NULL DEFAULT '{}',
  dataset_summary_json TEXT NOT NULL DEFAULT '{}',
  summary_json TEXT NOT NULL DEFAULT '{}',
  artifact_path TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_pharma_cycles_created ON pharma_cycles(created_at DESC);

CREATE TABLE IF NOT EXISTS pharma_cycle_candidates (
  id TEXT PRIMARY KEY,
  cycle_id TEXT NOT NULL,
  candidate_key TEXT NOT NULL,
  family_key TEXT NOT NULL DEFAULT '',
  candidate_type TEXT NOT NULL DEFAULT 'candidate',
  status TEXT NOT NULL DEFAULT 'candidate',
  metrics_json TEXT NOT NULL DEFAULT '{}',
  folds_json TEXT NOT NULL DEFAULT '[]',
  warnings_json TEXT NOT NULL DEFAULT '[]',
  artifact_path TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (cycle_id) REFERENCES pharma_cycles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pharma_cycle_candidates_cycle ON pharma_cycle_candidates(cycle_id);
CREATE INDEX IF NOT EXISTS idx_pharma_cycle_candidates_key ON pharma_cycle_candidates(candidate_key, created_at DESC);

CREATE TABLE IF NOT EXISTS pharma_homologations (
  id TEXT PRIMARY KEY,
  candidate_key TEXT NOT NULL UNIQUE,
  family_key TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'candidate',
  metrics_json TEXT NOT NULL DEFAULT '{}',
  reasons_json TEXT NOT NULL DEFAULT '[]',
  last_cycle_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (last_cycle_id) REFERENCES pharma_cycles(id) ON DELETE SET NULL
);
"""


COREYDIGS_DOSSIER_SQL = """
CREATE TABLE IF NOT EXISTS dossier_assertions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  source_key TEXT NOT NULL DEFAULT '',
  normalized_title TEXT NOT NULL DEFAULT '',
  dedupe_key TEXT NOT NULL DEFAULT '',
  source_node_id TEXT,
  assertion_text TEXT NOT NULL,
  summary TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT '',
  institution TEXT NOT NULL DEFAULT '',
  topic_tags_json TEXT NOT NULL DEFAULT '[]',
  evidence_tags_json TEXT NOT NULL DEFAULT '[]',
  stance TEXT NOT NULL DEFAULT 'allegation',
  is_dated INTEGER NOT NULL DEFAULT 0,
  asserted_at TEXT,
  confidence REAL NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (source_node_id) REFERENCES representation_nodes(id) ON DELETE SET NULL,
  UNIQUE(document_id, source_node_id, summary)
);

CREATE INDEX IF NOT EXISTS idx_dossier_assertions_document ON dossier_assertions(document_id);
CREATE INDEX IF NOT EXISTS idx_dossier_assertions_dedupe ON dossier_assertions(dedupe_key);
CREATE INDEX IF NOT EXISTS idx_dossier_assertions_asserted_at ON dossier_assertions(asserted_at);

CREATE TABLE IF NOT EXISTS dossier_entities (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  label TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  canonical_label TEXT NOT NULL,
  mention_count INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  UNIQUE(document_id, entity_type, canonical_label)
);

CREATE INDEX IF NOT EXISTS idx_dossier_entities_document ON dossier_entities(document_id);
CREATE INDEX IF NOT EXISTS idx_dossier_entities_canonical ON dossier_entities(canonical_label);

CREATE TABLE IF NOT EXISTS dossier_signal_windows (
  id TEXT PRIMARY KEY,
  window_date TEXT NOT NULL,
  topic_key TEXT NOT NULL DEFAULT 'all',
  signal_key TEXT NOT NULL,
  value REAL NOT NULL DEFAULT 0,
  support_count INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(window_date, topic_key, signal_key)
);

CREATE INDEX IF NOT EXISTS idx_dossier_signal_windows_date ON dossier_signal_windows(window_date);
CREATE INDEX IF NOT EXISTS idx_dossier_signal_windows_topic ON dossier_signal_windows(topic_key);
"""


ACTIVITY_CENTER_SQL = """
CREATE TABLE IF NOT EXISTS activity_signals (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  source_module TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  entity_id TEXT,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  severity TEXT NOT NULL DEFAULT 'info',
  visibility TEXT NOT NULL DEFAULT 'public',
  signal_state TEXT NOT NULL DEFAULT 'active',
  review_state TEXT NOT NULL DEFAULT 'pending',
  note TEXT NOT NULL DEFAULT '',
  snooze_until TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  origin TEXT NOT NULL DEFAULT 'derived',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_activity_signals_module ON activity_signals(user_id, source_module, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_signals_review ON activity_signals(user_id, review_state, updated_at DESC);

CREATE TABLE IF NOT EXISTS activity_reviews (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  signal_id TEXT NOT NULL,
  action TEXT NOT NULL,
  review_state TEXT NOT NULL,
  visibility TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  snooze_until TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_activity_reviews_signal ON activity_reviews(user_id, signal_id, created_at DESC);

CREATE TABLE IF NOT EXISTS activity_git_profiles (
  user_id TEXT PRIMARY KEY,
  repo_path TEXT NOT NULL,
  export_subdir TEXT NOT NULL DEFAULT 'activity-exports',
  branch_name TEXT,
  valid INTEGER NOT NULL DEFAULT 0,
  last_validated_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS activity_private_exports (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  signal_id TEXT NOT NULL,
  review_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  visibility TEXT NOT NULL DEFAULT 'private',
  file_relpath TEXT,
  content_json TEXT NOT NULL DEFAULT '{}',
  commit_hash TEXT,
  error_text TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  committed_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_activity_private_exports_user ON activity_private_exports(user_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_private_exports_signal ON activity_private_exports(user_id, signal_id, updated_at DESC);
"""


MATH_EXTRACTION_SQL = """
CREATE TABLE IF NOT EXISTS math_artifacts (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  page_number INTEGER NOT NULL DEFAULT 1,
  source_ref TEXT NOT NULL DEFAULT '',
  region_box_json TEXT,
  image_path TEXT,
  raw_text TEXT NOT NULL DEFAULT '',
  latex TEXT,
  confidence REAL NOT NULL DEFAULT 0,
  provider_name TEXT NOT NULL DEFAULT '',
  selected_provider TEXT NOT NULL DEFAULT '',
  model_name TEXT,
  extraction_mode TEXT NOT NULL DEFAULT 'native_math',
  provider_attempts_json TEXT NOT NULL DEFAULT '[]',
  normalized_latex TEXT,
  mathml TEXT,
  handwriting_likelihood REAL NOT NULL DEFAULT 0,
  quality_tier TEXT NOT NULL DEFAULT 'heuristic',
  retry_state TEXT NOT NULL DEFAULT 'idle',
  warnings_json TEXT NOT NULL DEFAULT '[]',
  validation_state TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_math_artifacts_document ON math_artifacts(document_id, page_number);

CREATE TABLE IF NOT EXISTS math_regions (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL,
  page_number INTEGER NOT NULL DEFAULT 1,
  region_index INTEGER NOT NULL DEFAULT 1,
  bbox_json TEXT,
  image_path TEXT,
  raw_text TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL DEFAULT 0,
  provider_attempts_json TEXT NOT NULL DEFAULT '[]',
  handwriting_likelihood REAL NOT NULL DEFAULT 0,
  quality_tier TEXT NOT NULL DEFAULT 'region',
  status TEXT NOT NULL DEFAULT 'pending',
  warnings_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (artifact_id) REFERENCES math_artifacts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_math_regions_artifact ON math_regions(artifact_id, region_index);

CREATE TABLE IF NOT EXISTS math_formulae (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL,
  region_id TEXT,
  document_id TEXT NOT NULL,
  node_id TEXT,
  page_number INTEGER NOT NULL DEFAULT 1,
  label TEXT NOT NULL DEFAULT '',
  raw_text TEXT NOT NULL DEFAULT '',
  latex TEXT,
  confidence REAL NOT NULL DEFAULT 0,
  provider_name TEXT NOT NULL DEFAULT '',
  selected_provider TEXT NOT NULL DEFAULT '',
  model_name TEXT,
  extraction_mode TEXT NOT NULL DEFAULT 'native_math',
  provider_attempts_json TEXT NOT NULL DEFAULT '[]',
  normalized_latex TEXT,
  mathml TEXT,
  handwriting_likelihood REAL NOT NULL DEFAULT 0,
  quality_tier TEXT NOT NULL DEFAULT 'heuristic',
  retry_state TEXT NOT NULL DEFAULT 'idle',
  validation_status TEXT NOT NULL DEFAULT 'pending',
  warnings_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (artifact_id) REFERENCES math_artifacts(id) ON DELETE CASCADE,
  FOREIGN KEY (region_id) REFERENCES math_regions(id) ON DELETE SET NULL,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (node_id) REFERENCES representation_nodes(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_math_formulae_document ON math_formulae(document_id, page_number);
CREATE INDEX IF NOT EXISTS idx_math_formulae_validation ON math_formulae(validation_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS math_formula_links (
  id TEXT PRIMARY KEY,
  formula_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  region_id TEXT,
  document_id TEXT NOT NULL,
  node_id TEXT,
  link_type TEXT NOT NULL DEFAULT 'page',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (formula_id) REFERENCES math_formulae(id) ON DELETE CASCADE,
  FOREIGN KEY (artifact_id) REFERENCES math_artifacts(id) ON DELETE CASCADE,
  FOREIGN KEY (region_id) REFERENCES math_regions(id) ON DELETE SET NULL,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (node_id) REFERENCES representation_nodes(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_math_formula_links_formula ON math_formula_links(formula_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_math_formula_links_document ON math_formula_links(document_id, updated_at DESC);
"""


CITATION_MINING_SQL = """
CREATE TABLE IF NOT EXISTS citation_entries (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  node_id TEXT,
  page_number INTEGER NOT NULL DEFAULT 1,
  section_label TEXT NOT NULL DEFAULT '',
  raw_text TEXT NOT NULL DEFAULT '',
  normalized_text TEXT NOT NULL DEFAULT '',
  entry_type TEXT NOT NULL DEFAULT 'bibliography',
  authors_json TEXT NOT NULL DEFAULT '[]',
  title TEXT,
  year TEXT,
  container_title TEXT,
  publisher TEXT,
  volume TEXT,
  issue TEXT,
  pages TEXT,
  doi TEXT,
  url TEXT,
  isbn TEXT,
  confidence REAL NOT NULL DEFAULT 0,
  parse_status TEXT NOT NULL DEFAULT 'parsed',
  warnings_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (node_id) REFERENCES representation_nodes(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_citation_entries_document ON citation_entries(document_id, page_number);
CREATE INDEX IF NOT EXISTS idx_citation_entries_doi ON citation_entries(doi);

CREATE TABLE IF NOT EXISTS citation_mentions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  node_id TEXT,
  page_number INTEGER NOT NULL DEFAULT 1,
  mention_text TEXT NOT NULL DEFAULT '',
  normalized_text TEXT NOT NULL DEFAULT '',
  mention_type TEXT NOT NULL DEFAULT 'inline',
  target_label TEXT,
  target_year TEXT,
  raw_marker TEXT,
  confidence REAL NOT NULL DEFAULT 0,
  match_status TEXT NOT NULL DEFAULT 'unresolved',
  warnings_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (node_id) REFERENCES representation_nodes(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_citation_mentions_document ON citation_mentions(document_id, page_number);
CREATE INDEX IF NOT EXISTS idx_citation_mentions_match ON citation_mentions(match_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS footnote_artifacts (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  node_id TEXT,
  page_number INTEGER NOT NULL DEFAULT 1,
  note_label TEXT NOT NULL DEFAULT '',
  raw_text TEXT NOT NULL DEFAULT '',
  normalized_text TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'mixed',
  confidence REAL NOT NULL DEFAULT 0,
  citations_detected INTEGER NOT NULL DEFAULT 0,
  commentary_detected INTEGER NOT NULL DEFAULT 0,
  warnings_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (node_id) REFERENCES representation_nodes(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_footnote_artifacts_document ON footnote_artifacts(document_id, page_number);

CREATE TABLE IF NOT EXISTS footnote_spans (
  id TEXT PRIMARY KEY,
  footnote_id TEXT NOT NULL,
  span_index INTEGER NOT NULL DEFAULT 1,
  span_kind TEXT NOT NULL DEFAULT 'unknown',
  text TEXT NOT NULL DEFAULT '',
  normalized_text TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL DEFAULT 0,
  citation_entry_id TEXT,
  citation_mention_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (footnote_id) REFERENCES footnote_artifacts(id) ON DELETE CASCADE,
  FOREIGN KEY (citation_entry_id) REFERENCES citation_entries(id) ON DELETE SET NULL,
  FOREIGN KEY (citation_mention_id) REFERENCES citation_mentions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_footnote_spans_footnote ON footnote_spans(footnote_id, span_index);

CREATE TABLE IF NOT EXISTS citation_links (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  source_kind TEXT NOT NULL DEFAULT 'mention',
  source_id TEXT NOT NULL,
  target_kind TEXT NOT NULL DEFAULT 'entry',
  target_id TEXT NOT NULL,
  link_type TEXT NOT NULL DEFAULT 'candidate_match',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_citation_links_document ON citation_links(document_id, source_kind, target_kind);
"""


RESEARCH_GRAPH_MATERIALIZATION_SQL = """
CREATE TABLE IF NOT EXISTS research_graph_nodes (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  graph_type TEXT NOT NULL,
  source_table TEXT NOT NULL,
  source_id TEXT NOT NULL,
  label TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(document_id, source_table, source_id),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_research_graph_nodes_document ON research_graph_nodes(document_id, graph_type);

CREATE TABLE IF NOT EXISTS research_graph_edges (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  edge_type TEXT NOT NULL,
  source_node_ref TEXT NOT NULL,
  target_node_ref TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  weight REAL NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_research_graph_edges_document ON research_graph_edges(document_id, edge_type);

CREATE TABLE IF NOT EXISTS technique_materializations (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  family_key TEXT NOT NULL,
  technique_count INTEGER NOT NULL DEFAULT 0,
  source_count INTEGER NOT NULL DEFAULT 0,
  asset_count INTEGER NOT NULL DEFAULT 0,
  adaptation_count INTEGER NOT NULL DEFAULT 0,
  validation_case_count INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(document_id, family_key),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_technique_materializations_document ON technique_materializations(document_id, family_key);
"""


MigrationFn = Callable[[sqlite3.Connection], None]


def _load_citations_schema_sql() -> str:
  schema_path = Path(__file__).resolve().parent / "citations" / "schema.sql"
  return schema_path.read_text(encoding="utf-8")


def _normalize_database_path(path_text: str) -> str:
  try:
    candidate = Path(path_text).expanduser().resolve(strict=False)
  except Exception:
    candidate = Path(os.path.abspath(path_text))
  return os.path.normcase(os.path.normpath(str(candidate)))


def create_connection(database_path: Path) -> sqlite3.Connection:
  database_path.parent.mkdir(parents=True, exist_ok=True)
  connection = sqlite3.connect(database_path, timeout=30.0, isolation_level=None)
  connection.row_factory = sqlite3.Row
  connection.execute("PRAGMA foreign_keys = ON;")
  connection.execute("PRAGMA journal_mode = WAL;")
  connection.execute("PRAGMA synchronous = NORMAL;")
  connection.execute("PRAGMA busy_timeout = 30000;")
  return connection


def _ensure_column(connection: sqlite3.Connection, table_name: str, column_name: str, definition: str) -> None:
  columns = {row["name"] for row in connection.execute(f"PRAGMA table_info({table_name})").fetchall()}
  if column_name in columns:
    return
  try:
    connection.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}")
  except sqlite3.OperationalError as error:
    if "duplicate column name" not in str(error).lower():
      raise


def _ensure_schema_migrations_table(connection: sqlite3.Connection) -> None:
  connection.execute(
    """
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
    """
  )


def _migration_001_baseline(connection: sqlite3.Connection) -> None:
  connection.executescript(BASELINE_SCHEMA_SQL)


def _migration_002_pipeline_runtime(connection: sqlite3.Connection) -> None:
  connection.executescript(PIPELINE_RUNTIME_SQL)
  _ensure_column(connection, "documents", "extraction_status", "TEXT NOT NULL DEFAULT 'pending'")
  _ensure_column(connection, "documents", "index_status", "TEXT NOT NULL DEFAULT 'pending'")
  _ensure_column(connection, "documents", "extraction_metadata_json", "TEXT NOT NULL DEFAULT '{}'")
  _ensure_column(connection, "documents", "pipeline_version", "TEXT")
  _ensure_column(connection, "documents", "last_indexed_at", "TEXT")
  _ensure_column(connection, "import_jobs", "current_stage", "TEXT")
  _ensure_column(connection, "import_jobs", "progress_completed", "INTEGER NOT NULL DEFAULT 0")
  _ensure_column(connection, "import_jobs", "progress_total", "INTEGER NOT NULL DEFAULT 0")
  _ensure_column(connection, "import_jobs", "stage_warnings_json", "TEXT NOT NULL DEFAULT '[]'")
  _ensure_column(connection, "import_jobs", "error_code", "TEXT")
  _ensure_column(connection, "import_jobs", "state_json", "TEXT NOT NULL DEFAULT '{}'")
  _ensure_column(connection, "watch_folders", "error_text", "TEXT")
  connection.execute(
    """
    UPDATE documents
    SET extraction_status = CASE WHEN page_count > 0 THEN 'extracted' ELSE 'pending' END
    WHERE COALESCE(extraction_status, '') = ''
    """
  )
  connection.execute(
    """
    UPDATE documents
    SET index_status = CASE WHEN status IN ('indexed', 'completed') THEN 'indexed' ELSE 'pending' END
    WHERE COALESCE(index_status, '') = ''
    """
  )
  connection.execute(
    """
    UPDATE documents
    SET extraction_metadata_json = '{}'
    WHERE COALESCE(extraction_metadata_json, '') = ''
    """
  )
  connection.execute(
    """
    UPDATE import_jobs
    SET stage_warnings_json = COALESCE(NULLIF(stage_warnings_json, ''), warnings_json, '[]')
    WHERE COALESCE(stage_warnings_json, '') = ''
    """
  )
  connection.execute(
    """
    UPDATE import_jobs
    SET state_json = '{}'
    WHERE COALESCE(state_json, '') = ''
    """
  )


def _migration_003_polynomial_techniques(connection: sqlite3.Connection) -> None:
  connection.executescript(POLYNOMIAL_TECHNIQUE_SQL)


def _migration_004_forecast_technique_families(connection: sqlite3.Connection) -> None:
  _ensure_column(connection, "forecast_techniques", "family_key", "TEXT NOT NULL DEFAULT 'polynomial'")
  _ensure_column(connection, "forecast_techniques", "family_title", "TEXT NOT NULL DEFAULT 'Polynomial Forecasting Methods'")
  _ensure_column(connection, "forecast_technique_sources", "section_title", "TEXT NOT NULL DEFAULT ''")
  connection.execute(
    """
    UPDATE forecast_techniques
    SET family_key = 'polynomial'
    WHERE COALESCE(family_key, '') = ''
    """
  )
  connection.execute(
    """
    UPDATE forecast_techniques
    SET family_title = 'Polynomial Forecasting Methods'
    WHERE COALESCE(family_title, '') = ''
    """
  )
  connection.execute(
    """
    UPDATE forecast_technique_sources
    SET section_title = source_label
    WHERE COALESCE(section_title, '') = ''
    """
  )


def _migration_005_pharma_event_topos(connection: sqlite3.Connection) -> None:
  connection.executescript(PHARMA_EVENT_TOPOS_SQL)


def _migration_006_coreydigs_dossiers(connection: sqlite3.Connection) -> None:
  connection.executescript(COREYDIGS_DOSSIER_SQL)


def _migration_007_activity_center(connection: sqlite3.Connection) -> None:
  connection.executescript(ACTIVITY_CENTER_SQL)


def _migration_008_research_map_sources(connection: sqlite3.Connection) -> None:
  _ensure_column(connection, "research_maps", "source_kind", "TEXT")
  _ensure_column(connection, "research_maps", "source_ref", "TEXT")
  connection.execute(
    """
    CREATE INDEX IF NOT EXISTS idx_research_maps_source
    ON research_maps(user_id, source_kind, source_ref)
    """
  )


def _migration_009_math_extraction(connection: sqlite3.Connection) -> None:
  connection.executescript(MATH_EXTRACTION_SQL)


def _migration_010_math_provider_metadata(connection: sqlite3.Connection) -> None:
  _ensure_column(connection, "math_artifacts", "selected_provider", "TEXT NOT NULL DEFAULT ''")
  _ensure_column(connection, "math_artifacts", "provider_attempts_json", "TEXT NOT NULL DEFAULT '[]'")
  _ensure_column(connection, "math_artifacts", "normalized_latex", "TEXT")
  _ensure_column(connection, "math_artifacts", "mathml", "TEXT")
  _ensure_column(connection, "math_artifacts", "handwriting_likelihood", "REAL NOT NULL DEFAULT 0")
  _ensure_column(connection, "math_artifacts", "quality_tier", "TEXT NOT NULL DEFAULT 'heuristic'")
  _ensure_column(connection, "math_artifacts", "retry_state", "TEXT NOT NULL DEFAULT 'idle'")
  _ensure_column(connection, "math_regions", "provider_attempts_json", "TEXT NOT NULL DEFAULT '[]'")
  _ensure_column(connection, "math_regions", "handwriting_likelihood", "REAL NOT NULL DEFAULT 0")
  _ensure_column(connection, "math_regions", "quality_tier", "TEXT NOT NULL DEFAULT 'region'")
  _ensure_column(connection, "math_formulae", "selected_provider", "TEXT NOT NULL DEFAULT ''")
  _ensure_column(connection, "math_formulae", "provider_attempts_json", "TEXT NOT NULL DEFAULT '[]'")
  _ensure_column(connection, "math_formulae", "normalized_latex", "TEXT")
  _ensure_column(connection, "math_formulae", "mathml", "TEXT")
  _ensure_column(connection, "math_formulae", "handwriting_likelihood", "REAL NOT NULL DEFAULT 0")
  _ensure_column(connection, "math_formulae", "quality_tier", "TEXT NOT NULL DEFAULT 'heuristic'")
  _ensure_column(connection, "math_formulae", "retry_state", "TEXT NOT NULL DEFAULT 'idle'")
  connection.execute(
    """
    CREATE INDEX IF NOT EXISTS idx_math_formulae_retry
    ON math_formulae(retry_state, updated_at DESC)
    """
  )


def _migration_011_research_graph_materializations(connection: sqlite3.Connection) -> None:
  connection.executescript(RESEARCH_GRAPH_MATERIALIZATION_SQL)


def _migration_012_citation_mining(connection: sqlite3.Connection) -> None:
  connection.executescript(CITATION_MINING_SQL)


def _migration_013_tracked_file_ledger(connection: sqlite3.Connection) -> None:
  connection.execute(
    """
    CREATE TABLE IF NOT EXISTS tracked_files (
      id TEXT PRIMARY KEY,
      root_watch_folder_id TEXT,
      absolute_path TEXT NOT NULL UNIQUE,
      relative_path TEXT NOT NULL DEFAULT '',
      extension TEXT NOT NULL DEFAULT '',
      size_bytes INTEGER NOT NULL DEFAULT 0,
      mtime TEXT,
      checksum_sha1 TEXT,
      discovered_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      last_import_job_id TEXT,
      extraction_status TEXT NOT NULL DEFAULT 'pending',
      ocr_status TEXT NOT NULL DEFAULT 'pending',
      chunk_status TEXT NOT NULL DEFAULT 'pending',
      embedding_status TEXT NOT NULL DEFAULT 'pending',
      index_status TEXT NOT NULL DEFAULT 'pending',
      overall_status TEXT NOT NULL DEFAULT 'discovered',
      stale INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (root_watch_folder_id) REFERENCES watch_folders(id) ON DELETE SET NULL,
      FOREIGN KEY (last_import_job_id) REFERENCES import_jobs(id) ON DELETE SET NULL
    )
    """
  )
  connection.execute(
    """
    CREATE TABLE IF NOT EXISTS tracked_file_events (
      id TEXT PRIMARY KEY,
      tracked_file_id TEXT NOT NULL,
      import_job_id TEXT,
      stage TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      event_fingerprint TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (tracked_file_id) REFERENCES tracked_files(id) ON DELETE CASCADE,
      FOREIGN KEY (import_job_id) REFERENCES import_jobs(id) ON DELETE SET NULL
    )
    """
  )
  connection.execute("CREATE INDEX IF NOT EXISTS idx_tracked_files_status ON tracked_files(overall_status, stale, updated_at DESC)")
  connection.execute("CREATE INDEX IF NOT EXISTS idx_tracked_files_watch_folder ON tracked_files(root_watch_folder_id, relative_path)")
  connection.execute("CREATE INDEX IF NOT EXISTS idx_tracked_files_import_job ON tracked_files(last_import_job_id, overall_status)")
  connection.execute("CREATE INDEX IF NOT EXISTS idx_tracked_file_events_file ON tracked_file_events(tracked_file_id, created_at DESC)")

  watched_rows = connection.execute(
    """
    SELECT id, watch_folder_id, file_path, relative_path, size_bytes, modified_at, checksum, last_seen_at, last_import_job_id, created_at, updated_at
    FROM watched_files
    ORDER BY created_at ASC, id ASC
    """
  ).fetchall()
  for row in watched_rows:
    absolute_path = str(row["file_path"] or "").strip()
    if not absolute_path:
      continue
    absolute_path = _normalize_database_path(absolute_path)
    current = connection.execute("SELECT id FROM tracked_files WHERE absolute_path = ?", (absolute_path,)).fetchone()
    if current is not None:
      continue
    overall_status = "pending_import" if row["last_import_job_id"] else "discovered"
    connection.execute(
      """
      INSERT OR IGNORE INTO tracked_files (
        id, root_watch_folder_id, absolute_path, relative_path, extension, size_bytes, mtime, checksum_sha1,
        discovered_at, last_seen_at, last_import_job_id, extraction_status, ocr_status, chunk_status,
        embedding_status, index_status, overall_status, stale, error_message, metadata_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'pending', 'pending', 'pending', 'pending', ?, 0, NULL, '{}', ?, ?)
      """,
      (
        f"tf-{row['id']}",
        row["watch_folder_id"],
        absolute_path,
        row["relative_path"] or "",
        Path(absolute_path).suffix.lower(),
        int(row["size_bytes"] or 0),
        row["modified_at"],
        row["checksum"],
        row["created_at"] or row["last_seen_at"],
        row["last_seen_at"] or row["updated_at"] or row["created_at"],
        row["last_import_job_id"],
        overall_status,
        row["created_at"] or row["last_seen_at"],
        row["updated_at"] or row["last_seen_at"] or row["created_at"],
      ),
    )


def _migration_014_hybrid_watch_metrics(connection: sqlite3.Connection) -> None:
  _ensure_column(connection, "watch_folders", "include_extensions_json", "TEXT NOT NULL DEFAULT '[]'")
  _ensure_column(connection, "watch_folders", "exclude_globs_json", "TEXT NOT NULL DEFAULT '[]'")
  _ensure_column(connection, "watch_folders", "last_scan_started_at", "TEXT")
  _ensure_column(connection, "watch_folders", "last_scan_finished_at", "TEXT")
  _ensure_column(connection, "watch_folders", "files_seen", "INTEGER NOT NULL DEFAULT 0")
  _ensure_column(connection, "watch_folders", "files_added", "INTEGER NOT NULL DEFAULT 0")
  _ensure_column(connection, "watch_folders", "files_changed", "INTEGER NOT NULL DEFAULT 0")
  _ensure_column(connection, "watch_folders", "files_deleted", "INTEGER NOT NULL DEFAULT 0")
  _ensure_column(connection, "watch_folders", "scan_errors", "INTEGER NOT NULL DEFAULT 0")
  _ensure_column(connection, "watch_folders", "watch_backend", "TEXT NOT NULL DEFAULT 'polling'")
  _ensure_column(connection, "watch_folders", "last_event_at", "TEXT")
  _ensure_column(connection, "watch_folders", "last_event_summary_json", "TEXT NOT NULL DEFAULT '{}'")
  connection.execute(
    """
    UPDATE watch_folders
    SET include_extensions_json = '[]'
    WHERE COALESCE(include_extensions_json, '') = ''
    """
  )
  connection.execute(
    """
    UPDATE watch_folders
    SET exclude_globs_json = '[]'
    WHERE COALESCE(exclude_globs_json, '') = ''
    """
  )
  connection.execute(
    """
    UPDATE watch_folders
    SET last_event_summary_json = '{}'
    WHERE COALESCE(last_event_summary_json, '') = ''
    """
  )


def _migration_015_citation_acquisition(connection: sqlite3.Connection) -> None:
  connection.executescript(_load_citations_schema_sql())


def _migration_016_citation_procurement_queue_enrichment(connection: sqlite3.Connection) -> None:
  _ensure_column(connection, "citation_manual_procurement_queue", "canonical_snapshot_json", "TEXT NOT NULL DEFAULT '{}'")
  _ensure_column(connection, "citation_manual_procurement_queue", "unresolved_reasons_json", "TEXT NOT NULL DEFAULT '[]'")
  _ensure_column(connection, "citation_manual_procurement_queue", "suggested_identifiers_json", "TEXT NOT NULL DEFAULT '[]'")
  _ensure_column(connection, "citation_manual_procurement_queue", "provenance_snapshot_json", "TEXT NOT NULL DEFAULT '[]'")
  _ensure_column(connection, "citation_manual_procurement_queue", "future_workflow_json", "TEXT NOT NULL DEFAULT '{}'")
  connection.execute(
    """
    UPDATE citation_manual_procurement_queue
    SET canonical_snapshot_json = '{}'
    WHERE COALESCE(canonical_snapshot_json, '') = ''
    """
  )
  connection.execute(
    """
    UPDATE citation_manual_procurement_queue
    SET unresolved_reasons_json = json_array(json_object('code', reason_code))
    WHERE COALESCE(unresolved_reasons_json, '') = ''
    """
  )
  connection.execute(
    """
    UPDATE citation_manual_procurement_queue
    SET suggested_identifiers_json = '[]'
    WHERE COALESCE(suggested_identifiers_json, '') = ''
    """
  )
  connection.execute(
    """
    UPDATE citation_manual_procurement_queue
    SET provenance_snapshot_json = '[]'
    WHERE COALESCE(provenance_snapshot_json, '') = ''
    """
  )
  connection.execute(
    """
    UPDATE citation_manual_procurement_queue
    SET future_workflow_json = '{}'
    WHERE COALESCE(future_workflow_json, '') = ''
    """
  )
  connection.execute(
    """
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
    )
    """
  )
  connection.execute(
    """
    CREATE INDEX IF NOT EXISTS idx_citation_manual_procurement_events_queue
      ON citation_manual_procurement_events(procurement_queue_id, created_at DESC)
    """
  )
  connection.execute(
    """
    CREATE INDEX IF NOT EXISTS idx_citation_manual_procurement_events_actor
      ON citation_manual_procurement_events(actor_user_id, created_at DESC)
    """
  )


MIGRATIONS: list[tuple[str, MigrationFn]] = [
  ("001_baseline", _migration_001_baseline),
  ("002_pipeline_runtime", _migration_002_pipeline_runtime),
  ("003_polynomial_techniques", _migration_003_polynomial_techniques),
  ("004_forecast_technique_families", _migration_004_forecast_technique_families),
  ("005_pharma_event_topos", _migration_005_pharma_event_topos),
  ("006_coreydigs_dossiers", _migration_006_coreydigs_dossiers),
  ("007_activity_center", _migration_007_activity_center),
  ("008_research_map_sources", _migration_008_research_map_sources),
  ("009_math_extraction", _migration_009_math_extraction),
  ("010_math_provider_metadata", _migration_010_math_provider_metadata),
  ("011_research_graph_materializations", _migration_011_research_graph_materializations),
  ("012_citation_mining", _migration_012_citation_mining),
  ("013_tracked_file_ledger", _migration_013_tracked_file_ledger),
  ("014_hybrid_watch_metrics", _migration_014_hybrid_watch_metrics),
  ("015_citation_acquisition", _migration_015_citation_acquisition),
  ("016_citation_procurement_queue_enrichment", _migration_016_citation_procurement_queue_enrichment),
]


def initialize_database(database_path: Path) -> None:
  connection = create_connection(database_path)
  try:
    _ensure_schema_migrations_table(connection)
    applied = {
      row["version"]
      for row in connection.execute("SELECT version FROM schema_migrations ORDER BY version ASC").fetchall()
    }
    for version, migrate in MIGRATIONS:
      if version in applied:
        continue
      migrate(connection)
      connection.execute("INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)", (version,))
    connection.commit()
  finally:
    connection.close()


@contextmanager
def database_session(database_path: Path):
  connection = create_connection(database_path)
  try:
    yield connection
    try:
      connection.commit()
    except sqlite3.OperationalError:
      pass
  except Exception:
    try:
      connection.rollback()
    except sqlite3.OperationalError:
      pass
    raise
  finally:
    connection.close()
