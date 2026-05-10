from __future__ import annotations

from typing import Any

from . import repository


FINAL_IMPLEMENTATION_STATUSES = {
  "complete",
  "completed",
  "implemented",
  "production_ready",
  "ready",
  "stable",
}

FINAL_ADAPTATION_STATUSES = {
  "complete",
  "completed",
  "final",
  "implemented",
  "production_ready",
  "ready",
  "stable",
}


def _coerce_severity(value: str | None) -> str:
  normalized = str(value or "info").strip().lower()
  if normalized in {"error", "warning", "info", "success"}:
    return normalized
  return "info"


def _build_signal(
  signal_id: str,
  *,
  source_module: str,
  source_kind: str,
  title: str,
  summary: str,
  severity: str = "info",
  signal_state: str = "active",
  entity_id: str | None = None,
  payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
  return {
    "id": signal_id,
    "source_module": source_module,
    "source_kind": source_kind,
    "entity_id": entity_id,
    "title": title,
    "summary": summary,
    "severity": _coerce_severity(severity),
    "signal_state": signal_state,
    "payload": payload or {},
  }


def _provider_signal(provider_key: str, provider: dict[str, Any], *, strict: bool) -> dict[str, Any]:
  ready = bool(provider.get("ready"))
  fallback = bool(provider.get("fallback"))
  severity = "info" if ready and not fallback else "warning"
  if not ready and strict:
    severity = "error"
  detail = provider.get("detail") or "Provider status unavailable."
  status_bits = []
  if ready:
    status_bits.append("ready")
  else:
    status_bits.append("not ready")
  if fallback:
    status_bits.append("fallback")
  title = f"{provider.get('name') or provider_key} provider"
  return _build_signal(
    f"activity:library:provider:{provider_key}",
    source_module="library",
    source_kind="provider_status",
    entity_id=provider_key,
    title=title,
    summary=f"{format_status_label(status_bits)}. {detail}",
    severity=severity,
    signal_state="ready" if ready else ("awaiting_refinement" if strict else "degraded"),
    payload={
      "provider_key": provider_key,
      "provider": provider,
      "awaiting_refinement": not ready and strict,
      "recommended_action": "Refine the local provider runtime, then retest from the current job or query state." if not ready else None,
      "next_check": "Confirm this provider reports ready and no longer falls back." if not ready else None,
      "retry_hint": "Restart the backend after the provider runtime is available." if not ready else None,
    },
  )


def format_status_label(bits: list[str]) -> str:
  if not bits:
    return "Status unknown"
  return ", ".join(bits).capitalize()


def _vector_index_signal(system_status: dict[str, Any], *, strict: bool) -> dict[str, Any]:
  qdrant = system_status.get("qdrant") or {}
  ready = bool(qdrant.get("ready"))
  severity = "info" if ready else ("error" if strict else "warning")
  summary = qdrant.get("detail") or f"Vector index collection: {qdrant.get('collection') or 'n/a'}."
  return _build_signal(
    "activity:library:vector-index",
    source_module="library",
    source_kind="vector_index",
    title="Vector index runtime",
    summary=summary,
    severity=severity,
    signal_state="ready" if ready else ("awaiting_refinement" if strict else "degraded"),
    payload={
      **qdrant,
      "awaiting_refinement": not ready and strict,
      "recommended_action": "Bring the vector index runtime online, then retest indexing or retrieval." if not ready else None,
      "next_check": "Confirm Qdrant is reachable and the configured collection is ready." if not ready else None,
      "retry_hint": "Restart the backend after Qdrant is healthy." if not ready else None,
    },
  )


def _import_job_signal(job: dict[str, Any], tasks: list[dict[str, Any]]) -> dict[str, Any]:
  warnings = repository.json_loads(job.get("warnings_json"), []) + repository.json_loads(job.get("stage_warnings_json"), [])
  state = repository.json_loads(job.get("state_json"), {})
  file_counts = state.get("file_counts") or {}
  status = job.get("status") or "queued"
  stage_state = state.get("stage_state") or status
  severity = "info"
  if status == "failed":
    severity = "error"
  elif state.get("awaiting_refinement"):
    severity = "warning"
  elif warnings or (file_counts.get("failed") or 0) > 0 or (file_counts.get("deferred_to_ocr") or 0) > 0:
    severity = "warning"
  summary_bits = [
    f"Stage {job.get('current_stage') or 'queued'}",
    f"{int(job.get('document_count') or 0)} documents",
  ]
  if file_counts:
    summary_bits.append(
      f"{int(file_counts.get('processed', 0))}/{int(file_counts.get('discovered', 0))} files processed"
    )
  if job.get("error_code"):
    summary_bits.append(str(job["error_code"]))
  summary = ". ".join(summary_bits)
  return _build_signal(
    f"activity:library:import-job:{job['id']}",
    source_module="library",
    source_kind="import_job",
    entity_id=job["id"],
    title=f"Import job {job['id']}",
    summary=summary,
    severity=severity,
    signal_state=stage_state,
    payload={
      "job_id": job["id"],
      "source_path": job.get("source_path"),
      "status": status,
      "warnings": warnings,
      "error_code": job.get("error_code"),
      "error_text": job.get("error_text"),
      "file_counts": file_counts,
      "task_count": len(tasks),
      "throughput_per_minute": state.get("throughput_per_minute"),
      "stall_minutes": state.get("stall_minutes"),
      "awaiting_refinement": bool(state.get("awaiting_refinement")),
      "recommended_action": state.get("recommended_action"),
      "next_check": state.get("next_check"),
      "retry_hint": state.get("retry_hint"),
      "semantic_stats": state.get("semantic_stats") or {},
    },
  )


def _pipeline_task_signal(job: dict[str, Any], task: dict[str, Any]) -> dict[str, Any]:
  warnings = repository.json_loads(task.get("warnings_json"), [])
  payload = repository.json_loads(task.get("payload_json"), {})
  status = task.get("status") or "queued"
  severity = "warning"
  if status == "failed":
    severity = "error"
  elif status == "completed" and not warnings and not task.get("error_code"):
    severity = "info"
  summary = f"{job.get('source_path') or 'Import job'} · {status}"
  if task.get("error_code"):
    summary = f"{summary} · {task['error_code']}"
  elif warnings:
    summary = f"{summary} · {warnings[0]}"
  return _build_signal(
    f"activity:library:pipeline-task:{task['id']}",
    source_module="library",
    source_kind="pipeline_task",
    entity_id=task["id"],
    title=f"Pipeline task {task.get('stage') or 'unknown'}",
    summary=summary,
    severity=severity,
    signal_state=payload.get("stage_state") or status,
    payload={
      "job_id": job["id"],
      "task_id": task["id"],
      "stage": task.get("stage"),
      "progress_completed": int(task.get("progress_completed") or 0),
      "progress_total": int(task.get("progress_total") or 0),
      "warnings": warnings,
      "error_code": task.get("error_code"),
      "error_text": task.get("error_text"),
      "payload": payload,
      "awaiting_refinement": bool(payload.get("awaiting_refinement")),
      "recommended_action": payload.get("recommended_action"),
      "next_check": payload.get("next_check"),
      "retry_hint": payload.get("retry_hint"),
    },
  )


def _forecast_signal(technique: dict[str, Any]) -> dict[str, Any]:
  implementation_status = str(technique.get("implementation_status") or "").strip().lower()
  adaptation_status = str(technique.get("adaptation_status") or "").strip().lower()
  confidence_level = str(technique.get("confidence_level") or "").strip().lower()
  severity = "warning"
  if confidence_level in {"low", "unknown"}:
    severity = "error"
  elif confidence_level in {"medium", "moderate"}:
    severity = "warning"
  summary_bits = [
    f"Implementation: {technique.get('implementation_status') or 'unknown'}",
    f"Adaptation: {technique.get('adaptation_status') or 'unknown'}",
    f"Confidence: {technique.get('confidence_level') or 'unknown'}",
  ]
  notes = technique.get("implementation_notes") or []
  if notes:
    summary_bits.append(str(notes[0]))
  return _build_signal(
    f"activity:library:forecast-technique:{technique['id']}",
    source_module="library",
    source_kind="forecast_technique",
    entity_id=technique["id"],
    title=technique.get("technique") or technique["id"],
    summary=". ".join(summary_bits),
    severity=severity,
    signal_state="unfinished",
    payload={
      "technique_id": technique["id"],
      "family_key": technique.get("family_key"),
      "implementation_status": technique.get("implementation_status"),
      "adaptation_status": technique.get("adaptation_status"),
      "confidence_level": technique.get("confidence_level"),
      "validation_case_count": len(technique.get("validation_cases") or []),
      "notes": notes,
    },
  )


def build_library_runtime_signals(connection, engine) -> list[dict[str, Any]]:
  system_status = engine.system_status(connection)
  strict_runtime = not bool(system_status.get("dev_fallbacks_enabled"))
  signals = [_vector_index_signal(system_status, strict=strict_runtime)]

  for provider_key, provider in (system_status.get("providers") or {}).items():
    signals.append(_provider_signal(provider_key, provider, strict=strict_runtime))

  jobs = repository.list_import_jobs(connection)
  tasks = repository.list_pipeline_tasks(connection, [job["id"] for job in jobs]) if jobs else []
  tasks_by_job: dict[str, list[dict[str, Any]]] = {}
  for task in tasks:
    tasks_by_job.setdefault(task["job_id"], []).append(task)

  for job in jobs:
    job_tasks = tasks_by_job.get(job["id"], [])
    signals.append(_import_job_signal(job, job_tasks))
    for task in job_tasks:
      warnings = repository.json_loads(task.get("warnings_json"), [])
      if task.get("status") not in {"completed"} or warnings or task.get("error_code"):
        signals.append(_pipeline_task_signal(job, task))

  for technique in repository.list_forecast_techniques(connection):
    implementation_status = str(technique.get("implementation_status") or "").strip().lower()
    adaptation_status = str(technique.get("adaptation_status") or "").strip().lower()
    confidence_level = str(technique.get("confidence_level") or "").strip().lower()
    if implementation_status not in FINAL_IMPLEMENTATION_STATUSES or adaptation_status not in FINAL_ADAPTATION_STATUSES or confidence_level in {"low", "medium", "moderate", "unknown"}:
      signals.append(_forecast_signal(technique))

  return signals
