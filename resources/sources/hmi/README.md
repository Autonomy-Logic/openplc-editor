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
| `unit/` | The interface of a generated HMI unit (`hmi_unit.h`) and its preview setters (`hmi_preview.h`) |
| `preview/` | The editor's preview host (`hmi_preview_host.cpp`): one viewer of a unit in a WebAssembly module, frames rasterized in bands with unchanged bands skipped |
| `fonts/` | The vetted fonts: OpenPLC Sans (default, ASCII and Latin-1) and Liberation Sans (full); see its README |

## Building

Compile the five `core/*.c` files with `core/` on the include path and `-ffp-contract=off`, plus the font table the
HMI build generates (`hmi_font_table`, from `src/backend/shared/hmi/fonts/font-table-source.ts`; only the faces the
screens use, in the project's font variant). Text is rasterized from the TrueType outlines on every target. An optional `hmi_config.h` on the include path sets `HMI_DL_CAPACITY`, `HMI_BOUNDS_MAX` and `HMI_BOUNDS_CLIPS_MAX`.

## Rules that keep the output identical everywhere

- Geometry, colors and text widths are integers. Floats are used only for text: glyph placement (pen and baseline in
  `hmi_raster_text`) and stb_truetype's glyph rasterization. Number formatting is exact integer arithmetic.
- No fused multiply-add: every build must pass `-ffp-contract=off`. The pragma in `hmi_text.c` protects gcc builds
  only; clang ignores it under `-ffp-contract=fast`, and the text scenes in `tests/hmi-core` fail when that happens.
  `-ffast-math` is refused at compile time.
- Trigonometry comes from constant integer tables.
- Device coordinates are clamped to +-131072 pixels, so every per-pixel product fits 64 bits.

## Widget library

Screens are ST built on StandardWidgets, an ST library over these primitives: the element base, containers,
widgets, the on-screen keyboard, the screen base and the runtime the generated glue drives. It lives in
`src/backend/shared/hmi/lib/` (shared surface) and is compiled by STruC++ as its own library; its `{external}` code
includes `hmi_core.h`.

## Generated unit

`unit/hmi_unit.h` is what a generated HMI unit gives the host that runs it: one program instance per viewer with its
role, the tag table with read and write accessors for the PLC variables screens use, and the project's frame period,
panel PIN and relock time. `unit/hmi_preview.h` adds the live property setters only the editor's preview links. The
editor's generator (`src/backend/shared/hmi/unit/`) writes the unit.

## Tests (in openplc-editor)

`npm run test:hmi-core` (or `node tests/hmi-core/run.mjs`, see the options at the top of that file) builds the
golden scenes and the unit tests with gcc, clang and WebAssembly (`-Wall -Wextra -Werror`), checks every target
against `tests/hmi-core/golden.txt` with both font variants, and runs the fuzzer under AddressSanitizer and UndefinedBehaviorSanitizer.
`--png <dir>` writes the scenes as images. After an intended rendering change, review the images and run with
`--update`.

`npm run test:hmi-lib` (`tests/hmi-lib/run.mjs`) compiles the library and test screens with STruC++, builds them with
this core on gcc and clang (plus a build under AddressSanitizer and UndefinedBehaviorSanitizer), drives scripted
input and checks every frame against `tests/hmi-lib/golden.txt`.

`npm run test:hmi-preview` (`tests/hmi-preview/run.ts`) builds a sample project's preview with the shared preview
build and the in-editor WebAssembly toolchain, runs it through the preview host, and checks frames, band skipping,
live setters, navigation, the widget-block preview and how long rebuilds take after each kind of edit.

`npm run test:hmi-unit` (`tests/hmi-unit/run.mjs`) generates a sample project's unit, builds it with this core and a
C host that uses only `unit/hmi_unit.h` and `unit/hmi_preview.h`, and checks its frames, writes (range clamping
included), navigation and role grid against `tests/hmi-unit/golden.txt`, also under the sanitizers.
