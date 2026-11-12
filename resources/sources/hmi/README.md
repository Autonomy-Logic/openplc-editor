# HMI core

Platform-neutral C core of the HMI: the primitives screens call, the display list, per-viewer sessions and input,
and the rasterizer. The same sources build for Runtime v4, baremetal panels and the WebAssembly preview and client,
and produce the same pixels on each. This folder is mirrored byte for byte in openplc-web at
`src/assets/firmware/hmi/` (`scripts/compare-surfaces.py`).

| Path | Contents |
| --- | --- |
| `core/hmi_core.h` | Public API and display list format |
| `core/hmi_internal.h` | Definitions shared by the core's files |
| `core/hmi_core.c` | Sessions, recording, frame transform, pointer arbitration, keyboard, pages |
| `core/hmi_theme.c` | Predefined and project themes |
| `core/hmi_math.c` | Table trigonometry, ellipse table, number formatting |
| `core/hmi_raster.c` | Rasterizer, band hashes, deadlines |
| `core/hmi_text.c` | Fonts, text metrics, glyph cache, text drawing |
| `core/third_party/` | stb_truetype (see its README) |
| `fonts/` | The vetted fonts: OpenPLC Sans (default, ASCII and Latin-1) and Liberation Sans (full); see its README |

## Building

Compile the five `core/*.c` files with `core/` on the include path and `-ffp-contract=off`, plus the font table the
HMI build generates (`hmi_font_table`, from `src/backend/shared/hmi/fonts/font-table-source.ts`; only the faces the
screens use, in the project's font variant). Text is rasterized from the TrueType outlines on every target. An optional `hmi_config.h` on the include path sets `HMI_DL_CAPACITY` and `HMI_BOUNDS_MAX`.

## Rules that keep the output identical everywhere

- Geometry, colors and text widths are integers. Floats are used only by stb_truetype's glyph rasterization and for
  formatting values that do not fit the integer formatter.
- No fused multiply-add: `-ffp-contract=off` in every build (also set by pragma in `hmi_text.c`).
- Trigonometry comes from constant integer tables.
- Device coordinates are clamped to +-131072 pixels, so every per-pixel product fits 64 bits.

## Tests (in openplc-editor)

`npm run test:hmi-core` (or `node tests/hmi-core/run.mjs`, see the options at the top of that file) builds the
golden scenes and the unit tests with gcc, clang and WebAssembly (`-Wall -Wextra -Werror`), checks every target
against `tests/hmi-core/golden.txt` with both font variants, and runs the fuzzer under AddressSanitizer and UndefinedBehaviorSanitizer.
`--png <dir>` writes the scenes as images. After an intended rendering change, review the images and run with
`--update`.
