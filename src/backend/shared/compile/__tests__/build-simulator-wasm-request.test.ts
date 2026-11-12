import {
  buildSimulatorWasmRequest,
  SIMULATOR_CXX_FLAGS,
  SIMULATOR_LINK_FLAGS,
  SIMULATOR_MODULE,
} from '../steps/build-simulator-wasm-request'

const SUPPORT = {
  'wasm-sim/sim_main.cpp': '// shim',
  'wasm-sim/stub/Arduino.h': '// arduino',
  'wasm-sim/core/api/Common.cpp': '// common',
  'wasm-sim/core/api/Print.cpp': '// print',
  'wasm-sim/core/api/Stream.cpp': '// stream',
  'wasm-sim/core/api/String.cpp': '// string',
  'wasm-sim/core/api/IPAddress.cpp': '// not linked',
}

const firmware = (extra: Record<string, string> = {}): Record<string, string> => ({
  'examples/Baremetal/Baremetal.ino': 'void setup() { helper(); }\nvoid helper() {}\nvoid loop() {}\n',
  'examples/Baremetal/modbus_serial.cpp': '// rtu',
  'examples/Baremetal/modbus_tcp.cpp': '// tcp',
  'examples/Baremetal/baremetal_net.cpp': '// net',
  'examples/Baremetal/opcua_server.cpp': '// opcua',
  'examples/Baremetal/opcua_nodes.cpp': '// opcua',
  'examples/Baremetal/s7comm_server.cpp': '// s7',
  'examples/Baremetal/modbus_types.h': '// header',
  'src/generated.cpp': '// program',
  'src/arduino.cpp': '// hal',
  'src/defines.h': '#define SIMULATOR_MODE',
  ...SUPPORT,
  ...extra,
})

const unitsOf = (files: Record<string, string>): string[] => {
  const built = buildSimulatorWasmRequest(files)
  if (!built.ok) throw new Error(built.error)
  return built.request.units.map((unit) => unit.source)
}

describe('buildSimulatorWasmRequest', () => {
  it('compiles the runtime, the program and the support units, and leaves the network parts out', () => {
    expect(unitsOf(firmware())).toEqual([
      'examples/Baremetal/Baremetal.cpp',
      'examples/Baremetal/modbus_serial.cpp',
      'src/arduino.cpp',
      'src/generated.cpp',
      'wasm-sim/sim_main.cpp',
      'wasm-sim/core/api/Common.cpp',
      'wasm-sim/core/api/Print.cpp',
      'wasm-sim/core/api/Stream.cpp',
      'wasm-sim/core/api/String.cpp',
    ])
  })

  it('turns the sketch into a C++ unit with Arduino.h, its prototypes and line markers', () => {
    const built = buildSimulatorWasmRequest(firmware())
    if (!built.ok) throw new Error(built.error)
    const unit = built.request.files['examples/Baremetal/Baremetal.cpp']

    expect(built.request.files['examples/Baremetal/Baremetal.ino']).toBeUndefined()
    expect(unit).toBe(
      [
        '#include <Arduino.h>',
        '#line 1 "examples/Baremetal/Baremetal.ino"',
        'void helper();',
        '#line 1 "examples/Baremetal/Baremetal.ino"',
        'void setup() { helper(); }',
        'void helper() {}',
        'void loop() {}',
        '',
      ].join('\n'),
    )
  })

  it('keeps every other file as an input, headers and unused sources included', () => {
    const built = buildSimulatorWasmRequest(firmware())
    if (!built.ok) throw new Error(built.error)

    expect(built.request.files['examples/Baremetal/modbus_types.h']).toBe('// header')
    expect(built.request.files['examples/Baremetal/modbus_tcp.cpp']).toBe('// tcp')
    expect(built.request.files['wasm-sim/core/api/IPAddress.cpp']).toBe('// not linked')
  })

  it('builds a reactor module with the simulator flags', () => {
    const built = buildSimulatorWasmRequest(firmware())
    if (!built.ok) throw new Error(built.error)

    expect(built.request.output).toBe(SIMULATOR_MODULE)
    expect(built.request.cxxFlags).toEqual(SIMULATOR_CXX_FLAGS)
    expect(built.request.linkFlags).toEqual(SIMULATOR_LINK_FLAGS)
    expect(SIMULATOR_CXX_FLAGS).toEqual(expect.arrayContaining(['-std=gnu++17', '-Iwasm-sim/stub', '-Iwasm-sim/core']))
    expect(SIMULATOR_LINK_FLAGS).toContain('-mexec-model=reactor')
  })

  it('compiles the project C/C++ blocks unit when the project has one', () => {
    expect(unitsOf(firmware({ 'src/c_blocks_code.cpp': '// blocks' }))).toContain('src/c_blocks_code.cpp')
  })

  it('refuses firmware files without the sketch', () => {
    const files = firmware()
    delete files['examples/Baremetal/Baremetal.ino']
    expect(buildSimulatorWasmRequest(files)).toEqual({
      ok: false,
      error: "The firmware files have no 'examples/Baremetal/Baremetal.ino'.",
    })
  })

  it('refuses firmware files without a simulator support unit', () => {
    const files = firmware()
    delete files['wasm-sim/core/api/Print.cpp']
    expect(buildSimulatorWasmRequest(files)).toEqual({
      ok: false,
      error: "The simulator support file 'wasm-sim/core/api/Print.cpp' is missing.",
    })
  })

  it('refuses firmware files that already carry the unit the sketch becomes', () => {
    expect(buildSimulatorWasmRequest(firmware({ 'examples/Baremetal/Baremetal.cpp': '// clash' }))).toEqual({
      ok: false,
      error: "The firmware files already have a 'examples/Baremetal/Baremetal.cpp'.",
    })
  })
})
