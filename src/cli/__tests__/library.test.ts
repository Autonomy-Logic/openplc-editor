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

jest.mock('@root/backend/editor/library-manager', () => ({
  LibraryManagerModule: jest.fn().mockImplementation(() => ({
    listInstalled: () => [
      { name: 'modbee-protocol', version: '0.1.0', bundled: false, installedAt: '', origin: 'stlib' },
    ],
    installFromFile: jest.fn(),
    loadAll: () => [],
    loadEnabledArchives: () => ({ archives: [], missing: [] }),
  })),
}))

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
  it('names the three subcommands when given none', async () => {
    const { result, payload } = await run(['library'])
    expect(result.exitCode).toBe(ExitCode.Usage)
    expect(payload.error.code).toBe(ErrorCode.InvalidArgument)
    expect(payload.error.message).toContain('build, install or list')
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
})
