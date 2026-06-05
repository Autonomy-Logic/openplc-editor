import { stToXML } from '../st-xml'

describe('stToXML (old-editor)', () => {
  it('wraps value in the ST body structure with xhtml:p', () => {
    const result = stToXML('x := 1;')
    expect(result).toEqual({
      body: {
        ST: {
          'xhtml:p': {
            $: 'x := 1;',
          },
        },
      },
    })
  })

  it('handles an empty string', () => {
    const result = stToXML('')
    expect(result.body.ST['xhtml:p'].$).toBe('')
  })

  it('handles multiline ST code', () => {
    const code = 'IF x > 0 THEN\n  y := x;\nEND_IF;'
    const result = stToXML(code)
    expect(result.body.ST['xhtml:p'].$).toBe(code)
  })
})
