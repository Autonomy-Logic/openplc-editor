#!/usr/bin/env python3
"""
Compare surface definitions between the web and editor compare-surfaces.py scripts.

Parses the SURFACES and MAPPED_SURFACES variables from both scripts using
Python's AST module and checks that they define the same surfaces, so the two
repos can never silently check a different set.
Exit code 0 = match, 1 = mismatch or parse failure.
"""

from __future__ import annotations

import argparse
import ast
import sys
from pathlib import Path

SCRIPT_RELATIVE_PATH = "scripts/compare-surfaces.py"


def extract_var(filepath: Path, varname: str):
    """Return the literal value assigned to `varname` in the script, or None."""
    with open(filepath) as f:
        tree = ast.parse(f.read())
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == varname:
                    return ast.literal_eval(node.value)
    return None


def extract_surfaces(filepath: Path) -> list[str] | None:
    value = extract_var(filepath, "SURFACES")
    return sorted(value) if value is not None else None


def extract_mapped(filepath: Path) -> list | None:
    """MAPPED_SURFACES as a list of dicts, normalized (sorted by name) for a
    stable comparison; missing entirely returns None."""
    value = extract_var(filepath, "MAPPED_SURFACES")
    if value is None:
        return None
    return sorted(value, key=lambda m: m.get("name", ""))


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Compare SURFACES definitions between repo compare-surfaces.py scripts."
    )
    parser.add_argument(
        "--web-root",
        required=True,
        type=Path,
        help="Path to the web repo root",
    )
    parser.add_argument(
        "--editor-root",
        required=True,
        type=Path,
        help="Path to the editor repo root",
    )
    args = parser.parse_args()

    web_script = args.web_root / SCRIPT_RELATIVE_PATH
    editor_script = args.editor_root / SCRIPT_RELATIVE_PATH

    web = extract_surfaces(web_script)
    editor = extract_surfaces(editor_script)

    if web is None or editor is None:
        missing = []
        if web is None:
            missing.append(f"web ({web_script})")
        if editor is None:
            missing.append(f"editor ({editor_script})")
        print(f"::error::Could not extract SURFACES from: {', '.join(missing)}")
        return 1

    if web != editor:
        web_only = set(web) - set(editor)
        editor_only = set(editor) - set(web)
        print("::error::SURFACES definitions do not match:")
        if web_only:
            print(f"  Only in web: {', '.join(sorted(web_only))}")
        if editor_only:
            print(f"  Only in editor: {', '.join(sorted(editor_only))}")
        return 1

    # MAPPED_SURFACES must match too (it controls the path-mapped checks).
    web_mapped = extract_mapped(web_script)
    editor_mapped = extract_mapped(editor_script)
    if web_mapped != editor_mapped:
        print("::error::MAPPED_SURFACES definitions do not match:")
        print(f"  web:    {web_mapped}")
        print(f"  editor: {editor_mapped}")
        return 1

    print(f"SURFACES definitions match: {web}")
    mapped_names = [m.get("name") for m in (web_mapped or [])]
    print(f"MAPPED_SURFACES definitions match: {mapped_names}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
