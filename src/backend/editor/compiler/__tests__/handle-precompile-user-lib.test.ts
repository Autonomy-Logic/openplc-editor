import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CompilerModule } from '../compiler-module'
import type { ToolchainProperties } from '../types'

// Electron is imported transitively by compiler-module; stub the bits the
// instantiation path actually touches so jest doesn't have to load the real
// runtime in the renderer-test environment.
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn().mockReturnValue('/tmp/mock-user-data'),
    getAppPath: jest.fn().mockReturnValue('/tmp/mock-app-root'),
    isPackaged: false,
    getVersion: jest.fn().mockReturnValue('0.0.0-test'),
  },
  dialog: { showSaveDialog: jest.fn().mockResolvedValue({ filePath: '/tmp/mock-save-path' }) },
}))
jest.mock('electron/main', () => ({}), { virtual: true })

// Route every child-process invocation through a shared `execImpl.current`
// dispatcher so tests can capture the argv each precompile TU spawn produces.
// execFile is the path recipe-exec.ts hits today; exec stays mocked for the
// legacy compile-related call sites in the module's wider call graph.
const execImpl: { current: (cmd: string) => Promise<{ stdout: string; stderr: string }> } = {
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
      .then((v) => cb(null, v))
      .catch((e: Error) => cb(e))
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
      .then((v) => cb(null, v))
      .catch((e: Error) => cb(e))
    return { kill: () => undefined }
  }
  ;(execFile as unknown as { [k: symbol]: unknown })[promisify.custom] = (
    command: string,
    args: ReadonlyArray<string>,
  ) => execImpl.current(renderArgvAsCmd(command, args))
  return { exec, execFile, spawn: jest.fn() }
})
;(process as unknown as { resourcesPath: string }).resourcesPath ??= process.cwd()

describe('handlePrecompileUserLib include-path injection', () => {
  const fs = jest.requireActual('node:fs') as typeof import('node:fs')
  const noopLog = jest.fn()
  let compilerModule: CompilerModule
  let buildDir: string
  let srcDir: string
  let extractSpy: jest.SpyInstance

  // The recipe deliberately includes `{includes}` twice and a trailing
  // `-o {object_file}` so every assertion that scans the rendered command
  // can rely on a stable, deterministic shape.
  const baseProps: ToolchainProperties = {
    fqbn: 'arduino:renesas_uno:unor4wifi',
    properties: {
      'compiler.path': '/fake/renesas/bin/',
      'compiler.ar.cmd': 'arm-none-eabi-ar',
      'compiler.ar.flags': 'rcs',
      'build.arch': 'RENESAS_UNO',
      'build.core.path': '/fake/renesas/cores/arduino',
      'build.variant.path': '/fake/renesas/variants/UNOWIFIR4',
    },
    recipeCpp: 'arm-none-eabi-g++ -c {source_file} {includes} -o {object_file}',
    recipeC: 'arm-none-eabi-gcc -c {source_file} {includes} -o {object_file}',
    recipeAr: 'arm-none-eabi-ar rcs {archive_file_path} {object_file}',
  }

  beforeEach(() => {
    compilerModule = new CompilerModule()
    noopLog.mockClear()
    buildDir = fs.mkdtempSync(join(tmpdir(), 'openplc-precompile-includes-'))
    srcDir = join(buildDir, 'src')
    fs.mkdirSync(srcDir, { recursive: true })
    extractSpy = jest
      .spyOn(compilerModule, 'extractToolchainProperties')
      .mockResolvedValue(baseProps as unknown as ToolchainProperties)
    execImpl.current = async () => ({ stdout: '', stderr: '' })
  })

  afterEach(() => {
    extractSpy.mockRestore()
    fs.rmSync(buildDir, { recursive: true, force: true })
  })

  it('injects -I{build.core.path} and -I{build.variant.path} into every TU compile', async () => {
    // The Renesas-style failure mode: c_blocks_code.cpp includes <Arduino.h>
    // which lives at build.core.path/Arduino.h. The platform recipe leaves
    // the bare core/variant -I out of recipe.cpp.o.pattern and relies on
    // arduino-cli to inject them at compile time via {includes}. The
    // precompile mirrors that injection here.
    fs.writeFileSync(join(srcDir, 'c_blocks_code.cpp'), '#include <Arduino.h>\n', 'utf-8')

    const execCalls: string[] = []
    execImpl.current = async (cmd) => {
      execCalls.push(cmd)
      return { stdout: '', stderr: '' }
    }

    await compilerModule.handlePrecompileUserLib({
      compilationPath: buildDir,
      fqbn: 'arduino:renesas_uno:unor4wifi',
      handleOutputData: noopLog,
    })

    const compileCmd = execCalls.find((c) => c.includes('c_blocks_code.cpp')) ?? ''
    expect(compileCmd).toContain('-I/fake/renesas/cores/arduino')
    expect(compileCmd).toContain('-I/fake/renesas/variants/UNOWIFIR4')
  })

  it('omits the variant -I when build.variant.path is unset (runtime-only / minimalist cores)', async () => {
    extractSpy.mockResolvedValue({
      ...baseProps,
      properties: { ...baseProps.properties, 'build.variant.path': '' },
    } as unknown as ToolchainProperties)

    fs.writeFileSync(join(srcDir, 'c_blocks_code.cpp'), '#include <Arduino.h>\n', 'utf-8')

    const execCalls: string[] = []
    execImpl.current = async (cmd) => {
      execCalls.push(cmd)
      return { stdout: '', stderr: '' }
    }

    await compilerModule.handlePrecompileUserLib({
      compilationPath: buildDir,
      fqbn: 'arduino:renesas_uno:unor4wifi',
      handleOutputData: noopLog,
    })

    const compileCmd = execCalls.find((c) => c.includes('c_blocks_code.cpp')) ?? ''
    expect(compileCmd).toContain('-I/fake/renesas/cores/arduino')
    // No bare `-I` followed by space-then-empty — the variant flag is dropped entirely.
    expect(compileCmd).not.toMatch(/-I(\s|$)/)
  })

  it('hard-fails with an actionable error when build.core.path is missing from --show-properties', async () => {
    extractSpy.mockResolvedValue({
      ...baseProps,
      properties: {
        'compiler.path': '/fake/renesas/bin/',
        'compiler.ar.cmd': 'arm-none-eabi-ar',
        'compiler.ar.flags': 'rcs',
        // build.core.path intentionally absent — TUs that include
        // <Arduino.h> would silently fail to find the header otherwise.
      },
    } as unknown as ToolchainProperties)

    fs.writeFileSync(join(srcDir, 'c_blocks_code.cpp'), '#include <Arduino.h>\n', 'utf-8')

    await expect(
      compilerModule.handlePrecompileUserLib({
        compilationPath: buildDir,
        fqbn: 'arduino:renesas_uno:unor4wifi',
        handleOutputData: noopLog,
      }),
    ).rejects.toThrow(/build\.core\.path.*core is likely not installed/s)
  })
})
