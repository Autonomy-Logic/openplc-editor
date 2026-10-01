import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'

import { CompilerModule } from '../compiler-module'

// Same stubbing contract as handle-core-installation.test.ts: electron is
// imported transitively, and recipe-exec promisifies execFile at module load.
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

function fakeChild(exitCode = 0, stdout = '') {
  const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  setImmediate(() => {
    if (stdout) child.stdout.emit('data', Buffer.from(stdout))
    child.emit('close', exitCode)
  })
  return child
}

/** Every argv the mock `spawn` was called with, as flat strings. */
function spawnedArgs(): string[][] {
  return jest.mocked(spawn).mock.calls.map((call) => (call[1] as string[]) ?? [])
}

describe('handleLibraryInstallation — spawning only when something is missing', () => {
  let compilerModule: CompilerModule
  let log: jest.Mock

  beforeEach(() => {
    compilerModule = new CompilerModule()
    log = jest.fn()
    jest.mocked(spawn).mockReset()
    jest.spyOn(compilerModule, 'recordLibrariesInstalled').mockResolvedValue(undefined)
  })

  it('spawns nothing when the cache already lists every required library', async () => {
    // THE bug this work fixed. `arduino-cli lib install` on an
    // already-installed library still checks the index over the network before
    // answering "already installed" — 1-2 s each on Windows, on every build.
    jest
      .spyOn(compilerModule, 'getArduinoInstalledLibraries')
      .mockResolvedValue([...CompilerModule.GLOBAL_LIBRARIES, 'P1AM'])

    await compilerModule.handleLibraryInstallation(['P1AM'], log)

    expect(spawn).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith('All required libraries are already installed.', 'info')
  })

  it('installs only the libraries actually missing, not the whole set', async () => {
    const [first, ...rest] = CompilerModule.GLOBAL_LIBRARIES
    jest.spyOn(compilerModule, 'getArduinoInstalledLibraries').mockResolvedValue([...rest])
    jest.mocked(spawn).mockImplementation(() => fakeChild(0) as never)

    await compilerModule.handleLibraryInstallation([], log)

    expect(spawnedArgs()).toEqual([['lib', 'install', first, ...compilerModule.arduinoCliBaseParameters]])
  })

  it('records what it installed, so the next build skips it', async () => {
    const [first, ...rest] = CompilerModule.GLOBAL_LIBRARIES
    jest.spyOn(compilerModule, 'getArduinoInstalledLibraries').mockResolvedValue([...rest])
    jest.mocked(spawn).mockImplementation(() => fakeChild(0) as never)
    const record = jest.spyOn(compilerModule, 'recordLibrariesInstalled').mockResolvedValue(undefined)

    await compilerModule.handleLibraryInstallation([], log)

    // Without this the cache only ever reflects startup, and the same library
    // is reinstalled for the rest of the session.
    expect(record).toHaveBeenCalledWith([first])
  })

  it('does NOT record anything when the install fails', async () => {
    const [first, ...rest] = CompilerModule.GLOBAL_LIBRARIES
    jest.spyOn(compilerModule, 'getArduinoInstalledLibraries').mockResolvedValue([...rest])
    jest.mocked(spawn).mockImplementation(() => fakeChild(1) as never)
    const record = jest.spyOn(compilerModule, 'recordLibrariesInstalled').mockResolvedValue(undefined)

    await compilerModule.handleLibraryInstallation([], log)

    // Caching a failed install would make the library permanently invisible.
    expect(record).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(expect.stringContaining('exited with code 1'), 'warning')
  })

  it('rebuilds the cache from arduino-cli once when it cannot be read, instead of assuming empty', async () => {
    // `null` is "I do not know". Reading it as "nothing is installed" is what
    // made a machine with a failed startup refresh reinstall all twenty
    // globals on every single build.
    jest.spyOn(compilerModule, 'getArduinoInstalledLibraries').mockResolvedValue(null)
    const listed = JSON.stringify({
      installed_libraries: CompilerModule.GLOBAL_LIBRARIES.map((name) => ({ library: { name } })),
    })
    jest.mocked(spawn).mockImplementation(() => fakeChild(0, listed) as never)

    await compilerModule.handleLibraryInstallation([], log)

    // One `lib list` to find out — and then no `lib install` at all.
    expect(spawnedArgs()).toEqual([['lib', 'list', '--json', ...compilerModule.arduinoCliBaseParameters]])
    expect(log).toHaveBeenCalledWith('All required libraries are already installed.', 'info')
  })
})

describe('handleLibraryInstallation — third-party (git-url) libraries', () => {
  const OPEN62541 = {
    name: 'open62541',
    gitUrl: 'https://github.com/Autonomy-Logic/open62541-embedded.git',
    reason: 'OPC-UA server',
  }

  let compilerModule: CompilerModule
  let log: jest.Mock

  beforeEach(() => {
    compilerModule = new CompilerModule()
    log = jest.fn()
    jest.mocked(spawn).mockReset()
    jest.spyOn(compilerModule, 'recordLibrariesInstalled').mockResolvedValue(undefined)
  })

  it('installs an absent one with --git-url', async () => {
    jest.spyOn(compilerModule, 'getArduinoInstalledLibraries').mockResolvedValue([...CompilerModule.GLOBAL_LIBRARIES])
    jest.mocked(spawn).mockImplementation(() => fakeChild(0) as never)

    await compilerModule.handleLibraryInstallation([], log, [OPEN62541])

    expect(spawnedArgs()).toEqual([
      ['lib', 'install', '--git-url', OPEN62541.gitUrl, ...compilerModule.arduinoCliBaseParameters],
    ])
    // The user sees an unfamiliar clone in the log; it says who asked for it.
    expect(log).toHaveBeenCalledWith(expect.stringContaining('OPC-UA server'), 'info')
  })

  it('skips one the cache already knows about', async () => {
    // Cloning open62541 is ~7 MB. Doing it per build is the same defect as the
    // index libraries, only more expensive.
    jest
      .spyOn(compilerModule, 'getArduinoInstalledLibraries')
      .mockResolvedValue([...CompilerModule.GLOBAL_LIBRARIES, 'open62541'])

    await compilerModule.handleLibraryInstallation([], log, [OPEN62541])

    expect(spawn).not.toHaveBeenCalled()
  })

  it('records it under its library.properties name, which is what lib list reports', async () => {
    jest.spyOn(compilerModule, 'getArduinoInstalledLibraries').mockResolvedValue([...CompilerModule.GLOBAL_LIBRARIES])
    jest.mocked(spawn).mockImplementation(() => fakeChild(0) as never)
    const record = jest.spyOn(compilerModule, 'recordLibrariesInstalled').mockResolvedValue(undefined)

    await compilerModule.handleLibraryInstallation([], log, [OPEN62541])

    // Record it under anything else and the skip check above never matches.
    expect(record).toHaveBeenCalledWith(['open62541'])
  })

  it('warns and continues when the clone fails, leaving the compile to be the judge', async () => {
    jest.spyOn(compilerModule, 'getArduinoInstalledLibraries').mockResolvedValue([...CompilerModule.GLOBAL_LIBRARIES])
    jest.mocked(spawn).mockImplementation(() => fakeChild(1) as never)
    const record = jest.spyOn(compilerModule, 'recordLibrariesInstalled').mockResolvedValue(undefined)

    await expect(compilerModule.handleLibraryInstallation([], log, [OPEN62541])).resolves.not.toThrow()

    expect(log).toHaveBeenCalledWith(expect.stringContaining('could not install open62541'), 'warning')
    expect(record).not.toHaveBeenCalled()
  })

  it('installs git-url libraries before index ones', async () => {
    // A target that needs open62541 cannot compile without it; the index
    // libraries are mostly optional per-board extras. Order matters only for
    // which failure the user reads first, but that is worth being about.
    const [first, ...rest] = CompilerModule.GLOBAL_LIBRARIES
    jest.spyOn(compilerModule, 'getArduinoInstalledLibraries').mockResolvedValue([...rest])
    jest.mocked(spawn).mockImplementation(() => fakeChild(0) as never)

    await compilerModule.handleLibraryInstallation([], log, [OPEN62541])

    expect(spawnedArgs()).toEqual([
      ['lib', 'install', '--git-url', OPEN62541.gitUrl, ...compilerModule.arduinoCliBaseParameters],
      ['lib', 'install', first, ...compilerModule.arduinoCliBaseParameters],
    ])
  })
})
