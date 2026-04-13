import { ConvertToLangShortenedFormat, CreateEditorPath } from '../formatters/POU'

describe('ConvertToLangShortenedFormat', () => {
  it('converts "Python" to "python"', () => {
    expect(ConvertToLangShortenedFormat('Python')).toBe('python')
  })

  it('converts "C/C++" to "cpp"', () => {
    expect(ConvertToLangShortenedFormat('C/C++')).toBe('cpp')
  })

  it('converts "Instruction List" to "il"', () => {
    expect(ConvertToLangShortenedFormat('Instruction List')).toBe('il')
  })

  it('converts "Structured Text" to "st"', () => {
    expect(ConvertToLangShortenedFormat('Structured Text')).toBe('st')
  })

  it('converts "Ladder Diagram" to "ld"', () => {
    expect(ConvertToLangShortenedFormat('Ladder Diagram')).toBe('ld')
  })

  it('converts "Sequential Function Chart" to "sfc"', () => {
    expect(ConvertToLangShortenedFormat('Sequential Function Chart')).toBe('sfc')
  })

  it('converts "Function Block Diagram" to "fbd"', () => {
    expect(ConvertToLangShortenedFormat('Function Block Diagram')).toBe('fbd')
  })
})

describe('CreateEditorPath', () => {
  it('creates path for a program', () => {
    expect(CreateEditorPath('main', 'program')).toBe('/data/pous/program/main')
  })

  it('creates path for a function', () => {
    expect(CreateEditorPath('add', 'function')).toBe('/data/pous/function/add')
  })

  it('creates path for a function-block', () => {
    expect(CreateEditorPath('counter', 'function-block')).toBe('/data/pous/function-block/counter')
  })
})
