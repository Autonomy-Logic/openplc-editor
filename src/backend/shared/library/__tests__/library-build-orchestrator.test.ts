/**
 * Tests for the shared library-build orchestrator.
 *
 * The orchestrator's job is to drive the 7-stage flow through a
 * `LibraryBuildPort`.  These tests mock the port + the inner shared
 * helpers (`prepareXmlForLibraryBuild`, `libraryBuildFromTranspiledSt`)
 * and verify the orchestrator's contract: stage ordering, error
 * propagation, cache hit/miss, archive feed-through, verification
 * gating.
 *
 * Production callers (desktop adapter and the future web adapter) get
 * exercised through their own integration paths — this file is
 * unit-level for the orchestration logic itself.
 */

import type { LibraryBuildPort, VerifyCompileArgs } from '../../../../middleware/shared/ports/library-build-port'
import type { TranspileToStArgs, TranspileToStResult } from '../../../../middleware/shared/ports/compiler-platform-port'
import type { PLCProjectData } from '../../types/PLC/open-plc'

// ST the fake `transpileToSt` port method emits.  Fixed content so the
// verification-cache tests can precompute the harness MD5 off it.
const FAKE_PROGRAM_ST = 'PROGRAM main\n(* transpiled *)\nEND_PROGRAM\n'

// ---------------------------------------------------------------------------
// Mocks for the inner shared helpers
// ---------------------------------------------------------------------------

const mockPrepareXml = jest.fn()
const mockLibraryBuild = jest.fn()
const mockComposeVerify = jest.fn((project: { meta: unknown; data: unknown }) => ({
  meta: { ...(project.meta as Record<string, unknown>), type: 'plc-project' },
  data: project.data,
}))

jest.mock('../build-pipeline', () => ({
  prepareXmlForLibraryBuild: (...args: unknown[]) => mockPrepareXml(...args),
  libraryBuildFromTranspiledSt: (...args: unknown[]) => mockLibraryBuild(...args),
  composeVerificationProject: (...args: unknown[]) =>
    mockComposeVerify(...(args as [{ meta: unknown; data: unknown }])),
}))

import { runLibraryBuildPipeline } from '../library-build-orchestrator'

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

interface PortHarness {
  port: LibraryBuildPort
  files: Map<string, string>
  manifestContent: string | null
  archives: unknown[]
  missing: string[]
  verifyResult: { success: boolean; message?: string }
  verifyCalls: VerifyCompileArgs[]
  transpileResult: TranspileToStResult
  transpileCalls: TranspileToStArgs[]
  /** Programmable error for whichever method the test wants to fail. */
  throwOn: Partial<Record<keyof LibraryBuildPort, Error>>
}

function makePort(): PortHarness {
  const harness: PortHarness = {
    port: undefined as unknown as LibraryBuildPort,
    files: new Map<string, string>(),
    manifestContent: '{"name":"lib","version":"0.1.0","namespace":"lib"}',
    archives: [],
    missing: [],
    verifyResult: { success: true },
    verifyCalls: [],
    transpileResult: { ok: true, programSt: FAKE_PROGRAM_ST },
    transpileCalls: [],
    throwOn: {},
  }
  harness.port = {
    async computeMd5(input: string) {
      // Deterministic stand-in — same input → same hash, different
      // inputs → different hashes.  Length-prefix makes near-duplicates
      // distinguishable.
      return `md5-${input.length}-${input.charCodeAt(0) ?? 0}`
    },
    async transpileToSt(args: TranspileToStArgs, log) {
      if (harness.throwOn.transpileToSt) throw harness.throwOn.transpileToSt
      harness.transpileCalls.push(args)
      // Exercise the orchestrator's log-forwarding lambda.
      log('transpiler: parsing project IR', 'info')
      return harness.transpileResult
    },
    async readBuildFile(_projectPath: string, relPath: string) {
      if (harness.throwOn.readBuildFile) throw harness.throwOn.readBuildFile
      if (relPath === 'library.json') return harness.manifestContent
      return harness.files.get(relPath) ?? null
    },
    async writeBuildFile(_projectPath: string, relPath: string, content: string) {
      if (harness.throwOn.writeBuildFile) throw harness.throwOn.writeBuildFile
      harness.files.set(relPath, content)
    },
    async deleteBuildSubtree(_projectPath: string, relPath: string) {
      if (harness.throwOn.deleteBuildSubtree) throw harness.throwOn.deleteBuildSubtree
      for (const key of [...harness.files.keys()]) {
        if (key.startsWith(`${relPath}/`)) harness.files.delete(key)
      }
    },
    async loadLibraryArchives() {
      if (harness.throwOn.loadLibraryArchives) throw harness.throwOn.loadLibraryArchives
      return { archives: harness.archives, missing: harness.missing }
    },
    async verifyCompile(args) {
      harness.verifyCalls.push(args)
      args.emit('verifying...', 'info')
      return harness.verifyResult
    },
  }
  return harness
}

function projectDataEmpty(): PLCProjectData {
  return {
    pous: [],
    dataTypes: [],
    libraries: [],
    configuration: { resource: { tasks: [], instances: [], globalVariables: [] } },
  } as unknown as PLCProjectData
}

function captureEvents() {
  const events: Array<{ message: string; level: string }> = []
  return { events, emit: (e: { message: string; level: string }) => events.push(e) }
}

beforeEach(() => {
  mockPrepareXml.mockReset()
  mockLibraryBuild.mockReset()
  mockComposeVerify.mockClear()

  mockPrepareXml.mockReturnValue({
    projectData: projectDataEmpty(),
    knownPous: [],
    manifest: { name: 'lib', version: '0.1.0', namespace: 'lib', extra: {} },
  })
  mockLibraryBuild.mockReturnValue({ success: true, archive: { stub: true }, errors: [] })
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runLibraryBuildPipeline', () => {
  it('emits stages in canonical order and writes the .stlib at build/{name}.stlib', async () => {
    const harness = makePort()
    const { events, emit } = captureEvents()

    const result = await runLibraryBuildPipeline(
      {
        projectPath: '/project',
        projectData: projectDataEmpty(),
        verifyProjectData: projectDataEmpty(),
        cleanBuild: false,
      },
      harness.port,
      emit,
    )

    expect(result.success).toBe(true)
    expect(result.libraryName).toBe('lib')
    expect(result.stlibPath).toBe('build/lib.stlib')
    expect(harness.files.get('build/lib.stlib')).toMatch(/^\{[\s\S]+\}\n$/)
    // Verification cache persisted with the MD5 the orchestrator computed.
    expect(harness.files.has('build/.verify-cache-library.json')).toBe(true)
    // Intermediates (program.st) live in memory only — the ST is
    // produced in-process by `transpileToSt` and never persisted.
    // See the path-constants comment in library-build-orchestrator.ts.
    expect(harness.files.has('build/library/src/program.st')).toBe(false)
    // Stage messages flow through in order.
    expect(events.map((e) => e.message)).toEqual(
      expect.arrayContaining([
        'Starting library build...',
        'Manifest OK — building "lib" v0.1.0.',
        'Transpiling project to Structured Text',
        'Verifying with OpenPLC Simulator (avr-gcc)...',
        'Compiling library archive...',
        'Library built successfully: build/lib.stlib',
      ]),
    )
    // The stubbed projectData from Stage 1 is what the transpiler sees.
    expect(harness.transpileCalls).toHaveLength(1)
  })

  it('does not call deleteBuildSubtree (intermediates are no longer persisted)', async () => {
    // Regression guard: dropping the intermediate file writes means
    // dropping the subtree clear too — no orphan files to leave
    // behind from the previous run.
    const harness = makePort()
    const deleteSpy = jest.spyOn(harness.port, 'deleteBuildSubtree')
    const { emit } = captureEvents()

    await runLibraryBuildPipeline(
      {
        projectPath: '/project',
        projectData: projectDataEmpty(),
        verifyProjectData: projectDataEmpty(),
        cleanBuild: false,
      },
      harness.port,
      emit,
    )

    expect(deleteSpy).not.toHaveBeenCalled()
  })

  it('fails fast when the manifest is missing from the project', async () => {
    const harness = makePort()
    harness.manifestContent = null
    const { events, emit } = captureEvents()

    const result = await runLibraryBuildPipeline(
      {
        projectPath: '/project',
        projectData: projectDataEmpty(),
        verifyProjectData: projectDataEmpty(),
        cleanBuild: false,
      },
      harness.port,
      emit,
    )

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/library\.json.*missing/)
    // Should NOT have called any later stages.
    expect(mockPrepareXml).not.toHaveBeenCalled()
    expect(mockLibraryBuild).not.toHaveBeenCalled()
    expect(harness.verifyCalls).toHaveLength(0)
  })

  it('feeds the resolved library archives into libraryBuildFromTranspiledSt', async () => {
    // Regression for the TON bug: the orchestrator MUST hand the
    // archives (bundled IEC set + user-enabled) to the strucpp call.
    const harness = makePort()
    const bundledArchive = { manifest: { name: 'iec-standard-fb', functionBlocks: [{ name: 'TON' }] } }
    const userArchive = { manifest: { name: 'oscat-basic', functionBlocks: [] } }
    harness.archives = [bundledArchive, userArchive]
    const { emit } = captureEvents()

    await runLibraryBuildPipeline(
      {
        projectPath: '/project',
        projectData: {
          ...projectDataEmpty(),
          libraries: [{ name: 'oscat-basic', version: '1.0.0' }],
        } as PLCProjectData,
        verifyProjectData: projectDataEmpty(),
        cleanBuild: false,
      },
      harness.port,
      emit,
    )

    const [, , , aux] = mockLibraryBuild.mock.calls[0]
    expect(aux.dependencyArchives).toBe(harness.archives)
    expect(aux.dependencyRefs).toEqual([{ name: 'oscat-basic', version: '1.0.0' }])
  })

  it('aborts before the strucpp compile when the project enables an unresolved library', async () => {
    const harness = makePort()
    harness.missing = ['ghost-lib']
    const { events, emit } = captureEvents()

    const result = await runLibraryBuildPipeline(
      {
        projectPath: '/project',
        projectData: {
          ...projectDataEmpty(),
          libraries: [{ name: 'ghost-lib', version: '1.0.0' }],
        } as PLCProjectData,
        verifyProjectData: projectDataEmpty(),
        cleanBuild: false,
      },
      harness.port,
      emit,
    )

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/ghost-lib/)
    expect(result.error).toMatch(/Library Manager/)
    expect(harness.verifyCalls).toHaveLength(0)
    expect(mockLibraryBuild).not.toHaveBeenCalled()
  })

  it('skips verification when the MD5 cache matches', async () => {
    const harness = makePort()
    // Pre-seed the cache.  computeMd5 in the harness is deterministic
    // off program.st length + first char; the orchestrator's value
    // will match this when the same transpiler output replays.
    const expectedMd5 = `md5-${FAKE_PROGRAM_ST.length}-${FAKE_PROGRAM_ST.charCodeAt(0)}`
    harness.files.set('build/.verify-cache-library.json', JSON.stringify({ md5: expectedMd5, success: true }))
    const { events, emit } = captureEvents()

    await runLibraryBuildPipeline(
      {
        projectPath: '/project',
        projectData: projectDataEmpty(),
        verifyProjectData: projectDataEmpty(),
        cleanBuild: false,
      },
      harness.port,
      emit,
    )

    expect(harness.verifyCalls).toHaveLength(0)
    expect(events.some((e) => e.message.includes('Skipping verification'))).toBe(true)
  })

  it('cleanBuild forces a fresh verification regardless of cache', async () => {
    const harness = makePort()
    const expectedMd5 = `md5-${FAKE_PROGRAM_ST.length}-${FAKE_PROGRAM_ST.charCodeAt(0)}`
    harness.files.set('build/.verify-cache-library.json', JSON.stringify({ md5: expectedMd5, success: true }))
    const { emit } = captureEvents()

    await runLibraryBuildPipeline(
      {
        projectPath: '/project',
        projectData: projectDataEmpty(),
        verifyProjectData: projectDataEmpty(),
        cleanBuild: true,
      },
      harness.port,
      emit,
    )

    expect(harness.verifyCalls).toHaveLength(1)
  })

  it('runs a fresh verification when the cache read throws', async () => {
    const harness = makePort()
    // Throw only on the cache read; the manifest read (Stage 0) must
    // still succeed so we reach the cache-consult path.
    const realRead = harness.port.readBuildFile.bind(harness.port)
    harness.port.readBuildFile = async (projectPath, relPath) => {
      if (relPath === 'build/.verify-cache-library.json') throw new Error('cache read blew up')
      return realRead(projectPath, relPath)
    }
    const { emit } = captureEvents()

    await runLibraryBuildPipeline(
      {
        projectPath: '/project',
        projectData: projectDataEmpty(),
        verifyProjectData: projectDataEmpty(),
        cleanBuild: false,
      },
      harness.port,
      emit,
    )

    // Cache read failed → treated as a miss → fresh verification runs.
    expect(harness.verifyCalls).toHaveLength(1)
  })

  it('runs a fresh verification when the cached file is malformed JSON', async () => {
    const harness = makePort()
    harness.files.set('build/.verify-cache-library.json', '{ not valid json')
    const { emit } = captureEvents()

    await runLibraryBuildPipeline(
      {
        projectPath: '/project',
        projectData: projectDataEmpty(),
        verifyProjectData: projectDataEmpty(),
        cleanBuild: false,
      },
      harness.port,
      emit,
    )

    // Malformed cache → fall through to a real verification run.
    expect(harness.verifyCalls).toHaveLength(1)
  })

  it('surfaces a verification failure as a warning but still emits the .stlib', async () => {
    const harness = makePort()
    harness.verifyResult = { success: false, message: 'AVR ran out of flash' }
    const { events, emit } = captureEvents()

    const result = await runLibraryBuildPipeline(
      {
        projectPath: '/project',
        projectData: projectDataEmpty(),
        verifyProjectData: projectDataEmpty(),
        cleanBuild: false,
      },
      harness.port,
      emit,
    )

    expect(result.success).toBe(true) // verification failure is advisory
    expect(result.verification?.success).toBe(false)
    expect(result.verification?.message).toBe('AVR ran out of flash')
    expect(harness.files.has('build/lib.stlib')).toBe(true)
    expect(events.some((e) => e.level === 'warning' && /Verification reported issues/.test(e.message))).toBe(true)
  })

  it('propagates strucpp compile errors as a fatal build failure', async () => {
    const harness = makePort()
    mockLibraryBuild.mockReturnValueOnce({
      success: false,
      errors: [{ message: "Undefined type 'TON'", file: 'main.st', line: 15 }],
    })
    const { events, emit } = captureEvents()

    const result = await runLibraryBuildPipeline(
      {
        projectPath: '/project',
        projectData: projectDataEmpty(),
        verifyProjectData: projectDataEmpty(),
        cleanBuild: false,
      },
      harness.port,
      emit,
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe("Undefined type 'TON'")
    expect(result.libraryName).toBe('lib')
    // .stlib should NOT be written when compilation failed.
    expect(harness.files.has('build/lib.stlib')).toBe(false)
    // Error line formatted with file + line prefix.
    expect(events.some((e) => /\[main\.st:15\].*Undefined type 'TON'/.test(e.message))).toBe(true)
  })

  it('threads pouDocs and cppBlocks through to libraryBuildFromTranspiledSt', async () => {
    const harness = makePort()
    const { emit } = captureEvents()

    const projectData = {
      ...projectDataEmpty(),
      pous: [{ type: 'function-block', data: { name: 'MyFb', documentation: 'A docstring' } }],
      dataTypes: [{ name: 'MyType', documentation: 'A type description' }],
      originalCppPous: [{ name: 'MyCppFb', code: 'void setup() {}', variables: [] }],
    } as unknown as PLCProjectData

    await runLibraryBuildPipeline(
      {
        projectPath: '/project',
        projectData,
        verifyProjectData: projectDataEmpty(),
        cleanBuild: false,
      },
      harness.port,
      emit,
    )

    const [, , , aux] = mockLibraryBuild.mock.calls[0]
    expect(aux.pouDocs).toEqual({ MyFb: 'A docstring', MyType: 'A type description' })
    expect(aux.cppBlocks).toEqual([{ name: 'MyCppFb', code: 'void setup() {}', variables: [] }])
  })

  it('returns the manifest validation error verbatim without proceeding', async () => {
    const harness = makePort()
    mockPrepareXml.mockReturnValueOnce({ error: 'library.json is missing manifest.namespace' })
    const { emit } = captureEvents()

    const result = await runLibraryBuildPipeline(
      {
        projectPath: '/project',
        projectData: projectDataEmpty(),
        verifyProjectData: projectDataEmpty(),
        cleanBuild: false,
      },
      harness.port,
      emit,
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe('library.json is missing manifest.namespace')
    expect(mockLibraryBuild).not.toHaveBeenCalled()
    expect(harness.verifyCalls).toHaveLength(0)
  })

  it('fails when reading library.json throws an IO error', async () => {
    const harness = makePort()
    harness.throwOn.readBuildFile = new Error('disk on fire')
    const { emit } = captureEvents()

    const result = await runLibraryBuildPipeline(
      {
        projectPath: '/project',
        projectData: projectDataEmpty(),
        verifyProjectData: projectDataEmpty(),
        cleanBuild: false,
      },
      harness.port,
      emit,
    )

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Could not read library\.json: disk on fire/)
    expect(mockPrepareXml).not.toHaveBeenCalled()
  })

  it('fails when the transpiler reports an error', async () => {
    const harness = makePort()
    harness.transpileResult = {
      ok: false,
      errors: [{ message: 'unexpected token in POU body', line: 1, column: 1, severity: 'error' }],
    }
    const { emit } = captureEvents()

    const result = await runLibraryBuildPipeline(
      {
        projectPath: '/project',
        projectData: projectDataEmpty(),
        verifyProjectData: projectDataEmpty(),
        cleanBuild: false,
      },
      harness.port,
      emit,
    )

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/transpile-from-json failed: unexpected token in POU body/)
    expect(result.libraryName).toBe('lib')
    expect(mockLibraryBuild).not.toHaveBeenCalled()
    expect(harness.verifyCalls).toHaveLength(0)
  })

  it('falls back to a generic message when the transpiler returns ok=true but no ST', async () => {
    const harness = makePort()
    // ok=true with an undefined programSt still short-circuits, and
    // with no `errors[]` the orchestrator uses its default message.
    harness.transpileResult = { ok: true, programSt: undefined }
    const { emit } = captureEvents()

    const result = await runLibraryBuildPipeline(
      {
        projectPath: '/project',
        projectData: projectDataEmpty(),
        verifyProjectData: projectDataEmpty(),
        cleanBuild: false,
      },
      harness.port,
      emit,
    )

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/transpile-from-json failed: transpile-from-json failed/)
  })

  it('treats a thrown verifyCompile as a failed (advisory) verification', async () => {
    const harness = makePort()
    // A non-Error throwable exercises the `String(error)` fallback in
    // `formatError`.
    harness.port.verifyCompile = async () => {
      throw 'avr-gcc segfaulted'
    }
    const { events, emit } = captureEvents()

    const result = await runLibraryBuildPipeline(
      {
        projectPath: '/project',
        projectData: projectDataEmpty(),
        verifyProjectData: projectDataEmpty(),
        cleanBuild: false,
      },
      harness.port,
      emit,
    )

    // Verification failures are advisory — the build still succeeds.
    expect(result.success).toBe(true)
    expect(result.verification?.success).toBe(false)
    expect(result.verification?.message).toBe('avr-gcc segfaulted')
    expect(events.some((e) => e.level === 'warning' && /Verification reported issues/.test(e.message))).toBe(true)
  })

  it('warns but still ships the .stlib when the verification cache cannot be written', async () => {
    const harness = makePort()
    // Fail only the cache write; the .stlib write happens later and
    // must still succeed.
    const realWrite = harness.port.writeBuildFile.bind(harness.port)
    harness.port.writeBuildFile = async (projectPath, relPath, content) => {
      if (relPath === 'build/.verify-cache-library.json') throw new Error('cache dir read-only')
      return realWrite(projectPath, relPath, content)
    }
    const { events, emit } = captureEvents()

    const result = await runLibraryBuildPipeline(
      {
        projectPath: '/project',
        projectData: projectDataEmpty(),
        verifyProjectData: projectDataEmpty(),
        cleanBuild: false,
      },
      harness.port,
      emit,
    )

    expect(result.success).toBe(true)
    expect(harness.files.has('build/lib.stlib')).toBe(true)
    expect(events.some((e) => e.level === 'warning' && /Could not write verification cache/.test(e.message))).toBe(true)
  })

  it('fails when the .stlib archive cannot be written', async () => {
    const harness = makePort()
    harness.port.writeBuildFile = async (_projectPath, relPath) => {
      if (relPath === 'build/lib.stlib') throw new Error('out of disk space')
      // Let the cache write succeed.
    }
    const { emit } = captureEvents()

    const result = await runLibraryBuildPipeline(
      {
        projectPath: '/project',
        projectData: projectDataEmpty(),
        verifyProjectData: projectDataEmpty(),
        cleanBuild: false,
      },
      harness.port,
      emit,
    )

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Could not write lib\.stlib: out of disk space/)
    expect(result.libraryName).toBe('lib')
  })
})
