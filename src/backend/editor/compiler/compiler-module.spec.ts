import { cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CompilerModule } from './compiler-module'

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

  describe('handleUploadProgram (no serial port)', () => {
    /**
     * A step that cannot run must FAIL, not return quietly.
     *
     * `uploadArduinoBoard` only awaits this method and reports `{ ok: true }` on
     * any normal return, and the build's outcome now comes from the pipeline's
     * verdict rather than from whether an error was logged. So a silent bail
     * here told the user their board had been flashed when nothing was sent —
     * red "No communication port specified", then "Arduino upload complete.",
     * then success.
     */
    it('throws when no port is passed and none is persisted', async () => {
      const logged: Array<{ message: string; level?: string }> = []

      await expect(
        compilerModule.handleUploadProgram({
          // A directory with no devices/configuration.json, so the disk
          // fallback finds nothing either.
          projectPath: join(tmpdir(), 'openplc-no-such-project'),
          arduinoPlatform: 'arduino:avr:uno',
          compilationPath: join(tmpdir(), 'openplc-no-such-build'),
          handleOutputData: (chunk, level) => {
            logged.push({ message: typeof chunk === 'string' ? chunk : chunk.toString(), ...(level ? { level } : {}) })
          },
        }),
      ).rejects.toThrow(/No communication port specified/)

      // It must not have announced anything that reads like progress.
      expect(logged.some((entry) => /upload complete/i.test(entry.message))).toBe(false)
    })
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

  describe('compileLibrary — IPC payload validation', () => {
    /**
     * Collects what the module posts over the progress channel, plus whether
     * it ever closed. A build that neither posts a result nor closes is the
     * exact failure being guarded against: `main.ts` invokes this method with
     * `void`, so a throw would leave the renderer's promise unsettled forever.
     */
    function makeChannel() {
      // `unknown[]`, matching `CompileProgressChannel.postMessage(message:
      // unknown)`. Typing the sink as the shape we hope to find would assume
      // the very thing these tests exist to check.
      const messages: unknown[] = []
      let closed = false
      return {
        messages,
        isClosed: () => closed,
        channel: {
          start: () => {},
          postMessage: (m: unknown) => messages.push(m),
          close: () => {
            closed = true
          },
        },
      }
    }

    /** The build result carried by one of `messages`, or null if none does. */
    function readBuildResult(messages: unknown[]): { success: boolean; error?: string } | null {
      for (const message of messages) {
        if (typeof message !== 'object' || message === null) continue
        if (!('libraryBuildResult' in message)) continue
        const result = message.libraryBuildResult
        if (typeof result !== 'object' || result === null) continue
        if (!('success' in result) || typeof result.success !== 'boolean') continue
        const error = 'error' in result && typeof result.error === 'string' ? result.error : undefined
        return { success: result.success, ...(error === undefined ? {} : { error }) }
      }
      return null
    }

    const bridge = { loadEnabledArchives: () => ({ archives: [], missing: [] }) }

    const wellFormed = {
      pous: [],
      dataTypes: [],
      libraries: [],
      configuration: { resource: { tasks: [], instances: [], globalVariables: [] } },
    }

    it('accepts the payload the editor adapter actually sends', async () => {
      // Guards the other direction from the rejection cases below: a validator
      // that turns away a well-formed build is a worse regression than the hole
      // it closes. This is `IpcProjectData`'s shape — note `configuration`
      // (singular), which is what the adapter emits and what `stubProgramFor`
      // reads.
      const compilerModule = new CompilerModule()
      const { messages, channel } = makeChannel()

      await compilerModule.compileLibrary(['/project', wellFormed, []], channel, bridge)

      const result = readBuildResult(messages)
      // It still fails — there is no `library.json` on disk at `/project` — but
      // it must fail on THAT, having passed the boundary check.
      expect(result?.error ?? '').not.toMatch(
        /malformed request|no project path|no project data|no POU list|no configuration|no resource|no task or instance list/,
      )
    })

    it.each([
      ['not an array', 'malformed request'],
      [[], 'malformed request'],
      [['/project'], 'malformed request'],
      [['', wellFormed, []], 'no project path'],
      [['/project', null, []], 'no project data'],
      [['/project', {}, []], 'no POU list'],
      [['/project', { pous: [] }, []], 'no configuration'],
      [['/project', { pous: [], configuration: {} }, []], 'no resource'],
      [['/project', { pous: [], configuration: { resource: {} } }, []], 'no task or instance list'],
    ])('rejects %p with a result and a closed port', async (args, expected) => {
      const compilerModule = new CompilerModule()
      const { messages, isClosed, channel } = makeChannel()

      await compilerModule.compileLibrary(args, channel, bridge)

      const result = readBuildResult(messages)
      // A result is what settles the renderer's promise — the assertion that
      // matters more than the wording.
      expect(result).not.toBeNull()
      expect(result?.success).toBe(false)
      expect(result?.error).toContain(expected)

      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(isClosed()).toBe(true)
    })
  })
})
