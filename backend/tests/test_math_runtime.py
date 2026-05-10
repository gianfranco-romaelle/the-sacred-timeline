from __future__ import annotations

from pathlib import Path

from app.config import Settings
from app.math_runtime import (
  HeuristicMathRecognitionProvider,
  TieredMathRecognitionProvider,
  build_math_provider,
  _normalize_latex,
)


def test_normalize_latex_preserves_common_math_symbols():
  payload = _normalize_latex("Δω = γB_0 + √2 ≤ Ω")
  assert payload is not None
  assert r"\Delta" in payload
  assert r"\omega" in payload
  assert r"\gamma" in payload
  assert "B_{0}" in payload
  assert r"\sqrt{2}" in payload
  assert r"\leq" in payload
  assert r"\Omega" in payload


def test_heuristic_provider_extracts_native_math_artifacts(tmp_path: Path):
  provider = HeuristicMathRecognitionProvider(
    Settings(
      math_pix2text_enabled=False,
      math_unimernet_enabled=False,
      math_nougat_enabled=False,
      math_mathpix_enabled=False,
    )
  )
  parsed = {
    "title": "math",
    "pages": [
      {
        "number": 1,
        "text": "The governing equation is Δω = γB_0 and E = mc^2.",
        "metadata": {"extraction_mode": "native_text", "ocr_confidence": 1.0},
      }
    ],
    "text": "The governing equation is Δω = γB_0 and E = mc^2.",
    "warnings": [],
    "language": "en",
    "metadata": {},
  }

  result = provider.extract_document_math(Path("math.txt"), parsed, artifact_dir=tmp_path)

  assert result["pages_scanned"] == 1
  assert result["formula_count"] >= 1
  assert result["formula_recognized"] >= 1
  assert result["documents_with_math_artifacts"] == 1
  assert result["formulae"][0]["latex"]
  assert r"\Delta" in result["formulae"][0]["latex"]


def test_build_math_provider_returns_tiered_provider():
  provider = build_math_provider(
    Settings(
      math_pix2text_enabled=False,
      math_unimernet_enabled=False,
      math_nougat_enabled=False,
      math_mathpix_enabled=False,
    )
  )
  assert isinstance(provider, TieredMathRecognitionProvider)


def test_tiered_provider_falls_back_to_heuristic_when_stronger_providers_disabled(tmp_path: Path):
  provider = TieredMathRecognitionProvider(
    Settings(
      math_pix2text_enabled=False,
      math_unimernet_enabled=False,
      math_nougat_enabled=False,
      math_mathpix_enabled=False,
    )
  )
  parsed = {
    "title": "math",
    "pages": [
      {
        "number": 1,
        "text": "The governing equation is Δω = γB_0 and E = mc^2.",
        "metadata": {"extraction_mode": "native_text", "ocr_confidence": 1.0},
      }
    ],
    "text": "The governing equation is Δω = γB_0 and E = mc^2.",
    "warnings": [],
    "language": "en",
    "metadata": {},
  }

  result = provider.extract_document_math(Path("math.txt"), parsed, artifact_dir=tmp_path)

  assert result["formula_count"] >= 1
  assert result["formulae"][0]["selected_provider"] == "heuristic_math"
  assert result["formulae"][0]["latex"]
