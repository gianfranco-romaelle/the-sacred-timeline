from __future__ import annotations

import hashlib
import re
from typing import Iterable

from .models import CitationInput, IdentifierSet, NormalizedCitation
from .scoring import score_normalization
from .text_utils import ascii_fold as _ascii_fold
from .text_utils import canonical_text, match_text, slug_text
DOI_RE = re.compile(r"(?:https?://(?:dx\.)?doi\.org/)?(10\.\d{4,9}/[-._;()/:a-z0-9]+)", re.IGNORECASE)
ISBN_RE = re.compile(r"\b(?:97[89][-\s]?)?(?:\d[-\s]?){9,12}[\dxX]\b")
ARXIV_RE = re.compile(r"\b(?:arxiv\s*:?\s*)?((?:\d{4}\.\d{4,5}|[a-z\-]+(?:\.[A-Z]{2})?/\d{7}))(?:v\d+)?\b", re.IGNORECASE)
PMID_RE = re.compile(r"\bPMID\s*:?\s*(\d{5,9})\b", re.IGNORECASE)
URL_RE = re.compile(r"https?://\S+", re.IGNORECASE)
YEAR_RE = re.compile(r"\b(1[6-9]\d{2}|20\d{2}|21\d{2})\b")
VOLUME_RE = re.compile(r"\b(?:vol(?:ume)?\.?\s*)([A-Za-z0-9\-]+)\b", re.IGNORECASE)
ISSUE_RE = re.compile(r"\b(?:no\.?|issue)\s*([A-Za-z0-9\-]+)\b", re.IGNORECASE)
PAGES_RE = re.compile(r"\b(?:pp?\.?\s*)?(\d{1,5}\s*[-–]\s*\d{1,5})\b", re.IGNORECASE)

GENERIC_TITLES = {
  "introduction",
  "selected works",
  "collected works",
  "essays",
  "papers",
  "proceedings",
  "handbook",
}
def normalize_doi(value: str | None) -> str | None:
  if not value:
    return None
  match = DOI_RE.search(value)
  if not match:
    return None
  return match.group(1).lower().rstrip(").,;")


def normalize_isbn(value: str | None) -> tuple[str | None, str | None]:
  if not value:
    return (None, None)
  match = ISBN_RE.search(value)
  if not match:
    return (None, None)
  digits = re.sub(r"[^0-9Xx]", "", match.group(0)).upper()
  if len(digits) == 10:
    return (digits, None)
  if len(digits) == 13:
    return (None, digits)
  return (None, None)


def normalize_arxiv(value: str | None) -> str | None:
  if not value:
    return None
  match = ARXIV_RE.search(value)
  if not match:
    return None
  return match.group(1).lower()


def normalize_pmid(value: str | None) -> str | None:
  if not value:
    return None
  match = PMID_RE.search(value)
  if not match:
    return None
  return match.group(1)


def _extract_url(text: str) -> str | None:
  match = URL_RE.search(text or "")
  return match.group(0) if match else None


def _extract_year(text: str, candidate: str | None = None) -> str | None:
  if candidate and YEAR_RE.fullmatch(candidate):
    return candidate
  matches = YEAR_RE.findall(text or "")
  if not matches:
    return None
  years = [item for item in matches if item]
  return years[0] if years else None


def _extract_volume(text: str, candidate: str | None = None) -> str | None:
  if candidate:
    return candidate
  match = VOLUME_RE.search(text or "")
  return match.group(1) if match else None


def _extract_issue(text: str, candidate: str | None = None) -> str | None:
  if candidate:
    return candidate
  match = ISSUE_RE.search(text or "")
  return match.group(1) if match else None


def _extract_pages(text: str, candidate: str | None = None) -> str | None:
  if candidate:
    return candidate
  match = PAGES_RE.search(text or "")
  if not match:
    return None
  return match.group(1).replace(" ", "")


def _extract_authors(text: str, year: str | None) -> list[str]:
  if not text:
    return []
  prefix = text
  if year and year in text:
    prefix = text.split(year, 1)[0]
  prefix = prefix.strip(" .;:,()")
  if not prefix:
    return []
  if re.search(r"\b(?:collected works|selected works|complete works|proceedings|volume|part\s+[ivx\d]+)\b", prefix, re.IGNORECASE):
    return []

  if prefix.count(",") >= 3:
    comma_parts = [item.strip() for item in prefix.split(",") if item.strip()]
    if len(comma_parts) % 2 == 0:
      results = []
      for index in range(0, len(comma_parts), 2):
        results.append(f"{comma_parts[index]}, {comma_parts[index + 1]}")
      return results[:6]

  chunks = re.split(r"\s+(?:and|&)\s+|;\s*", prefix, flags=re.IGNORECASE)
  authors = []
  for chunk in chunks:
    candidate = chunk.strip(" ,.;:")
    if not candidate:
      continue
    words = candidate.split()
    if len(words) > 8:
      continue
    if re.search(r"\b(editor|edited|translator|translation|press|journal|university)\b", candidate, re.IGNORECASE):
      continue
    authors.append(candidate)
  return authors[:6]


def _extract_title(text: str, year: str | None, journal: str | None) -> str | None:
  quoted = re.search(r'"([^"]{4,})"', text or "")
  if quoted:
    return quoted.group(1).strip()

  working = str(text or "")
  prefix = ""
  if year and year in working:
    prefix = working.split(year, 1)[0].strip(" .;:,()")
    working = working.split(year, 1)[1]
  working = working.strip(" .;:,()")
  if not working:
    if prefix:
      prefix_segments = [item.strip(" .;:,()") for item in re.split(r"\.\s+|:\s+", prefix) if item.strip(" .;:,()")]
      return prefix_segments[0] if prefix_segments else None
    return None
  if re.search(r"\bIn:\b", working, re.IGNORECASE):
    working = re.split(r"\bIn:\b", working, maxsplit=1, flags=re.IGNORECASE)[0]
  if journal and journal in working:
    working = working.split(journal, 1)[0]
  segments = [item.strip(" .;:,()") for item in re.split(r"\.\s+|:\s+", working) if item.strip(" .;:,()")]
  if not segments:
    return None
  for segment in segments:
    if len(segment.split()) < 2:
      continue
    if re.search(r"\b(?:journal|press|university|pages|volume|number|doi|isbn|arxiv|pmid)\b", segment, re.IGNORECASE):
      continue
    return segment
  title_candidate = segments[0] if segments else None
  if title_candidate and re.search(r"\b(?:press|university|publisher)\b", title_candidate, re.IGNORECASE) and prefix:
    prefix_segments = [item.strip(" .;:,()") for item in re.split(r"\.\s+|:\s+", prefix) if item.strip(" .;:,()")]
    for segment in prefix_segments:
      if len(segment.split()) >= 2:
        return segment
  return title_candidate


def _extract_publisher(text: str, citation_type: str) -> str | None:
  segments = [item.strip(" .;:,()") for item in re.split(r"\.\s+", text or "") if item.strip(" .;:,()")]
  for segment in segments:
    if re.search(r"\b(?:press|university|publisher|dissertation|thesis)\b", segment, re.IGNORECASE):
      return segment
  return None


def _extract_journal(text: str, candidate: str | None = None) -> str | None:
  if candidate:
    return candidate
  segments = [item.strip(" .;:,()") for item in re.split(r"\.\s+", text or "") if item.strip(" .;:,()")]
  for segment in segments:
    if re.search(r"\b(?:journal|review|transactions|proceedings|annals|letters)\b", segment, re.IGNORECASE):
      return segment
  return None


def infer_citation_type(text: str, identifiers: IdentifierSet, journal: str | None, publisher: str | None) -> str:
  lowered = match_text(text)
  if identifiers.arxiv or " preprint " in f" {lowered} " or " arxiv " in f" {lowered} ":
    return "preprint"
  if identifiers.url and any(marker in lowered for marker in ["accessed", "retrieved", "available at", "http://", "https://"]):
    return "webpage"
  if re.search(r"\b(ph\.?\s*d|thesis|dissertation)\b", lowered, re.IGNORECASE):
    return "thesis"
  if re.search(r"\bin\b", lowered) and re.search(r"\b(?:edited by|editor|editors)\b", lowered):
    return "chapter"
  if journal or identifiers.doi or re.search(r"\b\d+\(\d+\)\b", text or "") or PAGES_RE.search(text or ""):
    return "article"
  if identifiers.isbn10 or identifiers.isbn13 or publisher:
    return "book"
  return "webpage" if identifiers.url else "unknown"


def build_author_aliases(authors: Iterable[str]) -> list[str]:
  aliases: list[str] = []
  seen: set[str] = set()
  for author in authors:
    candidate = canonical_text(author)
    if not candidate:
      continue
    parts = [item for item in re.split(r"\s+", candidate.replace(",", " ")) if item]
    if len(parts) >= 2:
      first, last = parts[0], parts[-1]
      variants = [
        candidate,
        f"{last}, {first}",
        f"{last} {first[0]}.",
        f"{first[0]}. {last}",
      ]
    else:
      variants = [candidate]
    for variant in variants:
      normalized = variant.strip()
      key = normalized.lower()
      if normalized and key not in seen:
        seen.add(key)
        aliases.append(normalized)
  return aliases


def build_title_aliases(title: str | None) -> list[str]:
  if not title:
    return []
  cleaned = canonical_text(title)
  variants = {
    cleaned,
    _ascii_fold(cleaned),
    re.split(r":\s+|- ", cleaned, maxsplit=1)[0].strip(),
    re.sub(r"\b(the|a|an)\b", "", match_text(cleaned)).strip(),
  }
  return [item for item in sorted(variants) if item]


def build_strict_fingerprint(title: str | None, authors: list[str], year: str | None, citation_type: str, identifiers: IdentifierSet) -> str:
  preferred = identifiers.preferred_key()
  if preferred:
    return preferred
  author_key = slug_text(authors[0]) if authors else "anon"
  title_key = slug_text(title or "")
  return f"{citation_type}|{author_key}|{title_key}|{year or 'unknown'}"


def build_fuzzy_fingerprint(title: str | None, authors: list[str], year: str | None, citation_type: str) -> str:
  title_terms = [item for item in match_text(title or "").split() if len(item) > 2][:6]
  author_terms = [slug_text(item).split("-")[0] for item in authors[:2]]
  year_bucket = year or "unknown"
  return "|".join([citation_type, "-".join(sorted(title_terms)), "-".join(sorted(author_terms)), year_bucket])


def collect_warnings(
  title: str | None,
  text: str,
  citation_type: str,
  authors: list[str],
  identifiers: IdentifierSet,
) -> list[str]:
  warnings: list[str] = []
  title_key = match_text(title or "")
  if title_key in GENERIC_TITLES or len(title_key.split()) <= 2:
    warnings.append("common_title")
  if re.search(r"\b(?:vol(?:ume)?\.?\s*[ivx\d]+|part\s+[ivx\d]+|tome\s+[ivx\d]+)\b", text, re.IGNORECASE):
    warnings.append("multivolume_work")
  if re.search(r"\b(?:translated by|translation by|translated|translator|trans\.)\b", text, re.IGNORECASE):
    warnings.append("translated_work")
  if re.search(r"\b(?:collected works|selected works|selected papers|complete works)\b", text, re.IGNORECASE):
    warnings.append("collected_works")
  if re.search(r"\b(?:edited by|editor|editors|eds?\.)\b", text, re.IGNORECASE):
    warnings.append("edited_volume")
  if citation_type == "article" and (identifiers.isbn10 or identifiers.isbn13):
    warnings.append("probable_wrong_edition_collision")
  if not authors:
    warnings.append("missing_author")
  if not title:
    warnings.append("missing_title")
  return warnings


def normalize_citation(entry: CitationInput, *, record_id: str | None = None) -> NormalizedCitation:
  original = str(entry.original_text or "").strip()
  cleaned = canonical_text(original)
  normalized = match_text(original)

  doi = normalize_doi(entry.extracted_doi or original)
  isbn10, isbn13 = normalize_isbn(entry.extracted_isbn or original)
  arxiv = normalize_arxiv(original)
  pmid = normalize_pmid(original)
  url = _extract_url(original)
  identifiers = IdentifierSet(doi=doi, isbn10=isbn10, isbn13=isbn13, arxiv=arxiv, pmid=pmid, url=url)

  year = _extract_year(original, entry.extracted_year)
  journal = _extract_journal(cleaned, entry.extracted_journal)
  volume = _extract_volume(original, entry.extracted_volume)
  issue = _extract_issue(original, entry.extracted_issue)
  pages = _extract_pages(original, entry.extracted_pages)

  authors = _extract_authors(cleaned, year)
  title = _extract_title(cleaned, year, journal)
  provisional_type = infer_citation_type(cleaned, identifiers, journal, None)
  publisher = _extract_publisher(cleaned, provisional_type)
  citation_type = infer_citation_type(cleaned, identifiers, journal, publisher)

  title_aliases = build_title_aliases(title)
  author_aliases = build_author_aliases(authors)
  warnings = collect_warnings(title, cleaned, citation_type, authors, identifiers)

  stable_id = record_id or hashlib.sha1(
    f"{entry.source_id or ''}|{original}".encode("utf-8", errors="ignore")
  ).hexdigest()[:16]
  strict_fingerprint = build_strict_fingerprint(title, authors, year, citation_type, identifiers)
  fuzzy_fingerprint = build_fuzzy_fingerprint(title, authors, year, citation_type)

  record = NormalizedCitation(
    id=f"purified-{stable_id}",
    source_id=entry.source_id,
    source_kind=entry.source_kind,
    original_text=original,
    cleaned_text=cleaned,
    normalized_text=normalized,
    citation_type=citation_type,
    title=title,
    title_normalized=match_text(title or "") or None,
    title_aliases=title_aliases,
    authors=authors,
    author_aliases=author_aliases,
    year=year,
    journal=journal,
    publisher=publisher,
    volume=volume,
    issue=issue,
    pages=pages,
    identifiers=identifiers,
    strict_fingerprint=strict_fingerprint,
    fuzzy_fingerprint=fuzzy_fingerprint,
    warnings=warnings,
    metadata=dict(entry.metadata),
  )
  record.normalization_confidence = score_normalization(record)
  return record


def normalize_citations(entries: list[CitationInput]) -> list[NormalizedCitation]:
  return [normalize_citation(entry) for entry in entries]
