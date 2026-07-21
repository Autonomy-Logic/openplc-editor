import { parseInterfaceXml, parsePousXml } from '../pou-xml'

describe('parseInterfaceXml', () => {
  it('returns an empty variables array with no returnType when interface is empty', () => {
    expect(parseInterfaceXml({})).toEqual({ variables: [] })
  })

  it('categorizes variables by group', () => {
    const result = parseInterfaceXml({
      inputVars: { variable: [{ '@name': 'a', type: { BOOL: '' } }] },
      outputVars: { variable: [{ '@name': 'b', type: { BOOL: '' } }] },
      inOutVars: { variable: [{ '@name': 'c', type: { BOOL: '' } }] },
      externalVars: { variable: [{ '@name': 'd', type: { BOOL: '' } }] },
      localVars: { variable: [{ '@name': 'e', type: { BOOL: '' } }] },
      tempVars: { variable: [{ '@name': 'f', type: { BOOL: '' } }] },
    })
    expect(result.variables.map((v) => [v.name, v.class])).toEqual([
      ['a', 'input'],
      ['b', 'output'],
      ['c', 'inOut'],
      ['d', 'external'],
      ['e', 'local'],
      ['f', 'temp'],
    ])
  })

  it('parses a base-type returnType', () => {
    const result = parseInterfaceXml({ returnType: { INT: '' } })
    expect(result.returnType).toBe('INT')
  })

  it('parses a derived returnType', () => {
    const result = parseInterfaceXml({ returnType: { derived: { '@name': 'MyType' } } })
    expect(result.returnType).toBe('MyType')
  })
})

describe('parsePousXml', () => {
  it('parses an ST program with documentation', () => {
    const { pous, warnings } = parsePousXml([
      {
        '@name': 'main',
        '@pouType': 'program',
        interface: {},
        documentation: { 'xhtml:p': 'A program' },
        body: { ST: { 'xhtml:p': 'x := 1;' } },
      },
    ])
    expect(warnings).toEqual([])
    expect(pous).toEqual([
      {
        name: 'main',
        pouType: 'program',
        interface: { variables: [] },
        body: { language: 'st', value: 'x := 1;' },
        documentation: 'A program',
      },
    ])
  })

  it('parses an IL function-block', () => {
    const { pous } = parsePousXml({
      '@name': 'fb1',
      '@pouType': 'functionBlock',
      interface: {},
      documentation: { 'xhtml:p': ' ' },
      body: { IL: { 'xhtml:p': 'LD 1' } },
    })
    expect(pous[0].pouType).toBe('function-block')
    expect(pous[0].body).toEqual({ language: 'il', value: 'LD 1' })
    expect(pous[0].documentation).toBe('')
  })

  it('parses a function with a returnType', () => {
    const { pous } = parsePousXml({
      '@name': 'f1',
      '@pouType': 'function',
      interface: { returnType: { BOOL: '' } },
      documentation: '',
      body: { ST: { 'xhtml:p': 'f1 := TRUE;' } },
    })
    expect(pous[0].interface?.returnType).toBe('BOOL')
  })

  it('parses an LD body', () => {
    const { pous, warnings } = parsePousXml({
      '@name': 'ld1',
      '@pouType': 'program',
      interface: {},
      documentation: '',
      body: { LD: {} },
    })
    expect(warnings).toEqual([])
    expect(pous[0].body.language).toBe('ld')
    expect(pous[0].body.value).toEqual({ name: 'ld1', updated: false, rungs: [] })
  })

  it('parses an FBD body', () => {
    const { pous, warnings } = parsePousXml({
      '@name': 'fbd1',
      '@pouType': 'program',
      interface: {},
      documentation: '',
      body: { FBD: {} },
    })
    expect(warnings).toEqual([])
    expect(pous[0].body.language).toBe('fbd')
    expect(pous[0].body.value).toEqual({
      name: 'fbd1',
      updated: false,
      rung: { comment: '', nodes: [], edges: [], selectedNodes: [] },
    })
  })

  it('warns and skips an SFC body', () => {
    const { pous, warnings } = parsePousXml({
      '@name': 'sfc1',
      '@pouType': 'program',
      interface: {},
      documentation: '',
      body: { SFC: {} },
    })
    expect(pous).toEqual([])
    expect(warnings).toEqual(['POU "sfc1": Sequential Function Chart is not supported by the importer, skipped'])
  })

  it('warns and skips a POU with an unrecognized pouType', () => {
    const { pous, warnings } = parsePousXml({ '@name': 'bad1', '@pouType': 'weird', body: {} })
    expect(pous).toEqual([])
    expect(warnings).toEqual(['POU "bad1": unrecognized pouType "weird", skipped'])
  })

  it('warns and skips a POU with no recognized body language', () => {
    const { pous, warnings } = parsePousXml({
      '@name': 'nobody',
      '@pouType': 'program',
      interface: {},
      documentation: '',
      body: {},
    })
    expect(pous).toEqual([])
    expect(warnings).toEqual(['POU "nobody": no recognized body language found, skipped'])
  })
})
