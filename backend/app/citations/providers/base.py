from __future__ import annotations

import hashlib
from abc import ABC, abstractmethod
from typing import Any

from ..text_utils import match_text, slug_text
from .cache import CachePolicy, LookupCacheBackend, MemoryLookupCacheBackend
from .models import (
  AcquisitionQuery,
  ProviderAttemptLog,
  ProviderCandidate,
  ProviderLookupResult,
  ProviderQueryStrategy,
  ProviderRiskFlag,
  ProviderTransport,
)
from .policies import LookupContext, ProviderClock, RateLimitPolicy, RetryPolicy, RuntimeHooks


class CitationLookupProviderBase(ABC):
  name = "citation_provider"
  detail = "stub"
  supported_identifier_types: tuple[str, ...] = ()
  provider_risk_codes: tuple[str, ...] = ()

  def __init__(
    self,
    *,
    cache_backend: LookupCacheBackend | None = None,
    cache_policy: CachePolicy | None = None,
    rate_limit_policy: RateLimitPolicy | None = None,
    retry_policy: RetryPolicy | None = None,
    hooks: RuntimeHooks | None = None,
    clock: ProviderClock | None = None,
  ) -> None:
    self.cache_backend = cache_backend or MemoryLookupCacheBackend()
    self.cache_policy = cache_policy or CachePolicy()
    self.rate_limit = rate_limit_policy or RateLimitPolicy()
    self.retry_policy = retry_policy or RetryPolicy()
    self.hooks = hooks or RuntimeHooks()
    self.clock = clock or ProviderClock()
    self._last_request_at: float | None = None

  def check_ready(self) -> tuple[bool, str | None]:
    return (True, self.detail)

  def build_query_plan(self, query: AcquisitionQuery) -> list[ProviderQueryStrategy]:
    strategies: list[ProviderQueryStrategy] = []
    for identifier_type, value in query.identifier_values():
      if identifier_type not in self.supported_identifier_types:
        continue
      strategies.append(
        self._make_strategy(
          strategy_name=f"identifier:{identifier_type}",
          strategy_stage="identifier_first",
          query_text=value,
          params={"identifier_type": identifier_type, "identifier_value": value},
          priority=10,
        )
      )
    exact = self.build_exact_query(query)
    if exact:
      strategies.append(
        self._make_strategy(
          strategy_name="exact_title_author",
          strategy_stage="exact",
          query_text=exact,
          params={"mode": "exact"},
          priority=50,
        )
      )
    fuzzy = self.build_fuzzy_query(query)
    if fuzzy and fuzzy != exact:
      strategies.append(
        self._make_strategy(
          strategy_name="fuzzy_title_author",
          strategy_stage="fuzzy",
          query_text=fuzzy,
          params={"mode": "fuzzy"},
          priority=90,
        )
      )
    return strategies[: max(int(self.rate_limit.max_queries_per_lookup), 1)]

  def lookup(
    self,
    query: AcquisitionQuery,
    *,
    context: LookupContext | None = None,
    transport: ProviderTransport | None = None,
  ) -> ProviderLookupResult:
    runtime = context or LookupContext()
    plan = self.build_query_plan(query)
    result = ProviderLookupResult(provider_name=self.name, query_id=query.id, dry_run=runtime.dry_run)
    if runtime.dry_run:
      result.attempts = [
        ProviderAttemptLog(
          provider_name=self.name,
          strategy_name=item.strategy_name,
          strategy_stage=item.strategy_stage,
          query_text=item.query_text,
          cache_key=item.cache_key,
          status="planned",
          warnings=[item.dry_run_note or "dry_run"],
        )
        for item in plan
      ]
      return result

    if transport is None:
      result.warnings.append("no_transport_configured")
      result.attempts = [
        ProviderAttemptLog(
          provider_name=self.name,
          strategy_name=item.strategy_name,
          strategy_stage=item.strategy_stage,
          query_text=item.query_text,
          cache_key=item.cache_key,
          status="skipped",
          warnings=["no_transport_configured"],
        )
        for item in plan
      ]
      return result

    for strategy in plan:
      attempt = ProviderAttemptLog(
        provider_name=self.name,
        strategy_name=strategy.strategy_name,
        strategy_stage=strategy.strategy_stage,
        query_text=strategy.query_text,
        cache_key=strategy.cache_key,
      )
      cached = self._cache_get(strategy.cache_key)
      if cached is not None:
        attempt.cache_hit = True
        attempt.status = "completed"
        attempt.raw_response = cached
        self.hooks.on_cache_hit(self.name, strategy.cache_key)
        parsed = self.parse_candidates(cached, strategy, query)
      else:
        self._respect_rate_limit(strategy, runtime)
        raw_payload = self._fetch_with_retry(transport, strategy, attempt)
        attempt.raw_response = raw_payload
        parsed = self.parse_candidates(raw_payload, strategy, query)
        if self.cache_policy.enabled and raw_payload:
          self.cache_backend.set(
            strategy.cache_key,
            raw_payload,
            ttl_seconds=self.cache_policy.ttl_seconds,
            metadata={"provider": self.name, "strategy": strategy.strategy_name},
          )
          self.hooks.on_cache_store(self.name, strategy.cache_key)

      scored = [self.score_candidate(candidate, query) for candidate in parsed]
      result.attempts.append(attempt)
      result.candidates.extend(scored[: runtime.max_candidates])
      if attempt.status == "failed" and attempt.retryable:
        result.warnings.append(f"{strategy.strategy_name}:retryable_failure")
        break
      if any(candidate.candidate_score >= 0.9 for candidate in scored):
        break

    result.candidates.sort(key=lambda item: item.candidate_score, reverse=True)
    result.candidates = result.candidates[: runtime.max_candidates]
    return result

  def build_exact_query(self, query: AcquisitionQuery) -> str | None:
    if not query.title:
      return None
    author = query.authors[0] if query.authors else None
    parts = [query.title]
    if author:
      parts.append(author)
    if query.year:
      parts.append(query.year)
    return " ".join(part for part in parts if part)

  def build_fuzzy_query(self, query: AcquisitionQuery) -> str | None:
    if not query.title:
      return None
    title = match_text(query.title)
    author = slug_text(query.authors[0]).replace("-", " ") if query.authors else ""
    parts = [title]
    if author:
      parts.append(author)
    return " ".join(part for part in parts if part).strip() or None

  def score_candidate(self, candidate: ProviderCandidate, query: AcquisitionQuery) -> ProviderCandidate:
    score = 0.1
    ranking_basis: list[str] = []
    shared_identifier = False
    for identifier_type, value in query.identifier_values():
      candidate_value = str(candidate.identifiers.get(identifier_type) or "")
      if candidate_value and candidate_value.lower() == value.lower():
        score += 0.62
        shared_identifier = True
        ranking_basis.append(f"shared_{identifier_type}")
        break

    title_score = self._similarity(candidate.title, query.title)
    author_score = self._author_similarity(candidate.authors, query.authors)
    score += title_score * 0.18
    score += author_score * 0.07
    if query.year and candidate.year:
      if query.year == candidate.year:
        score += 0.05
        ranking_basis.append("year_match")
      else:
        try:
          if abs(int(query.year) - int(candidate.year)) >= 8 and not shared_identifier:
            score -= 0.18
            candidate.risk_flags.append(
              ProviderRiskFlag(
                code="probable_wrong_edition_collision",
                severity="warning",
                message="Year gap suggests a different edition or manifestation.",
              )
            )
        except ValueError:
          pass
    if title_score >= 0.9:
      ranking_basis.append("strong_title_match")
    if author_score >= 0.9:
      ranking_basis.append("strong_author_match")
    candidate.candidate_score = round(max(0.0, min(0.99, score)), 3)
    candidate.ranking_basis = sorted(set(candidate.ranking_basis + ranking_basis))
    candidate.risk_flags.extend(self.provider_risk_flags(candidate))
    candidate.risk_flags = self._dedupe_risk_flags(candidate.risk_flags)
    return candidate

  def provider_risk_flags(self, candidate: ProviderCandidate) -> list[ProviderRiskFlag]:
    return []

  @abstractmethod
  def parse_candidates(
    self,
    raw_payload: dict[str, Any],
    strategy: ProviderQueryStrategy,
    query: AcquisitionQuery,
  ) -> list[ProviderCandidate]:
    raise NotImplementedError

  def _make_strategy(
    self,
    *,
    strategy_name: str,
    strategy_stage: str,
    query_text: str,
    params: dict[str, Any] | None = None,
    priority: int,
  ) -> ProviderQueryStrategy:
    cache_key = hashlib.sha1(
      f"{self.name}|{strategy_name}|{query_text}|{params or {}}".encode("utf-8", errors="ignore")
    ).hexdigest()
    return ProviderQueryStrategy(
      provider_name=self.name,
      strategy_name=strategy_name,
      strategy_stage=strategy_stage,
      query_text=query_text,
      params=dict(params or {}),
      cache_key=cache_key,
      priority=priority,
      dry_run_note=f"plan:{strategy_name}",
    )

  def _cache_get(self, key: str) -> dict[str, Any] | None:
    if not self.cache_policy.enabled:
      return None
    return self.cache_backend.get(key)

  def _respect_rate_limit(self, strategy: ProviderQueryStrategy, context: LookupContext) -> None:
    if self._last_request_at is None:
      return
    now = self.clock.monotonic()
    delta = now - self._last_request_at
    wait_seconds = max(self.rate_limit.min_interval_seconds - delta, 0.0)
    if wait_seconds <= 0:
      return
    self.hooks.on_rate_limit_wait(self.name, wait_seconds, strategy.strategy_name, dry_run=context.dry_run)
    if context.enforce_waits and not context.dry_run:
      self.clock.sleep(wait_seconds)

  def _fetch_with_retry(
    self,
    transport: ProviderTransport,
    strategy: ProviderQueryStrategy,
    attempt: ProviderAttemptLog,
  ) -> dict[str, Any]:
    for attempt_number in range(1, max(self.retry_policy.max_attempts, 1) + 1):
      payload = dict(transport.fetch(self.name, strategy) or {})
      attempt.http_status = payload.get("status_code")
      self._last_request_at = self.clock.monotonic()
      retryable = bool(payload.get("retryable")) or int(payload.get("status_code") or 200) in self.retry_policy.retryable_statuses
      if payload.get("ok", True) or not retryable or attempt_number >= self.retry_policy.max_attempts:
        attempt.status = "completed" if payload.get("ok", True) else "failed"
        attempt.retryable = retryable
        if not payload.get("ok", True):
          attempt.warnings.append(payload.get("error") or "provider_request_failed")
        return payload
      delay = self.retry_policy.backoff_seconds[min(attempt_number - 1, len(self.retry_policy.backoff_seconds) - 1)]
      self.hooks.on_retry_scheduled(self.name, strategy.strategy_name, attempt_number, delay)
      attempt.retryable = True
    return {"ok": False, "error": "unreachable_retry_state"}

  def _similarity(self, left: str | None, right: str | None) -> float:
    left_tokens = set(match_text(left or "").split())
    right_tokens = set(match_text(right or "").split())
    if not left_tokens or not right_tokens:
      return 0.0
    return len(left_tokens & right_tokens) / max(len(left_tokens | right_tokens), 1)

  def _author_similarity(self, left: list[str], right: list[str]) -> float:
    left_keys = {slug_text(item).split("-")[-1] for item in left if slug_text(item)}
    right_keys = {slug_text(item).split("-")[-1] for item in right if slug_text(item)}
    if not left_keys or not right_keys:
      return 0.0
    return len(left_keys & right_keys) / max(len(left_keys | right_keys), 1)

  def _dedupe_risk_flags(self, flags: list[ProviderRiskFlag]) -> list[ProviderRiskFlag]:
    seen: set[tuple[str, str]] = set()
    deduped: list[ProviderRiskFlag] = []
    for flag in flags:
      key = (flag.code, flag.message)
      if key in seen:
        continue
      seen.add(key)
      deduped.append(flag)
    return deduped
