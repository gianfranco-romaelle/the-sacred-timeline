from __future__ import annotations

import os
from pathlib import Path

from .bootstrap import activate_vendor_path

activate_vendor_path()

from pydantic_settings import BaseSettings, SettingsConfigDict


def _load_local_runtime_env() -> None:
  repo_root = Path(__file__).resolve().parents[2]
  env_path = repo_root / ".tmp" / "remote-ocr.env"
  if not env_path.exists():
    return
  for line in env_path.read_text(encoding="utf-8").splitlines():
    text = str(line or "").strip()
    if not text or text.startswith("#") or "=" not in text:
      continue
    name, value = text.split("=", 1)
    name = name.strip()
    if not name:
      continue
    os.environ.setdefault(name, value.strip())


_load_local_runtime_env()


class Settings(BaseSettings):
  model_config = SettingsConfigDict(env_prefix="SEMANTIC_LIBRARY_", extra="ignore")

  app_name: str = "Self-Hosted Semantic Library Engine"
  runtime_mode: str = "prod"
  data_dir: str = "backend/data"
  model_cache_dir: str = "backend/data/model-cache"
  job_artifact_dir: str = "backend/data/jobs"
  operator_runtime_path: str = ".tmp/operator-runtime.json"
  session_cookie_name: str = "semantic_library_session"
  jwt_secret: str = "local-dev-secret-change-me-2026-please-override"
  session_ttl_hours: int = 72
  qdrant_url: str = "http://127.0.0.1:6333"
  qdrant_api_key: str | None = None
  enable_local_qdrant_fallback: bool = True
  qdrant_local_path: str = "backend/data/qdrant-local"
  default_local_username: str = "librarian"
  default_local_password: str = "library"
  default_local_display_name: str = "Local Librarian"
  bootstrap_default_account: bool = False
  enable_dev_fallbacks: bool = False
  enable_demo_seed: bool = False
  qdrant_collection_name: str = "library_nodes"
  vector_size: int = 1024
  embedding_model: str = "BAAI/bge-m3"
  reranker_model: str = "BAAI/bge-reranker-base"
  ocr_language: str = "en"
  request_timeout_seconds: float = 15.0
  ollama_base_url: str = "http://127.0.0.1:11434"
  ollama_model: str = "qwen2.5:7b-instruct"
  remote_llm_url: str | None = None
  remote_llm_api_key: str | None = None
  pipeline_version: str = "2026.03.v2"
  worker_poll_interval_seconds: float = 3.0
  citation_download_poll_interval_seconds: float = 15.0
  citation_download_timeout_seconds: float = 180.0
  citation_download_chunk_size_bytes: int = 262144
  citation_download_staging_dir: str = "backend/data/citations/staging"
  watch_folder_scan_interval_seconds: float = 300.0
  watchfiles_enabled: bool = True
  watchfiles_debounce_milliseconds: int = 1200
  watchfiles_step_milliseconds: int = 75
  watchfiles_rust_timeout_milliseconds: int = 250
  watch_folder_copy_settle_seconds: float = 8.0
  watch_folder_event_batch_limit: int = 512
  extract_file_timeout_seconds: float = 45.0
  extract_stage_batch_size: int = 1
  extract_failure_recovery_batch_size: int = 2
  running_task_recovery_minutes: float = 10.0
  directory_discovery_max_passes: int = 4
  directory_discovery_stable_passes: int = 2
  directory_discovery_settle_seconds: float = 0.2
  priority_import_roots: str = r"G:\Other computers\My Laptop\THE AUGUSTE LAURENT SOCIETY"
  max_active_import_jobs: int = 1
  math_runtime_profile: str = "safe-high-quality"
  math_provider_timeout_seconds: float = 90.0
  math_max_page_batch_size: int = 1
  math_max_region_batch_size: int = 1
  math_confidence_escalate_threshold: float = 0.72
  math_confidence_accept_threshold: float = 0.9
  math_handwriting_likelihood_threshold: float = 0.45
  math_max_rendered_page_side: int = 1800
  math_pix2text_enabled: bool = True
  math_pix2text_device: str | None = None
  math_pix2text_resized_shape: int = 768
  math_pix2text_formula_model: str = "mfr-1.5"
  math_pix2text_detector_model: str = "mfd-1.5"
  math_unimernet_enabled: bool = True
  math_unimernet_command: str | None = None
  math_unimernet_model_name: str = "unimernet_small"
  math_nougat_enabled: bool = True
  math_nougat_command: str = "nougat"
  math_nougat_model: str = "0.1.0-small"
  math_mathpix_enabled: bool = False
  math_mathpix_app_id: str | None = None
  math_mathpix_api_key: str | None = None
  math_mathpix_use_for_low_confidence: bool = True
  remote_ocr_enabled: bool = True
  remote_ocr_url: str | None = None
  remote_ocr_api_key: str | None = None
  remote_ocr_model: str = "ocr-1"
  remote_ocr_timeout_seconds: float = 60.0
  prefer_remote_ocr: bool = False
  remote_only_ocr: bool = False
  remote_compute_mode: str = "local_everything"
  remote_embedding_enabled: bool = False
  remote_embedding_url: str | None = None
  remote_embedding_api_key: str | None = None
  remote_embedding_model: str = "embed-1"
  remote_embedding_timeout_seconds: float = 120.0
  prefer_remote_embedding: bool = False
  remote_only_embedding: bool = False
  remote_vector_upsert_enabled: bool = False
  remote_vector_upsert_url: str | None = None
  remote_vector_upsert_api_key: str | None = None
  remote_vector_upsert_timeout_seconds: float = 120.0
  profiling_mode: bool = False

  @property
  def backend_root(self) -> Path:
    return Path(__file__).resolve().parents[1]

  @property
  def resolved_data_dir(self) -> Path:
    path = Path(self.data_dir)
    if path.is_absolute():
      return path
    return Path(__file__).resolve().parents[2] / path

  @property
  def sqlite_path(self) -> Path:
    return self.resolved_data_dir / "library.sqlite3"

  @property
  def resolved_model_cache_dir(self) -> Path:
    path = Path(self.model_cache_dir)
    if path.is_absolute():
      return path
    return Path(__file__).resolve().parents[2] / path

  @property
  def resolved_job_artifact_dir(self) -> Path:
    path = Path(self.job_artifact_dir)
    if path.is_absolute():
      return path
    return Path(__file__).resolve().parents[2] / path

  @property
  def resolved_citation_download_staging_dir(self) -> Path:
    path = Path(self.citation_download_staging_dir)
    if path.is_absolute():
      return path
    return Path(__file__).resolve().parents[2] / path

  @property
  def resolved_operator_runtime_path(self) -> Path:
    path = Path(self.operator_runtime_path)
    if path.is_absolute():
      return path
    return Path(__file__).resolve().parents[2] / path

  @property
  def resolved_qdrant_local_path(self) -> Path:
    path = Path(self.qdrant_local_path)
    if path.is_absolute():
      return path
    return Path(__file__).resolve().parents[2] / path

  @property
  def resolved_math_model_cache_dir(self) -> Path:
    return self.resolved_model_cache_dir / "math"

  @property
  def effective_remote_embedding_url(self) -> str | None:
    explicit = str(self.remote_embedding_url or "").strip()
    if explicit:
      return explicit
    base = str(self.remote_ocr_url or "").strip()
    if not base:
      return None
    if base.endswith("/v1/ocr"):
      return base[: -len("/v1/ocr")] + "/v1/embed"
    return base.rstrip("/") + "/v1/embed"

  @property
  def effective_remote_vector_upsert_url(self) -> str | None:
    explicit = str(self.remote_vector_upsert_url or "").strip()
    if explicit:
      return explicit
    base = str(self.remote_ocr_url or "").strip()
    if not base:
      return None
    if base.endswith("/v1/ocr"):
      return base[: -len("/v1/ocr")] + "/v1/vector/upsert"
    return base.rstrip("/") + "/v1/vector/upsert"

  @property
  def normalized_remote_compute_mode(self) -> str:
    raw = str(self.remote_compute_mode or "").strip().lower()
    aliases = {
      "local": "local_everything",
      "local_only": "local_everything",
      "remote_ocr": "remote_ocr_only",
      "remote_ocr_only": "remote_ocr_only",
      "remote_ocr_embedding": "remote_ocr_remote_embeddings",
      "remote_ocr_embeddings": "remote_ocr_remote_embeddings",
      "remote_ocr_remote_embeddings": "remote_ocr_remote_embeddings",
      "remote_full": "remote_ocr_remote_embeddings_remote_vector",
      "remote_vector": "remote_ocr_remote_embeddings_remote_vector",
      "remote_ocr_remote_embeddings_remote_vector": "remote_ocr_remote_embeddings_remote_vector",
    }
    return aliases.get(raw, "local_everything")

  @property
  def use_remote_ocr(self) -> bool:
    return (
      self.normalized_remote_compute_mode in {
        "remote_ocr_only",
        "remote_ocr_remote_embeddings",
        "remote_ocr_remote_embeddings_remote_vector",
      }
      or bool(self.remote_ocr_enabled and self.remote_ocr_url)
    )

  @property
  def use_remote_embedding(self) -> bool:
    return (
      self.normalized_remote_compute_mode in {
        "remote_ocr_remote_embeddings",
        "remote_ocr_remote_embeddings_remote_vector",
      }
      or bool(self.remote_embedding_enabled and self.effective_remote_embedding_url)
    )

  @property
  def use_remote_vector_upsert(self) -> bool:
    return (
      self.normalized_remote_compute_mode == "remote_ocr_remote_embeddings_remote_vector"
      or bool(self.remote_vector_upsert_enabled and self.effective_remote_vector_upsert_url)
    )

  @property
  def prioritized_import_roots(self) -> list[str]:
    parts = [item.strip() for item in str(self.priority_import_roots or "").split("|")]
    return [item.rstrip("\\/") for item in parts if item]

  @property
  def is_dev(self) -> bool:
    return self.runtime_mode.strip().lower() == "dev"

  @property
  def dev_fallbacks_enabled(self) -> bool:
    return self.enable_dev_fallbacks or self.is_dev

  @property
  def demo_seed_enabled(self) -> bool:
    return self.enable_demo_seed or self.is_dev

  @property
  def default_account_enabled(self) -> bool:
    return self.bootstrap_default_account or self.is_dev


settings = Settings()
