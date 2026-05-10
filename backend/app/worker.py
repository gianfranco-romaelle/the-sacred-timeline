from __future__ import annotations

import hashlib
import json
import logging
import re
import shutil
import threading
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import settings
from .database import database_session, initialize_database
from .engine import IMAGE_EXTENSIONS, LibraryEngine, extract_document, extract_document_with_timeout
from .errors import ServiceDependencyError, remediation_payload_from_error
from . import repository
from .semeiotics import build_document_scaffolds

try:
  from watchfiles import Change, watch
except Exception:  # pragma: no cover - optional import
  Change = None
  watch = None


logger = logging.getLogger(__name__)


def file_checksum(path: Path) -> str:
  digest = hashlib.sha1()
  with path.open("rb") as handle:
    for chunk in iter(lambda: handle.read(1024 * 1024), b""):
      digest.update(chunk)
  return digest.hexdigest()


def iso_mtime(path: Path) -> str:
  return datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat()


class Worker:
  def __init__(self) -> None:
    self.engine = LibraryEngine(settings)
    self._recovery_checked = False
    self._watcher_threads: dict[str, threading.Thread] = {}
    self._watch_event_lock = threading.Lock()
    self._pending_watch_events: dict[str, dict[str, dict[str, Any]]] = {}
    self._watcher_stop = threading.Event()

  def _operator_runtime_state(self) -> dict[str, Any]:
    path = settings.resolved_operator_runtime_path
    default = {
      "paused": False,
      "pause_reason": None,
      "updated_at": None,
      "source": str(path),
    }
    if not path.exists():
      return default
    try:
      payload = json.loads(path.read_text(encoding="utf-8") or "{}")
    except Exception as error:
      return {
        **default,
        "paused": True,
        "pause_reason": f"Operator runtime state could not be parsed: {error}",
        "updated_at": repository.utc_now(),
      }
    return {
      "paused": bool(payload.get("paused")),
      "pause_reason": payload.get("pause_reason"),
      "updated_at": payload.get("updated_at"),
      "source": str(path),
    }

  def _job_dir(self, job_id: str) -> Path:
    directory = settings.resolved_job_artifact_dir / job_id
    directory.mkdir(parents=True, exist_ok=True)
    return directory

  def _read_job_state(self, job: dict) -> dict:
    return repository.json_loads(job.get("state_json"), {})

  def _write_job_state(self, connection, job_id: str, state: dict) -> None:
    repository.update_import_job(connection, job_id, state_json=state)

  def _append_warning(self, items: list[str] | None, message: str) -> list[str]:
    warnings = [item for item in (items or []) if item]
    if message and message not in warnings:
      warnings.append(message)
    return warnings

  def _current_item_payload(self, state: dict) -> dict:
    return {
      "current_item_name": state.get("current_item_name"),
      "current_item_path": state.get("current_item_path"),
      "current_item_index": state.get("current_item_index"),
      "current_item_total": state.get("current_item_total"),
      "stage_started_at": state.get("stage_started_at"),
      "last_progress_at": state.get("last_progress_at"),
      "recovered_after_restart": bool(state.get("recovered_after_restart")),
    }

  def _clear_refinement_state(self, state: dict) -> None:
    state["awaiting_refinement"] = False
    state["recommended_action"] = None
    state["next_check"] = None
    state["retry_hint"] = None
    state["retry_command"] = None
    state["can_continue"] = True
    state["missing_services"] = []

  def _parse_timestamp(self, value: str | None) -> datetime | None:
    if not value:
      return None
    try:
      return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except Exception:
      return None

  def _job_priority_key(self, job: dict) -> tuple[int, float, str]:
    source_path = str(job.get("source_path") or "").replace("/", "\\").rstrip("\\").lower()
    prioritized_roots = [root.replace("/", "\\").rstrip("\\").lower() for root in settings.prioritized_import_roots]
    root_priority = 0 if any(source_path.startswith(root) for root in prioritized_roots if root) else 1
    state = self._read_job_state(job)
    stage_state = str(state.get("stage_state") or "").strip().lower()
    if stage_state == "recovering":
      priority = 0
    elif job.get("status") == "running":
      priority = 1
    else:
      priority = 2
    created = self._parse_timestamp(job.get("created_at"))
    created_ts = created.timestamp() if created is not None else 0.0
    return (root_priority, priority, created_ts, str(job.get("id") or ""))

  def _throughput_per_minute(self, started_at: str | None, completed: int | None) -> float | None:
    if not started_at or completed is None or completed <= 0:
      return None
    started = self._parse_timestamp(started_at)
    if started is None:
      return None
    elapsed_minutes = max((datetime.now(timezone.utc) - started).total_seconds() / 60.0, 1 / 60.0)
    return round(float(completed) / elapsed_minutes, 2)

  def _stall_minutes(self, last_progress_at: str | None) -> float | None:
    progress_time = self._parse_timestamp(last_progress_at)
    if progress_time is None:
      return None
    return round(max((datetime.now(timezone.utc) - progress_time).total_seconds(), 0.0) / 60.0, 1)

  def _runtime_payload(self, state: dict, *, progress_completed: int | None = None, progress_total: int | None = None, semantic_stats: dict | None = None, stage_state: str | None = None, remediation: dict | None = None) -> dict:
    if stage_state is not None:
      state["stage_state"] = stage_state
    if semantic_stats is not None:
      state["semantic_stats"] = semantic_stats
    if remediation:
      state["awaiting_refinement"] = bool(remediation.get("awaiting_refinement"))
      state["recommended_action"] = remediation.get("recommended_action")
      state["next_check"] = remediation.get("next_check")
      state["retry_hint"] = remediation.get("retry_hint")
      state["retry_command"] = remediation.get("retry_command")
      state["can_continue"] = bool(remediation.get("can_continue", False))
      state["missing_services"] = list(remediation.get("missing_services") or [])
      state["stage_state"] = remediation.get("stage_state") or state.get("stage_state") or "awaiting_refinement"
    elif stage_state and stage_state != "awaiting_refinement":
      self._clear_refinement_state(state)

    effective_completed = progress_completed
    if effective_completed is None:
      effective_completed = state.get("current_item_index")
    throughput = self._throughput_per_minute(state.get("stage_started_at"), int(effective_completed) if effective_completed is not None else None)
    stall_minutes = self._stall_minutes(state.get("last_progress_at"))
    state["throughput_per_minute"] = throughput
    state["stall_minutes"] = stall_minutes

    return {
      **self._current_item_payload(state),
      "stage_state": state.get("stage_state") or "running",
      "throughput_per_minute": throughput,
      "stall_minutes": stall_minutes,
      "awaiting_refinement": bool(state.get("awaiting_refinement")),
      "recommended_action": state.get("recommended_action"),
      "next_check": state.get("next_check"),
      "retry_hint": state.get("retry_hint"),
      "retry_command": state.get("retry_command"),
      "can_continue": bool(state.get("can_continue", True)),
      "semantic_stats": state.get("semantic_stats") if semantic_stats is None else semantic_stats,
      "progress_completed": progress_completed,
      "progress_total": progress_total,
      "missing_services": list(state.get("missing_services") or []),
    }

  def _runtime_service_ready(self, service_name: str) -> bool:
    normalized = str(service_name or "").strip().lower()
    if normalized == "embedding":
      return bool(self.engine.embedder.ready)
    if normalized == "reranker":
      return bool(self.engine.reranker.ready)
    if normalized == "vector_index":
      return bool(self.engine.vector_index.enabled)
    if normalized == "reasoner":
      return bool(self.engine.reasoner.ready)
    if normalized == "ocr":
      return bool(self.engine.ocr_provider.ready)
    if normalized == "market_data":
      return bool(self.engine.market_data_provider.ready)
    if normalized == "pharma_news":
      return bool(self.engine.pharma_news_provider.ready)
    if normalized == "dossier_news":
      return bool(self.engine.dossier_news_provider.ready)
    if normalized == "cryptography":
      return False
    return False

  def _can_recover_document_with_ocr(self, source_path: Path) -> bool:
    ocr_configured = bool(self.engine.ocr_provider.ready)
    if not ocr_configured:
      remote_url = str(getattr(settings, "remote_ocr_url", "") or "").strip()
      ocr_configured = bool(remote_url or getattr(settings, "use_remote_ocr", False))
    suffix = source_path.suffix.lower()
    if suffix == ".pdf":
      return ocr_configured
    if suffix == ".djvu":
      return bool(shutil.which("ddjvu"))
    if suffix in IMAGE_EXTENSIONS:
      return ocr_configured
    return False

  def _prepared_artifact_semantic_stats(self, prepared_artifacts: list[str], *, embedded_count: int = 0, indexed_vector_count: int = 0, stage: str = "chunk") -> dict:
    node_counts: Counter[str] = Counter()
    summary_counts: Counter[str] = Counter()
    research_scaffold_counts: Counter[str] = Counter()
    relation_counts: Counter[str] = Counter()
    math_counts: Counter[str] = Counter()
    citation_counts: Counter[str] = Counter()
    object_documents: dict[str, set[str]] = {}
    document_count = 0
    page_count = 0
    token_total = 0
    vector_target = 0

    for artifact_text in prepared_artifacts:
      payload = self._read_json(Path(artifact_text))
      document_count += 1
      parsed = payload.get("parsed") or {}
      document = payload.get("document") or {}
      nodes = payload.get("nodes") or []
      math_payload = payload.get("math") or {}
      citation_payload = payload.get("citations") or {}
      citation_summary = citation_payload.get("summary") or citation_payload
      page_count += len(parsed.get("pages") or [])
      math_counts["formula_count"] += int(math_payload.get("formula_count", 0) or 0)
      math_counts["formula_recognized"] += int(math_payload.get("formula_recognized", 0) or 0)
      math_counts["formula_pending"] += int(math_payload.get("formula_pending", 0) or 0)
      math_counts["pages_scanned"] += int(math_payload.get("pages_scanned", 0) or 0)
      citation_counts["bibliography_entries"] += int(citation_summary.get("bibliography_entries", 0) or 0)
      citation_counts["parsed_entry_count"] += int(citation_summary.get("parsed_entry_count", 0) or 0)
      citation_counts["partially_parsed_entry_count"] += int(citation_summary.get("partially_parsed_entry_count", 0) or 0)
      citation_counts["unresolved_entry_count"] += int(citation_summary.get("unresolved_entry_count", 0) or 0)
      citation_counts["citation_mentions"] += int(citation_summary.get("citation_mentions", 0) or 0)
      citation_counts["matched_mentions"] += int(citation_summary.get("matched_mentions", 0) or 0)
      citation_counts["unresolved_mentions"] += int(citation_summary.get("unresolved_mentions", 0) or 0)
      citation_counts["footnotes"] += int(citation_summary.get("footnotes", 0) or 0)
      citation_counts["mixed_footnotes"] += int(citation_summary.get("mixed_footnotes", 0) or 0)
      citation_counts["commentary_footnotes"] += int(citation_summary.get("commentary_footnotes", 0) or 0)
      citation_counts["citation_only_footnotes"] += int(citation_summary.get("citation_only_footnotes", 0) or 0)
      citation_counts["entry_confidence_samples"] += int(citation_summary.get("bibliography_entries", 0) or 0)
      citation_counts["mention_confidence_samples"] += int(citation_summary.get("citation_mentions", 0) or 0)
      citation_counts["footnote_confidence_samples"] += int(citation_summary.get("footnotes", 0) or 0)
      citation_counts["entry_confidence_weighted"] += float(citation_summary.get("entry_average_confidence", 0.0) or 0.0) * int(citation_summary.get("bibliography_entries", 0) or 0)
      citation_counts["mention_confidence_weighted"] += float(citation_summary.get("mention_average_confidence", 0.0) or 0.0) * int(citation_summary.get("citation_mentions", 0) or 0)
      citation_counts["footnote_confidence_weighted"] += float(citation_summary.get("footnote_average_confidence", 0.0) or 0.0) * int(citation_summary.get("footnotes", 0) or 0)
      for node in nodes:
        node_type = str(node.get("node_type") or "unknown")
        node_counts[node_type] += 1
        if node_type == "summary":
          summary_counts[str(node.get("summary_level") or "unknown")] += 1
        token_total += int(node.get("token_count") or 0)
        if node_type in {"summary", "chunk"} and str(node.get("text") or "").strip():
          vector_target += 1
      scaffolds = build_document_scaffolds(document, nodes)
      research_scaffold_counts["sign_tokens"] += len(scaffolds.get("sign_tokens", []))
      research_scaffold_counts["objects"] += len(scaffolds.get("objects_of_reference", []))
      research_scaffold_counts["categories"] += len(scaffolds.get("categories", []))
      research_scaffold_counts["morphisms"] += len(scaffolds.get("category_morphisms", []))
      research_scaffold_counts["covers"] += len(scaffolds.get("covers", []))
      research_scaffold_counts["restrictions"] += len(scaffolds.get("restriction_maps", []))
      research_scaffold_counts["constraints"] += len(scaffolds.get("gluing_constraints", []))
      research_scaffold_counts["obstructions"] += len(scaffolds.get("obstructions", []))
      research_scaffold_counts["simplices"] += len(scaffolds.get("simplices", []))
      relation_counts["category_morphisms"] += len(scaffolds.get("category_morphisms", []))
      relation_counts["restriction_maps"] += len(scaffolds.get("restriction_maps", []))
      relation_counts["obstructions"] += len(scaffolds.get("obstructions", []))
      relation_counts["simplices"] += len(scaffolds.get("simplices", []))
      document_key = str(document.get("id") or payload.get("source_path") or document_count)
      for object_row in scaffolds.get("objects_of_reference", []):
        canonical = str(object_row.get("canonical_label") or object_row.get("label") or "").strip().lower()
        if not canonical:
          continue
        object_documents.setdefault(canonical, set()).add(document_key)

    cross_document_pairs: set[tuple[str, str]] = set()
    for document_ids in object_documents.values():
      ids = sorted(document_ids)
      for index, source_id in enumerate(ids):
        for target_id in ids[index + 1:]:
          cross_document_pairs.add((source_id, target_id))

    relation_total = int(sum(relation_counts.values()))
    object_count = int(research_scaffold_counts.get("objects", 0))
    citation_mentions = int(citation_counts.get("citation_mentions", 0) or 0)
    bibliography_entries = int(citation_counts.get("bibliography_entries", 0) or 0)
    footnotes = int(citation_counts.get("footnotes", 0) or 0)
    citation_counts["entry_average_confidence"] = round(
      float(citation_counts.get("entry_confidence_weighted", 0.0) or 0.0) / max(int(citation_counts.get("entry_confidence_samples", 0) or 0), 1),
      3,
    ) if bibliography_entries else 0.0
    citation_counts["mention_average_confidence"] = round(
      float(citation_counts.get("mention_confidence_weighted", 0.0) or 0.0) / max(int(citation_counts.get("mention_confidence_samples", 0) or 0), 1),
      3,
    ) if citation_mentions else 0.0
    citation_counts["footnote_average_confidence"] = round(
      float(citation_counts.get("footnote_confidence_weighted", 0.0) or 0.0) / max(int(citation_counts.get("footnote_confidence_samples", 0) or 0), 1),
      3,
    ) if footnotes else 0.0
    citation_counts["match_rate"] = round(int(citation_counts.get("matched_mentions", 0) or 0) / citation_mentions, 3) if citation_mentions else 0.0
    citation_counts["unresolved_rate"] = round(int(citation_counts.get("unresolved_mentions", 0) or 0) / citation_mentions, 3) if citation_mentions else 0.0
    for key in ("entry_confidence_samples", "mention_confidence_samples", "footnote_confidence_samples", "entry_confidence_weighted", "mention_confidence_weighted", "footnote_confidence_weighted"):
      citation_counts.pop(key, None)
    return {
      "stage": stage,
      "document_count": document_count,
      "page_count": page_count,
      "node_count": int(sum(node_counts.values())),
      "node_counts": dict(node_counts),
      "chunk_count": int(node_counts.get("chunk", 0)),
      "summary_counts": dict(summary_counts),
      "math_counts": dict(math_counts),
      "citation_counts": dict(citation_counts),
      "token_totals": {
        "all_nodes": token_total,
        "vector_target_nodes": vector_target,
      },
      "embedding_queue": {
        "total": vector_target,
        "written": int(embedded_count),
        "pending": max(vector_target - int(embedded_count), 0),
      },
      "indexed_vector_count": int(indexed_vector_count),
      "vector_queue": {
        "written": int(indexed_vector_count),
        "pending": max(vector_target - int(indexed_vector_count), 0),
      },
      "research_scaffold_counts": dict(research_scaffold_counts),
      "relation_counts": dict(relation_counts),
      "component_counts": {
        "document_proxy": document_count,
        "semantic_proxy": max(1, document_count - min(len(cross_document_pairs), max(document_count - 1, 0))),
      },
      "cross_document_links": {
        "linked_pairs": len(cross_document_pairs),
        "shared_object_count": sum(1 for document_ids in object_documents.values() if len(document_ids) > 1),
      },
      "average_relation_degree_proxy": round(relation_total / max(object_count, 1), 2),
    }

  def _set_active_item(self, state: dict, stage: str, source_path: Path | str | None, index: int | None, total: int | None) -> dict:
    now = repository.utc_now()
    self._clear_refinement_state(state)
    cursor = dict(state.get("resume_cursor") or {})
    path_text = str(source_path) if source_path else cursor.get("current_item_path")
    if cursor.get("stage") != stage:
      cursor["stage_started_at"] = now
    else:
      cursor["stage_started_at"] = cursor.get("stage_started_at") or now
    cursor["stage"] = stage
    cursor["current_item_path"] = path_text
    cursor["current_item_name"] = Path(path_text).name if path_text else None
    if index is not None:
      cursor["current_item_index"] = int(index)
    if total is not None:
      cursor["current_item_total"] = int(total)
    cursor["last_progress_at"] = now
    state["resume_cursor"] = cursor
    state["current_item_path"] = cursor.get("current_item_path")
    state["current_item_name"] = cursor.get("current_item_name")
    state["current_item_index"] = cursor.get("current_item_index")
    state["current_item_total"] = cursor.get("current_item_total")
    state["stage_started_at"] = cursor.get("stage_started_at")
    state["last_progress_at"] = cursor.get("last_progress_at")
    state["resumable"] = True
    return state

  def _update_active_item(
    self,
    connection,
    job_id: str,
    task_id: str,
    state: dict,
    stage: str,
    source_path: Path | str | None,
    index: int | None,
    total: int | None,
    payload: dict | None = None,
  ) -> dict:
    self._set_active_item(state, stage, source_path, index, total)
    self._write_job_state(connection, job_id, state)
    self._reconcile_file_stage(
      connection,
      state,
      source_path=source_path,
      stage=stage,
      status="running",
      import_job_id=job_id,
      event_message=f"{stage} is running for this file.",
    )
    merged_payload = dict(payload or {})
    merged_payload.update(self._current_item_payload(state))
    repository.update_pipeline_task(connection, task_id, status="running", payload_json=merged_payload)
    try:
      connection.commit()
    except Exception:
      pass
    return state

  def _commit_progress_tick(self, connection) -> None:
    try:
      connection.commit()
    except Exception:
      pass

  def _remove_job_artifacts(self, job_ids: list[str]) -> None:
    for job_id in job_ids:
      artifact_dir = settings.resolved_job_artifact_dir / job_id
      if artifact_dir.exists():
        shutil.rmtree(artifact_dir, ignore_errors=True)

  def _resolve_root_watch_folder_id(self, connection, source_path: Path | str, options: dict[str, Any] | None = None) -> str | None:
    option_watch_folder_id = str((options or {}).get("watch_folder_id") or "").strip()
    if option_watch_folder_id:
      return option_watch_folder_id
    folder = repository.find_watch_folder_for_path(connection, source_path)
    return str(folder["id"]) if folder is not None else None

  def _reconcile_file_stage(
    self,
    connection,
    state: dict,
    *,
    source_path: Path | str | None,
    stage: str,
    status: str,
    import_job_id: str | None,
    error_message: str | None = None,
    event_message: str | None = None,
    metadata: dict[str, Any] | None = None,
  ) -> None:
    if source_path is None:
      return
    source = Path(str(source_path))
    extra_metadata = dict(metadata or {})
    if state.get("current_item_index") is not None:
      extra_metadata["current_item_index"] = state.get("current_item_index")
    if state.get("current_item_total") is not None:
      extra_metadata["current_item_total"] = state.get("current_item_total")
    root_watch_folder_id = state.get("root_watch_folder_id")
    size_bytes = None
    mtime = None
    if source.exists():
      try:
        size_bytes = source.stat().st_size
        mtime = iso_mtime(source)
      except Exception:
        size_bytes = None
        mtime = None
    repository.reconcile_tracked_file_stage(
      connection,
      absolute_path=source,
      stage=stage,
      status=status,
      import_job_id=import_job_id,
      root_watch_folder_id=root_watch_folder_id,
      size_bytes=size_bytes,
      mtime=mtime,
      error_message=error_message,
      metadata_json=extra_metadata if extra_metadata else None,
      event_message=event_message,
    )

  def _is_task_stale_for_recovery(self, job: dict, task: dict, state: dict) -> bool:
    if task.get("status") != "running":
      return False

    threshold_minutes = max(float(settings.running_task_recovery_minutes), 0.5)
    candidate_timestamps = [
      state.get("last_progress_at"),
      task.get("updated_at"),
      task.get("started_at"),
      job.get("updated_at"),
    ]
    reference_time = next((self._parse_timestamp(value) for value in candidate_timestamps if self._parse_timestamp(value) is not None), None)
    if reference_time is None:
      return True

    age_minutes = max((datetime.now(timezone.utc) - reference_time).total_seconds(), 0.0) / 60.0
    return age_minutes >= threshold_minutes

  def _recover_incomplete_jobs(self, connection, *, force_running: bool = False) -> int:
    recovered = 0
    jobs = repository.list_import_jobs(connection)
    incomplete_manual_sources = sorted({
      job["source_path"]
      for job in jobs
      if job.get("kind") == "manual_import" and job.get("status") in {"queued", "running"}
    })
    for source_path in incomplete_manual_sources:
      result = repository.deduplicate_import_jobs(connection, source_path)
      if result["deleted_job_ids"]:
        self._remove_job_artifacts(result["deleted_job_ids"])
        recovered += result["deleted_jobs"]

    jobs = repository.list_import_jobs(connection)
    for job in jobs:
      tasks = self._ensure_tasks(connection, job)
      unfinished = [task for task in self._effective_pipeline_tasks(tasks) if task["status"] in {"queued", "running"}]
      if not unfinished:
        continue

      state = self._read_job_state(job)
      next_stage = unfinished[0]["stage"]
      recovery_messages: list[str] = []

      for task in unfinished:
        if task["status"] != "running":
          continue
        should_recover = force_running or self._is_task_stale_for_recovery(job, task, state)
        if not should_recover:
          continue
        recovery_message = "Recovered after restart." if force_running else "Recovered stale running task."
        task_warnings = self._append_warning(repository.json_loads(task.get("warnings_json"), []), recovery_message)
        repository.update_pipeline_task(
          connection,
          task["id"],
          status="queued",
          warnings_json=task_warnings,
          finished_at=None,
          error_code=None,
          error_text=None,
        )
        recovery_messages.append(recovery_message)

      if recovery_messages:
        if force_running:
          state["recovered_after_restart"] = True
        state["resumable"] = True
        state["stage_state"] = "recovering"
        state["last_recovered_at"] = repository.utc_now()
        warnings = repository.json_loads(job.get("warnings_json"), [])
        stage_warnings = repository.json_loads(job.get("stage_warnings_json"), [])
        for message in recovery_messages:
          warnings = self._append_warning(warnings, message)
          stage_warnings = self._append_warning(stage_warnings, message)
        repository.update_import_job(
          connection,
          job["id"],
          status="queued",
          current_stage=next_stage,
          warnings_json=warnings,
          stage_warnings_json=stage_warnings,
          error_code=None,
          error_text=None,
          finished_at=None,
          state_json=state,
        )
        recovered += 1
      elif job.get("status") == "queued" and not state.get("resumable"):
        state["resumable"] = True
        repository.update_import_job(
          connection,
          job["id"],
          current_stage=job.get("current_stage") or next_stage,
          state_json=state,
        )

    return recovered

  def _artifact_path(self, job_id: str, name: str) -> Path:
    return self._job_dir(job_id) / name

  def _write_json(self, path: Path, payload: dict | list) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

  def _read_json(self, path: Path):
    return json.loads(path.read_text(encoding="utf-8"))

  def _sample_failures(self, failed_files: list[dict], limit: int = 5) -> list[dict]:
    return failed_files[:limit]

  def _write_failure_manifest(self, job_id: str, name: str, failed_files: list[dict]) -> str | None:
    if not failed_files:
      return None
    path = self._artifact_path(job_id, name)
    self._write_json(path, {"failed_files": failed_files})
    return str(path)

  def _build_file_counts(self, state: dict, *, processed: int | None = None, succeeded: int | None = None, failed: int | None = None, deferred_to_ocr: int | None = None) -> dict:
    current = repository.json_loads(state.get("file_counts"), {}) if isinstance(state.get("file_counts"), str) else dict(state.get("file_counts") or {})
    counts = {
      "discovered": int(current.get("discovered", 0)),
      "processed": int(current.get("processed", 0)),
      "succeeded": int(current.get("succeeded", 0)),
      "failed": int(current.get("failed", 0)),
      "deferred_to_ocr": int(current.get("deferred_to_ocr", 0)),
    }
    if processed is not None:
      counts["processed"] = int(processed)
    if succeeded is not None:
      counts["succeeded"] = int(succeeded)
    if failed is not None:
      counts["failed"] = int(failed)
    if deferred_to_ocr is not None:
      counts["deferred_to_ocr"] = int(deferred_to_ocr)
    return counts

  def _empty_citation_summary(self) -> dict[str, Any]:
    return {
      "documents_mined": 0,
      "bibliography_entries": 0,
      "parsed_entry_count": 0,
      "partially_parsed_entry_count": 0,
      "unresolved_entry_count": 0,
      "citation_mentions": 0,
      "matched_mentions": 0,
      "unresolved_mentions": 0,
      "footnotes": 0,
      "mixed_footnotes": 0,
      "commentary_footnotes": 0,
      "citation_only_footnotes": 0,
      "entry_average_confidence": 0.0,
      "mention_average_confidence": 0.0,
      "footnote_average_confidence": 0.0,
      "match_rate": 0.0,
      "unresolved_rate": 0.0,
      "average_confidence": 0.0,
      "failed_count": 0,
      "sample_failures": [],
      "manifest_path": None,
    }

  def _merge_citation_summary(self, base: dict[str, Any] | None, update: dict[str, Any] | None) -> dict[str, Any]:
    def weighted_average(base_avg: float, base_count: int, update_avg: float, update_count: int) -> float:
      total = base_count + update_count
      if total <= 0:
        return 0.0
      return round(((base_avg * base_count) + (update_avg * update_count)) / total, 3)

    summary = self._empty_citation_summary()
    base = base or {}
    update = update or {}
    for payload in (base, update):
      for key, value in payload.items():
        if key in {"average_confidence", "entry_average_confidence", "mention_average_confidence", "footnote_average_confidence", "match_rate", "unresolved_rate"}:
          continue
        if key == "sample_failures":
          summary["sample_failures"] = list(value or [])
          continue
        if key == "manifest_path":
          summary["manifest_path"] = value
          continue
        if key in summary and isinstance(summary[key], int):
          summary[key] = int(summary[key]) + int(value or 0)
    existing_docs = int(base.get("documents_mined", 0) or 0)
    update_docs = int(update.get("documents_mined", 0) or 0)
    total_docs = existing_docs + update_docs
    if total_docs > 0:
      base_avg = float(base.get("average_confidence", 0.0) or 0.0)
      update_avg = float(update.get("average_confidence", 0.0) or 0.0)
      base_total = int(base.get("bibliography_entries", 0) or 0) + int(base.get("citation_mentions", 0) or 0) + int(base.get("footnotes", 0) or 0)
      update_total = int(update.get("bibliography_entries", 0) or 0) + int(update.get("citation_mentions", 0) or 0) + int(update.get("footnotes", 0) or 0)
      summary["average_confidence"] = weighted_average(base_avg, base_total, update_avg, update_total)
    summary["entry_average_confidence"] = weighted_average(
      float(base.get("entry_average_confidence", 0.0) or 0.0),
      int(base.get("bibliography_entries", 0) or 0),
      float(update.get("entry_average_confidence", 0.0) or 0.0),
      int(update.get("bibliography_entries", 0) or 0),
    )
    summary["mention_average_confidence"] = weighted_average(
      float(base.get("mention_average_confidence", 0.0) or 0.0),
      int(base.get("citation_mentions", 0) or 0),
      float(update.get("mention_average_confidence", 0.0) or 0.0),
      int(update.get("citation_mentions", 0) or 0),
    )
    summary["footnote_average_confidence"] = weighted_average(
      float(base.get("footnote_average_confidence", 0.0) or 0.0),
      int(base.get("footnotes", 0) or 0),
      float(update.get("footnote_average_confidence", 0.0) or 0.0),
      int(update.get("footnotes", 0) or 0),
    )
    mention_total = int(summary.get("citation_mentions", 0) or 0)
    matched_total = int(summary.get("matched_mentions", 0) or 0)
    unresolved_total = int(summary.get("unresolved_mentions", 0) or 0)
    if mention_total > 0:
      summary["match_rate"] = round(matched_total / mention_total, 3)
      summary["unresolved_rate"] = round(unresolved_total / mention_total, 3)
    return summary

  def _write_citation_artifact(self, artifact_path: Path, source_path: Path, parsed: dict[str, Any]) -> dict[str, Any]:
    citation_payload = self.engine.extract_citation_artifacts(source_path, parsed)
    self._write_json(
      artifact_path,
      {
        "source_path": str(source_path),
        "citations": citation_payload,
      },
    )
    return citation_payload

  def _write_citation_artifact_safe(self, artifact_path: Path, source_path: Path, parsed: dict[str, Any], warnings: list[str]) -> dict[str, Any] | None:
    try:
      return self._write_citation_artifact(artifact_path, source_path, parsed)
    except Exception as error:
      warnings.append(f"{source_path.name}: citation mining failed, but the pipeline continued.")
      return None

  def _summarize_citation_artifacts(self, artifact_paths: list[str]) -> dict[str, Any]:
    summary = self._empty_citation_summary()
    for artifact_text in artifact_paths:
      path = Path(artifact_text)
      if not path.exists():
        continue
      payload = (self._read_json(path) or {}).get("citations") or {}
      summary = self._merge_citation_summary(summary, payload.get("summary") or {})
    return summary

  def _extract_placeholder(self, source_path: Path, error: ServiceDependencyError) -> dict:
    return {
      "title": source_path.stem.replace("_", " ").strip() or source_path.stem,
      "file_type": source_path.suffix.lower().lstrip(".") or "pdf",
      "pages": [],
      "warnings": [error.message, "Deferred to OCR stage."],
      "text": "",
      "language": "en",
      "metadata": {
        "deferred_to_ocr": True,
        "deferred_reason": error.code,
      },
    }

  def _extract_failure_entry(self, source_path: Path, stage: str, code: str, message: str, **extra) -> dict:
    entry = {
      "path": str(source_path),
      "stage": stage,
      "code": code,
      "message": message,
    }
    for key, value in extra.items():
      if value is not None:
        entry[key] = value
    return entry

  def _source_missing_message(self, source_path: Path) -> str:
    return (
      f"Source file disappeared or became inaccessible before extract: {source_path}. "
      "The file may have been moved, renamed, removed, or the drive/share may be temporarily unavailable."
    )

  def _extract_timeout_seconds_for(self, source_path: Path) -> float:
    timeout_seconds = float(settings.extract_file_timeout_seconds)
    try:
      size_mb = float(source_path.stat().st_size) / (1024.0 * 1024.0)
    except Exception:
      size_mb = 0.0

    suffix = source_path.suffix.lower()
    if size_mb > 1.0:
      timeout_seconds = max(timeout_seconds, min(240.0, 45.0 + (size_mb * 10.0)))

    if suffix == ".pdf":
      try:
        page_count = int(self.engine.ocr_provider.get_pdf_page_count(source_path) or 0)
      except Exception:
        page_count = 0
      if page_count > 0:
        timeout_seconds = max(timeout_seconds, min(240.0, 45.0 + (page_count * 0.23)))

    return round(timeout_seconds, 2)

  def _reported_timeout_seconds(self, failure: dict) -> float | None:
    raw_value = failure.get("timeout_seconds")
    if raw_value is not None:
      try:
        return float(raw_value)
      except Exception:
        pass
    message = str(failure.get("message") or "")
    match = re.search(r"after\s+(\d+(?:\.\d+)?)\s+seconds", message, re.IGNORECASE)
    if not match:
      return None
    try:
      return float(match.group(1))
    except Exception:
      return None

  def _extract_failure_recovery_key(self, failure: dict) -> str:
    return f"{str(failure.get('code') or '').strip().lower()}::{str(failure.get('path') or '').strip()}"

  def _extract_recovery_attempts(self, state: dict) -> dict[str, int]:
    current = state.get("extract_recovery_attempts")
    if not isinstance(current, dict):
      current = {}
      state["extract_recovery_attempts"] = current
    normalized: dict[str, int] = {}
    for key, value in current.items():
      try:
        normalized[str(key)] = int(value)
      except Exception:
        continue
    state["extract_recovery_attempts"] = normalized
    return normalized

  def _recoverable_extract_failure_profile(self, failure: dict) -> dict | None:
    code = str(failure.get("code") or "").strip().lower()
    message = str(failure.get("message") or "").strip().lower()
    source_path = Path(str(failure.get("path") or ""))
    if code == "extract_file_failed":
      if "codec can't encode" in message:
        return {
          "max_attempts": 2,
          "timeout_seconds": self._extract_timeout_seconds_for(source_path),
          "reason": "prior encoding failure",
        }
      if (
        "importerror" in message
        or "cannot import name 'build_math_provider'" in message
        or "no module named" in message
        or "sqrt_pattern = re.compile" in message
        or "nothing to repeat at position 0" in message
        or "exited before returning a result" in message
      ):
        return {
          "max_attempts": 2,
          "timeout_seconds": self._extract_timeout_seconds_for(source_path),
          "reason": "prior transient extractor runtime failure",
        }
    if code == "extract_file_timeout":
      adaptive_timeout = self._extract_timeout_seconds_for(source_path)
      reported_timeout = self._reported_timeout_seconds(failure)
      retry_timeout = max(adaptive_timeout, max(float(settings.extract_file_timeout_seconds) * 2.0, 90.0))
      max_attempts = 2 if reported_timeout is not None and adaptive_timeout > (reported_timeout + 5.0) else 1
      return {
        "max_attempts": max_attempts,
        "timeout_seconds": retry_timeout,
        "reason": "prior extract timeout",
        "reported_timeout_seconds": reported_timeout,
      }
    return None

  def _is_recoverable_extract_failure(self, failure: dict) -> bool:
    return self._recoverable_extract_failure_profile(failure) is not None

  def _extract_failure_from_exception(self, source_path: Path, error: Exception, *, timeout_seconds: float | None = None) -> dict:
    if isinstance(error, ServiceDependencyError):
      return self._extract_failure_entry(source_path, "extract", error.code, error.message)
    message = str(error)
    if "Timed out while extracting" in message:
      return self._extract_failure_entry(source_path, "extract", "extract_file_timeout", message, timeout_seconds=timeout_seconds)
    if "empty file" in message.lower():
      return self._extract_failure_entry(source_path, "extract", "extract_file_empty", message)
    return self._extract_failure_entry(source_path, "extract", "extract_file_failed", message)

  def _retry_recoverable_extract_failures(
    self,
    connection,
    job_id: str,
    task_id: str,
    state: dict,
    warnings: list[str],
    *,
    sources: list[str],
    artifact_paths: list[str],
    failed_files: list[dict],
    succeeded: int,
    failed: int,
  ) -> tuple[list[str], list[dict], int, int, str | None]:
    if not failed_files:
      return artifact_paths, failed_files, succeeded, failed, None
    source_positions = {str(path): index for index, path in enumerate(sources, start=1)}
    recovery_attempts = self._extract_recovery_attempts(state)
    manifest_path = None
    remaining_failures: list[dict] = []
    recovered_count = 0
    attempted_recoveries = 0
    recovery_batch_size = max(int(settings.extract_failure_recovery_batch_size), 1)
    for entry in failed_files:
      profile = self._recoverable_extract_failure_profile(entry)
      if profile is None:
        remaining_failures.append(entry)
        continue
      if attempted_recoveries >= recovery_batch_size:
        remaining_failures.append(entry)
        continue
      recovery_key = self._extract_failure_recovery_key(entry)
      if int(recovery_attempts.get(recovery_key, 0) or 0) >= int(profile["max_attempts"]):
        remaining_failures.append(entry)
        continue
      source_text = str(entry.get("path") or "").strip()
      source_index = source_positions.get(source_text)
      if not source_text or source_index is None:
        remaining_failures.append(entry)
        continue
      source_path = Path(source_text)
      if not source_path.exists():
        remaining_failures.append(entry)
        continue
      state = self._update_active_item(
        connection,
        job_id,
        task_id,
        state,
        "extract",
        source_path,
        source_index,
        len(sources),
      )
      artifact_path = self._job_dir(job_id) / "extracted" / f"{source_index:04d}.json"
      recovery_attempts[recovery_key] = int(recovery_attempts.get(recovery_key, 0) or 0) + 1
      attempted_recoveries += 1
      try:
        parsed = extract_document_with_timeout(
          source_path,
          None,
          include_ocr=False,
          timeout_seconds=float(profile["timeout_seconds"]),
        )
      except Exception as error:
        remaining_failures.append(self._extract_failure_from_exception(source_path, error, timeout_seconds=float(profile["timeout_seconds"])))
        continue
      warnings.extend(parsed.get("warnings", []))
      self._write_json(artifact_path, {"source_path": str(source_path), "parsed": parsed, "deferred_to_ocr": False})
      artifact_text = str(artifact_path)
      if artifact_text not in artifact_paths:
        artifact_paths.append(artifact_text)
      succeeded += 1
      failed = max(0, failed - 1)
      recovered_count += 1
      recovery_attempts.pop(recovery_key, None)
      warnings.append(f"{source_path.name}: auto-recovered from a {profile['reason']}.")
    if remaining_failures:
      manifest_path = self._write_failure_manifest(job_id, "extract-failures.json", remaining_failures)
    if recovered_count:
      warnings.append(f"Recovered {recovered_count} prior extract failure(s) automatically.")
    return artifact_paths, remaining_failures, succeeded, failed, manifest_path

  def _classify_ocr_exception(self, source_path: Path, error: Exception) -> tuple[dict, bool]:
    message = str(error)
    normalized = message.lower()
    provider_broken = False
    code = "ocr_file_failed"
    guidance = None
    if "convertpirattribute2runtimeattribute" in normalized or "onednn_instruction.cc" in normalized:
      code = "ocr_runtime_incompatible"
      provider_broken = True
      guidance = self._ocr_runtime_remediation_summary()
      message = (
        "PaddleOCR runtime incompatibility on this machine; kept extracted text and skipped OCR for this file. "
        f"Original error: {str(error)}"
      )
    elif (
      "remote_ocr" in normalized
      or "httpx" in normalized
      or "connection refused" in normalized
      or "unable to connect" in normalized
      or "timed out" in normalized
      or "temporary failure in name resolution" in normalized
      or "name or service not known" in normalized
      or "nodename nor servname" in normalized
      or "ocr worker is busy" in normalized
    ):
      code = "ocr_remote_unavailable"
      provider_broken = True
      guidance = self._remote_ocr_remediation_summary()
      message = (
        "Remote OCR is unavailable right now; kept extracted text and paused OCR refinement for this run. "
        f"Original error: {str(error)}"
      )
    entry = {
      "path": str(source_path),
      "stage": "ocr",
      "code": code,
      "message": message,
    }
    if guidance:
      entry["recommended_action"] = guidance
    return entry, provider_broken

  def _ocr_runtime_remediation_summary(self) -> str:
    remote_url = str(getattr(settings, "remote_ocr_url", "") or "").strip()
    if remote_url:
      return (
        "PaddleOCR runtime is incompatible on this machine. "
        f"Switch OCR to the configured remote backend at {remote_url} and retry the OCR stage later."
      )
    return (
      "PaddleOCR runtime is incompatible on this machine. "
      "Configure SEMANTIC_LIBRARY_REMOTE_OCR_URL for the built-in remote OCR fallback, or replace the local OCR backend, then retry OCR later."
    )

  def _remote_ocr_remediation_summary(self) -> str:
    remote_url = str(getattr(settings, "remote_ocr_url", "") or "").strip()
    if remote_url:
      return (
        "Remote OCR is temporarily unreachable. "
        f"The OCR stage is paused and will not move forward until the remote OCR server at {remote_url} is healthy again. "
        "Retry OCR from the saved manifest once that server is reachable."
      )
    return (
      "Remote OCR is temporarily unreachable. "
      "The OCR stage is paused and will not move forward until a reachable OCR backend is restored."
    )

  def _ocr_route_label(self) -> str:
    remote_url = str(getattr(settings, "remote_ocr_url", "") or "").strip()
    remote_only = bool(getattr(settings, "remote_only_ocr", False))
    if remote_only and remote_url:
      return f"remote_only:{remote_url}"
    if remote_only:
      return "remote_only"
    provider_name = str(getattr(self.engine.ocr_provider, "name", "") or "ocr")
    provider_detail = str(getattr(self.engine.ocr_provider, "detail", "") or "").strip()
    if provider_detail:
      return f"{provider_name}:{provider_detail}"
    return provider_name

  def _count_garbled_retry_candidates(self, failed_files: list[dict[str, Any]]) -> int:
    return sum(
      1
      for item in failed_files
      if "garbled" in str(item.get("message") or "").lower()
    )

  def _watch_folder_due_for_scan(self, folder: dict[str, Any]) -> bool:
    interval_seconds = max(float(getattr(settings, "watch_folder_scan_interval_seconds", 300.0) or 300.0), 1.0)
    last_scanned_at = self._parse_timestamp(folder.get("last_scanned_at"))
    if last_scanned_at is None:
      return True
    elapsed = max((datetime.now(timezone.utc) - last_scanned_at).total_seconds(), 0.0)
    return elapsed >= interval_seconds

  def _watch_folder_include_extensions(self, folder: dict[str, Any]) -> list[str]:
    extensions = repository.json_loads(folder.get("include_extensions_json"), [])
    return [str(item or "").strip().lower() for item in extensions if str(item or "").strip()]

  def _watch_folder_exclude_globs(self, folder: dict[str, Any]) -> list[str]:
    patterns = repository.json_loads(folder.get("exclude_globs_json"), [])
    return [str(item or "").strip() for item in patterns if str(item or "").strip()]

  def _watch_folder_scan_backend(self) -> str:
    if bool(getattr(settings, "watchfiles_enabled", True)) and watch is not None:
      return "hybrid"
    return "polling"

  def _event_change_name(self, change: Any) -> str:
    if Change is not None:
      if change == Change.added:
        return "added"
      if change == Change.modified:
        return "modified"
      if change == Change.deleted:
        return "deleted"
    lowered = str(getattr(change, "name", change)).lower()
    if "add" in lowered:
      return "added"
    if "delete" in lowered:
      return "deleted"
    return "modified"

  def _enqueue_watch_change(self, watch_folder_id: str, change_name: str, path_text: str) -> None:
    normalized_path = repository.normalize_absolute_path(path_text)
    detected_at = time.time()
    settle_seconds = getattr(settings, "watch_folder_copy_settle_seconds", 8.0)
    if settle_seconds is None:
      settle_seconds = 8.0
    ready_at = detected_at + max(float(settle_seconds), 0.0)
    with self._watch_event_lock:
      folder_events = self._pending_watch_events.setdefault(watch_folder_id, {})
      max_pending = max(int(getattr(settings, "watch_folder_event_batch_limit", 512) or 512) * 4, 64)
      existing = folder_events.get(normalized_path)
      merged_change = change_name
      if existing is not None:
        previous = str(existing.get("change") or "")
        if change_name == "deleted" or previous == "deleted":
          merged_change = "deleted"
        elif previous == "added":
          merged_change = "added"
      elif len(folder_events) >= max_pending:
        # Bound the watch-event buffer so a burst of filesystem churn cannot grow this in-memory queue without limit.
        oldest_path = next(iter(folder_events))
        folder_events.pop(oldest_path, None)
      folder_events[normalized_path] = {
        "path": path_text,
        "change": merged_change,
        "detected_at": detected_at,
        "ready_at": ready_at,
      }

  def _watch_folder_event_loop(self, folder: dict[str, Any]) -> None:
    if watch is None:
      return
    folder_path = Path(folder["path"])
    try:
      for changes in watch(
        folder_path,
        recursive=bool(folder.get("recursive")),
        debounce=max(int(getattr(settings, "watchfiles_debounce_milliseconds", 1200) or 1200), 1),
        step=max(int(getattr(settings, "watchfiles_step_milliseconds", 75) or 75), 1),
        rust_timeout=max(int(getattr(settings, "watchfiles_rust_timeout_milliseconds", 250) or 250), 1),
        yield_on_timeout=True,
      ):
        if self._watcher_stop.is_set():
          return
        if not changes:
          continue
        for change, changed_path in changes:
          self._enqueue_watch_change(folder["id"], self._event_change_name(change), str(changed_path))
    except Exception as error:
      logger.warning("Watchfiles observer failed for %s: %s", folder_path, error)

  def _ensure_watch_observers(self, connection) -> None:
    if not bool(getattr(settings, "watchfiles_enabled", True)) or watch is None:
      for folder in repository.list_watch_folders(connection):
        if folder.get("enabled"):
          repository.update_watch_folder(connection, folder["id"], watch_backend="polling")
      return
    for folder in repository.list_watch_folders(connection):
      if not folder.get("enabled"):
        continue
      if folder["id"] in self._watcher_threads:
        continue
      thread = threading.Thread(
        target=self._watch_folder_event_loop,
        args=(folder,),
        name=f"watch-folder-{folder['id']}",
        daemon=True,
      )
      self._watcher_threads[folder["id"]] = thread
      thread.start()
      repository.update_watch_folder(connection, folder["id"], watch_backend="hybrid", error_text=None)

  def _process_watch_event_batch(self, connection, folder: dict[str, Any], events: dict[str, dict[str, Any]]) -> int:
    if not events:
      return 0
    folder_path = Path(folder["path"])
    include_extensions = self._watch_folder_include_extensions(folder)
    exclude_globs = self._watch_folder_exclude_globs(folder)
    known = {
      repository.normalize_absolute_path(row["file_path"]): row
      for row in repository.list_watched_files(connection, folder["id"])
    }
    files_added = 0
    files_changed = 0
    files_deleted = 0
    files_seen = 0
    created_jobs = 0
    scan_errors = 0
    started_at = repository.utc_now()
    for normalized_path, event in events.items():
      raw_path = str(event.get("path") or normalized_path)
      change_name = str(event.get("change") or "modified")
      path = Path(raw_path)
      files_seen += 1
      try:
        if change_name == "deleted" or not path.exists():
          repository.mark_tracked_file_stale(connection, normalized_path)
          files_deleted += 1
          continue
        if self.engine._is_excluded_watch_path(path, folder_path, exclude_globs):
          continue
        allowed_extensions = self.engine._normalize_include_extensions(include_extensions)
        if path.suffix.lower() not in allowed_extensions:
          continue
        checksum = file_checksum(path)
        modified_at = iso_mtime(path)
        relative_path = str(path.relative_to(folder_path))
        snapshot = known.get(normalized_path)
        changed = (
          snapshot is None
          or snapshot.get("checksum") != checksum
          or int(snapshot.get("size_bytes") or 0) != path.stat().st_size
          or snapshot.get("modified_at") != modified_at
        )
        last_job_id = snapshot.get("last_import_job_id") if snapshot else None
        if changed:
          active_job = repository.find_active_import_job(connection, str(path), kind="watch_sync")
          if active_job is not None:
            last_job_id = active_job["id"]
          else:
            job = repository.create_import_job(
              connection,
              kind="watch_sync",
              source_path=str(path),
              created_by=folder.get("created_by"),
              options={"recursive": False, "watch_folder_id": folder["id"]},
            )
            last_job_id = job["id"]
            created_jobs += 1
          if snapshot is None:
            files_added += 1
          else:
            files_changed += 1
        repository.upsert_watched_file(
          connection,
          watch_folder_id=folder["id"],
          file_path=str(path),
          relative_path=relative_path,
          size_bytes=path.stat().st_size,
          modified_at=modified_at,
          checksum=checksum,
          last_import_job_id=last_job_id,
        )
        repository.upsert_tracked_file_discovery(
          connection,
          root_watch_folder_id=folder["id"],
          absolute_path=path,
          relative_path=relative_path,
          size_bytes=path.stat().st_size,
          mtime=modified_at,
          checksum_sha1=checksum,
          last_import_job_id=last_job_id,
          pending_import=bool(last_job_id),
          metadata_json={
            "watch_event": change_name,
            "watch_backend": "watchfiles",
          },
        )
      except Exception as error:
        scan_errors += 1
        logger.warning("Watch-folder event processing failed for %s: %s", raw_path, error)
    repository.update_watch_folder(
      connection,
      folder["id"],
      watch_backend=self._watch_folder_scan_backend(),
      last_scan_started_at=started_at,
      last_scan_finished_at=repository.utc_now(),
      last_event_at=repository.utc_now(),
      last_event_summary_json={
        "files_seen": files_seen,
        "files_added": files_added,
        "files_changed": files_changed,
        "files_deleted": files_deleted,
      },
      files_seen=files_seen,
      files_added=files_added,
      files_changed=files_changed,
      files_deleted=files_deleted,
      scan_errors=scan_errors,
      error_text=None if scan_errors == 0 else folder.get("error_text"),
    )
    if files_seen:
      logger.info(
        "Watch-folder events processed for %s: seen=%s added=%s changed=%s deleted=%s jobs=%s",
        folder["path"],
        files_seen,
        files_added,
        files_changed,
        files_deleted,
        created_jobs,
      )
    return created_jobs

  def _drain_watch_events(self, connection) -> int:
    if not self._pending_watch_events:
      return 0
    processed = 0
    ready_folders: dict[str, dict[str, dict[str, Any]]] = {}
    now = time.time()
    batch_limit = max(int(getattr(settings, "watch_folder_event_batch_limit", 512) or 512), 1)
    with self._watch_event_lock:
      for folder_id, folder_events in self._pending_watch_events.items():
        ready_items: dict[str, dict[str, Any]] = {}
        for normalized_path, event in list(folder_events.items()):
          if float(event.get("ready_at") or 0.0) > now:
            continue
          if len(ready_items) >= batch_limit:
            break
          ready_items[normalized_path] = event
          del folder_events[normalized_path]
        if ready_items:
          ready_folders[folder_id] = ready_items
      self._pending_watch_events = {
        folder_id: events
        for folder_id, events in self._pending_watch_events.items()
        if events
      }
    if not ready_folders:
      return 0
    folder_rows = {folder["id"]: folder for folder in repository.list_watch_folders(connection)}
    for folder_id, events in ready_folders.items():
      folder = folder_rows.get(folder_id)
      if folder is None or not folder.get("enabled"):
        continue
      processed += self._process_watch_event_batch(connection, folder, events)
    return processed

  def _refresh_deferred_ocr_runtime_state(self, connection) -> int:
    updated = 0
    for job in repository.list_import_jobs(connection):
      state = self._read_job_state(job)
      ocr_state = dict(state.get("ocr") or {})
      if not ocr_state or not ocr_state.get("awaiting_refinement"):
        continue
      pause_reason = str(ocr_state.get("pause_reason_code") or "")
      if pause_reason not in {"ocr_remote_unavailable", "ocr_runtime_incompatible"}:
        continue
      provider_ready = bool(self.engine.ocr_provider.ready)
      next_pause_state = "resume_ready" if provider_ready else "paused"
      if (
        ocr_state.get("pause_state") == next_pause_state
        and bool(ocr_state.get("resume_ready")) == provider_ready
      ):
        continue
      ocr_state["pause_state"] = next_pause_state
      ocr_state["resume_ready"] = provider_ready
      ocr_state["last_runtime_check_at"] = repository.utc_now()
      ocr_state["resume_note"] = (
        "OCR runtime looks healthy again. Retry the saved OCR manifest when ready."
        if provider_ready else
        "OCR is still paused. The pipeline can continue using extracted text until OCR is available again."
      )
      state["ocr"] = ocr_state
      self._write_job_state(connection, job["id"], state)
      updated += 1
    return updated

  def _queue_ready_ocr_retry(self, connection, job: dict, tasks: list[dict]) -> bool:
    state = self._read_job_state(job)
    ocr_state = dict(state.get("ocr") or {})
    if not ocr_state:
      return False
    if not bool(ocr_state.get("resume_ready")):
      return False
    failed_file_map = {
      str(item.get("path") or "").strip(): dict(item)
      for item in (ocr_state.get("failed_files") or [])
      if str(item.get("path") or "").strip()
    }
    for retry_candidate in self._detect_saved_ocr_retry_candidates(state):
      failed_file_map.setdefault(str(retry_candidate.get("path") or "").strip(), retry_candidate)
    failed_files = [item for item in failed_file_map.values() if str(item.get("path") or "").strip()]
    if not failed_files:
      return False
    ocr_task = next((task for task in tasks if task.get("stage") == "ocr"), None)
    if ocr_task is None:
      return False
    if ocr_task.get("status") == "running":
      return False

    retry_target_count = len(failed_files)
    garbled_document_count = self._count_garbled_retry_candidates(failed_files)
    now = repository.utc_now()
    ocr_state["awaiting_refinement"] = False
    ocr_state["recommended_action"] = None
    ocr_state["pause_state"] = "resuming"
    ocr_state["resume_ready"] = True
    ocr_state["resume_note"] = "OCR backend is healthy again. Retrying saved OCR failures now."
    ocr_state["last_runtime_check_at"] = now
    ocr_state["retry_mode"] = "failed_manifest"
    ocr_state["retry_target_count"] = retry_target_count
    ocr_state["retry_completed"] = 0
    ocr_state["retry_attempted"] = 0
    ocr_state["garbled_document_count"] = garbled_document_count
    ocr_state["queue_state"] = "queued"
    ocr_state["queue_note"] = "Saved OCR retry backlog is queued for the active OCR backend."
    ocr_state["ocr_route"] = self._ocr_route_label()
    state["ocr"] = ocr_state
    state["current_stage"] = "ocr"
    state["stage_state"] = "recovering"
    state["current_item_name"] = None
    state["current_item_path"] = None
    state["current_item_index"] = 0
    state["current_item_total"] = retry_target_count
    self._write_job_state(connection, job["id"], state)

    retry_payload = {
      **self._runtime_payload(
        state,
        progress_completed=0,
        progress_total=retry_target_count,
        stage_state="recovering",
      ),
      "retry_mode": "failed_manifest",
      "retry_target_count": retry_target_count,
      "retry_completed": 0,
      "retry_attempted": 0,
      "garbled_document_count": garbled_document_count,
      "queue_state": "queued",
      "queue_note": ocr_state["queue_note"],
      "ocr_route": ocr_state["ocr_route"],
      "ocr_failed": retry_target_count,
      "sample_failures": self._sample_failures(failed_files),
      "manifest_path": ocr_state.get("manifest_path"),
      "awaiting_refinement": False,
      "recommended_action": None,
      "pause_state": "resuming",
      "resume_ready": True,
      "resume_note": ocr_state["resume_note"],
    }
    repository.update_pipeline_task(
      connection,
      ocr_task["id"],
      status="queued",
      progress_completed=0,
      progress_total=retry_target_count,
      warnings_json=self._append_warning(repository.json_loads(ocr_task.get("warnings_json"), []), "Retrying saved OCR failures against the active OCR backend."),
      payload_json=retry_payload,
      error_code=None,
      error_text=None,
      started_at=None,
      finished_at=None,
    )

    reset_stage_names = {
      "structure",
      "chunk",
      "summarize",
      "embed",
      "index",
      "research_materialize",
      "technique_materialize",
      "complete",
    }
    for task in tasks:
      if task.get("stage") not in reset_stage_names:
        continue
      repository.update_pipeline_task(
        connection,
        task["id"],
        status="queued",
        progress_completed=0,
        progress_total=0,
        warnings_json=[],
        payload_json={},
        error_code=None,
        error_text=None,
        started_at=None,
        finished_at=None,
      )

    effective_tasks = self._effective_pipeline_tasks(repository.list_pipeline_tasks(connection, [job["id"]]))
    completed = sum(1 for task in effective_tasks if task["status"] == "completed")
    repository.update_import_job(
      connection,
      job["id"],
      status="queued",
      current_stage="ocr",
      progress_completed=completed,
      progress_total=len(effective_tasks),
      finished_at=None,
      state_json=state,
    )
    return True

  def _detect_saved_ocr_retry_candidates(self, state: dict) -> list[dict]:
    candidates: list[dict] = []
    for artifact_text in state.get("extracted_artifacts", []):
      artifact_path = Path(artifact_text)
      try:
        payload = self._read_json(artifact_path)
      except Exception:
        continue
      source_path = Path(str(payload.get("source_path") or ""))
      if not str(source_path):
        continue
      if source_path.suffix.lower() not in {".pdf", ".djvu", *IMAGE_EXTENSIONS}:
        continue
      retry_reason = self._ocr_retry_reason_for_payload(payload)
      if not retry_reason:
        continue
      candidates.append({
        "path": str(source_path),
        "stage": "ocr",
        "code": "ocr_retry_needed",
        "message": retry_reason,
        "recommended_action": "The saved extracted text looks incomplete or weak. Retry OCR against the active OCR backend.",
      })
    return candidates

  def _ocr_retry_reason_for_payload(self, payload: dict[str, Any]) -> str | None:
    parsed = dict(payload.get("parsed") or {})
    pages = list(parsed.get("pages") or [])
    combined_text = str(parsed.get("text") or "")
    if bool(payload.get("deferred_to_ocr")):
      return "This document was deferred to OCR earlier and still needs a full OCR pass."
    if not pages:
      return "This document has no extracted pages yet and needs OCR."
    blank_pages = 0
    weak_pages = 0
    garbled_pages = 0
    for page in pages:
      page_text = str(page.get("text") or "")
      metadata = dict(page.get("metadata") or {})
      extraction_mode = str(metadata.get("extraction_mode") or "").strip().lower()
      confidence = float(metadata.get("ocr_confidence", 0.0) or 0.0)
      if not page_text.strip():
        blank_pages += 1
      if extraction_mode in {"image_pending_ocr", "native_text_missing", "djvu_native_text_missing", "unavailable"}:
        weak_pages += 1
      elif extraction_mode.startswith("ocr_") and confidence < 0.45 and len(page_text.strip()) < 80:
        weak_pages += 1
      elif self._text_looks_garbled(page_text):
        garbled_pages += 1
    page_count = len(pages)
    if weak_pages > 0:
      return f"{weak_pages} page(s) have missing or weak OCR text."
    if garbled_pages > 0:
      return f"{garbled_pages} page(s) contain suspiciously garbled OCR text."
    if blank_pages == page_count:
      return "Every extracted page is blank."
    if page_count >= 3 and blank_pages / max(page_count, 1) >= 0.3:
      return "A large share of extracted pages are blank."
    if page_count >= 3 and len(combined_text.strip()) < 80:
      return "The extracted text is unusually sparse for a multi-page document."
    return None

  def _text_looks_garbled(self, text: str) -> bool:
    sample = str(text or "").strip()
    if len(sample) < 80:
      return False
    total_chars = len(sample)
    alpha_chars = sum(1 for char in sample if char.isalpha())
    if alpha_chars < 24:
      return False
    weird_chars = sum(1 for char in sample if not (char.isalnum() or char.isspace() or char in ".,;:!?()[]{}'\"/-–—_%&+=*#@$"))
    weird_ratio = weird_chars / max(total_chars, 1)
    replacement_ratio = sample.count("�") / max(total_chars, 1)
    tokens = re.findall(r"[A-Za-z][A-Za-z'’-]*", sample)
    if len(tokens) < 8:
      return replacement_ratio >= 0.04 or weird_ratio >= 0.22
    vowelish = sum(1 for token in tokens if re.search(r"[aeiouyAEIOUY]", token))
    vowel_ratio = vowelish / max(len(tokens), 1)
    consonant_heavy = sum(1 for token in tokens if len(token) >= 6 and not re.search(r"[aeiouyAEIOUY]", token))
    consonant_ratio = consonant_heavy / max(len(tokens), 1)
    short_token_ratio = sum(1 for token in tokens if len(token) <= 2) / max(len(tokens), 1)
    return (
      replacement_ratio >= 0.04
      or weird_ratio >= 0.18
      or consonant_ratio >= 0.22
      or (vowel_ratio <= 0.42 and short_token_ratio >= 0.45 and weird_ratio >= 0.1)
    )

  def _update_running_extract_progress(self, connection, job_id: str, task_id: str, state: dict, warnings: list[str], *, processed: int, total: int, succeeded: int, failed: int, deferred_to_ocr: int, failed_files: list[dict], manifest_path: str | None = None, citation_summary: dict[str, Any] | None = None) -> None:
    state["file_counts"] = self._build_file_counts(
      state,
      processed=processed,
      succeeded=succeeded,
      failed=failed,
      deferred_to_ocr=deferred_to_ocr,
    )
    state["extract"] = {
      "discovered_count": int(state.get("file_counts", {}).get("discovered", total) or total),
      "processed_count": processed,
      "success_count": succeeded,
      "failed_count": failed,
      "deferred_to_ocr_count": deferred_to_ocr,
      "failed_files": list(failed_files),
      "sample_failures": self._sample_failures(failed_files),
      "manifest_path": manifest_path,
    }
    self._write_job_state(connection, job_id, state)
    payload = self._runtime_payload(state, progress_completed=processed, progress_total=total, stage_state="running")
    payload.update({
      "processed": processed,
      "succeeded": succeeded,
      "failed": failed,
      "deferred_to_ocr": deferred_to_ocr,
      "citation_mine": citation_summary or state.get("citation_mine") or self._empty_citation_summary(),
      "sample_failures": self._sample_failures(failed_files),
      "manifest_path": manifest_path,
    })
    repository.update_pipeline_task(
      connection,
      task_id,
      status="running",
      progress_completed=processed,
      progress_total=total,
      warnings_json=warnings,
      payload_json=payload,
    )
    self._update_running_job_progress(connection, job_id, current_stage="extract", state=state, warnings=warnings)
    self._commit_progress_tick(connection)

  def _update_running_ocr_progress(
    self,
    connection,
    job_id: str,
    task_id: str,
    state: dict,
    warnings: list[str],
    *,
    processed: int,
    attempted: int | None = None,
    total: int,
    pages_ocrd: int,
    pages_improved: int,
    documents_touched: int,
    failed_files: list[dict],
    manifest_path: str | None = None,
    citation_summary: dict[str, Any] | None = None,
    queue_state: str = "draining",
    queue_note: str | None = None,
  ) -> None:
    effective_attempted = int(attempted if attempted is not None else processed)
    existing_ocr_state = dict(state.get("ocr") or {})
    state["ocr"] = {
      **existing_ocr_state,
      "artifact_count": processed,
      "pages_ocrd": pages_ocrd,
      "pages_improved": pages_improved,
      "documents_touched": documents_touched,
      "failed_count": len(failed_files),
      "failed_files": list(failed_files),
      "sample_failures": self._sample_failures(failed_files),
      "manifest_path": manifest_path,
      "retry_mode": "failed_manifest" if total else None,
      "retry_target_count": total,
      "retry_completed": processed,
      "retry_attempted": effective_attempted,
      "garbled_document_count": self._count_garbled_retry_candidates(failed_files),
      "queue_state": queue_state,
      "queue_note": queue_note or "OCR retry backlog is draining through the active OCR backend.",
      "ocr_route": self._ocr_route_label(),
    }
    self._write_job_state(connection, job_id, state)
    payload = self._runtime_payload(state, progress_completed=processed, progress_total=total, stage_state="running")
    payload.update({
      "pages_ocrd": pages_ocrd,
      "pages_improved": pages_improved,
      "documents_touched": documents_touched,
      "citation_mine": citation_summary or state.get("citation_mine") or self._empty_citation_summary(),
      "ocr_failed": len(failed_files),
      "sample_failures": self._sample_failures(failed_files),
      "manifest_path": manifest_path,
      "retry_mode": "failed_manifest" if total else None,
      "retry_target_count": total,
      "retry_completed": processed,
      "retry_attempted": effective_attempted,
      "garbled_document_count": self._count_garbled_retry_candidates(failed_files),
      "queue_state": queue_state,
      "queue_note": queue_note or "OCR retry backlog is draining through the active OCR backend.",
      "ocr_route": self._ocr_route_label(),
    })
    repository.update_pipeline_task(
      connection,
      task_id,
      status="running",
      progress_completed=processed,
      progress_total=total,
      warnings_json=warnings,
      payload_json=payload,
    )
    self._update_running_job_progress(connection, job_id, current_stage="ocr", state=state, warnings=warnings)
    self._commit_progress_tick(connection)

  def _update_running_ocr_document_progress(
    self,
    connection,
    job_id: str,
    task_id: str,
    state: dict,
    warnings: list[str],
    *,
    retry_completed: int,
    retry_attempted: int,
    retry_total: int,
    source_path: Path,
    page_completed: int,
    page_total: int,
  ) -> None:
    ocr_state = dict(state.get("ocr") or {})
    ocr_state["current_document_name"] = source_path.name
    ocr_state["current_document_path"] = str(source_path)
    ocr_state["current_document_page_completed"] = max(int(page_completed), 0)
    ocr_state["current_document_page_total"] = max(int(page_total), 0)
    ocr_state["retry_target_count"] = max(int(retry_total), 0)
    ocr_state["retry_completed"] = max(int(retry_completed), 0)
    ocr_state["retry_attempted"] = max(int(retry_attempted), 0)
    ocr_state["ocr_route"] = self._ocr_route_label()
    state["ocr"] = ocr_state
    self._write_job_state(connection, job_id, state)
    payload = self._runtime_payload(
      state,
      progress_completed=max(int(retry_completed), 0),
      progress_total=max(int(retry_total), 0),
      stage_state="running",
    )
    payload.update({
      "retry_target_count": max(int(retry_total), 0),
      "retry_completed": max(int(retry_completed), 0),
      "retry_attempted": max(int(retry_attempted), 0),
      "ocr_route": self._ocr_route_label(),
      "ocr_state": dict(ocr_state),
    })
    repository.update_pipeline_task(
      connection,
      task_id,
      status="running",
      progress_completed=max(int(retry_completed), 0),
      progress_total=max(int(retry_total), 0),
      warnings_json=warnings,
      payload_json=payload,
    )
    self._update_running_job_progress(connection, job_id, current_stage="ocr", state=state, warnings=warnings)
    self._commit_progress_tick(connection)

  def _update_running_stage_progress(
    self,
    connection,
    job_id: str,
    task_id: str,
    state: dict,
    warnings: list[str],
    *,
    stage: str,
    processed: int,
    total: int,
    payload_updates: dict | None = None,
    stage_updates: dict | None = None,
    semantic_stats: dict | None = None,
  ) -> None:
    if stage_updates is not None:
      state[stage] = stage_updates
    if semantic_stats is not None:
      state["semantic_stats"] = semantic_stats
    self._write_job_state(connection, job_id, state)
    payload = self._runtime_payload(
      state,
      progress_completed=processed,
      progress_total=total,
      stage_state="running",
      semantic_stats=semantic_stats,
    )
    payload.update(payload_updates or {})
    repository.update_pipeline_task(
      connection,
      task_id,
      status="running",
      progress_completed=processed,
      progress_total=total,
      warnings_json=warnings,
      payload_json=payload,
    )
    self._update_running_job_progress(connection, job_id, current_stage=stage, state=state, warnings=warnings)
    self._commit_progress_tick(connection)

  def _ensure_tasks(self, connection, job: dict) -> list[dict]:
    tasks = repository.get_or_create_pipeline_tasks(connection, job["id"], self.engine.PIPELINE_STAGES)
    if "math_extract" in self.engine.PIPELINE_STAGES:
      return tasks

    legacy_math_task = next((task for task in tasks if task.get("stage") == "math_extract"), None)
    if legacy_math_task is None:
      return tasks
    if legacy_math_task.get("status") == "completed":
      return tasks

    state = self._read_job_state(job)
    total = len(state.get("extracted_artifacts", []))
    state["math_integration"] = {
      "mode": "ocr_context",
      "note": "Math extraction is integrated into the OCR/context stage.",
    }
    if state.get("current_stage") == "math_extract":
      state["current_stage"] = "ocr"
    self._write_job_state(connection, job["id"], state)
    repository.update_pipeline_task(
      connection,
      legacy_math_task["id"],
      status="completed",
      progress_completed=total,
      progress_total=total,
      warnings_json=["Math extraction is integrated into the OCR/context stage."],
      payload_json={
        **self._runtime_payload(state, progress_completed=total, progress_total=total, stage_state="completed"),
        "math_integrated_with_ocr": True,
        "math_integration_mode": "ocr_context",
        "recommended_action": "Math extraction is now performed inside the OCR/context stage.",
      },
      error_code=None,
      error_text=None,
      finished_at=repository.utc_now(),
    )
    if job.get("current_stage") == "math_extract":
      repository.update_import_job(connection, job["id"], current_stage="ocr", state_json=state)
    return repository.list_pipeline_tasks(connection, [job["id"]])

  def _update_running_job_progress(self, connection, job_id: str, *, current_stage: str, state: dict, warnings: list[str] | None = None) -> None:
    all_tasks = repository.list_pipeline_tasks(connection, [job_id])
    effective_tasks = self._effective_pipeline_tasks(all_tasks)
    completed = sum(1 for task in effective_tasks if task["status"] == "completed")
    normalized_stage = "ocr" if current_stage == "math_extract" else current_stage
    current_job = repository.get_import_job(connection, job_id) or {}
    repository.update_import_job(
      connection,
      job_id,
      status="running",
      current_stage=normalized_stage,
      progress_completed=completed,
      progress_total=len(effective_tasks),
      warnings_json=warnings or repository.json_loads(current_job.get("warnings_json"), []),
      state_json=state,
      finished_at=None,
    )

  def _is_legacy_math_alias_task(self, task: dict) -> bool:
    return task.get("stage") == "math_extract" and "math_extract" not in self.engine.PIPELINE_STAGES

  def _effective_pipeline_tasks(self, tasks: list[dict]) -> list[dict]:
    return [task for task in tasks if not self._is_legacy_math_alias_task(task)]

  def _should_pause_for_refinement(self, connection, job: dict) -> bool:
    state = self._read_job_state(job)
    if not state.get("awaiting_refinement"):
      return False
    missing_services = [item for item in state.get("missing_services", []) if item]
    unresolved = [service for service in missing_services if not self._runtime_service_ready(service)]
    if unresolved:
      state["stage_state"] = "awaiting_refinement"
      state["stall_minutes"] = self._stall_minutes(state.get("last_progress_at"))
      self._write_job_state(connection, job["id"], state)
      return True
    self._clear_refinement_state(state)
    state["stage_state"] = "recovering"
    state["next_check"] = "Runtime dependencies look healthy again. Retesting the current stage now."
    self._write_job_state(connection, job["id"], state)
    return False

  def _sync_watch_folders(self, connection) -> int:
    created_jobs = 0
    for folder in repository.list_watch_folders(connection):
      if not folder.get("enabled"):
        continue
      if not self._watch_folder_due_for_scan(folder):
        continue
      first_scan = self._parse_timestamp(folder.get("last_scanned_at")) is None
      folder_path = Path(folder["path"])
      include_extensions = self._watch_folder_include_extensions(folder)
      exclude_globs = self._watch_folder_exclude_globs(folder)
      started_at = repository.utc_now()
      files_seen = 0
      files_added = 0
      files_changed = 0
      files_deleted = 0
      scan_errors = 0
      try:
        try:
          sources = self.engine.discover_sources(
            folder_path,
            recursive=bool(folder["recursive"]),
            include_extensions=include_extensions,
            exclude_globs=exclude_globs,
          )
        except ValueError as error:
          if "No supported documents were found" in str(error):
            sources = []
          else:
            raise
        files_seen = len(sources)
        known = {row["file_path"]: row for row in repository.list_watched_files(connection, folder["id"])}
        seen_paths: list[str] = []
        for source in sources:
          seen_paths.append(str(source))
          snapshot = known.get(str(source))
          checksum = file_checksum(source)
          modified_at = iso_mtime(source)
          changed = (
            snapshot is None
            or snapshot.get("checksum") != checksum
            or int(snapshot.get("size_bytes") or 0) != source.stat().st_size
            or snapshot.get("modified_at") != modified_at
          )
          last_job_id = snapshot.get("last_import_job_id") if snapshot else None
          if changed:
            if first_scan and snapshot is None:
              last_job_id = None
            else:
              active_job = repository.find_active_import_job(connection, str(source), kind="watch_sync")
              if active_job is not None:
                last_job_id = active_job["id"]
              else:
                job = repository.create_import_job(
                  connection,
                  kind="watch_sync",
                  source_path=str(source),
                  created_by=folder.get("created_by"),
                  options={"recursive": False, "watch_folder_id": folder["id"]},
                )
                last_job_id = job["id"]
                created_jobs += 1
            if snapshot is None:
              files_added += 1
            else:
              files_changed += 1
          repository.upsert_watched_file(
            connection,
            watch_folder_id=folder["id"],
            file_path=str(source),
            relative_path=str(source.relative_to(folder_path)),
            size_bytes=source.stat().st_size,
            modified_at=modified_at,
            checksum=checksum,
            last_import_job_id=last_job_id,
          )
          repository.upsert_tracked_file_discovery(
            connection,
            root_watch_folder_id=folder["id"],
            absolute_path=source,
            relative_path=str(source.relative_to(folder_path)),
            size_bytes=source.stat().st_size,
            mtime=modified_at,
            checksum_sha1=checksum,
            last_import_job_id=last_job_id,
            pending_import=bool(last_job_id),
            metadata_json={
              "watch_folder_sync": True,
              "first_scan": first_scan,
            },
          )
        files_deleted = repository.mark_tracked_files_stale_for_watch_folder(connection, folder["id"], seen_paths)
        repository.update_watch_folder(
          connection,
          folder["id"],
          last_scan_started_at=started_at,
          last_scan_finished_at=repository.utc_now(),
          last_scanned_at=repository.utc_now(),
          files_seen=files_seen,
          files_added=files_added,
          files_changed=files_changed,
          files_deleted=files_deleted,
          scan_errors=scan_errors,
          watch_backend=self._watch_folder_scan_backend(),
          last_event_summary_json={
            "files_seen": files_seen,
            "files_added": files_added,
            "files_changed": files_changed,
            "files_deleted": files_deleted,
            "full_reconciliation": True,
          },
          error_text=None,
        )
        logger.info(
          "Watch-folder reconcile for %s: seen=%s added=%s changed=%s deleted=%s jobs=%s",
          folder["path"],
          files_seen,
          files_added,
          files_changed,
          files_deleted,
          created_jobs,
        )
      except Exception as error:
        scan_errors += 1
        repository.update_watch_folder(
          connection,
          folder["id"],
          last_scan_started_at=started_at,
          last_scan_finished_at=repository.utc_now(),
          scan_errors=scan_errors,
          watch_backend=self._watch_folder_scan_backend(),
          error_text=str(error),
        )
        logger.warning("Watch-folder reconcile failed for %s: %s", folder["path"], error)
    return created_jobs

  def _run_stage(self, connection, job: dict, task: dict) -> dict:
    job_id = job["id"]
    stage = task["stage"]
    state = self._read_job_state(job)
    workspace = self._job_dir(job_id)
    options = repository.json_loads(job.get("options_json"), {})
    state["root_watch_folder_id"] = state.get("root_watch_folder_id") or self._resolve_root_watch_folder_id(connection, job["source_path"], options)

    if stage == "discover":
      discovery = self.engine.discover_sources_stable(Path(job["source_path"]), recursive=bool(options.get("recursive", True)))
      sources = discovery["sources"]
      state["sources"] = [str(source) for source in sources]
      state["discovery"] = {
        "stable": bool(discovery.get("stable")),
        "pass_count": int(discovery.get("pass_count", 1) or 1),
        "required_stable_passes": int(discovery.get("required_stable_passes", 1) or 1),
        "passes": discovery.get("passes", []),
      }
      state["file_counts"] = {
        "discovered": len(sources),
        "processed": 0,
        "succeeded": 0,
        "failed": 0,
        "deferred_to_ocr": 0,
      }
      state["resumable"] = True
      state["current_item_total"] = len(sources)
      for source in sources:
        source_path = Path(source)
        matched_folder = repository.find_watch_folder_for_path(connection, source_path)
        root_watch_folder_id = str(matched_folder["id"]) if matched_folder is not None else state.get("root_watch_folder_id")
        relative_path = source_path.name
        if matched_folder is not None:
          try:
            relative_path = str(source_path.relative_to(Path(matched_folder["path"])))
          except Exception:
            relative_path = source_path.name
        size_bytes = source_path.stat().st_size if source_path.exists() else 0
        mtime = iso_mtime(source_path) if source_path.exists() else None
        repository.upsert_tracked_file_discovery(
          connection,
          root_watch_folder_id=root_watch_folder_id,
          absolute_path=source_path,
          relative_path=relative_path,
          size_bytes=size_bytes,
          mtime=mtime,
          checksum_sha1=None,
          last_import_job_id=job_id,
          pending_import=True,
          metadata_json={"discovered_by_job": job_id, "stage": "discover"},
        )
        self._reconcile_file_stage(
          connection,
          state,
          source_path=source_path,
          stage="discover",
          status="completed",
          import_job_id=job_id,
          event_message="File was discovered and queued into the import pipeline.",
        )
      self._write_job_state(connection, job_id, state)
      payload = self._runtime_payload(state, progress_completed=len(sources), progress_total=len(sources), stage_state="completed")
      payload["discovered"] = len(sources)
      payload["discovery"] = state["discovery"]
      warnings: list[str] = []
      if not discovery.get("stable"):
        warnings.append(
          f"Directory listing did not stabilize after {discovery.get('pass_count', 1)} discovery passes. Continuing with the latest snapshot."
        )
      return {
        "progress_completed": len(sources),
        "progress_total": len(sources),
        "payload": payload,
        "warnings": warnings,
      }

    if stage == "extract":
      artifact_paths = list(state.get("extracted_artifacts", []))
      citation_artifact_paths = list(state.get("citation_artifacts", []))
      warnings: list[str] = []
      failed_files: list[dict] = []
      sources = state.get("sources", [])
      total = len(sources)
      extract_state = dict(state.get("extract") or {})
      citation_state = dict(state.get("citation_mine") or {})
      file_counts = self._build_file_counts(state)
      processed = min(int(file_counts.get("processed", 0) or 0), total)
      succeeded = int(file_counts.get("succeeded", 0) or 0)
      failed = int(file_counts.get("failed", 0) or 0)
      deferred_to_ocr = int(file_counts.get("deferred_to_ocr", 0) or 0)
      failed_files = list(extract_state.get("failed_files") or [])
      manifest_path = extract_state.get("manifest_path")
      citation_summary = self._merge_citation_summary(self._empty_citation_summary(), citation_state)
      artifact_paths, failed_files, succeeded, failed, recovered_manifest_path = self._retry_recoverable_extract_failures(
        connection,
        job_id,
        task["id"],
        state,
        warnings,
        sources=sources,
        artifact_paths=artifact_paths,
        failed_files=failed_files,
        succeeded=succeeded,
        failed=failed,
      )
      if recovered_manifest_path is not None or not failed_files:
        manifest_path = recovered_manifest_path
      batch_size = max(int(settings.extract_stage_batch_size), 1)
      batch_end = min(processed + batch_size, total)

      if processed >= total:
        state["extracted_artifacts"] = artifact_paths
        state["citation_artifacts"] = citation_artifact_paths
        state["citation_mine"] = citation_summary
        self._update_running_extract_progress(
          connection,
          job_id,
          task["id"],
          state,
          warnings,
          processed=processed,
          total=total,
          succeeded=succeeded,
          failed=failed,
          deferred_to_ocr=deferred_to_ocr,
          failed_files=failed_files,
          manifest_path=manifest_path,
          citation_summary=citation_summary,
        )
      for index, source_text in enumerate(sources[processed:batch_end], start=processed + 1):
        source_path = Path(source_text)
        artifact_path = workspace / "extracted" / f"{index:04d}.json"
        citation_path = workspace / "citations" / f"{index:04d}.json"
        state = self._update_active_item(
          connection,
          job_id,
          task["id"],
          state,
          "extract",
          source_path,
          index,
          total,
          payload={
            "processed": processed,
            "succeeded": succeeded,
            "failed": failed,
            "deferred_to_ocr": deferred_to_ocr,
            "citation_mine": citation_summary,
            "sample_failures": self._sample_failures(failed_files),
            "manifest_path": manifest_path,
          },
        )
        extract_timeout_seconds = self._extract_timeout_seconds_for(source_path)
        try:
          if not source_path.exists():
            missing_message = self._source_missing_message(source_path)
            failed += 1
            failed_files.append(
              self._extract_failure_entry(
                source_path,
                "extract",
                "extract_file_missing",
                missing_message,
              )
            )
            self._reconcile_file_stage(
              connection,
              state,
              source_path=source_path,
              stage="extract",
              status="failed",
              import_job_id=job_id,
              error_message=missing_message,
              event_message="Extract failed because the source file was missing.",
            )
            processed += 1
            if failed_files:
              manifest_path = self._write_failure_manifest(job_id, "extract-failures.json", failed_files)
            if processed % 25 == 0 or processed == total:
              state["extracted_artifacts"] = artifact_paths
              state["citation_artifacts"] = citation_artifact_paths
              state["citation_mine"] = citation_summary
              self._update_running_extract_progress(
                connection,
                job_id,
                task["id"],
                state,
                warnings,
                processed=processed,
                total=total,
                succeeded=succeeded,
                failed=failed,
                deferred_to_ocr=deferred_to_ocr,
                failed_files=failed_files,
                manifest_path=manifest_path,
                citation_summary=citation_summary,
              )
            continue
          parsed = extract_document_with_timeout(
            source_path,
            None,
            include_ocr=False,
            timeout_seconds=extract_timeout_seconds,
          )
          warnings.extend(parsed.get("warnings", []))
          self._write_json(artifact_path, {"source_path": str(source_path), "parsed": parsed, "deferred_to_ocr": False})
          citation_payload = self._write_citation_artifact_safe(citation_path, source_path, parsed, warnings)
          artifact_paths.append(str(artifact_path))
          if citation_payload is not None:
            citation_artifact_paths.append(str(citation_path))
            citation_summary = self._merge_citation_summary(citation_summary, citation_payload.get("summary") or {})
          succeeded += 1
          self._reconcile_file_stage(
            connection,
            state,
            source_path=source_path,
            stage="extract",
            status="completed",
            import_job_id=job_id,
            event_message="Extract completed for this file.",
            metadata={"ocr_pending": False},
          )
        except ServiceDependencyError as error:
          suffix = source_path.suffix.lower()
          can_recover_with_ocr = self._can_recover_document_with_ocr(source_path)
          if (
            (suffix == ".pdf" and error.code == "pdf_crypto_dependency_missing" and can_recover_with_ocr)
            or (suffix == ".djvu" and error.code == "djvu_dependency_missing" and can_recover_with_ocr)
          ):
            parsed = self._extract_placeholder(source_path, error)
            self._write_json(
              artifact_path,
              {
                "source_path": str(source_path),
                "parsed": parsed,
                "deferred_to_ocr": True,
                "extract_error_code": error.code,
              },
            )
            citation_payload = self._write_citation_artifact_safe(citation_path, source_path, parsed, warnings)
            artifact_paths.append(str(artifact_path))
            if citation_payload is not None:
              citation_artifact_paths.append(str(citation_path))
              citation_summary = self._merge_citation_summary(citation_summary, citation_payload.get("summary") or {})
            deferred_to_ocr += 1
            reason = "native extraction requires cryptography" if suffix == ".pdf" else "native DJVU extraction is unavailable"
            warnings.append(f"{source_path.name}: deferred to OCR because {reason}.")
            self._reconcile_file_stage(
              connection,
              state,
              source_path=source_path,
              stage="extract",
              status="completed",
              import_job_id=job_id,
              event_message="Native extraction completed with OCR follow-up required.",
              metadata={"ocr_pending": True},
            )
          else:
            failed += 1
            failed_files.append(self._extract_failure_entry(source_path, "extract", error.code, error.message))
            self._reconcile_file_stage(
              connection,
              state,
              source_path=source_path,
              stage="extract",
              status="failed",
              import_job_id=job_id,
              error_message=error.message,
              event_message=f"Extract failed: {error.code}.",
            )
        except Exception as error:
          message = str(error)
          suffix = source_path.suffix.lower()
          if suffix == ".pdf" and (
            "only Standard PDF encryption handler is available" in message
            or "unsupported security scheme" in message.lower()
          ):
            if self._can_recover_document_with_ocr(source_path):
              parsed = self._extract_placeholder(
                source_path,
                ServiceDependencyError(
                  code="pdf_encryption_unsupported",
                  message="Native PDF extraction could not open this encrypted PDF with the available handler.",
                  missing_services=[],
                ),
              )
              self._write_json(
                artifact_path,
                {
                  "source_path": str(source_path),
                  "parsed": parsed,
                  "deferred_to_ocr": True,
                  "extract_error_code": "pdf_encryption_unsupported",
                },
              )
              citation_payload = self._write_citation_artifact_safe(citation_path, source_path, parsed, warnings)
              artifact_paths.append(str(artifact_path))
              if citation_payload is not None:
                citation_artifact_paths.append(str(citation_path))
                citation_summary = self._merge_citation_summary(citation_summary, citation_payload.get("summary") or {})
              deferred_to_ocr += 1
              warnings.append(f"{source_path.name}: deferred to OCR because native PDF extraction could not open the encrypted document.")
              self._reconcile_file_stage(
                connection,
                state,
                source_path=source_path,
                stage="extract",
                status="completed",
                import_job_id=job_id,
                event_message="Native extraction completed with OCR follow-up required.",
                metadata={"ocr_pending": True},
              )
            else:
              failed += 1
              failed_files.append(self._extract_failure_entry(source_path, "extract", "pdf_encryption_unsupported", message))
              self._reconcile_file_stage(
                connection,
                state,
                source_path=source_path,
                stage="extract",
                status="failed",
                import_job_id=job_id,
                error_message=message,
                event_message="Extract failed because the PDF encryption scheme is unsupported.",
              )
          elif "empty file" in message.lower():
            failed += 1
            failed_files.append(self._extract_failure_entry(source_path, "extract", "extract_file_empty", message))
            self._reconcile_file_stage(
              connection,
              state,
              source_path=source_path,
              stage="extract",
              status="failed",
              import_job_id=job_id,
              error_message=message,
              event_message="Extract failed because the file was empty.",
            )
          elif "Timed out while extracting" in message:
            failed += 1
            failed_files.append(self._extract_failure_entry(source_path, "extract", "extract_file_timeout", message, timeout_seconds=extract_timeout_seconds))
            self._reconcile_file_stage(
              connection,
              state,
              source_path=source_path,
              stage="extract",
              status="failed",
              import_job_id=job_id,
              error_message=message,
              event_message="Extract timed out for this file.",
            )
          else:
            failed += 1
            failed_files.append(self._extract_failure_entry(source_path, "extract", "extract_file_failed", message))
            self._reconcile_file_stage(
              connection,
              state,
              source_path=source_path,
              stage="extract",
              status="failed",
              import_job_id=job_id,
              error_message=message,
              event_message="Extract failed for this file.",
            )
        processed += 1
        if failed_files:
          manifest_path = self._write_failure_manifest(job_id, "extract-failures.json", failed_files)
        if processed % 25 == 0 or processed == total or processed == batch_end:
          state["extracted_artifacts"] = artifact_paths
          state["citation_artifacts"] = citation_artifact_paths
          state["citation_mine"] = citation_summary
          self._update_running_extract_progress(
            connection,
            job_id,
            task["id"],
            state,
            warnings,
            processed=processed,
            total=total,
            succeeded=succeeded,
            failed=failed,
            deferred_to_ocr=deferred_to_ocr,
            failed_files=failed_files,
            manifest_path=manifest_path,
            citation_summary=citation_summary,
          )
      state["extracted_artifacts"] = artifact_paths
      state["citation_artifacts"] = citation_artifact_paths
      state["citation_mine"] = citation_summary
      self._update_running_extract_progress(
        connection,
        job_id,
        task["id"],
        state,
        warnings,
        processed=processed,
        total=total,
        succeeded=succeeded,
        failed=failed,
        deferred_to_ocr=deferred_to_ocr,
        failed_files=failed_files,
        manifest_path=manifest_path,
        citation_summary=citation_summary,
      )
      result = {
        "progress_completed": processed,
        "progress_total": total,
        "warnings": warnings,
        "payload": {
          **self._runtime_payload(
            state,
            progress_completed=processed,
            progress_total=total,
            stage_state="completed" if processed >= total and succeeded + deferred_to_ocr > 0 else ("running" if processed < total else "failed"),
          ),
          "processed": processed,
          "succeeded": succeeded,
          "failed": failed,
          "deferred_to_ocr": deferred_to_ocr,
          "citation_mine": citation_summary,
          "sample_failures": self._sample_failures(failed_files),
          "manifest_path": manifest_path,
        },
      }
      if processed >= total and succeeded + deferred_to_ocr <= 0:
        result["task_status"] = "failed"
        result["error_code"] = "extract_all_files_failed"
        result["error_text"] = f"All {processed} discovered files failed during extract."
      elif processed < total:
        result["task_status"] = "running"
      return result

    if stage == "math_extract":
      total = len(state.get("extracted_artifacts", []))
      state["math_integration"] = {
        "mode": "ocr_context",
        "note": "Math extraction is integrated into the OCR/context stage.",
      }
      self._write_job_state(connection, job_id, state)
      return {
        "progress_completed": total,
        "progress_total": total,
        "payload": {
          **self._runtime_payload(state, progress_completed=total, progress_total=total, stage_state="completed"),
          "math_integrated_with_ocr": True,
          "math_integration_mode": "ocr_context",
          "math_pages_scanned": int((state.get("math") or {}).get("pages_scanned", 0) or 0),
          "math_regions_detected": int((state.get("math") or {}).get("regions_detected", 0) or 0),
          "math_formula_count": int((state.get("math") or {}).get("formula_count", 0) or 0),
          "math_formula_recognized": int((state.get("math") or {}).get("formula_recognized", 0) or 0),
          "math_formula_pending": int((state.get("math") or {}).get("formula_pending", 0) or 0),
          "documents_with_math_artifacts": int((state.get("math") or {}).get("documents_with_math_artifacts", 0) or 0),
          "math_confidence_summary": dict((state.get("math") or {}).get("confidence_summary") or {}),
          "recommended_action": "Math extraction is now performed inside the OCR/context stage.",
        },
        "warnings": ["Math extraction is integrated into the OCR/context stage."],
      }

    if stage == "ocr":
      all_artifact_texts = list(state.get("ocr_artifacts") or state.get("extracted_artifacts", []))
      ocr_state = dict(state.get("ocr") or {})
      retry_mode = str(ocr_state.get("retry_mode") or "").strip().lower()
      retry_failed_files = [item for item in (ocr_state.get("failed_files") or []) if str(item.get("path") or "").strip()]
      retry_targets_by_path = {str(item.get("path")): item for item in retry_failed_files}
      artifact_path_lookup: dict[str, str] = {}
      for artifact_text in all_artifact_texts:
        try:
          source_path = str((self._read_json(Path(artifact_text)) or {}).get("source_path") or "").strip()
        except Exception:
          source_path = ""
        if source_path:
          artifact_path_lookup[source_path] = artifact_text
      retry_artifact_texts = [artifact_path_lookup[path] for path in retry_targets_by_path.keys() if path in artifact_path_lookup]
      artifact_texts = retry_artifact_texts if retry_mode == "failed_manifest" and retry_artifact_texts else all_artifact_texts
      updated_artifacts = list(all_artifact_texts)
      warnings: list[str] = []
      citation_artifact_paths: list[str] = list(state.get("citation_artifacts", []))
      citation_summary = self._summarize_citation_artifacts(citation_artifact_paths)
      total = len(artifact_texts)
      pages_ocrd = 0
      pages_improved = 0
      documents_touched = 0
      ocr_failed_files: list[dict] = [
        item for item in retry_failed_files
        if retry_mode == "failed_manifest" and str(item.get("path") or "").strip() not in artifact_path_lookup
      ]
      ocr_stage_remediation: dict | None = None
      existing_math_artifact_map = {
        Path(path).name: str(path)
        for path in state.get("math_artifacts", [])
      }
      math_pages_scanned = 0
      math_regions_detected = 0
      math_formula_count = 0
      math_formula_recognized = 0
      math_formula_pending = 0
      math_documents_with_artifacts = 0
      math_confidence_samples: list[float] = []
      math_awaiting_refinement = False
      math_recommended_action = None
      workspace_math_dir = workspace / "math"
      workspace_math_dir.mkdir(parents=True, exist_ok=True)
      workspace_markdown_dir = workspace / "markdown"
      workspace_markdown_dir.mkdir(parents=True, exist_ok=True)
      workspace_citation_dir = workspace / "citations"
      workspace_citation_dir.mkdir(parents=True, exist_ok=True)
      retry_completed = 0
      retry_attempted = 0
      if retry_mode == "failed_manifest" and total <= 0:
        state["ocr"] = {
          **ocr_state,
          "awaiting_refinement": False,
          "recommended_action": None,
          "pause_state": "ready",
          "resume_ready": True,
          "resume_note": "No saved OCR retry targets remained. Continuing with existing extracted text.",
          "retry_mode": None,
          "retry_target_count": 0,
          "retry_completed": 0,
          "retry_attempted": 0,
          "garbled_document_count": self._count_garbled_retry_candidates(ocr_failed_files),
          "failed_count": len(ocr_failed_files),
          "failed_files": list(ocr_failed_files),
          "sample_failures": self._sample_failures(ocr_failed_files),
          "queue_state": "completed",
          "queue_note": "No saved OCR retry targets remained.",
          "ocr_route": self._ocr_route_label(),
        }
        self._write_job_state(connection, job_id, state)
        return {
          "progress_completed": 0,
          "progress_total": 0,
          "warnings": ["No saved OCR retry targets remained for this job."],
          "payload": {
            **self._runtime_payload(state, progress_completed=0, progress_total=0, stage_state="completed"),
            "retry_mode": "failed_manifest",
            "retry_target_count": 0,
            "retry_completed": 0,
            "retry_attempted": 0,
            "garbled_document_count": self._count_garbled_retry_candidates(ocr_failed_files),
            "queue_state": "completed",
            "queue_note": "No saved OCR retry targets remained.",
            "ocr_route": self._ocr_route_label(),
            "ocr_failed": len(ocr_failed_files),
            "sample_failures": self._sample_failures(ocr_failed_files),
          },
        }
      for index, artifact_text in enumerate(artifact_texts, start=1):
        artifact_path = Path(artifact_text)
        payload = self._read_json(artifact_path)
        source_path = Path(payload["source_path"])
        citation_path = workspace_citation_dir / artifact_path.name
        state = self._update_active_item(connection, job_id, task["id"], state, "ocr", source_path, index, total)
        try:
          retry_attempted = index
          retry_entry = retry_targets_by_path.get(str(source_path))
          retry_requires_full_refresh = bool(retry_entry and str(retry_entry.get("code") or "") == "ocr_retry_needed")
          self._update_running_ocr_document_progress(
            connection,
            job_id,
            task["id"],
            state,
            warnings,
            retry_completed=retry_completed,
            retry_attempted=retry_attempted,
            retry_total=total,
            source_path=source_path,
            page_completed=0,
            page_total=0,
          )
          def _progress_callback(page_completed: int, page_total: int) -> None:
            self._update_running_ocr_document_progress(
              connection,
              job_id,
              task["id"],
              state,
              warnings,
              retry_completed=retry_completed,
              retry_attempted=retry_attempted,
              retry_total=total,
              source_path=source_path,
              page_completed=page_completed,
              page_total=page_total,
            )
          ocr_refresh = self.engine.refresh_document_ocr(
            source_path,
            payload["parsed"],
            deferred_to_ocr=bool(payload.get("deferred_to_ocr")) or retry_requires_full_refresh,
            progress_callback=_progress_callback,
          )
          parsed = ocr_refresh["parsed"]
          if ocr_refresh.get("document_changed"):
            payload["parsed"] = parsed
            payload["deferred_to_ocr"] = False
            self._write_json(artifact_path, payload)
            documents_touched += 1
          retry_completed += 1
          if int(ocr_refresh.get("pages_ocrd", 0) or 0) > 0:
            self._update_running_ocr_document_progress(
              connection,
              job_id,
              task["id"],
              state,
              warnings,
              retry_completed=retry_completed,
              retry_attempted=retry_attempted,
              retry_total=total,
              source_path=source_path,
              page_completed=int(ocr_refresh.get("pages_ocrd", 0) or 0),
              page_total=int(ocr_refresh.get("pages_ocrd", 0) or 0),
            )
          warnings.extend(ocr_refresh.get("warnings", []))
          pages_ocrd += int(ocr_refresh.get("pages_ocrd", 0) or 0)
          pages_improved += int(ocr_refresh.get("pages_improved", 0) or 0)
          self._reconcile_file_stage(
            connection,
            state,
            source_path=source_path,
            stage="ocr",
            status="completed",
            import_job_id=job_id,
            event_message="OCR completed for this file.",
            metadata={
              "pages_ocrd": int(ocr_refresh.get("pages_ocrd", 0) or 0),
              "pages_improved": int(ocr_refresh.get("pages_improved", 0) or 0),
              "compute_provenance": getattr(
                self.engine.ocr_provider,
                "provenance",
                lambda: {"provider": getattr(self.engine.ocr_provider, "name", "ocr"), "location": "local"},
              )(),
            },
          )
        except ServiceDependencyError as error:
          warnings.append(f"{source_path.name}: OCR skipped because {error.message}")
          failure_entry = {
            "path": str(source_path),
            "stage": "ocr",
            "code": error.code,
            "message": error.message,
          }
          ocr_failed_files.append(failure_entry)
          pause_reason_code = str(error.code or "").strip().lower()
          provider_broken = (
            pause_reason_code in {"ocr_remote_unavailable", "ocr_provider_unavailable", "import_runtime_unavailable"}
            or "ocr" in {str(item).strip().lower() for item in list(error.missing_services or [])}
          )
          if provider_broken:
            recommended_action = (
              self._remote_ocr_remediation_summary()
              if "remote" in pause_reason_code or "ocr" in {str(item).strip().lower() for item in list(error.missing_services or [])} else
              self._ocr_runtime_remediation_summary()
            )
            ocr_stage_remediation = {
              "awaiting_refinement": True,
              "recommended_action": recommended_action,
              "next_check": "Retest OCR after the remote OCR server is healthy again.",
              "retry_hint": "OCR is paused until the remote server becomes reachable again.",
              "retry_command": "Bring the OCR server back online, then rerun the worker or resume the OCR stage.",
              "can_continue": False,
              "missing_services": ["ocr"],
            }
            warnings.append("OCR is paused because the remote OCR server is unavailable.")
            if retry_mode != "failed_manifest":
              updated_artifacts.extend(artifact_texts[index:])
            self._reconcile_file_stage(
              connection,
              state,
              source_path=source_path,
              stage="ocr",
              status="pending",
              import_job_id=job_id,
              error_message=error.message,
              event_message="OCR is paused because the remote OCR runtime is unavailable.",
            )
            break
          self._reconcile_file_stage(
            connection,
            state,
            source_path=source_path,
            stage="ocr",
            status="failed",
            import_job_id=job_id,
            error_message=error.message,
            event_message="OCR failed for this file.",
          )
        except Exception as error:
          warnings.append(f"{source_path.name}: OCR failed but the pipeline continued.")
          failure_entry, provider_broken = self._classify_ocr_exception(source_path, error)
          ocr_failed_files.append(failure_entry)
          if provider_broken:
            pause_reason_code = failure_entry.get("code") or "ocr_runtime_unavailable"
            recommended_action = (
              self._remote_ocr_remediation_summary()
              if pause_reason_code == "ocr_remote_unavailable" else
              self._ocr_runtime_remediation_summary()
            )
            ocr_stage_remediation = {
              "awaiting_refinement": True,
              "recommended_action": recommended_action,
              "next_check": (
                "Retest OCR after the remote OCR server is healthy again."
                if pause_reason_code == "ocr_remote_unavailable" else
                "Retest OCR after changing the local OCR runtime."
              ),
              "retry_hint": "Resume the OCR stage later; the current run will continue with extracted text only.",
              "retry_command": "Resume the failed OCR work from the job state after OCR runtime refinement.",
              "can_continue": True,
              "missing_services": ["ocr" if pause_reason_code == "ocr_remote_unavailable" else "ocr_runtime_compatible"],
            }
            warnings.append(
              "OCR refinement is paused for this run. Skipping further OCR attempts and continuing with extracted text."
            )
            if retry_mode != "failed_manifest":
              updated_artifacts.extend(artifact_texts[index:])
            self._reconcile_file_stage(
              connection,
              state,
              source_path=source_path,
              stage="ocr",
              status="pending",
              import_job_id=job_id,
              error_message=failure_entry.get('message'),
              event_message="OCR is paused for this file until the OCR runtime is healthy again.",
            )
            break
          self._reconcile_file_stage(
            connection,
            state,
            source_path=source_path,
            stage="ocr",
            status="failed",
            import_job_id=job_id,
            error_message=failure_entry.get("message"),
            event_message="OCR failed for this file.",
          )
        citation_payload = self._write_citation_artifact_safe(citation_path, source_path, payload["parsed"], warnings)
        if citation_payload is not None:
          if str(citation_path) not in citation_artifact_paths:
            citation_artifact_paths.append(str(citation_path))
          citation_summary = self._summarize_citation_artifacts(citation_artifact_paths)
        math_payload = self.engine.extract_math_artifacts(source_path, payload["parsed"], artifact_dir=workspace / "math-crops")
        math_path = workspace_math_dir / artifact_path.name
        self._write_json(
          math_path,
          {
            "source_path": str(source_path),
            "math": math_payload,
          },
        )
        existing_math_artifact_map[math_path.name] = str(math_path)
        math_pages_scanned += int(math_payload.get("pages_scanned", 0) or 0)
        math_regions_detected += int(math_payload.get("regions_detected", 0) or 0)
        math_formula_count += int(math_payload.get("formula_count", 0) or 0)
        math_formula_recognized += int(math_payload.get("formula_recognized", 0) or 0)
        math_formula_pending += int(math_payload.get("formula_pending", 0) or 0)
        math_documents_with_artifacts += int(math_payload.get("documents_with_math_artifacts", 0) or 0)
        confidence = (math_payload.get("confidence_summary") or {}).get("average")
        if confidence is not None:
          math_confidence_samples.append(float(confidence))
        if math_payload.get("awaiting_refinement"):
          math_awaiting_refinement = True
          math_recommended_action = math_recommended_action or math_payload.get("recommended_action")
        ocr_manifest_path = self._write_failure_manifest(job_id, "ocr-failures.json", ocr_failed_files) if ocr_failed_files else None
        if index % 10 == 0 or index == total or ocr_failed_files:
          state["citation_artifacts"] = citation_artifact_paths
          state["citation_mine"] = citation_summary
          self._update_running_ocr_progress(
            connection,
            job_id,
            task["id"],
            state,
            warnings,
            processed=retry_completed,
            attempted=retry_attempted,
            total=total,
            pages_ocrd=pages_ocrd,
            pages_improved=pages_improved,
            documents_touched=documents_touched,
            failed_files=ocr_failed_files,
            manifest_path=ocr_manifest_path,
            citation_summary=citation_summary,
            queue_state="draining",
            queue_note="OCR retry backlog is draining through the active OCR backend.",
          )
      ocr_manifest_path = self._write_failure_manifest(job_id, "ocr-failures.json", ocr_failed_files) if ocr_failed_files else None
      math_confidence_summary = {
        "average": round(sum(math_confidence_samples) / len(math_confidence_samples), 3) if math_confidence_samples else 0.0,
        "max": round(max(math_confidence_samples), 3) if math_confidence_samples else 0.0,
      }
      math_summary = {
        "pages_scanned": math_pages_scanned,
        "regions_detected": math_regions_detected,
        "formula_count": math_formula_count,
        "formula_recognized": math_formula_recognized,
        "formula_pending": math_formula_pending,
        "documents_with_math_artifacts": math_documents_with_artifacts,
        "confidence_summary": math_confidence_summary,
        "awaiting_refinement": math_awaiting_refinement,
        "recommended_action": math_recommended_action,
        "integration_mode": "ocr_context",
      }
      state["ocr"] = {
        **dict(state.get("ocr") or {}),
        "artifact_count": len(all_artifact_texts),
        "pages_ocrd": pages_ocrd,
        "pages_improved": pages_improved,
        "documents_touched": documents_touched,
        "failed_count": len(ocr_failed_files),
        "failed_files": list(ocr_failed_files),
        "sample_failures": self._sample_failures(ocr_failed_files),
        "manifest_path": ocr_manifest_path,
        "awaiting_refinement": bool(ocr_stage_remediation and ocr_stage_remediation.get("awaiting_refinement")),
        "recommended_action": ocr_stage_remediation.get("recommended_action") if ocr_stage_remediation else None,
        "pause_state": "paused" if ocr_stage_remediation else "ready",
        "pause_reason_code": (ocr_failed_files[-1].get("code") if ocr_stage_remediation and ocr_failed_files else None),
        "paused_at": repository.utc_now() if ocr_stage_remediation else None,
        "resume_ready": False if ocr_stage_remediation else True,
        "last_runtime_check_at": repository.utc_now() if ocr_stage_remediation else None,
        "resume_note": (
          "Retry OCR from the saved manifest when the OCR backend is healthy again."
          if ocr_stage_remediation else None
        ),
        "retry_mode": None if not retry_mode else retry_mode,
        "retry_target_count": total if retry_mode else 0,
        "retry_completed": retry_completed if retry_mode else 0,
        "retry_attempted": retry_attempted if retry_mode else 0,
        "garbled_document_count": self._count_garbled_retry_candidates(ocr_failed_files),
        "queue_state": (
          "paused_remote_unavailable" if ocr_stage_remediation and (ocr_failed_files[-1].get("code") if ocr_failed_files else "") == "ocr_remote_unavailable" else
          "paused_runtime_incompatible" if ocr_stage_remediation else
          "completed" if retry_mode else
          "ready"
        ),
        "queue_note": (
          "Remote OCR is unavailable. OCR retries are paused until the remote server is reachable again."
          if ocr_stage_remediation and (ocr_failed_files[-1].get("code") if ocr_failed_files else "") == "ocr_remote_unavailable" else
          "Local OCR runtime is incompatible. OCR retries are paused until OCR runtime is corrected."
          if ocr_stage_remediation else
          "OCR retry backlog completed."
          if retry_mode else
          "OCR stage completed."
        ),
        "ocr_route": self._ocr_route_label(),
        "math": math_summary,
        "citation_mine": citation_summary,
      }
      state["ocr_artifacts"] = all_artifact_texts
      state["math_artifacts"] = list(existing_math_artifact_map.values())
      state["citation_artifacts"] = citation_artifact_paths
      state["math"] = math_summary
      state["citation_mine"] = citation_summary
      if ocr_stage_remediation:
        self._runtime_payload(
          state,
          progress_completed=retry_completed if retry_mode else documents_touched,
          progress_total=total if retry_mode else len(all_artifact_texts),
          remediation=ocr_stage_remediation,
        )
      self._write_job_state(connection, job_id, state)
      return {
        "task_status": "queued" if ocr_stage_remediation else "completed",
        "progress_completed": retry_completed if retry_mode else len(all_artifact_texts),
        "progress_total": total if retry_mode else len(all_artifact_texts),
        "warnings": warnings,
        "payload": {
          **self._runtime_payload(
            state,
            progress_completed=retry_completed if retry_mode else len(all_artifact_texts),
            progress_total=total if retry_mode else len(all_artifact_texts),
            stage_state="queued" if ocr_stage_remediation else "completed",
          ),
          "pages_ocrd": pages_ocrd,
          "pages_improved": pages_improved,
          "documents_touched": documents_touched,
          "ocr_failed": len(ocr_failed_files),
          "sample_failures": self._sample_failures(ocr_failed_files),
          "manifest_path": ocr_manifest_path,
          "awaiting_refinement": bool(ocr_stage_remediation and ocr_stage_remediation.get("awaiting_refinement")),
          "recommended_action": ocr_stage_remediation.get("recommended_action") if ocr_stage_remediation else None,
          "pause_state": "paused" if ocr_stage_remediation else "ready",
          "pause_reason_code": (ocr_failed_files[-1].get("code") if ocr_stage_remediation and ocr_failed_files else None),
          "resume_ready": False if ocr_stage_remediation else True,
          "resume_note": (
            "Retry OCR from the saved manifest when the OCR backend is healthy again."
            if ocr_stage_remediation else None
          ),
          "retry_mode": retry_mode if retry_mode else None,
          "retry_target_count": total if retry_mode else 0,
          "retry_completed": retry_completed if retry_mode else 0,
          "retry_attempted": retry_attempted if retry_mode else 0,
          "garbled_document_count": self._count_garbled_retry_candidates(ocr_failed_files),
          "queue_state": state["ocr"]["queue_state"],
          "queue_note": state["ocr"]["queue_note"],
          "ocr_route": state["ocr"]["ocr_route"],
          "historical_artifact_count": len(all_artifact_texts),
          "math_integrated_with_ocr": True,
          "math_pages_scanned": math_pages_scanned,
          "math_regions_detected": math_regions_detected,
          "math_formula_count": math_formula_count,
          "math_formula_recognized": math_formula_recognized,
          "math_formula_pending": math_formula_pending,
          "documents_with_math_artifacts": math_documents_with_artifacts,
          "math_confidence_summary": math_confidence_summary,
          "math_awaiting_refinement": math_awaiting_refinement,
          "math_recommended_action": math_recommended_action,
          "citation_mine": citation_summary,
        },
      }

    if stage == "structure":
      structured_artifacts = []
      artifact_texts = state.get("ocr_artifacts") or state.get("extracted_artifacts", [])
      math_artifact_map = {
        Path(path).name: Path(path)
        for path in state.get("math_artifacts", [])
      }
      citation_artifact_map = {
        Path(path).name: Path(path)
        for path in state.get("citation_artifacts", [])
      }
      total = len(artifact_texts)
      node_count = 0
      page_count = 0
      warnings: list[str] = []
      failed_files: list[dict] = []
      for index, artifact_text in enumerate(artifact_texts, start=1):
        artifact_path = Path(artifact_text)
        payload = self._read_json(artifact_path)
        source_path = Path(payload["source_path"])
        state = self._update_active_item(connection, job_id, task["id"], state, "structure", source_path, index, total)
        math_payload = {}
        citation_payload = {}
        math_artifact_path = math_artifact_map.get(artifact_path.name)
        if math_artifact_path and math_artifact_path.exists():
          math_payload = (self._read_json(math_artifact_path) or {}).get("math") or {}
        citation_artifact_path = citation_artifact_map.get(artifact_path.name)
        if citation_artifact_path and citation_artifact_path.exists():
          citation_payload = (self._read_json(citation_artifact_path) or {}).get("citations") or {}
        try:
          prepared = self.engine.prepare_document(source_path, payload["parsed"], math=math_payload, citations=citation_payload)
          serializable = {
            "source_path": str(prepared["source_path"]),
            "parsed": prepared["parsed"],
            "document": prepared["document"],
            "nodes": prepared["nodes"],
            "markdown": prepared.get("markdown") or "",
            "math": prepared.get("math") or {},
            "citations": prepared.get("citations") or {},
          }
          prepared_path = workspace / "prepared" / artifact_path.name
          self._write_json(prepared_path, serializable)
          markdown_path = workspace_markdown_dir / f"{artifact_path.stem}.md"
          markdown_path.write_text(str(prepared.get("markdown") or ""), encoding="utf-8")
          structured_artifacts.append(str(prepared_path))
          node_count += len(prepared.get("nodes", []))
          page_count += len(prepared.get("parsed", {}).get("pages", []))
          self._reconcile_file_stage(
            connection,
            state,
            source_path=source_path,
            stage="structure",
            status="completed",
            import_job_id=job_id,
            event_message="Structure preparation completed for this file.",
          )
        except Exception as error:
          failed_files.append(self._extract_failure_entry(source_path, "structure", "structure_document_failed", str(error)))
          warnings.append(f"{source_path.name}: structure preparation failed but the pipeline continued.")
          self._reconcile_file_stage(
            connection,
            state,
            source_path=source_path,
            stage="structure",
            status="failed",
            import_job_id=job_id,
            error_message=str(error),
            event_message="Structure preparation failed for this file.",
          )
        manifest_path = self._write_failure_manifest(job_id, "structure-failures.json", failed_files) if failed_files else None
        if index % 10 == 0 or index == total or failed_files:
          self._update_running_stage_progress(
            connection,
            job_id,
            task["id"],
            state,
            warnings,
            stage="structure",
            processed=index,
            total=total,
            payload_updates={
              "prepared_documents": len(structured_artifacts),
              "page_count": page_count,
              "node_count": node_count,
              "structure_failed": len(failed_files),
              "sample_failures": self._sample_failures(failed_files),
              "manifest_path": manifest_path,
            },
            stage_updates={
              "prepared_documents": len(structured_artifacts),
              "page_count": page_count,
              "node_count": node_count,
              "failed_count": len(failed_files),
              "failed_files": list(failed_files),
              "sample_failures": self._sample_failures(failed_files),
              "manifest_path": manifest_path,
            },
          )
      if total and not structured_artifacts:
        return {
          "task_status": "failed",
          "error_code": "structure_all_documents_failed",
          "error_text": f"All {total} prepared documents failed during structure.",
          "progress_completed": total,
          "progress_total": total,
          "warnings": warnings,
          "payload": {
            **self._runtime_payload(state, progress_completed=total, progress_total=total, stage_state="failed"),
            "prepared_documents": 0,
            "structure_failed": len(failed_files),
            "sample_failures": self._sample_failures(failed_files),
            "manifest_path": self._write_failure_manifest(job_id, "structure-failures.json", failed_files),
          },
        }
      state["prepared_artifacts"] = structured_artifacts
      self._write_job_state(connection, job_id, state)
      manifest_path = self._write_failure_manifest(job_id, "structure-failures.json", failed_files) if failed_files else None
      return {
        "progress_completed": len(structured_artifacts),
        "progress_total": total,
        "warnings": warnings,
        "payload": {
          **self._runtime_payload(state, progress_completed=len(structured_artifacts), progress_total=total, stage_state="completed"),
          "prepared_documents": len(structured_artifacts),
          "page_count": page_count,
          "node_count": node_count,
          "structure_failed": len(failed_files),
          "sample_failures": self._sample_failures(failed_files),
          "manifest_path": manifest_path,
        },
      }

    if stage in {"chunk", "summarize"}:
      prepared_artifacts = state.get("prepared_artifacts", [])
      total = len(prepared_artifacts)
      warnings: list[str] = []
      for index, artifact_text in enumerate(prepared_artifacts, start=1):
        first_payload = self._read_json(Path(artifact_text))
        state = self._update_active_item(
          connection,
          job_id,
          task["id"],
          state,
          stage,
          Path(first_payload["source_path"]),
          index,
          total,
        )
        if index % 25 == 0 or index == total:
          self._update_running_stage_progress(
            connection,
            job_id,
            task["id"],
            state,
            warnings,
            stage=stage,
            processed=index,
            total=total,
            stage_updates={"artifact_count": total},
            payload_updates={"artifact_count": total},
          )
        if stage == "chunk":
          self._reconcile_file_stage(
            connection,
            state,
            source_path=Path(first_payload["source_path"]),
            stage="chunk",
            status="completed",
            import_job_id=job_id,
            event_message="Chunking completed for this file.",
          )
      semantic_stats = self._prepared_artifact_semantic_stats(prepared_artifacts, stage=stage)
      state["semantic_stats"] = semantic_stats
      state[stage] = {"artifact_count": total}
      self._write_job_state(connection, job_id, state)
      return {
        "progress_completed": len(prepared_artifacts),
        "progress_total": len(prepared_artifacts),
        "warnings": warnings,
        "payload": self._runtime_payload(state, progress_completed=len(prepared_artifacts), progress_total=len(prepared_artifacts), stage_state="completed", semantic_stats=semantic_stats),
      }

    if stage == "embed":
      prepared_artifacts = state.get("prepared_artifacts", [])
      embedded_nodes = 0
      total = len(prepared_artifacts)
      warnings: list[str] = []
      failed_files: list[dict] = []
      for index, artifact_text in enumerate(prepared_artifacts, start=1):
        artifact_path = Path(artifact_text)
        payload = self._read_json(artifact_path)
        source_path = Path(payload["source_path"])
        state = self._update_active_item(connection, job_id, task["id"], state, "embed", source_path, index, total)
        try:
          candidate_nodes = [
            node
            for node in payload.get("nodes", [])
            if node.get("node_type") in {"summary", "chunk"} and str(node.get("text") or "").strip()
          ]
          missing_vectors = [
            node
            for node in candidate_nodes
            if not isinstance(node.get("embedding_vector"), list) or not node.get("embedding_vector")
          ]
          if missing_vectors:
            texts = [str(node.get("text") or "") for node in missing_vectors]
            embed_many = getattr(self.engine.embedder, "embed_many", None)
            if callable(embed_many):
              vectors = embed_many(texts)
            else:
              vectors = [self.engine.embedder.embed(text) for text in texts]
            embedding_provenance = getattr(
              self.engine.embedder,
              "provenance",
              lambda: {"provider": getattr(self.engine.embedder, "name", "embedding"), "location": "local"},
            )()
            recorded_at = repository.utc_now()
            for node, vector in zip(missing_vectors, vectors):
              node["embedding_vector"] = [float(value) for value in vector]
              metadata_json = dict(node.get("metadata_json") or {})
              metadata_json["embedding_provenance"] = {
                **embedding_provenance,
                "recorded_at": recorded_at,
                "vector_dimension": len(vector),
              }
              node["metadata_json"] = metadata_json
          embedded_nodes += len(candidate_nodes)
          self._write_json(artifact_path, payload)
          self._reconcile_file_stage(
            connection,
            state,
            source_path=source_path,
            stage="embed",
            status="completed",
            import_job_id=job_id,
            event_message="Embedding completed for this file.",
            metadata={
              "compute_provenance": getattr(
                self.engine.embedder,
                "provenance",
                lambda: {"provider": getattr(self.engine.embedder, "name", "embedding"), "location": "local"},
              )(),
              "embedded_nodes": len(candidate_nodes),
            },
          )
        except Exception as error:
          failed_files.append(self._extract_failure_entry(source_path, "embed", "embed_document_failed", str(error)))
          warnings.append(f"{source_path.name}: embedding failed for this document, but the stage continued.")
          self._reconcile_file_stage(
            connection,
            state,
            source_path=source_path,
            stage="embed",
            status="failed",
            import_job_id=job_id,
            error_message=str(error),
            event_message="Embedding failed for this file.",
          )
        if index % 10 == 0 or index == total or failed_files:
          manifest_path = self._write_failure_manifest(job_id, "embed-failures.json", failed_files) if failed_files else None
          self._update_running_stage_progress(
            connection,
            job_id,
            task["id"],
            state,
            warnings,
            stage="embed",
            processed=index,
            total=total,
            stage_updates={
              "embedded_nodes": embedded_nodes,
              "failed_count": len(failed_files),
              "failed_files": list(failed_files),
              "sample_failures": self._sample_failures(failed_files),
              "manifest_path": manifest_path,
            },
            payload_updates={
              "embedded_nodes": embedded_nodes,
              "embed_failed": len(failed_files),
              "sample_failures": self._sample_failures(failed_files),
              "manifest_path": manifest_path,
            },
          )
      semantic_stats = self._prepared_artifact_semantic_stats(prepared_artifacts, embedded_count=embedded_nodes, indexed_vector_count=0, stage="embed")
      state["semantic_stats"] = semantic_stats
      state["embed"] = {
        "embedded_nodes": embedded_nodes,
        "failed_count": len(failed_files),
        "failed_files": list(failed_files),
        "sample_failures": self._sample_failures(failed_files),
        "manifest_path": self._write_failure_manifest(job_id, "embed-failures.json", failed_files) if failed_files else None,
      }
      self._write_job_state(connection, job_id, state)
      return {
        "progress_completed": embedded_nodes,
        "progress_total": semantic_stats["embedding_queue"]["total"],
        "warnings": warnings,
        "payload": {
          **self._runtime_payload(state, progress_completed=embedded_nodes, progress_total=semantic_stats["embedding_queue"]["total"], stage_state="completed", semantic_stats=semantic_stats),
          "embed_failed": len(failed_files),
          "sample_failures": self._sample_failures(failed_files),
          "manifest_path": state["embed"]["manifest_path"],
        },
      }

    if stage == "index":
      prepared_artifacts = state.get("prepared_artifacts", [])
      document_ids = []
      indexed_vectors = 0
      total = len(prepared_artifacts)
      warnings: list[str] = []
      failed_files: list[dict] = []
      for index, artifact_text in enumerate(prepared_artifacts, start=1):
        payload = self._read_json(Path(artifact_text))
        source_path = Path(payload["source_path"])
        state = self._update_active_item(connection, job_id, task["id"], state, "index", source_path, index, total)
        try:
          persisted = self.engine.persist_prepared_document(
            connection,
            {
              "source_path": source_path,
              "parsed": payload["parsed"],
              "document": payload["document"],
              "nodes": payload["nodes"],
              "math": payload.get("math") or {},
              "citations": payload.get("citations") or {},
            },
          )
          document_ids.append(persisted["id"])
          indexed_vectors += sum(1 for node in payload.get("nodes", []) if node.get("node_type") in {"summary", "chunk"} and str(node.get("text") or "").strip())
          self._reconcile_file_stage(
            connection,
            state,
            source_path=source_path,
            stage="index",
            status="completed",
            import_job_id=job_id,
            event_message="Indexing completed for this file.",
            metadata={
              "compute_provenance": (
                dict((persisted.get("metadata") or {}).get("compute_provenance") or {})
                if isinstance(persisted.get("metadata"), dict) else {}
              ),
              "document_id": persisted["id"],
            },
          )
        except Exception as error:
          failed_files.append(self._extract_failure_entry(source_path, "index", "index_document_failed", str(error)))
          warnings.append(f"{source_path.name}: indexing failed for this document, but the stage continued.")
          self._reconcile_file_stage(
            connection,
            state,
            source_path=source_path,
            stage="index",
            status="failed",
            import_job_id=job_id,
            error_message=str(error),
            event_message="Indexing failed for this file.",
          )
        if index % 10 == 0 or index == total or failed_files:
          manifest_path = self._write_failure_manifest(job_id, "index-failures.json", failed_files) if failed_files else None
          self._update_running_stage_progress(
            connection,
            job_id,
            task["id"],
            state,
            warnings,
            stage="index",
            processed=index,
            total=total,
            stage_updates={
              "document_ids": list(document_ids),
              "indexed_vectors": indexed_vectors,
              "failed_count": len(failed_files),
              "failed_files": list(failed_files),
              "sample_failures": self._sample_failures(failed_files),
              "manifest_path": manifest_path,
            },
            payload_updates={
              "document_ids": list(document_ids),
              "indexed_vectors": indexed_vectors,
              "index_failed": len(failed_files),
              "sample_failures": self._sample_failures(failed_files),
              "manifest_path": manifest_path,
            },
          )
      if total and not document_ids:
        return {
          "task_status": "failed",
          "error_code": "index_all_documents_failed",
          "error_text": f"All {total} prepared documents failed during index.",
          "progress_completed": total,
          "progress_total": total,
          "warnings": warnings,
          "payload": {
            **self._runtime_payload(state, progress_completed=total, progress_total=total, stage_state="failed"),
            "document_ids": [],
            "index_failed": len(failed_files),
            "sample_failures": self._sample_failures(failed_files),
            "manifest_path": self._write_failure_manifest(job_id, "index-failures.json", failed_files),
          },
        }
      state["document_ids"] = document_ids
      semantic_stats = self._prepared_artifact_semantic_stats(prepared_artifacts, embedded_count=indexed_vectors, indexed_vector_count=indexed_vectors, stage="index")
      state["semantic_stats"] = semantic_stats
      state["index"] = {
        "document_ids": list(document_ids),
        "indexed_vectors": indexed_vectors,
        "failed_count": len(failed_files),
        "failed_files": list(failed_files),
        "sample_failures": self._sample_failures(failed_files),
        "manifest_path": self._write_failure_manifest(job_id, "index-failures.json", failed_files) if failed_files else None,
      }
      self._write_job_state(connection, job_id, state)
      return {
        "progress_completed": len(document_ids),
        "progress_total": len(prepared_artifacts),
        "warnings": warnings,
        "payload": {
          **self._runtime_payload(state, progress_completed=len(document_ids), progress_total=len(prepared_artifacts), stage_state="completed", semantic_stats=semantic_stats),
          "document_ids": document_ids,
          "indexed_vectors": indexed_vectors,
          "index_failed": len(failed_files),
          "sample_failures": self._sample_failures(failed_files),
          "manifest_path": state["index"]["manifest_path"],
        },
      }

    if stage == "research_materialize":
      document_ids = state.get("document_ids", [])
      total = len(document_ids)
      warnings: list[str] = []
      failed_files: list[dict] = []
      graph_nodes = 0
      graph_edges = 0
      for index, document_id in enumerate(document_ids, start=1):
        document = repository.get_document_by_id(connection, document_id)
        if document is None:
          failed_files.append({
            "path": document_id,
            "stage": "research_materialize",
            "code": "research_document_missing",
            "message": f"Indexed document {document_id} was not found for research materialization.",
          })
          continue
        state = self._update_active_item(connection, job_id, task["id"], state, "research_materialize", document["source_path"], index, total)
        try:
          result = self.engine.ensure_research_scaffolds_for_documents(connection, [document_id])
          graph_nodes += int(result.get("graph_nodes", 0) or 0)
          graph_edges += int(result.get("graph_edges", 0) or 0)
        except Exception as error:
          failed_files.append(self._extract_failure_entry(Path(document["source_path"]), "research_materialize", "research_materialize_failed", str(error)))
          warnings.append(f"{document['title']}: research materialization failed for this document, but the stage continued.")
        if index % 10 == 0 or index == total or failed_files:
          manifest_path = self._write_failure_manifest(job_id, "research-materialize-failures.json", failed_files) if failed_files else None
          self._update_running_stage_progress(
            connection,
            job_id,
            task["id"],
            state,
            warnings,
            stage="research_materialize",
            processed=index,
            total=total,
            payload_updates={
              "graph_nodes": graph_nodes,
              "graph_edges": graph_edges,
              "research_failed": len(failed_files),
              "sample_failures": self._sample_failures(failed_files),
              "manifest_path": manifest_path,
            },
            stage_updates={
              "graph_nodes": graph_nodes,
              "graph_edges": graph_edges,
              "failed_count": len(failed_files),
              "failed_files": list(failed_files),
              "sample_failures": self._sample_failures(failed_files),
              "manifest_path": manifest_path,
            },
          )
      state["research_materialize"] = {
        "graph_nodes": graph_nodes,
        "graph_edges": graph_edges,
        "failed_count": len(failed_files),
        "failed_files": list(failed_files),
        "sample_failures": self._sample_failures(failed_files),
        "manifest_path": self._write_failure_manifest(job_id, "research-materialize-failures.json", failed_files) if failed_files else None,
      }
      semantic_stats = self._prepared_artifact_semantic_stats(state.get("prepared_artifacts", []), embedded_count=0, indexed_vector_count=0, stage="research_materialize")
      state["semantic_stats"] = semantic_stats
      self._write_job_state(connection, job_id, state)
      return {
        "progress_completed": len(document_ids),
        "progress_total": len(document_ids),
        "warnings": warnings,
        "payload": {
          **self._runtime_payload(state, progress_completed=len(document_ids), progress_total=len(document_ids), stage_state="completed", semantic_stats=semantic_stats),
          "graph_nodes": graph_nodes,
          "graph_edges": graph_edges,
          "research_failed": len(failed_files),
          "sample_failures": self._sample_failures(failed_files),
          "manifest_path": state["research_materialize"]["manifest_path"],
        },
      }

    if stage == "technique_materialize":
      document_ids = state.get("document_ids", [])
      total = len(document_ids)
      warnings: list[str] = []
      failed_files: list[dict] = []
      result = {"documents": 0, "techniques": 0, "sources": 0}
      materialization_count = 0
      for index, document_id in enumerate(document_ids, start=1):
        document = repository.get_document_by_id(connection, document_id)
        if document is None:
          failed_files.append({
            "path": document_id,
            "stage": "technique_materialize",
            "code": "technique_document_missing",
            "message": f"Indexed document {document_id} was not found for technique materialization.",
          })
          continue
        state = self._update_active_item(connection, job_id, task["id"], state, "technique_materialize", document["source_path"], index, total)
        try:
          document_result = self.engine.ensure_forecast_technique_materializations(connection, document_ids=[document_id])
          result["documents"] += int(document_result.get("documents", 0) or 0)
          result["techniques"] += int(document_result.get("techniques", 0) or 0)
          result["sources"] += int(document_result.get("sources", 0) or 0)
          materialization_count += len(repository.list_document_technique_materializations(connection, document_id))
        except Exception as error:
          failed_files.append(self._extract_failure_entry(Path(document["source_path"]), "technique_materialize", "technique_materialize_failed", str(error)))
          warnings.append(f"{document['title']}: technique materialization failed for this document, but the stage continued.")
        if index % 10 == 0 or index == total or failed_files:
          manifest_path = self._write_failure_manifest(job_id, "technique-materialize-failures.json", failed_files) if failed_files else None
          self._update_running_stage_progress(
            connection,
            job_id,
            task["id"],
            state,
            warnings,
            stage="technique_materialize",
            processed=index,
            total=total,
            payload_updates={
              "documents": result["documents"],
              "techniques": result["techniques"],
              "sources": result["sources"],
              "materializations": materialization_count,
              "technique_failed": len(failed_files),
              "sample_failures": self._sample_failures(failed_files),
              "manifest_path": manifest_path,
            },
            stage_updates={
              "documents": result["documents"],
              "techniques": result["techniques"],
              "sources": result["sources"],
              "materializations": materialization_count,
              "failed_count": len(failed_files),
              "failed_files": list(failed_files),
              "sample_failures": self._sample_failures(failed_files),
              "manifest_path": manifest_path,
            },
          )
      state["technique_materialize"] = {
        "documents": result["documents"],
        "techniques": result["techniques"],
        "sources": result["sources"],
        "materializations": materialization_count,
        "failed_count": len(failed_files),
        "failed_files": list(failed_files),
        "sample_failures": self._sample_failures(failed_files),
        "manifest_path": self._write_failure_manifest(job_id, "technique-materialize-failures.json", failed_files) if failed_files else None,
      }
      self._write_job_state(connection, job_id, state)
      return {
        "progress_completed": result["documents"],
        "progress_total": len(document_ids),
        "warnings": warnings,
        "payload": {
          **self._runtime_payload(state, progress_completed=result["documents"], progress_total=len(document_ids), stage_state="completed"),
          **result,
          "materializations": materialization_count,
          "technique_failed": len(failed_files),
          "sample_failures": self._sample_failures(failed_files),
          "manifest_path": state["technique_materialize"]["manifest_path"],
        },
      }

    if stage == "complete":
      persisted_documents = [
        document_id
        for document_id in state.get("document_ids", [])
        if repository.get_document_by_id(connection, document_id) is not None
      ]
      if state.get("prepared_artifacts") and not persisted_documents:
        return {
          "task_status": "failed",
          "error_code": "complete_missing_indexed_documents",
          "error_text": "No indexed documents were persisted, so the pipeline cannot be marked complete.",
          "progress_completed": 0,
          "progress_total": len(state.get("prepared_artifacts", [])),
          "payload": self._runtime_payload(state, progress_completed=0, progress_total=len(state.get("prepared_artifacts", [])), stage_state="failed"),
        }
      return {
        "progress_completed": len(persisted_documents),
        "progress_total": len(state.get("document_ids", [])),
        "payload": self._runtime_payload(state, progress_completed=len(persisted_documents), progress_total=len(state.get("document_ids", [])), stage_state="completed"),
      }

    raise RuntimeError(f"Unsupported pipeline stage: {stage}")

  def _process_job(self, connection, job: dict) -> bool:
    if self._should_pause_for_refinement(connection, job):
      return False
    tasks = self._ensure_tasks(connection, job)
    if self._queue_ready_ocr_retry(connection, job, tasks):
      refreshed_job = repository.get_import_job(connection, job["id"])
      if refreshed_job is not None:
        job = refreshed_job
      tasks = repository.list_pipeline_tasks(connection, [job["id"]])
    effective_tasks = self._effective_pipeline_tasks(tasks)
    pending = next((task for task in effective_tasks if task["status"] in {"queued", "running"}), None)
    if pending is None:
      return False

    repository.update_import_job(
      connection,
      job["id"],
      status="running",
      current_stage=pending["stage"],
      started_at=job.get("started_at") or repository.utc_now(),
    )
    repository.update_pipeline_task(connection, pending["id"], status="running", started_at=pending.get("started_at") or repository.utc_now())
    self._commit_progress_tick(connection)
    refreshed_job = repository.get_import_job(connection, job["id"]) or job

    try:
      result = self._run_stage(connection, refreshed_job, pending)
      task_status = result.get("task_status", "completed")
      error_code = result.get("error_code")
      error_text = result.get("error_text")
      job_state = self._read_job_state(repository.get_import_job(connection, job["id"]) or refreshed_job)
      repository.update_pipeline_task(
        connection,
        pending["id"],
        status=task_status,
        progress_completed=result.get("progress_completed", 0),
        progress_total=result.get("progress_total", 0),
        warnings_json=result.get("warnings", []),
        payload_json=result.get("payload", self._runtime_payload(job_state, progress_completed=result.get("progress_completed", 0), progress_total=result.get("progress_total", 0), stage_state=task_status)),
        error_code=error_code,
        error_text=error_text,
        finished_at=repository.utc_now() if task_status in {"completed", "failed"} else None,
      )
      effective_tasks = self._effective_pipeline_tasks(repository.list_pipeline_tasks(connection, [job["id"]]))
      if task_status == "failed":
        job_state["resumable"] = False
        job_state["stage_state"] = "failed"
        repository.update_import_job(connection, job["id"], state_json=job_state)
        completed = sum(1 for task in effective_tasks if task["status"] == "completed")
        repository.update_import_job(
          connection,
          job["id"],
          status="failed",
          current_stage=pending["stage"],
          progress_completed=completed,
          progress_total=len(effective_tasks),
          warnings_json=result.get("warnings", []),
          stage_warnings_json=result.get("warnings", []),
          error_code=error_code,
          error_text=error_text,
          finished_at=repository.utc_now(),
        )
        return True
      all_tasks = repository.list_pipeline_tasks(connection, [job["id"]])
      effective_tasks = self._effective_pipeline_tasks(all_tasks)
      completed = sum(1 for task in effective_tasks if task["status"] == "completed")
      stage_warnings = []
      for task in all_tasks:
        stage_warnings.extend(repository.json_loads(task.get("warnings_json"), []))
      is_complete = all(task["status"] == "completed" for task in effective_tasks)
      next_stage = next((task["stage"] for task in effective_tasks if task["status"] in {"queued", "running"}), None)
      job_state["resumable"] = not is_complete
      if not is_complete:
        job_state["current_stage"] = next_stage
      repository.update_import_job(connection, job["id"], state_json=job_state)
      repository.update_import_job(
        connection,
        job["id"],
        status="completed" if is_complete else ("queued" if next_stage == pending["stage"] and task_status == "queued" else "running"),
        document_count=len(self._read_job_state(repository.get_import_job(connection, job["id"]) or refreshed_job).get("document_ids", [])),
        current_stage="complete" if is_complete else next_stage,
        progress_completed=completed,
        progress_total=len(effective_tasks),
        warnings_json=stage_warnings,
        stage_warnings_json=stage_warnings,
        finished_at=repository.utc_now() if is_complete else None,
      )
      return True
    except ServiceDependencyError as error:
      job_state = self._read_job_state(repository.get_import_job(connection, job["id"]) or refreshed_job)
      remediation = remediation_payload_from_error(error.code, error.missing_services)
      job_state["resumable"] = True
      job_state["current_stage"] = pending["stage"]
      self._runtime_payload(job_state, progress_completed=int(pending.get("progress_completed") or 0), progress_total=int(pending.get("progress_total") or 0), remediation=remediation)
      repository.update_import_job(connection, job["id"], state_json=job_state)
      repository.update_pipeline_task(
        connection,
        pending["id"],
        status="queued",
        warnings_json=[error.message],
        payload_json=self._runtime_payload(job_state, progress_completed=int(pending.get("progress_completed") or 0), progress_total=int(pending.get("progress_total") or 0), remediation=remediation),
        error_code=None,
        error_text=None,
        finished_at=None,
      )
      repository.update_import_job(
        connection,
        job["id"],
        status="queued",
        current_stage=pending["stage"],
        warnings_json=[error.message],
        stage_warnings_json=[error.message],
        error_code=None,
        error_text=None,
        finished_at=None,
      )
      self._reconcile_file_stage(
        connection,
        job_state,
        source_path=job_state.get("current_item_path"),
        stage=pending["stage"],
        status="pending",
        import_job_id=job["id"],
        error_message=error.message,
        event_message=f"{pending['stage']} paused because a runtime dependency is unavailable.",
      )
      return True
    except Exception as error:
      job_state = self._read_job_state(repository.get_import_job(connection, job["id"]) or refreshed_job)
      job_state["resumable"] = False
      repository.update_import_job(connection, job["id"], state_json=job_state)
      repository.update_pipeline_task(
        connection,
        pending["id"],
        status="failed",
        error_code="pipeline_stage_failed",
        error_text=str(error),
        finished_at=repository.utc_now(),
      )
      repository.update_import_job(
        connection,
        job["id"],
        status="failed",
        current_stage=pending["stage"],
        error_code="pipeline_stage_failed",
        error_text=str(error),
        finished_at=repository.utc_now(),
      )
      self._reconcile_file_stage(
        connection,
        job_state,
        source_path=job_state.get("current_item_path"),
        stage=pending["stage"],
        status="failed",
        import_job_id=job["id"],
        error_message=str(error),
        event_message=f"{pending['stage']} failed for the current file.",
      )
      return True

  def run_once(self) -> int:
    processed = 0
    with database_session(settings.sqlite_path) as connection:
      processed += self._recover_incomplete_jobs(connection, force_running=not self._recovery_checked)
    self._recovery_checked = True

    with database_session(settings.sqlite_path) as connection:
      processed += self._refresh_deferred_ocr_runtime_state(connection)

    with database_session(settings.sqlite_path) as connection:
      self._ensure_watch_observers(connection)
      processed += self._drain_watch_events(connection)

    with database_session(settings.sqlite_path) as connection:
      processed += self._sync_watch_folders(connection)

    operator_runtime = self._operator_runtime_state()
    if bool(operator_runtime.get("paused")):
      logger.info("Worker processing is paused by operator control: %s", operator_runtime.get("pause_reason") or "no reason provided")
      return processed

    with database_session(settings.sqlite_path) as connection:
      jobs = [job for job in repository.list_import_jobs(connection) if job["status"] in {"queued", "running"}]
      jobs.sort(key=self._job_priority_key)

    active_job_budget = max(int(settings.max_active_import_jobs), 1)
    active_jobs_processed = 0
    for job in jobs:
      if active_jobs_processed >= active_job_budget:
        break
      with database_session(settings.sqlite_path) as connection:
        refreshed = repository.get_import_job(connection, job["id"])
        if refreshed is None or refreshed["status"] not in {"queued", "running"}:
          continue
        if self._process_job(connection, refreshed):
          processed += 1
          active_jobs_processed += 1
    return processed

  def serve(self, interval_seconds: float | None = None) -> None:
    initialize_database(settings.sqlite_path)
    wait_seconds = interval_seconds if interval_seconds is not None else settings.worker_poll_interval_seconds
    while True:
      self.run_once()
      time.sleep(wait_seconds)
