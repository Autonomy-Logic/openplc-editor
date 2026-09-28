/**
 * Tests for the shared firmware-bundle composer.
 *
 * This composer is symmetric to `composeRuntimeV4Bundle` but for
 * the simulator/Arduino firmware compile path.  The byte-identical
 * assembly is what the recent C/C++ POU bug was missing — pinning
 * the contract here means a future change to file paths or overwrite
 * semantics surfaces as a test failure rather than as a cryptic
 * arduino-cli link error.
 */

import { buildCBlocksFromPous, composeFirmwareBundle } from '../steps/compose-firmware-bundle'

const baseInput = {
  strucppFiles: {},
  cBlocks: { header: '// Empty file\n', code: null as string | null },
  definesH: '#define PROGRAM_MD5 ""\n',
  firmwareSkeleton: {},
}

describe('composeFirmwareBundle — skeleton passthrough', () => {
  it('passes every skeleton entry through verbatim when no other inputs are present', () => {
    const skeleton = {
      'examples/Baremetal/Baremetal.ino': 'void setup() {}\nvoid loop() {}\n',
      'src/arduino.cpp': '// HAL adapter\n',
      'examples/Baremetal/modules/Modbus.cpp': '// Modbus helper\n',
    }
    const out = composeFirmwareBundle({ ...baseInput, firmwareSkeleton: skeleton })
    expect(out['examples/Baremetal/Baremetal.ino']).toBe('void setup() {}\nvoid loop() {}\n')
    expect(out['src/arduino.cpp']).toBe('// HAL adapter\n')
    expect(out['examples/Baremetal/modules/Modbus.cpp']).toBe('// Modbus helper\n')
  })

  it('overwrites src/c_blocks.h skeleton entry with the cBlocks header input', () => {
    const skeleton = { 'src/c_blocks.h': '// stub from skeleton\n' }
    const out = composeFirmwareBundle({
      ...baseInput,
      firmwareSkeleton: skeleton,
      cBlocks: { header: 'extern "C" void blink_setup(void *);\n', code: null },
    })
    expect(out['src/c_blocks.h']).toBe('extern "C" void blink_setup(void *);\n')
  })

  it('overwrites src/defines.h skeleton entry with the definesH input', () => {
    const skeleton = { 'src/defines.h': '// stub defines\n' }
    const out = composeFirmwareBundle({
      ...baseInput,
      firmwareSkeleton: skeleton,
      definesH: '#define PROGRAM_MD5 "abc"\n',
    })
    expect(out['src/defines.h']).toBe('#define PROGRAM_MD5 "abc"\n')
  })
})

describe('composeFirmwareBundle — strucpp output', () => {
  it('drops every strucppFiles entry under src/', () => {
    const out = composeFirmwareBundle({
      ...baseInput,
      strucppFiles: {
        'generated.cpp': 'gen_cpp',
        'generated.hpp': 'gen_hpp',
        'generated_debug.cpp': 'gen_dbg',
        'debug-map.json': '{"vars":[]}',
        'pou_BLINK.cpp': 'pou_content',
      },
    })
    expect(out['src/generated.cpp']).toBe('gen_cpp')
    expect(out['src/generated.hpp']).toBe('gen_hpp')
    expect(out['src/generated_debug.cpp']).toBe('gen_dbg')
    expect(out['src/debug-map.json']).toBe('{"vars":[]}')
    expect(out['src/pou_BLINK.cpp']).toBe('pou_content')
  })

  it('strucpp output overwrites same-named skeleton entries', () => {
    const out = composeFirmwareBundle({
      ...baseInput,
      firmwareSkeleton: { 'src/generated.cpp': '// stub\n' },
      strucppFiles: { 'generated.cpp': 'real strucpp output' },
    })
    expect(out['src/generated.cpp']).toBe('real strucpp output')
  })
})

describe('composeFirmwareBundle — c_blocks_code.cpp overwrite semantics', () => {
  it('puts the generated c_blocks_code.cpp under src/, on the pre-compiled side', () => {
    // Not next to the sketch: there arduino-cli builds it at whatever standard
    // the core ships, and this unit includes `generated.hpp`, which needs C++17.
    // On an mbed core (gnu++14) that failed with `'is_arithmetic_v' is not a
    // member of 'std'`; the AVR targets hid it by declaring -std=gnu++17 in
    // their hals.json cxx_flags, which a VPP board such as Opta does not.
    const skeleton = { 'examples/Baremetal/c_blocks_code.cpp': '// static baseline\n' }
    const out = composeFirmwareBundle({
      ...baseInput,
      firmwareSkeleton: skeleton,
      cBlocks: { header: 'h', code: 'void blink_setup(void *) {}\n' },
    })

    expect(out['src/c_blocks_code.cpp']).toBe('void blink_setup(void *) {}\n')
    // The skeleton's own baseline is left alone. It defines no symbols and pulls
    // in no strucpp header, so it compiles at the core's standard regardless.
    expect(out['examples/Baremetal/c_blocks_code.cpp']).toBe('// static baseline\n')
  })

  it('LEAVES examples/Baremetal/c_blocks_code.cpp untouched when cBlocks.code is null', () => {
    // Mirrors editor's "skipping c_blocks_code.cpp generation" path:
    // no C/C++ POUs → static baseline stays.
    const skeleton = { 'examples/Baremetal/c_blocks_code.cpp': '// static baseline kept\n' }
    const out = composeFirmwareBundle({
      ...baseInput,
      firmwareSkeleton: skeleton,
      cBlocks: { header: '// Empty file\n', code: null },
    })
    expect(out['examples/Baremetal/c_blocks_code.cpp']).toBe('// static baseline kept\n')
  })

  it('does not create examples/Baremetal/c_blocks_code.cpp when cBlocks.code is null and skeleton lacks it', () => {
    const out = composeFirmwareBundle({
      ...baseInput,
      firmwareSkeleton: {},
      cBlocks: { header: '// Empty file\n', code: null },
    })
    expect(out['examples/Baremetal/c_blocks_code.cpp']).toBeUndefined()
  })
})

describe('composeFirmwareBundle — full layout snapshot', () => {
  it('produces the canonical simulator file map for a project with C/C++ POUs', () => {
    const out = composeFirmwareBundle({
      firmwareSkeleton: {
        'examples/Baremetal/Baremetal.ino': 'BAREMETAL_INO',
        'examples/Baremetal/c_blocks_code.cpp': 'STATIC_BASELINE',
        'examples/Baremetal/openplc_retain.h': 'RETAIN_CONTRACT',
        'src/arduino.cpp': 'ARDUINO_HAL',
        'src/iec_std_lib.hpp': 'STRUCPP_RUNTIME_HEADER',
      },
      strucppFiles: {
        'generated.cpp': 'GEN_CPP',
        'generated.hpp': 'GEN_HPP',
        'pou_BLINK_CPP.cpp': 'POU_BLINK_CPP',
      },
      cBlocks: { header: 'CBLOCKS_HEADER', code: 'CBLOCKS_CODE_WITH_USER' },
      definesH: 'DEFINES_H',
    })

    expect(out).toEqual({
      'examples/Baremetal/Baremetal.ino': 'BAREMETAL_INO',
      // The skeleton's static baseline survives alongside the generated unit:
      // it defines no symbols and pulls in no strucpp header.
      'examples/Baremetal/c_blocks_code.cpp': 'STATIC_BASELINE',
      'examples/Baremetal/openplc_retain.h': 'RETAIN_CONTRACT',
      'src/openplc_retain.h': 'RETAIN_CONTRACT',
      'src/c_blocks_code.cpp': 'CBLOCKS_CODE_WITH_USER',
      'src/arduino.cpp': 'ARDUINO_HAL',
      'src/iec_std_lib.hpp': 'STRUCPP_RUNTIME_HEADER',
      'src/generated.cpp': 'GEN_CPP',
      'src/generated.hpp': 'GEN_HPP',
      'src/pou_BLINK_CPP.cpp': 'POU_BLINK_CPP',
      'src/c_blocks.h': 'CBLOCKS_HEADER',
      'src/defines.h': 'DEFINES_H',
      'src/OpenPLCUserLib.h': expect.stringContaining('#pragma once') as unknown as string,
    })
  })

  it('produces the canonical simulator file map for a project with NO C/C++ POUs', () => {
    const out = composeFirmwareBundle({
      firmwareSkeleton: {
        'examples/Baremetal/Baremetal.ino': 'BAREMETAL_INO',
        'examples/Baremetal/c_blocks_code.cpp': 'STATIC_BASELINE_KEPT',
        'src/arduino.cpp': 'ARDUINO_HAL',
        'src/c_blocks.h': 'STATIC_HEADER_STUB',
      },
      strucppFiles: {
        'generated.cpp': 'GEN_CPP',
      },
      cBlocks: { header: '// Empty file\n', code: null },
      definesH: 'DEFINES_H',
    })

    expect(out).toEqual({
      'examples/Baremetal/Baremetal.ino': 'BAREMETAL_INO',
      'examples/Baremetal/c_blocks_code.cpp': 'STATIC_BASELINE_KEPT',
      'src/arduino.cpp': 'ARDUINO_HAL',
      // header was overwritten with the empty-file sentinel
      'src/c_blocks.h': '// Empty file\n',
      'src/generated.cpp': 'GEN_CPP',
      'src/defines.h': 'DEFINES_H',
      'src/OpenPLCUserLib.h': expect.stringContaining('#pragma once') as unknown as string,
    })
  })
})

describe('composeFirmwareBundle — vendor-facing contract headers', () => {
  // The web skeleton never passes through mergeStrucppRuntimeIntoSkeleton, so the mirror cannot depend on a HAL.
  it('mirrors openplc_retain.h into src/ even when the skeleton carries no HAL', () => {
    const out = composeFirmwareBundle({
      ...baseInput,
      firmwareSkeleton: { 'examples/Baremetal/openplc_retain.h': '/* contract */' },
    })
    expect(out['src/openplc_retain.h']).toBe('/* contract */')
    expect(out['examples/Baremetal/openplc_retain.h']).toBe('/* contract */')
  })

  it('writes nothing under src/ when the skeleton lacks the header', () => {
    const out = composeFirmwareBundle({ ...baseInput, firmwareSkeleton: {} })
    expect('src/openplc_retain.h' in out).toBe(false)
  })
})

describe('composeFirmwareBundle — OpenPLCUserLib.h stub', () => {
  // Baremetal.ino `#include <OpenPLCUserLib.h>` is what triggers
  // arduino-cli's library discovery for the strucpp pipeline.  The
  // bundle must always ship a stub at this exact path so the include
  // resolves on both compile flows:
  //
  //   - Editor: arduino-cli sees both this stub AND a separately-
  //     staged precompiled-archive library; library discovery picks
  //     whichever the per-board search picks first.  The stub is
  //     header-only so it can't shadow the precompiled archive's
  //     symbols.
  //   - Web (compile-service single-pass): the stub at <sketch>/src/
  //     is the only one that exists, and `--library src` makes it
  //     discoverable.  Without it the build fails at the preprocessor
  //     with `fatal error: OpenPLCUserLib.h: No such file or directory`.
  it('always emits the stub under src/OpenPLCUserLib.h', () => {
    const out = composeFirmwareBundle({
      firmwareSkeleton: {},
      strucppFiles: {},
      cBlocks: { header: '', code: null },
      definesH: '',
    })
    expect(out['src/OpenPLCUserLib.h']).toContain('#pragma once')
  })

  it('writes the discovery anchor beside the sketch when libDeps is set', () => {
    const out = composeFirmwareBundle({
      firmwareSkeleton: {},
      strucppFiles: {},
      cBlocks: { header: '', code: 'void x() {}', libDeps: '#include <Adafruit_NeoPixel.h>\n' },
      definesH: '',
    })
    expect(out['examples/Baremetal/c_blocks_libdeps.cpp']).toContain('#include <Adafruit_NeoPixel.h>')
  })

  it('writes no anchor when the project declares no library includes', () => {
    const out = composeFirmwareBundle({
      firmwareSkeleton: {},
      strucppFiles: {},
      cBlocks: { header: '', code: 'void x() {}', libDeps: null },
      definesH: '',
    })
    expect(out['examples/Baremetal/c_blocks_libdeps.cpp']).toBeUndefined()
  })
})

describe('buildCBlocksFromPous', () => {
  it('returns the empty-file sentinel + null code for empty input', () => {
    const result = buildCBlocksFromPous([])
    expect(result).toEqual({ header: '// Empty file\n', code: null, libDeps: null })
  })

  it('keeps the conditional an include sits under', () => {
    const result = buildCBlocksFromPous([
      {
        name: 'neo',
        variables: [],
        code: '#ifdef ARDUINO_ARCH_ESP32\n#include <WiFi.h>\n#endif\nvoid setup() {}\n',
      },
    ])
    // Lifting the include out of its guard is what would break an AVR build
    // that compiles today.
    expect(result.libDeps).toContain('#ifdef ARDUINO_ARCH_ESP32')
    expect(result.libDeps).toContain('#include <WiFi.h>')
    expect(result.libDeps).toContain('#endif')
  })

  it('leaves a conditional group empty when its body was all code', () => {
    const result = buildCBlocksFromPous([
      {
        name: 'neo',
        variables: [],
        code: '#include <Adafruit_NeoPixel.h>\n#if DEBUG_TRACE\nSerial.println(counter);\n#endif\n',
      },
    ])
    expect(result.libDeps).toContain('#if DEBUG_TRACE\n#endif')
    expect(result.libDeps).not.toContain('Serial.println')
  })

  it('carries a define that forms an include name', () => {
    const result = buildCBlocksFromPous([
      { name: 'neo', variables: [], code: '#define LIB <Adafruit_NeoPixel.h>\n#include LIB\n' },
    ])
    expect(result.libDeps).toContain('#define LIB <Adafruit_NeoPixel.h>')
    expect(result.libDeps).toContain('#include LIB')
  })

  it('drops #error, #warning and #pragma', () => {
    const result = buildCBlocksFromPous([
      {
        name: 'neo',
        variables: [],
        code: '#include <Adafruit_NeoPixel.h>\n#error "needs wifi"\n#warning "slow"\n#pragma pack(1)\n',
      },
    ])
    // The real translation unit is compiled too and raises them there; here they
    // could fire on a condition only the pre-compile side can evaluate.
    expect(result.libDeps).not.toContain('needs wifi')
    expect(result.libDeps).not.toContain('slow')
    expect(result.libDeps).not.toContain('pack(1)')
  })

  it('ignores an include inside a comment', () => {
    const result = buildCBlocksFromPous([
      {
        name: 'neo',
        variables: [],
        code: '/*\n#include <Ghost.h>\n*/\n// #include <AlsoGhost.h>\n#include <Adafruit_NeoPixel.h>\n',
      },
    ])
    expect(result.libDeps).not.toContain('Ghost.h')
    expect(result.libDeps).not.toContain('AlsoGhost.h')
    expect(result.libDeps).toContain('#include <Adafruit_NeoPixel.h>')
  })

  it('splices a line continuation before reading directives', () => {
    const result = buildCBlocksFromPous([{ name: 'neo', variables: [], code: '#include \\\n<Adafruit_NeoPixel.h>\n' }])
    expect(result.libDeps).toContain('Adafruit_NeoPixel.h')
  })

  it('returns null when directives exist but none of them is an angle include', () => {
    const result = buildCBlocksFromPous([
      { name: 'neo', variables: [], code: '#define X 1\n#ifdef X\n#include "local.h"\n#endif\n' },
    ])
    expect(result.libDeps).toBeNull()
  })

  it('lifts the angle-bracket includes a block declares into libDeps', () => {
    const result = buildCBlocksFromPous([
      {
        name: 'neo',
        variables: [],
        code: '#include <Arduino.h>\n  #include <Adafruit_NeoPixel.h>\n#include "local.h"\nvoid setup() {}\n',
      },
    ])
    expect(result.libDeps).toContain('#include <Adafruit_NeoPixel.h>')
    expect(result.libDeps).toContain('#include <Arduino.h>')
    // A quoted include names a file beside the user's source, which does not
    // exist beside the sketch.
    expect(result.libDeps).not.toContain('local.h')
  })

  it('transcribes each block separately rather than merging their includes', () => {
    const pou = (name: string) => ({
      name,
      variables: [],
      code: '#include <Adafruit_NeoPixel.h>\nvoid setup() {}\n',
    })
    const result = buildCBlocksFromPous([pou('a'), pou('b')])
    // Deduplicating would mean lifting includes out of the streams they belong
    // to, which is what loses their conditions. A repeated include costs
    // nothing: headers carry their own guards.
    expect(result.libDeps).toContain('// a')
    expect(result.libDeps).toContain('// b')
    expect(result.libDeps?.match(/Adafruit_NeoPixel\.h/g)).toHaveLength(2)
  })

  it('leaves libDeps null when no block includes anything', () => {
    const result = buildCBlocksFromPous([{ name: 'plain', variables: [], code: 'void setup() {}\n' }])
    expect(result.libDeps).toBeNull()
  })

  it('returns generated header + code when POUs are present', () => {
    const result = buildCBlocksFromPous([
      {
        name: 'blink_cpp',
        variables: [
          {
            name: 'period_ms',
            type: { definition: 'base-type', value: 'UINT' },
            class: 'input',
            location: '',
            documentation: '',
          },
        ],
        code: '#include <Arduino.h>\nvoid setup() {}\nvoid loop() {}\n',
      },
    ])
    expect(typeof result.header).toBe('string')
    expect(result.header).toContain('BLINK_CPP_VARS')
    expect(result.header).toContain('blink_cpp_setup')
    expect(typeof result.code).toBe('string')
    expect(result.code).toContain('blink_cpp_setup')
  })

  it('passes a single POU as the only entry in both header and code generation', () => {
    const pous = [
      {
        name: 'one',
        variables: [],
        code: 'void setup() {}\nvoid loop() {}\n',
      },
    ]
    const result = buildCBlocksFromPous(pous)
    // header references the one POU's vars struct + setup/loop
    expect(result.header).toContain('one_setup')
    expect(result.header).toContain('one_loop')
    // code includes the user's body integrated into the wrapper
    expect(result.code).toContain('one_setup')
  })
})
