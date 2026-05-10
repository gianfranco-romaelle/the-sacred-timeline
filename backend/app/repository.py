from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from uuid import uuid4


ENTITY_TABLES: tuple[tuple[str, str], ...] = (
  ("objects_of_reference", "ObjectOfReference"),
  ("sign_tokens", "SignToken"),
  ("interpretants", "Interpretant"),
  ("morphisms", "Morphism"),
  ("triads", "Triad"),
  ("categories", "Category"),
  ("category_morphisms", "CategoryMorphism"),
  ("functors", "FunctorMapping"),
  ("natural_transformations", "NaturalTransformation"),
  ("covers", "Cover"),
  ("restriction_maps", "RestrictionMap"),
  ("gluing_constraints", "GluingConstraint"),
  ("obstructions", "Obstruction"),
  ("simplices", "Simplex"),
  ("catastrophe_events", "CatastropheEvent"),
  ("research_bundles", "ResearchBundle"),
  ("research_maps", "ResearchMap"),
  ("research_map_pins", "ResearchMapPin"),
)


# Shared persistence helpers stay near the top because the rest of this module
# serializes many JSON-heavy row shapes and reuses the same small primitives.
def _stable_repo_id(prefix: str, *parts: object) -> str:
  digest = hashlib.sha1("||".join(str(part) for part in parts).encode("utf-8", errors="ignore")).hexdigest()[:16]
  return f"{prefix}-{digest}"


def utc_now() -> str:
  return datetime.now(timezone.utc).isoformat()


def row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
  return dict(row) if row is not None else None


def json_loads(value: str | None, default: Any):
  if isinstance(value, (dict, list)):
    return value
  if not value:
    return default
  try:
    return json.loads(value)
  except (json.JSONDecodeError, TypeError):
    return default


def _json(value: Any, default: Any) -> str:
  return json.dumps(default if value is None else value)


FILE_LEDGER_STATUS_ORDER: tuple[str, ...] = (
  "discovered",
  "pending_import",
  "extracting",
  "extracted",
  "ocr_pending",
  "ocr_done",
  "chunked",
  "embedded",
  "indexed",
  "failed",
  "stale",
)


def normalize_absolute_path(path: str | Path) -> str:
  candidate = Path(path).expanduser()
  try:
    candidate = candidate.resolve(strict=False)
  except Exception:
    candidate = Path(os.path.abspath(str(candidate)))
  normalized = os.path.normpath(str(candidate))
  return os.path.normcase(normalized)


def _tracked_file_stage_column(stage: str | None) -> str | None:
  normalized = str(stage or "").strip().lower()
  if normalized == "extract":
    return "extraction_status"
  if normalized == "ocr":
    return "ocr_status"
  if normalized == "chunk":
    return "chunk_status"
  if normalized == "embed":
    return "embedding_status"
  if normalized == "index":
    return "index_status"
  return None


def _compute_overall_tracked_file_status(row: dict[str, Any]) -> str:
  if bool(row.get("stale")):
    return "stale"
  statuses = {
    "extraction_status": str(row.get("extraction_status") or "pending"),
    "ocr_status": str(row.get("ocr_status") or "pending"),
    "chunk_status": str(row.get("chunk_status") or "pending"),
    "embedding_status": str(row.get("embedding_status") or "pending"),
    "index_status": str(row.get("index_status") or "pending"),
  }
  if row.get("error_message") or any(status == "failed" for status in statuses.values()):
    return "failed"
  if statuses["index_status"] == "completed":
    return "indexed"
  if statuses["embedding_status"] == "completed":
    return "embedded"
  if statuses["chunk_status"] == "completed":
    return "chunked"
  if statuses["ocr_status"] == "completed":
    return "ocr_done"
  if statuses["ocr_status"] in {"queued", "pending", "running"} and statuses["extraction_status"] == "completed":
    return "ocr_pending"
  if statuses["extraction_status"] == "completed":
    return "extracted"
  if statuses["extraction_status"] == "running":
    return "extracting"
  if row.get("last_import_job_id"):
    return "pending_import"
  return "discovered"


def _tracked_file_metadata(value: dict[str, Any] | None = None) -> str:
  return _json(value, {})


def _insert_many(connection: sqlite3.Connection, table: str, rows: list[dict[str, Any]]) -> None:
  if not rows:
    return
  columns = list(rows[0].keys())
  placeholders = ", ".join(f":{column}" for column in columns)
  connection.executemany(
    f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({placeholders})",
    rows,
  )


def _delete_in(connection: sqlite3.Connection, table: str, column: str, values: list[str]) -> None:
  if not values:
    return
  connection.execute(
    f"DELETE FROM {table} WHERE {column} IN ({','.join('?' for _ in values)})",
    values,
  )


# Authentication and session state ------------------------------------------------
def create_user(connection: sqlite3.Connection, username: str, display_name: str, password_hash: str, role: str = "admin") -> dict[str, Any]:
  now = utc_now()
  user_id = f"user-{uuid4().hex}"
  connection.execute(
    """
    INSERT INTO users (id, username, display_name, password_hash, role, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    """,
    (user_id, username.strip().lower(), display_name.strip(), password_hash, role, now),
  )
  return get_user_by_id(connection, user_id)


def get_user_by_username(connection: sqlite3.Connection, username: str) -> dict[str, Any] | None:
  row = connection.execute("SELECT * FROM users WHERE username = ?", (username.strip().lower(),)).fetchone()
  return row_to_dict(row)


def get_user_by_id(connection: sqlite3.Connection, user_id: str) -> dict[str, Any] | None:
  row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
  return row_to_dict(row)


def count_users(connection: sqlite3.Connection) -> int:
  row = connection.execute("SELECT COUNT(*) AS count FROM users").fetchone()
  return int(row["count"] if row else 0)


def create_session(connection: sqlite3.Connection, user_id: str, expires_at: str) -> dict[str, Any]:
  session_id = f"session-{uuid4().hex}"
  now = utc_now()
  connection.execute(
    "INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    (session_id, user_id, now, expires_at),
  )
  return {"id": session_id, "user_id": user_id, "created_at": now, "expires_at": expires_at}


def get_session(connection: sqlite3.Connection, session_id: str) -> dict[str, Any] | None:
  row = connection.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
  return row_to_dict(row)


def delete_session(connection: sqlite3.Connection, session_id: str) -> None:
  connection.execute("DELETE FROM sessions WHERE id = ?", (session_id,))


# Document ingestion and document-node persistence --------------------------------
def list_documents(connection: sqlite3.Connection) -> list[dict[str, Any]]:
  rows = connection.execute(
    """
    SELECT id, title, source_path, file_type, language, status, summary, checksum,
           extraction_status, index_status, page_count, node_count, warnings_json, metadata_json,
           extraction_metadata_json, pipeline_version, last_indexed_at, created_at, updated_at
    FROM documents
    ORDER BY updated_at DESC, title ASC
    """
  ).fetchall()
  return [dict(row) for row in rows]


def get_document_by_source_path(connection: sqlite3.Connection, source_path: str) -> dict[str, Any] | None:
  row = connection.execute("SELECT * FROM documents WHERE source_path = ?", (source_path,)).fetchone()
  return row_to_dict(row)


def get_document_by_id(connection: sqlite3.Connection, document_id: str) -> dict[str, Any] | None:
  row = connection.execute("SELECT * FROM documents WHERE id = ?", (document_id,)).fetchone()
  return row_to_dict(row)


def upsert_document(connection: sqlite3.Connection, document: dict[str, Any]) -> None:
  payload = dict(document)
  payload["warnings_json"] = _json(payload.get("warnings_json"), [])
  payload["metadata_json"] = _json(payload.get("metadata_json"), {})
  payload["extraction_metadata_json"] = _json(payload.get("extraction_metadata_json"), {})
  connection.execute(
    """
    INSERT INTO documents (
      id, title, source_path, file_type, language, status, extraction_status, index_status, summary, checksum,
      page_count, node_count, warnings_json, metadata_json, extraction_metadata_json, pipeline_version, last_indexed_at,
      created_at, updated_at
    )
    VALUES (
      :id, :title, :source_path, :file_type, :language, :status, :extraction_status, :index_status, :summary, :checksum,
      :page_count, :node_count, :warnings_json, :metadata_json, :extraction_metadata_json, :pipeline_version, :last_indexed_at,
      :created_at, :updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      source_path = excluded.source_path,
      file_type = excluded.file_type,
      language = excluded.language,
      status = excluded.status,
      extraction_status = excluded.extraction_status,
      index_status = excluded.index_status,
      summary = excluded.summary,
      checksum = excluded.checksum,
      page_count = excluded.page_count,
      node_count = excluded.node_count,
      warnings_json = excluded.warnings_json,
      metadata_json = excluded.metadata_json,
      extraction_metadata_json = excluded.extraction_metadata_json,
      pipeline_version = excluded.pipeline_version,
      last_indexed_at = excluded.last_indexed_at,
      updated_at = excluded.updated_at
    """,
    payload,
  )


def replace_document_nodes(connection: sqlite3.Connection, document_id: str, nodes: Iterable[dict[str, Any]]) -> None:
  connection.execute("DELETE FROM representation_nodes_fts WHERE document_id = ?", (document_id,))
  connection.execute("DELETE FROM representation_nodes WHERE document_id = ?", (document_id,))
  for node in nodes:
    payload = dict(node)
    payload["metadata_json"] = _json(payload.get("metadata_json"), {})
    connection.execute(
      """
      INSERT INTO representation_nodes (
        id, document_id, parent_id, node_type, summary_level, title, heading_path, ordinal,
        page_start, page_end, text, token_count, language, checksum, metadata_json, created_at, updated_at
      ) VALUES (
        :id, :document_id, :parent_id, :node_type, :summary_level, :title, :heading_path, :ordinal,
        :page_start, :page_end, :text, :token_count, :language, :checksum, :metadata_json, :created_at, :updated_at
      )
      """,
      payload,
    )
    connection.execute(
      """
      INSERT INTO representation_nodes_fts (node_id, document_id, node_type, summary_level, title, heading_path, text)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      """,
      (
        node["id"],
        node["document_id"],
        node["node_type"],
        node.get("summary_level"),
        node["title"],
        node["heading_path"],
        node["text"],
      ),
    )


def list_nodes_by_document(connection: sqlite3.Connection, document_id: str) -> list[dict[str, Any]]:
  rows = connection.execute(
    "SELECT * FROM representation_nodes WHERE document_id = ? ORDER BY ordinal ASC",
    (document_id,),
  ).fetchall()
  return [dict(row) for row in rows]


def get_nodes_by_ids(connection: sqlite3.Connection, node_ids: Iterable[str]) -> list[dict[str, Any]]:
  ids = [node_id for node_id in node_ids if node_id]
  if not ids:
    return []
  rows = connection.execute(
    f"SELECT * FROM representation_nodes WHERE id IN ({','.join('?' for _ in ids)})",
    ids,
  ).fetchall()
  return [dict(row) for row in rows]


def list_neighbor_nodes(connection: sqlite3.Connection, document_id: str, node_type: str, ordinal: int, distance: int = 1) -> list[dict[str, Any]]:
  rows = connection.execute(
    """
    SELECT * FROM representation_nodes
    WHERE document_id = ? AND node_type = ? AND ordinal BETWEEN ? AND ?
    ORDER BY ordinal ASC
    """,
    (document_id, node_type, max(0, ordinal - distance), ordinal + distance),
  ).fetchall()
  return [dict(row) for row in rows]


def replace_document_math_data(
  connection: sqlite3.Connection,
  document_id: str,
  math_payload: dict[str, Any] | None,
  *,
  page_node_ids: dict[int, str] | None = None,
) -> None:
  page_node_ids = page_node_ids or {}
  artifact_ids = [row["id"] for row in connection.execute("SELECT id FROM math_artifacts WHERE document_id = ?", (document_id,)).fetchall()]
  formula_ids = [row["id"] for row in connection.execute("SELECT id FROM math_formulae WHERE document_id = ?", (document_id,)).fetchall()]
  if formula_ids:
    _delete_in(connection, "math_formula_links", "formula_id", formula_ids)
  if artifact_ids:
    _delete_in(connection, "math_regions", "artifact_id", artifact_ids)
    _delete_in(connection, "math_formulae", "artifact_id", artifact_ids)
    _delete_in(connection, "math_artifacts", "id", artifact_ids)

  payload = math_payload or {}
  now = utc_now()

  artifact_rows = []
  for artifact in payload.get("artifacts", []):
    artifact_rows.append(
      {
        "id": artifact["id"],
        "document_id": document_id,
        "page_number": int(artifact.get("page_number", 1) or 1),
        "source_ref": artifact.get("source_ref", ""),
        "region_box_json": _json(artifact.get("region_box"), None),
        "image_path": artifact.get("image_path"),
        "raw_text": artifact.get("raw_text", ""),
        "latex": artifact.get("latex"),
        "confidence": float(artifact.get("confidence", 0.0) or 0.0),
        "provider_name": artifact.get("provider_name", ""),
        "selected_provider": artifact.get("selected_provider") or artifact.get("provider_name", ""),
        "model_name": artifact.get("model_name"),
        "extraction_mode": artifact.get("extraction_mode", "native_math"),
        "provider_attempts_json": _json(artifact.get("provider_attempts"), []),
        "normalized_latex": artifact.get("normalized_latex"),
        "mathml": artifact.get("mathml"),
        "handwriting_likelihood": float(artifact.get("handwriting_likelihood", 0.0) or 0.0),
        "quality_tier": artifact.get("quality_tier", "heuristic"),
        "retry_state": artifact.get("retry_state", "idle"),
        "warnings_json": _json(artifact.get("warnings"), []),
        "validation_state": artifact.get("validation_state", "pending"),
        "created_at": artifact.get("created_at") or now,
        "updated_at": now,
      }
    )
  _insert_many(connection, "math_artifacts", artifact_rows)

  region_rows = []
  for region in payload.get("regions", []):
    region_rows.append(
      {
        "id": region["id"],
        "artifact_id": region["artifact_id"],
        "page_number": int(region.get("page_number", 1) or 1),
        "region_index": int(region.get("region_index", 1) or 1),
        "bbox_json": _json(region.get("bbox"), None),
        "image_path": region.get("image_path"),
        "raw_text": region.get("raw_text", ""),
        "confidence": float(region.get("confidence", 0.0) or 0.0),
        "provider_attempts_json": _json(region.get("provider_attempts"), []),
        "handwriting_likelihood": float(region.get("handwriting_likelihood", 0.0) or 0.0),
        "quality_tier": region.get("quality_tier", "region"),
        "status": region.get("status", "pending"),
        "warnings_json": _json(region.get("warnings"), []),
        "created_at": region.get("created_at") or now,
        "updated_at": now,
      }
    )
  _insert_many(connection, "math_regions", region_rows)

  formula_rows = []
  for formula in payload.get("formulae", []):
    page_number = int(formula.get("page_number", 1) or 1)
    formula_rows.append(
      {
        "id": formula["id"],
        "artifact_id": formula["artifact_id"],
        "region_id": formula.get("region_id"),
        "document_id": document_id,
        "node_id": formula.get("node_id") or page_node_ids.get(page_number),
        "page_number": page_number,
        "label": formula.get("label", ""),
        "raw_text": formula.get("raw_text", ""),
        "latex": formula.get("latex"),
        "confidence": float(formula.get("confidence", 0.0) or 0.0),
        "provider_name": formula.get("provider_name", ""),
        "selected_provider": formula.get("selected_provider") or formula.get("provider_name", ""),
        "model_name": formula.get("model_name"),
        "extraction_mode": formula.get("extraction_mode", "native_math"),
        "provider_attempts_json": _json(formula.get("provider_attempts"), []),
        "normalized_latex": formula.get("normalized_latex"),
        "mathml": formula.get("mathml"),
        "handwriting_likelihood": float(formula.get("handwriting_likelihood", 0.0) or 0.0),
        "quality_tier": formula.get("quality_tier", "heuristic"),
        "retry_state": formula.get("retry_state", "idle"),
        "validation_status": formula.get("validation_status", "pending"),
        "warnings_json": _json(formula.get("warnings"), []),
        "created_at": formula.get("created_at") or now,
        "updated_at": now,
      }
    )
  _insert_many(connection, "math_formulae", formula_rows)

  link_rows = []
  for link in payload.get("links", []):
    payload_json = link.get("payload") if "payload" in link else link.get("payload_json")
    page_number = int(json_loads(_json(payload_json, {}), {}).get("page_number", 0) or 0)
    link_rows.append(
      {
        "id": link["id"],
        "formula_id": link["formula_id"],
        "artifact_id": link["artifact_id"],
        "region_id": link.get("region_id"),
        "document_id": document_id,
        "node_id": link.get("node_id") or page_node_ids.get(page_number),
        "link_type": link.get("link_type", "page"),
        "payload_json": _json(payload_json, {}),
        "created_at": link.get("created_at") or now,
        "updated_at": now,
      }
    )
  _insert_many(connection, "math_formula_links", link_rows)


# Citation, footnote, and reference materialization -------------------------------
def replace_document_citation_data(
  connection: sqlite3.Connection,
  document_id: str,
  citation_payload: dict[str, Any] | None,
  *,
  page_node_ids: dict[int, str] | None = None,
) -> None:
  page_node_ids = page_node_ids or {}
  footnote_ids = [row["id"] for row in connection.execute("SELECT id FROM footnote_artifacts WHERE document_id = ?", (document_id,)).fetchall()]
  mention_ids = [row["id"] for row in connection.execute("SELECT id FROM citation_mentions WHERE document_id = ?", (document_id,)).fetchall()]
  entry_ids = [row["id"] for row in connection.execute("SELECT id FROM citation_entries WHERE document_id = ?", (document_id,)).fetchall()]
  if footnote_ids:
    _delete_in(connection, "footnote_spans", "footnote_id", footnote_ids)
    _delete_in(connection, "footnote_artifacts", "id", footnote_ids)
  if mention_ids:
    _delete_in(connection, "citation_links", "source_id", mention_ids)
    _delete_in(connection, "citation_mentions", "id", mention_ids)
  if entry_ids:
    _delete_in(connection, "citation_links", "target_id", entry_ids)
    _delete_in(connection, "citation_entries", "id", entry_ids)

  payload = citation_payload or {}
  now = utc_now()

  entry_rows = []
  for entry in payload.get("entries", []):
    page_number = int(entry.get("page_number", 1) or 1)
    entry_rows.append(
      {
        "id": entry["id"],
        "document_id": document_id,
        "node_id": entry.get("node_id") or page_node_ids.get(page_number),
        "page_number": page_number,
        "section_label": entry.get("section_label", ""),
        "raw_text": entry.get("raw_text", ""),
        "normalized_text": entry.get("normalized_text", ""),
        "entry_type": entry.get("entry_type", "bibliography"),
        "authors_json": _json(entry.get("authors"), []),
        "title": entry.get("title"),
        "year": entry.get("year"),
        "container_title": entry.get("container_title"),
        "publisher": entry.get("publisher"),
        "volume": entry.get("volume"),
        "issue": entry.get("issue"),
        "pages": entry.get("pages"),
        "doi": entry.get("doi"),
        "url": entry.get("url"),
        "isbn": entry.get("isbn"),
        "confidence": float(entry.get("confidence", 0.0) or 0.0),
        "parse_status": entry.get("parse_status", "parsed"),
        "warnings_json": _json(entry.get("warnings"), []),
        "created_at": entry.get("created_at") or now,
        "updated_at": now,
      }
    )
  _insert_many(connection, "citation_entries", entry_rows)

  mention_rows = []
  for mention in payload.get("mentions", []):
    page_number = int(mention.get("page_number", 1) or 1)
    mention_rows.append(
      {
        "id": mention["id"],
        "document_id": document_id,
        "node_id": mention.get("node_id") or page_node_ids.get(page_number),
        "page_number": page_number,
        "mention_text": mention.get("mention_text", ""),
        "normalized_text": mention.get("normalized_text", ""),
        "mention_type": mention.get("mention_type", "inline"),
        "target_label": mention.get("target_label"),
        "target_year": mention.get("target_year"),
        "raw_marker": mention.get("raw_marker"),
        "confidence": float(mention.get("confidence", 0.0) or 0.0),
        "match_status": mention.get("match_status", "unresolved"),
        "warnings_json": _json(mention.get("warnings"), []),
        "created_at": mention.get("created_at") or now,
        "updated_at": now,
      }
    )
  _insert_many(connection, "citation_mentions", mention_rows)

  footnote_rows = []
  for footnote in payload.get("footnotes", []):
    page_number = int(footnote.get("page_number", 1) or 1)
    footnote_rows.append(
      {
        "id": footnote["id"],
        "document_id": document_id,
        "node_id": footnote.get("node_id") or page_node_ids.get(page_number),
        "page_number": page_number,
        "note_label": footnote.get("note_label", ""),
        "raw_text": footnote.get("raw_text", ""),
        "normalized_text": footnote.get("normalized_text", ""),
        "kind": footnote.get("kind", "mixed"),
        "confidence": float(footnote.get("confidence", 0.0) or 0.0),
        "citations_detected": int(footnote.get("citations_detected", 0) or 0),
        "commentary_detected": int(footnote.get("commentary_detected", 0) or 0),
        "warnings_json": _json(footnote.get("warnings"), []),
        "created_at": footnote.get("created_at") or now,
        "updated_at": now,
      }
    )
  _insert_many(connection, "footnote_artifacts", footnote_rows)

  span_rows = []
  for span in payload.get("spans", []):
    span_rows.append(
      {
        "id": span["id"],
        "footnote_id": span["footnote_id"],
        "span_index": int(span.get("span_index", 1) or 1),
        "span_kind": span.get("span_kind", "unknown"),
        "text": span.get("text", ""),
        "normalized_text": span.get("normalized_text", ""),
        "confidence": float(span.get("confidence", 0.0) or 0.0),
        "citation_entry_id": span.get("citation_entry_id"),
        "citation_mention_id": span.get("citation_mention_id"),
        "created_at": span.get("created_at") or now,
        "updated_at": now,
      }
    )
  _insert_many(connection, "footnote_spans", span_rows)

  link_rows = []
  for link in payload.get("links", []):
    link_rows.append(
      {
        "id": link["id"],
        "document_id": document_id,
        "source_kind": link.get("source_kind", "mention"),
        "source_id": link.get("source_id", ""),
        "target_kind": link.get("target_kind", "entry"),
        "target_id": link.get("target_id", ""),
        "link_type": link.get("link_type", "candidate_match"),
        "payload_json": _json(link.get("payload"), {}),
        "created_at": link.get("created_at") or now,
        "updated_at": now,
      }
    )
  _insert_many(connection, "citation_links", link_rows)


def list_document_citation_entries(connection: sqlite3.Connection, document_id: str) -> list[dict[str, Any]]:
  rows = connection.execute(
    """
    SELECT *
    FROM citation_entries
    WHERE document_id = ?
    ORDER BY page_number ASC, confidence DESC, id ASC
    """,
    (document_id,),
  ).fetchall()
  items = []
  for row in rows:
    payload = dict(row)
    payload["authors"] = json_loads(payload.pop("authors_json", None), [])
    payload["warnings"] = json_loads(payload.pop("warnings_json", None), [])
    link_items: list[dict[str, Any]] = []
    for link_row in connection.execute(
      "SELECT * FROM citation_links WHERE document_id = ? AND target_id = ? ORDER BY updated_at DESC",
      (document_id, row["id"]),
    ).fetchall():
      link_payload = dict(link_row)
      link_payload["payload"] = json_loads(link_payload.pop("payload_json", None), {})
      link_items.append(link_payload)
    payload["links"] = link_items
    items.append(payload)
  return items


def list_document_citation_mentions(connection: sqlite3.Connection, document_id: str) -> list[dict[str, Any]]:
  rows = connection.execute(
    """
    SELECT *
    FROM citation_mentions
    WHERE document_id = ?
    ORDER BY page_number ASC, id ASC
    """,
    (document_id,),
  ).fetchall()
  items = []
  for row in rows:
    payload = dict(row)
    payload["warnings"] = json_loads(payload.pop("warnings_json", None), [])
    items.append(payload)
  return items


def get_citation_entry(connection: sqlite3.Connection, citation_id: str) -> dict[str, Any] | None:
  row = connection.execute("SELECT * FROM citation_entries WHERE id = ?", (citation_id,)).fetchone()
  if row is None:
    return None
  matches = list_document_citation_entries(connection, row["document_id"])
  return next((item for item in matches if item["id"] == citation_id), None)


def list_document_footnotes(connection: sqlite3.Connection, document_id: str) -> list[dict[str, Any]]:
  rows = connection.execute(
    """
    SELECT *
    FROM footnote_artifacts
    WHERE document_id = ?
    ORDER BY page_number ASC, note_label ASC, id ASC
    """,
    (document_id,),
  ).fetchall()
  items = []
  for row in rows:
    payload = dict(row)
    payload["warnings"] = json_loads(payload.pop("warnings_json", None), [])
    span_rows = connection.execute(
      "SELECT * FROM footnote_spans WHERE footnote_id = ? ORDER BY span_index ASC",
      (row["id"],),
    ).fetchall()
    payload["spans"] = [
      {
        **dict(span_row),
        "confidence": float(dict(span_row).get("confidence") or 0.0),
      }
      for span_row in span_rows
    ]
    items.append(payload)
  return items


def citation_summary_for_document(connection: sqlite3.Connection, document_id: str) -> dict[str, Any]:
  entry_row = connection.execute(
    """
    SELECT
      COUNT(*) AS entry_count,
      SUM(CASE WHEN parse_status = 'parsed' THEN 1 ELSE 0 END) AS parsed_count,
      SUM(CASE WHEN parse_status = 'partially_parsed' THEN 1 ELSE 0 END) AS partially_parsed_count,
      SUM(CASE WHEN parse_status = 'unresolved' THEN 1 ELSE 0 END) AS unresolved_count,
      AVG(confidence) AS average_confidence
    FROM citation_entries
    WHERE document_id = ?
    """,
    (document_id,),
  ).fetchone()
  mention_row = connection.execute(
    """
    SELECT
      COUNT(*) AS mention_count,
      SUM(CASE WHEN match_status = 'matched' THEN 1 ELSE 0 END) AS matched_count,
      AVG(confidence) AS average_confidence
    FROM citation_mentions
    WHERE document_id = ?
    """,
    (document_id,),
  ).fetchone()
  footnote_row = connection.execute(
    """
    SELECT
      COUNT(*) AS footnote_count,
      SUM(CASE WHEN kind = 'mixed' THEN 1 ELSE 0 END) AS mixed_count,
      SUM(CASE WHEN kind = 'commentary' THEN 1 ELSE 0 END) AS commentary_count,
      SUM(CASE WHEN kind = 'citation' THEN 1 ELSE 0 END) AS citation_only_count,
      AVG(confidence) AS average_confidence
    FROM footnote_artifacts
    WHERE document_id = ?
    """,
    (document_id,),
  ).fetchone()
  mention_count = int(mention_row["mention_count"] or 0) if mention_row else 0
  matched_count = int(mention_row["matched_count"] or 0) if mention_row else 0
  unresolved_count = max(mention_count - matched_count, 0)
  return {
    "entry_count": int(entry_row["entry_count"] or 0) if entry_row else 0,
    "parsed_entry_count": int(entry_row["parsed_count"] or 0) if entry_row else 0,
    "partially_parsed_entry_count": int(entry_row["partially_parsed_count"] or 0) if entry_row else 0,
    "unresolved_entry_count": int(entry_row["unresolved_count"] or 0) if entry_row else 0,
    "average_entry_confidence": round(float(entry_row["average_confidence"] or 0.0), 3) if entry_row else 0.0,
    "mention_count": mention_count,
    "matched_mention_count": matched_count,
    "unresolved_mention_count": unresolved_count,
    "average_mention_confidence": round(float(mention_row["average_confidence"] or 0.0), 3) if mention_row else 0.0,
    "footnote_count": int(footnote_row["footnote_count"] or 0) if footnote_row else 0,
    "mixed_footnote_count": int(footnote_row["mixed_count"] or 0) if footnote_row else 0,
    "commentary_footnote_count": int(footnote_row["commentary_count"] or 0) if footnote_row else 0,
    "citation_only_footnote_count": int(footnote_row["citation_only_count"] or 0) if footnote_row else 0,
    "average_footnote_confidence": round(float(footnote_row["average_confidence"] or 0.0), 3) if footnote_row else 0.0,
    "match_rate": round(matched_count / mention_count, 3) if mention_count else 0.0,
    "unresolved_rate": round(unresolved_count / mention_count, 3) if mention_count else 0.0,
  }


def list_document_math_formulae(connection: sqlite3.Connection, document_id: str) -> list[dict[str, Any]]:
  formula_rows = connection.execute(
    """
    SELECT *
    FROM math_formulae
    WHERE document_id = ?
    ORDER BY page_number ASC, confidence DESC, id ASC
    """,
    (document_id,),
  ).fetchall()
  formulas = [dict(row) for row in formula_rows]
  if not formulas:
    return []

  formula_ids = [item["id"] for item in formulas]
  artifact_ids = sorted({item["artifact_id"] for item in formulas if item.get("artifact_id")})
  region_ids = sorted({item["region_id"] for item in formulas if item.get("region_id")})

  artifacts = {
    row["id"]: dict(row)
    for row in connection.execute(
      f"SELECT * FROM math_artifacts WHERE id IN ({','.join('?' for _ in artifact_ids)})",
      artifact_ids,
    ).fetchall()
  } if artifact_ids else {}
  regions = {
    row["id"]: dict(row)
    for row in connection.execute(
      f"SELECT * FROM math_regions WHERE id IN ({','.join('?' for _ in region_ids)})",
      region_ids,
    ).fetchall()
  } if region_ids else {}
  link_rows = connection.execute(
    f"SELECT * FROM math_formula_links WHERE formula_id IN ({','.join('?' for _ in formula_ids)}) ORDER BY updated_at DESC",
    formula_ids,
  ).fetchall()
  links_by_formula: dict[str, list[dict[str, Any]]] = {}
  for row in link_rows:
    payload = dict(row)
    payload["payload"] = json_loads(payload.pop("payload_json", None), {})
    links_by_formula.setdefault(payload["formula_id"], []).append(payload)

  hydrated: list[dict[str, Any]] = []
  for formula in formulas:
    payload = dict(formula)
    payload["warnings"] = json_loads(payload.pop("warnings_json", None), [])
    payload["provider_attempts"] = json_loads(payload.pop("provider_attempts_json", None), [])
    artifact = dict(artifacts.get(formula["artifact_id"], {}))
    if artifact:
      artifact["warnings"] = json_loads(artifact.pop("warnings_json", None), [])
      artifact["provider_attempts"] = json_loads(artifact.pop("provider_attempts_json", None), [])
      artifact["region_box"] = json_loads(artifact.pop("region_box_json", None), None)
    region = dict(regions.get(formula.get("region_id"), {}))
    if region:
      region["warnings"] = json_loads(region.pop("warnings_json", None), [])
      region["provider_attempts"] = json_loads(region.pop("provider_attempts_json", None), [])
      region["bbox"] = json_loads(region.pop("bbox_json", None), None)
    payload["artifact"] = artifact or None
    payload["region"] = region or None
    payload["links"] = links_by_formula.get(formula["id"], [])
    hydrated.append(payload)
  return hydrated


def get_math_formula(connection: sqlite3.Connection, formula_id: str) -> dict[str, Any] | None:
  row = connection.execute("SELECT * FROM math_formulae WHERE id = ?", (formula_id,)).fetchone()
  if row is None:
    return None
  matches = list_document_math_formulae(connection, row["document_id"])
  return next((item for item in matches if item["id"] == formula_id), None)


def queue_math_formula_retry(connection: sqlite3.Connection, *, formula_ids: Iterable[str] | None = None, document_id: str | None = None) -> int:
  ids = [item for item in (formula_ids or []) if item]
  if document_id:
    rows = connection.execute("SELECT id FROM math_formulae WHERE document_id = ?", (document_id,)).fetchall()
    ids.extend(row["id"] for row in rows)
  ids = sorted(set(ids))
  if not ids:
    return 0
  now = utc_now()
  connection.execute(
    (
      f"UPDATE math_formulae SET validation_status = 'pending_retry', retry_state = 'pending_retry', updated_at = ? "
      f"WHERE id IN ({','.join('?' for _ in ids)})"
    ),
    [now, *ids],
  )
  return len(ids)


def math_summary_for_document(connection: sqlite3.Connection, document_id: str) -> dict[str, Any]:
  row = connection.execute(
    """
    SELECT
      COUNT(*) AS formula_count,
      SUM(CASE WHEN latex IS NOT NULL AND latex <> '' THEN 1 ELSE 0 END) AS recognized_count,
      SUM(CASE WHEN validation_status <> 'recognized' THEN 1 ELSE 0 END) AS pending_count,
      SUM(CASE WHEN retry_state = 'pending_retry' THEN 1 ELSE 0 END) AS retry_ready_count,
      AVG(confidence) AS average_confidence
    FROM math_formulae
    WHERE document_id = ?
    """,
    (document_id,),
  ).fetchone()
  if row is None:
    return {
      "formula_count": 0,
      "recognized_count": 0,
      "pending_count": 0,
      "average_confidence": 0.0,
    }
  return {
    "formula_count": int(row["formula_count"] or 0),
    "recognized_count": int(row["recognized_count"] or 0),
    "pending_count": int(row["pending_count"] or 0),
    "retry_ready_count": int(row["retry_ready_count"] or 0),
    "average_confidence": round(float(row["average_confidence"] or 0.0), 3),
    "provider_mix": {
      item["selected_provider"] or item["provider_name"] or "unknown": int(item["count"])
      for item in connection.execute(
        """
        SELECT
          COALESCE(NULLIF(selected_provider, ''), provider_name, 'unknown') AS selected_provider,
          COUNT(*) AS count
        FROM math_formulae
        WHERE document_id = ?
        GROUP BY COALESCE(NULLIF(selected_provider, ''), provider_name, 'unknown')
        ORDER BY count DESC, selected_provider ASC
        """,
        (document_id,),
      ).fetchall()
    },
  }


def list_import_jobs(connection: sqlite3.Connection) -> list[dict[str, Any]]:
  rows = connection.execute("SELECT * FROM import_jobs ORDER BY created_at DESC").fetchall()
  return [dict(row) for row in rows]


def list_import_jobs_by_source_path(connection: sqlite3.Connection, source_path: str) -> list[dict[str, Any]]:
  rows = connection.execute(
    """
    SELECT *
    FROM import_jobs
    WHERE source_path = ?
    ORDER BY
      CASE status
        WHEN 'running' THEN 0
        WHEN 'queued' THEN 1
        WHEN 'failed' THEN 2
        WHEN 'completed' THEN 3
        ELSE 4
      END,
      created_at ASC,
      id ASC
    """,
    (source_path,),
  ).fetchall()
  return [dict(row) for row in rows]


def find_active_import_job(connection: sqlite3.Connection, source_path: str, kind: str | None = None) -> dict[str, Any] | None:
  params: list[Any] = [source_path]
  query = """
    SELECT *
    FROM import_jobs
    WHERE source_path = ?
      AND status IN ('queued', 'running')
  """
  if kind:
    query += " AND kind = ?"
    params.append(kind)
  query += """
    ORDER BY
      CASE status
        WHEN 'running' THEN 0
        WHEN 'queued' THEN 1
        ELSE 2
      END,
      created_at ASC,
      id ASC
    LIMIT 1
  """
  row = connection.execute(query, params).fetchone()
  return row_to_dict(row)


def import_job_stats(connection: sqlite3.Connection) -> dict[str, int]:
  rows = connection.execute("SELECT status, COUNT(*) AS count FROM import_jobs GROUP BY status").fetchall()
  stats = {"queued": 0, "running": 0, "completed": 0, "failed": 0}
  for row in rows:
    stats[row["status"]] = int(row["count"])
  return stats


def get_import_job(connection: sqlite3.Connection, job_id: str) -> dict[str, Any] | None:
  row = connection.execute("SELECT * FROM import_jobs WHERE id = ?", (job_id,)).fetchone()
  return row_to_dict(row)


def create_import_job(connection: sqlite3.Connection, kind: str, source_path: str, created_by: str | None, options: dict[str, Any] | None = None) -> dict[str, Any]:
  now = utc_now()
  job = {
    "id": f"job-{uuid4().hex}",
    "kind": kind,
    "source_path": source_path,
    "status": "queued",
    "created_by": created_by,
    "document_count": 0,
    "options_json": _json(options, {}),
    "warnings_json": "[]",
    "current_stage": None,
    "progress_completed": 0,
    "progress_total": 0,
    "stage_warnings_json": "[]",
    "error_code": None,
    "error_text": None,
    "state_json": "{}",
    "created_at": now,
    "updated_at": now,
    "started_at": None,
    "finished_at": None,
  }
  connection.execute(
    """
    INSERT INTO import_jobs (
      id, kind, source_path, status, created_by, document_count, options_json, warnings_json, current_stage,
      progress_completed, progress_total, stage_warnings_json, error_code, error_text, state_json,
      created_at, updated_at, started_at, finished_at
    )
    VALUES (
      :id, :kind, :source_path, :status, :created_by, :document_count, :options_json, :warnings_json, :current_stage,
      :progress_completed, :progress_total, :stage_warnings_json, :error_code, :error_text, :state_json,
      :created_at, :updated_at, :started_at, :finished_at
    )
    """,
    job,
  )
  return job


def update_import_job(connection: sqlite3.Connection, job_id: str, **updates: Any) -> None:
  if not updates:
    return
  updates["updated_at"] = utc_now()
  if "options_json" in updates:
    updates["options_json"] = _json(updates["options_json"], {})
  if "warnings_json" in updates:
    updates["warnings_json"] = _json(updates["warnings_json"], [])
  if "stage_warnings_json" in updates:
    updates["stage_warnings_json"] = _json(updates["stage_warnings_json"], [])
  if "state_json" in updates:
    updates["state_json"] = _json(updates["state_json"], {})
  columns = ", ".join(f"{key} = :{key}" for key in updates.keys())
  updates["id"] = job_id
  connection.execute(f"UPDATE import_jobs SET {columns} WHERE id = :id", updates)


def delete_import_jobs(connection: sqlite3.Connection, job_ids: Iterable[str]) -> dict[str, int]:
  ids = [job_id for job_id in job_ids if job_id]
  if not ids:
    return {"deleted_jobs": 0, "deleted_tasks": 0}
  placeholders = ",".join("?" for _ in ids)
  task_count_row = connection.execute(
    f"SELECT COUNT(*) AS count FROM pipeline_tasks WHERE job_id IN ({placeholders})",
    ids,
  ).fetchone()
  deleted_tasks = int(task_count_row["count"] if task_count_row else 0)
  connection.execute(
    f"DELETE FROM pipeline_tasks WHERE job_id IN ({placeholders})",
    ids,
  )
  connection.execute(
    f"UPDATE watched_files SET last_import_job_id = NULL WHERE last_import_job_id IN ({placeholders})",
    ids,
  )
  connection.execute(
    f"UPDATE tracked_files SET last_import_job_id = NULL WHERE last_import_job_id IN ({placeholders})",
    ids,
  )
  connection.execute(
    f"DELETE FROM import_jobs WHERE id IN ({placeholders})",
    ids,
  )
  return {"deleted_jobs": len(ids), "deleted_tasks": deleted_tasks}


def deduplicate_import_jobs(connection: sqlite3.Connection, source_path: str, keep_job_id: str | None = None) -> dict[str, Any]:
  jobs = [job for job in list_import_jobs_by_source_path(connection, source_path) if job.get("status") in {"queued", "running"}]
  if len(jobs) <= 1:
    return {"kept_job_id": jobs[0]["id"] if jobs else None, "deleted_job_ids": [], "deleted_jobs": 0, "deleted_tasks": 0}

  keep_job = None
  if keep_job_id:
    keep_job = next((job for job in jobs if job["id"] == keep_job_id), None)
  if keep_job is None:
    keep_job = next((job for job in jobs if job["status"] == "running"), None)
  if keep_job is None:
    keep_job = next((job for job in jobs if job["status"] == "queued"), None)
  if keep_job is None:
    keep_job = jobs[0]

  delete_ids = [job["id"] for job in jobs if job["id"] != keep_job["id"]]
  result = delete_import_jobs(connection, delete_ids)
  result["kept_job_id"] = keep_job["id"]
  result["deleted_job_ids"] = delete_ids
  return result


def reset_import_jobs(connection: sqlite3.Connection) -> dict[str, int]:
  job_count_row = connection.execute("SELECT COUNT(*) AS count FROM import_jobs").fetchone()
  task_count_row = connection.execute("SELECT COUNT(*) AS count FROM pipeline_tasks").fetchone()
  job_count = int(job_count_row["count"] if job_count_row else 0)
  task_count = int(task_count_row["count"] if task_count_row else 0)
  connection.execute("DELETE FROM pipeline_tasks")
  connection.execute("DELETE FROM import_jobs")
  connection.execute("UPDATE watched_files SET last_import_job_id = NULL")
  connection.execute("UPDATE tracked_files SET last_import_job_id = NULL")
  return {"deleted_jobs": job_count, "deleted_tasks": task_count}


def list_watch_folders(connection: sqlite3.Connection) -> list[dict[str, Any]]:
  rows = connection.execute("SELECT * FROM watch_folders ORDER BY created_at DESC").fetchall()
  return [dict(row) for row in rows]


def get_watch_folder(connection: sqlite3.Connection, watch_folder_id: str) -> dict[str, Any] | None:
  row = connection.execute("SELECT * FROM watch_folders WHERE id = ?", (watch_folder_id,)).fetchone()
  return row_to_dict(row)


def create_watch_folder(
  connection: sqlite3.Connection,
  path: str,
  recursive: bool,
  created_by: str | None,
  *,
  include_extensions: list[str] | None = None,
  exclude_globs: list[str] | None = None,
) -> dict[str, Any]:
  now = utc_now()
  payload = {
    "id": f"watch-{uuid4().hex}",
    "path": path,
    "enabled": 1,
    "recursive": 1 if recursive else 0,
    "include_extensions_json": _json(include_extensions, []),
    "exclude_globs_json": _json(exclude_globs, []),
    "created_by": created_by,
    "created_at": now,
    "updated_at": now,
    "last_scanned_at": None,
    "last_scan_started_at": None,
    "last_scan_finished_at": None,
    "files_seen": 0,
    "files_added": 0,
    "files_changed": 0,
    "files_deleted": 0,
    "scan_errors": 0,
    "watch_backend": "polling",
    "last_event_at": None,
    "last_event_summary_json": "{}",
    "error_text": None,
  }
  connection.execute(
    """
    INSERT INTO watch_folders (
      id, path, enabled, recursive, include_extensions_json, exclude_globs_json, created_by, created_at, updated_at,
      last_scanned_at, last_scan_started_at, last_scan_finished_at, files_seen, files_added, files_changed,
      files_deleted, scan_errors, watch_backend, last_event_at, last_event_summary_json, error_text
    )
    VALUES (
      :id, :path, :enabled, :recursive, :include_extensions_json, :exclude_globs_json, :created_by, :created_at, :updated_at,
      :last_scanned_at, :last_scan_started_at, :last_scan_finished_at, :files_seen, :files_added, :files_changed,
      :files_deleted, :scan_errors, :watch_backend, :last_event_at, :last_event_summary_json, :error_text
    )
    ON CONFLICT(path) DO UPDATE SET
      recursive = excluded.recursive,
      include_extensions_json = excluded.include_extensions_json,
      exclude_globs_json = excluded.exclude_globs_json,
      enabled = 1,
      updated_at = excluded.updated_at,
      error_text = NULL
    """,
    payload,
  )
  row = connection.execute("SELECT * FROM watch_folders WHERE path = ?", (path,)).fetchone()
  return dict(row)


def update_watch_folder(connection: sqlite3.Connection, watch_folder_id: str, **updates: Any) -> None:
  if not updates:
    return
  if "include_extensions_json" in updates:
    updates["include_extensions_json"] = _json(updates["include_extensions_json"], [])
  if "exclude_globs_json" in updates:
    updates["exclude_globs_json"] = _json(updates["exclude_globs_json"], [])
  if "last_event_summary_json" in updates:
    updates["last_event_summary_json"] = _json(updates["last_event_summary_json"], {})
  updates["updated_at"] = utc_now()
  updates["id"] = watch_folder_id
  columns = ", ".join(f"{key} = :{key}" for key in updates.keys() if key != "id")
  connection.execute(f"UPDATE watch_folders SET {columns} WHERE id = :id", updates)


def list_pipeline_tasks(connection: sqlite3.Connection, job_ids: Iterable[str] | None = None) -> list[dict[str, Any]]:
  if job_ids:
    ids = list(job_ids)
    if not ids:
      return []
    rows = connection.execute(
      f"SELECT * FROM pipeline_tasks WHERE job_id IN ({','.join('?' for _ in ids)}) ORDER BY job_id ASC, sequence ASC",
      ids,
    ).fetchall()
    return [dict(row) for row in rows]
  rows = connection.execute("SELECT * FROM pipeline_tasks ORDER BY created_at ASC, sequence ASC").fetchall()
  return [dict(row) for row in rows]


def create_pipeline_task(connection: sqlite3.Connection, job_id: str, stage: str, sequence: int, status: str = "queued", payload: dict[str, Any] | None = None) -> dict[str, Any]:
  now = utc_now()
  row = {
    "id": f"task-{uuid4().hex}",
    "job_id": job_id,
    "stage": stage,
    "sequence": sequence,
    "status": status,
    "progress_completed": 0,
    "progress_total": 0,
    "warnings_json": "[]",
    "error_code": None,
    "error_text": None,
    "payload_json": _json(payload, {}),
    "created_at": now,
    "updated_at": now,
    "started_at": None,
    "finished_at": None,
  }
  connection.execute(
    """
    INSERT INTO pipeline_tasks (
      id, job_id, stage, sequence, status, progress_completed, progress_total, warnings_json,
      error_code, error_text, payload_json, created_at, updated_at, started_at, finished_at
    )
    VALUES (
      :id, :job_id, :stage, :sequence, :status, :progress_completed, :progress_total, :warnings_json,
      :error_code, :error_text, :payload_json, :created_at, :updated_at, :started_at, :finished_at
    )
    """,
    row,
  )
  return row


def update_pipeline_task(connection: sqlite3.Connection, task_id: str, **updates: Any) -> None:
  if not updates:
    return
  updates["updated_at"] = utc_now()
  if "warnings_json" in updates:
    updates["warnings_json"] = _json(updates["warnings_json"], [])
  if "payload_json" in updates:
    updates["payload_json"] = _json(updates["payload_json"], {})
  updates["id"] = task_id
  columns = ", ".join(f"{key} = :{key}" for key in updates.keys() if key != "id")
  connection.execute(f"UPDATE pipeline_tasks SET {columns} WHERE id = :id", updates)


def get_pipeline_task(connection: sqlite3.Connection, task_id: str) -> dict[str, Any] | None:
  row = connection.execute("SELECT * FROM pipeline_tasks WHERE id = ?", (task_id,)).fetchone()
  return row_to_dict(row)


def get_or_create_pipeline_tasks(connection: sqlite3.Connection, job_id: str, stages: list[str]) -> list[dict[str, Any]]:
  existing = list_pipeline_tasks(connection, [job_id])
  existing_by_stage = {task["stage"]: task for task in existing}
  if not existing:
    created = []
    for sequence, stage in enumerate(stages, start=1):
      created.append(create_pipeline_task(connection, job_id, stage, sequence))
    return created

  for sequence, stage in enumerate(stages, start=1):
    task = existing_by_stage.get(stage)
    if task is None:
      task = create_pipeline_task(connection, job_id, stage, sequence)
      existing_by_stage[stage] = task
    elif int(task.get("sequence") or 0) != sequence:
      update_pipeline_task(connection, task["id"], sequence=sequence)
  return list_pipeline_tasks(connection, [job_id])


def list_watched_files(connection: sqlite3.Connection, watch_folder_id: str) -> list[dict[str, Any]]:
  rows = connection.execute(
    "SELECT * FROM watched_files WHERE watch_folder_id = ? ORDER BY relative_path ASC",
    (watch_folder_id,),
  ).fetchall()
  return [dict(row) for row in rows]


def upsert_watched_file(
  connection: sqlite3.Connection,
  watch_folder_id: str,
  file_path: str,
  relative_path: str,
  size_bytes: int,
  modified_at: str | None,
  checksum: str | None,
  last_import_job_id: str | None = None,
) -> dict[str, Any]:
  now = utc_now()
  payload = {
    "id": f"wf-{uuid4().hex}",
    "watch_folder_id": watch_folder_id,
    "file_path": file_path,
    "relative_path": relative_path,
    "size_bytes": size_bytes,
    "modified_at": modified_at,
    "checksum": checksum,
    "last_seen_at": now,
    "last_import_job_id": last_import_job_id,
    "created_at": now,
    "updated_at": now,
  }
  connection.execute(
    """
    INSERT INTO watched_files (
      id, watch_folder_id, file_path, relative_path, size_bytes, modified_at, checksum, last_seen_at, last_import_job_id, created_at, updated_at
    )
    VALUES (
      :id, :watch_folder_id, :file_path, :relative_path, :size_bytes, :modified_at, :checksum, :last_seen_at, :last_import_job_id, :created_at, :updated_at
    )
    ON CONFLICT(watch_folder_id, file_path) DO UPDATE SET
      relative_path = excluded.relative_path,
      size_bytes = excluded.size_bytes,
      modified_at = excluded.modified_at,
      checksum = excluded.checksum,
      last_seen_at = excluded.last_seen_at,
      last_import_job_id = COALESCE(excluded.last_import_job_id, watched_files.last_import_job_id),
      updated_at = excluded.updated_at
    """,
    payload,
  )
  row = connection.execute(
    "SELECT * FROM watched_files WHERE watch_folder_id = ? AND file_path = ?",
    (watch_folder_id, file_path),
  ).fetchone()
  return dict(row)


def find_watch_folder_for_path(connection: sqlite3.Connection, absolute_path: str | Path) -> dict[str, Any] | None:
  normalized = normalize_absolute_path(absolute_path)
  best_match = None
  best_length = -1
  for folder in list_watch_folders(connection):
    folder_path = normalize_absolute_path(folder["path"])
    candidate_prefixes = {folder_path}
    if not folder_path.endswith(os.sep):
      candidate_prefixes.add(f"{folder_path}{os.sep}")
    if normalized == folder_path or any(normalized.startswith(prefix) for prefix in candidate_prefixes):
      if len(folder_path) > best_length:
        best_match = folder
        best_length = len(folder_path)
  return best_match


def get_tracked_file(connection: sqlite3.Connection, tracked_file_id: str) -> dict[str, Any] | None:
  row = connection.execute("SELECT * FROM tracked_files WHERE id = ?", (tracked_file_id,)).fetchone()
  return row_to_dict(row)


def get_tracked_file_by_path(connection: sqlite3.Connection, absolute_path: str | Path) -> dict[str, Any] | None:
  row = connection.execute(
    "SELECT * FROM tracked_files WHERE absolute_path = ?",
    (normalize_absolute_path(absolute_path),),
  ).fetchone()
  return row_to_dict(row)


def list_tracked_files(
  connection: sqlite3.Connection,
  *,
  overall_status: str | None = None,
  stale: bool | None = None,
  root_watch_folder_id: str | None = None,
  bucket: str | None = None,
  limit: int = 200,
) -> list[dict[str, Any]]:
  clauses: list[str] = []
  params: list[Any] = []
  if overall_status:
    clauses.append("overall_status = ?")
    params.append(overall_status)
  if stale is not None:
    clauses.append("stale = ?")
    params.append(1 if stale else 0)
  if root_watch_folder_id:
    clauses.append("root_watch_folder_id = ?")
    params.append(root_watch_folder_id)
  normalized_bucket = str(bucket or "").strip().lower()
  if normalized_bucket == "stale":
    clauses.append("stale = 1")
  elif normalized_bucket == "failed":
    clauses.append("(overall_status = 'failed' OR error_message IS NOT NULL)")
  elif normalized_bucket == "new":
    clauses.append("overall_status IN ('discovered', 'pending_import')")
  where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
  rows = connection.execute(
    f"""
    SELECT *
    FROM tracked_files
    {where_sql}
    ORDER BY
      CASE overall_status
        WHEN 'failed' THEN 0
        WHEN 'extracting' THEN 1
        WHEN 'ocr_pending' THEN 2
        WHEN 'pending_import' THEN 3
        WHEN 'discovered' THEN 4
        WHEN 'stale' THEN 5
        ELSE 6
      END,
      updated_at DESC,
      relative_path ASC
    LIMIT ?
    """,
    [*params, max(int(limit), 1)],
  ).fetchall()
  return [dict(row) for row in rows]


def list_tracked_file_events(connection: sqlite3.Connection, tracked_file_id: str) -> list[dict[str, Any]]:
  rows = connection.execute(
    """
    SELECT *
    FROM tracked_file_events
    WHERE tracked_file_id = ?
    ORDER BY created_at DESC, id DESC
    """,
    (tracked_file_id,),
  ).fetchall()
  return [dict(row) for row in rows]


def list_recent_tracked_file_events(
  connection: sqlite3.Connection,
  *,
  limit: int = 200,
  root_watch_folder_id: str | None = None,
) -> list[dict[str, Any]]:
  clauses: list[str] = []
  params: list[Any] = []
  if root_watch_folder_id:
    clauses.append("tf.root_watch_folder_id = ?")
    params.append(root_watch_folder_id)
  where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
  rows = connection.execute(
    f"""
    SELECT
      e.*,
      tf.absolute_path AS absolute_path,
      tf.relative_path AS relative_path,
      tf.overall_status AS overall_status
    FROM tracked_file_events e
    JOIN tracked_files tf ON tf.id = e.tracked_file_id
    {where_sql}
    ORDER BY e.created_at DESC, e.id DESC
    LIMIT ?
    """,
    [*params, max(int(limit), 1)],
  ).fetchall()
  return [dict(row) for row in rows]


def _upsert_tracked_file_row(connection: sqlite3.Connection, payload: dict[str, Any]) -> dict[str, Any]:
  connection.execute(
    """
    INSERT INTO tracked_files (
      id, root_watch_folder_id, absolute_path, relative_path, extension, size_bytes, mtime, checksum_sha1,
      discovered_at, last_seen_at, last_import_job_id, extraction_status, ocr_status, chunk_status,
      embedding_status, index_status, overall_status, stale, error_message, metadata_json, created_at, updated_at
    )
    VALUES (
      :id, :root_watch_folder_id, :absolute_path, :relative_path, :extension, :size_bytes, :mtime, :checksum_sha1,
      :discovered_at, :last_seen_at, :last_import_job_id, :extraction_status, :ocr_status, :chunk_status,
      :embedding_status, :index_status, :overall_status, :stale, :error_message, :metadata_json, :created_at, :updated_at
    )
    ON CONFLICT(absolute_path) DO UPDATE SET
      root_watch_folder_id = COALESCE(excluded.root_watch_folder_id, tracked_files.root_watch_folder_id),
      relative_path = excluded.relative_path,
      extension = excluded.extension,
      size_bytes = excluded.size_bytes,
      mtime = excluded.mtime,
      checksum_sha1 = COALESCE(excluded.checksum_sha1, tracked_files.checksum_sha1),
      last_seen_at = excluded.last_seen_at,
      last_import_job_id = COALESCE(excluded.last_import_job_id, tracked_files.last_import_job_id),
      extraction_status = excluded.extraction_status,
      ocr_status = excluded.ocr_status,
      chunk_status = excluded.chunk_status,
      embedding_status = excluded.embedding_status,
      index_status = excluded.index_status,
      overall_status = excluded.overall_status,
      stale = excluded.stale,
      error_message = excluded.error_message,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
    """,
    payload,
  )
  row = connection.execute("SELECT * FROM tracked_files WHERE absolute_path = ?", (payload["absolute_path"],)).fetchone()
  return dict(row)


def upsert_tracked_file_discovery(
  connection: sqlite3.Connection,
  *,
  root_watch_folder_id: str | None,
  absolute_path: str | Path,
  relative_path: str,
  size_bytes: int,
  mtime: str | None,
  checksum_sha1: str | None,
  last_import_job_id: str | None = None,
  pending_import: bool = False,
  metadata_json: dict[str, Any] | None = None,
) -> dict[str, Any]:
  normalized_path = normalize_absolute_path(absolute_path)
  existing = get_tracked_file_by_path(connection, normalized_path)
  now = utc_now()
  payload = {
    "id": existing["id"] if existing else f"tf-{uuid4().hex}",
    "root_watch_folder_id": root_watch_folder_id or (existing.get("root_watch_folder_id") if existing else None),
    "absolute_path": normalized_path,
    "relative_path": relative_path,
    "extension": Path(normalized_path).suffix.lower(),
    "size_bytes": int(size_bytes or 0),
    "mtime": mtime,
    "checksum_sha1": checksum_sha1,
    "discovered_at": existing.get("discovered_at") if existing else now,
    "last_seen_at": now,
    "last_import_job_id": last_import_job_id if last_import_job_id is not None else (existing.get("last_import_job_id") if existing else None),
    "extraction_status": (existing.get("extraction_status") if existing else "pending") or "pending",
    "ocr_status": (existing.get("ocr_status") if existing else "pending") or "pending",
    "chunk_status": (existing.get("chunk_status") if existing else "pending") or "pending",
    "embedding_status": (existing.get("embedding_status") if existing else "pending") or "pending",
    "index_status": (existing.get("index_status") if existing else "pending") or "pending",
    "overall_status": existing.get("overall_status") if existing else "discovered",
    "stale": 0,
    "error_message": None if pending_import else (existing.get("error_message") if existing else None),
    "metadata_json": _tracked_file_metadata({
      **json_loads(existing.get("metadata_json") if existing else "{}", {}),
      **dict(metadata_json or {}),
    }),
    "created_at": existing.get("created_at") if existing else now,
    "updated_at": now,
  }
  if pending_import:
    payload["overall_status"] = "pending_import"
  elif not existing:
    payload["overall_status"] = "discovered"
  elif payload["overall_status"] == "stale":
    payload["overall_status"] = _compute_overall_tracked_file_status(payload)
  row = _upsert_tracked_file_row(connection, payload)
  if not existing:
    record_tracked_file_event(
      connection,
      tracked_file_id=row["id"],
      import_job_id=last_import_job_id,
      stage="discover",
      status="discovered",
      message="File discovered by watch-folder reconciliation.",
      payload={"absolute_path": normalized_path, "relative_path": relative_path},
    )
  elif pending_import:
    record_tracked_file_event(
      connection,
      tracked_file_id=row["id"],
      import_job_id=last_import_job_id,
      stage="discover",
      status="pending_import",
      message="File changed and was queued for import.",
      payload={"absolute_path": normalized_path, "relative_path": relative_path},
    )
  return row


def mark_tracked_files_stale_for_watch_folder(
  connection: sqlite3.Connection,
  root_watch_folder_id: str,
  seen_paths: Iterable[str | Path],
) -> int:
  normalized_seen = {normalize_absolute_path(path) for path in seen_paths}
  rows = connection.execute(
    "SELECT * FROM tracked_files WHERE root_watch_folder_id = ?",
    (root_watch_folder_id,),
  ).fetchall()
  updated = 0
  for row in rows:
    absolute_path = str(row["absolute_path"] or "")
    if absolute_path in normalized_seen or int(row["stale"] or 0) == 1:
      continue
    connection.execute(
      """
      UPDATE tracked_files
      SET stale = 1, overall_status = 'stale', updated_at = ?, error_message = NULL
      WHERE id = ?
      """,
      (utc_now(), row["id"]),
    )
    record_tracked_file_event(
      connection,
      tracked_file_id=row["id"],
      import_job_id=row["last_import_job_id"],
      stage="discover",
      status="stale",
      message="File was not seen during the latest watch-folder reconciliation.",
      payload={"absolute_path": absolute_path},
    )
    updated += 1
  return updated


def mark_tracked_file_stale(
  connection: sqlite3.Connection,
  absolute_path: str | Path,
  *,
  import_job_id: str | None = None,
  message: str = "File was deleted or disappeared from the watch root.",
) -> dict[str, Any] | None:
  row = get_tracked_file_by_path(connection, absolute_path)
  if row is None:
    return None
  connection.execute(
    """
    UPDATE tracked_files
    SET stale = 1, overall_status = 'stale', error_message = NULL, updated_at = ?
    WHERE id = ?
    """,
    (utc_now(), row["id"]),
  )
  record_tracked_file_event(
    connection,
    tracked_file_id=row["id"],
    import_job_id=import_job_id or row.get("last_import_job_id"),
    stage="discover",
    status="stale",
    message=message,
    payload={"absolute_path": row["absolute_path"]},
  )
  return get_tracked_file(connection, row["id"])


def mark_tracked_file_stale_by_id(
  connection: sqlite3.Connection,
  tracked_file_id: str,
  *,
  import_job_id: str | None = None,
  message: str = "File was manually marked stale by the operator.",
) -> dict[str, Any] | None:
  row = get_tracked_file(connection, tracked_file_id)
  if row is None:
    return None
  return mark_tracked_file_stale(
    connection,
    row["absolute_path"],
    import_job_id=import_job_id or row.get("last_import_job_id"),
    message=message,
  )


def reconcile_tracked_file_stage(
  connection: sqlite3.Connection,
  *,
  absolute_path: str | Path,
  stage: str,
  status: str,
  import_job_id: str | None = None,
  root_watch_folder_id: str | None = None,
  relative_path: str | None = None,
  size_bytes: int | None = None,
  mtime: str | None = None,
  checksum_sha1: str | None = None,
  error_message: str | None = None,
  metadata_json: dict[str, Any] | None = None,
  event_message: str | None = None,
) -> dict[str, Any]:
  normalized_path = normalize_absolute_path(absolute_path)
  existing = get_tracked_file_by_path(connection, normalized_path)
  now = utc_now()
  payload = {
    "id": existing["id"] if existing else f"tf-{uuid4().hex}",
    "root_watch_folder_id": root_watch_folder_id or (existing.get("root_watch_folder_id") if existing else None),
    "absolute_path": normalized_path,
    "relative_path": relative_path or (existing.get("relative_path") if existing else Path(normalized_path).name),
    "extension": Path(normalized_path).suffix.lower(),
    "size_bytes": int(size_bytes if size_bytes is not None else (existing.get("size_bytes") if existing else 0) or 0),
    "mtime": mtime if mtime is not None else (existing.get("mtime") if existing else None),
    "checksum_sha1": checksum_sha1 if checksum_sha1 is not None else (existing.get("checksum_sha1") if existing else None),
    "discovered_at": existing.get("discovered_at") if existing else now,
    "last_seen_at": existing.get("last_seen_at") if existing else now,
    "last_import_job_id": import_job_id if import_job_id is not None else (existing.get("last_import_job_id") if existing else None),
    "extraction_status": (existing.get("extraction_status") if existing else "pending") or "pending",
    "ocr_status": (existing.get("ocr_status") if existing else "pending") or "pending",
    "chunk_status": (existing.get("chunk_status") if existing else "pending") or "pending",
    "embedding_status": (existing.get("embedding_status") if existing else "pending") or "pending",
    "index_status": (existing.get("index_status") if existing else "pending") or "pending",
    "overall_status": existing.get("overall_status") if existing else "discovered",
    "stale": 0,
    "error_message": error_message,
    "metadata_json": _tracked_file_metadata({
      **json_loads(existing.get("metadata_json") if existing else "{}", {}),
      **dict(metadata_json or {}),
    }),
    "created_at": existing.get("created_at") if existing else now,
    "updated_at": now,
  }
  stage_column = _tracked_file_stage_column(stage)
  normalized_status = str(status or "").strip().lower() or "pending"
  if stage_column:
    payload[stage_column] = normalized_status
  metadata_payload = json_loads(payload.get("metadata_json"), {})
  if stage == "extract" and normalized_status == "completed":
    if bool(metadata_payload.get("ocr_pending")):
      payload["ocr_status"] = "pending"
    elif payload["ocr_status"] in {"pending", "queued"}:
      payload["ocr_status"] = "not_needed"
  if normalized_status == "failed":
    payload["error_message"] = error_message or event_message or (existing.get("error_message") if existing else None)
  elif error_message is None and existing is not None and normalized_status in {"completed", "running", "queued", "pending"}:
    payload["error_message"] = existing.get("error_message")
    if normalized_status == "completed":
      payload["error_message"] = None
  if stage == "extract" and normalized_status == "completed" and payload["ocr_status"] in {"queued", "pending", "running"}:
    payload["overall_status"] = "ocr_pending" if payload["ocr_status"] != "completed" else "extracted"
  else:
    payload["overall_status"] = _compute_overall_tracked_file_status(payload)
  row = _upsert_tracked_file_row(connection, payload)
  record_tracked_file_event(
    connection,
    tracked_file_id=row["id"],
    import_job_id=import_job_id,
    stage=stage,
    status=normalized_status,
    message=event_message or error_message or f"{stage} marked {normalized_status}.",
    payload={
      "absolute_path": normalized_path,
      "overall_status": row["overall_status"],
      "stage_column": stage_column,
      "metadata": dict(metadata_json or {}),
    },
  )
  return row


def record_tracked_file_event(
  connection: sqlite3.Connection,
  *,
  tracked_file_id: str,
  import_job_id: str | None,
  stage: str,
  status: str,
  message: str | None = None,
  payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
  now = utc_now()
  payload_json = _tracked_file_metadata(payload)
  fingerprint = _stable_repo_id(
    "tfe",
    tracked_file_id,
    import_job_id or "",
    stage,
    status,
    message or "",
    payload_json,
  )
  event = {
    "id": f"tfe-{uuid4().hex}",
    "tracked_file_id": tracked_file_id,
    "import_job_id": import_job_id,
    "stage": stage,
    "status": status,
    "message": message,
    "payload_json": payload_json,
    "event_fingerprint": fingerprint,
    "created_at": now,
    "updated_at": now,
  }
  connection.execute(
    """
    INSERT INTO tracked_file_events (
      id, tracked_file_id, import_job_id, stage, status, message, payload_json, event_fingerprint, created_at, updated_at
    )
    VALUES (
      :id, :tracked_file_id, :import_job_id, :stage, :status, :message, :payload_json, :event_fingerprint, :created_at, :updated_at
    )
    ON CONFLICT(event_fingerprint) DO UPDATE SET
      message = excluded.message,
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at
    """,
    event,
  )
  row = connection.execute(
    "SELECT * FROM tracked_file_events WHERE event_fingerprint = ?",
    (fingerprint,),
  ).fetchone()
  return dict(row)


def list_saved_queries(connection: sqlite3.Connection, user_id: str) -> list[dict[str, Any]]:
  rows = connection.execute(
    "SELECT * FROM saved_queries WHERE user_id = ? ORDER BY created_at DESC",
    (user_id,),
  ).fetchall()
  return [dict(row) for row in rows]


# Saved query history and reusable response snapshots -----------------------------
def create_saved_query(
  connection: sqlite3.Connection,
  user_id: str,
  title: str,
  query_text: str,
  mode: str,
  response_json: str,
  research_bundle_id: str | None = None,
) -> dict[str, Any]:
  now = utc_now()
  payload = {
    "id": f"saved-{uuid4().hex}",
    "user_id": user_id,
    "title": title,
    "query_text": query_text,
    "mode": mode,
    "research_bundle_id": research_bundle_id,
    "response_json": response_json,
    "created_at": now,
    "updated_at": now,
  }
  connection.execute(
    """
    INSERT INTO saved_queries (id, user_id, title, query_text, mode, research_bundle_id, response_json, created_at, updated_at)
    VALUES (:id, :user_id, :title, :query_text, :mode, :research_bundle_id, :response_json, :created_at, :updated_at)
    """,
    payload,
  )
  return payload


def list_notes(connection: sqlite3.Connection, user_id: str) -> list[dict[str, Any]]:
  rows = connection.execute("SELECT * FROM notes WHERE user_id = ? ORDER BY created_at DESC", (user_id,)).fetchall()
  return [dict(row) for row in rows]


def create_note(
  connection: sqlite3.Connection,
  user_id: str,
  title: str,
  content: str,
  document_id: str | None,
  node_id: str | None,
  entity_id: str | None = None,
) -> dict[str, Any]:
  now = utc_now()
  payload = {
    "id": f"note-{uuid4().hex}",
    "user_id": user_id,
    "title": title,
    "content": content,
    "document_id": document_id,
    "node_id": node_id,
    "entity_id": entity_id,
    "created_at": now,
    "updated_at": now,
  }
  connection.execute(
    """
    INSERT INTO notes (id, user_id, title, content, document_id, node_id, entity_id, created_at, updated_at)
    VALUES (:id, :user_id, :title, :content, :document_id, :node_id, :entity_id, :created_at, :updated_at)
    """,
    payload,
  )
  return payload


def upsert_pharma_events(connection: sqlite3.Connection, events: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
  now = utc_now()
  saved: list[dict[str, Any]] = []
  for event in events:
    payload = {
      "id": event.get("id") or f"pharma-event-{uuid4().hex}",
      "source": str(event.get("source", "")).strip().lower(),
      "external_id": str(event.get("external_id", "")).strip(),
      "ticker": str(event.get("ticker", "")).strip().upper(),
      "company": str(event.get("company", "")),
      "event_at": str(event.get("event_at", "")),
      "title": str(event.get("title", "")),
      "summary": str(event.get("summary", "")),
      "event_type": str(event.get("event_type", "corporate")),
      "trial_phase": str(event.get("trial_phase", "")),
      "indication": str(event.get("indication", "")),
      "source_url": str(event.get("source_url", "")),
      "press_release_url": str(event.get("press_release_url", "")),
      "press_release_text": str(event.get("press_release_text", "")),
      "ingest_hash": str(event.get("ingest_hash", "")),
      "confidence": float(event.get("confidence", 0.0) or 0.0),
      "payload_json": _json(event.get("payload"), {}),
      "created_at": event.get("created_at") or now,
      "updated_at": now,
    }
    connection.execute(
      """
      INSERT INTO pharma_events (
        id, source, external_id, ticker, company, event_at, title, summary, event_type, trial_phase, indication,
        source_url, press_release_url, press_release_text, ingest_hash, confidence, payload_json, created_at, updated_at
      )
      VALUES (
        :id, :source, :external_id, :ticker, :company, :event_at, :title, :summary, :event_type, :trial_phase, :indication,
        :source_url, :press_release_url, :press_release_text, :ingest_hash, :confidence, :payload_json, :created_at, :updated_at
      )
      ON CONFLICT(source, ingest_hash) DO UPDATE SET
        external_id = excluded.external_id,
        ticker = excluded.ticker,
        company = excluded.company,
        event_at = excluded.event_at,
        title = excluded.title,
        summary = excluded.summary,
        event_type = excluded.event_type,
        trial_phase = excluded.trial_phase,
        indication = excluded.indication,
        source_url = excluded.source_url,
        press_release_url = excluded.press_release_url,
        press_release_text = excluded.press_release_text,
        confidence = excluded.confidence,
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at
      """,
      payload,
    )
    row = connection.execute(
      "SELECT * FROM pharma_events WHERE source = ? AND ingest_hash = ?",
      (payload["source"], payload["ingest_hash"]),
    ).fetchone()
    if row is not None:
      item = dict(row)
      item["payload"] = json_loads(item.get("payload_json"), {})
      saved.append(item)
  return saved


def list_pharma_events(
  connection: sqlite3.Connection,
  *,
  symbols: Iterable[str] | None = None,
  limit: int = 100,
) -> list[dict[str, Any]]:
  parameters: list[Any] = []
  where = []
  if symbols:
    normalized = [str(symbol).strip().upper() for symbol in symbols if str(symbol).strip()]
    if normalized:
      where.append(f"ticker IN ({','.join('?' for _ in normalized)})")
      parameters.extend(normalized)
  parameters.append(max(1, int(limit)))
  sql = "SELECT * FROM pharma_events"
  if where:
    sql += f" WHERE {' AND '.join(where)}"
  sql += " ORDER BY event_at DESC, updated_at DESC LIMIT ?"
  rows = connection.execute(sql, parameters).fetchall()
  items = [dict(row) for row in rows]
  for item in items:
    item["payload"] = json_loads(item.get("payload_json"), {})
  return items


def create_pharma_cycle(
  connection: sqlite3.Connection,
  *,
  user_id: str | None,
  benchmark_symbol: str,
  scope: dict[str, Any],
  request: dict[str, Any],
  dataset_summary: dict[str, Any],
  summary: dict[str, Any],
  artifact_path: str | None = None,
) -> dict[str, Any]:
  now = utc_now()
  payload = {
    "id": f"pharma-cycle-{uuid4().hex}",
    "user_id": user_id,
    "benchmark_symbol": benchmark_symbol,
    "scope_json": _json(scope, {}),
    "request_json": _json(request, {}),
    "dataset_summary_json": _json(dataset_summary, {}),
    "summary_json": _json(summary, {}),
    "artifact_path": artifact_path,
    "created_at": now,
    "updated_at": now,
  }
  connection.execute(
    """
    INSERT INTO pharma_cycles (
      id, user_id, benchmark_symbol, scope_json, request_json, dataset_summary_json, summary_json,
      artifact_path, created_at, updated_at
    )
    VALUES (
      :id, :user_id, :benchmark_symbol, :scope_json, :request_json, :dataset_summary_json, :summary_json,
      :artifact_path, :created_at, :updated_at
    )
    """,
    payload,
  )
  return payload


def list_pharma_cycles(connection: sqlite3.Connection, limit: int = 50) -> list[dict[str, Any]]:
  rows = connection.execute(
    "SELECT * FROM pharma_cycles ORDER BY created_at DESC LIMIT ?",
    (max(1, int(limit)),),
  ).fetchall()
  items = [dict(row) for row in rows]
  for item in items:
    item["scope"] = json_loads(item.get("scope_json"), {})
    item["request"] = json_loads(item.get("request_json"), {})
    item["dataset_summary"] = json_loads(item.get("dataset_summary_json"), {})
    item["summary"] = json_loads(item.get("summary_json"), {})
  return items


def get_pharma_cycle(connection: sqlite3.Connection, cycle_id: str) -> dict[str, Any] | None:
  row = connection.execute("SELECT * FROM pharma_cycles WHERE id = ?", (cycle_id,)).fetchone()
  if row is None:
    return None
  item = dict(row)
  item["scope"] = json_loads(item.get("scope_json"), {})
  item["request"] = json_loads(item.get("request_json"), {})
  item["dataset_summary"] = json_loads(item.get("dataset_summary_json"), {})
  item["summary"] = json_loads(item.get("summary_json"), {})
  return item


def replace_pharma_cycle_candidates(connection: sqlite3.Connection, cycle_id: str, candidates: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
  connection.execute("DELETE FROM pharma_cycle_candidates WHERE cycle_id = ?", (cycle_id,))
  now = utc_now()
  saved: list[dict[str, Any]] = []
  for candidate in candidates:
    payload = {
      "id": f"pharma-candidate-{uuid4().hex}",
      "cycle_id": cycle_id,
      "candidate_key": str(candidate.get("candidate_key", "")),
      "family_key": str(candidate.get("family_key", "")),
      "candidate_type": str(candidate.get("candidate_type", "candidate")),
      "status": str(candidate.get("status", "candidate")),
      "metrics_json": _json(candidate.get("metrics"), {}),
      "folds_json": _json(candidate.get("folds"), []),
      "warnings_json": _json(candidate.get("warnings"), []),
      "artifact_path": candidate.get("artifact_path"),
      "created_at": now,
      "updated_at": now,
    }
    connection.execute(
      """
      INSERT INTO pharma_cycle_candidates (
        id, cycle_id, candidate_key, family_key, candidate_type, status, metrics_json, folds_json,
        warnings_json, artifact_path, created_at, updated_at
      )
      VALUES (
        :id, :cycle_id, :candidate_key, :family_key, :candidate_type, :status, :metrics_json, :folds_json,
        :warnings_json, :artifact_path, :created_at, :updated_at
      )
      """,
      payload,
    )
    saved.append(payload)
  return saved


def list_pharma_cycle_candidates(connection: sqlite3.Connection, cycle_id: str | None = None) -> list[dict[str, Any]]:
  if cycle_id:
    rows = connection.execute("SELECT * FROM pharma_cycle_candidates WHERE cycle_id = ? ORDER BY created_at ASC", (cycle_id,)).fetchall()
  else:
    rows = connection.execute("SELECT * FROM pharma_cycle_candidates ORDER BY created_at DESC").fetchall()
  items = [dict(row) for row in rows]
  for item in items:
    item["metrics"] = json_loads(item.get("metrics_json"), {})
    item["folds"] = json_loads(item.get("folds_json"), [])
    item["warnings"] = json_loads(item.get("warnings_json"), [])
  return items


def upsert_pharma_homologation(
  connection: sqlite3.Connection,
  *,
  candidate_key: str,
  family_key: str,
  status: str,
  metrics: dict[str, Any],
  reasons: list[str],
  last_cycle_id: str | None,
) -> dict[str, Any]:
  now = utc_now()
  row = {
    "id": f"pharma-homologation-{uuid4().hex}",
    "candidate_key": candidate_key,
    "family_key": family_key,
    "status": status,
    "metrics_json": _json(metrics, {}),
    "reasons_json": _json(reasons, []),
    "last_cycle_id": last_cycle_id,
    "created_at": now,
    "updated_at": now,
  }
  connection.execute(
    """
    INSERT INTO pharma_homologations (
      id, candidate_key, family_key, status, metrics_json, reasons_json, last_cycle_id, created_at, updated_at
    )
    VALUES (
      :id, :candidate_key, :family_key, :status, :metrics_json, :reasons_json, :last_cycle_id, :created_at, :updated_at
    )
    ON CONFLICT(candidate_key) DO UPDATE SET
      family_key = excluded.family_key,
      status = excluded.status,
      metrics_json = excluded.metrics_json,
      reasons_json = excluded.reasons_json,
      last_cycle_id = excluded.last_cycle_id,
      updated_at = excluded.updated_at
    """,
    row,
  )
  return get_pharma_homologation(connection, candidate_key) or row


def get_pharma_homologation(connection: sqlite3.Connection, candidate_key: str) -> dict[str, Any] | None:
  row = connection.execute("SELECT * FROM pharma_homologations WHERE candidate_key = ?", (candidate_key,)).fetchone()
  if row is None:
    return None
  item = dict(row)
  item["metrics"] = json_loads(item.get("metrics_json"), {})
  item["reasons"] = json_loads(item.get("reasons_json"), [])
  return item


def list_pharma_homologations(connection: sqlite3.Connection) -> list[dict[str, Any]]:
  rows = connection.execute("SELECT * FROM pharma_homologations ORDER BY updated_at DESC").fetchall()
  items = [dict(row) for row in rows]
  for item in items:
    item["metrics"] = json_loads(item.get("metrics_json"), {})
    item["reasons"] = json_loads(item.get("reasons_json"), [])
  return items


def replace_dossier_assertions(connection: sqlite3.Connection, assertions: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
  connection.execute("DELETE FROM dossier_assertions")
  now = utc_now()
  saved: list[dict[str, Any]] = []
  for assertion in assertions:
    payload = {
      "id": assertion.get("id") or f"dossier-assertion-{uuid4().hex}",
      "document_id": str(assertion.get("document_id", "")),
      "source_key": str(assertion.get("source_key", "")),
      "normalized_title": str(assertion.get("normalized_title", "")),
      "dedupe_key": str(assertion.get("dedupe_key", "")),
      "source_node_id": assertion.get("source_node_id"),
      "assertion_text": str(assertion.get("assertion_text", "")),
      "summary": str(assertion.get("summary", "")),
      "actor": str(assertion.get("actor", "")),
      "institution": str(assertion.get("institution", "")),
      "topic_tags_json": _json(assertion.get("topic_tags"), []),
      "evidence_tags_json": _json(assertion.get("evidence_tags"), []),
      "stance": str(assertion.get("stance", "allegation")),
      "is_dated": 1 if assertion.get("is_dated") else 0,
      "asserted_at": assertion.get("asserted_at"),
      "confidence": float(assertion.get("confidence", 0.0) or 0.0),
      "payload_json": _json(assertion.get("payload"), {}),
      "created_at": assertion.get("created_at") or now,
      "updated_at": now,
    }
    connection.execute(
      """
      INSERT INTO dossier_assertions (
        id, document_id, source_key, normalized_title, dedupe_key, source_node_id, assertion_text, summary,
        actor, institution, topic_tags_json, evidence_tags_json, stance, is_dated, asserted_at,
        confidence, payload_json, created_at, updated_at
      )
      VALUES (
        :id, :document_id, :source_key, :normalized_title, :dedupe_key, :source_node_id, :assertion_text, :summary,
        :actor, :institution, :topic_tags_json, :evidence_tags_json, :stance, :is_dated, :asserted_at,
        :confidence, :payload_json, :created_at, :updated_at
      )
      """,
      payload,
    )
    saved.append(payload)
  return list_dossier_assertions(connection, limit=max(100, len(saved)))


def replace_dossier_entities(connection: sqlite3.Connection, entities: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
  connection.execute("DELETE FROM dossier_entities")
  now = utc_now()
  saved: list[dict[str, Any]] = []
  for entity in entities:
    payload = {
      "id": entity.get("id") or f"dossier-entity-{uuid4().hex}",
      "document_id": str(entity.get("document_id", "")),
      "label": str(entity.get("label", "")),
      "entity_type": str(entity.get("entity_type", "")),
      "canonical_label": str(entity.get("canonical_label", "")),
      "mention_count": int(entity.get("mention_count", 0) or 0),
      "payload_json": _json(entity.get("payload"), {}),
      "created_at": entity.get("created_at") or now,
      "updated_at": now,
    }
    connection.execute(
      """
      INSERT INTO dossier_entities (
        id, document_id, label, entity_type, canonical_label, mention_count, payload_json, created_at, updated_at
      )
      VALUES (
        :id, :document_id, :label, :entity_type, :canonical_label, :mention_count, :payload_json, :created_at, :updated_at
      )
      """,
      payload,
    )
    saved.append(payload)
  return list_dossier_entities(connection, limit=max(100, len(saved)))


def replace_dossier_signal_windows(connection: sqlite3.Connection, windows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
  connection.execute("DELETE FROM dossier_signal_windows")
  now = utc_now()
  saved: list[dict[str, Any]] = []
  for window in windows:
    payload = {
      "id": window.get("id") or f"dossier-window-{uuid4().hex}",
      "window_date": str(window.get("window_date", "")),
      "topic_key": str(window.get("topic_key", "all")),
      "signal_key": str(window.get("signal_key", "")),
      "value": float(window.get("value", 0.0) or 0.0),
      "support_count": int(window.get("support_count", 0) or 0),
      "payload_json": _json(window.get("payload"), {}),
      "created_at": window.get("created_at") or now,
      "updated_at": now,
    }
    connection.execute(
      """
      INSERT INTO dossier_signal_windows (
        id, window_date, topic_key, signal_key, value, support_count, payload_json, created_at, updated_at
      )
      VALUES (
        :id, :window_date, :topic_key, :signal_key, :value, :support_count, :payload_json, :created_at, :updated_at
      )
      """,
      payload,
    )
    saved.append(payload)
  return list_dossier_signal_windows(connection, limit=max(100, len(saved)))


def list_dossier_assertions(
  connection: sqlite3.Connection,
  *,
  limit: int = 100,
  dated_only: bool = False,
) -> list[dict[str, Any]]:
  sql = "SELECT * FROM dossier_assertions"
  parameters: list[Any] = []
  if dated_only:
    sql += " WHERE is_dated = 1"
  sql += " ORDER BY COALESCE(asserted_at, updated_at) DESC, created_at DESC LIMIT ?"
  parameters.append(max(1, int(limit)))
  rows = connection.execute(sql, parameters).fetchall()
  items = [dict(row) for row in rows]
  for item in items:
    item["topic_tags"] = json_loads(item.get("topic_tags_json"), [])
    item["evidence_tags"] = json_loads(item.get("evidence_tags_json"), [])
    item["payload"] = json_loads(item.get("payload_json"), {})
    item["is_dated"] = bool(item.get("is_dated"))
  return items


def list_dossier_entities(connection: sqlite3.Connection, *, limit: int = 200) -> list[dict[str, Any]]:
  rows = connection.execute(
    "SELECT * FROM dossier_entities ORDER BY mention_count DESC, label ASC LIMIT ?",
    (max(1, int(limit)),),
  ).fetchall()
  items = [dict(row) for row in rows]
  for item in items:
    item["payload"] = json_loads(item.get("payload_json"), {})
  return items


def list_dossier_signal_windows(connection: sqlite3.Connection, *, limit: int = 2000) -> list[dict[str, Any]]:
  rows = connection.execute(
    "SELECT * FROM dossier_signal_windows ORDER BY window_date DESC, topic_key ASC, signal_key ASC LIMIT ?",
    (max(1, int(limit)),),
  ).fetchall()
  items = [dict(row) for row in rows]
  for item in items:
    item["payload"] = json_loads(item.get("payload_json"), {})
  return items


def keyword_search(connection: sqlite3.Connection, query_text: str, node_types: Iterable[str], summary_levels: Iterable[str | None], document_ids: Iterable[str] | None, limit: int = 12) -> list[dict[str, Any]]:
  tokens = re.findall(r"[A-Za-z0-9']+", query_text)
  if not tokens:
    return []

  where_clauses = ["representation_nodes_fts MATCH ?"]
  parameters: list[Any] = [" ".join(tokens)]

  node_types = list(node_types)
  summary_levels = list(summary_levels)
  if node_types:
    where_clauses.append(f"representation_nodes.node_type IN ({','.join('?' for _ in node_types)})")
    parameters.extend(node_types)
  if summary_levels:
    where_clauses.append(f"COALESCE(representation_nodes.summary_level, '') IN ({','.join('?' for _ in summary_levels)})")
    parameters.extend("" if level is None else level for level in summary_levels)
  if document_ids:
    document_ids = list(document_ids)
    where_clauses.append(f"representation_nodes.document_id IN ({','.join('?' for _ in document_ids)})")
    parameters.extend(document_ids)

  parameters.append(limit)
  rows = connection.execute(
    f"""
    SELECT representation_nodes.*, bm25(representation_nodes_fts) AS bm25_score
    FROM representation_nodes_fts
    JOIN representation_nodes ON representation_nodes.id = representation_nodes_fts.node_id
    WHERE {' AND '.join(where_clauses)}
    ORDER BY bm25_score
    LIMIT ?
    """,
    parameters,
  ).fetchall()
  return [dict(row) for row in rows]


def upsert_object_of_reference(connection: sqlite3.Connection, object_row: dict[str, Any]) -> dict[str, Any]:
  now = utc_now()
  payload = {
    "id": object_row["id"],
    "label": object_row["label"],
    "canonical_label": object_row["canonical_label"],
    "description": object_row.get("description", ""),
    "payload_json": _json(object_row.get("payload_json"), {}),
    "created_at": object_row.get("created_at", now),
    "updated_at": now,
  }
  connection.execute(
    """
    INSERT INTO objects_of_reference (id, label, canonical_label, description, payload_json, created_at, updated_at)
    VALUES (:id, :label, :canonical_label, :description, :payload_json, :created_at, :updated_at)
    ON CONFLICT(canonical_label) DO UPDATE SET
      label = excluded.label,
      description = excluded.description,
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at
    """,
    payload,
  )
  row = connection.execute(
    "SELECT * FROM objects_of_reference WHERE canonical_label = ?",
    (object_row["canonical_label"],),
  ).fetchone()
  return dict(row)


# Derived research-graph and scaffold materialization -----------------------------
def replace_document_research_graph_summary(
  connection: sqlite3.Connection,
  document_id: str,
  *,
  sign_rows: list[dict[str, Any]],
  category_rows: list[dict[str, Any]],
  category_morphism_rows: list[dict[str, Any]],
  cover_rows: list[dict[str, Any]],
  restriction_rows: list[dict[str, Any]],
  constraint_rows: list[dict[str, Any]],
  obstruction_rows: list[dict[str, Any]],
  simplex_rows: list[dict[str, Any]],
  object_id_map: dict[str, str],
) -> None:
  connection.execute("DELETE FROM research_graph_edges WHERE document_id = ?", (document_id,))
  connection.execute("DELETE FROM research_graph_nodes WHERE document_id = ?", (document_id,))

  now = utc_now()
  node_rows: list[dict[str, Any]] = []
  edge_rows: list[dict[str, Any]] = []

  object_graph_ids = {
    object_id: f"rg-node-{document_id}-object-{object_id}"
    for object_id in sorted({item for item in object_id_map.values() if item})
  }
  for canonical_label, object_id in object_id_map.items():
    if not object_id:
      continue
    node_rows.append({
      "id": object_graph_ids[object_id],
      "document_id": document_id,
      "graph_type": "object",
      "source_table": "objects_of_reference",
      "source_id": object_id,
      "label": canonical_label,
      "payload_json": _json({"canonical_label": canonical_label}, {}),
      "created_at": now,
      "updated_at": now,
    })

  sign_graph_ids: dict[str, str] = {}
  for row in sign_rows:
    graph_id = f"rg-node-{document_id}-sign-{row['id']}"
    sign_graph_ids[row["id"]] = graph_id
    payload = json_loads(row.get("payload_json"), {})
    object_id = payload.get("object_id")
    node_rows.append({
      "id": graph_id,
      "document_id": document_id,
      "graph_type": "sign_token",
      "source_table": "sign_tokens",
      "source_id": row["id"],
      "label": row["label"],
      "payload_json": _json(payload, {}),
      "created_at": now,
      "updated_at": now,
    })
    if object_id and object_id in object_graph_ids:
      edge_rows.append({
        "id": f"rg-edge-{document_id}-sign-object-{row['id']}",
        "document_id": document_id,
        "edge_type": "sign_refers_to_object",
        "source_node_ref": graph_id,
        "target_node_ref": object_graph_ids[object_id],
        "label": "refers_to",
        "weight": float(row.get("frequency", 1) or 1),
        "payload_json": _json({"sign_token_id": row["id"], "object_id": object_id}, {}),
        "created_at": now,
        "updated_at": now,
      })

  category_graph_ids: dict[str, str] = {}
  for row in category_rows:
    graph_id = f"rg-node-{document_id}-category-{row['id']}"
    category_graph_ids[row["id"]] = graph_id
    payload = json_loads(row.get("payload_json"), {})
    node_rows.append({
      "id": graph_id,
      "document_id": document_id,
      "graph_type": "category",
      "source_table": "categories",
      "source_id": row["id"],
      "label": row["label"],
      "payload_json": _json(payload, {}),
      "created_at": now,
      "updated_at": now,
    })

  for row in category_morphism_rows:
    source_ref = object_graph_ids.get(row.get("source_object_id", ""))
    target_ref = object_graph_ids.get(row.get("target_object_id", ""))
    if not source_ref or not target_ref:
      continue
    edge_rows.append({
      "id": f"rg-edge-{document_id}-category-morphism-{row['id']}",
      "document_id": document_id,
      "edge_type": "category_morphism",
      "source_node_ref": source_ref,
      "target_node_ref": target_ref,
      "label": row.get("relation_label", ""),
      "weight": float(row.get("weight", 0.0) or 0.0),
      "payload_json": _json(json_loads(row.get("payload_json"), {}), {}),
      "created_at": now,
      "updated_at": now,
    })

  cover_graph_ids: dict[str, str] = {}
  for row in cover_rows:
    graph_id = f"rg-node-{document_id}-cover-{row['id']}"
    cover_graph_ids[row["id"]] = graph_id
    payload = json_loads(row.get("payload_json"), {})
    node_rows.append({
      "id": graph_id,
      "document_id": document_id,
      "graph_type": "cover",
      "source_table": "covers",
      "source_id": row["id"],
      "label": row["label"],
      "payload_json": _json(payload, {}),
      "created_at": now,
      "updated_at": now,
    })
    object_ref = object_graph_ids.get(row.get("object_id", ""))
    if object_ref:
      edge_rows.append({
        "id": f"rg-edge-{document_id}-cover-object-{row['id']}",
        "document_id": document_id,
        "edge_type": "cover_scope",
        "source_node_ref": graph_id,
        "target_node_ref": object_ref,
        "label": "covers",
        "weight": 1.0,
        "payload_json": _json({"cover_id": row["id"], "object_id": row.get("object_id")}, {}),
        "created_at": now,
        "updated_at": now,
      })

  for row in restriction_rows:
    cover_ref = cover_graph_ids.get(row.get("cover_id", ""))
    object_ref = object_graph_ids.get(row.get("shared_object_id", ""))
    if not cover_ref or not object_ref:
      continue
    edge_rows.append({
      "id": f"rg-edge-{document_id}-restriction-{row['id']}",
      "document_id": document_id,
      "edge_type": "restriction_map",
      "source_node_ref": cover_ref,
      "target_node_ref": object_ref,
      "label": "restricts",
      "weight": 1.0,
      "payload_json": _json({
        "from_node_id": row.get("from_node_id"),
        "to_node_id": row.get("to_node_id"),
        "validation": json_loads(row.get("validation_json"), {}),
      }, {}),
      "created_at": now,
      "updated_at": now,
    })

  for row in constraint_rows:
    cover_ref = cover_graph_ids.get(row.get("cover_id", ""))
    object_ref = object_graph_ids.get(row.get("object_id", ""))
    if not cover_ref or not object_ref:
      continue
    edge_rows.append({
      "id": f"rg-edge-{document_id}-constraint-{row['id']}",
      "document_id": document_id,
      "edge_type": "gluing_constraint",
      "source_node_ref": cover_ref,
      "target_node_ref": object_ref,
      "label": row.get("label", ""),
      "weight": 1.0,
      "payload_json": _json({
        "rule": json_loads(row.get("rule_json"), {}),
        "validation": json_loads(row.get("validation_json"), {}),
      }, {}),
      "created_at": now,
      "updated_at": now,
    })

  for row in obstruction_rows:
    object_ref = object_graph_ids.get(row.get("object_id", ""))
    if not object_ref:
      continue
    edge_rows.append({
      "id": f"rg-edge-{document_id}-obstruction-{row['id']}",
      "document_id": document_id,
      "edge_type": "obstruction",
      "source_node_ref": object_ref,
      "target_node_ref": object_ref,
      "label": row.get("severity", "moderate"),
      "weight": 1.0,
      "payload_json": _json(json_loads(row.get("payload_json"), {}), {}),
      "created_at": now,
      "updated_at": now,
    })

  for row in simplex_rows:
    graph_id = f"rg-node-{document_id}-simplex-{row['id']}"
    node_rows.append({
      "id": graph_id,
      "document_id": document_id,
      "graph_type": "simplex",
      "source_table": "simplices",
      "source_id": row["id"],
      "label": f"Simplex {row.get('dimension', 0)}",
      "payload_json": _json({
        "dimension": int(row.get("dimension", 0) or 0),
        "object_ids": json_loads(row.get("object_ids_json"), []),
      }, {}),
      "created_at": now,
      "updated_at": now,
    })

  _insert_many(connection, "research_graph_nodes", node_rows)
  _insert_many(connection, "research_graph_edges", edge_rows)


def list_research_graph_nodes(connection: sqlite3.Connection, document_id: str) -> list[dict[str, Any]]:
  rows = connection.execute(
    "SELECT * FROM research_graph_nodes WHERE document_id = ? ORDER BY graph_type ASC, label ASC",
    (document_id,),
  ).fetchall()
  payloads = []
  for row in rows:
    item = dict(row)
    item["payload"] = json_loads(item.get("payload_json"), {})
    payloads.append(item)
  return payloads


def list_research_graph_edges(connection: sqlite3.Connection, document_id: str) -> list[dict[str, Any]]:
  rows = connection.execute(
    "SELECT * FROM research_graph_edges WHERE document_id = ? ORDER BY edge_type ASC, label ASC",
    (document_id,),
  ).fetchall()
  payloads = []
  for row in rows:
    item = dict(row)
    item["payload"] = json_loads(item.get("payload_json"), {})
    payloads.append(item)
  return payloads


def replace_document_research_scaffolds(connection: sqlite3.Connection, document_id: str, scaffolds: dict[str, list[dict[str, Any]]]) -> None:
  category_ids = [row["id"] for row in connection.execute("SELECT id FROM categories WHERE document_id = ?", (document_id,)).fetchall()]
  cover_ids = [row["id"] for row in connection.execute("SELECT id FROM covers WHERE document_id = ?", (document_id,)).fetchall()]

  _delete_in(connection, "category_morphisms", "category_id", category_ids)
  _delete_in(connection, "restriction_maps", "cover_id", cover_ids)
  _delete_in(connection, "gluing_constraints", "cover_id", cover_ids)
  _delete_in(connection, "obstructions", "cover_id", cover_ids)
  connection.execute("DELETE FROM sign_tokens WHERE document_id = ?", (document_id,))
  connection.execute("DELETE FROM categories WHERE document_id = ?", (document_id,))
  connection.execute("DELETE FROM covers WHERE document_id = ?", (document_id,))
  connection.execute("DELETE FROM simplices WHERE document_id = ?", (document_id,))

  object_id_map: dict[str, str] = {}
  for object_row in scaffolds.get("objects_of_reference", []):
    persisted = upsert_object_of_reference(connection, object_row)
    object_id_map[object_row["canonical_label"]] = persisted["id"]

  sign_rows = []
  for row in scaffolds.get("sign_tokens", []):
    payload = dict(row)
    extra = json_loads(payload.get("payload_json"), {})
    extra["object_id"] = object_id_map.get(payload.pop("canonical_object", ""))
    payload["payload_json"] = _json(extra, {})
    sign_rows.append(payload)
  _insert_many(connection, "sign_tokens", sign_rows)

  category_rows = []
  for row in scaffolds.get("categories", []):
    payload = dict(row)
    object_ids = [object_id_map.get(item) for item in payload.pop("canonical_objects", [])]
    clean_object_ids = [item for item in object_ids if item]
    extra = json_loads(payload.get("payload_json"), {})
    extra["object_ids"] = clean_object_ids
    payload["payload_json"] = _json(extra, {})
    category_rows.append(payload)
  _insert_many(connection, "categories", category_rows)

  category_morphism_rows = []
  for row in scaffolds.get("category_morphisms", []):
    payload = dict(row)
    payload["source_object_id"] = object_id_map.get(payload.pop("source_canonical", ""), "")
    payload["target_object_id"] = object_id_map.get(payload.pop("target_canonical", ""), "")
    payload["payload_json"] = _json(json_loads(payload.get("payload_json"), {}), {})
    if payload["source_object_id"] and payload["target_object_id"]:
      category_morphism_rows.append(payload)
  _insert_many(connection, "category_morphisms", category_morphism_rows)

  cover_rows = []
  for row in scaffolds.get("covers", []):
    payload = dict(row)
    payload["object_id"] = object_id_map.get(payload.pop("canonical_object", ""), "")
    payload["node_ids_json"] = _json(payload.get("node_ids_json"), [])
    payload["payload_json"] = _json(json_loads(payload.get("payload_json"), {}), {})
    if payload["object_id"]:
      cover_rows.append(payload)
  _insert_many(connection, "covers", cover_rows)

  restriction_rows = []
  for row in scaffolds.get("restriction_maps", []):
    payload = dict(row)
    payload["shared_object_id"] = object_id_map.get(payload.pop("shared_canonical", ""), "")
    payload["payload_json"] = _json(json_loads(payload.get("payload_json"), {}), {})
    payload["validation_json"] = _json(json_loads(payload.get("validation_json"), {}), {})
    if payload["shared_object_id"]:
      restriction_rows.append(payload)
  _insert_many(connection, "restriction_maps", restriction_rows)

  constraint_rows = []
  for row in scaffolds.get("gluing_constraints", []):
    payload = dict(row)
    payload["object_id"] = object_id_map.get(payload.pop("canonical_object", ""), "")
    payload["rule_json"] = _json(json_loads(payload.get("rule_json"), {}), {})
    payload["validation_json"] = _json(json_loads(payload.get("validation_json"), {}), {})
    if payload["object_id"]:
      constraint_rows.append(payload)
  _insert_many(connection, "gluing_constraints", constraint_rows)

  obstruction_rows = []
  for row in scaffolds.get("obstructions", []):
    payload = dict(row)
    payload["object_id"] = object_id_map.get(payload.pop("canonical_object", ""), "")
    payload["payload_json"] = _json(json_loads(payload.get("payload_json"), {}), {})
    if payload["object_id"]:
      obstruction_rows.append(payload)
  _insert_many(connection, "obstructions", obstruction_rows)

  simplex_rows = []
  for row in scaffolds.get("simplices", []):
    payload = dict(row)
    object_ids = [object_id_map.get(item) for item in payload.pop("canonical_objects", [])]
    clean_object_ids = [item for item in object_ids if item]
    payload["object_ids_json"] = _json(clean_object_ids, [])
    payload["payload_json"] = _json(json_loads(payload.get("payload_json"), {}), {})
    if len(clean_object_ids) >= 2:
      simplex_rows.append(payload)
  _insert_many(connection, "simplices", simplex_rows)
  replace_document_research_graph_summary(
    connection,
    document_id,
    sign_rows=sign_rows,
    category_rows=category_rows,
    category_morphism_rows=category_morphism_rows,
    cover_rows=cover_rows,
    restriction_rows=restriction_rows,
    constraint_rows=constraint_rows,
    obstruction_rows=obstruction_rows,
    simplex_rows=simplex_rows,
    object_id_map=object_id_map,
  )


def list_sign_tokens(connection: sqlite3.Connection, document_ids: Iterable[str]) -> list[dict[str, Any]]:
  ids = list(document_ids)
  if not ids:
    return []
  rows = connection.execute(
    f"SELECT * FROM sign_tokens WHERE document_id IN ({','.join('?' for _ in ids)}) ORDER BY frequency DESC",
    ids,
  ).fetchall()
  return [dict(row) for row in rows]


def list_objects_of_reference(connection: sqlite3.Connection, object_ids: Iterable[str] | None = None, canonical_labels: Iterable[str] | None = None) -> list[dict[str, Any]]:
  if object_ids:
    ids = list(object_ids)
    if not ids:
      return []
    rows = connection.execute(
      f"SELECT * FROM objects_of_reference WHERE id IN ({','.join('?' for _ in ids)}) ORDER BY label ASC",
      ids,
    ).fetchall()
    return [dict(row) for row in rows]
  if canonical_labels:
    labels = list(canonical_labels)
    if not labels:
      return []
    rows = connection.execute(
      f"SELECT * FROM objects_of_reference WHERE canonical_label IN ({','.join('?' for _ in labels)}) ORDER BY label ASC",
      labels,
    ).fetchall()
    return [dict(row) for row in rows]
  rows = connection.execute("SELECT * FROM objects_of_reference ORDER BY label ASC").fetchall()
  return [dict(row) for row in rows]


def list_categories(connection: sqlite3.Connection, document_ids: Iterable[str]) -> list[dict[str, Any]]:
  ids = list(document_ids)
  if not ids:
    return []
  rows = connection.execute(
    f"SELECT * FROM categories WHERE document_id IN ({','.join('?' for _ in ids)}) ORDER BY scope ASC, label ASC",
    ids,
  ).fetchall()
  return [dict(row) for row in rows]


def list_category_morphisms(connection: sqlite3.Connection, category_ids: Iterable[str]) -> list[dict[str, Any]]:
  ids = list(category_ids)
  if not ids:
    return []
  rows = connection.execute(
    f"SELECT * FROM category_morphisms WHERE category_id IN ({','.join('?' for _ in ids)}) ORDER BY weight DESC",
    ids,
  ).fetchall()
  return [dict(row) for row in rows]


def list_covers(connection: sqlite3.Connection, document_ids: Iterable[str], object_ids: Iterable[str] | None = None) -> list[dict[str, Any]]:
  document_ids = list(document_ids)
  if not document_ids:
    return []
  where = f"document_id IN ({','.join('?' for _ in document_ids)})"
  parameters: list[Any] = list(document_ids)
  if object_ids:
    object_ids = [item for item in object_ids if item]
    if object_ids:
      where += f" AND object_id IN ({','.join('?' for _ in object_ids)})"
      parameters.extend(object_ids)
  rows = connection.execute(f"SELECT * FROM covers WHERE {where} ORDER BY label ASC", parameters).fetchall()
  return [dict(row) for row in rows]


def list_restriction_maps(connection: sqlite3.Connection, cover_ids: Iterable[str]) -> list[dict[str, Any]]:
  ids = list(cover_ids)
  if not ids:
    return []
  rows = connection.execute(
    f"SELECT * FROM restriction_maps WHERE cover_id IN ({','.join('?' for _ in ids)}) ORDER BY created_at ASC",
    ids,
  ).fetchall()
  return [dict(row) for row in rows]


def list_gluing_constraints(connection: sqlite3.Connection, cover_ids: Iterable[str]) -> list[dict[str, Any]]:
  ids = list(cover_ids)
  if not ids:
    return []
  rows = connection.execute(
    f"SELECT * FROM gluing_constraints WHERE cover_id IN ({','.join('?' for _ in ids)}) ORDER BY created_at ASC",
    ids,
  ).fetchall()
  return [dict(row) for row in rows]


def list_obstructions(connection: sqlite3.Connection, cover_ids: Iterable[str]) -> list[dict[str, Any]]:
  ids = list(cover_ids)
  if not ids:
    return []
  rows = connection.execute(
    f"SELECT * FROM obstructions WHERE cover_id IN ({','.join('?' for _ in ids)}) ORDER BY created_at ASC",
    ids,
  ).fetchall()
  return [dict(row) for row in rows]


def list_simplices(connection: sqlite3.Connection, document_ids: Iterable[str]) -> list[dict[str, Any]]:
  ids = list(document_ids)
  if not ids:
    return []
  rows = connection.execute(
    f"SELECT * FROM simplices WHERE document_id IN ({','.join('?' for _ in ids)}) ORDER BY dimension DESC, weight DESC",
    ids,
  ).fetchall()
  return [dict(row) for row in rows]


# Research bundles capture retrieval output plus higher-order semantic structure.
def create_research_bundle(connection: sqlite3.Connection, bundle: dict[str, Any]) -> dict[str, Any]:
  now = utc_now()
  bundle_id = bundle.get("id") or f"bundle-{uuid4().hex}"
  payload = {
    "id": bundle_id,
    "user_id": bundle.get("user_id"),
    "query_text": bundle["query_text"],
    "mode": bundle["mode"],
    "answer": bundle["answer"],
    "citations_json": _json(bundle.get("citations"), []),
    "evidence_json": _json(bundle.get("evidence_bundle"), {}),
    "entities_json": _json(bundle.get("entities"), []),
    "relations_json": _json(bundle.get("relations"), []),
    "lens_payloads_json": _json(bundle.get("lens_payloads"), {}),
    "validation_json": _json(bundle.get("validation"), []),
    "warnings_json": _json(bundle.get("warnings"), []),
    "trace_json": _json(bundle.get("trace"), {}),
    "created_at": bundle.get("created_at", now),
    "updated_at": now,
  }
  connection.execute(
    """
    INSERT INTO research_bundles (
      id, user_id, query_text, mode, answer, citations_json, evidence_json, entities_json, relations_json,
      lens_payloads_json, validation_json, warnings_json, trace_json, created_at, updated_at
    ) VALUES (
      :id, :user_id, :query_text, :mode, :answer, :citations_json, :evidence_json, :entities_json, :relations_json,
      :lens_payloads_json, :validation_json, :warnings_json, :trace_json, :created_at, :updated_at
    )
    """,
    payload,
  )

  interpretants = []
  for item in bundle.get("interpretants", []):
    row = dict(item)
    row["claims_json"] = _json(row.get("claims_json"), [])
    row["stance_json"] = _json(row.get("stance_json"), {})
    row["tone_json"] = _json(row.get("tone_json"), {})
    row["payload_json"] = _json(row.get("payload_json"), {})
    interpretants.append(row)
  _insert_many(connection, "interpretants", interpretants)

  morphisms = []
  for item in bundle.get("morphisms", []):
    row = dict(item)
    row["payload_json"] = _json(row.get("payload_json"), {})
    row["validation_json"] = _json(row.get("validation_json"), {})
    morphisms.append(row)
  _insert_many(connection, "morphisms", morphisms)

  triads = []
  for item in bundle.get("triads", []):
    row = dict(item)
    row["payload_json"] = _json(row.get("payload_json"), {})
    triads.append(row)
  _insert_many(connection, "triads", triads)

  functors = []
  for item in bundle.get("functors", []):
    row = dict(item)
    row["mapping_json"] = _json(row.get("mapping_json"), {})
    row["validation_json"] = _json(row.get("validation_json"), {})
    functors.append(row)
  _insert_many(connection, "functors", functors)

  natural_transformations = []
  for item in bundle.get("natural_transformations", []):
    row = dict(item)
    row["components_json"] = _json(row.get("components_json"), [])
    row["validation_json"] = _json(row.get("validation_json"), {})
    natural_transformations.append(row)
  _insert_many(connection, "natural_transformations", natural_transformations)

  catastrophe_events = []
  for item in bundle.get("catastrophe_events", []):
    row = dict(item)
    row["control_axis_json"] = _json(row.get("control_axis_json"), {})
    row["state_axis_json"] = _json(row.get("state_axis_json"), {})
    row["payload_json"] = _json(row.get("payload_json"), {})
    row["validation_json"] = _json(row.get("validation_json"), {})
    catastrophe_events.append(row)
  _insert_many(connection, "catastrophe_events", catastrophe_events)
  return get_research_bundle(connection, bundle_id) or payload


def get_research_bundle(connection: sqlite3.Connection, bundle_id: str) -> dict[str, Any] | None:
  row = connection.execute("SELECT * FROM research_bundles WHERE id = ?", (bundle_id,)).fetchone()
  if row is None:
    return None
  payload = dict(row)
  payload["citations"] = json_loads(payload.get("citations_json"), [])
  payload["evidence_bundle"] = json_loads(payload.get("evidence_json"), {})
  payload["entities"] = json_loads(payload.get("entities_json"), [])
  payload["relations"] = json_loads(payload.get("relations_json"), [])
  payload["lens_payloads"] = json_loads(payload.get("lens_payloads_json"), {})
  payload["validation"] = json_loads(payload.get("validation_json"), [])
  payload["warnings"] = json_loads(payload.get("warnings_json"), [])
  payload["trace"] = json_loads(payload.get("trace_json"), {})
  return payload


# Research maps and pins are the authored curation layer on top of bundles.
def list_research_maps(connection: sqlite3.Connection, user_id: str) -> list[dict[str, Any]]:
  rows = connection.execute(
    "SELECT * FROM research_maps WHERE user_id = ? ORDER BY updated_at DESC",
    (user_id,),
  ).fetchall()
  return [dict(row) for row in rows]


def get_research_map_by_source(connection: sqlite3.Connection, user_id: str, source_kind: str, source_ref: str) -> dict[str, Any] | None:
  row = connection.execute(
    """
    SELECT *
    FROM research_maps
    WHERE user_id = ? AND source_kind = ? AND source_ref = ?
    ORDER BY updated_at DESC
    LIMIT 1
    """,
    (user_id, source_kind, source_ref),
  ).fetchone()
  return row_to_dict(row)


def create_research_map(connection: sqlite3.Connection, user_id: str, title: str, description: str,
    bundle_id: str | None = None, layout: dict[str, Any] | None = None, source_kind: str | None = None,
    source_ref: str | None = None) -> dict[str, Any]:
  now = utc_now()
  payload = {
    "id": f"map-{uuid4().hex}",
    "user_id": user_id,
    "title": title,
    "description": description,
    "bundle_id": bundle_id,
    "source_kind": source_kind,
    "source_ref": source_ref,
    "layout_json": _json(layout, {}),
    "created_at": now,
    "updated_at": now,
  }
  connection.execute(
    """
    INSERT INTO research_maps (id, user_id, title, description, bundle_id, source_kind, source_ref, layout_json, created_at, updated_at)
    VALUES (:id, :user_id, :title, :description, :bundle_id, :source_kind, :source_ref, :layout_json, :created_at, :updated_at)
    """,
    payload,
  )
  return payload


def update_research_map(connection: sqlite3.Connection, map_id: str, title: str, description: str,
    bundle_id: str | None = None, layout: dict[str, Any] | None = None, source_kind: str | None = None,
    source_ref: str | None = None) -> dict[str, Any]:
  connection.execute(
    """
    UPDATE research_maps
    SET title = ?,
        description = ?,
        bundle_id = ?,
        source_kind = ?,
        source_ref = ?,
        layout_json = ?,
        updated_at = ?
    WHERE id = ?
    """,
    (title, description, bundle_id, source_kind, source_ref, _json(layout, {}), utc_now(), map_id),
  )
  row = connection.execute("SELECT * FROM research_maps WHERE id = ?", (map_id,)).fetchone()
  return dict(row)


def create_research_map_pin(connection: sqlite3.Connection, map_id: str, entity_id: str, pin_type: str, position: dict[str, Any] | None = None, payload: dict[str, Any] | None = None) -> dict[str, Any]:
  row = {
    "id": f"pin-{uuid4().hex}",
    "map_id": map_id,
    "entity_id": entity_id,
    "pin_type": pin_type,
    "position_json": _json(position, {}),
    "payload_json": _json(payload, {}),
    "created_at": utc_now(),
  }
  connection.execute(
    """
    INSERT INTO research_map_pins (id, map_id, entity_id, pin_type, position_json, payload_json, created_at)
    VALUES (:id, :map_id, :entity_id, :pin_type, :position_json, :payload_json, :created_at)
    """,
    row,
  )
  return row


def delete_research_map_pins(connection: sqlite3.Connection, map_id: str) -> None:
  connection.execute("DELETE FROM research_map_pins WHERE map_id = ?", (map_id,))


def list_research_map_pins(connection: sqlite3.Connection, map_ids: Iterable[str]) -> list[dict[str, Any]]:
  ids = list(map_ids)
  if not ids:
    return []
  rows = connection.execute(
    f"SELECT * FROM research_map_pins WHERE map_id IN ({','.join('?' for _ in ids)}) ORDER BY created_at ASC",
    ids,
  ).fetchall()
  return [dict(row) for row in rows]


def get_research_entity(connection: sqlite3.Connection, entity_id: str) -> dict[str, Any] | None:
  for table, entity_type in ENTITY_TABLES:
    row = connection.execute(f"SELECT * FROM {table} WHERE id = ?", (entity_id,)).fetchone()
    if row is None:
      continue
    payload = dict(row)
    payload["type"] = entity_type
    for key in list(payload.keys()):
      if key.endswith("_json"):
        payload[key[:-5]] = json_loads(payload[key], {})
    return payload
  return None


def upsert_forecast_technique(connection: sqlite3.Connection, technique: dict[str, Any]) -> dict[str, Any]:
  now = utc_now()
  payload = {
    "id": technique["id"],
    "family_key": technique.get("family_key", "polynomial"),
    "family_title": technique.get("family_title", "Polynomial Forecasting Methods"),
    "technique": technique["technique"],
    "category": technique["category"],
    "forecast_target": technique["forecast_target"],
    "difficulty": technique["difficulty"],
    "short_definition": technique["short_definition"],
    "purpose": technique["purpose"],
    "required_inputs_json": _json(technique.get("required_inputs"), []),
    "optional_inputs_json": _json(technique.get("optional_inputs"), []),
    "outputs_json": _json(technique.get("outputs"), []),
    "time_horizon": technique.get("time_horizon", ""),
    "frequency_assumptions": technique.get("frequency_assumptions", ""),
    "mathematical_logic": technique.get("mathematical_logic", ""),
    "algorithm_json": _json(technique.get("algorithm"), []),
    "assumptions_json": _json(technique.get("assumptions"), []),
    "strengths_json": _json(technique.get("strengths"), []),
    "weaknesses_json": _json(technique.get("weaknesses"), []),
    "failure_modes_json": _json(technique.get("failure_modes"), []),
    "common_mistakes_json": _json(technique.get("common_mistakes"), []),
    "minimum_viable_version": technique.get("minimum_viable_version", ""),
    "advanced_version": technique.get("advanced_version", ""),
    "implementation_status": technique.get("implementation_status", "template_only"),
    "adaptation_status": technique.get("adaptation_status", "unclassified"),
    "best_use_case": technique.get("best_use_case", ""),
    "key_limitation": technique.get("key_limitation", ""),
    "confidence_level": technique.get("confidence_level", "medium"),
    "source_reference_hint": technique.get("source_reference_hint", ""),
    "pseudocode": technique.get("pseudocode", ""),
    "implementation_notes_json": _json(technique.get("implementation_notes"), []),
    "validation_checks_json": _json(technique.get("validation_checks"), []),
    "unit_test_ideas_json": _json(technique.get("unit_test_ideas"), []),
    "backtesting_procedure_json": _json(technique.get("backtesting_procedure"), []),
    "spreadsheet_logic": technique.get("spreadsheet_logic", ""),
    "connections_json": _json(technique.get("connections"), []),
    "inputs_summary": technique.get("inputs_summary", ""),
    "outputs_summary": technique.get("outputs_summary", ""),
    "created_at": technique.get("created_at", now),
    "updated_at": now,
  }
  connection.execute(
    """
    INSERT INTO forecast_techniques (
      id, family_key, family_title, technique, category, forecast_target, difficulty, short_definition, purpose,
      required_inputs_json, optional_inputs_json, outputs_json, time_horizon, frequency_assumptions,
      mathematical_logic, algorithm_json, assumptions_json, strengths_json, weaknesses_json,
      failure_modes_json, common_mistakes_json, minimum_viable_version, advanced_version,
      implementation_status, adaptation_status, best_use_case, key_limitation, confidence_level,
      source_reference_hint, pseudocode, implementation_notes_json, validation_checks_json,
      unit_test_ideas_json, backtesting_procedure_json, spreadsheet_logic, connections_json,
      inputs_summary, outputs_summary, created_at, updated_at
    ) VALUES (
      :id, :family_key, :family_title, :technique, :category, :forecast_target, :difficulty, :short_definition, :purpose,
      :required_inputs_json, :optional_inputs_json, :outputs_json, :time_horizon, :frequency_assumptions,
      :mathematical_logic, :algorithm_json, :assumptions_json, :strengths_json, :weaknesses_json,
      :failure_modes_json, :common_mistakes_json, :minimum_viable_version, :advanced_version,
      :implementation_status, :adaptation_status, :best_use_case, :key_limitation, :confidence_level,
      :source_reference_hint, :pseudocode, :implementation_notes_json, :validation_checks_json,
      :unit_test_ideas_json, :backtesting_procedure_json, :spreadsheet_logic, :connections_json,
      :inputs_summary, :outputs_summary, :created_at, :updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
      family_key = excluded.family_key,
      family_title = excluded.family_title,
      technique = excluded.technique,
      category = excluded.category,
      forecast_target = excluded.forecast_target,
      difficulty = excluded.difficulty,
      short_definition = excluded.short_definition,
      purpose = excluded.purpose,
      required_inputs_json = excluded.required_inputs_json,
      optional_inputs_json = excluded.optional_inputs_json,
      outputs_json = excluded.outputs_json,
      time_horizon = excluded.time_horizon,
      frequency_assumptions = excluded.frequency_assumptions,
      mathematical_logic = excluded.mathematical_logic,
      algorithm_json = excluded.algorithm_json,
      assumptions_json = excluded.assumptions_json,
      strengths_json = excluded.strengths_json,
      weaknesses_json = excluded.weaknesses_json,
      failure_modes_json = excluded.failure_modes_json,
      common_mistakes_json = excluded.common_mistakes_json,
      minimum_viable_version = excluded.minimum_viable_version,
      advanced_version = excluded.advanced_version,
      implementation_status = excluded.implementation_status,
      adaptation_status = excluded.adaptation_status,
      best_use_case = excluded.best_use_case,
      key_limitation = excluded.key_limitation,
      confidence_level = excluded.confidence_level,
      source_reference_hint = excluded.source_reference_hint,
      pseudocode = excluded.pseudocode,
      implementation_notes_json = excluded.implementation_notes_json,
      validation_checks_json = excluded.validation_checks_json,
      unit_test_ideas_json = excluded.unit_test_ideas_json,
      backtesting_procedure_json = excluded.backtesting_procedure_json,
      spreadsheet_logic = excluded.spreadsheet_logic,
      connections_json = excluded.connections_json,
      inputs_summary = excluded.inputs_summary,
      outputs_summary = excluded.outputs_summary,
      updated_at = excluded.updated_at
    """,
    payload,
  )
  row = connection.execute("SELECT * FROM forecast_techniques WHERE id = ?", (technique["id"],)).fetchone()
  return dict(row) if row else payload


def replace_forecast_technique_assets(connection: sqlite3.Connection, technique_id: str, assets: list[dict[str, Any]]) -> None:
  connection.execute("DELETE FROM forecast_technique_assets WHERE technique_id = ?", (technique_id,))
  rows = []
  for asset in assets:
    rows.append(
      {
        "id": asset["id"],
        "technique_id": technique_id,
        "asset_type": asset["asset_type"],
        "label": asset["label"],
        "path": asset["path"],
        "symbol": asset.get("symbol"),
        "payload_json": _json(asset.get("payload"), {}),
        "created_at": utc_now(),
        "updated_at": utc_now(),
      }
    )
  _insert_many(connection, "forecast_technique_assets", rows)


def replace_forecast_technique_adaptations(connection: sqlite3.Connection, technique_id: str, adaptations: list[dict[str, Any]]) -> None:
  connection.execute("DELETE FROM forecast_technique_adaptations WHERE technique_id = ?", (technique_id,))
  rows = []
  for adaptation in adaptations:
    rows.append(
      {
        "id": adaptation["id"],
        "technique_id": technique_id,
        "name": adaptation["name"],
        "category": adaptation.get("category", ""),
        "summary": adaptation.get("summary", ""),
        "forecast_targets_json": _json(adaptation.get("forecast_targets"), []),
        "created_at": utc_now(),
        "updated_at": utc_now(),
      }
    )
  _insert_many(connection, "forecast_technique_adaptations", rows)


def replace_forecast_technique_validation_cases(connection: sqlite3.Connection, technique_id: str, validation_cases: list[dict[str, Any]]) -> None:
  connection.execute("DELETE FROM forecast_technique_validation_cases WHERE technique_id = ?", (technique_id,))
  rows = []
  for case in validation_cases:
    rows.append(
      {
        "id": case["id"],
        "technique_id": technique_id,
        "name": case["name"],
        "description": case.get("description", ""),
        "expected_outcome": case.get("expected_outcome", ""),
        "created_at": utc_now(),
        "updated_at": utc_now(),
      }
    )
  _insert_many(connection, "forecast_technique_validation_cases", rows)


def delete_document_forecast_technique_sources(connection: sqlite3.Connection, document_id: str, family_key: str) -> None:
  technique_rows = connection.execute(
    "SELECT id FROM forecast_techniques WHERE family_key = ?",
    (family_key,),
  ).fetchall()
  technique_ids = [row["id"] for row in technique_rows]
  if not technique_ids:
    return
  connection.execute(
    f"DELETE FROM forecast_technique_sources WHERE document_id = ? AND technique_id IN ({','.join('?' for _ in technique_ids)})",
    [document_id, *technique_ids],
  )


def replace_document_forecast_technique_sources(connection: sqlite3.Connection, document_id: str, family_key: str, sources: list[dict[str, Any]]) -> None:
  delete_document_forecast_technique_sources(connection, document_id, family_key)
  rows = []
  for source in sources:
    rows.append(
      {
        "id": source["id"],
        "technique_id": source["technique_id"],
        "document_id": document_id,
        "node_id": source.get("node_id"),
        "source_label": source["source_label"],
        "section_title": source.get("section_title", source.get("source_label", "")),
        "page_start": int(source.get("page_start", 1) or 1),
        "page_end": int(source.get("page_end", 1) or 1),
        "reference_text": source.get("reference_text", ""),
        "source_reference": source.get("source_reference", ""),
        "variation_type": source.get("variation_type", "conceptual"),
        "evidence_score": float(source.get("evidence_score", 0.0)),
        "created_at": utc_now(),
        "updated_at": utc_now(),
      }
    )
  _insert_many(connection, "forecast_technique_sources", rows)


def upsert_document_technique_materialization_summary(
  connection: sqlite3.Connection,
  document_id: str,
  family_key: str,
  *,
  technique_count: int,
  source_count: int,
  asset_count: int,
  adaptation_count: int,
  validation_case_count: int,
  payload: dict[str, Any] | None = None,
) -> None:
  now = utc_now()
  summary_id = f"techmat-{document_id}-{family_key}"
  connection.execute(
    """
    INSERT INTO technique_materializations (
      id, document_id, family_key, technique_count, source_count, asset_count,
      adaptation_count, validation_case_count, payload_json, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
    ON CONFLICT(document_id, family_key) DO UPDATE SET
      technique_count = excluded.technique_count,
      source_count = excluded.source_count,
      asset_count = excluded.asset_count,
      adaptation_count = excluded.adaptation_count,
      validation_case_count = excluded.validation_case_count,
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at
    """,
    (
      summary_id,
      document_id,
      family_key,
      int(technique_count),
      int(source_count),
      int(asset_count),
      int(adaptation_count),
      int(validation_case_count),
      _json(payload, {}),
      now,
      now,
    ),
  )


def list_document_technique_materializations(connection: sqlite3.Connection, document_id: str) -> list[dict[str, Any]]:
  rows = connection.execute(
    "SELECT * FROM technique_materializations WHERE document_id = ? ORDER BY family_key ASC",
    (document_id,),
  ).fetchall()
  payloads = []
  for row in rows:
    item = dict(row)
    item["payload"] = json_loads(item.get("payload_json"), {})
    payloads.append(item)
  return payloads


def replace_document_technique_materialization(connection: sqlite3.Connection, document_id: str, family_key: str, payload: dict[str, list[dict[str, Any]]]) -> None:
  raw_techniques = [dict(item) for item in payload.get("techniques", [])]
  techniques = []
  for index, technique in enumerate(raw_techniques, start=1):
    technique_name = technique.get("technique") or technique.get("name") or technique.get("title") or family_key.replace("_", " ").title()
    technique_id = technique.get("id") or _stable_repo_id("forecast-technique", document_id, family_key, technique_name, index)
    technique["id"] = technique_id
    technique["technique"] = technique_name
    technique["category"] = technique.get("category", "unclassified")
    technique["forecast_target"] = technique.get("forecast_target", "general")
    technique["difficulty"] = technique.get("difficulty", "unknown")
    technique["short_definition"] = technique.get("short_definition") or technique_name
    technique["purpose"] = technique.get("purpose") or technique_name
    techniques.append(technique)

  technique_ids = [technique["id"] for technique in techniques]
  default_technique_id = technique_ids[0] if len(technique_ids) == 1 else None

  sources = []
  for index, source in enumerate(payload.get("sources", []), start=1):
    row = dict(source)
    row["technique_id"] = row.get("technique_id") or default_technique_id
    if not row.get("technique_id"):
      continue
    row["source_label"] = row.get("source_label") or row.get("section_title") or row.get("source_reference") or f"{family_key} source {index}"
    row["id"] = row.get("id") or _stable_repo_id("forecast-source", document_id, family_key, row["technique_id"], row["source_label"], index)
    sources.append(row)

  assets = []
  for index, asset in enumerate(payload.get("assets", []), start=1):
    row = dict(asset)
    row["technique_id"] = row.get("technique_id") or default_technique_id
    if not row.get("technique_id"):
      continue
    row["asset_type"] = row.get("asset_type", "reference")
    row["label"] = row.get("label") or row.get("path") or f"{family_key} asset {index}"
    row["path"] = row.get("path", "")
    row["id"] = row.get("id") or _stable_repo_id("forecast-asset", document_id, family_key, row["technique_id"], row["label"], index)
    assets.append(row)

  adaptations = []
  for index, adaptation in enumerate(payload.get("adaptations", []), start=1):
    row = dict(adaptation)
    row["technique_id"] = row.get("technique_id") or default_technique_id
    if not row.get("technique_id"):
      continue
    row["name"] = row.get("name") or row.get("summary") or f"{family_key} adaptation {index}"
    row["id"] = row.get("id") or _stable_repo_id("forecast-adaptation", document_id, family_key, row["technique_id"], row["name"], index)
    adaptations.append(row)

  validation_cases = []
  for index, case in enumerate(payload.get("validation_cases", []), start=1):
    row = dict(case)
    row["technique_id"] = row.get("technique_id") or default_technique_id
    if not row.get("technique_id"):
      continue
    row["name"] = row.get("name") or row.get("description") or f"{family_key} validation {index}"
    row["id"] = row.get("id") or _stable_repo_id("forecast-validation", document_id, family_key, row["technique_id"], row["name"], index)
    validation_cases.append(row)

  for technique in techniques:
    upsert_forecast_technique(connection, technique)
    technique_assets = [asset for asset in assets if asset["technique_id"] == technique["id"]]
    technique_adaptations = [adaptation for adaptation in adaptations if adaptation["technique_id"] == technique["id"]]
    technique_validation_cases = [case for case in validation_cases if case["technique_id"] == technique["id"]]
    replace_forecast_technique_assets(connection, technique["id"], technique_assets)
    replace_forecast_technique_adaptations(connection, technique["id"], technique_adaptations)
    replace_forecast_technique_validation_cases(connection, technique["id"], technique_validation_cases)
  replace_document_forecast_technique_sources(connection, document_id, family_key, sources)
  upsert_document_technique_materialization_summary(
    connection,
    document_id,
    family_key,
    technique_count=len(techniques),
    source_count=len(sources),
    asset_count=len(assets),
    adaptation_count=len(adaptations),
    validation_case_count=len(validation_cases),
    payload={
      "technique_ids": [technique.get("id") for technique in techniques if technique.get("id")],
      "family_key": family_key,
    },
  )


def _inflate_forecast_technique(row: dict[str, Any]) -> dict[str, Any]:
  payload = dict(row)
  for field in (
    "required_inputs_json",
    "optional_inputs_json",
    "outputs_json",
    "algorithm_json",
    "assumptions_json",
    "strengths_json",
    "weaknesses_json",
    "failure_modes_json",
    "common_mistakes_json",
    "implementation_notes_json",
    "validation_checks_json",
    "unit_test_ideas_json",
    "backtesting_procedure_json",
    "connections_json",
  ):
    payload[field[:-5]] = json_loads(payload.get(field), [])
  return payload


def list_forecast_techniques(connection: sqlite3.Connection, document_id: str | None = None, family_key: str | None = None) -> list[dict[str, Any]]:
  if document_id:
    where = ["forecast_technique_sources.document_id = ?"]
    params: list[Any] = [document_id]
    if family_key:
      where.append("forecast_techniques.family_key = ?")
      params.append(family_key)
    rows = connection.execute(
      f"""
      SELECT DISTINCT forecast_techniques.*
      FROM forecast_techniques
      JOIN forecast_technique_sources ON forecast_technique_sources.technique_id = forecast_techniques.id
      WHERE {' AND '.join(where)}
      ORDER BY forecast_techniques.technique ASC
      """,
      params,
    ).fetchall()
  else:
    if family_key:
      rows = connection.execute(
        "SELECT * FROM forecast_techniques WHERE family_key = ? ORDER BY technique ASC",
        (family_key,),
      ).fetchall()
    else:
      rows = connection.execute("SELECT * FROM forecast_techniques ORDER BY technique ASC").fetchall()
  return [_inflate_forecast_technique(dict(row)) for row in rows]


def list_forecast_technique_sources(connection: sqlite3.Connection, technique_ids: Iterable[str] | None = None, document_id: str | None = None) -> list[dict[str, Any]]:
  where: list[str] = []
  params: list[Any] = []
  if technique_ids:
    ids = [item for item in technique_ids if item]
    if ids:
      where.append(f"technique_id IN ({','.join('?' for _ in ids)})")
      params.extend(ids)
  if document_id:
    where.append("document_id = ?")
    params.append(document_id)
  sql = "SELECT * FROM forecast_technique_sources"
  if where:
    sql += f" WHERE {' AND '.join(where)}"
  sql += " ORDER BY evidence_score DESC, page_start ASC"
  rows = connection.execute(sql, params).fetchall()
  return [dict(row) for row in rows]


def list_forecast_technique_assets(connection: sqlite3.Connection, technique_ids: Iterable[str]) -> list[dict[str, Any]]:
  ids = [item for item in technique_ids if item]
  if not ids:
    return []
  rows = connection.execute(
    f"SELECT * FROM forecast_technique_assets WHERE technique_id IN ({','.join('?' for _ in ids)}) ORDER BY label ASC",
    ids,
  ).fetchall()
  payloads = []
  for row in rows:
    item = dict(row)
    item["payload"] = json_loads(item.get("payload_json"), {})
    payloads.append(item)
  return payloads


def list_forecast_technique_adaptations(connection: sqlite3.Connection, technique_ids: Iterable[str]) -> list[dict[str, Any]]:
  ids = [item for item in technique_ids if item]
  if not ids:
    return []
  rows = connection.execute(
    f"SELECT * FROM forecast_technique_adaptations WHERE technique_id IN ({','.join('?' for _ in ids)}) ORDER BY name ASC",
    ids,
  ).fetchall()
  payloads = []
  for row in rows:
    item = dict(row)
    item["forecast_targets"] = json_loads(item.get("forecast_targets_json"), [])
    payloads.append(item)
  return payloads


def list_forecast_technique_validation_cases(connection: sqlite3.Connection, technique_ids: Iterable[str]) -> list[dict[str, Any]]:
  ids = [item for item in technique_ids if item]
  if not ids:
    return []
  rows = connection.execute(
    f"SELECT * FROM forecast_technique_validation_cases WHERE technique_id IN ({','.join('?' for _ in ids)}) ORDER BY name ASC",
    ids,
  ).fetchall()
  return [dict(row) for row in rows]


def get_forecast_technique_detail(connection: sqlite3.Connection, technique_id: str, document_id: str | None = None, family_key: str | None = None) -> dict[str, Any] | None:
  if family_key:
    row = connection.execute(
      "SELECT * FROM forecast_techniques WHERE id = ? AND family_key = ?",
      (technique_id, family_key),
    ).fetchone()
  else:
    row = connection.execute("SELECT * FROM forecast_techniques WHERE id = ?", (technique_id,)).fetchone()
  if row is None:
    return None
  payload = _inflate_forecast_technique(dict(row))
  payload["sources"] = list_forecast_technique_sources(connection, [technique_id], document_id=document_id)
  payload["assets"] = list_forecast_technique_assets(connection, [technique_id])
  payload["adaptations"] = list_forecast_technique_adaptations(connection, [technique_id])
  payload["validation_cases"] = list_forecast_technique_validation_cases(connection, [technique_id])
  return payload


def list_document_forecast_technique_details(connection: sqlite3.Connection, document_id: str, family_key: str | None = None) -> list[dict[str, Any]]:
  techniques = list_forecast_techniques(connection, document_id=document_id, family_key=family_key)
  technique_ids = [item["id"] for item in techniques]
  sources = list_forecast_technique_sources(connection, technique_ids, document_id=document_id)
  assets = list_forecast_technique_assets(connection, technique_ids)
  adaptations = list_forecast_technique_adaptations(connection, technique_ids)
  validation_cases = list_forecast_technique_validation_cases(connection, technique_ids)
  sources_by: dict[str, list[dict[str, Any]]] = {}
  for source in sources:
    sources_by.setdefault(source["technique_id"], []).append(source)
  assets_by: dict[str, list[dict[str, Any]]] = {}
  for asset in assets:
    assets_by.setdefault(asset["technique_id"], []).append(asset)
  adaptations_by: dict[str, list[dict[str, Any]]] = {}
  for adaptation in adaptations:
    adaptations_by.setdefault(adaptation["technique_id"], []).append(adaptation)
  validation_by: dict[str, list[dict[str, Any]]] = {}
  for case in validation_cases:
    validation_by.setdefault(case["technique_id"], []).append(case)
  for technique in techniques:
    technique["sources"] = sources_by.get(technique["id"], [])
    technique["assets"] = assets_by.get(technique["id"], [])
    technique["adaptations"] = adaptations_by.get(technique["id"], [])
    technique["validation_cases"] = validation_by.get(technique["id"], [])
  return techniques


def _inflate_activity_signal(row: dict[str, Any], git_export: dict[str, Any] | None = None) -> dict[str, Any]:
  payload = dict(row)
  payload["payload"] = json_loads(payload.get("payload_json"), {})
  payload["git_export"] = git_export
  return payload


def get_activity_signal(connection: sqlite3.Connection, user_id: str, signal_id: str) -> dict[str, Any] | None:
  row = connection.execute(
    "SELECT * FROM activity_signals WHERE user_id = ? AND id = ?",
    (user_id, signal_id),
  ).fetchone()
  return row_to_dict(row)


def upsert_activity_signal(
  connection: sqlite3.Connection,
  user_id: str,
  signal: dict[str, Any],
  *,
  origin: str = "derived",
  allow_review_overrides: bool = False,
) -> dict[str, Any]:
  now = utc_now()
  existing = get_activity_signal(connection, user_id, signal["id"])
  payload = {
    "user_id": user_id,
    "id": signal["id"],
    "source_module": signal.get("source_module", existing["source_module"] if existing else "library"),
    "source_kind": signal.get("source_kind", existing["source_kind"] if existing else "runtime"),
    "entity_id": signal.get("entity_id", existing.get("entity_id") if existing else None),
    "title": signal.get("title", existing["title"] if existing else signal["id"]),
    "summary": signal.get("summary", existing.get("summary") if existing else ""),
    "severity": signal.get("severity", existing.get("severity") if existing else "info"),
    "visibility": signal.get("visibility", existing.get("visibility") if existing else "public"),
    "signal_state": signal.get("signal_state", existing.get("signal_state") if existing else "active"),
    "review_state": signal.get("review_state", existing.get("review_state") if existing else "pending"),
    "note": signal.get("note", existing.get("note") if existing else ""),
    "snooze_until": signal.get("snooze_until", existing.get("snooze_until") if existing else None),
    "payload_json": _json(signal.get("payload"), existing.get("payload_json") if existing else {}),
    "origin": signal.get("origin") or (existing.get("origin") if existing else origin) or origin,
    "created_at": existing["created_at"] if existing else now,
    "updated_at": now,
  }
  if existing and not allow_review_overrides:
    payload["visibility"] = existing.get("visibility") or payload["visibility"]
    payload["review_state"] = existing.get("review_state") or payload["review_state"]
    payload["note"] = existing.get("note") or payload["note"]
    payload["snooze_until"] = existing.get("snooze_until") if existing.get("snooze_until") is not None else payload["snooze_until"]
  connection.execute(
    """
    INSERT INTO activity_signals (
      user_id, id, source_module, source_kind, entity_id, title, summary, severity,
      visibility, signal_state, review_state, note, snooze_until, payload_json, origin, created_at, updated_at
    ) VALUES (
      :user_id, :id, :source_module, :source_kind, :entity_id, :title, :summary, :severity,
      :visibility, :signal_state, :review_state, :note, :snooze_until, :payload_json, :origin, :created_at, :updated_at
    )
    ON CONFLICT(user_id, id) DO UPDATE SET
      source_module = excluded.source_module,
      source_kind = excluded.source_kind,
      entity_id = excluded.entity_id,
      title = excluded.title,
      summary = excluded.summary,
      severity = excluded.severity,
      visibility = excluded.visibility,
      signal_state = excluded.signal_state,
      review_state = excluded.review_state,
      note = excluded.note,
      snooze_until = excluded.snooze_until,
      payload_json = excluded.payload_json,
      origin = excluded.origin,
      updated_at = excluded.updated_at
    """,
    payload,
  )
  row = get_activity_signal(connection, user_id, signal["id"])
  return dict(row) if row else payload


def list_activity_signals(
  connection: sqlite3.Connection,
  user_id: str,
  *,
  source_module: str | None = None,
  include_snoozed: bool = True,
) -> list[dict[str, Any]]:
  where = ["activity_signals.user_id = ?"]
  params: list[Any] = [user_id]
  if source_module:
    where.append("activity_signals.source_module = ?")
    params.append(source_module)
  if not include_snoozed:
    where.append("(activity_signals.snooze_until IS NULL OR activity_signals.snooze_until <= ?)")
    params.append(utc_now())
  rows = connection.execute(
    f"""
    SELECT activity_signals.*, exports.id AS export_id, exports.status AS export_status, exports.file_relpath,
           exports.commit_hash, exports.error_text AS export_error_text, exports.updated_at AS export_updated_at
    FROM activity_signals
    LEFT JOIN (
      SELECT pending.user_id, pending.signal_id, pending.id, pending.status, pending.file_relpath, pending.commit_hash,
             pending.error_text, pending.updated_at
      FROM activity_private_exports AS pending
      INNER JOIN (
        SELECT user_id, signal_id, MAX(updated_at) AS latest_updated_at
        FROM activity_private_exports
        GROUP BY user_id, signal_id
      ) AS latest
        ON latest.user_id = pending.user_id
       AND latest.signal_id = pending.signal_id
       AND latest.latest_updated_at = pending.updated_at
    ) AS exports
      ON exports.user_id = activity_signals.user_id
     AND exports.signal_id = activity_signals.id
    WHERE {' AND '.join(where)}
    ORDER BY activity_signals.updated_at DESC, activity_signals.created_at DESC
    """,
    params,
  ).fetchall()
  payloads = []
  for row in rows:
    item = dict(row)
    git_export = None
    if item.get("export_id"):
      git_export = {
        "id": item["export_id"],
        "status": item.get("export_status"),
        "file_relpath": item.get("file_relpath"),
        "commit_hash": item.get("commit_hash"),
        "error_text": item.get("export_error_text"),
        "updated_at": item.get("export_updated_at"),
      }
    payloads.append(_inflate_activity_signal(item, git_export))
  return payloads


def resolve_missing_activity_signals(connection: sqlite3.Connection, user_id: str, origin: str, active_ids: set[str]) -> None:
  rows = connection.execute(
    "SELECT id FROM activity_signals WHERE user_id = ? AND origin = ?",
    (user_id, origin),
  ).fetchall()
  now = utc_now()
  for row in rows:
    signal_id = row["id"]
    if signal_id in active_ids:
      continue
    connection.execute(
      """
      UPDATE activity_signals
      SET signal_state = 'resolved',
          severity = CASE WHEN severity = 'error' THEN 'warning' ELSE severity END,
          updated_at = ?
      WHERE user_id = ? AND id = ?
      """,
      (now, user_id, signal_id),
    )


def create_activity_review(
  connection: sqlite3.Connection,
  user_id: str,
  signal_id: str,
  *,
  action: str,
  review_state: str,
  visibility: str,
  note: str = "",
  snooze_until: str | None = None,
  payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
  review = {
    "id": f"activity-review-{uuid4().hex}",
    "user_id": user_id,
    "signal_id": signal_id,
    "action": action,
    "review_state": review_state,
    "visibility": visibility,
    "note": note,
    "snooze_until": snooze_until,
    "payload_json": _json(payload, {}),
    "created_at": utc_now(),
  }
  connection.execute(
    """
    INSERT INTO activity_reviews (
      id, user_id, signal_id, action, review_state, visibility, note, snooze_until, payload_json, created_at
    ) VALUES (
      :id, :user_id, :signal_id, :action, :review_state, :visibility, :note, :snooze_until, :payload_json, :created_at
    )
    """,
    review,
  )
  return review


def list_activity_reviews(connection: sqlite3.Connection, user_id: str, signal_id: str) -> list[dict[str, Any]]:
  rows = connection.execute(
    """
    SELECT * FROM activity_reviews
    WHERE user_id = ? AND signal_id = ?
    ORDER BY created_at DESC
    """,
    (user_id, signal_id),
  ).fetchall()
  payloads = []
  for row in rows:
    item = dict(row)
    item["payload"] = json_loads(item.get("payload_json"), {})
    payloads.append(item)
  return payloads


def get_activity_git_profile(connection: sqlite3.Connection, user_id: str) -> dict[str, Any] | None:
  row = connection.execute(
    "SELECT * FROM activity_git_profiles WHERE user_id = ?",
    (user_id,),
  ).fetchone()
  return row_to_dict(row)


def upsert_activity_git_profile(
  connection: sqlite3.Connection,
  user_id: str,
  *,
  repo_path: str,
  export_subdir: str = "activity-exports",
  branch_name: str | None = None,
  valid: bool = False,
  last_validated_at: str | None = None,
  last_error: str | None = None,
) -> dict[str, Any]:
  now = utc_now()
  existing = get_activity_git_profile(connection, user_id)
  payload = {
    "user_id": user_id,
    "repo_path": repo_path,
    "export_subdir": export_subdir or "activity-exports",
    "branch_name": branch_name,
    "valid": 1 if valid else 0,
    "last_validated_at": last_validated_at,
    "last_error": last_error,
    "created_at": existing["created_at"] if existing else now,
    "updated_at": now,
  }
  connection.execute(
    """
    INSERT INTO activity_git_profiles (
      user_id, repo_path, export_subdir, branch_name, valid, last_validated_at, last_error, created_at, updated_at
    ) VALUES (
      :user_id, :repo_path, :export_subdir, :branch_name, :valid, :last_validated_at, :last_error, :created_at, :updated_at
    )
    ON CONFLICT(user_id) DO UPDATE SET
      repo_path = excluded.repo_path,
      export_subdir = excluded.export_subdir,
      branch_name = excluded.branch_name,
      valid = excluded.valid,
      last_validated_at = excluded.last_validated_at,
      last_error = excluded.last_error,
      updated_at = excluded.updated_at
    """,
    payload,
  )
  row = get_activity_git_profile(connection, user_id)
  return dict(row) if row else payload


def create_activity_private_export(
  connection: sqlite3.Connection,
  user_id: str,
  signal_id: str,
  *,
  review_id: str | None = None,
  visibility: str = "private",
  file_relpath: str | None = None,
  content: dict[str, Any] | None = None,
  status: str = "pending",
) -> dict[str, Any]:
  now = utc_now()
  payload = {
    "id": f"activity-export-{uuid4().hex}",
    "user_id": user_id,
    "signal_id": signal_id,
    "review_id": review_id,
    "status": status,
    "visibility": visibility,
    "file_relpath": file_relpath,
    "content_json": _json(content, {}),
    "commit_hash": None,
    "error_text": None,
    "created_at": now,
    "updated_at": now,
    "committed_at": None,
  }
  connection.execute(
    """
    INSERT INTO activity_private_exports (
      id, user_id, signal_id, review_id, status, visibility, file_relpath, content_json,
      commit_hash, error_text, created_at, updated_at, committed_at
    ) VALUES (
      :id, :user_id, :signal_id, :review_id, :status, :visibility, :file_relpath, :content_json,
      :commit_hash, :error_text, :created_at, :updated_at, :committed_at
    )
    """,
    payload,
  )
  return payload


def list_activity_private_exports(connection: sqlite3.Connection, user_id: str, *, status: str | None = None) -> list[dict[str, Any]]:
  where = ["user_id = ?"]
  params: list[Any] = [user_id]
  if status:
    where.append("status = ?")
    params.append(status)
  rows = connection.execute(
    f"SELECT * FROM activity_private_exports WHERE {' AND '.join(where)} ORDER BY updated_at DESC",
    params,
  ).fetchall()
  payloads = []
  for row in rows:
    item = dict(row)
    item["content"] = json_loads(item.get("content_json"), {})
    payloads.append(item)
  return payloads


def get_activity_private_export(connection: sqlite3.Connection, user_id: str, export_id: str) -> dict[str, Any] | None:
  row = connection.execute(
    "SELECT * FROM activity_private_exports WHERE user_id = ? AND id = ?",
    (user_id, export_id),
  ).fetchone()
  if row is None:
    return None
  item = dict(row)
  item["content"] = json_loads(item.get("content_json"), {})
  return item


def update_activity_private_export(connection: sqlite3.Connection, user_id: str, export_id: str, **updates: Any) -> None:
  if not updates:
    return
  updates["updated_at"] = utc_now()
  if "content_json" in updates:
    updates["content_json"] = _json(updates["content_json"], {})
  columns = ", ".join(f"{key} = :{key}" for key in updates.keys())
  updates["user_id"] = user_id
  updates["id"] = export_id
  connection.execute(
    f"UPDATE activity_private_exports SET {columns} WHERE user_id = :user_id AND id = :id",
    updates,
  )
