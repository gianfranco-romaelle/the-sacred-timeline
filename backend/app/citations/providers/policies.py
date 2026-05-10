from __future__ import annotations

import time
from dataclasses import dataclass


@dataclass(slots=True)
class RateLimitPolicy:
  min_interval_seconds: float = 3.0
  max_queries_per_lookup: int = 3
  burst_size: int = 1


@dataclass(slots=True)
class RetryPolicy:
  max_attempts: int = 2
  retryable_statuses: tuple[int, ...] = (408, 429, 500, 502, 503, 504)
  backoff_seconds: tuple[float, ...] = (3.0, 8.0)


@dataclass(slots=True)
class LookupContext:
  dry_run: bool = False
  max_candidates: int = 10
  enforce_waits: bool = False
  request_timeout_seconds: float = 20.0


class RuntimeHooks:
  def on_cache_hit(self, provider_name: str, cache_key: str) -> None:
    return None

  def on_cache_store(self, provider_name: str, cache_key: str) -> None:
    return None

  def on_rate_limit_wait(self, provider_name: str, seconds: float, strategy_name: str, *, dry_run: bool) -> None:
    return None

  def on_retry_scheduled(self, provider_name: str, strategy_name: str, attempt_number: int, delay_seconds: float) -> None:
    return None


class ProviderClock:
  def monotonic(self) -> float:
    return time.monotonic()

  def sleep(self, seconds: float) -> None:
    time.sleep(seconds)
