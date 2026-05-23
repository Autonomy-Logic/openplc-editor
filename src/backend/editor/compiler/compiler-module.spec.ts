import { cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CompilerModule } from './compiler-module'
import type { ToolchainProperties } from './types'

jest.mock('electron', () => ({
  app: {
    getPath: jest.fn().mockReturnValue('/tmp/mock-user-data'),
    // In dev (the branch tests exercise — `isPackaged` is undefined/falsy
    // through this mock), strucppRuntimeDir resolves under
    // `<app-root>/node_modules/strucpp/src/runtime/include`; any
    // non-empty string works for the type-asserting tests.
    getAppPath: jest.fn().mockReturnValue('/tmp/mock-app-root'),
    isPackaged: false,
    getVersion: jest.fn().mockReturnValue('0.0.0-test'),
  },
  dialog: {
    showSaveDialog: jest.fn().mockResolvedValue({ filePath: '/tmp/mock-save-path' }),
  },
}))

jest.mock('electron/main', () => ({}), { virtual: true })

// Stub `cp` from node:fs/promises so handleGenerateArduinoCppFile doesn't
// actually touch disk during tests. Other fs/promises members keep their
// real implementation.
jest.mock('node:fs/promises', () => {
  const actual = jest.requireActual('node:fs/promises')
  return { ...actual, cp: jest.fn().mockResolvedValue(undefined) }
})

// Mock node:child_process so individual tests can swap the exec impl. The
// real `exec` carries a promisify.custom symbol that makes `promisify(exec)`
// resolve with `{ stdout, stderr }` instead of a single value — we replicate
// that here so the production code path through promisify behaves identically.
const execImpl: {
  current: (cmd: string) => Promise<{ stdout: string; stderr: string }>
} = {
  current: async () => ({ stdout: '', stderr: '' }),
}
jest.mock('node:child_process', () => {
  const { promisify } = jest.requireActual('node:util') as typeof import('node:util')
  const exec = (
    cmd: string,
    _opts: unknown,
    cb: (err: Error | null, val?: { stdout: string; stderr: string }) => void,
  ) => {
    execImpl
      .current(cmd)
      .then((val) => cb(null, val))
      .catch((err: Error) => cb(err))
    return { kill: () => undefined }
  }
  ;(exec as unknown as { [k: symbol]: unknown })[promisify.custom] = (cmd: string) => execImpl.current(cmd)
  return { exec, spawn: jest.fn() }
})

// CompilerModule uses process.resourcesPath (Electron-specific) when not in dev mode.
// In Jest, NODE_ENV is 'test', so DEVELOPMENT_MODE is false. Provide a fallback.
;(process as unknown as { resourcesPath: string }).resourcesPath ??= process.cwd()

describe('CompilerModule', () => {
  let compilerModule: CompilerModule

  beforeEach(() => {
    compilerModule = new CompilerModule()
  })

  it('should be defined and instantiated successfully', () => {
    expect(compilerModule).toBeDefined()
    expect(compilerModule).toBeInstanceOf(CompilerModule)
  })

  it('should have expected static properties', () => {
    expect(typeof CompilerModule.HOST_PLATFORM).toBe('string')
    expect(['x64', 'arm64', 'ia32', 'arm']).toContain(CompilerModule.HOST_ARCHITECTURE)
    expect(typeof CompilerModule.DEVELOPMENT_MODE).toBe('boolean')
    expect(Array.isArray(CompilerModule.GLOBAL_LIBRARIES)).toBe(true)
    expect(CompilerModule.GLOBAL_LIBRARIES.length).toBeGreaterThan(0)
  })

  it('should initialize directory and binary paths', () => {
    expect(typeof compilerModule.binaryDirectoryPath).toBe('string')
    expect(typeof compilerModule.sourceDirectoryPath).toBe('string')
    expect(typeof compilerModule.arduinoCliBinaryPath).toBe('string')
    expect(typeof compilerModule.arduinoCliConfigurationFilePath).toBe('string')
    expect(Array.isArray(compilerModule.arduinoCliBaseParameters)).toBe(true)
    expect(typeof compilerModule.xml2stBinaryPath).toBe('string')
    expect(typeof compilerModule.strucppRuntimeDir).toBe('string')
  })

  it('getHostHardwareInfo should return a string containing hardware info', () => {
    const info = compilerModule.getHostHardwareInfo()
    expect(typeof info).toBe('string')
    expect(info).toContain('System Architecture')
    expect(info).toContain('Operating System')
    expect(info).toContain('Logical CPU Cores')
  })

  describe('applyPlatformOptions (VPP target.platformOptions → FQBN)', () => {
    const nanoOptions = [
      {
        key: 'cpu',
        label: 'Processor',
        default: 'atmega328',
        values: [
          { id: 'atmega328', label: 'New Bootloader' },
          { id: 'atmega328old', label: 'Old Bootloader' },
        ],
      },
    ]

    it('returns the platform unchanged when no platformOptions are declared', () => {
      expect(CompilerModule.applyPlatformOptions('arduino:avr:mega', undefined, undefined)).toBe('arduino:avr:mega')
      expect(CompilerModule.applyPlatformOptions('arduino:avr:mega', [], { cpu: 'whatever' })).toBe('arduino:avr:mega')
    })

    it('uses the option default when no user selection is provided', () => {
      expect(CompilerModule.applyPlatformOptions('arduino:avr:nano', nanoOptions, undefined)).toBe(
        'arduino:avr:nano:cpu=atmega328',
      )
      expect(CompilerModule.applyPlatformOptions('arduino:avr:nano', nanoOptions, {})).toBe(
        'arduino:avr:nano:cpu=atmega328',
      )
    })

    it('honours a user selection over the default', () => {
      expect(CompilerModule.applyPlatformOptions('arduino:avr:nano', nanoOptions, { cpu: 'atmega328old' })).toBe(
        'arduino:avr:nano:cpu=atmega328old',
      )
    })

    it('falls back to default for missing keys when multiple options exist', () => {
      const multiOpt = [
        ...nanoOptions,
        {
          key: 'upload_speed',
          label: 'Upload Speed',
          default: '115200',
          values: [
            { id: '115200', label: '115200' },
            { id: '57600', label: '57600' },
          ],
        },
      ]
      // Only cpu is overridden — upload_speed should use its default.
      expect(CompilerModule.applyPlatformOptions('arduino:avr:nano', multiOpt, { cpu: 'atmega328old' })).toBe(
        'arduino:avr:nano:cpu=atmega328old:upload_speed=115200',
      )
    })

    it('preserves option declaration order in the resulting FQBN', () => {
      // arduino-cli expects sub-options concatenated in their menu-declaration
      // order — swapping would change the cache key and miss the warm cache.
      const ordered = [
        { key: 'a', label: 'A', default: 'a1', values: [{ id: 'a1', label: 'a1' }] },
        { key: 'b', label: 'B', default: 'b1', values: [{ id: 'b1', label: 'b1' }] },
        { key: 'c', label: 'C', default: 'c1', values: [{ id: 'c1', label: 'c1' }] },
      ]
      expect(CompilerModule.applyPlatformOptions('foo:bar:baz', ordered, { c: 'cX', a: 'aY' })).toBe(
        'foo:bar:baz:a=aY:b=b1:c=cX',
      )
    })
  })

  describe('parseShowPropertiesOutput (pre-compile pipeline foundation)', () => {
    it('parses key=value lines into a flat record', () => {
      const stdout = ['build.arch=MBED_OPTA', 'build.board=OPTA', 'compiler.cpp.cmd=arm-none-eabi-g++', ''].join('\n')
      expect(CompilerModule.parseShowPropertiesOutput(stdout)).toEqual({
        'build.arch': 'MBED_OPTA',
        'build.board': 'OPTA',
        'compiler.cpp.cmd': 'arm-none-eabi-g++',
      })
    })

    it('preserves "=" in values (e.g. -DARDUINO=10607)', () => {
      const stdout = 'compiler.define=-DARDUINO=\nbuild.extra_flags=-DCM4=0x60000000\n'
      expect(CompilerModule.parseShowPropertiesOutput(stdout)).toEqual({
        'compiler.define': '-DARDUINO=',
        'build.extra_flags': '-DCM4=0x60000000',
      })
    })

    it('captures empty values without dropping the key', () => {
      const stdout = 'compiler.cpp.extra_flags=\nbuild.usb_flags='
      expect(CompilerModule.parseShowPropertiesOutput(stdout)).toEqual({
        'compiler.cpp.extra_flags': '',
        'build.usb_flags': '',
      })
    })

    it('captures the full recipe.cpp.o.pattern with embedded quotes and placeholders', () => {
      // Real recipe shape from arduino:mbed_opta@4.5.0
      const recipe =
        '"/path/to/arm-none-eabi-g++" -c -nostdlib "@/path/with spaces/defines.txt" ' +
        '-DARDUINO=10607 {includes} "{source_file}" -o "{object_file}"'
      const stdout = `recipe.cpp.o.pattern=${recipe}\n`
      const props = CompilerModule.parseShowPropertiesOutput(stdout)
      expect(props['recipe.cpp.o.pattern']).toBe(recipe)
    })
  })

  describe('synthesizeSimulatorPinMapping (Simulator pin layout from hals.json)', () => {
    it('parses the comma-separated default_* strings into typed DevicePin entries', () => {
      const pins = CompilerModule.synthesizeSimulatorPinMapping({
        default_din: '62, 63, 64, 65',
        default_dout: '14, 15, 16',
        default_ain: 'A0, A1',
        default_aout: '2, 3',
      })
      // Order: digitalInput, analogInput, digitalOutput, analogOutput
      expect(pins.map((p) => p.pin)).toEqual(['62', '63', '64', '65', 'A0', 'A1', '14', '15', '16', '2', '3'])
      expect(pins.map((p) => p.pinType)).toEqual([
        'digitalInput',
        'digitalInput',
        'digitalInput',
        'digitalInput',
        'analogInput',
        'analogInput',
        'digitalOutput',
        'digitalOutput',
        'digitalOutput',
        'analogOutput',
        'analogOutput',
      ])
    })

    it('skips empty/whitespace entries so a trailing comma does not produce a blank pin', () => {
      const pins = CompilerModule.synthesizeSimulatorPinMapping({
        default_din: '62,  ,63,',
        default_dout: '',
        default_ain: '',
        default_aout: '',
      })
      expect(pins).toEqual([
        { pin: '62', pinType: 'digitalInput', address: '', alias: '' },
        { pin: '63', pinType: 'digitalInput', address: '', alias: '' },
      ])
    })

    it('returns an empty list when the board declares no pin defaults', () => {
      expect(CompilerModule.synthesizeSimulatorPinMapping({})).toEqual([])
    })
  })

  describe('installAsArduinoLibrary (precompiled library layout)', () => {
    const fs = jest.requireActual('node:fs') as typeof import('node:fs')
    const fsPromises = jest.requireActual('node:fs/promises') as typeof import('node:fs/promises')
    const cpMock = cp as jest.MockedFunction<typeof cp>
    let tempCompilationPath: string
    let dummyArchivePath: string

    beforeEach(() => {
      tempCompilationPath = fs.mkdtempSync(join(tmpdir(), 'openplc-precompile-spec-'))
      dummyArchivePath = join(tempCompilationPath, 'precompile', 'libOpenPLCUserLib.a')
      fs.mkdirSync(join(tempCompilationPath, 'precompile'), { recursive: true })
      fs.writeFileSync(dummyArchivePath, '!<arch>\n', 'utf-8')
      cpMock.mockImplementation(fsPromises.cp)
    })

    afterEach(() => {
      fs.rmSync(tempCompilationPath, { recursive: true, force: true })
      cpMock.mockReset().mockResolvedValue(undefined)
    })

    it('stages the library under os.tmpdir() (path must be space-free for the linker -L flag)', async () => {
      const { libraryDir, archDir } = await compilerModule.installAsArduinoLibrary({
        compilationPath: tempCompilationPath,
        archivePath: dummyArchivePath,
        archCandidates: ['cortex-m7'],
      })
      expect(libraryDir.startsWith(jest.requireActual('node:os').tmpdir())).toBe(true)
      expect(libraryDir).not.toMatch(/\s/)
      expect(archDir).toBe(join(libraryDir, 'src', 'cortex-m7'))
      expect(fs.existsSync(join(libraryDir, 'library.properties'))).toBe(true)
      expect(fs.existsSync(join(libraryDir, 'src', 'OpenPLCUserLib.h'))).toBe(true)
      expect(fs.existsSync(join(archDir, 'libOpenPLCUserLib.a'))).toBe(true)
    })

    it('lays the archive under every candidate subdir so arduino-cli finds it regardless of per-core convention', async () => {
      const { libraryDir } = await compilerModule.installAsArduinoLibrary({
        compilationPath: tempCompilationPath,
        archivePath: dummyArchivePath,
        // AVR Mega exposes build.mcu=atmega2560 + build.arch=AVR; arduino-cli
        // picks atmega2560 for the precompiled-lib subdir on this core, while
        // mbed cores pick build.architecture (e.g. cortex-m7). Writing to both
        // dirs sidesteps the per-core mapping.
        archCandidates: ['atmega2560', 'avr'],
      })
      expect(fs.existsSync(join(libraryDir, 'src', 'atmega2560', 'libOpenPLCUserLib.a'))).toBe(true)
      expect(fs.existsSync(join(libraryDir, 'src', 'avr', 'libOpenPLCUserLib.a'))).toBe(true)
    })

    it('marks the library as precompiled=full so arduino-cli skips source compilation', async () => {
      const { libraryDir } = await compilerModule.installAsArduinoLibrary({
        compilationPath: tempCompilationPath,
        archivePath: dummyArchivePath,
        archCandidates: ['avr'],
      })
      const props = fs.readFileSync(join(libraryDir, 'library.properties'), 'utf-8')
      expect(props).toMatch(/^precompiled=full$/m)
      expect(props).toMatch(/^name=OpenPLCUserLib$/m)
      expect(props).toMatch(/^architectures=\*$/m)
    })

    it('writes a stub header that documents its purpose without redeclaring symbols', async () => {
      const { libraryDir } = await compilerModule.installAsArduinoLibrary({
        compilationPath: tempCompilationPath,
        archivePath: dummyArchivePath,
        archCandidates: ['cortex-m7'],
      })
      const header = fs.readFileSync(join(libraryDir, 'src', 'OpenPLCUserLib.h'), 'utf-8')
      expect(header).toContain('#pragma once')
      expect(header).toContain('stub')
      expect(header).not.toMatch(/^extern\s+/m)
    })

    it('isolates concurrent same-board compiles by suffixing the staging path with process.pid', async () => {
      const { libraryDir } = await compilerModule.installAsArduinoLibrary({
        compilationPath: tempCompilationPath,
        archivePath: dummyArchivePath,
        archCandidates: ['cortex-m4'],
      })
      // Reset-on-stage-collision is documented in the method; the pid suffix
      // is what prevents a concurrent process from deleting our staging dir
      // mid-build (md5 alone would collide for the same compilationPath).
      expect(libraryDir).toMatch(new RegExp(`-${process.pid}/OpenPLCUserLib$`))
    })
  })

  describe('ensureResponseFileStubs (ESP32/STM32duino response-file workaround)', () => {
    // Method is `private static` — exposed for direct testing via a typed
    // façade so the regex and EEXIST handling can be exercised in isolation
    // without going through the full pre-compile path.
    const ensureStubs = (
      CompilerModule as unknown as {
        ensureResponseFileStubs(cmd: string, log: (s: string) => void): Promise<void>
      }
    ).ensureResponseFileStubs.bind(CompilerModule)
    const fs = jest.requireActual('node:fs') as typeof import('node:fs')
    const noopLog = jest.fn()
    let workDir: string

    beforeEach(() => {
      noopLog.mockClear()
      workDir = fs.mkdtempSync(join(tmpdir(), 'openplc-stubs-spec-'))
    })

    afterEach(() => {
      fs.rmSync(workDir, { recursive: true, force: true })
    })

    it('creates an empty stub for a quoted POSIX @-file the recipe references but does not exist', async () => {
      const missing = join(workDir, 'sub', 'build_opt.h')
      const cmd = `arm-none-eabi-g++ -c "@${missing}" -DARDUINO=10607 -o foo.o`
      await ensureStubs(cmd, noopLog)
      expect(fs.existsSync(missing)).toBe(true)
      expect(fs.statSync(missing).size).toBe(0)
      expect(noopLog).toHaveBeenCalledWith(expect.stringContaining(`Stubbed empty response file: ${missing}`), 'info')
    })

    it('matches Windows-style @C:\\... and @C:/... absolute paths from the recipe', async () => {
      // Windows paths can't actually be created on POSIX hosts, so we assert
      // via the side-effect: the regex must extract them so the mkdir/writeFile
      // attempt happens (and would surface a mkdir error).
      const winBackslash = 'C:\\Users\\dev\\AppData\\arduino\\sketches\\hash\\file_opts'
      const winSlash = 'C:/Users/dev/AppData/arduino/sketches/hash/build_opt.h'
      const cmd = `arm-zephyr-eabi-g++ -c "@${winBackslash}" "@${winSlash}" -o foo.o`
      const originalCwd = process.cwd()
      process.chdir(workDir)
      try {
        await ensureStubs(cmd, noopLog).catch(() => {
          /* mkdir of "C:" on POSIX can fail — regex match still asserted via the log */
        })
      } finally {
        process.chdir(originalCwd)
      }
      const logCalls = noopLog.mock.calls.flat().join('\n')
      expect(logCalls).toContain(winBackslash)
      expect(logCalls).toContain(winSlash)
    })

    it('does not overwrite existing response files', async () => {
      const existing = join(workDir, 'preexisting.txt')
      fs.writeFileSync(existing, 'real flags here', 'utf-8')
      const cmd = `g++ -c "@${existing}" foo.cpp`
      await ensureStubs(cmd, noopLog)
      expect(fs.readFileSync(existing, 'utf-8')).toBe('real flags here')
      expect(noopLog).not.toHaveBeenCalled()
    })

    it('deduplicates repeated @-references so a path is stubbed at most once', async () => {
      const target = join(workDir, 'shared.opt')
      const cmd = `g++ -c "@${target}" "@${target}" "@${target}"`
      await ensureStubs(cmd, noopLog)
      expect(fs.existsSync(target)).toBe(true)
      expect(noopLog).toHaveBeenCalledTimes(1)
    })

    it('ignores @-tokens with relative paths (not absolute → not a response file we own)', async () => {
      // Relative-path @-args either reference workspace-local files (which
      // we shouldn't touch) or are non-path arguments — the regex deliberately
      // only matches absolute paths.
      const relative = 'subdir/file.txt'
      const cmd = `g++ -c "@${relative}" foo.cpp`
      await ensureStubs(cmd, noopLog)
      expect(noopLog).not.toHaveBeenCalled()
    })
  })

  describe('extractToolchainProperties (recipe extraction)', () => {
    it('caches successful results so a second call for the same FQBN skips arduino-cli', async () => {
      let execCallCount = 0
      execImpl.current = async () => {
        execCallCount += 1
        return {
          stdout: [
            'recipe.cpp.o.pattern=avr-g++ {source_file} -o {object_file}',
            'recipe.c.o.pattern=avr-gcc {source_file} -o {object_file}',
            'recipe.ar.pattern=avr-ar rcs {archive_file_path} {object_file}',
            'compiler.path=/avr/',
            'compiler.ar.cmd=avr-ar',
          ].join('\n'),
          stderr: '',
        }
      }
      const first = await compilerModule.extractToolchainProperties('arduino:avr:uno')
      const second = await compilerModule.extractToolchainProperties('arduino:avr:uno')
      expect(first).toBe(second) // same reference — cache hit, not re-parsed
      expect(execCallCount).toBe(1)
    })

    it('throws a descriptive error when arduino-cli returns an incomplete recipe set', async () => {
      // Missing recipe.c.o.pattern and recipe.ar.pattern — usually signals
      // that the core for this FQBN isn't installed.
      execImpl.current = async () => ({
        stdout: 'recipe.cpp.o.pattern=g++ {source_file} -o {object_file}\n',
        stderr: '',
      })
      await expect(compilerModule.extractToolchainProperties('unknown:vendor:board')).rejects.toThrow(
        /incomplete recipe set.*core for this board is not installed/s,
      )
    })
  })

  describe('handlePrecompileUserLib (pre-compile loop)', () => {
    const fs = jest.requireActual('node:fs') as typeof import('node:fs')
    const noopLog = jest.fn()
    let buildDir: string
    let srcDir: string
    let extractSpy: jest.SpyInstance

    const cannedProps: ToolchainProperties = {
      fqbn: 'arduino:avr:uno',
      properties: {
        'compiler.path': '/fake/avr/bin/',
        'compiler.ar.cmd': 'avr-ar',
        'compiler.ar.flags': 'rcs',
        'build.arch': 'AVR',
      },
      recipeCpp: 'avr-g++ -c {source_file} {includes} {includes} -o {object_file}',
      recipeC: 'avr-gcc -c {source_file} {includes} -o {object_file}',
      recipeAr: 'avr-ar rcs {archive_file_path} {object_file}',
    }

    beforeEach(() => {
      noopLog.mockClear()
      buildDir = fs.mkdtempSync(join(tmpdir(), 'openplc-precompile-loop-'))
      srcDir = join(buildDir, 'src')
      fs.mkdirSync(srcDir, { recursive: true })
      extractSpy = jest
        .spyOn(compilerModule, 'extractToolchainProperties')
        .mockResolvedValue(cannedProps as unknown as ToolchainProperties)
    })

    afterEach(() => {
      extractSpy.mockRestore()
      fs.rmSync(buildDir, { recursive: true, force: true })
    })

    it('throws when src/ contains no compilable TUs (only the board HAL arduino.cpp would be excluded)', async () => {
      fs.writeFileSync(join(srcDir, 'arduino.cpp'), '// HAL\n', 'utf-8')
      await expect(
        compilerModule.handlePrecompileUserLib({
          compilationPath: buildDir,
          fqbn: 'arduino:avr:uno',
          handleOutputData: noopLog,
        }),
      ).rejects.toThrow(/no \.cpp sources found under/)
    })

    it('excludes arduino.cpp from the compile set so the board HAL stays with arduino-cli', async () => {
      fs.writeFileSync(join(srcDir, 'arduino.cpp'), '// HAL\n', 'utf-8')
      fs.writeFileSync(join(srcDir, 'pou_MAIN.cpp'), '// pou\n', 'utf-8')
      fs.writeFileSync(join(srcDir, 'configuration.cpp'), '// config\n', 'utf-8')

      const execCalls: string[] = []
      execImpl.current = async (cmd) => {
        execCalls.push(cmd)
        return { stdout: '', stderr: '' }
      }

      await compilerModule.handlePrecompileUserLib({
        compilationPath: buildDir,
        fqbn: 'arduino:avr:uno',
        handleOutputData: noopLog,
      })

      // Two compile invocations + one ar invocation = 3 exec calls.
      expect(execCalls).toHaveLength(3)
      const compileCmds = execCalls.slice(0, 2).join('\n')
      expect(compileCmds).toContain('pou_MAIN.cpp')
      expect(compileCmds).toContain('configuration.cpp')
      expect(compileCmds).not.toContain('arduino.cpp')
    })

    it('substitutes every {includes} occurrence (recipes that interpolate it twice must not leak literals)', async () => {
      fs.writeFileSync(join(srcDir, 'pou_MAIN.cpp'), '// pou\n', 'utf-8')

      const execCalls: string[] = []
      execImpl.current = async (cmd) => {
        execCalls.push(cmd)
        return { stdout: '', stderr: '' }
      }

      await compilerModule.handlePrecompileUserLib({
        compilationPath: buildDir,
        fqbn: 'arduino:avr:uno',
        handleOutputData: noopLog,
      })

      // recipeCpp had `{includes} {includes}` (double occurrence). After
      // substitution there must be ZERO literal `{includes}` left.
      expect(execCalls[0]).not.toContain('{includes}')
    })

    it('preserves source-file order in the ar archive members (deterministic build output)', async () => {
      // Three sources to verify ordering; the pre-compile builds objectFiles
      // synchronously from the source list so order is stable regardless of
      // concurrent compile resolution timing.
      fs.writeFileSync(join(srcDir, 'a_first.cpp'), '// a\n', 'utf-8')
      fs.writeFileSync(join(srcDir, 'm_middle.cpp'), '// m\n', 'utf-8')
      fs.writeFileSync(join(srcDir, 'z_last.cpp'), '// z\n', 'utf-8')

      let arCmd = ''
      execImpl.current = async (cmd) => {
        if (cmd.includes('avr-ar')) arCmd = cmd
        return { stdout: '', stderr: '' }
      }

      await compilerModule.handlePrecompileUserLib({
        compilationPath: buildDir,
        fqbn: 'arduino:avr:uno',
        handleOutputData: noopLog,
      })

      const aPos = arCmd.indexOf('a_first.o')
      const mPos = arCmd.indexOf('m_middle.o')
      const zPos = arCmd.indexOf('z_last.o')
      expect(aPos).toBeGreaterThan(-1)
      expect(mPos).toBeGreaterThan(aPos)
      expect(zPos).toBeGreaterThan(mPos)
    })

    it('throws an actionable error when compiler.path or compiler.ar.cmd is missing from --show-properties', async () => {
      extractSpy.mockResolvedValue({
        ...cannedProps,
        properties: {
          /* compiler.path & compiler.ar.cmd intentionally absent */
        },
      } as unknown as ToolchainProperties)

      fs.writeFileSync(join(srcDir, 'pou_MAIN.cpp'), '// pou\n', 'utf-8')

      execImpl.current = async () => ({ stdout: '', stderr: '' })

      await expect(
        compilerModule.handlePrecompileUserLib({
          compilationPath: buildDir,
          fqbn: 'arduino:avr:uno',
          handleOutputData: noopLog,
        }),
      ).rejects.toThrow(/compiler\.path \+ compiler\.ar\.cmd.*core is likely not installed/s)
    })
  })
})
