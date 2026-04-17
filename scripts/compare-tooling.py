#!/usr/bin/env python3
"""
Compare tooling configuration between openplc-web and openplc-editor.

Checks that lint, formatting, and TypeScript configurations produce
equivalent output on shared surfaces. Byte-identical files are hash-
compared; config files with legitimate platform differences are
structurally compared.

Exit code 0 = all in sync, 1 = differences found.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# Files that must be byte-identical (same relative path in both repos)
IDENTICAL_FILES = [
    ".prettierrc",
    "scripts/compare-surfaces.py",
    "scripts/compare-dependencies.py",
    "scripts/compare-surface-definitions.py",
    "scripts/compare-tooling.py",
]

# ESLint config (different filenames, rules must match)
ESLINT_FILES = {
    "web": "eslint.config.js",
    "editor": "eslint.config.mjs",
}

# TypeScript config (different structure, key options must match)
TSCONFIG_FILES = {
    "web": "tsconfig.app.json",
    "editor": "tsconfig.json",
}

# Compiler options that must match for shared surface type-checking consistency
TSCONFIG_SHARED_OPTIONS = [
    "strict",
    "jsx",
    "noFallthroughCasesInSwitch",
    "noUnusedLocals",
    "noUnusedParameters",
    "paths",
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def hash_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def strip_eslint_ignores(text: str) -> str:
    """Remove the { ignores: [...] } config block from ESLint config text."""
    return re.sub(
        r"\{\s*ignores:\s*\[.*?\],?\s*\}",
        "",
        text,
        flags=re.DOTALL,
    )


def normalize_whitespace(text: str) -> str:
    """Collapse runs of whitespace and strip for comparison."""
    return re.sub(r"\s+", " ", text).strip()


def parse_jsonc(text: str) -> dict:
    """Parse JSON with comments (// and /* */) and trailing commas."""
    # Strip comments while preserving strings containing //
    result = []
    i = 0
    while i < len(text):
        if text[i] == '"':
            j = i + 1
            while j < len(text):
                if text[j] == '\\':
                    j += 2
                    continue
                if text[j] == '"':
                    j += 1
                    break
                j += 1
            result.append(text[i:j])
            i = j
        elif text[i:i+2] == '//':
            i = text.index('\n', i) if '\n' in text[i:] else len(text)
        elif text[i:i+2] == '/*':
            end = text.index('*/', i)
            i = end + 2
        else:
            result.append(text[i])
            i += 1
    text = "".join(result)
    # Strip trailing commas before } or ]
    text = re.sub(r",\s*([}\]])", r"\1", text)
    return json.loads(text)


# ---------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------

def check_identical_files(
    web_root: Path, editor_root: Path
) -> list[dict]:
    results = []
    for relpath in IDENTICAL_FILES:
        web_file = web_root / relpath
        editor_file = editor_root / relpath

        entry: dict = {"file": relpath, "check": "byte-identical"}

        if not web_file.exists() and not editor_file.exists():
            entry["status"] = "skip"
            entry["reason"] = "missing in both repos"
        elif not web_file.exists():
            entry["status"] = "fail"
            entry["reason"] = "missing in web repo"
        elif not editor_file.exists():
            entry["status"] = "fail"
            entry["reason"] = "missing in editor repo"
        elif hash_file(web_file) == hash_file(editor_file):
            entry["status"] = "pass"
        else:
            entry["status"] = "fail"
            entry["reason"] = "files differ"

        results.append(entry)
    return results


def check_eslint_rules(
    web_root: Path, editor_root: Path
) -> list[dict]:
    web_file = web_root / ESLINT_FILES["web"]
    editor_file = editor_root / ESLINT_FILES["editor"]

    entry: dict = {
        "file": f"{ESLINT_FILES['web']} <-> {ESLINT_FILES['editor']}",
        "check": "eslint-rules",
    }

    if not web_file.exists() or not editor_file.exists():
        missing = []
        if not web_file.exists():
            missing.append(f"web ({web_file})")
        if not editor_file.exists():
            missing.append(f"editor ({editor_file})")
        entry["status"] = "fail"
        entry["reason"] = f"missing: {', '.join(missing)}"
        return [entry]

    web_text = web_file.read_text()
    editor_text = editor_file.read_text()

    web_stripped = normalize_whitespace(strip_eslint_ignores(web_text))
    editor_stripped = normalize_whitespace(strip_eslint_ignores(editor_text))

    if web_stripped == editor_stripped:
        entry["status"] = "pass"
    else:
        entry["status"] = "fail"
        entry["reason"] = "ESLint rules/plugins/config differ (ignoring ignores block)"

    return [entry]


def check_tsconfig_options(
    web_root: Path, editor_root: Path
) -> list[dict]:
    web_file = web_root / TSCONFIG_FILES["web"]
    editor_file = editor_root / TSCONFIG_FILES["editor"]

    entry: dict = {
        "file": f"{TSCONFIG_FILES['web']} <-> {TSCONFIG_FILES['editor']}",
        "check": "tsconfig-shared-options",
    }

    if not web_file.exists() or not editor_file.exists():
        missing = []
        if not web_file.exists():
            missing.append(f"web ({web_file})")
        if not editor_file.exists():
            missing.append(f"editor ({editor_file})")
        entry["status"] = "fail"
        entry["reason"] = f"missing: {', '.join(missing)}"
        return [entry]

    with open(web_file) as f:
        web_config = parse_jsonc(f.read())
    with open(editor_file) as f:
        editor_config = parse_jsonc(f.read())

    web_opts = web_config.get("compilerOptions", {})
    editor_opts = editor_config.get("compilerOptions", {})

    mismatches = []
    for opt in TSCONFIG_SHARED_OPTIONS:
        web_val = web_opts.get(opt)
        editor_val = editor_opts.get(opt)
        if web_val != editor_val:
            mismatches.append(
                f"{opt}: web={json.dumps(web_val)}  editor={json.dumps(editor_val)}"
            )

    if mismatches:
        entry["status"] = "fail"
        entry["reason"] = "; ".join(mismatches)
    else:
        entry["status"] = "pass"

    return [entry]


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Compare tooling configuration between web and editor repos."
    )
    parser.add_argument(
        "--web-root", required=True, type=Path,
        help="Path to the web repo root",
    )
    parser.add_argument(
        "--editor-root", required=True, type=Path,
        help="Path to the editor repo root",
    )
    parser.add_argument(
        "--github-annotations", action="store_true",
        help="Emit GitHub Actions error annotations",
    )
    args = parser.parse_args()

    all_results: list[dict] = []
    all_results.extend(check_identical_files(args.web_root, args.editor_root))
    all_results.extend(check_eslint_rules(args.web_root, args.editor_root))
    all_results.extend(check_tsconfig_options(args.web_root, args.editor_root))

    failures = [r for r in all_results if r["status"] == "fail"]
    passes = [r for r in all_results if r["status"] == "pass"]
    skips = [r for r in all_results if r["status"] == "skip"]

    for r in passes:
        print(f"  PASS  {r['file']} ({r['check']})")
    for r in skips:
        print(f"  SKIP  {r['file']} -- {r.get('reason', '')}")
    for r in failures:
        msg = f"  FAIL  {r['file']} ({r['check']}): {r.get('reason', '')}"
        print(msg)
        if args.github_annotations:
            print(f"::error::{r['file']}: {r.get('reason', 'mismatch')}", file=sys.stderr)

    print()
    print(f"{len(passes)} passed, {len(failures)} failed, {len(skips)} skipped")

    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
