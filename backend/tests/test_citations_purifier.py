from __future__ import annotations

import json

from app.citations import CitationInput, normalize_citation, purify_citations
from app.citations.cli import main as citations_cli_main


def test_normalize_article_detects_identifiers_type_and_preserves_original():
  record = normalize_citation(
    CitationInput(
      original_text=(
        'Smith, John, and Jane Doe. 2018. "On Ether Drift." '
        "Journal of Curious Physics 12(3): 100-120. doi:10.1234/example"
      ),
      source_kind="bibliography",
    )
  )

  assert record.original_text.startswith("Smith, John")
  assert record.identifiers.doi == "10.1234/example"
  assert record.citation_type == "article"
  assert record.title == "On Ether Drift."
  assert record.year == "2018"
  assert "Smith, John" in record.authors
  assert record.strict_fingerprint == "doi:10.1234/example"
  assert record.normalization_confidence >= 0.75


def test_normalize_detects_book_chapter_thesis_and_preprint():
  book = normalize_citation(
    CitationInput(
      original_text=(
        "Bourbaki, Nicolas. 1974. Elements of Mathematics: Theory of Sets. "
        "Paris: Hermann. ISBN 978-0201006345"
      )
    )
  )
  chapter = normalize_citation(
    CitationInput(
      original_text=(
        "Cartwright, Nancy. 1995. Models and the Limits of Theory. "
        "In: Scientific Models, edited by Margaret Morrison and Mary Morgan, pages 49-67. Cambridge University Press."
      )
    )
  )
  thesis = normalize_citation(
    CitationInput(
      original_text=(
        "Nguyen, Lan. 2019. Sheaf-Theoretic Methods in Biological Inference. "
        "PhD thesis, University of Chicago."
      )
    )
  )
  preprint = normalize_citation(
    CitationInput(
      original_text=(
        "Garcia, Elena. 2021. Sparse Causal Topology for Dynamic Systems. "
        "arXiv:2101.12345v2 preprint."
      )
    )
  )

  assert book.citation_type == "book"
  assert book.identifiers.isbn13 == "9780201006345"
  assert chapter.citation_type == "chapter"
  assert "edited_volume" in chapter.warnings
  assert thesis.citation_type == "thesis"
  assert preprint.citation_type == "preprint"
  assert preprint.identifiers.arxiv == "2101.12345"


def test_purify_clusters_high_confidence_variants_of_same_work():
  result = purify_citations(
    [
      CitationInput(
        original_text=(
          'Smith, John, and Jane Doe. 2018. "On Ether Drift." '
          "Journal of Curious Physics 12(3): 100-120. doi:10.1234/example"
        )
      ),
      CitationInput(
        original_text=(
          "Smith, J.; Doe, J. 2018. On Ether Drift. "
          "Journal of Curious Physics 12(3):100-120. https://doi.org/10.1234/example"
        )
      ),
      CitationInput(
        original_text=(
          "Bishop, Christopher M. 2006. Pattern Recognition and Machine Learning. Springer."
        )
      ),
      CitationInput(
        original_text=(
          "Bishop, C. M. 2006. Pattern recognition & machine learning. Springer."
        )
      ),
    ]
  )

  assert len(result.normalized_records) == 4
  cluster_sizes = sorted(len(cluster.member_ids) for cluster in result.candidate_clusters)
  assert cluster_sizes == [2, 2]
  doi_cluster = next(cluster for cluster in result.candidate_clusters if cluster.work_key == "doi:10.1234/example")
  assert doi_cluster.confidence >= 0.9
  assert "shared_identifier" in doi_cluster.merge_basis


def test_purify_emits_review_warnings_for_ambiguous_cases():
  result = purify_citations(
    [
      CitationInput(
        original_text="Collected Works. Vol. II. 1968. Oxford University Press."
      ),
      CitationInput(
        original_text=(
          "Husserl, Edmund. 1931. Ideas: General Introduction to Pure Phenomenology. "
          "Trans. W. R. Boyce Gibson. London: Allen & Unwin."
        )
      ),
      CitationInput(
        original_text=(
          "Whitehead, Alfred North. 1929. Process and Reality. New York: Macmillan. ISBN 9780029351801."
        )
      ),
      CitationInput(
        original_text=(
          "Whitehead, Alfred North. 1978. Process and Reality. Corrected Edition. New York: Free Press. ISBN 9780029352105."
        )
      ),
    ]
  )

  by_title = {record.title or record.original_text: record for record in result.normalized_records}
  collected = next(record for record in result.normalized_records if "Collected Works" in record.original_text)
  translated = next(record for record in result.normalized_records if "Phenomenology" in record.original_text)
  whitehead_records = [record for record in result.normalized_records if "Process and Reality" in record.original_text]

  assert "common_title" in collected.warnings
  assert "multivolume_work" in collected.warnings
  assert "translated_work" in translated.warnings
  assert all("probable_wrong_edition_collision" in record.warnings for record in whitehead_records)


def test_cli_batch_purification_writes_json(tmp_path):
  input_path = tmp_path / "citations.jsonl"
  output_path = tmp_path / "purified.json"
  items = [
    {
      "original_text": "Latour, Bruno. 1987. Science in Action. Cambridge, MA: Harvard University Press.",
      "source_kind": "library",
    },
    {
      "original_text": (
        "Latour, B. 1987. Science in Action. Harvard Univ. Press."
      ),
      "source_kind": "website",
    },
  ]
  input_path.write_text("\n".join(json.dumps(item) for item in items) + "\n", encoding="utf-8")

  exit_code = citations_cli_main(["--input", str(input_path), "--format", "jsonl", "--output", str(output_path), "--pretty"])

  assert exit_code == 0
  payload = json.loads(output_path.read_text(encoding="utf-8"))
  assert len(payload["normalized_records"]) == 2
  assert len(payload["candidate_clusters"]) == 1
  assert payload["candidate_clusters"][0]["confidence"] >= 0.85
