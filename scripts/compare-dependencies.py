#!/usr/bin/env python3
"""
Compare shared production dependencies between openplc-web and openplc-editor.

Reads package.json from both repos and checks that every dependency present
in both has the same version specifier.
Exit code 0 = all match, 1 = mismatches found.
"""

import argparse
import json
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Compare shared production dependency versions between repos."
    )
    parser.add_argument(
        "--web-root",
        required=True,
        type=Path,
        help="Path to the web repo root (containing package.json)",
    )
    parser.add_argument(
        "--editor-root",
        required=True,
        type=Path,
        help="Path to the editor repo root (containing package.json)",
    )
    args = parser.parse_args()

    with open(args.web_root / "package.json") as f:
        web_deps = json.load(f).get("dependencies", {})
    with open(args.editor_root / "package.json") as f:
        editor_deps = json.load(f).get("dependencies", {})

    shared = sorted(set(web_deps) & set(editor_deps))
    mismatches = []

    for pkg in shared:
        if web_deps[pkg] != editor_deps[pkg]:
            mismatches.append((pkg, web_deps[pkg], editor_deps[pkg]))

    if mismatches:
        print(f"::error::Found {len(mismatches)} shared dependency version mismatch(es):")
        for pkg, web_ver, editor_ver in mismatches:
            print(f"  {pkg}: web={web_ver}  editor={editor_ver}")
        return 1

    print(f"All {len(shared)} shared dependencies match.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
