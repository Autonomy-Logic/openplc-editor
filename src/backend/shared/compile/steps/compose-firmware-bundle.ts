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
  /** Pre-authored `defines.h` content. */
  definesH: string
  /** Pre-authored `vpp_config.h` content for arduino-cli targets whose VPP package declares `vppIo: true`. */
  vppConfigH?: string
  /** Pre-authored `opcua_config.h` content for baremetal targets whose VPP
   *  declares `opcuaServer: true`.  Caller invokes
   *  `generateOpcUaHeaderContent`; absent / undefined when the target cannot
   *  host an OPC-UA server at all.  Always overwrites `src/opcua_config.h`
   *  when present — the firmware skeleton ships a stub with
   *  `OPCUA_ENABLED 0`, so the runtime's OPC-UA translation units
   *  `#include "opcua_config.h"` unconditionally and compile to nothing on
   *  every target that has no server. */
  opcuaConfigH?: string
  /** Generated `s7comm_config.h`, on the same contract: the firmware skeleton
   *  ships a stub with `S7COMM_ENABLED 0`, so the S7 translation units
   *  `#include "s7comm_config.h"` unconditionally and compile to nothing on
   *  every target that has no server. */
  s7commConfigH?: string
  /** Generated `modbus_master_config.h`, on the same contract: the firmware skeleton
   *  ships a stub with `MB_MASTER_ENABLED 0`, so the master translation units
   *  `#include "modbus_master_config.h"` unconditionally and compile to nothing
   *  on every target that runs no master. */
  modbusMasterConfigH?: string
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
export function buildCBlocksFromPous(
  originalCppPous: CppPouDataCode[],
  userTypeNames: Iterable<string> = [],
): ComposeFirmwareBundleInput['cBlocks'] {
  if (originalCppPous.length === 0) {
    return { header: '// Empty file\n', code: null }
  }
  const headers: CppPouDataHeader[] = originalCppPous.map((pou) => ({
    name: pou.name,
    variables: pou.variables,
  }))
  return {
    header: generateCBlocksHeader(headers, userTypeNames),
    code: generateCBlocksCode(originalCppPous, userTypeNames),
  }
}

// Included from src/ units (runtime glue, HALs); arduino-cli hides the sketch dir from library builds.
const VENDOR_FACING_CONTRACT_HEADERS = ['openplc_retain.h'] as const

/** Assemble the firmware file tree. */
export function composeFirmwareBundle(input: ComposeFirmwareBundleInput): Record<string, string> {
  const {
    strucppFiles,
    cBlocks,
    definesH,
    vppConfigH,
    opcuaConfigH,
    s7commConfigH,
    modbusMasterConfigH,
    firmwareSkeleton,
  } = input

  const files: Record<string, string> = { ...firmwareSkeleton }

  for (const header of VENDOR_FACING_CONTRACT_HEADERS) {
    const content = files[`examples/Baremetal/${header}`]
    if (typeof content === 'string') files[`src/${header}`] = content
  }

  for (const [filename, content] of Object.entries(strucppFiles)) {
    files[`src/${filename}`] = content
  }

  files['src/c_blocks.h'] = cBlocks.header

  if (cBlocks.code !== null) {
    files['src/c_blocks_code.cpp'] = cBlocks.code
  }

  files['src/defines.h'] = definesH

  if (vppConfigH !== undefined) {
    files['src/vpp_config.h'] = vppConfigH
  }

  if (opcuaConfigH !== undefined) {
    files['src/opcua_config.h'] = opcuaConfigH
  }

  if (s7commConfigH !== undefined) {
    files['src/s7comm_config.h'] = s7commConfigH
  }

  if (modbusMasterConfigH !== undefined) {
    files['src/modbus_master_config.h'] = modbusMasterConfigH
  }

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
