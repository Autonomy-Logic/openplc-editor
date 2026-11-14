import type { WasmCompileRequest, WasmCompileUnit } from '../../../../middleware/shared/ports/wasm-toolchain-types'
import { addInoPrototypes } from './ino-prototypes'

/** The sketch in the firmware files, and the translation unit it becomes. */
export const SIMULATOR_SKETCH = 'examples/Baremetal/Baremetal.ino'
export const SIMULATOR_SKETCH_UNIT = 'examples/Baremetal/Baremetal.cpp'
/** Where the firmware skeleton carries the simulator's host shim, its `Arduino.h` and the ArduinoCore-API. */
export const SIMULATOR_SUPPORT_DIR = 'wasm-sim'
export const SIMULATOR_MODULE = 'simulator.wasm'

/** Runtime units left out: the network stack and the Modbus TCP, OPC UA and S7 servers. Modbus RTU stays. */
const EXCLUDED_RUNTIME_UNIT = /^examples\/Baremetal\/(baremetal_net|modbus_tcp|opcua_[\w]+|s7comm_server)\.cpp$/
const SUPPORT_UNITS = [
  `${SIMULATOR_SUPPORT_DIR}/sim_main.cpp`,
  `${SIMULATOR_SUPPORT_DIR}/sim_python.cpp`,
  `${SIMULATOR_SUPPORT_DIR}/core/api/Common.cpp`,
  `${SIMULATOR_SUPPORT_DIR}/core/api/Print.cpp`,
  `${SIMULATOR_SUPPORT_DIR}/core/api/Stream.cpp`,
  `${SIMULATOR_SUPPORT_DIR}/core/api/String.cpp`,
]

/**
 * C++ flags for every unit: the dialect STruC++ generates for, the Arduino API include paths, no warnings, and the
 * Python block loader the generated stubs call, force-included as the runtime does.
 */
export const SIMULATOR_CXX_FLAGS = [
  '-std=gnu++17',
  '-O1',
  '-fno-exceptions',
  '-fno-rtti',
  '-w',
  '-DARDUINO=10819',
  '-DARDUINO_ARCH_WASM',
  `-I${SIMULATOR_SUPPORT_DIR}/stub`,
  '-include',
  `${SIMULATOR_SUPPORT_DIR}/stub/iec_python.h`,
  `-I${SIMULATOR_SUPPORT_DIR}/core`,
  '-Isrc',
  '-Iexamples/Baremetal',
]

/** A reactor module the host drives, with 16 MiB of memory to start and room to grow to 256 MiB. */
export const SIMULATOR_LINK_FLAGS = [
  '-mexec-model=reactor',
  '-O1',
  '-fno-exceptions',
  '-Wl,--initial-memory=16777216',
  '-Wl,--max-memory=268435456',
]

export type SimulatorWasmRequestResult = { ok: true; request: WasmCompileRequest } | { ok: false; error: string }

const isCppUnit = (path: string): boolean =>
  /^src\/[^/]+\.cpp$/.test(path) ||
  (/^examples\/Baremetal\/[^/]+\.cpp$/.test(path) && !EXCLUDED_RUNTIME_UNIT.test(path))

/**
 * Lays the composed firmware files out as one WebAssembly compile request: the sketch becomes a C++ unit with
 * `Arduino.h` included and its prototypes generated, the runtime and the project's units are compiled, the
 * network parts are left out, and the simulator's host shim and Arduino core are linked in.
 */
export function buildSimulatorWasmRequest(firmwareFiles: Record<string, string>): SimulatorWasmRequestResult {
  const sketch = firmwareFiles[SIMULATOR_SKETCH]
  if (sketch === undefined) return { ok: false, error: `The firmware files have no '${SIMULATOR_SKETCH}'.` }
  const missing = SUPPORT_UNITS.find((path) => firmwareFiles[path] === undefined)
  if (missing !== undefined) return { ok: false, error: `The simulator support file '${missing}' is missing.` }
  if (firmwareFiles[SIMULATOR_SKETCH_UNIT] !== undefined) {
    return { ok: false, error: `The firmware files already have a '${SIMULATOR_SKETCH_UNIT}'.` }
  }

  const files: Record<string, string> = {}
  for (const [path, content] of Object.entries(firmwareFiles)) {
    if (path !== SIMULATOR_SKETCH) files[path] = content
  }
  files[SIMULATOR_SKETCH_UNIT] = [
    '#include <Arduino.h>',
    `#line 1 "${SIMULATOR_SKETCH}"`,
    addInoPrototypes(sketch, SIMULATOR_SKETCH),
  ].join('\n')

  const units: WasmCompileUnit[] = [...Object.keys(files).filter(isCppUnit).sort(), ...SUPPORT_UNITS].map((source) => ({
    source,
    language: 'c++',
  }))

  return {
    ok: true,
    request: {
      files,
      units,
      cxxFlags: SIMULATOR_CXX_FLAGS,
      linkFlags: SIMULATOR_LINK_FLAGS,
      output: SIMULATOR_MODULE,
    },
  }
}
