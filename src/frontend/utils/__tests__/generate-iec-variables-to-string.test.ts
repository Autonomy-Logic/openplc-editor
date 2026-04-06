import type { PLCVariable } from '../../../middleware/shared/ports/types'
import { generateIecVariablesToString } from '../generate-iec-variables-to-string'

const makeVariable = (overrides: Partial<PLCVariable> & Pick<PLCVariable, 'name'>): PLCVariable => ({
  name: overrides.name,
  class: overrides.class ?? 'local',
  type: overrides.type ?? { definition: 'base-type', value: 'INT' },
  location: overrides.location ?? '',
  initialValue: overrides.initialValue ?? null,
  documentation: overrides.documentation ?? '',
  debug: overrides.debug ?? false,
})

describe('generateIecVariablesToString', () => {
  it('returns a bare VAR/END_VAR block for an empty array', () => {
    expect(generateIecVariablesToString([])).toBe('VAR\nEND_VAR')
  })

  it('returns a bare VAR/END_VAR block for null/undefined input', () => {
    expect(generateIecVariablesToString(null as unknown as PLCVariable[])).toBe('VAR\nEND_VAR')
  })

  it('generates a single local variable', () => {
    const vars: PLCVariable[] = [makeVariable({ name: 'counter', class: 'local' })]
    const result = generateIecVariablesToString(vars)

    expect(result).toContain('VAR')
    expect(result).toContain('\tcounter : INT;')
    expect(result).toContain('END_VAR')
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

    expect(result).toContain('\tsensor : INT AT %IX0.0;')
  })

  it('includes the initial value when present', () => {
    const vars: PLCVariable[] = [makeVariable({ name: 'counter', class: 'local', initialValue: '42' })]
    const result = generateIecVariablesToString(vars)

    expect(result).toContain('\tcounter : INT := 42;')
  })

  it('includes both location and initial value together', () => {
    const vars: PLCVariable[] = [
      makeVariable({ name: 'x', class: 'local', location: '%QW0', initialValue: '100' }),
    ]
    const result = generateIecVariablesToString(vars)

    expect(result).toContain('\tx : INT AT %QW0 := 100;')
  })

  it('appends documentation as a single-line comment', () => {
    const vars: PLCVariable[] = [makeVariable({ name: 'temp', class: 'local', documentation: 'Temperature sensor' })]
    const result = generateIecVariablesToString(vars)

    expect(result).toContain('\ttemp : INT; (* Temperature sensor *)')
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
    const lIdx = result.indexOf('\nVAR\n')
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
    expect(result).toContain('\ta : INT;')
    expect(result).toContain('\tb : BOOL;')
    // Only one VAR_INPUT block
    expect(result.split('VAR_INPUT').length).toBe(2) // one occurrence = 2 parts
  })
})
