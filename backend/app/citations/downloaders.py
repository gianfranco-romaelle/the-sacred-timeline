from __future__ import annotations

import shutil
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


class CitationDownloadError(RuntimeError):
  def __init__(self, code: str, message: str, *, retryable: bool) -> None:
    super().__init__(message)
    self.code = code
    self.retryable = retryable


@dataclass(slots=True)
class CitationDownloadRequest:
  provider_name: str
  candidate_id: str
  provider_record_id: str
  source_url: str | None
  download_url: str | None
  metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class CitationDownloadResult:
  source_url: str
  bytes_written: int
  resumed: bool = False
  response_headers: dict[str, str] = field(default_factory=dict)
  warnings: list[str] = field(default_factory=list)


class CitationArtifactDownloader(ABC):
  provider_name = "generic"
  supports_resume = True

  def build_request(self, candidate: dict[str, Any]) -> CitationDownloadRequest:
    return CitationDownloadRequest(
      provider_name=self.provider_name,
      candidate_id=candidate["id"],
      provider_record_id=str(candidate.get("provider_record_id") or candidate["id"]),
      source_url=candidate.get("source_url"),
      download_url=candidate.get("download_url"),
      metadata={
        "preview_url": candidate.get("preview_url"),
        "raw_payload": candidate.get("raw_payload") or {},
        "candidate_metadata": candidate.get("metadata") or {},
      },
    )

  @abstractmethod
  def download(
    self,
    request: CitationDownloadRequest,
    destination: Path,
    *,
    resume_from: int = 0,
    timeout_seconds: float = 180.0,
    chunk_size: int = 262144,
  ) -> CitationDownloadResult:
    raise NotImplementedError


class UrlCitationArtifactDownloader(CitationArtifactDownloader):
  user_agent = "SacredTimelineCitationWorker/1.0"

  def _select_url(self, request: CitationDownloadRequest) -> str:
    candidate_url = str(request.download_url or request.source_url or "").strip()
    if not candidate_url:
      raise CitationDownloadError(
        "missing_download_url",
        f"{self.provider_name} candidate does not expose a downloadable URL.",
        retryable=False,
      )
    return candidate_url

  def download(
    self,
    request: CitationDownloadRequest,
    destination: Path,
    *,
    resume_from: int = 0,
    timeout_seconds: float = 180.0,
    chunk_size: int = 262144,
  ) -> CitationDownloadResult:
    source_url = self._select_url(request)
    headers = {"User-Agent": self.user_agent}
    mode = "wb"
    resumed = False
    parsed = urlparse(source_url)
    if resume_from > 0 and self.supports_resume and parsed.scheme not in {"file"}:
      headers["Range"] = f"bytes={resume_from}-"
      mode = "ab"
      resumed = True

    destination.parent.mkdir(parents=True, exist_ok=True)
    req = Request(source_url, headers=headers)
    try:
      with urlopen(req, timeout=timeout_seconds) as response:
        status = int(getattr(response, "status", 200) or 200)
        if status >= 400:
          raise CitationDownloadError(
            f"http_{status}",
            f"{self.provider_name} returned HTTP {status}.",
            retryable=status in {408, 425, 429, 500, 502, 503, 504},
          )
        if resume_from > 0 and status == 200 and mode == "ab":
          destination.unlink(missing_ok=True)
          mode = "wb"
          resumed = False
        with destination.open(mode) as handle:
          shutil.copyfileobj(response, handle, length=chunk_size)
        return CitationDownloadResult(
          source_url=source_url,
          bytes_written=int(destination.stat().st_size),
          resumed=resumed,
          response_headers={key.lower(): value for key, value in response.headers.items()},
        )
    except CitationDownloadError:
      raise
    except HTTPError as error:
      raise CitationDownloadError(
        f"http_{error.code}",
        f"{self.provider_name} returned HTTP {error.code}.",
        retryable=error.code in {408, 425, 429, 500, 502, 503, 504},
      ) from error
    except URLError as error:
      raise CitationDownloadError(
        "network_error",
        f"{self.provider_name} download failed: {error.reason}",
        retryable=True,
      ) from error
    except OSError as error:
      raise CitationDownloadError(
        "filesystem_error",
        f"Failed to write staged artifact: {error}",
        retryable=False,
      ) from error


class LibraryGenesisArtifactDownloader(UrlCitationArtifactDownloader):
  provider_name = "libgen"


class SciHubArtifactDownloader(UrlCitationArtifactDownloader):
  provider_name = "scihub"

  def _select_url(self, request: CitationDownloadRequest) -> str:
    if request.download_url:
      return str(request.download_url).strip()
    raise CitationDownloadError(
      "missing_download_url",
      "Sci-Hub candidate is missing a direct PDF URL and cannot be fetched safely.",
      retryable=False,
    )


class InternetArchiveArtifactDownloader(UrlCitationArtifactDownloader):
  provider_name = "internet_archive"

  def _select_url(self, request: CitationDownloadRequest) -> str:
    if request.download_url:
      return str(request.download_url).strip()
    availability = str((request.metadata.get("candidate_metadata") or {}).get("availability_status") or "").strip().lower()
    if availability in {"borrowable", "restricted"}:
      raise CitationDownloadError(
        "borrow_required",
        "Internet Archive item requires borrow or restricted access; manual handling is required.",
        retryable=False,
      )
    return super()._select_url(request)


def default_downloaders() -> dict[str, CitationArtifactDownloader]:
  return {
    "libgen": LibraryGenesisArtifactDownloader(),
    "scihub": SciHubArtifactDownloader(),
    "internet_archive": InternetArchiveArtifactDownloader(),
  }
