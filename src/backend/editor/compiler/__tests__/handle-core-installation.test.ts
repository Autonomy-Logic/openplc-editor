import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'

import { CompilerModule } from '../compiler-module'

// Electron is imported transitively by compiler-module; stub the bits the
// instantiation path actually touches so jest doesn't load the real runtime.
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

// compiler-module pulls in recipe-exec, which calls promisify(execFile) at
// module load, so the mock must expose exec/execFile (with promisify.custom)
// alongside spawn. handleCoreInstallation reaches spawn only on the install
// path (core absent OR a pinned version is requested); the skip-path tests
// assert spawn is NOT called.
jest.mock('node:child_process', () => {
  const { promisify } = jest.requireActual('node:util') as typeof import('node:util')
  const noop = async () => ({ stdout: '', stderr: '' })
  const exec = (
    _cmd: string,
    _opts: unknown,
    cb: (err: Error | null, val?: { stdout: string; stderr: string }) => void,
  ) => {
    noop().then((v) => cb(null, v))
    return { kill: () => undefined }
  }
  ;(exec as unknown as { [k: symbol]: unknown })[promisify.custom] = () => noop()
  const execFile = (
    _command: string,
    _args: ReadonlyArray<string>,
    _opts: unknown,
    cb: (err: Error | null, val?: { stdout: string; stderr: string }) => void,
  ) => {
    noop().then((v) => cb(null, v))
    return { kill: () => undefined }
  }
  ;(execFile as unknown as { [k: symbol]: unknown })[promisify.custom] = () => noop()
  return { exec, execFile, spawn: jest.fn() }
})
;(process as unknown as { resourcesPath: string }).resourcesPath ??= process.cwd()

type InstalledCores = Awaited<ReturnType<CompilerModule['getArduinoInstalledCores']>>

// A fake ChildProcess that satisfies handleCoreInstallation's wiring
// (stdout/stderr `.on`, plus a `close` event) and reports the given exit code
// on the next tick so the `.on('close')` handler is registered first.
function fakeChild(exitCode = 0) {
  const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  setImmediate(() => child.emit('close', exitCode))
  return child
}

describe('handleCoreInstallation (prebuilt core pin = exact manifest version)', () => {
  let compilerModule: CompilerModule

  beforeEach(() => {
    compilerModule = new CompilerModule()
    jest.mocked(spawn).mockReset()
  })

  it('does nothing when boardCore is null', async () => {
    const log = jest.fn()
    const coresSpy = jest.spyOn(compilerModule, 'getArduinoInstalledCores')
    await compilerModule.handleCoreInstallation(null, log)
    expect(coresSpy).not.toHaveBeenCalled()
    expect(spawn).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
  })

  it('installs the EXACT pinned version even when a different version is already present', async () => {
    const log = jest.fn()
    jest.mocked(spawn).mockReturnValue(fakeChild(0) as unknown as ReturnType<typeof spawn>)
    jest
      .spyOn(compilerModule, 'getArduinoInstalledCores')
      .mockResolvedValue({ 'FACTS:samd': { version: '1.7.99' } } as unknown as InstalledCores)

    await compilerModule.handleCoreInstallation('FACTS:samd', log, '1.7.13')

    expect(spawn).toHaveBeenCalledTimes(1)
    const [, argv] = jest.mocked(spawn).mock.calls[0]
    expect(argv).toEqual(expect.arrayContaining(['core', 'install', 'FACTS:samd@1.7.13']))
  })

  it('installs the pinned version when the core is absent', async () => {
    const log = jest.fn()
    jest.mocked(spawn).mockReturnValue(fakeChild(0) as unknown as ReturnType<typeof spawn>)
    jest.spyOn(compilerModule, 'getArduinoInstalledCores').mockResolvedValue({} as InstalledCores)

    await compilerModule.handleCoreInstallation('FACTS:samd', log, '1.7.13')

    expect(spawn).toHaveBeenCalledTimes(1)
    const [, argv] = jest.mocked(spawn).mock.calls[0]
    expect(argv).toEqual(expect.arrayContaining(['core', 'install', 'FACTS:samd@1.7.13']))
  })

  it('rejects when the pinned version install fails (non-zero exit)', async () => {
    const log = jest.fn()
    jest.mocked(spawn).mockReturnValue(fakeChild(1) as unknown as ReturnType<typeof spawn>)
    jest.spyOn(compilerModule, 'getArduinoInstalledCores').mockResolvedValue({} as InstalledCores)

    await expect(compilerModule.handleCoreInstallation('FACTS:samd', log, '9.9.9')).rejects.toThrow(
      /exited with code 1/,
    )
  })

  it('skips install (no spawn) only when the core is present AND no version is pinned', async () => {
    const log = jest.fn()
    jest
      .spyOn(compilerModule, 'getArduinoInstalledCores')
      .mockResolvedValue({ 'arduino:avr': { version: '1.8.6' } } as unknown as InstalledCores)

    await compilerModule.handleCoreInstallation('arduino:avr', log)

    expect(spawn).not.toHaveBeenCalled()
    const message = log.mock.calls.map((c) => String(c[0])).join('\n')
    expect(message).toMatch(/already installed/)
  })
})
