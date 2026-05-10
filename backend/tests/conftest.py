from __future__ import annotations

import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
VENDOR_PATH = BACKEND_ROOT / "_vendor"

if str(VENDOR_PATH) not in sys.path:
  sys.path.insert(0, str(VENDOR_PATH))
if str(BACKEND_ROOT) not in sys.path:
  sys.path.insert(0, str(BACKEND_ROOT))

from app.bootstrap import activate_vendor_path

activate_vendor_path()

import pytest
from fastapi.testclient import TestClient

from app import main as main_module
from app.database import initialize_database
from app.engine import LibraryEngine
from app.providers import HashEmbeddingProvider


class _MemoryVectorIndex:
  enabled = True
  search_enabled = True
  write_enabled = True
  mode = "test-memory"
  storage_path = None
  detail = "In-memory vector index for isolated backend tests."

  def __init__(self):
    self.nodes = []

  def status(self):
    return {
      "configured_url": "memory://pytest",
      "ready": True,
      "write_ready": True,
      "detail": self.detail,
      "collection": "test_nodes",
      "mode": self.mode,
      "storage_path": self.storage_path,
      "write_mode": self.mode,
      "remote_upsert": {"enabled": False, "ready": False},
    }

  def upsert_nodes(self, nodes):
    eligible = [
      dict(node)
      for node in nodes
      if node.get("node_type") in {"summary", "chunk"} and str(node.get("text") or "").strip()
    ]
    self.nodes.extend(eligible)
    return {
      "upserted_count": len(eligible),
      "point_ids": [str(node["id"]) for node in eligible],
      "collection": "test_nodes",
      "mode": self.mode,
      "warnings": [],
      "embedding_provenance": {"provider": "hash_embedding", "location": "local"},
      "vector_provenance": {
        "location": "local",
        "collection": "test_nodes",
        "mode": self.mode,
        "storage_path": None,
        "configured_url": "memory://pytest",
      },
    }

  def search(self, query_text, node_types=None, summary_levels=None, document_ids=None, limit=12):
    node_type_set = set(node_types or [])
    summary_level_set = set(summary_levels or [])
    document_id_set = set(document_ids or [])
    query_terms = {term.lower() for term in str(query_text or "").split() if term.strip()}
    matches = []
    for node in self.nodes:
      if node_type_set and node.get("node_type") not in node_type_set:
        continue
      if summary_level_set and node.get("summary_level") not in summary_level_set:
        continue
      if document_id_set and node.get("document_id") not in document_id_set:
        continue
      text = str(node.get("text") or "").lower()
      score = sum(1 for term in query_terms if term in text)
      matches.append((score, node))
    matches.sort(key=lambda item: item[0], reverse=True)
    return [
      {
        "id": str(node["id"]),
        "node_id": str(node["id"]),
        "score": float(score),
        "document_id": node.get("document_id"),
        "node_type": node.get("node_type"),
        "summary_level": node.get("summary_level"),
        "ordinal": node.get("ordinal", 0),
        "page_start": node.get("page_start", 1),
        "page_end": node.get("page_end", 1),
        "title": node.get("title", ""),
        "text": node.get("text", ""),
      }
      for score, node in matches[:limit]
    ]


@pytest.fixture
def isolated_client(tmp_path):
  previous_values = {
    "data_dir": main_module.settings.data_dir,
    "model_cache_dir": main_module.settings.model_cache_dir,
    "job_artifact_dir": main_module.settings.job_artifact_dir,
    "runtime_mode": main_module.settings.runtime_mode,
    "enable_dev_fallbacks": main_module.settings.enable_dev_fallbacks,
    "enable_demo_seed": main_module.settings.enable_demo_seed,
    "bootstrap_default_account": main_module.settings.bootstrap_default_account,
  }
  previous_engine = main_module.engine

  main_module.settings.data_dir = str(tmp_path / "data")
  # Keep the shared cache path in tests so Windows file locks from local model
  # providers do not block temporary-directory cleanup between isolated clients.
  main_module.settings.model_cache_dir = previous_values["model_cache_dir"]
  main_module.settings.job_artifact_dir = str(tmp_path / "jobs")
  main_module.settings.runtime_mode = "dev"
  main_module.settings.enable_dev_fallbacks = True
  main_module.settings.enable_demo_seed = True
  main_module.settings.bootstrap_default_account = True

  initialize_database(main_module.settings.sqlite_path)
  main_module.engine = LibraryEngine(main_module.settings)
  main_module.engine.embedder = HashEmbeddingProvider(main_module.settings.vector_size)
  main_module.engine.vector_index = _MemoryVectorIndex()

  with TestClient(main_module.app) as client:
    yield client

  main_module.engine = previous_engine
  for key, value in previous_values.items():
    setattr(main_module.settings, key, value)
