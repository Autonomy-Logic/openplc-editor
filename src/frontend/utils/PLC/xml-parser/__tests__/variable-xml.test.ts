import { extractXhtmlText, parseDocumentationXml, parseVariableXml } from '../variable-xml'

describe('extractXhtmlText', () => {
  it('reads a plain string xhtml:p (no attributes)', () => {
    expect(extractXhtmlText({ 'xhtml:p': 'hello' })).toBe('hello')
  })

  it('reads the $ text node when xhtml:p has attributes', () => {
    expect(extractXhtmlText({ 'xhtml:p': { $: 'hello' } })).toBe('hello')
  })

  it('returns "" when there is no xhtml:p', () => {
    expect(extractXhtmlText({})).toBe('')
  })

  it('returns "" when the $ text node is missing/non-string', () => {
    expect(extractXhtmlText({ 'xhtml:p': {} })).toBe('')
  })
})

describe('parseDocumentationXml', () => {
  it('un-placeholders the single-space convention back to ""', () => {
    expect(parseDocumentationXml({ 'xhtml:p': ' ' })).toBe('')
  })

  it('passes through real documentation text', () => {
    expect(parseDocumentationXml({ 'xhtml:p': 'A comment' })).toBe('A comment')
  })
})

describe('parseVariableXml', () => {
  it('parses a fully-populated variable', () => {
    const result = parseVariableXml(
      {
        '@name': 'x',
        '@address': '%IX0.0',
        type: { BOOL: '' },
        initialValue: { simpleValue: { '@value': 'TRUE' } },
        documentation: { 'xhtml:p': 'A var' },
      },
      'input',
    )
    expect(result).toEqual({
      name: 'x',
      class: 'input',
      type: { definition: 'base-type', value: 'BOOL' },
      location: '%IX0.0',
      initialValue: 'TRUE',
      documentation: 'A var',
    })
  })

  it('defaults name to "", location to "", initialValue to null when absent', () => {
    const result = parseVariableXml({ type: { INT: '' } }, 'local')
    expect(result.name).toBe('')
    expect(result.location).toBe('')
    expect(result.initialValue).toBeNull()
  })
})
