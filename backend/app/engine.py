from __future__ import annotations

import fnmatch
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import uuid
from tempfile import TemporaryDirectory
from pathlib import Path
from typing import Any, Mapping

from .bootstrap import activate_vendor_path
from .citation_runtime import extract_document_citations
from .config import Settings
from . import repository
from .errors import ServiceDependencyError
from .math_runtime import build_math_provider
from .providers import (
  FallbackReasoner,
  RemoteServiceError,
  _classify_remote_error,
  build_embedding_provider,
  build_ocr_provider,
  build_reasoner,
  build_reranker,
)

activate_vendor_path()

try:
  from bs4 import BeautifulSoup
except Exception:  # pragma: no cover - optional import
  BeautifulSoup = None

try:
  from docx import Document as DocxDocument
except Exception:  # pragma: no cover - optional import
  DocxDocument = None

try:
  from ebooklib import ITEM_DOCUMENT, epub
except Exception:  # pragma: no cover - optional import
  ITEM_DOCUMENT = None
  epub = None

try:
  from pypdf import PdfReader
except Exception:  # pragma: no cover - optional import
  PdfReader = None

try:
  import httpx
except Exception:  # pragma: no cover - optional import
  httpx = None

try:
  import psutil
except Exception:  # pragma: no cover - optional import
  psutil = None

try:
  import resource
except Exception:  # pragma: no cover - non-Unix
  resource = None

try:
  from qdrant_client import QdrantClient
  from qdrant_client.models import Distance, FieldCondition, Filter, MatchAny, MatchValue, PointStruct, VectorParams
except Exception:  # pragma: no cover - optional import
  QdrantClient = None
  Distance = None
  FieldCondition = None
  Filter = None
  MatchAny = None
  MatchValue = None
  PointStruct = None
  VectorParams = None


IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp"}
SUPPORTED_EXTENSIONS = {".txt", ".md", ".html", ".htm", ".docx", ".epub", ".pdf", ".djvu", *IMAGE_EXTENSIONS}
WORD_PATTERN = re.compile(r"[A-Za-z0-9']+")
SENTENCE_PATTERN = re.compile(r"(?<=[.!?])\s+")
HEADING_PATTERN = re.compile(r"^(chapter|book|section|\d+[.)])\s+", re.IGNORECASE)


# Extraction can run in reduced mode when OCR is unavailable. The noop provider
# gives the engine a stable interface without pretending OCR succeeded.
class _NoopOCRProvider:
  def get_pdf_page_count(self, _path: Path) -> int:
    return 0

  def ocr_pdf_page(self, _path: Path, _page_number: int) -> dict[str, Any]:
    return {"text": "", "confidence": 0.0, "warnings": []}

  def ocr_image(self, _path: Path) -> dict[str, Any]:
    return {"text": "", "confidence": 0.0, "warnings": []}


def extract_document_with_timeout(
  source_path: Path,
  ocr_provider,
  *,
  include_ocr: bool = True,
  timeout_seconds: float | None = None,
) -> dict[str, Any]:
  if include_ocr or not timeout_seconds or timeout_seconds <= 0:
    return extract_document(source_path, ocr_provider, include_ocr=include_ocr)

  script_path = Path(__file__).resolve().parents[1] / "run_extract_subprocess.py"
  command = [sys.executable, str(script_path), "--source", str(source_path)]
  child_env = dict(os.environ)
  child_env["PYTHONIOENCODING"] = "utf-8"
  child_env["PYTHONUTF8"] = "1"
  try:
    result = subprocess.run(
      command,
      capture_output=True,
      text=True,
      encoding="utf-8",
      errors="ignore",
      timeout=timeout_seconds,
      env=child_env,
      check=False,
    )
  except subprocess.TimeoutExpired as error:
    raise RuntimeError(f"Timed out while extracting {source_path.name} after {timeout_seconds:.0f} seconds") from error

  stdout_lines = [line.strip() for line in (result.stdout or "").splitlines() if line.strip()]
  payload = None
  if stdout_lines:
    try:
      payload = json.loads(stdout_lines[-1])
    except json.JSONDecodeError:
      payload = None
  if not payload:
    stderr_text = (result.stderr or "").strip()
    message = stderr_text or "Extractor worker exited before returning a result."
    raise RuntimeError(f"{message} ({source_path.name})")

  if payload.get("ok"):
    return payload["parsed"]

  service_error = payload.get("service_error")
  if service_error:
    raise ServiceDependencyError(
      code=service_error.get("code") or "extract_dependency_missing",
      message=service_error.get("message") or f"Extraction dependency is unavailable for {source_path.name}.",
      missing_services=service_error.get("missing_services") or [],
    )

  raise RuntimeError(payload.get("error") or f"Unable to extract {source_path.name}.")


def tokenize_words(text: str) -> list[str]:
  return [token.lower() for token in WORD_PATTERN.findall(text)]


def text_checksum(value: str) -> str:
  return hashlib.sha1(value.encode("utf-8", errors="ignore")).hexdigest()


def summarize_text(text: str, max_sentences: int = 2, max_words: int = 70) -> str:
  cleaned = " ".join(text.split())
  if not cleaned:
    return "No extractable text was available."
  sentences = [sentence.strip() for sentence in SENTENCE_PATTERN.split(cleaned) if sentence.strip()]
  summary = " ".join(sentences[:max_sentences]).strip()
  words = summary.split()
  if len(words) > max_words:
    summary = " ".join(words[:max_words]).rstrip(" ,.;:") + "..."
  return summary or cleaned[:280]


def detect_language(text: str) -> str:
  lowered = f" {text.lower()} "
  if any(token in lowered for token in (" le ", " la ", " les ", " des ", " une ")):
    return "fr"
  if any(token in lowered for token in (" der ", " die ", " und ", " das ")):
    return "de"
  return "en"


def lexical_overlap_score(query: str, text: str) -> float:
  query_tokens = set(tokenize_words(query))
  text_tokens = tokenize_words(text)
  if not query_tokens or not text_tokens:
    return 0.0
  return len(query_tokens & set(text_tokens)) / max(1, len(query_tokens))


def reciprocal_rank_fusion(result_sets: list[list[dict[str, Any]]], k: int = 60) -> list[dict[str, Any]]:
  merged: dict[str, dict[str, Any]] = {}
  for result_set in result_sets:
    for rank, item in enumerate(result_set, start=1):
      score = 1.0 / (k + rank)
      entry = merged.setdefault(item["id"], {**item, "score": 0.0})
      entry["score"] += score
      if item.get("text") and not entry.get("text"):
        entry["text"] = item["text"]
  return sorted(merged.values(), key=lambda item: item["score"], reverse=True)


def _command_path(name: str) -> str | None:
  resolved = shutil.which(name) or shutil.which(f"{name}.exe")
  if resolved:
    return resolved
  if not sys.platform.startswith("win"):
    return None
  normalized = str(name or "").lower().removesuffix(".exe")
  windows_roots = [
    Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")),
    Path(os.environ.get("ProgramFiles", r"C:\Program Files")),
  ]
  known_locations = {
    "djvutxt": [root / "DjVuLibre" / "djvutxt.exe" for root in windows_roots],
    "ddjvu": [root / "DjVuLibre" / "ddjvu.exe" for root in windows_roots],
  }
  for candidate in known_locations.get(normalized, []):
    if candidate.exists():
      return str(candidate)
  return None


def _run_external_command(args: list[str]) -> subprocess.CompletedProcess[str]:
  return subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="ignore", check=False)


def _markdown_math_block(latex: str, *, display: bool = True) -> str:
  cleaned = str(latex or "").strip()
  if not cleaned:
    return ""
  if display:
    return f"$$\n{cleaned}\n$$"
  return f"${cleaned}$"


def _looks_like_display_math(raw_text: str, latex: str) -> bool:
  candidate = str(raw_text or latex or "").strip()
  if not candidate:
    return False
  if "\n" in candidate:
    return True
  if len(candidate) >= 24:
    return True
  if any(token in candidate for token in ("=", r"\sum", r"\int", r"\prod", r"\frac", r"\begin", "->", "=>")):
    return True
  return False


def _inject_page_formulae(page_text: str, formulae: list[dict[str, Any]]) -> tuple[str, set[str]]:
  updated = str(page_text or "")
  injected_ids: set[str] = set()
  ordered = sorted(
    [dict(item) for item in formulae if item.get("latex") and str(item.get("raw_text") or "").strip()],
    key=lambda item: len(str(item.get("raw_text") or "")),
    reverse=True,
  )
  for formula in ordered:
    raw_text = str(formula.get("raw_text") or "").strip()
    formula_id = str(formula.get("id") or "")
    latex = str(formula.get("latex") or "").strip()
    if not raw_text or not latex or raw_text not in updated:
      continue
    updated = updated.replace(raw_text, _markdown_math_block(latex, display=_looks_like_display_math(raw_text, latex)), 1)
    if formula_id:
      injected_ids.add(formula_id)
  return (updated, injected_ids)


class RemoteVectorUpsertClient:
  def __init__(self, settings: Settings) -> None:
    self.settings = settings
    self.base_url = str(getattr(settings, "effective_remote_vector_upsert_url", "") or "").rstrip("/")
    self.api_key = getattr(settings, "remote_vector_upsert_api_key", None) or getattr(settings, "remote_ocr_api_key", None)
    self.timeout_seconds = float(getattr(settings, "remote_vector_upsert_timeout_seconds", 120.0) or 120.0)

  @property
  def enabled(self) -> bool:
    return bool(getattr(self.settings, "use_remote_vector_upsert", False) and self.base_url)

  def _headers(self) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if self.api_key:
      headers["Authorization"] = f"Bearer {self.api_key}"
    return headers

  def check_ready(self) -> tuple[bool, str | None]:
    if not self.enabled:
      return (False, "Remote vector upsert is disabled.")
    if httpx is None:
      return (False, "httpx is not available.")
    health_url = self.base_url
    if health_url.endswith("/v1/vector/upsert"):
      health_url = health_url[: -len("/v1/vector/upsert")] + "/health"
    try:
      response = httpx.get(health_url, timeout=min(self.timeout_seconds, 5.0))
      response.raise_for_status()
      payload = response.json()
      providers = dict(payload.get("providers") or {})
      vector_backend = dict(providers.get("vector_backend") or {})
      if payload.get("ready") is False:
        return (False, str(payload.get("detail") or payload.get("status") or "Remote compute node is not ready."))
      if vector_backend and not bool(vector_backend.get("ready")):
        return (False, str(vector_backend.get("detail") or "Remote vector backend is not ready."))
      return (True, self.base_url)
    except Exception as error:
      remote_error = error if isinstance(error, Exception) else RuntimeError(str(error))
      classified = RemoteServiceError("remote_vector_upsert", "service_unavailable", str(remote_error), node_url=self.base_url)
      if isinstance(remote_error, Exception):
        classified = RemoteServiceError("remote_vector_upsert", "service_unavailable", str(remote_error), node_url=self.base_url)
        if httpx is not None:
          try:
            classified = _classify_remote_error("remote_vector_upsert", self.base_url, remote_error)  # type: ignore[arg-type]
          except Exception:
            pass
      return (False, classified.message)

  def status(self) -> dict[str, Any]:
    ready, detail = self.check_ready()
    return {
      "enabled": self.enabled,
      "ready": ready,
      "detail": detail,
      "node_url": self.base_url or None,
      "collection": self.settings.qdrant_collection_name,
      "mode": "remote_compute_node" if self.enabled else "disabled",
    }

  def upsert_points(self, points: list[dict[str, Any]]) -> dict[str, Any]:
    if not self.enabled:
      return {"upserted_count": 0, "point_ids": [], "collection": self.settings.qdrant_collection_name, "mode": "disabled"}
    if httpx is None:
      raise RemoteServiceError("remote_vector_upsert", "service_unavailable", "httpx is not available.", node_url=self.base_url)
    payload = {
      "collection": self.settings.qdrant_collection_name,
      "points": points,
    }
    try:
      response = httpx.post(
        self.base_url,
        headers=self._headers(),
        json=payload,
        timeout=self.timeout_seconds,
      )
      response.raise_for_status()
    except Exception as error:
      raise _classify_remote_error("remote_vector_upsert", self.base_url, error) from error
    body = response.json()
    if isinstance(body.get("data"), dict):
      body = body["data"]
    point_ids = [str(value) for value in list(body.get("point_ids", []) or [])]
    return {
      "upserted_count": int(body.get("upserted_count", len(point_ids)) or 0),
      "point_ids": point_ids,
      "collection": str(body.get("collection") or self.settings.qdrant_collection_name),
      "node_url": self.base_url,
      "mode": "remote_compute_node",
      "latency_ms": float(body.get("latency_ms", 0.0) or 0.0),
      "queue_wait_ms": float(body.get("queue_wait_ms", 0.0) or 0.0),
      "warnings": list(body.get("warnings", []) or []),
    }


# VectorIndex is the vendor-facing vector seam. The rest of the engine talks to
# it in retrieval terms so backend storage choices can evolve independently.
class VectorIndex:
  def __init__(self, settings: Settings, embedder) -> None:
    self.settings = settings
    self.embedder = embedder
    self.client = None
    self.detail = None
    self.mode = None
    self.storage_path = None
    self.remote_upsert = RemoteVectorUpsertClient(settings)
    if QdrantClient is not None and VectorParams is not None and Distance is not None:
      try:
        kwargs = {"url": settings.qdrant_url, "check_compatibility": False}
        if settings.qdrant_api_key:
          kwargs["api_key"] = settings.qdrant_api_key
        self.client = QdrantClient(**kwargs)
        self.mode = "remote"
        self._ensure_collection()
      except Exception as error:
        remote_error = str(error)
        self.client = None
        self.mode = None
        if settings.enable_local_qdrant_fallback and not self.remote_upsert.enabled:
          try:
            local_path = settings.resolved_qdrant_local_path
            local_path.mkdir(parents=True, exist_ok=True)
            self.client = QdrantClient(path=str(local_path))
            self.mode = "local"
            self.storage_path = str(local_path)
            self.detail = f"Remote Qdrant unavailable; using local vector store at {local_path}."
            self._ensure_collection()
          except Exception as local_error:
            self.client = None
            self.mode = None
            self.detail = f"Remote Qdrant unavailable ({remote_error}); local fallback failed ({local_error})."
        else:
          self.detail = remote_error
    else:
      self.detail = "qdrant-client is not installed."

  def _ensure_collection(self) -> None:
    if self.client is None:
      return
    collections = self.client.get_collections().collections
    existing = {item.name for item in collections}
    if self.settings.qdrant_collection_name not in existing:
      self.client.create_collection(
        collection_name=self.settings.qdrant_collection_name,
        vectors_config=VectorParams(size=self.settings.vector_size, distance=Distance.COSINE),
      )
    try:
      self.client.create_payload_index(self.settings.qdrant_collection_name, "document_id", "keyword")
      self.client.create_payload_index(self.settings.qdrant_collection_name, "node_type", "keyword")
      self.client.create_payload_index(self.settings.qdrant_collection_name, "summary_level", "keyword")
    except Exception:
      pass

  @property
  def search_enabled(self) -> bool:
    return self.client is not None

  @property
  def write_enabled(self) -> bool:
    return bool(self.remote_upsert.enabled or self.client is not None)

  @property
  def enabled(self) -> bool:
    return self.search_enabled

  def status(self) -> dict[str, Any]:
    return {
      "configured_url": self.settings.qdrant_url,
      "ready": self.search_enabled,
      "write_ready": self.write_enabled,
      "detail": self.detail,
      "collection": self.settings.qdrant_collection_name,
      "mode": self.mode,
      "storage_path": self.storage_path,
      "write_mode": "remote_compute_node" if self.remote_upsert.enabled else self.mode,
      "remote_upsert": self.remote_upsert.status(),
    }

  def _build_filter(self, node_types: list[str], summary_levels: list[str | None] | None, document_ids: list[str] | None):
    if not self.search_enabled or Filter is None or FieldCondition is None or MatchValue is None:
      return None
    conditions: list[Any] = []
    if node_types:
      if len(node_types) == 1:
        conditions.append(FieldCondition(key="node_type", match=MatchValue(value=node_types[0])))
      elif MatchAny is not None:
        conditions.append(FieldCondition(key="node_type", match=MatchAny(any=node_types)))
    if summary_levels:
      normalized = [level or "" for level in summary_levels]
      if len(normalized) == 1:
        conditions.append(FieldCondition(key="summary_level", match=MatchValue(value=normalized[0])))
      elif MatchAny is not None:
        conditions.append(FieldCondition(key="summary_level", match=MatchAny(any=normalized)))
    if document_ids:
      if len(document_ids) == 1:
        conditions.append(FieldCondition(key="document_id", match=MatchValue(value=document_ids[0])))
      elif MatchAny is not None:
        conditions.append(FieldCondition(key="document_id", match=MatchAny(any=document_ids)))
    return Filter(must=conditions) if conditions else None

  def _embedding_provenance(self) -> dict[str, Any]:
    if hasattr(self.embedder, "provenance"):
      return dict(self.embedder.provenance())
    return {
      "provider": getattr(self.embedder, "name", "embedding"),
      "location": "local",
      "detail": getattr(self.embedder, "detail", None),
    }

  def _vector_provenance_template(self) -> dict[str, Any]:
    if self.remote_upsert.enabled:
      return {
        "location": "remote",
        "node_url": self.remote_upsert.base_url,
        "collection": self.settings.qdrant_collection_name,
        "mode": "remote_compute_node",
      }
    return {
      "location": "local" if self.mode == "local" else "remote",
      "collection": self.settings.qdrant_collection_name,
      "mode": self.mode,
      "storage_path": self.storage_path,
      "configured_url": self.settings.qdrant_url,
    }

  def _eligible_nodes(self, nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
      node
      for node in nodes
      if node.get("node_type") in {"summary", "chunk"} and str(node.get("text") or "").strip()
    ]

  def _point_id_for_node(self, node_id: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"{self.settings.qdrant_collection_name}:{node_id}"))

  def _prepare_vectors(self, nodes: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    eligible = self._eligible_nodes(nodes)
    missing = [node for node in eligible if not isinstance(node.get("embedding_vector"), list) or not node.get("embedding_vector")]
    if missing:
      texts = [str(node.get("text") or "") for node in missing]
      vectors = self.embedder.embed_many(texts)
      embedding_provenance = self._embedding_provenance()
      timestamp = repository.utc_now()
      for node, vector in zip(missing, vectors):
        node["embedding_vector"] = [float(value) for value in vector]
        metadata = dict(node.get("metadata_json") or {})
        metadata["embedding_provenance"] = {
          **embedding_provenance,
          "recorded_at": timestamp,
          "vector_dimension": len(vector),
        }
        node["metadata_json"] = metadata
    return eligible, self._embedding_provenance()

  def upsert_nodes(self, nodes: list[dict[str, Any]]) -> dict[str, Any]:
    if not self.write_enabled:
      raise RuntimeError("Vector index is not available for writes.")
    eligible, embedding_provenance = self._prepare_vectors(nodes)
    if not eligible:
      return {
        "upserted_count": 0,
        "point_ids": [],
        "embedding_provenance": embedding_provenance,
        "vector_provenance": self._vector_provenance_template(),
      }
    points = []
    for node in eligible:
      points.append({
        "id": str(node["id"]) if self.remote_upsert.enabled else self._point_id_for_node(str(node["id"])),
        "node_id": str(node["id"]),
        "vector": [float(value) for value in list(node.get("embedding_vector") or [])],
        "payload": {
          "node_id": str(node["id"]),
          "document_id": node["document_id"],
          "node_type": node["node_type"],
          "summary_level": node.get("summary_level") or "",
          "ordinal": node["ordinal"],
          "page_start": node["page_start"],
          "page_end": node["page_end"],
          "title": node["title"],
          "text": str(node.get("text") or "")[:4000],
        },
      })
    if self.remote_upsert.enabled:
      result = self.remote_upsert.upsert_points(points)
    else:
      if self.client is None or PointStruct is None:
        raise RuntimeError("Qdrant client is not available.")
      payload_points = [
        PointStruct(id=point["id"], vector=point["vector"], payload=point["payload"])
        for point in points
      ]
      self.client.upsert(collection_name=self.settings.qdrant_collection_name, points=payload_points)
      result = {
        "upserted_count": len(points),
        "point_ids": [str(point["id"]) for point in points],
        "collection": self.settings.qdrant_collection_name,
        "mode": self.mode,
        "warnings": [],
      }
    timestamp = repository.utc_now()
    vector_template = {
      **self._vector_provenance_template(),
      "recorded_at": timestamp,
      "upserted_count": int(result.get("upserted_count", len(points)) or 0),
      "remote_point_id": None,
      "warnings": list(result.get("warnings", []) or []),
    }
    point_id_lookup = {str(point["node_id"]): str(point["id"]) for point in points}
    for node in eligible:
      metadata = dict(node.get("metadata_json") or {})
      metadata["embedding_provenance"] = {
        **dict(metadata.get("embedding_provenance") or {}),
        **embedding_provenance,
      }
      metadata["vector_provenance"] = {
        **vector_template,
        "remote_point_id": point_id_lookup.get(str(node["id"])) or str(node["id"]),
      }
      node["metadata_json"] = metadata
    return {
      **result,
      "embedding_provenance": embedding_provenance,
      "vector_provenance": vector_template,
    }

  def search(self, query_text: str, node_types: list[str], summary_levels: list[str | None] | None = None, document_ids: list[str] | None = None, limit: int = 12) -> list[dict[str, Any]]:
    if not self.search_enabled:
      return []
    try:
      query_filter = self._build_filter(node_types, summary_levels, document_ids)
      results = self.client.search(
        collection_name=self.settings.qdrant_collection_name,
        query_vector=self.embedder.embed(query_text),
        limit=limit,
        query_filter=query_filter,
      )
      return [
        {
          "id": str(point.id),
          "node_id": point.payload.get("node_id") or str(point.id),
          "score": float(point.score),
          "document_id": point.payload.get("document_id"),
          "node_type": point.payload.get("node_type"),
          "summary_level": point.payload.get("summary_level") or None,
          "ordinal": point.payload.get("ordinal", 0),
          "page_start": point.payload.get("page_start", 1),
          "page_end": point.payload.get("page_end", 1),
          "title": point.payload.get("title", ""),
          "text": point.payload.get("text", ""),
        }
        for point in results
      ]
    except Exception:
      return []


def extract_plain_text(path: Path) -> tuple[list[dict[str, Any]], list[str], dict[str, Any]]:
  text = path.read_text(encoding="utf-8", errors="ignore")
  return [{"number": 1, "text": text, "metadata": {"extraction_mode": "plain_text", "ocr_confidence": 1.0}}], [], {}


def extract_html(path: Path) -> tuple[list[dict[str, Any]], list[str], dict[str, Any]]:
  raw = path.read_text(encoding="utf-8", errors="ignore")
  if BeautifulSoup is None:
    stripped = re.sub(r"<[^>]+>", " ", raw)
    return [{"number": 1, "text": stripped, "metadata": {"extraction_mode": "html_fallback", "ocr_confidence": 1.0}}], ["BeautifulSoup is unavailable; HTML was stripped with a fallback parser."], {}
  soup = BeautifulSoup(raw, "html.parser")
  title = soup.title.string.strip() if soup.title and soup.title.string else path.stem
  body = soup.get_text("\n", strip=True)
  return [{"number": 1, "text": f"{title}\n\n{body}", "metadata": {"extraction_mode": "html", "ocr_confidence": 1.0}}], [], {}


def extract_docx(path: Path) -> tuple[list[dict[str, Any]], list[str], dict[str, Any]]:
  if DocxDocument is None:
    raise RuntimeError("python-docx is not installed.")
  document = DocxDocument(str(path))
  paragraphs = [paragraph.text.strip() for paragraph in document.paragraphs if paragraph.text.strip()]
  return [{"number": 1, "text": "\n\n".join(paragraphs), "metadata": {"extraction_mode": "docx", "ocr_confidence": 1.0}}], [], {}


def extract_epub(path: Path) -> tuple[list[dict[str, Any]], list[str], dict[str, Any]]:
  if epub is None or ITEM_DOCUMENT is None:
    raise RuntimeError("ebooklib is not installed.")
  book = epub.read_epub(str(path))
  sections = []
  page_number = 1
  for item in book.get_items_of_type(ITEM_DOCUMENT):
    content = item.get_content().decode("utf-8", errors="ignore")
    if BeautifulSoup is not None:
      text = BeautifulSoup(content, "html.parser").get_text("\n", strip=True)
    else:
      text = re.sub(r"<[^>]+>", " ", content)
    if text.strip():
      sections.append({"number": page_number, "text": text, "metadata": {"extraction_mode": "epub", "ocr_confidence": 1.0}})
      page_number += 1
  return sections or [{"number": 1, "text": "", "metadata": {"extraction_mode": "epub", "ocr_confidence": 0.0}}], [], {}


def extract_pdf_via_ocr(path: Path, ocr_provider) -> tuple[list[dict[str, Any]], list[str]]:
  page_count = ocr_provider.get_pdf_page_count(path)
  if not page_count:
    return [], ["Rendered-page OCR could not determine the PDF page count."]
  warnings: list[str] = []
  pages: list[dict[str, Any]] = []
  for index in range(1, page_count + 1):
    ocr_result = ocr_provider.ocr_pdf_page(path, index)
    if ocr_result and ocr_result.get("text", "").strip():
      warnings.extend(ocr_result.get("warnings", []))
      pages.append({
        "number": index,
        "text": ocr_result["text"],
        "metadata": {"extraction_mode": "ocr_rendered_page", "ocr_confidence": float(ocr_result.get("confidence", 0.0))},
      })
    else:
      warnings.append(f"Page {index} could not be read by rendered-page OCR.")
      pages.append({
        "number": index,
        "text": "",
        "metadata": {"extraction_mode": "unavailable", "ocr_confidence": 0.0},
      })
  return pages, warnings


def extract_pdf(path: Path, ocr_provider, include_ocr: bool = True) -> tuple[list[dict[str, Any]], list[str], dict[str, Any]]:
  if PdfReader is None:
    raise RuntimeError("pypdf is not installed.")
  warnings: list[str] = []
  try:
    reader = PdfReader(str(path))
  except Exception as error:
    message = str(error)
    if "cryptography>=3.1 is required for AES algorithm" in message:
      if include_ocr:
        pages, ocr_warnings = extract_pdf_via_ocr(path, ocr_provider)
        if pages:
          warnings.append("Native PDF text extraction required cryptography for AES support; using rendered-page OCR instead.")
          warnings.extend(ocr_warnings)
          return pages, warnings, {"fallback_reason": "pdf_crypto_dependency_missing"}
      raise ServiceDependencyError(
        code="pdf_crypto_dependency_missing",
        message="AES-encrypted PDF import requires the 'cryptography' package for native text extraction.",
        missing_services=["cryptography"],
      ) from error
    raise RuntimeError(f"Unable to open PDF {path.name}: {message}") from error
  pages = []
  for index, page in enumerate(reader.pages, start=1):
    try:
      text = page.extract_text() or ""
    except Exception as error:
      message = str(error)
      if "cryptography>=3.1 is required for AES algorithm" in message:
        if include_ocr:
          ocr_result = ocr_provider.ocr_pdf_page(path, index)
          if ocr_result and ocr_result.get("text", "").strip():
            warnings.append(f"Page {index} required rendered-page OCR because native PDF extraction needed cryptography.")
            warnings.extend(ocr_result.get("warnings", []))
            pages.append({
              "number": index,
              "text": ocr_result["text"],
              "metadata": {"extraction_mode": "ocr_rendered_page", "ocr_confidence": float(ocr_result.get("confidence", 0.0))},
            })
            continue
        raise ServiceDependencyError(
          code="pdf_crypto_dependency_missing",
          message="AES-encrypted PDF import requires the 'cryptography' package for native text extraction.",
          missing_services=["cryptography"],
        ) from error
      raise RuntimeError(f"Unable to extract text from {path.name} page {index}: {message}") from error
    metadata = {"extraction_mode": "native_text", "ocr_confidence": 1.0}
    if not text.strip() and include_ocr:
      ocr_result = ocr_provider.ocr_pdf_page(path, index)
      if ocr_result and ocr_result.get("text", "").strip():
        text = ocr_result["text"]
        metadata = {"extraction_mode": "ocr_rendered_page", "ocr_confidence": float(ocr_result.get("confidence", 0.0))}
        warnings.extend(ocr_result.get("warnings", []))
      else:
        warnings.append(f"Page {index} had no native text and OCR fallback was unavailable or empty.")
        metadata = {"extraction_mode": "unavailable", "ocr_confidence": 0.0}
    elif not text.strip():
      metadata = {"extraction_mode": "native_text_missing", "ocr_confidence": 0.0}
    pages.append({"number": index, "text": text, "metadata": metadata})
  return pages or [{"number": 1, "text": "", "metadata": {"extraction_mode": "pdf", "ocr_confidence": 0.0}}], warnings, {}


def _split_djvu_pages(text: str) -> list[str]:
  if not text:
    return []
  blocks = [block.strip() for block in re.split(r"\f+", text) if block.strip()]
  return blocks or [text.strip()]


def extract_djvu_native_text(path: Path) -> tuple[list[dict[str, Any]], list[str], dict[str, Any]]:
  extractor = _command_path("djvutxt")
  if extractor is None:
    raise ServiceDependencyError(
      code="djvu_dependency_missing",
      message="DJVU import requires the 'djvutxt' command for native text extraction.",
      missing_services=["djvutxt"],
    )
  result = _run_external_command([extractor, str(path)])
  if result.returncode != 0:
    message = (result.stderr or result.stdout or "").strip() or f"Failed to extract text from {path.name}."
    raise RuntimeError(message)
  page_blocks = _split_djvu_pages(result.stdout)
  pages = [
    {
      "number": index,
      "text": block,
      "metadata": {"extraction_mode": "djvu_native_text", "ocr_confidence": 1.0},
    }
    for index, block in enumerate(page_blocks, start=1)
  ]
  if not pages:
    pages = [{"number": 1, "text": "", "metadata": {"extraction_mode": "djvu_native_text_missing", "ocr_confidence": 0.0}}]
  return pages, [], {}


def extract_djvu_via_ocr(path: Path, ocr_provider) -> tuple[list[dict[str, Any]], list[str], dict[str, Any]]:
  renderer = _command_path("ddjvu")
  if renderer is None:
    raise ServiceDependencyError(
      code="djvu_dependency_missing",
      message="DJVU OCR fallback requires the 'ddjvu' command to render pages as images.",
      missing_services=["ddjvu"],
    )
  pages: list[dict[str, Any]] = []
  warnings: list[str] = []
  with TemporaryDirectory() as temp_dir:
    workspace = Path(temp_dir)
    page_number = 1
    while True:
      image_path = workspace / f"page-{page_number}.tiff"
      result = _run_external_command([renderer, f"-page={page_number}", "-format=tiff", str(path), str(image_path)])
      if result.returncode != 0 or not image_path.exists():
        if page_number == 1:
          message = (result.stderr or result.stdout or "").strip() or f"Unable to render DJVU pages for {path.name}."
          raise RuntimeError(message)
        break
      ocr_result = ocr_provider.ocr_image(image_path)
      page_text = ocr_result.get("text", "")
      warnings.extend(ocr_result.get("warnings", []))
      if not page_text.strip():
        warnings.append(f"DJVU page {page_number} had no OCR text.")
      pages.append(
        {
          "number": page_number,
          "text": page_text,
          "metadata": {"extraction_mode": "djvu_ocr", "ocr_confidence": float(ocr_result.get("confidence", 0.0))},
        }
      )
      page_number += 1
  return pages, warnings, {"fallback_reason": "djvu_ocr"}


def extract_djvu(path: Path, ocr_provider, include_ocr: bool = True) -> tuple[list[dict[str, Any]], list[str], dict[str, Any]]:
  warnings: list[str] = []
  metadata: dict[str, Any] = {}
  try:
    pages, native_warnings, metadata = extract_djvu_native_text(path)
    warnings.extend(native_warnings)
  except ServiceDependencyError as error:
    if not include_ocr:
      raise
    pages = []
    warnings.append(error.message)
  if any(page.get("text", "").strip() for page in pages):
    return pages, warnings, metadata
  if include_ocr:
    ocr_pages, ocr_warnings, ocr_metadata = extract_djvu_via_ocr(path, ocr_provider)
    return ocr_pages or pages, warnings + ocr_warnings, {**metadata, **ocr_metadata}
  return pages, warnings, metadata


def extract_image(path: Path, ocr_provider, include_ocr: bool = True) -> tuple[list[dict[str, Any]], list[str], dict[str, Any]]:
  if not include_ocr:
    return [{"number": 1, "text": "", "metadata": {"extraction_mode": "image_pending_ocr", "ocr_confidence": 0.0}}], [], {}
  result = ocr_provider.ocr_image(path)
  warnings = list(result.get("warnings", []))
  if not result.get("text", "").strip():
    warnings.append(f"OCR could not extract text from {path.name}.")
  return [{"number": 1, "text": result.get("text", ""), "metadata": {"extraction_mode": "ocr_image", "ocr_confidence": float(result.get("confidence", 0.0))}}], warnings, {}


def extract_document(source_path: Path, ocr_provider, include_ocr: bool = True) -> dict[str, Any]:
  extension = source_path.suffix.lower()
  if extension in {".txt", ".md"}:
    pages, warnings, metadata = extract_plain_text(source_path)
  elif extension in {".html", ".htm"}:
    pages, warnings, metadata = extract_html(source_path)
  elif extension == ".docx":
    pages, warnings, metadata = extract_docx(source_path)
  elif extension == ".epub":
    pages, warnings, metadata = extract_epub(source_path)
  elif extension == ".pdf":
    pages, warnings, metadata = extract_pdf(source_path, ocr_provider, include_ocr=include_ocr)
  elif extension == ".djvu":
    pages, warnings, metadata = extract_djvu(source_path, ocr_provider, include_ocr=include_ocr)
  elif extension in IMAGE_EXTENSIONS:
    pages, warnings, metadata = extract_image(source_path, ocr_provider, include_ocr=include_ocr)
  else:
    raise RuntimeError(f"Unsupported file type: {source_path.suffix or 'unknown'}")
  combined_text = "\n\n".join(page["text"] for page in pages if page["text"].strip())
  return {
    "title": source_path.stem.replace("_", " ").strip() or source_path.stem,
    "file_type": extension.lstrip(".") or "txt",
    "pages": pages,
    "warnings": warnings,
    "text": combined_text,
    "language": detect_language(combined_text),
    "metadata": metadata,
  }


def split_sections(pages: list[dict[str, Any]]) -> list[dict[str, Any]]:
  sections: list[dict[str, Any]] = []
  current_pages: list[dict[str, Any]] = []
  current_title = "Section 1"

  def flush() -> None:
    nonlocal current_pages, current_title
    if not current_pages:
      return
    sections.append({
      "title": current_title,
      "page_start": current_pages[0]["number"],
      "page_end": current_pages[-1]["number"],
      "text": "\n\n".join(page["text"] for page in current_pages),
      "pages": current_pages,
    })
    current_pages = []
    current_title = f"Section {len(sections) + 1}"

  for page in pages:
    page_text = page["text"].strip()
    heading_line = next((line.strip() for line in page_text.splitlines()[:4] if line.strip()), "")
    if heading_line and (HEADING_PATTERN.match(heading_line) or heading_line.isupper()):
      flush()
      current_title = heading_line[:120]
    current_pages.append(page)
    if len(current_pages) >= 6:
      flush()
  flush()
  return sections or [{
    "title": "Section 1",
    "page_start": pages[0]["number"] if pages else 1,
    "page_end": pages[-1]["number"] if pages else 1,
    "text": "\n\n".join(page["text"] for page in pages),
    "pages": pages,
  }]


def group_chapters(sections: list[dict[str, Any]]) -> list[dict[str, Any]]:
  chapters: list[list[dict[str, Any]]] = []
  bucket: list[dict[str, Any]] = []
  for section in sections:
    bucket.append(section)
    if len(bucket) >= 3:
      chapters.append(bucket)
      bucket = []
  if bucket:
    chapters.append(bucket)
  return [{
    "title": f"Chapter {index}",
    "page_start": chapter_sections[0]["page_start"],
    "page_end": chapter_sections[-1]["page_end"],
    "sections": chapter_sections,
    "text": "\n\n".join(section["text"] for section in chapter_sections),
  } for index, chapter_sections in enumerate(chapters, start=1)]


def split_text_fragments(text: str) -> list[str]:
  paragraphs = [paragraph.strip() for paragraph in re.split(r"\n{2,}", text) if paragraph.strip()]
  fragments: list[str] = []
  for paragraph in paragraphs:
    sentences = [sentence.strip() for sentence in SENTENCE_PATTERN.split(paragraph) if sentence.strip()]
    if sentences:
      fragments.extend(sentences)
    else:
      fragments.append(paragraph)
  return fragments or ([text.strip()] if text.strip() else [])


def chunk_section(section: dict[str, Any], document_id: str, language: str, start_ordinal: int, token_counter) -> tuple[list[dict[str, Any]], int]:
  chunks: list[dict[str, Any]] = []
  ordinal = start_ordinal
  pages = section["pages"]
  buffer_fragments: list[dict[str, Any]] = []
  buffer_token_count = 0
  buffer_start_page = pages[0]["number"] if pages else 1

  def flush_buffer() -> None:
    nonlocal ordinal, buffer_fragments, buffer_start_page, buffer_token_count
    if not buffer_fragments:
      return
    chunk_text = "\n\n".join(fragment["text"] for fragment in buffer_fragments)
    chunk_end_page = buffer_fragments[-1]["page_number"]
    chunks.append({
      "id": f"{document_id}-chunk-{ordinal}",
      "document_id": document_id,
      "parent_id": f"{document_id}-section-{section['ordinal']}",
      "node_type": "chunk",
      "summary_level": None,
      "title": f"Chunk {ordinal}",
      "heading_path": section["title"],
      "ordinal": ordinal,
      "page_start": buffer_start_page,
      "page_end": chunk_end_page,
      "text": chunk_text,
      "token_count": buffer_token_count,
      "language": language,
      "checksum": text_checksum(chunk_text),
      "metadata_json": {"kind": "chunk"},
      "created_at": repository.utc_now(),
      "updated_at": repository.utc_now(),
    })
    ordinal += 1
    overlap_fragments: list[dict[str, Any]] = []
    overlap_tokens = 0
    for fragment in reversed(buffer_fragments):
      overlap_fragments.insert(0, fragment)
      overlap_tokens += fragment["token_count"]
      if overlap_tokens >= 120:
        break
    buffer_fragments = overlap_fragments
    buffer_token_count = overlap_tokens
    buffer_start_page = buffer_fragments[0]["page_number"] if buffer_fragments else chunk_end_page

  for page in pages:
    fragments = split_text_fragments(page["text"])
    page_token_count = sum(max(1, token_counter(fragment)) for fragment in fragments) if fragments else 0
    if page_token_count >= 250 and buffer_fragments:
      flush_buffer()
    for fragment in fragments:
      token_count = max(1, token_counter(fragment))
      if buffer_fragments and buffer_token_count + token_count > 900:
        flush_buffer()
      if not buffer_fragments:
        buffer_start_page = page["number"]
      buffer_fragments.append({"text": fragment, "token_count": token_count, "page_number": page["number"]})
      buffer_token_count += token_count
      while buffer_token_count >= 700:
        flush_buffer()
    if page_token_count >= 250:
      flush_buffer()
  if buffer_fragments:
    flush_buffer()
  return chunks, ordinal


def _page_needs_ocr_refresh(page: dict[str, Any]) -> bool:
  text = str(page.get("text", "") or "")
  metadata = dict(page.get("metadata") or {})
  mode = str(metadata.get("extraction_mode") or "").strip().lower()
  confidence = float(metadata.get("ocr_confidence", 0.0) or 0.0)
  if mode in {"image_pending_ocr", "native_text_missing", "djvu_native_text_missing", "unavailable"}:
    return True
  if not text.strip():
    return True
  if mode.startswith("ocr_"):
    return confidence <= 0.2 and not text.strip()
  return False


# LibraryEngine coordinates provider readiness, extraction, indexing, and query
# synthesis. The comments below mark the seams where fallback behavior matters.
class LibraryEngine:
  PIPELINE_STAGES = ["discover", "extract", "ocr", "structure", "chunk", "summarize", "embed", "index", "research_materialize", "technique_materialize", "complete"]

  def __init__(self, settings: Settings) -> None:
    self.settings = settings
    self._embedder = None
    self._reranker = None
    self._reasoner = None
    self._ocr_provider = None
    self._math_provider = None
    self._vector_index = None

  @property
  def embedder(self):
    if self._embedder is None:
      self._embedder = build_embedding_provider(self.settings)
    return self._embedder

  @embedder.setter
  def embedder(self, value):
    self._embedder = value

  @property
  def reranker(self):
    if self._reranker is None:
      self._reranker = build_reranker(self.settings)
    return self._reranker

  @reranker.setter
  def reranker(self, value):
    self._reranker = value

  @property
  def reasoner(self):
    if self._reasoner is None:
      self._reasoner = build_reasoner(self.settings)
    return self._reasoner

  @reasoner.setter
  def reasoner(self, value):
    self._reasoner = value

  @property
  def ocr_provider(self):
    if self._ocr_provider is None:
      self._ocr_provider = build_ocr_provider(self.settings)
    return self._ocr_provider

  @ocr_provider.setter
  def ocr_provider(self, value):
    self._ocr_provider = value

  @property
  def math_provider(self):
    if self._math_provider is None:
      self._math_provider = build_math_provider(self.settings)
    return self._math_provider

  @math_provider.setter
  def math_provider(self, value):
    self._math_provider = value

  @property
  def vector_index(self):
    if self._vector_index is None:
      self._vector_index = VectorIndex(self.settings, self.embedder)
    return self._vector_index

  @vector_index.setter
  def vector_index(self, value):
    self._vector_index = value

  def provider_status(self) -> dict[str, dict[str, Any]]:
    # Centralize provider readiness here so the API and operational surfaces
    # report the same fallback/degraded state without duplicate probes.
    return {
      "embedding": {
        "name": self.embedder.name,
        "ready": self.embedder.ready,
        "fallback": getattr(self.embedder, "is_fallback", False),
        "detail": self.embedder.check_ready()[1],
        "sources": getattr(self.embedder, "source_statuses", lambda: {})(),
      },
      "reranker": {
        "name": self.reranker.name,
        "ready": self.reranker.ready,
        "fallback": getattr(self.reranker, "is_fallback", False),
        "detail": self.reranker.check_ready()[1],
      },
      "reasoner": {
        "name": self.reasoner.name,
        "ready": self.reasoner.ready,
        "fallback": getattr(self.reasoner, "is_fallback", False),
        "detail": self.reasoner.check_ready()[1],
      },
      "ocr": {
        "name": self.ocr_provider.name,
        "ready": self.ocr_provider.ready,
        "fallback": getattr(self.ocr_provider, "is_fallback", False),
        "detail": self.ocr_provider.check_ready()[1],
        "sources": getattr(self.ocr_provider, "source_statuses", lambda: {})(),
      },
      "math": {
        "name": self.math_provider.name,
        "ready": self.math_provider.ready,
        "fallback": getattr(self.math_provider, "is_fallback", False),
        "detail": self.math_provider.check_ready()[1],
      },
    }

  def system_status(self, connection) -> dict[str, Any]:
    watch_folders = repository.list_watch_folders(connection)
    documents = repository.list_documents(connection)
    technique_materializations = sum(len(repository.list_document_technique_materializations(connection, document["id"])) for document in documents)
    research_graph_documents = sum(1 for document in documents if repository.list_research_graph_nodes(connection, document["id"]))
    jobs = repository.list_import_jobs(connection)
    current_rss_bytes = None
    peak_rss_bytes = None
    if psutil is not None:
      try:
        current_rss_bytes = int(psutil.Process().memory_info().rss)
      except Exception:
        current_rss_bytes = None
    if resource is not None:
      try:
        peak_rss = int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
        if peak_rss > 0:
          peak_rss_bytes = peak_rss * (1024 if os.name != "nt" else 1)
      except Exception:
        peak_rss_bytes = None
    throughputs: list[float] = []
    for job in jobs:
      state = repository.json_loads(job.get("state_json"), {})
      value = state.get("throughput_per_minute")
      if value is not None:
        try:
          throughputs.append(float(value))
        except Exception:
          pass
    return {
      "runtime_mode": self.settings.runtime_mode,
      "dev_fallbacks_enabled": self.settings.dev_fallbacks_enabled,
      "pipeline_version": self.settings.pipeline_version,
      "compute": {
        "mode": getattr(self.settings, "normalized_remote_compute_mode", "local_everything"),
        "use_remote_ocr": bool(getattr(self.settings, "use_remote_ocr", False)),
        "use_remote_embedding": bool(getattr(self.settings, "use_remote_embedding", False)),
        "use_remote_vector_upsert": bool(getattr(self.settings, "use_remote_vector_upsert", False)),
        "remote_ocr_url": getattr(self.settings, "remote_ocr_url", None),
        "remote_embedding_url": getattr(self.settings, "effective_remote_embedding_url", None),
        "remote_vector_upsert_url": getattr(self.settings, "effective_remote_vector_upsert_url", None),
      },
      "qdrant": self.vector_index.status(),
      "providers": self.provider_status(),
      "import_runtime": self.import_runtime_status(),
      "query_runtime": self.query_runtime_status(),
      "jobs": {
        **repository.import_job_stats(connection),
        "pipeline_tasks": len(repository.list_pipeline_tasks(connection)),
      },
      "persistence": {
        "documents": len(documents),
        "indexed_documents": sum(1 for document in documents if document.get("index_status") == "indexed"),
        "research_graph_documents": research_graph_documents,
        "technique_materializations": technique_materializations,
      },
      "watch_folders": {
        "count": len(watch_folders),
        "enabled": sum(1 for folder in watch_folders if folder.get("enabled")),
        "active_backends": sorted({str(folder.get("watch_backend") or "polling") for folder in watch_folders if folder.get("enabled")}),
        "files_seen": sum(int(folder.get("files_seen") or 0) for folder in watch_folders),
        "files_added": sum(int(folder.get("files_added") or 0) for folder in watch_folders),
        "files_changed": sum(int(folder.get("files_changed") or 0) for folder in watch_folders),
        "files_deleted": sum(int(folder.get("files_deleted") or 0) for folder in watch_folders),
        "scan_errors": sum(int(folder.get("scan_errors") or 0) for folder in watch_folders),
      },
      "profiling": {
        "enabled": bool(self.settings.profiling_mode),
        "current_rss_bytes": current_rss_bytes,
        "peak_rss_bytes": peak_rss_bytes,
        "record_throughput_per_minute": round(sum(throughputs), 2) if throughputs else 0.0,
        "tracked_file_count": int(connection.execute("SELECT COUNT(*) FROM tracked_files").fetchone()[0] or 0),
        "tracked_file_event_count": int(connection.execute("SELECT COUNT(*) FROM tracked_file_events").fetchone()[0] or 0),
        "job_queue_sizes": {
          "queued": sum(1 for job in jobs if job.get("status") == "queued"),
          "running": sum(1 for job in jobs if job.get("status") == "running"),
          "failed": sum(1 for job in jobs if job.get("status") == "failed"),
        },
      },
    }

  def import_runtime_status(self) -> dict[str, Any]:
    embedder_fallback = bool(getattr(self.embedder, "is_fallback", False))
    ocr_fallback = bool(getattr(self.ocr_provider, "is_fallback", False))
    math_fallback = bool(getattr(self.math_provider, "is_fallback", False))
    vector_fallback = self.vector_index.write_enabled and self.vector_index.mode == "local"
    ready = bool(self.embedder.ready and self.vector_index.write_enabled)
    degraded = bool(embedder_fallback or ocr_fallback or math_fallback or vector_fallback)
    warnings: list[str] = []
    if embedder_fallback:
      warnings.append("Embedding provider is running in fallback mode.")
    if ocr_fallback:
      warnings.append("OCR provider is running in fallback mode.")
    if math_fallback:
      warnings.append("Math extraction is running in fallback mode.")
    if vector_fallback:
      warnings.append("Vector index is using the local fallback store.")
    detail = "Import pipeline is ready."
    if not ready:
      detail = "Import pipeline is missing one or more required runtimes."
    elif degraded:
      detail = "Import pipeline is usable with one or more fallbacks enabled."
    return {
      "ready": ready,
      "degraded": degraded,
      "detail": detail,
      "warnings": warnings,
    }

  def query_runtime_status(self) -> dict[str, Any]:
    retrieval_ready = True
    retrieval_degraded = bool(
      not self.vector_index.search_enabled
      or getattr(self.embedder, "is_fallback", False)
      or getattr(self.reranker, "is_fallback", False)
      or not self.reranker.ready
    )
    synthesis_ready = True
    synthesis_degraded = bool(not self.reasoner.ready or getattr(self.reasoner, "is_fallback", False))
    warnings: list[str] = []
    if not self.vector_index.search_enabled:
      warnings.append("Query retrieval will fall back to lexical search because the vector index is unavailable.")
    elif self.vector_index.mode == "local":
      warnings.append("Query retrieval is using the local vector-store fallback.")
    if getattr(self.embedder, "is_fallback", False):
      warnings.append("Query retrieval is using fallback embeddings.")
    if getattr(self.reranker, "is_fallback", False) or not self.reranker.ready:
      warnings.append("Query reranking is using a degraded or fallback path.")
    if synthesis_degraded:
      warnings.append("Answer synthesis is using a fallback reasoner.")
    detail = "Query pipeline is ready."
    if retrieval_degraded or synthesis_degraded:
      detail = "Query pipeline is usable with degraded retrieval and/or synthesis."
    return {
      "ready": True,
      "retrieval_ready": retrieval_ready,
      "retrieval_degraded": retrieval_degraded,
      "synthesis_ready": synthesis_ready,
      "synthesis_degraded": synthesis_degraded,
      "detail": detail,
      "warnings": warnings,
    }

  def _missing_runtime_services(self, *, for_query: bool = False, for_import: bool = False) -> list[str]:
    missing = []
    if not self.embedder.ready:
      missing.append("embedding")
    if not self.reranker.ready:
      missing.append("reranker")
    if (for_import and not self.vector_index.write_enabled) or (not for_import and not self.vector_index.search_enabled):
      missing.append("vector_index")
    if for_import and not self.ocr_provider.ready:
      missing.append("ocr")
    return sorted(set(missing))

  def _query_reasoner(self):
    # Query-time reasoning degrades intentionally so retrieval can still return
    # grounded passages even when the preferred synthesis provider is absent.
    if self.reasoner.ready:
      return self.reasoner
    return FallbackReasoner()

  def ensure_query_runtime(self) -> None:
    # Query can degrade to keyword retrieval plus lexical scoring even when
    # vector search, reranking, or live reasoning are unavailable.
    return

  def ensure_import_runtime(self) -> None:
    if self.settings.dev_fallbacks_enabled:
      return
    missing = self._missing_runtime_services(for_import=True)
    if missing:
      raise ServiceDependencyError(
        code="import_runtime_unavailable",
        message="The ingestion runtime is not ready in normal mode.",
        missing_services=missing,
      )

  def classify_query(self, query: str) -> str:
    lowered = query.lower()
    if any(token in lowered for token in ("compare", "across", "between", "synthesize")):
      return "cross_book"
    if any(token in lowered for token in ("chapter", "section")):
      return "section"
    if any(token in lowered for token in ("whole book", "entire book", "main thesis", "overview", "argument")):
      return "book"
    return "passage"

  def ingest_seed_document(self, connection, title: str, body: str, source_path: str, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
    parsed = {
      "title": title,
      "file_type": "txt",
      "pages": [{"number": 1, "text": body, "metadata": {"extraction_mode": "seed", "ocr_confidence": 1.0}}],
      "warnings": [],
      "text": body,
      "language": detect_language(body),
      "metadata": metadata or {},
    }
    prepared = self.prepare_document(Path(source_path), parsed)
    return self.persist_prepared_document(connection, prepared)

  def resolve_import_source_path(self, source_path: Path) -> Path:
    normalized = source_path.expanduser()
    if normalized.suffix.lower() != ".lnk" or sys.platform != "win32":
      return normalized

    try:
      shortcut_literal = str(normalized).replace("'", "''")
      powershell_script = (
        "$shell = New-Object -ComObject WScript.Shell; "
        f"$shortcut = $shell.CreateShortcut('{shortcut_literal}'); "
        "if ($shortcut.TargetPath) { Write-Output $shortcut.TargetPath }"
      )
      command = [
        "powershell",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        powershell_script,
      ]
      result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="ignore", check=False)
      target = (result.stdout or "").strip()
      if result.returncode == 0 and target:
        return Path(target).expanduser()
    except Exception:
      pass

    return normalized

  def _normalize_include_extensions(self, include_extensions: list[str] | set[str] | tuple[str, ...] | None) -> set[str]:
    if not include_extensions:
      return {extension.lower() for extension in SUPPORTED_EXTENSIONS}
    normalized: set[str] = set()
    for extension in include_extensions:
      text = str(extension or "").strip().lower()
      if not text:
        continue
      normalized.add(text if text.startswith(".") else f".{text}")
    return normalized or {extension.lower() for extension in SUPPORTED_EXTENSIONS}

  def _is_excluded_watch_path(self, path: Path, root_path: Path, exclude_globs: list[str] | None = None) -> bool:
    patterns = [str(pattern or "").strip() for pattern in (exclude_globs or []) if str(pattern or "").strip()]
    if not patterns:
      return False
    try:
      relative_path = path.relative_to(root_path).as_posix()
    except Exception:
      relative_path = path.name
    return any(
      fnmatch.fnmatch(relative_path, pattern)
      or fnmatch.fnmatch(path.name, pattern)
      for pattern in patterns
    )

  def _discover_directory_sources(
    self,
    source_path: Path,
    recursive: bool = True,
    *,
    include_extensions: list[str] | set[str] | tuple[str, ...] | None = None,
    exclude_globs: list[str] | None = None,
  ) -> list[Path]:
    allowed_extensions = self._normalize_include_extensions(include_extensions)
    walker = source_path.rglob("*") if recursive else source_path.glob("*")
    return [
      path
      for path in sorted(walker)
      if (
        path.is_file()
        and path.suffix.lower() in allowed_extensions
        and not self._is_excluded_watch_path(path, source_path, exclude_globs)
      )
    ]

  def discover_sources_stable(
    self,
    source_path: Path,
    recursive: bool = True,
    *,
    include_extensions: list[str] | set[str] | tuple[str, ...] | None = None,
    exclude_globs: list[str] | None = None,
  ) -> dict[str, Any]:
    source_path = self.resolve_import_source_path(source_path)
    if not source_path.exists():
      raise FileNotFoundError(f"Import path was not found: {source_path}")
    if not source_path.is_dir():
      if source_path.is_file() and source_path.suffix.lower() in self._normalize_include_extensions(include_extensions) and not self._is_excluded_watch_path(source_path, source_path.parent, exclude_globs):
        return {
          "sources": [source_path],
          "stable": True,
          "pass_count": 1,
          "required_stable_passes": 1,
          "passes": [{"pass": 1, "count": 1}],
        }
      if source_path.is_file():
        raise ValueError(f"Unsupported file type for import: {source_path.suffix or source_path.name}")
      raise ValueError(f"Unsupported import source: {source_path}")

    max_passes = max(int(self.settings.directory_discovery_max_passes or 1), 1)
    required_stable_passes = max(int(self.settings.directory_discovery_stable_passes or 1), 1)
    settle_seconds = max(float(self.settings.directory_discovery_settle_seconds or 0.0), 0.0)
    previous_signature: tuple[str, ...] | None = None
    stable_passes = 0
    passes: list[dict[str, Any]] = []
    sources: list[Path] = []

    for pass_index in range(1, max_passes + 1):
      discovered = self._discover_directory_sources(
        source_path,
        recursive=recursive,
        include_extensions=include_extensions,
        exclude_globs=exclude_globs,
      )
      sources = list(dict.fromkeys(discovered))
      signature = tuple(str(path) for path in sources)
      passes.append({
        "pass": pass_index,
        "count": len(sources),
      })
      if signature == previous_signature:
        stable_passes += 1
      else:
        stable_passes = 1
      previous_signature = signature
      if stable_passes >= required_stable_passes:
        if not sources:
          raise ValueError(f"No supported documents were found in {source_path}")
        return {
          "sources": sources,
          "stable": True,
          "pass_count": pass_index,
          "required_stable_passes": required_stable_passes,
          "passes": passes,
        }
      if pass_index < max_passes and settle_seconds > 0:
        time.sleep(settle_seconds)

    if not sources:
      raise ValueError(f"No supported documents were found in {source_path}")
    return {
      "sources": sources,
      "stable": False,
      "pass_count": len(passes),
      "required_stable_passes": required_stable_passes,
      "passes": passes,
    }

  def discover_sources(
    self,
    source_path: Path,
    recursive: bool = True,
    *,
    include_extensions: list[str] | set[str] | tuple[str, ...] | None = None,
    exclude_globs: list[str] | None = None,
  ) -> list[Path]:
    source_path = self.resolve_import_source_path(source_path)
    if source_path.is_dir():
      return self.discover_sources_stable(
        source_path,
        recursive=recursive,
        include_extensions=include_extensions,
        exclude_globs=exclude_globs,
      )["sources"]
    if not source_path.exists():
      raise FileNotFoundError(f"Import path was not found: {source_path}")
    if source_path.is_file() and source_path.suffix.lower() in self._normalize_include_extensions(include_extensions) and not self._is_excluded_watch_path(source_path, source_path.parent, exclude_globs):
      return [source_path]
    if source_path.is_file():
      raise ValueError(f"Unsupported file type for import: {source_path.suffix or source_path.name}")
    raise ValueError(f"Unsupported import source: {source_path}")

  def validate_import_source(self, source_path: Path, recursive: bool = True) -> dict[str, Any]:
    normalized = self.resolve_import_source_path(source_path)
    sources = self.discover_sources(normalized, recursive=recursive)
    return {
      "path": str(normalized),
      "recursive": recursive,
      "candidate_count": len(sources),
      "kind": "directory" if normalized.is_dir() else "file",
    }

  def summarize_for_level(self, text: str, level: str, fallback_words: int) -> str:
    summary = self._query_reasoner().summarize(text, level)
    if summary:
      return summary.strip()
    return summarize_text(text, max_sentences=3 if level == "book" else 2, max_words=fallback_words)

  def ingest_path(self, connection, source_path: Path, recursive: bool = True) -> list[dict[str, Any]]:
    self.ensure_import_runtime()
    results = []
    for path in self.discover_sources(source_path, recursive=recursive):
      parsed = extract_document(path, self.ocr_provider, include_ocr=self.ocr_provider.ready or self.settings.dev_fallbacks_enabled)
      prepared = self.prepare_document(
        path,
        parsed,
        math=self.extract_math_artifacts(path, parsed),
        citations=self.extract_citation_artifacts(path, parsed),
      )
      results.append(self.persist_prepared_document(connection, prepared))
    return results

  def extract_math_artifacts(self, source_path: Path, parsed: dict[str, Any], *, artifact_dir: Path | None = None) -> dict[str, Any]:
    payload = self.math_provider.extract_document_math(
      source_path,
      parsed,
      ocr_provider=self.ocr_provider if self.ocr_provider.ready else None,
      artifact_dir=artifact_dir,
    )
    return self._normalize_math_payload(source_path, payload)

  def extract_citation_artifacts(self, source_path: Path, parsed: dict[str, Any]) -> dict[str, Any]:
    return extract_document_citations(source_path, parsed)

  def render_document_markdown(self, source_path: Path, parsed: dict[str, Any], math: dict[str, Any] | None = None) -> str:
    pages = [dict(page) for page in parsed.get("pages") or []]
    formulae_by_page: dict[int, list[dict[str, Any]]] = {}
    for formula in (math or {}).get("formulae", []) or []:
      page_number = int(formula.get("page_number") or 1)
      formulae_by_page.setdefault(page_number, []).append(dict(formula))

    lines = [f"# {parsed.get('title') or source_path.stem}", ""]
    source_label = str(source_path)
    if source_label:
      lines.extend([f"Source: `{source_label}`", ""])

    for page in pages:
      page_number = int(page.get("number") or len(lines))
      page_text = str(page.get("text") or "").strip()
      page_formulae = formulae_by_page.get(page_number, [])
      rendered_page, injected_ids = _inject_page_formulae(page_text, page_formulae)
      lines.extend([f"## Page {page_number}", ""])
      if rendered_page.strip():
        lines.extend([rendered_page.strip(), ""])
      else:
        lines.extend(["_No extractable text._", ""])

      remaining_formulae = [
        formula
        for formula in page_formulae
        if formula.get("latex") and str(formula.get("id") or "") not in injected_ids
      ]
      if remaining_formulae:
        lines.append("### Formulae")
        lines.append("")
        for formula in remaining_formulae:
          latex = str(formula.get("latex") or "").strip()
          if not latex:
            continue
          lines.append(_markdown_math_block(latex, display=True))
          lines.append("")

    markdown = "\n".join(lines).strip()
    return markdown + "\n"

  def _normalize_math_payload(self, source_path: Path, payload: dict[str, Any] | None) -> dict[str, Any]:
    normalized = dict(payload or {})
    artifacts = [dict(item) for item in normalized.get("artifacts", [])]
    regions = [dict(item) for item in normalized.get("regions", [])]
    formulae = [dict(item) for item in normalized.get("formulae", [])]
    links = [dict(item) for item in normalized.get("links", [])]

    artifact_ids_by_page: dict[int, str] = {}
    for index, artifact in enumerate(artifacts, start=1):
      page_number = int(artifact.get("page_number", 1) or 1)
      stable_text = artifact.get("normalized_latex") or artifact.get("latex") or artifact.get("raw_text") or artifact.get("source_ref") or index
      artifact_id = str(artifact.get("id") or f"mathart-{hashlib.sha1(f'{source_path}|{page_number}|{index}|{stable_text}'.encode('utf-8', errors='ignore')).hexdigest()[:16]}")
      artifact["id"] = artifact_id
      artifact.setdefault("page_number", page_number)
      artifact.setdefault("source_ref", str(source_path))
      artifact_ids_by_page.setdefault(page_number, artifact_id)

    region_ids_by_key: dict[tuple[str, int], str] = {}
    for index, region in enumerate(regions, start=1):
      page_number = int(region.get("page_number", 1) or 1)
      artifact_id = str(region.get("artifact_id") or artifact_ids_by_page.get(page_number) or f"mathart-{hashlib.sha1(f'{source_path}|{page_number}|artifact-fallback'.encode('utf-8', errors='ignore')).hexdigest()[:16]}")
      region_index = int(region.get("region_index", index) or index)
      region_id = str(region.get("id") or f"mathregion-{hashlib.sha1(f'{artifact_id}|{region_index}|{region.get('raw_text') or page_number}'.encode('utf-8', errors='ignore')).hexdigest()[:16]}")
      region["artifact_id"] = artifact_id
      region["page_number"] = page_number
      region["region_index"] = region_index
      region["id"] = region_id
      region_ids_by_key[(artifact_id, region_index)] = region_id

    formula_ids: list[str] = []
    for index, formula in enumerate(formulae, start=1):
      page_number = int(formula.get("page_number", 1) or 1)
      artifact_id = str(formula.get("artifact_id") or artifact_ids_by_page.get(page_number) or f"mathart-{hashlib.sha1(f'{source_path}|{page_number}|formula-artifact-fallback'.encode('utf-8', errors='ignore')).hexdigest()[:16]}")
      region_index = int(formula.get("region_index", index) or index)
      region_id = formula.get("region_id") or region_ids_by_key.get((artifact_id, region_index))
      stable_text = formula.get("normalized_latex") or formula.get("latex") or formula.get("raw_text") or formula.get("label") or index
      formula_id = str(formula.get("id") or f"mathformula-{hashlib.sha1(f'{artifact_id}|{region_id}|{page_number}|{stable_text}'.encode('utf-8', errors='ignore')).hexdigest()[:16]}")
      formula["id"] = formula_id
      formula["artifact_id"] = artifact_id
      formula["region_id"] = region_id
      formula["page_number"] = page_number
      formula_ids.append(formula_id)

    for index, link in enumerate(links, start=1):
      formula_id = str(link.get("formula_id") or (formula_ids[index - 1] if index - 1 < len(formula_ids) else ""))
      if not formula_id:
        continue
      stable_target = link.get("target_id") or link.get("node_id") or link.get("kind") or index
      link["id"] = str(link.get("id") or f"mathlink-{hashlib.sha1(f'{formula_id}|{stable_target}'.encode('utf-8', errors='ignore')).hexdigest()[:16]}")
      link["formula_id"] = formula_id

    normalized["artifacts"] = artifacts
    normalized["regions"] = regions
    normalized["formulae"] = formulae
    normalized["links"] = [link for link in links if link.get("formula_id")]
    return normalized

  def refresh_document_ocr(
    self,
    source_path: Path,
    parsed: dict[str, Any],
    *,
    deferred_to_ocr: bool = False,
    progress_callback=None,
  ) -> dict[str, Any]:
    suffix = source_path.suffix.lower()
    original_pages = list(parsed.get("pages") or [])
    warnings = list(parsed.get("warnings") or [])

    if suffix in IMAGE_EXTENSIONS:
      refreshed = extract_document(source_path, self.ocr_provider, include_ocr=True)
      page_total = len(refreshed.get("pages", []) or [])
      if progress_callback is not None:
        progress_callback(page_total, page_total)
      return {
        "parsed": refreshed,
        "pages_ocrd": page_total,
        "pages_improved": page_total,
        "document_changed": True,
        "warnings": list(refreshed.get("warnings") or []),
      }

    if suffix == ".djvu":
      if deferred_to_ocr or any(_page_needs_ocr_refresh(page) for page in original_pages):
        refreshed = extract_document(source_path, self.ocr_provider, include_ocr=True)
        pages = list(refreshed.get("pages", []) or [])
        if progress_callback is not None:
          progress_callback(len(pages), len(pages))
        return {
          "parsed": refreshed,
          "pages_ocrd": len(pages),
          "pages_improved": len([page for page in pages if str(page.get("text", "") or "").strip()]),
          "document_changed": True,
          "warnings": list(refreshed.get("warnings") or []),
        }
      return {
        "parsed": parsed,
        "pages_ocrd": 0,
        "pages_improved": 0,
        "document_changed": False,
        "warnings": warnings,
      }

    if suffix != ".pdf":
      return {
        "parsed": parsed,
        "pages_ocrd": 0,
        "pages_improved": 0,
        "document_changed": False,
        "warnings": warnings,
      }

    if deferred_to_ocr:
      refreshed = extract_document(source_path, self.ocr_provider, include_ocr=True)
      pages = list(refreshed.get("pages", []) or [])
      if progress_callback is not None:
        progress_callback(len(pages), len(pages))
      return {
        "parsed": refreshed,
        "pages_ocrd": len(pages),
        "pages_improved": len([page for page in pages if str(page.get("text", "") or "").strip()]),
        "document_changed": True,
        "warnings": list(refreshed.get("warnings") or []),
      }

    updated_pages: list[dict[str, Any]] = []
    pages_ocrd = 0
    pages_improved = 0
    document_changed = False
    refresh_targets = sum(1 for page in original_pages if _page_needs_ocr_refresh(page))
    for page in original_pages:
      page_payload = dict(page)
      metadata = dict(page_payload.get("metadata") or {})
      if not _page_needs_ocr_refresh(page_payload):
        page_payload["metadata"] = metadata
        updated_pages.append(page_payload)
        continue

      page_number = int(page_payload.get("number", len(updated_pages) + 1) or len(updated_pages) + 1)
      pages_ocrd += 1
      if progress_callback is not None:
        progress_callback(pages_ocrd - 1, refresh_targets)
      ocr_result = self.ocr_provider.ocr_pdf_page(source_path, page_number)
      if ocr_result and str(ocr_result.get("text", "") or "").strip():
        page_payload["text"] = str(ocr_result.get("text", "") or "")
        page_payload["metadata"] = {
          **metadata,
          "extraction_mode": "ocr_rendered_page",
          "ocr_confidence": float(ocr_result.get("confidence", 0.0) or 0.0),
        }
        warnings.extend(list(ocr_result.get("warnings", []) or []))
        pages_improved += 1
        document_changed = True
      else:
        page_payload["metadata"] = {
          **metadata,
          "extraction_mode": "unavailable",
          "ocr_confidence": 0.0,
        }
        warnings.append(f"Page {page_number} still has no usable OCR text.")
      if progress_callback is not None:
        progress_callback(pages_ocrd, refresh_targets)
      updated_pages.append(page_payload)

    if not pages_ocrd:
      return {
        "parsed": parsed,
        "pages_ocrd": 0,
        "pages_improved": 0,
        "document_changed": False,
        "warnings": warnings,
      }

    merged_text = "\n\n".join(str(page.get("text", "") or "") for page in updated_pages if str(page.get("text", "") or "").strip())
    refreshed = {
      **parsed,
      "pages": updated_pages,
      "warnings": warnings,
      "text": merged_text,
      "language": detect_language(merged_text),
      "metadata": {
        **dict(parsed.get("metadata") or {}),
        "ocr_refresh_applied": True,
        "ocr_pages_attempted": pages_ocrd,
        "ocr_pages_improved": pages_improved,
      },
    }
    return {
      "parsed": refreshed,
      "pages_ocrd": pages_ocrd,
      "pages_improved": pages_improved,
      "document_changed": document_changed,
      "warnings": warnings,
    }

  def prepare_document(
    self,
    source_path: Path,
    parsed: dict[str, Any],
    math: dict[str, Any] | None = None,
    citations: dict[str, Any] | None = None,
  ) -> dict[str, Any]:
    full_text = parsed["text"]
    checksum = text_checksum(f"{source_path}:{full_text}")
    now = repository.utc_now()
    existing = None
    document_id = f"doc-{checksum[:16]}"
    math_payload = math or {}
    markdown = self.render_document_markdown(source_path, parsed, math_payload)
    math_summary = {
      "pages_scanned": int(math_payload.get("pages_scanned", 0) or 0),
      "regions_detected": int(math_payload.get("regions_detected", 0) or 0),
      "formula_count": int(math_payload.get("formula_count", 0) or 0),
      "formula_recognized": int(math_payload.get("formula_recognized", 0) or 0),
      "formula_pending": int(math_payload.get("formula_pending", 0) or 0),
      "documents_with_math_artifacts": int(math_payload.get("documents_with_math_artifacts", 0) or 0),
      "confidence_summary": dict(math_payload.get("confidence_summary") or {}),
    }
    sections = split_sections(parsed["pages"])
    for index, section in enumerate(sections, start=1):
      section["ordinal"] = index
    chapters = group_chapters(sections)
    nodes: list[dict[str, Any]] = []
    book_summary = self.summarize_for_level(full_text, "book", 110)
    document_metadata = dict(parsed.get("metadata") or {})
    extraction_modes = [page.get("metadata", {}).get("extraction_mode", "unknown") for page in parsed["pages"]]
    extraction_metadata = {
      "page_count": len(parsed["pages"]),
      "ocr_page_count": sum(1 for mode in extraction_modes if "ocr" in mode),
      "empty_page_count": sum(1 for page in parsed["pages"] if not page.get("text", "").strip()),
      "extraction_modes": extraction_modes,
      "warnings": parsed["warnings"],
      "math": math_summary,
      "citations": dict((citations or {}).get("summary") or {}),
    }
    nodes.append({
      "id": f"{document_id}-book",
      "document_id": document_id,
      "parent_id": None,
      "node_type": "book",
      "summary_level": None,
      "title": parsed["title"],
      "heading_path": parsed["title"],
      "ordinal": 0,
      "page_start": 1,
      "page_end": max(1, len(parsed["pages"])),
      "text": full_text[:12000],
      "token_count": self.embedder.count_tokens(full_text),
      "language": parsed["language"],
      "checksum": checksum,
      "metadata_json": {"kind": "book", "metadata": document_metadata},
      "created_at": now,
      "updated_at": now,
    })
    nodes.append({
      "id": f"{document_id}-summary-book",
      "document_id": document_id,
      "parent_id": f"{document_id}-book",
      "node_type": "summary",
      "summary_level": "book",
      "title": f"{parsed['title']} synopsis",
      "heading_path": parsed["title"],
      "ordinal": 1,
      "page_start": 1,
      "page_end": max(1, len(parsed["pages"])),
      "text": book_summary,
      "token_count": self.embedder.count_tokens(book_summary),
      "language": parsed["language"],
      "checksum": text_checksum(book_summary),
      "metadata_json": {"kind": "summary"},
      "created_at": now,
      "updated_at": now,
    })

    chunk_ordinal = 1
    for chapter_index, chapter in enumerate(chapters, start=1):
      chapter_id = f"{document_id}-chapter-{chapter_index}"
      chapter_summary = self.summarize_for_level(chapter["text"], "chapter", 90)
      nodes.append({
        "id": chapter_id,
        "document_id": document_id,
        "parent_id": f"{document_id}-book",
        "node_type": "chapter",
        "summary_level": None,
        "title": chapter["title"],
        "heading_path": chapter["title"],
        "ordinal": chapter_index,
        "page_start": chapter["page_start"],
        "page_end": chapter["page_end"],
        "text": chapter["text"][:8000],
        "token_count": self.embedder.count_tokens(chapter["text"]),
        "language": parsed["language"],
        "checksum": text_checksum(chapter["text"]),
        "metadata_json": {"kind": "chapter"},
        "created_at": now,
        "updated_at": now,
      })
      nodes.append({
        "id": f"{chapter_id}-summary",
        "document_id": document_id,
        "parent_id": chapter_id,
        "node_type": "summary",
        "summary_level": "chapter",
        "title": f"{chapter['title']} summary",
        "heading_path": chapter["title"],
        "ordinal": chapter_index,
        "page_start": chapter["page_start"],
        "page_end": chapter["page_end"],
        "text": chapter_summary,
        "token_count": self.embedder.count_tokens(chapter_summary),
        "language": parsed["language"],
        "checksum": text_checksum(chapter_summary),
        "metadata_json": {"kind": "summary"},
        "created_at": now,
        "updated_at": now,
      })
      for section in chapter["sections"]:
        section_id = f"{document_id}-section-{section['ordinal']}"
        section_summary = self.summarize_for_level(section["text"], "section", 75)
        nodes.append({
          "id": section_id,
          "document_id": document_id,
          "parent_id": chapter_id,
          "node_type": "section",
          "summary_level": None,
          "title": section["title"],
          "heading_path": f"{chapter['title']} > {section['title']}",
          "ordinal": section["ordinal"],
          "page_start": section["page_start"],
          "page_end": section["page_end"],
          "text": section["text"][:8000],
          "token_count": self.embedder.count_tokens(section["text"]),
          "language": parsed["language"],
          "checksum": text_checksum(section["text"]),
          "metadata_json": {"kind": "section"},
          "created_at": now,
          "updated_at": now,
        })
        nodes.append({
          "id": f"{section_id}-summary",
          "document_id": document_id,
          "parent_id": section_id,
          "node_type": "summary",
          "summary_level": "section",
          "title": f"{section['title']} summary",
          "heading_path": f"{chapter['title']} > {section['title']}",
          "ordinal": section["ordinal"],
          "page_start": section["page_start"],
          "page_end": section["page_end"],
          "text": section_summary,
          "token_count": self.embedder.count_tokens(section_summary),
          "language": parsed["language"],
          "checksum": text_checksum(section_summary),
          "metadata_json": {"kind": "summary"},
          "created_at": now,
          "updated_at": now,
        })
        for page in section["pages"]:
          nodes.append({
            "id": f"{document_id}-page-{page['number']}",
            "document_id": document_id,
            "parent_id": section_id,
            "node_type": "page",
            "summary_level": None,
            "title": f"Page {page['number']}",
            "heading_path": f"{chapter['title']} > {section['title']}",
            "ordinal": page["number"],
            "page_start": page["number"],
            "page_end": page["number"],
            "text": page["text"],
            "token_count": self.embedder.count_tokens(page["text"]),
            "language": parsed["language"],
            "checksum": text_checksum(page["text"]),
            "metadata_json": {**page.get("metadata", {}), "kind": "page"},
            "created_at": now,
            "updated_at": now,
          })
        section_chunks, chunk_ordinal = chunk_section(section, document_id, parsed["language"], chunk_ordinal, self.embedder.count_tokens)
        nodes.extend(section_chunks)

    document = {
      "id": document_id,
      "title": parsed["title"],
      "source_path": str(source_path),
      "file_type": parsed["file_type"],
      "language": parsed["language"],
      "status": "indexed",
      "extraction_status": "extracted",
      "index_status": "indexed",
      "summary": book_summary,
      "checksum": checksum,
      "page_count": len(parsed["pages"]),
      "node_count": len(nodes),
      "warnings_json": parsed["warnings"],
      "metadata_json": document_metadata,
      "extraction_metadata_json": extraction_metadata,
      "pipeline_version": self.settings.pipeline_version,
      "last_indexed_at": now,
      "created_at": now,
      "updated_at": now,
    }
    return {
      "document": document,
      "nodes": nodes,
      "parsed": parsed,
      "markdown": markdown,
      "source_path": source_path,
      "document_metadata": document_metadata,
      "math": math_payload,
      "citations": citations or {},
    }

  def persist_prepared_document(self, connection, prepared: dict[str, Any]) -> dict[str, Any]:
    source_path: Path = prepared["source_path"]
    parsed = prepared["parsed"]
    document = dict(prepared["document"])
    nodes = prepared["nodes"]
    existing = repository.get_document_by_source_path(connection, str(source_path))
    checksum = document["checksum"]
    document_id = existing["id"] if existing else f"doc-{checksum[:16]}"
    document["id"] = document_id
    document["created_at"] = existing["created_at"] if existing else document["created_at"]
    document["updated_at"] = repository.utc_now()
    for node in nodes:
      if node["document_id"] != document_id:
        node["document_id"] = document_id
      node["id"] = node["id"].replace(prepared["document"]["id"], document_id, 1)
      if node.get("parent_id"):
        node["parent_id"] = node["parent_id"].replace(prepared["document"]["id"], document_id, 1)
    document_metadata = repository.json_loads(document.get("metadata_json"), {})
    extraction_metadata = repository.json_loads(document.get("extraction_metadata_json"), {})
    vector_result = self.vector_index.upsert_nodes(nodes) or {}
    document_metadata["compute_provenance"] = {
      "ocr": getattr(self.ocr_provider, "provenance", lambda: {"provider": getattr(self.ocr_provider, "name", "ocr")})(),
      "embedding": vector_result.get("embedding_provenance") or getattr(self.embedder, "provenance", lambda: {"provider": getattr(self.embedder, "name", "embedding")})(),
      "vector": vector_result.get("vector_provenance") or {},
      "indexed_at": repository.utc_now(),
    }
    extraction_metadata["last_index_provenance"] = {
      "vector": vector_result.get("vector_provenance") or {},
      "embedding": vector_result.get("embedding_provenance") or {},
    }
    document["metadata_json"] = document_metadata
    document["extraction_metadata_json"] = extraction_metadata
    repository.upsert_document(connection, document)
    repository.replace_document_nodes(connection, document_id, nodes)
    page_node_ids = {
      int(node.get("page_start") or 0): node["id"]
      for node in nodes
      if node.get("node_type") == "page" and int(node.get("page_start") or 0) > 0
    }
    repository.replace_document_math_data(connection, document_id, prepared.get("math") or {}, page_node_ids=page_node_ids)
    repository.replace_document_citation_data(connection, document_id, prepared.get("citations") or {}, page_node_ids=page_node_ids)
    repository.replace_document_research_scaffolds(connection, document_id, [])
    self._materialize_document_families(connection, document, nodes)
    document["warnings"] = parsed["warnings"]
    document["metadata"] = repository.json_loads(document["metadata_json"], {})
    document["extraction_metadata"] = repository.json_loads(document["extraction_metadata_json"], {})
    return document

  def seed_if_empty(self, connection) -> None:
    if repository.list_documents(connection):
      return
    self.ingest_seed_document(
      connection,
      title="The Elements, Book I",
      source_path="seed://euclid-elements-book-i",
      body=(
        "Euclid opens with definitions, postulates, and common notions. The constructive sequence fixes a stable order. "
        "Each proposition depends on prior constructions, making geometry legible through explicit operations and derived relations."
      ),
      metadata={"author": "Euclid", "year": -300, "edition_year": -300, "translation": False, "formalism": "geometry"},
    )
    self.ingest_seed_document(
      connection,
      title="Collected Papers on Continuity",
      source_path="seed://peirce-continuity",
      body=(
        "Peirce treats continuity as more than extension. He links it to generality, relation, and diagrammatic reasoning. "
        "The argument moves from isolated objects toward structured mediation between terms."
      ),
      metadata={"author": "Charles Sanders Peirce", "year": 1895, "edition_year": 1895, "translation": False, "formalism": "semiotics"},
    )
    self.ingest_seed_document(
      connection,
      title="Structural Morphogenesis Fragments",
      source_path="seed://thom-structural-morphogenesis",
      body=(
        "Thom emphasizes qualitative transitions, stability, and structural thresholds. Morphogenesis becomes intelligible through forms, singularities, and transformations that preserve intelligible structure across change."
      ),
      metadata={"author": "Rene Thom", "year": 1972, "edition_year": 1972, "translation": True, "formalism": "catastrophe theory"},
    )

  def ensure_research_scaffolds(self, connection) -> None:
    for document in repository.list_documents(connection):
      sign_rows = repository.list_sign_tokens(connection, [document["id"]])
      if sign_rows:
        continue
      nodes = repository.list_nodes_by_document(connection, document["id"])
      if not nodes:
        continue
      repository.replace_document_research_scaffolds(connection, document["id"], [])

  def ensure_research_scaffolds_for_documents(self, connection, document_ids: list[str] | None = None) -> dict[str, int]:
    documents = repository.list_documents(connection)
    if document_ids:
      requested = set(document_ids)
      documents = [document for document in documents if document["id"] in requested]
    document_count = 0
    node_count = 0
    edge_count = 0
    for document in documents:
      nodes = repository.list_nodes_by_document(connection, document["id"])
      if not nodes:
        continue
      repository.replace_document_research_scaffolds(connection, document["id"], [])
      document_count += 1
      node_count += len(repository.list_research_graph_nodes(connection, document["id"]))
      edge_count += len(repository.list_research_graph_edges(connection, document["id"]))
    return {"documents": document_count, "graph_nodes": node_count, "graph_edges": edge_count}

  def _resolve_scoped_document_ids(self, connection, scope: dict[str, Any] | None = None) -> list[str] | None:
    return None

  def _retrieve_query_material(self, connection, query_text: str, scope: dict[str, Any] | None = None) -> dict[str, Any]:
    # Retrieval is staged: coarse summary recall first, then finer node recall
    # and reranking. Keeping that flow here makes fallback behavior explicit.
    self.ensure_query_runtime()
    resolved_document_ids = self._resolve_scoped_document_ids(connection, scope)
    if resolved_document_ids == []:
      return {
        "mode": self.classify_query(query_text),
        "answer": "Insufficient evidence in the scoped collection to answer this question confidently.",
        "citations": [],
        "related_documents": [],
        "coverage": {"status": "insufficient_evidence", "summary": "No supporting passages were found inside the requested scope."},
        "warnings": ["insufficient_evidence"],
        "trace": {"retrieved_documents": [], "retrieved_nodes": [], "scope": scope or {}},
      }
    mode = self.classify_query(query_text)
    coarse_summary_levels = {
      "passage": ["section", "chapter", "book"],
      "section": ["section", "chapter"],
      "book": ["book", "chapter"],
      "cross_book": ["book", "chapter", "section"],
    }[mode]
    fine_node_types = {
      "passage": ["chunk", "page"],
      "section": ["section", "chunk", "page"],
      "book": ["chapter", "section", "chunk"],
      "cross_book": ["chunk", "page", "section"],
    }[mode]

    coarse_vector = self.vector_index.search(query_text, node_types=["summary"], summary_levels=coarse_summary_levels, document_ids=resolved_document_ids, limit=12)
    coarse_keyword = repository.keyword_search(connection, query_text, node_types=["summary"], summary_levels=coarse_summary_levels, document_ids=resolved_document_ids, limit=12)
    coarse_results = reciprocal_rank_fusion([coarse_vector, coarse_keyword])
    if not coarse_results:
      for document in repository.list_documents(connection):
        if resolved_document_ids is not None and document["id"] not in resolved_document_ids:
          continue
        score = lexical_overlap_score(query_text, f"{document['title']} {document['summary']}")
        if score <= 0:
          continue
        coarse_results.append({
          "id": f"{document['id']}-summary-book",
          "score": score,
          "document_id": document["id"],
          "node_type": "summary",
          "summary_level": "book",
          "page_start": 1,
          "page_end": max(1, int(document["page_count"])),
          "title": document["title"],
          "text": document["summary"],
        })
      coarse_results.sort(key=lambda item: item["score"], reverse=True)

    candidate_document_ids = []
    for item in coarse_results:
      document_id = item.get("document_id")
      if document_id and document_id not in candidate_document_ids:
        candidate_document_ids.append(document_id)
      if len(candidate_document_ids) >= 6:
        break

    fine_vector = self.vector_index.search(query_text, node_types=fine_node_types, document_ids=candidate_document_ids or None, limit=30)
    fine_keyword = repository.keyword_search(connection, query_text, node_types=fine_node_types, summary_levels=[None], document_ids=candidate_document_ids or None, limit=30)
    fine_results = reciprocal_rank_fusion([fine_vector, fine_keyword])

    reranked = []
    use_lexical_rerank = (not self.reranker.ready) or getattr(self.reranker, "is_fallback", False)
    for item in fine_results:
      rerank_delta = lexical_overlap_score(query_text, item.get("text", "")) if use_lexical_rerank else self.reranker.score(query_text, item.get("text", ""))
      item["rerank_score"] = item["score"] + rerank_delta
      reranked.append(item)
    reranked.sort(key=lambda item: item["rerank_score"], reverse=True)
    if not reranked:
      for item in coarse_results:
        item["rerank_score"] = item["score"] + lexical_overlap_score(query_text, item.get("text", ""))
        reranked.append(item)

    expanded = []
    seen_node_ids = set()
    for item in reranked[:12]:
      if item["id"] not in seen_node_ids:
        expanded.append(item)
        seen_node_ids.add(item["id"])
      ordinal = int(item.get("ordinal", 0))
      if not item.get("document_id") or not item.get("node_type") or ordinal <= 0:
        continue
      for neighbor in repository.list_neighbor_nodes(connection, item["document_id"], item["node_type"], ordinal, distance=1):
        if neighbor["id"] in seen_node_ids:
          continue
        neighbor_payload = dict(neighbor)
        neighbor_payload["score"] = float(item.get("score", 0.0)) * 0.92
        neighbor_payload["rerank_score"] = float(item.get("rerank_score", 0.0)) * 0.92
        expanded.append(neighbor_payload)
        seen_node_ids.add(neighbor["id"])
    reranked = sorted(expanded or reranked, key=lambda item: item.get("rerank_score", item.get("score", 0.0)), reverse=True)

    citations = []
    seen_pairs = set()
    for item in reranked[:30]:
      pair = (item.get("document_id"), item.get("page_start"), item.get("page_end"))
      if pair in seen_pairs:
        continue
      row = repository.get_document_by_id(connection, item["document_id"])
      citations.append({
        "id": item["id"],
        "document_id": item["document_id"],
        "document_title": row["title"] if row else item.get("document_id"),
        "page_start": int(item.get("page_start", 1)),
        "page_end": int(item.get("page_end", 1)),
        "quote": summarize_text(item.get("text", ""), max_sentences=2, max_words=55),
        "score": round(float(item["rerank_score"]), 4),
      })
      seen_pairs.add(pair)
      if len(citations) >= 8:
        break

    related_documents = []
    document_scores: dict[str, float] = {}
    for item in coarse_results[:10] + reranked[:10]:
      document_id = item.get("document_id")
      if document_id:
        document_scores[document_id] = max(document_scores.get(document_id, 0.0), float(item.get("score", 0.0)))
    for document_id, score in sorted(document_scores.items(), key=lambda entry: entry[1], reverse=True)[:5]:
      row = repository.get_document_by_id(connection, document_id)
      related_documents.append({"id": document_id, "title": row["title"] if row else document_id, "score": round(score, 4)})

    warnings = []
    if getattr(self.embedder, "is_fallback", False):
      warnings.append("embedding_fallback")
    if not self.vector_index.enabled:
      warnings.append("vector_index_fallback")
    if getattr(self.reranker, "is_fallback", False):
      warnings.append("reranker_fallback")
    elif not self.reranker.ready:
      warnings.append("reranker_degraded_fallback")
    if getattr(self.reasoner, "is_fallback", False):
      warnings.append("reasoner_fallback")
    elif not self.reasoner.ready:
      warnings.append("reasoner_degraded_fallback")
    if not getattr(self.ocr_provider, "ready", False):
      warnings.append("ocr_unavailable")

    if not citations:
      return {
        "mode": mode,
        "answer": "Insufficient evidence in the indexed library to answer this question confidently.",
        "citations": [],
        "related_documents": related_documents,
        "coverage": {"status": "insufficient_evidence", "summary": "No supporting passages were retrieved from the current index."},
        "warnings": warnings + ["insufficient_evidence"],
        "trace": {"retrieved_documents": candidate_document_ids, "retrieved_nodes": [item["id"] for item in coarse_results[:10]], "scope": scope or {}},
      }

    coverage_status = "ready" if len(citations) >= 3 else "limited_evidence"
    coverage_summary = "Answer synthesized from retrieved evidence." if coverage_status == "ready" else "Answer is based on a small evidence set."
    return {
      "mode": mode,
      "answer": "",
      "citations": citations,
      "related_documents": related_documents,
      "coverage": {"status": coverage_status, "summary": coverage_summary},
      "warnings": warnings,
      "trace": {
        "retrieved_documents": candidate_document_ids,
        "retrieved_nodes": [item["id"] for item in coarse_results[:10]] + [item["id"] for item in reranked[:10]],
        "scope": scope or {},
      },
    }

  def query(self, connection, query_text: str, user_id: str | None = None, scope: dict[str, Any] | None = None) -> dict[str, Any]:
    retrieval = self._retrieve_query_material(connection, query_text, scope=scope)
    bundle = self._build_research_bundle(connection, query_text, retrieval, user_id=user_id)
    return {
      "mode": retrieval["mode"],
      "answer": bundle["answer"] or retrieval["answer"],
      "citations": retrieval["citations"],
      "related_documents": retrieval["related_documents"],
      "coverage": retrieval["coverage"],
      "warnings": retrieval["warnings"],
      "trace": retrieval["trace"],
      "research_bundle_id": bundle["id"],
    }

  def research_query(self, connection, query_text: str, user_id: str | None = None, scope: dict[str, Any] | None = None) -> dict[str, Any]:
    retrieval = self._retrieve_query_material(connection, query_text, scope=scope)
    return self._build_research_bundle(connection, query_text, retrieval, user_id=user_id)

  def _inflate_json_row(self, row: dict[str, Any], fields: list[str]) -> dict[str, Any]:
    payload = dict(row)
    for field in fields:
      default = [] if field in {"node_ids_json", "object_ids_json", "components_json", "claims_json"} else {}
      payload[field[:-5]] = repository.json_loads(payload.get(field), default)
    return payload

  def _build_research_bundle(self, connection, query_text: str, retrieval: dict[str, Any], user_id: str | None = None) -> dict[str, Any]:
    bundle_id = f"bundle-{text_checksum(f'{query_text}|{repository.utc_now()}')[:20]}"
    now = repository.utc_now()
    citations = retrieval["citations"]
    document_ids = []
    for citation in citations:
      if citation["document_id"] not in document_ids:
        document_ids.append(citation["document_id"])
    documents = [repository.get_document_by_id(connection, document_id) for document_id in document_ids]
    documents = [row for row in documents if row]

    sign_tokens = [self._inflate_json_row(row, ["payload_json"]) for row in repository.list_sign_tokens(connection, document_ids)]
    categories = [self._inflate_json_row(row, ["payload_json"]) for row in repository.list_categories(connection, document_ids)]
    category_morphisms = [self._inflate_json_row(row, ["payload_json"]) for row in repository.list_category_morphisms(connection, [row["id"] for row in categories])]
    simplices = [self._inflate_json_row(row, ["object_ids_json", "payload_json"]) for row in repository.list_simplices(connection, document_ids)]

    object_ids = {row.get("payload", {}).get("object_id") for row in sign_tokens if row.get("payload", {}).get("object_id")}
    objects = [self._inflate_json_row(row, ["payload_json"]) for row in repository.list_objects_of_reference(connection, object_ids=object_ids)]
    object_lookup = {row["id"]: row for row in objects}

    covers = [self._inflate_json_row(row, ["node_ids_json", "payload_json"]) for row in repository.list_covers(connection, document_ids, object_ids)]
    restriction_maps = [self._inflate_json_row(row, ["payload_json", "validation_json"]) for row in repository.list_restriction_maps(connection, [row["id"] for row in covers])]
    gluing_constraints = [self._inflate_json_row(row, ["rule_json", "validation_json"]) for row in repository.list_gluing_constraints(connection, [row["id"] for row in covers])]
    seeded_obstructions = [self._inflate_json_row(row, ["payload_json"]) for row in repository.list_obstructions(connection, [row["id"] for row in covers])]

    interpretants, triads, triad_payload, triad_relations, triad_validation = self._build_interpretants(bundle_id, citations, sign_tokens, object_lookup, user_id, now)
    morphisms, morphism_relations = self._build_morphisms(bundle_id, interpretants, citations, now)
    functors, natural_transformations, diagram_payload, diagram_validation = self._build_diagram_structures(bundle_id, categories, category_morphisms, object_lookup, now)
    sheaf_payload, sheaf_validation, dynamic_obstructions = self._build_sheaf_payload(covers, restriction_maps, gluing_constraints, seeded_obstructions, connection)
    simplicial_payload = self._build_simplicial_payload(simplices, object_lookup)
    catastrophe_events, catastrophe_payload, catastrophe_validation = self._build_catastrophe_payload(bundle_id, documents, citations, now)

    lens_payloads = {
      "triad": triad_payload,
      "diagram": diagram_payload,
      "sheaf": sheaf_payload,
      "simplicial": simplicial_payload,
      "catastrophe": catastrophe_payload,
    }
    validation = triad_validation + diagram_validation + sheaf_validation + catastrophe_validation

    answer = retrieval["answer"]
    generated_answer = self._query_reasoner().answer(query_text, retrieval["mode"], citations, lens_payloads)
    if generated_answer:
      answer = generated_answer
    elif self.reasoner.ready and not self.settings.dev_fallbacks_enabled:
      raise ServiceDependencyError(
        code="reasoner_generation_failed",
        message="The reasoning service failed while generating an answer.",
        missing_services=["reasoner"],
      )
    elif not answer:
      answer = self._fallback_answer(retrieval["mode"], citations)

    entities = self._build_bundle_entities(objects, sign_tokens, categories, covers, simplices, interpretants, dynamic_obstructions, catastrophe_events, functors, natural_transformations)
    relations = triad_relations + morphism_relations + self._build_cover_relations(covers, dynamic_obstructions, restriction_maps)
    evidence_nodes = repository.get_nodes_by_ids(connection, [citation["id"] for citation in citations] + [row.get("node_id") for row in sign_tokens[:12] if row.get("node_id")])
    evidence_bundle = {
      "documents": [
        {"id": row["id"], "title": row["title"], "metadata": repository.json_loads(row.get("metadata_json"), {})}
        for row in documents
      ],
      "nodes": [
        {
          "id": row["id"],
          "document_id": row["document_id"],
          "title": row["title"],
          "page_start": row["page_start"],
          "page_end": row["page_end"],
          "heading_path": row["heading_path"],
        }
        for row in evidence_nodes
      ],
      "node_ids": [row["id"] for row in evidence_nodes],
      "citation_ids": [row["id"] for row in citations],
    }

    bundle = {
      "id": bundle_id,
      "user_id": user_id,
      "query_text": query_text,
      "mode": retrieval["mode"],
      "answer": answer,
      "citations": citations,
      "evidence_bundle": evidence_bundle,
      "entities": entities,
      "relations": relations,
      "lens_payloads": lens_payloads,
      "validation": validation,
      "warnings": retrieval["warnings"] + ([] if citations else ["insufficient_evidence"]),
      "trace": retrieval["trace"],
      "interpretants": interpretants,
      "triads": triads,
      "morphisms": morphisms,
      "functors": functors,
      "natural_transformations": natural_transformations,
      "catastrophe_events": catastrophe_events,
      "created_at": now,
    }
    repository.create_research_bundle(connection, bundle)
    return {
      "id": bundle_id,
      "mode": retrieval["mode"],
      "answer": answer,
      "citations": citations,
      "evidence_bundle": evidence_bundle,
      "entities": entities,
      "relations": relations,
      "lens_payloads": [
        {"key": key, "title": value["title"], "status": value["status"], "summary": value["summary"], "data": value["data"]}
        for key, value in lens_payloads.items()
      ],
      "validation": validation,
      "warnings": bundle["warnings"],
      "trace": retrieval["trace"],
    }

  def _build_interpretants(self, bundle_id: str, citations: list[dict[str, Any]], sign_tokens: list[dict[str, Any]], object_lookup: dict[str, dict[str, Any]], user_id: str | None, now: str):
    interpretants = []
    triads = []
    relations = []
    validation = []
    payload = {
      "title": "Peircean Triad Lens",
      "status": "empty",
      "summary": "No triads were assembled.",
      "data": {"interpretant_ids": [], "triad_ids": []},
    }
    for index, citation in enumerate(citations[:6], start=1):
      matching_signs = [token for token in sign_tokens if token["document_id"] == citation["document_id"]][:3]
      object_id = next((token.get("payload", {}).get("object_id") for token in matching_signs if token.get("payload", {}).get("object_id")), None)
      interpretant_id = f"interp-{bundle_id}-{index}"
      interpretants.append({
        "id": interpretant_id,
        "bundle_id": bundle_id,
        "user_id": user_id,
        "node_id": citation["id"],
        "parent_interpretant_id": None if index == 1 else f"interp-{bundle_id}-1",
        "depth": 0 if index == 1 else 1,
        "summary": summarize_text(citation["quote"], max_sentences=1, max_words=30),
        "claims_json": [{"text": citation["quote"], "citations": [citation["id"]]}],
        "stance_json": {"target": object_id, "label": "supporting", "score": citation["score"]},
        "tone_json": {"label": "analytic", "score": min(0.99, 0.55 + (citation["score"] / 2))},
        "payload_json": {"document_id": citation["document_id"]},
        "created_at": now,
        "updated_at": now,
      })
      validation.append({
        "id": f"triad-validation-{index}",
        "title": f"Triad grounding {index}",
        "status": "pass" if matching_signs and object_id else "warning",
        "details": "Interpretant is grounded by sign and object." if matching_signs and object_id else "Interpretant fell back to citation-only grounding.",
        "entity_ids": [interpretant_id] + ([matching_signs[0]["id"]] if matching_signs else []),
      })
      if object_id:
        for sign in matching_signs[:1]:
          triad_id = f"triad-{bundle_id}-{index}-{sign['id']}"
          triads.append({
            "id": triad_id,
            "bundle_id": bundle_id,
            "sign_token_id": sign["id"],
            "object_id": object_id,
            "interpretant_id": interpretant_id,
            "payload_json": {"citation_id": citation["id"]},
            "created_at": now,
            "updated_at": now,
          })
          relations.append({
            "id": triad_id,
            "type": "Triad",
            "source_id": sign["id"],
            "target_id": interpretant_id,
            "label": object_lookup.get(object_id, {}).get("label", "interprets"),
            "evidence_ids": [citation["id"]],
            "validation": {"status": "grounded"},
            "metadata": {"object_id": object_id},
          })
    if interpretants:
      payload = {
        "title": "Peircean Triad Lens",
        "status": "ready",
        "summary": f"{len(interpretants)} interpretants and {len(triads)} grounded triads assembled from the evidence bundle.",
        "data": {"interpretant_ids": [row["id"] for row in interpretants], "triad_ids": [row["id"] for row in triads]},
      }
    return interpretants, triads, payload, relations, validation

  def _build_morphisms(self, bundle_id: str, interpretants: list[dict[str, Any]], citations: list[dict[str, Any]], now: str):
    morphisms = []
    relations = []
    for index, (left, right) in enumerate(zip(interpretants, interpretants[1:]), start=1):
      morphism_type = "analogy" if citations[index - 1]["document_id"] != citations[index]["document_id"] else "refinement"
      morphism_id = f"morphism-{bundle_id}-{index}"
      morphisms.append({
        "id": morphism_id,
        "bundle_id": bundle_id,
        "source_entity_id": left["id"],
        "target_entity_id": right["id"],
        "morphism_type": morphism_type,
        "label": morphism_type.title(),
        "payload_json": {"citation_ids": [citations[index - 1]["id"], citations[index]["id"]]},
        "validation_json": {"status": "pass", "kind": morphism_type},
        "created_at": now,
        "updated_at": now,
      })
      relations.append({
        "id": morphism_id,
        "type": "Morphism",
        "source_id": left["id"],
        "target_id": right["id"],
        "label": morphism_type.title(),
        "evidence_ids": [citations[index - 1]["id"], citations[index]["id"]],
        "validation": {"status": "pass", "kind": morphism_type},
        "metadata": {"kind": morphism_type},
      })
    return morphisms, relations

  def _build_diagram_structures(self, bundle_id: str, categories: list[dict[str, Any]], category_morphisms: list[dict[str, Any]], object_lookup: dict[str, dict[str, Any]], now: str):
    functors = []
    natural_transformations = []
    validation = []
    grouped: dict[str, list[dict[str, Any]]] = {}
    for category in categories:
      grouped.setdefault(category["document_id"], []).append(category)
    document_ids = list(grouped.keys())
    for index, (source_document, target_document) in enumerate(zip(document_ids, document_ids[1:]), start=1):
      source_category = grouped[source_document][0]
      target_category = grouped[target_document][0]
      source_ids = source_category.get("payload", {}).get("object_ids", [])
      target_ids = target_category.get("payload", {}).get("object_ids", [])
      mapping_pairs = []
      for source_object_id in source_ids:
        source_label = str(object_lookup.get(source_object_id, {}).get("label", "")).strip().lower()
        best_match = next((target_object_id for target_object_id in target_ids if str(object_lookup.get(target_object_id, {}).get("label", "")).strip().lower() == source_label), None)
        if best_match is None and target_ids:
          best_match = target_ids[min(len(mapping_pairs), len(target_ids) - 1)]
        if best_match:
          mapping_pairs.append({"source_object_id": source_object_id, "target_object_id": best_match})
      target_pairs = {(row["source_object_id"], row["target_object_id"]) for row in category_morphisms if row["category_id"] == target_category["id"]}
      matched_morphisms = 0
      for row in category_morphisms:
        if row["category_id"] != source_category["id"]:
          continue
        mapped_source = next((item["target_object_id"] for item in mapping_pairs if item["source_object_id"] == row["source_object_id"]), None)
        mapped_target = next((item["target_object_id"] for item in mapping_pairs if item["source_object_id"] == row["target_object_id"]), None)
        if mapped_source and mapped_target and (mapped_source, mapped_target) in target_pairs:
          matched_morphisms += 1
      functor_id = f"functor-{bundle_id}-{index}"
      functors.append({
        "id": functor_id,
        "bundle_id": bundle_id,
        "source_category_id": source_category["id"],
        "target_category_id": target_category["id"],
        "name": f"{source_category['label']} -> {target_category['label']}",
        "mapping_json": {"pairs": mapping_pairs},
        "validation_json": {"identity_preserved": bool(mapping_pairs), "composition_preserved": matched_morphisms > 0, "matched_morphisms": matched_morphisms},
        "created_at": now,
        "updated_at": now,
      })
      validation.append({
        "id": f"functor-validation-{index}",
        "title": f"Functor {index}",
        "status": "pass" if matched_morphisms > 0 else "warning",
        "details": f"Mapped {len(mapping_pairs)} objects with {matched_morphisms} commuting relation matches.",
        "entity_ids": [source_category["id"], target_category["id"], functor_id],
      })
      if len(mapping_pairs) >= 2:
        natural_id = f"natural-{bundle_id}-{index}"
        natural_transformations.append({
          "id": natural_id,
          "bundle_id": bundle_id,
          "source_functor_id": functor_id,
          "target_functor_id": functor_id,
          "label": f"Comparison transform {index}",
          "components_json": mapping_pairs[:2],
          "validation_json": {"commutative": matched_morphisms > 0, "component_count": len(mapping_pairs[:2])},
          "created_at": now,
          "updated_at": now,
        })
        validation.append({
          "id": f"natural-validation-{index}",
          "title": f"Natural transformation {index}",
          "status": "pass" if matched_morphisms > 0 else "warning",
          "details": "Named comparison components preserve at least one mapped relation." if matched_morphisms > 0 else "Mapped components did not preserve a visible relation.",
          "entity_ids": [natural_id, functor_id],
        })
    payload = {
      "title": "Grothendieck Diagram Lens",
      "status": "ready" if functors else "empty",
      "summary": f"{len(functors)} functors and {len(natural_transformations)} natural transformations assembled from book categories.",
      "data": {
        "category_ids": [row["id"] for row in categories],
        "functor_ids": [row["id"] for row in functors],
        "natural_transformation_ids": [row["id"] for row in natural_transformations],
      },
    }
    return functors, natural_transformations, payload, validation

  def _build_sheaf_payload(self, covers: list[dict[str, Any]], restriction_maps: list[dict[str, Any]], gluing_constraints: list[dict[str, Any]], seeded_obstructions: list[dict[str, Any]], connection):
    cover_lookup = {row["id"]: row for row in covers}
    nodes = {row["id"]: row for row in repository.get_nodes_by_ids(connection, [node_id for cover in covers for node_id in cover.get("node_ids", [])])}
    dynamic_obstructions = []
    validation = []
    for constraint in gluing_constraints:
      cover = cover_lookup.get(constraint["cover_id"])
      if cover is None:
        continue
      section_nodes = [nodes.get(node_id) for node_id in cover.get("node_ids", []) if nodes.get(node_id)]
      overlap_scores = []
      for left, right in zip(section_nodes, section_nodes[1:]):
        left_words = set(tokenize_words(left.get("text", "")))
        right_words = set(tokenize_words(right.get("text", "")))
        overlap_scores.append(len(left_words & right_words) / max(1, len(left_words | right_words)))
      threshold = float(constraint.get("rule", {}).get("threshold", 0.2))
      average_overlap = sum(overlap_scores) / len(overlap_scores) if overlap_scores else 1.0
      passes = average_overlap >= threshold
      validation.append({
        "id": f"gluing-validation-{constraint['id']}",
        "title": constraint["label"],
        "status": "pass" if passes else "warning",
        "details": "Local sections glue successfully." if passes else "Local sections fail the gluing threshold and produce an obstruction.",
        "entity_ids": [constraint["id"], cover["id"]],
      })
      if not passes:
        dynamic_obstructions.append({
          "id": f"obstruction-{constraint['id']}",
          "type": "Obstruction",
          "label": cover["label"],
          "document_id": cover["document_id"],
          "node_id": cover.get("node_ids", [None])[0],
          "parent_id": cover["id"],
          "metadata": {"average_overlap": round(average_overlap, 4), "threshold": threshold},
        })
    payload = {
      "title": "Sheaf Lens",
      "status": "ready" if covers else "empty",
      "summary": f"{len(covers)} covers, {len(restriction_maps)} restriction maps, and {len(seeded_obstructions) + len(dynamic_obstructions)} obstructions assessed.",
      "data": {
        "cover_ids": [row["id"] for row in covers],
        "restriction_map_ids": [row["id"] for row in restriction_maps],
        "obstruction_ids": [row["id"] for row in seeded_obstructions] + [row["id"] for row in dynamic_obstructions],
      },
    }
    return payload, validation, dynamic_obstructions

  def _build_simplicial_payload(self, simplices: list[dict[str, Any]], object_lookup: dict[str, dict[str, Any]]):
    display = []
    for simplex in simplices[:10]:
      display.append({
        "id": simplex["id"],
        "dimension": simplex["dimension"],
        "weight": simplex["weight"],
        "labels": [object_lookup.get(object_id, {}).get("label", object_id) for object_id in simplex.get("object_ids", [])],
        "node_id": simplex.get("node_id"),
      })
    return {
      "title": "Simplicial Lens",
      "status": "ready" if display else "empty",
      "summary": f"{len(display)} higher-order concept constellations extracted from retrieved documents.",
      "data": {"simplices": display},
    }

  def _build_catastrophe_payload(self, bundle_id: str, documents: list[dict[str, Any]], citations: list[dict[str, Any]], now: str):
    rows = []
    for document in documents:
      metadata = repository.json_loads(document.get("metadata_json"), {})
      year = metadata.get("edition_year") or metadata.get("year")
      if year is None:
        continue
      citation_score = next((item["score"] for item in citations if item["document_id"] == document["id"]), 0.0)
      rows.append({"document_id": document["id"], "title": document["title"], "year": year, "formalism": metadata.get("formalism", "general"), "state_score": citation_score})
    if len(rows) < 2:
      return [], {
        "title": "Catastrophe Lens",
        "status": "unavailable",
        "summary": "No ordered control axis was available for regime-shift detection.",
        "data": {"points": []},
      }, [{
        "id": f"catastrophe-validation-{bundle_id}",
        "title": "Catastrophe detection",
        "status": "warning",
        "details": "At least two documents with ordered metadata are required.",
        "entity_ids": [],
      }]
    ordered = sorted(rows, key=lambda row: row["year"])
    deltas = [abs(right["state_score"] - left["state_score"]) for left, right in zip(ordered, ordered[1:])]
    max_delta = max(deltas) if deltas else 0.0
    event_type = "cusp" if len(ordered) >= 3 and max_delta >= 0.2 else "fold" if max_delta >= 0.12 else "stable"
    events = []
    if event_type in {"cusp", "fold"}:
      events.append({
        "id": f"catastrophe-{bundle_id}",
        "bundle_id": bundle_id,
        "label": f"{event_type.title()} transition across retrieved sources",
        "event_type": event_type,
        "control_axis_json": {"dimension": "year", "points": [row["year"] for row in ordered]},
        "state_axis_json": {"dimension": "citation_score", "points": [row["state_score"] for row in ordered]},
        "payload_json": {"documents": [row["document_id"] for row in ordered]},
        "validation_json": {"status": "pass", "delta": max_delta},
        "created_at": now,
        "updated_at": now,
      })
    return events, {
      "title": "Catastrophe Lens",
      "status": "ready" if events else "limited",
      "summary": f"Control axis built from {len(ordered)} ordered documents; strongest state delta {max_delta:.2f}.",
      "data": {"points": ordered, "event_ids": [row["id"] for row in events], "event_type": event_type},
    }, [{
      "id": f"catastrophe-validation-{bundle_id}",
      "title": "Catastrophe detection",
      "status": "pass" if events else "warning",
      "details": "Detected regime shift in the ordered source set." if events else "No meaningful regime shift exceeded the configured threshold.",
      "entity_ids": [row["id"] for row in events],
    }]

  def _build_bundle_entities(self, objects, sign_tokens, categories, covers, simplices, interpretants, obstructions, catastrophe_events, functors, natural_transformations):
    entities = []
    for row in objects[:12]:
      entities.append({"id": row["id"], "type": "ObjectOfReference", "label": row["label"], "document_id": row.get("payload", {}).get("document_id"), "node_id": None, "parent_id": None, "metadata": row.get("payload", {})})
    for row in sign_tokens[:12]:
      entities.append({"id": row["id"], "type": "SignToken", "label": row["label"], "document_id": row.get("document_id"), "node_id": row.get("node_id"), "parent_id": row.get("payload", {}).get("object_id"), "metadata": row.get("payload", {})})
    for row in categories[:8]:
      entities.append({"id": row["id"], "type": "Category", "label": row["label"], "document_id": row.get("document_id"), "node_id": row.get("node_id"), "parent_id": None, "metadata": row.get("payload", {})})
    for row in covers[:8]:
      entities.append({"id": row["id"], "type": "Cover", "label": row["label"], "document_id": row.get("document_id"), "node_id": row.get("node_ids", [None])[0], "parent_id": row.get("object_id"), "metadata": {"node_ids": row.get("node_ids", [])}})
    for row in simplices[:8]:
      entities.append({"id": row["id"], "type": "Simplex", "label": f"{row['dimension']}-simplex", "document_id": row.get("document_id"), "node_id": row.get("node_id"), "parent_id": None, "metadata": {"dimension": row["dimension"], "object_ids": row.get("object_ids", []), "weight": row.get("weight")}})
    for row in interpretants:
      entities.append({"id": row["id"], "type": "Interpretant", "label": summarize_text(row["summary"], max_sentences=1, max_words=6), "document_id": row.get("payload_json", {}).get("document_id") if isinstance(row.get("payload_json"), dict) else None, "node_id": row.get("node_id"), "parent_id": row.get("parent_interpretant_id"), "metadata": {"summary": row["summary"], "depth": row["depth"]}})
    for row in functors:
      entities.append({"id": row["id"], "type": "FunctorMapping", "label": row["name"], "document_id": None, "node_id": None, "parent_id": row["source_category_id"], "metadata": row.get("mapping_json", {}) if isinstance(row.get("mapping_json"), dict) else {}})
    for row in natural_transformations:
      entities.append({"id": row["id"], "type": "NaturalTransformation", "label": row["label"], "document_id": None, "node_id": None, "parent_id": row["source_functor_id"], "metadata": {"components": row.get("components_json", []) if isinstance(row.get("components_json"), list) else []}})
    entities.extend(obstructions)
    for row in catastrophe_events:
      entities.append({"id": row["id"], "type": "CatastropheEvent", "label": row["label"], "document_id": None, "node_id": None, "parent_id": None, "metadata": {"event_type": row["event_type"]}})
    return entities

  def _build_cover_relations(self, covers, obstructions, restriction_maps):
    relations = []
    for row in restriction_maps[:12]:
      relations.append({"id": row["id"], "type": "RestrictionMap", "source_id": row["from_node_id"], "target_id": row["to_node_id"], "label": "restricts", "evidence_ids": [], "validation": row.get("validation", {}), "metadata": row.get("payload", {})})
    for row in covers[:8]:
      relations.append({"id": f"cover-rel-{row['id']}", "type": "Cover", "source_id": row["object_id"], "target_id": row["id"], "label": "covered_by", "evidence_ids": row.get("node_ids", []), "validation": {"status": "grounded"}, "metadata": row.get("payload", {})})
    for row in obstructions[:8]:
      relations.append({"id": f"obstruction-rel-{row['id']}", "type": "Obstruction", "source_id": row["parent_id"], "target_id": row["id"], "label": "obstructs", "evidence_ids": [], "validation": {"status": "warning"}, "metadata": row.get("metadata", {})})
    return relations

  def _fallback_answer(self, mode: str, citations: list[dict[str, Any]]) -> str:
    if not citations:
      return "Insufficient evidence in the indexed library to answer this question confidently."
    if mode == "cross_book" and len(citations) >= 2:
      first = citations[0]
      second = citations[1]
      return (
        f"{first['document_title']} frames the issue through {first['quote'].lower()} "
        f"while {second['document_title']} shifts it toward {second['quote'].lower()} "
        "The current evidence bundle supports a comparative reading rather than a single uniform thesis."
      )
    lead = citations[0]
    return (
      f"The strongest available evidence comes from {lead['document_title']} on pages {lead['page_start']}-{lead['page_end']}. "
      f"It indicates that {lead['quote'].lower()} "
      "The other retrieved passages reinforce that interpretation."
    )
