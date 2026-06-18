#!/usr/bin/env python3
"""
Compare byte-identical surfaces between openplc-editor and openplc-web.

Surfaces checked (same src-relative path in both repos):
  - frontend/          (UI layer)
  - middleware/shared/  (ports + providers)
  - backend/shared/    (application logic, use cases)
  - __architecture__/  (validation scripts)

Mapped surfaces (different path per repo, compared by structure within
the mapped base — see MAPPED_SURFACES):
  - bare-metal-runtime  (editor: resources/sources/{arduino,Baremetal};
                         web:    src/assets/firmware/{arduino,Baremetal})

Every file in these surfaces must be byte-identical across both repos.
Exit code 0 = all identical, 1 = differences found.
"""

from __future__ import annotations

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

# Surfaces that live at a DIFFERENT path in each repo (so they can't be a
# plain src-relative entry in SURFACES). `editor`/`web` are repo-root-relative
# (the repo root is the parent of the --editor-root/--web-root src dirs).
#
# Checked ONE-WAY (web is a subset of the editor's tree): every file the web
# bundle ships under `web` must be byte-identical to the editor's `editor`
# tree at the same relative path. Editor-only files are NOT flagged — the
# editor's resources/sources/hal/ also carries ~30 per-board HALs the web
# bundle (AVR8js simulator only) does not ship. A content edit to any shared
# runtime file still surfaces as a hash mismatch.
MAPPED_SURFACES = [
    {
        "name": "bare-metal-runtime",
        "editor": "resources/sources",
        "web": "src/assets/firmware",
        # Only the C/C++ runtime sources are shared; the web bundle also keeps
        # its own bundler glue here (e.g. an index.ts that imports the sources
        # as strings) which the editor does not have.
        "exts": [".cpp", ".hpp", ".c", ".h", ".ino"],
    },
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


def collect_all_hashes(base: Path, exts: list[str] | None = None) -> dict[str, str]:
    """Hash every file under `base`, keyed by the path relative to `base`.
    When `exts` is given, only files with one of those suffixes are included."""
    result = {}
    if not base.exists():
        return result
    ext_set = set(exts) if exts else None
    for path in sorted(base.rglob("*")):
        if path.is_file() and (ext_set is None or path.suffix in ext_set):
            result[str(path.relative_to(base))] = hash_file(path)
    return result


def compare_mapped(web_repo: Path, editor_repo: Path, mapped: dict) -> dict:
    """One-way check: every (filtered) file the web bundle ships under
    `mapped['web']` must exist and be byte-identical in the editor tree at
    `mapped['editor']`. Editor-only files are not flagged (web ships a
    subset)."""
    web_base = web_repo / mapped["web"]
    editor_base = editor_repo / mapped["editor"]
    web_hashes = collect_all_hashes(web_base, mapped.get("exts"))

    diffs = []
    for rel, h in sorted(web_hashes.items()):
        editor_path = editor_base / rel
        if not editor_path.is_file():
            diffs.append({"file": rel, "reason": "only_in_web"})
        elif hash_file(editor_path) != h:
            diffs.append({"file": rel, "reason": "hash_mismatch"})

    return {
        "match": len(diffs) == 0,
        "files_checked": len(web_hashes),
        "diffs": diffs,
        "mapped": {"editor": mapped["editor"], "web": mapped["web"]},
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

    # Mapped surfaces are repo-root-relative; the repo root is the parent of
    # the src dir passed for --web-root/--editor-root.
    web_repo = args.web_root.parent
    editor_repo = args.editor_root.parent
    for mapped in MAPPED_SURFACES:
        result = compare_mapped(web_repo, editor_repo, mapped)
        surfaces[mapped["name"]] = result
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
            mapped = result.get("mapped")
            for diff in result["diffs"]:
                reason = diff["reason"]
                filepath = diff["file"]
                if mapped:
                    # Mapped surfaces sit at a different path per repo, so there
                    # is no single src-relative anchor; reference both sides.
                    ew = f"{mapped['editor']}/{filepath}"
                    ww = f"{mapped['web']}/{filepath}"
                    if reason == "only_in_web":
                        msg = f"[{surface}] File exists only in web repo: {ww}"
                    elif reason == "only_in_editor":
                        msg = f"[{surface}] File exists only in editor repo: {ew}"
                    else:
                        msg = f"[{surface}] File differs between repos: editor {ew} vs web {ww}"
                    print(f"::error::{msg}", file=sys.stderr)
                else:
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
