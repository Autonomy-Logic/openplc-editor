import { spawn } from 'node:child_process'

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
// alongside spawn. handleCoreInstallation only ever reaches spawn, and only
// on the install path; the relaxed-pin tests assert it is NOT spawned when the
// same core is already present, so a bare jest.fn() for spawn suffices.
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

describe('handleCoreInstallation (prebuilt core pin relaxed)', () => {
  let compilerModule: CompilerModule

  beforeEach(() => {
    compilerModule = new CompilerModule()
    jest.mocked(spawn).mockClear()
  })

  it('does nothing when boardCore is null', async () => {
    const log = jest.fn()
    const coresSpy = jest.spyOn(compilerModule, 'getArduinoInstalledCores')
    await compilerModule.handleCoreInstallation(null, log)
    expect(coresSpy).not.toHaveBeenCalled()
    expect(spawn).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
  })

  it('skips install (no spawn) when the same core is present, even with a divergent pinned version', async () => {
    const log = jest.fn()
    jest
      .spyOn(compilerModule, 'getArduinoInstalledCores')
      .mockResolvedValue({ 'FACTS:samd': { version: '1.7.99' } } as unknown as InstalledCores)

    // Pinned 1.7.13, but 1.7.99 is installed: the relaxed policy accepts it.
    await compilerModule.handleCoreInstallation('FACTS:samd', log, '1.7.13')

    expect(spawn).not.toHaveBeenCalled()
    const message = log.mock.calls.map((c) => String(c[0])).join('\n')
    expect(message).toMatch(/already installed/)
    expect(message).toMatch(/1\.7\.13 not enforced/)
  })

  it('skips install when the core is present and no version is pinned', async () => {
    const log = jest.fn()
    jest
      .spyOn(compilerModule, 'getArduinoInstalledCores')
      .mockResolvedValue({ 'arduino:avr': { version: '1.8.6' } } as unknown as InstalledCores)

    await compilerModule.handleCoreInstallation('arduino:avr', log)

    expect(spawn).not.toHaveBeenCalled()
    const message = log.mock.calls.map((c) => String(c[0])).join('\n')
    expect(message).toMatch(/already installed/)
    expect(message).not.toMatch(/not enforced/)
  })
})
