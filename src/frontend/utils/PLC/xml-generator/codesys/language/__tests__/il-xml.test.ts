import { ilToXML } from '../il-xml'

describe('ilToXML', () => {
  it('wraps value in the IL body structure with xhtml namespace', () => {
    const result = ilToXML('LD %IX0.0')
    expect(result).toEqual({
      body: {
        IL: {
          xhtml: {
            '@xmlns': 'http://www.w3.org/1999/xhtml',
            $: 'LD %IX0.0',
          },
        },
      },
    })
  })

  it('handles an empty string', () => {
    const result = ilToXML('')
    expect(result.body.IL.xhtml.$).toBe('')
  })

  it('handles multiline IL code', () => {
    const code = 'LD %IX0.0\nAND %IX0.1\nST %QX0.0'
    const result = ilToXML(code)
    expect(result.body.IL.xhtml.$).toBe(code)
  })
})
