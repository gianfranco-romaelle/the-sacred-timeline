from __future__ import annotations

import math
import re
from difflib import SequenceMatcher

from .models import NormalizedCitation
from .text_utils import canonical_text
from .text_utils import match_text, slug_text


def score_normalization(record: NormalizedCitation) -> float:
  score = 0.15
  if record.title:
    score += 0.25
  if record.authors:
    score += 0.2
  if record.year:
    score += 0.12
  if record.identifiers.any():
    score += 0.18
  if record.journal or record.publisher:
    score += 0.05
  if record.volume or record.pages:
    score += 0.03
  if record.citation_type != "unknown":
    score += 0.04
  penalties = 0.0
  if "missing_title" in record.warnings:
    penalties += 0.18
  if "missing_author" in record.warnings:
    penalties += 0.1
  if "common_title" in record.warnings:
    penalties += 0.06
  return round(max(0.05, min(0.99, score - penalties)), 3)


def _author_keys(record: NormalizedCitation) -> set[str]:
  keys: set[str] = set()
  for author in record.authors:
    raw = canonical_text(author)
    if not raw:
      continue
    if "," in raw:
      family = raw.split(",", 1)[0].strip()
      if family:
        keys.add(slug_text(family))
        continue
    parts = [item for item in re.split(r"\s+", raw) if item]
    if parts:
      keys.add(slug_text(parts[-1]))
  return keys


def _token_similarity(left: str | None, right: str | None) -> float:
  left_text = match_text(left or "")
  right_text = match_text(right or "")
  if not left_text or not right_text:
    return 0.0
  left_tokens = set(left_text.split())
  right_tokens = set(right_text.split())
  overlap = len(left_tokens & right_tokens) / max(len(left_tokens | right_tokens), 1)
  ordered = SequenceMatcher(None, left_text, right_text).ratio()
  return round((overlap * 0.6) + (ordered * 0.4), 3)


def likely_wrong_edition_collision(left: NormalizedCitation, right: NormalizedCitation) -> bool:
  if left.identifiers.isbn13 and right.identifiers.isbn13 and left.identifiers.isbn13 != right.identifiers.isbn13:
    return True
  if left.identifiers.isbn10 and right.identifiers.isbn10 and left.identifiers.isbn10 != right.identifiers.isbn10:
    return True
  if left.volume and right.volume and left.volume != right.volume:
    return True
  if left.year and right.year:
    try:
      if abs(int(left.year) - int(right.year)) >= 8 and left.citation_type == right.citation_type == "book":
        return True
    except ValueError:
      return False
  return False


def compatibility_score(left: NormalizedCitation, right: NormalizedCitation) -> tuple[float, list[str]]:
  warnings: list[str] = []
  left_key = left.identifiers.preferred_key()
  right_key = right.identifiers.preferred_key()
  if left_key and right_key and left_key == right_key:
    return (0.99, warnings)
  if left.identifiers.doi and right.identifiers.doi and left.identifiers.doi == right.identifiers.doi:
    return (0.99, warnings)

  title_score = _token_similarity(left.title, right.title)
  author_overlap = len(_author_keys(left) & _author_keys(right))
  author_total = max(len(_author_keys(left) | _author_keys(right)), 1)
  author_score = author_overlap / author_total if author_total else 0.0
  year_score = 0.0
  if left.year and right.year:
    try:
      delta = abs(int(left.year) - int(right.year))
      year_score = 1.0 if delta == 0 else (0.75 if delta == 1 else (0.4 if delta <= 3 else 0.0))
    except ValueError:
      year_score = 0.0
  type_score = 1.0 if left.citation_type == right.citation_type else 0.35
  venue_score = _token_similarity(left.journal or left.publisher, right.journal or right.publisher)

  score = (title_score * 0.45) + (author_score * 0.25) + (year_score * 0.15) + (type_score * 0.1) + (venue_score * 0.05)
  if title_score >= 0.84 and author_score >= 0.99 and year_score >= 0.75:
    score += 0.07
  if likely_wrong_edition_collision(left, right):
    score -= 0.22
    warnings.append("probable_wrong_edition_collision")
  if left.citation_type != right.citation_type and {left.citation_type, right.citation_type} == {"book", "article"}:
    warnings.append("cross_type_collision")
  if title_score >= 0.78 and score < 0.9:
    warnings.append("ambiguous_similar_title")

  return (round(max(0.0, min(0.99, score)), 3), warnings)


def cluster_confidence(member_scores: list[float]) -> float:
  if not member_scores:
    return 0.0
  mean = sum(member_scores) / len(member_scores)
  variance = sum((item - mean) ** 2 for item in member_scores) / len(member_scores)
  stability_bonus = max(0.0, 0.08 - math.sqrt(variance))
  return round(max(0.05, min(0.99, mean + stability_bonus)), 3)
