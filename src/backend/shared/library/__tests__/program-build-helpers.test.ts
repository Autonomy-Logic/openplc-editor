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
import type { KnownPou } from '../../utils/PLC/split-program-st'
import {
  buildKnownPous,
  emitCompileErrorEvents,
  enrichErrorWithPouContext,
  formatErrorWithPouContext,
} from '../program-build-helpers'

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

describe('enrichErrorWithPouContext', () => {
  const knownPous: KnownPou[] = [
    { name: 'CVAVAVA', kind: 'FUNCTION_BLOCK', language: 'st' },
    { name: 'Main', kind: 'PROGRAM', language: 'st' },
  ]

  it('returns the error unchanged when pouName is already set', () => {
    // The semantic annotation pass has already attached context — the
    // enricher must not clobber strucpp's own attribution.
    const err: StrucppCompileError = { ...baseError, file: 'cvavava.st', line: 12, pouName: 'OTHER' }
    expect(enrichErrorWithPouContext(err, knownPous)).toBe(err)
  })

  it('returns the error unchanged when no filename is available', () => {
    // Errors from the synthetic _types.st / _config.st sections or the
    // pre-compile gate have no file — enrichment cannot guess.
    const err: StrucppCompileError = { ...baseError, line: 0 }
    expect(enrichErrorWithPouContext(err, knownPous)).toBe(err)
  })

  it('returns the error unchanged when the filename matches no known POU', () => {
    // A stray `.st` file that isn't one of the project's POUs (or a
    // typo in strucpp's filename plumbing) — we don't fabricate a
    // pouName because the navigation lookup would silently fail anyway.
    const err: StrucppCompileError = { ...baseError, file: 'ghost.st', line: 1 }
    expect(enrichErrorWithPouContext(err, knownPous)).toBe(err)
  })

  it('populates pouName + pouKind from the filename (case-insensitive)', () => {
    // The reported regression: strucpp's parse-error path emits
    // `cvavava.st:12:3` with no pouName, the editor's hook bails at
    // `if (!err.pouName) return`, and the click does nothing.  The
    // enricher must turn the lowercase filename into the canonical
    // project name so the lookup hits.
    const err: StrucppCompileError = { ...baseError, file: 'cvavava.st', line: 1 }
    const enriched = enrichErrorWithPouContext(err, knownPous)
    expect(enriched.pouName).toBe('CVAVAVA')
    expect(enriched.pouKind).toBe('FUNCTION_BLOCK')
  })

  it('tags errors above the last END_VAR as `var-block`', () => {
    // Parse errors inside a VAR block — the user's `TON0 : TON;`
    // repro — should route the navigation hook into the variables
    // panel, not the body view.
    const perPou = new Map([
      [
        'cvavava.st',
        ['FUNCTION_BLOCK CVAVAVA', 'VAR', '  TON0 : TON;', 'END_VAR', '  ;', 'END_FUNCTION_BLOCK'].join('\n'),
      ],
    ])
    const err: StrucppCompileError = { ...baseError, file: 'cvavava.st', line: 3 }
    const enriched = enrichErrorWithPouContext(err, knownPous, perPou)
    expect(enriched.section).toBe('var-block')
    expect(enriched.bodyLine).toBeUndefined()
  })

  it('tags errors at or after the body boundary as `body` with bodyLine remapped', () => {
    // First body statement sits on per-POU line 5; the editor's body
    // Monaco view shows that as line 1.  Verify the offset math.
    const perPou = new Map([
      [
        'cvavava.st',
        ['FUNCTION_BLOCK CVAVAVA', 'VAR', '  X : INT;', 'END_VAR', '  X := X + 1;', 'END_FUNCTION_BLOCK'].join('\n'),
      ],
    ])
    const err: StrucppCompileError = { ...baseError, file: 'cvavava.st', line: 5 }
    const enriched = enrichErrorWithPouContext(err, knownPous, perPou)
    expect(enriched.section).toBe('body')
    expect(enriched.bodyLine).toBe(1)
  })

  it('skips blank separator lines between END_VAR and the body', () => {
    // The ST generators (`pou-text-serializer.ts` and xml2st on the
    // compile path) insert blank lines after END_VAR for readability.
    // Those blanks live in the per-POU file the splitter feeds
    // strucpp but NOT in `pou.body.value`, which is what the body
    // Monaco editor renders.  Treating the blank as bodyLine 1 used
    // to shift the cursor one line past the editor's actual line
    // count and crash `getLineMaxColumn`.  The enricher must look
    // through the blank(s) to find the first real body line.
    const perPou = new Map([
      [
        'cvavava.st',
        [
          'FUNCTION_BLOCK CVAVAVA', // 1 — header
          'VAR', // 2
          '  X : INT;', // 3
          'END_VAR', // 4
          '', // 5 — blank separator
          '  X := X + 1;', // 6 — first body line
          'END_FUNCTION_BLOCK', // 7
        ].join('\n'),
      ],
    ])
    const err: StrucppCompileError = { ...baseError, file: 'cvavava.st', line: 6 }
    const enriched = enrichErrorWithPouContext(err, knownPous, perPou)
    expect(enriched.section).toBe('body')
    expect(enriched.bodyLine).toBe(1)
  })

  it('looks up the per-POU file case-insensitively', () => {
    // Strucpp echoes the filename it was handed at compile time —
    // case can differ from the splitter's map key (the project may
    // store POU names in any case the user typed).  Without the
    // case-insensitive lookup, `perPouSources.get(err.file)` returns
    // undefined and section/bodyLine never get populated even though
    // the file content is right there.
    const perPou = new Map([
      [
        'CVAVAVA.st',
        ['FUNCTION_BLOCK CVAVAVA', 'VAR', '  X : INT;', 'END_VAR', '  X := X + 1;', 'END_FUNCTION_BLOCK'].join('\n'),
      ],
    ])
    const err: StrucppCompileError = { ...baseError, file: 'cvavava.st', line: 5 }
    const enriched = enrichErrorWithPouContext(err, knownPous, perPou)
    expect(enriched.section).toBe('body')
    expect(enriched.bodyLine).toBe(1)
  })

  it('handles POUs without any var blocks (body starts at line 2)', () => {
    // A FUNCTION_BLOCK whose first body statement lives directly under
    // the header still needs section/bodyLine — otherwise body errors
    // here would slip through as untagged and the hook would only open
    // the tab without moving the cursor.
    const perPou = new Map([['noop.st', ['FUNCTION_BLOCK NOOP', '  ;', 'END_FUNCTION_BLOCK'].join('\n')]])
    const pous: KnownPou[] = [{ name: 'NOOP', kind: 'FUNCTION_BLOCK', language: 'st' }]
    const err: StrucppCompileError = { ...baseError, file: 'noop.st', line: 2 }
    const enriched = enrichErrorWithPouContext(err, pous, perPou)
    expect(enriched.section).toBe('body')
    expect(enriched.bodyLine).toBe(1)
  })

  it('skips section tagging when the per-POU source map is not provided', () => {
    // Pipeline runs in monolithic-fallback (splitter bailed) skip the
    // source map entirely.  pouName still gets derived from the
    // filename — the click opens the tab — but section/bodyLine stay
    // undefined so the hook's "open tab, no cursor jump" branch fires.
    const err: StrucppCompileError = { ...baseError, file: 'cvavava.st', line: 3 }
    const enriched = enrichErrorWithPouContext(err, knownPous)
    expect(enriched.pouName).toBe('CVAVAVA')
    expect(enriched.section).toBeUndefined()
    expect(enriched.bodyLine).toBeUndefined()
  })

  it('skips section tagging when err.line is 0 (no source location)', () => {
    // Pre-compile gate errors (missing libraries) carry line: 0 with
    // no filename, but defensively: an err.file with line === 0
    // shouldn't divide by section either.
    const perPou = new Map([
      [
        'cvavava.st',
        ['FUNCTION_BLOCK CVAVAVA', 'VAR', '  X : INT;', 'END_VAR', '  ;', 'END_FUNCTION_BLOCK'].join('\n'),
      ],
    ])
    const err: StrucppCompileError = { ...baseError, file: 'cvavava.st', line: 0 }
    const enriched = enrichErrorWithPouContext(err, knownPous, perPou)
    expect(enriched.pouName).toBe('CVAVAVA')
    expect(enriched.section).toBeUndefined()
  })
})

describe('emitCompileErrorEvents', () => {
  const mkErr = (overrides: Partial<StrucppCompileError> = {}): StrucppCompileError => ({
    message: 'test error',
    line: 1,
    column: 1,
    severity: 'error',
    ...overrides,
  })

  it('emits a single header line when the errors list is empty', () => {
    // Defensive: callers shouldn't invoke this with an empty list
    // (success path is gated elsewhere), but if they do, the header
    // alone is still useful and the loop must not throw.
    const calls: Array<{ msg: string; level: string; raw?: StrucppCompileError }> = []
    emitCompileErrorEvents([], (msg, level, raw) => calls.push({ msg, level, raw }))
    expect(calls).toEqual([{ msg: 'STruC++ compilation failed:', level: 'error', raw: undefined }])
  })

  it('emits one event per error, each carrying the structured `raw`', () => {
    // The renderer keys click-to-navigate off `compileError.pouName`
    // — every per-error event must therefore reach the sink with the
    // raw attached, never as a joined string that drops the
    // structured fields.
    const e1 = mkErr({ pouName: 'Foo', section: 'body', bodyLine: 3, message: 'first' })
    const e2 = mkErr({ pouName: 'Bar', section: 'var-block', message: 'second' })
    const diags = [
      { formatted: '[Foo / body line 3]\nfoo.st:5:1: error: first', raw: e1 },
      { formatted: '[Bar / variable x]\nbar.st:2:1: error: second', raw: e2 },
    ]
    const calls: Array<{ msg: string; level: string; raw?: StrucppCompileError }> = []
    emitCompileErrorEvents(diags, (msg, level, raw) => calls.push({ msg, level, raw }))
    expect(calls).toHaveLength(3)
    expect(calls[0]).toEqual({ msg: 'STruC++ compilation failed:', level: 'error', raw: undefined })
    expect(calls[1]).toEqual({ msg: diags[0].formatted, level: 'error', raw: e1 })
    expect(calls[2]).toEqual({ msg: diags[1].formatted, level: 'error', raw: e2 })
  })

  it('falls back through formatted → raw.message → "unknown error" when formatted is missing', () => {
    // Defensive: a malformed entry where `formatted` is empty should
    // still produce something the user can read.  The raw is still
    // attached so click-to-navigate works even on the fallback path.
    const eOk = mkErr({ pouName: 'Ok', message: 'has message' })
    const eEmpty = mkErr({ pouName: 'Empty', message: '' })
    const diags = [
      { formatted: '', raw: eOk }, // empty formatted, falls to raw.message
      { formatted: '', raw: eEmpty }, // empty formatted + empty message → last-resort literal
    ]
    const calls: Array<{ msg: string; level: string; raw?: StrucppCompileError }> = []
    emitCompileErrorEvents(diags, (msg, level, raw) => calls.push({ msg, level, raw }))
    expect(calls[1]).toEqual({ msg: 'has message', level: 'error', raw: eOk })
    expect(calls[2]).toEqual({ msg: 'unknown error', level: 'error', raw: eEmpty })
  })
})
