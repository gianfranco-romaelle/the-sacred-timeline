from __future__ import annotations

from typing import Any
from pathlib import Path

from app.market_analysis_runtime import analyze_market_bundle
from app.market_workbench_runtime import MarketWorkbenchRuntime
from app.pharma_event_topos_runtime import normalize_pharma_event


def _sample_bundle() -> dict[str, Any]:
  return {
    "provider": {"name": "fake_yfinance", "ready": True, "fallback": False, "detail": "mock"},
    "symbols": {
      "SPY": {
        "symbol": "SPY",
        "spot": 100.0,
        "history": [
          {"date": "2026-01-02T00:00:00Z", "close": 98.0, "adj_close": 98.0, "volume": 1000.0},
          {"date": "2026-01-03T00:00:00Z", "close": 99.5, "adj_close": 99.5, "volume": 1200.0},
          {"date": "2026-01-04T00:00:00Z", "close": 101.0, "adj_close": 101.0, "volume": 1400.0},
          {"date": "2026-01-05T00:00:00Z", "close": 100.5, "adj_close": 100.5, "volume": 1100.0},
          {"date": "2026-01-06T00:00:00Z", "close": 102.0, "adj_close": 102.0, "volume": 1500.0},
          {"date": "2026-01-07T00:00:00Z", "close": 103.0, "adj_close": 103.0, "volume": 1300.0},
          {"date": "2026-01-08T00:00:00Z", "close": 102.6, "adj_close": 102.6, "volume": 1250.0},
          {"date": "2026-01-09T00:00:00Z", "close": 104.4, "adj_close": 104.4, "volume": 1600.0},
          {"date": "2026-01-10T00:00:00Z", "close": 105.1, "adj_close": 105.1, "volume": 1550.0},
        ],
        "options": [
          {
            "expiry": "2026-02-20T00:00:00Z",
            "calls": [
              {"contractSymbol": "SPY260220C00100000", "strike": 100.0, "bid": 1.0, "ask": 1.2, "change": 0.1, "volume": 250.0, "impliedVolatility": 0.22},
              {"contractSymbol": "SPY260220C00105000", "strike": 105.0, "bid": 0.7, "ask": 0.9, "change": 0.05, "volume": 180.0, "impliedVolatility": 0.24},
            ],
            "puts": [
              {"contractSymbol": "SPY260220P00100000", "strike": 100.0, "bid": 1.1, "ask": 1.3, "change": -0.08, "volume": 210.0, "impliedVolatility": 0.23},
              {"contractSymbol": "SPY260220P00095000", "strike": 95.0, "bid": 0.8, "ask": 1.0, "change": -0.03, "volume": 170.0, "impliedVolatility": 0.25},
            ],
          },
          {
            "expiry": "2026-03-20T00:00:00Z",
            "calls": [
              {"contractSymbol": "SPY260320C00100000", "strike": 100.0, "bid": 1.5, "ask": 1.8, "change": 0.11, "volume": 260.0, "impliedVolatility": 0.21},
            ],
            "puts": [
              {"contractSymbol": "SPY260320P00100000", "strike": 100.0, "bid": 1.4, "ask": 1.7, "change": -0.06, "volume": 220.0, "impliedVolatility": 0.22},
            ],
          },
        ],
      },
      "QQQ": {
        "symbol": "QQQ",
        "spot": 200.0,
        "history": [
          {"date": "2026-01-02T00:00:00Z", "close": 198.0, "adj_close": 198.0, "volume": 900.0},
          {"date": "2026-01-03T00:00:00Z", "close": 199.0, "adj_close": 199.0, "volume": 950.0},
          {"date": "2026-01-04T00:00:00Z", "close": 201.5, "adj_close": 201.5, "volume": 1000.0},
          {"date": "2026-01-05T00:00:00Z", "close": 202.0, "adj_close": 202.0, "volume": 1020.0},
          {"date": "2026-01-06T00:00:00Z", "close": 203.0, "adj_close": 203.0, "volume": 1040.0},
          {"date": "2026-01-07T00:00:00Z", "close": 204.0, "adj_close": 204.0, "volume": 1060.0},
          {"date": "2026-01-08T00:00:00Z", "close": 203.4, "adj_close": 203.4, "volume": 1010.0},
          {"date": "2026-01-09T00:00:00Z", "close": 205.6, "adj_close": 205.6, "volume": 1090.0},
          {"date": "2026-01-10T00:00:00Z", "close": 206.2, "adj_close": 206.2, "volume": 1120.0},
        ],
        "options": [],
      },
    },
    "benchmark_symbol": "SPY",
    "benchmark": {
      "symbol": "SPY",
      "spot": 102.0,
      "history": [
        {"date": "2026-01-02T00:00:00Z", "close": 98.0, "adj_close": 98.0, "volume": 1000.0},
        {"date": "2026-01-03T00:00:00Z", "close": 99.5, "adj_close": 99.5, "volume": 1200.0},
        {"date": "2026-01-04T00:00:00Z", "close": 101.0, "adj_close": 101.0, "volume": 1400.0},
        {"date": "2026-01-05T00:00:00Z", "close": 100.5, "adj_close": 100.5, "volume": 1100.0},
        {"date": "2026-01-06T00:00:00Z", "close": 102.0, "adj_close": 102.0, "volume": 1500.0},
        {"date": "2026-01-07T00:00:00Z", "close": 103.0, "adj_close": 103.0, "volume": 1300.0},
        {"date": "2026-01-08T00:00:00Z", "close": 102.6, "adj_close": 102.6, "volume": 1250.0},
        {"date": "2026-01-09T00:00:00Z", "close": 104.4, "adj_close": 104.4, "volume": 1600.0},
        {"date": "2026-01-10T00:00:00Z", "close": 105.1, "adj_close": 105.1, "volume": 1550.0},
      ],
      "options": [],
    },
    "warnings": [],
  }


def _sample_request() -> dict[str, Any]:
  return {
    "symbols": ["SPY", "QQQ"],
    "benchmark_symbol": "SPY",
    "period": "6mo",
    "interval": "1d",
    "mode": "auto",
    "max_expiries": 2,
    "max_strikes_per_expiry": 2,
    "rolling_window": 4,
    "k_neighbors": 2,
    "risk_free_rate": 0.0,
  }


class _FakeMarketProvider:
  name = "fake_market"
  ready = True
  is_fallback = False

  def check_ready(self) -> tuple[bool, str]:
    return (True, "fake market ready")

  def fetch_market_bundle(self, **_: Any) -> dict[str, Any]:
    return _sample_bundle()


class _FakePharmaProvider:
  name = "fake_pharma"
  ready = True
  is_fallback = False

  def check_ready(self) -> tuple[bool, str]:
    return (True, "fake pharma ready")

  def source_statuses(self) -> dict[str, Any]:
    return {"biopharmcatalyst": {"ready": True, "detail": "fixture"}}

  def sync_recent_events(self, **_: Any) -> dict[str, Any]:
    return {
      "provider": {"name": self.name, "ready": True, "detail": "fixture", "fallback": False},
      "items": [
        {
          "ticker": "VRTX",
          "event_at": "2026-03-10T00:00:00Z",
          "event_type": "clinical",
          "title": "Positive Phase 3 data",
        }
      ],
      "warnings": [],
    }


def test_market_analysis_bundle_emits_green_identity_summary() -> None:
  result = analyze_market_bundle(_sample_bundle(), _sample_request())

  assert "green_identity" in result
  assert result["green_identity"]["aggregate"]["residual"] >= 0.0
  assert result["de_rham"]["aggregate"]["beta0"] >= 0
  assert result["temporal_regime"]["green_identity"]["laplacian_residual"] >= 0.0


def test_market_workbench_runtime_status_snapshot_and_greens() -> None:
  runtime = MarketWorkbenchRuntime(
    market_provider=_FakeMarketProvider(),
    pharma_provider=_FakePharmaProvider(),
  )

  status = runtime.status()
  greens = runtime.greens_report(_sample_request())
  snapshot = runtime.snapshot(_sample_request())

  assert status["providers"]["market_data"]["ready"] is True
  assert greens["summary"]["objective"]["value"] >= 0.0
  assert snapshot["pharma"]["count"] == 1
  assert snapshot["market"]["green_identity"]["aggregate"]["residual"] >= 0.0


def test_market_workbench_optimizer_improves_or_holds_loss() -> None:
  runtime = MarketWorkbenchRuntime(
    market_provider=_FakeMarketProvider(),
    pharma_provider=_FakePharmaProvider(),
  )

  result = runtime.optimize_market({**_sample_request(), "branch": "all", "max_sweeps": 2})

  assert result["optimization"]["best_loss"] <= result["optimization"]["starting_loss"] + 1e-9
  assert result["optimization"]["iteration_count"] >= 1
  assert set(result["best_parameter_record"]) == {"decWeight", "sl2Weight", "e8Weight", "potentialWeight", "baseDensity"}


def test_market_workbench_optimizer_writes_artifacts(tmp_path: Path) -> None:
  runtime = MarketWorkbenchRuntime(
    market_provider=_FakeMarketProvider(),
    pharma_provider=_FakePharmaProvider(),
    artifact_root=tmp_path,
  )

  result = runtime.optimize_market({**_sample_request(), "branch": "all", "max_sweeps": 1})
  artifacts = result["artifacts"]

  optimization_run = Path(artifacts["optimization_run"])
  latest_preset = Path(artifacts["latest_preset"])

  assert optimization_run.exists()
  assert latest_preset.exists()
  assert optimization_run.read_text(encoding="utf-8")
  assert '"best_parameter_record"' in latest_preset.read_text(encoding="utf-8")


def test_market_workbench_snapshot_writes_artifact_when_requested(tmp_path: Path) -> None:
  runtime = MarketWorkbenchRuntime(
    market_provider=_FakeMarketProvider(),
    pharma_provider=_FakePharmaProvider(),
    artifact_root=tmp_path,
  )

  result = runtime.snapshot({**_sample_request(), "branch": "all", "persist_artifact": True})

  snapshot_artifact = Path(result["artifacts"]["snapshot"])
  assert snapshot_artifact.exists()
  assert '"market"' in snapshot_artifact.read_text(encoding="utf-8")


def test_market_workbench_train_emits_metrics_and_artifacts(tmp_path: Path) -> None:
  runtime = MarketWorkbenchRuntime(
    market_provider=_FakeMarketProvider(),
    pharma_provider=_FakePharmaProvider(),
    artifact_root=tmp_path,
  )

  result = runtime.train_market(
    {
      **_sample_request(),
      "train_window": 2,
      "test_window": 1,
      "step_size": 1,
      "min_history": 4,
    }
  )

  assert result["dataset"]["row_count"] >= 2
  assert "ridge" in result["models"]
  assert "ridge_adaptive" in result["models"]
  assert "green_rule" in result["models"]
  assert result["winner"] in {"ridge", "ridge_adaptive", "green_rule"}
  assert all("ridge_adaptive_metrics" in fold for fold in result["folds"])
  assert Path(result["artifacts"]["training_run"]).exists()
  assert Path(result["artifacts"]["latest_training"]).exists()


def test_market_workbench_train_scan_returns_best_window(tmp_path: Path) -> None:
  runtime = MarketWorkbenchRuntime(
    market_provider=_FakeMarketProvider(),
    pharma_provider=_FakePharmaProvider(),
    artifact_root=tmp_path,
  )

  result = runtime.train_scan(
    {
      **_sample_request(),
      "rolling_window": 3,
      "train_windows": [2, 3],
      "test_window": 1,
      "step_size": 1,
      "min_history": 4,
    }
  )

  assert len(result["runs"]) == 2
  assert result["best"]["train_window"] in {2, 3}
  assert all("ridge_adaptive" in run for run in result["runs"])


def test_normalize_pharma_event_infers_event_type_and_phase_from_text() -> None:
  payload = normalize_pharma_event(
    {
      "source": "biopharmcatalyst",
      "ticker": "VRTX",
      "title": "Vertex Announces Positive Phase 3 Trial Results in IgA Nephropathy",
      "summary": "The study met its primary endpoint and supports a future BLA filing.",
      "press_release_text": "Positive Phase 3 data with statistically significant endpoint improvement.",
      "event_type": "",
      "trial_phase": "",
      "indication": "",
    }
  )

  assert payload["event_type"] in {"clinical", "regulatory"}
  assert payload["trial_phase"] == "Phase 3"


def test_normalize_pharma_event_prefers_corporate_headline_over_pipeline_body() -> None:
  payload = normalize_pharma_event(
    {
      "source": "biopharmcatalyst",
      "ticker": "MRNA",
      "title": "Moderna to Present at Upcoming Investor Conferences in March 2026",
      "summary": "Management will participate in upcoming investor conferences and business updates.",
      "press_release_text": "The company also highlighted ongoing clinical programs across multiple Phase 3 trials.",
      "event_type": "",
      "trial_phase": "",
      "indication": "",
    }
  )

  assert payload["event_type"] == "corporate"


def test_normalize_pharma_event_detects_regulatory_committee_language() -> None:
  payload = normalize_pharma_event(
    {
      "source": "biopharmcatalyst",
      "ticker": "MRNA",
      "title": "European Medicines Agency's Committee for Medicinal Products for Human Use Issues Positive Opinion",
      "summary": "The opinion supports a marketing authorization pathway.",
      "press_release_text": "",
      "event_type": "",
      "trial_phase": "",
      "indication": "",
    }
  )

  assert payload["event_type"] == "regulatory"


def test_normalize_pharma_event_prefers_infectious_disease_for_vaccine_review() -> None:
  payload = normalize_pharma_event(
    {
      "source": "biopharmcatalyst",
      "ticker": "MRNA",
      "title": "Moderna Announces the FDA Will Initiate the Review of Its Investigational Seasonal Influenza Vaccine Submission",
      "summary": "The BLA review advances the seasonal flu vaccine candidate.",
      "press_release_text": "Moderna develops vaccines and therapeutics across infectious diseases, cancer, and rare diseases.",
      "event_type": "",
      "trial_phase": "",
      "indication": "",
    }
  )

  assert payload["indication"] == "infectious disease"
