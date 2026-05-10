from __future__ import annotations

from .cluster import cluster_citations
from .models import CitationInput, PurificationResult
from .normalize import normalize_citations


def purify_citations(entries: list[CitationInput]) -> PurificationResult:
  normalized = normalize_citations(entries)
  clusters = cluster_citations(normalized)
  return PurificationResult(normalized_records=normalized, candidate_clusters=clusters)
