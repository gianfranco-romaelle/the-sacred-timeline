from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import pytest

from app import repository
from app.citations import review_repository as citation_repo
from app.citations.download_worker import CitationDownloadWorker, ImportJobPromotionHook
from app.citations.downloaders import CitationArtifactDownloader, CitationDownloadError, CitationDownloadRequest, CitationDownloadResult
from app.citations.providers.policies import RateLimitPolicy, RetryPolicy
from app.config import settings
from app.database import database_session, initialize_database


def utc_now() -> str:
  return datetime.now(timezone.utc).isoformat()


@pytest.fixture
def isolated_citation_settings(tmp_path: Path):
  previous = {
    "data_dir": settings.data_dir,
    "citation_download_staging_dir": settings.citation_download_staging_dir,
    "runtime_mode": settings.runtime_mode,
    "enable_demo_seed": settings.enable_demo_seed,
    "bootstrap_default_account": settings.bootstrap_default_account,
  }
  settings.data_dir = str(tmp_path / "data")
  settings.citation_download_staging_dir = str(tmp_path / "data" / "citations" / "staging")
  settings.runtime_mode = "live"
  settings.enable_demo_seed = False
  settings.bootstrap_default_account = False
  initialize_database(settings.sqlite_path)
  yield settings
  for key, value in previous.items():
    setattr(settings, key, value)


class FixtureDownloader(CitationArtifactDownloader):
  provider_name = "libgen"

  def __init__(
    self,
    content: bytes,
    *,
    failures_before_success: int = 0,
    fail_after_bytes: int | None = None,
  ) -> None:
    self.content = content
    self.failures_before_success = failures_before_success
    self.fail_after_bytes = fail_after_bytes
    self.resume_offsets: list[int] = []

  def download(
    self,
    request: CitationDownloadRequest,
    destination: Path,
    *,
    resume_from: int = 0,
    timeout_seconds: float = 180.0,
    chunk_size: int = 262144,
  ) -> CitationDownloadResult:
    del request, timeout_seconds, chunk_size
    self.resume_offsets.append(resume_from)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if self.failures_before_success > 0:
      self.failures_before_success -= 1
      slice_end = self.fail_after_bytes or len(self.content)
      chunk = self.content[resume_from:slice_end]
      mode = "ab" if resume_from > 0 else "wb"
      with destination.open(mode) as handle:
        handle.write(chunk)
      raise CitationDownloadError("temporary_provider_failure", "Provider interrupted the transfer.", retryable=True)
    mode = "ab" if resume_from > 0 else "wb"
    with destination.open(mode) as handle:
      handle.write(self.content[resume_from:])
    return CitationDownloadResult(
      source_url="fixture://libgen/download",
      bytes_written=int(destination.stat().st_size),
      resumed=resume_from > 0,
      response_headers={"content-length": str(destination.stat().st_size)},
    )


def seed_download_candidate(
  *,
  content: bytes,
  expected_sha256: str,
) -> dict[str, str]:
  now = utc_now()
  ids = {
    "run_id": f"citrun-{uuid4().hex}",
    "work_id": f"citwork-{uuid4().hex}",
    "edition_id": f"cited-{uuid4().hex}",
    "lookup_job_id": f"citlookup-{uuid4().hex}",
    "candidate_id": f"citcand-{uuid4().hex}",
  }
  with database_session(settings.sqlite_path) as connection:
    connection.execute(
      """
      INSERT INTO citation_processing_runs (
        id, parent_run_id, import_job_id, run_type, tool_name, tool_version, config_fingerprint,
        status, triggered_by_user_id, settings_json, notes_json, started_at, finished_at, created_at, updated_at
      )
      VALUES (?, NULL, NULL, 'lookup', 'test-download-worker', '1.0', 'cfg-download',
        'completed', NULL, '{}', '[]', ?, ?, ?, ?)
      """,
      (ids["run_id"], now, now, now, now),
    )
    connection.execute(
      """
      INSERT INTO citation_works (
        id, preferred_title, title_key, subtitle, work_type, canonical_author_string, original_year, language,
        work_status, cluster_confidence, summary_text, semantic_status, graph_status, metadata_json,
        created_at, updated_at, superseded_by_work_id
      )
      VALUES (?, 'Psychology and Alchemy', 'psychology and alchemy', NULL, 'book', 'C. G. Jung',
        '1944', 'en', 'canonical', 0.9, 'Download worker test work.', 'pending', 'pending', '{}', ?, ?, NULL)
      """,
      (ids["work_id"], now, now),
    )
    connection.execute(
      """
      INSERT INTO citation_editions (
        id, work_id, preferred_title, edition_statement, publication_year, publisher, place_of_publication,
        language, format_hint, volume, issue, page_count, edition_status, cluster_confidence, metadata_json,
        created_at, updated_at, superseded_by_edition_id
      )
      VALUES (?, ?, 'Psychology and Alchemy', 'Collected Works Vol. 12', '1968',
        'Princeton University Press', 'Princeton', 'en', 'pdf', '12', NULL, 640, 'canonical', 0.88, '{}', ?, ?, NULL)
      """,
      (ids["edition_id"], ids["work_id"], now, now),
    )
    connection.execute(
      """
      INSERT INTO citation_lookup_jobs (
        id, processing_run_id, normalized_record_id, work_id, edition_id, provider, query_text, query_fingerprint,
        priority, status, rate_limit_bucket, attempts, last_attempt_at, started_at, finished_at,
        response_summary_json, error_text, created_by_user_id, created_at, updated_at
      )
      VALUES (?, ?, NULL, ?, ?, 'libgen', 'doi:10.0000/test', 'lookup-fp', 10, 'completed',
        'libgen', 1, ?, ?, ?, '{}', NULL, NULL, ?, ?)
      """,
      (ids["lookup_job_id"], ids["run_id"], ids["work_id"], ids["edition_id"], now, now, now, now, now),
    )
    connection.execute(
      """
      INSERT INTO citation_acquisition_candidates (
        id, lookup_job_id, work_id, edition_id, provider, provider_record_id, candidate_status,
        title, author_string, publication_year, publisher, language, file_format, file_size_bytes, page_count,
        match_confidence, availability_status, source_url, preview_url, download_url, access_notes,
        raw_payload_json, metadata_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, 'libgen', 'lg-123', 'approved', 'Psychology and Alchemy', 'C. G. Jung', '1968',
        'Princeton University Press', 'en', 'pdf', ?, 640, 0.95, 'available',
        'https://libgen.test/lg-123', 'https://libgen.test/preview/lg-123', 'https://libgen.test/download/lg-123',
        'manual review approved', '{}', ?, ?, ?)
      """,
      (
        ids["candidate_id"],
        ids["lookup_job_id"],
        ids["work_id"],
        ids["edition_id"],
        len(content),
        json.dumps({"sha256": expected_sha256, "risk_flags": []}),
        now,
        now,
      ),
    )
    job = citation_repo.create_download_job(
      connection,
      acquisition_candidate_id=ids["candidate_id"],
      approval_queue_id=None,
      requested_by_user_id=None,
      approved_by_user_id=None,
      status="approved",
      metadata={"queued_by": "test-suite"},
    )
  ids["download_job_id"] = job["id"]
  return ids


def test_download_worker_stages_artifact_writes_sidecar_and_queues_import(isolated_citation_settings):
  content = b"approved-candidate-content"
  expected_sha256 = __import__("hashlib").sha256(content).hexdigest()
  ids = seed_download_candidate(content=content, expected_sha256=expected_sha256)
  downloader = FixtureDownloader(content)
  worker = CitationDownloadWorker(
    app_settings=isolated_citation_settings,
    downloaders={"libgen": downloader},
    rate_limit_policies={"libgen": RateLimitPolicy(min_interval_seconds=0.0)},
    retry_policy=RetryPolicy(max_attempts=3, backoff_seconds=(0.0, 0.0, 0.0)),
    promotion_hook=ImportJobPromotionHook(),
  )

  result = worker.run_once()

  assert result is not None
  with database_session(settings.sqlite_path) as connection:
    download_job = citation_repo.get_download_job(connection, ids["download_job_id"])
    manifestation = citation_repo.get_manifestation(connection, download_job["manifestation_id"])
    import_job = repository.find_active_import_job(connection, download_job["output_uri"], kind="citation_download_import")
  assert download_job is not None
  assert download_job["status"] == "completed"
  assert Path(download_job["output_uri"]).exists()
  assert str(Path(download_job["output_uri"]).resolve()).startswith(str(settings.resolved_citation_download_staging_dir.resolve()))
  assert manifestation is not None
  assert manifestation["acquisition_status"] == "downloaded"
  sidecar_path = Path(download_job["metadata"]["sidecar_path"])
  assert sidecar_path.exists()
  sidecar = json.loads(sidecar_path.read_text(encoding="utf-8"))
  assert sidecar["schema_version"] == "citation_download_sidecar.v1"
  assert sidecar["integrity"]["ok"] is True
  assert sidecar["promotion"]["status"] == "queued"
  assert import_job is not None
  assert import_job["status"] == "queued"
  assert downloader.resume_offsets == [0]


def test_download_worker_blocks_exact_checksum_duplicates(isolated_citation_settings):
  content = b"duplicate-candidate-content"
  expected_sha256 = __import__("hashlib").sha256(content).hexdigest()
  ids = seed_download_candidate(content=content, expected_sha256=expected_sha256)
  downloader = FixtureDownloader(content)
  with database_session(settings.sqlite_path) as connection:
    existing = citation_repo.create_manifestation(
      connection,
      edition_id=ids["edition_id"],
      source_candidate_id=None,
      file_format="pdf",
      local_path="C:/library/already-present.pdf",
      storage_uri="C:/library/already-present.pdf",
      checksum_sha256=expected_sha256,
      size_bytes=len(content),
      source_provider="local_library",
      acquisition_status="downloaded",
      metadata={"note": "existing library artifact"},
    )
    assert existing["checksum_sha256"] == expected_sha256

  worker = CitationDownloadWorker(
    app_settings=isolated_citation_settings,
    downloaders={"libgen": downloader},
    rate_limit_policies={"libgen": RateLimitPolicy(min_interval_seconds=0.0)},
    retry_policy=RetryPolicy(max_attempts=3, backoff_seconds=(0.0, 0.0, 0.0)),
    promotion_hook=ImportJobPromotionHook(),
  )
  worker.run_once()

  with database_session(settings.sqlite_path) as connection:
    download_job = citation_repo.get_download_job(connection, ids["download_job_id"])
    manifestation = citation_repo.get_manifestation(connection, download_job["manifestation_id"])
    import_job = repository.find_active_import_job(connection, download_job["output_uri"], kind="citation_download_import")
  assert download_job is not None
  assert download_job["status"] == "blocked"
  assert "duplicate_artifact_detected" in str(download_job["error_text"] or "")
  assert manifestation is not None
  assert manifestation["acquisition_status"] == "quarantined"
  sidecar = json.loads(Path(download_job["metadata"]["sidecar_path"]).read_text(encoding="utf-8"))
  assert sidecar["duplicate_check"]["status"] == "exact_match"
  assert import_job is None


def test_download_worker_retries_and_resumes_partial_downloads(isolated_citation_settings):
  content = b"resumable-approved-content"
  expected_sha256 = __import__("hashlib").sha256(content).hexdigest()
  ids = seed_download_candidate(content=content, expected_sha256=expected_sha256)
  downloader = FixtureDownloader(content, failures_before_success=1, fail_after_bytes=7)
  worker = CitationDownloadWorker(
    app_settings=isolated_citation_settings,
    downloaders={"libgen": downloader},
    rate_limit_policies={"libgen": RateLimitPolicy(min_interval_seconds=0.0)},
    retry_policy=RetryPolicy(max_attempts=3, backoff_seconds=(0.0, 0.0, 0.0)),
    promotion_hook=ImportJobPromotionHook(),
  )

  first = worker.run_once()
  assert first is not None
  with database_session(settings.sqlite_path) as connection:
    queued_job = citation_repo.get_download_job(connection, ids["download_job_id"])
  assert queued_job is not None
  assert queued_job["status"] == "queued"
  assert queued_job["retry_count"] == 1
  active_target = Path(queued_job["metadata"]["active_target_path"])
  assert active_target.with_suffix(active_target.suffix + ".part").exists()

  second = worker.run_once()
  assert second is not None
  with database_session(settings.sqlite_path) as connection:
    completed_job = citation_repo.get_download_job(connection, ids["download_job_id"])
  assert completed_job is not None
  assert completed_job["status"] == "completed"
  assert Path(completed_job["output_uri"]).read_bytes() == content
  assert downloader.resume_offsets == [0, 7]
  assert len(completed_job["metadata"]["attempts"]) == 2
