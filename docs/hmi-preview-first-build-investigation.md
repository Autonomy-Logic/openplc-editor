# HMI preview and simulator builds: what makes the first build fast

What this branch ships, in the editor and in openplc-web, to shorten the HMI preview's first build and the OpenPLC
Simulator's rebuild. The code is shared and byte-identical between the two repositories unless a platform is named.

## Library objects next to each library

- Each library that declares widgets compiles from one whole unit generated from its `.stlib` and its dependencies
  (`backend/shared/library/library-unit.ts`, HMI wrapper `backend/shared/hmi/lib-object/library-unit.ts`), so a
  library gives the same object in every project, in the preview and in `hmi.wasm`. Its preview factory table is
  generated from the library alone and compiled with it (`<library>_factory.cpp`).
- A library's unit carries a tag whose key is a digest of the archive, its dependencies' archives, the kind (`hmi`,
  `hmi-factory`, `simulator`), the unit's flags and the provided header versions (`libraryObjectKey`). The compile
  service offers the object kept for the library when the key and the toolchain match, and writes back the object a
  build used when it differs. The object cache still checks every file the object was built from, so a stale object is
  never linked.
- Desktop: `<userData>/libraries/<name>/<base>.<kind>.wasm-object` next to a user-installed `<base>.stlib`, named by
  the shared `libraryObjectFileName`. Web: the IndexedDB store `openplc-library-objects`, keyed by kind and library.
  Bundled libraries keep nothing there; they use the shipped objects.

## Shipped objects

- `npm run build:hmi-objects` (part of `npm run build`) compiles, with the editor's own toolchain: the HMI core, font
  tables, hosts, the live elements, each bundled widget library and its factory table, the OpenPLC Simulator units of
  the bundled PLC libraries, and every object of the default palette gallery in each font variant (`compact`, `full`):
  its screen, glue and factory groups and its linked module. On this branch that is 29 objects, 8.0 MB.
- Output: editor `release/hmi-objects/` (packaged as the extra resource `hmi-objects`), web `vendor/hmi-objects/`.
  Neither is committed.
- A set built by another toolchain is ignored. An object whose sources changed (another HMI core API, another STruC++
  runtime) misses the cache and compiles.

## Lean STruC++ includes

- STruC++ is pinned to 0.8.1-rc3, which carries the lean runtime and generated includes and undefines only the C
  standard library macros the generated code uses.
- The generated HMI slot header and glue do not include `<algorithm>`.

## Precompiled prelude

- `build:hmi-objects` takes the opening of the default gallery's unit header (`hmi_unit.hpp`), up to and including the
  line `#include "hmi_unit_libraries.hpp"`, and compiles it as a C++ header with the preview's C++ flags
  (`buildHmiPrelude`). It ships `hmi_prelude.pch` and `hmi_prelude.json` with the other objects.
- Key: `hmi_prelude.json` records the toolchain identity, the prelude text, the libraries header, the exact clang flags
  it was compiled with (target included), the SHA-256 of the precompiled header, and the SHA-256 of every request file
  clang read for it.
- Load (`loadHmiPrelude`): only when the toolchain identity is the same, the flags equal those of the preview units
  (`HMI_PREVIEW_PRELUDE_FLAGS`: the target and `HMI_PREVIEW_CXX_FLAGS`), the precompiled header has the recorded
  digest, and every file it read is unchanged among the preview's runtime headers and HMI sources. Otherwise the preview
  runs without it.
- Match (`hmiPreludeFits`): a build uses it only when its unit header opens with the prelude text, over the same
  libraries header, and the flags are equal. Every group but the factory then compiles with `-include-pch`; the
  factory, the host, the live elements, the C core and the library units compile without it.
- Cache: clang lists headers read through a precompiled header as absolute paths and never lists the `.pch`. The object
  cache records such a path as the request file it names, and records the `-include-pch` file itself, so a change to
  the prelude or to a header inside it recompiles the units built from it.
- Fallback: when a build that used the prelude fails to compile, the preview compiles it once more without the prelude
  and reports that build's result.

## OpenPLC Simulator: library units and `program_md5.h`

- Only the simulator build asks STruC++ for separate library files. Each library the program reaches, and its
  dependencies, compiles from its own whole unit (`compile/steps/simulator-library-units.ts`, under `simlib/`), tagged
  like the HMI library units, so a user library's object is kept next to it and the bundled ones are shipped. Runtime
  v3/v4, baremetal and the debug compile keep their output.
- The program's MD5 is in `src/program_md5.h` (`generateProgramMd5Header`), which only `Baremetal.ino` and
  `modbus_debug.cpp` include, no longer in `defines.h`. A program edit therefore leaves the runtime units that include
  `defines.h` cached. Runtime v4's own `defines.h` is unchanged.

## Measured

Before and after this branch:

| Case | Before | After |
| --- | ---: | ---: |
| HMI preview, blank screen, first open, desktop | 2.35-3.21 s | 1.54-2.17 s |
| HMI preview, blank screen, first open, web | 2.60-2.68 s | 1.03-1.04 s |
| Simulator rebuild after a one-line edit | 12 of 23 units, 7.4-9.5 s | 3 of 23 units, 2.5-2.6 s |

## Re-measuring

The `hmi-first-build-timing` specs time a screen's click to its first frame in three sessions on one profile (a fresh
profile, then two restarts) and append one JSON line per session to `FB_OUT`. They are local measurements, skipped
unless `FB_RUN` is set.

Editor, after a production build and the preload copy described in CLAUDE.md "Electron e2e":

```bash
FB_RUN=1 FB_OUT=/path/results.jsonl npx playwright test e2e/hmi-first-build-timing.spec.ts --workers=1
```

Web: the same command with `--project=chromium`; Playwright starts the dev server, or set `FB_URL`.

These specs do not measure the simulator rebuild.
