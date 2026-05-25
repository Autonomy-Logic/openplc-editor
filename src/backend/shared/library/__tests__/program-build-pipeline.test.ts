// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * Tests for the program-build pipeline.
 *
 * The pipeline orchestrates strucpp's compile / formatDiagnostic /
 * buildSourceMap plus the ST splitter into a single result the
 * Electron editor and the web editor both consume.  Both
 * dependencies are mocked here — strucpp because its ESM module is
 * incompatible with Jest's CJS transform, the splitter because the
 * pipeline's behaviour around split-vs-monolithic is what we want
 * to lock in independently of the splitter's real parse rules.
 */
import type * as strucpp from 'strucpp'

import type { KnownPou } from '../../utils/PLC/split-program-st'
import type { ProgramBuildPipelineOptions } from '../program-build-pipeline'

// --- Mocks ----------------------------------------------------------------

const splitProgramSt = jest.fn<ReturnType<typeof import('../../utils/PLC/split-program-st').splitProgramSt>, never[]>()
jest.mock('../../utils/PLC/split-program-st', () => ({
  splitProgramSt: (...args: unknown[]) => splitProgramSt(...(args as never[])),
}))

type CompileResult = ReturnType<typeof strucpp.compile>
const strucppCompile = jest.fn<CompileResult, Parameters<typeof strucpp.compile>>()
const strucppFormatDiagnostic = jest.fn<string, Parameters<typeof strucpp.formatDiagnostic>>(
  (err) => `<formatted:${err.message}>`,
)
const strucppBuildSourceMap = jest.fn<unknown, Parameters<typeof strucpp.buildSourceMap>>(() => ({}))

jest.mock('../strucpp-runtime', () => ({
  loadStrucpp: () => ({
    compile: strucppCompile,
    formatDiagnostic: strucppFormatDiagnostic,
    buildSourceMap: strucppBuildSourceMap,
  }),
}))

// --- Imports after mocks set up ------------------------------------------

// eslint-disable-next-line import/first
import { runProgramBuildPipeline } from '../program-build-pipeline'

// --- Helpers --------------------------------------------------------------

const pou = (name: string, kind: KnownPou['kind'] = 'PROGRAM'): KnownPou => ({ name, kind, language: 'st' })

const baseOpts: ProgramBuildPipelineOptions = {
  source: 'PROGRAM Main\nVAR x : INT; END_VAR\nEND_PROGRAM',
  md5: 'cafebabe',
  pous: [pou('Main')],
  libraries: [],
  missingLibraries: [],
  hasCBlocks: false,
}

// Minimal happy-path strucpp result.  Individual tests override
// fields to exercise the per-result branches.
const okResult: CompileResult = {
  success: true,
  cppCode: 'int main(){}',
  headerCode: '#pragma once',
  warnings: [],
} as unknown as CompileResult

beforeEach(() => {
  splitProgramSt.mockReset()
  strucppCompile.mockReset()
  strucppFormatDiagnostic.mockClear()
  strucppBuildSourceMap.mockClear()
  // Default: splitter sees nothing it can split.  Each test that
  // wants the split branch overrides this.
  splitProgramSt.mockReturnValue(null)
  strucppCompile.mockReturnValue(okResult)
})

// --- Tests ----------------------------------------------------------------

describe('runProgramBuildPipeline — missing-library gate', () => {
  it('refuses to compile when the project enables an uninstalled library', () => {
    const result = runProgramBuildPipeline({ ...baseOpts, missingLibraries: ['oscat-basic'] })
    expect(result.success).toBe(false)
    expect(result.files).toEqual([])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].formatted).toContain('oscat-basic')
    expect(result.errors[0].formatted).toContain('Library Manager')
    expect(strucppCompile).not.toHaveBeenCalled()
  })

  it('still echoes the input md5 on the missing-library refusal', () => {
    // The caller stashes `md5Hash` in its build manifest before the
    // pipeline runs — keeping it round-tripped here means callers
    // don't special-case the refusal path.
    const result = runProgramBuildPipeline({ ...baseOpts, missingLibraries: ['x'], md5: 'feedface' })
    expect(result.md5Hash).toBe('feedface')
  })
})

describe('runProgramBuildPipeline — monolithic compile (no splitter)', () => {
  it('skips the splitter entirely when pous is empty', () => {
    const result = runProgramBuildPipeline({ ...baseOpts, pous: [] })
    expect(splitProgramSt).not.toHaveBeenCalled()
    expect(result.splitterFallbackMessage).toBeNull()
    expect(result.success).toBe(true)
  })

  it('emits a single generated.cpp/.hpp pair from the strucpp result', () => {
    const result = runProgramBuildPipeline({ ...baseOpts, pous: [] })
    expect(result.files).toEqual([
      { name: 'generated.cpp', content: 'int main(){}' },
      { name: 'generated.hpp', content: '#pragma once' },
    ])
  })

  it('echoes the md5 and reports no debug map / no warnings', () => {
    const result = runProgramBuildPipeline({ ...baseOpts, pous: [], md5: 'cafef00d' })
    expect(result.md5Hash).toBe('cafef00d')
    expect(result.debugMapSummary).toBeNull()
    expect(result.warnings).toEqual([])
  })
})

describe('runProgramBuildPipeline — splitter fallback', () => {
  it('falls back to monolithic with an info message when the splitter returns null', () => {
    splitProgramSt.mockReturnValue(null)
    const result = runProgramBuildPipeline(baseOpts)
    expect(result.success).toBe(true)
    expect(result.splitterFallbackMessage).toContain('falling back to monolithic')
    // Compile was still invoked, just with the monolithic source.
    expect(strucppCompile).toHaveBeenCalledTimes(1)
    const callArgs = strucppCompile.mock.calls[0]
    expect(callArgs[0]).toBe(baseOpts.source)
    expect(callArgs[1]?.fileName).toBe('program.st')
  })
})

describe('runProgramBuildPipeline — successful split compile', () => {
  beforeEach(() => {
    splitProgramSt.mockReturnValue({
      files: new Map([
        ['Main.st', 'PROGRAM Main … END_PROGRAM'],
        ['Helper.st', 'FUNCTION Helper … END_FUNCTION'],
      ]),
      pouOffsets: new Map([
        ['Main', { kind: 'PROGRAM', startLine: 1, endLine: 5 }],
        ['Helper', { kind: 'FUNCTION', startLine: 6, endLine: 10 }],
      ]),
    })
  })

  it('emits a program.st.map.json artefact with the per-POU offsets', () => {
    const result = runProgramBuildPipeline(baseOpts)
    const mapFile = result.files.find((f) => f.name === 'program.st.map.json')
    expect(mapFile).toBeDefined()
    const parsed = JSON.parse(mapFile!.content) as {
      pouOffsets: Record<string, { kind: string; startLine: number; endLine: number }>
    }
    expect(parsed.pouOffsets).toEqual({
      Main: { kind: 'PROGRAM', startLine: 1, endLine: 5 },
      Helper: { kind: 'FUNCTION', startLine: 6, endLine: 10 },
    })
  })

  it('passes the first split file as the primary source and the rest as additionalSources', () => {
    runProgramBuildPipeline(baseOpts)
    const [primarySource, options] = strucppCompile.mock.calls[0]
    expect(primarySource).toBe('PROGRAM Main … END_PROGRAM')
    expect(options?.fileName).toBe('Main.st')
    expect(options?.additionalSources).toEqual([{ fileName: 'Helper.st', source: 'FUNCTION Helper … END_FUNCTION' }])
  })

  it('does not set splitterFallbackMessage when the split succeeded', () => {
    const result = runProgramBuildPipeline(baseOpts)
    expect(result.splitterFallbackMessage).toBeNull()
  })
})

describe('runProgramBuildPipeline — C-block include plumbing', () => {
  it('passes c_blocks.h through pouIncludes when hasCBlocks is true', () => {
    runProgramBuildPipeline({ ...baseOpts, hasCBlocks: true, pous: [] })
    const options = strucppCompile.mock.calls[0][1]
    expect(options?.pouIncludes).toEqual(['c_blocks.h'])
  })

  it('passes an empty pouIncludes when hasCBlocks is false', () => {
    runProgramBuildPipeline({ ...baseOpts, hasCBlocks: false, pous: [] })
    const options = strucppCompile.mock.calls[0][1]
    expect(options?.pouIncludes).toEqual([])
  })
})

describe('runProgramBuildPipeline — emitting per-POU cpp files', () => {
  it('uses result.cppFiles when strucpp returns the per-TU split', () => {
    strucppCompile.mockReturnValue({
      ...okResult,
      cppFiles: [
        { name: 'Main.cpp', content: '// Main' },
        { name: 'Helper.cpp', content: '// Helper' },
      ],
    } as unknown as CompileResult)
    const result = runProgramBuildPipeline({ ...baseOpts, pous: [] })
    const cppNames = result.files.filter((f) => f.name.endsWith('.cpp')).map((f) => f.name)
    expect(cppNames).toEqual(['Main.cpp', 'Helper.cpp'])
    // generated.cpp should NOT be there — cppFiles supersedes it.
    expect(cppNames).not.toContain('generated.cpp')
  })

  it('falls back to a single generated.cpp when cppFiles is empty', () => {
    strucppCompile.mockReturnValue({ ...okResult, cppFiles: [] } as unknown as CompileResult)
    const result = runProgramBuildPipeline({ ...baseOpts, pous: [] })
    const cppNames = result.files.filter((f) => f.name.endsWith('.cpp')).map((f) => f.name)
    expect(cppNames).toEqual(['generated.cpp'])
  })
})

describe('runProgramBuildPipeline — debug artefacts', () => {
  it('emits generated_debug.cpp when strucpp returns debugTableCpp', () => {
    strucppCompile.mockReturnValue({
      ...okResult,
      debugTableCpp: '// debug table',
    } as unknown as CompileResult)
    const result = runProgramBuildPipeline({ ...baseOpts, pous: [] })
    expect(result.files.find((f) => f.name === 'generated_debug.cpp')).toEqual({
      name: 'generated_debug.cpp',
      content: '// debug table',
    })
    // No debugMap → no summary.
    expect(result.debugMapSummary).toBeNull()
  })

  it('emits debug-map.json with a summary when strucpp returns a debugMap', () => {
    strucppCompile.mockReturnValue({
      ...okResult,
      debugMap: { leaves: [{ a: 1 }, { a: 2 }, { a: 3 }], arrays: [{ b: 1 }] },
    } as unknown as CompileResult)
    const result = runProgramBuildPipeline({ ...baseOpts, pous: [] })
    expect(result.files.find((f) => f.name === 'debug-map.json')).toBeDefined()
    expect(result.debugMapSummary).toBe('Debug map: 3 leaves in 1 arrays')
  })

  it('omits debug-map.json when strucpp returns no debugMap', () => {
    const result = runProgramBuildPipeline({ ...baseOpts, pous: [] })
    expect(result.files.find((f) => f.name === 'debug-map.json')).toBeUndefined()
  })
})

describe('runProgramBuildPipeline — compile failure', () => {
  it('formats every error and every warning through formatErrorWithPouContext', () => {
    strucppCompile.mockReturnValue({
      success: false,
      errors: [
        { message: 'oops', line: 1, column: 1, severity: 'error', pouName: 'Main', section: 'body', bodyLine: 7 },
      ],
      warnings: [{ message: 'careful', line: 2, column: 1, severity: 'warning' }],
    } as unknown as CompileResult)
    const result = runProgramBuildPipeline({ ...baseOpts, pous: [] })
    expect(result.success).toBe(false)
    expect(result.files).toEqual([])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].formatted).toContain('[Main / body line 7]')
    expect(result.errors[0].formatted).toContain('<formatted:oops>')
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0].formatted).toBe('<formatted:careful>')
  })

  it('echoes the md5 on the failure path', () => {
    strucppCompile.mockReturnValue({
      success: false,
      errors: [{ message: 'x', line: 1, column: 1, severity: 'error' }],
      warnings: [],
    } as unknown as CompileResult)
    const result = runProgramBuildPipeline({ ...baseOpts, pous: [], md5: 'feed' })
    expect(result.md5Hash).toBe('feed')
  })
})

describe('runProgramBuildPipeline — warning formatting on success', () => {
  it('passes successful-build warnings through the POU-context formatter', () => {
    strucppCompile.mockReturnValue({
      ...okResult,
      warnings: [{ message: 'unused', line: 4, column: 1, severity: 'warning', pouName: 'Main' }],
    } as unknown as CompileResult)
    const result = runProgramBuildPipeline({ ...baseOpts, pous: [] })
    expect(result.success).toBe(true)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0].formatted).toContain('[Main]')
  })
})

describe('runProgramBuildPipeline — sourceMap fed every split file', () => {
  it('asks strucpp to build a source map covering every split file', () => {
    splitProgramSt.mockReturnValue({
      files: new Map([
        ['Main.st', 'a'],
        ['Helper.st', 'b'],
      ]),
      pouOffsets: new Map(),
    })
    runProgramBuildPipeline(baseOpts)
    const sourceMapArg = strucppBuildSourceMap.mock.calls[0][0]
    expect(sourceMapArg).toEqual([
      { fileName: 'Main.st', source: 'a' },
      { fileName: 'Helper.st', source: 'b' },
    ])
  })

  it('falls back to a single program.st entry when the splitter is skipped', () => {
    runProgramBuildPipeline({ ...baseOpts, pous: [] })
    expect(strucppBuildSourceMap.mock.calls[0][0]).toEqual([{ fileName: 'program.st', source: baseOpts.source }])
  })
})
