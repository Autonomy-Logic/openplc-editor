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

// Mock node:child_process so individual tests can swap the exec impl. Both
// `exec` (legacy callsites still going through promisify(exec) in this
// module's call graph) AND `execFile` (the new path used by recipe-exec.ts)
// route through the same `execImpl.current` dispatcher so tests inspect
// invocations uniformly. For execFile we synthesize a printable cmd string
// from (command, args) so existing `expect(cmd).toContain('pou_MAIN.cpp')`
// assertions still work — bare argv entries get rendered with surrounding
// quotes only if they contain whitespace, matching the eye-grep shape the
// tests were written against.
const execImpl: {
  current: (cmd: string) => Promise<{ stdout: string; stderr: string }>
} = {
  current: async () => ({ stdout: '', stderr: '' }),
}
const renderArgvAsCmd = (command: string, args: ReadonlyArray<string>): string =>
  [command, ...args].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')
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

  const execFile = (
    command: string,
    args: ReadonlyArray<string>,
    _opts: unknown,
    cb: (err: Error | null, val?: { stdout: string; stderr: string }) => void,
  ) => {
    execImpl
      .current(renderArgvAsCmd(command, args))
      .then((val) => cb(null, val))
      .catch((err: Error) => cb(err))
    return { kill: () => undefined }
  }
  ;(execFile as unknown as { [k: symbol]: unknown })[promisify.custom] = (
    command: string,
    args: ReadonlyArray<string>,
  ) => execImpl.current(renderArgvAsCmd(command, args))

  return { exec, execFile, spawn: jest.fn() }
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
    // without going through the full pre-compile path. Takes already-tokenized
    // argv (post-`tokenizeRecipe`) — response-file tokens arrive without
    // surrounding quote chars.
    const ensureStubs = (
      CompilerModule as unknown as {
        ensureResponseFileStubs(argv: ReadonlyArray<string>, log: (s: string) => void): Promise<void>
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

    it('creates an empty stub for a POSIX @-file the recipe references but does not exist', async () => {
      const missing = join(workDir, 'sub', 'build_opt.h')
      const argv = ['arm-none-eabi-g++', '-c', `@${missing}`, '-DARDUINO=10607', '-o', 'foo.o']
      await ensureStubs(argv, noopLog)
      expect(fs.existsSync(missing)).toBe(true)
      expect(fs.statSync(missing).size).toBe(0)
      expect(noopLog).toHaveBeenCalledWith(expect.stringContaining(`Stubbed empty response file: ${missing}`), 'info')
    })

    it('matches Windows-style @C:\\... and @C:/... absolute paths in argv tokens', () => {
      // Pure regex assertion against the public extractor — observing
      // extraction via filesystem side-effects (mkdir/writeFile) is
      // platform-fragile (POSIX accepts "C:" as a literal directory
      // name; Windows actually writes under C:\). The extractor is the
      // authoritative subject, so we test it directly.
      const winBackslash = 'C:\\Users\\dev\\AppData\\arduino\\sketches\\hash\\file_opts'
      const winSlash = 'C:/Users/dev/AppData/arduino/sketches/hash/build_opt.h'
      const argv = ['arm-zephyr-eabi-g++', '-c', `@${winBackslash}`, `@${winSlash}`, '-o', 'foo.o']

      const extracted = (
        CompilerModule as unknown as {
          extractResponseFilesFromArgv(argv: ReadonlyArray<string>): string[]
        }
      ).extractResponseFilesFromArgv(argv)

      expect(extracted).toContain(winBackslash)
      expect(extracted).toContain(winSlash)
    })

    it('does not overwrite existing response files', async () => {
      const existing = join(workDir, 'preexisting.txt')
      fs.writeFileSync(existing, 'real flags here', 'utf-8')
      const argv = ['g++', '-c', `@${existing}`, 'foo.cpp']
      await ensureStubs(argv, noopLog)
      expect(fs.readFileSync(existing, 'utf-8')).toBe('real flags here')
      expect(noopLog).not.toHaveBeenCalled()
    })

    it('deduplicates repeated @-references so a path is stubbed at most once', async () => {
      const target = join(workDir, 'shared.opt')
      const argv = ['g++', '-c', `@${target}`, `@${target}`, `@${target}`]
      await ensureStubs(argv, noopLog)
      expect(fs.existsSync(target)).toBe(true)
      expect(noopLog).toHaveBeenCalledTimes(1)
    })

    it('ignores @-tokens with relative paths (not absolute → not a response file we own)', async () => {
      // Relative-path @-args either reference workspace-local files (which
      // we shouldn't touch) or are non-path arguments — the regex deliberately
      // only matches absolute paths.
      const argv = ['g++', '-c', '@subdir/file.txt', 'foo.cpp']
      await ensureStubs(argv, noopLog)
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
        'build.core.path': '/fake/avr/cores/arduino',
        'build.variant.path': '/fake/avr/variants/standard',
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
          // build.core.path present so we reach the compiler/ar check
          'build.core.path': '/fake/avr/cores/arduino',
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

    it('caps concurrent toolchain spawns at the host CPU count (no unbounded parallel exec)', async () => {
      // Reproduces the unbounded-parallelism failure mode the cap was
      // added to prevent: ~30 TUs on a 4-core box used to dispatch 30
      // simultaneous g++ + cmd.exe pairs. Instrument the exec mock with
      // an in-flight counter to assert the peak respects the cap.
      const os = jest.requireActual('node:os') as typeof import('node:os')
      const cpuCount = os.cpus().length
      const tuCount = cpuCount + 4

      for (let i = 0; i < tuCount; i++) {
        fs.writeFileSync(join(srcDir, `tu_${String(i).padStart(2, '0')}.cpp`), '// tu\n', 'utf-8')
      }

      let inFlight = 0
      let peakInFlight = 0
      execImpl.current = async (cmd) => {
        // Archive (avr-ar) is sequential by design — skip it from the count.
        if (cmd.includes('avr-ar')) return { stdout: '', stderr: '' }
        inFlight += 1
        if (inFlight > peakInFlight) peakInFlight = inFlight
        // Yield so workers actually overlap rather than each synchronously
        // resolving and pulling the next item before we observe the peak.
        await new Promise((r) => setTimeout(r, 10))
        inFlight -= 1
        return { stdout: '', stderr: '' }
      }

      await compilerModule.handlePrecompileUserLib({
        compilationPath: buildDir,
        fqbn: 'arduino:avr:uno',
        handleOutputData: noopLog,
      })

      expect(peakInFlight).toBeLessThanOrEqual(cpuCount)
      // Sanity: the cap kicked in only because we actually parallelised.
      // On a single-core host the assertion would degenerate; skip the
      // sanity check there.
      if (cpuCount > 1) expect(peakInFlight).toBeGreaterThan(1)
    })

    it('stashes sources before compile so a failed archive leaves a recoverable state for retry', async () => {
      // Two strucpp-side TUs and the board HAL. After a failed first run
      // we expect src/ to retain only arduino.cpp and the stash to hold
      // the two pre-compile sources verbatim — a subsequent retry must
      // pick them up from the stash and complete successfully.
      fs.writeFileSync(join(srcDir, 'arduino.cpp'), '// HAL\n', 'utf-8')
      fs.writeFileSync(join(srcDir, 'pou_MAIN.cpp'), '// pou body\n', 'utf-8')
      fs.writeFileSync(join(srcDir, 'configuration.cpp'), '// config body\n', 'utf-8')

      const stashDir = join(buildDir, 'precompile', 'sources')

      let failNextArchive = true
      execImpl.current = async (cmd) => {
        if (cmd.includes('avr-ar') && failNextArchive) {
          throw new Error('simulated archive failure')
        }
        return { stdout: '', stderr: '' }
      }

      await expect(
        compilerModule.handlePrecompileUserLib({
          compilationPath: buildDir,
          fqbn: 'arduino:avr:uno',
          handleOutputData: noopLog,
        }),
      ).rejects.toThrow(/simulated archive failure/)

      // Post-failure state: stash holds the strucpp sources, src/ has only
      // arduino.cpp — exactly the invariant arduino-cli depends on.
      expect(fs.existsSync(join(stashDir, 'pou_MAIN.cpp'))).toBe(true)
      expect(fs.existsSync(join(stashDir, 'configuration.cpp'))).toBe(true)
      expect(fs.existsSync(join(srcDir, 'pou_MAIN.cpp'))).toBe(false)
      expect(fs.existsSync(join(srcDir, 'configuration.cpp'))).toBe(false)
      expect(fs.existsSync(join(srcDir, 'arduino.cpp'))).toBe(true)
      // Content survived the move untouched (no truncation, no swap).
      expect(fs.readFileSync(join(stashDir, 'pou_MAIN.cpp'), 'utf-8')).toBe('// pou body\n')

      // Second run resolves the simulated failure and completes.
      failNextArchive = false
      const result = await compilerModule.handlePrecompileUserLib({
        compilationPath: buildDir,
        fqbn: 'arduino:avr:uno',
        handleOutputData: noopLog,
      })

      // The TU set discovered from the stash matches the original two
      // strucpp sources — order is deterministic (sorted basenames).
      expect(result.objectFiles.map((p) => p.split(/[\\/]/).pop())).toEqual(['configuration.o', 'pou_MAIN.o'])
    })

    it('injects -I{build.core.path} and -I{build.variant.path} into every TU compile (so Arduino.h resolves)', async () => {
      // Reproduces the failure mode where Renesas-style cores leave the
      // bare core/variant -I out of recipe.cpp.o.pattern and rely on
      // arduino-cli to inject them at compile time via the `{includes}`
      // substitution. The precompile mirrors that injection here.
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

      const compileCmd = execCalls.find((c) => c.includes('pou_MAIN.cpp')) ?? ''
      expect(compileCmd).toContain('-I/fake/avr/cores/arduino')
      expect(compileCmd).toContain('-I/fake/avr/variants/standard')
    })

    it('omits the variant -I when build.variant.path is unset (runtime-only / minimalist cores)', async () => {
      extractSpy.mockResolvedValue({
        ...cannedProps,
        properties: {
          ...cannedProps.properties,
          'build.variant.path': '',
        },
      } as unknown as ToolchainProperties)

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

      const compileCmd = execCalls.find((c) => c.includes('pou_MAIN.cpp')) ?? ''
      expect(compileCmd).toContain('-I/fake/avr/cores/arduino')
      // No `-I` followed by empty path — the variant flag is dropped entirely.
      expect(compileCmd).not.toMatch(/-I(\s|$)/)
    })

    it('places extraCxxFlags `-I` paths BEFORE the core/variant `-I`s (avr-libstdcpp <new> must shadow Arduino core <new>)', async () => {
      // Load-bearing ordering: Arduino's `cores/arduino/new` declares
      // `operator new[]` as `[[gnu::weak]]`, while modm-io/avr-libstdcpp's
      // `<new>` declares it without the weak attribute. Whichever header
      // the preprocessor finds first determines whether `_Znaj` references
      // emitted from `new T[]` are strong or weak. Weak undefined refs do
      // NOT pull the matching definition from `core.a/new.cpp.o` during
      // link — the call resolves to address 0 (the AVR reset vector),
      // resulting in an infinite reset the moment any precompiled TU
      // executes a `new` expression.
      //
      // arduino-cli's stock recipe interpolates `{compiler.cpp.extra_flags}`
      // (which carries the cxx_flags `-I .../avr-libstdcpp/include`)
      // BEFORE `{includes}` (the core/variant paths), so the avr-libstdcpp
      // `<new>` wins. The precompile must mirror that ordering — this
      // test pins the contract.
      fs.writeFileSync(join(srcDir, 'pou_MAIN.cpp'), '// pou\n', 'utf-8')

      const execCalls: string[] = []
      execImpl.current = async (cmd) => {
        execCalls.push(cmd)
        return { stdout: '', stderr: '' }
      }

      await compilerModule.handlePrecompileUserLib({
        compilationPath: buildDir,
        fqbn: 'arduino:avr:uno',
        extraCxxFlags: ['-std=gnu++17', '-I/fake/openplc-avr-libstdcpp/include'],
        handleOutputData: noopLog,
      })

      const compileCmd = execCalls.find((c) => c.includes('pou_MAIN.cpp')) ?? ''
      const libStdCppPos = compileCmd.indexOf('-I/fake/openplc-avr-libstdcpp/include')
      const corePos = compileCmd.indexOf('-I/fake/avr/cores/arduino')
      const variantPos = compileCmd.indexOf('-I/fake/avr/variants/standard')

      expect(libStdCppPos).toBeGreaterThan(-1)
      expect(corePos).toBeGreaterThan(-1)
      expect(variantPos).toBeGreaterThan(-1)
      // avr-libstdcpp must come before BOTH core and variant -I paths.
      expect(libStdCppPos).toBeLessThan(corePos)
      expect(libStdCppPos).toBeLessThan(variantPos)
    })

    it('keeps non-`-I` flags from extraCxxFlags as trailing args so the last `-std=` wins over the recipe default', async () => {
      // The precompile appends `-std=gnu++17 -fno-rtti` as trailing flags
      // to override the AVR core's recipe-baked `-std=gnu++11`. Any
      // additional `-std=` or `-f*` flags from VPP-package cxx_flags
      // must end up trailing too, otherwise a `-std=` from cxx_flags
      // gets shadowed by the recipe default and strucpp templates that
      // require C++17 fail to compile.
      fs.writeFileSync(join(srcDir, 'pou_MAIN.cpp'), '// pou\n', 'utf-8')

      const execCalls: string[] = []
      execImpl.current = async (cmd) => {
        execCalls.push(cmd)
        return { stdout: '', stderr: '' }
      }

      await compilerModule.handlePrecompileUserLib({
        compilationPath: buildDir,
        fqbn: 'arduino:avr:uno',
        extraCxxFlags: ['-std=gnu++17', '-I/fake/openplc-avr-libstdcpp/include'],
        handleOutputData: noopLog,
      })

      const compileCmd = execCalls.find((c) => c.includes('pou_MAIN.cpp')) ?? ''
      // -I lands before the source-file end of the recipe; -std= lands after.
      const stdPos = compileCmd.lastIndexOf('-std=gnu++17')
      const sourcePos = compileCmd.indexOf('pou_MAIN.cpp')
      expect(stdPos).toBeGreaterThan(sourcePos)
    })

    it('hard-fails with an actionable error when build.core.path is missing from --show-properties', async () => {
      extractSpy.mockResolvedValue({
        ...cannedProps,
        properties: {
          'compiler.path': '/fake/avr/bin/',
          'compiler.ar.cmd': 'avr-ar',
          'compiler.ar.flags': 'rcs',
          // build.core.path intentionally absent — TUs that include
          // <Arduino.h> would silently fail to find the header.
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
      ).rejects.toThrow(/build\.core\.path.*core is likely not installed/s)
    })

    it('hard-fails with an actionable error when no arch property is exposed by --show-properties', async () => {
      // Reproduce a custom/legacy core whose platform.txt exposes none
      // of build.mcu / build.architecture / build.arch. The legacy
      // fallback to a literal "unknown" subdir silently placed the
      // archive somewhere arduino-cli would never look, producing an
      // opaque undefined-symbols link error far downstream. The
      // refactored path surfaces a loud, FQBN-tagged error instead.
      extractSpy.mockResolvedValue({
        ...cannedProps,
        properties: {
          'compiler.path': '/fake/avr/bin/',
          'compiler.ar.cmd': 'avr-ar',
          'compiler.ar.flags': 'rcs',
          'build.core.path': '/fake/avr/cores/arduino',
          // build.mcu / build.architecture / build.arch intentionally absent
        },
      } as unknown as ToolchainProperties)

      fs.writeFileSync(join(srcDir, 'pou_MAIN.cpp'), '// pou\n', 'utf-8')

      execImpl.current = async () => ({ stdout: '', stderr: '' })

      await expect(
        compilerModule.handlePrecompileUserLib({
          compilationPath: buildDir,
          fqbn: 'unknown:vendor:weird-board',
          handleOutputData: noopLog,
        }),
      ).rejects.toThrow(
        /Toolchain arch subdir resolution failed for "unknown:vendor:weird-board".*build\.mcu.*build\.architecture.*build\.arch.*file an issue/s,
      )
    })
  })
})
