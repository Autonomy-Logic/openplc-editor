/**
 * `openplc-cli library` — argument handling and result shaping.
 *
 * The heavy paths (a real build, a real install) belong to the modules this
 * command drives and are covered where they live. What is tested here is the
 * part the command owns: which subcommands exist, what a missing argument
 * reports, and the shape of what comes back.
 */

import { parseArgs } from '../args'
import { runLibrary } from '../commands/library'
import { ErrorCode, ExitCode } from '../exit-codes'
import { Reporter, type WriterStreams } from '../output'

// The compiler drags in the hardware and package-manager modules, which want
// Electron's `app`. Nothing here builds, so it is stubbed rather than loaded.
jest.mock('@root/backend/editor/compiler', () => ({
  CompilerModule: jest.fn().mockImplementation(() => ({ compileLibrary: jest.fn() })),
}))

jest.mock('../project/load', () => ({
  loadProject: jest.fn(),
}))

// Mutable so a test can describe the store it wants without re-mocking.
const libraryStore: {
  installed: Array<Record<string, unknown>>
  archives: Record<string, string | null>
  uninstalled: Array<{ name: string; version?: string }>
  uninstallResult: { success: boolean; error?: string }
} = {
  installed: [],
  archives: {},
  uninstalled: [],
  uninstallResult: { success: true },
}

jest.mock('@root/backend/editor/library-manager', () => ({
  LibraryManagerModule: jest.fn().mockImplementation(() => ({
    listInstalled: () => libraryStore.installed,
    installFromFile: jest.fn(),
    loadAll: () => [],
    loadEnabledArchives: () => ({ archives: [], missing: [] }),
    readArchiveText: (name: string, version?: string) =>
      libraryStore.archives[version ? `${name}@${version}` : name] ?? null,
    uninstall: (name: string, version?: string) => {
      libraryStore.uninstalled.push({ name, version })
      if (libraryStore.uninstallResult.success) {
        libraryStore.installed = libraryStore.installed
          .map((row) => ({ ...row, versions: ((row.versions as string[]) ?? []).filter((v) => v !== version) }))
          .filter((row) => (row.versions as string[]).length > 0)
      }
      return libraryStore.uninstallResult
    },
  })),
}))

const MODBEE = { name: 'modbee-protocol', version: '0.1.0', bundled: false, installedAt: '', origin: 'stlib' }

beforeEach(() => {
  libraryStore.installed = [{ ...MODBEE, versions: ['0.1.0'] }]
  libraryStore.archives = {}
  libraryStore.uninstalled = []
  libraryStore.uninstallResult = { success: true }
})

function capture(): { streams: WriterStreams; out: string[]; err: string[] } {
  const out: string[] = []
  const err: string[] = []
  return { streams: { out: (t) => out.push(t), err: (t) => err.push(t) }, out, err }
}

const run = async (argv: string[]) => {
  const { streams, out } = capture()
  const reporter = new Reporter({ mode: 'json', streams })
  const result = await runLibrary(parseArgs(argv), reporter)
  return { result, payload: out.length > 0 ? JSON.parse(out[0]) : undefined }
}

describe('openplc-cli library', () => {
  it('names the subcommands when given none', async () => {
    const { result, payload } = await run(['library'])
    expect(result.exitCode).toBe(ExitCode.Usage)
    expect(payload.error.code).toBe(ErrorCode.InvalidArgument)
    expect(payload.error.message).toContain('build, install, uninstall, info, list, pin or unpin')
  })

  it('rejects an unknown subcommand rather than guessing', async () => {
    const { result, payload } = await run(['library', 'publish'])
    expect(result.exitCode).toBe(ExitCode.Usage)
    expect(payload.error.message).toContain('publish')
  })

  it('asks for a project path when build is given none', async () => {
    const { result, payload } = await run(['library', 'build'])
    expect(result.exitCode).toBe(ExitCode.Usage)
    expect(payload.error.message).toContain('library project')
  })

  it('asks for a file when install is given none', async () => {
    const { result, payload } = await run(['library', 'install'])
    expect(result.exitCode).toBe(ExitCode.Usage)
    expect(payload.error.message).toContain('.stlib')
  })

  it('lists what the library manager reports as installed', async () => {
    const { result, payload } = await run(['library', 'list'])
    expect(result.exitCode).toBe(ExitCode.Ok)
    expect(payload.ok).toBe(true)
    expect(payload.libraries).toHaveLength(1)
    expect(payload.libraries[0].name).toBe('modbee-protocol')
  })

  it('carries every installed version in the JSON, not just the newest', async () => {
    libraryStore.installed = [{ ...MODBEE, version: '0.2.0', versions: ['0.2.0', '0.1.0'] }]

    const { payload } = await run(['library', 'list'])

    expect(payload.libraries[0].versions).toEqual(['0.2.0', '0.1.0'])
  })

  describe('uninstall', () => {
    it('asks for a name when given none', async () => {
      const { result, payload } = await run(['library', 'uninstall'])
      expect(result.exitCode).toBe(ExitCode.Usage)
      expect(payload.error.message).toContain('name@version')
    })

    it('reports a library that is not installed', async () => {
      const { result, payload } = await run(['library', 'uninstall', 'phantom'])
      expect(result.exitCode).toBe(ExitCode.NotFound)
      expect(payload.error.code).toBe(ErrorCode.TargetError)
    })

    it('removes the only version without being told which', async () => {
      const { result, payload } = await run(['library', 'uninstall', 'modbee-protocol'])
      expect(result.exitCode).toBe(ExitCode.Ok)
      expect(payload.removed).toEqual(['0.1.0'])
      expect(libraryStore.uninstalled).toEqual([{ name: 'modbee-protocol', version: '0.1.0' }])
    })

    it('refuses to guess when several versions are installed', async () => {
      libraryStore.installed = [{ ...MODBEE, version: '0.2.0', versions: ['0.2.0', '0.1.0'] }]

      const { result, payload } = await run(['library', 'uninstall', 'modbee-protocol'])

      expect(result.exitCode).toBe(ExitCode.Usage)
      expect(payload.error.message).toContain('0.2.0, 0.1.0')
      expect(libraryStore.uninstalled).toEqual([])
    })

    it('removes the version named with @', async () => {
      libraryStore.installed = [{ ...MODBEE, version: '0.2.0', versions: ['0.2.0', '0.1.0'] }]

      const { result, payload } = await run(['library', 'uninstall', 'modbee-protocol@0.1.0'])

      expect(result.exitCode).toBe(ExitCode.Ok)
      expect(payload.removed).toEqual(['0.1.0'])
      expect(payload.remaining).toEqual(['0.2.0'])
    })

    it('removes every version under --all', async () => {
      libraryStore.installed = [{ ...MODBEE, version: '0.2.0', versions: ['0.2.0', '0.1.0'] }]

      const { result, payload } = await run(['library', 'uninstall', 'modbee-protocol', '--all'])

      expect(result.exitCode).toBe(ExitCode.Ok)
      expect(payload.removed).toEqual(['0.2.0', '0.1.0'])
    })

    it('passes a refusal from the manager through', async () => {
      libraryStore.installed = [{ ...MODBEE, bundled: true, versions: ['0.1.0'] }]
      libraryStore.uninstallResult = { success: false, error: "Cannot uninstall bundled library 'modbee-protocol'" }

      const { result, payload } = await run(['library', 'uninstall', 'modbee-protocol'])

      expect(result.exitCode).toBe(ExitCode.TargetError)
      expect(payload.error.message).toContain('bundled')
    })
  })

  describe('info', () => {
    const archive = {
      manifest: {
        name: 'modbee-protocol',
        version: '0.1.0',
        namespace: 'modbee',
        description: 'Ring protocol blocks',
        isBuiltin: false,
        functions: [
          { name: 'SCALE', returnType: 'REAL', parameters: [{ name: 'Raw', type: 'INT', direction: 'input' }] },
        ],
        functionBlocks: [
          {
            name: 'ANALOG_IN',
            inputs: [{ name: 'CH', type: 'INT' }],
            outputs: [{ name: 'VAL', type: 'REAL' }],
            inouts: [],
          },
        ],
        types: [{ name: 'MB_TABLE', kind: 'enum' }],
      },
      sources: [{ fileName: 'ring.cpp', source: '' }],
    }

    it('asks for a name when given none', async () => {
      const { result, payload } = await run(['library', 'info'])
      expect(result.exitCode).toBe(ExitCode.Usage)
      expect(payload.error.message).toContain('name@version')
    })

    it('reports a library it cannot read', async () => {
      const { result, payload } = await run(['library', 'info', 'phantom'])
      expect(result.exitCode).toBe(ExitCode.NotFound)
      expect(payload.error.code).toBe(ErrorCode.TargetError)
    })

    it('reports the pins of every block, which is what list cannot', async () => {
      libraryStore.archives['modbee-protocol'] = JSON.stringify(archive)

      const { result, payload } = await run(['library', 'info', 'modbee-protocol'])

      expect(result.exitCode).toBe(ExitCode.Ok)
      expect(payload.library.functionBlocks[0].outputs).toEqual([{ name: 'VAL', type: 'REAL' }])
      expect(payload.library.functions[0].returnType).toBe('REAL')
      expect(payload.library.types).toEqual([{ name: 'MB_TABLE', kind: 'enum' }])
      expect(payload.library.sources).toEqual(['ring.cpp'])
    })

    it('reads the version named with @', async () => {
      libraryStore.installed = [{ ...MODBEE, versions: ['0.1.0', '0.0.9'] }]
      libraryStore.archives['modbee-protocol@0.0.9'] = JSON.stringify(archive)

      const { result } = await run(['library', 'info', 'modbee-protocol@0.0.9'])

      expect(result.exitCode).toBe(ExitCode.Ok)
    })

    it('refuses a version that is not installed rather than showing another one', async () => {
      // `readArchiveText` resolves through `resolveVersion`, which substitutes
      // the newest — right for a compile, which reports the substitution, and
      // wrong here: it printed 0.1.0's blocks under the heading 9.9.9.
      libraryStore.archives['modbee-protocol'] = JSON.stringify(archive)

      const { result, payload } = await run(['library', 'info', 'modbee-protocol@9.9.9'])

      expect(result.exitCode).toBe(ExitCode.NotFound)
      expect(payload.error.message).toContain('version 9.9.9 is not installed')
      expect(payload.error.message).toContain('0.1.0')
    })

    it('reports an archive that is not readable JSON', async () => {
      libraryStore.archives['modbee-protocol'] = '{ not json'

      const { result, payload } = await run(['library', 'info', 'modbee-protocol'])

      expect(result.exitCode).toBe(ExitCode.TargetError)
      expect(payload.error.message).toContain('unreadable')
    })
  })

  describe('pin and unpin', () => {
    it('asks for both arguments when pin is given none', async () => {
      const { result, payload } = await run(['library', 'pin'])
      expect(result.exitCode).toBe(ExitCode.Usage)
      expect(payload.error.message).toContain('name@version')
    })

    it('insists on a version, since a pin without one is what it exists to set', async () => {
      const { result, payload } = await run(['library', 'pin', './proj', 'modbee-protocol'])
      expect(result.exitCode).toBe(ExitCode.Usage)
      expect(payload.error.message).toContain('needs a version')
    })

    it('asks for both arguments when unpin is given none', async () => {
      const { result, payload } = await run(['library', 'unpin', './proj'])
      expect(result.exitCode).toBe(ExitCode.Usage)
      expect(payload.error.message).toContain('library name')
    })
  })
})
