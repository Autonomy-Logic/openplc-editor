import type { PLCVariable } from '../../../middleware/shared/ports/types'
import { generateIecVariablesToString, getIecVariableLineMap } from '../generate-iec-variables-to-string'

const makeVariable = (overrides: Partial<PLCVariable> & Pick<PLCVariable, 'name'>): PLCVariable => ({
  name: overrides.name,
  class: overrides.class ?? 'local',
  type: overrides.type ?? { definition: 'base-type', value: 'INT' },
  location: overrides.location ?? '',
  initialValue: overrides.initialValue ?? null,
  documentation: overrides.documentation ?? '',
  debug: overrides.debug ?? false,
})

// Format matches xml2st's PouProgramGenerator output:
//   * VAR / END_VAR keywords are indented by 2 spaces
//   * variable declaration lines by 4 spaces
//   * consecutive var-class blocks have no blank line between them
// See `generate-iec-variables-to-string.ts` for the rationale.

describe('generateIecVariablesToString', () => {
  it('returns a bare VAR/END_VAR block for an empty array', () => {
    expect(generateIecVariablesToString([])).toBe('  VAR\n  END_VAR')
  })

  it('returns a bare VAR/END_VAR block for null/undefined input', () => {
    expect(generateIecVariablesToString(null as unknown as PLCVariable[])).toBe('  VAR\n  END_VAR')
  })

  it('generates a single local variable', () => {
    const vars: PLCVariable[] = [makeVariable({ name: 'counter', class: 'local' })]
    const result = generateIecVariablesToString(vars)

    expect(result).toContain('  VAR\n')
    expect(result).toContain('    counter : INT;')
    expect(result).toContain('  END_VAR')
  })

  it('uses the correct block header for each variable class', () => {
    const classes: Array<{ class: PLCVariable['class']; header: string }> = [
      { class: 'global', header: 'VAR_GLOBAL' },
      { class: 'external', header: 'VAR_EXTERNAL' },
      { class: 'input', header: 'VAR_INPUT' },
      { class: 'output', header: 'VAR_OUTPUT' },
      { class: 'inOut', header: 'VAR_IN_OUT' },
      { class: 'local', header: 'VAR' },
      { class: 'temp', header: 'VAR_TEMP' },
    ]

    for (const { class: cls, header } of classes) {
      const vars: PLCVariable[] = [makeVariable({ name: 'v', class: cls })]
      const result = generateIecVariablesToString(vars)
      expect(result).toContain(header)
    }
  })

  it('defaults to "global" class when class is undefined', () => {
    const vars: PLCVariable[] = [makeVariable({ name: 'v' })]
    // Remove the class property to simulate undefined
    delete (vars[0] as unknown as Record<string, unknown>).class
    const result = generateIecVariablesToString(vars)
    expect(result).toContain('VAR_GLOBAL')
  })

  it('includes the AT location when present', () => {
    const vars: PLCVariable[] = [makeVariable({ name: 'sensor', class: 'local', location: '%IX0.0' })]
    const result = generateIecVariablesToString(vars)

    expect(result).toContain('    sensor : INT AT %IX0.0;')
  })

  it('includes the initial value when present', () => {
    const vars: PLCVariable[] = [makeVariable({ name: 'counter', class: 'local', initialValue: '42' })]
    const result = generateIecVariablesToString(vars)

    expect(result).toContain('    counter : INT := 42;')
  })

  it('includes both location and initial value together', () => {
    const vars: PLCVariable[] = [makeVariable({ name: 'x', class: 'local', location: '%QW0', initialValue: '100' })]
    const result = generateIecVariablesToString(vars)

    expect(result).toContain('    x : INT AT %QW0 := 100;')
  })

  it('appends documentation as a single-line comment', () => {
    const vars: PLCVariable[] = [makeVariable({ name: 'temp', class: 'local', documentation: 'Temperature sensor' })]
    const result = generateIecVariablesToString(vars)

    expect(result).toContain('    temp : INT; (* Temperature sensor *)')
  })

  it('collapses multi-line documentation to a single line', () => {
    const vars: PLCVariable[] = [
      makeVariable({ name: 'temp', class: 'local', documentation: 'Line 1\nLine 2\r\nLine 3' }),
    ]
    const result = generateIecVariablesToString(vars)

    expect(result).toContain('(* Line 1 Line 2 Line 3 *)')
  })

  it('does not append empty documentation', () => {
    const vars: PLCVariable[] = [makeVariable({ name: 'temp', class: 'local', documentation: '   \n  ' })]
    const result = generateIecVariablesToString(vars)

    expect(result).not.toContain('(*')
  })

  it('orders groups as global, external, input, output, inout, local, temp', () => {
    const vars: PLCVariable[] = [
      makeVariable({ name: 'tVar', class: 'temp' }),
      makeVariable({ name: 'lVar', class: 'local' }),
      makeVariable({ name: 'ioVar', class: 'inOut' }),
      makeVariable({ name: 'oVar', class: 'output' }),
      makeVariable({ name: 'iVar', class: 'input' }),
      makeVariable({ name: 'eVar', class: 'external' }),
      makeVariable({ name: 'gVar', class: 'global' }),
    ]
    const result = generateIecVariablesToString(vars)

    const gIdx = result.indexOf('VAR_GLOBAL')
    const eIdx = result.indexOf('VAR_EXTERNAL')
    const iIdx = result.indexOf('VAR_INPUT')
    const oIdx = result.indexOf('VAR_OUTPUT')
    const ioIdx = result.indexOf('VAR_IN_OUT')
    // The local block is bare `VAR` (not VAR_*).  Search for `  VAR\n`
    // so the index lookup doesn't accidentally hit the start of any
    // `VAR_INPUT`/`VAR_OUTPUT`/etc. header earlier in the output.
    const lIdx = result.indexOf('  VAR\n')
    const tIdx = result.indexOf('VAR_TEMP')

    expect(gIdx).toBeLessThan(eIdx)
    expect(eIdx).toBeLessThan(iIdx)
    expect(iIdx).toBeLessThan(oIdx)
    expect(oIdx).toBeLessThan(ioIdx)
    expect(ioIdx).toBeLessThan(lIdx)
    expect(lIdx).toBeLessThan(tIdx)
  })

  it('generates multiple variables within the same class block', () => {
    const vars: PLCVariable[] = [
      makeVariable({ name: 'a', class: 'input' }),
      makeVariable({ name: 'b', class: 'input', type: { definition: 'base-type', value: 'BOOL' } }),
    ]
    const result = generateIecVariablesToString(vars)

    expect(result).toContain('VAR_INPUT')
    expect(result).toContain('    a : INT;')
    expect(result).toContain('    b : BOOL;')
    // Only one VAR_INPUT block
    expect(result.split('VAR_INPUT').length).toBe(2) // one occurrence = 2 parts
  })

  it('emits consecutive var-class blocks with no blank line between them (xml2st parity)', () => {
    // xml2st walks `self.Interface` and emits each var-class block
    // back-to-back, immediately closing one END_VAR before opening the
    // next header.  The vars-text editor needs to mirror that exactly
    // so a manual edit of the text view doesn't get re-formatted into
    // a different shape on the next save / round-trip.
    const vars: PLCVariable[] = [
      makeVariable({ name: 'inA', class: 'input' }),
      makeVariable({ name: 'outA', class: 'output' }),
    ]
    const result = generateIecVariablesToString(vars)
    expect(result).toBe(
      ['  VAR_INPUT', '    inA : INT;', '  END_VAR', '  VAR_OUTPUT', '    outA : INT;', '  END_VAR'].join('\n'),
    )
  })
})

describe('getIecVariableLineMap', () => {
  it('returns an empty map for empty / nullish input', () => {
    expect(getIecVariableLineMap([]).size).toBe(0)
    expect(getIecVariableLineMap(null as unknown as PLCVariable[]).size).toBe(0)
  })

  it('places each variable on the same Monaco line as the IEC text emits', () => {
    const vars: PLCVariable[] = [
      makeVariable({ name: 'ValveState', class: 'input', type: { definition: 'base-type', value: 'BOOL' } }),
      makeVariable({ name: 'DidPrint', class: 'output', type: { definition: 'base-type', value: 'BOOL' } }),
    ]
    const map = getIecVariableLineMap(vars)
    expect(map.get('ValveState')).toEqual({ line: 2, column: 5 })
    expect(map.get('DidPrint')).toEqual({ line: 5, column: 5 })

    // Spot-check the line numbers against the emitted text — this is
    // the regression guard: if the synthesizer ever inserts an extra
    // blank line or drops a header, this test catches the drift.
    const text = generateIecVariablesToString(vars)
    const lines = text.split('\n')
    for (const [name, pos] of map) {
      // 1-indexed Monaco → 0-indexed array access.
      expect(lines[pos.line - 1].trimStart().startsWith(`${name} :`)).toBe(true)
    }
  })

  it('honours the global → external → input → output → inout → local → temp ordering', () => {
    const vars: PLCVariable[] = [
      makeVariable({ name: 'a', class: 'local' }),
      makeVariable({ name: 'b', class: 'input' }),
      makeVariable({ name: 'c', class: 'output' }),
      makeVariable({ name: 'd', class: 'local' }),
    ]
    const map = getIecVariableLineMap(vars)
    const text = generateIecVariablesToString(vars)
    const lines = text.split('\n')
    for (const [name, pos] of map) {
      expect(lines[pos.line - 1].trimStart().startsWith(`${name} :`)).toBe(true)
    }
  })

  it('uses column 5 (4-space indent + 1-indexed Monaco) for every variable name', () => {
    const map = getIecVariableLineMap([makeVariable({ name: 'OnlyOne', class: 'input' })])
    expect(map.get('OnlyOne')?.column).toBe(5)
  })
})
