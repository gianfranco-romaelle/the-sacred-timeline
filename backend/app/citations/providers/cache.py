from __future__ import annotations

import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class CachePolicy:
  enabled: bool = True
  ttl_seconds: float = 900.0
  max_entries: int = 512


@dataclass(slots=True)
class CacheEntry:
  key: str
  value: dict[str, Any]
  created_monotonic: float
  expires_monotonic: float
  metadata: dict[str, Any] = field(default_factory=dict)


class LookupCacheBackend(ABC):
  @abstractmethod
  def get(self, key: str) -> dict[str, Any] | None:
    raise NotImplementedError

  @abstractmethod
  def set(self, key: str, value: dict[str, Any], *, ttl_seconds: float, metadata: dict[str, Any] | None = None) -> None:
    raise NotImplementedError


class MemoryLookupCacheBackend(LookupCacheBackend):
  def __init__(self, max_entries: int = 512) -> None:
    self.max_entries = max(int(max_entries), 1)
    self._items: dict[str, CacheEntry] = {}

  def get(self, key: str) -> dict[str, Any] | None:
    entry = self._items.get(key)
    if entry is None:
      return None
    if entry.expires_monotonic <= time.monotonic():
      self._items.pop(key, None)
      return None
    return dict(entry.value)

  def set(self, key: str, value: dict[str, Any], *, ttl_seconds: float, metadata: dict[str, Any] | None = None) -> None:
    now = time.monotonic()
    if len(self._items) >= self.max_entries:
      oldest_key = min(self._items.items(), key=lambda item: item[1].created_monotonic)[0]
      self._items.pop(oldest_key, None)
    self._items[key] = CacheEntry(
      key=key,
      value=dict(value),
      created_monotonic=now,
      expires_monotonic=now + max(float(ttl_seconds), 0.0),
      metadata=dict(metadata or {}),
    )
