from __future__ import annotations

import hashlib
import re
from pathlib import Path
from typing import Any


BIBLIOGRAPHY_HEADING_RE = re.compile(
  r"^\s*(references|bibliography|works cited|sources|further reading|notes and references|works consulted|references cited)\s*[:.\-]?\s*$",
  re.IGNORECASE,
)
SECTION_HEADING_RE = re.compile(r"^\s*[A-Z][A-Z0-9\s:,'\-\(\)]{3,}\s*$")
FOOTNOTE_LINE_RE = re.compile(r"^\s*(\[(?P<bracket>\d+)\]|(?P<number>\d+)[\].)]|(?P<symbol>[\*\u2020\u2021]))\s+(?P<text>.+)$", re.MULTILINE)
NUMBERED_ENTRY_RE = re.compile(r"^\s*(?:\[\d+\]|\d+[\].)])\s+")
AUTHOR_YEAR_ENTRY_RE = re.compile(r"^\s*[A-Z][A-Za-z'`\-]+(?:,\s*[A-Z][A-Za-z'`\-\.]+)+(?:.*?\b(?:1[6-9]\d{2}|20\d{2}|21\d{2})[a-z]?\b)")
AUTHOR_YEAR_MENTION_RE = re.compile(r"\((?P<body>[^()]{0,180}?\b(?:1[6-9]\d{2}|20\d{2}|21\d{2})[a-z]?(?:[^()]*)?)\)")
NUMERIC_MENTION_RE = re.compile(r"\[(?P<body>\d+(?:\s*[-,]\s*\d+)*)\]")
DOI_RE = re.compile(r"\b10\.\d{4,9}/[-._;()/:A-Za-z0-9]+\b", re.IGNORECASE)
URL_RE = re.compile(r"https?://\S+", re.IGNORECASE)
ISBN_RE = re.compile(r"\b(?:97[89][-\s]?)?(?:\d[-\s]?){9,12}[\dX]\b", re.IGNORECASE)
YEAR_RE = re.compile(r"\b(1[6-9]\d{2}|20\d{2}|21\d{2})([a-z])?\b")
COMMENTARY_HINT_RE = re.compile(r"\b(argues?|suggests?|however|therefore|compare|contra|see also|note that|cf\.?)\b", re.IGNORECASE)
CONTAINER_HINT_RE = re.compile(r"\b(journal|press|review|proceedings|vol\.|no\.|pp\.|pages?)\b", re.IGNORECASE)
PAGE_REF_RE = re.compile(r"\b(?:p|pp)\.?\s*\d", re.IGNORECASE)
QUOTED_TEXT_RE = re.compile(r'["\u201c\u201d](.+?)["\u201c\u201d]')
TITLE_TOKEN_RE = re.compile(r"[A-Za-z]{4,}")


def _normalize_text(value: str) -> str:
  return re.sub(r"\s+", " ", str(value or "")).strip()


def _stable_id(prefix: str, *parts: object) -> str:
  digest = hashlib.sha1("||".join(str(part) for part in parts).encode("utf-8", errors="ignore")).hexdigest()[:16]
  return f"{prefix}-{digest}"


def _split_lines(text: str) -> list[str]:
  return [line.rstrip() for line in str(text or "").splitlines()]


def _extract_identifier(text: str, pattern: re.Pattern[str]) -> str | None:
  match = pattern.search(text or "")
  if not match:
    return None
  return _normalize_text(match.group(0))


def _line_indent(raw_line: str) -> int:
  return len(str(raw_line or "")) - len(str(raw_line or "").lstrip(" \t"))


def _strip_entry_prefix(text: str) -> tuple[str, int | None]:
  raw = str(text or "")
  numbered_match = re.match(r"^\s*(?:\[(\d+)\]|(\d+)[\].)])\s+(?P<body>.+)$", raw)
  if not numbered_match:
    return (_normalize_text(raw), None)
  ordinal = numbered_match.group(1) or numbered_match.group(2)
  return (_normalize_text(numbered_match.group("body")), int(ordinal) if ordinal else None)


def _looks_like_freeform_entry_start(text: str) -> bool:
  cleaned = _normalize_text(text)
  if len(cleaned) < 12:
    return False
  if NUMBERED_ENTRY_RE.match(cleaned) or AUTHOR_YEAR_ENTRY_RE.match(cleaned):
    return True
  if YEAR_RE.search(cleaned) and re.match(r"^[A-Z][A-Za-z'`\-]+,\s+[A-Z]", cleaned):
    return True
  if re.match(r"^[A-Z][A-Za-z'`\-]+,\s+[A-Z].{6,}$", cleaned) and "." in cleaned[:80]:
    return True
  return False


def _looks_like_bibliography_entry_start(text: str) -> bool:
  cleaned, _ = _strip_entry_prefix(text)
  cleaned = _normalize_text(cleaned)
  if len(cleaned) < 8:
    return False
  if AUTHOR_YEAR_ENTRY_RE.match(cleaned) or _looks_like_freeform_entry_start(cleaned):
    return True
  if DOI_RE.search(cleaned) or URL_RE.search(cleaned) or ISBN_RE.search(cleaned):
    return True
  if COMMENTARY_HINT_RE.search(cleaned) and not CONTAINER_HINT_RE.search(cleaned):
    return False
  return False


def _segment_title_remainder(text: str) -> list[str]:
  segments = [part.strip(" .;:") for part in re.split(r"\.\s+|:\s+", _normalize_text(text)) if part.strip(" .;:")]
  return [segment for segment in segments if segment]


def _parse_author_blob(author_blob: str) -> list[str]:
  cleaned = _normalize_text(author_blob).strip(" .,;:()")
  if not cleaned:
    return []
  cleaned = re.sub(r"\bet al\.?$", "", cleaned, flags=re.IGNORECASE).strip(" ,;")
  if not cleaned:
    return []

  if ";" in cleaned:
    return [_normalize_text(part) for part in cleaned.split(";") if _normalize_text(part)]

  if re.search(r"\s+(?:and|&)\s+", cleaned, re.IGNORECASE):
    parts = re.split(r"\s+(?:and|&)\s+", cleaned, flags=re.IGNORECASE)
    return [_normalize_text(part) for part in parts if _normalize_text(part)]

  if cleaned.count(",") >= 3:
    comma_parts = [part.strip() for part in cleaned.split(",") if part.strip()]
    if len(comma_parts) % 2 == 0:
      paired = []
      for index in range(0, len(comma_parts), 2):
        paired.append(f"{comma_parts[index]}, {comma_parts[index + 1]}")
      return paired

  return [cleaned]


def _entry_title_tokens(entry: dict[str, Any]) -> set[str]:
  title = _normalize_text(entry.get("title") or "")
  return {token.lower() for token in TITLE_TOKEN_RE.findall(title)}


def _parse_bibliography_entry(raw_text: str, *, line_count: int = 1, entry_kind: str = "freeform") -> dict[str, Any]:
  normalized, ordinal = _strip_entry_prefix(raw_text)
  year_match = YEAR_RE.search(normalized)
  year = year_match.group(0) if year_match else None
  doi = _extract_identifier(normalized, DOI_RE)
  url = _extract_identifier(normalized, URL_RE)
  isbn = _extract_identifier(normalized, ISBN_RE)
  authors: list[str] = []
  title = None
  container_title = None
  publisher = None
  volume = None
  issue = None
  pages = None
  warnings: list[str] = []

  if year_match:
    author_blob = normalized[:year_match.start()].strip(" .,;:()")
    if author_blob:
      authors = _parse_author_blob(author_blob)
    remainder = normalized[year_match.end():].strip(" .")
  else:
    parts = _segment_title_remainder(normalized)
    if parts and re.match(r"^[A-Z][A-Za-z'`\-]+,\s+[A-Z]", parts[0]):
      authors = _parse_author_blob(parts[0])
      remainder = ". ".join(parts[1:])
    elif parts:
      authors = _parse_author_blob(parts[0])
      remainder = ". ".join(parts[1:]) if len(parts) > 1 else normalized
    else:
      remainder = normalized

  quoted_title = None
  quoted_match = QUOTED_TEXT_RE.search(remainder)
  if quoted_match:
    quoted_title = _normalize_text(quoted_match.group(1))
  remainder_parts = _segment_title_remainder(remainder)
  if quoted_title:
    title = quoted_title
  if remainder_parts:
    title = title or remainder_parts[0]
  if len(remainder_parts) > 1:
    container_title = remainder_parts[1]
  if len(remainder_parts) > 2:
    publisher = remainder_parts[2]

  volume_match = re.search(r"\bvol\.?\s*([A-Za-z0-9\-]+)", normalized, re.IGNORECASE)
  if volume_match:
    volume = volume_match.group(1)
  issue_match = re.search(r"\bno\.?\s*([A-Za-z0-9\-]+)", normalized, re.IGNORECASE)
  if issue_match:
    issue = issue_match.group(1)
  pages_match = re.search(r"\bpp?\.?\s*([0-9\-–]+)", normalized, re.IGNORECASE)
  if pages_match:
    pages = pages_match.group(1)

  parse_status = "parsed"
  confidence = 0.35
  if authors:
    confidence += 0.15
  if year:
    confidence += 0.15
  if title:
    confidence += 0.1
  if container_title or publisher:
    confidence += 0.08
  if doi or url or isbn:
    confidence += 0.1
  if line_count > 1:
    confidence += 0.05
  if entry_kind in {"numbered", "author_year"}:
    confidence += 0.05

  resolved_fields = sum(
    1 for value in (authors, year, title, container_title, publisher, volume, issue, pages, doi, url, isbn)
    if value
  )
  if not authors and not year and not title:
    parse_status = "unresolved"
    confidence = 0.15
    warnings.append("reference lacked clear bibliographic fields")
  elif not (authors and title and (year or doi or url or isbn or container_title)):
    parse_status = "partially_parsed"
    confidence = max(confidence - 0.08, 0.25)
    warnings.append("reference structure is partial or ambiguous")
  elif resolved_fields < 4:
    parse_status = "partially_parsed"
    confidence = max(confidence - 0.04, 0.25)

  if ordinal is None and entry_kind == "numbered":
    warnings.append("numbered reference marker could not be normalized")

  return {
    "ordinal": ordinal,
    "authors": authors,
    "title": title,
    "year": year,
    "container_title": container_title,
    "publisher": publisher,
    "volume": volume,
    "issue": issue,
    "pages": pages,
    "doi": doi,
    "url": url,
    "isbn": isbn,
    "confidence": round(min(confidence, 0.99), 3),
    "parse_status": parse_status,
    "warnings": warnings,
  }


def _split_bibliography_entries(lines: list[str]) -> list[dict[str, Any]]:
  entries: list[dict[str, Any]] = []
  current: list[str] = []
  current_kind = "freeform"
  saw_separator = False

  def flush_current() -> None:
    nonlocal current, current_kind, saw_separator
    if not current:
      return
    joined = " ".join(_normalize_text(part) for part in current if _normalize_text(part))
    if joined:
      entries.append(
        {
          "raw_text": joined,
          "line_count": len(current),
          "entry_kind": current_kind,
        }
      )
    current = []
    current_kind = "freeform"
    saw_separator = False

  for raw_line in lines:
    cleaned = _normalize_text(raw_line)
    if not cleaned:
      if current:
        saw_separator = True
      continue
    starts_numbered = bool(NUMBERED_ENTRY_RE.match(cleaned) and _looks_like_bibliography_entry_start(cleaned))
    starts_author_year = bool(AUTHOR_YEAR_ENTRY_RE.match(cleaned))
    starts_freeform = _looks_like_freeform_entry_start(cleaned)
    indent = _line_indent(raw_line)
    last_text = _normalize_text(current[-1]) if current else ""
    last_complete = bool(last_text and re.search(r"(?:\.\s*$|https?://\S+$|\b10\.\d{4,9}/)", last_text, re.IGNORECASE))
    starts_entry = False
    next_kind = current_kind

    if starts_numbered:
      starts_entry = True
      next_kind = "numbered"
    elif starts_author_year:
      starts_entry = True
      next_kind = "author_year"
    elif starts_freeform and (not current or saw_separator or last_complete) and indent == 0:
      starts_entry = True
      next_kind = "freeform"

    if starts_entry and current:
      flush_current()
    if not current:
      current_kind = next_kind
      current = [raw_line]
      saw_separator = False
      continue
    current.append(raw_line)
    saw_separator = False

  flush_current()
  return entries


def _extract_bibliography_sections(pages: list[dict[str, Any]]) -> list[dict[str, Any]]:
  sections: list[dict[str, Any]] = []
  for page in pages:
    lines = _split_lines(page.get("text", ""))
    active_heading = None
    active_lines: list[str] = []
    for line in lines:
      normalized = _normalize_text(line)
      if not normalized:
        if active_heading and active_lines:
          active_lines.append("")
        continue
      if BIBLIOGRAPHY_HEADING_RE.match(normalized):
        if active_heading and active_lines:
          sections.append({"page_number": int(page.get("number", 1) or 1), "heading": active_heading, "lines": list(active_lines)})
        active_heading = normalized
        active_lines = []
        continue
      if active_heading:
        if SECTION_HEADING_RE.match(normalized) and not NUMBERED_ENTRY_RE.match(normalized):
          if active_lines:
            sections.append({"page_number": int(page.get("number", 1) or 1), "heading": active_heading, "lines": list(active_lines)})
          active_heading = None
          active_lines = []
          continue
        if active_lines and active_lines[-1] == "" and not _looks_like_bibliography_entry_start(normalized):
          sections.append({"page_number": int(page.get("number", 1) or 1), "heading": active_heading, "lines": list(active_lines)})
          active_heading = None
          active_lines = []
          continue
        active_lines.append(normalized)
    if active_heading and active_lines:
      sections.append({"page_number": int(page.get("number", 1) or 1), "heading": active_heading, "lines": list(active_lines)})
  return sections


def _extract_inline_mentions(page_text: str, *, page_number: int) -> list[dict[str, Any]]:
  mentions: list[dict[str, Any]] = []
  for match in AUTHOR_YEAR_MENTION_RE.finditer(page_text or ""):
    body = _normalize_text(match.group("body"))
    if len(body) < 6:
      continue
    year_match = YEAR_RE.search(body)
    target_year = year_match.group(0) if year_match else None
    target_label = body[: year_match.start()].strip(" ,;:") if year_match else body
    mentions.append(
      {
        "page_number": page_number,
        "mention_text": match.group(0),
        "normalized_text": body,
        "mention_type": "author_year",
        "target_label": target_label or None,
        "target_year": target_year,
        "raw_marker": match.group(0),
        "confidence": 0.72 if target_year else 0.45,
        "match_status": "unresolved",
        "warnings": [],
      }
    )
  for match in NUMERIC_MENTION_RE.finditer(page_text or ""):
    body = _normalize_text(match.group("body"))
    if not body:
      continue
    mentions.append(
      {
        "page_number": page_number,
        "mention_text": match.group(0),
        "normalized_text": body,
        "mention_type": "numeric",
        "target_label": None,
        "target_year": None,
        "raw_marker": match.group(0),
        "confidence": 0.61,
        "match_status": "unresolved",
        "warnings": [],
      }
    )
  return mentions


def _classify_note_sentence(sentence: str) -> tuple[str, float]:
  normalized = _normalize_text(sentence)
  if not normalized:
    return ("unknown", 0.0)
  citation_score = 0.0
  if YEAR_RE.search(normalized):
    citation_score += 0.25
  if re.search(r"\b[A-Z][A-Za-z'`\-]+\s+(?:1[6-9]\d{2}|20\d{2}|21\d{2})[a-z]?\b", normalized):
    citation_score += 0.18
  if DOI_RE.search(normalized) or URL_RE.search(normalized) or ISBN_RE.search(normalized):
    citation_score += 0.4
  if CONTAINER_HINT_RE.search(normalized):
    citation_score += 0.18
  if AUTHOR_YEAR_ENTRY_RE.match(normalized):
    citation_score += 0.25
  if PAGE_REF_RE.search(normalized):
    citation_score += 0.12
  if re.search(r"\b(?:ibid|op\.?\s+cit\.?|see)\b", normalized, re.IGNORECASE):
    citation_score += 0.2

  commentary_score = 0.0
  if COMMENTARY_HINT_RE.search(normalized):
    commentary_score += 0.35
  if len(normalized.split()) > 12:
    commentary_score += 0.15
  if ":" in normalized or ";" in normalized:
    commentary_score += 0.1
  if re.search(r"\b(?:because|although|while|whereas|instead)\b", normalized, re.IGNORECASE):
    commentary_score += 0.1

  quotation_score = 0.0
  if QUOTED_TEXT_RE.search(normalized):
    quotation_score += 0.45
  if normalized.startswith(("'", '"', "\u201c")) or normalized.endswith(("'", '"', "\u201d")):
    quotation_score += 0.1

  if citation_score >= 0.3 and commentary_score >= 0.25:
    return ("mixed", round(min(0.95, 0.4 + max(citation_score, commentary_score)), 3))
  if quotation_score >= 0.35 and citation_score >= 0.2:
    return ("mixed", round(min(0.95, 0.38 + max(quotation_score, citation_score)), 3))
  if quotation_score >= max(citation_score, commentary_score) and quotation_score >= 0.35:
    return ("quotation", round(min(0.9, 0.35 + quotation_score), 3))
  if citation_score >= commentary_score and citation_score >= 0.3:
    return ("citation", round(min(0.95, 0.45 + citation_score), 3))
  if commentary_score > citation_score:
    return ("commentary", round(min(0.95, 0.45 + commentary_score), 3))
  return ("unknown", 0.35)


def _split_footnote_spans(text: str) -> list[dict[str, Any]]:
  normalized = _normalize_text(text)
  sentences = [segment.strip() for segment in re.split(r"(?<=[.!?;])\s+|(?<=:)\s+(?=[A-Z\"'])|(?:\s+--\s+|\s+\u2014\s+)", normalized) if segment.strip()]
  if not sentences and _normalize_text(text):
    sentences = [normalized]
  spans: list[dict[str, Any]] = []
  for index, sentence in enumerate(sentences, start=1):
    span_kind, confidence = _classify_note_sentence(sentence)
    spans.append(
      {
        "span_index": index,
        "span_kind": span_kind,
        "text": sentence,
        "normalized_text": sentence,
        "confidence": confidence,
      }
    )
  return spans


def _extract_footnotes(page_text: str, *, page_number: int, skip_lines: set[str] | None = None) -> list[dict[str, Any]]:
  notes: list[dict[str, Any]] = []
  skip_lines = {_normalize_text(item) for item in (skip_lines or set()) if _normalize_text(item)}
  for match in FOOTNOTE_LINE_RE.finditer(page_text or ""):
    full_line = _normalize_text(match.group(0))
    if full_line in skip_lines:
      continue
    note_label = match.group("bracket") or match.group("number") or match.group("symbol") or ""
    raw_text = _normalize_text(match.group("text"))
    if len(raw_text) < 4:
      continue
    spans = _split_footnote_spans(raw_text)
    citation_spans = [span for span in spans if span["span_kind"] in {"citation", "mixed"}]
    commentary_spans = [span for span in spans if span["span_kind"] in {"commentary", "mixed", "quotation"}]
    kind = "mixed"
    if citation_spans and not commentary_spans:
      kind = "citation"
    elif commentary_spans and not citation_spans:
      kind = "commentary"
    elif not citation_spans and not commentary_spans:
      kind = "unknown"
    confidence = 0.45
    if kind == "mixed":
      confidence = 0.68
    elif kind != "unknown":
      confidence = 0.58
    notes.append(
      {
        "page_number": page_number,
        "note_label": note_label,
        "raw_text": raw_text,
        "normalized_text": raw_text,
        "kind": kind,
        "confidence": confidence,
        "citations_detected": len(citation_spans),
        "commentary_detected": len(commentary_spans),
        "spans": spans,
        "warnings": [],
      }
    )
  return notes


def _entry_author_key(entry: dict[str, Any]) -> str:
  authors = entry.get("authors") or []
  if not authors:
    return ""
  author = _normalize_text(str(authors[0]))
  if "," in author:
    return _normalize_text(author.split(",")[0]).lower()
  parts = [part for part in author.split() if part]
  return _normalize_text(parts[-1] if parts else author).lower()


def _entry_year_key(entry: dict[str, Any]) -> str:
  value = _normalize_text(entry.get("year") or "")
  if len(value) >= 4:
    return value[:4]
  return value


def _numeric_targets(raw_marker: str) -> set[str]:
  targets: set[str] = set()
  for part in re.split(r"\s*[-,]\s*", _normalize_text(raw_marker)):
    if part.isdigit():
      targets.add(part)
  return targets


def _match_mentions(entries: list[dict[str, Any]], mentions: list[dict[str, Any]]) -> list[dict[str, Any]]:
  links: list[dict[str, Any]] = []
  for mention in mentions:
    best_entry = None
    best_score = 0.0
    mention_label = _normalize_text(mention.get("target_label") or "").lower()
    mention_year = _normalize_text(mention.get("target_year") or "")
    mention_year_key = mention_year[:4] if len(mention_year) >= 4 else mention_year
    mention_tokens = {token.lower() for token in TITLE_TOKEN_RE.findall(mention_label)}
    numeric_targets = _numeric_targets(mention.get("normalized_text") or mention.get("raw_marker") or "")
    for entry in entries:
      score = 0.0
      if mention_year and mention_year == _normalize_text(entry.get("year") or ""):
        score += 0.4
      elif mention_year_key and mention_year_key == _entry_year_key(entry):
        score += 0.25
      author_key = _entry_author_key(entry)
      if mention_label and author_key and author_key in mention_label:
        score += 0.4
      if mention.get("mention_type") == "numeric":
        ordinal = entry.get("ordinal")
        if ordinal is not None and str(ordinal) in numeric_targets:
          score += 0.85
      elif mention_tokens:
        title_tokens = _entry_title_tokens(entry)
        overlap = len(mention_tokens & title_tokens)
        if overlap >= 2:
          score += min(0.25, 0.08 * overlap)
      if score > best_score:
        best_score = score
        best_entry = entry
    if best_entry and best_score >= 0.4:
      mention["match_status"] = "matched"
      mention["confidence"] = round(max(float(mention.get("confidence") or 0.0), min(0.98, 0.5 + best_score / 2.0)), 3)
      links.append(
        {
          "source_kind": "mention",
          "source_id": mention["id"],
          "target_kind": "entry",
          "target_id": best_entry["id"],
          "link_type": "matched_entry",
          "payload": {"score": round(best_score, 3)},
        }
      )
    else:
      mention["match_status"] = "unresolved"
  return links


def extract_document_citations(source_path: Path, parsed: dict[str, Any]) -> dict[str, Any]:
  pages = list(parsed.get("pages") or [])
  entries: list[dict[str, Any]] = []
  mentions: list[dict[str, Any]] = []
  footnotes: list[dict[str, Any]] = []
  spans: list[dict[str, Any]] = []
  links: list[dict[str, Any]] = []
  warnings: list[str] = []

  bibliography_sections = _extract_bibliography_sections(pages)
  bibliography_lines_by_page: dict[int, set[str]] = {}
  for section_index, section in enumerate(bibliography_sections, start=1):
    bibliography_lines_by_page.setdefault(int(section.get("page_number", 1) or 1), set()).update(
      _normalize_text(line) for line in section.get("lines", []) if _normalize_text(line)
    )
    section_entries = _split_bibliography_entries(section.get("lines", []))
    for entry_index, entry_payload in enumerate(section_entries, start=1):
      raw_entry = entry_payload.get("raw_text", "")
      parsed_entry = _parse_bibliography_entry(
        raw_entry,
        line_count=int(entry_payload.get("line_count", 1) or 1),
        entry_kind=str(entry_payload.get("entry_kind") or "freeform"),
      )
      entry_id = _stable_id("citeentry", source_path, section.get("page_number"), section_index, entry_index, raw_entry)
      entries.append(
        {
          "id": entry_id,
          "page_number": int(section.get("page_number", 1) or 1),
          "section_label": section.get("heading", ""),
          "raw_text": raw_entry,
          "normalized_text": _normalize_text(raw_entry),
          "entry_type": "bibliography",
          "authors": parsed_entry["authors"],
          "title": parsed_entry["title"],
          "year": parsed_entry["year"],
          "container_title": parsed_entry["container_title"],
          "publisher": parsed_entry["publisher"],
          "volume": parsed_entry["volume"],
          "issue": parsed_entry["issue"],
          "pages": parsed_entry["pages"],
          "doi": parsed_entry["doi"],
          "url": parsed_entry["url"],
          "isbn": parsed_entry["isbn"],
          "ordinal": parsed_entry["ordinal"],
          "confidence": parsed_entry["confidence"],
          "parse_status": parsed_entry["parse_status"],
          "warnings": parsed_entry["warnings"],
        }
      )

  for page in pages:
    page_number = int(page.get("number", 1) or 1)
    page_text = str(page.get("text", "") or "")
    for mention_index, mention in enumerate(_extract_inline_mentions(page_text, page_number=page_number), start=1):
      mention["id"] = _stable_id("citemention", source_path, page_number, mention_index, mention["mention_text"])
      mentions.append(mention)
    for note_index, footnote in enumerate(
      _extract_footnotes(page_text, page_number=page_number, skip_lines=bibliography_lines_by_page.get(page_number, set())),
      start=1,
    ):
      footnote_id = _stable_id("footnote", source_path, page_number, note_index, footnote["note_label"], footnote["raw_text"])
      footnote["id"] = footnote_id
      extracted_spans = []
      for span in footnote.pop("spans", []):
        span_id = _stable_id("footspan", footnote_id, span["span_index"], span["text"])
        mention_id = None
        if span["span_kind"] in {"citation", "mixed"}:
          mention_id = _stable_id("citemention", source_path, page_number, "footnote", footnote["note_label"], span["text"])
          mentions.append(
            {
              "id": mention_id,
              "page_number": page_number,
              "mention_text": span["text"],
              "normalized_text": span["normalized_text"],
              "mention_type": "footnote_span",
              "target_label": None,
              "target_year": YEAR_RE.search(span["text"]).group(0) if YEAR_RE.search(span["text"]) else None,
              "raw_marker": footnote["note_label"],
              "confidence": max(float(span.get("confidence") or 0.0), 0.42 if span["span_kind"] == "mixed" else 0.48),
              "match_status": "unresolved",
              "warnings": [],
            }
          )
        extracted_spans.append(
          {
            "id": span_id,
            "footnote_id": footnote_id,
            "span_index": int(span["span_index"]),
            "span_kind": span["span_kind"],
            "text": span["text"],
            "normalized_text": span["normalized_text"],
            "confidence": float(span.get("confidence") or 0.0),
            "citation_entry_id": None,
            "citation_mention_id": mention_id,
          }
        )
      spans.extend(extracted_spans)
      footnotes.append(footnote)

  links.extend(_match_mentions(entries, mentions))
  matched_entry_ids = {link["target_id"] for link in links if link.get("target_kind") == "entry"}
  for span in spans:
    mention_id = span.get("citation_mention_id")
    if not mention_id:
      continue
    match = next((link for link in links if link.get("source_id") == mention_id and link.get("target_kind") == "entry"), None)
    if match:
      span["citation_entry_id"] = match["target_id"]

  entry_confidence_values = [float(item.get("confidence") or 0.0) for item in entries]
  mention_confidence_values = [float(item.get("confidence") or 0.0) for item in mentions]
  footnote_confidence_values = [float(item.get("confidence") or 0.0) for item in footnotes]
  confidence_values = entry_confidence_values + mention_confidence_values + footnote_confidence_values
  average_confidence = round(sum(confidence_values) / len(confidence_values), 3) if confidence_values else 0.0
  mixed_footnotes = sum(1 for item in footnotes if item.get("kind") == "mixed")
  parsed_entries = sum(1 for item in entries if item.get("parse_status") == "parsed")
  partially_parsed_entries = sum(1 for item in entries if item.get("parse_status") == "partially_parsed")
  unresolved_entries = sum(1 for item in entries if item.get("parse_status") == "unresolved")
  matched_mentions = len([item for item in mentions if item.get("match_status") == "matched"])
  unresolved_mentions = len([item for item in mentions if item.get("match_status") != "matched"])
  match_rate = round(matched_mentions / len(mentions), 3) if mentions else 0.0
  unresolved_rate = round(unresolved_mentions / len(mentions), 3) if mentions else 0.0

  return {
    "entries": entries,
    "mentions": mentions,
    "footnotes": footnotes,
    "spans": spans,
    "links": [
      {
        "id": _stable_id("citelink", source_path, link["source_kind"], link["source_id"], link["target_kind"], link["target_id"], link["link_type"]),
        **link,
      }
      for link in links
    ],
    "summary": {
      "documents_mined": 1 if pages else 0,
      "bibliography_entries": len(entries),
      "parsed_entry_count": parsed_entries,
      "partially_parsed_entry_count": partially_parsed_entries,
      "unresolved_entry_count": unresolved_entries,
      "citation_mentions": len(mentions),
      "matched_mentions": matched_mentions,
      "unresolved_mentions": unresolved_mentions,
      "footnotes": len(footnotes),
      "mixed_footnotes": mixed_footnotes,
      "commentary_footnotes": len([item for item in footnotes if item.get("kind") == "commentary"]),
      "citation_only_footnotes": len([item for item in footnotes if item.get("kind") == "citation"]),
      "entry_average_confidence": round(sum(entry_confidence_values) / len(entry_confidence_values), 3) if entry_confidence_values else 0.0,
      "mention_average_confidence": round(sum(mention_confidence_values) / len(mention_confidence_values), 3) if mention_confidence_values else 0.0,
      "footnote_average_confidence": round(sum(footnote_confidence_values) / len(footnote_confidence_values), 3) if footnote_confidence_values else 0.0,
      "match_rate": match_rate,
      "unresolved_rate": unresolved_rate,
      "average_confidence": average_confidence,
    },
    "warnings": warnings,
  }
