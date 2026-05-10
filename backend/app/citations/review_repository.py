from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4


def utc_now() -> str:
  return datetime.now(timezone.utc).isoformat()


def row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
  return dict(row) if row is not None else None


def json_loads(value: str | None, default: Any):
  if isinstance(value, (dict, list)):
    return value
  if not value:
    return default
  try:
    return json.loads(value)
  except (json.JSONDecodeError, TypeError):
    return default


def _json(value: Any, default: Any) -> str:
  return json.dumps(default if value is None else value)


def get_work(connection: sqlite3.Connection, work_id: str) -> dict[str, Any] | None:
  row = connection.execute("SELECT * FROM citation_works WHERE id = ?", (work_id,)).fetchone()
  payload = row_to_dict(row)
  if payload is None:
    return None
  payload["metadata"] = json_loads(payload.pop("metadata_json", None), {})
  return payload


def get_edition(connection: sqlite3.Connection, edition_id: str) -> dict[str, Any] | None:
  row = connection.execute("SELECT * FROM citation_editions WHERE id = ?", (edition_id,)).fetchone()
  payload = row_to_dict(row)
  if payload is None:
    return None
  payload["metadata"] = json_loads(payload.pop("metadata_json", None), {})
  return payload


def get_candidate(connection: sqlite3.Connection, candidate_id: str) -> dict[str, Any] | None:
  row = connection.execute("SELECT * FROM citation_acquisition_candidates WHERE id = ?", (candidate_id,)).fetchone()
  payload = row_to_dict(row)
  if payload is None:
    return None
  payload["raw_payload"] = json_loads(payload.pop("raw_payload_json", None), {})
  payload["metadata"] = json_loads(payload.pop("metadata_json", None), {})
  return payload


def list_work_editions(connection: sqlite3.Connection, work_id: str) -> list[dict[str, Any]]:
  rows = connection.execute(
    """
    SELECT *
    FROM citation_editions
    WHERE work_id = ?
    ORDER BY publication_year ASC, created_at ASC
    """,
    (work_id,),
  ).fetchall()
  items: list[dict[str, Any]] = []
  for row in rows:
    payload = dict(row)
    payload["metadata"] = json_loads(payload.pop("metadata_json", None), {})
    items.append(payload)
  return items


def list_work_candidates(connection: sqlite3.Connection, work_id: str) -> list[dict[str, Any]]:
  rows = connection.execute(
    """
    SELECT *
    FROM citation_acquisition_candidates
    WHERE work_id = ?
    ORDER BY match_confidence DESC, created_at DESC
    """,
    (work_id,),
  ).fetchall()
  items: list[dict[str, Any]] = []
  for row in rows:
    payload = dict(row)
    payload["raw_payload"] = json_loads(payload.pop("raw_payload_json", None), {})
    payload["metadata"] = json_loads(payload.pop("metadata_json", None), {})
    items.append(payload)
  return items


def list_work_manifestations(connection: sqlite3.Connection, work_id: str) -> list[dict[str, Any]]:
  rows = connection.execute(
    """
    SELECT manifestations.*
    FROM citation_file_manifestations AS manifestations
    JOIN citation_editions AS editions ON editions.id = manifestations.edition_id
    WHERE editions.work_id = ?
    ORDER BY manifestations.created_at DESC
    """,
    (work_id,),
  ).fetchall()
  items: list[dict[str, Any]] = []
  for row in rows:
    payload = dict(row)
    payload["metadata"] = json_loads(payload.pop("metadata_json", None), {})
    items.append(payload)
  return items


def get_manifestation(connection: sqlite3.Connection, manifestation_id: str) -> dict[str, Any] | None:
  row = connection.execute("SELECT * FROM citation_file_manifestations WHERE id = ?", (manifestation_id,)).fetchone()
  payload = row_to_dict(row)
  if payload is None:
    return None
  payload["metadata"] = json_loads(payload.pop("metadata_json", None), {})
  return payload


def find_manifestation_for_candidate(connection: sqlite3.Connection, candidate_id: str) -> dict[str, Any] | None:
  row = connection.execute(
    """
    SELECT *
    FROM citation_file_manifestations
    WHERE source_candidate_id = ?
    ORDER BY created_at DESC
    LIMIT 1
    """,
    (candidate_id,),
  ).fetchone()
  payload = row_to_dict(row)
  if payload is None:
    return None
  payload["metadata"] = json_loads(payload.pop("metadata_json", None), {})
  return payload


def list_work_provenance(connection: sqlite3.Connection, work_id: str) -> list[dict[str, Any]]:
  rows = connection.execute(
    """
    SELECT
      links.id AS resolution_link_id,
      links.resolution_status,
      links.confidence AS resolution_confidence,
      normalized.id AS normalized_record_id,
      normalized.title,
      normalized.author_string,
      normalized.year,
      normalized.parse_confidence,
      observations.id AS observation_id,
      observations.source_system,
      observations.source_record_type,
      observations.source_record_id,
      observations.source_document_id,
      observations.source_url,
      observations.source_locator,
      observations.raw_citation_text,
      observations.raw_context_text,
      observations.provenance_json
    FROM citation_resolution_links AS links
    JOIN citation_normalized_records AS normalized ON normalized.id = links.normalized_record_id
    JOIN citation_observations AS observations ON observations.id = normalized.observation_id
    WHERE links.work_id = ?
    ORDER BY links.is_current DESC, links.confidence DESC, normalized.created_at DESC
    """,
    (work_id,),
  ).fetchall()
  items: list[dict[str, Any]] = []
  for row in rows:
    payload = dict(row)
    payload["provenance"] = json_loads(payload.pop("provenance_json", None), {})
    items.append(payload)
  return items


def list_review_queue(
  connection: sqlite3.Connection,
  *,
  status_filter: str | None = None,
  work_id: str | None = None,
  limit: int = 200,
) -> list[dict[str, Any]]:
  clauses: list[str] = []
  params: list[Any] = []
  if status_filter:
    clauses.append("queue.status = ?")
    params.append(status_filter)
  if work_id:
    clauses.append("queue.work_id = ?")
    params.append(work_id)
  where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
  rows = connection.execute(
    f"""
    SELECT
      queue.*,
      works.preferred_title AS work_title,
      works.work_status AS work_status,
      candidates.title AS candidate_title,
      candidates.provider AS candidate_provider,
      candidates.match_confidence AS candidate_score
    FROM citation_approval_queue AS queue
    LEFT JOIN citation_works AS works ON works.id = queue.work_id
    LEFT JOIN citation_acquisition_candidates AS candidates ON candidates.id = queue.acquisition_candidate_id
    {where_sql}
    ORDER BY
      CASE queue.status
        WHEN 'pending' THEN 0
        WHEN 'in_review' THEN 1
        WHEN 'deferred' THEN 2
        WHEN 'approved' THEN 3
        WHEN 'rejected' THEN 4
        ELSE 5
      END,
      queue.priority ASC,
      queue.created_at ASC
    LIMIT ?
    """,
    [*params, max(int(limit), 1)],
  ).fetchall()
  items: list[dict[str, Any]] = []
  for row in rows:
    payload = dict(row)
    payload["decision_notes"] = json_loads(payload.pop("decision_notes_json", None), [])
    payload["metadata"] = json_loads(payload.pop("metadata_json", None), {})
    items.append(payload)
  return items


def get_review_queue_item(connection: sqlite3.Connection, review_id: str) -> dict[str, Any] | None:
  row = connection.execute("SELECT * FROM citation_approval_queue WHERE id = ?", (review_id,)).fetchone()
  payload = row_to_dict(row)
  if payload is None:
    return None
  payload["decision_notes"] = json_loads(payload.pop("decision_notes_json", None), [])
  payload["metadata"] = json_loads(payload.pop("metadata_json", None), {})
  return payload


def create_review_queue_item(
  connection: sqlite3.Connection,
  *,
  queue_type: str,
  summary_text: str,
  requested_by_user_id: str | None,
  normalized_record_id: str | None = None,
  resolution_link_id: str | None = None,
  work_id: str | None = None,
  edition_id: str | None = None,
  manifestation_id: str | None = None,
  acquisition_candidate_id: str | None = None,
  assigned_to_user_id: str | None = None,
  priority: int = 100,
  due_at: str | None = None,
  metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
  now = utc_now()
  payload = {
    "id": f"citrev-{uuid4().hex}",
    "queue_type": queue_type,
    "status": "pending",
    "priority": int(priority),
    "summary_text": summary_text,
    "normalized_record_id": normalized_record_id,
    "resolution_link_id": resolution_link_id,
    "work_id": work_id,
    "edition_id": edition_id,
    "manifestation_id": manifestation_id,
    "acquisition_candidate_id": acquisition_candidate_id,
    "requested_by_user_id": requested_by_user_id,
    "assigned_to_user_id": assigned_to_user_id,
    "due_at": due_at,
    "decision_notes_json": "[]",
    "metadata_json": _json(metadata, {}),
    "created_at": now,
    "updated_at": now,
    "resolved_at": None,
  }
  connection.execute(
    """
    INSERT INTO citation_approval_queue (
      id, queue_type, status, priority, summary_text, normalized_record_id, resolution_link_id, work_id,
      edition_id, manifestation_id, acquisition_candidate_id, requested_by_user_id, assigned_to_user_id,
      due_at, decision_notes_json, metadata_json, created_at, updated_at, resolved_at
    )
    VALUES (
      :id, :queue_type, :status, :priority, :summary_text, :normalized_record_id, :resolution_link_id, :work_id,
      :edition_id, :manifestation_id, :acquisition_candidate_id, :requested_by_user_id, :assigned_to_user_id,
      :due_at, :decision_notes_json, :metadata_json, :created_at, :updated_at, :resolved_at
    )
    """,
    payload,
  )
  return get_review_queue_item(connection, payload["id"]) or payload


def update_review_queue_item(connection: sqlite3.Connection, review_id: str, **updates: Any) -> None:
  if not updates:
    return
  if "decision_notes_json" in updates:
    updates["decision_notes_json"] = _json(updates["decision_notes_json"], [])
  if "metadata_json" in updates:
    updates["metadata_json"] = _json(updates["metadata_json"], {})
  updates["updated_at"] = utc_now()
  updates["id"] = review_id
  columns = ", ".join(f"{key} = :{key}" for key in updates.keys() if key != "id")
  connection.execute(f"UPDATE citation_approval_queue SET {columns} WHERE id = :id", updates)


def create_review_event(
  connection: sqlite3.Connection,
  *,
  review_id: str,
  actor_user_id: str | None,
  action: str,
  from_status: str | None,
  to_status: str | None,
  event_notes: str | None = None,
  payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
  now = utc_now()
  event = {
    "id": f"citevent-{uuid4().hex}",
    "approval_queue_id": review_id,
    "actor_user_id": actor_user_id,
    "action": action,
    "from_status": from_status,
    "to_status": to_status,
    "event_notes": event_notes,
    "payload_json": _json(payload, {}),
    "created_at": now,
  }
  connection.execute(
    """
    INSERT INTO citation_approval_events (
      id, approval_queue_id, actor_user_id, action, from_status, to_status, event_notes, payload_json, created_at
    )
    VALUES (
      :id, :approval_queue_id, :actor_user_id, :action, :from_status, :to_status, :event_notes, :payload_json, :created_at
    )
    """,
    event,
  )
  return event


def list_review_events(connection: sqlite3.Connection, review_id: str) -> list[dict[str, Any]]:
  rows = connection.execute(
    "SELECT * FROM citation_approval_events WHERE approval_queue_id = ? ORDER BY created_at ASC",
    (review_id,),
  ).fetchall()
  items: list[dict[str, Any]] = []
  for row in rows:
    payload = dict(row)
    payload["payload"] = json_loads(payload.pop("payload_json", None), {})
    items.append(payload)
  return items


def update_candidate(connection: sqlite3.Connection, candidate_id: str, **updates: Any) -> None:
  if not updates:
    return
  if "raw_payload_json" in updates:
    updates["raw_payload_json"] = _json(updates["raw_payload_json"], {})
  if "metadata_json" in updates:
    updates["metadata_json"] = _json(updates["metadata_json"], {})
  updates["updated_at"] = utc_now()
  updates["id"] = candidate_id
  columns = ", ".join(f"{key} = :{key}" for key in updates.keys() if key != "id")
  connection.execute(f"UPDATE citation_acquisition_candidates SET {columns} WHERE id = :id", updates)


def update_work(connection: sqlite3.Connection, work_id: str, **updates: Any) -> None:
  if not updates:
    return
  if "metadata_json" in updates:
    updates["metadata_json"] = _json(updates["metadata_json"], {})
  updates["updated_at"] = utc_now()
  updates["id"] = work_id
  columns = ", ".join(f"{key} = :{key}" for key in updates.keys() if key != "id")
  connection.execute(f"UPDATE citation_works SET {columns} WHERE id = :id", updates)


def create_manifestation(
  connection: sqlite3.Connection,
  *,
  edition_id: str,
  source_candidate_id: str | None,
  manifestation_type: str = "digital_file",
  media_type: str | None = None,
  file_format: str | None = None,
  storage_uri: str | None = None,
  local_path: str | None = None,
  checksum_sha256: str | None = None,
  size_bytes: int | None = None,
  page_count: int | None = None,
  source_provider: str | None = None,
  source_url: str | None = None,
  acquisition_status: str = "planned",
  ocr_status: str = "pending",
  text_extraction_status: str = "pending",
  embedding_status: str = "pending",
  graph_enrichment_status: str = "pending",
  metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
  now = utc_now()
  payload = {
    "id": f"citman-{uuid4().hex}",
    "edition_id": edition_id,
    "source_candidate_id": source_candidate_id,
    "manifestation_type": manifestation_type,
    "media_type": media_type,
    "file_format": file_format,
    "storage_uri": storage_uri,
    "local_path": local_path,
    "checksum_sha256": checksum_sha256,
    "size_bytes": size_bytes,
    "page_count": page_count,
    "source_provider": source_provider,
    "source_url": source_url,
    "acquisition_status": acquisition_status,
    "ocr_status": ocr_status,
    "text_extraction_status": text_extraction_status,
    "embedding_status": embedding_status,
    "graph_enrichment_status": graph_enrichment_status,
    "metadata_json": _json(metadata, {}),
    "created_at": now,
    "updated_at": now,
  }
  connection.execute(
    """
    INSERT INTO citation_file_manifestations (
      id, edition_id, source_candidate_id, manifestation_type, media_type, file_format, storage_uri,
      local_path, checksum_sha256, size_bytes, page_count, source_provider, source_url, acquisition_status,
      ocr_status, text_extraction_status, embedding_status, graph_enrichment_status, metadata_json,
      created_at, updated_at
    )
    VALUES (
      :id, :edition_id, :source_candidate_id, :manifestation_type, :media_type, :file_format, :storage_uri,
      :local_path, :checksum_sha256, :size_bytes, :page_count, :source_provider, :source_url, :acquisition_status,
      :ocr_status, :text_extraction_status, :embedding_status, :graph_enrichment_status, :metadata_json,
      :created_at, :updated_at
    )
    """,
    payload,
  )
  return get_manifestation(connection, payload["id"]) or payload


def update_manifestation(connection: sqlite3.Connection, manifestation_id: str, **updates: Any) -> None:
  if not updates:
    return
  if "metadata_json" in updates:
    updates["metadata_json"] = _json(updates["metadata_json"], {})
  updates["updated_at"] = utc_now()
  updates["id"] = manifestation_id
  columns = ", ".join(f"{key} = :{key}" for key in updates.keys() if key != "id")
  connection.execute(f"UPDATE citation_file_manifestations SET {columns} WHERE id = :id", updates)


def create_download_job(
  connection: sqlite3.Connection,
  *,
  acquisition_candidate_id: str,
  approval_queue_id: str | None,
  requested_by_user_id: str | None,
  approved_by_user_id: str | None,
  status: str = "approved",
  download_policy: str = "manual_only",
  metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
  now = utc_now()
  payload = {
    "id": f"citdl-{uuid4().hex}",
    "acquisition_candidate_id": acquisition_candidate_id,
    "approval_queue_id": approval_queue_id,
    "manifestation_id": None,
    "requested_by_user_id": requested_by_user_id,
    "approved_by_user_id": approved_by_user_id,
    "status": status,
    "download_policy": download_policy,
    "retry_count": 0,
    "last_attempt_at": None,
    "started_at": None,
    "finished_at": None,
    "output_uri": None,
    "checksum_sha256": None,
    "error_text": None,
    "metadata_json": _json(metadata, {}),
    "created_at": now,
    "updated_at": now,
  }
  connection.execute(
    """
    INSERT INTO citation_download_jobs (
      id, acquisition_candidate_id, approval_queue_id, manifestation_id, requested_by_user_id, approved_by_user_id,
      status, download_policy, retry_count, last_attempt_at, started_at, finished_at, output_uri,
      checksum_sha256, error_text, metadata_json, created_at, updated_at
    )
    VALUES (
      :id, :acquisition_candidate_id, :approval_queue_id, :manifestation_id, :requested_by_user_id, :approved_by_user_id,
      :status, :download_policy, :retry_count, :last_attempt_at, :started_at, :finished_at, :output_uri,
      :checksum_sha256, :error_text, :metadata_json, :created_at, :updated_at
    )
    """,
    payload,
  )
  return get_download_job(connection, payload["id"]) or payload


def get_download_job(connection: sqlite3.Connection, download_job_id: str) -> dict[str, Any] | None:
  row = connection.execute("SELECT * FROM citation_download_jobs WHERE id = ?", (download_job_id,)).fetchone()
  payload = row_to_dict(row)
  if payload is None:
    return None
  payload["metadata"] = json_loads(payload.pop("metadata_json", None), {})
  return payload


def update_download_job(connection: sqlite3.Connection, download_job_id: str, **updates: Any) -> None:
  if not updates:
    return
  if "metadata_json" in updates:
    updates["metadata_json"] = _json(updates["metadata_json"], {})
  updates["updated_at"] = utc_now()
  updates["id"] = download_job_id
  columns = ", ".join(f"{key} = :{key}" for key in updates.keys() if key != "id")
  connection.execute(f"UPDATE citation_download_jobs SET {columns} WHERE id = :id", updates)


def find_download_job_for_candidate(connection: sqlite3.Connection, candidate_id: str) -> dict[str, Any] | None:
  row = connection.execute(
    """
    SELECT *
    FROM citation_download_jobs
    WHERE acquisition_candidate_id = ?
    ORDER BY created_at DESC
    LIMIT 1
    """,
    (candidate_id,),
  ).fetchone()
  payload = row_to_dict(row)
  if payload is None:
    return None
  payload["metadata"] = json_loads(payload.pop("metadata_json", None), {})
  return payload


def list_download_jobs(
  connection: sqlite3.Connection,
  *,
  status_filter: str | None = None,
  acquisition_candidate_id: str | None = None,
  work_id: str | None = None,
  limit: int = 200,
) -> list[dict[str, Any]]:
  clauses: list[str] = []
  params: list[Any] = []
  if status_filter:
    clauses.append("jobs.status = ?")
    params.append(status_filter)
  if acquisition_candidate_id:
    clauses.append("jobs.acquisition_candidate_id = ?")
    params.append(acquisition_candidate_id)
  if work_id:
    clauses.append("candidates.work_id = ?")
    params.append(work_id)
  where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
  rows = connection.execute(
    f"""
    SELECT jobs.*, candidates.title AS candidate_title, candidates.provider AS candidate_provider
    FROM citation_download_jobs AS jobs
    JOIN citation_acquisition_candidates AS candidates ON candidates.id = jobs.acquisition_candidate_id
    {where_sql}
    ORDER BY jobs.created_at DESC
    LIMIT ?
    """,
    [*params, max(int(limit), 1)],
  ).fetchall()
  items: list[dict[str, Any]] = []
  for row in rows:
    payload = dict(row)
    payload["metadata"] = json_loads(payload.pop("metadata_json", None), {})
    items.append(payload)
  return items


def list_pollable_download_jobs(connection: sqlite3.Connection, *, limit: int = 50) -> list[dict[str, Any]]:
  rows = connection.execute(
    """
    SELECT
      jobs.*,
      candidates.provider AS candidate_provider,
      candidates.candidate_status,
      candidates.work_id,
      candidates.edition_id
    FROM citation_download_jobs AS jobs
    JOIN citation_acquisition_candidates AS candidates ON candidates.id = jobs.acquisition_candidate_id
    WHERE jobs.status IN ('approved', 'queued', 'running')
    ORDER BY
      CASE jobs.status
        WHEN 'running' THEN 0
        WHEN 'approved' THEN 1
        WHEN 'queued' THEN 2
        ELSE 3
      END,
      jobs.created_at ASC
    LIMIT ?
    """,
    (max(int(limit), 1),),
  ).fetchall()
  items: list[dict[str, Any]] = []
  for row in rows:
    payload = dict(row)
    payload["metadata"] = json_loads(payload.pop("metadata_json", None), {})
    items.append(payload)
  return items


def create_manual_procurement_item(
  connection: sqlite3.Connection,
  *,
  work_id: str,
  edition_id: str | None,
  approval_queue_id: str | None,
  owner_user_id: str | None,
  requested_by_user_id: str | None,
  reason_code: str,
  priority: int = 100,
  vendor_hint: str | None = None,
  notes: list[str] | None = None,
  canonical_snapshot: dict[str, Any] | None = None,
  unresolved_reasons: list[dict[str, Any]] | None = None,
  suggested_identifiers: list[dict[str, Any]] | None = None,
  provenance_snapshot: list[dict[str, Any]] | None = None,
  future_workflow: dict[str, Any] | None = None,
  metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
  now = utc_now()
  payload = {
    "id": f"citproc-{uuid4().hex}",
    "work_id": work_id,
    "edition_id": edition_id,
    "approval_queue_id": approval_queue_id,
    "owner_user_id": owner_user_id,
    "requested_by_user_id": requested_by_user_id,
    "status": "queued",
    "reason_code": reason_code,
    "priority": int(priority),
    "vendor_hint": vendor_hint,
    "estimated_cost_cents": None,
    "due_at": None,
    "notes_json": _json(notes, []),
    "canonical_snapshot_json": _json(canonical_snapshot, {}),
    "unresolved_reasons_json": _json(unresolved_reasons, []),
    "suggested_identifiers_json": _json(suggested_identifiers, []),
    "provenance_snapshot_json": _json(provenance_snapshot, []),
    "future_workflow_json": _json(future_workflow, {}),
    "metadata_json": _json(metadata, {}),
    "created_at": now,
    "updated_at": now,
    "resolved_at": None,
  }
  connection.execute(
    """
    INSERT INTO citation_manual_procurement_queue (
      id, work_id, edition_id, approval_queue_id, owner_user_id, requested_by_user_id, status, reason_code,
      priority, vendor_hint, estimated_cost_cents, due_at, notes_json, canonical_snapshot_json,
      unresolved_reasons_json, suggested_identifiers_json, provenance_snapshot_json, future_workflow_json,
      metadata_json, created_at, updated_at, resolved_at
    )
    VALUES (
      :id, :work_id, :edition_id, :approval_queue_id, :owner_user_id, :requested_by_user_id, :status, :reason_code,
      :priority, :vendor_hint, :estimated_cost_cents, :due_at, :notes_json, :canonical_snapshot_json,
      :unresolved_reasons_json, :suggested_identifiers_json, :provenance_snapshot_json, :future_workflow_json,
      :metadata_json, :created_at, :updated_at, :resolved_at
    )
    """,
    payload,
  )
  return get_manual_procurement_item(connection, payload["id"]) or payload


def get_manual_procurement_item(connection: sqlite3.Connection, item_id: str) -> dict[str, Any] | None:
  row = connection.execute("SELECT * FROM citation_manual_procurement_queue WHERE id = ?", (item_id,)).fetchone()
  payload = row_to_dict(row)
  if payload is None:
    return None
  payload["notes"] = json_loads(payload.pop("notes_json", None), [])
  payload["canonical_snapshot"] = json_loads(payload.pop("canonical_snapshot_json", None), {})
  payload["unresolved_reasons"] = json_loads(payload.pop("unresolved_reasons_json", None), [])
  payload["suggested_identifiers"] = json_loads(payload.pop("suggested_identifiers_json", None), [])
  payload["provenance_snapshot"] = json_loads(payload.pop("provenance_snapshot_json", None), [])
  payload["future_workflow"] = json_loads(payload.pop("future_workflow_json", None), {})
  payload["metadata"] = json_loads(payload.pop("metadata_json", None), {})
  return payload


def list_manual_procurement_items(
  connection: sqlite3.Connection,
  *,
  status_filter: str | None = None,
  work_id: str | None = None,
  owner_user_id: str | None = None,
  limit: int = 200,
) -> list[dict[str, Any]]:
  clauses: list[str] = []
  params: list[Any] = []
  if status_filter:
    clauses.append("queue.status = ?")
    params.append(status_filter)
  if work_id:
    clauses.append("queue.work_id = ?")
    params.append(work_id)
  if owner_user_id:
    clauses.append("queue.owner_user_id = ?")
    params.append(owner_user_id)
  where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
  rows = connection.execute(
    f"""
    SELECT queue.*, works.preferred_title AS work_title
    FROM citation_manual_procurement_queue AS queue
    JOIN citation_works AS works ON works.id = queue.work_id
    {where_sql}
    ORDER BY queue.priority ASC, queue.created_at ASC
    LIMIT ?
    """,
    [*params, max(int(limit), 1)],
  ).fetchall()
  items: list[dict[str, Any]] = []
  for row in rows:
    payload = dict(row)
    payload["notes"] = json_loads(payload.pop("notes_json", None), [])
    payload["canonical_snapshot"] = json_loads(payload.pop("canonical_snapshot_json", None), {})
    payload["unresolved_reasons"] = json_loads(payload.pop("unresolved_reasons_json", None), [])
    payload["suggested_identifiers"] = json_loads(payload.pop("suggested_identifiers_json", None), [])
    payload["provenance_snapshot"] = json_loads(payload.pop("provenance_snapshot_json", None), [])
    payload["future_workflow"] = json_loads(payload.pop("future_workflow_json", None), {})
    payload["metadata"] = json_loads(payload.pop("metadata_json", None), {})
    items.append(payload)
  return items


def list_candidate_identifiers(connection: sqlite3.Connection, candidate_id: str) -> list[dict[str, Any]]:
  rows = connection.execute(
    """
    SELECT *
    FROM citation_identifiers
    WHERE acquisition_candidate_id = ?
    ORDER BY is_primary DESC, identifier_type ASC, created_at ASC
    """,
    (candidate_id,),
  ).fetchall()
  return [dict(row) for row in rows]


def list_work_identifiers(connection: sqlite3.Connection, work_id: str, *, edition_id: str | None = None) -> list[dict[str, Any]]:
  clauses = ["(work_id = ?"]
  params: list[Any] = [work_id]
  if edition_id:
    clauses.append(" OR edition_id = ?")
    params.append(edition_id)
  clauses.append(")")
  rows = connection.execute(
    f"""
    SELECT *
    FROM citation_identifiers
    WHERE {''.join(clauses)}
    ORDER BY is_primary DESC, identifier_type ASC, created_at ASC
    """,
    params,
  ).fetchall()
  return [dict(row) for row in rows]


def list_manifestation_identifiers(connection: sqlite3.Connection, manifestation_id: str) -> list[dict[str, Any]]:
  rows = connection.execute(
    """
    SELECT *
    FROM citation_identifiers
    WHERE manifestation_id = ?
    ORDER BY is_primary DESC, identifier_type ASC, created_at ASC
    """,
    (manifestation_id,),
  ).fetchall()
  return [dict(row) for row in rows]


def update_manual_procurement_item(connection: sqlite3.Connection, item_id: str, **updates: Any) -> None:
  if not updates:
    return
  if "notes_json" in updates:
    updates["notes_json"] = _json(updates["notes_json"], [])
  if "canonical_snapshot_json" in updates:
    updates["canonical_snapshot_json"] = _json(updates["canonical_snapshot_json"], {})
  if "unresolved_reasons_json" in updates:
    updates["unresolved_reasons_json"] = _json(updates["unresolved_reasons_json"], [])
  if "suggested_identifiers_json" in updates:
    updates["suggested_identifiers_json"] = _json(updates["suggested_identifiers_json"], [])
  if "provenance_snapshot_json" in updates:
    updates["provenance_snapshot_json"] = _json(updates["provenance_snapshot_json"], [])
  if "future_workflow_json" in updates:
    updates["future_workflow_json"] = _json(updates["future_workflow_json"], {})
  if "metadata_json" in updates:
    updates["metadata_json"] = _json(updates["metadata_json"], {})
  updates["updated_at"] = utc_now()
  updates["id"] = item_id
  columns = ", ".join(f"{key} = :{key}" for key in updates.keys() if key != "id")
  connection.execute(f"UPDATE citation_manual_procurement_queue SET {columns} WHERE id = :id", updates)


def create_manual_procurement_event(
  connection: sqlite3.Connection,
  *,
  procurement_queue_id: str,
  actor_user_id: str | None,
  action: str,
  from_status: str | None,
  to_status: str | None,
  note_text: str | None = None,
  payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
  event = {
    "id": f"citprocevent-{uuid4().hex}",
    "procurement_queue_id": procurement_queue_id,
    "actor_user_id": actor_user_id,
    "action": action,
    "from_status": from_status,
    "to_status": to_status,
    "note_text": note_text,
    "payload_json": _json(payload, {}),
    "created_at": utc_now(),
  }
  connection.execute(
    """
    INSERT INTO citation_manual_procurement_events (
      id, procurement_queue_id, actor_user_id, action, from_status, to_status, note_text, payload_json, created_at
    )
    VALUES (
      :id, :procurement_queue_id, :actor_user_id, :action, :from_status, :to_status, :note_text, :payload_json, :created_at
    )
    """,
    event,
  )
  return event


def list_manual_procurement_events(connection: sqlite3.Connection, item_id: str) -> list[dict[str, Any]]:
  rows = connection.execute(
    """
    SELECT *
    FROM citation_manual_procurement_events
    WHERE procurement_queue_id = ?
    ORDER BY created_at ASC
    """,
    (item_id,),
  ).fetchall()
  items: list[dict[str, Any]] = []
  for row in rows:
    payload = dict(row)
    payload["payload"] = json_loads(payload.pop("payload_json", None), {})
    items.append(payload)
  return items


def create_identifier(
  connection: sqlite3.Connection,
  *,
  identifier_type: str,
  normalized_value: str,
  raw_value: str | None = None,
  is_primary: bool = False,
  source_confidence: float = 1.0,
  normalized_record_id: str | None = None,
  work_id: str | None = None,
  edition_id: str | None = None,
  manifestation_id: str | None = None,
  acquisition_candidate_id: str | None = None,
) -> dict[str, Any]:
  now = utc_now()
  payload = {
    "id": f"citid-{uuid4().hex}",
    "normalized_record_id": normalized_record_id,
    "work_id": work_id,
    "edition_id": edition_id,
    "manifestation_id": manifestation_id,
    "acquisition_candidate_id": acquisition_candidate_id,
    "identifier_type": identifier_type,
    "normalized_value": normalized_value,
    "raw_value": raw_value,
    "is_primary": 1 if is_primary else 0,
    "source_confidence": float(source_confidence),
    "created_at": now,
    "updated_at": now,
  }
  connection.execute(
    """
    INSERT OR IGNORE INTO citation_identifiers (
      id, normalized_record_id, work_id, edition_id, manifestation_id, acquisition_candidate_id,
      identifier_type, normalized_value, raw_value, is_primary, source_confidence, created_at, updated_at
    )
    VALUES (
      :id, :normalized_record_id, :work_id, :edition_id, :manifestation_id, :acquisition_candidate_id,
      :identifier_type, :normalized_value, :raw_value, :is_primary, :source_confidence, :created_at, :updated_at
    )
    """,
    payload,
  )
  row = connection.execute("SELECT * FROM citation_identifiers WHERE id = ?", (payload["id"],)).fetchone()
  return dict(row) if row is not None else payload


def find_manifestations_by_checksum(connection: sqlite3.Connection, checksum_sha256: str, *, limit: int = 20) -> list[dict[str, Any]]:
  rows = connection.execute(
    """
    SELECT *
    FROM citation_file_manifestations
    WHERE checksum_sha256 = ?
    ORDER BY created_at DESC
    LIMIT ?
    """,
    (checksum_sha256, max(int(limit), 1)),
  ).fetchall()
  items: list[dict[str, Any]] = []
  for row in rows:
    payload = dict(row)
    payload["metadata"] = json_loads(payload.pop("metadata_json", None), {})
    items.append(payload)
  return items


def list_documents_for_duplicate_detection(
  connection: sqlite3.Connection,
  *,
  basename: str | None = None,
  limit: int = 200,
) -> list[dict[str, Any]]:
  clauses: list[str] = []
  params: list[Any] = []
  if basename:
    clauses.append("LOWER(source_path) LIKE ?")
    params.append(f"%{str(basename).lower()}")
  where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
  rows = connection.execute(
    f"""
    SELECT id, title, source_path, file_type, status, updated_at
    FROM documents
    {where_sql}
    ORDER BY updated_at DESC
    LIMIT ?
    """,
    [*params, max(int(limit), 1)],
  ).fetchall()
  return [dict(row) for row in rows]


def create_provenance_event(
  connection: sqlite3.Connection,
  *,
  entity_type: str,
  entity_id: str,
  event_type: str,
  actor_user_id: str | None,
  processing_run_id: str | None = None,
  approval_queue_id: str | None = None,
  source_system: str | None = None,
  source_record_type: str | None = None,
  source_record_id: str | None = None,
  event_summary: str | None = None,
  payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
  now = utc_now()
  event = {
    "id": f"citprov-{uuid4().hex}",
    "entity_type": entity_type,
    "entity_id": entity_id,
    "event_type": event_type,
    "source_system": source_system,
    "source_record_type": source_record_type,
    "source_record_id": source_record_id,
    "processing_run_id": processing_run_id,
    "approval_queue_id": approval_queue_id,
    "actor_user_id": actor_user_id,
    "event_summary": event_summary,
    "payload_json": _json(payload, {}),
    "created_at": now,
  }
  connection.execute(
    """
    INSERT INTO citation_provenance_events (
      id, entity_type, entity_id, event_type, source_system, source_record_type, source_record_id,
      processing_run_id, approval_queue_id, actor_user_id, event_summary, payload_json, created_at
    )
    VALUES (
      :id, :entity_type, :entity_id, :event_type, :source_system, :source_record_type, :source_record_id,
      :processing_run_id, :approval_queue_id, :actor_user_id, :event_summary, :payload_json, :created_at
    )
    """,
    event,
  )
  return event


def list_entity_provenance_events(connection: sqlite3.Connection, entity_type: str, entity_id: str) -> list[dict[str, Any]]:
  rows = connection.execute(
    """
    SELECT *
    FROM citation_provenance_events
    WHERE entity_type = ? AND entity_id = ?
    ORDER BY created_at ASC
    """,
    (entity_type, entity_id),
  ).fetchall()
  items: list[dict[str, Any]] = []
  for row in rows:
    payload = dict(row)
    payload["payload"] = json_loads(payload.pop("payload_json", None), {})
    items.append(payload)
  return items


def merge_work_clusters(connection: sqlite3.Connection, *, target_work_id: str, source_work_ids: list[str]) -> None:
  unique_sources = [item for item in {item for item in source_work_ids if item and item != target_work_id}]
  if not unique_sources:
    return
  placeholders = ",".join("?" for _ in unique_sources)
  now = utc_now()
  connection.execute(
    f"UPDATE citation_editions SET work_id = ?, updated_at = ? WHERE work_id IN ({placeholders})",
    [target_work_id, now, *unique_sources],
  )
  connection.execute(
    f"UPDATE citation_acquisition_candidates SET work_id = ?, updated_at = ? WHERE work_id IN ({placeholders})",
    [target_work_id, now, *unique_sources],
  )
  connection.execute(
    f"UPDATE citation_resolution_links SET work_id = ?, updated_at = ? WHERE work_id IN ({placeholders})",
    [target_work_id, now, *unique_sources],
  )
  connection.execute(
    f"UPDATE citation_manual_procurement_queue SET work_id = ?, updated_at = ? WHERE work_id IN ({placeholders})",
    [target_work_id, now, *unique_sources],
  )
  connection.execute(
    f"UPDATE citation_approval_queue SET work_id = ?, updated_at = ? WHERE work_id IN ({placeholders})",
    [target_work_id, now, *unique_sources],
  )
  connection.execute(
    f"UPDATE citation_identifiers SET work_id = ?, updated_at = ? WHERE work_id IN ({placeholders})",
    [target_work_id, now, *unique_sources],
  )
  connection.execute(
    f"""
    UPDATE citation_works
    SET work_status = 'merged', superseded_by_work_id = ?, updated_at = ?
    WHERE id IN ({placeholders})
    """,
    [target_work_id, now, *unique_sources],
  )


def split_work_cluster(
  connection: sqlite3.Connection,
  *,
  source_work_id: str,
  new_work_payload: dict[str, Any],
  edition_ids: list[str] | None = None,
  candidate_ids: list[str] | None = None,
  resolution_link_ids: list[str] | None = None,
) -> dict[str, Any]:
  now = utc_now()
  payload = {
    "id": f"citwork-{uuid4().hex}",
    "preferred_title": new_work_payload.get("preferred_title") or "Untitled split work",
    "title_key": new_work_payload.get("title_key") or (new_work_payload.get("preferred_title") or "untitled split work").lower(),
    "subtitle": new_work_payload.get("subtitle"),
    "work_type": new_work_payload.get("work_type") or "unknown",
    "canonical_author_string": new_work_payload.get("canonical_author_string"),
    "original_year": new_work_payload.get("original_year"),
    "language": new_work_payload.get("language"),
    "work_status": new_work_payload.get("work_status") or "canonical",
    "cluster_confidence": float(new_work_payload.get("cluster_confidence") or 0.0),
    "summary_text": new_work_payload.get("summary_text"),
    "semantic_status": new_work_payload.get("semantic_status") or "pending",
    "graph_status": new_work_payload.get("graph_status") or "pending",
    "metadata_json": _json(new_work_payload.get("metadata"), {}),
    "created_at": now,
    "updated_at": now,
    "superseded_by_work_id": None,
  }
  connection.execute(
    """
    INSERT INTO citation_works (
      id, preferred_title, title_key, subtitle, work_type, canonical_author_string, original_year, language,
      work_status, cluster_confidence, summary_text, semantic_status, graph_status, metadata_json,
      created_at, updated_at, superseded_by_work_id
    )
    VALUES (
      :id, :preferred_title, :title_key, :subtitle, :work_type, :canonical_author_string, :original_year, :language,
      :work_status, :cluster_confidence, :summary_text, :semantic_status, :graph_status, :metadata_json,
      :created_at, :updated_at, :superseded_by_work_id
    )
    """,
    payload,
  )
  if edition_ids:
    placeholders = ",".join("?" for _ in edition_ids)
    connection.execute(
      f"UPDATE citation_editions SET work_id = ?, updated_at = ? WHERE id IN ({placeholders}) AND work_id = ?",
      [payload["id"], utc_now(), *edition_ids, source_work_id],
    )
  if candidate_ids:
    placeholders = ",".join("?" for _ in candidate_ids)
    connection.execute(
      f"UPDATE citation_acquisition_candidates SET work_id = ?, updated_at = ? WHERE id IN ({placeholders}) AND work_id = ?",
      [payload["id"], utc_now(), *candidate_ids, source_work_id],
    )
  if resolution_link_ids:
    placeholders = ",".join("?" for _ in resolution_link_ids)
    connection.execute(
      f"UPDATE citation_resolution_links SET work_id = ?, updated_at = ? WHERE id IN ({placeholders}) AND work_id = ?",
      [payload["id"], utc_now(), *resolution_link_ids, source_work_id],
    )
  return get_work(connection, payload["id"]) or payload
