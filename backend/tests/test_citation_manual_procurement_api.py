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


def register_user(client, username_prefix: str = "cit-proc") -> dict:
  response = client.post(
    "/api/auth/register",
    json={
      "username": f"{username_prefix}-{uuid4().hex[:8]}",
      "display_name": "Procurement Reviewer",
      "password": "library-pass",
    },
  )
  assert response.status_code == 200
  return response.json()["user"]


def seed_procurement_fixture(user_id: str) -> dict[str, str]:
  now = utc_now()
  ids = {
    "run_id": f"citrun-{uuid4().hex}",
    "observation_id": f"citobs-{uuid4().hex}",
    "normalized_id": f"citnorm-{uuid4().hex}",
    "work_id": f"citwork-{uuid4().hex}",
    "edition_id": f"cited-{uuid4().hex}",
    "resolution_link_id": f"citres-{uuid4().hex}",
  }
  with database_session(main_module.settings.sqlite_path) as connection:
    connection.execute(
      """
      INSERT INTO citation_processing_runs (
        id, parent_run_id, import_job_id, run_type, tool_name, tool_version, config_fingerprint,
        status, triggered_by_user_id, settings_json, notes_json, started_at, finished_at, created_at, updated_at
      )
      VALUES (?, NULL, NULL, 'match', 'test-procurement', '1.0', 'cfg-procurement',
        'completed', ?, '{}', '[]', ?, ?, ?, ?)
      """,
      (ids["run_id"], user_id, now, now, now, now),
    )
    connection.execute(
      """
      INSERT INTO citation_observations (
        id, source_system, source_record_type, source_record_id, source_document_id, source_url, source_locator,
        observed_at, raw_citation_text, raw_context_text, raw_context_json, raw_status, language_hint,
        fingerprint_sha1, provenance_json, metadata_json, created_at, updated_at, retired_at
      )
      VALUES (?, 'semantic_library_engine', 'library_metadata', 'lib-1', NULL, 'https://example.org/catalog',
        'catalog', ?, ?, ?, '{}', 'captured', 'en', 'proc-fp-1', ?, '{}', ?, ?, NULL)
      """,
      (
        ids["observation_id"],
        now,
        "Peirce, C. S. Collected Papers of Charles Sanders Peirce. Vol. 1.",
        "Private library metadata import.",
        json.dumps({"source_project": "semantic-library-engine"}),
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
      VALUES (?, ?, ?, NULL, 1, 'ambiguous', 'Collected Papers of Charles Sanders Peirce',
        'collected papers of charles sanders peirce', NULL, 'C. S. Peirce', '1931', 'Harvard University Press',
        'Cambridge', NULL, NULL, '1', NULL, NULL, 'en', 'book', 0.82, ?, '{}', ?, ?)
      """,
      (
        ids["normalized_id"],
        ids["observation_id"],
        ids["run_id"],
        json.dumps(["multivolume_work", "metadata_conflict"]),
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
      VALUES (?, 'Collected Papers of Charles Sanders Peirce', 'collected papers of charles sanders peirce',
        NULL, 'book', 'C. S. Peirce', '1931', 'en', 'needs_review', 0.71,
        'Multi-volume work likely requiring manual procurement.', 'pending', 'pending', ?, ?, ?, NULL)
      """,
      (
        ids["work_id"],
        json.dumps({"warnings": ["multivolume_work", "metadata_incomplete"]}),
        now,
        now,
      ),
    )
    connection.execute(
      """
      INSERT INTO citation_editions (
        id, work_id, preferred_title, edition_statement, publication_year, publisher, place_of_publication,
        language, format_hint, volume, issue, page_count, edition_status, cluster_confidence,
        metadata_json, created_at, updated_at, superseded_by_edition_id
      )
      VALUES (?, ?, 'Collected Papers of Charles Sanders Peirce', 'Volume 1', '1931',
        'Harvard University Press', 'Cambridge', 'en', 'print', '1', NULL, 512, 'ambiguous', 0.66,
        '{}', ?, ?, NULL)
      """,
      (ids["edition_id"], ids["work_id"], now, now),
    )
    connection.execute(
      """
      INSERT INTO citation_resolution_links (
        id, normalized_record_id, processing_run_id, work_id, edition_id, manifestation_id, resolution_type,
        resolution_status, confidence, rationale_json, is_current, supersedes_resolution_id, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, NULL, 'canonical_match', 'proposed', 0.63, ?, 1, NULL, ?, ?)
      """,
      (
        ids["resolution_link_id"],
        ids["normalized_id"],
        ids["run_id"],
        ids["work_id"],
        ids["edition_id"],
        json.dumps({"reason": "Ambiguous volume-level match."}),
        now,
        now,
      ),
    )
    connection.execute(
      """
      INSERT INTO citation_identifiers (
        id, normalized_record_id, work_id, edition_id, manifestation_id, acquisition_candidate_id,
        identifier_type, normalized_value, raw_value, is_primary, source_confidence, created_at, updated_at
      )
      VALUES (?, NULL, ?, NULL, NULL, NULL, 'isbn13', '9780674321259', '9780674321259', 1, 0.91, ?, ?)
      """,
      (f"citid-{uuid4().hex}", ids["work_id"], now, now),
    )
    connection.execute(
      """
      INSERT INTO citation_identifiers (
        id, normalized_record_id, work_id, edition_id, manifestation_id, acquisition_candidate_id,
        identifier_type, normalized_value, raw_value, is_primary, source_confidence, created_at, updated_at
      )
      VALUES (?, NULL, NULL, ?, NULL, NULL, 'oclc', '1234567', '1234567', 0, 0.74, ?, ?)
      """,
      (f"citid-{uuid4().hex}", ids["edition_id"], now, now),
    )
  return ids


def test_manual_procurement_create_stores_snapshots_and_exports_context(isolated_client):
  client = isolated_client
  user = register_user(client)
  ids = seed_procurement_fixture(user["id"])

  create_response = client.post(
    "/api/citations/manual-procurement",
    json={
      "work_id": ids["work_id"],
      "edition_id": ids["edition_id"],
      "reason_code": "metadata_contradictory",
      "unresolved_reasons": [
        {"code": "metadata_contradictory", "detail": "Publication year and volume metadata conflict."},
        {"code": "poor_scan_availability", "detail": "Only poor-quality scans have been seen so far."},
      ],
      "priority": 15,
      "vendor_hint": "specialist used-book sellers",
      "notes": ["Check archive.org and antiquarian dealers later."],
      "future_workflow": {"upload_candidate": True, "preferred_targets": ["libgen", "internet_archive"]},
      "metadata": {"requested_from": "test-suite"},
    },
  )
  assert create_response.status_code == 200
  payload = create_response.json()
  assert payload["item"]["reason_code"] == "metadata_contradictory"
  assert payload["item"]["canonical_snapshot"]["work"]["preferred_title"] == "Collected Papers of Charles Sanders Peirce"
  assert payload["item"]["unresolved_reasons"][0]["code"] == "metadata_contradictory"
  assert payload["item"]["suggested_identifiers"][0]["identifier_type"] in {"isbn13", "oclc"}
  assert payload["item"]["provenance_snapshot"][0]["raw_citation_text"].startswith("Peirce, C. S.")
  assert payload["item"]["future_workflow"]["upload_candidate"] is True
  assert payload["events"][0]["action"] == "created"

  export_response = client.get("/api/citations/manual-procurement/export?limit=20")
  assert export_response.status_code == 200
  export_payload = export_response.json()
  assert export_payload["schema_version"] == "citation_manual_procurement_export.v1"
  assert export_payload["count"] == 1
  assert export_payload["items"][0]["search_hints"]


def test_manual_procurement_actions_update_status_and_upload_flags(isolated_client):
  client = isolated_client
  user = register_user(client, "cit-proc-actions")
  ids = seed_procurement_fixture(user["id"])

  create_response = client.post(
    "/api/citations/manual-procurement",
    json={
      "work_id": ids["work_id"],
      "edition_id": ids["edition_id"],
      "reason_code": "no_reliable_match",
      "priority": 25,
    },
  )
  assert create_response.status_code == 200
  item_id = create_response.json()["item"]["id"]

  researching_response = client.post(
    f"/api/citations/manual-procurement/{item_id}/action",
    json={"action": "mark_researching", "note": "Searching dealer catalogs."},
  )
  assert researching_response.status_code == 200
  assert researching_response.json()["item"]["status"] == "researching"

  upload_flag_response = client.post(
    f"/api/citations/manual-procurement/{item_id}/action",
    json={
      "action": "set_upload_candidate",
      "note": "If a clean scan is produced, queue it for archival upload review.",
      "payload": {
        "upload_candidate": True,
        "preferred_targets": ["internet_archive", "libgen"],
        "workflow_status": "planned",
        "scan_ready": False,
        "upload_ready": False,
      },
    },
  )
  assert upload_flag_response.status_code == 200
  payload = upload_flag_response.json()
  assert payload["item"]["future_workflow"]["upload_candidate"] is True
  assert payload["item"]["future_workflow"]["preferred_targets"] == ["internet_archive", "libgen"]
  assert payload["events"][-1]["action"] == "set_upload_candidate"

  ordered_response = client.post(
    f"/api/citations/manual-procurement/{item_id}/action",
    json={
      "action": "mark_ordered",
      "note": "Ordered a print copy for scanning.",
      "payload": {"estimated_cost_cents": 4500, "vendor_hint": "ABEBooks"},
    },
  )
  assert ordered_response.status_code == 200
  ordered_payload = ordered_response.json()
  assert ordered_payload["item"]["status"] == "ordered"
  assert ordered_payload["item"]["estimated_cost_cents"] == 4500
  assert ordered_payload["item"]["vendor_hint"] == "ABEBooks"


def test_review_action_routes_work_into_enriched_manual_procurement_queue(isolated_client):
  client = isolated_client
  user = register_user(client, "cit-proc-review")
  ids = seed_procurement_fixture(user["id"])

  review_response = client.post(
    "/api/citations/review-queue",
    json={
      "queue_type": "procurement_review",
      "summary_text": "No reliable digital match; route to manual procurement.",
      "work_id": ids["work_id"],
      "edition_id": ids["edition_id"],
      "priority": 30,
    },
  )
  assert review_response.status_code == 200
  review_id = review_response.json()["item"]["id"]

  decision_response = client.post(
    f"/api/citations/review-queue/{review_id}/decision",
    json={
      "action": "send_work_to_manual_procurement_queue",
      "note": "Only low-confidence and poor-quality sources were found.",
      "payload": {
        "reason_code": "low_confidence_only",
        "unresolved_reasons": [
          {"code": "low_confidence_only"},
          {"code": "poor_scan_availability"},
        ],
        "future_workflow": {"upload_candidate": True, "preferred_targets": ["internet_archive"]},
      },
    },
  )
  assert decision_response.status_code == 200
  procurement_item = decision_response.json()["manual_procurement_items"][0]
  assert procurement_item["reason_code"] == "low_confidence_only"
  assert procurement_item["canonical_snapshot"]["work"]["id"] == ids["work_id"]
  assert procurement_item["future_workflow"]["upload_candidate"] is True
  assert len(procurement_item["provenance_snapshot"]) == 1
