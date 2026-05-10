from __future__ import annotations

from dataclasses import dataclass, field


def remediation_payload_from_error(code: str, missing_services: list[str] | None = None) -> dict[str, object]:
  missing = [item for item in (missing_services or []) if item]
  normalized = str(code or "").strip().lower()
  payload: dict[str, object] = {
    "stage_state": "awaiting_refinement",
    "awaiting_refinement": True,
    "can_continue": False,
    "recommended_action": "Refine the local runtime, then retest the same stage from the current job state.",
    "next_check": "Confirm the required backend services are healthy before retrying.",
    "retry_hint": "Restart the backend, reopen the PowerShell import monitor, and verify the blocked service shows ready.",
    "retry_command": "Use the library backend power control or rerun scripts/start-backend.ps1.",
    "missing_services": missing,
  }

  if normalized in {"pdf_crypto_dependency_missing", "djvu_dependency_missing"}:
    payload.update({
      "recommended_action": "Install the missing extraction dependency or allow OCR recovery for this file type, then retest.",
      "next_check": "Verify native extraction or OCR support is available for the blocked file type.",
      "retry_hint": "Keep the job queued; once the dependency is available, the worker can resume from the same file.",
    })
  elif normalized in {"import_runtime_unavailable", "query_runtime_unavailable"}:
    payload.update({
      "recommended_action": "Bring the missing ingestion or retrieval services online before retesting.",
      "next_check": "Check embedding, vector index, OCR, reranker, and reasoner readiness in /api/system/status.",
      "retry_hint": "After the missing services show ready, restart the worker or rerun the stage.",
    })
  elif normalized.endswith("_provider_unavailable") or normalized.endswith("_sync_failed") or normalized.endswith("_fetch_failed"):
    payload.update({
      "recommended_action": "Stabilize the upstream provider, then rerun the operation from the saved state.",
      "next_check": "Confirm the provider reports ready and returns healthy source status.",
      "retry_hint": "Once the provider is healthy, rerun the request without resetting existing job state.",
    })

  return payload


@dataclass
class ServiceDependencyError(RuntimeError):
  code: str
  message: str
  missing_services: list[str] = field(default_factory=list)

  def __post_init__(self) -> None:
    super().__init__(self.message)

  def to_detail(self) -> dict[str, object]:
    return {
      "code": self.code,
      "message": self.message,
      "missing_services": self.missing_services,
      **remediation_payload_from_error(self.code, self.missing_services),
    }
