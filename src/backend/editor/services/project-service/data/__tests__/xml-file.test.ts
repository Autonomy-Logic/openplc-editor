jest.mock('@root/frontend/utils/format-date', () => ({
  formatDate: jest.fn().mockReturnValue('2024-01-01T00:00:00'),
}))

import { baseXmlStructure } from '../xml-file'

describe('baseXmlStructure', () => {
  it('has the expected top-level XML namespace attributes', () => {
    expect(baseXmlStructure['@xmlns']).toBe('http://www.plcopen.org/xml/tc6_0201')
    expect(baseXmlStructure['@xmlns:xhtml']).toBe('http://www.w3.org/1999/xhtml')
  })

  it('has fileHeader with default values', () => {
    expect(baseXmlStructure.fileHeader['@companyName']).toBe('Unknown')
    expect(baseXmlStructure.fileHeader['@productName']).toBe('Unnamed')
    expect(baseXmlStructure.fileHeader['@productVersion']).toBe('1')
    expect(typeof baseXmlStructure.fileHeader['@creationDateTime']).toBe('string')
  })

  it('has contentHeader with coordinateInfo', () => {
    expect(baseXmlStructure.contentHeader['@name']).toBe('Unnamed')
    expect(baseXmlStructure.contentHeader.coordinateInfo.fbd.scaling['@x']).toBe('16')
    expect(baseXmlStructure.contentHeader.coordinateInfo.ld.scaling['@x']).toBe('10')
    expect(baseXmlStructure.contentHeader.coordinateInfo.sfc.scaling['@x']).toBe('10')
  })

  it('has instances configuration', () => {
    expect(baseXmlStructure.instances.configurations.configuration['@name']).toBe('Config0')
    expect(baseXmlStructure.instances.configurations.configuration.resource['@name']).toBe('Res0')
  })
})
