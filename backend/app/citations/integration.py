from __future__ import annotations

from dataclasses import asdict, dataclass, field, is_dataclass
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Protocol


def _utc_now_iso() -> str:
  return datetime.now(timezone.utc).isoformat()


class CitationIntegrationEvent(str, Enum):
  RAW_CITATIONS_OBSERVED = "citations.raw_citations.observed"
  PURIFICATION_REQUESTED = "citations.purification.requested"
  PURIFICATION_COMPLETED = "citations.purification.completed"
  PRIVATE_COLLECTION_UPSERTED = "citations.private_collection.upserted"
  HOLDINGS_SUPPRESSION_UPDATED = "citations.holdings_suppression.updated"
  BIBLIOGRAPHIC_GRAPH_UPDATED = "citations.bibliographic_graph.updated"
  WIKI_ENRICHMENT_REQUESTED = "citations.wiki_enrichment.requested"
  WIKI_ENRICHMENT_COMPLETED = "citations.wiki_enrichment.completed"
  ACQUISITION_CANDIDATE_APPROVED = "citations.acquisition_candidate.approved"
  DOWNLOAD_ARTIFACT_STAGED = "citations.download_artifact.staged"
  SEMANTIC_IMPORT_REQUESTED = "semantic.import.requested"


class CitationIntegrationQueue(str, Enum):
  RAW_INTAKE = "citations.raw-intake"
  PURIFICATION = "citations.purification"
  HOLDINGS_SYNC = "citations.holdings-sync"
  WIKI_ENRICHMENT = "citations.wiki-enrichment"
  DOWNLOADS = "citations.downloads"
  SEMANTIC_IMPORTS = "semantic.imports"


class SupportsToDict(Protocol):
  def to_dict(self) -> dict[str, Any]:
    ...


def _as_payload_dict(value: dict[str, Any] | SupportsToDict | Any) -> dict[str, Any]:
  if hasattr(value, "to_dict"):
    return dict(value.to_dict())
  if is_dataclass(value):
    return asdict(value)
  return dict(value)


def _enum_value(value: str | Enum) -> str:
  if isinstance(value, Enum):
    return str(value.value)
  return str(value)


@dataclass(slots=True)
class EventEnvelope:
  name: str
  producer: str
  payload: dict[str, Any]
  version: str = "v1"
  event_id: str | None = None
  occurred_at: str = field(default_factory=_utc_now_iso)
  correlation_id: str | None = None
  causation_id: str | None = None
  dedupe_key: str | None = None
  partition_key: str | None = None

  @classmethod
  def wrap(
    cls,
    *,
    name: CitationIntegrationEvent | str,
    producer: str,
    payload: dict[str, Any] | SupportsToDict | Any,
    version: str = "v1",
    event_id: str | None = None,
    correlation_id: str | None = None,
    causation_id: str | None = None,
    dedupe_key: str | None = None,
    partition_key: str | None = None,
  ) -> "EventEnvelope":
    return cls(
      name=_enum_value(name),
      producer=producer,
      payload=_as_payload_dict(payload),
      version=version,
      event_id=event_id,
      correlation_id=correlation_id,
      causation_id=causation_id,
      dedupe_key=dedupe_key,
      partition_key=partition_key,
    )

  def to_dict(self) -> dict[str, Any]:
    return asdict(self)


@dataclass(slots=True)
class LocalQueueMessage:
  queue_name: str
  message_type: str
  payload: dict[str, Any]
  message_id: str | None = None
  available_at: str | None = None
  dedupe_key: str | None = None
  correlation_id: str | None = None
  attempts: int = 0
  metadata: dict[str, Any] = field(default_factory=dict)

  @classmethod
  def from_payload(
    cls,
    *,
    queue_name: CitationIntegrationQueue | str,
    message_type: CitationIntegrationEvent | str,
    payload: dict[str, Any] | SupportsToDict | Any,
    message_id: str | None = None,
    available_at: str | None = None,
    dedupe_key: str | None = None,
    correlation_id: str | None = None,
    attempts: int = 0,
    metadata: dict[str, Any] | None = None,
  ) -> "LocalQueueMessage":
    return cls(
      queue_name=_enum_value(queue_name),
      message_type=_enum_value(message_type),
      payload=_as_payload_dict(payload),
      message_id=message_id,
      available_at=available_at,
      dedupe_key=dedupe_key,
      correlation_id=correlation_id,
      attempts=attempts,
      metadata=dict(metadata or {}),
    )

  def to_dict(self) -> dict[str, Any]:
    return asdict(self)


class MessageBus(Protocol):
  def publish_event(self, envelope: EventEnvelope) -> None:
    ...

  def enqueue(self, message: LocalQueueMessage) -> None:
    ...

  def dequeue(self, queue_name: str, *, limit: int = 1) -> list[LocalQueueMessage]:
    ...


@dataclass(slots=True)
class RawCitationObservation:
  raw_citation_text: str
  source_record_id: str
  source_kind: str
  page_url: str | None = None
  page_title: str | None = None
  locator: str | None = None
  extracted_fields: dict[str, Any] = field(default_factory=dict)
  provenance: dict[str, Any] = field(default_factory=dict)
  metadata: dict[str, Any] = field(default_factory=dict)

  def to_dict(self) -> dict[str, Any]:
    return asdict(self)


@dataclass(slots=True)
class RawCitationsObservedPayload:
  batch_id: str
  source_system: str
  observations: list[RawCitationObservation] = field(default_factory=list)
  requested_by: str | None = None
  metadata: dict[str, Any] = field(default_factory=dict)

  def to_dict(self) -> dict[str, Any]:
    return {
      "batch_id": self.batch_id,
      "source_system": self.source_system,
      "observations": [item.to_dict() for item in self.observations],
      "requested_by": self.requested_by,
      "metadata": dict(self.metadata),
    }


@dataclass(slots=True)
class PurificationRequestedPayload:
  batch_id: str
  source_system: str
  raw_observation_ids: list[str] = field(default_factory=list)
  parser_version: str | None = None
  suppress_owned_works: bool = True
  metadata: dict[str, Any] = field(default_factory=dict)

  def to_dict(self) -> dict[str, Any]:
    return asdict(self)


@dataclass(slots=True)
class PurificationCompletedPayload:
  batch_id: str
  normalized_record_ids: list[str] = field(default_factory=list)
  work_ids: list[str] = field(default_factory=list)
  cluster_ids: list[str] = field(default_factory=list)
  warnings: list[str] = field(default_factory=list)
  metadata: dict[str, Any] = field(default_factory=dict)

  def to_dict(self) -> dict[str, Any]:
    return asdict(self)


@dataclass(slots=True)
class PrivateCollectionHolding:
  holding_id: str
  document_id: str | None = None
  source_path: str | None = None
  title: str | None = None
  authors: list[str] = field(default_factory=list)
  identifiers: dict[str, str] = field(default_factory=dict)
  checksum_sha1: str | None = None
  checksum_sha256: str | None = None
  edition_notes: list[str] = field(default_factory=list)
  metadata: dict[str, Any] = field(default_factory=dict)

  def to_dict(self) -> dict[str, Any]:
    return asdict(self)


@dataclass(slots=True)
class PrivateCollectionUpsertedPayload:
  snapshot_id: str
  collection_name: str
  holdings: list[PrivateCollectionHolding] = field(default_factory=list)
  metadata: dict[str, Any] = field(default_factory=dict)

  def to_dict(self) -> dict[str, Any]:
    return {
      "snapshot_id": self.snapshot_id,
      "collection_name": self.collection_name,
      "holdings": [item.to_dict() for item in self.holdings],
      "metadata": dict(self.metadata),
    }


@dataclass(slots=True)
class HoldingsSuppressionUpdatedPayload:
  work_id: str
  edition_id: str | None = None
  suppression_status: str = "candidate"
  matched_document_ids: list[str] = field(default_factory=list)
  matched_manifestation_ids: list[str] = field(default_factory=list)
  matched_identifiers: list[str] = field(default_factory=list)
  reason_codes: list[str] = field(default_factory=list)
  metadata: dict[str, Any] = field(default_factory=dict)

  def to_dict(self) -> dict[str, Any]:
    return asdict(self)


@dataclass(slots=True)
class BibliographicGraphUpdatedPayload:
  work_id: str
  edition_ids: list[str] = field(default_factory=list)
  manifestation_ids: list[str] = field(default_factory=list)
  canonical_title: str | None = None
  identifiers: dict[str, str] = field(default_factory=dict)
  linked_source_record_ids: list[str] = field(default_factory=list)
  metadata: dict[str, Any] = field(default_factory=dict)

  def to_dict(self) -> dict[str, Any]:
    return asdict(self)


@dataclass(slots=True)
class WikiEnrichmentPayload:
  wiki_candidate_id: str
  page_title: str
  page_url: str | None = None
  candidate_work_ids: list[str] = field(default_factory=list)
  top_identifiers: list[str] = field(default_factory=list)
  suppression_status: str | None = None
  enrichment_summary: str | None = None
  metadata: dict[str, Any] = field(default_factory=dict)

  def to_dict(self) -> dict[str, Any]:
    return asdict(self)


@dataclass(slots=True)
class AcquisitionCandidateApprovedPayload:
  review_id: str
  candidate_id: str
  work_id: str
  edition_id: str | None = None
  provider: str | None = None
  approved_by_user_id: str | None = None
  risk_flags: list[str] = field(default_factory=list)
  metadata: dict[str, Any] = field(default_factory=dict)

  def to_dict(self) -> dict[str, Any]:
    return asdict(self)


@dataclass(slots=True)
class DownloadArtifactStagedPayload:
  download_job_id: str
  candidate_id: str
  work_id: str | None = None
  edition_id: str | None = None
  manifestation_id: str | None = None
  provider: str | None = None
  staging_path: str | None = None
  sidecar_path: str | None = None
  checksum_sha256: str | None = None
  duplicate_status: str = "unknown"
  metadata: dict[str, Any] = field(default_factory=dict)

  def to_dict(self) -> dict[str, Any]:
    return asdict(self)


@dataclass(slots=True)
class SemanticImportRequestedPayload:
  import_job_id: str
  source_path: str
  work_id: str | None = None
  edition_id: str | None = None
  manifestation_id: str | None = None
  sidecar_path: str | None = None
  trigger: str = "citation_download_worker"
  metadata: dict[str, Any] = field(default_factory=dict)

  def to_dict(self) -> dict[str, Any]:
    return asdict(self)


@dataclass(slots=True)
class InMemoryMessageBus:
  events: list[EventEnvelope] = field(default_factory=list)
  queues: dict[str, list[LocalQueueMessage]] = field(default_factory=dict)

  def publish_event(self, envelope: EventEnvelope) -> None:
    self.events.append(envelope)

  def enqueue(self, message: LocalQueueMessage) -> None:
    self.queues.setdefault(message.queue_name, []).append(message)

  def dequeue(self, queue_name: str, *, limit: int = 1) -> list[LocalQueueMessage]:
    messages = self.queues.get(queue_name, [])
    taken = list(messages[:limit])
    self.queues[queue_name] = messages[limit:]
    return taken


__all__ = [
  "AcquisitionCandidateApprovedPayload",
  "BibliographicGraphUpdatedPayload",
  "CitationIntegrationEvent",
  "CitationIntegrationQueue",
  "DownloadArtifactStagedPayload",
  "EventEnvelope",
  "HoldingsSuppressionUpdatedPayload",
  "InMemoryMessageBus",
  "LocalQueueMessage",
  "MessageBus",
  "PrivateCollectionHolding",
  "PrivateCollectionUpsertedPayload",
  "PurificationCompletedPayload",
  "PurificationRequestedPayload",
  "RawCitationObservation",
  "RawCitationsObservedPayload",
  "SemanticImportRequestedPayload",
  "WikiEnrichmentPayload",
]
