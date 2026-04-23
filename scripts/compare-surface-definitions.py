#!/usr/bin/env python3
"""
Compare SURFACES definitions between the web and editor compare-surfaces.py scripts.

Parses the SURFACES variable from both scripts using Python's AST module
and checks that they define the same set of surfaces.
Exit code 0 = match, 1 = mismatch or parse failure.
"""

from __future__ import annotations

import argparse
import ast
import sys
from pathlib import Path

SCRIPT_RELATIVE_PATH = "scripts/compare-surfaces.py"


def extract_surfaces(filepath: Path) -> list[str] | None:
    with open(filepath) as f:
        tree = ast.parse(f.read())
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == "SURFACES":
                    return sorted(ast.literal_eval(node.value))
    return None


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

    print(f"SURFACES definitions match: {web}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
