import { stToXML } from '../st-xml'

describe('stToXML', () => {
  it('wraps value in the ST body structure with xhtml namespace', () => {
    const result = stToXML('x := 1;')
    expect(result).toEqual({
      body: {
        ST: {
          xhtml: {
            '@xmlns': 'http://www.w3.org/1999/xhtml',
            $: 'x := 1;',
          },
        },
      },
    })
  })

  it('handles an empty string', () => {
    const result = stToXML('')
    expect(result.body.ST.xhtml.$).toBe('')
  })

  it('handles multiline ST code', () => {
    const code = 'IF x > 0 THEN\n  y := x;\nEND_IF;'
    const result = stToXML(code)
    expect(result.body.ST.xhtml.$).toBe(code)
  })
})
