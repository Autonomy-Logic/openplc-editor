import { ilToXML } from '../il-xml'

describe('ilToXML (old-editor)', () => {
  it('wraps value in the IL body structure with xhtml:p', () => {
    const result = ilToXML('LD %IX0.0')
    expect(result).toEqual({
      body: {
        IL: {
          'xhtml:p': {
            $: 'LD %IX0.0',
          },
        },
      },
    })
  })

  it('handles an empty string', () => {
    const result = ilToXML('')
    expect(result.body.IL['xhtml:p'].$).toBe('')
  })

  it('handles multiline IL code', () => {
    const code = 'LD %IX0.0\nAND %IX0.1\nST %QX0.0'
    const result = ilToXML(code)
    expect(result.body.IL['xhtml:p'].$).toBe(code)
  })
})
