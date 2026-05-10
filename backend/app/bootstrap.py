from __future__ import annotations

import os
import sys
import warnings
import logging
from pathlib import Path


class _SuppressPaddleConnectivityWarning(logging.Filter):
  def filter(self, record: logging.LogRecord) -> bool:
    message = str(record.getMessage() or "")
    return "Connectivity check to the model hoster has been skipped because `PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK` is enabled." not in message


def activate_vendor_path() -> Path:
  backend_root = Path(__file__).resolve().parents[1]
  vendor_paths = [backend_root / "_vendor_runtime", backend_root / "_vendor"]

  # Paddle's hoster connectivity probe is expensive and noisy during local boot.
  os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
  os.environ.setdefault("FLAGS_json_format_model", "0")
  os.environ.setdefault("FLAGS_enable_pir_api", "0")
  os.environ.setdefault("FLAGS_enable_pir_in_executor", "0")
  os.environ.setdefault("FLAGS_use_mkldnn", "0")
  warnings.filterwarnings(
    "ignore",
    message=r".*doesn't match a supported version!.*",
  )
  root_logger = logging.getLogger()
  if not any(isinstance(item, _SuppressPaddleConnectivityWarning) for item in root_logger.filters):
    root_logger.addFilter(_SuppressPaddleConnectivityWarning())

  for vendor_path in reversed(vendor_paths):
    if not vendor_path.exists():
      continue

    vendor_string = str(vendor_path)
    if vendor_string not in sys.path:
      sys.path.append(vendor_string)

    extra_python_paths = [
      vendor_path / "win32",
      vendor_path / "win32" / "lib",
      vendor_path / "pythonwin",
      vendor_path / "pywin32_system32",
    ]
    for extra_path in extra_python_paths:
      if not extra_path.exists():
        continue
      extra_string = str(extra_path)
      if extra_string not in sys.path:
        sys.path.append(extra_string)
      os.environ["PATH"] = f"{extra_string}{os.pathsep}{os.environ.get('PATH', '')}"
      if hasattr(os, "add_dll_directory"):
        try:
          os.add_dll_directory(extra_string)
        except OSError:
          pass

    for dll_dir in vendor_path.glob("*.libs"):
      dll_string = str(dll_dir)
      os.environ["PATH"] = f"{dll_string}{os.pathsep}{os.environ.get('PATH', '')}"
      if hasattr(os, "add_dll_directory"):
        try:
          os.add_dll_directory(dll_string)
        except OSError:
          pass

  return backend_root
