import { getBaseCodeSysXmlStructure } from '../base-xml'

describe('getBaseCodeSysXmlStructure', () => {
  it('returns a BaseXml with the codesys namespace', () => {
    const xml = getBaseCodeSysXmlStructure()
    expect(xml.project['@xmlns']).toBe('http://www.plcopen.org/xml/tc6_0200')
  })

  it('has default fileHeader fields', () => {
    const xml = getBaseCodeSysXmlStructure()
    expect(xml.project.fileHeader['@companyName']).toBe('Unknown')
    expect(xml.project.fileHeader['@productName']).toBe('Unnamed')
    expect(xml.project.fileHeader['@productVersion']).toBe('1')
    expect(xml.project.fileHeader['@creationDateTime']).toBeDefined()
  })

  it('has default contentHeader with scaling info', () => {
    const xml = getBaseCodeSysXmlStructure()
    expect(xml.project.contentHeader['@name']).toBe('Unnamed')
    expect(xml.project.contentHeader['@modificationDateTime']).toBeDefined()
    expect(xml.project.contentHeader.coordinateInfo.fbd.scaling).toEqual({ '@x': '16', '@y': '16' })
    expect(xml.project.contentHeader.coordinateInfo.ld.scaling).toEqual({ '@x': '16', '@y': '16' })
    expect(xml.project.contentHeader.coordinateInfo.sfc.scaling).toEqual({ '@x': '16', '@y': '16' })
  })

  it('has empty types and instances', () => {
    const xml = getBaseCodeSysXmlStructure()
    expect(xml.project.types.dataTypes.dataType).toEqual([])
    expect(xml.project.types.pous.pou).toEqual([])
    expect(xml.project.instances.configurations.configuration['@name']).toBe('Config0')
    expect(xml.project.instances.configurations.configuration.resource['@name']).toBe('Res0')
    expect(xml.project.instances.configurations.configuration.resource.task).toEqual([])
  })

  it('returns a fresh object each time', () => {
    const a = getBaseCodeSysXmlStructure()
    const b = getBaseCodeSysXmlStructure()
    expect(a).not.toBe(b)
    a.project.types.pous.pou.push({} as never)
    expect(b.project.types.pous.pou).toHaveLength(0)
  })
})
