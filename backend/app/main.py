from __future__ import annotations

import json
import shutil
from pathlib import Path
from datetime import datetime, timedelta, timezone
from typing import Annotated

from .bootstrap import activate_vendor_path

activate_vendor_path()

import jwt
from argon2 import PasswordHasher
from fastapi import Depends, FastAPI, HTTPException, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from . import activity, repository
from .config import settings
from .citations.procurement_service import CitationProcurementError, CitationProcurementService
from .citations import review_repository as citation_review_repo
from .citations.review_service import CitationReviewError, CitationReviewService
from .cognitive_invariants_collection import (
  SOURCE_KIND as COGNITIVE_INVARIANTS_SOURCE_KIND,
  build_cognitive_invariants_payload,
  materialize_cognitive_invariants_map,
)
from .database import database_session, initialize_database
from .engine import LibraryEngine
from .errors import ServiceDependencyError
from .forecast_technique_families import build_pack_payload
from .lawvere_collection import (
  SOURCE_KIND as LAWVERE_COLLECTION_SOURCE_KIND,
  build_lawvere_collection_payload,
  materialize_lawvere_collection_map,
)
from .website_topos import SOURCE_KIND as WEBSITE_TOPOS_SOURCE_KIND
from .website_topos import load_reviewed_website_topos_export, materialize_website_topos_map
from .schemas import (
  ActivityExportCommitRequest,
  ActivityExportFailureRequest,
  ActivityGitExportsResponse,
  ActivityGitProfileResponse,
  ActivityGitProfileOut,
  ActivityGitProfileRequest,
  ActivityPrivateExportOut,
  ActivityReviewHistoryResponse,
  ActivityReviewOut,
  ActivityReviewRequest,
  ActivitySignalOut,
  ActivitySignalSyncRequest,
  ActivitySignalsResponse,
  CognitiveInvariantsMaterializeRequest,
  CognitiveInvariantsMaterializeResponse,
  CitationAcquisitionCandidateReviewOut,
  CitationDownloadJobOut,
  CitationDownloadJobsResponse,
  CitationEntryOut,
  CitationEditionReviewOut,
  DossierAssertionsResponse,
  DossierSignalWindowsResponse,
  DossierSyncRequest,
  DossierSyncResponse,
  CitationManifestationReviewOut,
  CitationManualProcurementItemOut,
  CitationManualProcurementCreate,
  CitationManualProcurementActionRequest,
  CitationManualProcurementDetailOut,
  CitationManualProcurementEventOut,
  CitationManualProcurementExportItemOut,
  CitationManualProcurementExportResponse,
  CitationManualProcurementResponse,
  CitationProvenanceEventOut,
  CitationProvenanceLinkOut,
  CitationReviewDecisionNoteOut,
  CitationReviewDecisionRequest,
  CitationReviewEventOut,
  CitationReviewQueueCreate,
  CitationReviewQueueDetailOut,
  CitationReviewQueueItemOut,
  CitationReviewQueueResponse,
  CitationWorkReviewOut,
  DocumentCitationsResponse,
  DocumentFootnotesResponse,
  DocumentMathResponse,
  DocumentOut,
  FootnoteArtifactOut,
  FootnoteSpanOut,
  ForecastTechniqueOut,
  ForecastTechniquePackOut,
  ImportJobCreate,
  ImportJobOut,
  LoginRequest,
  LawvereCollectionMaterializeRequest,
  LawvereCollectionMaterializeResponse,
  MarketAnalysisRequest,
  MarketAnalysisResponse,
  MathFormulaLinkOut,
  MathFormulaOut,
  MathRegionOut,
  MathRetryRequest,
  MathRetryResponse,
  NoteCreate,
  NoteOut,
  OperatorActionResponse,
  OperatorRuntimeStateOut,
  OperatorRuntimeStateRequest,
  PharmaCycleRequest,
  PharmaCycleResponse,
  PharmaEventsResponse,
  PharmaHomologationsResponse,
  PharmaLeaderboardResponse,
  PharmaSyncRequest,
  PharmaSyncResponse,
  QueryRequest,
  QueryResponse,
  RegisterRequest,
  ResearchMapCreate,
  ResearchMapOut,
  ResearchMapPinCreate,
  ResearchMapPinOut,
  ResearchQueryRequest,
  ResearchQueryResponse,
  SavedQueryCreate,
  SavedQueryOut,
  SessionResponse,
  SystemProviderStatusOut,
  SystemStatusOut,
  CitationMentionOut,
  TrackedFileDetailOut,
  TrackedFileEventOut,
  TrackedFileEventsResponse,
  TrackedFileArtifactPathsResponse,
  TrackedFileOut,
  TrackedFilesResponse,
  UserOut,
  WebsiteToposMaterializeRequest,
  WebsiteToposMaterializeResponse,
  WatchFolderCreate,
  WatchFolderOut,
)


app = FastAPI(title=settings.app_name)
app.add_middleware(
  CORSMiddleware,
  allow_origins=[
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:4173",
    "http://localhost:4173",
    "http://127.0.0.1:4174",
    "http://localhost:4174",
  ],
  allow_origin_regex=r"^https?://(127\.0\.0\.1|localhost)(:\d+)?$",
  allow_credentials=True,
  allow_methods=["*"],
  allow_headers=["*"],
)

password_hasher = PasswordHasher()
engine = LibraryEngine(settings)
citation_review_service = CitationReviewService()
citation_procurement_service = CitationProcurementService()
bearer = HTTPBearer(auto_error=False)

settings.resolved_data_dir.mkdir(parents=True, exist_ok=True)
initialize_database(settings.sqlite_path)


def read_operator_runtime_state() -> dict[str, object]:
  path = settings.resolved_operator_runtime_path
  default = {
    "paused": False,
    "pause_reason": None,
    "updated_at": None,
    "source": "default",
  }
  if not path.exists():
    return default
  try:
    payload = json.loads(path.read_text(encoding="utf-8") or "{}")
  except Exception:
    return {
      **default,
      "paused": True,
      "pause_reason": "Operator runtime state file is unreadable.",
      "updated_at": datetime.now(timezone.utc).isoformat(),
      "source": str(path),
    }
  return {
    "paused": bool(payload.get("paused")),
    "pause_reason": payload.get("pause_reason"),
    "updated_at": payload.get("updated_at"),
    "source": str(path),
  }


def write_operator_runtime_state(paused: bool, pause_reason: str | None = None) -> dict[str, object]:
  path = settings.resolved_operator_runtime_path
  path.parent.mkdir(parents=True, exist_ok=True)
  payload = {
    "paused": bool(paused),
    "pause_reason": pause_reason.strip() if pause_reason else None,
    "updated_at": datetime.now(timezone.utc).isoformat(),
    "source": str(path),
  }
  path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
  return payload


def tracked_file_artifact_paths(item: dict) -> list[str]:
  paths: list[str] = []
  absolute_path = str(item.get("absolute_path") or "").strip()
  if absolute_path:
    paths.append(absolute_path)
  job_id = str(item.get("last_import_job_id") or "").strip()
  if not job_id:
    return paths
  artifact_root = settings.resolved_job_artifact_dir / job_id
  candidate_dirs = [
    artifact_root / "extracted",
    artifact_root / "ocr",
    artifact_root / "prepared",
    artifact_root / "markdown",
    artifact_root / "math",
    artifact_root / "citations",
  ]
  for candidate in candidate_dirs:
    if candidate.exists():
      paths.append(str(candidate))
  if artifact_root.exists():
    paths.append(str(artifact_root))
  # Preserve order but remove duplicates.
  return list(dict.fromkeys(paths))


def encode_session_token(session_id: str, user_id: str, expires_at: str) -> str:
  return jwt.encode(
    {"session_id": session_id, "user_id": user_id, "expires_at": expires_at},
    settings.jwt_secret,
    algorithm="HS256",
  )


def decode_session_token(token: str) -> dict[str, str]:
  return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])


def to_user_out(user: dict) -> UserOut:
  return UserOut(
    id=user["id"],
    username=user["username"],
    display_name=user["display_name"],
    role=user["role"],
    created_at=user["created_at"],
  )


def to_document_out(document: dict) -> DocumentOut:
  return DocumentOut(
    id=document["id"],
    title=document["title"],
    source_path=document["source_path"],
    file_type=document["file_type"],
    language=document["language"],
    status=document["status"],
    extraction_status=document.get("extraction_status") or "pending",
    index_status=document.get("index_status") or "pending",
    summary=document["summary"],
    page_count=int(document["page_count"]),
    node_count=int(document["node_count"]),
    warnings=repository.json_loads(document.get("warnings_json"), []),
    metadata=repository.json_loads(document.get("metadata_json"), {}),
    extraction_metadata=repository.json_loads(document.get("extraction_metadata_json"), {}),
    pipeline_version=document.get("pipeline_version"),
    last_indexed_at=document.get("last_indexed_at"),
    updated_at=document["updated_at"],
  )


def to_import_job_out(job: dict, tasks: list[dict] | None = None) -> ImportJobOut:
  task_rows = tasks or []
  state = repository.json_loads(job.get("state_json"), {})
  file_counts = state.get("file_counts") or {}
  resumable = bool(state.get("resumable")) or job.get("status") in {"queued", "running"}
  return ImportJobOut(
    id=job["id"],
    kind=job["kind"],
    source_path=job["source_path"],
    status=job["status"],
    document_count=int(job["document_count"]),
    options=repository.json_loads(job.get("options_json"), {}),
    warnings=repository.json_loads(job.get("warnings_json"), []),
    current_stage=job.get("current_stage"),
    progress_completed=int(job.get("progress_completed") or 0),
    progress_total=int(job.get("progress_total") or 0),
    file_counts={
      "discovered": int(file_counts.get("discovered", 0)),
      "processed": int(file_counts.get("processed", 0)),
      "succeeded": int(file_counts.get("succeeded", 0)),
      "failed": int(file_counts.get("failed", 0)),
      "deferred_to_ocr": int(file_counts.get("deferred_to_ocr", 0)),
    },
    current_item_name=state.get("current_item_name"),
    current_item_path=state.get("current_item_path"),
    current_item_index=int(state["current_item_index"]) if state.get("current_item_index") is not None else None,
    current_item_total=int(state["current_item_total"]) if state.get("current_item_total") is not None else None,
    resumable=resumable,
    recovered_after_restart=bool(state.get("recovered_after_restart")),
    stage_state=state.get("stage_state"),
    throughput_per_minute=float(state["throughput_per_minute"]) if state.get("throughput_per_minute") is not None else None,
    stall_minutes=float(state["stall_minutes"]) if state.get("stall_minutes") is not None else None,
    awaiting_refinement=bool(state.get("awaiting_refinement")),
    recommended_action=state.get("recommended_action"),
    next_check=state.get("next_check"),
    retry_hint=state.get("retry_hint"),
    semantic_stats=state.get("semantic_stats") or {},
    stage_warnings=repository.json_loads(job.get("stage_warnings_json"), []),
    error_code=job.get("error_code"),
    tasks=[
      {
        "id": item["id"],
        "stage": item["stage"],
        "status": item["status"],
        "progress_completed": int(item.get("progress_completed") or 0),
        "progress_total": int(item.get("progress_total") or 0),
        "warnings": repository.json_loads(item.get("warnings_json"), []),
        "error_code": item.get("error_code"),
        "payload": repository.json_loads(item.get("payload_json"), {}),
      }
      for item in task_rows
    ],
    error_text=job.get("error_text"),
    created_at=job["created_at"],
    updated_at=job["updated_at"],
    started_at=job.get("started_at"),
    finished_at=job.get("finished_at"),
  )


def to_math_region_out(region: dict | None) -> MathRegionOut | None:
  if region is None:
    return None
  return MathRegionOut(
    id=region["id"],
    artifact_id=region["artifact_id"],
    page_number=int(region.get("page_number") or 1),
    region_index=int(region.get("region_index") or 1),
    bbox=region.get("bbox"),
    image_path=region.get("image_path"),
    raw_text=region.get("raw_text") or "",
    confidence=float(region.get("confidence") or 0.0),
    status=region.get("status") or "pending",
    warnings=region.get("warnings") or [],
  )


def to_math_link_out(link: dict) -> MathFormulaLinkOut:
  return MathFormulaLinkOut(
    id=link["id"],
    formula_id=link["formula_id"],
    artifact_id=link["artifact_id"],
    region_id=link.get("region_id"),
    document_id=link["document_id"],
    node_id=link.get("node_id"),
    link_type=link.get("link_type") or "page",
    payload=link.get("payload") or repository.json_loads(link.get("payload_json"), {}),
  )


def to_math_formula_out(formula: dict) -> MathFormulaOut:
  artifact = formula.get("artifact")
  if artifact is None and formula.get("artifact_id"):
    artifact = {
      "id": formula.get("artifact_id"),
      "page_number": formula.get("page_number"),
      "extraction_mode": formula.get("extraction_mode"),
    }
  return MathFormulaOut(
    id=formula["id"],
    artifact_id=formula["artifact_id"],
    region_id=formula.get("region_id"),
    document_id=formula["document_id"],
    node_id=formula.get("node_id"),
    page_number=int(formula.get("page_number") or 1),
    label=formula.get("label") or "",
    raw_text=formula.get("raw_text") or "",
    latex=formula.get("latex"),
    confidence=float(formula.get("confidence") or 0.0),
    provider_name=formula.get("provider_name") or "",
    selected_provider=formula.get("selected_provider") or formula.get("provider_name") or "",
    model_name=formula.get("model_name"),
    extraction_mode=formula.get("extraction_mode") or "native_math",
    provider_attempts=formula.get("provider_attempts") or repository.json_loads(formula.get("provider_attempts_json"), []),
    normalized_latex=formula.get("normalized_latex"),
    mathml=formula.get("mathml"),
    handwriting_likelihood=float(formula.get("handwriting_likelihood") or 0.0),
    quality_tier=formula.get("quality_tier") or "heuristic",
    retry_state=formula.get("retry_state") or "idle",
    validation_status=formula.get("validation_status") or "pending",
    warnings=formula.get("warnings") or repository.json_loads(formula.get("warnings_json"), []),
    artifact=artifact,
    region=to_math_region_out(formula.get("region")),
    links=[to_math_link_out(item) for item in formula.get("links", [])],
  )


def to_citation_mention_out(mention: dict) -> CitationMentionOut:
  return CitationMentionOut(
    id=mention["id"],
    document_id=mention["document_id"],
    node_id=mention.get("node_id"),
    page_number=int(mention.get("page_number") or 1),
    mention_text=mention.get("mention_text") or "",
    normalized_text=mention.get("normalized_text") or "",
    mention_type=mention.get("mention_type") or "inline",
    target_label=mention.get("target_label"),
    target_year=mention.get("target_year"),
    raw_marker=mention.get("raw_marker"),
    confidence=float(mention.get("confidence") or 0.0),
    match_status=mention.get("match_status") or "unresolved",
    warnings=mention.get("warnings") or repository.json_loads(mention.get("warnings_json"), []),
  )


def to_citation_entry_out(entry: dict) -> CitationEntryOut:
  return CitationEntryOut(
    id=entry["id"],
    document_id=entry["document_id"],
    node_id=entry.get("node_id"),
    page_number=int(entry.get("page_number") or 1),
    section_label=entry.get("section_label") or "",
    raw_text=entry.get("raw_text") or "",
    normalized_text=entry.get("normalized_text") or "",
    entry_type=entry.get("entry_type") or "bibliography",
    authors=entry.get("authors") or repository.json_loads(entry.get("authors_json"), []),
    title=entry.get("title"),
    year=entry.get("year"),
    container_title=entry.get("container_title"),
    publisher=entry.get("publisher"),
    volume=entry.get("volume"),
    issue=entry.get("issue"),
    pages=entry.get("pages"),
    doi=entry.get("doi"),
    url=entry.get("url"),
    isbn=entry.get("isbn"),
    confidence=float(entry.get("confidence") or 0.0),
    parse_status=entry.get("parse_status") or "parsed",
    warnings=entry.get("warnings") or repository.json_loads(entry.get("warnings_json"), []),
    links=entry.get("links") or [],
  )


def to_footnote_span_out(span: dict) -> FootnoteSpanOut:
  return FootnoteSpanOut(
    id=span["id"],
    footnote_id=span["footnote_id"],
    span_index=int(span.get("span_index") or 1),
    span_kind=span.get("span_kind") or "unknown",
    text=span.get("text") or "",
    normalized_text=span.get("normalized_text") or "",
    confidence=float(span.get("confidence") or 0.0),
    citation_entry_id=span.get("citation_entry_id"),
    citation_mention_id=span.get("citation_mention_id"),
  )


def to_footnote_artifact_out(footnote: dict) -> FootnoteArtifactOut:
  return FootnoteArtifactOut(
    id=footnote["id"],
    document_id=footnote["document_id"],
    node_id=footnote.get("node_id"),
    page_number=int(footnote.get("page_number") or 1),
    note_label=footnote.get("note_label") or "",
    raw_text=footnote.get("raw_text") or "",
    normalized_text=footnote.get("normalized_text") or "",
    kind=footnote.get("kind") or "mixed",
    confidence=float(footnote.get("confidence") or 0.0),
    citations_detected=int(footnote.get("citations_detected") or 0),
    commentary_detected=int(footnote.get("commentary_detected") or 0),
    warnings=footnote.get("warnings") or repository.json_loads(footnote.get("warnings_json"), []),
    spans=[to_footnote_span_out(item) for item in footnote.get("spans", [])],
  )


def to_citation_review_decision_note_out(note: dict) -> CitationReviewDecisionNoteOut:
  return CitationReviewDecisionNoteOut(
    acted_at=note.get("acted_at") or "",
    actor_user_id=note.get("actor_user_id"),
    action=note.get("action") or "noted",
    note=note.get("note"),
  )


def to_citation_work_review_out(work: dict | None) -> CitationWorkReviewOut | None:
  if work is None:
    return None
  return CitationWorkReviewOut(
    id=work["id"],
    preferred_title=work["preferred_title"],
    subtitle=work.get("subtitle"),
    work_type=work.get("work_type") or "unknown",
    canonical_author_string=work.get("canonical_author_string"),
    original_year=work.get("original_year"),
    language=work.get("language"),
    work_status=work.get("work_status") or "canonical",
    cluster_confidence=float(work.get("cluster_confidence") or 0.0),
    summary_text=work.get("summary_text"),
    semantic_status=work.get("semantic_status") or "pending",
    graph_status=work.get("graph_status") or "pending",
    metadata=work.get("metadata") or {},
    created_at=work["created_at"],
    updated_at=work["updated_at"],
    superseded_by_work_id=work.get("superseded_by_work_id"),
  )


def to_citation_edition_review_out(edition: dict | None) -> CitationEditionReviewOut | None:
  if edition is None:
    return None
  return CitationEditionReviewOut(
    id=edition["id"],
    work_id=edition["work_id"],
    edition_status=edition.get("edition_status") or "candidate",
    preferred_title=edition.get("preferred_title"),
    format_hint=edition.get("format_hint"),
    publisher=edition.get("publisher"),
    place_of_publication=edition.get("place_of_publication"),
    publication_year=edition.get("publication_year"),
    edition_statement=edition.get("edition_statement"),
    volume=edition.get("volume"),
    issue=edition.get("issue"),
    language=edition.get("language"),
    page_count=int(edition["page_count"]) if edition.get("page_count") is not None else None,
    cluster_confidence=float(edition.get("cluster_confidence") or 0.0),
    metadata=edition.get("metadata") or {},
    created_at=edition["created_at"],
    updated_at=edition["updated_at"],
    superseded_by_edition_id=edition.get("superseded_by_edition_id"),
  )


def to_citation_manifestation_review_out(manifestation: dict) -> CitationManifestationReviewOut:
  return CitationManifestationReviewOut(
    id=manifestation["id"],
    edition_id=manifestation["edition_id"],
    source_candidate_id=manifestation.get("source_candidate_id"),
    manifestation_type=manifestation.get("manifestation_type") or "digital_file",
    media_type=manifestation.get("media_type"),
    file_format=manifestation.get("file_format"),
    storage_uri=manifestation.get("storage_uri"),
    local_path=manifestation.get("local_path"),
    checksum_sha256=manifestation.get("checksum_sha256"),
    size_bytes=int(manifestation["size_bytes"]) if manifestation.get("size_bytes") is not None else None,
    page_count=int(manifestation["page_count"]) if manifestation.get("page_count") is not None else None,
    source_provider=manifestation.get("source_provider"),
    source_url=manifestation.get("source_url"),
    acquisition_status=manifestation.get("acquisition_status") or "planned",
    ocr_status=manifestation.get("ocr_status") or "pending",
    text_extraction_status=manifestation.get("text_extraction_status") or "pending",
    embedding_status=manifestation.get("embedding_status") or "pending",
    graph_enrichment_status=manifestation.get("graph_enrichment_status") or "pending",
    metadata=manifestation.get("metadata") or {},
    created_at=manifestation["created_at"],
    updated_at=manifestation["updated_at"],
  )


def to_citation_candidate_review_out(candidate: dict | None) -> CitationAcquisitionCandidateReviewOut | None:
  if candidate is None:
    return None
  metadata = candidate.get("metadata") or {}
  return CitationAcquisitionCandidateReviewOut(
    id=candidate["id"],
    lookup_job_id=candidate["lookup_job_id"],
    work_id=candidate["work_id"],
    edition_id=candidate.get("edition_id"),
    provider=candidate["provider"],
    provider_record_id=candidate["provider_record_id"],
    candidate_status=candidate.get("candidate_status") or "candidate",
    title=candidate.get("title"),
    author_string=candidate.get("author_string"),
    publication_year=candidate.get("publication_year"),
    publisher=candidate.get("publisher"),
    language=candidate.get("language"),
    file_format=candidate.get("file_format"),
    file_size_bytes=int(candidate["file_size_bytes"]) if candidate.get("file_size_bytes") is not None else None,
    page_count=int(candidate["page_count"]) if candidate.get("page_count") is not None else None,
    match_confidence=float(candidate.get("match_confidence") or 0.0),
    normalized_score=float(metadata.get("normalized_score") or metadata.get("candidate_score") or candidate.get("match_confidence") or 0.0),
    availability_status=candidate.get("availability_status") or "unknown",
    source_url=candidate.get("source_url"),
    preview_url=candidate.get("preview_url"),
    download_url=candidate.get("download_url"),
    access_notes=candidate.get("access_notes"),
    risk_flags=list(metadata.get("risk_flags") or []),
    raw_payload=candidate.get("raw_payload") or {},
    metadata=metadata,
    created_at=candidate["created_at"],
    updated_at=candidate["updated_at"],
  )


def to_citation_provenance_link_out(link: dict) -> CitationProvenanceLinkOut:
  return CitationProvenanceLinkOut(
    resolution_link_id=link["resolution_link_id"],
    resolution_status=link.get("resolution_status") or "proposed",
    resolution_confidence=float(link.get("resolution_confidence") or 0.0),
    normalized_record_id=link["normalized_record_id"],
    title=link.get("title"),
    author_string=link.get("author_string"),
    year=link.get("year"),
    parse_confidence=float(link.get("parse_confidence") or 0.0),
    observation_id=link["observation_id"],
    source_system=link.get("source_system") or "",
    source_record_type=link.get("source_record_type"),
    source_record_id=link.get("source_record_id"),
    source_document_id=link.get("source_document_id"),
    source_url=link.get("source_url"),
    source_locator=link.get("source_locator"),
    raw_citation_text=link.get("raw_citation_text") or "",
    raw_context_text=link.get("raw_context_text"),
    provenance=link.get("provenance") or {},
  )


def to_citation_review_event_out(event: dict) -> CitationReviewEventOut:
  return CitationReviewEventOut(
    id=event["id"],
    approval_queue_id=event["approval_queue_id"],
    actor_user_id=event.get("actor_user_id"),
    action=event.get("action") or "",
    from_status=event.get("from_status"),
    to_status=event.get("to_status"),
    event_notes=event.get("event_notes"),
    payload=event.get("payload") or {},
    created_at=event["created_at"],
  )


def to_citation_provenance_event_out(event: dict) -> CitationProvenanceEventOut:
  return CitationProvenanceEventOut(
    id=event["id"],
    entity_type=event["entity_type"],
    entity_id=event["entity_id"],
    event_type=event["event_type"],
    source_system=event.get("source_system"),
    source_record_type=event.get("source_record_type"),
    source_record_id=event.get("source_record_id"),
    processing_run_id=event.get("processing_run_id"),
    approval_queue_id=event.get("approval_queue_id"),
    actor_user_id=event.get("actor_user_id"),
    event_summary=event.get("event_summary"),
    payload=event.get("payload") or {},
    created_at=event["created_at"],
  )


def to_citation_review_queue_item_out(item: dict) -> CitationReviewQueueItemOut:
  return CitationReviewQueueItemOut(
    id=item["id"],
    queue_type=item.get("queue_type") or "",
    status=item.get("status") or "pending",
    priority=int(item.get("priority") or 100),
    summary_text=item.get("summary_text") or "",
    normalized_record_id=item.get("normalized_record_id"),
    resolution_link_id=item.get("resolution_link_id"),
    work_id=item.get("work_id"),
    edition_id=item.get("edition_id"),
    manifestation_id=item.get("manifestation_id"),
    acquisition_candidate_id=item.get("acquisition_candidate_id"),
    requested_by_user_id=item.get("requested_by_user_id"),
    assigned_to_user_id=item.get("assigned_to_user_id"),
    due_at=item.get("due_at"),
    resolved_at=item.get("resolved_at"),
    decision_notes=[to_citation_review_decision_note_out(note) for note in item.get("decision_notes", [])],
    metadata=item.get("metadata") or {},
    created_at=item["created_at"],
    updated_at=item["updated_at"],
    work_title=item.get("work_title"),
    work_status=item.get("work_status"),
    candidate_title=item.get("candidate_title"),
    candidate_provider=item.get("candidate_provider"),
    candidate_score=float(item["candidate_score"]) if item.get("candidate_score") is not None else None,
  )


def to_citation_download_job_out(job: dict) -> CitationDownloadJobOut:
  return CitationDownloadJobOut(
    id=job["id"],
    acquisition_candidate_id=job["acquisition_candidate_id"],
    approval_queue_id=job.get("approval_queue_id"),
    manifestation_id=job.get("manifestation_id"),
    requested_by_user_id=job.get("requested_by_user_id"),
    approved_by_user_id=job.get("approved_by_user_id"),
    status=job.get("status") or "planned",
    download_policy=job.get("download_policy") or "manual_only",
    retry_count=int(job.get("retry_count") or 0),
    last_attempt_at=job.get("last_attempt_at"),
    started_at=job.get("started_at"),
    finished_at=job.get("finished_at"),
    output_uri=job.get("output_uri"),
    checksum_sha256=job.get("checksum_sha256"),
    error_text=job.get("error_text"),
    metadata=job.get("metadata") or {},
    created_at=job["created_at"],
    updated_at=job["updated_at"],
    candidate_title=job.get("candidate_title"),
    candidate_provider=job.get("candidate_provider"),
  )


def to_citation_manual_procurement_item_out(item: dict) -> CitationManualProcurementItemOut:
  return CitationManualProcurementItemOut(
    id=item["id"],
    work_id=item["work_id"],
    edition_id=item.get("edition_id"),
    approval_queue_id=item.get("approval_queue_id"),
    owner_user_id=item.get("owner_user_id"),
    requested_by_user_id=item.get("requested_by_user_id"),
    status=item.get("status") or "queued",
    reason_code=item.get("reason_code") or "",
    priority=int(item.get("priority") or 100),
    vendor_hint=item.get("vendor_hint"),
    estimated_cost_cents=int(item["estimated_cost_cents"]) if item.get("estimated_cost_cents") is not None else None,
    due_at=item.get("due_at"),
    notes=list(item.get("notes") or []),
    canonical_snapshot=item.get("canonical_snapshot") or {},
    unresolved_reasons=list(item.get("unresolved_reasons") or []),
    suggested_identifiers=list(item.get("suggested_identifiers") or []),
    provenance_snapshot=list(item.get("provenance_snapshot") or []),
    future_workflow=item.get("future_workflow") or {},
    metadata=item.get("metadata") or {},
    created_at=item["created_at"],
    updated_at=item["updated_at"],
    resolved_at=item.get("resolved_at"),
    work_title=item.get("work_title"),
  )


def to_citation_manual_procurement_event_out(event: dict) -> CitationManualProcurementEventOut:
  return CitationManualProcurementEventOut(
    id=event["id"],
    procurement_queue_id=event["procurement_queue_id"],
    actor_user_id=event.get("actor_user_id"),
    action=event.get("action") or "",
    from_status=event.get("from_status"),
    to_status=event.get("to_status"),
    note_text=event.get("note_text"),
    payload=event.get("payload") or {},
    created_at=event["created_at"],
  )


def to_citation_manual_procurement_detail_out(detail: dict) -> CitationManualProcurementDetailOut:
  return CitationManualProcurementDetailOut(
    item=to_citation_manual_procurement_item_out(detail["item"]),
    work=to_citation_work_review_out(detail.get("work")),
    edition=to_citation_edition_review_out(detail.get("edition")),
    provenance_links=[to_citation_provenance_link_out(item) for item in detail.get("provenance_links", [])],
    events=[to_citation_manual_procurement_event_out(item) for item in detail.get("events", [])],
  )


def to_citation_review_queue_detail_out(detail: dict) -> CitationReviewQueueDetailOut:
  return CitationReviewQueueDetailOut(
    item=to_citation_review_queue_item_out(detail["item"]),
    work=to_citation_work_review_out(detail.get("work")),
    edition=to_citation_edition_review_out(detail.get("edition")),
    candidate=to_citation_candidate_review_out(detail.get("candidate")),
    editions=[to_citation_edition_review_out(item) for item in detail.get("editions", []) if item],
    candidates=[to_citation_candidate_review_out(item) for item in detail.get("candidates", []) if item],
    manifestations=[to_citation_manifestation_review_out(item) for item in detail.get("manifestations", [])],
    provenance_links=[to_citation_provenance_link_out(item) for item in detail.get("provenance_links", [])],
    events=[to_citation_review_event_out(item) for item in detail.get("events", [])],
    work_events=[to_citation_provenance_event_out(item) for item in detail.get("work_events", [])],
    candidate_events=[to_citation_provenance_event_out(item) for item in detail.get("candidate_events", [])],
    download_jobs=[to_citation_download_job_out(item) for item in detail.get("download_jobs", [])],
    manual_procurement_items=[to_citation_manual_procurement_item_out(item) for item in detail.get("manual_procurement_items", [])],
  )


def to_forecast_technique_out(technique: dict) -> ForecastTechniqueOut:
  return ForecastTechniqueOut(**technique)


def to_watch_folder_out(folder: dict) -> WatchFolderOut:
  return WatchFolderOut(
    id=folder["id"],
    path=folder["path"],
    enabled=bool(folder["enabled"]),
    recursive=bool(folder["recursive"]),
    include_extensions=repository.json_loads(folder.get("include_extensions_json"), []),
    exclude_globs=repository.json_loads(folder.get("exclude_globs_json"), []),
    created_at=folder["created_at"],
    updated_at=folder["updated_at"],
    last_scanned_at=folder.get("last_scanned_at"),
    last_scan_started_at=folder.get("last_scan_started_at"),
    last_scan_finished_at=folder.get("last_scan_finished_at"),
    files_seen=int(folder.get("files_seen") or 0),
    files_added=int(folder.get("files_added") or 0),
    files_changed=int(folder.get("files_changed") or 0),
    files_deleted=int(folder.get("files_deleted") or 0),
    scan_errors=int(folder.get("scan_errors") or 0),
    watch_backend=str(folder.get("watch_backend") or "polling"),
    last_event_at=folder.get("last_event_at"),
    last_event_summary=repository.json_loads(folder.get("last_event_summary_json"), {}),
  )


def to_tracked_file_event_out(event: dict) -> TrackedFileEventOut:
  return TrackedFileEventOut(
    id=event["id"],
    tracked_file_id=event["tracked_file_id"],
    import_job_id=event.get("import_job_id"),
    stage=event["stage"],
    status=event["status"],
    message=event.get("message"),
    payload_json=repository.json_loads(event.get("payload_json"), {}),
    created_at=event["created_at"],
    updated_at=event["updated_at"],
  )


def to_tracked_file_out(item: dict) -> TrackedFileOut:
  return TrackedFileOut(
    id=item["id"],
    root_watch_folder_id=item.get("root_watch_folder_id"),
    absolute_path=item["absolute_path"],
    relative_path=item.get("relative_path") or "",
    extension=item.get("extension") or "",
    size_bytes=int(item.get("size_bytes") or 0),
    mtime=item.get("mtime"),
    checksum_sha1=item.get("checksum_sha1"),
    discovered_at=item["discovered_at"],
    last_seen_at=item["last_seen_at"],
    last_import_job_id=item.get("last_import_job_id"),
    extraction_status=item.get("extraction_status") or "pending",
    ocr_status=item.get("ocr_status") or "pending",
    chunk_status=item.get("chunk_status") or "pending",
    embedding_status=item.get("embedding_status") or "pending",
    index_status=item.get("index_status") or "pending",
    overall_status=item.get("overall_status") or "discovered",
    stale=bool(item.get("stale")),
    error_message=item.get("error_message"),
    metadata_json=repository.json_loads(item.get("metadata_json"), {}),
    created_at=item["created_at"],
    updated_at=item["updated_at"],
  )


def to_research_map_out(item: dict, pin_count: int = 0) -> ResearchMapOut:
  return ResearchMapOut(
    id=item["id"],
    title=item["title"],
    description=item["description"],
    bundle_id=item.get("bundle_id"),
    source_kind=item.get("source_kind"),
    source_ref=item.get("source_ref"),
    layout=repository.json_loads(item.get("layout_json"), {}),
    pin_count=pin_count,
    created_at=item["created_at"],
    updated_at=item["updated_at"],
  )


def to_activity_signal_out(signal: dict) -> ActivitySignalOut:
  git_export = signal.get("git_export")
  return ActivitySignalOut(
    id=signal["id"],
    source_module=signal["source_module"],
    source_kind=signal["source_kind"],
    entity_id=signal.get("entity_id"),
    title=signal["title"],
    summary=signal.get("summary") or "",
    severity=signal.get("severity") or "info",
    visibility=signal.get("visibility") or "public",
    signal_state=signal.get("signal_state") or "active",
    review_state=signal.get("review_state") or "pending",
    note=signal.get("note") or "",
    snooze_until=signal.get("snooze_until"),
    created_at=signal["created_at"],
    updated_at=signal["updated_at"],
    payload=signal.get("payload") or repository.json_loads(signal.get("payload_json"), {}),
    git_export=git_export,
  )


def to_activity_review_out(review: dict) -> ActivityReviewOut:
  return ActivityReviewOut(
    id=review["id"],
    signal_id=review["signal_id"],
    action=review["action"],
    review_state=review["review_state"],
    visibility=review["visibility"],
    note=review.get("note") or "",
    snooze_until=review.get("snooze_until"),
    created_at=review["created_at"],
    payload=review.get("payload") or repository.json_loads(review.get("payload_json"), {}),
  )


def to_activity_git_profile_out(profile: dict | None) -> ActivityGitProfileOut | None:
  if profile is None:
    return None
  return ActivityGitProfileOut(
    repo_path=profile["repo_path"],
    export_subdir=profile.get("export_subdir") or "activity-exports",
    branch_name=profile.get("branch_name"),
    valid=bool(profile.get("valid")),
    last_validated_at=profile.get("last_validated_at"),
    last_error=profile.get("last_error"),
    created_at=profile["created_at"],
    updated_at=profile["updated_at"],
  )


def to_activity_private_export_out(item: dict) -> ActivityPrivateExportOut:
  return ActivityPrivateExportOut(
    id=item["id"],
    signal_id=item["signal_id"],
    status=item["status"],
    visibility=item.get("visibility") or "private",
    file_relpath=item.get("file_relpath"),
    commit_hash=item.get("commit_hash"),
    error_text=item.get("error_text"),
    content=item.get("content") or repository.json_loads(item.get("content_json"), {}),
    created_at=item["created_at"],
    updated_at=item["updated_at"],
    committed_at=item.get("committed_at"),
  )


def get_current_user(request: Request, credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)] = None) -> dict:
  token = credentials.credentials if credentials else request.cookies.get(settings.session_cookie_name)
  if token is None:
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing session token.")
  try:
    payload = decode_session_token(token)
  except jwt.InvalidTokenError as error:
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session token.") from error
  expires_at = datetime.fromisoformat(payload["expires_at"])
  if expires_at <= datetime.now(timezone.utc):
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session has expired.")
  with database_session(settings.sqlite_path) as connection:
    session_row = repository.get_session(connection, payload["session_id"])
    if session_row is None:
      raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session was not found.")
    user = repository.get_user_by_id(connection, session_row["user_id"])
    if user is None:
      raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User was not found.")
    return user


def ensure_default_local_account(connection) -> None:
  if not settings.default_account_enabled:
    return
  existing = repository.get_user_by_username(connection, settings.default_local_username)
  if existing is not None:
    return
  repository.create_user(
    connection,
    settings.default_local_username,
    settings.default_local_display_name,
    password_hasher.hash(settings.default_local_password),
    role="admin",
  )


@app.on_event("startup")
def startup_event() -> None:
  settings.resolved_data_dir.mkdir(parents=True, exist_ok=True)
  settings.resolved_model_cache_dir.mkdir(parents=True, exist_ok=True)
  settings.resolved_job_artifact_dir.mkdir(parents=True, exist_ok=True)
  initialize_database(settings.sqlite_path)
  with database_session(settings.sqlite_path) as connection:
    ensure_default_local_account(connection)
    if settings.demo_seed_enabled:
      engine.seed_if_empty(connection)


def sync_library_activity_signals(connection, user_id: str) -> list[dict]:
  runtime_signals = activity.build_library_runtime_signals(connection, engine)
  active_ids = set()
  for signal in runtime_signals:
    repository.upsert_activity_signal(connection, user_id, signal, origin="derived:library")
    active_ids.add(signal["id"])
  repository.resolve_missing_activity_signals(connection, user_id, "derived:library", active_ids)
  return repository.list_activity_signals(connection, user_id)


@app.get("/api/health")
def healthcheck() -> dict[str, str]:
  return {"status": "ok"}


@app.get("/api/system/status", response_model=SystemStatusOut)
def system_status():
  with database_session(settings.sqlite_path) as connection:
    payload = engine.system_status(connection)
  return SystemStatusOut(
    runtime_mode=payload["runtime_mode"],
    dev_fallbacks_enabled=payload["dev_fallbacks_enabled"],
    pipeline_version=payload["pipeline_version"],
    qdrant=payload["qdrant"],
    providers={key: SystemProviderStatusOut(**value) for key, value in payload["providers"].items()},
    import_runtime=payload.get("import_runtime", {}),
    query_runtime=payload.get("query_runtime", {}),
    jobs=payload["jobs"],
    watch_folders=payload["watch_folders"],
    profiling=payload.get("profiling", {}),
  )


@app.get("/api/activity/signals", response_model=ActivitySignalsResponse)
def list_activity_signals(current_user: Annotated[dict, Depends(get_current_user)]):
  with database_session(settings.sqlite_path) as connection:
    items = [to_activity_signal_out(item) for item in sync_library_activity_signals(connection, current_user["id"])]
  return ActivitySignalsResponse(items=items, mode="live")


@app.post("/api/activity/signals/sync", response_model=ActivitySignalsResponse)
def sync_activity_signals(payload: ActivitySignalSyncRequest, current_user: Annotated[dict, Depends(get_current_user)]):
  with database_session(settings.sqlite_path) as connection:
    for item in payload.items:
      repository.upsert_activity_signal(
        connection,
        current_user["id"],
        item.model_dump(),
        origin=f"synced:{item.source_module}",
        allow_review_overrides=False,
      )
    items = [to_activity_signal_out(item) for item in sync_library_activity_signals(connection, current_user["id"])]
  return ActivitySignalsResponse(items=items, mode="live")


@app.post("/api/activity/reviews/{signal_id}")
def review_activity_signal(signal_id: str, payload: ActivityReviewRequest, current_user: Annotated[dict, Depends(get_current_user)]):
  with database_session(settings.sqlite_path) as connection:
    sync_library_activity_signals(connection, current_user["id"])
    signal = repository.get_activity_signal(connection, current_user["id"], signal_id)
    if signal is None:
      raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Activity signal not found.")

    updated_signal = repository.upsert_activity_signal(
      connection,
      current_user["id"],
      {
        "id": signal_id,
        "source_module": signal["source_module"],
        "source_kind": signal["source_kind"],
        "entity_id": signal.get("entity_id"),
        "title": signal["title"],
        "summary": signal["summary"],
        "severity": signal["severity"],
        "signal_state": signal["signal_state"],
        "visibility": payload.visibility,
        "review_state": payload.review_state,
        "note": payload.note,
        "snooze_until": payload.snooze_until,
        "payload": repository.json_loads(signal.get("payload_json"), {}),
      },
      origin=signal.get("origin") or "derived",
      allow_review_overrides=True,
    )
    review = repository.create_activity_review(
      connection,
      current_user["id"],
      signal_id,
      action=payload.action,
      review_state=payload.review_state,
      visibility=payload.visibility,
      note=payload.note,
      snooze_until=payload.snooze_until,
      payload=payload.payload,
    )

    export_item = None
    if payload.visibility == "private":
      export_payload = {
        "signal": {
          "id": updated_signal["id"],
          "source_module": updated_signal["source_module"],
          "source_kind": updated_signal["source_kind"],
          "entity_id": updated_signal.get("entity_id"),
          "title": updated_signal["title"],
          "summary": updated_signal.get("summary") or "",
          "severity": updated_signal.get("severity") or "info",
          "signal_state": updated_signal.get("signal_state") or "active",
          "review_state": payload.review_state,
          "visibility": payload.visibility,
          "note": payload.note,
          "snooze_until": payload.snooze_until,
          "payload": repository.json_loads(updated_signal.get("payload_json"), {}),
          "updated_at": updated_signal["updated_at"],
        },
        "review": {
          "id": review["id"],
          "action": payload.action,
          "review_state": payload.review_state,
          "visibility": payload.visibility,
          "note": payload.note,
          "snooze_until": payload.snooze_until,
          "created_at": review["created_at"],
          "payload": payload.payload,
        },
      }
      export_item = repository.create_activity_private_export(
        connection,
        current_user["id"],
        signal_id,
        review_id=review["id"],
        visibility=payload.visibility,
        content=export_payload,
      )

    signal_with_export = next(
      (item for item in repository.list_activity_signals(connection, current_user["id"]) if item["id"] == signal_id),
      updated_signal,
    )

  return {
    "signal": to_activity_signal_out(signal_with_export),
    "review": to_activity_review_out({**review, "payload": payload.payload}),
    "export": to_activity_private_export_out(export_item) if export_item else None,
  }


@app.get("/api/activity/review-history/{signal_id}", response_model=ActivityReviewHistoryResponse)
def activity_review_history(signal_id: str, current_user: Annotated[dict, Depends(get_current_user)]):
  with database_session(settings.sqlite_path) as connection:
    items = [to_activity_review_out(item) for item in repository.list_activity_reviews(connection, current_user["id"], signal_id)]
  return ActivityReviewHistoryResponse(items=items)


@app.get("/api/activity/git/profile", response_model=ActivityGitProfileResponse)
def get_activity_git_profile(current_user: Annotated[dict, Depends(get_current_user)]):
  with database_session(settings.sqlite_path) as connection:
    profile = repository.get_activity_git_profile(connection, current_user["id"])
  return ActivityGitProfileResponse(item=to_activity_git_profile_out(profile))


@app.post("/api/activity/git/profile", response_model=ActivityGitProfileOut)
def set_activity_git_profile(payload: ActivityGitProfileRequest, current_user: Annotated[dict, Depends(get_current_user)]):
  with database_session(settings.sqlite_path) as connection:
    profile = repository.upsert_activity_git_profile(
      connection,
      current_user["id"],
      repo_path=payload.repo_path,
      export_subdir=payload.export_subdir,
      branch_name=payload.branch_name,
      valid=payload.valid,
      last_validated_at=payload.last_validated_at,
      last_error=payload.last_error,
    )
  return to_activity_git_profile_out(profile)


@app.get("/api/activity/git/exports", response_model=ActivityGitExportsResponse)
def list_activity_git_exports(current_user: Annotated[dict, Depends(get_current_user)], status_filter: str | None = None):
  with database_session(settings.sqlite_path) as connection:
    items = [
      to_activity_private_export_out(item)
      for item in repository.list_activity_private_exports(connection, current_user["id"], status=status_filter)
    ]
  return ActivityGitExportsResponse(items=items)


@app.post("/api/activity/git/exports/{export_id}/complete", response_model=ActivityPrivateExportOut)
def complete_activity_git_export(
  export_id: str,
  payload: ActivityExportCommitRequest,
  current_user: Annotated[dict, Depends(get_current_user)],
):
  with database_session(settings.sqlite_path) as connection:
    item = repository.get_activity_private_export(connection, current_user["id"], export_id)
    if item is None:
      raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Activity export not found.")
    repository.update_activity_private_export(
      connection,
      current_user["id"],
      export_id,
      status="committed",
      commit_hash=payload.commit_hash,
      file_relpath=payload.file_relpath,
      error_text=None,
      committed_at=datetime.now(timezone.utc).isoformat(),
    )
    updated = repository.get_activity_private_export(connection, current_user["id"], export_id)
  return to_activity_private_export_out(updated)


@app.post("/api/activity/git/exports/{export_id}/fail", response_model=ActivityPrivateExportOut)
def fail_activity_git_export(
  export_id: str,
  payload: ActivityExportFailureRequest,
  current_user: Annotated[dict, Depends(get_current_user)],
):
  with database_session(settings.sqlite_path) as connection:
    item = repository.get_activity_private_export(connection, current_user["id"], export_id)
    if item is None:
      raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Activity export not found.")
    repository.update_activity_private_export(
      connection,
      current_user["id"],
      export_id,
      status="failed",
      error_text=payload.error_text,
    )
    updated = repository.get_activity_private_export(connection, current_user["id"], export_id)
  return to_activity_private_export_out(updated)


@app.get("/api/auth/session", response_model=SessionResponse)
def get_session(current_user: Annotated[dict, Depends(get_current_user)]):
  return SessionResponse(user=to_user_out(current_user), mode="live")


@app.post("/api/auth/register", response_model=SessionResponse)
def register_account(payload: RegisterRequest, response: Response):
  with database_session(settings.sqlite_path) as connection:
    existing = repository.get_user_by_username(connection, payload.username)
    if existing is not None:
      raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already exists.")
    role = "admin" if repository.count_users(connection) == 0 else "user"
    user = repository.create_user(connection, payload.username, payload.display_name, password_hasher.hash(payload.password), role=role)
    expires_at = (datetime.now(timezone.utc) + timedelta(hours=settings.session_ttl_hours)).isoformat()
    session = repository.create_session(connection, user["id"], expires_at)
    token = encode_session_token(session["id"], user["id"], expires_at)
    response.set_cookie(settings.session_cookie_name, token, httponly=True, samesite="lax")
    response.headers["Authorization"] = f"Bearer {token}"
    return SessionResponse(user=to_user_out(user), mode="live")


@app.post("/api/auth/login", response_model=SessionResponse)
def login_account(payload: LoginRequest, response: Response):
  with database_session(settings.sqlite_path) as connection:
    user = repository.get_user_by_username(connection, payload.username)
    if user is None:
      raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials.")
    try:
      password_hasher.verify(user["password_hash"], payload.password)
    except Exception as error:  # pragma: no cover - argon2 internals
      raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials.") from error
    expires_at = (datetime.now(timezone.utc) + timedelta(hours=settings.session_ttl_hours)).isoformat()
    session = repository.create_session(connection, user["id"], expires_at)
    token = encode_session_token(session["id"], user["id"], expires_at)
    response.set_cookie(settings.session_cookie_name, token, httponly=True, samesite="lax")
    response.headers["Authorization"] = f"Bearer {token}"
    return SessionResponse(user=to_user_out(user), mode="live")


@app.post("/api/auth/logout")
def logout_account(response: Response, current_user: Annotated[dict, Depends(get_current_user)], credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)] = None):
  if credentials:
    try:
      payload = decode_session_token(credentials.credentials)
      with database_session(settings.sqlite_path) as connection:
        repository.delete_session(connection, payload["session_id"])
    except jwt.InvalidTokenError:
      pass
  response.delete_cookie(settings.session_cookie_name)
  return {"ok": True, "user_id": current_user["id"]}


@app.get("/api/documents")
def list_documents(current_user: Annotated[dict, Depends(get_current_user)]):
  with database_session(settings.sqlite_path) as connection:
    documents = [to_document_out(document) for document in repository.list_documents(connection)]
  return {"items": documents}


@app.get("/api/documents/{document_id}/math", response_model=DocumentMathResponse)
def get_document_math(document_id: str, current_user: Annotated[dict, Depends(get_current_user)]):
  with database_session(settings.sqlite_path) as connection:
    document = repository.get_document_by_id(connection, document_id)
    if document is None:
      raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")
    items = [to_math_formula_out(item) for item in repository.list_document_math_formulae(connection, document_id)]
    summary = repository.math_summary_for_document(connection, document_id)
  return DocumentMathResponse(document_id=document_id, items=items, summary=summary)


@app.get("/api/math/{formula_id}", response_model=MathFormulaOut)
def get_math_formula(formula_id: str, current_user: Annotated[dict, Depends(get_current_user)]):
  with database_session(settings.sqlite_path) as connection:
    payload = repository.get_math_formula(connection, formula_id)
  if payload is None:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Math formula not found.")
  return to_math_formula_out(payload)


@app.post("/api/math/retry", response_model=MathRetryResponse)
def retry_math_formulae(payload: MathRetryRequest, current_user: Annotated[dict, Depends(get_current_user)]):
  with database_session(settings.sqlite_path) as connection:
    requested = len({item for item in payload.formula_ids if item})
    if payload.document_id and requested == 0:
      requested = repository.math_summary_for_document(connection, payload.document_id)["formula_count"]
    updated = repository.queue_math_formula_retry(
      connection,
      formula_ids=payload.formula_ids,
      document_id=payload.document_id,
    )
  return MathRetryResponse(ok=True, requested=requested, updated=updated)


@app.get("/api/documents/{document_id}/citations", response_model=DocumentCitationsResponse)
def get_document_citations(document_id: str, current_user: Annotated[dict, Depends(get_current_user)]):
  with database_session(settings.sqlite_path) as connection:
    document = repository.get_document_by_id(connection, document_id)
    if document is None:
      raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")
    items = [to_citation_entry_out(item) for item in repository.list_document_citation_entries(connection, document_id)]
    mentions = [to_citation_mention_out(item) for item in repository.list_document_citation_mentions(connection, document_id)]
    summary = repository.citation_summary_for_document(connection, document_id)
  return DocumentCitationsResponse(document_id=document_id, items=items, mentions=mentions, summary=summary)


@app.get("/api/documents/{document_id}/footnotes", response_model=DocumentFootnotesResponse)
def get_document_footnotes(document_id: str, current_user: Annotated[dict, Depends(get_current_user)]):
  with database_session(settings.sqlite_path) as connection:
    document = repository.get_document_by_id(connection, document_id)
    if document is None:
      raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")
    items = [to_footnote_artifact_out(item) for item in repository.list_document_footnotes(connection, document_id)]
    summary = repository.citation_summary_for_document(connection, document_id)
  return DocumentFootnotesResponse(document_id=document_id, items=items, summary=summary)


@app.get("/api/citations/review-queue", response_model=CitationReviewQueueResponse)
def list_citation_review_queue(
  current_user: Annotated[dict, Depends(get_current_user)],
  status_filter: str | None = None,
  work_id: str | None = None,
  limit: int = 200,
):
  with database_session(settings.sqlite_path) as connection:
    items = citation_review_repo.list_review_queue(
      connection,
      status_filter=status_filter,
      work_id=work_id,
      limit=limit,
    )
  return CitationReviewQueueResponse(items=[to_citation_review_queue_item_out(item) for item in items])


@app.post("/api/citations/review-queue", response_model=CitationReviewQueueDetailOut)
def create_citation_review_queue_item(
  payload: CitationReviewQueueCreate,
  current_user: Annotated[dict, Depends(get_current_user)],
):
  try:
    with database_session(settings.sqlite_path) as connection:
      detail = citation_review_service.create_review_item(
        connection,
        queue_type=payload.queue_type,
        summary_text=payload.summary_text,
        requested_by_user_id=current_user["id"],
        normalized_record_id=payload.normalized_record_id,
        resolution_link_id=payload.resolution_link_id,
        work_id=payload.work_id,
        edition_id=payload.edition_id,
        manifestation_id=payload.manifestation_id,
        acquisition_candidate_id=payload.acquisition_candidate_id,
        assigned_to_user_id=payload.assigned_to_user_id,
        priority=payload.priority,
        due_at=payload.due_at,
        metadata=payload.metadata,
      )
  except CitationReviewError as error:
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error
  return to_citation_review_queue_detail_out(detail)


@app.get("/api/citations/review-queue/{review_id}", response_model=CitationReviewQueueDetailOut)
def get_citation_review_queue_item(review_id: str, current_user: Annotated[dict, Depends(get_current_user)]):
  try:
    with database_session(settings.sqlite_path) as connection:
      detail = citation_review_service.build_review_detail(connection, review_id)
  except CitationReviewError as error:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
  return to_citation_review_queue_detail_out(detail)


@app.post("/api/citations/review-queue/{review_id}/decision", response_model=CitationReviewQueueDetailOut)
def apply_citation_review_decision(
  review_id: str,
  payload: CitationReviewDecisionRequest,
  current_user: Annotated[dict, Depends(get_current_user)],
):
  try:
    with database_session(settings.sqlite_path) as connection:
      detail = citation_review_service.apply_decision(
        connection,
        review_id=review_id,
        actor_user_id=current_user["id"],
        action=payload.action,
        note=payload.note,
        payload=payload.payload,
      )
  except CitationReviewError as error:
    status_code = status.HTTP_404_NOT_FOUND if "not found" in str(error).lower() else status.HTTP_400_BAD_REQUEST
    raise HTTPException(status_code=status_code, detail=str(error)) from error
  return to_citation_review_queue_detail_out(detail)


@app.get("/api/citations/download-jobs", response_model=CitationDownloadJobsResponse)
def list_citation_download_jobs(
  current_user: Annotated[dict, Depends(get_current_user)],
  status_filter: str | None = None,
  limit: int = 200,
):
  with database_session(settings.sqlite_path) as connection:
    items = citation_review_repo.list_download_jobs(connection, status_filter=status_filter, limit=limit)
  return CitationDownloadJobsResponse(items=[to_citation_download_job_out(item) for item in items])


@app.get("/api/citations/manual-procurement", response_model=CitationManualProcurementResponse)
def list_citation_manual_procurement(
  current_user: Annotated[dict, Depends(get_current_user)],
  status_filter: str | None = None,
  owner_user_id: str | None = None,
  limit: int = 200,
):
  with database_session(settings.sqlite_path) as connection:
    items = citation_review_repo.list_manual_procurement_items(
      connection,
      status_filter=status_filter,
      owner_user_id=owner_user_id,
      limit=limit,
    )
  return CitationManualProcurementResponse(items=[to_citation_manual_procurement_item_out(item) for item in items])


@app.post("/api/citations/manual-procurement", response_model=CitationManualProcurementDetailOut)
def create_citation_manual_procurement(
  payload: CitationManualProcurementCreate,
  current_user: Annotated[dict, Depends(get_current_user)],
):
  try:
    with database_session(settings.sqlite_path) as connection:
      detail = citation_procurement_service.create_item(
        connection,
        work_id=payload.work_id,
        edition_id=payload.edition_id,
        approval_queue_id=payload.approval_queue_id,
        owner_user_id=payload.owner_user_id,
        requested_by_user_id=current_user["id"],
        reason_code=payload.reason_code,
        unresolved_reasons=payload.unresolved_reasons,
        priority=payload.priority,
        vendor_hint=payload.vendor_hint,
        due_at=payload.due_at,
        notes=payload.notes,
        future_workflow=payload.future_workflow,
        metadata=payload.metadata,
        actor_user_id=current_user["id"],
      )
  except CitationProcurementError as error:
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error
  return to_citation_manual_procurement_detail_out(detail)


@app.get("/api/citations/manual-procurement/export", response_model=CitationManualProcurementExportResponse)
def export_citation_manual_procurement(
  current_user: Annotated[dict, Depends(get_current_user)],
  status_filter: str | None = None,
  owner_user_id: str | None = None,
  limit: int = 500,
):
  with database_session(settings.sqlite_path) as connection:
    payload = citation_procurement_service.export_session(
      connection,
      status_filter=status_filter,
      owner_user_id=owner_user_id,
      limit=limit,
    )
  return CitationManualProcurementExportResponse(
    schema_version=payload["schema_version"],
    exported_at=payload["exported_at"],
    filters=payload.get("filters") or {},
    count=int(payload.get("count") or 0),
    items=[
      CitationManualProcurementExportItemOut(
        queue_item=to_citation_manual_procurement_item_out(item["queue_item"]),
        search_hints=list(item.get("search_hints") or []),
      )
      for item in payload.get("items", [])
    ],
  )


@app.get("/api/citations/manual-procurement/{item_id}", response_model=CitationManualProcurementDetailOut)
def get_citation_manual_procurement_item(
  item_id: str,
  current_user: Annotated[dict, Depends(get_current_user)],
):
  try:
    with database_session(settings.sqlite_path) as connection:
      detail = citation_procurement_service.build_detail(connection, item_id)
  except CitationProcurementError as error:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
  return to_citation_manual_procurement_detail_out(detail)


@app.post("/api/citations/manual-procurement/{item_id}/action", response_model=CitationManualProcurementDetailOut)
def update_citation_manual_procurement_item(
  item_id: str,
  payload: CitationManualProcurementActionRequest,
  current_user: Annotated[dict, Depends(get_current_user)],
):
  try:
    with database_session(settings.sqlite_path) as connection:
      detail = citation_procurement_service.apply_action(
        connection,
        item_id=item_id,
        actor_user_id=current_user["id"],
        action=payload.action,
        note=payload.note,
        payload=payload.payload,
      )
  except CitationProcurementError as error:
    status_code = status.HTTP_404_NOT_FOUND if "not found" in str(error).lower() else status.HTTP_400_BAD_REQUEST
    raise HTTPException(status_code=status_code, detail=str(error)) from error
  return to_citation_manual_procurement_detail_out(detail)


@app.get("/api/citations/{citation_id}", response_model=CitationEntryOut)
def get_citation_entry(citation_id: str, current_user: Annotated[dict, Depends(get_current_user)]):
  with database_session(settings.sqlite_path) as connection:
    payload = repository.get_citation_entry(connection, citation_id)
  if payload is None:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Citation entry not found.")
  return to_citation_entry_out(payload)


@app.get("/api/forecast-techniques")
def list_forecast_techniques(current_user: Annotated[dict, Depends(get_current_user)], document_id: str | None = None, family_key: str | None = None):
  with database_session(settings.sqlite_path) as connection:
    engine.ensure_forecast_technique_materializations(connection, [document_id] if document_id else None, family_key=family_key)
    items = [to_forecast_technique_out(item) for item in repository.list_forecast_techniques(connection, document_id=document_id, family_key=family_key)]
  return {"items": items}


@app.get("/api/forecast-techniques/{technique_id}", response_model=ForecastTechniqueOut)
def get_forecast_technique(technique_id: str, current_user: Annotated[dict, Depends(get_current_user)], document_id: str | None = None, family_key: str | None = None):
  with database_session(settings.sqlite_path) as connection:
    engine.ensure_forecast_technique_materializations(connection, [document_id] if document_id else None, family_key=family_key)
    payload = repository.get_forecast_technique_detail(connection, technique_id, document_id=document_id, family_key=family_key)
  if payload is None:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Forecast technique not found.")
  return to_forecast_technique_out(payload)


@app.get("/api/documents/{document_id}/forecast-technique-pack", response_model=ForecastTechniquePackOut)
def get_document_forecast_technique_pack(document_id: str, current_user: Annotated[dict, Depends(get_current_user)], family_key: str | None = None):
  with database_session(settings.sqlite_path) as connection:
    document = repository.get_document_by_id(connection, document_id)
    if document is None:
      raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")
    engine.ensure_forecast_technique_materializations(connection, [document_id], family_key=family_key)
    details = repository.list_document_forecast_technique_details(connection, document_id, family_key=family_key)
    pack = build_pack_payload(document, details)
  return ForecastTechniquePackOut(**pack)


@app.get("/api/import-jobs")
def list_import_jobs(current_user: Annotated[dict, Depends(get_current_user)]):
  with database_session(settings.sqlite_path) as connection:
    raw_jobs = repository.list_import_jobs(connection)
    job_ids = [job["id"] for job in raw_jobs]
    task_rows = repository.list_pipeline_tasks(connection, job_ids) if job_ids else []
    tasks_by_job: dict[str, list[dict]] = {}
    for task in task_rows:
      tasks_by_job.setdefault(task["job_id"], []).append(task)
    jobs = [to_import_job_out(job, tasks_by_job.get(job["id"], [])) for job in raw_jobs]
  return {"items": jobs}


@app.post("/api/import-jobs", response_model=ImportJobOut)
def queue_import_job(payload: ImportJobCreate, current_user: Annotated[dict, Depends(get_current_user)]):
  recursive = bool((payload.options or {}).get("recursive", True))
  try:
    engine.validate_import_source(Path(payload.source_path), recursive=recursive)
  except FileNotFoundError as error:
    raise HTTPException(
      status_code=status.HTTP_400_BAD_REQUEST,
      detail={"code": "import_path_not_found", "message": str(error)},
    ) from error
  except ValueError as error:
    message = str(error)
    code = "import_no_supported_files" if "No supported documents were found" in message else "import_unsupported_source"
    raise HTTPException(
      status_code=status.HTTP_400_BAD_REQUEST,
      detail={"code": code, "message": message},
    ) from error
  with database_session(settings.sqlite_path) as connection:
    existing_job = None
    if payload.kind == "manual_import":
      existing_job = repository.find_active_import_job(connection, payload.source_path, kind=payload.kind)
    if existing_job:
      tasks = repository.list_pipeline_tasks(connection, [existing_job["id"]])
      return to_import_job_out(existing_job, tasks)
    job = repository.create_import_job(connection, kind=payload.kind, source_path=payload.source_path, created_by=current_user["id"], options=payload.options)
  return to_import_job_out(job, [])


@app.delete("/api/import-jobs")
def reset_import_jobs(current_user: Annotated[dict, Depends(get_current_user)]):
  with database_session(settings.sqlite_path) as connection:
    result = repository.reset_import_jobs(connection)
  job_artifact_root = settings.resolved_job_artifact_dir
  if job_artifact_root.exists():
    for child in job_artifact_root.iterdir():
      if child.is_dir():
        shutil.rmtree(child, ignore_errors=True)
      else:
        child.unlink(missing_ok=True)
  return {"ok": True, "deleted_jobs": result["deleted_jobs"], "deleted_tasks": result["deleted_tasks"], "user_id": current_user["id"]}


@app.get("/api/watch-folders")
def list_watch_folders(current_user: Annotated[dict, Depends(get_current_user)]):
  with database_session(settings.sqlite_path) as connection:
    folders = [to_watch_folder_out(folder) for folder in repository.list_watch_folders(connection)]
  return {"items": folders}


@app.post("/api/watch-folders", response_model=WatchFolderOut)
def create_watch_folder(payload: WatchFolderCreate, current_user: Annotated[dict, Depends(get_current_user)]):
  with database_session(settings.sqlite_path) as connection:
    folder = repository.create_watch_folder(
      connection,
      path=payload.path,
      recursive=payload.recursive,
      include_extensions=payload.include_extensions,
      exclude_globs=payload.exclude_globs,
      created_by=current_user["id"],
    )
  return to_watch_folder_out(folder)


@app.get("/api/operator/runtime", response_model=OperatorRuntimeStateOut)
def get_operator_runtime_state(current_user: Annotated[dict, Depends(get_current_user)]):
  return OperatorRuntimeStateOut(**read_operator_runtime_state())


@app.post("/api/operator/runtime", response_model=OperatorRuntimeStateOut)
def set_operator_runtime_state(
  payload: OperatorRuntimeStateRequest,
  current_user: Annotated[dict, Depends(get_current_user)],
):
  return OperatorRuntimeStateOut(**write_operator_runtime_state(payload.paused, payload.pause_reason))


@app.post("/api/watch-folders/{watch_folder_id}/rescan", response_model=OperatorActionResponse)
def rescan_watch_folder(watch_folder_id: str, current_user: Annotated[dict, Depends(get_current_user)]):
  with database_session(settings.sqlite_path) as connection:
    folder = repository.get_watch_folder(connection, watch_folder_id)
    if folder is None:
      raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Watch folder not found.")
    repository.update_watch_folder(
      connection,
      watch_folder_id,
      last_scanned_at=None,
      last_scan_started_at=None,
      last_scan_finished_at=None,
      error_text=None,
      last_event_summary_json={
        "operator_requested": True,
        "action": "rescan",
        "requested_by": current_user["username"],
        "requested_at": datetime.now(timezone.utc).isoformat(),
      },
    )
  return OperatorActionResponse(message=f"Rescan requested for {folder['path']}.")


@app.get("/api/tracked-files", response_model=TrackedFilesResponse)
def list_tracked_files(
  current_user: Annotated[dict, Depends(get_current_user)],
  status: str | None = None,
  stale: bool | None = None,
  root_watch_folder_id: str | None = None,
  limit: int = 200,
):
  with database_session(settings.sqlite_path) as connection:
    items = repository.list_tracked_files(
      connection,
      overall_status=status,
      stale=stale,
      root_watch_folder_id=root_watch_folder_id,
      limit=limit,
    )
  return TrackedFilesResponse(items=[to_tracked_file_out(item) for item in items])


@app.get("/api/tracked-file-events", response_model=TrackedFileEventsResponse)
def list_recent_tracked_file_events(
  current_user: Annotated[dict, Depends(get_current_user)],
  root_watch_folder_id: str | None = None,
  limit: int = 200,
):
  with database_session(settings.sqlite_path) as connection:
    items = repository.list_recent_tracked_file_events(
      connection,
      root_watch_folder_id=root_watch_folder_id,
      limit=limit,
    )
  return TrackedFileEventsResponse(items=[to_tracked_file_event_out(item) for item in items])


@app.get("/api/tracked-files/stale", response_model=TrackedFilesResponse)
def list_stale_tracked_files(current_user: Annotated[dict, Depends(get_current_user)], limit: int = 200):
  with database_session(settings.sqlite_path) as connection:
    items = repository.list_tracked_files(connection, bucket="stale", limit=limit)
  return TrackedFilesResponse(items=[to_tracked_file_out(item) for item in items])


@app.get("/api/tracked-files/new", response_model=TrackedFilesResponse)
def list_new_tracked_files(current_user: Annotated[dict, Depends(get_current_user)], limit: int = 200):
  with database_session(settings.sqlite_path) as connection:
    items = repository.list_tracked_files(connection, bucket="new", limit=limit)
  return TrackedFilesResponse(items=[to_tracked_file_out(item) for item in items])


@app.get("/api/tracked-files/failed", response_model=TrackedFilesResponse)
def list_failed_tracked_files(current_user: Annotated[dict, Depends(get_current_user)], limit: int = 200):
  with database_session(settings.sqlite_path) as connection:
    items = repository.list_tracked_files(connection, bucket="failed", limit=limit)
  return TrackedFilesResponse(items=[to_tracked_file_out(item) for item in items])


@app.get("/api/tracked-files/{tracked_file_id}", response_model=TrackedFileDetailOut)
def get_tracked_file(tracked_file_id: str, current_user: Annotated[dict, Depends(get_current_user)]):
  with database_session(settings.sqlite_path) as connection:
    item = repository.get_tracked_file(connection, tracked_file_id)
    if item is None:
      raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tracked file not found.")
    history = repository.list_tracked_file_events(connection, tracked_file_id)
  payload = to_tracked_file_out(item).model_dump()
  payload["history"] = [to_tracked_file_event_out(event) for event in history]
  return TrackedFileDetailOut(**payload)


@app.get("/api/tracked-files/{tracked_file_id}/artifacts", response_model=TrackedFileArtifactPathsResponse)
def get_tracked_file_artifacts(tracked_file_id: str, current_user: Annotated[dict, Depends(get_current_user)]):
  with database_session(settings.sqlite_path) as connection:
    item = repository.get_tracked_file(connection, tracked_file_id)
    if item is None:
      raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tracked file not found.")
  return TrackedFileArtifactPathsResponse(
    tracked_file_id=item["id"],
    absolute_path=item["absolute_path"],
    last_import_job_id=item.get("last_import_job_id"),
    items=tracked_file_artifact_paths(item),
  )


@app.post("/api/tracked-files/{tracked_file_id}/retry", response_model=OperatorActionResponse)
def retry_tracked_file(tracked_file_id: str, current_user: Annotated[dict, Depends(get_current_user)]):
  with database_session(settings.sqlite_path) as connection:
    item = repository.get_tracked_file(connection, tracked_file_id)
    if item is None:
      raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tracked file not found.")
    source_path = str(item["absolute_path"])
    existing_job = repository.find_active_import_job(connection, source_path, kind="manual_import")
    job = existing_job or repository.create_import_job(
      connection,
      kind="manual_import",
      source_path=source_path,
      created_by=current_user["id"],
      options={"recursive": False, "trigger": "operator_retry", "tracked_file_id": tracked_file_id},
    )
    repository.reconcile_tracked_file_stage(
      connection,
      absolute_path=source_path,
      stage="extract",
      status="queued",
      import_job_id=job["id"],
      root_watch_folder_id=item.get("root_watch_folder_id"),
      relative_path=item.get("relative_path"),
      size_bytes=int(item.get("size_bytes") or 0),
      mtime=item.get("mtime"),
      checksum_sha1=item.get("checksum_sha1"),
      error_message=None,
      metadata_json=repository.json_loads(item.get("metadata_json"), {}),
      event_message="Operator queued this file for retry.",
    )
  return OperatorActionResponse(message=f"Retry queued for {item['relative_path']}.")


@app.post("/api/tracked-files/{tracked_file_id}/mark-stale", response_model=OperatorActionResponse)
def mark_tracked_file_stale_route(tracked_file_id: str, current_user: Annotated[dict, Depends(get_current_user)]):
  with database_session(settings.sqlite_path) as connection:
    item = repository.mark_tracked_file_stale_by_id(
      connection,
      tracked_file_id,
      message="File was manually marked stale by the operator.",
    )
    if item is None:
      raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tracked file not found.")
  return OperatorActionResponse(message=f"Marked {item['relative_path']} as stale.")


@app.post("/api/query", response_model=QueryResponse)
def query_library(payload: QueryRequest, current_user: Annotated[dict, Depends(get_current_user)]):
  try:
    with database_session(settings.sqlite_path) as connection:
      result = engine.query(connection, payload.query, user_id=current_user["id"], scope=payload.scope)
    return QueryResponse(**result)
  except ServiceDependencyError as error:
    raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=error.to_detail()) from error


@app.post("/api/market/analysis", response_model=MarketAnalysisResponse)
def analyze_market(payload: MarketAnalysisRequest, current_user: Annotated[dict, Depends(get_current_user)]):
  try:
    result = engine.analyze_market(payload.model_dump())
    return MarketAnalysisResponse(**result)
  except ServiceDependencyError as error:
    raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=error.to_detail()) from error


@app.post("/api/market/pharma/sync", response_model=PharmaSyncResponse)
def sync_pharma_events(payload: PharmaSyncRequest, current_user: Annotated[dict, Depends(get_current_user)]):
  try:
    with database_session(settings.sqlite_path) as connection:
      result = engine.sync_pharma_events(connection, payload.model_dump())
    return PharmaSyncResponse(**result)
  except ServiceDependencyError as error:
    raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=error.to_detail()) from error


@app.post("/api/market/dossiers/sync", response_model=DossierSyncResponse)
def sync_dossiers(payload: DossierSyncRequest, current_user: Annotated[dict, Depends(get_current_user)]):
  try:
    with database_session(settings.sqlite_path) as connection:
      result = engine.sync_dossier_assertions(connection, payload.model_dump())
    return DossierSyncResponse(**result)
  except ServiceDependencyError as error:
    raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=error.to_detail()) from error


@app.get("/api/market/dossiers/assertions", response_model=DossierAssertionsResponse)
def list_dossier_assertions(
  current_user: Annotated[dict, Depends(get_current_user)],
  limit: int = 100,
  dated_only: bool = False,
):
  with database_session(settings.sqlite_path) as connection:
    result = engine.list_dossier_assertions(
      connection,
      {
        "limit": limit,
        "dated_only": dated_only,
      },
    )
  return DossierAssertionsResponse(**result)


@app.get("/api/market/dossiers/windows", response_model=DossierSignalWindowsResponse)
def list_dossier_windows(
  current_user: Annotated[dict, Depends(get_current_user)],
  limit: int = 500,
):
  with database_session(settings.sqlite_path) as connection:
    result = engine.list_dossier_signal_windows(
      connection,
      {
        "limit": limit,
      },
    )
  return DossierSignalWindowsResponse(**result)


@app.get("/api/market/pharma/events", response_model=PharmaEventsResponse)
def list_pharma_events(
  current_user: Annotated[dict, Depends(get_current_user)],
  symbols: str = "",
  limit: int = 100,
):
  with database_session(settings.sqlite_path) as connection:
    result = engine.list_pharma_events(
      connection,
      {
        "symbols": [item.strip().upper() for item in symbols.split(",") if item.strip()],
        "limit": limit,
      },
    )
  return PharmaEventsResponse(**result)


@app.post("/api/market/pharma/cycles", response_model=PharmaCycleResponse)
def run_pharma_cycle(payload: PharmaCycleRequest, current_user: Annotated[dict, Depends(get_current_user)]):
  try:
    with database_session(settings.sqlite_path) as connection:
      result = engine.run_pharma_cycle(connection, payload.model_dump(), user_id=current_user["id"])
    return PharmaCycleResponse(**result)
  except ServiceDependencyError as error:
    raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=error.to_detail()) from error


@app.get("/api/market/pharma/cycles")
def list_pharma_cycles(current_user: Annotated[dict, Depends(get_current_user)]):
  with database_session(settings.sqlite_path) as connection:
    return engine.list_pharma_cycles(connection)


@app.get("/api/market/pharma/cycles/{cycle_id}")
def get_pharma_cycle(cycle_id: str, current_user: Annotated[dict, Depends(get_current_user)]):
  with database_session(settings.sqlite_path) as connection:
    payload = engine.get_pharma_cycle(connection, cycle_id)
  if payload is None:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pharma cycle not found.")
  return payload


@app.get("/api/market/pharma/leaderboard", response_model=PharmaLeaderboardResponse)
def pharma_leaderboard(current_user: Annotated[dict, Depends(get_current_user)]):
  with database_session(settings.sqlite_path) as connection:
    return PharmaLeaderboardResponse(**engine.pharma_leaderboard(connection))


@app.get("/api/market/pharma/homologations", response_model=PharmaHomologationsResponse)
def pharma_homologations(current_user: Annotated[dict, Depends(get_current_user)]):
  with database_session(settings.sqlite_path) as connection:
    return PharmaHomologationsResponse(**engine.pharma_homologations(connection))


@app.post("/api/research/query", response_model=ResearchQueryResponse)
def research_query(payload: ResearchQueryRequest, current_user: Annotated[dict, Depends(get_current_user)]):
  try:
    with database_session(settings.sqlite_path) as connection:
      result = engine.research_query(connection, payload.query, user_id=current_user["id"], scope=payload.scope)
    return ResearchQueryResponse(**result)
  except ServiceDependencyError as error:
    raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=error.to_detail()) from error


@app.get("/api/research/bundles/{bundle_id}", response_model=ResearchQueryResponse)
def get_research_bundle(bundle_id: str, current_user: Annotated[dict, Depends(get_current_user)]):
  with database_session(settings.sqlite_path) as connection:
    payload = repository.get_research_bundle(connection, bundle_id)
  if payload is None:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Research bundle not found.")
  return ResearchQueryResponse(
    id=payload["id"],
    mode=payload["mode"],
    answer=payload["answer"],
    citations=payload["citations"],
    evidence_bundle=payload["evidence_bundle"],
    entities=payload["entities"],
    relations=payload["relations"],
    lens_payloads=[
      {"key": key, "title": value["title"], "status": value["status"], "summary": value["summary"], "data": value["data"]}
      for key, value in payload["lens_payloads"].items()
    ],
    validation=payload["validation"],
    warnings=payload["warnings"],
    trace=payload["trace"],
  )


@app.get("/api/research/maps")
def list_research_maps(current_user: Annotated[dict, Depends(get_current_user)]):
  with database_session(settings.sqlite_path) as connection:
    maps = repository.list_research_maps(connection, current_user["id"])
    pins = repository.list_research_map_pins(connection, [item["id"] for item in maps])
  pin_counts: dict[str, int] = {}
  for pin in pins:
    pin_counts[pin["map_id"]] = pin_counts.get(pin["map_id"], 0) + 1
  return {
    "items": [
      to_research_map_out(item, pin_count=pin_counts.get(item["id"], 0))
      for item in maps
    ]
  }


@app.post("/api/research/maps", response_model=ResearchMapOut)
def create_research_map(payload: ResearchMapCreate, current_user: Annotated[dict, Depends(get_current_user)]):
  with database_session(settings.sqlite_path) as connection:
    item = repository.create_research_map(connection, current_user["id"], payload.title, payload.description, payload.bundle_id, payload.layout)
  return to_research_map_out(item, pin_count=0)


@app.get("/api/research/topos/website")
def get_website_topos_export(current_user: Annotated[dict, Depends(get_current_user)]):
  return load_reviewed_website_topos_export()


@app.get("/api/research/lawvere")
def get_lawvere_collection(current_user: Annotated[dict, Depends(get_current_user)]):
  with database_session(settings.sqlite_path) as connection:
    return build_lawvere_collection_payload(connection)


@app.get("/api/research/lawvere/formalization-candidates")
def get_lawvere_formalization_candidates(current_user: Annotated[dict, Depends(get_current_user)]):
  with database_session(settings.sqlite_path) as connection:
    payload = build_lawvere_collection_payload(connection)
  return {
    "items": payload.get("formalization_candidates", []),
    "source_kind": LAWVERE_COLLECTION_SOURCE_KIND,
    "source_ref": payload.get("source_ref") or "",
  }


@app.get("/api/research/cognitive-invariants")
def get_cognitive_invariants_collection(current_user: Annotated[dict, Depends(get_current_user)]):
  with database_session(settings.sqlite_path) as connection:
    return build_cognitive_invariants_payload(connection)


@app.get("/api/research/cognitive-invariants/formalization-candidates")
def get_cognitive_invariants_formalization_candidates(current_user: Annotated[dict, Depends(get_current_user)]):
  with database_session(settings.sqlite_path) as connection:
    payload = build_cognitive_invariants_payload(connection)
  return {
    "items": payload.get("formalization_candidates", []),
    "source_kind": COGNITIVE_INVARIANTS_SOURCE_KIND,
    "source_ref": payload.get("source_ref") or "",
  }


@app.post("/api/research/maps/from-topos", response_model=WebsiteToposMaterializeResponse)
def create_research_map_from_topos(payload: WebsiteToposMaterializeRequest, current_user: Annotated[dict, Depends(get_current_user)]):
  export_payload = load_reviewed_website_topos_export()
  with database_session(settings.sqlite_path) as connection:
    item, pins_created = materialize_website_topos_map(
      connection,
      current_user["id"],
      export_payload,
      title=payload.title,
      description=payload.description,
    )
  return WebsiteToposMaterializeResponse(
    map=to_research_map_out(item, pin_count=pins_created),
    pins_created=pins_created,
    source_kind=WEBSITE_TOPOS_SOURCE_KIND,
    source_ref=export_payload.get("source_ref") or "",
  )


@app.post("/api/research/maps/from-lawvere", response_model=LawvereCollectionMaterializeResponse)
def create_research_map_from_lawvere(payload: LawvereCollectionMaterializeRequest, current_user: Annotated[dict, Depends(get_current_user)]):
  with database_session(settings.sqlite_path) as connection:
    export_payload = build_lawvere_collection_payload(connection)
    item, pins_created = materialize_lawvere_collection_map(
      connection,
      current_user["id"],
      export_payload,
      title=payload.title,
      description=payload.description,
    )
  return LawvereCollectionMaterializeResponse(
    map=to_research_map_out(item, pin_count=pins_created),
    pins_created=pins_created,
    source_kind=LAWVERE_COLLECTION_SOURCE_KIND,
    source_ref=export_payload.get("source_ref") or "",
  )


@app.post("/api/research/maps/from-cognitive-invariants", response_model=CognitiveInvariantsMaterializeResponse)
def create_research_map_from_cognitive_invariants(payload: CognitiveInvariantsMaterializeRequest, current_user: Annotated[dict, Depends(get_current_user)]):
  with database_session(settings.sqlite_path) as connection:
    export_payload = build_cognitive_invariants_payload(connection)
    item, pins_created = materialize_cognitive_invariants_map(
      connection,
      current_user["id"],
      export_payload,
      title=payload.title,
      description=payload.description,
    )
  return CognitiveInvariantsMaterializeResponse(
    map=to_research_map_out(item, pin_count=pins_created),
    pins_created=pins_created,
    source_kind=COGNITIVE_INVARIANTS_SOURCE_KIND,
    source_ref=export_payload.get("source_ref") or "",
  )


@app.post("/api/research/maps/{map_id}/pins", response_model=ResearchMapPinOut)
def create_research_map_pin(map_id: str, payload: ResearchMapPinCreate, current_user: Annotated[dict, Depends(get_current_user)]):
  with database_session(settings.sqlite_path) as connection:
    available_maps = {item["id"] for item in repository.list_research_maps(connection, current_user["id"])}
    if map_id not in available_maps:
      raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Research map not found.")
    item = repository.create_research_map_pin(connection, map_id, payload.entity_id, payload.pin_type, payload.position, payload.payload)
  return ResearchMapPinOut(
    id=item["id"],
    map_id=item["map_id"],
    entity_id=item["entity_id"],
    pin_type=item["pin_type"],
    position=repository.json_loads(item.get("position_json"), {}),
    payload=repository.json_loads(item.get("payload_json"), {}),
    created_at=item["created_at"],
  )


@app.get("/api/research/entities/{entity_id}")
def get_research_entity(entity_id: str, current_user: Annotated[dict, Depends(get_current_user)]):
  with database_session(settings.sqlite_path) as connection:
    payload = repository.get_research_entity(connection, entity_id)
  if payload is None:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entity not found.")
  return payload


@app.get("/api/saved-queries")
def list_saved_queries(current_user: Annotated[dict, Depends(get_current_user)]):
  with database_session(settings.sqlite_path) as connection:
    items = [
      SavedQueryOut(
        id=item["id"],
        title=item["title"],
        query_text=item["query_text"],
        mode=item["mode"],
        research_bundle_id=item.get("research_bundle_id"),
        created_at=item["created_at"],
      )
      for item in repository.list_saved_queries(connection, current_user["id"])
    ]
  return {"items": items}


@app.post("/api/saved-queries", response_model=SavedQueryOut)
def create_saved_query(payload: SavedQueryCreate, current_user: Annotated[dict, Depends(get_current_user)]):
  with database_session(settings.sqlite_path) as connection:
    item = repository.create_saved_query(
      connection,
      user_id=current_user["id"],
      title=payload.title,
      query_text=payload.query_text,
      mode=payload.mode,
      response_json=json.dumps(payload.response),
      research_bundle_id=payload.research_bundle_id,
    )
  return SavedQueryOut(
    id=item["id"],
    title=item["title"],
    query_text=item["query_text"],
    mode=item["mode"],
    research_bundle_id=item.get("research_bundle_id"),
    created_at=item["created_at"],
  )


@app.get("/api/notes")
def list_notes(current_user: Annotated[dict, Depends(get_current_user)]):
  with database_session(settings.sqlite_path) as connection:
    items = [
      NoteOut(
        id=item["id"],
        title=item["title"],
        content=item["content"],
        document_id=item["document_id"],
        node_id=item["node_id"],
        entity_id=item.get("entity_id"),
        created_at=item["created_at"],
      )
      for item in repository.list_notes(connection, current_user["id"])
    ]
  return {"items": items}


@app.post("/api/notes", response_model=NoteOut)
def create_note(payload: NoteCreate, current_user: Annotated[dict, Depends(get_current_user)]):
  with database_session(settings.sqlite_path) as connection:
    item = repository.create_note(connection, current_user["id"], payload.title, payload.content, payload.document_id, payload.node_id, payload.entity_id)
  return NoteOut(
    id=item["id"],
    title=item["title"],
    content=item["content"],
    document_id=item["document_id"],
    node_id=item["node_id"],
    entity_id=item.get("entity_id"),
    created_at=item["created_at"],
  )
