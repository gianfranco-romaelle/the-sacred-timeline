from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from itertools import combinations
from pathlib import Path
from statistics import mean
from typing import Any

from .engine import purify_citations
from .models import CitationInput, NormalizedCitation
from .normalize import normalize_citation
from .providers import InternetArchiveProvider, LibraryGenesisProvider, SciHubProvider
from .providers.models import AcquisitionQuery, ProviderCandidate


def _safe_divide(numerator: float, denominator: float) -> float:
  if denominator <= 0:
    return 0.0
  return numerator / denominator


def _f1(precision: float, recall: float) -> float:
  if precision <= 0 or recall <= 0:
    return 0.0
  return 2 * precision * recall / (precision + recall)


@dataclass(slots=True)
class NormalizationExpectation:
  citation_type: str | None = None
  title_contains: str | None = None
  authors_include: list[str] = field(default_factory=list)
  year: str | None = None
  identifiers: dict[str, str] = field(default_factory=dict)
  must_warn: list[str] = field(default_factory=list)
  should_queue_for_review: bool = False
  review_reason_codes: list[str] = field(default_factory=list)
  work_cluster_id: str | None = None
  edition_group_id: str | None = None

  def to_dict(self) -> dict[str, Any]:
    return asdict(self)


@dataclass(slots=True)
class CitationEvaluationRecord:
  id: str
  original_text: str
  source_kind: str = "unknown"
  source_id: str | None = None
  extracted_fields: dict[str, Any] = field(default_factory=dict)
  tags: list[str] = field(default_factory=list)
  expectation: NormalizationExpectation = field(default_factory=NormalizationExpectation)
  notes: str | None = None

  def to_citation_input(self) -> CitationInput:
    return CitationInput(
      original_text=self.original_text,
      source_kind=self.source_kind,
      source_id=self.source_id or self.id,
      extracted_doi=self.extracted_fields.get("doi"),
      extracted_isbn=self.extracted_fields.get("isbn"),
      extracted_year=self.extracted_fields.get("year"),
      extracted_journal=self.extracted_fields.get("journal"),
      extracted_volume=self.extracted_fields.get("volume"),
      extracted_issue=self.extracted_fields.get("issue"),
      extracted_pages=self.extracted_fields.get("pages"),
      metadata={"evaluation_tags": list(self.tags), "evaluation_notes": self.notes},
    )

  def to_dict(self) -> dict[str, Any]:
    payload = asdict(self)
    payload["expectation"] = self.expectation.to_dict()
    return payload


@dataclass(slots=True)
class ProviderCandidateFixture:
  provider_record_id: str
  title: str | None
  authors: list[str] = field(default_factory=list)
  year: str | None = None
  publisher: str | None = None
  journal: str | None = None
  identifiers: dict[str, str] = field(default_factory=dict)
  availability: str = "unknown"
  file_format: str | None = None
  risk_flags: list[dict[str, Any]] = field(default_factory=list)
  metadata: dict[str, Any] = field(default_factory=dict)

  def to_provider_candidate(self, provider_name: str) -> ProviderCandidate:
    return ProviderCandidate(
      provider_name=provider_name,
      provider_record_id=self.provider_record_id,
      title=self.title,
      authors=list(self.authors),
      year=self.year,
      publisher=self.publisher,
      journal=self.journal,
      identifiers=dict(self.identifiers),
      availability=self.availability,
      file_format=self.file_format,
      raw_payload=dict(self.metadata),
    )

  def to_dict(self) -> dict[str, Any]:
    return asdict(self)


@dataclass(slots=True)
class ProviderRankingCase:
  id: str
  provider: str
  query_record_id: str
  expected_top_candidate_id: str
  relevant_candidate_ids: list[str] = field(default_factory=list)
  expected_should_queue_for_review: bool = False
  notes: str | None = None
  candidates: list[ProviderCandidateFixture] = field(default_factory=list)

  def to_dict(self) -> dict[str, Any]:
    return {
      "id": self.id,
      "provider": self.provider,
      "query_record_id": self.query_record_id,
      "expected_top_candidate_id": self.expected_top_candidate_id,
      "relevant_candidate_ids": list(self.relevant_candidate_ids),
      "expected_should_queue_for_review": self.expected_should_queue_for_review,
      "notes": self.notes,
      "candidates": [item.to_dict() for item in self.candidates],
    }


@dataclass(slots=True)
class CitationEvaluationCorpus:
  schema_version: str
  records: list[CitationEvaluationRecord] = field(default_factory=list)
  provider_ranking_cases: list[ProviderRankingCase] = field(default_factory=list)

  @classmethod
  def from_dict(cls, payload: dict[str, Any]) -> "CitationEvaluationCorpus":
    records = [
      CitationEvaluationRecord(
        id=item["id"],
        original_text=item["original_text"],
        source_kind=item.get("source_kind", "unknown"),
        source_id=item.get("source_id"),
        extracted_fields=dict(item.get("extracted_fields") or {}),
        tags=list(item.get("tags") or []),
        expectation=NormalizationExpectation(**dict(item.get("expectation") or {})),
        notes=item.get("notes"),
      )
      for item in payload.get("records") or []
    ]
    ranking_cases = [
      ProviderRankingCase(
        id=item["id"],
        provider=item["provider"],
        query_record_id=item["query_record_id"],
        expected_top_candidate_id=item["expected_top_candidate_id"],
        relevant_candidate_ids=list(item.get("relevant_candidate_ids") or []),
        expected_should_queue_for_review=bool(item.get("expected_should_queue_for_review")),
        notes=item.get("notes"),
        candidates=[
          ProviderCandidateFixture(
            provider_record_id=candidate["provider_record_id"],
            title=candidate.get("title"),
            authors=list(candidate.get("authors") or []),
            year=candidate.get("year"),
            publisher=candidate.get("publisher"),
            journal=candidate.get("journal"),
            identifiers=dict(candidate.get("identifiers") or {}),
            availability=str(candidate.get("availability") or "unknown"),
            file_format=candidate.get("file_format"),
            risk_flags=list(candidate.get("risk_flags") or []),
            metadata=dict(candidate.get("metadata") or {}),
          )
          for candidate in item.get("candidates") or []
        ],
      )
      for item in payload.get("provider_ranking_cases") or []
    ]
    return cls(
      schema_version=str(payload.get("schema_version") or "citation_evaluation_corpus.v1"),
      records=records,
      provider_ranking_cases=ranking_cases,
    )

  @classmethod
  def load(cls, path: str | Path) -> "CitationEvaluationCorpus":
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    return cls.from_dict(payload)

  def inputs(self) -> list[CitationInput]:
    return [record.to_citation_input() for record in self.records]

  def record_by_id(self) -> dict[str, CitationEvaluationRecord]:
    return {record.id: record for record in self.records}

  def to_dict(self) -> dict[str, Any]:
    return {
      "schema_version": self.schema_version,
      "records": [item.to_dict() for item in self.records],
      "provider_ranking_cases": [item.to_dict() for item in self.provider_ranking_cases],
    }


@dataclass(slots=True)
class MetricSummary:
  total: int
  passed: int
  precision: float = 0.0
  recall: float = 0.0
  f1: float = 0.0
  accuracy: float = 0.0

  def to_dict(self) -> dict[str, Any]:
    return asdict(self)


@dataclass(slots=True)
class FailureDetail:
  case_id: str
  category: str
  message: str
  expected: Any = None
  observed: Any = None
  metadata: dict[str, Any] = field(default_factory=dict)

  def to_dict(self) -> dict[str, Any]:
    return asdict(self)


@dataclass(slots=True)
class NormalizationEvaluationResult:
  type_accuracy: float
  identifier_recall: float
  warning_recall: float
  review_queue_precision: float
  review_queue_recall: float
  average_confidence: float
  failures: list[FailureDetail] = field(default_factory=list)

  def to_dict(self) -> dict[str, Any]:
    return {
      "type_accuracy": self.type_accuracy,
      "identifier_recall": self.identifier_recall,
      "warning_recall": self.warning_recall,
      "review_queue_precision": self.review_queue_precision,
      "review_queue_recall": self.review_queue_recall,
      "average_confidence": self.average_confidence,
      "failures": [item.to_dict() for item in self.failures],
    }


@dataclass(slots=True)
class ClusteringEvaluationResult:
  precision: float
  recall: float
  f1: float
  wrong_merge_risk: float
  edition_collision_warning_recall: float
  failures: list[FailureDetail] = field(default_factory=list)

  def to_dict(self) -> dict[str, Any]:
    return {
      "precision": self.precision,
      "recall": self.recall,
      "f1": self.f1,
      "wrong_merge_risk": self.wrong_merge_risk,
      "edition_collision_warning_recall": self.edition_collision_warning_recall,
      "failures": [item.to_dict() for item in self.failures],
    }


@dataclass(slots=True)
class ProviderRankingEvaluationResult:
  hit_at_1: float
  mean_reciprocal_rank: float
  review_queue_precision: float
  review_queue_recall: float
  failures: list[FailureDetail] = field(default_factory=list)

  def to_dict(self) -> dict[str, Any]:
    return {
      "hit_at_1": self.hit_at_1,
      "mean_reciprocal_rank": self.mean_reciprocal_rank,
      "review_queue_precision": self.review_queue_precision,
      "review_queue_recall": self.review_queue_recall,
      "failures": [item.to_dict() for item in self.failures],
    }


@dataclass(slots=True)
class CitationEvaluationReport:
  corpus_version: str
  normalization: NormalizationEvaluationResult
  clustering: ClusteringEvaluationResult
  provider_ranking: ProviderRankingEvaluationResult

  def to_dict(self) -> dict[str, Any]:
    return {
      "corpus_version": self.corpus_version,
      "normalization": self.normalization.to_dict(),
      "clustering": self.clustering.to_dict(),
      "provider_ranking": self.provider_ranking.to_dict(),
    }


def evaluate_normalization(
  corpus: CitationEvaluationCorpus,
  *,
  normalized_records: dict[str, NormalizedCitation] | None = None,
) -> NormalizationEvaluationResult:
  by_id = normalized_records or {
    record.id: normalize_citation(record.to_citation_input())
    for record in corpus.records
  }

  type_hits = 0
  expected_identifier_total = 0
  observed_identifier_hits = 0
  expected_warning_total = 0
  observed_warning_hits = 0
  review_tp = 0
  review_fp = 0
  review_fn = 0
  confidences: list[float] = []
  failures: list[FailureDetail] = []

  for record in corpus.records:
    normalized = by_id[record.id]
    expectation = record.expectation
    confidences.append(float(normalized.normalization_confidence))
    if expectation.citation_type and normalized.citation_type == expectation.citation_type:
      type_hits += 1
    elif expectation.citation_type:
      failures.append(
        FailureDetail(
          case_id=record.id,
          category="normalization_type",
          message="Citation type mismatch.",
          expected=expectation.citation_type,
          observed=normalized.citation_type,
        )
      )
    if expectation.title_contains and expectation.title_contains.lower() not in str(normalized.title or "").lower():
      failures.append(
        FailureDetail(
          case_id=record.id,
          category="normalization_title",
          message="Normalized title did not preserve the expected title signal.",
          expected=expectation.title_contains,
          observed=normalized.title,
        )
      )
    for author in expectation.authors_include:
      if not any(author.lower() in item.lower() for item in normalized.authors):
        failures.append(
          FailureDetail(
            case_id=record.id,
            category="normalization_author",
            message="Expected author was not retained in normalized author list.",
            expected=author,
            observed=list(normalized.authors),
          )
        )
    if expectation.year and normalized.year != expectation.year:
      failures.append(
        FailureDetail(
          case_id=record.id,
          category="normalization_year",
          message="Expected year was not recovered.",
          expected=expectation.year,
          observed=normalized.year,
        )
      )

    for identifier_name, identifier_value in expectation.identifiers.items():
      expected_identifier_total += 1
      observed_value = getattr(normalized.identifiers, identifier_name, None)
      if observed_value == identifier_value:
        observed_identifier_hits += 1
      else:
        failures.append(
          FailureDetail(
            case_id=record.id,
            category="identifier_extraction",
            message=f"Identifier {identifier_name} was not extracted as expected.",
            expected=identifier_value,
            observed=observed_value,
          )
        )

    for warning in expectation.must_warn:
      expected_warning_total += 1
      if warning in normalized.warnings:
        observed_warning_hits += 1
      else:
        failures.append(
          FailureDetail(
            case_id=record.id,
            category="warning_recall",
            message="Expected human-review warning was not emitted.",
            expected=warning,
            observed=list(normalized.warnings),
          )
        )

    predicted_review = _normalized_record_should_queue_for_review(normalized)
    expected_review = bool(expectation.should_queue_for_review)
    if predicted_review and expected_review:
      review_tp += 1
    elif predicted_review and not expected_review:
      review_fp += 1
      failures.append(
        FailureDetail(
          case_id=record.id,
          category="review_queue_overtrigger",
          message="Review queue heuristic escalated a case that was expected to stay automatic.",
          expected=False,
          observed=True,
          metadata={"warnings": list(normalized.warnings), "confidence": normalized.normalization_confidence},
        )
      )
    elif expected_review and not predicted_review:
      review_fn += 1
      failures.append(
        FailureDetail(
          case_id=record.id,
          category="review_queue_miss",
          message="Review queue heuristic failed to escalate an expected ambiguous case.",
          expected=True,
          observed=False,
          metadata={"warnings": list(normalized.warnings), "confidence": normalized.normalization_confidence},
        )
      )

  type_accuracy = _safe_divide(type_hits, len(corpus.records))
  identifier_recall = _safe_divide(observed_identifier_hits, expected_identifier_total)
  warning_recall = _safe_divide(observed_warning_hits, expected_warning_total)
  review_precision = _safe_divide(review_tp, review_tp + review_fp)
  review_recall = _safe_divide(review_tp, review_tp + review_fn)
  average_confidence = mean(confidences) if confidences else 0.0
  return NormalizationEvaluationResult(
    type_accuracy=round(type_accuracy, 4),
    identifier_recall=round(identifier_recall, 4),
    warning_recall=round(warning_recall, 4),
    review_queue_precision=round(review_precision, 4),
    review_queue_recall=round(review_recall, 4),
    average_confidence=round(average_confidence, 4),
    failures=failures,
  )


def evaluate_clustering(
  corpus: CitationEvaluationCorpus,
  *,
  normalized_records: dict[str, NormalizedCitation] | None = None,
) -> ClusteringEvaluationResult:
  result = purify_citations(corpus.inputs())
  actual_cluster_map: dict[str, str] = {}
  for cluster in result.candidate_clusters:
    for member_id in cluster.member_ids:
      member = next((item for item in result.normalized_records if item.id == member_id), None)
      record_key = str(member.source_id or member.id) if member is not None else str(member_id)
      actual_cluster_map[record_key] = cluster.id
  expected_cluster_map = {
    record.id: record.expectation.work_cluster_id or record.id
    for record in corpus.records
  }
  normalized_by_id = normalized_records or {
    str(normalized.source_id or record.id): normalized
    for record, normalized in zip(corpus.records, result.normalized_records, strict=False)
  }

  tp = 0
  fp = 0
  fn = 0
  failures: list[FailureDetail] = []
  collision_pairs = 0
  collision_warning_hits = 0

  for left, right in combinations(corpus.records, 2):
    predicted_merge = actual_cluster_map.get(left.id, left.id) == actual_cluster_map.get(right.id, right.id)
    expected_merge = expected_cluster_map.get(left.id, left.id) == expected_cluster_map.get(right.id, right.id)
    if predicted_merge and expected_merge:
      tp += 1
    elif predicted_merge and not expected_merge:
      fp += 1
      failures.append(
        FailureDetail(
          case_id=f"{left.id}::{right.id}",
          category="wrong_merge",
          message="Two records merged that should stay in different work clusters.",
          expected="separate_clusters",
          observed="merged",
          metadata={
            "left_text": left.original_text,
            "right_text": right.original_text,
          },
        )
      )
    elif expected_merge and not predicted_merge:
      fn += 1
      failures.append(
        FailureDetail(
          case_id=f"{left.id}::{right.id}",
          category="missed_merge",
          message="Two records in the same gold work cluster were not merged.",
          expected="merged",
          observed="separate_clusters",
          metadata={
            "left_text": left.original_text,
            "right_text": right.original_text,
          },
        )
      )

    left_edition = left.expectation.edition_group_id
    right_edition = right.expectation.edition_group_id
    if (
      expected_merge
      and left_edition
      and right_edition
      and left_edition != right_edition
    ):
      collision_pairs += 1
      left_normalized = normalized_by_id[left.id]
      right_normalized = normalized_by_id[right.id]
      if "probable_wrong_edition_collision" in left_normalized.warnings or "probable_wrong_edition_collision" in right_normalized.warnings:
        collision_warning_hits += 1
      else:
        failures.append(
          FailureDetail(
            case_id=f"{left.id}::{right.id}",
            category="edition_collision_warning",
            message="Same-work different-edition pair was not flagged as a likely edition collision.",
            expected="probable_wrong_edition_collision",
            observed={
              left.id: list(left_normalized.warnings),
              right.id: list(right_normalized.warnings),
            },
          )
        )

  precision = _safe_divide(tp, tp + fp)
  recall = _safe_divide(tp, tp + fn)
  wrong_merge_risk = _safe_divide(fp, tp + fp)
  edition_collision_warning_recall = _safe_divide(collision_warning_hits, collision_pairs)
  return ClusteringEvaluationResult(
    precision=round(precision, 4),
    recall=round(recall, 4),
    f1=round(_f1(precision, recall), 4),
    wrong_merge_risk=round(wrong_merge_risk, 4),
    edition_collision_warning_recall=round(edition_collision_warning_recall, 4),
    failures=failures,
  )


def evaluate_provider_ranking(
  corpus: CitationEvaluationCorpus,
  *,
  normalized_records: dict[str, NormalizedCitation] | None = None,
) -> ProviderRankingEvaluationResult:
  providers = {
    "internet_archive": InternetArchiveProvider(),
    "libgen": LibraryGenesisProvider(),
    "library_genesis": LibraryGenesisProvider(),
    "scihub": SciHubProvider(),
    "sci_hub": SciHubProvider(),
  }
  normalized_by_id = normalized_records or {
    record.id: normalize_citation(record.to_citation_input())
    for record in corpus.records
  }

  hit_at_1_hits = 0
  reciprocal_ranks: list[float] = []
  review_tp = 0
  review_fp = 0
  review_fn = 0
  failures: list[FailureDetail] = []

  for case in corpus.provider_ranking_cases:
    provider = providers[case.provider]
    query_record = normalized_by_id[case.query_record_id]
    query = AcquisitionQuery.from_normalized(query_record)
    scored = [
      provider.score_candidate(candidate.to_provider_candidate(provider.name), query)
      for candidate in case.candidates
    ]
    ranked = sorted(scored, key=lambda item: item.candidate_score, reverse=True)
    top_id = ranked[0].provider_record_id if ranked else None
    if top_id == case.expected_top_candidate_id:
      hit_at_1_hits += 1
    else:
      failures.append(
        FailureDetail(
          case_id=case.id,
          category="provider_ranking_top1",
          message="Top-ranked candidate did not match the gold candidate.",
          expected=case.expected_top_candidate_id,
          observed=top_id,
          metadata={"ranked_ids": [item.provider_record_id for item in ranked]},
        )
      )
    reciprocal_rank = 0.0
    for index, item in enumerate(ranked, start=1):
      if item.provider_record_id in set(case.relevant_candidate_ids or [case.expected_top_candidate_id]):
        reciprocal_rank = 1.0 / index
        break
    reciprocal_ranks.append(reciprocal_rank)

    predicted_review = _provider_case_should_queue_for_review(ranked)
    expected_review = bool(case.expected_should_queue_for_review)
    if predicted_review and expected_review:
      review_tp += 1
    elif predicted_review and not expected_review:
      review_fp += 1
      failures.append(
        FailureDetail(
          case_id=case.id,
          category="provider_review_overtrigger",
          message="Provider-ranking heuristic escalated a case expected to stay auto-approvable.",
          expected=False,
          observed=True,
          metadata={"top_score": ranked[0].candidate_score if ranked else None},
        )
      )
    elif expected_review and not predicted_review:
      review_fn += 1
      failures.append(
        FailureDetail(
          case_id=case.id,
          category="provider_review_miss",
          message="Provider-ranking heuristic failed to escalate an ambiguous lookup case.",
          expected=True,
          observed=False,
          metadata={"top_score": ranked[0].candidate_score if ranked else None},
        )
      )

  hit_at_1 = _safe_divide(hit_at_1_hits, len(corpus.provider_ranking_cases))
  mrr = mean(reciprocal_ranks) if reciprocal_ranks else 0.0
  review_precision = _safe_divide(review_tp, review_tp + review_fp)
  review_recall = _safe_divide(review_tp, review_tp + review_fn)
  return ProviderRankingEvaluationResult(
    hit_at_1=round(hit_at_1, 4),
    mean_reciprocal_rank=round(mrr, 4),
    review_queue_precision=round(review_precision, 4),
    review_queue_recall=round(review_recall, 4),
    failures=failures,
  )


def evaluate_corpus(corpus: CitationEvaluationCorpus) -> CitationEvaluationReport:
  normalized_by_id = {
    record.id: normalize_citation(record.to_citation_input())
    for record in corpus.records
  }
  return CitationEvaluationReport(
    corpus_version=corpus.schema_version,
    normalization=evaluate_normalization(corpus, normalized_records=normalized_by_id),
    clustering=evaluate_clustering(corpus),
    provider_ranking=evaluate_provider_ranking(corpus, normalized_records=normalized_by_id),
  )


def generate_failure_report(report: CitationEvaluationReport) -> str:
  sections: list[str] = []
  sections.append("# Citation Evaluation Failure Report")
  sections.append("")
  sections.append(f"Corpus version: `{report.corpus_version}`")
  sections.append("")
  sections.append("## Metrics")
  sections.append(
    f"- normalization: type_accuracy={report.normalization.type_accuracy:.3f}, "
    f"identifier_recall={report.normalization.identifier_recall:.3f}, "
    f"warning_recall={report.normalization.warning_recall:.3f}, "
    f"review_precision={report.normalization.review_queue_precision:.3f}, "
    f"review_recall={report.normalization.review_queue_recall:.3f}"
  )
  sections.append(
    f"- clustering: precision={report.clustering.precision:.3f}, recall={report.clustering.recall:.3f}, "
    f"f1={report.clustering.f1:.3f}, wrong_merge_risk={report.clustering.wrong_merge_risk:.3f}, "
    f"edition_collision_warning_recall={report.clustering.edition_collision_warning_recall:.3f}"
  )
  sections.append(
    f"- provider_ranking: hit_at_1={report.provider_ranking.hit_at_1:.3f}, "
    f"mrr={report.provider_ranking.mean_reciprocal_rank:.3f}, "
    f"review_precision={report.provider_ranking.review_queue_precision:.3f}, "
    f"review_recall={report.provider_ranking.review_queue_recall:.3f}"
  )
  sections.append("")
  for heading, failures in [
    ("Normalization Failures", report.normalization.failures),
    ("Clustering Failures", report.clustering.failures),
    ("Provider Ranking Failures", report.provider_ranking.failures),
  ]:
    sections.append(f"## {heading}")
    if not failures:
      sections.append("- none")
      sections.append("")
      continue
    for failure in failures[:10]:
      sections.append(
        f"- `{failure.case_id}` [{failure.category}] {failure.message} "
        f"Expected={failure.expected!r} Observed={failure.observed!r}"
      )
    if len(failures) > 10:
      sections.append(f"- ... {len(failures) - 10} more failures")
    sections.append("")
  return "\n".join(sections).strip() + "\n"


def load_default_corpus() -> CitationEvaluationCorpus:
  fixture_path = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "citations_evaluation_corpus.json"
  return CitationEvaluationCorpus.load(fixture_path)


def _normalized_record_should_queue_for_review(record: NormalizedCitation) -> bool:
  review_warnings = {
    "common_title",
    "multivolume_work",
    "translated_work",
    "collected_works",
    "edited_volume",
    "probable_wrong_edition_collision",
  }
  if record.normalization_confidence < 0.72:
    return True
  return any(item in review_warnings for item in record.warnings)


def _provider_case_should_queue_for_review(candidates: list[ProviderCandidate]) -> bool:
  if not candidates:
    return True
  top = candidates[0]
  if top.candidate_score < 0.86:
    return True
  if len(candidates) >= 2 and (top.candidate_score - candidates[1].candidate_score) < 0.08:
    return True
  risk_codes = {flag.code for flag in top.risk_flags}
  return bool(risk_codes & {"probable_wrong_edition_collision", "borrow_required", "mirror_variability"})


__all__ = [
  "CitationEvaluationCorpus",
  "CitationEvaluationRecord",
  "CitationEvaluationReport",
  "FailureDetail",
  "NormalizationExpectation",
  "ProviderCandidateFixture",
  "ProviderRankingCase",
  "evaluate_clustering",
  "evaluate_corpus",
  "evaluate_normalization",
  "evaluate_provider_ranking",
  "generate_failure_report",
  "load_default_corpus",
]
