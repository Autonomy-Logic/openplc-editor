#!/usr/bin/env python3
"""
Compare byte-identical surfaces between openplc-editor and openplc-web.

Surfaces checked:
  - frontend/          (UI layer)
  - middleware/shared/  (ports + providers)
  - backend/shared/    (application logic, use cases)
  - __architecture__/  (validation scripts)

Every file in these directories must be byte-identical across both repos.
Exit code 0 = all identical, 1 = differences found.
"""

import argparse
import hashlib
import json
import sys
from pathlib import Path

SURFACES = [
    "frontend",
    "middleware/shared",
    "backend/shared",
    "__architecture__",
]


def hash_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def collect_hashes(root: Path, surface: str) -> dict[str, str]:
    base = root / surface
    if not base.exists():
        return {}
    result = {}
    for path in sorted(base.rglob("*")):
        if path.is_file():
            rel = str(path.relative_to(root))
            result[rel] = hash_file(path)
    return result


def compare_surface(
    web_root: Path, editor_root: Path, surface: str
) -> dict:
    web_hashes = collect_hashes(web_root, surface)
    editor_hashes = collect_hashes(editor_root, surface)
    all_files = sorted(set(web_hashes) | set(editor_hashes))

    diffs = []
    for f in all_files:
        in_web = f in web_hashes
        in_editor = f in editor_hashes
        if in_web and not in_editor:
            diffs.append({"file": f, "reason": "only_in_web"})
        elif in_editor and not in_web:
            diffs.append({"file": f, "reason": "only_in_editor"})
        elif web_hashes[f] != editor_hashes[f]:
            diffs.append({"file": f, "reason": "hash_mismatch"})

    return {
        "match": len(diffs) == 0,
        "files_checked": len(all_files),
        "diffs": diffs,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Compare byte-identical surfaces between web and editor repos."
    )
    parser.add_argument(
        "--web-root",
        required=True,
        type=Path,
        help="Path to the web repo's src/ directory",
    )
    parser.add_argument(
        "--editor-root",
        required=True,
        type=Path,
        help="Path to the editor repo's src/ directory",
    )
    parser.add_argument(
        "--github-annotations",
        action="store_true",
        help="Emit GitHub Actions annotations to stderr",
    )
    args = parser.parse_args()

    surfaces = {}
    total_diffs = 0

    for surface in SURFACES:
        result = compare_surface(args.web_root, args.editor_root, surface)
        surfaces[surface] = result
        total_diffs += len(result["diffs"])

    total_files = sum(s["files_checked"] for s in surfaces.values())
    overall_match = all(s["match"] for s in surfaces.values())

    output = {
        "match": overall_match,
        "surfaces": surfaces,
        "total_files": total_files,
        "total_diffs": total_diffs,
    }

    # JSON to stdout (machine-readable)
    print(json.dumps(output))

    # GitHub annotations to stderr
    if args.github_annotations:
        for surface, result in surfaces.items():
            if result["match"]:
                continue
            for diff in result["diffs"]:
                reason = diff["reason"]
                filepath = diff["file"]
                if reason == "only_in_web":
                    msg = f"[{surface}] File exists only in web repo: src/{filepath}"
                elif reason == "only_in_editor":
                    msg = f"[{surface}] File exists only in editor repo: src/{filepath}"
                else:
                    msg = f"[{surface}] File differs between repos: src/{filepath}"
                print(f"::error file=src/{filepath}::{msg}", file=sys.stderr)

    return 0 if overall_match else 1


if __name__ == "__main__":
    sys.exit(main())
