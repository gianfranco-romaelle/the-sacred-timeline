from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from . import review_repository as repo


class CitationProcurementError(RuntimeError):
  pass


@dataclass(slots=True)
class CitationProcurementService:
  def _canonical_snapshot(self, work: dict[str, Any] | None, edition: dict[str, Any] | None) -> dict[str, Any]:
    return {
      "work": work or {},
      "edition": edition or {},
    }

  def _normalize_reasons(self, reason_code: str | None, reasons: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    normalized = [dict(item) for item in (reasons or []) if isinstance(item, dict)]
    if reason_code and not any(str(item.get("code") or "").strip() == str(reason_code).strip() for item in normalized):
      normalized.insert(0, {"code": str(reason_code).strip()})
    return normalized

  def _suggested_identifiers(self, connection, work_id: str, edition_id: str | None = None) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for row in repo.list_work_identifiers(connection, work_id, edition_id=edition_id):
      identifier_type = str(row.get("identifier_type") or "").strip()
      value = str(row.get("normalized_value") or "").strip()
      if not identifier_type or not value:
        continue
      key = (identifier_type, value)
      if key in seen:
        continue
      seen.add(key)
      items.append(
        {
          "identifier_type": identifier_type,
          "value": value,
          "is_primary": bool(row.get("is_primary")),
          "source_confidence": float(row.get("source_confidence") or 0.0),
          "search_hint": f"{identifier_type}:{value}",
        }
      )
    return items

  def _provenance_snapshot(self, connection, work_id: str) -> list[dict[str, Any]]:
    snapshot: list[dict[str, Any]] = []
    for row in repo.list_work_provenance(connection, work_id):
      snapshot.append(
        {
          "observation_id": row["observation_id"],
          "normalized_record_id": row["normalized_record_id"],
          "resolution_link_id": row["resolution_link_id"],
          "source_system": row.get("source_system"),
          "source_record_type": row.get("source_record_type"),
          "source_record_id": row.get("source_record_id"),
          "source_document_id": row.get("source_document_id"),
          "source_url": row.get("source_url"),
          "source_locator": row.get("source_locator"),
          "raw_citation_text": row.get("raw_citation_text"),
          "title": row.get("title"),
          "author_string": row.get("author_string"),
          "year": row.get("year"),
          "resolution_confidence": row.get("resolution_confidence"),
        }
      )
    return snapshot

  def _default_future_workflow(self, overrides: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = {
      "upload_candidate": False,
      "preferred_targets": [],
      "workflow_status": "not_ready",
      "scan_ready": False,
      "upload_ready": False,
    }
    payload.update(dict(overrides or {}))
    return payload

  def build_detail(self, connection, item_id: str) -> dict[str, Any]:
    item = repo.get_manual_procurement_item(connection, item_id)
    if item is None:
      raise CitationProcurementError("Manual procurement item not found.")
    work = repo.get_work(connection, item["work_id"])
    edition = repo.get_edition(connection, item["edition_id"]) if item.get("edition_id") else None
    return {
      "item": item,
      "work": work,
      "edition": edition,
      "provenance_links": repo.list_work_provenance(connection, item["work_id"]),
      "events": repo.list_manual_procurement_events(connection, item_id),
    }

  def create_item(
    self,
    connection,
    *,
    work_id: str,
    edition_id: str | None,
    approval_queue_id: str | None,
    owner_user_id: str | None,
    requested_by_user_id: str | None,
    reason_code: str,
    unresolved_reasons: list[dict[str, Any]] | None = None,
    priority: int = 100,
    vendor_hint: str | None = None,
    due_at: str | None = None,
    notes: list[str] | None = None,
    future_workflow: dict[str, Any] | None = None,
    metadata: dict[str, Any] | None = None,
    actor_user_id: str | None = None,
  ) -> dict[str, Any]:
    work = repo.get_work(connection, work_id)
    if work is None:
      raise CitationProcurementError("Manual procurement item requires a valid work.")
    edition = repo.get_edition(connection, edition_id) if edition_id else None
    item = repo.create_manual_procurement_item(
      connection,
      work_id=work_id,
      edition_id=edition_id,
      approval_queue_id=approval_queue_id,
      owner_user_id=owner_user_id,
      requested_by_user_id=requested_by_user_id,
      reason_code=reason_code,
      priority=priority,
      vendor_hint=vendor_hint,
      notes=notes,
      canonical_snapshot=self._canonical_snapshot(work, edition),
      unresolved_reasons=self._normalize_reasons(reason_code, unresolved_reasons),
      suggested_identifiers=self._suggested_identifiers(connection, work_id, edition_id=edition_id),
      provenance_snapshot=self._provenance_snapshot(connection, work_id),
      future_workflow=self._default_future_workflow(future_workflow),
      metadata=metadata,
    )
    if due_at:
      repo.update_manual_procurement_item(connection, item["id"], due_at=due_at)
      item = repo.get_manual_procurement_item(connection, item["id"]) or item
    repo.create_manual_procurement_event(
      connection,
      procurement_queue_id=item["id"],
      actor_user_id=actor_user_id or requested_by_user_id,
      action="created",
      from_status=None,
      to_status=item["status"],
      note_text=(notes or [None])[0],
      payload={"reason_code": reason_code},
    )
    repo.create_provenance_event(
      connection,
      entity_type="manual_procurement",
      entity_id=item["id"],
      event_type="procurement_queued",
      actor_user_id=actor_user_id or requested_by_user_id,
      approval_queue_id=approval_queue_id,
      event_summary="Work entered manual procurement queue.",
      payload={"work_id": work_id, "reason_code": reason_code},
    )
    return self.build_detail(connection, item["id"])

  def apply_action(
    self,
    connection,
    *,
    item_id: str,
    actor_user_id: str | None,
    action: str,
    note: str | None = None,
    payload: dict[str, Any] | None = None,
  ) -> dict[str, Any]:
    item = repo.get_manual_procurement_item(connection, item_id)
    if item is None:
      raise CitationProcurementError("Manual procurement item not found.")
    action_payload = dict(payload or {})
    updates: dict[str, Any] = {}
    from_status = item["status"]
    to_status = from_status

    notes = list(item.get("notes") or [])
    if note:
      notes.append(note)
      updates["notes_json"] = notes

    if action == "assign_owner":
      updates["owner_user_id"] = action_payload.get("owner_user_id")
    elif action == "set_priority":
      updates["priority"] = int(action_payload.get("priority") or item.get("priority") or 100)
    elif action == "set_due_at":
      updates["due_at"] = action_payload.get("due_at")
    elif action == "add_note":
      pass
    elif action == "mark_researching":
      to_status = "researching"
      updates["status"] = to_status
    elif action == "mark_ordered":
      to_status = "ordered"
      updates["status"] = to_status
      updates["estimated_cost_cents"] = action_payload.get("estimated_cost_cents")
      updates["vendor_hint"] = action_payload.get("vendor_hint") or item.get("vendor_hint")
    elif action == "mark_awaiting_scan":
      to_status = "awaiting_scan"
      updates["status"] = to_status
    elif action == "mark_awaiting_upload":
      to_status = "awaiting_upload"
      updates["status"] = to_status
    elif action == "mark_completed":
      to_status = "completed"
      updates["status"] = to_status
      updates["resolved_at"] = repo.utc_now()
    elif action == "mark_closed_unavailable":
      to_status = "closed_unavailable"
      updates["status"] = to_status
      updates["resolved_at"] = repo.utc_now()
    elif action == "set_upload_candidate":
      future = dict(item.get("future_workflow") or {})
      future.update(
        {
          "upload_candidate": bool(action_payload.get("upload_candidate", True)),
          "preferred_targets": list(action_payload.get("preferred_targets") or future.get("preferred_targets") or []),
          "workflow_status": action_payload.get("workflow_status") or future.get("workflow_status") or "planned",
          "scan_ready": bool(action_payload.get("scan_ready", future.get("scan_ready", False))),
          "upload_ready": bool(action_payload.get("upload_ready", future.get("upload_ready", False))),
        }
      )
      updates["future_workflow_json"] = future
    elif action == "refresh_snapshot":
      work = repo.get_work(connection, item["work_id"])
      edition = repo.get_edition(connection, item["edition_id"]) if item.get("edition_id") else None
      updates["canonical_snapshot_json"] = self._canonical_snapshot(work, edition)
      updates["suggested_identifiers_json"] = self._suggested_identifiers(connection, item["work_id"], edition_id=item.get("edition_id"))
      updates["provenance_snapshot_json"] = self._provenance_snapshot(connection, item["work_id"])
    elif action == "update_unresolved_reasons":
      updates["unresolved_reasons_json"] = self._normalize_reasons(item.get("reason_code"), list(action_payload.get("unresolved_reasons") or []))
    elif action == "update_suggested_identifiers":
      updates["suggested_identifiers_json"] = list(action_payload.get("suggested_identifiers") or [])
    else:
      raise CitationProcurementError(f"Unsupported procurement action: {action}")

    if updates:
      repo.update_manual_procurement_item(connection, item_id, **updates)
    updated = repo.get_manual_procurement_item(connection, item_id) or item
    repo.create_manual_procurement_event(
      connection,
      procurement_queue_id=item_id,
      actor_user_id=actor_user_id,
      action=action,
      from_status=from_status,
      to_status=updated["status"],
      note_text=note,
      payload=action_payload,
    )
    repo.create_provenance_event(
      connection,
      entity_type="manual_procurement",
      entity_id=item_id,
      event_type="procurement_updated",
      actor_user_id=actor_user_id,
      approval_queue_id=updated.get("approval_queue_id"),
      event_summary=note or f"Manual procurement action applied: {action}.",
      payload={"action": action, "status": updated["status"], **action_payload},
    )
    return self.build_detail(connection, item_id)

  def export_session(
    self,
    connection,
    *,
    status_filter: str | None = None,
    owner_user_id: str | None = None,
    limit: int = 500,
  ) -> dict[str, Any]:
    items = repo.list_manual_procurement_items(
      connection,
      status_filter=status_filter,
      owner_user_id=owner_user_id,
      limit=limit,
    )
    export_items: list[dict[str, Any]] = []
    for item in items:
      work_snapshot = dict(item.get("canonical_snapshot") or {}).get("work") or {}
      search_hints = [
        " ".join(part for part in [work_snapshot.get("preferred_title"), work_snapshot.get("canonical_author_string"), work_snapshot.get("original_year")] if part),
        *[
          str(identifier.get("search_hint") or "")
          for identifier in item.get("suggested_identifiers") or []
          if str(identifier.get("search_hint") or "").strip()
        ],
      ]
      export_items.append(
        {
          "queue_item": item,
          "search_hints": [hint for hint in search_hints if hint],
        }
      )
      repo.create_manual_procurement_event(
        connection,
        procurement_queue_id=item["id"],
        actor_user_id=None,
        action="exported",
        from_status=item["status"],
        to_status=item["status"],
        note_text=None,
        payload={"status_filter": status_filter, "owner_user_id": owner_user_id},
      )
    return {
      "schema_version": "citation_manual_procurement_export.v1",
      "exported_at": repo.utc_now(),
      "filters": {
        "status_filter": status_filter,
        "owner_user_id": owner_user_id,
        "limit": limit,
      },
      "count": len(export_items),
      "items": export_items,
    }
