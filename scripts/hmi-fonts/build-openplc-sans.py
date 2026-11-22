#!/usr/bin/env python3
"""
Builds OpenPLC Sans, the HMI's bundled font, from Liberation Sans 2.1.5 (SIL OFL 1.1).

Keeps ASCII and Latin-1 (U+0020-U+007E, U+00A0-U+00FF) with their outlines and kerning, drops hinting and other
layout data, and renames the faces: the OFL reserves the names "Liberation" and "Arimo" for unmodified fonts.
Output bytes are reproducible: same input, same fontTools version, same files.

Usage (needs fontTools 4.60.1):
  build-openplc-sans.py <dir with LiberationSans-Regular.ttf and -Bold.ttf from liberation-fonts-ttf-2.1.5> <out dir>
"""

import hashlib
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

FONTTOOLS_VERSION = "4.60.1"
UNICODES = list(range(0x20, 0x7F)) + list(range(0xA0, 0x100))
FAMILY = "OpenPLC Sans"

# Upstream files, liberation-fonts-ttf-2.1.5.tar.gz.
SOURCES = {
    "Regular": ("LiberationSans-Regular.ttf", "76d04c18ea243f426b7de1f3ad208e927008f961dc5945e5aad352d0dfde8ee8"),
    "Bold": ("LiberationSans-Bold.ttf", "788abee4c806d660e8aee46689dd8540cd4bb98da03dcc9d171ce3efd99a9173"),
}

# Name records rewritten (family, style, unique id, full name, PostScript name) or removed (trademark,
# description, typographic family and style). Copyright, version, designer, URLs and licence are kept.
REMOVED_NAMES = (7, 10, 16, 17, 18, 21, 22)
RESERVED = ("liberation", "arimo")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build(style: str, src: Path, out: Path) -> None:
    options = subset.Options()
    options.layout_features = ["kern"]
    options.legacy_kern = True
    options.hinting = False
    options.drop_tables += ["hdmx", "VDMX", "LTSH", "gasp", "DSIG"]
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    options.notdef_outline = True
    options.glyph_names = False
    font = TTFont(src, recalcTimestamp=False)
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=UNICODES)
    subsetter.subset(font)

    name = font["name"]
    for name_id in REMOVED_NAMES:
        name.removeNames(nameID=name_id)
    postscript = f"{FAMILY.replace(' ', '')}-{style}"
    names = {1: FAMILY, 2: style, 3: f"{postscript} 2.1.5 subset", 4: f"{FAMILY} {style}", 6: postscript}
    for record in list(name.names):
        if record.nameID in names:
            name.setName(names[record.nameID], record.nameID, record.platformID, record.platEncID, record.langID)
    for record in name.names:
        text = record.toUnicode().lower()
        if record.nameID not in (0, 13) and any(word in text for word in RESERVED):
            raise SystemExit(f"{style}: name {record.nameID} still uses a reserved name: {record.toUnicode()}")
    font["post"].formatType = 3.0  # no glyph names
    font.save(out)


def main() -> None:
    import fontTools

    if fontTools.version != FONTTOOLS_VERSION:
        raise SystemExit(f"needs fontTools {FONTTOOLS_VERSION}, found {fontTools.version}")
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    src_dir, out_dir = Path(sys.argv[1]), Path(sys.argv[2])
    out_dir.mkdir(parents=True, exist_ok=True)
    for style, (file, digest) in SOURCES.items():
        src = src_dir / file
        if sha256(src) != digest:
            raise SystemExit(f"{file} is not the upstream 2.1.5 file")
        out = out_dir / f"{FAMILY.replace(' ', '')}-{style}.ttf"
        build(style, src, out)
        print(f"{out.name} {out.stat().st_size} {sha256(out)}")


if __name__ == "__main__":
    main()
