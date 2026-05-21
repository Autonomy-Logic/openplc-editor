// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * Tests for the pure helpers shared by every program-build
 * orchestrator (`buildKnownPous`, `formatErrorWithPouContext`).
 *
 * The compile pipeline depends on these to turn project state into
 * the splitter's POU descriptor and to enrich strucpp's gcc-style
 * diagnostics with click-to-open context.  These helpers are pure
 * functions with no I/O so they're tested directly.
 */
import type * as strucpp from 'strucpp'

import type { PLCPou } from '../../types/PLC/open-plc'
import { buildKnownPous, formatErrorWithPouContext } from '../program-build-helpers'

type StrucppCompileError = strucpp.CompileError
type StrucppFormatDiagnostic = typeof strucpp.formatDiagnostic
type StrucppSourceMap = ReturnType<typeof strucpp.buildSourceMap>

type Language = PLCPou['data']['language']

// The body's `value` shape is language-specific (string for st/il/
// python/cpp/sfc; flow schemas for ld/fbd) but `buildKnownPous`
// reads only `type`, `data.name`, and `data.language` — so the
// fixtures can lean on `as unknown as PLCPou` instead of building
// fully-typed bodies for every supported language.
const program = (name: string, language: Language = 'st'): PLCPou =>
  ({
    type: 'program',
    data: { name, language, variables: [], body: { language, value: '' }, documentation: '' },
  }) as unknown as PLCPou

const fn = (name: string, language: Language = 'st'): PLCPou =>
  ({
    type: 'function',
    data: {
      name,
      language,
      returnType: 'INT',
      variables: [],
      body: { language, value: '' },
      documentation: '',
    },
  }) as unknown as PLCPou

const fb = (name: string, language: Language = 'st'): PLCPou =>
  ({
    type: 'function-block',
    data: { name, language, variables: [], body: { language, value: '' }, documentation: '' },
  }) as unknown as PLCPou

describe('buildKnownPous', () => {
  it('returns an empty array for an empty project', () => {
    expect(buildKnownPous([])).toEqual([])
  })

  it('maps each POU type to the matching strucpp `kind`', () => {
    const known = buildKnownPous([program('Main'), fn('Helper'), fb('Counter')])
    expect(known).toEqual([
      { name: 'Main', kind: 'PROGRAM', language: 'st' },
      { name: 'Helper', kind: 'FUNCTION', language: 'st' },
      { name: 'Counter', kind: 'FUNCTION_BLOCK', language: 'st' },
    ])
  })

  it('passes the POU language straight through', () => {
    // The splitter uses `language` to decide which serialised body
    // shape to expect for each entry.  Round-tripping every supported
    // language locks in the contract so a future enum change here
    // forces a deliberate update.
    const languages: Language[] = ['st', 'il', 'ld', 'fbd', 'sfc', 'python', 'cpp']
    const known = buildKnownPous(languages.map((lang) => program(`P_${lang}`, lang)))
    expect(known.map((k) => k.language)).toEqual(languages)
  })

  it('preserves declaration order', () => {
    const known = buildKnownPous([fn('B'), program('A'), fb('C')])
    expect(known.map((k) => k.name)).toEqual(['B', 'A', 'C'])
  })
})

// Minimal strucpp diagnostic fixture — only the fields the helper
// reads.  The formatter is stubbed to return a predictable suffix so
// assertions focus on the prefix the helper prepends.
const baseError: StrucppCompileError = {
  message: 'Cannot assign WSTRING to BOOL',
  line: 0,
  column: 0,
  severity: 'error',
}

const fakeFormatDiagnostic: StrucppFormatDiagnostic = (err, _sourceMap, _opts) => `<base:${err.message}>`
const fakeSourceMap = {} as unknown as StrucppSourceMap

describe('formatErrorWithPouContext', () => {
  it('falls back to plain formatDiagnostic when no POU context is attached', () => {
    // Errors in synthetic _types.st / _config.st or pre-split bail
    // paths arrive without pouName; the helper must not prepend an
    // unknown bracket and must not crash.
    const out = formatErrorWithPouContext(baseError, fakeFormatDiagnostic, fakeSourceMap)
    expect(out).toBe('<base:Cannot assign WSTRING to BOOL>')
  })

  it('prepends [<pou> / body line N] for body errors', () => {
    const err: StrucppCompileError = { ...baseError, pouName: 'Main', section: 'body', bodyLine: 7 }
    const out = formatErrorWithPouContext(err, fakeFormatDiagnostic, fakeSourceMap)
    expect(out).toBe('[Main / body line 7]\n<base:Cannot assign WSTRING to BOOL>')
  })

  it('prepends [<pou> / variable <name>] when a var-block error names the variable', () => {
    const err: StrucppCompileError = {
      ...baseError,
      pouName: 'Main',
      section: 'var-block',
      variableName: 'speed',
    }
    const out = formatErrorWithPouContext(err, fakeFormatDiagnostic, fakeSourceMap)
    expect(out).toBe('[Main / variable speed]\n<base:Cannot assign WSTRING to BOOL>')
  })

  it('falls back to var-block line prefix when no variable name is available', () => {
    // Some var-block errors fire before the parser recovers a name
    // (e.g. malformed declaration); the helper still surfaces the
    // POU + line so the user can locate the offending text.
    const err: StrucppCompileError = { ...baseError, pouName: 'Main', section: 'var-block', line: 4 }
    const out = formatErrorWithPouContext(err, fakeFormatDiagnostic, fakeSourceMap)
    expect(out).toBe('[Main / variables, line 4]\n<base:Cannot assign WSTRING to BOOL>')
  })

  it('falls back to a bare [<pou>] prefix when section is missing', () => {
    // Errors that strucpp attributes to a POU but not to a specific
    // section (rare — happens for cross-POU semantic errors); still
    // worth the click-to-open context.
    const err: StrucppCompileError = { ...baseError, pouName: 'Main' }
    const out = formatErrorWithPouContext(err, fakeFormatDiagnostic, fakeSourceMap)
    expect(out).toBe('[Main]\n<base:Cannot assign WSTRING to BOOL>')
  })

  it('falls back to bare [<pou>] for body errors missing the bodyLine', () => {
    // Defensive: if `section === 'body'` but `bodyLine` is undefined,
    // we can't render a useful line number — degrade to the
    // POU-only prefix instead of writing `body line undefined`.
    const err: StrucppCompileError = { ...baseError, pouName: 'Main', section: 'body' }
    const out = formatErrorWithPouContext(err, fakeFormatDiagnostic, fakeSourceMap)
    expect(out).toBe('[Main]\n<base:Cannot assign WSTRING to BOOL>')
  })

  it('passes `preferBodyLine: true` to the format-diagnostic call', () => {
    // The body-line preference is what keeps the user-visible line
    // numbers consistent between the prefix the helper writes and
    // the gcc-style snippet strucpp emits.  Verifying it here means
    // a future refactor that drops the option triggers a regression.
    const spy = jest.fn<string, Parameters<StrucppFormatDiagnostic>>(() => '<stub>')
    formatErrorWithPouContext(baseError, spy as unknown as StrucppFormatDiagnostic, fakeSourceMap)
    expect(spy).toHaveBeenCalledWith(baseError, fakeSourceMap, { preferBodyLine: true })
  })
})
