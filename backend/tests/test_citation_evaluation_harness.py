from __future__ import annotations

from app.citations.evaluation import (
  evaluate_corpus,
  generate_failure_report,
  load_default_corpus,
)


def test_default_corpus_covers_requested_edge_case_families():
  corpus = load_default_corpus()
  tags = {tag for record in corpus.records for tag in record.tags}

  assert len(corpus.records) >= 12
  assert "ocr_noise" in tags
  assert "partial_fragment" in tags
  assert "multivolume" in tags
  assert "translation" in tags
  assert "hard_negative" in tags
  assert any(record.expectation.citation_type == "chapter" for record in corpus.records)
  assert any(record.expectation.citation_type == "thesis" for record in corpus.records)
  assert any(record.expectation.citation_type == "preprint" for record in corpus.records)
  assert len(corpus.provider_ranking_cases) >= 3


def test_evaluation_report_exposes_metrics_and_failure_report():
  report = evaluate_corpus(load_default_corpus())

  assert report.corpus_version == "citation_evaluation_corpus.v1"
  assert report.normalization.type_accuracy >= 0.7
  assert report.normalization.identifier_recall >= 0.95
  assert report.normalization.warning_recall >= 0.75
  assert report.clustering.precision >= 0.95
  assert report.clustering.recall >= 0.1
  assert report.clustering.wrong_merge_risk <= 0.05
  assert report.provider_ranking.hit_at_1 >= 0.99
  assert report.provider_ranking.mean_reciprocal_rank >= 0.99

  failure_report = generate_failure_report(report)

  assert "Citation Evaluation Failure Report" in failure_report
  assert "Normalization Failures" in failure_report
  assert "Clustering Failures" in failure_report
  assert "Provider Ranking Failures" in failure_report
  assert "prml_messy" in failure_report
  assert "scihub_ether_article" in failure_report
