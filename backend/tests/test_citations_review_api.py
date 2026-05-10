from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app import main as main_module
from app.database import database_session, initialize_database
from app.engine import LibraryEngine


def utc_now() -> str:
  return datetime.now(timezone.utc).isoformat()


@pytest.fixture
def isolated_client(tmp_path: Path):
  previous_values = {
    "data_dir": main_module.settings.data_dir,
    "model_cache_dir": main_module.settings.model_cache_dir,
    "job_artifact_dir": main_module.settings.job_artifact_dir,
    "runtime_mode": main_module.settings.runtime_mode,
    "enable_dev_fallbacks": main_module.settings.enable_dev_fallbacks,
    "enable_demo_seed": main_module.settings.enable_demo_seed,
    "bootstrap_default_account": main_module.settings.bootstrap_default_account,
  }
  previous_engine = main_module.engine

  main_module.settings.data_dir = str(tmp_path / "data")
  main_module.settings.model_cache_dir = previous_values["model_cache_dir"]
  main_module.settings.job_artifact_dir = str(tmp_path / "jobs")
  main_module.settings.runtime_mode = "live"
  main_module.settings.enable_dev_fallbacks = True
  main_module.settings.enable_demo_seed = False
  main_module.settings.bootstrap_default_account = True

  initialize_database(main_module.settings.sqlite_path)
  main_module.engine = LibraryEngine(main_module.settings)

  with TestClient(main_module.app) as client:
    yield client

  main_module.engine = previous_engine
  for key, value in previous_values.items():
    setattr(main_module.settings, key, value)


def register_user(client, username_prefix: str = "cit-review") -> dict:
  response = client.post(
    "/api/auth/register",
    json={
      "username": f"{username_prefix}-{uuid4().hex[:8]}",
      "display_name": "Citation Reviewer",
      "password": "library-pass",
    },
  )
  assert response.status_code == 200
  return response.json()["user"]


def seed_citation_review_fixture(user_id: str) -> dict[str, str]:
  now = utc_now()
  ids = {
    "parse_run_id": f"citrun-{uuid4().hex}",
    "lookup_run_id": f"citrun-{uuid4().hex}",
    "observation_id": f"citobs-{uuid4().hex}",
    "normalized_id": f"citnorm-{uuid4().hex}",
    "work_id": f"citwork-{uuid4().hex}",
    "source_work_id": f"citwork-{uuid4().hex}",
    "edition_id": f"cited-{uuid4().hex}",
    "lookup_job_libgen_id": f"citlookup-{uuid4().hex}",
    "lookup_job_ia_id": f"citlookup-{uuid4().hex}",
    "candidate_libgen_id": f"citcand-{uuid4().hex}",
    "candidate_ia_id": f"citcand-{uuid4().hex}",
    "manifestation_id": f"citman-{uuid4().hex}",
    "resolution_link_id": f"citres-{uuid4().hex}",
  }
  with database_session(main_module.settings.sqlite_path) as connection:
    connection.execute(
      """
      INSERT INTO citation_processing_runs (
        id, parent_run_id, import_job_id, run_type, tool_name, tool_version, config_fingerprint,
        status, triggered_by_user_id, settings_json, notes_json, started_at, finished_at, created_at, updated_at
      )
      VALUES (?, NULL, NULL, 'parse', 'test-parser', '1.0', 'cfg-parse', 'completed', ?, '{}', '[]', ?, ?, ?, ?)
      """,
      (ids["parse_run_id"], user_id, now, now, now, now),
    )
    connection.execute(
      """
      INSERT INTO citation_processing_runs (
        id, parent_run_id, import_job_id, run_type, tool_name, tool_version, config_fingerprint,
        status, triggered_by_user_id, settings_json, notes_json, started_at, finished_at, created_at, updated_at
      )
      VALUES (?, ?, NULL, 'lookup', 'test-lookup', '1.0', 'cfg-lookup', 'completed', ?, '{}', '[]', ?, ?, ?, ?)
      """,
      (ids["lookup_run_id"], ids["parse_run_id"], user_id, now, now, now, now),
    )
    connection.execute(
      """
      INSERT INTO citation_observations (
        id, source_system, source_record_type, source_record_id, source_document_id, source_url, source_locator,
        observed_at, raw_citation_text, raw_context_text, raw_context_json, raw_status, language_hint,
        fingerprint_sha1, provenance_json, metadata_json, created_at, updated_at, retired_at
      )
      VALUES (?, 'wiki_scraper', 'bibliography_entry', 'record-1', NULL, 'https://example.org/source',
        'section:references', ?, ?, ?, '{}', 'captured', 'en', 'fp-1', ?, '{}', ?, ?, NULL)
      """,
      (
        ids["observation_id"],
        now,
        "Jung, C. G. Psychology and Alchemy. Princeton University Press, 1968.",
        "References section from scraped site.",
        json.dumps({"scraper": "tree-forcing", "source_project": "wiki-download-citation-tool"}),
        now,
        now,
      ),
    )
    connection.execute(
      """
      INSERT INTO citation_normalized_records (
        id, observation_id, processing_run_id, supersedes_normalized_id, is_current, normalization_status,
        title, title_key, subtitle, author_string, year, publisher, place_of_publication, container_title,
        edition_statement, volume, issue, page_range, language, publication_type, parse_confidence,
        parser_warnings_json, normalized_payload_json, created_at, updated_at
      )
      VALUES (?, ?, ?, NULL, 1, 'parsed', 'Psychology and Alchemy', 'psychology and alchemy', NULL,
        'C. G. Jung', '1968', 'Princeton University Press', 'Princeton', NULL, NULL, NULL, NULL, NULL,
        'en', 'book', 0.94, '[]', ?, ?, ?)
      """,
      (
        ids["normalized_id"],
        ids["observation_id"],
        ids["parse_run_id"],
        json.dumps({"identifiers": {}, "aliases": ["Psychology & Alchemy"]}),
        now,
        now,
      ),
    )
    connection.execute(
      """
      INSERT INTO citation_works (
        id, preferred_title, title_key, subtitle, work_type, canonical_author_string, original_year, language,
        work_status, cluster_confidence, summary_text, semantic_status, graph_status, metadata_json,
        created_at, updated_at, superseded_by_work_id
      )
      VALUES (?, 'Psychology and Alchemy', 'psychology and alchemy', NULL, 'book', 'C. G. Jung',
        '1944', 'en', 'canonical', 0.92, 'Canonical work record for review tests.',
        'pending', 'pending', ?, ?, ?, NULL)
      """,
      (
        ids["work_id"],
        json.dumps({"warnings": ["translated_work"], "aliases": ["Psychologie und Alchemie"]}),
        now,
        now,
      ),
    )
    connection.execute(
      """
      INSERT INTO citation_works (
        id, preferred_title, title_key, subtitle, work_type, canonical_author_string, original_year, language,
        work_status, cluster_confidence, summary_text, semantic_status, graph_status, metadata_json,
        created_at, updated_at, superseded_by_work_id
      )
      VALUES (?, 'Psychology & Alchemy', 'psychology and alchemy', NULL, 'book', 'Carl Jung',
        '1944', 'en', 'candidate', 0.61, 'Duplicate cluster for merge testing.',
        'pending', 'pending', '{}', ?, ?, NULL)
      """,
      (ids["source_work_id"], now, now),
    )
    connection.execute(
      """
      INSERT INTO citation_editions (
        id, work_id, preferred_title, edition_statement, publication_year, publisher, place_of_publication,
        language, format_hint, volume, issue, page_count, edition_status, cluster_confidence,
        metadata_json, created_at, updated_at, superseded_by_edition_id
      )
      VALUES (?, ?, 'Psychology and Alchemy', 'Collected Works Vol. 12', '1968',
        'Princeton University Press', 'Princeton', 'en', 'print', '12', NULL, 640, 'canonical', 0.88,
        ?, ?, ?, NULL)
      """,
      (
        ids["edition_id"],
        ids["work_id"],
        json.dumps({"warnings": ["multivolume_work", "edited_volume"]}),
        now,
        now,
      ),
    )
    connection.execute(
      """
      INSERT INTO citation_resolution_links (
        id, normalized_record_id, processing_run_id, work_id, edition_id, manifestation_id,
        resolution_type, resolution_status, confidence, rationale_json, is_current, supersedes_resolution_id,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, NULL, 'canonical_match', 'accepted', 0.91, ?, 1, NULL, ?, ?)
      """,
      (
        ids["resolution_link_id"],
        ids["normalized_id"],
        ids["parse_run_id"],
        ids["work_id"],
        ids["edition_id"],
        json.dumps({"reason": "Matched by normalized title and author."}),
        now,
        now,
      ),
    )
    connection.execute(
      """
      INSERT INTO citation_lookup_jobs (
        id, processing_run_id, normalized_record_id, work_id, edition_id, provider, query_text, query_fingerprint,
        priority, status, rate_limit_bucket, attempts, last_attempt_at, started_at, finished_at,
        response_summary_json, error_text, created_by_user_id, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, 'libgen', 'doi:10.0000/test', 'lookup-fp-1', 10, 'completed', 'libgen', 1, ?, ?, ?,
        ?, NULL, ?, ?, ?)
      """,
      (
        ids["lookup_job_libgen_id"],
        ids["lookup_run_id"],
        ids["normalized_id"],
        ids["work_id"],
        ids["edition_id"],
        now,
        now,
        now,
        json.dumps({"query_strategy": "identifier_first"}),
        user_id,
        now,
        now,
      ),
    )
    connection.execute(
      """
      INSERT INTO citation_lookup_jobs (
        id, processing_run_id, normalized_record_id, work_id, edition_id, provider, query_text, query_fingerprint,
        priority, status, rate_limit_bucket, attempts, last_attempt_at, started_at, finished_at,
        response_summary_json, error_text, created_by_user_id, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, 'internet_archive', 'psychology and alchemy jung', 'lookup-fp-2', 20, 'completed',
        'internet_archive', 1, ?, ?, ?, ?, NULL, ?, ?, ?)
      """,
      (
        ids["lookup_job_ia_id"],
        ids["lookup_run_id"],
        ids["normalized_id"],
        ids["work_id"],
        ids["edition_id"],
        now,
        now,
        now,
        json.dumps({"query_strategy": "exact_title_author"}),
        user_id,
        now,
        now,
      ),
    )
    connection.execute(
      """
      INSERT INTO citation_acquisition_candidates (
        id, lookup_job_id, work_id, edition_id, provider, provider_record_id, candidate_status,
        title, author_string, publication_year, publisher, language, file_format, file_size_bytes, page_count,
        match_confidence, availability_status, source_url, preview_url, download_url, access_notes,
        raw_payload_json, metadata_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, 'libgen', 'lg-123', 'candidate', 'Psychology and Alchemy', 'C. G. Jung', '1968',
        'Princeton University Press', 'en', 'pdf', 5242880, 640, 0.93, 'available',
        'https://libgen.test/lg-123', 'https://libgen.test/preview/lg-123', 'https://libgen.test/download/lg-123',
        'mirror available', ?, ?, ?, ?)
      """,
      (
        ids["candidate_libgen_id"],
        ids["lookup_job_libgen_id"],
        ids["work_id"],
        ids["edition_id"],
        json.dumps({"provider": "libgen", "record_id": "lg-123"}),
        json.dumps({"candidate_score": 0.95, "normalized_score": 0.96, "risk_flags": ["mirror_unverified"]}),
        now,
        now,
      ),
    )
    connection.execute(
      """
      INSERT INTO citation_acquisition_candidates (
        id, lookup_job_id, work_id, edition_id, provider, provider_record_id, candidate_status,
        title, author_string, publication_year, publisher, language, file_format, file_size_bytes, page_count,
        match_confidence, availability_status, source_url, preview_url, download_url, access_notes,
        raw_payload_json, metadata_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, 'internet_archive', 'ia-psyalchemy', 'shortlisted', 'Psychology and Alchemy',
        'C. G. Jung', '1968', 'Princeton University Press', 'en', 'pdf', 4194304, 640, 0.84, 'borrowable',
        'https://archive.org/details/ia-psyalchemy', 'https://archive.org/details/ia-psyalchemy',
        NULL, 'borrow only', ?, ?, ?, ?)
      """,
      (
        ids["candidate_ia_id"],
        ids["lookup_job_ia_id"],
        ids["work_id"],
        ids["edition_id"],
        json.dumps({"provider": "internet_archive", "identifier": "ia-psyalchemy"}),
        json.dumps({"candidate_score": 0.82, "risk_flags": ["borrow_only", "wrong_edition_collision"]}),
        now,
        now,
      ),
    )
    connection.execute(
      """
      INSERT INTO citation_file_manifestations (
        id, edition_id, source_candidate_id, manifestation_type, media_type, file_format, storage_uri,
        local_path, checksum_sha256, size_bytes, page_count, source_provider, source_url, acquisition_status,
        ocr_status, text_extraction_status, embedding_status, graph_enrichment_status, metadata_json, created_at, updated_at
      )
      VALUES (?, ?, ?, 'digital_file', 'application/pdf', 'pdf', NULL, NULL, NULL, 5242880, 640,
        'internet_archive', 'https://archive.org/details/ia-psyalchemy', 'planned',
        'pending', 'pending', 'pending', 'pending', ?, ?, ?)
      """,
      (
        ids["manifestation_id"],
        ids["edition_id"],
        ids["candidate_ia_id"],
        json.dumps({"planned_from_candidate_id": ids["candidate_ia_id"]}),
        now,
        now,
      ),
    )
  return ids


def test_citation_review_detail_includes_candidates_scores_risks_and_provenance(isolated_client):
  client = isolated_client
  user = register_user(client)
  ids = seed_citation_review_fixture(user["id"])

  create_response = client.post(
    "/api/citations/review-queue",
    json={
      "queue_type": "candidate_review",
      "summary_text": "Review acquisition candidates for canonical work.",
      "work_id": ids["work_id"],
      "edition_id": ids["edition_id"],
      "acquisition_candidate_id": ids["candidate_libgen_id"],
      "resolution_link_id": ids["resolution_link_id"],
      "normalized_record_id": ids["normalized_id"],
      "priority": 10,
      "metadata": {"source": "test-suite"},
    },
  )

  assert create_response.status_code == 200
  payload = create_response.json()
  assert payload["item"]["status"] == "pending"
  assert payload["work"]["preferred_title"] == "Psychology and Alchemy"
  assert len(payload["candidates"]) == 2
  assert payload["candidates"][0]["provider"] == "libgen"
  assert payload["candidates"][0]["normalized_score"] == 0.96
  assert "mirror_unverified" in payload["candidates"][0]["risk_flags"]
  assert payload["manifestations"][0]["source_provider"] == "internet_archive"
  assert payload["provenance_links"][0]["raw_citation_text"].startswith("Jung, C. G.")
  assert payload["provenance_links"][0]["source_system"] == "wiki_scraper"
  assert payload["events"][0]["action"] == "created"
  assert payload["work_events"][0]["event_type"] == "review_queued"

  review_response = client.get("/api/citations/review-queue")
  assert review_response.status_code == 200
  assert review_response.json()["items"][0]["candidate_provider"] == "libgen"


def test_citation_review_approval_creates_download_job_and_audit_log(isolated_client):
  client = isolated_client
  user = register_user(client, "cit-approve")
  ids = seed_citation_review_fixture(user["id"])

  create_response = client.post(
    "/api/citations/review-queue",
    json={
      "queue_type": "download_authorization",
      "summary_text": "Approve the strongest provider match.",
      "work_id": ids["work_id"],
      "edition_id": ids["edition_id"],
      "acquisition_candidate_id": ids["candidate_libgen_id"],
      "priority": 5,
    },
  )
  assert create_response.status_code == 200
  review_id = create_response.json()["item"]["id"]

  decision_response = client.post(
    f"/api/citations/review-queue/{review_id}/decision",
    json={
      "action": "approve_candidate_for_download",
      "note": "Best match after manual inspection.",
      "payload": {"operator_confidence": 0.99},
    },
  )
  assert decision_response.status_code == 200
  payload = decision_response.json()
  assert payload["item"]["status"] == "approved"
  assert payload["candidate"]["candidate_status"] == "approved"
  assert payload["download_jobs"][0]["status"] == "approved"
  assert payload["download_jobs"][0]["download_policy"] == "manual_only"
  assert payload["events"][-1]["action"] == "approve_candidate_for_download"
  assert payload["events"][-1]["event_notes"] == "Best match after manual inspection."
  assert payload["candidate_events"][-1]["event_type"] == "approved"
  assert payload["item"]["decision_notes"][-1]["action"] == "approve_candidate_for_download"

  downloads_response = client.get("/api/citations/download-jobs")
  assert downloads_response.status_code == 200
  jobs_payload = downloads_response.json()
  assert len(jobs_payload["items"]) == 1
  assert jobs_payload["items"][0]["acquisition_candidate_id"] == ids["candidate_libgen_id"]


def test_citation_review_can_route_manual_procurement_and_merge_clusters(isolated_client):
  client = isolated_client
  user = register_user(client, "cit-manual")
  ids = seed_citation_review_fixture(user["id"])

  procurement_response = client.post(
    "/api/citations/review-queue",
    json={
      "queue_type": "procurement_review",
      "summary_text": "Route unresolved work to procurement.",
      "work_id": ids["work_id"],
      "edition_id": ids["edition_id"],
      "priority": 25,
    },
  )
  assert procurement_response.status_code == 200
  procurement_review_id = procurement_response.json()["item"]["id"]

  decision_response = client.post(
    f"/api/citations/review-queue/{procurement_review_id}/decision",
    json={
      "action": "send_work_to_manual_procurement_queue",
      "note": "Only borrow-only copies are available.",
      "payload": {
        "owner_user_id": user["id"],
        "reason_code": "borrow_only_candidates",
        "vendor_hint": "used-book marketplaces",
        "priority": 15,
      },
    },
  )
  assert decision_response.status_code == 200
  procurement_payload = decision_response.json()
  assert procurement_payload["item"]["status"] == "deferred"
  assert procurement_payload["manual_procurement_items"][0]["reason_code"] == "borrow_only_candidates"

  manual_queue_response = client.get("/api/citations/manual-procurement")
  assert manual_queue_response.status_code == 200
  assert manual_queue_response.json()["items"][0]["work_id"] == ids["work_id"]

  merge_response = client.post(
    "/api/citations/review-queue",
    json={
      "queue_type": "work_merge",
      "summary_text": "Merge duplicate canonical work clusters.",
      "work_id": ids["source_work_id"],
      "priority": 30,
    },
  )
  assert merge_response.status_code == 200
  merge_review_id = merge_response.json()["item"]["id"]

  merge_decision_response = client.post(
    f"/api/citations/review-queue/{merge_review_id}/decision",
    json={
      "action": "merge_clusters",
      "note": "Same work; duplicate created by fuzzy purifier.",
      "payload": {
        "target_work_id": ids["work_id"],
        "source_work_ids": [ids["source_work_id"]],
      },
    },
  )
  assert merge_decision_response.status_code == 200
  merge_payload = merge_decision_response.json()
  assert merge_payload["item"]["status"] == "approved"
  assert merge_payload["item"]["work_id"] == ids["work_id"]
  assert merge_payload["work_events"][-1]["event_type"] == "merged"

  with database_session(main_module.settings.sqlite_path) as connection:
    source_work = connection.execute(
      "SELECT work_status, superseded_by_work_id FROM citation_works WHERE id = ?",
      (ids["source_work_id"],),
    ).fetchone()
  assert source_work is not None
  assert source_work["work_status"] == "merged"
  assert source_work["superseded_by_work_id"] == ids["work_id"]
