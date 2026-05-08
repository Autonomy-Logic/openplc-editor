import {
  baseTypes,
  PLCFunctionBlockLanguages,
  PLCFunctionLanguages,
  PLCLanguages,
  PLCLanguagesShortenedForm,
  PLCProgramLanguages,
} from '../plc-constants/types'

describe('baseTypes', () => {
  // baseTypes now sources from strucpp's `libs/iec-types.json` via
  // the iec-types-registry. The earlier hand-rolled list (and the
  // stale LOGLEVEL extension) is gone — adding/removing a base type
  // happens upstream in strucpp.
  it('contains every IEC 61131-3 elementary type the editor exposes', () => {
    expect(baseTypes).toContain('BOOL')
    expect(baseTypes).toContain('INT')
    expect(baseTypes).toContain('REAL')
    expect(baseTypes).toContain('STRING')
    expect(baseTypes).toContain('WSTRING')
    expect(baseTypes).toContain('TIME')
    expect(baseTypes).toContain('DT')
  })

  it('does not surface alias spellings (canonical names only)', () => {
    expect(baseTypes).not.toContain('TIME_OF_DAY')
    expect(baseTypes).not.toContain('DATE_AND_TIME')
  })

  it('is readonly', () => {
    const _check: readonly string[] = baseTypes
    expect(_check).toBe(baseTypes)
  })
})

describe('PLCLanguagesShortenedForm', () => {
  it('contains all five IEC 61131-3 languages', () => {
    expect(PLCLanguagesShortenedForm).toEqual(['IL', 'ST', 'LD', 'FBD', 'SFC'])
  })
})

describe('PLCFunctionBlockLanguages', () => {
  it('includes standard languages plus python and cpp', () => {
    expect(PLCFunctionBlockLanguages).toEqual(['IL', 'ST', 'LD', 'FBD', 'SFC', 'python', 'cpp'])
  })
})

describe('PLCFunctionLanguages', () => {
  it('contains the five standard languages', () => {
    expect(PLCFunctionLanguages).toEqual(['IL', 'ST', 'LD', 'FBD', 'SFC'])
  })
})

describe('PLCProgramLanguages', () => {
  it('contains the five standard languages', () => {
    expect(PLCProgramLanguages).toEqual(['IL', 'ST', 'LD', 'FBD', 'SFC'])
  })
})

describe('PLCLanguages', () => {
  it('contains full language names', () => {
    expect(PLCLanguages).toEqual([
      'instruction-list',
      'structured-text',
      'ladder-diagram',
      'function-block-diagram',
      'sequential-function-chart',
    ])
  })
})
