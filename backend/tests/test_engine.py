from __future__ import annotations

import math
from pathlib import Path
import pytest
import shutil
import sys
import app.engine as engine_module

from app.config import Settings
from app.database import database_session, initialize_database
import subprocess

from app import repository
from app.engine import LibraryEngine, VectorIndex, _command_path, extract_document, summarize_text
from app.errors import ServiceDependencyError
from app.providers import CompositeOCRProvider, RemoteOCRProvider, build_ocr_provider
from app.lawvere_collection import build_lawvere_collection_payload, build_lawvere_document_metadata, dedupe_lawvere_sources
from app.coreydigs_investigative_dossiers_runtime import (
  build_dossier_context,
  build_dossier_sync_payload,
  build_event_dossier_features,
  dossier_rule_prediction,
  triangulate_primary_references,
)
from app.polynomial_runtime import (
  cauchy_root_bound,
  count_real_roots_in_interval,
  fit_chebyshev_series,
  lagrange_interpolation_coefficients,
)
from app.analytic_probability_runtime import (
  agreement_formula_statistics,
  approximate_xi_from_theta,
  brownian_bridge_range_statistic,
  compare_zeta_summation_methods,
  first_passage_time,
  jacobi_theta,
  laplace_transform_exponential_sum,
  levy_density_exponential_sum,
  mellin_transform_from_samples,
  reciprocal_density_from_grid,
  sample_exponential_sum_law,
  simulate_brownian_bridge,
  simulate_squared_bessel,
 )
from app.ordered_weighted_averaging_runtime import (
  andness,
  choquet_from_owa,
  iowa,
  linguistic_owa,
  majority_guided_aggregation,
  max_entropy_owa_weights,
  orness,
  owa,
  owa_weights_from_ranked_assessments,
  wowa,
)
from app.operator_ergodic_theory_runtime import (
  correlation_decay_profile,
  empirical_visit_frequencies,
  jdlg_split_vector,
  koopman_observable_update,
  markov_factor_projection,
  mean_ergodic_projection,
  recurrence_statistics,
  stationary_distribution,
  stochastic_matrix_from_counts,
  time_average,
  weighted_time_average,
)
from app.dyson_spectral_statistics_runtime import (
  circular_spacing_statistics,
  coulomb_gas_energy,
  dyson_thermodynamic_quantities,
  ensemble_beta_label,
  metropolis_circular_beta_ensemble,
  semicircle_density,
  spectral_irregularity_score,
  wigner_surmise_pdf,
)
from app.high_dimensional_probability_runtime import (
  HighDimensionalProbabilityAdapter,
  bernstein_mean_radius,
  covariance_matrix,
  gaussian_random_projection,
  hoeffding_mean_interval,
  iterative_soft_thresholding,
  principal_component,
  random_matrix_spectral_diagnostics,
  subgaussian_proxy,
)
from app.weak_convergence_runtime import (
  WeakConvergenceAdapter,
  argmax_m_estimator,
  bounded_lipschitz_metric_proxy,
  brownian_bridge_proxy,
  cadlag_modulus,
  dependent_sequence_diagnostic,
  empirical_cdf,
  entropy_bracketing_proxy,
  kolmogorov_distance,
  multiplier_bootstrap_empirical_process,
  partial_sum_process,
  prokhorov_metric_proxy,
  pushforward_samples,
  random_time_change,
)
from app.binocular_convergence_runtime import (
  BinocularConvergenceAdapter,
  classify_metric_from_alley_discrepancy,
  convergence_angle_from_depth,
  fit_empirical_convergence_function,
  normalize_visual_distances,
)
from app.dependence_probability_statistics_runtime import (
  DependenceStatisticsAdapter,
  additive_functional_summary,
  empirical_variogram,
  garch11_quasi_loglikelihood,
  hurst_rs_estimate,
  moving_block_bootstrap,
  regenerative_blocks,
  rolling_covariance_panel,
  weak_dependence_profile,
)
from app.volterra_operator_methods_runtime import (
  VolterraOperatorAdapter,
  apply_volterra_operator,
  discrete_convolution,
  finite_laplace_transform,
  solve_volterra_integral_equation,
  tail_subspace_membership,
  volterra_matrix,
  volterra_resolvent_series,
)
from app.contemporary_probability_runtime import (
  ContemporaryProbabilityAdapter,
  brownian_motion_path,
  effective_resistance_line_graph,
  finite_markov_chain_sample,
  geometric_brownian_motion,
  return_probability_estimate,
  riffle_shuffle_deck,
  sample_standard_normal_mcmc,
  self_avoiding_walk,
  simple_random_walk,
  wilson_path_tree_line_graph,
)
from app.orthogonal_polynomials_runtime import (
  OrthogonalContinuedFractionAdapter,
  continued_fraction_convergents,
  gaussian_quadrature_from_recurrence,
  monic_orthogonal_polynomial_values,
  schur_function_from_parameters,
  simple_continued_fraction,
  stieltjes_j_fraction,
  szego_recurrence,
)
from app.affine_hecke_orthogonal_runtime import (
  AffineHeckeOrthogonalAdapter,
  affine_weyl_orbit,
  askey_wilson_polynomial,
  q_shift_parameters,
  rank_one_symmetrizer,
  reduced_word_length,
  type_a_affine_simple_reflection,
)
from app.combinatorial_topology_runtime import (
  CombinatorialTopologyAdapter,
  barycentric_subdivision,
  betti_numbers_mod2,
  boundary_matrix_mod2,
  covering_dimension_upper_bound,
  euler_characteristic,
  homological_manifold_screen,
  link_of_simplex,
  nerve_complex,
  orientability_summary,
  simplicial_lefschetz_number,
  star_of_simplex,
)
from app.helsinki_icm_runtime import (
  HelsinkiICMAdapter,
  barycentric_interpolate,
  bloch_wigner_dilog,
  bogomolov_instability_screen,
  compare_interpolation_node_families,
  euler_maruyama_path,
  finite_horizon_optimal_feedback,
  invariance_principle_window,
  ito_integral_left_sum,
  normal_form_resonance_summary,
  regulator_sum_cross_ratios,
  shapley_value,
)
from app.information_theoretic_learning_runtime import (
  InformationTheoreticLearningAdapter,
  cauchy_schwarz_divergence,
  correntropy,
  correntropy_induced_metric,
  correntropy_spectrum_proxy,
  cross_information_potential,
  information_potential,
  lagged_correntropy,
  mcc_linear_regression,
  mee_linear_regression,
  pdf_kernel_matrix,
  quadratic_renyi_entropy,
)
from app.bayesian_networks_influence_diagrams_runtime import (
  BayesianNetworksAdapter,
  d_separated,
  dirichlet_update_cpt,
  evidence_conflict_score,
  expected_value_of_information,
  optimal_decision,
  posterior_query,
  sequential_cpt_update,
  value_of_perfect_information,
)
from app.information_geometry_methods_runtime import (
  InformationGeometryAdapter,
  entropy_regularized_bayes_update,
  fisher_rao_barycenter,
  fisher_rao_distance_discrete,
  geodesic_black_box_search,
  geodesic_lognormal_regression,
  kl_divergence_discrete,
  natural_gradient_flow,
  simplex_geodesic_interpolate,
)


class _StubEmbedder:
  def embed(self, text: str) -> list[float]:
    return [0.0, 0.0, 0.0, 0.0]

  def embed_many(self, texts: list[str]) -> list[list[float]]:
    return [[0.0, 0.0, 0.0, 0.0] for _ in texts]

  def provenance(self) -> dict[str, str]:
    return {"provider": "stub_embedding", "location": "local"}


def test_vector_index_falls_back_to_local_qdrant_store(tmp_path, monkeypatch):
  import app.engine as engine_module

  class _FakeCollection:
    def __init__(self, name: str):
      self.name = name

  class _FakeCollectionsResponse:
    def __init__(self, collections):
      self.collections = collections

  class _FakeQdrantClient:
    local_collections: set[str] = set()

    def __init__(self, **kwargs):
      if "url" in kwargs:
        raise RuntimeError("remote refused")
      self.path = kwargs.get("path")

    def get_collections(self):
      return _FakeCollectionsResponse([_FakeCollection(name) for name in sorted(self.local_collections)])

    def create_collection(self, collection_name, vectors_config):
      self.local_collections.add(collection_name)

    def create_payload_index(self, collection_name, key, kind):
      return None

  monkeypatch.setattr(engine_module, "QdrantClient", _FakeQdrantClient)

  settings = Settings(
    qdrant_url="http://127.0.0.1:6333",
    qdrant_collection_name="library_nodes",
    qdrant_local_path=str(tmp_path / "qdrant-local"),
    enable_local_qdrant_fallback=True,
    vector_size=4,
  )

  index = VectorIndex(settings, _StubEmbedder())

  assert index.enabled is True
  assert index.mode == "local"
  assert index.storage_path == str(tmp_path / "qdrant-local")
  assert "local vector store" in (index.detail or "")
  assert "library_nodes" in _FakeQdrantClient.local_collections


def test_vector_index_remote_upsert_records_provenance(monkeypatch):
  settings = Settings(
    remote_compute_mode="remote_ocr_remote_embeddings_remote_vector",
    remote_ocr_url="https://compute.example.test/v1/ocr",
    remote_vector_upsert_enabled=True,
    qdrant_collection_name="library_nodes",
    vector_size=4,
  )

  class _FakeRemoteUpsert:
    enabled = True
    base_url = "https://compute.example.test/v1/vector/upsert"

    def status(self):
      return {
        "enabled": True,
        "ready": True,
        "node_url": self.base_url,
        "collection": "library_nodes",
        "mode": "remote_compute_node",
      }

    def upsert_points(self, points):
      return {
        "upserted_count": len(points),
        "point_ids": [str(point["id"]) for point in points],
        "collection": "library_nodes",
        "mode": "remote_compute_node",
        "node_url": self.base_url,
        "warnings": [],
      }

  index = VectorIndex(settings, _StubEmbedder())
  index.remote_upsert = _FakeRemoteUpsert()

  nodes = [
    {
      "id": "node-1",
      "document_id": "doc-1",
      "parent_id": None,
      "node_type": "chunk",
      "summary_level": None,
      "title": "Chunk 1",
      "heading_path": "Chunk 1",
      "ordinal": 1,
      "page_start": 1,
      "page_end": 1,
      "text": "remote vector test",
      "token_count": 3,
      "language": "en",
      "checksum": "abc",
      "metadata_json": {},
      "created_at": "2026-03-22T00:00:00+00:00",
      "updated_at": "2026-03-22T00:00:00+00:00",
    }
  ]

  result = index.upsert_nodes(nodes)

  assert result["mode"] == "remote_compute_node"
  assert result["upserted_count"] == 1
  metadata = dict(nodes[0]["metadata_json"])
  assert metadata["embedding_provenance"]["provider"] == "stub_embedding"
  assert metadata["vector_provenance"]["mode"] == "remote_compute_node"
  assert metadata["vector_provenance"]["remote_point_id"] == "node-1"


def test_build_ocr_provider_prefers_local_with_remote_fallback(monkeypatch):
  import app.providers as providers_module

  class _FakePaddleProvider:
    name = "paddleocr"
    is_fallback = False
    ready = True

    def __init__(self, language: str = "en") -> None:
      self.language = language

    def check_ready(self):
      return (True, self.language)

  monkeypatch.setattr(providers_module, "PaddleOCR", object())
  monkeypatch.setattr(providers_module, "pdfium", object())
  monkeypatch.setattr(providers_module, "PaddleOCRProvider", _FakePaddleProvider)

  settings = Settings(
    remote_ocr_enabled=True,
    remote_ocr_url="https://ocr.example.test/v1/ocr",
    remote_ocr_api_key="secret",
    remote_ocr_model="ocr-1",
    prefer_remote_ocr=False,
    remote_only_ocr=False,
  )

  provider = build_ocr_provider(settings)

  assert isinstance(provider, CompositeOCRProvider)
  assert isinstance(provider.fallback, RemoteOCRProvider)


def test_build_ocr_provider_uses_remote_only_when_enabled(monkeypatch):
  import app.providers as providers_module

  class _FakePaddleProvider:
    def __init__(self, language: str = "en") -> None:
      self.language = language

    def check_ready(self):
      return (True, self.language)

  monkeypatch.setattr(providers_module, "PaddleOCR", object())
  monkeypatch.setattr(providers_module, "pdfium", object())
  monkeypatch.setattr(providers_module, "PaddleOCRProvider", _FakePaddleProvider)

  settings = Settings(
    remote_ocr_enabled=True,
    remote_ocr_url="https://ocr.example.test/v1/ocr",
    remote_ocr_api_key="secret",
    remote_ocr_model="ocr-1",
    remote_only_ocr=True,
  )

  provider = build_ocr_provider(settings)

  assert isinstance(provider, RemoteOCRProvider)


def test_persist_prepared_document_populates_research_and_technique_summaries(tmp_path):
  test_settings = build_dev_settings(tmp_path / "data")
  initialize_database(test_settings.sqlite_path)
  engine = LibraryEngine(test_settings)

  with database_session(test_settings.sqlite_path) as connection:
    document = engine.ingest_seed_document(
      connection,
      title="Polynomials and Covers",
      source_path="seed://polynomials-and-covers",
      body=(
        "Chebyshev polynomial approximation uses sections, covers, restriction maps, and simplicial reasoning. "
        "Lagrange interpolation, polynomial roots, and gluing constraints appear together."
      ),
      metadata={"author": "Test Author", "formalism": "polynomials"},
    )
    graph_nodes = repository.list_research_graph_nodes(connection, document["id"])
    graph_edges = repository.list_research_graph_edges(connection, document["id"])
    technique_materializations = repository.list_document_technique_materializations(connection, document["id"])

  assert graph_nodes
  assert graph_edges
  assert any(item["graph_type"] == "sign_token" for item in graph_nodes)
  assert any(item["edge_type"] in {"sign_refers_to_object", "category_morphism", "cover_scope"} for item in graph_edges)
  assert technique_materializations


def test_extract_math_artifacts_normalizes_missing_ids(tmp_path):
  test_settings = build_dev_settings(tmp_path / "data")
  initialize_database(test_settings.sqlite_path)
  engine = LibraryEngine(test_settings)

  class _StubMathProvider:
    def extract_document_math(self, source_path, parsed, ocr_provider=None, artifact_dir=None):
      return {
        "pages_scanned": 1,
        "regions_detected": 1,
        "formula_count": 1,
        "formula_recognized": 1,
        "formula_pending": 0,
        "documents_with_math_artifacts": 1,
        "confidence_summary": {"average": 0.8, "max": 0.8},
        "artifacts": [
          {
            "page_number": 1,
            "latex": r"\Delta \omega = \gamma B_0",
            "confidence": 0.8,
          }
        ],
        "regions": [
          {
            "page_number": 1,
            "region_index": 1,
            "raw_text": "Δω = γB0",
          }
        ],
        "formulae": [
          {
            "page_number": 1,
            "region_index": 1,
            "latex": r"\Delta \omega = \gamma B_0",
            "raw_text": "Δω = γB0",
            "confidence": 0.8,
          }
        ],
        "links": [
          {
            "kind": "page_reference",
            "target_id": "page-1",
          }
        ],
      }

  engine._math_provider = _StubMathProvider()

  parsed = {
    "title": "math",
    "pages": [{"number": 1, "text": "Δω = γB0", "metadata": {"extraction_mode": "native_text"}}],
    "text": "Δω = γB0",
    "warnings": [],
    "language": "en",
    "metadata": {},
  }
  result = engine.extract_math_artifacts(Path("sample.txt"), parsed)

  assert result["artifacts"][0]["id"].startswith("mathart-")
  assert result["regions"][0]["id"].startswith("mathregion-")
  assert result["regions"][0]["artifact_id"] == result["artifacts"][0]["id"]
  assert result["formulae"][0]["id"].startswith("mathformula-")
  assert result["formulae"][0]["artifact_id"] == result["artifacts"][0]["id"]
  assert result["formulae"][0]["region_id"] == result["regions"][0]["id"]
  assert result["links"][0]["id"].startswith("mathlink-")
  assert result["links"][0]["formula_id"] == result["formulae"][0]["id"]


def test_render_document_markdown_injects_latex_and_appends_unplaced_formulae(tmp_path):
  test_settings = build_dev_settings(tmp_path / "data")
  initialize_database(test_settings.sqlite_path)
  engine = LibraryEngine(test_settings)

  parsed = {
    "title": "Math Notes",
    "pages": [
      {
        "number": 1,
        "text": "The key relation is x = y + z in this derivation.",
        "metadata": {"extraction_mode": "native_text"},
      },
      {
        "number": 2,
        "text": "Second page commentary.",
        "metadata": {"extraction_mode": "native_text"},
      },
    ],
    "text": "The key relation is x = y + z in this derivation.\n\nSecond page commentary.",
    "warnings": [],
    "language": "en",
    "metadata": {},
  }
  math_payload = {
    "formulae": [
      {
        "id": "mathformula-inline",
        "page_number": 1,
        "raw_text": "x = y + z",
        "latex": r"x = y + z",
      },
      {
        "id": "mathformula-display",
        "page_number": 2,
        "raw_text": "",
        "latex": r"\int_0^1 f(x)\,dx",
      },
    ]
  }

  markdown = engine.render_document_markdown(Path("math.pdf"), parsed, math_payload)

  assert "# Math Notes" in markdown
  assert "$$\nx = y + z\n$$" in markdown
  assert "### Formulae" in markdown
  assert "$$\n\\int_0^1 f(x)\\,dx\n$$" in markdown
from app.hilbert_bayesian_coresets_runtime import (
  HilbertBayesianCoresetAdapter,
  bayesian_hilbert_coreset,
  coreset_alignment_diagnostics,
  hilbert_frank_wolfe_coreset,
  hilbert_importance_sampling_coreset,
  mean_coordinate_wasserstein,
  merge_distributed_coreset_weights,
  predictive_loglikelihood_average,
  random_projection_fisher,
  random_projection_l2,
  wasserstein_1d,
)
from app.hpc_mpi_data_science_runtime import (
  HPCMPIDataScienceAdapter,
  amdahl_speedup,
  bitonic_merge_sort,
  build_mpiexec_command,
  build_sbatch_template,
  cannon_matrix_product,
  classification_metrics,
  collective_roundtrip,
  cut_dendrogram,
  deadlock_risk_diagnostics,
  densest_subgraph_greedy,
  distributed_knn_predict,
  distributed_matrix_vector_product,
  evaluate_clustering,
  fox_matrix_product,
  gray_code,
  gray_to_binary,
  gustafson_scaled_speedup,
  hypercube_broadcast_steps,
  hyperquicksort_sort,
  iso_efficiency_required_work,
  johnson_lindenstrauss_projection,
  kmeans_coreset_d2_sampling,
  mpi_dependency_status,
  mpi_mapreduce,
  odd_even_transposition_sort,
  parallel_io_risk_score,
  parallel_kmeans,
  partition_search_frontier,
  psrs_sort,
  ring_pipeline_broadcast_steps,
  scalability_diagnostics,
  smallest_enclosing_ball_coreset,
  subgraph_isomorphism_search,
  snyder_matrix_product,
  timed_barrier,
  ward_hierarchical_clustering,
)
from app.market_analysis_runtime import (
  MarketGreenTriadAdapter,
  analyze_market_bundle,
  black_scholes_greeks,
)
from app.pharma_event_topos_runtime import (
  PharmaEventToposAdapter,
  compute_event_quality_score,
  parse_biopharmcatalyst_listing_html,
)


def build_dev_settings(tmp_path):
  return Settings(
    data_dir=str(tmp_path),
    model_cache_dir=str(tmp_path / "model-cache"),
    job_artifact_dir=str(tmp_path / "jobs"),
    runtime_mode="dev",
    enable_dev_fallbacks=True,
    enable_demo_seed=True,
    bootstrap_default_account=True,
  )


def build_fake_market_bundle():
  return {
    "provider": {"name": "fake_yfinance", "ready": True, "fallback": False, "detail": "mock"},
    "symbols": {
      "VRTX": {
        "symbol": "VRTX",
        "spot": 470.0,
        "history": [
          {"date": "2026-02-27T00:00:00Z", "close": 455.0, "adj_close": 455.0, "volume": 850.0},
          {"date": "2026-03-02T00:00:00Z", "close": 458.0, "adj_close": 458.0, "volume": 900.0},
          {"date": "2026-03-03T00:00:00Z", "close": 463.0, "adj_close": 463.0, "volume": 920.0},
          {"date": "2026-03-04T00:00:00Z", "close": 466.0, "adj_close": 466.0, "volume": 980.0},
          {"date": "2026-03-05T00:00:00Z", "close": 468.0, "adj_close": 468.0, "volume": 1000.0},
          {"date": "2026-03-06T00:00:00Z", "close": 475.0, "adj_close": 475.0, "volume": 1400.0},
          {"date": "2026-03-09T00:00:00Z", "close": 478.0, "adj_close": 478.0, "volume": 1320.0},
        ],
        "options": [
          {
            "expiry": "2026-04-17T00:00:00Z",
            "calls": [
              {"contractSymbol": "VRTX260417C00470000", "strike": 470.0, "bid": 11.0, "ask": 12.0, "change": 0.6, "volume": 210.0, "impliedVolatility": 0.35},
              {"contractSymbol": "VRTX260417C00480000", "strike": 480.0, "bid": 8.0, "ask": 9.0, "change": 0.4, "volume": 180.0, "impliedVolatility": 0.37},
            ],
            "puts": [
              {"contractSymbol": "VRTX260417P00470000", "strike": 470.0, "bid": 10.5, "ask": 11.6, "change": -0.4, "volume": 190.0, "impliedVolatility": 0.36},
            ],
          },
        ],
      },
      "MRNA": {
        "symbol": "MRNA",
        "spot": 118.0,
        "history": [
          {"date": "2026-02-27T00:00:00Z", "close": 114.0, "adj_close": 114.0, "volume": 1000.0},
          {"date": "2026-03-02T00:00:00Z", "close": 115.0, "adj_close": 115.0, "volume": 1040.0},
          {"date": "2026-03-03T00:00:00Z", "close": 116.5, "adj_close": 116.5, "volume": 1060.0},
          {"date": "2026-03-04T00:00:00Z", "close": 117.0, "adj_close": 117.0, "volume": 1090.0},
          {"date": "2026-03-05T00:00:00Z", "close": 118.0, "adj_close": 118.0, "volume": 1120.0},
          {"date": "2026-03-06T00:00:00Z", "close": 117.5, "adj_close": 117.5, "volume": 1080.0},
          {"date": "2026-03-09T00:00:00Z", "close": 118.2, "adj_close": 118.2, "volume": 1070.0},
        ],
        "options": [],
      },
      "ALNY": {
        "symbol": "ALNY",
        "spot": 245.0,
        "history": [
          {"date": "2026-02-27T00:00:00Z", "close": 248.0, "adj_close": 248.0, "volume": 650.0},
          {"date": "2026-03-02T00:00:00Z", "close": 247.0, "adj_close": 247.0, "volume": 660.0},
          {"date": "2026-03-03T00:00:00Z", "close": 246.0, "adj_close": 246.0, "volume": 670.0},
          {"date": "2026-03-04T00:00:00Z", "close": 245.5, "adj_close": 245.5, "volume": 690.0},
          {"date": "2026-03-05T00:00:00Z", "close": 245.0, "adj_close": 245.0, "volume": 920.0},
          {"date": "2026-03-06T00:00:00Z", "close": 239.0, "adj_close": 239.0, "volume": 1500.0},
          {"date": "2026-03-09T00:00:00Z", "close": 238.0, "adj_close": 238.0, "volume": 1420.0},
        ],
        "options": [],
      },
      "XBI": {
        "symbol": "XBI",
        "spot": 93.0,
        "history": [
          {"date": "2026-02-27T00:00:00Z", "close": 91.0, "adj_close": 91.0, "volume": 1900.0},
          {"date": "2026-03-02T00:00:00Z", "close": 91.5, "adj_close": 91.5, "volume": 1910.0},
          {"date": "2026-03-03T00:00:00Z", "close": 92.0, "adj_close": 92.0, "volume": 1930.0},
          {"date": "2026-03-04T00:00:00Z", "close": 92.4, "adj_close": 92.4, "volume": 1940.0},
          {"date": "2026-03-05T00:00:00Z", "close": 92.8, "adj_close": 92.8, "volume": 1950.0},
          {"date": "2026-03-06T00:00:00Z", "close": 93.0, "adj_close": 93.0, "volume": 1970.0},
          {"date": "2026-03-09T00:00:00Z", "close": 93.2, "adj_close": 93.2, "volume": 1980.0},
        ],
        "options": [],
      },
    },
    "benchmark_symbol": "XBI",
    "benchmark": {
      "symbol": "XBI",
      "spot": 93.0,
      "history": [
        {"date": "2026-02-27T00:00:00Z", "close": 91.0, "adj_close": 91.0, "volume": 1900.0},
        {"date": "2026-03-02T00:00:00Z", "close": 91.5, "adj_close": 91.5, "volume": 1910.0},
        {"date": "2026-03-03T00:00:00Z", "close": 92.0, "adj_close": 92.0, "volume": 1930.0},
        {"date": "2026-03-04T00:00:00Z", "close": 92.4, "adj_close": 92.4, "volume": 1940.0},
        {"date": "2026-03-05T00:00:00Z", "close": 92.8, "adj_close": 92.8, "volume": 1950.0},
        {"date": "2026-03-06T00:00:00Z", "close": 93.0, "adj_close": 93.0, "volume": 1970.0},
        {"date": "2026-03-09T00:00:00Z", "close": 93.2, "adj_close": 93.2, "volume": 1980.0},
      ],
      "options": [],
    },
    "warnings": [],
  }


def test_summarize_text_trims_sentences():
  summary = summarize_text(
    "First sentence is clear. Second sentence adds depth. Third sentence should be omitted.",
    max_sentences=2,
  )
  assert "First sentence is clear." in summary
  assert "Second sentence adds depth." in summary
  assert "Third sentence" not in summary


def test_engine_can_seed_and_query(tmp_path):
  test_settings = build_dev_settings(tmp_path)
  initialize_database(test_settings.sqlite_path)
  engine = LibraryEngine(test_settings)

  with database_session(test_settings.sqlite_path) as connection:
    engine.seed_if_empty(connection)
    result = engine.query(connection, "Compare continuity across Euclid and Peirce.")

  assert result["mode"] == "cross_book"
  assert result["citations"]
  assert result["related_documents"]
  assert result["research_bundle_id"]


def test_engine_builds_research_bundle(tmp_path):
  test_settings = build_dev_settings(tmp_path)
  initialize_database(test_settings.sqlite_path)
  engine = LibraryEngine(test_settings)

  with database_session(test_settings.sqlite_path) as connection:
    engine.seed_if_empty(connection)
    result = engine.research_query(connection, "Compare continuity across Euclid and Peirce.")

  assert result["id"]
  assert result["lens_payloads"]
  assert any(item["key"] == "triad" for item in result["lens_payloads"])
  assert any(entity["type"] == "Interpretant" for entity in result["entities"])
  assert result["validation"]


def test_ingest_path_respects_recursive_flag(tmp_path):
  library_root = tmp_path / "library"
  nested_dir = library_root / "nested"
  nested_dir.mkdir(parents=True)
  (library_root / "top.txt").write_text("Top level text", encoding="utf-8")
  (nested_dir / "nested.txt").write_text("Nested text", encoding="utf-8")

  test_settings = build_dev_settings(tmp_path / "data")
  initialize_database(test_settings.sqlite_path)
  engine = LibraryEngine(test_settings)

  with database_session(test_settings.sqlite_path) as connection:
    top_level_only = engine.ingest_path(connection, library_root, recursive=False)

  assert len(top_level_only) == 1
  assert top_level_only[0]["title"] == "top"


def test_validate_import_source_rejects_missing_path(tmp_path):
  test_settings = build_dev_settings(tmp_path / "data")
  initialize_database(test_settings.sqlite_path)
  engine = LibraryEngine(test_settings)

  try:
    engine.validate_import_source(tmp_path / "missing-library")
  except FileNotFoundError as error:
    assert "Import path was not found" in str(error)
  else:  # pragma: no cover - protects validation contract
    raise AssertionError("Expected missing import path validation to fail.")


def test_validate_import_source_resolves_windows_shortcut_target(tmp_path, monkeypatch):
  target_dir = tmp_path / "library"
  target_dir.mkdir()
  (target_dir / "sample.txt").write_text("shortcut source", encoding="utf-8")
  shortcut_path = tmp_path / "Library Shortcut.lnk"
  shortcut_path.write_text("", encoding="utf-8")

  test_settings = build_dev_settings(tmp_path / "data")
  initialize_database(test_settings.sqlite_path)
  engine = LibraryEngine(test_settings)

  monkeypatch.setattr(engine, "resolve_import_source_path", lambda path: target_dir if path == shortcut_path else path)

  result = engine.validate_import_source(shortcut_path)

  assert result["path"] == str(target_dir)
  assert result["kind"] == "directory"
  assert result["candidate_count"] == 1


def test_engine_requires_runtime_in_prod_without_services(tmp_path):
  test_settings = Settings(
    data_dir=str(tmp_path),
    model_cache_dir=str(tmp_path / "model-cache"),
    job_artifact_dir=str(tmp_path / "jobs"),
    runtime_mode="prod",
    enable_dev_fallbacks=False,
    enable_demo_seed=False,
    bootstrap_default_account=False,
  )
  initialize_database(test_settings.sqlite_path)
  engine = LibraryEngine(test_settings)

  with database_session(test_settings.sqlite_path) as connection:
    try:
      engine.query(connection, "What is the main argument?")
    except ServiceDependencyError as error:
      assert error.code == "query_runtime_unavailable"
      assert error.missing_services
    else:  # pragma: no cover - protects strict runtime contract
      raise AssertionError("Expected a strict runtime failure in prod mode.")


def test_discover_sources_accepts_djvu(tmp_path):
  library_root = tmp_path / "library"
  library_root.mkdir()
  (library_root / "sample.djvu").write_text("placeholder", encoding="utf-8")

  test_settings = build_dev_settings(tmp_path / "data")
  initialize_database(test_settings.sqlite_path)
  engine = LibraryEngine(test_settings)

  discovered = engine.discover_sources(library_root)

  assert len(discovered) == 1
  assert discovered[0].suffix.lower() == ".djvu"


def test_discover_sources_reiterates_until_tree_stabilizes(tmp_path, monkeypatch):
  library_root = tmp_path / "library"
  library_root.mkdir()
  first = library_root / "first.pdf"
  second = library_root / "second.pdf"
  first.write_text("placeholder", encoding="utf-8")
  second.write_text("placeholder", encoding="utf-8")

  test_settings = build_dev_settings(tmp_path / "data")
  test_settings.directory_discovery_max_passes = 5
  test_settings.directory_discovery_stable_passes = 2
  test_settings.directory_discovery_settle_seconds = 0.0
  initialize_database(test_settings.sqlite_path)
  engine = LibraryEngine(test_settings)

  passes = [
    [first],
    [first, second],
    [first, second],
  ]

  def fake_discover_directory_sources(source_path: Path, recursive: bool = True, include_extensions=None, exclude_globs=None):
    if passes:
      return passes.pop(0)
    return [first, second]

  monkeypatch.setattr(engine, "_discover_directory_sources", fake_discover_directory_sources)

  discovery = engine.discover_sources_stable(library_root)

  assert discovery["stable"] is True
  assert discovery["pass_count"] == 3
  assert [str(path) for path in discovery["sources"]] == [str(first), str(second)]
  assert [entry["count"] for entry in discovery["passes"]] == [1, 2, 2]


def test_extract_document_reports_missing_djvu_dependency(tmp_path, monkeypatch):
  source = tmp_path / "sample.djvu"
  source.write_text("placeholder", encoding="utf-8")

  class FakeOCR:
    ready = False

    def ocr_image(self, path):
      return {"text": "", "confidence": 0.0, "warnings": []}

  monkeypatch.setattr("app.engine._command_path", lambda name: None)

  try:
    extract_document(source, FakeOCR(), include_ocr=False)
  except ServiceDependencyError as error:
    assert error.code == "djvu_dependency_missing"
    assert "djvutxt" in error.missing_services
  else:  # pragma: no cover - protects dependency contract
    raise AssertionError("Expected DJVU extraction to fail clearly when tools are missing.")


def test_command_path_discovers_djvu_tools_from_known_windows_install(tmp_path, monkeypatch):
  install_root = tmp_path / "Program Files (x86)"
  tool_dir = install_root / "DjVuLibre"
  tool_dir.mkdir(parents=True)
  command_path = tool_dir / "djvutxt.exe"
  command_path.write_text("", encoding="utf-8")

  monkeypatch.setattr("app.engine.shutil.which", lambda name: None)
  monkeypatch.setattr("app.engine.sys.platform", "win32")
  monkeypatch.setenv("ProgramFiles(x86)", str(install_root))
  monkeypatch.setenv("ProgramFiles", str(tmp_path / "Program Files"))

  assert _command_path("djvutxt") == str(command_path)


def test_extract_document_can_fallback_to_djvu_ocr(tmp_path, monkeypatch):
  source = tmp_path / "sample.djvu"
  source.write_text("placeholder", encoding="utf-8")

  class FakeOCR:
    ready = True

    def ocr_image(self, path):
      page_number = int(path.stem.split("-")[-1])
      return {"text": f"Page {page_number} OCR text", "confidence": 0.9, "warnings": []}

  def fake_command(name: str) -> str | None:
    return name

  def fake_run(args: list[str]) -> subprocess.CompletedProcess[str]:
    if args[0] == "djvutxt":
      return subprocess.CompletedProcess(args, 0, stdout="", stderr="")
    page_flag = next((item for item in args if item.startswith("-page=")), "-page=1")
    page_number = int(page_flag.split("=")[-1])
    output_path = Path(args[-1])
    if page_number <= 2:
      output_path.write_text("rendered", encoding="utf-8")
      return subprocess.CompletedProcess(args, 0, stdout="", stderr="")
    return subprocess.CompletedProcess(args, 1, stdout="", stderr="done")

  monkeypatch.setattr("app.engine._command_path", fake_command)
  monkeypatch.setattr("app.engine._run_external_command", fake_run)

  parsed = extract_document(source, FakeOCR(), include_ocr=True)

  assert parsed["file_type"] == "djvu"
  assert parsed["pages"][0]["metadata"]["extraction_mode"] == "djvu_ocr"
  assert len(parsed["pages"]) == 2
  assert "Page 1 OCR text" in parsed["text"]


def test_refresh_document_ocr_only_repairs_missing_pdf_pages(tmp_path):
  settings = build_dev_settings(tmp_path / "data")
  engine = LibraryEngine(settings)
  source = tmp_path / "native.pdf"
  source.write_bytes(b"%PDF-1.4")

  calls: list[int] = []

  class FakeOCR:
    ready = True

    def ocr_pdf_page(self, pdf_path, page_number):
      calls.append(page_number)
      return {"text": f"OCR rescue {page_number}", "confidence": 0.87, "warnings": []}

  engine._ocr_provider = FakeOCR()
  parsed = {
    "title": "native",
    "file_type": "pdf",
    "pages": [
      {"number": 1, "text": "Native page 1", "metadata": {"extraction_mode": "native_text", "ocr_confidence": 1.0}},
      {"number": 2, "text": "", "metadata": {"extraction_mode": "native_text_missing", "ocr_confidence": 0.0}},
    ],
    "warnings": [],
    "text": "Native page 1",
    "language": "en",
    "metadata": {},
  }

  refreshed = engine.refresh_document_ocr(source, parsed, deferred_to_ocr=False)

  assert calls == [2]
  assert refreshed["pages_ocrd"] == 1
  assert refreshed["pages_improved"] == 1
  assert refreshed["document_changed"] is True
  assert refreshed["parsed"]["pages"][0]["text"] == "Native page 1"
  assert refreshed["parsed"]["pages"][1]["text"] == "OCR rescue 2"
  assert refreshed["parsed"]["pages"][1]["metadata"]["extraction_mode"] == "ocr_rendered_page"
  assert "Native page 1" in refreshed["parsed"]["text"]
  assert "OCR rescue 2" in refreshed["parsed"]["text"]


def test_refresh_document_ocr_fully_refreshes_deferred_pdf(tmp_path, monkeypatch):
  settings = build_dev_settings(tmp_path / "data")
  engine = LibraryEngine(settings)
  source = tmp_path / "deferred.pdf"
  source.write_bytes(b"%PDF-1.4")

  monkeypatch.setattr(
    "app.engine.extract_document",
    lambda source_path, ocr_provider, include_ocr=True: {
      "title": source_path.stem,
      "file_type": "pdf",
      "pages": [
        {"number": 1, "text": "Full OCR page 1", "metadata": {"extraction_mode": "ocr_rendered_page", "ocr_confidence": 0.9}},
        {"number": 2, "text": "Full OCR page 2", "metadata": {"extraction_mode": "ocr_rendered_page", "ocr_confidence": 0.88}},
      ],
      "warnings": [],
      "text": "Full OCR page 1\n\nFull OCR page 2",
      "language": "en",
      "metadata": {"fallback_reason": "deferred_to_ocr"},
    },
  )

  refreshed = engine.refresh_document_ocr(
    source,
    {
      "title": "deferred",
      "file_type": "pdf",
      "pages": [{"number": 1, "text": "", "metadata": {"extraction_mode": "unavailable", "ocr_confidence": 0.0}}],
      "warnings": [],
      "text": "",
      "language": "en",
      "metadata": {},
    },
    deferred_to_ocr=True,
  )

  assert refreshed["pages_ocrd"] == 2
  assert refreshed["pages_improved"] == 2
  assert refreshed["document_changed"] is True
  assert refreshed["parsed"]["pages"][0]["text"] == "Full OCR page 1"
  assert refreshed["parsed"]["metadata"]["fallback_reason"] == "deferred_to_ocr"


def test_lawvere_metadata_and_source_deduplication(tmp_path):
  root = tmp_path / "Lawvere Collection"
  root.mkdir()
  canonical = root / "1969-adjointness-in-foundations.pdf"
  duplicate = root / "1969-adjointness-in-foundations - Copy.pdf"
  other = root / "1971-introduction-to-toposes-algebraic-geometry-and-logic.pdf"
  for path in (canonical, duplicate, other):
    path.write_text("placeholder", encoding="utf-8")

  metadata = build_lawvere_document_metadata(canonical, canonical.stem, {})
  deduped = dedupe_lawvere_sources([canonical, duplicate, other])

  assert metadata["collection_key"] == "lawvere"
  assert metadata["author"] == "F. William Lawvere"
  assert "adjointness" in metadata["themes"]
  assert deduped == [canonical, other]


def test_build_lawvere_collection_payload_groups_duplicates_and_candidates(tmp_path):
  root = tmp_path / "Lawvere Collection"
  root.mkdir()
  files = [
    root / "1963-functorial-semantics-of-algebraic-theories-(short).pdf",
    root / "1969-adjointness-in-foundations.pdf",
    root / "1969-adjointness-in-foundations - Copy.pdf",
    root / "1971-introduction-to-toposes-algebraic-geometry-and-logic.pdf",
  ]
  for path in files:
    path.write_text("placeholder", encoding="utf-8")

  payload = build_lawvere_collection_payload(collection_path=root)

  assert payload["collection_stats"]["file_count"] == 4
  assert payload["collection_stats"]["canonical_document_count"] == 3
  assert payload["collection_stats"]["duplicate_variant_count"] == 1
  assert any(item["id"] == "candidate.toposes" for item in payload["formalization_candidates"])
  assert any(item["id"] == "intent.lawvere.global-mode" for item in payload["website_design_intents"])


def test_polynomial_runtime_core_functions():
  assert cauchy_root_bound([1, 0, -1]) >= 2.0
  assert count_real_roots_in_interval([1, 0, -1], -2, 2) == 2
  assert lagrange_interpolation_coefficients([(0, 1), (1, 3)]) == [2.0, 1.0]
  chebyshev = fit_chebyshev_series([-1.0, 0.0, 1.0], [1.0, 0.0, 1.0], 2)
  assert chebyshev["basis"] == "chebyshev"
  assert chebyshev["rmse"] >= 0.0


def test_engine_materializes_polynomial_techniques(tmp_path):
  test_settings = build_dev_settings(tmp_path / "data")
  initialize_database(test_settings.sqlite_path)
  engine = LibraryEngine(test_settings)

  body = (
    "Polynomials. Cauchy bounds, Gauss-Lucas, Sturm theorem, resultants, discriminants, "
    "Chebyshev polynomials, Lagrange interpolation, Groebner bases, and LLL all appear here."
  )

  with database_session(test_settings.sqlite_path) as connection:
    document = engine.ingest_seed_document(
      connection,
      title="Polynomials Notes",
      source_path="seed://polynomials-notes",
      body=body,
      metadata={"author": "Victor V. Prasolov", "formalism": "polynomials"},
    )
    techniques = repository.list_document_forecast_technique_details(connection, document["id"])

  assert techniques
  assert all(item["family_key"] == "polynomial" for item in techniques)
  assert any(item["technique"] == "Chebyshev Approximation and Orthogonal Basis Fitting" for item in techniques)
  assert any(item["sources"] for item in techniques)


def test_analytic_probability_runtime_core_functions():
  theta_value = jacobi_theta(1.0, terms=50)
  xi_value = approximate_xi_from_theta(2.0, lower=1e-3, upper=10.0, steps=240, theta_terms=60)
  samples = sample_exponential_sum_law(32, shape=1.0, terms=24, seed=11)
  reciprocal = reciprocal_density_from_grid([0.5, 1.0, 2.0], [0.2, 0.5, 0.3])
  bridge = simulate_brownian_bridge(64, seed=5)
  bessel = simulate_squared_bessel(2.0, steps=80, seed=7)
  comparison = compare_zeta_summation_methods(2.0, n_terms=50, damping=0.02)
  agreement = agreement_formula_statistics(12, num_steps=64, seed=17)

  assert theta_value > 1.0
  assert isinstance(xi_value, complex)
  assert len(samples) == 32
  assert min(samples) > 0
  assert abs(laplace_transform_exponential_sum(0.0, shape=1.0, terms=20) - 1.0) < 1e-12
  assert levy_density_exponential_sum(0.25, shape=1.0, terms=20) > 0
  assert reciprocal["x_grid"] == [2.0, 1.0, 0.5]
  assert mellin_transform_from_samples([1.0, 1.0, 1.0], 2.0) == 1
  assert bridge[0] == 0.0 and bridge[-1] == 0.0
  assert brownian_bridge_range_statistic(bridge) >= 0.0
  assert min(bessel) >= 0.0
  assert first_passage_time([0.1, 0.2, 0.8], 0.5) == 2
  assert first_passage_time([0.1, 0.2, 0.3], 0.5) is None
  assert isinstance(comparison["raw_partial_sum"], complex)
  assert agreement["mean_range_statistic"] >= 0.0


def test_engine_materializes_theta_zeta_techniques(tmp_path):
  test_settings = build_dev_settings(tmp_path / "data")
  initialize_database(test_settings.sqlite_path)
  engine = LibraryEngine(test_settings)

  body = (
    "Probability laws related to the Jacobi theta and Riemann zeta functions, and Brownian excursions. "
    "Sections discuss probabilistic interpretations of xi(s), infinitely divisible families, "
    "Laplace transforms, Levy densities, moments and Mellin transforms, Bessel processes, "
    "first passage times, maxima, the agreement formula, and renormalization of the series n^-s."
  )

  with database_session(test_settings.sqlite_path) as connection:
    document = engine.ingest_seed_document(
      connection,
      title="Probability laws related to the Jacobi theta and Riemann zeta functions",
      source_path="seed://theta-zeta-excursions",
      body=body,
      metadata={"author": "Philippe Biane; Jim Pitman; Marc Yor", "formalism": "analytic probability"},
    )
    techniques = repository.list_document_forecast_technique_details(connection, document["id"], family_key="theta_zeta_excursions")

  assert techniques
  assert all(item["family_key"] == "theta_zeta_excursions" for item in techniques)
  assert any(item["technique"] == "Theta/Xi Mellin Law Mapping" for item in techniques)
  assert any(item["sources"] for item in techniques)


def test_ordered_weighted_averaging_runtime_core_functions():
  scores = [0.2, 0.7, 0.5]
  weights = [0.6, 0.3, 0.1]
  order_weights = max_entropy_owa_weights(3, 0.7)
  ranked_weights = owa_weights_from_ranked_assessments([[0.8, 0.5, 0.2], [0.7, 0.55, 0.25]])
  linguistic = linguistic_owa(["low", "medium", "high"], weights, ["low", "medium", "high"])
  majority = majority_guided_aggregation([0.4, 0.6, 0.9], majority_level=0.65)

  assert abs(owa(scores, weights) - 0.64) < 1e-12
  assert abs(choquet_from_owa(scores, weights) - owa(scores, weights)) < 1e-12
  assert 0.0 <= orness(weights) <= 1.0
  assert abs(orness(weights) + andness(weights) - 1.0) < 1e-12
  assert wowa(scores, [0.5, 0.3, 0.2], weights) > 0.0
  assert iowa(scores, [0.1, 0.9, 0.5], weights) > 0.0
  assert abs(sum(order_weights) - 1.0) < 1e-12
  assert abs(sum(ranked_weights) - 1.0) < 1e-12
  assert linguistic["label"] in {"low", "medium", "high"}
  assert abs(sum(majority["weights"]) - 1.0) < 1e-12


def test_engine_materializes_owa_techniques(tmp_path):
  test_settings = build_dev_settings(tmp_path / "data")
  initialize_database(test_settings.sqlite_path)
  engine = LibraryEngine(test_settings)

  body = (
    "Recent developments in the ordered weighted averaging operators. "
    "The book discusses OWA operators and nonadditive integrals, the WOWA operator, "
    "induced ordered weighted averaging operators, OWA determination methods, "
    "fuzzification of OWA operators, majority guided aggregation, collective choice sets, "
    "linguistic OWA operators, and environmental and evidence fusion applications."
  )

  with database_session(test_settings.sqlite_path) as connection:
    document = engine.ingest_seed_document(
      connection,
      title="Recent Developments in the Ordered Weighted Averaging Operators",
      source_path="seed://ordered-weighted-averaging",
      body=body,
      metadata={"author": "Ronald R. Yager; Janusz Kacprzyk; Gleb Beliakov", "formalism": "aggregation"},
    )
    techniques = repository.list_document_forecast_technique_details(connection, document["id"], family_key="ordered_weighted_averaging")

  assert techniques
  assert all(item["family_key"] == "ordered_weighted_averaging" for item in techniques)
  assert any(item["technique"] == "Classical OWA Aggregation and Behavioral Profiling" for item in techniques)
  assert any(item["sources"] for item in techniques)


def test_operator_ergodic_runtime_core_functions():
  operator = stochastic_matrix_from_counts([[8, 2], [1, 9]])
  updated = koopman_observable_update(operator, [1.0, -1.0])
  projection = mean_ergodic_projection(operator, steps=64)
  stationary = stationary_distribution(operator, steps=256)
  path = [0, 1, 0, 1, 0]
  recurrence = recurrence_statistics(path)
  frequencies = empirical_visit_frequencies(path, num_states=2)
  coarse = markov_factor_projection(
    [[0.8, 0.2, 0.0], [0.1, 0.7, 0.2], [0.0, 0.4, 0.6]],
    partition=["a", "a", "b"],
  )
  split = jdlg_split_vector([[1.0, 0.0], [0.0, 1.0]], [0.3, 0.7], steps=16)
  decay = correlation_decay_profile([1.0, -1.0, 1.0, -1.0], max_lag=2)

  assert len(updated) == 2
  assert len(projection) == 2
  assert abs(sum(stationary) - 1.0) < 1e-9
  assert recurrence["first_return_index"] == 2
  assert abs(sum(frequencies) - 1.0) < 1e-9
  assert len(coarse["coarse_operator"]) == 2
  assert abs(sum(coarse["coarse_operator"][0]) - 1.0) < 1e-9
  assert abs(split["reversible_component"][0] + split["stable_component"][0] - 0.3) < 1e-9
  assert decay[0] == 1.0
  assert time_average([1.0, 2.0, 3.0]) == 2.0
  assert abs(weighted_time_average([1.0, 3.0], [1.0, 3.0]) - 2.5) < 1e-12


def test_engine_materializes_operator_ergodic_techniques(tmp_path):
  test_settings = build_dev_settings(tmp_path / "data")
  initialize_database(test_settings.sqlite_path)
  engine = LibraryEngine(test_settings)

  body = (
    "Operator Theoretic Aspects of Ergodic Theory. "
    "The book studies topological dynamical systems, recurrence, the Koopman operator, "
    "the mean ergodic theorem, strong and weak mixing, pointwise ergodic theorems, "
    "Markov operators, factor maps, the Jacobs-de Leeuw-Glicksberg decomposition, "
    "the Kronecker factor, and the spectral theorem for dynamical systems."
  )

  with database_session(test_settings.sqlite_path) as connection:
    document = engine.ingest_seed_document(
      connection,
      title="Operator Theoretic Aspects of Ergodic Theory",
      source_path="seed://operator-ergodic-theory",
      body=body,
      metadata={"author": "Tanja Eisner; Balint Farkas; Markus Haase; Rainer Nagel", "formalism": "ergodic theory"},
    )
    techniques = repository.list_document_forecast_technique_details(connection, document["id"], family_key="operator_ergodic_theory")

  assert techniques
  assert all(item["family_key"] == "operator_ergodic_theory" for item in techniques)
  assert any(item["technique"] == "Mean Ergodic Cesaro Projection" for item in techniques)
  assert any(item["sources"] for item in techniques)


def test_dyson_runtime_core_functions():
  angles = [0.0, math.pi / 2.0, math.pi, 3.0 * math.pi / 2.0]
  spacing = circular_spacing_statistics(angles)
  sample = metropolis_circular_beta_ensemble(6, 2.0, steps=200, burn_in=80, seed=13)
  thermo = dyson_thermodynamic_quantities(2.0)
  score = spectral_irregularity_score(angles, 2.0)

  assert semicircle_density(0.0) > 0.0
  assert semicircle_density(3.0) == 0.0
  assert len(spacing["unfolded_spacings"]) == 4
  assert abs(spacing["mean_spacing"] - 1.0) < 1e-12
  assert wigner_surmise_pdf(1.0, 1.0) > 0.0
  assert ensemble_beta_label(4.0) == "symplectic"
  assert math.isfinite(coulomb_gas_energy(angles))
  assert len(sample) == 6
  assert all(sample[index] <= sample[index + 1] for index in range(len(sample) - 1))
  assert math.isfinite(thermo["entropy"])
  assert math.isfinite(score["coulomb_energy"])


def test_engine_materializes_dyson_techniques(tmp_path):
  test_settings = build_dev_settings(tmp_path / "data")
  initialize_database(test_settings.sqlite_path)
  engine = LibraryEngine(test_settings)

  body = (
    "Statistical Theory of the Energy Levels of Complex Systems. "
    "Dyson studies the Gaussian, orthogonal, unitary, and symplectic ensembles; "
    "derives joint eigenvalue distributions and level repulsion; introduces the "
    "electrostatic Coulomb gas analogy; and discusses entropy and thermodynamic variables."
  )

  with database_session(test_settings.sqlite_path) as connection:
    document = engine.ingest_seed_document(
      connection,
      title="Statistical Theory of the Energy Levels of Complex Systems. I",
      source_path="seed://dyson-1962",
      body=body,
      metadata={"author": "Freeman J. Dyson", "formalism": "random matrix theory"},
    )
    techniques = repository.list_document_forecast_technique_details(connection, document["id"], family_key="dyson_spectral_statistics")

  assert techniques
  assert all(item["family_key"] == "dyson_spectral_statistics" for item in techniques)
  assert any(item["technique"] == "Level Repulsion and Spacing Diagnostics" for item in techniques)
  assert any(item["sources"] for item in techniques)


def test_high_dimensional_probability_runtime_core_functions():
  hoeffding = hoeffding_mean_interval([0.2, 0.4, 0.6, 0.8], lower_bound=0.0, upper_bound=1.0)
  bernstein = bernstein_mean_radius([0.2, 0.4, 0.6, 0.8], bound=1.0)
  proxy = subgaussian_proxy([0.2, 0.4, 0.6, 0.8])
  covariance = covariance_matrix([[1.0, 0.0], [0.0, 1.0], [2.0, 1.0]])
  component = principal_component(covariance)
  projection = gaussian_random_projection([[1.0, 0.0], [0.0, 1.0]], 2, seed=9)
  diagnostics = random_matrix_spectral_diagnostics([[1.0, 0.0], [0.0, 2.0], [1.0, 1.0]])
  sparse_fit = iterative_soft_thresholding([[1.0, 0.0], [0.0, 1.0], [1.0, 1.0]], [1.0, -1.0, 0.0], 0.05, iterations=80)
  adapter = HighDimensionalProbabilityAdapter()
  summary = adapter.random_projection_summary([[1.0, 0.0], [0.0, 1.0]], 2, seed=9)

  assert hoeffding["lower"] < hoeffding["upper"]
  assert bernstein["radius"] >= 0.0
  assert proxy["proxy_scale"] >= 0.0
  assert len(covariance) == 2 and len(covariance[0]) == 2
  assert math.isfinite(component["explained_variance_ratio"])
  assert len(projection["projected_points"]) == 2 and len(projection["projected_points"][0]) == 2
  assert diagnostics["stable_rank"] >= 0.0
  assert len(sparse_fit["coefficients"]) == 2
  assert len(summary["projected_points"]) == 2


def test_engine_materializes_high_dimensional_probability_techniques(tmp_path):
  test_settings = build_dev_settings(tmp_path / "data")
  initialize_database(test_settings.sqlite_path)
  engine = LibraryEngine(test_settings)

  body = (
    "High-Dimensional Probability: an introduction with applications in data science. "
    "The text covers concentration of sums of independent random variables, random vectors, "
    "random matrices, Johnson-Lindenstrauss random projections, and sparse recovery."
  )

  with database_session(test_settings.sqlite_path) as connection:
    document = engine.ingest_seed_document(
      connection,
      title="High-Dimensional Probability",
      source_path="seed://high-dimensional-probability",
      body=body,
      metadata={"author": "Roman Vershynin", "formalism": "high-dimensional probability"},
    )
    techniques = repository.list_document_forecast_technique_details(connection, document["id"], family_key="high_dimensional_probability")

  assert techniques
  assert all(item["family_key"] == "high_dimensional_probability" for item in techniques)
  assert any(item["technique"] == "Sparse Recovery via Iterative Soft Thresholding" for item in techniques)
  assert any(item["sources"] for item in techniques)


def test_dependence_probability_statistics_runtime_core_functions():
  blocks = regenerative_blocks(["reset", "run", "reset", "hold"], ["reset"])
  additive = additive_functional_summary(blocks, {"reset": 1.0, "run": 2.0, "hold": -1.0})
  profile = weak_dependence_profile([1.0, 0.0, 1.0, 0.0, 1.0], 2)
  bootstrap = moving_block_bootstrap([1.0, 2.0, 3.0, 4.0, 5.0], block_length=2, n_bootstrap=8, seed=13)
  hurst = hurst_rs_estimate([1.0, 2.0, 1.5, 2.5, 1.75, 2.75, 2.0, 3.0])
  garch = garch11_quasi_loglikelihood([0.1, -0.2, 0.15, -0.05], omega=0.01, alpha=0.05, beta=0.9)
  variogram = empirical_variogram([0.0, 1.0, 2.0], [1.0, 3.0, 2.0])
  rolling = rolling_covariance_panel([[1.0, 0.0], [2.0, 1.0], [3.0, 1.5], [4.0, 2.0]], window=3)
  adapter = DependenceStatisticsAdapter()
  summary = adapter.weak_dependence_bootstrap([1.0, 0.0, 1.0, 0.0, 1.0, 0.0, 1.0, 0.0], max_lag=2, block_length=2, n_bootstrap=6, seed=7)

  assert blocks == [["reset"], ["run", "reset"], ["hold"]]
  assert math.isfinite(additive["stationary_reward_proxy"])
  assert profile[0] == 1.0
  assert len(bootstrap["replicates"]) == 8
  assert all(len(replicate) == 5 for replicate in bootstrap["replicates"])
  assert math.isfinite(hurst["hurst_estimate"])
  assert all(variance > 0.0 for variance in garch["variances"])
  assert len(variogram["distances"]) == len(variogram["semivariances"])
  assert len(rolling) == 2
  assert len(summary["bootstrap"]["replicates"]) == 6


def test_engine_extracts_bibliography_and_mixed_footnotes(tmp_path):
  test_settings = build_dev_settings(tmp_path / "data")
  initialize_database(test_settings.sqlite_path)
  engine = LibraryEngine(test_settings)

  source_path = tmp_path / "citations.txt"
  source_path.write_text(
    "\n".join(
      [
        "A short scholarly note.",
        "References",
        "[1] Smith, John. 1998. On Ether Drift. Journal of Speculative Physics. pp. 10-22. doi:10.1234/example",
        "[2] Doe, Jane. 2005. Mirage Geometry. Mirage Press.",
        "",
        "As argued elsewhere (Smith 1998), the effect remains unstable.",
        "[1] Compare Smith 1998 with later critiques; however, the experiment was repeated under narrower constraints.",
      ]
    ),
    encoding="utf-8",
  )

  parsed = {
    "title": "citations",
    "file_type": "txt",
    "pages": [
      {
        "number": 1,
        "text": source_path.read_text(encoding="utf-8"),
        "metadata": {"extraction_mode": "native_text"},
      }
    ],
    "warnings": [],
    "text": source_path.read_text(encoding="utf-8"),
    "language": "en",
    "metadata": {},
  }

  payload = engine.extract_citation_artifacts(source_path, parsed)

  assert payload["summary"]["bibliography_entries"] >= 2
  assert payload["summary"]["citation_mentions"] >= 2
  assert payload["summary"]["footnotes"] == 1
  assert payload["summary"]["mixed_footnotes"] == 1
  assert any(item.get("kind") == "mixed" for item in payload["footnotes"])
  assert any(item.get("doi") == "10.1234/example" for item in payload["entries"])
  assert payload["summary"]["entry_average_confidence"] > 0.0
  assert payload["summary"]["mention_average_confidence"] > 0.0
  assert payload["summary"]["footnote_average_confidence"] > 0.0


def test_engine_joins_multiline_bibliography_and_matches_numeric_mentions(tmp_path):
  test_settings = build_dev_settings(tmp_path / "data")
  initialize_database(test_settings.sqlite_path)
  engine = LibraryEngine(test_settings)

  source_path = tmp_path / "multiline-citations.txt"
  text = "\n".join(
    [
      "Works Cited:",
      "[1] Smith, John. 1998. On Ether Drift.",
      "Journal of Speculative Physics. pp. 10-22. doi:10.1234/example",
      "",
      "Arendt, Hannah. The Human Condition. Chicago: University of Chicago Press, 1958.",
      "",
      "This later note leans on [1] for the original apparatus description.",
    ]
  )
  source_path.write_text(text, encoding="utf-8")

  parsed = {
    "title": "multiline citations",
    "file_type": "txt",
    "pages": [{"number": 1, "text": text, "metadata": {"extraction_mode": "native_text"}}],
    "warnings": [],
    "text": text,
    "language": "en",
    "metadata": {},
  }

  payload = engine.extract_citation_artifacts(source_path, parsed)

  assert payload["summary"]["bibliography_entries"] == 2
  assert payload["summary"]["parsed_entry_count"] >= 1
  smith_entry = next(item for item in payload["entries"] if item.get("doi") == "10.1234/example")
  assert "Journal of Speculative Physics" in (smith_entry.get("container_title") or smith_entry.get("raw_text") or "")
  assert any(item.get("match_status") == "matched" and item.get("mention_type") == "numeric" for item in payload["mentions"])


def test_engine_preserves_quotation_and_mixed_footnote_spans(tmp_path):
  test_settings = build_dev_settings(tmp_path / "data")
  initialize_database(test_settings.sqlite_path)
  engine = LibraryEngine(test_settings)

  source_path = tmp_path / "footnote-citations.txt"
  text = "\n".join(
    [
      "References",
      "[1] Doe, Jane. 2001. The Mirage Reconsidered. Mirage Review. pp. 20-21.",
      "",
      '[1] Compare Smith 1998; however, "the instrument drifted" according to later observers. See Doe 2001, pp. 20-21.',
    ]
  )
  source_path.write_text(text, encoding="utf-8")

  parsed = {
    "title": "footnote citations",
    "file_type": "txt",
    "pages": [{"number": 1, "text": text, "metadata": {"extraction_mode": "native_text"}}],
    "warnings": [],
    "text": text,
    "language": "en",
    "metadata": {},
  }

  payload = engine.extract_citation_artifacts(source_path, parsed)

  assert payload["summary"]["footnotes"] == 1
  assert payload["summary"]["mixed_footnotes"] == 1
  footnote = payload["footnotes"][0]
  span_kinds = {span.get("span_kind") for span in payload["spans"] if span.get("footnote_id") == footnote["id"]}
  assert "commentary" in span_kinds or "mixed" in span_kinds
  assert "quotation" in span_kinds or "mixed" in span_kinds
  assert any(item.get("mention_type") == "footnote_span" for item in payload["mentions"])


def test_engine_materializes_dependence_probability_statistics_techniques(tmp_path):
  test_settings = build_dev_settings(tmp_path / "data")
  initialize_database(test_settings.sqlite_path)
  engine = LibraryEngine(test_settings)

  body = (
    "Dependence in Probability and Statistics includes regeneration-based statistics for Harris recurrent Markov chains, "
    "weak dependence for causal sequences, long memory, efficient inference in GARCH processes, "
    "variograms for spatial max-stable random fields, and multivariate financial returns."
  )

  with database_session(test_settings.sqlite_path) as connection:
    document = engine.ingest_seed_document(
      connection,
      title="Dependence in Probability and Statistics",
      source_path="seed://dependence-in-probability-statistics",
      body=body,
      metadata={"author": "Patrice Bertail; Paul Doukhan; Philippe Soulier", "formalism": "dependence"},
    )
    techniques = repository.list_document_forecast_technique_details(connection, document["id"], family_key="dependence_probability_statistics")

  assert techniques
  assert all(item["family_key"] == "dependence_probability_statistics" for item in techniques)
  assert any(item["technique"] == "Weak-Dependence Profile and Moving-Block Bootstrap" for item in techniques)
  assert any(item["sources"] for item in techniques)


def test_volterra_operator_methods_runtime_core_functions():
  matrix = volterra_matrix(4)
  image = apply_volterra_operator([1.0, 2.0, 3.0, 4.0])
  solution = solve_volterra_integral_equation([1.0, 0.0, 0.0, 0.0], lam=0.2, iterations=40)
  convolution = discrete_convolution([1.0, 2.0, 3.0], [1.0, 0.0])
  transform = finite_laplace_transform([1.0, 2.0, 3.0], 1.0 + 0.5j)
  resolvent = volterra_resolvent_series([1.0, 0.0, 0.0], lam=0.1, terms=5)
  membership = tail_subspace_membership([0.0, 0.0, 2.0], 2)
  adapter = VolterraOperatorAdapter(horizon=1.0)
  summary = adapter.transform_summary([1.0, 2.0, 3.0], 1.0)

  assert len(matrix) == 4 and len(matrix[0]) == 4
  assert image[-1] > image[0]
  assert math.isfinite(solution["residual_norm"])
  assert convolution == [1.0, 2.0, 3.0]
  assert isinstance(transform, complex)
  assert resolvent["terms"] == 5
  assert membership["is_member"] is True
  assert isinstance(summary["finite_laplace_transform"], complex)


def test_engine_materializes_volterra_operator_methods_techniques(tmp_path):
  test_settings = build_dev_settings(tmp_path / "data")
  initialize_database(test_settings.sqlite_path)
  engine = LibraryEngine(test_settings)

  body = (
    "Volterra Adventures studies the Volterra operator, resolvent kernels, Volterra-type integral equations, "
    "the Titchmarsh convolution theorem, the finite Laplace transform, and invariant subspaces."
  )

  with database_session(test_settings.sqlite_path) as connection:
    document = engine.ingest_seed_document(
      connection,
      title="Volterra Adventures",
      source_path="seed://volterra-adventures",
      body=body,
      metadata={"author": "Joel H. Shapiro", "formalism": "operator theory"},
    )
    techniques = repository.list_document_forecast_technique_details(connection, document["id"], family_key="volterra_operator_methods")

  assert techniques
  assert all(item["family_key"] == "volterra_operator_methods" for item in techniques)
  assert any(item["technique"] == "Volterra Convolution and Finite Laplace Transform Workflow" for item in techniques)
  assert any(item["sources"] for item in techniques)


def test_contemporary_probability_runtime_core_functions():
  walk = simple_random_walk(12, seed=5)
  return_probability = return_probability_estimate(50, 8, seed=5)
  self_avoiding = self_avoiding_walk(16, seed=5)
  brownian = brownian_motion_path(32, seed=5)
  deck = riffle_shuffle_deck(10, 3, seed=5)
  markov_path = finite_markov_chain_sample([[0.8, 0.2], [0.1, 0.9]], 0, 20, seed=5)
  mcmc = sample_standard_normal_mcmc(0.0, steps=200, burn_in=20, seed=5)
  resistance = effective_resistance_line_graph(7, 1, 5)
  tree = wilson_path_tree_line_graph(7)
  gbm = geometric_brownian_motion(100.0, mu=0.03, sigma=0.2, horizon=1.0, steps=32, seed=5)
  adapter = ContemporaryProbabilityAdapter()
  summary = adapter.finance_summary(100.0, mu=0.03, sigma=0.2, horizon=1.0, steps=16, seed=5)

  assert len(walk) == 13
  assert 0.0 <= return_probability <= 1.0
  assert len({tuple(point) for point in self_avoiding["path"]}) == len(self_avoiding["path"])
  assert len(brownian) == 33
  assert sorted(deck) == list(range(10))
  assert len(markov_path) == 21
  assert 0.0 <= mcmc["acceptance_rate"] <= 1.0
  assert resistance == 4
  assert len(tree) == 6
  assert all(value > 0.0 for value in gbm)
  assert summary["terminal_value"] > 0.0


def test_engine_materializes_contemporary_probability_techniques(tmp_path):
  test_settings = build_dev_settings(tmp_path / "data")
  initialize_database(test_settings.sqlite_path)
  engine = LibraryEngine(test_settings)

  body = (
    "Lectures on Contemporary Probability covers simple random walk, self-avoiding walk, Brownian motion, "
    "shuffling and random permutations, Markov chains on finite sets, Markov chain Monte Carlo, "
    "random walks and electrical networks, uniform spanning trees, and simulations in finance."
  )

  with database_session(test_settings.sqlite_path) as connection:
    document = engine.ingest_seed_document(
      connection,
      title="Lectures on Contemporary Probability",
      source_path="seed://lectures-on-contemporary-probability",
      body=body,
      metadata={"author": "Gregory F. Lawler; Lester N. Coyle", "formalism": "probability lectures"},
    )
    techniques = repository.list_document_forecast_technique_details(connection, document["id"], family_key="contemporary_probability")

  assert techniques
  assert all(item["family_key"] == "contemporary_probability" for item in techniques)
  assert any(item["technique"] == "Finance Simulation with Geometric Brownian Motion" for item in techniques)
  assert any(item["sources"] for item in techniques)


def test_orthogonal_polynomials_runtime_core_functions():
  simple = simple_continued_fraction(math.pi, max_terms=6)
  convergents = continued_fraction_convergents([3, 7, 15, 1])
  j_fraction = stieltjes_j_fraction([0.0, 0.0], [0.25], 1.5)
  values = monic_orthogonal_polynomial_values([0.0, 0.0], [0.25], 0.5)
  quadrature = gaussian_quadrature_from_recurrence([0.0, 0.0], [0.25])
  szego = szego_recurrence([0.1 + 0.0j, -0.2 + 0.0j], 0.2 + 0.1j)
  schur = schur_function_from_parameters([0.1 + 0.0j, -0.2 + 0.0j], 0.2 + 0.1j)
  adapter = OrthogonalContinuedFractionAdapter()
  summary = adapter.unit_circle_summary([0.1 + 0.0j, -0.2 + 0.0j], 0.2 + 0.1j)

  assert simple["coefficients"]
  assert convergents[-1]["denominator"] > 0
  assert isinstance(j_fraction, complex)
  assert len(values) == 3
  assert len(quadrature["nodes"]) == 2
  assert all(weight > 0.0 for weight in quadrature["weights"])
  assert isinstance(szego["phi"], complex)
  assert isinstance(schur, complex)
  assert isinstance(summary["schur_value"], complex)


def test_engine_materializes_orthogonal_continued_fraction_techniques(tmp_path):
  test_settings = build_dev_settings(tmp_path / "data")
  initialize_database(test_settings.sqlite_path)
  engine = LibraryEngine(test_settings)

  body = (
    "Orthogonal Polynomials and Continued Fractions: From Euler's Point of View. "
    "The book covers continued fractions, Euler's theory, Stieltjes' continued fractions, "
    "orthogonal polynomials, quadrature formulas, and orthogonal polynomials on the unit circle."
  )

  with database_session(test_settings.sqlite_path) as connection:
    document = engine.ingest_seed_document(
      connection,
      title="Orthogonal Polynomials and Continued Fractions",
      source_path="seed://orthogonal-polynomials-continued-fractions",
      body=body,
      metadata={"author": "Sergey Khrushchev", "formalism": "continued fractions"},
    )
    techniques = repository.list_document_forecast_technique_details(connection, document["id"], family_key="orthogonal_polynomials_continued_fractions")

  assert techniques
  assert all(item["family_key"] == "orthogonal_polynomials_continued_fractions" for item in techniques)
  assert any(item["technique"] == "Unit-Circle Schur Parameters and Szego Recursion" for item in techniques)
  assert any(item["sources"] for item in techniques)


def test_affine_hecke_runtime_core_functions():
  reflected = type_a_affine_simple_reflection([0.0, 1.0, -1.0], 1)
  orbit = affine_weyl_orbit([0.0, 1.0, -1.0], max_steps=1)
  reduced = reduced_word_length([0, 1, 1, 2, 2, 0])
  split = rank_one_symmetrizer([1.0, 2.0, 2.0, 1.0], t=0.5)
  shifted = q_shift_parameters([0.2, 0.3, 0.4, 0.5], 0.7, steps=2)
  value = askey_wilson_polynomial(1, 0.25, 0.2, 0.3, 0.4, 0.5, 0.7)
  adapter = AffineHeckeOrthogonalAdapter()
  summary = adapter.rank_one_polynomial_summary(1, 0.25, a=0.2, b=0.3, c=0.4, d=0.5, q=0.7)

  assert reflected == [1.0, 0.0, -1.0]
  assert orbit
  assert reduced["length"] <= 6
  assert len(split["symmetric"]) == 4 and len(split["antisymmetric"]) == 4
  assert len(shifted) == 4
  assert isinstance(value, complex)
  assert isinstance(summary["askey_wilson_value"], complex)


def test_engine_materializes_affine_hecke_techniques(tmp_path):
  test_settings = build_dev_settings(tmp_path / "data")
  initialize_database(test_settings.sqlite_path)
  engine = LibraryEngine(test_settings)

  body = (
    "Affine Hecke Algebras and Orthogonal Polynomials studies affine root systems, "
    "the extended affine Weyl group, the braid group, the affine Hecke algebra, "
    "orthogonal polynomials, symmetrizers, intertwiners, shift operators, and the rank 1 Askey-Wilson case."
  )

  with database_session(test_settings.sqlite_path) as connection:
    document = engine.ingest_seed_document(
      connection,
      title="Affine Hecke Algebras and Orthogonal Polynomials",
      source_path="seed://affine-hecke-orthogonal-polynomials",
      body=body,
      metadata={"author": "I. G. Macdonald", "formalism": "affine Hecke"},
    )
    techniques = repository.list_document_forecast_technique_details(connection, document["id"], family_key="affine_hecke_orthogonal_polynomials")

  assert techniques
  assert all(item["family_key"] == "affine_hecke_orthogonal_polynomials" for item in techniques)
  assert any(item["technique"] == "Rank-One Askey-Wilson Evaluation and q-Shift Ladder" for item in techniques)
  assert any(item["sources"] for item in techniques)


def test_weak_convergence_runtime_core_functions():
  cdf = empirical_cdf([0.1, 0.3, 0.9], [0.0, 0.5, 1.0])
  kolmogorov = kolmogorov_distance([0.1, 0.3, 0.9], [0.2, 0.4, 0.8])
  bounded = bounded_lipschitz_metric_proxy([0.1, 0.3, 0.9], [0.2, 0.4, 0.8], grid_size=16)
  prokhorov = prokhorov_metric_proxy([0.1, 0.3, 0.9], [0.2, 0.4, 0.8], tolerance=0.05)
  partial = partial_sum_process([1.0, -1.0, 2.0], scale=False)
  bridge = brownian_bridge_proxy([0.1, 0.3, 0.8], [0.0, 0.5, 1.0])
  bootstrap = multiplier_bootstrap_empirical_process([0.1, 0.3, 0.8], [0.0, 0.5, 1.0], n_bootstrap=16, seed=7)
  modulus = cadlag_modulus([0.0, 0.0, 1.0], [0.0, 0.5, 1.0], delta=0.5)
  time_changed = random_time_change([0.0, 1.0, 2.0], [0.0, 1.0, 2.0], [0.5, 1.5])
  pushed = pushforward_samples([1.0, 2.0, 3.0], lambda value: value * value)
  entropy = entropy_bracketing_proxy([0.0, 0.5, 1.0], epsilon=0.2)
  estimate = argmax_m_estimator([0.0, 1.0, 2.0], [0.1, 0.9, 0.2])
  dependence = dependent_sequence_diagnostic([1.0, 1.0, 1.0], block_size=2)
  adapter = WeakConvergenceAdapter()
  summary = adapter.dependent_sequence_summary([1.0, -1.0, 2.0, -2.0], block_size=2)

  assert cdf["cdf"][-1] == 1.0
  assert kolmogorov >= 0.0
  assert bounded >= 0.0
  assert prokhorov >= 0.0
  assert partial[0] == 0.0 and len(partial) == 4
  assert bridge["sup_norm"] >= 0.0
  assert len(bootstrap["sup_norms"]) == 16
  assert modulus["modulus"] >= 0.0
  assert len(time_changed["path"]) == 2
  assert pushed == [1.0, 4.0, 9.0]
  assert entropy["covering_number"] >= 1.0
  assert estimate["argmax"] == 1.0
  assert dependence["variance"] == 0.0
  assert "partial_sum_process" in summary


def test_engine_materializes_weak_convergence_techniques(tmp_path):
  test_settings = build_dev_settings(tmp_path / "data")
  initialize_database(test_settings.sqlite_path)
  engine = LibraryEngine(test_settings)

  body = (
    "Convergence of Probability Measures. Weak convergence in metric spaces, properties of weak convergence, "
    "convergence in distribution, Prohorov's theorem, the space C, Wiener measure and Donsker's theorem, "
    "the space D, dependent variables, martingales, ergodic processes, and convergence in probability."
  )

  with database_session(test_settings.sqlite_path) as connection:
    document = engine.ingest_seed_document(
      connection,
      title="Convergence of Probability Measures",
      source_path="seed://billingsley-convergence-of-probability-measures",
      body=body,
      metadata={"author": "Patrick Billingsley", "formalism": "weak convergence"},
    )
    techniques = repository.list_document_forecast_technique_details(connection, document["id"], family_key="weak_convergence_probability_measures")

  assert techniques
  assert all(item["family_key"] == "weak_convergence_probability_measures" for item in techniques)
  assert any(item["technique"] == "Portmanteau Weak-Law Distance Screening" for item in techniques)
  assert any(item["sources"] for item in techniques)


def test_engine_materializes_empirical_process_techniques(tmp_path):
  test_settings = build_dev_settings(tmp_path / "data")
  initialize_database(test_settings.sqlite_path)
  engine = LibraryEngine(test_settings)

  body = (
    "Weak Convergence and Empirical Processes with applications to statistics. "
    "Empirical processes, Glivenko-Cantelli classes, Donsker classes, entropy, bracketing, "
    "bootstrap methods, M-estimation, and applications to statistics."
  )

  with database_session(test_settings.sqlite_path) as connection:
    document = engine.ingest_seed_document(
      connection,
      title="Weak Convergence and Empirical Processes",
      source_path="seed://vdv-wellner-weak-convergence-empirical-processes",
      body=body,
      metadata={"author": "Aad van der Vaart; Jon Wellner", "formalism": "empirical process"},
    )
    techniques = repository.list_document_forecast_technique_details(connection, document["id"], family_key="empirical_process_weak_convergence")

  assert techniques
  assert all(item["family_key"] == "empirical_process_weak_convergence" for item in techniques)
  assert any(item["technique"] == "Multiplier Bootstrap Empirical Process" for item in techniques)
  assert any(item["sources"] for item in techniques)


def test_binocular_convergence_runtime_core_functions():
  angle = convergence_angle_from_depth(1.0)
  classification = classify_metric_from_alley_discrepancy([0.2, 0.25], [0.3, 0.35])
  normalized = normalize_visual_distances([2.0, 4.0, 8.0])
  fit = fit_empirical_convergence_function([0.5, 0.4, 0.3], [1.0, 1.1, 1.4])
  adapter = BinocularConvergenceAdapter()
  summary = adapter.convergence_summary([1.0, 2.0, 4.0])

  assert angle > 0.0
  assert classification["classification"] in {"hyperbolic_proxy", "euclidean_proxy", "elliptic_proxy"}
  assert normalized["normalized"][-1] == 1.0
  assert len(fit["fitted_distances"]) == 3
  assert len(summary["angles"]) == 3


def test_engine_materializes_binocular_convergence_techniques(tmp_path):
  test_settings = build_dev_settings(tmp_path / "data")
  initialize_database(test_settings.sqlite_path)
  engine = LibraryEngine(test_settings)

  body = (
    "Convergence Function in Binocular Visual Space. The paper discusses Luneburg visual space, "
    "the convergence function r(gamma), parallel and distance alley experiments, and normalization "
    "of visual distance by the far point."
  )

  with database_session(test_settings.sqlite_path) as connection:
    document = engine.ingest_seed_document(
      connection,
      title="Convergence Function in Binocular Visual Space",
      source_path="seed://shipley-binocular-convergence",
      body=body,
      metadata={"author": "Thorne Shipley", "formalism": "binocular geometry"},
    )
    techniques = repository.list_document_forecast_technique_details(connection, document["id"], family_key="binocular_convergence_geometry")

  assert techniques
  assert all(item["family_key"] == "binocular_convergence_geometry" for item in techniques)
  assert any(item["technique"] == "Empirical Convergence-Function Fitting" for item in techniques)
  assert any(item["sources"] for item in techniques)


def test_combinatorial_topology_runtime_core_functions():
  cover = [{1, 2, 3}, {2, 3}, {3, 4}]
  nerve = nerve_complex(cover)
  dimension = covering_dimension_upper_bound(cover)
  subdivision = barycentric_subdivision([[0, 1, 2]])
  boundary = boundary_matrix_mod2([[0, 1], [1, 2], [0, 2]], 1)
  homology = betti_numbers_mod2([[0, 1], [1, 2], [0, 2]])
  chi = euler_characteristic([[0, 1, 2]])
  star = star_of_simplex([[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]], [0])
  link = link_of_simplex([[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]], [0])
  orientable = orientability_summary([[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]])
  manifold = homological_manifold_screen([[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]])
  lefschetz = simplicial_lefschetz_number([[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]], {0: 0, 1: 1, 2: 2, 3: 3})
  adapter = CombinatorialTopologyAdapter()
  summary = adapter.fixed_point_summary([[0, 1, 2]], {0: 0, 1: 1, 2: 2})

  assert nerve["dimension_upper_bound"] == 1
  assert dimension["dimension_upper_bound"] == 1
  assert len(subdivision["maximal_simplices"]) == 6
  assert len(boundary["matrix"]) == 3
  assert homology["betti_numbers"] == [1, 1]
  assert chi == 1
  assert len(star["maximal_simplices"]) == 3
  assert betti_numbers_mod2(link["maximal_simplices"])["betti_numbers"] == [1, 1]
  assert orientable["orientable"] is True
  assert manifold["homological_manifold_like"] is True
  assert lefschetz["lefschetz_number"] == 2
  assert summary["lefschetz_number"] == 1


def test_engine_materializes_alexandrov_combinatorial_topology_techniques(tmp_path):
  test_settings = build_dev_settings(tmp_path / "data")
  initialize_database(test_settings.sqlite_path)
  engine = LibraryEngine(test_settings)

  body = (
    "Combinatorial Topology by P. S. Aleksandrov. Volume 1 covers complexes, the nerve of a finite "
    "system of sets, barycentric subdivisions, Sperner's lemma, fixed point theorems, and dimension theory. "
    "Volume 2 covers chains, the operator A, Betti groups, the operator V, invariance of the Betti groups, "
    "and relative cycles. Volume 3 covers homological manifolds, the Poincare duality, the Alexander-Pontryagin "
    "duality, linking, the Brouwer theory of continuous mappings, and the Lefschetz number for fixed points."
  )

  with database_session(test_settings.sqlite_path) as connection:
    document = engine.ingest_seed_document(
      connection,
      title="Combinatorial Topology",
      source_path="seed://alexandrov-combinatorial-topology",
      body=body,
      metadata={"author": "P. S. Aleksandrov", "formalism": "combinatorial topology"},
    )
    techniques = repository.list_document_forecast_technique_details(connection, document["id"], family_key="alexandrov_combinatorial_topology")

  assert techniques
  assert all(item["family_key"] == "alexandrov_combinatorial_topology" for item in techniques)
  assert any(item["technique"] == "Boundary Operator and Mod-2 Betti Group Computation" for item in techniques)
  assert any(item["sources"] for item in techniques)


def test_helsinki_icm_runtime_core_functions():
  dilog = bloch_wigner_dilog(0.5 + 0.25j)
  regulator = regulator_sum_cross_ratios([0.5 + 0.25j, 0.2 + 0.1j], weights=[1.0, -0.5])
  instability = bogomolov_instability_screen(2, 1.0, -0.25)
  invariance = invariance_principle_window([0.1, -0.2, 0.3, -0.1, 0.2, -0.3], n_reference=12, seed=7)
  ito_value = ito_integral_left_sum([1.0, 1.0, 1.0], [0.0, 0.2, 0.5, 0.9])
  sde = euler_maruyama_path(1.0, lambda x, t: 0.0, lambda x, t: 0.0, horizon=1.0, steps=8, seed=7)
  resonance = normal_form_resonance_summary([1.0, -1.0], max_degree=2, tolerance=1e-9)
  feedback = finite_horizon_optimal_feedback([[0, 1], [0, 1]], [[0.0, 1.0], [0.5, 0.0]], [0.0, 0.0], horizon=2)
  interpolation = compare_interpolation_node_families(6)
  interp_value = barycentric_interpolate([-1.0, 0.0, 1.0], [1.0, 0.0, 1.0], 0.5)
  shapley = shapley_value({
    tuple(): 0.0,
    (1,): 0.0,
    (2,): 0.0,
    (3,): 0.0,
    (1, 2): 1.0,
    (1, 3): 1.0,
    (2, 3): 1.0,
    (1, 2, 3): 1.0,
  })
  adapter = HelsinkiICMAdapter()
  coalition = adapter.coalition_summary({
    tuple(): 0.0,
    (1,): 0.0,
    (2,): 0.0,
    (1, 2): 1.0,
  })

  assert abs(bloch_wigner_dilog(0.0)) < 1e-12
  assert isinstance(dilog, float)
  assert isinstance(regulator["regulator_sum"], float)
  assert instability["instability_flag"] is True
  assert invariance["path_sup_norm"] >= 0.0
  assert invariance["reference_sup_norms"] == sorted(invariance["reference_sup_norms"])
  assert abs(ito_value - 0.9) < 1e-12
  assert sde == [1.0] * 9
  assert resonance["counts_by_degree"][2] >= 1
  assert feedback["policies"][0][0] == 0
  assert interpolation["chebyshev_lebesgue_proxy"] < interpolation["equispaced_lebesgue_proxy"]
  assert abs(interp_value - 0.25) < 1e-12
  assert all(abs(value - (1.0 / 3.0)) < 1e-12 for value in shapley.values())
  assert coalition[1] == coalition[2] == 0.5


def test_engine_materializes_helsinki_icm_selected_methods(tmp_path):
  test_settings = build_dev_settings(tmp_path / "data")
  initialize_database(test_settings.sqlite_path)
  engine = LibraryEngine(test_settings)

  body = (
    "Proceedings of the International Congress of Mathematicians, Helsinki 1978. "
    "Volume 2 includes Algebraic K-Theory and Zeta Functions of Elliptic Curves, "
    "Unstable Vector Bundles and Curves on Surfaces, Rate of Convergence and Large Deviations in Invariance Principle, "
    "Un Survol de la Theorie de l'Integrale Stochastique, Formal and Analytical Integral Sets, "
    "On the Structure of Optimal Feedback Systems, Polynomial Interpolation, and Recent Developments in the Theory of the Shapley Value."
  )

  with database_session(test_settings.sqlite_path) as connection:
    document = engine.ingest_seed_document(
      connection,
      title="Proceedings of the International Congress of Mathematicians Helsinki 1978 Volume 2",
      source_path="seed://helsinki-icm-1978-volume-2",
      body=body,
      metadata={"editor": "Olli Lehto", "formalism": "conference proceedings"},
    )
    techniques = repository.list_document_forecast_technique_details(connection, document["id"], family_key="helsinki_icm_selected_methods")

  assert techniques
  assert all(item["family_key"] == "helsinki_icm_selected_methods" for item in techniques)
  assert any(item["technique"] == "Finite-Horizon Optimal Feedback Surface" for item in techniques)
  assert any(item["technique"] == "Exact Shapley Value Attribution and Coalition Sensitivity" for item in techniques)
  assert any(item["sources"] for item in techniques)


def test_information_theoretic_learning_runtime_core_functions():
  entropy = quadratic_renyi_entropy([0.1, 0.2, 0.25, 0.35], 0.2)
  ip = information_potential([0.1, 0.2, 0.25, 0.35], 0.2)
  cross_ip = cross_information_potential([0.1, 0.2, 0.25], [0.15, 0.22, 0.4], 0.2)
  divergence = cauchy_schwarz_divergence([0.1, 0.2, 0.25], [0.15, 0.22, 0.4], 0.2)
  similarity = correntropy([1.0, 2.0, 3.0], [1.0, 2.1, 2.9], 0.5)
  metric = correntropy_induced_metric([1.0, 2.0, 3.0], [1.0, 2.1, 2.9], 0.5)
  lag_summary = lagged_correntropy([1.0, 0.5, -0.1, 0.3, 0.9], max_lag=3, sigma=0.6)
  spectrum = correntropy_spectrum_proxy([1.0, 0.5, -0.1, 0.3, 0.9], max_lag=3, sigma=0.6)
  kernel = pdf_kernel_matrix([[0.1, 0.2, 0.3], [0.15, 0.25, 0.35]], 0.2)
  design = [[1.0, 0.0], [1.0, 1.0], [1.0, 2.0], [1.0, 3.0]]
  response = [1.0, 2.0, 3.0, 4.0]
  mcc_fit = mcc_linear_regression(design, response, sigma=0.8, step_size=0.02, epochs=40)
  mee_fit = mee_linear_regression(design, response, sigma=0.8, step_size=0.005, epochs=20)
  adapter = InformationTheoreticLearningAdapter()
  summary = adapter.process_dependence_summary([1.0, 0.5, -0.1, 0.3, 0.9], sigma=0.6, max_lag=3)

  assert entropy >= 0.0
  assert 0.0 < ip <= 1.0
  assert cross_ip > 0.0
  assert divergence >= 0.0
  assert 0.0 < similarity <= 1.0
  assert metric >= 0.0
  assert lag_summary["lags"][0] == 0
  assert len(spectrum["frequencies"]) == len(spectrum["spectrum"])
  assert kernel[0][1] == kernel[1][0]
  assert len(mcc_fit["coefficients"]) == 2
  assert len(mee_fit["coefficients"]) == 2
  assert summary["lagged_correntropy"]["lags"][0] == 0


def test_engine_materializes_information_theoretic_learning_techniques(tmp_path):
  test_settings = build_dev_settings(tmp_path / "data")
  initialize_database(test_settings.sqlite_path)
  engine = LibraryEngine(test_settings)

  body = (
    "Information Theoretic Learning by Jose C. Principe. Renyi's entropy, divergence, and nonparametric estimators. "
    "Adaptive information filtering with error entropy and correntropy criteria. Algorithms for entropy and correntropy adaptation. "
    "Classification using divergence measures, clustering, kernels on PDFs, correntropy, and correntropy for random processes."
  )

  with database_session(test_settings.sqlite_path) as connection:
    document = engine.ingest_seed_document(
      connection,
      title="Information Theoretic Learning: Renyi's Entropy and Kernel Perspectives",
      source_path="seed://principe-information-theoretic-learning",
      body=body,
      metadata={"author": "Jose C. Principe", "formalism": "information theoretic learning"},
    )
    techniques = repository.list_document_forecast_technique_details(connection, document["id"], family_key="information_theoretic_learning")

  assert techniques
  assert all(item["family_key"] == "information_theoretic_learning" for item in techniques)
  assert any(item["technique"] == "Maximum Correntropy Criterion Linear Adaptation" for item in techniques)
  assert any(item["sources"] for item in techniques)


def test_bayesian_networks_runtime_core_functions():
  parents = {"Rain": [], "Market": ["Rain"]}
  cpts = {
    "Rain": {(): {"High": 0.3, "Low": 0.7}},
    "Market": {
      ("High",): {"Up": 0.8, "Down": 0.2},
      ("Low",): {"Up": 0.4, "Down": 0.6},
    },
  }
  posterior = posterior_query("Rain", {"Market": "Up"}, parents, cpts)
  blocked = d_separated("X", "Z", ["Y"], {"X": [], "Y": ["X"], "Z": ["Y"]})
  updated = dirichlet_update_cpt({(): {"High": 2.0, "Low": 1.0}}, prior_alpha=1.0)
  learned = sequential_cpt_update(
    [{"Rain": "High", "Market": "Up"}, {"Rain": "Low", "Market": "Down"}, {"Rain": "Low", "Market": "Up"}],
    parents=parents,
    states={"Rain": ["High", "Low"], "Market": ["Up", "Down"]},
    prior_alpha=1.0,
  )
  conflict = evidence_conflict_score({"Market": "Up"}, parents, cpts)
  decision = optimal_decision({"Boom": 0.6, "Bust": 0.4}, {"Buy": {"Boom": 3.0, "Bust": -2.0}, "Wait": {"Boom": 1.0, "Bust": 0.0}})
  voi = expected_value_of_information(
    {"Boom": 0.6, "Bust": 0.4},
    {"Buy": {"Boom": 3.0, "Bust": -2.0}, "Wait": {"Boom": 1.0, "Bust": 0.0}},
    {"Boom": {"Good": 0.8, "Bad": 0.2}, "Bust": {"Good": 0.3, "Bad": 0.7}},
  )
  perfect = value_of_perfect_information(
    {"Boom": 0.6, "Bust": 0.4},
    {"Buy": {"Boom": 3.0, "Bust": -2.0}, "Wait": {"Boom": 1.0, "Bust": 0.0}},
  )
  adapter = BayesianNetworksAdapter()
  summary = adapter.inference_summary("Rain", {"Market": "Up"}, parents, cpts)

  assert abs(sum(posterior.values()) - 1.0) < 1e-12
  assert blocked is True
  assert abs(sum(updated[()].values()) - 1.0) < 1e-12
  assert "Rain" in learned and "Market" in learned
  assert conflict["conflict_score"] >= 0.0
  assert decision["best_action"] in {"Buy", "Wait"}
  assert voi["value_of_information"] >= -1e-12
  assert perfect >= -1e-12
  assert abs(sum(summary["posterior"].values()) - 1.0) < 1e-12


def test_engine_materializes_bayesian_networks_and_influence_diagrams(tmp_path):
  test_settings = build_dev_settings(tmp_path / "data")
  initialize_database(test_settings.sqlite_path)
  engine = LibraryEngine(test_settings)

  body = (
    "Bayesian Networks and Influence Diagrams: A Guide to Construction and Analysis. "
    "Bayesian probability theory, Bayesian networks, d-separation, influence diagrams, model construction, "
    "learning, sequential adaptation, conflict analysis, sensitivity analysis, and value of information."
  )

  with database_session(test_settings.sqlite_path) as connection:
    document = engine.ingest_seed_document(
      connection,
      title="Bayesian Networks and Influence Diagrams: A Guide to Construction and Analysis",
      source_path="seed://kjaerulff-madsen-bn-id",
      body=body,
      metadata={"author": "Uffe B. Kjaerulff; Anders L. Madsen", "formalism": "bayesian networks"},
    )
    techniques = repository.list_document_forecast_technique_details(connection, document["id"], family_key="bayesian_networks_influence_diagrams")

  assert techniques
  assert all(item["family_key"] == "bayesian_networks_influence_diagrams" for item in techniques)
  assert any(item["technique"] == "Exact Posterior Inference by Enumeration" for item in techniques)
  assert any(item["sources"] for item in techniques)


def test_information_geometry_runtime_core_functions():
  kl_value = kl_divergence_discrete([0.4, 0.6], [0.5, 0.5])
  distance = fisher_rao_distance_discrete([0.4, 0.6], [0.5, 0.5])
  midpoint = simplex_geodesic_interpolate([0.4, 0.6], [0.5, 0.5], 0.5)
  barycenter = fisher_rao_barycenter([[0.4, 0.6], [0.5, 0.5]], [0.25, 0.75])
  flow = natural_gradient_flow([0.4, 0.6], lambda p: [1.0 - p[0], -1.0 + p[0]], step_size=0.1, steps=6)
  posterior = entropy_regularized_bayes_update([0.5, 0.5], [0.0, 1.0], temperature=1.0)
  search = geodesic_black_box_search(lambda p: p[0], [0.4, 0.6], steps=8, seed=7)
  regression = geodesic_lognormal_regression([0.0, 1.0, 2.0], [1.0, 2.0, 4.0], iterations=200, step_size=0.02)
  adapter = InformationGeometryAdapter()
  metric_summary = adapter.metric_summary([0.4, 0.6], [0.5, 0.5])

  assert kl_value >= 0.0
  assert distance >= 0.0
  assert abs(sum(midpoint) - 1.0) < 1e-12
  assert abs(sum(barycenter) - 1.0) < 1e-12
  assert len(flow["path"]) == 7
  assert abs(sum(posterior) - 1.0) < 1e-12
  assert len(search["trajectory"]) == 9
  assert regression["geodesic_log_loss"] >= 0.0
  assert metric_summary["fisher_rao_distance"] >= 0.0


def test_engine_materializes_information_geometry_methods(tmp_path):
  test_settings = build_dev_settings(tmp_path / "data")
  initialize_database(test_settings.sqlite_path)
  engine = LibraryEngine(test_settings)

  body = (
    "Information Entropy and Their Geometric Structures. Geometry of Fisher Information Metric and the Barycenter Map. "
    "Natural Gradient Flow in the Mixture Geometry of a Discrete Exponential Family. "
    "Black-Box Optimization Using Geodesics in Statistical Manifolds. "
    "A New Robust Regression Method Based on Minimization of Geodesic Distances on a Probabilistic Manifold. "
    "Methods of Information Geometry by Amari and Nagaoka."
  )

  with database_session(test_settings.sqlite_path) as connection:
    document = engine.ingest_seed_document(
      connection,
      title="Information Entropy and Their Geometric Structures",
      source_path="seed://information-entropy-geometric-structures",
      body=body,
      metadata={"editorial_context": "Entropy special issue", "formalism": "information geometry"},
    )
    techniques = repository.list_document_forecast_technique_details(connection, document["id"], family_key="information_geometry_methods")

  assert techniques
  assert all(item["family_key"] == "information_geometry_methods" for item in techniques)
  assert any(item["technique"] == "Natural Gradient Flow on the Simplex" for item in techniques)
  assert any(item["sources"] for item in techniques)


def test_hilbert_bayesian_coresets_runtime_core_functions():
  vectors = [[1.0, 0.0], [0.8, 0.2], [0.0, 1.0]]
  diagnostics = coreset_alignment_diagnostics(vectors)
  is_coreset = hilbert_importance_sampling_coreset(vectors, 8, seed=7)
  fw_coreset = hilbert_frank_wolfe_coreset(vectors, 5)
  l2_projection = random_projection_l2([[1.0, 2.0, 3.0], [0.5, 1.5, 2.5]])
  fisher_projection = random_projection_fisher(
    [
      [[1.0, 0.0], [0.5, 0.2], [0.1, 0.3]],
      [[0.8, 0.1], [0.4, 0.4], [0.2, 0.2]],
    ],
    [0, 1, 0],
  )
  merged = merge_distributed_coreset_weights([[1.0, 0.0, 0.5], [0.0, 0.5, 0.5]])
  loglik = predictive_loglikelihood_average([[0.0, -1.0, -0.5], [-0.1, -0.8, -0.4]])
  w1 = wasserstein_1d([0.0, 1.0, 2.0], [0.0, 1.5, 2.5])
  mean_w = mean_coordinate_wasserstein([[0.0, 1.0], [1.0, 2.0]], [[0.0, 1.1], [1.2, 1.9]])
  generic = bayesian_hilbert_coreset(vectors, 4, method="fw")
  adapter = HilbertBayesianCoresetAdapter()
  eval_summary = adapter.evaluate([[0.0, -1.0], [-0.2, -0.8]], [[0.0, 1.0], [1.0, 2.0]], [[0.1, 0.9], [1.1, 2.1]])

  assert diagnostics["sigma"] > 0.0
  assert is_coreset["residual_norm"] >= 0.0
  assert fw_coreset["residual_norm"] >= 0.0
  assert len(fw_coreset["trajectory"]) == 5
  assert len(l2_projection[0]) == 3
  assert len(fisher_projection[0]) == 3
  assert merged == [1.0, 0.5, 1.0]
  assert math.isfinite(loglik["mean_predictive_loglikelihood"])
  assert w1 >= 0.0
  assert mean_w >= 0.0
  assert generic["method"] == "fw"
  assert eval_summary["mean_coordinate_wasserstein"] >= 0.0


def test_engine_materializes_hilbert_bayesian_coresets(tmp_path):
  test_settings = build_dev_settings(tmp_path / "data")
  initialize_database(test_settings.sqlite_path)
  engine = LibraryEngine(test_settings)

  body = (
    "Automated Scalable Bayesian Inference via Hilbert Coresets. "
    "Coresets as sparse vector sum approximation. Hilbert coresets via importance sampling. "
    "Coreset construction via Frank-Wolfe. Distributed coreset construction. "
    "Norms and random projection. Bayesian Hilbert coresets with random projection. "
    "Synthetic evaluation and experiments using negative test log-likelihood and Wasserstein distance."
  )

  with database_session(test_settings.sqlite_path) as connection:
    document = engine.ingest_seed_document(
      connection,
      title="Automated Scalable Bayesian Inference via Hilbert Coresets",
      source_path="seed://campbell-broderick-hilbert-coresets-1710-05053",
      body=body,
      metadata={"author": "Trevor Campbell; Tamara Broderick", "formalism": "bayesian coresets"},
    )
    techniques = repository.list_document_forecast_technique_details(connection, document["id"], family_key="hilbert_bayesian_coresets")

  assert techniques
  assert all(item["family_key"] == "hilbert_bayesian_coresets" for item in techniques)
  assert any(item["technique"] == "Hilbert Coreset Construction via Frank-Wolfe" for item in techniques)
  assert any(item["sources"] for item in techniques)


def test_hpc_mpi_runtime_core_functions():
  status = mpi_dependency_status()
  adapter = HPCMPIDataScienceAdapter()

  assert amdahl_speedup(0.1, 8) > 1.0
  assert gustafson_scaled_speedup(0.1, 8) > amdahl_speedup(0.1, 8)
  assert iso_efficiency_required_work(24.0, target_efficiency=0.75) > 0.0

  scaling = scalability_diagnostics(serial_time=100.0, parallel_time=20.0, processors=4, serial_fraction=0.2, overhead=15.0)
  io_risk = parallel_io_risk_score(8.0e9, 1.0e9, 10.0)
  collectives = collective_roundtrip(2.0, root_payload=[2.0])
  barrier = timed_barrier()
  deadlock = deadlock_risk_diagnostics([(0, 1), (1, 0)])

  assert scaling["speedup"] == 5.0
  assert io_risk["risk_level"] in {"low", "moderate", "high"}
  assert collectives["allreduce_sum"] == 2.0
  assert barrier["barrier_seconds"] >= 0.0
  assert deadlock["has_deadlock_cycle"] is True

  gray = gray_code(5)
  assert gray_to_binary(gray) == 5
  assert len(ring_pipeline_broadcast_steps(4, root=0)) == 3
  assert len(hypercube_broadcast_steps(3, root=0)) == 3

  assert odd_even_transposition_sort([5.0, 1.0, 4.0, 2.0]) == [1.0, 2.0, 4.0, 5.0]
  assert bitonic_merge_sort([5.0, 1.0, 4.0, 2.0]) == [1.0, 2.0, 4.0, 5.0]
  assert hyperquicksort_sort([[9.0, 3.0], [8.0, 1.0], [7.0, 2.0], [6.0, 4.0]])["sorted_values"] == [1.0, 2.0, 3.0, 4.0, 6.0, 7.0, 8.0, 9.0]
  assert psrs_sort([[9.0, 1.0], [8.0, 2.0], [7.0, 3.0], [6.0, 4.0]])["sorted_values"] == [1.0, 2.0, 3.0, 4.0, 6.0, 7.0, 8.0, 9.0]

  matvec = distributed_matrix_vector_product([[1.0, 2.0], [3.0, 4.0]], [1.0, 1.0])
  cannon = cannon_matrix_product([[1.0, 2.0], [3.0, 4.0]], [[1.0, 0.0], [0.0, 1.0]], grid_size=2)
  fox = fox_matrix_product([[1.0, 2.0], [3.0, 4.0]], [[1.0, 0.0], [0.0, 1.0]], grid_size=2)
  snyder = snyder_matrix_product([[1.0, 2.0], [3.0, 4.0]], [[1.0, 0.0], [0.0, 1.0]], grid_size=2)

  assert matvec["global_result"] == [3.0, 7.0]
  assert cannon == [[1.0, 2.0], [3.0, 4.0]]
  assert fox == [[1.0, 2.0], [3.0, 4.0]]
  assert snyder == [[1.0, 2.0], [3.0, 4.0]]

  totals = mpi_mapreduce(
    ["a", "b", "a"],
    map_fn=lambda record: [(record, 1.0)],
    reduce_fn=lambda _key, values: sum(values),
  )
  assert totals["a"] == 2.0
  assert totals["b"] == 1.0

  kmeans = parallel_kmeans([[0.0, 0.0], [0.1, 0.0], [5.0, 5.0], [5.1, 5.0]], 2, iterations=5, seed=7)
  clustering = evaluate_clustering([0, 0, 1, 1], kmeans["assignments"])
  tree = ward_hierarchical_clustering([[0.0], [0.1], [5.0], [5.1]])
  flat = cut_dendrogram(tree["merges"], tree["n_samples"], 2)

  assert len(kmeans["centroids"]) == 2
  assert clustering["rand_index"] >= 0.0
  assert len(flat) == 4

  predictions = distributed_knn_predict([[0.0], [1.0], [10.0]], [0, 0, 1], [[0.2], [9.9]], k=1)
  cls_metrics = classification_metrics([0, 1], predictions)

  assert predictions == [0, 1]
  assert cls_metrics["accuracy"] == 1.0

  ball = smallest_enclosing_ball_coreset([[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]], epsilon=0.25)
  coreset = kmeans_coreset_d2_sampling([[0.0, 0.0], [1.0, 0.0], [5.0, 5.0], [6.0, 5.0]], sample_size=2, seed=7)
  projected = johnson_lindenstrauss_projection([[0.0, 1.0], [1.0, 0.0]], target_dim=2, seed=7)

  assert ball["radius"] >= 0.0
  assert len(coreset["selected_indices"]) >= 1
  assert len(projected[0]) == 2

  dense = densest_subgraph_greedy(4, [(0, 1), (1, 2), (2, 0), (2, 3)])
  frontier = partition_search_frontier(list(range(6)))
  matches = subgraph_isomorphism_search({0: [1], 1: [0]}, {0: [1], 1: [0], 2: []}, max_matches=1)

  assert dense["density"] > 0.0
  assert frontier == [0, 1, 2, 3, 4, 5]
  assert matches

  script = build_sbatch_template(job_name="forecast-batch", command="python worker.py", tasks=4, nodes=2, partition="compute")
  assert "#SBATCH --job-name=forecast-batch" in script
  assert "python worker.py" in script

  if status["mpi4py_available"] and status["launcher_available"]:
    command = build_mpiexec_command("worker.py", ranks=2)
    assert "worker.py" in command
  else:
    with pytest.raises(ServiceDependencyError):
      build_mpiexec_command("worker.py", ranks=2)

  assert adapter.dependency_status()["mpi4py_available"] == status["mpi4py_available"]
  assert adapter.scalability(serial_time=10.0, parallel_time=5.0, processors=2)["speedup"] == 2.0


def test_engine_materializes_hpc_mpi_data_science(tmp_path):
  test_settings = build_dev_settings(tmp_path / "data")
  initialize_database(test_settings.sqlite_path)
  engine = LibraryEngine(test_settings)

  body = (
    "Introduction to HPC with MPI for Data Science. Amdahl's law, Gustafson's law, and parallel I/O. "
    "Broadcast, scatter, gather, reduce, allreduce, scan, and deadlocks. "
    "Ring topology, hypercube, and Gray code. HyperQuickSort, PSRS, Cannon's algorithm, Fox's algorithm, and Snyder's algorithm. "
    "MapReduce in MPI. Parallel k-means, hierarchical clustering, k-NN on a computer cluster. "
    "Core-sets, Johnson-Lindenstrauss random projection, densest sub-graph heuristics, subgraph isomorphism, and SLURM."
  )

  with database_session(test_settings.sqlite_path) as connection:
    document = engine.ingest_seed_document(
      connection,
      title="Introduction to HPC with MPI for Data Science",
      source_path="seed://nielsen-hpc-mpi-data-science",
      body=body,
      metadata={"author": "Frank Nielsen", "formalism": "hpc mpi"},
    )
    techniques = repository.list_document_forecast_technique_details(connection, document["id"], family_key="hpc_mpi_data_science")

  assert techniques
  assert all(item["family_key"] == "hpc_mpi_data_science" for item in techniques)
  assert len(techniques) >= 10
  assert any(item["technique"] == "Parallel k-Means Clustering with Model Selection and Partition Evaluation" for item in techniques)
  assert any(item["sources"] for item in techniques)


def test_hpc_mpi_mpiexec_integration_if_available():
  status = mpi_dependency_status()
  if not status["mpi4py_available"] or not status["launcher_available"]:
    pytest.skip("mpi4py or mpiexec not available in the local environment.")

  launcher = shutil.which("mpiexec") or shutil.which("mpirun")
  assert launcher is not None

  code = """
from app.hpc_mpi_data_science_runtime import collective_roundtrip, distributed_matrix_vector_product, parallel_kmeans
from mpi4py import MPI
comm = MPI.COMM_WORLD
rank = comm.Get_rank()
collectives = collective_roundtrip(float(rank + 1), root_payload=[1.0, 2.0] if rank == 0 else None, comm=comm)
local_rows = [[1.0, 2.0]] if rank == 0 else [[3.0, 4.0]]
matvec = distributed_matrix_vector_product(local_rows, [1.0, 1.0] if rank == 0 else None, comm=comm)
points = [[0.0, 0.0], [0.1, 0.0]] if rank == 0 else [[5.0, 5.0], [5.1, 5.0]]
kmeans = parallel_kmeans(points, 2, iterations=4, seed=7, comm=comm)
if rank == 0:
    assert collectives["reduce_sum"] == 3.0
    assert matvec["global_result"] == [3.0, 7.0]
    assert len(kmeans["centroids"]) == 2
print(f"rank={rank}")
"""
  env = dict(**__import__("os").environ)
  existing = env.get("PYTHONPATH", "")
  env["PYTHONPATH"] = f"backend\\_vendor;backend{(';'+existing) if existing else ''}"
  result = subprocess.run(
    [launcher, "-n", "2", sys.executable, "-c", code],
    capture_output=True,
    text=True,
    cwd=str(Path(__file__).resolve().parents[2]),
    env=env,
    check=False,
  )

  assert result.returncode == 0, result.stderr or result.stdout
  assert "rank=0" in result.stdout
  assert "rank=1" in result.stdout


def test_engine_provider_status_reports_market_data(tmp_path):
  test_settings = build_dev_settings(tmp_path / "data")
  initialize_database(test_settings.sqlite_path)
  engine = LibraryEngine(test_settings)

  providers = engine.provider_status()

  assert "market_data" in providers
  assert providers["market_data"]["name"]


def test_coreydigs_triangulation_and_sync_payload(tmp_path):
  test_settings = build_dev_settings(tmp_path / "data")
  initialize_database(test_settings.sqlite_path)
  engine = LibraryEngine(test_settings)

  body = (
    "Misconceptions and Clickbait. According to a court filing dated 2024-08-17, vaccine passport rules expanded. "
    "The report also mentions CDC guidance and policy records. "
    "This is how I navigate repeated narrative clusters and duplicate headlines."
  )

  with database_session(test_settings.sqlite_path) as connection:
    document = engine.ingest_seed_document(
      connection,
      title="Misconceptions and Clickbait",
      source_path="C:/CoreyDigs/6-Misconceptions-and-Clickbait.pdf",
      body=body,
      metadata={"author": "CoreyDigs"},
    )
    documents = repository.list_documents(connection)
    nodes_by_document = {
      document["id"]: repository.list_nodes_by_document(connection, document["id"]),
    }
    payload = build_dossier_sync_payload(documents, nodes_by_document, document_limit=20, assertion_limit_per_document=8)

  assert payload["assertions"]
  first = payload["assertions"][0]
  assert first["payload"]["triangulation"]["primary_backing_score"] > 0.0
  assert payload["summary"]["triangulated_assertion_count"] >= 1
  assert payload["signal_windows"]


def test_coreydigs_event_features_are_primary_backing_gated():
  triangulation = triangulate_primary_references(
    "According to a court filing and CDC report, the controversy widened on 2024-08-17.",
    context_text="The filing references public health policy records.",
  )
  assert triangulation["counts"]["court_document"] >= 1
  assert triangulation["counts"]["government_or_ngo_record"] >= 1

  assertions = [
    {
      "topic_tags": ["public_health", "legal_rights"],
      "is_dated": True,
      "asserted_at": "2024-08-17T00:00:00+00:00",
      "payload": {
        "evidence_density": 0.6,
        "headline_body_discrepancy": 0.4,
        "duplicate_document_ids": ["a", "b"],
        "primary_backing_score": 0.7,
      },
    },
    {
      "topic_tags": ["media_narrative"],
      "is_dated": False,
      "asserted_at": None,
      "payload": {
        "evidence_density": 0.2,
        "headline_body_discrepancy": 0.5,
        "duplicate_document_ids": ["c"],
        "primary_backing_score": 0.1,
      },
    },
  ]
  windows = [
    {"window_date": "2024-08-17", "topic_key": "all", "signal_key": "assertion_density", "value": 2},
    {"window_date": "2024-08-17", "topic_key": "all", "signal_key": "evidence_density", "value": 0.4},
    {"window_date": "2024-08-17", "topic_key": "all", "signal_key": "clickbait_risk", "value": 0.45},
    {"window_date": "2024-08-17", "topic_key": "all", "signal_key": "primary_backing_score", "value": 0.55},
    {"window_date": "2024-08-17", "topic_key": "public_health", "signal_key": "vaccine_public_health_pressure", "value": 0.7},
    {"window_date": "2024-08-17", "topic_key": "legal_rights", "signal_key": "legal_rights_pressure", "value": 0.65},
    {"window_date": "2024-08-17", "topic_key": "media_narrative", "signal_key": "narrative_volatility", "value": 0.5},
  ]
  context = build_dossier_context(assertions=assertions, signal_windows=windows)
  features = build_event_dossier_features(
    {
      "event_at": "2024-08-20T00:00:00+00:00",
      "title": "Vaccine passport challenge update",
      "summary": "Legal rights pressure and public health controversy remain elevated.",
      "press_release_text": "The policy update triggered more reporting.",
    },
    context,
  )

  assert features["dossier.primary_backing_score"] > 0.0
  assert features["dossier.vaccine_public_health_pressure"] > 0.0
  assert abs(dossier_rule_prediction({"features": features}, "post_release_response")) <= 0.035


def test_engine_syncs_dossiers_and_injects_candidate(tmp_path):
  test_settings = build_dev_settings(tmp_path / "data")
  initialize_database(test_settings.sqlite_path)
  engine = LibraryEngine(test_settings)

  dossier_body = (
    "Misconceptions and Clickbait. According to a court filing dated 2026-03-04, vaccine-passport litigation widened. "
    "CDC guidance and public health records were cited in the report."
  )

  class FakeMarketProvider:
    name = "fake_yfinance"
    is_fallback = False
    ready = True

    def check_ready(self):
      return (True, "mock")

    def fetch_market_bundle(self, **_kwargs):
      return build_fake_market_bundle()

  with database_session(test_settings.sqlite_path) as connection:
    engine.ingest_seed_document(
      connection,
      title="Misconceptions and Clickbait",
      source_path="C:/CoreyDigs/6-Misconceptions-and-Clickbait.pdf",
      body=dossier_body,
      metadata={"author": "CoreyDigs"},
    )
    synced = engine.sync_dossier_assertions(connection, {})
    assert synced["summary"]["stored_assertion_count"] >= 1

    repository.upsert_pharma_events(
      connection,
      [
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
        }
      ],
    )
    engine.market_data_provider = FakeMarketProvider()
    result = engine.run_pharma_cycle(
      connection,
      {
        "symbols": ["VRTX"],
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
        "include_dossier_signals": True,
      },
      user_id="tester",
    )

  assert result["cycle"]["id"]
  assert result["cycle"]["dataset_summary"]["dossier_assertion_count"] >= 1
  assert any(item["family_key"] == "coreydigs_investigative_dossiers" for item in result["candidates"])


def test_market_analysis_runtime_builds_green_triad():
  greeks = black_scholes_greeks(
    spot=100.0,
    strike=100.0,
    time_to_expiry=30.0 / 365.25,
    volatility=0.2,
    risk_free_rate=0.0,
    option_type="call",
  )
  assert greeks["gamma"] > 0.0

  bundle = {
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
  request = {
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

  result = analyze_market_bundle(bundle, request)
  adapter = MarketGreenTriadAdapter()
  adapter_result = adapter.analyze_bundle(bundle, request)

  assert result["options_surface"]["vertex_count"] > 0
  assert result["temporal_regime"]["vertex_count"] > 0
  assert result["cross_symbol"]["vertex_count"] == 2
  assert result["thermodynamics"]["aggregate"]["partition_function"] > 0.0
  assert result["casimir_euler"]["aggregate"]["euler_grade"] >= 0.0
  assert "signals" in adapter_result


def test_biopharmcatalyst_listing_parser_extracts_event_rows():
  html = """
  <html><body>
    <table>
      <tr>
        <td>Mar 10, 2026</td>
        <td>Vertex Pharmaceuticals (VRTX) positive Phase 3 rare disease data</td>
        <td><a href="/news/vrtx-phase3">Press release</a></td>
      </tr>
      <tr>
        <td>Mar 05, 2026</td>
        <td>Alnylam Pharmaceuticals (ALNY) follow-on offering</td>
        <td><a href="/news/alny-offering">Press release</a></td>
      </tr>
    </table>
  </body></html>
  """

  items = parse_biopharmcatalyst_listing_html(html, base_url="https://www.biopharmcatalyst.com", requested_symbols={"VRTX", "ALNY"}, limit=10)

  assert len(items) == 2
  assert items[0]["ticker"] in {"VRTX", "ALNY"}
  assert any(item["event_type"] == "clinical" for item in items)
  assert all(item["source"] == "biopharmcatalyst" for item in items)


def test_event_quality_score_rewards_specific_clinical_language():
  score = compute_event_quality_score(
    {
      "title": "Positive Phase 3 topline data",
      "summary": "The study met its primary endpoint in a rare disease cohort.",
      "press_release_text": "The press release includes patients, cohorts, dose levels, and response rate detail.",
      "trial_phase": "Phase 3",
      "press_release_url": "https://example.com/release",
    }
  )

  assert score["score"] > 0.7
  assert "specificity" in score["components"]


def test_pharma_event_topos_cycle_runs_on_fake_market_bundle():
  adapter = PharmaEventToposAdapter()

  class FakeMarketProvider:
    def fetch_market_bundle(self, **_kwargs):
      return build_fake_market_bundle()

  events = [
    {
      "id": "event-vrtx",
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
      "confidence": 0.9,
      "payload": {},
    },
    {
      "id": "event-mrna",
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
      "confidence": 0.8,
      "payload": {},
    },
    {
      "id": "event-alny",
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
      "confidence": 0.7,
      "payload": {},
    },
  ]

  result = adapter.run_cycle(
    events,
    market_provider=FakeMarketProvider(),
    request={
      "symbols": ["VRTX", "MRNA", "ALNY"],
      "benchmark_symbol": "XBI",
      "period": "1y",
      "interval": "1d",
      "train_window": 1,
      "test_window": 1,
      "step_size": 1,
      "pre_window": 5,
      "post_window": 1,
      "max_expiries": 2,
      "max_strikes_per_expiry": 2,
      "rolling_window": 4,
      "k_neighbors": 2,
      "risk_free_rate": 0.0,
    },
  )

  assert result["dataset"]["summary"]["row_count"] >= 2
  assert any(item["candidate_key"] == "crown:linear_ridge" for item in result["candidates"])
  assert result["leaderboard"]
