from __future__ import annotations

from app.citations import CitationInput, normalize_citation
from app.citations.providers import (
  AcquisitionQuery,
  InternetArchiveProvider,
  LibraryGenesisProvider,
  LookupContext,
  MemoryLookupCacheBackend,
  SciHubProvider,
)


class FakeTransport:
  def __init__(self, responses):
    self.responses = responses
    self.calls = []

  def fetch(self, provider_name, strategy):
    self.calls.append((provider_name, strategy.strategy_name, strategy.query_text))
    key = (provider_name, strategy.strategy_name)
    return dict(self.responses.get(key, {"ok": True, "results": []}))


def _query_from_text(text: str) -> AcquisitionQuery:
  record = normalize_citation(CitationInput(original_text=text))
  return AcquisitionQuery.from_normalized(record)


def test_scihub_dry_run_prefers_identifier_first():
  query = _query_from_text(
    'Smith, John. 2018. "On Ether Drift." Journal of Curious Physics. doi:10.1234/example'
  )
  provider = SciHubProvider()

  result = provider.lookup(query, context=LookupContext(dry_run=True))

  assert result.dry_run is True
  assert len(result.attempts) >= 1
  assert result.attempts[0].strategy_name == "identifier:doi"
  assert all(attempt.status == "planned" for attempt in result.attempts)


def test_libgen_uses_cache_before_transport():
  query = _query_from_text(
    "Bishop, Christopher M. 2006. Pattern Recognition and Machine Learning. ISBN 9780387310732."
  )
  cache = MemoryLookupCacheBackend()
  provider = LibraryGenesisProvider(cache_backend=cache)
  planned = provider.build_query_plan(query)
  cache.set(
    planned[0].cache_key,
    {
      "ok": True,
      "results": [
        {
          "id": "libgen-1",
          "title": "Pattern Recognition and Machine Learning",
          "authors": ["Bishop, Christopher M."],
          "year": "2006",
          "isbn13": "9780387310732",
        }
      ],
    },
    ttl_seconds=300,
  )
  transport = FakeTransport({})

  result = provider.lookup(query, context=LookupContext(dry_run=False), transport=transport)

  assert len(transport.calls) == 0
  assert result.attempts[0].cache_hit is True
  assert result.candidates[0].candidate_score >= 0.9
  assert any(flag.code == "mirror_variability" for flag in result.candidates[0].risk_flags)


def test_internet_archive_falls_back_to_exact_then_fuzzy():
  query = _query_from_text(
    "Latour, Bruno. 1987. Science in Action. Cambridge, MA: Harvard University Press."
  )
  provider = InternetArchiveProvider()

  plan = provider.build_query_plan(query)

  assert [item.strategy_name for item in plan] == ["exact_title_author", "fuzzy_title_author"]


def test_provider_parses_candidates_and_scores_conservatively():
  query = _query_from_text(
    "Whitehead, Alfred North. 1929. Process and Reality. New York: Macmillan. ISBN 9780029351801."
  )
  transport = FakeTransport(
    {
      ("internet_archive", "identifier:isbn13"): {
        "ok": True,
        "docs": [
          {
            "identifier": "processreality1929",
            "title": "Process and Reality",
            "authors": ["Whitehead, Alfred North"],
            "year": "1929",
            "isbn13": "9780029351801",
            "availability": "borrowable",
          },
          {
            "identifier": "processreality1978",
            "title": "Process and Reality",
            "authors": ["Whitehead, Alfred North"],
            "year": "1978",
            "isbn13": "9780029352105",
            "availability": "borrowable",
          },
        ],
      }
    }
  )
  provider = InternetArchiveProvider()

  result = provider.lookup(query, context=LookupContext(dry_run=False), transport=transport)

  assert len(result.candidates) == 2
  assert result.candidates[0].provider_record_id == "processreality1929"
  assert result.candidates[0].candidate_score > result.candidates[1].candidate_score
  assert any(flag.code == "borrow_required" for flag in result.candidates[0].risk_flags)
  assert any(flag.code == "probable_wrong_edition_collision" for flag in result.candidates[1].risk_flags)


def test_retryable_provider_error_is_recorded_without_looping():
  query = _query_from_text(
    'Smith, John. 2018. "On Ether Drift." Journal of Curious Physics. doi:10.1234/example'
  )
  transport = FakeTransport(
    {
      ("scihub", "identifier:doi"): {
        "ok": False,
        "status_code": 429,
        "retryable": True,
        "error": "rate_limited",
        "results": [],
      }
    }
  )
  provider = SciHubProvider()

  result = provider.lookup(query, context=LookupContext(dry_run=False), transport=transport)

  assert len(transport.calls) == provider.retry_policy.max_attempts
  assert result.attempts[0].retryable is True
  assert result.attempts[0].status == "failed"
  assert "rate_limited" in result.attempts[0].warnings
