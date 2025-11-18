"""
Utility to download the UI-TARS checkpoint from HuggingFace Hub (or any repo).

Example:
    python scripts/download_model.py \
        --repo ui-tars/UI-TARS-1.5-7B \
        --target ../../models/ui-tars-1.5-7b
"""

from __future__ import annotations

import argparse
from pathlib import Path

from huggingface_hub import snapshot_download


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", required=True, help="HuggingFace repo id (e.g., org/name).")
    parser.add_argument(
        "--target",
        required=True,
        type=Path,
        help="Directory where the checkpoint will be stored.",
    )
    parser.add_argument(
        "--revision",
        default="main",
        help="Optional revision / branch / commit to download.",
    )
    parser.add_argument(
        "--token",
        default=None,
        help="HuggingFace token if the repo is gated.",
    )
    parser.add_argument(
        "--exclude",
        nargs="*",
        default=["*.safetensors.index.json", "*.md"],
        help="Glob patterns to skip during download.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    args.target.mkdir(parents=True, exist_ok=True)

    snapshot_download(
        repo_id=args.repo,
        revision=args.revision,
        local_dir=str(args.target),
        local_dir_use_symlinks=False,
        ignore_patterns=args.exclude,
        token=args.token,
    )

    print(f"Model downloaded into {args.target}")


if __name__ == "__main__":
    main()


