from __future__ import annotations

from .base import CitationLookupProviderBase
from .models import AcquisitionQuery, ProviderCandidate, ProviderQueryStrategy, ProviderRiskFlag


class SciHubProvider(CitationLookupProviderBase):
  name = "scihub"
  detail = "Sci-Hub adapter stub"
  supported_identifier_types = ("doi", "pmid")

  def build_exact_query(self, query: AcquisitionQuery) -> str | None:
    if query.identifiers.doi:
      return None
    return super().build_exact_query(query)

  def parse_candidates(
    self,
    raw_payload: dict[str, object],
    strategy: ProviderQueryStrategy,
    query: AcquisitionQuery,
  ) -> list[ProviderCandidate]:
    items = list(raw_payload.get("results") or [])
    candidates: list[ProviderCandidate] = []
    for item in items:
      candidates.append(
        ProviderCandidate(
          provider_name=self.name,
          provider_record_id=str(item.get("id") or item.get("doi") or item.get("pmid") or ""),
          title=item.get("title"),
          authors=list(item.get("authors") or []),
          year=str(item.get("year")) if item.get("year") else None,
          journal=item.get("journal"),
          source_url=item.get("source_url"),
          download_url=item.get("download_url"),
          preview_url=item.get("preview_url"),
          file_format=item.get("file_format") or "pdf",
          identifiers={
            key: value
            for key, value in {
              "doi": item.get("doi"),
              "pmid": item.get("pmid"),
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
        code="legal_access_risk",
        severity="critical",
        message="Sci-Hub results require explicit manual policy review before any downstream action.",
      )
    ]
    if not candidate.identifiers.get("doi"):
      flags.append(
        ProviderRiskFlag(
          code="missing_doi_anchor",
          severity="warning",
          message="Candidate lacks a DOI anchor and may be a weak match.",
        )
      )
    return flags
