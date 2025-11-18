"""
Utility to validate and normalize dark-pattern samples exported from the extension.

Usage:
    python scripts/build_dataset.py \
        --input datasets/run-001/raw.jsonl \
        --image-root datasets/run-001/images \
        --output datasets/run-001/processed.jsonl
"""

from __future__ import annotations

import json
import argparse
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


@dataclass
class Sample:
    instruction: str
    dom: str
    label: str
    image_path: str | None
    metadata: dict

    def to_prompt(self) -> str:
        parts = [
            "[SYSTEM] Detect deceptive UI patterns.",
            f"[INSTRUCTION]\n{self.instruction}",
            "[DOM SNIPPET]\n" + self.dom[:6000],
        ]
        if self.metadata:
            parts.append("[METADATA]\n" + json.dumps(self.metadata, ensure_ascii=False))
        if self.image_path:
            parts.append(f"[SCREENSHOT]\n{self.image_path}")
        parts.append("[RESPONSE]")
        return "\n\n".join(parts)

    def to_record(self) -> dict:
        return {
            "prompt": self.to_prompt(),
            "label": self.label,
            "image_path": self.image_path,
        }


def load_jsonl(path: Path) -> Iterable[dict]:
    with path.open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            yield json.loads(line)


def parse_sample(raw: dict, image_root: Path | None) -> Sample:
    image_rel = raw.get("screenshot") or raw.get("image_path")
    image_abs = None
    if image_rel and image_root:
        candidate = image_root / image_rel
        if not candidate.exists():
            raise FileNotFoundError(f"Image not found: {candidate}")
        image_abs = str(candidate.resolve())
    return Sample(
        instruction=raw["instruction"],
        dom=raw.get("dom", raw.get("html", "")),
        label=json.dumps(raw.get("patterns") or raw.get("label"), ensure_ascii=False),
        image_path=image_abs,
        metadata={
            "url": raw.get("url"),
            "timestamp": raw.get("timestamp"),
            "dark_pattern_types": raw.get("pattern_types"),
        },
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--image-root", type=Path, default=None)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    samples = []
    for row in load_jsonl(args.input):
        samples.append(parse_sample(row, args.image_root).to_record())

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as fh:
        for rec in samples:
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")

    print(f"Wrote {len(samples)} records -> {args.output}")


if __name__ == "__main__":
    main()


