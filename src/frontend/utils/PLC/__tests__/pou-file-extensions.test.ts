import {
  getEndKeyword,
  getExtensionFromLanguage,
  getFolderFromPouType,
  getLanguageFromExtension,
  getStartKeyword,
} from '../pou-file-extensions'

describe('getExtensionFromLanguage', () => {
  it('returns .st for st', () => {
    expect(getExtensionFromLanguage('st')).toBe('.st')
  })

  it('returns .il for il', () => {
    expect(getExtensionFromLanguage('il')).toBe('.il')
  })

  it('returns .ld for ld', () => {
    expect(getExtensionFromLanguage('ld')).toBe('.ld')
  })

  it('returns .fbd for fbd', () => {
    expect(getExtensionFromLanguage('fbd')).toBe('.fbd')
  })

  it('returns .py for python', () => {
    expect(getExtensionFromLanguage('python')).toBe('.py')
  })

  it('returns .cpp for cpp', () => {
    expect(getExtensionFromLanguage('cpp')).toBe('.cpp')
  })

  it('is case-insensitive', () => {
    expect(getExtensionFromLanguage('ST')).toBe('.st')
  })

  it('throws for unsupported language', () => {
    expect(() => getExtensionFromLanguage('java')).toThrow('Unsupported language: java')
  })
})

describe('getLanguageFromExtension', () => {
  it('returns st for .st', () => {
    expect(getLanguageFromExtension('.st')).toBe('st')
  })

  it('returns il for .il', () => {
    expect(getLanguageFromExtension('.il')).toBe('il')
  })

  it('returns ld for .ld', () => {
    expect(getLanguageFromExtension('.ld')).toBe('ld')
  })

  it('returns fbd for .fbd', () => {
    expect(getLanguageFromExtension('.fbd')).toBe('fbd')
  })

  it('returns python for .py', () => {
    expect(getLanguageFromExtension('.py')).toBe('python')
  })

  it('returns cpp for .cpp', () => {
    expect(getLanguageFromExtension('.cpp')).toBe('cpp')
  })

  it('works without leading dot', () => {
    expect(getLanguageFromExtension('st')).toBe('st')
  })

  it('throws for unsupported extension', () => {
    expect(() => getLanguageFromExtension('.java')).toThrow('Unsupported extension: .java')
  })
})

describe('getStartKeyword', () => {
  it('returns PROGRAM for program', () => {
    expect(getStartKeyword('program')).toBe('PROGRAM')
  })

  it('returns FUNCTION for function', () => {
    expect(getStartKeyword('function')).toBe('FUNCTION')
  })

  it('returns FUNCTION_BLOCK for function-block', () => {
    expect(getStartKeyword('function-block')).toBe('FUNCTION_BLOCK')
  })

  it('throws for unsupported POU type', () => {
    expect(() => getStartKeyword('unknown')).toThrow('Unsupported POU type: unknown')
  })
})

describe('getEndKeyword', () => {
  it('returns END_PROGRAM for program', () => {
    expect(getEndKeyword('program')).toBe('END_PROGRAM')
  })

  it('returns END_FUNCTION for function', () => {
    expect(getEndKeyword('function')).toBe('END_FUNCTION')
  })

  it('returns END_FUNCTION_BLOCK for function-block', () => {
    expect(getEndKeyword('function-block')).toBe('END_FUNCTION_BLOCK')
  })

  it('throws for unsupported POU type', () => {
    expect(() => getEndKeyword('unknown')).toThrow('Unsupported POU type: unknown')
  })
})

describe('getFolderFromPouType', () => {
  it('returns programs for program', () => {
    expect(getFolderFromPouType('program')).toBe('programs')
  })

  it('returns functions for function', () => {
    expect(getFolderFromPouType('function')).toBe('functions')
  })

  it('returns function-blocks for function-block', () => {
    expect(getFolderFromPouType('function-block')).toBe('function-blocks')
  })

  it('throws for unknown POU type', () => {
    expect(() => getFolderFromPouType('unknown')).toThrow('Unknown POU type: unknown')
  })
})
