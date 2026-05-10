from __future__ import annotations

import re
import unicodedata


ABBREVIATIONS = {
  "vol": "volume",
  "vol.": "volume",
  "no": "number",
  "no.": "number",
  "pp": "pages",
  "pp.": "pages",
  "ed.": "edited",
  "eds.": "editors",
  "trans.": "translated",
  "univ.": "university",
  "dept.": "department",
  "intl.": "international",
  "int'l": "international",
  "proc.": "proceedings",
  "rev.": "review",
}


def normalize_unicode(text: str) -> str:
  value = unicodedata.normalize("NFKC", str(text or ""))
  substitutions = {
    "\u2018": "'",
    "\u2019": "'",
    "\u201c": '"',
    "\u201d": '"',
    "\u2013": "-",
    "\u2014": "-",
    "\u2212": "-",
    "\ufb01": "fi",
    "\ufb02": "fl",
  }
  for source, replacement in substitutions.items():
    value = value.replace(source, replacement)
  return value


def ascii_fold(text: str) -> str:
  return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")


def repair_ocr_noise(text: str) -> str:
  value = str(text or "")

  def repair_token(match: re.Match[str]) -> str:
    token = match.group(0)
    letters = sum(ch.isalpha() for ch in token)
    digits = sum(ch.isdigit() for ch in token)
    if letters < max(digits, 1):
      return token
    translated = token.replace("0", "o").replace("1", "l").replace("5", "s").replace("8", "B")
    return translated

  value = re.sub(r"\b[0-9A-Za-z][0-9A-Za-z'/-]{2,}\b", repair_token, value)
  value = re.sub(r"\s+", " ", value)
  return value.strip()


def expand_abbreviations(text: str) -> str:
  value = f" {text.strip()} "
  for key, replacement in ABBREVIATIONS.items():
    value = re.sub(rf"(?i)(?<!\w){re.escape(key)}(?!\w)", replacement, value)
  return re.sub(r"\s+", " ", value).strip()


def normalize_spacing(text: str) -> str:
  value = re.sub(r"\s+", " ", str(text or ""))
  value = re.sub(r"\s*([,;:.()])\s*", r"\1 ", value)
  value = re.sub(r"\s*-\s*", " - ", value)
  return re.sub(r"\s+", " ", value).strip(" ,;")


def canonical_text(text: str) -> str:
  value = normalize_unicode(text)
  value = repair_ocr_noise(value)
  value = expand_abbreviations(value)
  value = normalize_spacing(value)
  return value


def match_text(text: str) -> str:
  value = canonical_text(text).lower()
  value = ascii_fold(value)
  value = re.sub(r"[^a-z0-9\s:/.-]", " ", value)
  value = re.sub(r"\b(the|a|an)\b", " ", value)
  return re.sub(r"\s+", " ", value).strip()


def slug_text(text: str) -> str:
  return re.sub(r"[^a-z0-9]+", "-", match_text(text)).strip("-")
