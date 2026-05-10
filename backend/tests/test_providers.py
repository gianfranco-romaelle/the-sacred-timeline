from __future__ import annotations

from pathlib import Path

from app import providers
from app.config import Settings


def test_sentence_transformer_probe_does_not_load_model(monkeypatch, tmp_path):
  monkeypatch.setattr(providers, "SentenceTransformer", object())
  provider = providers.SentenceTransformerEmbeddingProvider("BAAI/bge-m3", 1024, tmp_path / "models")

  def fail_load():
    raise AssertionError("_load should not run during readiness probe")

  monkeypatch.setattr(provider, "_load", fail_load)

  assert provider.check_ready() == (True, "BAAI/bge-m3")


def test_cross_encoder_probe_does_not_load_model(monkeypatch, tmp_path):
  monkeypatch.setattr(providers, "CrossEncoder", object())
  provider = providers.CrossEncoderReranker("BAAI/bge-reranker-base", tmp_path / "models")

  def fail_load():
    raise AssertionError("_load should not run during readiness probe")

  monkeypatch.setattr(provider, "_load", fail_load)

  assert provider.check_ready() == (True, "BAAI/bge-reranker-base")


def test_paddle_probe_does_not_initialize_ocr(monkeypatch):
  monkeypatch.setattr(providers, "PaddleOCR", object())
  monkeypatch.setattr(providers, "pdfium", object())
  provider = providers.PaddleOCRProvider("en")

  def fail_load():
    raise AssertionError("_load should not run during readiness probe")

  monkeypatch.setattr(provider, "_load", fail_load)

  assert provider.check_ready() == (True, "en")


def test_build_embedding_provider_prefers_local_with_remote_fallback(monkeypatch, tmp_path):
  monkeypatch.setattr(providers, "SentenceTransformer", object())

  settings = Settings(
    embedding_model="BAAI/bge-m3",
    remote_embedding_enabled=True,
    remote_embedding_url="https://compute.example.test/v1/embed",
    remote_embedding_api_key="secret",
    remote_embedding_model="embed-1",
    prefer_remote_embedding=False,
    remote_only_embedding=False,
    model_cache_dir=str(tmp_path / "models"),
  )

  provider = providers.build_embedding_provider(settings)

  assert isinstance(provider, providers.CompositeEmbeddingProvider)
  assert isinstance(provider.fallback, providers.RemoteEmbeddingProvider)


def test_build_embedding_provider_uses_derived_remote_endpoint(monkeypatch, tmp_path):
  monkeypatch.setattr(providers, "SentenceTransformer", None)

  settings = Settings(
    remote_ocr_url="https://compute.example.test/v1/ocr",
    remote_ocr_api_key="secret",
    remote_embedding_enabled=True,
    remote_embedding_url=None,
    remote_embedding_model="embed-1",
    remote_only_embedding=True,
    model_cache_dir=str(tmp_path / "models"),
  )

  provider = providers.build_embedding_provider(settings)

  assert isinstance(provider, providers.RemoteEmbeddingProvider)
  assert provider.base_url == "https://compute.example.test/v1/embed"


def test_build_ocr_provider_prefers_remote_in_remote_ocr_mode(monkeypatch):
  monkeypatch.setattr(providers, "_get_paddleocr", lambda: object())
  monkeypatch.setattr(providers, "pdfium", object())

  settings = Settings(
    remote_compute_mode="remote_ocr_only",
    remote_ocr_url="https://compute.example.test/v1/ocr",
    remote_ocr_api_key="secret",
    remote_ocr_model="ocr-1",
  )

  provider = providers.build_ocr_provider(settings)

  assert isinstance(provider, providers.RemoteOCRProvider)


def test_build_embedding_provider_prefers_remote_in_remote_embedding_mode(monkeypatch, tmp_path):
  monkeypatch.setattr(providers, "SentenceTransformer", object())

  settings = Settings(
    remote_compute_mode="remote_ocr_remote_embeddings",
    remote_ocr_url="https://compute.example.test/v1/ocr",
    remote_ocr_api_key="secret",
    remote_embedding_enabled=True,
    remote_embedding_model="embed-1",
    model_cache_dir=str(tmp_path / "models"),
  )

  provider = providers.build_embedding_provider(settings)

  assert isinstance(provider, providers.CompositeEmbeddingProvider)
  assert isinstance(provider.primary, providers.RemoteEmbeddingProvider)


def test_remote_embedding_provider_checks_health_endpoint(monkeypatch):
  class _FakeResponse:
    def raise_for_status(self):
      return None

    def json(self):
      return {"embedding_ready": True}

  class _FakeHttpx:
    @staticmethod
    def get(url, timeout):
      assert url == "https://compute.example.test/health"
      return _FakeResponse()

  monkeypatch.setattr(providers, "httpx", _FakeHttpx)
  provider = providers.RemoteEmbeddingProvider("https://compute.example.test/v1/embed", None, "embed-1", 30.0)

  assert provider.check_ready() == (True, "embed-1")


def test_remote_ocr_provider_checks_health_endpoint(monkeypatch):
  class _FakeResponse:
    def raise_for_status(self):
      return None

    def json(self):
      return {"ready": True, "providers": {"ocr": {"ready": True}}}

  class _FakeHttpx:
    @staticmethod
    def get(url, timeout):
      assert url == "https://compute.example.test/health"
      return _FakeResponse()

  monkeypatch.setattr(providers, "httpx", _FakeHttpx)
  provider = providers.RemoteOCRProvider("https://compute.example.test/v1/ocr", None, "ocr-1", 30.0)

  assert provider.check_ready() == (True, "ocr-1")
