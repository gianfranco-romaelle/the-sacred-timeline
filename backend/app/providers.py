from __future__ import annotations

import base64
import hashlib
import io
import math
import mimetypes
import tempfile
import time
from pathlib import Path
from typing import Any

from .bootstrap import activate_vendor_path

activate_vendor_path()

try:
  import httpx
except Exception:  # pragma: no cover - optional import
  httpx = None

try:
  from curl_cffi import requests as curl_requests
except Exception:  # pragma: no cover - optional import
  curl_requests = None

try:
  import numpy as np
except Exception:  # pragma: no cover - optional import
  np = None

try:
  import pypdfium2 as pdfium
except Exception:  # pragma: no cover - optional import
  pdfium = None

try:
  from PIL import Image
except Exception:  # pragma: no cover - optional import
  Image = None

try:
  from sentence_transformers import CrossEncoder, SentenceTransformer
except Exception:  # pragma: no cover - optional import
  CrossEncoder = None
  SentenceTransformer = None

PaddleOCR = None
_paddleocr_import_attempted = False


def _get_paddleocr():
  global PaddleOCR, _paddleocr_import_attempted
  if _paddleocr_import_attempted:
    return PaddleOCR
  _paddleocr_import_attempted = True
  try:
    from paddleocr import PaddleOCR as _PaddleOCR
    PaddleOCR = _PaddleOCR
  except Exception:  # pragma: no cover - optional import
    PaddleOCR = None
  return PaddleOCR

try:
  import yfinance
except Exception:  # pragma: no cover - optional import
  yfinance = None

from .pharma_event_topos_runtime import (
  extract_press_release_text,
  normalize_pharma_event,
  parse_biopharmcatalyst_listing_html,
)


def _trim_text(text: str, max_words: int = 80) -> str:
  words = text.split()
  if len(words) <= max_words:
    return " ".join(words)
  return " ".join(words[:max_words]).rstrip(" ,.;:") + "..."


class RemoteServiceError(RuntimeError):
  def __init__(
    self,
    service: str,
    code: str,
    message: str,
    *,
    retryable: bool = True,
    node_url: str | None = None,
    status_code: int | None = None,
  ) -> None:
    self.service = service
    self.code = code
    self.message = message
    self.retryable = retryable
    self.node_url = node_url
    self.status_code = status_code
    super().__init__(f"{service}:{code}:{message}")


def _extract_remote_error_detail(response) -> str:
  try:
    payload = response.json()
    if isinstance(payload, dict):
      detail = payload.get("detail")
      if isinstance(detail, str) and detail.strip():
        return detail.strip()
      error = payload.get("error")
      if isinstance(error, str) and error.strip():
        return error.strip()
  except Exception:
    pass
  try:
    return str(response.text or "").strip() or f"HTTP {response.status_code}"
  except Exception:
    return f"HTTP {response.status_code}"


def _classify_remote_error(service: str, base_url: str, error: Exception) -> RemoteServiceError:
  if httpx is not None:
    if isinstance(error, httpx.TimeoutException):
      return RemoteServiceError(service, "network_timeout", "Remote request timed out.", node_url=base_url)
    if isinstance(error, httpx.HTTPStatusError):
      response = error.response
      status_code = int(response.status_code)
      detail = _extract_remote_error_detail(response)
      lowered = detail.lower()
      if status_code in {400, 413, 415, 422}:
        return RemoteServiceError(service, "bad_payload", detail or "Remote service rejected the payload.", retryable=False, node_url=base_url, status_code=status_code)
      if status_code == 429:
        return RemoteServiceError(service, "queue_timeout", detail or "Remote queue is full.", node_url=base_url, status_code=status_code)
      if status_code == 503:
        code = "queue_timeout" if "queue" in lowered or "timed out" in lowered else "service_unavailable"
        return RemoteServiceError(service, code, detail or "Remote service is unavailable.", node_url=base_url, status_code=status_code)
      return RemoteServiceError(service, "service_unavailable", detail or f"Remote service returned HTTP {status_code}.", node_url=base_url, status_code=status_code)
    if isinstance(error, httpx.RequestError):
      return RemoteServiceError(service, "service_unavailable", str(error), node_url=base_url)
  return RemoteServiceError(service, "service_unavailable", str(error), node_url=base_url)


# ProviderBase gives the rest of the runtime one readiness contract across
# embeddings, OCR, reranking, reasoning, and external data/news providers.
class ProviderBase:
  name = "provider"
  is_fallback = False
  is_available = True

  def __init__(self, detail: str | None = None) -> None:
    self.detail = detail
    self._ready_cache: tuple[bool, str | None] | None = None

  def check_ready(self) -> tuple[bool, str | None]:
    if self._ready_cache is None:
      try:
        self._ready_cache = self._probe_ready()
      except Exception as error:  # pragma: no cover - defensive
        self._ready_cache = (False, str(error))
    return self._ready_cache

  def _probe_ready(self) -> tuple[bool, str | None]:
    return (self.is_available, self.detail)

  @property
  def ready(self) -> bool:
    return self.check_ready()[0]

  def provenance(self) -> dict[str, Any]:
    return {
      "provider": self.name,
      "detail": self.detail,
      "location": "local",
      "fallback": bool(getattr(self, "is_fallback", False)),
    }


class MarketDataProvider(ProviderBase):
  name = "market_data"

  def fetch_market_bundle(
    self,
    *,
    symbols: list[str],
    benchmark_symbol: str,
    period: str,
    interval: str,
    max_expiries: int,
    ) -> dict[str, Any]:
    raise NotImplementedError


class PharmaNewsProvider(ProviderBase):
  name = "pharma_news"

  def sync_recent_events(
    self,
    *,
    symbols: list[str],
    limit: int,
  ) -> dict[str, Any]:
    raise NotImplementedError

  def source_statuses(self) -> dict[str, dict[str, Any]]:
    return {}


class DossierNewsProvider(ProviderBase):
  name = "dossier_news"

  def source_statuses(self) -> dict[str, dict[str, Any]]:
    return {}


class UnavailableMarketDataProvider(MarketDataProvider):
  name = "market_data_unavailable"
  is_available = False

  def fetch_market_bundle(
    self,
    *,
    symbols: list[str],
    benchmark_symbol: str,
    period: str,
    interval: str,
    max_expiries: int,
  ) -> dict[str, Any]:  # pragma: no cover - guarded by readiness checks
    raise RuntimeError(self.detail or "Market data provider is unavailable.")


class UnavailablePharmaNewsProvider(PharmaNewsProvider):
  name = "pharma_news_unavailable"
  is_available = False

  def sync_recent_events(
    self,
    *,
    symbols: list[str],
    limit: int,
  ) -> dict[str, Any]:  # pragma: no cover - guarded by readiness checks
    raise RuntimeError(self.detail or "Pharma news provider is unavailable.")


class UnavailableDossierNewsProvider(DossierNewsProvider):
  name = "dossier_news_unavailable"
  is_available = False


class YFinanceMarketDataProvider(MarketDataProvider):
  name = "yfinance"

  def __init__(self, cache_ttl_seconds: float = 300.0) -> None:
    super().__init__(detail="yfinance")
    self.cache_ttl_seconds = float(cache_ttl_seconds)
    self._module = None
    self._cache: dict[tuple[str, ...], tuple[float, Any]] = {}

  def _load(self):
    if self._module is None:
      if yfinance is None:
        raise RuntimeError("yfinance is not installed.")
      self._module = yfinance
    return self._module

  def _probe_ready(self) -> tuple[bool, str | None]:
    try:
      self._load()
      return (True, "yfinance")
    except Exception as error:
      return (False, str(error))

  def _cache_get(self, key: tuple[str, ...]) -> Any | None:
    cached = self._cache.get(key)
    if cached is None:
      return None
    expires_at, payload = cached
    if expires_at < time.monotonic():
      self._cache.pop(key, None)
      return None
    return payload

  def _cache_set(self, key: tuple[str, ...], payload: Any) -> Any:
    self._cache[key] = (time.monotonic() + self.cache_ttl_seconds, payload)
    return payload

  def _history_rows(self, ticker, *, symbol: str, period: str, interval: str) -> list[dict[str, Any]]:
    key = ("history", symbol, period, interval)
    cached = self._cache_get(key)
    if cached is not None:
      return cached
    frame = ticker.history(period=period, interval=interval, auto_adjust=False)
    rows: list[dict[str, Any]] = []
    if frame is not None and hasattr(frame, "iterrows"):
      for index, row in frame.iterrows():
        rows.append({
          "date": getattr(index, "isoformat", lambda: str(index))(),
          "open": float(row.get("Open", row.get("open", 0.0)) or 0.0),
          "high": float(row.get("High", row.get("high", 0.0)) or 0.0),
          "low": float(row.get("Low", row.get("low", 0.0)) or 0.0),
          "close": float(row.get("Close", row.get("close", 0.0)) or 0.0),
          "adj_close": float(row.get("Adj Close", row.get("adj_close", row.get("Close", 0.0))) or 0.0),
          "volume": float(row.get("Volume", row.get("volume", 0.0)) or 0.0),
        })
    return self._cache_set(key, rows)

  def _option_rows(self, frame) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    if frame is None or not hasattr(frame, "iterrows"):
      return rows
    for _, row in frame.iterrows():
      rows.append({
        "contractSymbol": str(row.get("contractSymbol", "")),
        "strike": float(row.get("strike", 0.0) or 0.0),
        "lastPrice": float(row.get("lastPrice", 0.0) or 0.0),
        "bid": float(row.get("bid", 0.0) or 0.0),
        "ask": float(row.get("ask", 0.0) or 0.0),
        "change": float(row.get("change", 0.0) or 0.0),
        "percentChange": float(row.get("percentChange", 0.0) or 0.0),
        "volume": float(row.get("volume", 0.0) or 0.0),
        "openInterest": float(row.get("openInterest", 0.0) or 0.0),
        "impliedVolatility": float(row.get("impliedVolatility", 0.0) or 0.0),
        "inTheMoney": bool(row.get("inTheMoney", False)),
      })
    return rows

  def _option_payload(self, ticker, *, symbol: str, max_expiries: int) -> list[dict[str, Any]]:
    key = ("options", symbol, str(max_expiries))
    cached = self._cache_get(key)
    if cached is not None:
      return cached
    payload: list[dict[str, Any]] = []
    expiries = list(getattr(ticker, "options", []) or [])[:max(0, int(max_expiries))]
    for expiry in expiries:
      chain = ticker.option_chain(expiry)
      payload.append({
        "expiry": str(expiry),
        "calls": self._option_rows(getattr(chain, "calls", None)),
        "puts": self._option_rows(getattr(chain, "puts", None)),
      })
    return self._cache_set(key, payload)

  def _ticker_payload(
    self,
    *,
    symbol: str,
    period: str,
    interval: str,
    max_expiries: int,
  ) -> dict[str, Any]:
    module = self._load()
    ticker = module.Ticker(symbol)
    history = self._history_rows(ticker, symbol=symbol, period=period, interval=interval)
    spot = float(history[-1]["close"]) if history else 0.0
    warnings: list[str] = []
    try:
      options = self._option_payload(ticker, symbol=symbol, max_expiries=max_expiries)
    except Exception as error:
      options = []
      warnings.append(f"{symbol}: option-chain fetch failed ({error}).")
    return {
      "symbol": symbol,
      "spot": spot,
      "history": history,
      "options": options,
      "warnings": warnings,
    }

  def fetch_market_bundle(
    self,
    *,
    symbols: list[str],
    benchmark_symbol: str,
    period: str,
    interval: str,
    max_expiries: int,
  ) -> dict[str, Any]:
    resolved_symbols = [symbol.strip().upper() for symbol in symbols if str(symbol).strip()]
    if not resolved_symbols:
      raise RuntimeError("At least one symbol is required.")
    benchmark = str(benchmark_symbol or "SPY").strip().upper() or "SPY"
    unique_symbols = list(dict.fromkeys([*resolved_symbols, benchmark]))
    payloads: dict[str, dict[str, Any]] = {}
    warnings: list[str] = []
    for symbol in unique_symbols:
      try:
        payloads[symbol] = self._ticker_payload(
          symbol=symbol,
          period=period,
          interval=interval,
          max_expiries=max_expiries,
        )
        warnings.extend(payloads[symbol].get("warnings", []))
      except Exception as error:
        if symbol == benchmark:
          raise RuntimeError(f"Benchmark fetch failed for {benchmark}: {error}") from error
        warnings.append(f"{symbol}: data fetch failed ({error}).")
    symbol_payloads = {symbol: payloads[symbol] for symbol in resolved_symbols if symbol in payloads}
    if not symbol_payloads:
      raise RuntimeError("No symbol data could be fetched from yfinance.")
    benchmark_payload = payloads.get(benchmark, {"symbol": benchmark, "spot": 0.0, "history": [], "options": [], "warnings": []})
    return {
      "provider": {
        "name": self.name,
        "ready": True,
        "detail": "yfinance",
        "fallback": False,
      },
      "symbols": symbol_payloads,
      "benchmark_symbol": benchmark,
      "benchmark": benchmark_payload,
      "warnings": warnings,
    }


class DrugHunterProvider(ProviderBase):
  name = "drughunter"
  is_available = False

  def _probe_ready(self) -> tuple[bool, str | None]:
    return (False, "WIP: DrugHunter access is not configured in this environment.")


class BioPharmCatalystProvider(PharmaNewsProvider):
  name = "biopharmcatalyst"

  def __init__(self, cache_ttl_seconds: float = 300.0) -> None:
    super().__init__(detail="BioPharmCatalyst")
    self.cache_ttl_seconds = float(cache_ttl_seconds)
    self._cache: dict[tuple[str, ...], tuple[float, Any]] = {}

  def _probe_ready(self) -> tuple[bool, str | None]:
    if httpx is None and curl_requests is None:
      return (False, "Neither httpx nor curl_cffi is installed.")
    return (True, "BioPharmCatalyst")

  def _cache_get(self, key: tuple[str, ...]) -> Any | None:
    cached = self._cache.get(key)
    if cached is None:
      return None
    expires_at, payload = cached
    if expires_at < time.monotonic():
      self._cache.pop(key, None)
      return None
    return payload

  def _cache_set(self, key: tuple[str, ...], payload: Any) -> Any:
    self._cache[key] = (time.monotonic() + self.cache_ttl_seconds, payload)
    return payload

  def _fetch_text(self, url: str) -> str:
    cached = self._cache_get(("url", url))
    if cached is not None:
      return str(cached)
    headers = {
      "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36"
      ),
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      "Pragma": "no-cache",
      "Referer": "https://www.biopharmcatalyst.com/",
    }
    errors: list[str] = []
    if httpx is not None:
      try:
        with httpx.Client(follow_redirects=True, timeout=20.0, headers=headers, http2=True) as client:
          response = client.get(url)
          response.raise_for_status()
          return self._cache_set(("url", url), response.text)
      except Exception as error:
        errors.append(f"httpx: {error}")
    if curl_requests is not None:
      try:
        response = curl_requests.get(url, timeout=20.0, headers=headers, impersonate="chrome")
        response.raise_for_status()
        return self._cache_set(("url", url), response.text)
      except Exception as error:
        errors.append(f"curl_cffi: {error}")
    if not errors:
      raise RuntimeError("No supported HTTP client is installed.")
    raise RuntimeError("; ".join(errors))

  def _fetch_json(self, url: str) -> dict[str, Any]:
    cached = self._cache_get(("json", url))
    if cached is not None:
      return dict(cached)
    headers = {
      "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36"
      ),
      "Accept": "application/json, text/plain, */*",
      "Referer": "https://www.biopharmcatalyst.com/",
    }
    errors: list[str] = []
    if httpx is not None:
      try:
        with httpx.Client(follow_redirects=True, timeout=20.0, headers=headers, http2=True) as client:
          response = client.get(url)
          response.raise_for_status()
          return self._cache_set(("json", url), response.json())
      except Exception as error:
        errors.append(f"httpx: {error}")
    if curl_requests is not None:
      try:
        response = curl_requests.get(url, timeout=20.0, headers=headers, impersonate="chrome")
        response.raise_for_status()
        return self._cache_set(("json", url), response.json())
      except Exception as error:
        errors.append(f"curl_cffi: {error}")
    if not errors:
      raise RuntimeError("No supported HTTP client is installed.")
    raise RuntimeError("; ".join(errors))

  def _listing_html(self) -> str:
    urls = (
      "https://www.biopharmcatalyst.com/company-news",
      "https://www.biopharmcatalyst.com/news",
    )
    errors: list[str] = []
    for url in urls:
      try:
        html = self._fetch_text(url)
      except Exception as error:
        errors.append(f"{url}: {error}")
        continue
      if html and len(html) > 200:
        return html
    raise RuntimeError("Unable to fetch BioPharmCatalyst listing pages. " + "; ".join(errors))

  def _api_symbol_events(self, symbol: str, limit: int) -> list[dict[str, Any]]:
    payload = self._fetch_json(f"https://www.biopharmcatalyst.com/api/news/{symbol}")
    raw_items = list(dict(dict(payload.get("data", {})).get("news", {})).get("data", []) or [])
    events: list[dict[str, Any]] = []
    for raw_item in raw_items[: max(1, int(limit))]:
      body_html = str(raw_item.get("body", "") or "")
      events.append(normalize_pharma_event({
        "source": "biopharmcatalyst",
        "external_id": str(raw_item.get("id", "")).strip(),
        "ticker": symbol,
        "company": "",
        "event_at": str(raw_item.get("updated_at") or raw_item.get("created") or ""),
        "title": raw_item.get("title", ""),
        "summary": raw_item.get("teaser", ""),
        "source_url": f"https://www.biopharmcatalyst.com/company/{symbol}/news",
        "press_release_url": "",
        "press_release_text": extract_press_release_text(body_html) if body_html else "",
        "confidence": 0.8,
        "payload": dict(raw_item),
      }))
    return events

  def sync_recent_events(
    self,
    *,
    symbols: list[str],
    limit: int,
  ) -> dict[str, Any]:
    requested_symbols = {symbol.strip().upper() for symbol in symbols if str(symbol).strip()}
    if requested_symbols:
      warnings: list[str] = []
      items: list[dict[str, Any]] = []
      per_symbol_limit = max(1, int(limit))
      for symbol in sorted(requested_symbols):
        try:
          items.extend(self._api_symbol_events(symbol, per_symbol_limit))
        except Exception as error:
          warnings.append(f"{symbol}: API fetch failed ({error}).")
      items.sort(key=lambda item: str(item.get("event_at", "")), reverse=True)
      return {
        "provider": {"name": self.name, "ready": True, "fallback": False, "detail": "BioPharmCatalyst"},
        "items": items[: max(1, int(limit))],
        "warnings": warnings,
        "source_statuses": self.source_statuses(),
      }
    listing_html = self._listing_html()
    raw_items = parse_biopharmcatalyst_listing_html(
      listing_html,
      base_url="https://www.biopharmcatalyst.com",
      requested_symbols=requested_symbols or None,
      limit=max(1, int(limit)),
    )
    warnings: list[str] = []
    items: list[dict[str, Any]] = []
    for raw_item in raw_items:
      press_release_url = str(raw_item.get("press_release_url", "")).strip()
      if press_release_url:
        try:
          press_html = self._fetch_text(press_release_url)
          raw_item = dict(raw_item)
          raw_item["press_release_text"] = extract_press_release_text(press_html)
        except Exception as error:
          warnings.append(f"{raw_item.get('ticker') or raw_item.get('company')}: press-release fetch failed ({error}).")
      items.append(normalize_pharma_event(raw_item))
    return {
      "provider": {"name": self.name, "ready": True, "fallback": False, "detail": "BioPharmCatalyst"},
      "items": items,
      "warnings": warnings,
      "source_statuses": self.source_statuses(),
    }

  def source_statuses(self) -> dict[str, dict[str, Any]]:
    return {
      "biopharmcatalyst": {
        "name": self.name,
        "ready": self.ready,
        "fallback": False,
        "detail": self.check_ready()[1],
      }
    }


class CompositePharmaNewsProvider(PharmaNewsProvider):
  name = "pharma_news"

  def __init__(self, live_provider: BioPharmCatalystProvider, drughunter_provider: DrugHunterProvider) -> None:
    super().__init__(detail="BioPharmCatalyst live; DrugHunter WIP.")
    self.live_provider = live_provider
    self.drughunter_provider = drughunter_provider

  def _probe_ready(self) -> tuple[bool, str | None]:
    if self.live_provider.ready:
      return (True, "BioPharmCatalyst live; DrugHunter WIP.")
    return (False, self.live_provider.check_ready()[1])

  def source_statuses(self) -> dict[str, dict[str, Any]]:
    return {
      "biopharmcatalyst": {
        "name": self.live_provider.name,
        "ready": self.live_provider.ready,
        "fallback": getattr(self.live_provider, "is_fallback", False),
        "detail": self.live_provider.check_ready()[1],
      },
      "drughunter": {
        "name": self.drughunter_provider.name,
        "ready": self.drughunter_provider.ready,
        "fallback": False,
        "detail": self.drughunter_provider.check_ready()[1],
        "wip": True,
      },
    }

  def sync_recent_events(
    self,
    *,
    symbols: list[str],
    limit: int,
  ) -> dict[str, Any]:
    payload = self.live_provider.sync_recent_events(symbols=symbols, limit=limit)
    payload["provider"] = {
      "name": self.name,
      "ready": True,
      "fallback": False,
      "detail": "BioPharmCatalyst live; DrugHunter WIP.",
      "sources": self.source_statuses(),
    }
    payload["source_statuses"] = self.source_statuses()
    return payload


class LocalDossierNewsProvider(DossierNewsProvider):
  name = "dossier_news"

  def __init__(self) -> None:
    super().__init__(detail="Indexed CoreyDigs dossier store with primary-reference triangulation.")

  def _probe_ready(self) -> tuple[bool, str | None]:
    return (True, self.detail)

  def source_statuses(self) -> dict[str, dict[str, Any]]:
    return {
      "coreydigs": {
        "name": "coreydigs",
        "ready": True,
        "fallback": False,
        "detail": "Indexed CoreyDigs dossier corpus.",
      },
      "primary_triangulation": {
        "name": "primary_triangulation",
        "ready": True,
        "fallback": False,
        "detail": "Classifies SEC, court, and government or NGO references from dossier text.",
      },
    }


class EmbeddingProvider(ProviderBase):
  name = "embedding"
  size = 256

  def embed(self, text: str) -> list[float]:
    raise NotImplementedError

  def embed_many(self, texts: list[str]) -> list[list[float]]:
    return [self.embed(text) for text in texts]

  def count_tokens(self, text: str) -> int:
    return len([token for token in text.split() if token])


class UnavailableEmbeddingProvider(EmbeddingProvider):
  name = "embedding_unavailable"
  is_available = False

  def embed(self, text: str) -> list[float]:  # pragma: no cover - guarded by readiness checks
    raise RuntimeError(self.detail or "Embedding provider is unavailable.")


class HashEmbeddingProvider(EmbeddingProvider):
  name = "hash_fallback"
  is_fallback = True

  def __init__(self, size: int) -> None:
    super().__init__(detail="Development fallback embedding provider.")
    self.size = size

  def embed(self, text: str) -> list[float]:
    vector = [0.0] * self.size
    for token in text.lower().split():
      digest = hashlib.sha1(token.encode("utf-8")).digest()
      index = int.from_bytes(digest[:4], "big") % self.size
      vector[index] += 1.0
    norm = math.sqrt(sum(value * value for value in vector)) or 1.0
    return [value / norm for value in vector]

  def count_tokens(self, text: str) -> int:
    return len([token for token in text.split() if token])


class SentenceTransformerEmbeddingProvider(EmbeddingProvider):
  name = "sentence_transformers"

  def __init__(self, model_name: str, size_hint: int, cache_dir: Path) -> None:
    super().__init__(detail=model_name)
    self.model_name = model_name
    self.size = size_hint
    self.cache_dir = cache_dir
    self._model = None
    self._tokenizer = None

  def _load(self):
    if self._model is None:
      if SentenceTransformer is None:
        raise RuntimeError("sentence-transformers is not installed.")
      self.cache_dir.mkdir(parents=True, exist_ok=True)
      self._model = SentenceTransformer(self.model_name, cache_folder=str(self.cache_dir))
      self._tokenizer = getattr(self._model, "tokenizer", None)
      if self._tokenizer is None and hasattr(self._model, "_first_module"):
        module = self._model._first_module()
        self._tokenizer = getattr(module, "tokenizer", None)
    return self._model

  def _probe_ready(self) -> tuple[bool, str | None]:
    if SentenceTransformer is None:
      return (False, "sentence-transformers is not installed.")
    try:
      self.cache_dir.mkdir(parents=True, exist_ok=True)
    except Exception as error:
      return (False, str(error))
    return (True, self.model_name)

  def embed(self, text: str) -> list[float]:
    model = self._load()
    vector = model.encode(text)
    values = vector.tolist() if hasattr(vector, "tolist") else list(vector)
    self.size = len(values)
    return [float(value) for value in values]

  def embed_many(self, texts: list[str]) -> list[list[float]]:
    if not texts:
      return []
    model = self._load()
    vectors = model.encode(texts)
    values = vectors.tolist() if hasattr(vectors, "tolist") else list(vectors)
    if values and isinstance(values[0], list):
      self.size = len(values[0])
      return [[float(item) for item in vector] for vector in values]
    if values:
      self.size = len(values)
      return [[float(item) for item in values]]
    return []

  def provenance(self) -> dict[str, Any]:
    return {
      **super().provenance(),
      "model": self.model_name,
      "cache_dir": str(self.cache_dir),
    }

  def count_tokens(self, text: str) -> int:
    self._load()
    if self._tokenizer is None:
      return super().count_tokens(text)
    encoded = self._tokenizer(
      text,
      add_special_tokens=False,
      return_attention_mask=False,
      return_token_type_ids=False,
    )
    return len(encoded.get("input_ids", []))


class RemoteEmbeddingProvider(EmbeddingProvider):
  name = "remote_embedding"

  def __init__(self, base_url: str, api_key: str | None, model_name: str, timeout_seconds: float = 120.0) -> None:
    super().__init__(detail=model_name)
    self.base_url = str(base_url or "").rstrip("/")
    self.api_key = api_key
    self.model_name = model_name
    self.timeout_seconds = float(timeout_seconds)

  def _probe_ready(self) -> tuple[bool, str | None]:
    if httpx is None:
      return (False, "httpx is not available.")
    if not self.base_url:
      return (False, "Remote embedding URL is not configured.")
    try:
      health_url = self.base_url
      if health_url.endswith("/v1/embed"):
        health_url = health_url[: -len("/v1/embed")] + "/health"
      response = httpx.get(health_url, timeout=min(self.timeout_seconds, 5.0))
      response.raise_for_status()
      payload = response.json()
      if not bool(payload.get("embedding_ready")):
        return (False, str(payload.get("last_error") or "Remote embedding node is not ready."))
      return (True, self.model_name)
    except Exception as error:
      return (False, str(error))

  def _headers(self) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if self.api_key:
      headers["Authorization"] = f"Bearer {self.api_key}"
    return headers

  def _request_embeddings(self, texts: list[str]) -> list[list[float]]:
    if httpx is None:
      raise RuntimeError("httpx is not available.")
    payload = {
      "model": self.model_name,
      "texts": [str(text or "") for text in texts],
      "chunk_text": False,
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
      raise _classify_remote_error("remote_embedding", self.base_url, error) from error
    body = response.json()
    if isinstance(body.get("data"), dict):
      body = body["data"]
    embeddings = list(body.get("embeddings", []) or [])
    if not embeddings:
      raise RemoteServiceError("remote_embedding", "bad_payload", "Remote embedding response did not include embeddings.", retryable=False, node_url=self.base_url)
    vectors: list[list[float]] = []
    for item in embeddings:
      record = item if isinstance(item, dict) else {"vector": item}
      vector = record.get("vector")
      if not isinstance(vector, list) or not vector:
        raise RemoteServiceError("remote_embedding", "bad_payload", "Remote embedding response did not include a usable vector.", retryable=False, node_url=self.base_url)
      vectors.append([float(value) for value in vector])
    if vectors:
      self.size = len(vectors[0])
    return vectors

  def embed(self, text: str) -> list[float]:
    vectors = self._request_embeddings([text])
    if not vectors:
      raise RemoteServiceError("remote_embedding", "bad_payload", "Remote embedding response did not include a usable vector.", retryable=False, node_url=self.base_url)
    return vectors[0]

  def embed_many(self, texts: list[str]) -> list[list[float]]:
    if not texts:
      return []
    return self._request_embeddings(texts)

  def count_tokens(self, text: str) -> int:
    return len([token for token in str(text or "").split() if token])

  def provenance(self) -> dict[str, Any]:
    return {
      **super().provenance(),
      "location": "remote",
      "node_url": self.base_url,
      "model": self.model_name,
    }


class CompositeEmbeddingProvider(EmbeddingProvider):
  name = "composite_embedding"

  def __init__(self, primary: EmbeddingProvider, fallback: EmbeddingProvider) -> None:
    detail = f"{primary.name} -> {fallback.name}"
    super().__init__(detail=detail)
    self.primary = primary
    self.fallback = fallback
    self.size = getattr(primary, "size", getattr(fallback, "size", self.size))
    self.is_fallback = bool(getattr(primary, "is_fallback", False) or getattr(fallback, "is_fallback", False))

  def _probe_ready(self) -> tuple[bool, str | None]:
    if self.primary.ready or self.fallback.ready:
      return (True, self.detail)
    primary_detail = self.primary.check_ready()[1] or self.primary.name
    fallback_detail = self.fallback.check_ready()[1] or self.fallback.name
    return (False, f"{primary_detail}; {fallback_detail}")

  def _with_fallback(self, operation: str, func, *args):
    errors: list[str] = []
    if self.primary.ready:
      try:
        result = func(self.primary, *args)
        self.size = getattr(self.primary, "size", self.size)
        return result
      except Exception as error:
        errors.append(f"{self.primary.name}:{operation}_failed:{error}")
    if not self.fallback.ready:
      if errors:
        raise RuntimeError("; ".join(errors))
      raise RuntimeError("No embedding provider is ready.")
    result = func(self.fallback, *args)
    self.size = getattr(self.fallback, "size", self.size)
    return result

  def embed(self, text: str) -> list[float]:
    return self._with_fallback("embed", lambda provider, value: provider.embed(value), text)

  def embed_many(self, texts: list[str]) -> list[list[float]]:
    return self._with_fallback("embed_many", lambda provider, values: provider.embed_many(values), texts)

  def count_tokens(self, text: str) -> int:
    if self.primary.ready:
      try:
        return self.primary.count_tokens(text)
      except Exception:
        pass
    if self.fallback.ready:
      try:
        return self.fallback.count_tokens(text)
      except Exception:
        pass
    return super().count_tokens(text)

  def source_statuses(self) -> dict[str, dict[str, Any]]:
    return {
      "primary": {
        "name": self.primary.name,
        "ready": self.primary.ready,
        "fallback": getattr(self.primary, "is_fallback", False),
        "detail": self.primary.check_ready()[1],
      },
      "fallback": {
        "name": self.fallback.name,
        "ready": self.fallback.ready,
        "fallback": getattr(self.fallback, "is_fallback", False),
        "detail": self.fallback.check_ready()[1],
      },
    }

  def provenance(self) -> dict[str, Any]:
    selected = self.primary if self.primary.ready else self.fallback
    payload = dict(selected.provenance())
    payload["provider"] = self.name
    payload["route"] = self.detail
    payload["selected_provider"] = selected.name
    payload["sources"] = self.source_statuses()
    return payload


class Reranker(ProviderBase):
  name = "reranker"

  def score(self, query: str, passage: str) -> float:
    raise NotImplementedError


class UnavailableReranker(Reranker):
  name = "reranker_unavailable"
  is_available = False

  def score(self, query: str, passage: str) -> float:  # pragma: no cover - guarded by readiness checks
    raise RuntimeError(self.detail or "Reranker is unavailable.")


class LexicalReranker(Reranker):
  name = "lexical_fallback"
  is_fallback = True

  def __init__(self) -> None:
    super().__init__(detail="Development fallback reranker.")

  def score(self, query: str, passage: str) -> float:
    query_tokens = {token for token in query.lower().split() if token}
    passage_tokens = {token for token in passage.lower().split() if token}
    if not query_tokens or not passage_tokens:
      return 0.0
    return len(query_tokens & passage_tokens) / max(1, len(query_tokens))


class CrossEncoderReranker(Reranker):
  name = "cross_encoder"

  def __init__(self, model_name: str, cache_dir: Path) -> None:
    super().__init__(detail=model_name)
    self.model_name = model_name
    self.cache_dir = cache_dir
    self._model = None

  def _load(self):
    if self._model is None:
      if CrossEncoder is None:
        raise RuntimeError("sentence-transformers is not installed.")
      self.cache_dir.mkdir(parents=True, exist_ok=True)
      self._model = CrossEncoder(self.model_name, cache_folder=str(self.cache_dir))
    return self._model

  def _probe_ready(self) -> tuple[bool, str | None]:
    if CrossEncoder is None:
      return (False, "sentence-transformers is not installed.")
    try:
      self.cache_dir.mkdir(parents=True, exist_ok=True)
    except Exception as error:
      return (False, str(error))
    return (True, self.model_name)

  def score(self, query: str, passage: str) -> float:
    model = self._load()
    score = model.predict([(query, passage)])
    if hasattr(score, "tolist"):
      score = score.tolist()
    return float(score[0] if isinstance(score, (list, tuple)) else score)


class Reasoner(ProviderBase):
  name = "reasoner"

  def answer(self, query: str, mode: str, citations: list[dict[str, Any]], lens_payloads: dict[str, Any]) -> str | None:
    raise NotImplementedError

  def summarize(self, text: str, level: str) -> str | None:
    raise NotImplementedError


class UnavailableReasoner(Reasoner):
  name = "reasoner_unavailable"
  is_available = False

  def answer(self, query: str, mode: str, citations: list[dict[str, Any]], lens_payloads: dict[str, Any]) -> str | None:  # pragma: no cover - guarded
    raise RuntimeError(self.detail or "Reasoner is unavailable.")

  def summarize(self, text: str, level: str) -> str | None:  # pragma: no cover - guarded
    raise RuntimeError(self.detail or "Reasoner is unavailable.")


class FallbackReasoner(Reasoner):
  name = "fallback"
  is_fallback = True

  def __init__(self) -> None:
    super().__init__(detail="Development fallback reasoner.")

  def answer(self, query: str, mode: str, citations: list[dict[str, Any]], lens_payloads: dict[str, Any]) -> str | None:
    if not citations:
      return None
    if mode == "cross_book" and len(citations) >= 2:
      first = citations[0]
      second = citations[1]
      return (
        f"{first['document_title']} frames the issue through {first['quote'].lower()} "
        f"while {second['document_title']} shifts it toward {second['quote'].lower()} "
        "The current bundle supports a comparative reading grounded in cited evidence."
      )
    lead = citations[0]
    return (
      f"The strongest retrieved evidence comes from {lead['document_title']} on pages {lead['page_start']}-{lead['page_end']}. "
      f"It suggests that {lead['quote'].lower()} "
      "The other cited passages reinforce that interpretation."
    )

  def summarize(self, text: str, level: str) -> str | None:
    cleaned = " ".join(text.split())
    if not cleaned:
      return "No extractable text was available."
    return _trim_text(cleaned, max_words=110 if level == "book" else 80)


class OllamaReasoner(Reasoner):
  name = "ollama"

  def __init__(self, base_url: str, model_name: str, timeout_seconds: float = 30.0) -> None:
    super().__init__(detail=model_name)
    self.base_url = base_url.rstrip("/")
    self.model_name = model_name
    self.timeout_seconds = timeout_seconds

  def _probe_ready(self) -> tuple[bool, str | None]:
    if httpx is None:
      return (False, "httpx is not available.")
    try:
      response = httpx.get(f"{self.base_url}/api/tags", timeout=min(5.0, self.timeout_seconds))
      response.raise_for_status()
      return (True, self.model_name)
    except Exception as error:
      return (False, str(error))

  def _generate(self, prompt: str) -> str | None:
    if httpx is None:
      return None
    try:
      response = httpx.post(
        f"{self.base_url}/api/generate",
        json={"model": self.model_name, "prompt": prompt, "stream": False},
        timeout=self.timeout_seconds,
      )
      response.raise_for_status()
      payload = response.json()
      return payload.get("response", "").strip() or None
    except Exception:
      return None

  def answer(self, query: str, mode: str, citations: list[dict[str, Any]], lens_payloads: dict[str, Any]) -> str | None:
    if not citations:
      return None
    evidence = "\n".join(
      f"- {item['document_title']} pp.{item['page_start']}-{item['page_end']}: {item['quote']}"
      for item in citations[:8]
    )
    lens_summary = "\n".join(
      f"- {key}: {value.get('summary', '')}"
      for key, value in lens_payloads.items()
      if value.get("summary")
    )
    prompt = (
      "You are answering from a self-hosted semantic library. "
      "Use only the supplied evidence. If the evidence is weak, say so.\n\n"
      f"Query mode: {mode}\n"
      f"Question: {query}\n\n"
      f"Evidence:\n{evidence}\n\n"
      f"Formal lens notes:\n{lens_summary or '- none'}\n\n"
      "Write a concise synthesis with explicit grounding in the evidence."
    )
    return self._generate(prompt)

  def summarize(self, text: str, level: str) -> str | None:
    prompt = (
      "Summarize the following document text for retrieval. "
      "Keep it grounded, concise, and factual. "
      f"Summary level: {level}.\n\n"
      f"Text:\n{text[:12000]}"
    )
    return self._generate(prompt)


class RemoteChatReasoner(Reasoner):
  name = "remote_openai_compatible"

  def __init__(self, base_url: str, api_key: str, model_name: str, timeout_seconds: float = 30.0) -> None:
    super().__init__(detail=model_name)
    self.base_url = base_url.rstrip("/")
    self.api_key = api_key
    self.model_name = model_name
    self.timeout_seconds = timeout_seconds

  def _chat(self, system_prompt: str, user_prompt: str) -> str | None:
    if httpx is None:
      return None
    try:
      response = httpx.post(
        f"{self.base_url}/v1/chat/completions",
        headers={"Authorization": f"Bearer {self.api_key}"},
        json={
          "model": self.model_name,
          "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
          ],
        },
        timeout=self.timeout_seconds,
      )
      response.raise_for_status()
      payload = response.json()
      choices = payload.get("choices", [])
      if not choices:
        return None
      return choices[0].get("message", {}).get("content", "").strip() or None
    except Exception:
      return None

  def _probe_ready(self) -> tuple[bool, str | None]:
    if httpx is None:
      return (False, "httpx is not available.")
    if not self.base_url or not self.api_key:
      return (False, "Remote LLM configuration is incomplete.")
    return (True, self.model_name)

  def answer(self, query: str, mode: str, citations: list[dict[str, Any]], lens_payloads: dict[str, Any]) -> str | None:
    evidence = "\n".join(
      f"{item['document_title']} pp.{item['page_start']}-{item['page_end']}: {item['quote']}"
      for item in citations[:8]
    )
    return self._chat(
      "Answer only from provided evidence and cite uncertainty.",
      f"Question: {query}\nMode: {mode}\nEvidence:\n{evidence}",
    )

  def summarize(self, text: str, level: str) -> str | None:
    return self._chat(
      "You write concise grounded retrieval summaries.",
      f"Summary level: {level}\nText:\n{text[:12000]}",
    )


class OCRProvider(ProviderBase):
  name = "ocr"

  def ocr_image(self, path: Path) -> dict[str, Any]:
    raise NotImplementedError

  def get_pdf_page_count(self, pdf_path: Path) -> int | None:
    return None

  def ocr_pdf_page(self, pdf_path: Path, page_number: int) -> dict[str, Any] | None:
    return None


class UnavailableOCRProvider(OCRProvider):
  name = "ocr_unavailable"
  is_available = False

  def ocr_image(self, path: Path) -> dict[str, Any]:  # pragma: no cover - guarded
    raise RuntimeError(self.detail or "OCR provider is unavailable.")


class NullOCRProvider(OCRProvider):
  name = "none"
  is_fallback = True

  def __init__(self) -> None:
    super().__init__(detail="Development fallback OCR provider.")

  def ocr_image(self, path: Path) -> dict[str, Any]:
    return {"text": "", "confidence": 0.0, "warnings": ["ocr_unavailable"]}


class PaddleOCRProvider(OCRProvider):
  name = "paddleocr"

  def __init__(self, language: str = "en") -> None:
    super().__init__(detail=language)
    self.language = language
    self._ocr = None

  def _load(self):
    if self._ocr is None:
      paddle_ocr_cls = _get_paddleocr()
      if paddle_ocr_cls is None:
        raise RuntimeError("PaddleOCR is not installed.")
      self._ocr = paddle_ocr_cls(use_angle_cls=True, lang=self.language, enable_mkldnn=False)
    return self._ocr

  def _probe_ready(self) -> tuple[bool, str | None]:
    if _get_paddleocr() is None:
      return (False, "PaddleOCR is not installed.")
    if pdfium is None:
      return (False, "pypdfium2 is not installed.")
    return (True, self.language)

  def _ocr_input(self, image_input: Any) -> dict[str, Any]:
    ocr = self._load()
    result = ocr.ocr(image_input)
    lines = []
    scores = []
    for page_result in result or []:
      for line in page_result or []:
        if len(line) < 2:
          continue
        text = str(line[1][0]).strip()
        if text:
          lines.append(text)
          try:
            scores.append(float(line[1][1]))
          except Exception:
            pass
    confidence = sum(scores) / len(scores) if scores else 0.0
    return {"text": "\n".join(lines), "confidence": confidence, "warnings": []}

  def ocr_image(self, path: Path) -> dict[str, Any]:
    return self._ocr_input(str(path))

  def get_pdf_page_count(self, pdf_path: Path) -> int | None:
    if pdfium is None:
      return None
    document = pdfium.PdfDocument(str(pdf_path))
    return len(document)

  def ocr_pdf_page(self, pdf_path: Path, page_number: int) -> dict[str, Any] | None:
    if pdfium is None:
      return None
    document = pdfium.PdfDocument(str(pdf_path))
    if page_number < 1 or page_number > len(document):
      return None
    page = document[page_number - 1]
    bitmap = page.render(scale=2)
    image_input = None
    if hasattr(bitmap, "to_numpy") and np is not None:
      image_input = bitmap.to_numpy()
    elif hasattr(bitmap, "to_pil"):
      pil_image = bitmap.to_pil()
      with tempfile.NamedTemporaryFile(delete=False, suffix=".png") as handle:
        temp_path = Path(handle.name)
      try:
        pil_image.save(temp_path)
        image_input = str(temp_path)
        result = self._ocr_input(image_input)
      finally:
        try:
          temp_path.unlink(missing_ok=True)
        except Exception:
          pass
      return result
    if image_input is None:
      return None
    return self._ocr_input(image_input)


class RemoteOCRProvider(OCRProvider):
  name = "remote_ocr"
  is_fallback = True

  def __init__(self, base_url: str, api_key: str | None, model_name: str, timeout_seconds: float = 60.0) -> None:
    super().__init__(detail=model_name)
    self.base_url = str(base_url or "").rstrip("/")
    self.api_key = api_key
    self.model_name = model_name
    self.timeout_seconds = float(timeout_seconds)

  def _probe_ready(self) -> tuple[bool, str | None]:
    if httpx is None:
      return (False, "httpx is not available.")
    if not self.base_url:
      return (False, "Remote OCR URL is not configured.")
    try:
      health_url = self.base_url
      if health_url.endswith("/v1/ocr"):
        health_url = health_url[: -len("/v1/ocr")] + "/health"
      response = httpx.get(health_url, timeout=min(self.timeout_seconds, 5.0))
      response.raise_for_status()
      payload = response.json()
      providers_payload = dict(payload.get("providers") or {})
      ocr_payload = dict(providers_payload.get("ocr") or {})
      if payload.get("ready") is False or ocr_payload.get("ready") is False:
        return (False, str(ocr_payload.get("detail") or payload.get("status") or "Remote OCR node is not ready."))
      return (True, self.model_name)
    except Exception as error:
      return (False, str(error))

  def _headers(self) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if self.api_key:
      headers["Authorization"] = f"Bearer {self.api_key}"
    return headers

  def _request_ocr(self, *, image_bytes: bytes, file_name: str, mime_type: str, page_number: int | None = None) -> dict[str, Any]:
    if httpx is None:
      raise RuntimeError("httpx is not available.")
    payload = {
      "model": self.model_name,
      "file_name": file_name,
      "mime_type": mime_type,
      "page_number": page_number,
      "image_base64": base64.b64encode(image_bytes).decode("ascii"),
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
      raise _classify_remote_error("remote_ocr", self.base_url, error) from error
    body = response.json()
    if isinstance(body.get("data"), dict):
      body = body["data"]
    return {
      "text": str(body.get("text", "") or ""),
      "confidence": float(body.get("confidence", 0.0) or 0.0),
      "warnings": list(body.get("warnings", []) or []),
      "provider": self.name,
    }

  def provenance(self) -> dict[str, Any]:
    return {
      **super().provenance(),
      "location": "remote",
      "node_url": self.base_url,
      "model": self.model_name,
    }

  def _render_pdf_page_bytes(self, pdf_path: Path, page_number: int) -> bytes | None:
    if pdfium is None or page_number < 1:
      return None
    document = pdfium.PdfDocument(str(pdf_path))
    if page_number > len(document):
      return None
    page = document[page_number - 1]
    bitmap = page.render(scale=2)
    if hasattr(bitmap, "to_pil"):
      pil_image = bitmap.to_pil()
      buffer = io.BytesIO()
      pil_image.save(buffer, format="PNG")
      return buffer.getvalue()
    if hasattr(bitmap, "to_numpy") and np is not None and Image is not None:
      image = Image.fromarray(bitmap.to_numpy())
      buffer = io.BytesIO()
      image.save(buffer, format="PNG")
      return buffer.getvalue()
    return None

  def ocr_image(self, path: Path) -> dict[str, Any]:
    mime_type, _ = mimetypes.guess_type(path.name)
    return self._request_ocr(
      image_bytes=path.read_bytes(),
      file_name=path.name,
      mime_type=mime_type or "application/octet-stream",
    )

  def get_pdf_page_count(self, pdf_path: Path) -> int | None:
    if pdfium is None:
      return None
    document = pdfium.PdfDocument(str(pdf_path))
    return len(document)

  def ocr_pdf_page(self, pdf_path: Path, page_number: int) -> dict[str, Any] | None:
    page_bytes = self._render_pdf_page_bytes(pdf_path, page_number)
    if page_bytes is None:
      return None
    return self._request_ocr(
      image_bytes=page_bytes,
      file_name=f"{pdf_path.stem}-page-{page_number}.png",
      mime_type="image/png",
      page_number=page_number,
    )


class CompositeOCRProvider(OCRProvider):
  name = "composite_ocr"

  def __init__(self, primary: OCRProvider, fallback: OCRProvider) -> None:
    detail = f"{primary.name} -> {fallback.name}"
    super().__init__(detail=detail)
    self.primary = primary
    self.fallback = fallback
    self.is_fallback = bool(getattr(primary, "is_fallback", False) or getattr(fallback, "is_fallback", False))

  def _probe_ready(self) -> tuple[bool, str | None]:
    if self.primary.ready or self.fallback.ready:
      return (True, self.detail)
    primary_detail = self.primary.check_ready()[1] or self.primary.name
    fallback_detail = self.fallback.check_ready()[1] or self.fallback.name
    return (False, f"{primary_detail}; {fallback_detail}")

  def _with_fallback(self, operation: str, func, *args):
    warnings: list[str] = []
    if self.primary.ready:
      try:
        result = func(self.primary, *args)
        if isinstance(result, dict):
          result["warnings"] = list(result.get("warnings", []) or [])
          result["provider"] = result.get("provider") or self.primary.name
        return result
      except Exception as error:
        warnings.append(f"{self.primary.name}:{operation}_failed:{error}")
    if not self.fallback.ready:
      if warnings:
        raise RuntimeError("; ".join(warnings))
      raise RuntimeError("No OCR provider is ready.")
    result = func(self.fallback, *args)
    if isinstance(result, dict):
      result["warnings"] = [*warnings, *list(result.get("warnings", []) or [])]
      result["provider"] = result.get("provider") or self.fallback.name
    return result

  def ocr_image(self, path: Path) -> dict[str, Any]:
    return self._with_fallback("ocr_image", lambda provider, file_path: provider.ocr_image(file_path), path)

  def get_pdf_page_count(self, pdf_path: Path) -> int | None:
    if self.primary.ready:
      try:
        page_count = self.primary.get_pdf_page_count(pdf_path)
        if page_count is not None:
          return page_count
      except Exception:
        pass
    if self.fallback.ready:
      try:
        return self.fallback.get_pdf_page_count(pdf_path)
      except Exception:
        return None
    return None

  def ocr_pdf_page(self, pdf_path: Path, page_number: int) -> dict[str, Any] | None:
    return self._with_fallback(
      "ocr_pdf_page",
      lambda provider, file_path, page: provider.ocr_pdf_page(file_path, page),
      pdf_path,
      page_number,
    )

  def source_statuses(self) -> dict[str, dict[str, Any]]:
    return {
      "primary": {
        "name": self.primary.name,
        "ready": self.primary.ready,
        "fallback": getattr(self.primary, "is_fallback", False),
        "detail": self.primary.check_ready()[1],
      },
      "fallback": {
        "name": self.fallback.name,
        "ready": self.fallback.ready,
        "fallback": getattr(self.fallback, "is_fallback", False),
        "detail": self.fallback.check_ready()[1],
      },
    }

  def provenance(self) -> dict[str, Any]:
    selected = self.primary if self.primary.ready else self.fallback
    payload = dict(selected.provenance())
    payload["provider"] = self.name
    payload["route"] = self.detail
    payload["selected_provider"] = selected.name
    payload["sources"] = self.source_statuses()
    return payload


def build_embedding_provider(settings) -> EmbeddingProvider:
  remote_provider: EmbeddingProvider | None = None
  effective_remote_url = getattr(settings, "effective_remote_embedding_url", None)
  if getattr(settings, "use_remote_embedding", False) and effective_remote_url:
    remote_provider = RemoteEmbeddingProvider(
      effective_remote_url,
      settings.remote_embedding_api_key or settings.remote_ocr_api_key,
      settings.remote_embedding_model,
      settings.remote_embedding_timeout_seconds,
    )
  prefer_remote = bool(getattr(settings, "prefer_remote_embedding", False))
  if getattr(settings, "normalized_remote_compute_mode", "local_everything") in {
    "remote_ocr_remote_embeddings",
    "remote_ocr_remote_embeddings_remote_vector",
  }:
    prefer_remote = True
  if bool(getattr(settings, "remote_only_embedding", False)):
    if remote_provider is not None:
      return remote_provider
    if getattr(settings, "use_remote_embedding", False):
      missing = []
      if not effective_remote_url:
        missing.append("remote_embedding_url")
      if httpx is None:
        missing.append("httpx")
      return UnavailableEmbeddingProvider(
        f"Remote-only embeddings are enabled but unavailable: {', '.join(missing) or 'remote embedding backend is not ready'}"
      )

  primary: EmbeddingProvider | None = None
  if SentenceTransformer is not None:
    primary = SentenceTransformerEmbeddingProvider(settings.embedding_model, settings.vector_size, settings.resolved_model_cache_dir)
  elif settings.dev_fallbacks_enabled:
    primary = HashEmbeddingProvider(settings.vector_size)

  if primary is not None and remote_provider is not None:
    if prefer_remote:
      return CompositeEmbeddingProvider(remote_provider, primary)
    return CompositeEmbeddingProvider(primary, remote_provider)
  if primary is not None:
    return primary
  if remote_provider is not None:
    return remote_provider
  return UnavailableEmbeddingProvider("sentence-transformers is not installed.")


# Keep provider factories centralized so the engine can stay vendor-neutral and
# only depend on readiness, fallback, and method contracts.
def build_reranker(settings) -> Reranker:
  if CrossEncoder is not None:
    return CrossEncoderReranker(settings.reranker_model, settings.resolved_model_cache_dir)
  if settings.dev_fallbacks_enabled:
    return LexicalReranker()
  return UnavailableReranker("sentence-transformers cross-encoder is not installed.")


def build_reasoner(settings) -> Reasoner:
  if settings.remote_llm_url and settings.remote_llm_api_key:
    provider = RemoteChatReasoner(settings.remote_llm_url, settings.remote_llm_api_key, settings.ollama_model, settings.request_timeout_seconds * 2)
    if provider.ready:
      return provider
  if httpx is not None and settings.ollama_base_url:
    provider = OllamaReasoner(settings.ollama_base_url, settings.ollama_model, settings.request_timeout_seconds * 2)
    if provider.ready:
      return provider
    if settings.dev_fallbacks_enabled:
      return FallbackReasoner()
    return UnavailableReasoner(provider.check_ready()[1])
  if settings.dev_fallbacks_enabled:
    return FallbackReasoner()
  return UnavailableReasoner("No live reasoning provider is configured.")


def build_ocr_provider(settings) -> OCRProvider:
  remote_provider: OCRProvider | None = None
  if getattr(settings, "use_remote_ocr", False) and settings.remote_ocr_url:
    remote_provider = RemoteOCRProvider(
      settings.remote_ocr_url,
      settings.remote_ocr_api_key,
      settings.remote_ocr_model,
      settings.remote_ocr_timeout_seconds,
    )
  remote_only = bool(getattr(settings, "remote_only_ocr", False))
  if getattr(settings, "normalized_remote_compute_mode", "local_everything") in {
    "remote_ocr_only",
    "remote_ocr_remote_embeddings",
    "remote_ocr_remote_embeddings_remote_vector",
  }:
    remote_only = remote_only or False
  prefer_remote = bool(getattr(settings, "prefer_remote_ocr", False))
  if getattr(settings, "normalized_remote_compute_mode", "local_everything") in {
    "remote_ocr_only",
    "remote_ocr_remote_embeddings",
    "remote_ocr_remote_embeddings_remote_vector",
  }:
    prefer_remote = True
  if remote_only:
    if remote_provider is not None:
      return remote_provider
    if getattr(settings, "use_remote_ocr", False):
      missing = []
      if not settings.remote_ocr_url:
        missing.append("remote_ocr_url")
      if httpx is None:
        missing.append("httpx")
      return UnavailableOCRProvider(f"Remote-only OCR is enabled but unavailable: {', '.join(missing) or 'remote OCR backend is not ready'}")
  primary: OCRProvider | None = None
  if _get_paddleocr() is not None and pdfium is not None:
    primary = PaddleOCRProvider(settings.ocr_language)
  if primary is not None and remote_provider is not None:
    if prefer_remote:
      return CompositeOCRProvider(remote_provider, primary)
    return CompositeOCRProvider(primary, remote_provider)
  if primary is not None:
    return primary
  if remote_provider is not None:
    return remote_provider
  if settings.dev_fallbacks_enabled:
    return NullOCRProvider()
  missing = []
  if _get_paddleocr() is None:
    missing.append("PaddleOCR")
  if pdfium is None:
    missing.append("pypdfium2")
  if getattr(settings, "use_remote_ocr", False) and not settings.remote_ocr_url:
    missing.append("remote_ocr_url")
  return UnavailableOCRProvider(f"Missing OCR dependencies: {', '.join(missing)}.")


def build_market_data_provider(settings) -> MarketDataProvider:
  if yfinance is not None:
    provider = YFinanceMarketDataProvider()
    if provider.ready:
      return provider
    if settings.dev_fallbacks_enabled:
      return UnavailableMarketDataProvider(provider.check_ready()[1])
    return UnavailableMarketDataProvider(provider.check_ready()[1])
  return UnavailableMarketDataProvider("yfinance is not installed.")


def build_pharma_news_provider(settings) -> PharmaNewsProvider:
  if httpx is None:
    return UnavailablePharmaNewsProvider("httpx is not installed.")
  live_provider = BioPharmCatalystProvider()
  drughunter_provider = DrugHunterProvider()
  if live_provider.ready:
    return CompositePharmaNewsProvider(live_provider, drughunter_provider)
  return UnavailablePharmaNewsProvider(live_provider.check_ready()[1] or "BioPharmCatalyst is unavailable.")


def build_dossier_news_provider(settings) -> DossierNewsProvider:
  return LocalDossierNewsProvider()
