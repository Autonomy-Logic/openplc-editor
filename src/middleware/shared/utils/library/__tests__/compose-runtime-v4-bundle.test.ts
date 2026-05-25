import type { ComposeRuntimeV4BundleInput } from '../compose-runtime-v4-bundle'
import { composeRuntimeV4Bundle } from '../compose-runtime-v4-bundle'

function baseInput(overrides: Partial<ComposeRuntimeV4BundleInput> = {}): ComposeRuntimeV4BundleInput {
  return {
    programSt: 'PROGRAM Main\nEND_PROGRAM\n',
    md5: 'deadbeefdeadbeefdeadbeefdeadbeef',
    strucppFiles: {
      'generated.cpp': '// generated\n',
      'generated.hpp': '// header\n',
      'generated_debug.cpp': '// debug\n',
      'debug-map.json': '{"version":2,"leaves":[]}',
    },
    cBlocks: {
      header: '// Empty file\n',
      code: null,
    },
    strucppRuntimeHeaders: {
      'strucpp_runtime/include/iec_std_lib.hpp': '// iec_std_lib\n',
      'strucpp_runtime/include/debug_dispatch.hpp': '// debug_dispatch\n',
    },
    confs: {
      modbusSlave: null,
      modbusMaster: null,
      s7Comm: null,
      opcUa: null,
      ethercat: '{"masters":[]}',
    },
    ...overrides,
  }
}

describe('composeRuntimeV4Bundle', () => {
  it('writes program.st at the zip root', () => {
    const files = composeRuntimeV4Bundle(baseInput())
    expect(files['program.st']).toBe('PROGRAM Main\nEND_PROGRAM\n')
  })

  it('passes strucpp emitted files through at root keys', () => {
    const files = composeRuntimeV4Bundle(baseInput())
    expect(files['generated.cpp']).toBe('// generated\n')
    expect(files['generated.hpp']).toBe('// header\n')
    expect(files['generated_debug.cpp']).toBe('// debug\n')
    expect(files['debug-map.json']).toBe('{"version":2,"leaves":[]}')
  })

  it('places strucpp runtime headers under strucpp_runtime/include/', () => {
    const files = composeRuntimeV4Bundle(baseInput())
    expect(files['strucpp_runtime/include/iec_std_lib.hpp']).toBe('// iec_std_lib\n')
    expect(files['strucpp_runtime/include/debug_dispatch.hpp']).toBe('// debug_dispatch\n')
  })

  it('emits defines.h with PROGRAM_MD5', () => {
    const files = composeRuntimeV4Bundle(baseInput())
    expect(files['defines.h']).toBe(
      '#pragma once\n// Program MD5\n#define PROGRAM_MD5 "deadbeefdeadbeefdeadbeefdeadbeef"\n',
    )
  })

  it('emits an empty c_blocks.h stub when no C/C++ POUs', () => {
    const files = composeRuntimeV4Bundle(baseInput())
    expect(files['c_blocks.h']).toBe('// Empty file\n')
    // No c_blocks_code.cpp when nothing to compile.
    expect('c_blocks_code.cpp' in files).toBe(false)
  })

  it('writes both c_blocks.h and c_blocks_code.cpp when caller supplies both', () => {
    const files = composeRuntimeV4Bundle(
      baseInput({
        cBlocks: {
          header: '// header for MyBlock\n',
          code: '// code for MyBlock\n',
        },
      }),
    )
    expect(files['c_blocks.h']).toBe('// header for MyBlock\n')
    expect(files['c_blocks_code.cpp']).toBe('// code for MyBlock\n')
  })

  it('omits each conf/*.json that is null (project does not use that protocol)', () => {
    const files = composeRuntimeV4Bundle(baseInput())
    expect('conf/modbus_slave.json' in files).toBe(false)
    expect('conf/modbus_master.json' in files).toBe(false)
    expect('conf/s7comm.json' in files).toBe(false)
    expect('conf/opcua.json' in files).toBe(false)
    // ethercat is always emitted (always non-null on input).
    expect(files['conf/ethercat.json']).toBe('{"masters":[]}')
  })

  it('writes each conf/*.json that is provided', () => {
    const files = composeRuntimeV4Bundle(
      baseInput({
        confs: {
          modbusSlave: '{"slaves":[{"id":1}]}',
          modbusMaster: '{"masters":[]}',
          s7Comm: '{"servers":[]}',
          opcUa: '{"endpoints":[]}',
          ethercat: '{"masters":[]}',
        },
      }),
    )
    expect(files['conf/modbus_slave.json']).toBe('{"slaves":[{"id":1}]}')
    expect(files['conf/modbus_master.json']).toBe('{"masters":[]}')
    expect(files['conf/s7comm.json']).toBe('{"servers":[]}')
    expect(files['conf/opcua.json']).toBe('{"endpoints":[]}')
    expect(files['conf/ethercat.json']).toBe('{"masters":[]}')
  })

  it('produces the file set runtime compile.sh check_required_files asserts', () => {
    // Hard contract: runtime's `core/scripts/compile.sh` exits 1 when
    // any of generated.hpp / at-least-one-*.cpp / strucpp_runtime/include
    // is missing.  Pin those assertions explicitly so future input
    // shape changes don't silently regress the upload contract.
    const files = composeRuntimeV4Bundle(baseInput())
    expect('generated.hpp' in files).toBe(true)
    expect(Object.keys(files).some((p) => p.endsWith('.cpp'))).toBe(true)
    expect(Object.keys(files).some((p) => p.startsWith('strucpp_runtime/include/'))).toBe(true)
  })

  it('returns a fresh file map per call (does not mutate input)', () => {
    const input = baseInput()
    const originalStrucpp = { ...input.strucppFiles }
    const originalHeaders = { ...input.strucppRuntimeHeaders }
    composeRuntimeV4Bundle(input)
    expect(input.strucppFiles).toEqual(originalStrucpp)
    expect(input.strucppRuntimeHeaders).toEqual(originalHeaders)
  })
})
