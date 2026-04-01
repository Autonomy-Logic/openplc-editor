import {
  baseTypes,
  PLCFunctionBlockLanguages,
  PLCFunctionLanguages,
  PLCLanguages,
  PLCLanguagesShortenedForm,
  PLCProgramLanguages,
} from '../plc-constants/types'

describe('baseTypes', () => {
  it('contains all IEC 61131-3 base types', () => {
    expect(baseTypes).toContain('BOOL')
    expect(baseTypes).toContain('INT')
    expect(baseTypes).toContain('REAL')
    expect(baseTypes).toContain('STRING')
    expect(baseTypes).toContain('LOGLEVEL')
  })

  it('has 21 entries', () => {
    expect(baseTypes).toHaveLength(21)
  })

  it('is readonly', () => {
    // Verify the array is typed as const (readonly tuple)
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
