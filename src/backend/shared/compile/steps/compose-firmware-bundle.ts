/**
 * Compose the simulator / Arduino firmware compile bundle.
 *
 * Canonical, pure function that assembles every file `arduino-cli
 * compile` needs to see: the firmware skeleton (`Baremetal.ino`,
 * Arduino-core headers, simulator HAL), strucpp's emitted artefacts,
 * the `c_blocks.h` / `c_blocks_code.cpp` pair, and `defines.h`.
 *
 * **Single source of truth for the firmware-compile file layout.**
 * Both repos used to assemble this layout independently — editor via
 * scattered `writeFile` calls across `copyStaticFiles` /
 * `handleGenerateCBlocksHeader` / `handleGenerateCBlocksCode` /
 * `handleGenerateDefinitionsFile` / `handleGenerateArduinoCppFile`,
 * web via inline assembly into `arduinoFiles` in the simulator
 * branch.  The duplication drifted (the C/C++ POU bug that surfaced
 * recently was a symptom).  Routing both through this composer
 * makes drift impossible: change a key here and both platforms
 * pick it up.
 *
 * Side effects: none.  No disk I/O, no HTTP, no DOM.  Inputs in,
 * `Record<string, string>` out.  The caller (editor:
 * `compiler-module.ts`'s `compileArduino` flow; web:
 * `compiler-adapter.ts`'s simulator branch) decides what to do
 * with the result — editor writes each entry to disk under
 * `build/<target>/`, web POSTs the whole map to the centralised
 * compiler service.
 *
 * Input shape mirrors `composeRuntimeV4Bundle` so the two
 * composers feel symmetric and a future shared pipeline can flow
 * from one to the other without re-deriving inputs.
 */

import type { CppPouData as CppPouDataCode } from '../../utils/cpp/generateCBlocksCode'
import { generateCBlocksCode } from '../../utils/cpp/generateCBlocksCode'
import type { CppPouData as CppPouDataHeader } from '../../utils/cpp/generateCBlocksHeader'
import { generateCBlocksHeader } from '../../utils/cpp/generateCBlocksHeader'

export interface ComposeFirmwareBundleInput {
  /** Strucpp emitted artefacts (key = filename at zip root, value
   *  = file content).  Same map `runProgramBuildPipeline` returns:
   *  `generated.cpp`, `generated.hpp`, `generated_debug.cpp`,
   *  `debug-map.json`, per-POU `*.cpp` splits, `program.st.map.json`. */
  strucppFiles: Record<string, string>
  /** Pre-rendered C blocks artefacts.  See `composeRuntimeV4Bundle`
   *  for the same contract:
   *    - `header`: required.  Empty / no-cpp projects pass
   *      `'// Empty file\n'` (the static stub from
   *      `src/assets/firmware/arduino/c_blocks.h`).
   *    - `code`: pass `null` when the project has no C/C++ POUs
   *      so the composer leaves the static baseline at
   *      `examples/Baremetal/c_blocks_code.cpp` alone.  Otherwise
   *      pass `generateCBlocksCode(originalCppPous)` and the
   *      static file gets overwritten with the user-facing version. */
  cBlocks: {
    header: string
    code: string | null
  }
  /** Pre-authored `defines.h` content.  Caller invokes the shared
   *  `generateDefinesContent` to produce this — the composer keeps
   *  it opaque so a future re-shaping of `defines.h` content
   *  doesn't ripple through. */
  definesH: string
  /** Pre-authored `vpp_config.h` content for arduino-cli targets
   *  whose VPP package declares `vppIo: true` (Arduino Opta, P1AM,
   *  future arduino-toolchain VPPs).  Caller invokes
   *  `generateVppConfigContent` to produce this; absent / undefined
   *  when the board doesn't ship a VPP config header.  Always
   *  overwrites `src/vpp_config.h` when present — the firmware
   *  skeleton ships a placeholder stub so naive `#include "vpp_config.h"`
   *  in shared HAL code still compiles on non-VPP boards. */
  vppConfigH?: string
  /** Firmware skeleton: the bundled set of base files arduino-cli
   *  needs but the user doesn't see (`Baremetal.ino`, the Arduino
   *  HAL, strucpp runtime headers, simulator HAL adapter).  Each
   *  platform provides this differently — editor copies from
   *  `resources/sources/...` at build time, web reads from
   *  `src/assets/firmware/...` via Vite's `import.meta.glob`.  The
   *  contents should be byte-identical between repos (enforced by
   *  the Shared Surface Sync CI check). */
  firmwareSkeleton: Record<string, string>
}

/**
 * Per-POU header metadata used by `generateCBlocksHeader`.  Re-exported
 * so callers (and tests) don't have to chase the original module to
 * understand the shape they're passing through.
 */
export type CBlocksHeaderPou = CppPouDataHeader
/** Per-POU code metadata used by `generateCBlocksCode`. */
export type CBlocksCodePou = CppPouDataCode

/**
 * Helper for the common "I have `originalCppPous`, give me the
 * `cBlocks` input shape" case.  Caller can either use this or hand
 * the composer the pre-rendered strings directly.
 */
export function buildCBlocksFromPous(originalCppPous: CppPouDataCode[]): ComposeFirmwareBundleInput['cBlocks'] {
  if (originalCppPous.length === 0) {
    // Editor's behaviour: leave the static `c_blocks.h` baseline
    // in place (`null` here means the composer skips the write).
    // Static `c_blocks_code.cpp` likewise stays untouched.
    return { header: '// Empty file\n', code: null }
  }
  const headers: CppPouDataHeader[] = originalCppPous.map((pou) => ({
    name: pou.name,
    variables: pou.variables,
  }))
  return {
    header: generateCBlocksHeader(headers),
    code: generateCBlocksCode(originalCppPous),
  }
}

/**
 * Assemble the firmware file tree.
 *
 * Layout produced (paths relative to project root):
 *  - `examples/Baremetal/Baremetal.ino`              — from skeleton
 *  - `examples/Baremetal/c_blocks_code.cpp`          — overwritten when `cBlocks.code !== null`
 *  - `examples/Baremetal/modules/...`                — from skeleton (Arduino library helpers)
 *  - `src/arduino.cpp`                               — from skeleton (HAL adapter, simulator-specific)
 *  - `src/c_blocks.h`                                — written verbatim from `cBlocks.header`
 *  - `src/defines.h`                                 — written verbatim from `definesH`
 *  - `src/<strucpp-emitted-file>`                    — every key from `strucppFiles`
 *  - `src/<strucpp-runtime-header>.hpp`              — from skeleton (strucpp runtime headers)
 *  - other skeleton entries                          — passed through verbatim
 *
 * Ordering: skeleton first, then overwrites.  Strucpp output
 * overwrites any same-named skeleton file (strucpp generally adds
 * new files; collisions are intentional when they happen).
 * `c_blocks.h` and `defines.h` overwrite the skeleton's static
 * stubs.  `c_blocks_code.cpp` is overwritten ONLY when the project
 * has C/C++ POUs — otherwise the static baseline stays.
 */
export function composeFirmwareBundle(input: ComposeFirmwareBundleInput): Record<string, string> {
  const { strucppFiles, cBlocks, definesH, vppConfigH, firmwareSkeleton } = input

  // Skeleton first (every Baremetal.ino, arduino HAL, strucpp
  // runtime header, etc.).  Subsequent overwrites replace specific
  // entries.
  const files: Record<string, string> = { ...firmwareSkeleton }

  // Strucpp output lands under `src/` alongside the runtime glue
  // — arduino-cli's `--library src` pass picks every TU there into
  // libsketch.
  for (const [filename, content] of Object.entries(strucppFiles)) {
    files[`src/${filename}`] = content
  }

  // C blocks header always overwrites: empty projects pass
  // `'// Empty file\n'`; non-empty pass the strucpp-friendly
  // declarations.  The static baseline in the skeleton at
  // `src/c_blocks.h` is harmless either way — this overwrite
  // resolves which one wins.
  files['src/c_blocks.h'] = cBlocks.header

  // C blocks code overwrites ONLY when the project has C/C++ POUs.
  // For empty projects, the firmware skeleton's static
  // `examples/Baremetal/c_blocks_code.cpp` baseline stays (it's
  // a benign empty unit per the editor's emission, providing
  // helpers the runtime expects regardless of user code).
  if (cBlocks.code !== null) {
    files['examples/Baremetal/c_blocks_code.cpp'] = cBlocks.code
  }

  // defines.h is the authored output of the shared
  // `generateDefinesContent` helper.  Always overwrites — the
  // skeleton ships a stub but this replaces it with the
  // project-specific content (board defines, PROGRAM_MD5, IO Config,
  // library toggles).
  files['src/defines.h'] = definesH

  // vpp_config.h carries the user's configuration-screen data for
  // arduino-cli VPP boards (currently Arduino Opta; P1AM next).
  // Always overwrites when present so a board that JUST opted into
  // vppIo gets the fresh content; non-VPP boards leave the skeleton's
  // placeholder stub in place.  Drivers `#include "vpp_config.h"`
  // unconditionally — the stub guarantees the include resolves on
  // every board, the per-define content varies.
  if (vppConfigH !== undefined) {
    files['src/vpp_config.h'] = vppConfigH
  }

  // OpenPLCUserLib.h stub — Baremetal.ino unconditionally
  // `#include <OpenPLCUserLib.h>` to trigger arduino-cli's
  // library-discovery for the strucpp pipeline.  On the editor's
  // local build path that header lives in a separately-staged
  // precompiled-archive library tree (see `installAsArduinoLibrary`)
  // and the include resolves through arduino-cli's library search
  // pass.  On the web's compile-service single-pass build the
  // strucpp `.cpp` files live directly under `src/` and are compiled
  // alongside the sketch via `--library src` — no precompiled
  // archive — so the include needs a sibling stub here to satisfy
  // the preprocessor.  Bundling it on the client keeps the editor /
  // web compile flows symmetric without the server needing to know
  // about the precompile/no-precompile distinction.  Real
  // declarations come via `arduino_runtime_glue.h`; the stub is
  // intentionally empty.
  files['src/OpenPLCUserLib.h'] = [
    '// Auto-generated stub for OpenPLCUserLib.',
    "// Resolves Baremetal.ino's `#include <OpenPLCUserLib.h>` in the",
    '// strucpp pipeline.  Real declarations come via',
    '// arduino_runtime_glue.h (already in src/).',
    '#pragma once',
    '',
  ].join('\n')

  return files
}
