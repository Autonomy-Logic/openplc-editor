# Fonts

The only fonts the HMI loads. The font build step (`src/backend/shared/hmi/fonts/`) refuses any file whose SHA-256
differs from the list in `vetted-fonts.ts`. Each face comes in two variants; a build uses one variant for all faces,
and only the faces its screens use.

| File | Face id | Variant | Size | SHA-256 |
| --- | --- | --- | --- | --- |
| `OpenPLCSans-Regular.ttf` | 0 (`HMI_FONT_REGULAR`) | compact (default) | 16.6 KB | `a9eea7d90d6c7edc9ab22fc46e069cda4b7197174c5c8116fd27f5093a189fb7` |
| `OpenPLCSans-Bold.ttf` | 1 (`HMI_FONT_BOLD`) | compact (default) | 16.6 KB | `50603a75a1ccc1b30a39fefa73b917156fd0d9cbc1ef64fec69cbdadfe2a0e69` |
| `LiberationSans-Regular.ttf` | 0 (`HMI_FONT_REGULAR`) | full | 411 KB | `76d04c18ea243f426b7de1f3ad208e927008f961dc5945e5aad352d0dfde8ee8` |
| `LiberationSans-Bold.ttf` | 1 (`HMI_FONT_BOLD`) | full | 414 KB | `788abee4c806d660e8aee46689dd8540cd4bb98da03dcc9d171ce3efd99a9173` |

- **Liberation Sans** (full): Liberation Fonts 2.1.5, `liberation-fonts-ttf-2.1.5.tar.gz` from
  https://github.com/liberationfonts/liberation-fonts/releases/tag/2.1.5 (archive SHA-256
  `7191c669bf38899f73a2094ed00f7b800553364f90e2637010a69c0e268f25d0`), files unmodified.
- **OpenPLC Sans** (compact): those two files cut to ASCII and Latin-1 (U+0020-U+007E, U+00A0-U+00FF) with
  `scripts/hmi-fonts/build-openplc-sans.py` (in openplc-editor, fontTools 4.60.1; the output is reproducible). Outlines,
  advances and kerning are unchanged, so the two variants draw the same pixels for those characters
  (`tests/hmi-core/golden.txt`); hinting, other layout data and glyph names are dropped. Other characters draw as the
  missing-glyph box. The faces are renamed because the licence reserves the names "Liberation" and "Arimo" for the
  unmodified fonts; the copyright notices are kept.
- Licence of both: SIL Open Font License 1.1, in `LICENSE.txt` (the release's `LICENSE` file).

Adding a face: add both variants here and to `VETTED_HMI_FONTS` with their id and hash, and add the id to
`enum hmi_font` in `core/hmi_core.h`.
