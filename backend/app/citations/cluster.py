from __future__ import annotations

import hashlib
from collections import defaultdict

from .models import CandidateWorkCluster, NormalizedCitation
from .scoring import cluster_confidence, compatibility_score, likely_wrong_edition_collision


class UnionFind:
  def __init__(self, items: list[str]) -> None:
    self.parent = {item: item for item in items}

  def find(self, item: str) -> str:
    parent = self.parent[item]
    if parent != item:
      self.parent[item] = self.find(parent)
    return self.parent[item]

  def union(self, left: str, right: str) -> None:
    left_root = self.find(left)
    right_root = self.find(right)
    if left_root != right_root:
      self.parent[right_root] = left_root


def _cluster_id(seed: str) -> str:
  return f"cluster-{hashlib.sha1(seed.encode('utf-8', errors='ignore')).hexdigest()[:12]}"


def _best_representative(records: list[NormalizedCitation]) -> NormalizedCitation:
  return sorted(
    records,
    key=lambda item: (
      item.normalization_confidence,
      bool(item.identifiers.preferred_key()),
      len(item.title or ""),
    ),
    reverse=True,
  )[0]


def cluster_citations(records: list[NormalizedCitation]) -> list[CandidateWorkCluster]:
  if not records:
    return []

  union = UnionFind([record.id for record in records])
  by_identifier: dict[str, list[NormalizedCitation]] = defaultdict(list)
  for record in records:
    preferred = record.identifiers.preferred_key()
    if preferred:
      by_identifier[preferred].append(record)
  for group in by_identifier.values():
    for index in range(1, len(group)):
      union.union(group[0].id, group[index].id)

  for index, left in enumerate(records):
    for right in records[index + 1:]:
      score, pair_warnings = compatibility_score(left, right)
      if "probable_wrong_edition_collision" in pair_warnings:
        if "probable_wrong_edition_collision" not in left.warnings:
          left.warnings.append("probable_wrong_edition_collision")
        if "probable_wrong_edition_collision" not in right.warnings:
          right.warnings.append("probable_wrong_edition_collision")
      if score >= 0.88 and "cross_type_collision" not in pair_warnings and not likely_wrong_edition_collision(left, right):
        union.union(left.id, right.id)
      elif score >= 0.8:
        warning = f"possible_same_work:{right.id}"
        if warning not in left.warnings:
          left.warnings.append(warning)
        warning = f"possible_same_work:{left.id}"
        if warning not in right.warnings:
          right.warnings.append(warning)

  grouped: dict[str, list[NormalizedCitation]] = defaultdict(list)
  for record in records:
    grouped[union.find(record.id)].append(record)

  clusters: list[CandidateWorkCluster] = []
  for root_id, members in grouped.items():
    representative = _best_representative(members)
    aliases = sorted({alias for member in members for alias in ([member.title or ""] + member.title_aliases + member.author_aliases) if alias})
    member_scores: list[float] = []
    merge_basis: list[str] = []
    warnings = sorted({warning for member in members for warning in member.warnings if not warning.startswith("possible_same_work:")})

    if len(members) == 1:
      member_scores.append(members[0].normalization_confidence)
      merge_basis.append("singleton")
    else:
      for index, left in enumerate(members):
        for right in members[index + 1:]:
          score, pair_warnings = compatibility_score(left, right)
          member_scores.append(score)
          warnings.extend(pair_warnings)
          if left.identifiers.preferred_key() and left.identifiers.preferred_key() == right.identifiers.preferred_key():
            merge_basis.append("shared_identifier")
          elif score >= 0.93:
            merge_basis.append("strong_fuzzy_match")
          else:
            merge_basis.append("conservative_grouping")

    confidence = cluster_confidence(member_scores or [representative.normalization_confidence])
    clusters.append(
      CandidateWorkCluster(
        id=_cluster_id(root_id),
        work_key=representative.strict_fingerprint,
        member_ids=[item.id for item in sorted(members, key=lambda item: item.id)],
        representative_title=representative.title,
        representative_authors=list(representative.authors),
        representative_year=representative.year,
        citation_type=representative.citation_type,
        aliases=aliases,
        confidence=confidence,
        warnings=sorted(set(warnings)),
        merge_basis=sorted(set(merge_basis)),
      )
    )

  return sorted(clusters, key=lambda item: (-len(item.member_ids), -item.confidence, item.id))
