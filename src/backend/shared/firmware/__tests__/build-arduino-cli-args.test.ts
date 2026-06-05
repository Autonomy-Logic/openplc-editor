import { buildArduinoCliCompileArgs, type BoardHalsCompileEntry } from '../build-arduino-cli-args'

const simulatorEntry: BoardHalsCompileEntry = {
  platform: 'arduino:avr:mega',
  core: 'arduino:avr',
  c_flags: ['-MMD', '-c', '-Wno-incompatible-pointer-types'],
  cxx_flags: ['-std=gnu++17'],
  ld_flags: ['-Wl,--defsym,__DATA_REGION_LENGTH__=0xFE00', '-Wl,--defsym,__stack=0x80FFFF'],
  max_data_size: 65024,
}

describe('buildArduinoCliCompileArgs', () => {
  it('composes the simulator argv editor and web both depend on', () => {
    const args = buildArduinoCliCompileArgs(simulatorEntry, {
      sketchPath: '/work/examples/Baremetal/Baremetal.ino',
      libraryPath: '/work/src',
      avrLibStdCppInclude: '/opt/avr-libstdcpp/include',
    })

    expect(args).toEqual([
      'compile',
      '-v',
      '-j',
      '0',
      '--build-property',
      'compiler.c.extra_flags=-MMD -c -Wno-incompatible-pointer-types',
      '--build-property',
      'compiler.cpp.extra_flags=-std=gnu++17 -I/opt/avr-libstdcpp/include',
      '--build-property',
      'compiler.c.elf.extra_flags=-Wl,--defsym,__DATA_REGION_LENGTH__=0xFE00 -Wl,--defsym,__stack=0x80FFFF',
      '--build-property',
      'upload.maximum_data_size=65024',
      '--library',
      '/work/src',
      '--export-binaries',
      '-b',
      'arduino:avr:mega',
      '/work/examples/Baremetal/Baremetal.ino',
    ])
  })

  it('omits -j 0 when parallel is false', () => {
    const args = buildArduinoCliCompileArgs(simulatorEntry, {
      sketchPath: 'a.ino',
      libraryPath: 'src',
      parallel: false,
    })
    expect(args.slice(0, 3)).toEqual(['compile', '-v', '--build-property'])
    expect(args).not.toContain('-j')
  })

  it('appends --clean when cleanBuild is requested', () => {
    const args = buildArduinoCliCompileArgs(simulatorEntry, {
      sketchPath: 'a.ino',
      libraryPath: 'src',
      cleanBuild: true,
    })
    // -j 0 still comes before --clean (matches editor's flow).
    expect(args.slice(0, 5)).toEqual(['compile', '-v', '-j', '0', '--clean'])
  })

  it('skips compiler.c.extra_flags when c_flags is missing or empty', () => {
    const without = buildArduinoCliCompileArgs(
      { platform: 'arduino:avr:mega' },
      { sketchPath: 'a.ino', libraryPath: 'src', parallel: false },
    )
    expect(without).not.toContain('compiler.c.extra_flags=')

    const empty = buildArduinoCliCompileArgs(
      { platform: 'arduino:avr:mega', c_flags: [] },
      { sketchPath: 'a.ino', libraryPath: 'src', parallel: false },
    )
    expect(empty.some((a) => a.startsWith('compiler.c.extra_flags='))).toBe(false)
  })

  it('only appends -I<avr-libstdcpp> when core is arduino:avr AND the include is supplied', () => {
    const noInclude = buildArduinoCliCompileArgs(simulatorEntry, {
      sketchPath: 'a.ino',
      libraryPath: 'src',
      parallel: false,
    })
    expect(noInclude.find((a) => a.startsWith('compiler.cpp.extra_flags='))).toBe(
      'compiler.cpp.extra_flags=-std=gnu++17',
    )

    const nonAvrEntry: BoardHalsCompileEntry = {
      platform: 'arduino:samd:mkrzero',
      core: 'arduino:samd',
      cxx_flags: ['-std=gnu++17'],
    }
    const nonAvr = buildArduinoCliCompileArgs(nonAvrEntry, {
      sketchPath: 'a.ino',
      libraryPath: 'src',
      avrLibStdCppInclude: '/opt/avr-libstdcpp/include',
      parallel: false,
    })
    expect(nonAvr.find((a) => a.startsWith('compiler.cpp.extra_flags='))).toBe('compiler.cpp.extra_flags=-std=gnu++17')
  })

  it('skips compiler.cpp.extra_flags entirely when cxx_flags is missing or empty', () => {
    const without = buildArduinoCliCompileArgs(
      { platform: 'arduino:avr:mega' },
      { sketchPath: 'a.ino', libraryPath: 'src', parallel: false },
    )
    expect(without.some((a) => a.startsWith('compiler.cpp.extra_flags='))).toBe(false)

    const empty = buildArduinoCliCompileArgs(
      { platform: 'arduino:avr:mega', cxx_flags: [] },
      { sketchPath: 'a.ino', libraryPath: 'src', parallel: false },
    )
    expect(empty.some((a) => a.startsWith('compiler.cpp.extra_flags='))).toBe(false)
  })

  it('skips compiler.c.elf.extra_flags when ld_flags is missing or empty', () => {
    const without = buildArduinoCliCompileArgs(
      { platform: 'arduino:avr:mega' },
      { sketchPath: 'a.ino', libraryPath: 'src', parallel: false },
    )
    expect(without.some((a) => a.startsWith('compiler.c.elf.extra_flags='))).toBe(false)

    const empty = buildArduinoCliCompileArgs(
      { platform: 'arduino:avr:mega', ld_flags: [] },
      { sketchPath: 'a.ino', libraryPath: 'src', parallel: false },
    )
    expect(empty.some((a) => a.startsWith('compiler.c.elf.extra_flags='))).toBe(false)
  })

  it('skips upload.maximum_data_size when max_data_size is not a number', () => {
    const args = buildArduinoCliCompileArgs(
      { platform: 'arduino:avr:mega' },
      { sketchPath: 'a.ino', libraryPath: 'src', parallel: false },
    )
    expect(args.some((a) => a.startsWith('upload.maximum_data_size='))).toBe(false)
  })

  it('appends trailingArgs after the sketch path', () => {
    const args = buildArduinoCliCompileArgs(
      { platform: 'arduino:avr:mega' },
      {
        sketchPath: 'a.ino',
        libraryPath: 'src',
        parallel: false,
        trailingArgs: ['--config-file', '/etc/arduino-cli.yaml'],
      },
    )
    const sketchIdx = args.indexOf('a.ino')
    expect(args.slice(sketchIdx + 1)).toEqual(['--config-file', '/etc/arduino-cli.yaml'])
  })
})
