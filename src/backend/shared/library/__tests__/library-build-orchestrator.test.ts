/**
 * Tests for the shared library-build orchestrator.
 *
 * The orchestrator's job is to drive the stage flow through a
 * `LibraryBuildPort`.  These tests mock the port + the inner shared
 * helpers (`prepareXmlForLibraryBuild`, `libraryBuildFromTranspiledSt`)
 * and verify the orchestrator's contract: stage ordering, error
 * propagation, archive feed-through.
 *
 * The build no longer runs an avr-gcc verification compile, so there is
 * nothing here about verify caching, `cleanBuild`, or advisory verify
 * failures — running a library goes through the debug harness instead
 * (`composeLibraryDebugHarness`).
 *
 * Production callers (desktop adapter and the future web adapter) get
 * exercised through their own integration paths — this file is
 * unit-level for the orchestration logic itself.
 */

import type { LibraryBuildPort } from '../../../../middleware/shared/ports/library-build-port'
import type { TranspileToStArgs, TranspileToStResult } from '../../../../middleware/shared/ports/compiler-platform-port'
import type { PLCProjectData } from '../../types/PLC/open-plc'

// ST the fake `transpileToSt` port method emits.
const FAKE_PROGRAM_ST = 'PROGRAM main\n(* transpiled *)\nEND_PROGRAM\n'

// ---------------------------------------------------------------------------
// Mocks for the inner shared helpers
// ---------------------------------------------------------------------------

const mockPrepareXml = jest.fn()
const mockLibraryBuild = jest.fn()

jest.mock('../build-pipeline', () => ({
  prepareXmlForLibraryBuild: (...args: unknown[]) => mockPrepareXml(...args),
  libraryBuildFromTranspiledSt: (...args: unknown[]) => mockLibraryBuild(...args),
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
  transpileResult: TranspileToStResult
  transpileCalls: TranspileToStArgs[]
  /** Programmable error for whichever method the test wants to fail. */
  throwOn: Partial<Record<keyof LibraryBuildPort, Error>>
  /** Error raised by `readBuildFile` for one specific path only.
   *  `throwOn.readBuildFile` fails every read, which means stage 0's
   *  `library.json` aborts the build before any later read is attempted —
   *  so a failure deeper in the pipeline needs to be scoped to its path. */
  throwOnRead: Map<string, Error>
}

function makePort(): PortHarness {
  const harness: PortHarness = {
    port: undefined as unknown as LibraryBuildPort,
    files: new Map<string, string>(),
    manifestContent: '{"name":"lib","version":"0.1.0","namespace":"lib"}',
    archives: [],
    missing: [],
    throwOnRead: new Map<string, Error>(),
    transpileResult: { ok: true, programSt: FAKE_PROGRAM_ST },
    transpileCalls: [],
    throwOn: {},
  }
  harness.port = {
    async transpileToSt(args: TranspileToStArgs, log) {
      if (harness.throwOn.transpileToSt) throw harness.throwOn.transpileToSt
      harness.transpileCalls.push(args)
      // Exercise the orchestrator's log-forwarding lambda.
      log('transpiler: parsing project IR', 'info')
      return harness.transpileResult
    },
    async readBuildFile(_projectPath: string, relPath: string) {
      if (harness.throwOn.readBuildFile) throw harness.throwOn.readBuildFile
      const scoped = harness.throwOnRead.get(relPath)
      if (scoped) throw scoped
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
      },
      harness.port,
      emit,
    )

    expect(result.success).toBe(true)
    expect(result.libraryName).toBe('lib')
    expect(result.stlibPath).toBe('build/lib.stlib')
    expect(harness.files.get('build/lib.stlib')).toMatch(/^\{[\s\S]+\}\n$/)
    // The `.stlib` is the ONLY thing the build writes. The verification
    // cache that used to sit beside it went out with the verify stage.
    expect(harness.files.has('build/.verify-cache-library.json')).toBe(false)
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
        'Compiling library archive...',
        'Library built successfully: build/lib.stlib',
      ]),
    )
    // The stubbed projectData from Stage 1 is what the transpiler sees.
    expect(harness.transpileCalls).toHaveLength(1)
    // Nothing in the build talks about verification any more. Asserted on the
    // whole event stream rather than the `arrayContaining` above, which would
    // happily pass with an extra verify line in the middle.
    expect(events.filter((e) => /verif/i.test(e.message))).toEqual([])
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
      },
      harness.port,
      emit,
    )

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/library\.json.*missing/)
    // Should NOT have called any later stages.
    expect(mockPrepareXml).not.toHaveBeenCalled()
    expect(mockLibraryBuild).not.toHaveBeenCalled()
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
      },
      harness.port,
      emit,
    )

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/ghost-lib/)
    expect(result.error).toMatch(/Library Manager/)
    expect(mockLibraryBuild).not.toHaveBeenCalled()
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

  it('threads pouDocs through to libraryBuildFromTranspiledSt', async () => {
    const harness = makePort()
    const { emit } = captureEvents()

    const projectData = {
      ...projectDataEmpty(),
      pous: [{ type: 'function-block', data: { name: 'MyFb', documentation: 'A docstring' } }],
      dataTypes: [{ name: 'MyType', documentation: 'A type description' }],
    } as unknown as PLCProjectData

    await runLibraryBuildPipeline({ projectPath: '/project', projectData }, harness.port, emit)

    const [, , , aux] = mockLibraryBuild.mock.calls[0]
    expect(aux.pouDocs).toEqual({ MyFb: 'A docstring', MyType: 'A type description' })
  })

  // The archive must carry what the AUTHOR wrote. `nativePous` is supplied by
  // the adapter from the RAW project data, because by the time the pipeline
  // runs `preprocessPous` has lowered every native body to bridge ST AND
  // rewritten its language tag — so the POU list here says `st` for all of
  // them. Seeding `language: 'cpp'` in these args would test a state that
  // cannot occur.
  it('reads authored C/C++ and Python POU files off disk and passes them verbatim', async () => {
    const harness = makePort()
    const { emit } = captureEvents()

    const CPP = '(* doc *)\nFUNCTION_BLOCK MyCppFb\nVAR_INPUT a : BOOL; END_VAR\nvoid setup() {}\nEND_FUNCTION_BLOCK\n'
    const PY = 'FUNCTION_BLOCK MyPyFb\nVAR_INPUT b : INT; END_VAR\ndef block_loop():\n    pass\nEND_FUNCTION_BLOCK\n'
    harness.files.set('pous/function-blocks/MyCppFb.cpp', CPP)
    harness.files.set('pous/function-blocks/MyPyFb.py', PY)

    const projectData = {
      ...projectDataEmpty(),
      // Lowered, exactly as the pipeline really receives them.
      pous: [
        { type: 'function-block', data: { name: 'MyCppFb', body: { language: 'st' } } },
        { type: 'function-block', data: { name: 'MyPyFb', body: { language: 'st' } } },
        { type: 'function-block', data: { name: 'PlainSt', body: { language: 'st' } } },
      ],
    } as unknown as PLCProjectData

    await runLibraryBuildPipeline(
      {
        projectPath: '/project',
        projectData,
        nativePous: [
          { name: 'MyCppFb', language: 'cpp', relPath: 'pous/function-blocks/MyCppFb.cpp' },
          { name: 'MyPyFb', language: 'python', relPath: 'pous/function-blocks/MyPyFb.py' },
        ],
      },
      harness.port,
      emit,
    )

    const [, , , aux] = mockLibraryBuild.mock.calls[0]
    expect(aux.nativeSources).toEqual([
      { fileName: 'MyCppFb.cpp', source: CPP },
      { fileName: 'MyPyFb.py', source: PY },
    ])
  })

  // A hand-authored project may put a native file under `pous/functions/`.
  // `collectNativePous` derives the path from the POU type so the build hands
  // strucpp the file and lets it explain that a native block cannot be a
  // FUNCTION, rather than dying on a path guessed wrong.
  it('reads a native POU from the path the adapter resolved', async () => {
    const harness = makePort()
    const { emit } = captureEvents()

    const FN = 'FUNCTION CPP_ADD : INT\nVAR_INPUT A : INT; END_VAR\nint add(){}\nEND_FUNCTION\n'
    harness.files.set('pous/functions/CPP_ADD.cpp', FN)

    const projectData = {
      ...projectDataEmpty(),
      pous: [{ type: 'function', data: { name: 'CPP_ADD', body: { language: 'st' } } }],
    } as unknown as PLCProjectData

    await runLibraryBuildPipeline(
      {
        projectPath: '/project',
        projectData,
        nativePous: [{ name: 'CPP_ADD', language: 'cpp', relPath: 'pous/functions/CPP_ADD.cpp' }],
      },
      harness.port,
      emit,
    )

    const [, , , aux] = mockLibraryBuild.mock.calls[0]
    expect(aux.nativeSources).toEqual([{ fileName: 'CPP_ADD.cpp', source: FN }])
  })

  // Regression: the pipeline used to infer the native list from
  // `projectData.pous[].body.language`, which is always `st` by this point.
  // It therefore found none, shipped the bridge ST in the archive instead of
  // the authored source, and produced the frozen-ABI artifact this design
  // exists to avoid.
  it('passes no native sources when the adapter supplied none, whatever the POU list says', async () => {
    const harness = makePort()
    const { emit } = captureEvents()
    harness.files.set(
      'pous/function-blocks/Ghost.cpp',
      'FUNCTION_BLOCK Ghost\nVAR_INPUT a : BOOL; END_VAR\nEND_FUNCTION_BLOCK\n',
    )

    await runLibraryBuildPipeline(
      {
        projectPath: '/project',
        projectData: projectDataEmpty(),
      },
      harness.port,
      emit,
    )

    const [, , , aux] = mockLibraryBuild.mock.calls[0]
    expect(aux.nativeSources).toEqual([])
  })

  it('fails naming the path when reading a native source throws', async () => {
    const harness = makePort()
    const { emit } = captureEvents()
    // Scoped to this one path: a blanket read failure would abort at stage 0's
    // `library.json` and never reach the native read.
    harness.throwOnRead.set('pous/function-blocks/Boom.cpp', new Error('EIO'))

    const result = await runLibraryBuildPipeline(
      {
        projectPath: '/project',
        projectData: projectDataEmpty(),
        nativePous: [{ name: 'Boom', language: 'cpp', relPath: 'pous/function-blocks/Boom.cpp' }],
      },
      harness.port,
      emit,
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('pous/function-blocks/Boom.cpp')
    expect(result.error).toContain('EIO')
    expect(mockLibraryBuild).not.toHaveBeenCalled()
  })

  it('fails naming the block when its authored source is missing from disk', async () => {
    const harness = makePort()
    const { emit } = captureEvents()

    const result = await runLibraryBuildPipeline(
      {
        projectPath: '/project',
        projectData: projectDataEmpty(),
        nativePous: [{ name: 'Gone', language: 'cpp', relPath: 'pous/function-blocks/Gone.cpp' }],
      },
      harness.port,
      emit,
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('Gone')
    expect(result.error).toContain('pous/function-blocks/Gone.cpp')
    expect(mockLibraryBuild).not.toHaveBeenCalled()
  })

  it('returns the manifest validation error verbatim without proceeding', async () => {
    const harness = makePort()
    mockPrepareXml.mockReturnValueOnce({ error: 'library.json is missing manifest.namespace' })
    const { emit } = captureEvents()

    const result = await runLibraryBuildPipeline(
      {
        projectPath: '/project',
        projectData: projectDataEmpty(),
      },
      harness.port,
      emit,
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe('library.json is missing manifest.namespace')
    expect(mockLibraryBuild).not.toHaveBeenCalled()
  })

  it('fails when reading library.json throws an IO error', async () => {
    const harness = makePort()
    harness.throwOn.readBuildFile = new Error('disk on fire')
    const { emit } = captureEvents()

    const result = await runLibraryBuildPipeline(
      {
        projectPath: '/project',
        projectData: projectDataEmpty(),
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
      },
      harness.port,
      emit,
    )

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/transpile-from-json failed: unexpected token in POU body/)
    expect(result.libraryName).toBe('lib')
    expect(mockLibraryBuild).not.toHaveBeenCalled()
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
      },
      harness.port,
      emit,
    )

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/transpile-from-json failed: transpile-from-json failed/)
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
      },
      harness.port,
      emit,
    )

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Could not write lib\.stlib: out of disk space/)
    expect(result.libraryName).toBe('lib')
  })
})
