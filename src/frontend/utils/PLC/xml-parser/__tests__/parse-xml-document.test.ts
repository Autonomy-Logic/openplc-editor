import { parseXmlDocument } from '../parse-xml-document'

describe('parseXmlDocument', () => {
  it('parses a minimal project document', () => {
    const xml = `<?xml version="1.0"?><project><contentHeader name="Unnamed"/></project>`
    const result = parseXmlDocument(xml)
    expect(result).toHaveProperty('contentHeader')
  })

  it('throws when the <project> root element is missing', () => {
    expect(() => parseXmlDocument('<?xml version="1.0"?><notAProject/>')).toThrow(
      'Invalid PLCopen XML: missing <project> root element',
    )
  })

  it('throws for empty/garbage input', () => {
    expect(() => parseXmlDocument('')).toThrow('Invalid PLCopen XML: missing <project> root element')
  })
})
