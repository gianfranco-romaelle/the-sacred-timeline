from __future__ import annotations

import json
import pprint
import traceback
from pathlib import Path

import app.worker as worker_module
from app import repository
from app.database import database_session, initialize_database
from app.errors import ServiceDependencyError


def build_test_worker(monkeypatch, tmp_path):
  monkeypatch.setattr(worker_module.settings, "data_dir", str(tmp_path / "data"))
  monkeypatch.setattr(worker_module.settings, "model_cache_dir", str(tmp_path / "model-cache"))
  monkeypatch.setattr(worker_module.settings, "job_artifact_dir", str(tmp_path / "jobs"))
  monkeypatch.setattr(worker_module.settings, "runtime_mode", "dev")
  monkeypatch.setattr(worker_module.settings, "extract_stage_batch_size", 1000)
  monkeypatch.setattr(worker_module.settings, "enable_dev_fallbacks", True)
  monkeypatch.setattr(worker_module.settings, "enable_demo_seed", False)
  monkeypatch.setattr(worker_module.settings, "bootstrap_default_account", False)
  initialize_database(worker_module.settings.sqlite_path)
  return worker_module.Worker()


def make_parsed_payload(source_path: Path, text: str) -> dict:
  return {
    "title": source_path.stem,
    "file_type": source_path.suffix.lower().lstrip(".") or "txt",
    "pages": [{"number": 1, "text": text, "metadata": {"extraction_mode": "native_text", "ocr_confidence": 1.0}}],
    "warnings": [],
    "text": text,
    "language": "en",
    "metadata": {},
  }


def test_run_once_prioritizes_auguste_and_limits_to_one_active_job(monkeypatch, tmp_path):
  worker = build_test_worker(monkeypatch, tmp_path)
  auguste_root = tmp_path / "THE AUGUSTE LAURENT SOCIETY"
  ufcop_root = tmp_path / "UFCOP"
  auguste_root.mkdir(parents=True)
  ufcop_root.mkdir(parents=True)
  (auguste_root / "auguste.txt").write_text("auguste", encoding="utf-8")
  (ufcop_root / "ufcop.txt").write_text("ufcop", encoding="utf-8")

  monkeypatch.setattr(worker, "_sync_watch_folders", lambda connection: 0)
  monkeypatch.setattr(worker_module.settings, "priority_import_roots", str(auguste_root))
  monkeypatch.setattr(worker_module.settings, "max_active_import_jobs", 1)

  processed_jobs: list[str] = []

  def fake_process_job(connection, job):
    processed_jobs.append(job["source_path"])
    return True

  monkeypatch.setattr(worker, "_process_job", fake_process_job)

  with database_session(worker_module.settings.sqlite_path) as connection:
    auguste_job = repository.create_import_job(
      connection,
      kind="manual_import",
      source_path=str(auguste_root),
      created_by=None,
      options={"recursive": True},
    )
    ufcop_job = repository.create_import_job(
      connection,
      kind="manual_import",
      source_path=str(ufcop_root),
      created_by=None,
      options={"recursive": True},
    )
    repository.update_import_job(connection, auguste_job["id"], status="queued", current_stage="extract")
    repository.update_import_job(connection, ufcop_job["id"], status="running", current_stage="structure")

  worker.run_once()

  assert processed_jobs == [str(auguste_root)]


def test_extract_stage_preserves_progress_and_defers_aes_pdfs(monkeypatch, tmp_path):
  worker = build_test_worker(monkeypatch, tmp_path)
  source_dir = tmp_path / "incoming"
  source_dir.mkdir(parents=True)
  good_file = source_dir / "good.txt"
  pdf_file = source_dir / "locked.pdf"
  good_file.write_text("valid import text", encoding="utf-8")
  pdf_file.write_bytes(b"%PDF-1.4")

  def fake_extract_document_with_timeout(source_path: Path, ocr_provider, include_ocr: bool = False, timeout_seconds=None):
    if source_path.suffix.lower() == ".txt":
      return make_parsed_payload(source_path, "valid import text")
    if source_path.suffix.lower() == ".pdf" and not include_ocr:
      raise ServiceDependencyError(
        code="pdf_crypto_dependency_missing",
        message="AES-encrypted PDF import requires the 'cryptography' package for native text extraction.",
        missing_services=["cryptography"],
      )
    raise AssertionError(f"Unexpected source path: {source_path}")

  monkeypatch.setattr(worker_module, "extract_document_with_timeout", fake_extract_document_with_timeout)
  monkeypatch.setattr(worker.engine.ocr_provider, "get_pdf_page_count", lambda source_path: 5)

  with database_session(worker_module.settings.sqlite_path) as connection:
    job = repository.create_import_job(
      connection,
      kind="manual_import",
      source_path=str(source_dir),
      created_by=None,
      options={"recursive": True},
    )

    assert worker._process_job(connection, job) is True
    discovered_job = repository.get_import_job(connection, job["id"])
    assert discovered_job is not None
    assert worker._process_job(connection, discovered_job) is True

    job_after_extract = repository.get_import_job(connection, job["id"])
    assert job_after_extract is not None
    assert job_after_extract["status"] == "running"
    assert job_after_extract["current_stage"] == "ocr"

    state = repository.json_loads(job_after_extract.get("state_json"), {})
    assert state["file_counts"] == {
      "discovered": 2,
      "processed": 2,
      "succeeded": 1,
      "failed": 0,
      "deferred_to_ocr": 1,
    }
    assert state["current_item_name"] == "locked.pdf"
    assert state["current_item_index"] == 2
    assert state["current_item_total"] == 2
    assert state["resumable"] is True
    assert state["extract"]["deferred_to_ocr_count"] == 1
    assert state["extract"]["failed_files"] == []

    artifacts = [json.loads(Path(path).read_text(encoding="utf-8")) for path in state["extracted_artifacts"]]
    assert len(artifacts) == 2
    assert any(item["deferred_to_ocr"] is True for item in artifacts)

    tasks = repository.list_pipeline_tasks(connection, [job["id"]])
    extract_task = next(task for task in tasks if task["stage"] == "extract")
    extract_payload = repository.json_loads(extract_task.get("payload_json"), {})
    assert extract_task["status"] == "completed"
    assert int(extract_task["progress_completed"]) == 2
    assert int(extract_task["progress_total"]) == 2
    assert extract_payload["processed"] == 2
    assert extract_payload["succeeded"] == 1
    assert extract_payload["failed"] == 0
    assert extract_payload["deferred_to_ocr"] == 1
    assert extract_payload["sample_failures"] == []
    assert extract_payload["manifest_path"] is None
    assert extract_payload["current_item_name"] == "locked.pdf"
    assert extract_payload["current_item_path"] == str(pdf_file)
    assert extract_payload["current_item_index"] == 2
    assert extract_payload["current_item_total"] == 2
    assert extract_payload["stage_started_at"] == state["stage_started_at"]
    assert extract_payload["last_progress_at"] == state["last_progress_at"]
    assert extract_payload["recovered_after_restart"] is False


def test_extract_stage_handles_pdfium_security_probe_failure_without_collapsing_stage(monkeypatch, tmp_path):
  worker = build_test_worker(monkeypatch, tmp_path)
  source_dir = tmp_path / "incoming"
  source_dir.mkdir(parents=True)
  pdf_file = source_dir / "locked.pdf"
  pdf_file.write_bytes(b"%PDF-1.4 locked")

  def fake_extract_document_with_timeout(source_path: Path, ocr_provider, include_ocr: bool = False, timeout_seconds=None):
    raise ServiceDependencyError(
      code="pdf_crypto_dependency_missing",
      message="Failed to load document (PDFium: Unsupported security scheme error).",
      missing_services=["cryptography"],
    )

  monkeypatch.setattr(worker_module, "extract_document_with_timeout", fake_extract_document_with_timeout)
  monkeypatch.setattr(
    worker.engine.ocr_provider,
    "get_pdf_page_count",
    lambda source_path: (_ for _ in ()).throw(RuntimeError("Failed to load document (PDFium: Unsupported security scheme error).")),
  )

  with database_session(worker_module.settings.sqlite_path) as connection:
    job = repository.create_import_job(
      connection,
      kind="manual_import",
      source_path=str(source_dir),
      created_by=None,
      options={"recursive": True},
    )

    assert worker._process_job(connection, job) is True
    discovered_job = repository.get_import_job(connection, job["id"])
    assert discovered_job is not None
    assert worker._process_job(connection, discovered_job) is True

    job_after_extract = repository.get_import_job(connection, job["id"])
    assert job_after_extract is not None
    assert job_after_extract["status"] == "failed"
    assert job_after_extract["current_stage"] == "extract"
    state = repository.json_loads(job_after_extract.get("state_json"), {})
    assert state["extract"]["failed_files"][0]["code"] == "pdf_crypto_dependency_missing"
    assert "Unsupported security scheme" in state["extract"]["failed_files"][0]["message"]


def test_extract_stage_defers_pdf_with_unsupported_encryption_handler_to_ocr(monkeypatch, tmp_path):
  worker = build_test_worker(monkeypatch, tmp_path)
  source_dir = tmp_path / "incoming"
  source_dir.mkdir(parents=True)
  pdf_file = source_dir / "locked.pdf"
  pdf_file.write_bytes(b"%PDF-1.4 protected")

  def fake_extract_document_with_timeout(source_path: Path, ocr_provider, include_ocr: bool = False, timeout_seconds=None):
    raise RuntimeError("Unable to open PDF locked.pdf: only Standard PDF encryption handler is available")

  monkeypatch.setattr(worker_module, "extract_document_with_timeout", fake_extract_document_with_timeout)
  monkeypatch.setattr(worker.engine.ocr_provider, "get_pdf_page_count", lambda source_path: 12)

  with database_session(worker_module.settings.sqlite_path) as connection:
    job = repository.create_import_job(
      connection,
      kind="manual_import",
      source_path=str(source_dir),
      created_by=None,
      options={"recursive": True},
    )

    assert worker._process_job(connection, job) is True
    discovered_job = repository.get_import_job(connection, job["id"])
    assert discovered_job is not None
    assert worker._process_job(connection, discovered_job) is True

    job_after_extract = repository.get_import_job(connection, job["id"])
    assert job_after_extract is not None
    assert job_after_extract["status"] == "running"
    assert job_after_extract["current_stage"] == "ocr"

    state = repository.json_loads(job_after_extract.get("state_json"), {})
    assert state["file_counts"] == {
      "discovered": 1,
      "processed": 1,
      "succeeded": 0,
      "failed": 0,
      "deferred_to_ocr": 1,
    }
    artifacts = [json.loads(Path(path).read_text(encoding="utf-8")) for path in state["extracted_artifacts"]]
    assert artifacts[0]["deferred_to_ocr"] is True
    assert artifacts[0]["extract_error_code"] == "pdf_encryption_unsupported"
    assert state["extract"]["failed_files"] == []

    tasks = repository.list_pipeline_tasks(connection, [job["id"]])
    extract_task = next(task for task in tasks if task["stage"] == "extract")
    extract_payload = repository.json_loads(extract_task.get("payload_json"), {})
    assert extract_task["status"] == "completed"
    assert extract_payload["deferred_to_ocr"] == 1
    assert extract_payload["failed"] == 0
    assert extract_payload["sample_failures"] == []


def test_extract_stage_defers_pdf_with_unsupported_encryption_even_if_page_probe_fails(monkeypatch, tmp_path):
  worker = build_test_worker(monkeypatch, tmp_path)
  source_dir = tmp_path / "incoming"
  source_dir.mkdir(parents=True)
  pdf_file = source_dir / "locked-probe.pdf"
  pdf_file.write_bytes(b"%PDF-1.4 protected")

  def fake_extract_document_with_timeout(source_path: Path, ocr_provider, include_ocr: bool = False, timeout_seconds=None):
    raise RuntimeError("Unable to open PDF locked-probe.pdf: only Standard PDF encryption handler is available")

  monkeypatch.setattr(worker_module, "extract_document_with_timeout", fake_extract_document_with_timeout)
  monkeypatch.setattr(worker.engine.ocr_provider, "get_pdf_page_count", lambda source_path: (_ for _ in ()).throw(RuntimeError("probe failed")))

  with database_session(worker_module.settings.sqlite_path) as connection:
    job = repository.create_import_job(
      connection,
      kind="manual_import",
      source_path=str(source_dir),
      created_by=None,
      options={"recursive": True},
    )

    assert worker._process_job(connection, job) is True
    discovered_job = repository.get_import_job(connection, job["id"])
    assert discovered_job is not None
    assert worker._process_job(connection, discovered_job) is True

    job_after_extract = repository.get_import_job(connection, job["id"])
    assert job_after_extract is not None
    assert job_after_extract["status"] == "running"
    assert job_after_extract["current_stage"] == "ocr"

    state = repository.json_loads(job_after_extract.get("state_json"), {})
    assert state["file_counts"]["deferred_to_ocr"] == 1
    assert state["file_counts"]["failed"] == 0
    assert state["extract"]["failed_files"] == []


def test_extract_stage_fails_only_after_all_files_fail(monkeypatch, tmp_path):
  worker = build_test_worker(monkeypatch, tmp_path)
  source_dir = tmp_path / "broken"
  source_dir.mkdir(parents=True)
  text_file = source_dir / "bad.txt"
  pdf_file = source_dir / "locked.pdf"
  text_file.write_text("broken text", encoding="utf-8")
  pdf_file.write_bytes(b"%PDF-1.4")

  def fake_extract_document_with_timeout(source_path: Path, ocr_provider, include_ocr: bool = False, timeout_seconds=None):
    if source_path.suffix.lower() == ".pdf":
      raise ServiceDependencyError(
        code="pdf_crypto_dependency_missing",
        message="AES-encrypted PDF import requires the 'cryptography' package for native text extraction.",
        missing_services=["cryptography"],
      )
    raise RuntimeError("Plain-text extraction failed.")

  monkeypatch.setattr(worker_module, "extract_document_with_timeout", fake_extract_document_with_timeout)
  monkeypatch.setattr(worker.engine.ocr_provider, "get_pdf_page_count", lambda source_path: None)

  with database_session(worker_module.settings.sqlite_path) as connection:
    job = repository.create_import_job(
      connection,
      kind="manual_import",
      source_path=str(source_dir),
      created_by=None,
      options={"recursive": True},
    )

    assert worker._process_job(connection, job) is True
    discovered_job = repository.get_import_job(connection, job["id"])
    assert discovered_job is not None
    assert worker._process_job(connection, discovered_job) is True

    job_after_extract = repository.get_import_job(connection, job["id"])
    assert job_after_extract is not None
    assert job_after_extract["status"] == "failed"
    assert job_after_extract["current_stage"] == "extract"
    assert job_after_extract["error_code"] == "extract_all_files_failed"
    assert job_after_extract["error_text"] == "All 2 discovered files failed during extract."

    state = repository.json_loads(job_after_extract.get("state_json"), {})
    assert state["file_counts"] == {
      "discovered": 2,
      "processed": 2,
      "succeeded": 0,
      "failed": 2,
      "deferred_to_ocr": 0,
    }
    assert len(state["extract"]["failed_files"]) == 2
    assert any(item["code"] == "pdf_crypto_dependency_missing" for item in state["extract"]["failed_files"])
    assert any(item["code"] == "extract_file_failed" for item in state["extract"]["failed_files"])
    manifest_path = state["extract"]["manifest_path"]
    assert manifest_path
    assert Path(manifest_path).exists()

    tasks = repository.list_pipeline_tasks(connection, [job["id"]])
    extract_task = next(task for task in tasks if task["stage"] == "extract")
    extract_payload = repository.json_loads(extract_task.get("payload_json"), {})
    assert extract_task["status"] == "failed"
    assert int(extract_task["progress_completed"]) == 2
    assert int(extract_task["progress_total"]) == 2
    assert extract_payload["failed"] == 2
    assert extract_payload["sample_failures"][0]["code"] in {"extract_file_failed", "pdf_crypto_dependency_missing"}


def test_extract_stage_marks_disappeared_source_as_missing_and_continues(monkeypatch, tmp_path):
  worker = build_test_worker(monkeypatch, tmp_path)
  source_dir = tmp_path / "incoming"
  source_dir.mkdir(parents=True)
  good_file = source_dir / "good.txt"
  missing_file = source_dir / "missing.pdf"
  good_file.write_text("valid import text", encoding="utf-8")
  missing_file.write_bytes(b"%PDF-1.4")

  def fake_extract_document(source_path: Path, ocr_provider, include_ocr: bool = True):
    if source_path == good_file:
      return make_parsed_payload(source_path, "valid import text")
    raise AssertionError(f"Missing file should not be opened by extractor: {source_path}")

  monkeypatch.setattr(worker_module, "extract_document", fake_extract_document)

  with database_session(worker_module.settings.sqlite_path) as connection:
    job = repository.create_import_job(
      connection,
      kind="manual_import",
      source_path=str(source_dir),
      created_by=None,
      options={"recursive": True},
    )

    assert worker._process_job(connection, job) is True
    missing_file.unlink()

    discovered_job = repository.get_import_job(connection, job["id"])
    assert discovered_job is not None
    assert worker._process_job(connection, discovered_job) is True

    job_after_extract = repository.get_import_job(connection, job["id"])
    assert job_after_extract is not None
    assert job_after_extract["status"] == "running"
    assert job_after_extract["current_stage"] == "ocr"

    state = repository.json_loads(job_after_extract.get("state_json"), {})
    assert state["file_counts"] == {
      "discovered": 2,
      "processed": 2,
      "succeeded": 1,
      "failed": 1,
      "deferred_to_ocr": 0,
    }
    assert len(state["extract"]["failed_files"]) == 1
    assert state["extract"]["failed_files"][0]["code"] == "extract_file_missing"
    assert "disappeared or became inaccessible" in state["extract"]["failed_files"][0]["message"]

    tasks = repository.list_pipeline_tasks(connection, [job["id"]])
    extract_task = next(task for task in tasks if task["stage"] == "extract")
    extract_payload = repository.json_loads(extract_task.get("payload_json"), {})
    assert extract_task["status"] == "completed"
    assert int(extract_task["progress_completed"]) == 2
    assert int(extract_task["progress_total"]) == 2
    assert extract_payload["failed"] == 1
    assert extract_payload["sample_failures"][0]["code"] == "extract_file_missing"


def test_extract_stage_auto_recovers_prior_charmap_failure(monkeypatch, tmp_path):
  worker = build_test_worker(monkeypatch, tmp_path)
  source_dir = tmp_path / "incoming"
  source_dir.mkdir(parents=True)
  source_file = source_dir / "unicode.pdf"
  source_file.write_bytes(b"%PDF-1.4")

  monkeypatch.setattr(
    worker_module,
    "extract_document_with_timeout",
    lambda source_path, ocr_provider, include_ocr=False, timeout_seconds=None: make_parsed_payload(source_path, "recovered text"),
  )

  with database_session(worker_module.settings.sqlite_path) as connection:
    job = repository.create_import_job(
      connection,
      kind="manual_import",
      source_path=str(source_dir),
      created_by=None,
      options={"recursive": True},
    )
    repository.update_import_job(
      connection,
      job["id"],
      status="running",
      current_stage="extract",
      progress_completed=1,
      progress_total=1,
      state_json={
        "sources": [str(source_file)],
        "resumable": True,
        "current_stage": "extract",
        "current_item_name": source_file.name,
        "current_item_path": str(source_file),
        "current_item_index": 1,
        "current_item_total": 1,
        "file_counts": {
          "discovered": 1,
          "processed": 1,
          "succeeded": 0,
          "failed": 1,
          "deferred_to_ocr": 0,
        },
        "extract": {
          "discovered_count": 1,
          "processed_count": 1,
          "success_count": 0,
          "failed_count": 1,
          "deferred_to_ocr_count": 0,
          "failed_files": [
            {
              "path": str(source_file),
              "stage": "extract",
              "code": "extract_file_failed",
              "message": "'charmap' codec can't encode character '\\u0394' in position 10: character maps to <undefined>",
            }
          ],
          "sample_failures": [],
          "manifest_path": None,
        },
      },
    )
    tasks = repository.get_or_create_pipeline_tasks(connection, job["id"], worker.engine.PIPELINE_STAGES)
    discover_task = next(task for task in tasks if task["stage"] == "discover")
    repository.update_pipeline_task(
      connection,
      discover_task["id"],
      status="completed",
      progress_completed=1,
      progress_total=1,
    )
    extract_task = next(task for task in tasks if task["stage"] == "extract")
    repository.update_pipeline_task(
      connection,
      extract_task["id"],
      status="running",
      progress_completed=1,
      progress_total=1,
      payload_json={
        "current_item_name": source_file.name,
        "current_item_path": str(source_file),
        "current_item_index": 1,
        "current_item_total": 1,
      },
    )

    running_job = repository.get_import_job(connection, job["id"])
    assert running_job is not None
    assert worker._process_job(connection, running_job) is True

    job_after_extract = repository.get_import_job(connection, job["id"])
    assert job_after_extract is not None
    assert job_after_extract["status"] == "running"
    assert job_after_extract["current_stage"] in {"extract", "ocr"}

    state = repository.json_loads(job_after_extract.get("state_json"), {})
    assert state["file_counts"] == {
      "discovered": 1,
      "processed": 1,
      "succeeded": 1,
      "failed": 0,
      "deferred_to_ocr": 0,
    }
    assert state["extract"]["failed_files"] == []
    assert state["extract"]["manifest_path"] is None
    assert len(state["extracted_artifacts"]) == 1
    artifact = json.loads(Path(state["extracted_artifacts"][0]).read_text(encoding="utf-8"))
    assert artifact["parsed"]["text"] == "recovered text"

    tasks = repository.list_pipeline_tasks(connection, [job["id"]])
    extract_task = next(task for task in tasks if task["stage"] == "extract")
    extract_payload = repository.json_loads(extract_task.get("payload_json"), {})
    assert extract_task["status"] == "completed"
    assert extract_payload["failed"] == 0
    assert extract_payload["succeeded"] == 1
    assert extract_payload["sample_failures"] == []

    if job_after_extract["current_stage"] != "ocr":
      resumed_job = repository.get_import_job(connection, job["id"])
      assert resumed_job is not None
      assert worker._process_job(connection, resumed_job) is True
      final_job = repository.get_import_job(connection, job["id"])
      assert final_job is not None
      assert final_job["current_stage"] == "ocr"


def test_extract_stage_auto_recovers_prior_transient_import_failure(monkeypatch, tmp_path):
  worker = build_test_worker(monkeypatch, tmp_path)
  source_dir = tmp_path / "incoming"
  source_dir.mkdir(parents=True)
  source_file = source_dir / "runtime.pdf"
  source_file.write_bytes(b"%PDF-1.4")

  monkeypatch.setattr(
    worker_module,
    "extract_document_with_timeout",
    lambda source_path, ocr_provider, include_ocr=False, timeout_seconds=None: make_parsed_payload(source_path, "runtime recovered"),
  )

  with database_session(worker_module.settings.sqlite_path) as connection:
    job = repository.create_import_job(
      connection,
      kind="manual_import",
      source_path=str(source_dir),
      created_by=None,
      options={"recursive": True},
    )
    repository.update_import_job(
      connection,
      job["id"],
      status="running",
      current_stage="extract",
      progress_completed=1,
      progress_total=1,
      state_json={
        "sources": [str(source_file)],
        "resumable": True,
        "current_stage": "extract",
        "current_item_name": source_file.name,
        "current_item_path": str(source_file),
        "current_item_index": 1,
        "current_item_total": 1,
        "file_counts": {
          "discovered": 1,
          "processed": 1,
          "succeeded": 0,
          "failed": 1,
          "deferred_to_ocr": 0,
        },
        "extract": {
          "discovered_count": 1,
          "processed_count": 1,
          "success_count": 0,
          "failed_count": 1,
          "deferred_to_ocr_count": 0,
          "failed_files": [
            {
              "path": str(source_file),
              "stage": "extract",
              "code": "extract_file_failed",
              "message": "ImportError: cannot import name 'build_math_provider' from 'app.math_runtime'",
            }
          ],
          "sample_failures": [],
          "manifest_path": None,
        },
      },
    )
    tasks = repository.get_or_create_pipeline_tasks(connection, job["id"], worker.engine.PIPELINE_STAGES)
    discover_task = next(task for task in tasks if task["stage"] == "discover")
    repository.update_pipeline_task(
      connection,
      discover_task["id"],
      status="completed",
      progress_completed=1,
      progress_total=1,
    )
    extract_task = next(task for task in tasks if task["stage"] == "extract")
    repository.update_pipeline_task(
      connection,
      extract_task["id"],
      status="running",
      progress_completed=1,
      progress_total=1,
      payload_json={
        "current_item_name": source_file.name,
        "current_item_path": str(source_file),
        "current_item_index": 1,
        "current_item_total": 1,
      },
    )

    running_job = repository.get_import_job(connection, job["id"])
    assert running_job is not None
    assert worker._process_job(connection, running_job) is True

    job_after_extract = repository.get_import_job(connection, job["id"])
    assert job_after_extract is not None
    state = repository.json_loads(job_after_extract.get("state_json"), {})
    assert state["extract"]["failed_files"] == []
    assert state["file_counts"]["failed"] == 0
    assert state["file_counts"]["succeeded"] == 1


def test_extract_stage_recovers_legacy_math_regex_runtime_failure(monkeypatch, tmp_path):
  worker = build_test_worker(monkeypatch, tmp_path)
  source_dir = tmp_path / "incoming"
  source_dir.mkdir(parents=True)
  source_file = source_dir / "legacy-math-regex.pdf"
  source_file.write_bytes(b"%PDF-1.4 legacy math regex")

  def fake_extract_document(source_path, ocr_provider, include_ocr=False, timeout_seconds=None):
    return make_parsed_payload(source_path, "legacy regex recovered")

  monkeypatch.setattr(worker_module, "extract_document_with_timeout", fake_extract_document)

  with database_session(worker_module.settings.sqlite_path) as connection:
    job = repository.create_import_job(
      connection,
      kind="manual_import",
      source_path=str(source_dir),
      created_by=None,
      options={"recursive": True},
    )
    repository.update_import_job(
      connection,
      job["id"],
      status="running",
      current_stage="extract",
      progress_completed=1,
      progress_total=1,
      state_json={
        "sources": [str(source_file)],
        "resumable": True,
        "current_stage": "extract",
        "current_item_name": source_file.name,
        "current_item_path": str(source_file),
        "current_item_index": 1,
        "current_item_total": 1,
        "file_counts": {
          "discovered": 1,
          "processed": 1,
          "succeeded": 0,
          "failed": 1,
          "deferred_to_ocr": 0,
        },
        "extract": {
          "discovered_count": 1,
          "processed_count": 1,
          "success_count": 0,
          "failed_count": 1,
          "deferred_to_ocr_count": 0,
          "failed_files": [
            {
              "path": str(source_file),
              "stage": "extract",
              "code": "extract_file_failed",
              "message": "Traceback ... re.error: nothing to repeat at position 0",
            }
          ],
          "sample_failures": [],
          "manifest_path": None,
        },
      },
    )
    tasks = repository.get_or_create_pipeline_tasks(connection, job["id"], worker.engine.PIPELINE_STAGES)
    discover_task = next(task for task in tasks if task["stage"] == "discover")
    repository.update_pipeline_task(
      connection,
      discover_task["id"],
      status="completed",
      progress_completed=1,
      progress_total=1,
    )
    extract_task = next(task for task in tasks if task["stage"] == "extract")
    repository.update_pipeline_task(
      connection,
      extract_task["id"],
      status="running",
      progress_completed=1,
      progress_total=1,
      payload_json={
        "current_item_name": source_file.name,
        "current_item_path": str(source_file),
        "current_item_index": 1,
        "current_item_total": 1,
      },
    )

    running_job = repository.get_import_job(connection, job["id"])
    assert running_job is not None
    assert worker._process_job(connection, running_job) is True

    job_after_extract = repository.get_import_job(connection, job["id"])
    assert job_after_extract is not None
    state = repository.json_loads(job_after_extract.get("state_json"), {})
    assert state["extract"]["failed_files"] == []
    assert state["file_counts"]["failed"] == 0
    assert state["file_counts"]["succeeded"] == 1


def test_extract_stage_retries_prior_timeout_once(monkeypatch, tmp_path):
  worker = build_test_worker(monkeypatch, tmp_path)
  source_dir = tmp_path / "incoming"
  source_dir.mkdir(parents=True)
  source_file = source_dir / "slow.pdf"
  source_file.write_bytes(b"%PDF-1.4")

  calls: list[float | None] = []

  def fake_extract_document_with_timeout(source_path, ocr_provider, include_ocr=False, timeout_seconds=None):
    calls.append(timeout_seconds)
    return make_parsed_payload(source_path, "slow recovered")

  monkeypatch.setattr(worker_module, "extract_document_with_timeout", fake_extract_document_with_timeout)

  with database_session(worker_module.settings.sqlite_path) as connection:
    job = repository.create_import_job(
      connection,
      kind="manual_import",
      source_path=str(source_dir),
      created_by=None,
      options={"recursive": True},
    )
    repository.update_import_job(
      connection,
      job["id"],
      status="running",
      current_stage="extract",
      progress_completed=1,
      progress_total=1,
      state_json={
        "sources": [str(source_file)],
        "resumable": True,
        "current_stage": "extract",
        "current_item_name": source_file.name,
        "current_item_path": str(source_file),
        "current_item_index": 1,
        "current_item_total": 1,
        "file_counts": {
          "discovered": 1,
          "processed": 1,
          "succeeded": 0,
          "failed": 1,
          "deferred_to_ocr": 0,
        },
        "extract": {
          "discovered_count": 1,
          "processed_count": 1,
          "success_count": 0,
          "failed_count": 1,
          "deferred_to_ocr_count": 0,
          "failed_files": [
            {
              "path": str(source_file),
              "stage": "extract",
              "code": "extract_file_timeout",
              "message": f"Timed out while extracting {source_file.name} after 45 seconds",
            }
          ],
          "sample_failures": [],
          "manifest_path": None,
        },
      },
    )
    tasks = repository.get_or_create_pipeline_tasks(connection, job["id"], worker.engine.PIPELINE_STAGES)
    discover_task = next(task for task in tasks if task["stage"] == "discover")
    repository.update_pipeline_task(
      connection,
      discover_task["id"],
      status="completed",
      progress_completed=1,
      progress_total=1,
    )
    extract_task = next(task for task in tasks if task["stage"] == "extract")
    repository.update_pipeline_task(
      connection,
      extract_task["id"],
      status="running",
      progress_completed=1,
      progress_total=1,
      payload_json={
        "current_item_name": source_file.name,
        "current_item_path": str(source_file),
        "current_item_index": 1,
        "current_item_total": 1,
      },
    )

    running_job = repository.get_import_job(connection, job["id"])
    assert running_job is not None
    assert worker._process_job(connection, running_job) is True

    job_after_extract = repository.get_import_job(connection, job["id"])
    assert job_after_extract is not None
    state = repository.json_loads(job_after_extract.get("state_json"), {})
    assert state["extract"]["failed_files"] == []
    assert state["file_counts"]["failed"] == 0
    assert state["file_counts"]["succeeded"] == 1
    assert calls == [90.0]


def test_extract_stage_timeout_gets_second_retry_when_adaptive_budget_increases(monkeypatch, tmp_path):
  worker = build_test_worker(monkeypatch, tmp_path)
  source_dir = tmp_path / "incoming"
  source_dir.mkdir(parents=True)
  source_file = source_dir / "large-timeout.pdf"
  source_file.write_bytes(b"%PDF-1.4" + (b"x" * (7 * 1024 * 1024)))

  calls: list[float | None] = []

  def fake_extract_document_with_timeout(source_path, ocr_provider, include_ocr=False, timeout_seconds=None):
    calls.append(timeout_seconds)
    return make_parsed_payload(source_path, "large recovered")

  monkeypatch.setattr(worker_module, "extract_document_with_timeout", fake_extract_document_with_timeout)
  monkeypatch.setattr(worker.engine.ocr_provider, "get_pdf_page_count", lambda source_path: 684)

  with database_session(worker_module.settings.sqlite_path) as connection:
    job = repository.create_import_job(
      connection,
      kind="manual_import",
      source_path=str(source_dir),
      created_by=None,
      options={"recursive": True},
    )
    repository.update_import_job(
      connection,
      job["id"],
      status="running",
      current_stage="extract",
      progress_completed=1,
      progress_total=1,
      state_json={
        "sources": [str(source_file)],
        "resumable": True,
        "current_stage": "extract",
        "current_item_name": source_file.name,
        "current_item_path": str(source_file),
        "current_item_index": 1,
        "current_item_total": 1,
        "extract_recovery_attempts": {
          f"extract_file_timeout::{source_file}": 1,
        },
        "file_counts": {
          "discovered": 1,
          "processed": 1,
          "succeeded": 0,
          "failed": 1,
          "deferred_to_ocr": 0,
        },
        "extract": {
          "discovered_count": 1,
          "processed_count": 1,
          "success_count": 0,
          "failed_count": 1,
          "deferred_to_ocr_count": 0,
          "failed_files": [
            {
              "path": str(source_file),
              "stage": "extract",
              "code": "extract_file_timeout",
              "message": f"Timed out while extracting {source_file.name} after 45 seconds",
              "timeout_seconds": 45.0,
            }
          ],
          "sample_failures": [],
          "manifest_path": None,
        },
      },
    )
    tasks = repository.get_or_create_pipeline_tasks(connection, job["id"], worker.engine.PIPELINE_STAGES)
    discover_task = next(task for task in tasks if task["stage"] == "discover")
    repository.update_pipeline_task(
      connection,
      discover_task["id"],
      status="completed",
      progress_completed=1,
      progress_total=1,
    )
    extract_task = next(task for task in tasks if task["stage"] == "extract")
    repository.update_pipeline_task(
      connection,
      extract_task["id"],
      status="running",
      progress_completed=1,
      progress_total=1,
      payload_json={
        "current_item_name": source_file.name,
        "current_item_path": str(source_file),
        "current_item_index": 1,
        "current_item_total": 1,
      },
    )

    running_job = repository.get_import_job(connection, job["id"])
    assert running_job is not None
    assert worker._process_job(connection, running_job) is True

    job_after_extract = repository.get_import_job(connection, job["id"])
    assert job_after_extract is not None
    state = repository.json_loads(job_after_extract.get("state_json"), {})
    assert state["extract"]["failed_files"] == []
    assert state["file_counts"]["failed"] == 0
    assert state["file_counts"]["succeeded"] == 1
    assert calls == [202.32]
    assert state.get("extract_recovery_attempts", {}) == {}


def test_extract_stage_limits_recovery_retries_per_pass(monkeypatch, tmp_path):
  worker = build_test_worker(monkeypatch, tmp_path)
  source_dir = tmp_path / "incoming"
  source_dir.mkdir(parents=True)
  first_file = source_dir / "first-timeout.pdf"
  second_file = source_dir / "second-timeout.pdf"
  first_file.write_bytes(b"%PDF-1.4")
  second_file.write_bytes(b"%PDF-1.4")

  calls: list[str] = []

  def fake_extract_document_with_timeout(source_path, ocr_provider, include_ocr=False, timeout_seconds=None):
    calls.append(source_path.name)
    return make_parsed_payload(source_path, f"recovered {source_path.name}")

  monkeypatch.setattr(worker_module, "extract_document_with_timeout", fake_extract_document_with_timeout)
  monkeypatch.setattr(worker_module.settings, "extract_failure_recovery_batch_size", 1)

  with database_session(worker_module.settings.sqlite_path) as connection:
    job = repository.create_import_job(
      connection,
      kind="manual_import",
      source_path=str(source_dir),
      created_by=None,
      options={"recursive": True},
    )
    repository.update_import_job(
      connection,
      job["id"],
      status="running",
      current_stage="extract",
      progress_completed=2,
      progress_total=2,
      state_json={
        "sources": [str(first_file), str(second_file)],
        "resumable": True,
        "current_stage": "extract",
        "current_item_name": second_file.name,
        "current_item_path": str(second_file),
        "current_item_index": 2,
        "current_item_total": 2,
        "file_counts": {
          "discovered": 2,
          "processed": 2,
          "succeeded": 0,
          "failed": 2,
          "deferred_to_ocr": 0,
        },
        "extract": {
          "discovered_count": 2,
          "processed_count": 2,
          "success_count": 0,
          "failed_count": 2,
          "deferred_to_ocr_count": 0,
          "failed_files": [
            {
              "path": str(first_file),
              "stage": "extract",
              "code": "extract_file_timeout",
              "message": f"Timed out while extracting {first_file.name} after 45 seconds",
              "timeout_seconds": 45.0,
            },
            {
              "path": str(second_file),
              "stage": "extract",
              "code": "extract_file_timeout",
              "message": f"Timed out while extracting {second_file.name} after 45 seconds",
              "timeout_seconds": 45.0,
            },
          ],
          "sample_failures": [],
          "manifest_path": None,
        },
      },
    )
    tasks = repository.get_or_create_pipeline_tasks(connection, job["id"], worker.engine.PIPELINE_STAGES)
    discover_task = next(task for task in tasks if task["stage"] == "discover")
    repository.update_pipeline_task(
      connection,
      discover_task["id"],
      status="completed",
      progress_completed=2,
      progress_total=2,
    )
    extract_task = next(task for task in tasks if task["stage"] == "extract")
    repository.update_pipeline_task(
      connection,
      extract_task["id"],
      status="running",
      progress_completed=2,
      progress_total=2,
      payload_json={
        "current_item_name": second_file.name,
        "current_item_path": str(second_file),
        "current_item_index": 2,
        "current_item_total": 2,
      },
    )

    running_job = repository.get_import_job(connection, job["id"])
    assert running_job is not None
    assert worker._process_job(connection, running_job) is True

    job_after_extract = repository.get_import_job(connection, job["id"])
    assert job_after_extract is not None
    state = repository.json_loads(job_after_extract.get("state_json"), {})
    assert calls == [first_file.name]
    assert state["file_counts"]["succeeded"] == 1
    assert state["file_counts"]["failed"] == 1
    assert len(state["extract"]["failed_files"]) == 1
    assert state["extract"]["failed_files"][0]["path"] == str(second_file)


def test_extract_stage_uses_adaptive_timeout_for_large_pdf(monkeypatch, tmp_path):
  worker = build_test_worker(monkeypatch, tmp_path)
  source_dir = tmp_path / "incoming"
  source_dir.mkdir(parents=True)
  source_file = source_dir / "large.pdf"
  source_file.write_bytes(b"%PDF-1.4" + (b"x" * (7 * 1024 * 1024)))

  calls: list[float | None] = []

  def fake_extract_document_with_timeout(source_path, ocr_provider, include_ocr=False, timeout_seconds=None):
    calls.append(timeout_seconds)
    return make_parsed_payload(source_path, "large recovered")

  monkeypatch.setattr(worker_module, "extract_document_with_timeout", fake_extract_document_with_timeout)
  monkeypatch.setattr(worker.engine.ocr_provider, "get_pdf_page_count", lambda source_path: 684)

  with database_session(worker_module.settings.sqlite_path) as connection:
    job = repository.create_import_job(
      connection,
      kind="manual_import",
      source_path=str(source_dir),
      created_by=None,
      options={"recursive": True},
    )
    assert worker._process_job(connection, job) is True
    discovered_job = repository.get_import_job(connection, job["id"])
    assert discovered_job is not None
    assert worker._process_job(connection, discovered_job) is True

    assert len(calls) == 1
    assert calls[0] == 202.32


def test_ocr_stage_persists_parallel_math_artifacts_with_context(monkeypatch, tmp_path):
  worker = build_test_worker(monkeypatch, tmp_path)
  source_dir = tmp_path / "incoming"
  source_dir.mkdir(parents=True)
  source_file = source_dir / "math.pdf"
  source_file.write_bytes(b"%PDF-1.4")

  monkeypatch.setattr(
    worker_module,
    "extract_document_with_timeout",
    lambda source_path, ocr_provider, include_ocr=False, timeout_seconds=None: make_parsed_payload(
      source_path,
      "The governing equation is Δω = γB0 and E = mc^2.",
    ),
  )
  monkeypatch.setattr(
    worker.engine,
    "extract_math_artifacts",
    lambda source_path, parsed, artifact_dir=None: {
      "pages_scanned": 1,
      "regions_detected": 1,
      "formula_count": 1,
      "formula_recognized": 1,
      "formula_pending": 0,
      "documents_with_math_artifacts": 1,
      "confidence_summary": {"average": 0.91, "max": 0.91},
      "artifacts": [
        {
          "id": "mathart-test",
          "page_number": 1,
          "source_ref": str(source_path),
          "raw_text": "Δω = γB0",
          "latex": r"\Delta \omega = \gamma B0",
          "confidence": 0.91,
          "provider_name": "heuristic_math",
          "model_name": "local-heuristic-v1",
          "extraction_mode": "native_math",
          "warnings": [],
          "validation_state": "recognized",
        }
      ],
      "regions": [
        {
          "id": "mathregion-test",
          "artifact_id": "mathart-test",
          "page_number": 1,
          "region_index": 1,
          "bbox": None,
          "image_path": None,
          "raw_text": "Δω = γB0",
          "confidence": 0.91,
          "status": "recognized",
          "warnings": [],
        }
      ],
      "formulae": [
        {
          "id": "mathformula-test",
          "artifact_id": "mathart-test",
          "region_id": "mathregion-test",
          "page_number": 1,
          "label": "Page 1 formula 1",
          "raw_text": "Δω = γB0",
          "latex": r"\Delta \omega = \gamma B0",
          "confidence": 0.91,
          "provider_name": "heuristic_math",
          "model_name": "local-heuristic-v1",
          "extraction_mode": "native_math",
          "validation_status": "recognized",
          "warnings": [],
        }
      ],
      "links": [
        {
          "id": "mathlink-test",
          "formula_id": "mathformula-test",
          "artifact_id": "mathart-test",
          "region_id": "mathregion-test",
          "link_type": "page",
          "payload": {"page_number": 1, "source_ref": str(source_path)},
        }
      ],
    },
  )
  monkeypatch.setattr(
    worker.engine,
    "prepare_document",
    lambda source_path, parsed, math=None, citations=None: {
      "source_path": source_path,
      "parsed": parsed,
      "document": {
        "id": "doc-test",
        "checksum": "checksum-test",
        "created_at": repository.utc_now(),
      },
      "nodes": [],
      "markdown": "# math\n\n$$\n\\Delta \\omega = \\gamma B0\n$$\n",
      "math": math or {},
      "citations": citations or {},
    },
  )

  with database_session(worker_module.settings.sqlite_path) as connection:
    job = repository.create_import_job(
      connection,
      kind="manual_import",
      source_path=str(source_dir),
      created_by=None,
      options={"recursive": True},
    )

    assert worker._process_job(connection, job) is True
    discovered_job = repository.get_import_job(connection, job["id"])
    assert discovered_job is not None
    assert worker._process_job(connection, discovered_job) is True
    after_extract = repository.get_import_job(connection, job["id"])
    assert after_extract is not None
    assert after_extract["current_stage"] == "ocr"

    assert worker._process_job(connection, after_extract) is True
    after_ocr = repository.get_import_job(connection, job["id"])
    assert after_ocr is not None
    assert after_ocr["current_stage"] == "structure"

    state = repository.json_loads(after_ocr.get("state_json"), {})
    assert state["math"]["formula_count"] == 1
    assert state["math"]["formula_recognized"] == 1
    assert state["math"]["integration_mode"] == "ocr_context"
    assert len(state["math_artifacts"]) == 1
    stored_math = json.loads(Path(state["math_artifacts"][0]).read_text(encoding="utf-8"))
    assert stored_math["math"]["formulae"][0]["latex"] == r"\Delta \omega = \gamma B0"

    tasks = repository.list_pipeline_tasks(connection, [job["id"]])
    ocr_task = next(task for task in tasks if task["stage"] == "ocr")
    ocr_payload = repository.json_loads(ocr_task.get("payload_json"), {})
    assert ocr_task["status"] == "completed"
    assert ocr_payload["math_integrated_with_ocr"] is True
    assert ocr_payload["math_formula_count"] == 1
    assert ocr_payload["math_formula_recognized"] == 1


def test_ocr_stage_records_file_failure_and_continues(monkeypatch, tmp_path):
  worker = build_test_worker(monkeypatch, tmp_path)
  source_dir = tmp_path / "incoming"
  source_dir.mkdir(parents=True)
  first_file = source_dir / "blank.pdf"
  second_file = source_dir / "good.pdf"
  first_file.write_bytes(b"%PDF-1.4 blank")
  second_file.write_bytes(b"%PDF-1.4 good")

  def fake_refresh(source_path, parsed, deferred_to_ocr=False):
    if source_path == first_file:
      raise RuntimeError("Paddle runtime crash")
    return {
      "parsed": make_parsed_payload(source_path, "ocr repaired"),
      "pages_ocrd": 1,
      "pages_improved": 1,
      "document_changed": True,
      "warnings": [],
    }

  monkeypatch.setattr(worker.engine, "refresh_document_ocr", fake_refresh)

  with database_session(worker_module.settings.sqlite_path) as connection:
    job = repository.create_import_job(
      connection,
      kind="manual_import",
      source_path=str(source_dir),
      created_by=None,
      options={"recursive": True},
    )
    artifact_one = worker._job_dir(job["id"]) / "extracted" / "0001.json"
    artifact_two = worker._job_dir(job["id"]) / "extracted" / "0002.json"
    worker._write_json(artifact_one, {"source_path": str(first_file), "parsed": make_parsed_payload(first_file, "")})
    worker._write_json(artifact_two, {"source_path": str(second_file), "parsed": make_parsed_payload(second_file, "")})
    repository.update_import_job(
      connection,
      job["id"],
      status="running",
      current_stage="ocr",
      progress_completed=3,
      progress_total=12,
      state_json={
        "sources": [str(first_file), str(second_file)],
        "resumable": True,
        "current_stage": "ocr",
        "extracted_artifacts": [str(artifact_one), str(artifact_two)],
      },
    )
    tasks = repository.get_or_create_pipeline_tasks(connection, job["id"], worker.engine.PIPELINE_STAGES)
    for task in tasks:
      if task["stage"] in {"discover", "extract"}:
        repository.update_pipeline_task(connection, task["id"], status="completed", progress_completed=2, progress_total=2)
    ocr_task = next(task for task in tasks if task["stage"] == "ocr")
    repository.update_pipeline_task(connection, ocr_task["id"], status="running", progress_completed=0, progress_total=2)

    running_job = repository.get_import_job(connection, job["id"])
    assert running_job is not None
    assert worker._process_job(connection, running_job) is True

    job_after_ocr = repository.get_import_job(connection, job["id"])
    assert job_after_ocr is not None
    assert job_after_ocr["status"] == "running"
    assert job_after_ocr["current_stage"] == "structure"
    state = repository.json_loads(job_after_ocr.get("state_json"), {})
    assert state["ocr"]["failed_count"] == 1
    assert state["ocr"]["failed_files"][0]["code"] == "ocr_file_failed"
    assert state["ocr"]["sample_failures"][0]["path"] == str(first_file)
    assert state["ocr"]["pages_ocrd"] == 1
    assert state["ocr"]["pages_improved"] == 1
    assert state["ocr"]["documents_touched"] == 1
    assert state["ocr"]["manifest_path"]
    assert Path(state["ocr"]["manifest_path"]).exists()

    tasks = repository.list_pipeline_tasks(connection, [job["id"]])
    ocr_task_after = next(task for task in tasks if task["stage"] == "ocr")
    ocr_payload = repository.json_loads(ocr_task_after.get("payload_json"), {})
    assert ocr_task_after["status"] == "completed"
    assert ocr_payload["ocr_failed"] == 1
    assert ocr_payload["pages_ocrd"] == 1
    assert ocr_payload["pages_improved"] == 1
    assert ocr_payload["documents_touched"] == 1


def test_ocr_stage_emits_running_progress_updates(monkeypatch, tmp_path):
  worker = build_test_worker(monkeypatch, tmp_path)
  source_dir = tmp_path / "incoming"
  source_dir.mkdir(parents=True)
  first_file = source_dir / "first.pdf"
  second_file = source_dir / "second.pdf"
  first_file.write_bytes(b"%PDF-1.4 first")
  second_file.write_bytes(b"%PDF-1.4 second")

  def fake_refresh(source_path, parsed, deferred_to_ocr=False):
    return {
      "parsed": make_parsed_payload(source_path, "ocr repaired"),
      "pages_ocrd": 1,
      "pages_improved": 1,
      "document_changed": True,
      "warnings": [],
    }

  monkeypatch.setattr(worker.engine, "refresh_document_ocr", fake_refresh)

  progress_calls: list[dict] = []
  original_update_running_ocr_progress = worker._update_running_ocr_progress

  def tracked_update_running_ocr_progress(*args, **kwargs):
    progress_calls.append({
      "processed": kwargs["processed"],
      "total": kwargs["total"],
      "pages_ocrd": kwargs["pages_ocrd"],
      "documents_touched": kwargs["documents_touched"],
    })
    return original_update_running_ocr_progress(*args, **kwargs)

  monkeypatch.setattr(worker, "_update_running_ocr_progress", tracked_update_running_ocr_progress)

  with database_session(worker_module.settings.sqlite_path) as connection:
    job = repository.create_import_job(
      connection,
      kind="manual_import",
      source_path=str(source_dir),
      created_by=None,
      options={"recursive": True},
    )
    artifact_one = worker._job_dir(job["id"]) / "extracted" / "0001.json"
    artifact_two = worker._job_dir(job["id"]) / "extracted" / "0002.json"
    worker._write_json(artifact_one, {"source_path": str(first_file), "parsed": make_parsed_payload(first_file, "")})
    worker._write_json(artifact_two, {"source_path": str(second_file), "parsed": make_parsed_payload(second_file, "")})
    repository.update_import_job(
      connection,
      job["id"],
      status="running",
      current_stage="ocr",
      progress_completed=3,
      progress_total=12,
      state_json={
        "sources": [str(first_file), str(second_file)],
        "resumable": True,
        "current_stage": "ocr",
        "extracted_artifacts": [str(artifact_one), str(artifact_two)],
      },
    )
    tasks = repository.get_or_create_pipeline_tasks(connection, job["id"], worker.engine.PIPELINE_STAGES)
    for task in tasks:
      if task["stage"] in {"discover", "extract"}:
        repository.update_pipeline_task(connection, task["id"], status="completed", progress_completed=2, progress_total=2)
    ocr_task = next(task for task in tasks if task["stage"] == "ocr")
    repository.update_pipeline_task(connection, ocr_task["id"], status="running", progress_completed=0, progress_total=2)

    running_job = repository.get_import_job(connection, job["id"])
    assert running_job is not None
    assert worker._process_job(connection, running_job) is True

    assert progress_calls
    assert progress_calls[-1]["processed"] == 2
    assert progress_calls[-1]["total"] == 2
    assert progress_calls[-1]["pages_ocrd"] == 2
    assert progress_calls[-1]["documents_touched"] == 2


def test_ocr_stage_short_circuits_incompatible_paddle_runtime(monkeypatch, tmp_path):
  worker = build_test_worker(monkeypatch, tmp_path)
  source_dir = tmp_path / "incoming"
  source_dir.mkdir(parents=True)
  first_file = source_dir / "first.pdf"
  second_file = source_dir / "second.pdf"
  first_file.write_bytes(b"%PDF-1.4 first")
  second_file.write_bytes(b"%PDF-1.4 second")

  calls: list[str] = []

  def fake_refresh(source_path, parsed, deferred_to_ocr=False):
    calls.append(source_path.name)
    raise RuntimeError("(Unimplemented) ConvertPirAttribute2RuntimeAttribute not support [pir::ArrayAttribute<pir::DoubleAttribute>]")

  monkeypatch.setattr(worker.engine, "refresh_document_ocr", fake_refresh)

  with database_session(worker_module.settings.sqlite_path) as connection:
    job = repository.create_import_job(
      connection,
      kind="manual_import",
      source_path=str(source_dir),
      created_by=None,
      options={"recursive": True},
    )
    artifact_one = worker._job_dir(job["id"]) / "extracted" / "0001.json"
    artifact_two = worker._job_dir(job["id"]) / "extracted" / "0002.json"
    worker._write_json(artifact_one, {"source_path": str(first_file), "parsed": make_parsed_payload(first_file, "")})
    worker._write_json(artifact_two, {"source_path": str(second_file), "parsed": make_parsed_payload(second_file, "")})
    repository.update_import_job(
      connection,
      job["id"],
      status="running",
      current_stage="ocr",
      progress_completed=3,
      progress_total=12,
      state_json={
        "sources": [str(first_file), str(second_file)],
        "resumable": True,
        "current_stage": "ocr",
        "extracted_artifacts": [str(artifact_one), str(artifact_two)],
      },
    )
    tasks = repository.get_or_create_pipeline_tasks(connection, job["id"], worker.engine.PIPELINE_STAGES)
    for task in tasks:
      if task["stage"] in {"discover", "extract"}:
        repository.update_pipeline_task(connection, task["id"], status="completed", progress_completed=2, progress_total=2)
    ocr_task = next(task for task in tasks if task["stage"] == "ocr")
    repository.update_pipeline_task(connection, ocr_task["id"], status="running", progress_completed=0, progress_total=2)

    running_job = repository.get_import_job(connection, job["id"])
    assert running_job is not None
    assert worker._process_job(connection, running_job) is True

    assert calls == [first_file.name]
    job_after_ocr = repository.get_import_job(connection, job["id"])
    assert job_after_ocr is not None
    assert job_after_ocr["status"] == "running"
    assert job_after_ocr["current_stage"] == "structure"
    state = repository.json_loads(job_after_ocr.get("state_json"), {})
    assert state["ocr"]["failed_count"] == 1
    assert state["ocr"]["failed_files"][0]["code"] == "ocr_runtime_incompatible"
    assert state["ocr"]["awaiting_refinement"] is True
    assert "PaddleOCR runtime is incompatible" in state["ocr"]["recommended_action"]
    assert "SEMANTIC_LIBRARY_REMOTE_OCR_URL" in state["ocr"]["recommended_action"]


def test_ocr_runtime_remediation_prefers_configured_remote_backend(monkeypatch, tmp_path):
  worker = build_test_worker(monkeypatch, tmp_path)
  monkeypatch.setattr(worker_module.settings, "remote_ocr_url", "https://ocr.example.test/v1/ocr")

  guidance = worker._ocr_runtime_remediation_summary()

  assert "https://ocr.example.test/v1/ocr" in guidance
  assert "SEMANTIC_LIBRARY_REMOTE_OCR_URL" not in guidance


def test_ocr_remote_unavailable_marks_pause_state(monkeypatch, tmp_path):
  worker = build_test_worker(monkeypatch, tmp_path)
  monkeypatch.setattr(worker_module.settings, "remote_ocr_url", "http://ocr.example.test:8001/v1/ocr")
  monkeypatch.setattr(worker_module.settings, "remote_only_ocr", True)
  source_dir = tmp_path / "incoming"
  source_dir.mkdir(parents=True)
  first_file = source_dir / "first.pdf"
  second_file = source_dir / "second.pdf"
  first_file.write_bytes(b"%PDF-1.4 first")
  second_file.write_bytes(b"%PDF-1.4 second")

  def fake_refresh_document_ocr(source_path: Path, parsed: dict, deferred_to_ocr: bool = False, progress_callback=None):
    raise RuntimeError("httpx.ConnectError: [Errno 111] Connection refused")

  monkeypatch.setattr(worker.engine, "refresh_document_ocr", fake_refresh_document_ocr)
  monkeypatch.setattr(worker.engine, "extract_math_artifacts", lambda source_path, parsed, artifact_dir=None: {
    "pages_scanned": 0,
    "regions_detected": 0,
    "formula_count": 0,
    "formula_recognized": 0,
    "formula_pending": 0,
    "documents_with_math_artifacts": 0,
    "confidence_summary": {"average": 0.0, "max": 0.0},
    "artifacts": [],
    "awaiting_refinement": False,
  })

  with database_session(worker_module.settings.sqlite_path) as connection:
    job = repository.create_import_job(
      connection,
      kind="manual_import",
      source_path=str(source_dir),
      created_by=None,
      options={"recursive": True},
    )
    artifact_one = worker._job_dir(job["id"]) / "extracted" / "0001.json"
    artifact_two = worker._job_dir(job["id"]) / "extracted" / "0002.json"
    worker._write_json(artifact_one, {"source_path": str(first_file), "parsed": make_parsed_payload(first_file, "")})
    worker._write_json(artifact_two, {"source_path": str(second_file), "parsed": make_parsed_payload(second_file, "")})
    repository.update_import_job(
      connection,
      job["id"],
      status="running",
      current_stage="ocr",
      state_json={
        "sources": [str(first_file), str(second_file)],
        "resumable": True,
        "current_stage": "ocr",
        "extracted_artifacts": [str(artifact_one), str(artifact_two)],
      },
    )
    tasks = repository.get_or_create_pipeline_tasks(connection, job["id"], worker.engine.PIPELINE_STAGES)
    for task in tasks:
      if task["stage"] in {"discover", "extract"}:
        repository.update_pipeline_task(connection, task["id"], status="completed", progress_completed=2, progress_total=2)
    ocr_task = next(task for task in tasks if task["stage"] == "ocr")
    repository.update_pipeline_task(connection, ocr_task["id"], status="running", progress_completed=0, progress_total=2)

    running_job = repository.get_import_job(connection, job["id"])
    assert running_job is not None
    assert worker._process_job(connection, running_job) is True

    job_after_ocr = repository.get_import_job(connection, job["id"])
    assert job_after_ocr is not None
    state = repository.json_loads(job_after_ocr.get("state_json"), {})
    assert state["ocr"]["failed_files"][0]["code"] == "ocr_remote_unavailable"
    assert state["ocr"]["awaiting_refinement"] is True
    assert state["ocr"]["pause_state"] == "paused"
    assert state["ocr"]["resume_ready"] is False
    assert state["ocr"]["queue_state"] == "paused_remote_unavailable"
    assert state["ocr"]["retry_completed"] == 0
    assert state["ocr"]["ocr_route"].startswith("remote_only:")
    assert "Remote OCR is temporarily unreachable" in state["ocr"]["recommended_action"]
    ocr_task_after = next(task for task in repository.list_pipeline_tasks(connection, [job["id"]]) if task["stage"] == "ocr")
    assert ocr_task_after["status"] == "queued"


def test_completed_ocr_stage_requeues_saved_failures_when_runtime_recovers(monkeypatch, tmp_path):
  worker = build_test_worker(monkeypatch, tmp_path)
  monkeypatch.setattr(worker_module.settings, "remote_ocr_url", "http://ocr.example.test:8001/v1/ocr")
  monkeypatch.setattr(worker_module.settings, "remote_only_ocr", True)
  source_dir = tmp_path / "incoming"
  source_dir.mkdir(parents=True)
  first_file = source_dir / "first.pdf"
  second_file = source_dir / "second.pdf"
  first_file.write_bytes(b"%PDF-1.4 first")
  second_file.write_bytes(b"%PDF-1.4 second")

  retried: list[str] = []

  def fake_refresh_document_ocr(source_path: Path, parsed: dict, deferred_to_ocr: bool = False, progress_callback=None):
    retried.append(source_path.name)
    parsed_copy = dict(parsed)
    parsed_copy["warnings"] = list(parsed.get("warnings") or [])
    return {
      "parsed": parsed_copy,
      "document_changed": False,
      "warnings": [],
      "pages_ocrd": 1,
      "pages_improved": 1,
    }

  monkeypatch.setattr(worker.engine, "refresh_document_ocr", fake_refresh_document_ocr)
  monkeypatch.setattr(worker.engine, "extract_math_artifacts", lambda source_path, parsed, artifact_dir=None: {
    "pages_scanned": 0,
    "regions_detected": 0,
    "formula_count": 0,
    "formula_recognized": 0,
    "formula_pending": 0,
    "documents_with_math_artifacts": 0,
    "confidence_summary": {"average": 0.0, "max": 0.0},
    "artifacts": [],
    "awaiting_refinement": False,
  })
  with database_session(worker_module.settings.sqlite_path) as connection:
    job = repository.create_import_job(
      connection,
      kind="manual_import",
      source_path=str(source_dir),
      created_by=None,
      options={"recursive": True},
    )
    artifact_one = worker._job_dir(job["id"]) / "extracted" / "0001.json"
    artifact_two = worker._job_dir(job["id"]) / "extracted" / "0002.json"
    worker._write_json(artifact_one, {"source_path": str(first_file), "parsed": make_parsed_payload(first_file, "")})
    worker._write_json(artifact_two, {"source_path": str(second_file), "parsed": make_parsed_payload(second_file, "")})
    repository.update_import_job(
      connection,
      job["id"],
      status="queued",
      current_stage="structure",
      state_json={
        "sources": [str(first_file), str(second_file)],
        "resumable": True,
        "current_stage": "structure",
        "extracted_artifacts": [str(artifact_one), str(artifact_two)],
        "ocr_artifacts": [str(artifact_one), str(artifact_two)],
        "ocr": {
          "awaiting_refinement": True,
          "pause_state": "resume_ready",
          "resume_ready": True,
          "pause_reason_code": "ocr_runtime_incompatible",
          "failed_count": 1,
          "failed_files": [{
            "path": str(second_file),
            "stage": "ocr",
            "code": "ocr_runtime_incompatible",
            "message": "old local OCR failure",
          }],
          "manifest_path": str(worker._job_dir(job["id"]) / "ocr-failures.json"),
        },
      },
    )
    tasks = repository.get_or_create_pipeline_tasks(connection, job["id"], worker.engine.PIPELINE_STAGES)
    for task in tasks:
      if task["stage"] in {"discover", "extract"}:
        repository.update_pipeline_task(connection, task["id"], status="completed", progress_completed=2, progress_total=2)
      elif task["stage"] == "ocr":
        repository.update_pipeline_task(
          connection,
          task["id"],
          status="completed",
          progress_completed=2,
          progress_total=2,
          payload_json={"awaiting_refinement": True, "recommended_action": "old local OCR guidance"},
        )
      elif task["stage"] == "structure":
        repository.update_pipeline_task(connection, task["id"], status="queued", progress_completed=3, progress_total=2)

    queued_job = repository.get_import_job(connection, job["id"])
    assert queued_job is not None
    assert worker._process_job(connection, queued_job) is True

    assert retried == [second_file.name]
    job_after = repository.get_import_job(connection, job["id"])
    assert job_after is not None
    assert job_after["current_stage"] == "structure"
    state = repository.json_loads(job_after.get("state_json"), {})
    assert state["ocr"]["failed_count"] == 0
    assert state["ocr"]["resume_ready"] is True
    assert state["ocr"]["pause_state"] == "ready"
    assert state["ocr"]["retry_target_count"] == 1
    assert state["ocr"]["retry_completed"] == 1
    assert state["ocr"]["queue_state"] == "completed"
    assert state["ocr"]["ocr_route"].startswith("remote_only:")
    refreshed_tasks = repository.list_pipeline_tasks(connection, [job["id"]])
    ocr_task = next(task for task in refreshed_tasks if task["stage"] == "ocr")
    assert ocr_task["status"] == "completed"
    assert ocr_task["progress_completed"] == 1
    assert ocr_task["progress_total"] == 1
    structure_task = next(task for task in refreshed_tasks if task["stage"] == "structure")
    assert structure_task["status"] == "queued"
    assert structure_task["progress_completed"] == 0


def test_sync_watch_folders_respects_scan_interval_and_reuses_active_job(monkeypatch, tmp_path):
  worker = build_test_worker(monkeypatch, tmp_path)
  watch_root = tmp_path / "watch"
  watch_root.mkdir(parents=True)
  source_file = watch_root / "new.txt"
  source_file.write_text("hello", encoding="utf-8")
  monkeypatch.setattr(worker_module.settings, "watch_folder_scan_interval_seconds", 300.0)

  with database_session(worker_module.settings.sqlite_path) as connection:
    folder = repository.create_watch_folder(connection, str(watch_root), True, None)
    repository.update_watch_folder(connection, folder["id"], last_scanned_at=repository.utc_now())
    assert worker._sync_watch_folders(connection) == 0

    repository.update_watch_folder(connection, folder["id"], last_scanned_at="2026-03-01T00:00:00+00:00")
    watched = repository.upsert_watched_file(
      connection,
      watch_folder_id=folder["id"],
      file_path=str(source_file),
      relative_path=source_file.name,
      size_bytes=1,
      modified_at="2026-03-01T00:00:00+00:00",
      checksum="old",
      last_import_job_id=None,
    )
    active_job = repository.create_import_job(
      connection,
      kind="watch_sync",
      source_path=str(source_file),
      created_by=None,
      options={"recursive": False, "watch_folder_id": folder["id"]},
    )
    repository.update_import_job(connection, active_job["id"], status="queued", current_stage="discover")

    created = worker._sync_watch_folders(connection)
    assert created == 0
    watched_after = next(item for item in repository.list_watched_files(connection, folder["id"]) if item["file_path"] == str(source_file))
    assert watched_after["last_import_job_id"] == active_job["id"]
    tracked = repository.get_tracked_file_by_path(connection, source_file)
    assert tracked is not None
    assert tracked["last_import_job_id"] == active_job["id"]
    assert tracked["overall_status"] == "pending_import"


def test_sync_watch_folders_baselines_first_scan_without_creating_jobs(monkeypatch, tmp_path):
  worker = build_test_worker(monkeypatch, tmp_path)
  watch_root = tmp_path / "watch-first-scan"
  watch_root.mkdir(parents=True)
  source_file = watch_root / "new.txt"
  source_file.write_text("hello", encoding="utf-8")
  monkeypatch.setattr(worker_module.settings, "watch_folder_scan_interval_seconds", 300.0)

  with database_session(worker_module.settings.sqlite_path) as connection:
    folder = repository.create_watch_folder(connection, str(watch_root), True, None)
    created = worker._sync_watch_folders(connection)
    assert created == 0
    watched = repository.list_watched_files(connection, folder["id"])
    assert len(watched) == 1
    assert watched[0]["file_path"] == str(source_file)
    assert watched[0]["last_import_job_id"] is None
    tracked = repository.get_tracked_file_by_path(connection, source_file)
    assert tracked is not None
    assert tracked["root_watch_folder_id"] == folder["id"]
    assert tracked["overall_status"] == "discovered"
    assert int(tracked["stale"] or 0) == 0
    queued_watch_jobs = [
      job for job in repository.list_import_jobs(connection)
      if job["kind"] == "watch_sync"
    ]
    assert queued_watch_jobs == []


def test_sync_watch_folders_marks_missing_tracked_file_stale(monkeypatch, tmp_path):
  worker = build_test_worker(monkeypatch, tmp_path)
  watch_root = tmp_path / "watch-stale"
  watch_root.mkdir(parents=True)
  source_file = watch_root / "gone.txt"
  source_file.write_text("hello", encoding="utf-8")

  with database_session(worker_module.settings.sqlite_path) as connection:
    folder = repository.create_watch_folder(connection, str(watch_root), True, None)
    assert worker._sync_watch_folders(connection) == 0
    source_file.unlink()
    repository.update_watch_folder(connection, folder["id"], last_scanned_at="2026-03-01T00:00:00+00:00")
    assert worker._sync_watch_folders(connection) == 0
    tracked = repository.get_tracked_file_by_path(connection, source_file)
    assert tracked is not None
    assert tracked["overall_status"] == "stale"
    assert int(tracked["stale"] or 0) == 1


def test_watch_event_add_modify_delete_detection(monkeypatch, tmp_path):
  worker = build_test_worker(monkeypatch, tmp_path)
  monkeypatch.setattr(worker_module.settings, "watch_folder_copy_settle_seconds", 0.0)
  watch_root = tmp_path / "watch-events"
  watch_root.mkdir(parents=True)
  source_file = watch_root / "evented.txt"

  with database_session(worker_module.settings.sqlite_path) as connection:
    folder = repository.create_watch_folder(
      connection,
      str(watch_root),
      True,
      None,
      include_extensions=["txt"],
      exclude_globs=["*.skip"],
    )

    source_file.write_text("hello", encoding="utf-8")
    worker._enqueue_watch_change(folder["id"], "added", str(source_file))
    created = worker._drain_watch_events(connection)
    assert created == 1
    tracked = repository.get_tracked_file_by_path(connection, source_file)
    assert tracked is not None
    assert tracked["overall_status"] == "pending_import"
    folder_after_add = repository.get_watch_folder(connection, folder["id"])
    assert folder_after_add is not None
    assert int(folder_after_add["files_added"] or 0) == 1

    source_file.write_text("hello again", encoding="utf-8")
    worker._enqueue_watch_change(folder["id"], "modified", str(source_file))
    created = worker._drain_watch_events(connection)
    assert created == 0
    folder_after_modify = repository.get_watch_folder(connection, folder["id"])
    assert folder_after_modify is not None
    assert int(folder_after_modify["files_changed"] or 0) == 1

    source_file.unlink()
    worker._enqueue_watch_change(folder["id"], "deleted", str(source_file))
    created = worker._drain_watch_events(connection)
    assert created == 0
    tracked_after_delete = repository.get_tracked_file_by_path(connection, source_file)
    assert tracked_after_delete is not None
    assert tracked_after_delete["overall_status"] == "stale"
    folder_after_delete = repository.get_watch_folder(connection, folder["id"])
    assert folder_after_delete is not None
    assert int(folder_after_delete["files_deleted"] or 0) == 1


def test_ensure_tasks_collapses_legacy_math_extract_stage(monkeypatch, tmp_path):
  worker = build_test_worker(monkeypatch, tmp_path)
  source_dir = tmp_path / "incoming"
  source_dir.mkdir(parents=True)
  source_file = source_dir / "legacy.pdf"
  source_file.write_bytes(b"%PDF-1.4 legacy")

  with database_session(worker_module.settings.sqlite_path) as connection:
    job = repository.create_import_job(
      connection,
      kind="manual_import",
      source_path=str(source_dir),
      created_by=None,
      options={"recursive": True},
    )
    artifact = worker._job_dir(job["id"]) / "extracted" / "0001.json"
    worker._write_json(artifact, {"source_path": str(source_file), "parsed": make_parsed_payload(source_file, "legacy text")})
    repository.update_import_job(
      connection,
      job["id"],
      status="running",
      current_stage="math_extract",
      state_json={
        "sources": [str(source_file)],
        "resumable": True,
        "current_stage": "math_extract",
        "extracted_artifacts": [str(artifact)],
      },
    )
    tasks = repository.get_or_create_pipeline_tasks(connection, job["id"], [
      "discover",
      "extract",
      "math_extract",
      "ocr",
      "structure",
      "chunk",
      "summarize",
      "embed",
      "index",
      "research_materialize",
      "technique_materialize",
      "complete",
    ])
    for task in tasks:
      if task["stage"] in {"discover", "extract"}:
        repository.update_pipeline_task(connection, task["id"], status="completed", progress_completed=1, progress_total=1)
      elif task["stage"] == "math_extract":
        repository.update_pipeline_task(connection, task["id"], status="queued")

    refreshed_job = repository.get_import_job(connection, job["id"])
    assert refreshed_job is not None
    normalized_tasks = worker._ensure_tasks(connection, refreshed_job)
    math_task = next(task for task in normalized_tasks if task["stage"] == "math_extract")
    ocr_task = next(task for task in normalized_tasks if task["stage"] == "ocr")
    assert math_task["status"] == "completed"
    assert ocr_task["status"] == "queued"

    updated_job = repository.get_import_job(connection, job["id"])
    assert updated_job is not None
    assert updated_job["current_stage"] == "ocr"
    state = repository.json_loads(updated_job.get("state_json"), {})
    assert state["current_stage"] == "ocr"
    assert state["math_integration"]["mode"] == "ocr_context"


def test_running_extract_updates_job_progress_without_legacy_math_stage(monkeypatch, tmp_path):
  worker = build_test_worker(monkeypatch, tmp_path)
  source_dir = tmp_path / "incoming"
  source_dir.mkdir(parents=True)
  source_file = source_dir / "sample.pdf"
  source_file.write_bytes(b"%PDF-1.4 sample")

  with database_session(worker_module.settings.sqlite_path) as connection:
    job = repository.create_import_job(
      connection,
      kind="manual_import",
      source_path=str(source_dir),
      created_by=None,
      options={"recursive": True},
    )
    repository.update_import_job(
      connection,
      job["id"],
      status="running",
      current_stage="extract",
      state_json={
        "sources": [str(source_file)],
        "resumable": True,
        "current_stage": "extract",
        "file_counts": {"discovered": 1, "processed": 0, "succeeded": 0, "failed": 0, "deferred_to_ocr": 0},
      },
    )
    tasks = repository.get_or_create_pipeline_tasks(connection, job["id"], [
      "discover",
      "extract",
      "math_extract",
      "ocr",
      "structure",
      "chunk",
      "summarize",
      "embed",
      "index",
      "research_materialize",
      "technique_materialize",
      "complete",
    ])
    for task in tasks:
      if task["stage"] == "discover":
        repository.update_pipeline_task(connection, task["id"], status="completed", progress_completed=1, progress_total=1)
      elif task["stage"] == "extract":
        repository.update_pipeline_task(connection, task["id"], status="running", progress_completed=0, progress_total=1)
      elif task["stage"] == "math_extract":
        repository.update_pipeline_task(connection, task["id"], status="completed", progress_completed=1, progress_total=1)

    state = repository.json_loads((repository.get_import_job(connection, job["id"]) or {}).get("state_json"), {})
    extract_task = next(task for task in repository.list_pipeline_tasks(connection, [job["id"]]) if task["stage"] == "extract")
    worker._update_running_extract_progress(
      connection,
      job["id"],
      extract_task["id"],
      state,
      [],
      processed=1,
      total=1,
      succeeded=1,
      failed=0,
      deferred_to_ocr=0,
      failed_files=[],
      manifest_path=None,
    )

    updated_job = repository.get_import_job(connection, job["id"])
    assert updated_job is not None
    assert updated_job["progress_completed"] == 1
    assert updated_job["progress_total"] == 11


def test_run_once_recovers_stale_running_job_and_deduplicates_same_source(monkeypatch, tmp_path):
  worker = build_test_worker(monkeypatch, tmp_path)
  source_dir = tmp_path / "incoming"
  source_dir.mkdir(parents=True)
  (source_dir / "sample.txt").write_text("resume me", encoding="utf-8")

  monkeypatch.setattr(worker, "_sync_watch_folders", lambda connection: 0)
  monkeypatch.setattr(worker, "_process_job", lambda connection, job: False)

  with database_session(worker_module.settings.sqlite_path) as connection:
    running_job = repository.create_import_job(
      connection,
      kind="manual_import",
      source_path=str(source_dir),
      created_by=None,
      options={"recursive": True},
    )
    duplicate_job = repository.create_import_job(
      connection,
      kind="manual_import",
      source_path=str(source_dir),
      created_by=None,
      options={"recursive": True},
    )
    failed_job = repository.create_import_job(
      connection,
      kind="manual_import",
      source_path=str(source_dir),
      created_by=None,
      options={"recursive": True},
    )
    repository.update_import_job(connection, running_job["id"], status="running", current_stage="extract")
    repository.update_import_job(connection, failed_job["id"], status="failed", error_code="pipeline_stage_failed")
    tasks = repository.get_or_create_pipeline_tasks(connection, running_job["id"], worker.engine.PIPELINE_STAGES)
    extract_task = next(task for task in tasks if task["stage"] == "extract")
    repository.update_pipeline_task(connection, extract_task["id"], status="running", progress_completed=17, progress_total=100)

  worker.run_once()

  with database_session(worker_module.settings.sqlite_path) as connection:
    jobs = repository.list_import_jobs_by_source_path(connection, str(source_dir))
    incomplete_jobs = [job for job in jobs if job["status"] in {"queued", "running"}]
    failed_jobs = [job for job in jobs if job["status"] == "failed"]
    assert len(incomplete_jobs) == 1
    assert len(failed_jobs) == 1
    kept_job = incomplete_jobs[0]
    assert kept_job["id"] == running_job["id"]
    assert kept_job["status"] == "queued"
    state = repository.json_loads(kept_job.get("state_json"), {})
    assert state["recovered_after_restart"] is True
    assert state["resumable"] is True
    tasks = repository.list_pipeline_tasks(connection, [kept_job["id"]])
    extract_task = next(task for task in tasks if task["stage"] == "extract")
    assert extract_task["status"] == "queued"
    assert "Recovered after restart." in repository.json_loads(extract_task.get("warnings_json"), [])
    assert all(job["id"] != duplicate_job["id"] for job in jobs)


def test_discover_stage_records_unstable_directory_listing(monkeypatch, tmp_path):
  worker = build_test_worker(monkeypatch, tmp_path)
  source_dir = tmp_path / "incoming"
  source_dir.mkdir(parents=True)
  first = source_dir / "one.txt"
  second = source_dir / "two.txt"
  first.write_text("one", encoding="utf-8")
  second.write_text("two", encoding="utf-8")

  monkeypatch.setattr(
    worker.engine,
    "discover_sources_stable",
    lambda source_path, recursive=True: {
      "sources": [first, second],
      "stable": False,
      "pass_count": 4,
      "required_stable_passes": 2,
      "passes": [
        {"pass": 1, "count": 1},
        {"pass": 2, "count": 2},
        {"pass": 3, "count": 2},
        {"pass": 4, "count": 2},
      ],
    },
  )

  with database_session(worker_module.settings.sqlite_path) as connection:
    job = repository.create_import_job(
      connection,
      kind="manual_import",
      source_path=str(source_dir),
      created_by=None,
      options={"recursive": True},
    )

    assert worker._process_job(connection, job) is True

    discovered_job = repository.get_import_job(connection, job["id"])
    assert discovered_job is not None
    state = repository.json_loads(discovered_job.get("state_json"), {})
    assert state["discovery"]["stable"] is False
    assert state["discovery"]["pass_count"] == 4
    assert len(state["sources"]) == 2

    tasks = repository.list_pipeline_tasks(connection, [job["id"]])
    discover_task = next(task for task in tasks if task["stage"] == "discover")
    warnings = repository.json_loads(discover_task.get("warnings_json"), [])
    payload = repository.json_loads(discover_task.get("payload_json"), {})
    assert any("did not stabilize" in item for item in warnings)
    assert payload["discovery"]["pass_count"] == 4


def test_run_once_requeues_stale_running_task_after_startup(monkeypatch, tmp_path):
  worker = build_test_worker(monkeypatch, tmp_path)
  source_dir = tmp_path / "incoming"
  source_dir.mkdir(parents=True)
  (source_dir / "sample.txt").write_text("resume me", encoding="utf-8")

  monkeypatch.setattr(worker, "_sync_watch_folders", lambda connection: 0)
  monkeypatch.setattr(worker, "_process_job", lambda connection, job: False)
  monkeypatch.setattr(worker_module.settings, "running_task_recovery_minutes", 5.0)
  worker._recovery_checked = True

  with database_session(worker_module.settings.sqlite_path) as connection:
    job = repository.create_import_job(
      connection,
      kind="manual_import",
      source_path=str(source_dir),
      created_by=None,
      options={"recursive": True},
    )
    repository.update_import_job(
      connection,
      job["id"],
      status="running",
      current_stage="extract",
      state_json={
        "last_progress_at": "2026-03-17T00:00:00+00:00",
        "current_item_name": "sample.txt",
        "current_item_index": 1,
        "current_item_total": 10,
      },
    )
    tasks = repository.get_or_create_pipeline_tasks(connection, job["id"], worker.engine.PIPELINE_STAGES)
    extract_task = next(task for task in tasks if task["stage"] == "extract")
    repository.update_pipeline_task(
      connection,
      extract_task["id"],
      status="running",
      progress_completed=1,
      progress_total=10,
      started_at="2026-03-17T00:00:00+00:00",
      payload_json={"current_item_name": "sample.txt"},
    )

  worker.run_once()

  with database_session(worker_module.settings.sqlite_path) as connection:
    recovered_job = repository.get_import_job(connection, job["id"])
    assert recovered_job is not None
    assert recovered_job["status"] == "queued"
    state = repository.json_loads(recovered_job.get("state_json"), {})
    assert state["resumable"] is True
    assert state["stage_state"] == "recovering"
    assert state.get("recovered_after_restart") in {None, False}

    tasks = repository.list_pipeline_tasks(connection, [job["id"]])
    extract_task = next(task for task in tasks if task["stage"] == "extract")
    assert extract_task["status"] == "queued"
    warnings = repository.json_loads(extract_task.get("warnings_json"), [])
    assert "Recovered stale running task." in warnings


def test_worker_runs_small_document_to_complete(monkeypatch, tmp_path):
  worker = build_test_worker(monkeypatch, tmp_path)
  source_dir = tmp_path / "incoming"
  source_dir.mkdir(parents=True)
  sample = source_dir / "sample.txt"
  sample.write_text(
    "Section One\n\n"
    "Euler studies series, integrals, and zeta values.\n\n"
    "Section Two\n\n"
    "Sheaf gluing, spectra, and formal diagrams appear together in the notes.\n",
    encoding="utf-8",
  )

  class _StubEmbedder:
    ready = True
    is_fallback = True
    detail = "stub"

    def count_tokens(self, text: str) -> int:
      return max(len((text or "").split()), 1)

    def embed(self, text: str) -> list[float]:
      return [0.1, 0.2, 0.3, 0.4]

  class _StubVectorIndex:
    ready = True
    enabled = True
    is_fallback = True
    detail = "stub"
    mode = "local"

    def upsert_nodes(self, nodes):
      return None

    def search(self, query_text, node_types=None, summary_levels=None, document_ids=None, limit=10):
      return []

  monkeypatch.setattr(worker_module, "extract_document_with_timeout", lambda source_path, ocr_provider, include_ocr=False, timeout_seconds=None: make_parsed_payload(source_path, sample.read_text(encoding="utf-8")))
  class _StubMathProvider:
    def extract_document_math(self, source_path, parsed, ocr_provider=None, artifact_dir=None):
      return {
        "pages_scanned": 1,
        "regions_detected": 1,
        "formula_count": 1,
        "formula_recognized": 1,
        "formula_pending": 0,
        "documents_with_math_artifacts": 1,
        "confidence_summary": {"average": 0.92, "max": 0.92},
        "artifacts": [
          {
            "page_number": 1,
            "latex": r"\zeta(s)=\sum_{n=1}^{\infty} n^{-s}",
            "confidence": 0.92,
            "extraction_mode": "native_math",
          }
        ],
      }

  worker.engine._math_provider = _StubMathProvider()
  monkeypatch.setattr(
    worker.engine,
    "refresh_document_ocr",
    lambda source_path, parsed, deferred_to_ocr=False, progress_callback=None: {
      "parsed": parsed,
      "pages_ocrd": 0,
      "pages_improved": 0,
      "document_changed": False,
      "warnings": [],
    },
  )
  worker.engine._embedder = _StubEmbedder()
  worker.engine._vector_index = _StubVectorIndex()
  real_persist_prepared_document = worker.engine.persist_prepared_document

  def traced_persist_prepared_document(connection, prepared):
    try:
      return real_persist_prepared_document(connection, prepared)
    except Exception as error:
      raise RuntimeError(traceback.format_exc()) from error

  monkeypatch.setattr(worker.engine, "persist_prepared_document", traced_persist_prepared_document)

  with database_session(worker_module.settings.sqlite_path) as connection:
    job = repository.create_import_job(
      connection,
      kind="manual_import",
      source_path=str(source_dir),
      created_by=None,
      options={"recursive": True},
    )

    loops = 0
    refreshed = repository.get_import_job(connection, job["id"])
    while refreshed is not None and refreshed["status"] in {"queued", "running"}:
      loops += 1
      assert loops <= 30
      assert worker._process_job(connection, refreshed) is True
      refreshed = repository.get_import_job(connection, job["id"])

    completed_job = repository.get_import_job(connection, job["id"])
    assert completed_job is not None
    tasks = repository.list_pipeline_tasks(connection, [job["id"]])
    task_snapshot = [
      {
        "stage": task["stage"],
        "status": task["status"],
        "error_code": task.get("error_code"),
        "error_text": task.get("error_text"),
        "payload": repository.json_loads(task.get("payload_json"), {}),
      }
      for task in tasks
    ]
    assert completed_job["status"] == "completed", pprint.pformat(
      {
        "job_status": completed_job["status"],
        "job_stage": completed_job["current_stage"],
        "job_error": completed_job["error_text"],
        "tasks": task_snapshot,
      },
      width=160,
      sort_dicts=False,
    )
    assert completed_job["current_stage"] == "complete"

    state = repository.json_loads(completed_job.get("state_json"), {})
    assert state["math"]["formula_recognized"] == 1
    assert state["structure"]["prepared_documents"] == 1
    assert state["embed"]["embedded_nodes"] > 0
    assert state["index"]["indexed_vectors"] > 0
    assert state["research_materialize"]["graph_nodes"] > 0
    assert state["research_materialize"]["graph_edges"] > 0
    assert state["technique_materialize"]["materializations"] >= 0
    assert state["document_ids"]

    assert tasks
    assert all(task["status"] == "completed" for task in tasks)

    document_id = state["document_ids"][0]
    document = repository.get_document_by_id(connection, document_id)
    assert document is not None
    assert repository.list_nodes_by_document(connection, document_id)
    assert repository.list_research_graph_nodes(connection, document_id)
    assert repository.list_research_graph_edges(connection, document_id)
    assert repository.list_document_technique_materializations(connection, document_id) is not None
    tracked = repository.get_tracked_file_by_path(connection, sample)
    assert tracked is not None
    assert tracked["extraction_status"] == "completed"
    assert tracked["ocr_status"] == "completed"
    assert tracked["chunk_status"] == "completed"
    assert tracked["embedding_status"] == "completed"
    assert tracked["index_status"] == "completed"
    assert tracked["overall_status"] == "indexed"
    history = repository.list_tracked_file_events(connection, tracked["id"])
    stages = {event["stage"] for event in history}
    assert {"discover", "extract", "ocr", "chunk", "embed", "index"}.issubset(stages)
