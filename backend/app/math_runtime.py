from __future__ import annotations

import hashlib
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from .config import Settings
from . import providers as provider_runtime
from .providers import OCRProvider, ProviderBase

try:
  from PIL import Image
except Exception:  # pragma: no cover - optional import
  Image = None

try:
  from pypdf import PdfReader, PdfWriter
except Exception:  # pragma: no cover - optional import
  PdfReader = None
  PdfWriter = None

try:
  from pix2text import Pix2Text
except Exception:  # pragma: no cover - optional import
  Pix2Text = None


MATH_KEYWORD_PATTERN = re.compile(
  r"\b("
  r"equation|formula|theorem|lemma|proof|corollary|integral|derivative|gradient|"
  r"matrix|vector|tensor|eigen|spectr|orbital|hamiltonian|lagrangian|sheaf|fibre|fiber|"
  r"annulus|ring|cusp|fold|attractor|pathway|reaction|morphism|functor|sum|product|"
  r"limit|identity|operator|laplacian|schrodinger|lorentz|lagrange|fourier"
  r")\b",
  re.IGNORECASE,
)
MATH_SYMBOL_PATTERN = re.compile(r"[=+\-*/^_<>\u2264\u2265\u2248\u2260\u2211\u220f\u222b\u221a\u2206\u0394\u2202\u221e\u2192\u21a6\u03bb\u03bc\u03bd\u03be\u03c0\u03c3\u03c4\u03c9\u03c6\u03c7\u03c8\u03a9\u03b1\u03b2\u03b3\u03b4\u03b5\u03b6\u03b7\u03b8\u03b9\u03ba]")
DISPLAY_MATH_PATTERN = re.compile(r"^\s*[\(\[]?.{0,16}[=\u2248\u221d\u2264\u2265\u2192\u21a6].+$")
INLINE_MATH_PATTERN = re.compile(r"[A-Za-z]\s*=\s*[A-Za-z0-9\\({\[]")
FRACTION_PATTERN = re.compile(r"\b\d+\s*/\s*\d+\b")
SUPERSCRIPT_PATTERN = re.compile(r"([A-Za-z0-9])\^([A-Za-z0-9]+)")
SUBSCRIPT_PATTERN = re.compile(r"([A-Za-z0-9])_([A-Za-z0-9]+)")
SQRT_PATTERN = re.compile(r"\u221a\s*([A-Za-z0-9]+)")
MULTISPACE_PATTERN = re.compile(r"\s+")
LATEX_FRAGMENT_PATTERN = re.compile(
  r"(?P<display>\$\$(?P<display_body>.+?)\$\$)|"
  r"(?P<inline>\$(?P<inline_body>[^$\n]+?)\$)|"
  r"(?P<paren>\\\((?P<paren_body>.+?)\\\))|"
  r"(?P<bracket>\\\[(?P<bracket_body>.+?)\\\])",
  re.DOTALL,
)
INLINE_FORMULA_SEGMENT_PATTERN = re.compile(
  r"([A-Za-z0-9\u0391-\u03c9\\][A-Za-z0-9\u0391-\u03c9\\_{}^()\[\]\s]{0,80}?"
  r"(?:=|\u2248|\u2264|\u2265|\u2260|\u2192|\u21a6)"
  r"[A-Za-z0-9\u0391-\u03c9\\_{}^()\[\]\s+\-*/,.]{1,120})"
)
UNICODE_LATEX_MAP = {
  "\u03b1": r"\alpha",
  "\u03b2": r"\beta",
  "\u03b3": r"\gamma",
  "\u03b4": r"\delta",
  "\u0394": r"\Delta",
  "\u2206": r"\Delta",
  "\u03b5": r"\epsilon",
  "\u03b8": r"\theta",
  "\u03bb": r"\lambda",
  "\u03bc": r"\mu",
  "\u03bd": r"\nu",
  "\u03be": r"\xi",
  "\u03c0": r"\pi",
  "\u03c3": r"\sigma",
  "\u03c4": r"\tau",
  "\u03c6": r"\phi",
  "\u03c7": r"\chi",
  "\u03c8": r"\psi",
  "\u03c9": r"\omega",
  "\u03a9": r"\Omega",
  "\u2211": r"\sum",
  "\u220f": r"\prod",
  "\u222b": r"\int",
  "\u221e": r"\infty",
  "\u2248": r"\approx",
  "\u2264": r"\leq",
  "\u2265": r"\geq",
  "\u2260": r"\neq",
  "\u00b1": r"\pm",
  "\u00d7": r"\times",
  "\u00b7": r"\cdot",
  "\u2192": r"\to",
  "\u21a6": r"\mapsto",
}
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp"}


def _stable_id(prefix: str, *parts: object) -> str:
  digest = hashlib.sha1("||".join(str(part) for part in parts).encode("utf-8", errors="ignore")).hexdigest()[:16]
  return f"{prefix}-{digest}"


def _safe_float(value: Any, default: float = 0.0) -> float:
  try:
    return float(value)
  except Exception:
    return float(default)


def _trim_text(value: str, max_length: int = 4000) -> str:
  text = str(value or "").strip()
  return text if len(text) <= max_length else text[:max_length].rstrip() + "..."


def _normalize_latex(text: str) -> str | None:
  candidate = str(text or "").strip()
  if not candidate:
    return None
  for symbol, latex in UNICODE_LATEX_MAP.items():
    candidate = candidate.replace(symbol, f" {latex} ")
  candidate = SQRT_PATTERN.sub(r"\\sqrt{\1}", candidate)
  candidate = SUPERSCRIPT_PATTERN.sub(r"\1^{\2}", candidate)
  candidate = SUBSCRIPT_PATTERN.sub(r"\1_{\2}", candidate)
  candidate = MULTISPACE_PATTERN.sub(" ", candidate).strip().strip("$")
  return candidate or None


def _extract_latex_fragments(text: str) -> list[str]:
  fragments: list[str] = []
  for match in LATEX_FRAGMENT_PATTERN.finditer(str(text or "")):
    body = match.group("display_body") or match.group("inline_body") or match.group("paren_body") or match.group("bracket_body") or ""
    normalized = _normalize_latex(body)
    if normalized:
      fragments.append(normalized)
  return fragments


def _extract_inline_formula_segments(text: str) -> list[str]:
  segments: list[str] = []
  candidate = str(text or "").strip()
  if not candidate:
    return segments
  for match in INLINE_FORMULA_SEGMENT_PATTERN.finditer(candidate):
    segment = match.group(1).strip(" ,.;:")
    if not segment:
      continue
    if segment.lower().startswith(("the ", "a ", "an ")):
      token_index = next(
        (index for index, char in enumerate(segment) if char in "=≈≤≥≠→↦"),
        -1,
      )
      if token_index > 0:
        prefix = segment[:token_index]
        prefix_tokens = prefix.split()
        if prefix_tokens:
          segment = " ".join(prefix_tokens[-1:]) + segment[token_index:]
    parts = [item.strip(" ,.;:") for item in re.split(r"\band\b", segment) if item.strip()]
    for part in parts:
      if any(symbol in part for symbol in ("=", "≈", "≤", "≥", "≠", "→", "↦")):
        segments.append(part)
  return segments


def _line_math_score(text: str) -> tuple[int, list[str]]:
  candidate = str(text or "").strip()
  if not candidate:
    return (0, [])
  reasons: list[str] = []
  score = 0
  symbol_hits = len(MATH_SYMBOL_PATTERN.findall(candidate))
  if symbol_hits:
    score += min(symbol_hits, 5)
    reasons.append("symbol_density")
  if DISPLAY_MATH_PATTERN.search(candidate):
    score += 2
    reasons.append("display_formula")
  if INLINE_MATH_PATTERN.search(candidate):
    score += 2
    reasons.append("inline_equation")
  if FRACTION_PATTERN.search(candidate):
    score += 1
    reasons.append("fraction")
  if MATH_KEYWORD_PATTERN.search(candidate):
    score += 1
    reasons.append("math_keyword")
  if candidate.count("(") != candidate.count(")"):
    score += 1
    reasons.append("unbalanced_grouping")
  return (score, reasons)


def _math_dense(page_text: str) -> bool:
  score, _ = _line_math_score((page_text or "")[:600])
  return score >= 3 or bool(_extract_latex_fragments(page_text))


def _handwriting_likelihood(page_text: str, page_metadata: dict[str, Any], scanned_like: bool) -> float:
  confidence = _safe_float(page_metadata.get("ocr_confidence"), 1.0)
  lines = [line.strip() for line in str(page_text or "").splitlines() if line.strip()]
  short_lines = sum(1 for line in lines if len(line) < 18)
  symbol_lines = sum(1 for line in lines if MATH_SYMBOL_PATTERN.search(line))
  likelihood = 0.0
  if scanned_like:
    likelihood += 0.25
  if confidence < 0.7:
    likelihood += 0.25
  if lines and short_lines / max(1, len(lines)) > 0.45:
    likelihood += 0.2
  if symbol_lines and symbol_lines / max(1, len(lines)) > 0.35:
    likelihood += 0.15
  if any(re.search(r"[A-Za-z0-9][^\w\s]{2,}", line) for line in lines):
    likelihood += 0.15
  return round(min(likelihood, 0.99), 3)


def _candidate_key(payload: dict[str, Any]) -> str:
  return str(payload.get("normalized_latex") or payload.get("latex") or payload.get("raw_text") or "").strip().lower()


def _merge_candidate(existing: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
  merged = dict(existing)
  existing_confidence = _safe_float(existing.get("confidence"))
  incoming_confidence = _safe_float(incoming.get("confidence"))
  if incoming_confidence >= existing_confidence:
    merged.update(incoming)
  attempts = list(existing.get("provider_attempts") or [])
  attempts.extend(incoming.get("provider_attempts") or [])
  merged["provider_attempts"] = attempts
  warnings = list(existing.get("warnings") or [])
  for item in incoming.get("warnings") or []:
    if item not in warnings:
      warnings.append(item)
  merged["warnings"] = warnings
  return merged


def _render_pdf_page_image(source_path: Path, page_number: int, output_path: Path, *, max_side: int) -> tuple[str | None, list[str]]:
  pdfium = provider_runtime.pdfium
  np = provider_runtime.np
  if pdfium is None:
    return (None, ["pdf_page_render_unavailable"])
  document = pdfium.PdfDocument(str(source_path))
  if page_number < 1 or page_number > len(document):
    return (None, ["pdf_page_out_of_range"])
  page = document[page_number - 1]
  bitmap = page.render(scale=2)
  pil_image = bitmap.to_pil() if hasattr(bitmap, "to_pil") else (Image.fromarray(bitmap.to_numpy()) if hasattr(bitmap, "to_numpy") and np is not None and Image is not None else None)
  if pil_image is None:
    return (None, ["pdf_page_render_failed"])
  width, height = pil_image.size
  scale = min(1.0, max_side / max(width, height)) if max(width, height) else 1.0
  if scale < 1.0:
    pil_image = pil_image.resize((max(1, int(width * scale)), max(1, int(height * scale))))
  output_path.parent.mkdir(parents=True, exist_ok=True)
  pil_image.save(output_path)
  return (str(output_path), [])


def _materialize_page_input(source_path: Path, page_number: int, artifact_dir: Path, settings: Settings) -> tuple[str | None, list[str]]:
  suffix = source_path.suffix.lower()
  if suffix in IMAGE_SUFFIXES:
    return (str(source_path), [])
  if suffix == ".pdf":
    return _render_pdf_page_image(source_path, page_number, artifact_dir / f"{source_path.stem}-page-{page_number:04d}.png", max_side=settings.math_max_rendered_page_side)
  return (None, ["page_input_unavailable"])


def _write_single_page_pdf(source_path: Path, page_number: int, target_path: Path) -> str | None:
  if PdfReader is None or PdfWriter is None:
    return None
  reader = PdfReader(str(source_path))
  if page_number < 1 or page_number > len(reader.pages):
    return None
  writer = PdfWriter()
  writer.add_page(reader.pages[page_number - 1])
  target_path.parent.mkdir(parents=True, exist_ok=True)
  with target_path.open("wb") as handle:
    writer.write(handle)
  return str(target_path)


class MathRecognitionProvider(ProviderBase):
  name = "math_recognizer"
  model_name = "math-heuristic-v1"
  supports_handwriting = False
  supports_native_pdf = False

  def __init__(self, settings: Settings, detail: str | None = None) -> None:
    super().__init__(detail=detail)
    self.settings = settings

  def recognize_region(self, source_path: Path, page: dict[str, Any], region: dict[str, Any], *, artifact_dir: Path) -> dict[str, Any] | None:
    return None

  def recognize_page(self, source_path: Path, page: dict[str, Any], *, artifact_dir: Path) -> dict[str, Any] | None:
    return None

  def extract_document_math(self, source_path: Path, parsed: dict[str, Any], *, ocr_provider: OCRProvider | None = None, artifact_dir: Path | None = None) -> dict[str, Any]:
    raise NotImplementedError


class HeuristicMathRecognitionProvider(MathRecognitionProvider):
  name = "heuristic_math"
  is_fallback = True
  supports_native_pdf = True

  def __init__(self, settings: Settings) -> None:
    super().__init__(settings, detail="Local heuristic math detector with lightweight LaTeX normalization.")

  def harvest_native_candidates(self, page: dict[str, Any], *, min_score: int = 2) -> list[dict[str, Any]]:
    page_number = int(page.get("number") or 1)
    page_text = str(page.get("text") or "").strip()
    candidates_by_key: dict[str, dict[str, Any]] = {}
    for line in [item.strip() for item in page_text.splitlines() if item.strip()]:
      segment_candidates = _extract_inline_formula_segments(line) or [line]
      for segment in segment_candidates:
        score, reasons = _line_math_score(segment)
        if score < min_score:
          continue
        latex = _normalize_latex(segment)
        key = (latex or segment).strip().lower()
        if not key:
          continue
        confidence = round(min(0.35 + (0.12 * score), 0.96), 2)
        candidate = {
          "page_number": page_number,
          "raw_text": segment,
          "latex": latex,
          "normalized_latex": latex,
          "confidence": confidence,
          "provider_name": self.name,
          "selected_provider": self.name,
          "provider_attempts": [{"provider": self.name, "status": "recognized" if latex else "low_confidence", "confidence": confidence, "detail": "native_text_harvest", "reasons": reasons}],
          "quality_tier": "native",
          "retry_state": "idle",
          "validation_status": "recognized" if latex else "low_confidence",
          "warnings": reasons,
        }
        candidates_by_key[key] = _merge_candidate(candidates_by_key[key], candidate) if key in candidates_by_key else candidate
    for latex in _extract_latex_fragments(page_text):
      key = latex.strip().lower()
      if not key:
        continue
      candidate = {
        "page_number": page_number,
        "raw_text": latex,
        "latex": latex,
        "normalized_latex": latex,
        "confidence": 0.95,
        "provider_name": self.name,
        "selected_provider": self.name,
        "provider_attempts": [{"provider": self.name, "status": "recognized", "confidence": 0.95, "detail": "latex_fragment_harvest"}],
        "quality_tier": "native",
        "retry_state": "idle",
        "validation_status": "recognized",
        "warnings": [],
      }
      candidates_by_key[key] = _merge_candidate(candidates_by_key[key], candidate) if key in candidates_by_key else candidate
    if not candidates_by_key and page_text:
      score, reasons = _line_math_score(page_text[:500])
      if score >= 3:
        latex = _normalize_latex(page_text[:500])
        confidence = round(min(0.35 + (0.12 * score), 0.96), 2)
        candidate = {
          "page_number": page_number,
          "raw_text": _trim_text(page_text[:500], 500),
          "latex": latex,
          "normalized_latex": latex,
          "confidence": confidence,
          "provider_name": self.name,
          "selected_provider": self.name,
          "provider_attempts": [{"provider": self.name, "status": "recognized" if latex else "low_confidence", "confidence": confidence, "detail": "page_text_harvest", "reasons": reasons}],
          "quality_tier": "native",
          "retry_state": "idle",
          "validation_status": "recognized" if latex else "low_confidence",
          "warnings": reasons,
        }
        key = _candidate_key(candidate)
        if key:
          candidates_by_key[key] = candidate
    return list(candidates_by_key.values())


  def extract_document_math(self, source_path: Path, parsed: dict[str, Any], *, ocr_provider: OCRProvider | None = None, artifact_dir: Path | None = None) -> dict[str, Any]:
    pages = list(parsed.get("pages") or [])
    artifacts: list[dict[str, Any]] = []
    regions: list[dict[str, Any]] = []
    formulae: list[dict[str, Any]] = []
    links: list[dict[str, Any]] = []
    confidence_values: list[float] = []
    pages_scanned = 0

    for page in pages:
      page_number = int(page.get("number") or 1)
      page_text = str(page.get("text") or "")
      page_metadata = dict(page.get("metadata") or {})
      extraction_mode = str(page_metadata.get("extraction_mode") or "native_text")
      scanned_like = any(token in extraction_mode for token in ("ocr", "missing", "image", "scan", "djvu"))
      candidates = self.harvest_native_candidates(page)
      if not candidates and not (scanned_like or _math_dense(page_text)):
        continue
      pages_scanned += 1
      handwriting_likelihood = _handwriting_likelihood(page_text, page_metadata, scanned_like)
      if not candidates:
        candidates = [{
          "page_number": page_number,
          "raw_text": _trim_text(page_text, 500),
          "latex": None,
          "normalized_latex": None,
          "confidence": 0.0,
          "provider_name": self.name,
          "selected_provider": self.name,
          "provider_attempts": [{"provider": self.name, "status": "low_confidence", "confidence": 0.0, "detail": "math_page_detected_without_formula"}],
          "quality_tier": "heuristic",
          "retry_state": "pending_retry",
          "validation_status": "low_confidence",
          "warnings": ["math_detected_without_formula"],
        }]
      for region_index, candidate in enumerate(candidates, start=1):
        artifact_id = _stable_id("mathart", source_path, page_number, region_index, candidate.get("normalized_latex") or candidate.get("raw_text"))
        region_id = _stable_id("mathregion", artifact_id, region_index)
        formula_id = _stable_id("mathformula", artifact_id, candidate.get("normalized_latex") or candidate.get("raw_text"))
        link_id = _stable_id("mathlink", formula_id, page_number)
        confidence = round(_safe_float(candidate.get("confidence")), 3)
        status = candidate.get("validation_status") or ("recognized" if candidate.get("latex") else "low_confidence")
        warnings = list(candidate.get("warnings") or [])
        artifacts.append({
          "id": artifact_id,
          "page_number": page_number,
          "source_ref": str(source_path),
          "region_box": None,
          "image_path": None,
          "raw_text": candidate.get("raw_text") or page_text[:500],
          "latex": candidate.get("latex"),
          "confidence": confidence,
          "provider_name": self.name,
          "selected_provider": candidate.get("selected_provider") or self.name,
          "model_name": self.model_name,
          "extraction_mode": "ocr_math" if scanned_like else "native_math",
          "provider_attempts": candidate.get("provider_attempts") or [],
          "normalized_latex": candidate.get("normalized_latex"),
          "mathml": None,
          "handwriting_likelihood": handwriting_likelihood,
          "quality_tier": candidate.get("quality_tier") or "heuristic",
          "retry_state": candidate.get("retry_state") or "idle",
          "warnings": warnings,
          "validation_state": status,
        })
        regions.append({
          "id": region_id,
          "artifact_id": artifact_id,
          "page_number": page_number,
          "region_index": region_index,
          "bbox": None,
          "image_path": None,
          "raw_text": candidate.get("raw_text") or page_text[:500],
          "confidence": confidence,
          "provider_attempts": candidate.get("provider_attempts") or [],
          "handwriting_likelihood": handwriting_likelihood,
          "quality_tier": candidate.get("quality_tier") or "region",
          "status": status,
          "warnings": warnings,
        })
        formulae.append({
          "id": formula_id,
          "artifact_id": artifact_id,
          "region_id": region_id,
          "page_number": page_number,
          "label": f"Page {page_number} formula {region_index}",
          "raw_text": candidate.get("raw_text") or page_text[:500],
          "latex": candidate.get("latex"),
          "confidence": confidence,
          "provider_name": self.name,
          "selected_provider": candidate.get("selected_provider") or self.name,
          "model_name": self.model_name,
          "extraction_mode": "ocr_math" if scanned_like else "native_math",
          "provider_attempts": candidate.get("provider_attempts") or [],
          "normalized_latex": candidate.get("normalized_latex"),
          "mathml": None,
          "handwriting_likelihood": handwriting_likelihood,
          "quality_tier": candidate.get("quality_tier") or "heuristic",
          "retry_state": candidate.get("retry_state") or "idle",
          "validation_status": status,
          "warnings": warnings,
        })
        links.append({
          "id": link_id,
          "formula_id": formula_id,
          "artifact_id": artifact_id,
          "region_id": region_id,
          "link_type": "page",
          "payload": {"page_number": page_number, "source_ref": str(source_path)},
        })
        confidence_values.append(confidence)

    formula_count = len(formulae)
    formula_recognized = sum(1 for item in formulae if item.get("latex"))
    formula_pending = formula_count - formula_recognized
    average_confidence = round(sum(confidence_values) / len(confidence_values), 3) if confidence_values else 0.0
    max_confidence = round(max(confidence_values), 3) if confidence_values else 0.0
    return {
      "pages_scanned": pages_scanned,
      "regions_detected": len(regions),
      "formula_count": formula_count,
      "formula_recognized": formula_recognized,
      "formula_pending": formula_pending,
      "documents_with_math_artifacts": 1 if formula_count else 0,
      "confidence_summary": {"average": average_confidence, "max": max_confidence},
      "artifacts": artifacts,
      "regions": regions,
      "formulae": formulae,
      "links": links,
    }


class Pix2TextMathRecognitionProvider(MathRecognitionProvider):
  name = "pix2text"

  def __init__(self, settings: Settings) -> None:
    super().__init__(settings, detail=settings.math_pix2text_formula_model)
    self.model_name = settings.math_pix2text_formula_model
    self._model = None

  def _probe_ready(self) -> tuple[bool, str | None]:
    if not self.settings.math_pix2text_enabled:
      return (False, "Pix2Text is disabled.")
    if Pix2Text is None:
      return (False, "pix2text is not installed.")
    return (True, self.model_name)

  def _load(self):
    if self._model is None:
      if Pix2Text is None:
        raise RuntimeError("pix2text is not installed.")
      self.settings.resolved_math_model_cache_dir.mkdir(parents=True, exist_ok=True)
      self._model = Pix2Text.from_config()
    return self._model

  def recognize_region(self, source_path: Path, page: dict[str, Any], region: dict[str, Any], *, artifact_dir: Path) -> dict[str, Any] | None:
    image_path = region.get("image_path")
    if not image_path:
      return None
    model = self._load()
    result = None
    if hasattr(model, "recognize_formula"):
      try:
        result = model.recognize_formula(image_path, return_text=False)
      except TypeError:
        result = model.recognize_formula(image_path)
    if result is None and hasattr(model, "recognize_text_formula"):
      result = model.recognize_text_formula(image_path)
    if result is None:
      return None
    latex = result if isinstance(result, str) else (result.get("text") or result.get("latex") or result.get("pred")) if isinstance(result, dict) else str(result)
    confidence = 0.78 if isinstance(result, str) else _safe_float(result.get("score") or result.get("confidence"), 0.78) if isinstance(result, dict) else 0.75
    normalized = _normalize_latex(latex or "")
    if not normalized:
      return None
    status = "recognized" if confidence >= self.settings.math_confidence_escalate_threshold else "low_confidence"
    return {
      "raw_text": latex or normalized,
      "latex": normalized,
      "normalized_latex": normalized,
      "confidence": round(confidence, 3),
      "provider_name": self.name,
      "selected_provider": self.name,
      "provider_attempts": [{"provider": self.name, "status": status, "confidence": round(confidence, 3), "detail": "pix2text_formula_recognition"}],
      "quality_tier": "local",
      "retry_state": "idle",
      "validation_status": status,
      "warnings": list(result.get("warnings") or []) if isinstance(result, dict) else [],
    }


class UniMERNetMathRecognitionProvider(MathRecognitionProvider):
  name = "unimernet"
  supports_handwriting = True

  def __init__(self, settings: Settings) -> None:
    super().__init__(settings, detail=settings.math_unimernet_model_name)
    self.model_name = settings.math_unimernet_model_name

  def _probe_ready(self) -> tuple[bool, str | None]:
    if not self.settings.math_unimernet_enabled:
      return (False, "UniMERNet is disabled.")
    if not self.settings.math_unimernet_command:
      return (False, "No UniMERNet command is configured.")
    return (True, self.model_name)

  def recognize_region(self, source_path: Path, page: dict[str, Any], region: dict[str, Any], *, artifact_dir: Path) -> dict[str, Any] | None:
    image_path = region.get("image_path")
    command = str(self.settings.math_unimernet_command or "").strip()
    if not image_path or not command:
      return None
    args = command.format(image_path=image_path).split() if "{image_path}" in command else [*command.split(), image_path]
    try:
      result = subprocess.run(args, capture_output=True, text=True, timeout=self.settings.math_provider_timeout_seconds, check=False)
    except Exception as error:
      return {
        "raw_text": "",
        "latex": None,
        "normalized_latex": None,
        "confidence": 0.0,
        "provider_name": self.name,
        "selected_provider": self.name,
        "provider_attempts": [{"provider": self.name, "status": "awaiting_refinement", "confidence": 0.0, "detail": str(error)}],
        "quality_tier": "local",
        "retry_state": "awaiting_refinement",
        "validation_status": "awaiting_refinement",
        "warnings": [str(error)],
      }
    stdout = (result.stdout or "").strip()
    payload = None
    if stdout.startswith("{"):
      try:
        payload = json.loads(stdout)
      except Exception:
        payload = None
    latex = (payload.get("latex") or payload.get("text") or payload.get("pred")) if isinstance(payload, dict) else (stdout.splitlines()[-1].strip() if stdout else None)
    normalized = _normalize_latex(latex or "")
    if not normalized:
      return None
    confidence = _safe_float((payload.get("confidence") or payload.get("score")) if isinstance(payload, dict) else 0.82, 0.82)
    status = "recognized" if confidence >= self.settings.math_confidence_escalate_threshold else "low_confidence"
    return {
      "raw_text": latex or normalized,
      "latex": normalized,
      "normalized_latex": normalized,
      "confidence": round(confidence, 3),
      "provider_name": self.name,
      "selected_provider": self.name,
      "provider_attempts": [{"provider": self.name, "status": status, "confidence": round(confidence, 3), "detail": "unimernet_command"}],
      "quality_tier": "local",
      "retry_state": "idle",
      "validation_status": status,
      "warnings": list(payload.get("warnings") or []) if isinstance(payload, dict) else [],
    }


class NougatMathRecognitionProvider(MathRecognitionProvider):
  name = "nougat"
  supports_native_pdf = True

  def __init__(self, settings: Settings) -> None:
    super().__init__(settings, detail=settings.math_nougat_model)
    self.model_name = settings.math_nougat_model

  def _probe_ready(self) -> tuple[bool, str | None]:
    if not self.settings.math_nougat_enabled:
      return (False, "Nougat is disabled.")
    executable = shutil.which(self.settings.math_nougat_command) or shutil.which(f"{self.settings.math_nougat_command}.exe")
    return (bool(executable), self.model_name if executable else "Nougat CLI was not found.")

  def recognize_page(self, source_path: Path, page: dict[str, Any], *, artifact_dir: Path) -> dict[str, Any] | None:
    if source_path.suffix.lower() != ".pdf":
      return None
    executable = shutil.which(self.settings.math_nougat_command) or shutil.which(f"{self.settings.math_nougat_command}.exe")
    if executable is None:
      return None
    page_number = int(page.get("number") or 1)
    with tempfile.TemporaryDirectory() as temp_dir:
      temp_root = Path(temp_dir)
      page_pdf = _write_single_page_pdf(source_path, page_number, temp_root / f"{source_path.stem}-page-{page_number}.pdf")
      if page_pdf is None:
        return None
      output_dir = temp_root / "nougat-out"
      args = [executable, page_pdf, "-o", str(output_dir), "--markdown", "-b", "1", "-m", self.settings.math_nougat_model]
      try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=self.settings.math_provider_timeout_seconds, check=False)
      except Exception as error:
        return {
          "raw_text": "",
          "latex": None,
          "normalized_latex": None,
          "confidence": 0.0,
          "provider_name": self.name,
          "selected_provider": self.name,
          "provider_attempts": [{"provider": self.name, "status": "awaiting_refinement", "confidence": 0.0, "detail": str(error)}],
          "quality_tier": "local",
          "retry_state": "awaiting_refinement",
          "validation_status": "awaiting_refinement",
          "warnings": [str(error)],
        }
      output_files = list(output_dir.glob("*.mmd"))
      if not output_files:
        return None
      markdown = output_files[0].read_text(encoding="utf-8", errors="ignore")
      fragments = _extract_latex_fragments(markdown)
      if not fragments:
        score, _ = _line_math_score(markdown[:800])
        if score < 3:
          return None
        fragments = [_normalize_latex(markdown[:500]) or markdown[:500]]
      latex = fragments[0]
      confidence = 0.84 if latex else 0.0
      status = "recognized" if confidence >= self.settings.math_confidence_escalate_threshold else "low_confidence"
      return {
        "raw_text": markdown[:1000],
        "latex": latex,
        "normalized_latex": latex,
        "confidence": confidence,
        "provider_name": self.name,
        "selected_provider": self.name,
        "provider_attempts": [{"provider": self.name, "status": status, "confidence": confidence, "detail": "nougat_page_markdown"}],
        "quality_tier": "local",
        "retry_state": "idle",
        "validation_status": status,
        "warnings": [line.strip() for line in (result.stderr or "").splitlines() if line.strip()][:3],
      }


class MathpixMathRecognitionProvider(MathRecognitionProvider):
  name = "mathpix"
  supports_handwriting = True

  def __init__(self, settings: Settings) -> None:
    super().__init__(settings, detail="Mathpix API")
    self.model_name = "v3/text"

  def _probe_ready(self) -> tuple[bool, str | None]:
    if not self.settings.math_mathpix_enabled:
      return (False, "Mathpix fallback is disabled.")
    if provider_runtime.httpx is None:
      return (False, "httpx is not installed.")
    if not self.settings.math_mathpix_app_id or not self.settings.math_mathpix_api_key:
      return (False, "Mathpix credentials are not configured.")
    return (True, "Mathpix API")

  def recognize_region(self, source_path: Path, page: dict[str, Any], region: dict[str, Any], *, artifact_dir: Path) -> dict[str, Any] | None:
    image_path = region.get("image_path")
    if provider_runtime.httpx is None or not image_path:
      return None
    try:
      with open(image_path, "rb") as handle:
        response = provider_runtime.httpx.post(
          "https://api.mathpix.com/v3/text",
          headers={"app_id": self.settings.math_mathpix_app_id or "", "app_key": self.settings.math_mathpix_api_key or ""},
          files={"file": (Path(image_path).name, handle, "image/png")},
          data={"options_json": json.dumps({"formats": ["text", "data"], "data_options": {"include_latex": True}, "math_inline_delimiters": ["$", "$"], "rm_spaces": True})},
          timeout=self.settings.math_provider_timeout_seconds,
        )
      response.raise_for_status()
      payload = response.json()
    except Exception as error:
      return {
        "raw_text": "",
        "latex": None,
        "normalized_latex": None,
        "confidence": 0.0,
        "provider_name": self.name,
        "selected_provider": self.name,
        "provider_attempts": [{"provider": self.name, "status": "awaiting_refinement", "confidence": 0.0, "detail": str(error)}],
        "quality_tier": "cloud",
        "retry_state": "awaiting_refinement",
        "validation_status": "awaiting_refinement",
        "warnings": [str(error)],
      }
    latex = payload.get("latex_styled") or payload.get("latex_normal") or next((item.get("value") for item in payload.get("data", []) if item.get("type") == "latex"), None) or payload.get("text")
    normalized = _normalize_latex(latex or "")
    if not normalized:
      return None
    confidence = _safe_float(payload.get("confidence_rate"), 0.92)
    status = "recognized" if confidence >= self.settings.math_confidence_escalate_threshold else "low_confidence"
    return {
      "raw_text": payload.get("text") or normalized,
      "latex": normalized,
      "normalized_latex": normalized,
      "confidence": round(confidence, 3),
      "provider_name": self.name,
      "selected_provider": self.name,
      "provider_attempts": [{"provider": self.name, "status": status, "confidence": round(confidence, 3), "detail": "mathpix_v3_text"}],
      "quality_tier": "cloud",
      "retry_state": "idle",
      "validation_status": status,
      "warnings": [],
    }


class TieredMathRecognitionProvider(MathRecognitionProvider):
  name = "tiered_math"
  supports_handwriting = True
  supports_native_pdf = True

  def __init__(self, settings: Settings) -> None:
    super().__init__(settings, detail=settings.math_runtime_profile)
    self.heuristic = HeuristicMathRecognitionProvider(settings)
    self.providers = [
      Pix2TextMathRecognitionProvider(settings),
      UniMERNetMathRecognitionProvider(settings),
      NougatMathRecognitionProvider(settings),
      MathpixMathRecognitionProvider(settings),
    ]

  def _ready_provider(self, provider: MathRecognitionProvider) -> bool:
    ready, _ = provider._probe_ready()
    return bool(ready)

  def extract_document_math(self, source_path: Path, parsed: dict[str, Any], *, ocr_provider: OCRProvider | None = None, artifact_dir: Path | None = None) -> dict[str, Any]:
    base_payload = self.heuristic.extract_document_math(source_path, parsed, ocr_provider=ocr_provider, artifact_dir=artifact_dir)
    workspace = artifact_dir or self.settings.resolved_job_artifact_dir / "math-preview"
    workspace.mkdir(parents=True, exist_ok=True)
    pages_by_number = {int(page.get("number") or 1): page for page in parsed.get("pages") or []}
    by_key: dict[tuple[int, str], dict[str, Any]] = {}

    for formula in base_payload.get("formulae", []):
      key = (int(formula.get("page_number") or 1), _candidate_key(formula))
      if key[1]:
        by_key[key] = formula

    for page_number, page in pages_by_number.items():
      page_text = str(page.get("text") or "")
      page_metadata = dict(page.get("metadata") or {})
      extraction_mode = str(page_metadata.get("extraction_mode") or "native_text")
      scanned_like = any(token in extraction_mode for token in ("ocr", "missing", "image", "scan", "djvu"))
      handwriting_likelihood = _handwriting_likelihood(page_text, page_metadata, scanned_like)
      needs_escalation = scanned_like or handwriting_likelihood >= self.settings.math_handwriting_likelihood_threshold or _math_dense(page_text)
      if not needs_escalation:
        continue
      image_path, image_warnings = _materialize_page_input(source_path, page_number, workspace, self.settings)
      if not image_path:
        continue
      region = {
        "page_number": page_number,
        "region_index": 1,
        "bbox": None,
        "image_path": image_path,
        "raw_text": _trim_text(page_text, 500),
        "confidence": 0.0,
        "provider_attempts": [],
        "handwriting_likelihood": handwriting_likelihood,
        "quality_tier": "region",
        "status": "pending",
        "warnings": image_warnings,
      }
      for provider in self.providers:
        if not self._ready_provider(provider):
          continue
        result = None
        try:
          result = provider.recognize_region(source_path, page, region, artifact_dir=workspace)
          if result is None and (provider.supports_native_pdf or scanned_like):
            result = provider.recognize_page(source_path, page, artifact_dir=workspace)
        except Exception as error:
          result = {
            "page_number": page_number,
            "raw_text": "",
            "latex": None,
            "normalized_latex": None,
            "confidence": 0.0,
            "provider_name": provider.name,
            "selected_provider": provider.name,
            "provider_attempts": [{"provider": provider.name, "status": "awaiting_refinement", "confidence": 0.0, "detail": str(error)}],
            "quality_tier": "local",
            "retry_state": "awaiting_refinement",
            "validation_status": "awaiting_refinement",
            "warnings": [str(error)],
          }
        if not result:
          continue
        result.setdefault("page_number", page_number)
        key = (page_number, _candidate_key(result))
        if not key[1]:
          continue
        if key in by_key:
          by_key[key] = _merge_candidate(by_key[key], result)
        else:
          by_key[key] = result

    if not by_key:
      return base_payload

    formulas: list[dict[str, Any]] = []
    artifacts: list[dict[str, Any]] = []
    regions: list[dict[str, Any]] = []
    links: list[dict[str, Any]] = []
    confidence_values: list[float] = []
    for index, ((page_number, _), formula) in enumerate(sorted(by_key.items(), key=lambda item: (item[0][0], item[0][1])), start=1):
      artifact_id = _stable_id("mathart", source_path, page_number, index, formula.get("normalized_latex") or formula.get("raw_text"))
      region_id = _stable_id("mathregion", artifact_id, index)
      formula_id = _stable_id("mathformula", artifact_id, formula.get("normalized_latex") or formula.get("raw_text"))
      link_id = _stable_id("mathlink", formula_id, page_number)
      confidence = round(_safe_float(formula.get("confidence")), 3)
      warnings = list(formula.get("warnings") or [])
      selected_provider = formula.get("selected_provider") or formula.get("provider_name") or self.heuristic.name
      model_name = next((provider.model_name for provider in self.providers if provider.name == selected_provider), self.heuristic.model_name)
      status = formula.get("validation_status") or ("recognized" if formula.get("latex") else "low_confidence")
      extraction_mode = "ocr_math" if selected_provider != self.heuristic.name else formula.get("extraction_mode", "native_math")
      artifact = {
        "id": artifact_id,
        "page_number": page_number,
        "source_ref": str(source_path),
        "region_box": None,
        "image_path": None,
        "raw_text": formula.get("raw_text") or "",
        "latex": formula.get("latex"),
        "confidence": confidence,
        "provider_name": formula.get("provider_name") or selected_provider,
        "selected_provider": selected_provider,
        "model_name": model_name,
        "extraction_mode": extraction_mode,
        "provider_attempts": formula.get("provider_attempts") or [],
        "normalized_latex": formula.get("normalized_latex"),
        "mathml": formula.get("mathml"),
        "handwriting_likelihood": float(formula.get("handwriting_likelihood", 0.0) or 0.0),
        "quality_tier": formula.get("quality_tier", "heuristic"),
        "retry_state": formula.get("retry_state", "idle"),
        "warnings": warnings,
        "validation_state": status,
      }
      region_payload = {
        "id": region_id,
        "artifact_id": artifact_id,
        "page_number": page_number,
        "region_index": 1,
        "bbox": None,
        "image_path": None,
        "raw_text": formula.get("raw_text") or "",
        "confidence": confidence,
        "provider_attempts": formula.get("provider_attempts") or [],
        "handwriting_likelihood": float(formula.get("handwriting_likelihood", 0.0) or 0.0),
        "quality_tier": formula.get("quality_tier", "region"),
        "status": status,
        "warnings": warnings,
      }
      formula_payload = dict(formula)
      formula_payload.update(
        {
          "id": formula_id,
          "artifact_id": artifact_id,
          "region_id": region_id,
          "page_number": page_number,
          "label": formula.get("label") or f"Page {page_number} formula 1",
          "provider_name": artifact["provider_name"],
          "selected_provider": selected_provider,
          "model_name": model_name,
          "extraction_mode": extraction_mode,
          "validation_status": status,
          "warnings": warnings,
        }
      )
      link_payload = {
        "id": link_id,
        "formula_id": formula_id,
        "artifact_id": artifact_id,
        "region_id": region_id,
        "link_type": "page",
        "payload": {"page_number": page_number, "source_ref": str(source_path)},
      }
      artifacts.append(artifact)
      regions.append(region_payload)
      formulas.append(formula_payload)
      links.append(link_payload)
      confidence_values.append(confidence)

    formula_count = len(formulas)
    formula_recognized = sum(1 for item in formulas if item.get("latex"))
    formula_pending = formula_count - formula_recognized
    average_confidence = round(sum(confidence_values) / len(confidence_values), 3) if confidence_values else 0.0
    max_confidence = round(max(confidence_values), 3) if confidence_values else 0.0
    awaiting_refinement = any(item.get("retry_state") == "awaiting_refinement" or item.get("validation_status") == "awaiting_refinement" for item in formulas)
    return {
      "pages_scanned": len({int(item.get("page_number") or 1) for item in formulas}),
      "regions_detected": len(regions),
      "formula_count": formula_count,
      "formula_recognized": formula_recognized,
      "formula_pending": formula_pending,
      "documents_with_math_artifacts": 1 if formula_count else 0,
      "confidence_summary": {"average": average_confidence, "max": max_confidence},
      "awaiting_refinement": awaiting_refinement,
      "recommended_action": "Configure a stronger math OCR provider for low-confidence formulas." if awaiting_refinement else None,
      "artifacts": artifacts,
      "regions": regions,
      "formulae": formulas,
      "links": links,
    }


def build_math_provider(settings: Settings) -> MathRecognitionProvider:
  return TieredMathRecognitionProvider(settings)
