from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4

from fastapi.testclient import TestClient

from app import main as main_module
from app import repository
from app.database import database_session, initialize_database
from app.engine import LibraryEngine
from app.providers import UnavailableReasoner


def build_fake_market_bundle():
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
      ],
      "options": [],
    },
    "warnings": [],
  }


def test_default_local_account_can_login(isolated_client):
  client = isolated_client

  login_response = client.post(
    "/api/auth/login",
    json={
      "username": "librarian",
      "password": "library",
    },
  )
  assert login_response.status_code == 200
  payload = login_response.json()
  assert payload["user"]["username"] == "librarian"
  assert payload["mode"] == "live"


def test_system_status_reports_runtime_mode(isolated_client):
  client = isolated_client

  response = client.get("/api/system/status")

  assert response.status_code == 200
  payload = response.json()
  assert payload["runtime_mode"] == "dev"
  assert payload["dev_fallbacks_enabled"] is True
  assert "providers" in payload
  assert "market_data" in payload["providers"]
  assert "pharma_news" in payload["providers"]
  assert "dossier_news" in payload["providers"]


def test_market_analysis_endpoint_returns_green_triad(isolated_client, monkeypatch):
  client = isolated_client
  username = f"market-{uuid4().hex[:8]}"

  register_response = client.post(
    "/api/auth/register",
    json={
      "username": username,
      "display_name": "Market Tester",
      "password": "library-pass",
    },
  )
  assert register_response.status_code == 200

  class FakeMarketProvider:
    name = "fake_yfinance"
    is_fallback = False
    ready = True

    def check_ready(self):
      return (True, "mock")

    def fetch_market_bundle(self, **_kwargs):
      return build_fake_market_bundle()

  monkeypatch.setattr(main_module.engine, "market_data_provider", FakeMarketProvider())

  response = client.post(
    "/api/market/analysis",
    json={
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
    },
  )

  assert response.status_code == 200
  payload = response.json()
  assert payload["provider"]["name"] == "fake_yfinance"
  assert payload["options_surface"]["vertex_count"] > 0
  assert payload["temporal_regime"]["vertex_count"] > 0
  assert payload["cross_symbol"]["vertex_count"] == 2
  assert payload["thermodynamics"]["aggregate"]["partition_function"] > 0.0


def test_market_analysis_returns_503_when_provider_is_unavailable(isolated_client, monkeypatch):
  client = isolated_client
  username = f"market-offline-{uuid4().hex[:8]}"

  register_response = client.post(
    "/api/auth/register",
    json={
      "username": username,
      "display_name": "Offline Market Tester",
      "password": "library-pass",
    },
  )
  assert register_response.status_code == 200

  class OfflineMarketProvider:
    name = "market_data_unavailable"
    is_fallback = False
    ready = False

    def check_ready(self):
      return (False, "yfinance is not installed.")

  monkeypatch.setattr(main_module.engine, "market_data_provider", OfflineMarketProvider())

  response = client.post(
    "/api/market/analysis",
    json={
      "symbols": ["SPY"],
      "benchmark_symbol": "SPY",
    },
  )

  assert response.status_code == 503
  detail = response.json()["detail"]
  assert detail["code"] == "market_data_provider_unavailable"


def test_pharma_sync_and_cycle_endpoints_work(isolated_client, monkeypatch):
  client = isolated_client
  username = f"pharma-{uuid4().hex[:8]}"

  register_response = client.post(
    "/api/auth/register",
    json={
      "username": username,
      "display_name": "Pharma Tester",
      "password": "library-pass",
    },
  )
  assert register_response.status_code == 200

  class FakePharmaProvider:
    name = "pharma_news"
    is_fallback = False
    ready = True

    def check_ready(self):
      return (True, "BioPharmCatalyst live; DrugHunter WIP.")

    def source_statuses(self):
      return {
        "biopharmcatalyst": {"name": "biopharmcatalyst", "ready": True, "fallback": False, "detail": "mock"},
        "drughunter": {"name": "drughunter", "ready": False, "fallback": False, "detail": "WIP", "wip": True},
      }

    def sync_recent_events(self, **_kwargs):
      return {
        "provider": {"name": "pharma_news", "ready": True, "fallback": False, "detail": "mock", "sources": self.source_statuses()},
        "items": [
          {
            "source": "biopharmcatalyst",
            "external_id": "evt-1",
            "ticker": "VRTX",
            "company": "Vertex Pharmaceuticals",
            "event_at": "2026-03-05T12:30:00Z",
            "title": "Vertex reports positive Phase 3 data",
            "summary": "Positive Phase 3 data with endpoint detail.",
            "event_type": "clinical",
            "trial_phase": "Phase 3",
            "indication": "rare disease",
            "source_url": "https://example.com/vrtx",
            "press_release_url": "https://example.com/vrtx-release",
            "press_release_text": "The study met its primary endpoint and included patient-response detail.",
            "ingest_hash": "evt-1-hash",
            "confidence": 0.9,
            "payload": {},
          },
          {
            "source": "biopharmcatalyst",
            "external_id": "evt-2",
            "ticker": "MRNA",
            "company": "Moderna",
            "event_at": "2026-03-04T12:30:00Z",
            "title": "Moderna oncology collaboration update",
            "summary": "Strategic oncology collaboration update.",
            "event_type": "strategic",
            "trial_phase": "",
            "indication": "oncology",
            "source_url": "https://example.com/mrna",
            "press_release_url": "https://example.com/mrna-release",
            "press_release_text": "The update expands the oncology collaboration platform.",
            "ingest_hash": "evt-2-hash",
            "confidence": 0.8,
            "payload": {},
          },
          {
            "source": "biopharmcatalyst",
            "external_id": "evt-3",
            "ticker": "ALNY",
            "company": "Alnylam",
            "event_at": "2026-03-05T12:30:00Z",
            "title": "Alnylam offering",
            "summary": "Follow-on offering announcement.",
            "event_type": "financing",
            "trial_phase": "",
            "indication": "",
            "source_url": "https://example.com/alny",
            "press_release_url": "https://example.com/alny-release",
            "press_release_text": "The company announced a follow-on offering.",
            "ingest_hash": "evt-3-hash",
            "confidence": 0.7,
            "payload": {},
          },
        ],
        "warnings": [],
      }

  class FakeMarketProvider:
    name = "fake_yfinance"
    is_fallback = False
    ready = True

    def check_ready(self):
      return (True, "mock")

    def fetch_market_bundle(self, **_kwargs):
      bundle = build_fake_market_bundle()
      return bundle

  monkeypatch.setattr(main_module.engine, "pharma_news_provider", FakePharmaProvider())
  monkeypatch.setattr(main_module.engine, "market_data_provider", FakeMarketProvider())

  sync_response = client.post(
    "/api/market/pharma/sync",
    json={"symbols": ["VRTX", "MRNA", "ALNY"], "limit": 10},
  )

  assert sync_response.status_code == 200
  sync_payload = sync_response.json()
  assert sync_payload["summary"]["stored_count"] == 3

  events_response = client.get("/api/market/pharma/events?symbols=VRTX,MRNA,ALNY&limit=10")
  assert events_response.status_code == 200
  assert events_response.json()["count"] == 3

  cycle_response = client.post(
    "/api/market/pharma/cycles",
    json={
      "symbols": ["VRTX", "MRNA", "ALNY"],
      "benchmark_symbol": "XBI",
      "period": "1y",
      "interval": "1d",
      "train_window": 1,
      "test_window": 1,
      "step_size": 1,
      "pre_window": 5,
      "post_window": 1,
      "max_events": 10,
      "max_expiries": 2,
      "max_strikes_per_expiry": 2,
      "rolling_window": 4,
      "k_neighbors": 2,
      "risk_free_rate": 0.0,
    },
  )

  assert cycle_response.status_code == 200
  cycle_payload = cycle_response.json()
  assert cycle_payload["cycle"]["id"]
  assert cycle_payload["candidates"]
  assert cycle_payload["leaderboard"]

  leaderboard_response = client.get("/api/market/pharma/leaderboard")
  assert leaderboard_response.status_code == 200
  assert leaderboard_response.json()["items"]

  homologation_response = client.get("/api/market/pharma/homologations")
  assert homologation_response.status_code == 200
  assert homologation_response.json()["items"]


def test_dossier_sync_and_list_endpoints_work(isolated_client):
  client = isolated_client
  username = f"dossier-{uuid4().hex[:8]}"

  register_response = client.post(
    "/api/auth/register",
    json={
      "username": username,
      "display_name": "Dossier Tester",
      "password": "library-pass",
    },
  )
  assert register_response.status_code == 200

  with database_session(main_module.settings.sqlite_path) as connection:
    main_module.engine.ingest_seed_document(
      connection,
      title="Misconceptions and Clickbait",
      source_path="C:/CoreyDigs/6-Misconceptions-and-Clickbait.pdf",
      body=(
        "According to a court filing dated 2024-08-17, vaccine passport litigation widened. "
        "CDC guidance and public health records were cited in the report."
      ),
      metadata={"author": "CoreyDigs"},
    )

  sync_response = client.post(
    "/api/market/dossiers/sync",
    json={"document_limit": 50, "assertion_limit_per_document": 12},
  )
  assert sync_response.status_code == 200
  sync_payload = sync_response.json()
  assert sync_payload["summary"]["stored_assertion_count"] >= 1
  assert sync_payload["provider"]["sources"]["primary_triangulation"]["name"] == "primary_triangulation"

  assertions_response = client.get("/api/market/dossiers/assertions?limit=20")
  assert assertions_response.status_code == 200
  assertions_payload = assertions_response.json()
  assert assertions_payload["count"] >= 1
  assert "payload" in assertions_payload["items"][0]

  windows_response = client.get("/api/market/dossiers/windows?limit=20")
  assert windows_response.status_code == 200
  windows_payload = windows_response.json()
  assert windows_payload["count"] >= 1


def test_register_login_and_query_flow(isolated_client):
  client = isolated_client
  username = f"tester-{uuid4().hex[:8]}"

  register_response = client.post(
    "/api/auth/register",
    json={
      "username": username,
      "display_name": "Backend Tester",
      "password": "library-pass",
    },
  )
  assert register_response.status_code == 200

  documents_response = client.get("/api/documents")
  assert documents_response.status_code == 200
  assert "items" in documents_response.json()

  query_response = client.post(
    "/api/query",
    json={"query": "What is the main argument of the Peirce continuity notes?"},
  )
  assert query_response.status_code == 200
  payload = query_response.json()
  assert payload["answer"]
  assert payload["citations"] is not None
  assert payload["research_bundle_id"]


def test_research_bundle_map_and_note_flow(isolated_client):
  client = isolated_client
  username = f"researcher-{uuid4().hex[:8]}"

  register_response = client.post(
    "/api/auth/register",
    json={
      "username": username,
      "display_name": "Research Tester",
      "password": "library-pass",
    },
  )
  assert register_response.status_code == 200

  research_response = client.post(
    "/api/research/query",
    json={"query": "Compare continuity across Euclid and Peirce."},
  )
  assert research_response.status_code == 200
  research_payload = research_response.json()
  assert research_payload["id"]
  assert research_payload["entities"]

  bundle_response = client.get(f"/api/research/bundles/{research_payload['id']}")
  assert bundle_response.status_code == 200

  map_response = client.post(
    "/api/research/maps",
    json={
      "title": "Continuity map",
      "description": "Pinned from test bundle",
      "bundle_id": research_payload["id"],
      "layout": {"lens": "triad"},
    },
  )
  assert map_response.status_code == 200
  map_payload = map_response.json()
  assert map_payload["id"]

  entity_id = research_payload["entities"][0]["id"]
  pin_response = client.post(
    f"/api/research/maps/{map_payload['id']}/pins",
    json={"entity_id": entity_id, "pin_type": "interpretant", "position": {"x": 10, "y": 20}},
  )
  assert pin_response.status_code == 200

  entity_response = client.get(f"/api/research/entities/{entity_id}")
  assert entity_response.status_code == 200

  note_response = client.post(
    "/api/notes",
    json={
      "title": "Interpretant note",
      "content": "Keep this entity in the map.",
      "entity_id": entity_id,
    },
  )
  assert note_response.status_code == 200
  assert note_response.json()["entity_id"] == entity_id


def test_website_topos_export_endpoint_returns_reviewed_payload(isolated_client):
  client = isolated_client
  username = f"topos-{uuid4().hex[:8]}"

  register_response = client.post(
    "/api/auth/register",
    json={
      "username": username,
      "display_name": "Website Topos Tester",
      "password": "library-pass",
    },
  )
  assert register_response.status_code == 200

  response = client.get("/api/research/topos/website")
  assert response.status_code == 200
  payload = response.json()

  assert payload["source_module"] == "MarketGRT.WebsiteTopos"
  assert payload["reviewed"] is True
  object_ids = {item["id"] for item in payload["objects"]}
  assert {"route.root", "route.library", "route.market_handoff", "route.timeline"} <= object_ids
  morphism_ids = {item["id"] for item in payload["morphisms"]}
  assert "m.cohomology.refines.export" in morphism_ids
  assert all(item["review_required"] for item in payload["generation_intents"])
  assert payload["reserved_automata"]["inc_ref_state"]["status"] == "reserved"


def test_materialize_website_topos_map_is_idempotent_and_persists_source_metadata(isolated_client):
  client = isolated_client
  username = f"topos-map-{uuid4().hex[:8]}"

  register_response = client.post(
    "/api/auth/register",
    json={
      "username": username,
      "display_name": "Website Topos Map Tester",
      "password": "library-pass",
    },
  )
  assert register_response.status_code == 200

  first_response = client.post(
    "/api/research/maps/from-topos",
    json={},
  )
  assert first_response.status_code == 200
  first_payload = first_response.json()
  assert first_payload["source_kind"] == "website_topos"
  assert first_payload["source_ref"] == "website-topos:canonical-shell:v1"
  assert first_payload["pins_created"] >= 10
  assert first_payload["map"]["source_kind"] == "website_topos"
  assert first_payload["map"]["source_ref"] == "website-topos:canonical-shell:v1"

  second_response = client.post(
    "/api/research/maps/from-topos",
    json={},
  )
  assert second_response.status_code == 200
  second_payload = second_response.json()
  assert second_payload["map"]["id"] == first_payload["map"]["id"]
  assert second_payload["pins_created"] == first_payload["pins_created"]

  maps_response = client.get("/api/research/maps")
  assert maps_response.status_code == 200
  maps = maps_response.json()["items"]
  assert len([item for item in maps if item["source_ref"] == "website-topos:canonical-shell:v1"]) == 1

  with database_session(main_module.settings.sqlite_path) as connection:
    persisted = repository.list_objects_of_reference(
      connection,
      canonical_labels=[
        "website_topos:object:route.root",
        "website_topos:morphism:m.cohomology.refines.export",
      ],
    )
  assert len(persisted) == 2


def test_lawvere_collection_endpoints_and_map_materialization(isolated_client, monkeypatch):
  client = isolated_client
  username = f"lawvere-{uuid4().hex[:8]}"

  register_response = client.post(
    "/api/auth/register",
    json={
      "username": username,
      "display_name": "Lawvere Tester",
      "password": "library-pass",
    },
  )
  assert register_response.status_code == 200

  with TemporaryDirectory() as temp_dir:
    collection_root = Path(temp_dir) / "Lawvere Collection"
    collection_root.mkdir(parents=True)
    for name in (
      "1963-functorial-semantics-of-algebraic-theories-(short).pdf",
      "1969-adjointness-in-foundations.pdf",
      "1969-adjointness-in-foundations - Copy.pdf",
      "1971-introduction-to-toposes-algebraic-geometry-and-logic.pdf",
    ):
      (collection_root / name).write_text("placeholder", encoding="utf-8")

    monkeypatch.setattr("app.lawvere_collection.LAWVERE_COLLECTION_PATH", collection_root)

    summary_response = client.get("/api/research/lawvere")
    assert summary_response.status_code == 200
    payload = summary_response.json()
    assert payload["collection_label"] == "Lawvere Collection"
    assert payload["collection_stats"]["canonical_document_count"] == 3
    assert payload["collection_stats"]["duplicate_variant_count"] == 1
    assert any(item["id"] == "candidate.adjointness" for item in payload["formalization_candidates"])

    candidates_response = client.get("/api/research/lawvere/formalization-candidates")
    assert candidates_response.status_code == 200
    assert any(item["id"] == "candidate.toposes" for item in candidates_response.json()["items"])

    map_response = client.post("/api/research/maps/from-lawvere", json={})
    assert map_response.status_code == 200
    map_payload = map_response.json()
    assert map_payload["source_kind"] == "lawvere_collection"
    assert map_payload["pins_created"] >= 1

    maps_response = client.get("/api/research/maps")
    assert maps_response.status_code == 200
    maps = maps_response.json()["items"]
    assert len([item for item in maps if item["source_ref"] == "lawvere-collection:canonical-folder:v1"]) == 1


def test_research_query_can_scope_to_lawvere_collection(isolated_client):
  client = isolated_client
  username = f"lawvere-scope-{uuid4().hex[:8]}"

  register_response = client.post(
    "/api/auth/register",
    json={
      "username": username,
      "display_name": "Lawvere Scope Tester",
      "password": "library-pass",
    },
  )
  assert register_response.status_code == 200

  with database_session(main_module.settings.sqlite_path) as connection:
    main_module.engine.ingest_seed_document(
      connection,
      title="1969 Adjointness in Foundations",
      source_path="seed://lawvere-adjointness",
      body="Adjointness organizes quantifiers, comprehension, equality, and the architecture of categorical logic.",
      metadata={
        "author": "F. William Lawvere",
        "year": 1969,
        "edition_year": 1969,
        "translation": False,
        "formalism": "category theory",
        "collection": "Lawvere Collection",
        "collection_key": "lawvere",
        "themes": ["adjointness", "hyperdoctrines"],
        "era": "foundational-1961-1969",
      },
    )
    main_module.engine.ingest_seed_document(
      connection,
      title="Collected Papers on Continuity",
      source_path="seed://peirce-continuity-scope",
      body="Continuity and relation are treated in a semiotic register.",
      metadata={"author": "Charles Sanders Peirce", "year": 1895, "edition_year": 1895, "translation": False, "formalism": "semiotics"},
    )

  response = client.post(
    "/api/research/query",
    json={
      "query": "Explain adjointness in foundations.",
      "preferred_lens": "diagram",
      "scope": {"collection": "lawvere"},
    },
  )
  assert response.status_code == 200
  payload = response.json()
  assert payload["citations"]
  assert all("Lawvere" in citation["document_title"] or "Adjointness" in citation["document_title"] for citation in payload["citations"])
  assert payload["trace"]["scope"]["collection"] == "lawvere"


def test_import_job_can_disable_recursive_scan(isolated_client):
  client = isolated_client
  username = f"importer-{uuid4().hex[:8]}"

  register_response = client.post(
    "/api/auth/register",
    json={
      "username": username,
      "display_name": "Import Tester",
      "password": "library-pass",
    },
  )
  assert register_response.status_code == 200

  with TemporaryDirectory() as temp_dir:
    import_path = Path(temp_dir) / "incoming"
    import_path.mkdir(parents=True)
    (import_path / "sample.txt").write_text("Top level import text", encoding="utf-8")

    import_response = client.post(
      "/api/import-jobs",
      json={
        "source_path": str(import_path),
        "kind": "manual_import",
        "options": {"recursive": False},
      },
    )
    assert import_response.status_code == 200
    assert import_response.json()["options"]["recursive"] is False


def test_import_job_reuses_existing_incomplete_manual_job(isolated_client):
  client = isolated_client
  username = f"import-dedup-{uuid4().hex[:8]}"

  register_response = client.post(
    "/api/auth/register",
    json={
      "username": username,
      "display_name": "Import Dedup Tester",
      "password": "library-pass",
    },
  )
  assert register_response.status_code == 200

  with TemporaryDirectory() as temp_dir:
    import_path = Path(temp_dir) / "incoming"
    import_path.mkdir(parents=True)
    (import_path / "sample.txt").write_text("Top level import text", encoding="utf-8")

    first_response = client.post(
      "/api/import-jobs",
      json={
        "source_path": str(import_path),
        "kind": "manual_import",
        "options": {"recursive": True},
      },
    )
    assert first_response.status_code == 200

    second_response = client.post(
      "/api/import-jobs",
      json={
        "source_path": str(import_path),
        "kind": "manual_import",
        "options": {"recursive": True},
      },
    )
    assert second_response.status_code == 200
    assert second_response.json()["id"] == first_response.json()["id"]

    jobs_response = client.get("/api/import-jobs")
    assert jobs_response.status_code == 200
    matching_jobs = [item for item in jobs_response.json()["items"] if item["source_path"] == str(import_path)]
    assert len(matching_jobs) == 1


def test_watch_folder_routes_expose_rules_and_metrics(isolated_client):
  client = isolated_client
  username = f"watch-folder-{uuid4().hex[:8]}"

  register_response = client.post(
    "/api/auth/register",
    json={
      "username": username,
      "display_name": "Watch Folder Tester",
      "password": "library-pass",
    },
  )
  assert register_response.status_code == 200

  with TemporaryDirectory() as temp_dir:
    watch_root = Path(temp_dir) / "watch"
    watch_root.mkdir(parents=True)

    create_response = client.post(
      "/api/watch-folders",
      json={
        "path": str(watch_root),
        "recursive": True,
        "include_extensions": ["pdf", ".djvu"],
        "exclude_globs": ["**/.obsidian/**", "*.tmp"],
      },
    )
    assert create_response.status_code == 200
    created = create_response.json()
    assert created["include_extensions"] == ["pdf", ".djvu"]
    assert created["exclude_globs"] == ["**/.obsidian/**", "*.tmp"]
    assert created["files_seen"] == 0
    assert created["files_added"] == 0

    list_response = client.get("/api/watch-folders")
    assert list_response.status_code == 200
    listed = next(item for item in list_response.json()["items"] if item["id"] == created["id"])
    assert listed["include_extensions"] == ["pdf", ".djvu"]
    assert listed["exclude_globs"] == ["**/.obsidian/**", "*.tmp"]
    assert "watch_backend" in listed


def test_import_job_rejects_missing_path(isolated_client):
  client = isolated_client
  username = f"missing-{uuid4().hex[:8]}"

  register_response = client.post(
    "/api/auth/register",
    json={
      "username": username,
      "display_name": "Missing Path Tester",
      "password": "library-pass",
    },
  )
  assert register_response.status_code == 200

  import_response = client.post(
    "/api/import-jobs",
    json={
      "source_path": "C:/Library/Incoming",
      "kind": "manual_import",
      "options": {"recursive": False},
    },
  )
  assert import_response.status_code == 400
  detail = import_response.json()["detail"]
  assert detail["code"] == "import_path_not_found"
  assert "Import path was not found" in detail["message"]


def test_forecast_technique_endpoints_return_polynomial_pack(isolated_client):
  client = isolated_client
  username = f"poly-{uuid4().hex[:8]}"

  register_response = client.post(
    "/api/auth/register",
    json={
      "username": username,
      "display_name": "Polynomial Tester",
      "password": "library-pass",
    },
  )
  assert register_response.status_code == 200

  with database_session(main_module.settings.sqlite_path) as connection:
    document = main_module.engine.ingest_seed_document(
      connection,
      title="Polynomials Field Notes",
      source_path="seed://polynomials-field-notes",
      body=(
        "Polynomials on markets. Cauchy bounds, Sturm theorem, Chebyshev polynomials, "
        "Lagrange interpolation, Groebner bases, and LLL methods are discussed together."
      ),
      metadata={"author": "Victor V. Prasolov", "formalism": "polynomials"},
    )

  list_response = client.get(f"/api/forecast-techniques?document_id={document['id']}")
  assert list_response.status_code == 200
  items = list_response.json()["items"]
  assert items

  technique_id = items[0]["id"]
  detail_response = client.get(f"/api/forecast-techniques/{technique_id}?document_id={document['id']}")
  assert detail_response.status_code == 200
  assert detail_response.json()["sources"]

  pack_response = client.get(f"/api/documents/{document['id']}/forecast-technique-pack")
  assert pack_response.status_code == 200
  payload = pack_response.json()
  assert payload["part1_master_technique_index"]
  assert payload["part2_technique_cards"]
  assert "PART 1" in payload["markdown"]


def test_import_jobs_include_file_counts_and_extract_payload(isolated_client):
  client = isolated_client
  username = f"import-view-{uuid4().hex[:8]}"

  register_response = client.post(
    "/api/auth/register",
    json={
      "username": username,
      "display_name": "Import View Tester",
      "password": "library-pass",
    },
  )
  assert register_response.status_code == 200

  with TemporaryDirectory() as temp_dir:
    source_path = Path(temp_dir) / "incoming"
    source_path.mkdir(parents=True)
    (source_path / "good.txt").write_text("valid import text", encoding="utf-8")

    with database_session(main_module.settings.sqlite_path) as connection:
      job = repository.create_import_job(
        connection,
        kind="manual_import",
        source_path=str(source_path),
        created_by=None,
        options={"recursive": True},
      )
      tasks = repository.get_or_create_pipeline_tasks(connection, job["id"], main_module.engine.PIPELINE_STAGES)
      repository.update_import_job(
        connection,
        job["id"],
        status="running",
        current_stage="ocr",
        state_json={
          "file_counts": {
            "discovered": 2,
            "processed": 2,
            "succeeded": 1,
            "failed": 1,
            "deferred_to_ocr": 0,
          },
          "current_item_name": "bad.pdf",
          "current_item_path": str(source_path / "bad.pdf"),
          "current_item_index": 2,
          "current_item_total": 2,
          "resumable": True,
          "recovered_after_restart": True,
        },
      )
      extract_task = next(task for task in tasks if task["stage"] == "extract")
      repository.update_pipeline_task(
        connection,
        extract_task["id"],
        status="completed",
        progress_completed=2,
        progress_total=2,
        payload_json={
          "processed": 2,
          "succeeded": 1,
          "failed": 1,
          "deferred_to_ocr": 0,
          "sample_failures": [
            {
              "path": str(source_path / "bad.pdf"),
              "stage": "extract",
              "code": "pdf_crypto_dependency_missing",
              "message": "AES-encrypted PDF import requires the 'cryptography' package for native text extraction.",
            }
          ],
          "current_item_name": "bad.pdf",
          "current_item_path": str(source_path / "bad.pdf"),
          "current_item_index": 2,
          "current_item_total": 2,
          "recovered_after_restart": True,
        },
      )

    response = client.get("/api/import-jobs")
    assert response.status_code == 200
    payload = response.json()["items"]
    matching_job = next(item for item in payload if item["id"] == job["id"])
    assert matching_job["file_counts"] == {
      "discovered": 2,
      "processed": 2,
      "succeeded": 1,
      "failed": 1,
      "deferred_to_ocr": 0,
    }
    assert matching_job["current_item_name"] == "bad.pdf"
    assert matching_job["current_item_path"].endswith("bad.pdf")
    assert matching_job["current_item_index"] == 2
    assert matching_job["current_item_total"] == 2
    assert matching_job["resumable"] is True
    assert matching_job["recovered_after_restart"] is True
    extract_payload = next(task for task in matching_job["tasks"] if task["stage"] == "extract")["payload"]
    assert extract_payload["failed"] == 1
    assert extract_payload["sample_failures"][0]["code"] == "pdf_crypto_dependency_missing"
    assert extract_payload["current_item_name"] == "bad.pdf"


def test_tracked_file_routes_return_status_filtered_items_and_history(isolated_client):
  client = isolated_client
  username = f"tracked-files-{uuid4().hex[:8]}"

  register_response = client.post(
    "/api/auth/register",
    json={
      "username": username,
      "display_name": "Tracked File Tester",
      "password": "library-pass",
    },
  )
  assert register_response.status_code == 200

  with TemporaryDirectory() as temp_dir:
    watch_root = Path(temp_dir) / "watch"
    watch_root.mkdir(parents=True)
    new_file = watch_root / "new.txt"
    failed_file = watch_root / "failed.pdf"
    stale_file = watch_root / "stale.png"
    new_file.write_text("new", encoding="utf-8")
    failed_file.write_text("failed", encoding="utf-8")
    stale_file.write_text("stale", encoding="utf-8")

    with database_session(main_module.settings.sqlite_path) as connection:
      folder = repository.create_watch_folder(connection, str(watch_root), True, None)
      new_row = repository.upsert_tracked_file_discovery(
        connection,
        root_watch_folder_id=folder["id"],
        absolute_path=new_file,
        relative_path=new_file.name,
        size_bytes=new_file.stat().st_size,
        mtime=None,
        checksum_sha1=None,
      )
      failed_job = repository.create_import_job(
        connection,
        kind="watch_sync",
        source_path=str(failed_file),
        created_by=None,
        options={"watch_folder_id": folder["id"]},
      )
      failed_row = repository.reconcile_tracked_file_stage(
        connection,
        absolute_path=failed_file,
        stage="extract",
        status="failed",
        import_job_id=failed_job["id"],
        root_watch_folder_id=folder["id"],
        relative_path=failed_file.name,
        size_bytes=failed_file.stat().st_size,
        error_message="parse error",
        event_message="Extract failed for this file.",
      )
      stale_row = repository.upsert_tracked_file_discovery(
        connection,
        root_watch_folder_id=folder["id"],
        absolute_path=stale_file,
        relative_path=stale_file.name,
        size_bytes=stale_file.stat().st_size,
        mtime=None,
        checksum_sha1=None,
      )
      repository.mark_tracked_files_stale_for_watch_folder(connection, folder["id"], [new_file, failed_file])

    list_response = client.get("/api/tracked-files")
    assert list_response.status_code == 200
    assert len(list_response.json()["items"]) >= 3

    failed_response = client.get("/api/tracked-files/failed")
    assert failed_response.status_code == 200
    assert any(item["id"] == failed_row["id"] for item in failed_response.json()["items"])

    new_response = client.get("/api/tracked-files/new")
    assert new_response.status_code == 200
    assert any(item["id"] == new_row["id"] for item in new_response.json()["items"])

    stale_response = client.get("/api/tracked-files/stale")
    assert stale_response.status_code == 200
    assert any(item["id"] == stale_row["id"] for item in stale_response.json()["items"])

    filtered_response = client.get("/api/tracked-files?status=failed")
    assert filtered_response.status_code == 200
    assert all(item["overall_status"] == "failed" for item in filtered_response.json()["items"])

    detail_response = client.get(f"/api/tracked-files/{failed_row['id']}")
    assert detail_response.status_code == 200
    detail = detail_response.json()
    assert detail["absolute_path"] == repository.normalize_absolute_path(failed_file)
    assert detail["history"]
    assert any(event["stage"] == "extract" for event in detail["history"])


def test_document_math_endpoints_return_persisted_formulae(isolated_client):
  client = isolated_client
  username = f"math-{uuid4().hex[:8]}"

  register_response = client.post(
    "/api/auth/register",
    json={
      "username": username,
      "display_name": "Math Tester",
      "password": "library-pass",
    },
  )
  assert register_response.status_code == 200

  with TemporaryDirectory() as temp_dir:
    source_path = Path(temp_dir) / "math.txt"
    source_path.write_text("The equation is Δω = γB0.", encoding="utf-8")

    with database_session(main_module.settings.sqlite_path) as connection:
      parsed = {
        "title": "math",
        "file_type": "txt",
        "pages": [{"number": 1, "text": "The equation is Δω = γB0.", "metadata": {"extraction_mode": "native_text"}}],
        "warnings": [],
        "text": "The equation is Δω = γB0.",
        "language": "en",
        "metadata": {},
      }
      prepared = main_module.engine.prepare_document(
        source_path,
        parsed,
        math={
          "pages_scanned": 1,
          "regions_detected": 1,
          "formula_count": 1,
          "formula_recognized": 1,
          "formula_pending": 0,
          "documents_with_math_artifacts": 1,
          "confidence_summary": {"average": 0.95, "max": 0.95},
          "artifacts": [
            {
              "id": "mathart-api",
              "page_number": 1,
              "source_ref": str(source_path),
              "raw_text": "Δω = γB0",
              "latex": r"\Delta \omega = \gamma B0",
              "confidence": 0.95,
              "provider_name": "heuristic_math",
              "model_name": "local-heuristic-v1",
              "extraction_mode": "native_math",
              "warnings": [],
              "validation_state": "recognized",
            }
          ],
          "regions": [
            {
              "id": "mathregion-api",
              "artifact_id": "mathart-api",
              "page_number": 1,
              "region_index": 1,
              "bbox": None,
              "image_path": None,
              "raw_text": "Δω = γB0",
              "confidence": 0.95,
              "status": "recognized",
              "warnings": [],
            }
          ],
          "formulae": [
            {
              "id": "mathformula-api",
              "artifact_id": "mathart-api",
              "region_id": "mathregion-api",
              "page_number": 1,
              "label": "Page 1 formula 1",
              "raw_text": "Δω = γB0",
              "latex": r"\Delta \omega = \gamma B0",
              "confidence": 0.95,
              "provider_name": "heuristic_math",
              "model_name": "local-heuristic-v1",
              "extraction_mode": "native_math",
              "validation_status": "recognized",
              "warnings": [],
            }
          ],
          "links": [
            {
              "id": "mathlink-api",
              "formula_id": "mathformula-api",
              "artifact_id": "mathart-api",
              "region_id": "mathregion-api",
              "link_type": "page",
              "payload": {"page_number": 1, "source_ref": str(source_path)},
            }
          ],
        },
      )
      document = main_module.engine.persist_prepared_document(connection, prepared)

    document_math = client.get(f"/api/documents/{document['id']}/math")
    assert document_math.status_code == 200
    payload = document_math.json()
    assert payload["summary"]["formula_count"] == 1
    assert payload["items"][0]["latex"] == r"\Delta \omega = \gamma B0"
    assert payload["items"][0]["node_id"]

    formula_detail = client.get("/api/math/mathformula-api")
    assert formula_detail.status_code == 200
    assert formula_detail.json()["artifact_id"] == "mathart-api"

    retry_response = client.post("/api/math/retry", json={"formula_ids": ["mathformula-api"]})
    assert retry_response.status_code == 200
    assert retry_response.json()["updated"] == 1

    with database_session(main_module.settings.sqlite_path) as connection:
      formula = repository.get_math_formula(connection, "mathformula-api")
      assert formula is not None
      assert formula["validation_status"] == "pending_retry"


def test_document_citation_endpoints_return_entries_mentions_and_footnotes(isolated_client):
  client = isolated_client
  username = f"cites-{uuid4().hex[:8]}"

  register_response = client.post(
    "/api/auth/register",
    json={
      "username": username,
      "display_name": "Citation Tester",
      "password": "library-pass",
    },
  )
  assert register_response.status_code == 200

  with TemporaryDirectory() as temp_dir:
    source_path = Path(temp_dir) / "citations.txt"
    text = "\n".join(
      [
        "References",
        "[1] Smith, John. 1998. On Ether Drift. Journal of Speculative Physics. doi:10.1234/example",
        "",
        "A later paragraph cites (Smith 1998) directly.",
        "[1] Compare Smith 1998 with later critiques; however, the experimental apparatus changed.",
      ]
    )
    source_path.write_text(text, encoding="utf-8")

    with database_session(main_module.settings.sqlite_path) as connection:
      parsed = {
        "title": "citations",
        "file_type": "txt",
        "pages": [{"number": 1, "text": text, "metadata": {"extraction_mode": "native_text"}}],
        "warnings": [],
        "text": text,
        "language": "en",
        "metadata": {},
      }
      citations = main_module.engine.extract_citation_artifacts(source_path, parsed)
      prepared = main_module.engine.prepare_document(
        source_path,
        parsed,
        citations=citations,
      )
      document = main_module.engine.persist_prepared_document(connection, prepared)

    document_citations = client.get(f"/api/documents/{document['id']}/citations")
    assert document_citations.status_code == 200
    citation_payload = document_citations.json()
    assert citation_payload["summary"]["entry_count"] == 1
    assert citation_payload["summary"]["mention_count"] >= 1
    assert "average_mention_confidence" in citation_payload["summary"]
    assert "match_rate" in citation_payload["summary"]
    assert citation_payload["items"][0]["doi"] == "10.1234/example"

    citation_id = citation_payload["items"][0]["id"]
    citation_detail = client.get(f"/api/citations/{citation_id}")
    assert citation_detail.status_code == 200
    assert citation_detail.json()["title"] == "On Ether Drift"

    footnotes = client.get(f"/api/documents/{document['id']}/footnotes")
    assert footnotes.status_code == 200
    footnote_payload = footnotes.json()
    assert footnote_payload["summary"]["footnote_count"] == 1
    assert footnote_payload["summary"]["mixed_footnote_count"] == 1
    assert "average_footnote_confidence" in footnote_payload["summary"]
    assert footnote_payload["items"][0]["kind"] == "mixed"
    assert any(span["span_kind"] in {"citation", "commentary", "mixed", "quotation"} for span in footnote_payload["items"][0]["spans"])


def test_reset_import_jobs_clears_jobs_tasks_and_artifacts(isolated_client):
  client = isolated_client
  username = f"resetter-{uuid4().hex[:8]}"

  register_response = client.post(
    "/api/auth/register",
    json={
      "username": username,
      "display_name": "Reset Tester",
      "password": "library-pass",
    },
  )
  assert register_response.status_code == 200

  artifact_dir = main_module.settings.resolved_job_artifact_dir / "job-reset-fixture"
  artifact_dir.mkdir(parents=True, exist_ok=True)
  (artifact_dir / "extract-failures.json").write_text("{}", encoding="utf-8")

  with database_session(main_module.settings.sqlite_path) as connection:
    job = repository.create_import_job(
      connection,
      kind="manual_import",
      source_path="C:/Library/Incoming",
      created_by=None,
      options={"recursive": True},
    )
    repository.get_or_create_pipeline_tasks(connection, job["id"], main_module.engine.PIPELINE_STAGES)

  response = client.delete("/api/import-jobs")
  assert response.status_code == 200
  payload = response.json()
  assert payload["ok"] is True
  assert payload["deleted_jobs"] == 1
  assert payload["deleted_tasks"] == len(main_module.engine.PIPELINE_STAGES)

  with database_session(main_module.settings.sqlite_path) as connection:
    assert repository.list_import_jobs(connection) == []
    assert repository.list_pipeline_tasks(connection) == []

  assert not artifact_dir.exists()


def test_query_degrades_in_prod_without_vector_runtime(tmp_path):
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
  main_module.settings.model_cache_dir = previous_values["model_cache_dir"]
  main_module.settings.job_artifact_dir = str(tmp_path / "jobs")
  main_module.settings.runtime_mode = "prod"
  main_module.settings.enable_dev_fallbacks = False
  main_module.settings.enable_demo_seed = False
  main_module.settings.bootstrap_default_account = False
  initialize_database(main_module.settings.sqlite_path)
  main_module.engine = LibraryEngine(main_module.settings)

  class UnavailableRuntime:
    def __init__(self, *, enabled: bool = False):
      self.ready = False
      self.enabled = enabled
      self.name = "unavailable"
      self.is_fallback = False

    def check_ready(self):
      return (False, "forced unavailable in test")

    def search(self, *args, **kwargs):
      return []

  main_module.engine._embedder = UnavailableRuntime()
  main_module.engine._reranker = UnavailableRuntime()
  main_module.engine._vector_index = UnavailableRuntime(enabled=False)

  try:
    with TestClient(main_module.app) as client:
      register_response = client.post(
        "/api/auth/register",
        json={
          "username": f"prod-{uuid4().hex[:8]}",
          "display_name": "Prod Tester",
          "password": "library-pass",
        },
      )
      assert register_response.status_code == 200

      query_response = client.post(
        "/api/query",
        json={"query": "What is the main argument of this book?"},
      )
      assert query_response.status_code == 200
      payload = query_response.json()
      assert payload["coverage"]["status"] == "insufficient_evidence"
      assert "vector_index_fallback" in payload["warnings"]
      assert "reranker_degraded_fallback" in payload["warnings"]
      assert payload["research_bundle_id"]
  finally:
    main_module.engine = previous_engine
    for key, value in previous_values.items():
      setattr(main_module.settings, key, value)


def test_query_uses_reasoner_fallback_in_prod_when_retrieval_is_ready(tmp_path):
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
  main_module.settings.model_cache_dir = previous_values["model_cache_dir"]
  main_module.settings.job_artifact_dir = str(tmp_path / "jobs")
  main_module.settings.runtime_mode = "prod"
  main_module.settings.enable_dev_fallbacks = False
  main_module.settings.enable_demo_seed = False
  main_module.settings.bootstrap_default_account = False
  initialize_database(main_module.settings.sqlite_path)
  main_module.engine = LibraryEngine(main_module.settings)
  main_module.engine._reasoner = UnavailableReasoner("forced offline in test")

  try:
    with database_session(main_module.settings.sqlite_path) as connection:
      main_module.engine.ingest_seed_document(
        connection,
        title="1969 Adjointness in Foundations",
        source_path="seed://lawvere-adjointness-prod",
        body="Adjointness organizes quantifiers, comprehension, equality, and categorical logic.",
        metadata={
          "author": "F. William Lawvere",
          "year": 1969,
          "edition_year": 1969,
          "translation": False,
          "formalism": "category theory",
          "collection": "Lawvere Collection",
          "collection_key": "lawvere",
          "themes": ["adjointness", "hyperdoctrines"],
          "era": "foundational-1961-1969",
        },
      )

    with TestClient(main_module.app) as client:
      register_response = client.post(
        "/api/auth/register",
        json={
          "username": f"prod-fallback-{uuid4().hex[:8]}",
          "display_name": "Prod Fallback Tester",
          "password": "library-pass",
        },
      )
      assert register_response.status_code == 200

      query_response = client.post(
        "/api/query",
        json={
          "query": "Explain adjointness in foundations.",
          "scope": {"collection": "lawvere"},
        },
      )
      assert query_response.status_code == 200
      payload = query_response.json()
      assert payload["answer"]
      assert payload["research_bundle_id"]
      assert "reasoner_degraded_fallback" in payload["warnings"]
      assert payload["citations"]
  finally:
    main_module.engine = previous_engine
    for key, value in previous_values.items():
      setattr(main_module.settings, key, value)


def test_activity_signal_sync_review_and_private_export_flow(isolated_client):
  client = isolated_client
  username = f"activity-{uuid4().hex[:8]}"

  register_response = client.post(
    "/api/auth/register",
    json={
      "username": username,
      "display_name": "Activity Tester",
      "password": "library-pass",
    },
  )
  assert register_response.status_code == 200

  sync_response = client.post(
    "/api/activity/signals/sync",
    json={
      "items": [
        {
          "id": "activity:timeline:data-load",
          "source_module": "timeline",
          "source_kind": "dataset_load",
          "title": "Timeline dataset load",
          "summary": "Loaded the sacred timeline.",
          "severity": "info",
          "visibility": "public",
          "signal_state": "ready",
          "payload": {"item_count": 42},
        }
      ]
    },
  )
  assert sync_response.status_code == 200
  assert any(item["id"] == "activity:timeline:data-load" for item in sync_response.json()["items"])

  review_response = client.post(
    "/api/activity/reviews/activity:timeline:data-load",
    json={
      "action": "approve",
      "review_state": "approved",
      "visibility": "private",
      "note": "Keep this one in the private queue.",
      "payload": {"scope": "timeline"},
    },
  )
  assert review_response.status_code == 200
  review_payload = review_response.json()
  assert review_payload["signal"]["review_state"] == "approved"
  assert review_payload["signal"]["visibility"] == "private"
  assert review_payload["export"]["status"] == "pending"

  history_response = client.get("/api/activity/review-history/activity:timeline:data-load")
  assert history_response.status_code == 200
  assert history_response.json()["items"][0]["note"] == "Keep this one in the private queue."

  profile_response = client.post(
    "/api/activity/git/profile",
    json={
      "repo_path": "C:/Users/Owner/Coding/private-notes",
      "export_subdir": "activity-exports",
      "branch_name": "main",
      "valid": True,
      "last_validated_at": "2026-03-17T12:00:00Z",
      "last_error": None,
    },
  )
  assert profile_response.status_code == 200
  assert profile_response.json()["repo_path"].endswith("private-notes")

  exports_response = client.get("/api/activity/git/exports?status_filter=pending")
  assert exports_response.status_code == 200
  export_item = exports_response.json()["items"][0]
  assert export_item["signal_id"] == "activity:timeline:data-load"

  complete_response = client.post(
    f"/api/activity/git/exports/{export_item['id']}/complete",
    json={
      "commit_hash": "abc123",
      "file_relpath": "activity-exports/activity-timeline-data-load-approve.json",
    },
  )
  assert complete_response.status_code == 200
  assert complete_response.json()["status"] == "committed"
  assert complete_response.json()["commit_hash"] == "abc123"
