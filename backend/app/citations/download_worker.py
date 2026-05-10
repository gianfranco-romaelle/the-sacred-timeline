from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Event
from typing import Any

from .. import repository
from ..config import Settings, settings
from ..database import database_session, initialize_database
from . import review_repository as repo
from .downloaders import (
  CitationArtifactDownloader,
  CitationDownloadError,
  CitationDownloadResult,
  default_downloaders,
)
from .providers.policies import ProviderClock, RateLimitPolicy, RetryPolicy
from .text_utils import slug_text


logger = logging.getLogger(__name__)


def _utc_now() -> datetime:
  return datetime.now(timezone.utc)


def _parse_timestamp(value: str | None) -> datetime | None:
  if not value:
    return None
  try:
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
  except Exception:
    return None


def _hash_file(path: Path, algorithm: str = "sha256") -> str:
  digest = hashlib.new(algorithm)
  with path.open("rb") as handle:
    for chunk in iter(lambda: handle.read(1024 * 1024), b""):
      digest.update(chunk)
  return digest.hexdigest()


def _write_json(path: Path, payload: dict[str, Any]) -> None:
  path.parent.mkdir(parents=True, exist_ok=True)
  path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")


@dataclass(slots=True)
class IntegrityCheck:
  ok: bool
  retryable: bool = False
  expected_hashes: dict[str, str] = field(default_factory=dict)
  warnings: list[str] = field(default_factory=list)
  errors: list[str] = field(default_factory=list)
  observed: dict[str, Any] = field(default_factory=dict)

  def to_dict(self) -> dict[str, Any]:
    return {
      "ok": self.ok,
      "retryable": self.retryable,
      "expected_hashes": dict(self.expected_hashes),
      "warnings": list(self.warnings),
      "errors": list(self.errors),
      "observed": dict(self.observed),
    }


@dataclass(slots=True)
class DuplicateCheck:
  status: str
  exact_matches: list[dict[str, Any]] = field(default_factory=list)
  possible_matches: list[dict[str, Any]] = field(default_factory=list)
  warnings: list[str] = field(default_factory=list)

  def to_dict(self) -> dict[str, Any]:
    return {
      "status": self.status,
      "exact_matches": list(self.exact_matches),
      "possible_matches": list(self.possible_matches),
      "warnings": list(self.warnings),
    }


class CitationPromotionHook:
  def promote(
    self,
    connection,
    *,
    download_job: dict[str, Any],
    candidate: dict[str, Any],
    manifestation: dict[str, Any],
    staged_path: Path,
    sidecar_path: Path,
    sidecar_payload: dict[str, Any],
  ) -> dict[str, Any]:
    return {"status": "skipped"}


class ImportJobPromotionHook(CitationPromotionHook):
  def __init__(self, *, import_kind: str = "citation_download_import") -> None:
    self.import_kind = import_kind

  def promote(
    self,
    connection,
    *,
    download_job: dict[str, Any],
    candidate: dict[str, Any],
    manifestation: dict[str, Any],
    staged_path: Path,
    sidecar_path: Path,
    sidecar_payload: dict[str, Any],
  ) -> dict[str, Any]:
    existing = repository.find_active_import_job(connection, str(staged_path), kind=self.import_kind)
    if existing is not None:
      return {
        "status": "already_queued",
        "import_job_id": existing["id"],
        "kind": self.import_kind,
      }
    job = repository.create_import_job(
      connection,
      kind=self.import_kind,
      source_path=str(staged_path),
      created_by=download_job.get("approved_by_user_id") or download_job.get("requested_by_user_id"),
      options={
        "trigger": "citation_download_worker",
        "citation_download_job_id": download_job["id"],
        "citation_manifestation_id": manifestation["id"],
        "citation_candidate_id": candidate["id"],
        "sidecar_path": str(sidecar_path),
        "staging_only": True,
      },
    )
    return {
      "status": "queued",
      "import_job_id": job["id"],
      "kind": self.import_kind,
    }


class CitationDownloadWorker:
  sidecar_schema = "citation_download_sidecar.v1"

  def __init__(
    self,
    *,
    app_settings: Settings = settings,
    downloaders: dict[str, CitationArtifactDownloader] | None = None,
    rate_limit_policies: dict[str, RateLimitPolicy] | None = None,
    retry_policy: RetryPolicy | None = None,
    promotion_hook: CitationPromotionHook | None = None,
    clock: ProviderClock | None = None,
  ) -> None:
    self.settings = app_settings
    self.downloaders = downloaders or default_downloaders()
    self.rate_limit_policies = rate_limit_policies or {}
    self.retry_policy = retry_policy or RetryPolicy(max_attempts=3, backoff_seconds=(30.0, 90.0, 240.0))
    self.promotion_hook = promotion_hook or ImportJobPromotionHook()
    self.clock = clock or ProviderClock()
    self._last_provider_request_at: dict[str, float] = {}
    self.settings.resolved_citation_download_staging_dir.mkdir(parents=True, exist_ok=True)

  def run_once(self) -> dict[str, Any] | None:
    initialize_database(self.settings.sqlite_path)
    with database_session(self.settings.sqlite_path) as connection:
      job = self._next_job(connection)
      if job is None:
        return None
      return self.process_job(connection, job)

  def poll_forever(self, stop_event: Event | None = None) -> None:
    interval = max(float(self.settings.citation_download_poll_interval_seconds), 0.1)
    while stop_event is None or not stop_event.is_set():
      try:
        self.run_once()
      except Exception:  # pragma: no cover - defensive runtime logging
        logger.exception("Citation download worker iteration failed.")
      self.clock.sleep(interval)

  def process_job(self, connection, job: dict[str, Any]) -> dict[str, Any]:
    download_job = repo.get_download_job(connection, job["id"]) or job
    candidate = repo.get_candidate(connection, download_job["acquisition_candidate_id"])
    if candidate is None:
      return self._finish_with_failure(
        connection,
        download_job,
        code="candidate_missing",
        message="Acquisition candidate was not found.",
        retryable=False,
      )
    if str(candidate.get("candidate_status") or "").strip().lower() != "approved":
      return self._finish_with_failure(
        connection,
        download_job,
        code="candidate_not_approved",
        message="Download worker only processes human-approved candidates.",
        retryable=False,
      )
    edition_id = candidate.get("edition_id")
    if not edition_id:
      return self._finish_with_failure(
        connection,
        download_job,
        code="edition_missing",
        message="Approved candidate is missing an edition reference.",
        retryable=False,
      )

    manifestation = (
      repo.get_manifestation(connection, download_job.get("manifestation_id"))
      if download_job.get("manifestation_id")
      else repo.find_manifestation_for_candidate(connection, candidate["id"])
    )
    if manifestation is None:
      manifestation = repo.create_manifestation(
        connection,
        edition_id=edition_id,
        source_candidate_id=candidate["id"],
        file_format=candidate.get("file_format"),
        page_count=candidate.get("page_count"),
        source_provider=candidate.get("provider"),
        source_url=candidate.get("source_url") or candidate.get("download_url"),
        metadata={"created_by": "citation_download_worker"},
      )
    if download_job.get("manifestation_id") != manifestation["id"]:
      repo.update_download_job(connection, download_job["id"], manifestation_id=manifestation["id"])
      download_job = repo.get_download_job(connection, download_job["id"]) or download_job

    work = repo.get_work(connection, candidate["work_id"]) if candidate.get("work_id") else None
    edition = repo.get_edition(connection, edition_id)
    downloader = self.downloaders.get(str(candidate.get("provider") or "").strip().lower())
    if downloader is None:
      return self._finish_with_failure(
        connection,
        download_job,
        code="provider_downloader_missing",
        message=f"No downloader is configured for provider {candidate.get('provider')!r}.",
        retryable=False,
      )

    metadata = dict(download_job.get("metadata") or {})
    attempts = list(metadata.get("attempts") or [])
    attempt_log = {
      "started_at": repo.utc_now(),
      "provider": candidate.get("provider"),
      "status": "running",
    }
    resume_target = self._build_staging_target(candidate, work, edition, download_job["id"])
    final_path = resume_target["final_path"]
    temp_path = resume_target["temp_path"]
    temp_path.parent.mkdir(parents=True, exist_ok=True)
    resume_from = int(temp_path.stat().st_size) if temp_path.exists() else 0
    attempt_log["resume_from_bytes"] = resume_from

    repo.update_download_job(
      connection,
      download_job["id"],
      status="running",
      started_at=download_job.get("started_at") or repo.utc_now(),
      last_attempt_at=repo.utc_now(),
      error_text=None,
      output_uri=str(final_path),
      metadata_json={**metadata, "active_target_path": str(final_path)},
    )
    repo.update_manifestation(
      connection,
      manifestation["id"],
      local_path=str(final_path),
      storage_uri=str(final_path),
      source_url=candidate.get("download_url") or candidate.get("source_url"),
      acquisition_status="planned",
      metadata_json={
        **(manifestation.get("metadata") or {}),
        "staging_path": str(final_path),
        "download_job_id": download_job["id"],
      },
    )

    try:
      self._respect_rate_limit(str(candidate.get("provider") or "").strip().lower())
      request = downloader.build_request(candidate)
      result = downloader.download(
        request,
        temp_path,
        resume_from=resume_from,
        timeout_seconds=float(self.settings.citation_download_timeout_seconds),
        chunk_size=int(self.settings.citation_download_chunk_size_bytes),
      )
      final_path.parent.mkdir(parents=True, exist_ok=True)
      temp_path.replace(final_path)
      integrity = self._verify_integrity(connection, final_path, candidate)
      duplicate_check = self._detect_duplicates(connection, final_path, manifestation["id"])
      attempt_log.update(
        {
          "finished_at": repo.utc_now(),
          "status": "completed" if integrity.ok and duplicate_check.status != "exact_match" else "blocked",
          "bytes_written": int(final_path.stat().st_size),
          "response_headers": dict(result.response_headers),
          "warnings": list(result.warnings),
          "resumed": bool(result.resumed),
        }
      )
      attempts.append(attempt_log)

      sidecar_path = self._sidecar_path(final_path)
      sidecar_payload = self._build_sidecar(
        download_job=repo.get_download_job(connection, download_job["id"]) or download_job,
        candidate=candidate,
        work=work,
        edition=edition,
        manifestation=repo.get_manifestation(connection, manifestation["id"]) or manifestation,
        result=result,
        artifact_path=final_path,
        integrity=integrity,
        duplicate_check=duplicate_check,
        promotion={"status": "pending"},
      )

      manifestation_metadata = {
        **(manifestation.get("metadata") or {}),
        "staging_path": str(final_path),
        "sidecar_path": str(sidecar_path),
        "integrity": integrity.to_dict(),
        "duplicate_check": duplicate_check.to_dict(),
      }

      if not integrity.ok:
        _write_json(sidecar_path, sidecar_payload)
        repo.update_manifestation(
          connection,
          manifestation["id"],
          local_path=str(final_path),
          storage_uri=str(final_path),
          file_format=self._file_format_for_path(final_path, candidate),
          checksum_sha256=integrity.observed.get("sha256"),
          size_bytes=integrity.observed.get("size_bytes"),
          acquisition_status="failed",
          metadata_json=manifestation_metadata,
        )
        return self._finish_with_failure(
          connection,
          download_job,
          code="integrity_check_failed",
          message="Downloaded artifact failed integrity verification.",
          retryable=integrity.retryable,
          metadata_updates={"attempts": attempts, "integrity": integrity.to_dict(), "sidecar_path": str(sidecar_path)},
          manifestation_id=manifestation["id"],
          output_uri=str(final_path),
          checksum_sha256=integrity.observed.get("sha256"),
        )

      if duplicate_check.status == "exact_match":
        sidecar_payload["promotion"] = {"status": "blocked_duplicate"}
        _write_json(sidecar_path, sidecar_payload)
        repo.update_manifestation(
          connection,
          manifestation["id"],
          local_path=str(final_path),
          storage_uri=str(final_path),
          file_format=self._file_format_for_path(final_path, candidate),
          checksum_sha256=integrity.observed.get("sha256"),
          size_bytes=integrity.observed.get("size_bytes"),
          acquisition_status="quarantined",
          metadata_json=manifestation_metadata,
        )
        return self._finish_with_failure(
          connection,
          download_job,
          code="duplicate_artifact_detected",
          message="Downloaded artifact matches an existing library artifact and was quarantined in staging.",
          retryable=False,
          status="blocked",
          metadata_updates={
            "attempts": attempts,
            "integrity": integrity.to_dict(),
            "duplicate_check": duplicate_check.to_dict(),
            "sidecar_path": str(sidecar_path),
          },
          manifestation_id=manifestation["id"],
          output_uri=str(final_path),
          checksum_sha256=integrity.observed.get("sha256"),
        )

      promotion = self.promotion_hook.promote(
        connection,
        download_job=download_job,
        candidate=candidate,
        manifestation=manifestation,
        staged_path=final_path,
        sidecar_path=sidecar_path,
        sidecar_payload=sidecar_payload,
      )
      sidecar_payload["promotion"] = promotion
      _write_json(sidecar_path, sidecar_payload)

      repo.update_manifestation(
        connection,
        manifestation["id"],
        local_path=str(final_path),
        storage_uri=str(final_path),
        file_format=self._file_format_for_path(final_path, candidate),
        checksum_sha256=integrity.observed.get("sha256"),
        size_bytes=integrity.observed.get("size_bytes"),
        acquisition_status="downloaded",
        metadata_json={
          **manifestation_metadata,
          "promotion": promotion,
        },
      )
      repo.create_identifier(
        connection,
        manifestation_id=manifestation["id"],
        identifier_type="sha256",
        normalized_value=str(integrity.observed.get("sha256") or ""),
        raw_value=str(integrity.observed.get("sha256") or ""),
        is_primary=True,
      )
      repo.update_download_job(
        connection,
        download_job["id"],
        manifestation_id=manifestation["id"],
        status="completed",
        finished_at=repo.utc_now(),
        output_uri=str(final_path),
        checksum_sha256=str(integrity.observed.get("sha256") or ""),
        error_text=None,
        metadata_json={
          **metadata,
          "attempts": attempts,
          "integrity": integrity.to_dict(),
          "duplicate_check": duplicate_check.to_dict(),
          "sidecar_path": str(sidecar_path),
          "promotion": promotion,
        },
      )
      repo.create_provenance_event(
        connection,
        entity_type="manifestation",
        entity_id=manifestation["id"],
        event_type="downloaded",
        actor_user_id=download_job.get("approved_by_user_id"),
        approval_queue_id=download_job.get("approval_queue_id"),
        event_summary="Approved candidate downloaded into staging.",
        payload={
          "download_job_id": download_job["id"],
          "artifact_path": str(final_path),
          "sidecar_path": str(sidecar_path),
          "promotion": promotion,
        },
      )
      repo.create_provenance_event(
        connection,
        entity_type="candidate",
        entity_id=candidate["id"],
        event_type="downloaded",
        actor_user_id=download_job.get("approved_by_user_id"),
        approval_queue_id=download_job.get("approval_queue_id"),
        event_summary="Approved candidate downloaded into staging.",
        payload={"download_job_id": download_job["id"], "manifestation_id": manifestation["id"]},
      )
      return repo.get_download_job(connection, download_job["id"]) or download_job
    except CitationDownloadError as error:
      attempt_log.update(
        {
          "finished_at": repo.utc_now(),
          "status": "failed",
          "error_code": error.code,
          "error_text": str(error),
          "retryable": error.retryable,
        }
      )
      attempts.append(attempt_log)
      return self._finish_with_failure(
        connection,
        download_job,
        code=error.code,
        message=str(error),
        retryable=error.retryable,
        metadata_updates={"attempts": attempts},
        manifestation_id=manifestation["id"],
        output_uri=str(final_path),
      )

  def _next_job(self, connection) -> dict[str, Any] | None:
    now = _utc_now()
    for job in repo.list_pollable_download_jobs(connection, limit=100):
      if str(job.get("candidate_status") or "").strip().lower() != "approved":
        continue
      metadata = job.get("metadata") or {}
      next_attempt_at = _parse_timestamp(metadata.get("next_attempt_at"))
      if next_attempt_at is not None and next_attempt_at > now:
        continue
      return job
    return None

  def _respect_rate_limit(self, provider_name: str) -> None:
    policy = self.rate_limit_policies.get(provider_name) or RateLimitPolicy(min_interval_seconds=15.0, max_queries_per_lookup=1)
    previous = self._last_provider_request_at.get(provider_name)
    if previous is not None:
      delta = self.clock.monotonic() - previous
      wait_seconds = max(float(policy.min_interval_seconds) - delta, 0.0)
      if wait_seconds > 0:
        self.clock.sleep(wait_seconds)
    self._last_provider_request_at[provider_name] = self.clock.monotonic()

  def _build_staging_target(
    self,
    candidate: dict[str, Any],
    work: dict[str, Any] | None,
    edition: dict[str, Any] | None,
    download_job_id: str,
  ) -> dict[str, Path]:
    provider = str(candidate.get("provider") or "unknown").strip().lower() or "unknown"
    provider_root = self.settings.resolved_citation_download_staging_dir / provider / download_job_id
    provider_root.mkdir(parents=True, exist_ok=True)
    extension = self._extension_for_candidate(candidate)
    filename = self._build_filename(candidate, work, edition, extension)
    final_path = self._reserve_unique_path(provider_root / filename)
    return {
      "final_path": final_path,
      "temp_path": final_path.with_suffix(final_path.suffix + ".part"),
    }

  def _extension_for_candidate(self, candidate: dict[str, Any]) -> str:
    raw = str(candidate.get("file_format") or "").strip().lower().lstrip(".")
    if raw:
      return f".{raw}"
    download_url = str(candidate.get("download_url") or candidate.get("source_url") or "").strip()
    suffix = Path(download_url.split("?")[0]).suffix
    return suffix if suffix else ".bin"

  def _file_format_for_path(self, artifact_path: Path, candidate: dict[str, Any]) -> str | None:
    if candidate.get("file_format"):
      return str(candidate["file_format"])
    suffix = artifact_path.suffix.lstrip(".").strip()
    return suffix or None

  def _build_filename(
    self,
    candidate: dict[str, Any],
    work: dict[str, Any] | None,
    edition: dict[str, Any] | None,
    extension: str,
  ) -> str:
    title = (
      candidate.get("title")
      or (edition or {}).get("preferred_title")
      or (work or {}).get("preferred_title")
      or "untitled"
    )
    author = candidate.get("author_string") or (work or {}).get("canonical_author_string") or "unknown"
    year = candidate.get("publication_year") or (edition or {}).get("publication_year") or (work or {}).get("original_year") or "undated"
    base = "-".join(
      part
      for part in [
        slug_text(str(author).split(",")[0])[:40],
        slug_text(str(year))[:12],
        slug_text(str(title))[:80],
        slug_text(str(candidate.get("provider") or ""))[:20],
        slug_text(str(candidate.get("provider_record_id") or candidate.get("id") or ""))[:24],
      ]
      if part
    )
    return f"{base or 'citation-artifact'}{extension}"

  def _reserve_unique_path(self, preferred_path: Path) -> Path:
    if not preferred_path.exists():
      return preferred_path
    stem = preferred_path.stem
    suffix = preferred_path.suffix
    counter = 2
    while True:
      candidate = preferred_path.with_name(f"{stem}--{counter}{suffix}")
      if not candidate.exists():
        return candidate
      counter += 1

  def _expected_hashes(self, connection, candidate: dict[str, Any]) -> dict[str, str]:
    hashes: dict[str, str] = {}
    raw_payload = candidate.get("raw_payload") or {}
    metadata = candidate.get("metadata") or {}
    for source in (raw_payload, metadata):
      for key in ("sha256", "md5"):
        value = str(source.get(key) or "").strip().lower()
        if value:
          hashes[key] = value
    for row in repo.list_candidate_identifiers(connection, candidate["id"]):
      identifier_type = str(row.get("identifier_type") or "").strip().lower()
      normalized_value = str(row.get("normalized_value") or "").strip().lower()
      if identifier_type in {"sha256", "md5"} and normalized_value:
        hashes[identifier_type] = normalized_value
    return hashes

  def _verify_integrity(self, connection, artifact_path: Path, candidate: dict[str, Any]) -> IntegrityCheck:
    expected = self._expected_hashes(connection, candidate)
    size_bytes = int(artifact_path.stat().st_size)
    sha256 = _hash_file(artifact_path, "sha256")
    md5 = _hash_file(artifact_path, "md5")
    observed = {
      "size_bytes": size_bytes,
      "sha256": sha256,
      "md5": md5,
    }
    warnings: list[str] = []
    errors: list[str] = []
    retryable = False
    expected_size = candidate.get("file_size_bytes")
    if expected_size is not None and int(expected_size) != size_bytes:
      errors.append(f"size_mismatch:{expected_size}!={size_bytes}")
      retryable = size_bytes < int(expected_size)
    if expected.get("sha256") and expected["sha256"] != sha256:
      errors.append("sha256_mismatch")
    if expected.get("md5") and expected["md5"] != md5:
      errors.append("md5_mismatch")
    if not expected:
      warnings.append("no_expected_hash_available")
    return IntegrityCheck(ok=not errors, retryable=retryable, expected_hashes=expected, warnings=warnings, errors=errors, observed=observed)

  def _detect_duplicates(self, connection, artifact_path: Path, manifestation_id: str) -> DuplicateCheck:
    checksum_sha256 = _hash_file(artifact_path, "sha256")
    exact_manifestations = [
      {
        "manifestation_id": item["id"],
        "local_path": item.get("local_path"),
        "source_provider": item.get("source_provider"),
      }
      for item in repo.find_manifestations_by_checksum(connection, checksum_sha256)
      if item["id"] != manifestation_id
    ]
    possible_documents = [
      {
        "document_id": item["id"],
        "source_path": item.get("source_path"),
        "title": item.get("title"),
      }
      for item in repo.list_documents_for_duplicate_detection(connection, basename=artifact_path.name)
      if str(item.get("source_path") or "").strip()
    ]
    status = "clear"
    warnings: list[str] = []
    if exact_manifestations:
      status = "exact_match"
      warnings.append("checksum_duplicate_detected")
    elif possible_documents:
      status = "possible_match"
      warnings.append("filename_collision_in_library")
    return DuplicateCheck(status=status, exact_matches=exact_manifestations, possible_matches=possible_documents, warnings=warnings)

  def _sidecar_path(self, artifact_path: Path) -> Path:
    return artifact_path.with_suffix(artifact_path.suffix + ".citation.json")

  def _build_sidecar(
    self,
    *,
    download_job: dict[str, Any],
    candidate: dict[str, Any],
    work: dict[str, Any] | None,
    edition: dict[str, Any] | None,
    manifestation: dict[str, Any] | None,
    result: CitationDownloadResult,
    artifact_path: Path,
    integrity: IntegrityCheck,
    duplicate_check: DuplicateCheck,
    promotion: dict[str, Any],
  ) -> dict[str, Any]:
    return {
      "schema_version": self.sidecar_schema,
      "generated_at": repo.utc_now(),
      "download_job": {
        "id": download_job["id"],
        "approval_queue_id": download_job.get("approval_queue_id"),
        "requested_by_user_id": download_job.get("requested_by_user_id"),
        "approved_by_user_id": download_job.get("approved_by_user_id"),
        "status": download_job.get("status"),
        "download_policy": download_job.get("download_policy"),
      },
      "candidate": {
        "id": candidate["id"],
        "provider": candidate.get("provider"),
        "provider_record_id": candidate.get("provider_record_id"),
        "title": candidate.get("title"),
        "author_string": candidate.get("author_string"),
        "publication_year": candidate.get("publication_year"),
        "match_confidence": candidate.get("match_confidence"),
        "availability_status": candidate.get("availability_status"),
        "source_url": candidate.get("source_url"),
        "download_url": candidate.get("download_url"),
        "raw_payload": candidate.get("raw_payload") or {},
        "metadata": candidate.get("metadata") or {},
      },
      "work": work,
      "edition": edition,
      "manifestation": manifestation,
      "staging": {
        "artifact_path": str(artifact_path),
        "artifact_size_bytes": int(artifact_path.stat().st_size),
        "provider_response_headers": dict(result.response_headers),
        "source_url": result.source_url,
        "resumed": bool(result.resumed),
      },
      "integrity": integrity.to_dict(),
      "duplicate_check": duplicate_check.to_dict(),
      "promotion": promotion,
    }

  def _finish_with_failure(
    self,
    connection,
    download_job: dict[str, Any],
    *,
    code: str,
    message: str,
    retryable: bool,
    status: str | None = None,
    metadata_updates: dict[str, Any] | None = None,
    manifestation_id: str | None = None,
    output_uri: str | None = None,
    checksum_sha256: str | None = None,
  ) -> dict[str, Any]:
    refreshed = repo.get_download_job(connection, download_job["id"]) or download_job
    metadata = dict(refreshed.get("metadata") or {})
    metadata.update(metadata_updates or {})
    retry_count = int(refreshed.get("retry_count") or 0) + 1
    next_status = status or "failed"
    next_attempt_at: str | None = None
    finished_at: str | None = repo.utc_now()
    if retryable and retry_count < max(int(self.retry_policy.max_attempts), 1):
      delay = self.retry_policy.backoff_seconds[min(retry_count - 1, len(self.retry_policy.backoff_seconds) - 1)]
      next_attempt_at = (_utc_now() + timedelta(seconds=float(delay))).isoformat()
      metadata["next_attempt_at"] = next_attempt_at
      next_status = "queued"
      finished_at = None
    else:
      metadata.pop("next_attempt_at", None)
    repo.update_download_job(
      connection,
      download_job["id"],
      manifestation_id=manifestation_id or refreshed.get("manifestation_id"),
      status=next_status,
      retry_count=retry_count,
      finished_at=finished_at,
      error_text=f"{code}: {message}",
      output_uri=output_uri or refreshed.get("output_uri"),
      checksum_sha256=checksum_sha256 or refreshed.get("checksum_sha256"),
      metadata_json=metadata,
    )
    if manifestation_id:
      manifestation = repo.get_manifestation(connection, manifestation_id)
      if manifestation is not None and next_status in {"failed", "blocked"}:
        repo.update_manifestation(
          connection,
          manifestation_id,
          acquisition_status="failed" if next_status == "failed" else "quarantined",
          metadata_json={
            **(manifestation.get("metadata") or {}),
            "download_error": {"code": code, "message": message},
          },
        )
    repo.create_provenance_event(
      connection,
      entity_type="candidate",
      entity_id=refreshed["acquisition_candidate_id"],
      event_type="download_failed",
      actor_user_id=refreshed.get("approved_by_user_id"),
      approval_queue_id=refreshed.get("approval_queue_id"),
      event_summary=message,
      payload={
        "download_job_id": download_job["id"],
        "code": code,
        "retryable": retryable,
        "next_status": next_status,
        "next_attempt_at": next_attempt_at,
      },
    )
    return repo.get_download_job(connection, download_job["id"]) or refreshed
