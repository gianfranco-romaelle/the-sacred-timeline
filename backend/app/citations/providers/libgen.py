from __future__ import annotations

from typing import Any

from .base import CitationLookupProviderBase
from .models import AcquisitionQuery, ProviderCandidate, ProviderQueryStrategy, ProviderRiskFlag


class LibraryGenesisProvider(CitationLookupProviderBase):
  name = "libgen"
  detail = "Library Genesis adapter stub"
  supported_identifier_types = ("doi", "isbn13", "isbn10")

  def parse_candidates(
    self,
    raw_payload: dict[str, Any],
    strategy: ProviderQueryStrategy,
    query: AcquisitionQuery,
  ) -> list[ProviderCandidate]:
    items = list(raw_payload.get("results") or [])
    candidates: list[ProviderCandidate] = []
    for item in items:
      candidates.append(
        ProviderCandidate(
          provider_name=self.name,
          provider_record_id=str(item.get("id") or item.get("md5") or item.get("identifier") or ""),
          title=item.get("title"),
          authors=list(item.get("authors") or []),
          year=str(item.get("year")) if item.get("year") else None,
          publisher=item.get("publisher"),
          file_format=item.get("extension") or item.get("file_format"),
          file_size_bytes=item.get("filesize"),
          source_url=item.get("source_url"),
          download_url=item.get("download_url"),
          identifiers={
            key: value
            for key, value in {
              "doi": item.get("doi"),
              "isbn13": item.get("isbn13"),
              "isbn10": item.get("isbn10"),
              "md5": item.get("md5"),
            }.items()
            if value
          },
          availability=item.get("availability") or "unknown",
          raw_payload=dict(item),
        )
      )
    return candidates

  def provider_risk_flags(self, candidate: ProviderCandidate) -> list[ProviderRiskFlag]:
    flags = [
      ProviderRiskFlag(
        code="mirror_variability",
        severity="warning",
        message="Mirror selection and record stability may vary across Library Genesis instances.",
      )
    ]
    if not candidate.identifiers.get("isbn13") and not candidate.identifiers.get("doi"):
      flags.append(
        ProviderRiskFlag(
          code="metadata_mismatch_risk",
          severity="warning",
          message="Record lacks strong identifiers and should be manually reviewed.",
        )
      )
    return flags
