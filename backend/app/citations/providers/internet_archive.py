from __future__ import annotations

from .base import CitationLookupProviderBase
from .models import AcquisitionQuery, ProviderCandidate, ProviderQueryStrategy, ProviderRiskFlag


class InternetArchiveProvider(CitationLookupProviderBase):
  name = "internet_archive"
  detail = "Internet Archive adapter stub"
  supported_identifier_types = ("isbn13", "isbn10", "doi")

  def parse_candidates(
    self,
    raw_payload: dict[str, object],
    strategy: ProviderQueryStrategy,
    query: AcquisitionQuery,
  ) -> list[ProviderCandidate]:
    items = list(raw_payload.get("docs") or raw_payload.get("results") or [])
    candidates: list[ProviderCandidate] = []
    for item in items:
      candidates.append(
        ProviderCandidate(
          provider_name=self.name,
          provider_record_id=str(item.get("identifier") or item.get("id") or ""),
          title=item.get("title"),
          authors=list(item.get("authors") or item.get("creator") or []),
          year=str(item.get("year")) if item.get("year") else None,
          publisher=item.get("publisher"),
          source_url=item.get("source_url"),
          preview_url=item.get("preview_url"),
          file_format=item.get("file_format"),
          identifiers={
            key: value
            for key, value in {
              "isbn13": item.get("isbn13"),
              "isbn10": item.get("isbn10"),
              "ia_identifier": item.get("identifier"),
              "doi": item.get("doi"),
            }.items()
            if value
          },
          availability=item.get("availability") or "borrowable",
          raw_payload=dict(item),
        )
      )
    return candidates

  def provider_risk_flags(self, candidate: ProviderCandidate) -> list[ProviderRiskFlag]:
    flags = []
    if candidate.availability in {"borrowable", "restricted"}:
      flags.append(
        ProviderRiskFlag(
          code="borrow_required",
          severity="info",
          message="Candidate may require borrow or access controls rather than direct acquisition.",
        )
      )
    flags.append(
      ProviderRiskFlag(
        code="scan_quality_variability",
        severity="warning",
        message="Archive scans and metadata quality may vary across items and should be reviewed manually.",
      )
    )
    return flags
