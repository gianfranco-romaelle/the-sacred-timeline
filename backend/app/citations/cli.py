from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from .engine import purify_citations
from .models import CitationInput


def _load_entries(path: Path, input_format: str) -> list[CitationInput]:
  if input_format == "lines":
    return [
      CitationInput(original_text=line.strip())
      for line in path.read_text(encoding="utf-8").splitlines()
      if line.strip()
    ]

  if input_format == "json":
    payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, dict):
      payload = payload.get("items", [])
    return [CitationInput(**item) for item in payload]

  items: list[CitationInput] = []
  for line in path.read_text(encoding="utf-8").splitlines():
    if not line.strip():
      continue
    items.append(CitationInput(**json.loads(line)))
  return items


def _write_output(path: Path | None, payload: dict[str, Any], pretty: bool) -> None:
  rendered = json.dumps(payload, indent=2 if pretty else None, ensure_ascii=True)
  if path is None:
    print(rendered)
    return
  path.write_text(rendered + ("\n" if not rendered.endswith("\n") else ""), encoding="utf-8")


def build_parser() -> argparse.ArgumentParser:
  parser = argparse.ArgumentParser(description="Batch-purify bibliographic citations into normalized records and conservative work clusters.")
  parser.add_argument("--input", required=True, help="Path to a JSON, JSONL, or newline-delimited text file.")
  parser.add_argument("--format", choices=["jsonl", "json", "lines"], default="jsonl", help="Input record format.")
  parser.add_argument("--output", help="Optional output path. Defaults to stdout.")
  parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON output.")
  return parser


def main(argv: list[str] | None = None) -> int:
  parser = build_parser()
  args = parser.parse_args(argv)
  input_path = Path(args.input)
  output_path = Path(args.output) if args.output else None
  entries = _load_entries(input_path, args.format)
  result = purify_citations(entries)
  _write_output(output_path, result.to_dict(), pretty=bool(args.pretty))
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
