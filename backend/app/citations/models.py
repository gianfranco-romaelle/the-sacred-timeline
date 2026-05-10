from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass(slots=True)
class CitationInput:
  original_text: str
  source_kind: str = "unknown"
  source_id: str | None = None
  extracted_doi: str | None = None
  extracted_isbn: str | None = None
  extracted_year: str | None = None
  extracted_journal: str | None = None
  extracted_volume: str | None = None
  extracted_issue: str | None = None
  extracted_pages: str | None = None
  metadata: dict[str, Any] = field(default_factory=dict)

  def to_dict(self) -> dict[str, Any]:
    return asdict(self)


@dataclass(slots=True)
class IdentifierSet:
  doi: str | None = None
  isbn10: str | None = None
  isbn13: str | None = None
  arxiv: str | None = None
  pmid: str | None = None
  url: str | None = None

  def preferred_key(self) -> str | None:
    if self.doi:
      return f"doi:{self.doi}"
    if self.isbn13:
      return f"isbn13:{self.isbn13}"
    if self.isbn10:
      return f"isbn10:{self.isbn10}"
    if self.arxiv:
      return f"arxiv:{self.arxiv}"
    if self.pmid:
      return f"pmid:{self.pmid}"
    return None

  def any(self) -> bool:
    return any([self.doi, self.isbn10, self.isbn13, self.arxiv, self.pmid, self.url])

  def to_dict(self) -> dict[str, Any]:
    return asdict(self)


@dataclass(slots=True)
class NormalizedCitation:
  id: str
  source_id: str | None
  source_kind: str
  original_text: str
  cleaned_text: str
  normalized_text: str
  citation_type: str
  title: str | None
  title_normalized: str | None
  title_aliases: list[str] = field(default_factory=list)
  authors: list[str] = field(default_factory=list)
  author_aliases: list[str] = field(default_factory=list)
  year: str | None = None
  journal: str | None = None
  publisher: str | None = None
  volume: str | None = None
  issue: str | None = None
  pages: str | None = None
  identifiers: IdentifierSet = field(default_factory=IdentifierSet)
  strict_fingerprint: str = ""
  fuzzy_fingerprint: str = ""
  normalization_confidence: float = 0.0
  warnings: list[str] = field(default_factory=list)
  metadata: dict[str, Any] = field(default_factory=dict)

  def to_dict(self) -> dict[str, Any]:
    payload = asdict(self)
    payload["identifiers"] = self.identifiers.to_dict()
    return payload


@dataclass(slots=True)
class CandidateWorkCluster:
  id: str
  work_key: str
  member_ids: list[str] = field(default_factory=list)
  representative_title: str | None = None
  representative_authors: list[str] = field(default_factory=list)
  representative_year: str | None = None
  citation_type: str = "unknown"
  aliases: list[str] = field(default_factory=list)
  confidence: float = 0.0
  warnings: list[str] = field(default_factory=list)
  merge_basis: list[str] = field(default_factory=list)

  def to_dict(self) -> dict[str, Any]:
    return asdict(self)


@dataclass(slots=True)
class PurificationResult:
  normalized_records: list[NormalizedCitation] = field(default_factory=list)
  candidate_clusters: list[CandidateWorkCluster] = field(default_factory=list)

  def to_dict(self) -> dict[str, Any]:
    return {
      "normalized_records": [item.to_dict() for item in self.normalized_records],
      "candidate_clusters": [item.to_dict() for item in self.candidate_clusters],
    }
