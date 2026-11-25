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
| `baremetal/` | The HMI host of the Baremetal firmware (`hmi_baremetal.c`, `.h`) and the panel driver contract a board's HAL implements (`hmi_panel.h`) |
| `unit/` | The interface of a generated HMI unit (`hmi_unit.h`), its preview setters and live elements (`hmi_preview.h`), the preview's factory table (`hmi_preview_factory.h`) and the host-side manifest a Runtime v4 HMI host serves values from (`hmi_access.h`) |
| `preview/` | The editor's preview host (`hmi_preview_host.cpp`): one viewer of a unit in a WebAssembly module, frames rasterized in bands with unchanged bands skipped; and its live elements (`hmi_preview_live.cpp`), added to the shown screen without a build |
| `client/` | The Runtime v4 browser client served at `/hmi/`, which runs the screens: the sign-in page, `hmi-client.js` (sign-in, token renewal, the screens' frame loop, input and drawing, the `/api/hmi` value channel), socket.io-client 4.8.1 (MIT) and `hmi_browser_host.cpp`, built with the generated unit, the core and the unit's font table into `hmi.wasm` at each upload |
| `fonts/` | The vetted fonts: OpenPLC Sans (default, ASCII and Latin-1) and Liberation Sans (full); see its README |

## Building

Compile the five `core/*.c` files with `core/` on the include path and `-ffp-contract=off`, plus the font table the
HMI build generates (`hmi_font_table`, from `src/backend/shared/hmi/fonts/font-table-source.ts`; only the faces the
screens use, in the project's font variant). Text is rasterized from the TrueType outlines on every target. An optional
`hmi_config.h` on the include path sets `HMI_DL_CAPACITY`, `HMI_BOUNDS_MAX` and `HMI_BOUNDS_CLIPS_MAX`.

Microcontroller builds define `HMI_STATIC_MEMORY`: the core and the unit glue then use no heap at all, so an HMI that
does not fit fails when the firmware links. Every buffer is static and sized by a macro, with these defaults:

| Macro | Default | Holds |
|---|---|---|
| `HMI_DL_CAPACITY` | 16 KB (64 KB with a heap) | The display list of one frame |
| `HMI_GLYPH_CACHE_BYTES` | 8 KB | Rasterized glyphs |
| `HMI_GLYPH_SCRATCH_BYTES` | 8 KB | A glyph too big for the cache; bigger glyphs are not drawn, cached or not, and the build warns about text sizes that reach them |
| `HMI_STB_ARENA_BYTES` | 24 KB | stb_truetype's memory while it rasterizes one glyph |
| `HMI_RASTER_ROW_MAX` | 1025 | Pixels plus one of the widest polygon row; wider polygons are not drawn |
| `HMI_BOUNDS_MAX` | 160 (512 with a heap) | Elements a frame records for touch |

There, only input elements that reach the screen (with the 28 lu touch margin) are recorded: nothing but pointer
arbitration reads bounds on a device. The glyph cache table has one slot per 64 cache bytes (32 to 256). The
rasterizer keeps its polygon scratch static in every build, so the stack stays small.

`hmi_session_create` returns NULL there (hosts use the default session), and `hmi_unit_create` hands out the one static
program instance.

On every target, a program instance (one per browser on Runtime v4, the only one on a panel) holds one screen slot as
large as the largest screen (`hmi_unit_slot.hpp`, generated). Only the page the viewer shows exists: `HmiMain` builds
its screen in the slot when the page opens (elements numbered from the page's fixed first id) and destroys it when the
viewer leaves, so the program needs the largest screen, not all of them. Screen-local state (a trend's history, a
diagram's pan, unwritten text) restarts when a page opens again; values wired to PLC variables return on the next
frame. Preview live edits reach only the shown screen. `unit/hmi_unit.h` includes `hmi_config.h` too when it is on the include path, so the unit glue sees the
same macros. `HMI_ASSERT` checks internal invariants only when `HMI_DEBUG_ASSERTS` is defined (the tests in
`tests/hmi-core` define it); product builds leave it out.

## Baremetal panels

A firmware build for a board whose package declares the `hmi` capability (a local panel) and a project with screens adds,
flat under the sketch library `src/`: the five core files, the generated unit (its translation units prefixed `hmi_` so
they never collide with the PLC program's), `hmi_unit.h`, the font table of the faces the screens draw (plus the regular
face when the panel has a PIN), `baremetal/`, and an `hmi_config.h` generated from the capability
(`src/backend/shared/hmi/firmware/`): `HMI_STATIC_MEMORY`, `HMI_DL_CAPACITY`, `HMI_GLYPH_CACHE_BYTES`, `HMI_BAND_BYTES`,
`HMI_RASTER_ROW_MAX` (panel width + 1), `HMI_STB_ARENA_BYTES` of the font variant (`HMI_STB_ARENA_BYTES` in
`fonts/vetted-fonts.ts`: 10 KB compact, 24 KB full; `tests/hmi-core` sweeps every glyph at every size against them),
`HMI_BOUNDS_MAX` (one and a half times the 28 lu touch targets the screen holds, in steps of 16, at least 64) and
the panel size, density, touch and color format. The fonts' licence goes
to `HMI-FONTS-LICENSE.txt` in the build folder, not to the firmware. Without screens nothing HMI is added, and
`Baremetal.ino` compiles the HMI out (`__has_include(<hmi_baremetal.h>)`). Arduino toolchains are gcc, so the pragma
in `hmi_text.c` keeps fused multiply-add off there. The screens run in `loop()`; on ESP32, `Baremetal.ino` gives that
task `HMI_BM_LOOP_STACK_BYTES` (16 KB, `hmi_baremetal.h`) instead of the core's 8 KB.

A board's HAL implements `hmi_panel.h`: `hmi_panel_push_band` gets the band as RGBA and may convert it to the panel's
format in place, so a driver needs no buffer of its own.

Every local panel starts on the core's startup screen (`hmi_splash_draw`): the Autonomy logo, drawn as polygons and
rounded rectangles in its own colours whatever the theme, so it needs no image and no font. It shows for 3 s
(`HMI_BM_SPLASH_MS`), and longer while a press that began on it is held; no touch on it reaches the PIN entry or the
screens. The panel firmware always compiles in the regular face, which the startup, calibration and PIN screens use.

A panel whose touch needs calibrating (capability `touchCalibration`, `HMI_PANEL_TOUCH_CAL`) reports raw readings
through `hmi_panel_read_touch_raw` and keeps the calibration through `hmi_panel_store_read`/`_write` (a record of
`HMI_PANEL_STORE_BYTES`: magic, version, the build id, the five raw points, CRC-32). The core's calibration screen
(`hmi_cal_*`) shows before the PIN entry: five crosses, the corners then the centre, each the median of the readings of
one press. The map is four triangles meeting at the centre target, each mapped exactly from its two corners and the
centre, so every target lands exactly and a panel whose readings bend between targets is followed; points that fold
the map (a press out of order, a centre outside the corners, presses that barely moved) start the calibration over.
The host calibrates at startup when the HMI Settings mode asks for it: `once` (only when no valid record is stored),
`upload` (also when the stored record was made under another build, `hmi_build_id`) or `boot` (every startup), right
after the startup screen. A press that begins on the startup screen and is held for 5 s (`HMI_BM_SPLASH_HOLD_MS`), or
`HMI_Calibrate()` from a screen (the designer's "Calibrate touch" action, or any condition such as a PLC input), opens
the calibration again. The record is written in the touch read that finishes a calibration, outside the slack budget,
so that one scan may run late.

`hmi_bm_init` (from `setup()`, before the first scan) brings the panel up, refuses a panel whose size differs from the
one in `hmi_config.h`, creates the program instance, sets the panel PIN and relock time from the unit, and draws the
first frame with no deadline, which measures what frames cost. `hmi_bm_task(slack)` runs from the scan loop with the
time left until the next scan and keeps 1 ms of it free; the HMI may drop frames but never delays a scan, except a
frame that costs more than a whole gap between scans:

- A logic frame starts once the unit's frame period has passed and only when its learned cost fits; it cannot be
  split. Frames without screen code (the PIN entry, a blank frame after a screen fault), screen frames and frames that
  build a screen (the first one, a page change; `hmi_unit_mount_pending`) each have their own learned cost. A frame that
  builds a screen, or a kind not measured yet, starts only at about the beginning of a gap; so does a frame whose cost
  exceeds a whole gap, which would otherwise never run.
- Bands whose hash did not change are neither drawn nor pushed. A band's rows start only when the learned per-row
  raster and push costs fit; the raster gets a deadline that leaves room for the push, and rows that miss it are
  dropped and redrawn later in half as many rows, growing back after a clean band.
- Touch is read every 15 ms, when the learned cost of a read (pressed and released learned apart) fits; otherwise it
  is read at the next call that has room. A release is reported at the last pressed point.

PLC variables are read and written (soft write, no force) through the firmware's debugger functions
(`openplc_debug_size`, `_read`, `_write`) at the addresses the build resolves from the program's `debug-map.json`.
A board without a panel driver links against weak defaults and the HMI stays off.

`openplc-cli compile --hmi-test-readout` (tests only) also defines `HMI_TEST_READOUT`: the firmware then answers the
debugger function codes 0x4F (the current display list in chunks) and 0x50 (frames drawn, bands pushed, scan overruns,
last logic frame and worst band in microseconds, the least free stack of the loop task in bytes, 0xFFFFFFFF where
the platform cannot tell, why the HMI is off (`hmi_bm_off_reason_t`, 0 while it runs) and touch reads postponed).
Product builds contain neither.

## Rules that keep the output identical everywhere

- Geometry, colors and text widths are integers. Floats are used only for text: glyph placement (pen and baseline in
  `hmi_raster_text`) and stb_truetype's glyph rasterization. Number formatting is exact integer arithmetic.
- No fused multiply-add: every build must pass `-ffp-contract=off`. The pragma in `hmi_text.c` protects gcc builds
  only; clang ignores it under `-ffp-contract=fast`, and the text scenes in `tests/hmi-core` fail when that happens.
  `-ffast-math` is refused at compile time.
- Trigonometry comes from constant integer tables.
- Device coordinates are clamped to +-131072 pixels, so every per-pixel product fits 64 bits.

## Widget library

Screens are ST built on StandardWidgets (`standard-widgets`), an ST library over these primitives: the element base,
containers, widgets, the on-screen keyboard, the screen base and the runtime the generated glue drives. Its source
lives in the openplc-hmi-widgets repository, which releases it as a plain STruC++ `.stlib` archive whose chunks record
the HMI core API version they call: `HMI_CORE_API_VERSION` in `core/hmi_core.h`, raised with any change a compiled
library could break on, and mirrored by the editor's TypeScript constant. The editor installs the pinned release into
`vendor/hmi-widgets/` (`npm run setup:hmi-widgets`) and ships it pre-installed; HMI builds provide `hmi_core.h` to
library code, PLC builds do not. Libraries a user installs, or builds from a library project, are used the same way
by a project that lists them: any function block deriving from `HmiElement` is a widget.

Layout is built from containers, which nest freely:

| Container | Lays its children out |
|---|---|
| `HmiVerticalStack` | side by side, left to right |
| `HmiHorizontalStack` | top to bottom |
| `HmiDiagram` | at their X, Y in design units, scaled to the room it gets |

Both stacks extend the abstract `HmiStack` (gap, padding and sizing), and every container extends the abstract
`HmiContainer`. Only containers may sit directly on a screen: an element is put in one with
`Parent := '<container name>'`, and the HMI build refuses a screen that declares any other element without one. The
screen lays its containers out top to bottom. A new screen comes with one `HmiHorizontalStack` that fills it.

Across a stack every child takes the stack's full width or height. Along it, a child with `AutoSize := TRUE` takes
its `Span`: a percent (100 by default) of the length the stack's other children leave, after padding and gaps. While
the spans add up to 100 or less, each child gets exactly its share and the rest stays empty; past 100 every span is
scaled down so the stack is exactly full. A child with `AutoSize` on ignores `PrefWidth`/`PrefHeight`. A child with
`AutoSize := FALSE` keeps its measured size (or `PrefWidth`/`PrefHeight`), ignores `Span`, and shrinks in proportion,
within its minimum, when the stack is too small. Containers, shapes, the gauge and the trend start with `AutoSize` on,
every other widget with it off.

The designer writes `AutoSize := TRUE` and a `Span` on every element it places in a stack, the stack a new screen
comes with included (`Span := 100`): a dropped container takes the span its siblings leave (an equal share when they
leave none), a dropped widget its natural size's share of the stack. Resizing an element with `AutoSize` on changes
only its `Span`; moving it to another stack sets the `Span` that keeps its size there. Inside a diagram, `AutoSize`
and `Span` have no effect.

A widget type sets its own start value for an inherited input with `{attribute 'hmi_default' := 'AutoSize := TRUE'}`
on the block, since a derived block cannot redeclare an input: the widget catalogue shows it as the type's default,
and the HMI build sets it in the screen's generated `Build` on every element that leaves it out of its initializer.
`{attribute 'hmi_enabled_by' := 'AutoSize'}` on an input greys it out in the inspector while that BOOL is off.

## Data widgets

The alarm banner, alarm list, event log and XY plot show PLC data larger than one value. The PLC side is the HmiAlarms
library (`hmi-alarms`, a pre-installed PLC library from the same openplc-hmi-widgets release, in every PLC build):
functions, not function blocks, because they take the program's tables as variable-length arrays (`ARRAY[*]`), which
a STruC++ function block cannot hold. The program sizes its own tables, with no limit set by the library:

- `HMI_ALARM(In, Id, Severity, Message, Table)` once per alarm and scan holds a row of `ARRAY[..] OF HMI_ALARM_ROW`
  while the alarm is active or unacknowledged;
- `HMI_ALARMS(Summary, Table)` once per scan after them applies the acknowledgements the HMI asked for (a row's
  `AckReq`, `Summary.AckTop`, `Summary.AckAll`, all written TRUE by the HMI and cleared here), frees rows that are
  cleared and acknowledged, and fills the `HMI_ALARM_SUMMARY` the banner shows;
- `HMI_ALARM_LOGGER(Table, Events)` after it logs what changed into a ring of `HMI_EVENT_ROW`, and
  `HMI_LOG_EVENT(Message, Kind, Severity, Events)` logs the program's own events (operator actions included).

A widget names its data with a literal STRING input marked `{attribute 'hmi_source' := '<TYPE>'}`
(`Source := 'instance0.Main.Alarms'`). The HMI build checks that the PLC variable is of that kind and generates, per
bound input, a feed block (`HMI__Feed_<Screen>_<Element>_<n>`, an `HmiFeed`) that reads each row's fields with
constant indexes; the screen's `Build` hands it to the widget with `SetFeed`, and the reads count for that screen
alone. A widget with an `AckRow` output gets a write-back of `AckReq` TRUE to the row, one with `AckTop` or `AckAll`
outputs of those requests to the summary, each limited to TRUE in Runtime v4's write lists. Arrays bound this way are
expanded whole, beyond the 32 elements the variable list shows.

`{attribute 'hmi_requires' := '<capability>'}` on a widget names a boolean of the target's capabilities: the designer's
palette leaves the widget out and a device build refuses it when the board lacks it (the preview does not check). The
alarm list and event log require `hmiDataWidgets`, which a VPP declares per device (`devices[].capabilities`) and the
plain Runtime v4 preset turns on.

## Generated unit

`unit/hmi_unit.h` is what a generated HMI unit gives the host that runs it: one program instance per viewer with its
role, the tag table with read and write accessors for the PLC variables screens use, and the project's frame period,
panel PIN and relock time. `unit/hmi_preview.h` adds the live property setters only the editor's preview links. The
editor's generator (`src/backend/shared/hmi/unit/`) writes the unit, and with it which tags each screen reads and
writes (`page-access.ts`, from the instance paths STruC++ resolved) and the roles that may open it.

## Runtime v4

The browser runs the screens; the device serves values. Only a local panel's build carries the panel settings (PIN,
relock time, touch calibration, build id, the PIN entry's face; `panel: true` of the generator): a Runtime v4 artefact
holds none of them, and the core's PIN entry is not linked into `hmi.wasm`, where `HMI_Lock()` does nothing. A Runtime v4 upload's `hmi/` folder
(`src/backend/shared/hmi/artefact/compose-hmi-artefact.ts`, manifest `{"format": 2}`) carries:

- `client/hmi.wasm`: the generated unit, the five core files, the font table and `client/hmi_browser_host.cpp`, built
  with the in-editor WebAssembly toolchain (core flags as above, so the browser draws the same pixels as the preview
  and a panel). The host keeps each tag's value as the device last sent it; a screen's write changes the local value
  at once and is queued for the device, and a value the device sent before it processed that write (its write count
  is behind) is skipped. Its exports also give each frame's element bounds, for effects a browser may draw over the
  screens later. It holds every screen of the project, so the runtime serves it only with a signed-in account's token;
  `hmi-client.js` fetches it with `Authorization: Bearer` after sign-in and returns to the form when it is refused. The
  other client files (sign-in page, script, style, socket.io, licences) carry nothing of the project and stay public.
- `src/hmi_access.h` and the generated `src/hmi_access.c`: data only, no screen code. The tag table with debug
  addresses, each screen's sorted read list, how it writes each tag (the whole value, and the mask of the bits it
  assigns one at a time) and its role bits, the program MD5 and the frame period. A bit assignment (`Tag.3 := ...`)
  reaches the host as a bit write (`hmi_bit_store` in the unit glue, `write_bit` of `hmi_tag_access_t`; the build
  routes STruC++'s read-modify-write of the whole variable through it and refuses to build when it cannot), which the
  runtime applies to the PLC's current value. Each write is tagged with the screen shown when it was made. The write
  entries also carry each screen's static limit per tag (`write-limits.ts`): a two-way widget declares what its
  NewValue can be with `{attribute 'hmi_range' := '<lo>..<hi>'}` (numbers, input names or `last(<list input>)`) or
  `{attribute 'hmi_max_length' := '<input>'}`, resolved from the element's literal properties; an assigned literal
  limits to itself (the numeric input's MinValue and MaxValue default to -1.0E38 and 1.0E38, the gauge zones' "off",
  and it delivers no entry outside them); any other write leaves the tag unlimited on that screen, and the limit is the union of the
  screen's writes. Conditions in screen code (interlocks) cannot be enforced by the runtime: they run in the browser,
  so the PLC program must validate what HMI screens write. The
  runtime's HMI host serves a viewer only the tags of the screen it shows when its role may open it, and applies only
  that screen's writes after checking their type and range (openplc-runtime `docs/HMI.md`).

`hmi_preview.h` also lets the preview change the shown screen's structure without a build. A preview build compiles
the libraries whole and generates a factory table (`unit/hmi_preview_factory.h`, `hmi_preview_factory.cpp`): every
widget type and one setter per input it sets live. `preview/hmi_preview_live.cpp` creates an element from it
(`hmi_unit_live_add`), takes any element, compiled or made, out of its container's children and the screen's drawing
list (`hmi_unit_live_detach`: no layout, drawing or input reaches it) and puts one back where the next build attaches
it (`hmi_unit_live_attach`); new elements are numbered after the screen's elements. When another page is shown, the
host forgets these changes and frees the made elements (`hmi_unit_live_sync`). Product builds (firmware, Runtime v4,
the CLI) generate no factory and never link either file.

## Tests (in openplc-editor)

`npm run test:hmi-core` (or `node tests/hmi-core/run.mjs`, see the options at the top of that file) builds the
golden scenes and the unit tests with gcc, clang and WebAssembly (`-Wall -Wextra -Werror`), checks every target
against `tests/hmi-core/golden.txt` with both font variants, and runs the fuzzer under AddressSanitizer and UndefinedBehaviorSanitizer.
`--png <dir>` writes the scenes as images. After an intended rendering change, review the images and run with
`--update`.

The headless frame tests of the widget library (test screens against the archive, built with this core on gcc and
clang and under the sanitizers) and the scripted test of the HmiAlarms library run in openplc-hmi-widgets
(`npm run test:native`), against this core at the editor commit its `hmi-core.json` pins; `ci-hmi-core.yml` also
runs them against this checkout's core.

`npm run test:hmi-preview` (`tests/hmi-preview/run.ts`) builds a sample project's preview with the shared preview
build and the in-editor WebAssembly toolchain, runs it through the preview host, and checks frames, band skipping,
live setters, navigation, the widget-block preview and how long rebuilds take after each kind of edit. It changes
a running module's structure without a build, as the designer does: elements added, removed (from a stack, a
container with its contents, a diagram), reordered, moved to another stack or on a diagram, and values changed, each
undone and redone, and checks that every step is drawn within `HMI_PREVIEW_LIVE_ADD_MS` (50 ms) without a compile, with
the frame and bounds of the module that step's source builds, and that a tap where a removed button was does nothing.
It prints where each build spent its time.

`npm run test:hmi-baremetal` (`tests/hmi-baremetal/run.mjs`) builds the core, the sample unit and the baremetal host
with `HMI_STATIC_MEMORY` and a fake panel, clock and debugger table, and checks in simulated time that the panel shows
the core's full render of each frame, unchanged bands are not pushed, no call runs past its slack (with a costly touch
read and costly first frames after unlocking and on a page change), the PIN, relock and touch work, a panel of another
size leaves the HMI off, product objects of the host and core reference no heap and carry no test readout, and a board
without a panel driver links with the HMI off. It also builds the firmware's Modbus PDU sources natively against the
simulator's Arduino stub and checks the framing, routing and answers of the readout codes 0x4F and 0x50. The test
programs are sanitized (ASan, UBSan); CI runs it in `ci-hmi-core.yml`.

`npm run test:hmi-client` (`tests/hmi-client/run.ts`) composes the sample project's Runtime v4 artefact with the real
WebAssembly toolchain, checks its files and host-side manifest, drives `hmi.wasm` as `hmi-client.js` does (values, taps,
queued writes, stale values skipped, the role grid) and checks it draws the same pixels as the same sources built
natively.

`npm run test:hmi-unit` (`tests/hmi-unit/run.mjs`) generates a sample project's unit, builds it with this core and a
C host that uses only `unit/hmi_unit.h` and `unit/hmi_preview.h`, and checks its frames, writes (range limits
included), navigation and role grid against `tests/hmi-unit/golden.txt`, also under the sanitizers.
