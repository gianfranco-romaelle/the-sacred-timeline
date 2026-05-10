from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .procurement_service import CitationProcurementService
from . import review_repository as repo


class CitationReviewError(RuntimeError):
  pass


@dataclass(slots=True)
class CitationReviewService:
  procurement_service: CitationProcurementService = field(default_factory=CitationProcurementService)

  @staticmethod
  def _append_decision_note(item: dict[str, Any], *, actor_user_id: str | None, action: str, note: str | None) -> list[dict[str, Any]]:
    notes = list(item.get("decision_notes") or [])
    notes.append(
      {
        "acted_at": repo.utc_now(),
        "actor_user_id": actor_user_id,
        "action": action,
        "note": note,
      }
    )
    return notes

  def build_review_detail(self, connection, review_id: str) -> dict[str, Any]:
    item = repo.get_review_queue_item(connection, review_id)
    if item is None:
      raise CitationReviewError("Review item not found.")
    work = repo.get_work(connection, item.get("work_id")) if item.get("work_id") else None
    edition = repo.get_edition(connection, item.get("edition_id")) if item.get("edition_id") else None
    candidate = repo.get_candidate(connection, item.get("acquisition_candidate_id")) if item.get("acquisition_candidate_id") else None
    work_id = item.get("work_id") or (candidate.get("work_id") if candidate else None)
    return {
      "item": item,
      "work": work,
      "edition": edition,
      "candidate": candidate,
      "editions": repo.list_work_editions(connection, work_id) if work_id else [],
      "candidates": repo.list_work_candidates(connection, work_id) if work_id else [],
      "manifestations": repo.list_work_manifestations(connection, work_id) if work_id else [],
      "provenance_links": repo.list_work_provenance(connection, work_id) if work_id else [],
      "events": repo.list_review_events(connection, review_id),
      "work_events": repo.list_entity_provenance_events(connection, "work", work_id) if work_id else [],
      "candidate_events": repo.list_entity_provenance_events(connection, "candidate", candidate["id"]) if candidate else [],
      "download_jobs": repo.list_download_jobs(connection, acquisition_candidate_id=candidate["id"], limit=50) if candidate else [],
      "manual_procurement_items": repo.list_manual_procurement_items(connection, work_id=work_id, limit=50) if work_id else [],
    }

  def create_review_item(self, connection, **kwargs: Any) -> dict[str, Any]:
    item = repo.create_review_queue_item(connection, **kwargs)
    repo.create_review_event(
      connection,
      review_id=item["id"],
      actor_user_id=kwargs.get("requested_by_user_id"),
      action="created",
      from_status=None,
      to_status=item["status"],
      event_notes=kwargs.get("summary_text"),
      payload={"queue_type": kwargs.get("queue_type")},
    )
    work_id = kwargs.get("work_id")
    if work_id:
      repo.create_provenance_event(
        connection,
        entity_type="work",
        entity_id=work_id,
        event_type="review_queued",
        actor_user_id=kwargs.get("requested_by_user_id"),
        approval_queue_id=item["id"],
        event_summary=kwargs.get("summary_text"),
        payload={"queue_type": kwargs.get("queue_type")},
      )
    return self.build_review_detail(connection, item["id"])

  def apply_decision(
    self,
    connection,
    *,
    review_id: str,
    actor_user_id: str | None,
    action: str,
    note: str | None = None,
    payload: dict[str, Any] | None = None,
  ) -> dict[str, Any]:
    item = repo.get_review_queue_item(connection, review_id)
    if item is None:
      raise CitationReviewError("Review item not found.")
    decision_payload = dict(payload or {})
    from_status = item["status"]
    to_status = from_status
    work_id = item.get("work_id")
    candidate_id = item.get("acquisition_candidate_id")
    decision_notes = self._append_decision_note(item, actor_user_id=actor_user_id, action=action, note=note)

    if action == "approve_candidate_for_download":
      if not candidate_id:
        raise CitationReviewError("Candidate-level approval requires an acquisition candidate.")
      repo.update_candidate(connection, candidate_id, candidate_status="approved")
      download_job = repo.find_download_job_for_candidate(connection, candidate_id)
      if download_job is None:
        download_job = repo.create_download_job(
          connection,
          acquisition_candidate_id=candidate_id,
          approval_queue_id=review_id,
          requested_by_user_id=item.get("requested_by_user_id"),
          approved_by_user_id=actor_user_id,
          status="approved",
          metadata={"review_note": note} if note else {},
        )
      to_status = "approved"
      repo.update_review_queue_item(
        connection,
        review_id,
        status=to_status,
        decision_notes_json=decision_notes,
        resolved_at=repo.utc_now(),
      )
      repo.create_provenance_event(
        connection,
        entity_type="candidate",
        entity_id=candidate_id,
        event_type="approved",
        actor_user_id=actor_user_id,
        approval_queue_id=review_id,
        event_summary=note or "Candidate approved for guarded download queue entry.",
        payload={"download_job_id": download_job["id"]},
      )
      if work_id:
        repo.create_provenance_event(
          connection,
          entity_type="work",
          entity_id=work_id,
          event_type="approved",
          actor_user_id=actor_user_id,
          approval_queue_id=review_id,
          event_summary=note or "Candidate approved for download.",
          payload={"candidate_id": candidate_id, "download_job_id": download_job["id"]},
        )
    elif action == "reject_candidate":
      if candidate_id:
        repo.update_candidate(connection, candidate_id, candidate_status="rejected")
        repo.create_provenance_event(
          connection,
          entity_type="candidate",
          entity_id=candidate_id,
          event_type="rejected",
          actor_user_id=actor_user_id,
          approval_queue_id=review_id,
          event_summary=note or "Candidate rejected by human review.",
          payload=decision_payload,
        )
      to_status = "rejected"
      repo.update_review_queue_item(
        connection,
        review_id,
        status=to_status,
        decision_notes_json=decision_notes,
        resolved_at=repo.utc_now(),
      )
    elif action == "defer_candidate":
      if candidate_id:
        repo.update_candidate(connection, candidate_id, candidate_status="shortlisted")
        repo.create_provenance_event(
          connection,
          entity_type="candidate",
          entity_id=candidate_id,
          event_type="deferred",
          actor_user_id=actor_user_id,
          approval_queue_id=review_id,
          event_summary=note or "Candidate deferred for later review.",
          payload=decision_payload,
        )
      to_status = "deferred"
      repo.update_review_queue_item(connection, review_id, status=to_status, decision_notes_json=decision_notes)
    elif action == "mark_unresolved":
      if work_id:
        repo.update_work(connection, work_id, work_status="needs_review")
        repo.create_provenance_event(
          connection,
          entity_type="work",
          entity_id=work_id,
          event_type="unresolved",
          actor_user_id=actor_user_id,
          approval_queue_id=review_id,
          event_summary=note or "Work marked unresolved by human review.",
          payload=decision_payload,
        )
      to_status = "deferred"
      repo.update_review_queue_item(connection, review_id, status=to_status, decision_notes_json=decision_notes)
    elif action == "send_work_to_manual_procurement_queue":
      if not work_id:
        raise CitationReviewError("Manual procurement routing requires a work.")
      procurement_detail = self.procurement_service.create_item(
        connection,
        work_id=work_id,
        edition_id=item.get("edition_id"),
        approval_queue_id=review_id,
        owner_user_id=decision_payload.get("owner_user_id"),
        requested_by_user_id=item.get("requested_by_user_id"),
        reason_code=decision_payload.get("reason_code") or "unresolved_acquisition",
        unresolved_reasons=list(decision_payload.get("unresolved_reasons") or []),
        priority=int(decision_payload.get("priority") or item.get("priority") or 100),
        vendor_hint=decision_payload.get("vendor_hint"),
        due_at=decision_payload.get("due_at"),
        notes=[note] if note else [],
        future_workflow=decision_payload.get("future_workflow"),
        metadata={"review_payload": decision_payload},
        actor_user_id=actor_user_id,
      )
      procurement = procurement_detail["item"]
      to_status = "deferred"
      repo.update_review_queue_item(connection, review_id, status=to_status, decision_notes_json=decision_notes)
      repo.create_provenance_event(
        connection,
        entity_type="work",
        entity_id=work_id,
        event_type="procured",
        actor_user_id=actor_user_id,
        approval_queue_id=review_id,
        event_summary=note or "Work routed to manual procurement queue.",
        payload={"manual_procurement_id": procurement["id"]},
      )
    elif action == "merge_clusters":
      target_work_id = str(decision_payload.get("target_work_id") or "").strip()
      source_work_ids = [str(item) for item in decision_payload.get("source_work_ids", []) if str(item).strip()]
      if not target_work_id or not source_work_ids:
        raise CitationReviewError("merge_clusters requires target_work_id and source_work_ids.")
      repo.merge_work_clusters(connection, target_work_id=target_work_id, source_work_ids=source_work_ids)
      to_status = "approved"
      repo.update_review_queue_item(
        connection,
        review_id,
        status=to_status,
        work_id=target_work_id,
        decision_notes_json=decision_notes,
        resolved_at=repo.utc_now(),
      )
      repo.create_provenance_event(
        connection,
        entity_type="work",
        entity_id=target_work_id,
        event_type="merged",
        actor_user_id=actor_user_id,
        approval_queue_id=review_id,
        event_summary=note or "Human review merged work clusters.",
        payload={"source_work_ids": source_work_ids},
      )
    elif action == "split_cluster":
      if not work_id:
        raise CitationReviewError("split_cluster requires a source work.")
      new_work = repo.split_work_cluster(
        connection,
        source_work_id=work_id,
        new_work_payload=decision_payload.get("new_work") or {},
        edition_ids=[str(item) for item in decision_payload.get("edition_ids", []) if str(item).strip()],
        candidate_ids=[str(item) for item in decision_payload.get("candidate_ids", []) if str(item).strip()],
        resolution_link_ids=[str(item) for item in decision_payload.get("resolution_link_ids", []) if str(item).strip()],
      )
      to_status = "approved"
      repo.update_review_queue_item(
        connection,
        review_id,
        status=to_status,
        decision_notes_json=decision_notes,
        resolved_at=repo.utc_now(),
      )
      repo.create_provenance_event(
        connection,
        entity_type="work",
        entity_id=new_work["id"],
        event_type="split",
        actor_user_id=actor_user_id,
        approval_queue_id=review_id,
        event_summary=note or "Human review split a work cluster.",
        payload={"source_work_id": work_id},
      )
      decision_payload = {**decision_payload, "new_work_id": new_work["id"]}
    else:
      raise CitationReviewError(f"Unsupported review action: {action}")

    repo.create_review_event(
      connection,
      review_id=review_id,
      actor_user_id=actor_user_id,
      action=action,
      from_status=from_status,
      to_status=to_status,
      event_notes=note,
      payload=decision_payload,
    )
    return self.build_review_detail(connection, review_id)
