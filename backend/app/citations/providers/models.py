from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Protocol

from ..models import IdentifierSet, NormalizedCitation


@dataclass(slots=True)
class AcquisitionQuery:
  id: str
  query_kind: str
  title: str | None
  authors: list[str] = field(default_factory=list)
  title_aliases: list[str] = field(default_factory=list)
  author_aliases: list[str] = field(default_factory=list)
  year: str | None = None
  journal: str | None = None
  publisher: str | None = None
  edition_statement: str | None = None
  citation_type: str = "unknown"
  identifiers: IdentifierSet = field(default_factory=IdentifierSet)
  metadata: dict[str, Any] = field(default_factory=dict)

  @classmethod
  def from_normalized(cls, record: NormalizedCitation, *, query_kind: str = "work") -> "AcquisitionQuery":
    return cls(
      id=record.id,
      query_kind=query_kind,
      title=record.title,
      authors=list(record.authors),
      title_aliases=list(record.title_aliases),
      author_aliases=list(record.author_aliases),
      year=record.year,
      journal=record.journal,
      publisher=record.publisher,
      edition_statement=record.metadata.get("edition_statement"),
      citation_type=record.citation_type,
      identifiers=record.identifiers,
      metadata=dict(record.metadata),
    )

  def identifier_values(self) -> list[tuple[str, str]]:
    identifiers: list[tuple[str, str]] = []
    if self.identifiers.doi:
      identifiers.append(("doi", self.identifiers.doi))
    if self.identifiers.isbn13:
      identifiers.append(("isbn13", self.identifiers.isbn13))
    if self.identifiers.isbn10:
      identifiers.append(("isbn10", self.identifiers.isbn10))
    if self.identifiers.pmid:
      identifiers.append(("pmid", self.identifiers.pmid))
    if self.identifiers.arxiv:
      identifiers.append(("arxiv", self.identifiers.arxiv))
    return identifiers

  def to_dict(self) -> dict[str, Any]:
    payload = asdict(self)
    payload["identifiers"] = self.identifiers.to_dict()
    return payload


@dataclass(slots=True)
class ProviderRiskFlag:
  code: str
  severity: str
  message: str
  metadata: dict[str, Any] = field(default_factory=dict)

  def to_dict(self) -> dict[str, Any]:
    return asdict(self)


@dataclass(slots=True)
class ProviderQueryStrategy:
  provider_name: str
  strategy_name: str
  strategy_stage: str
  query_text: str
  params: dict[str, Any] = field(default_factory=dict)
  cache_key: str = ""
  priority: int = 100
  dry_run_note: str | None = None

  def to_dict(self) -> dict[str, Any]:
    return asdict(self)


@dataclass(slots=True)
class ProviderAttemptLog:
  provider_name: str
  strategy_name: str
  strategy_stage: str
  query_text: str
  cache_key: str
  cache_hit: bool = False
  status: str = "planned"
  http_status: int | None = None
  retryable: bool = False
  raw_response: dict[str, Any] = field(default_factory=dict)
  warnings: list[str] = field(default_factory=list)

  def to_dict(self) -> dict[str, Any]:
    return asdict(self)


@dataclass(slots=True)
class ProviderCandidate:
  provider_name: str
  provider_record_id: str
  title: str | None
  authors: list[str] = field(default_factory=list)
  year: str | None = None
  publisher: str | None = None
  journal: str | None = None
  source_url: str | None = None
  download_url: str | None = None
  preview_url: str | None = None
  file_format: str | None = None
  file_size_bytes: int | None = None
  identifiers: dict[str, str] = field(default_factory=dict)
  availability: str = "unknown"
  candidate_score: float = 0.0
  ranking_basis: list[str] = field(default_factory=list)
  risk_flags: list[ProviderRiskFlag] = field(default_factory=list)
  raw_payload: dict[str, Any] = field(default_factory=dict)

  def to_dict(self) -> dict[str, Any]:
    payload = asdict(self)
    payload["risk_flags"] = [flag.to_dict() for flag in self.risk_flags]
    return payload


@dataclass(slots=True)
class ProviderLookupResult:
  provider_name: str
  query_id: str
  dry_run: bool
  attempts: list[ProviderAttemptLog] = field(default_factory=list)
  candidates: list[ProviderCandidate] = field(default_factory=list)
  warnings: list[str] = field(default_factory=list)

  def to_dict(self) -> dict[str, Any]:
    return {
      "provider_name": self.provider_name,
      "query_id": self.query_id,
      "dry_run": self.dry_run,
      "attempts": [attempt.to_dict() for attempt in self.attempts],
      "candidates": [candidate.to_dict() for candidate in self.candidates],
      "warnings": list(self.warnings),
    }


class ProviderTransport(Protocol):
  def fetch(self, provider_name: str, strategy: ProviderQueryStrategy) -> dict[str, Any]:
    ...

