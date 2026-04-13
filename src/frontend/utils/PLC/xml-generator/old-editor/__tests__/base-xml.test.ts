import { getBaseOldEditorXmlStructure, parseProjectToXML } from '../base-xml'

describe('getBaseOldEditorXmlStructure', () => {
  it('returns a BaseXml with the old-editor namespace', () => {
    const xml = getBaseOldEditorXmlStructure()
    expect(xml.project['@xmlns']).toBe('http://www.plcopen.org/xml/tc6_0201')
    expect(xml.project['@xmlns:xsd']).toBe('http://www.w3.org/2001/XMLSchema-instance')
    expect(xml.project['@xmlns:xhtml']).toBe('http://www.w3.org/1999/xhtml')
    expect(xml.project['@xmlns:ns1']).toBe('http://www.plcopen.org/xml/tc6_0201')
  })

  it('has default fileHeader fields', () => {
    const xml = getBaseOldEditorXmlStructure()
    expect(xml.project.fileHeader['@companyName']).toBe('Unknown')
    expect(xml.project.fileHeader['@productName']).toBe('Unnamed')
    expect(xml.project.fileHeader['@productVersion']).toBe('1')
    expect(xml.project.fileHeader['@creationDateTime']).toBeDefined()
  })

  it('has default contentHeader with scaling info', () => {
    const xml = getBaseOldEditorXmlStructure()
    expect(xml.project.contentHeader['@name']).toBe('Unnamed')
    expect(xml.project.contentHeader.coordinateInfo.fbd.scaling).toEqual({ '@x': '16', '@y': '16' })
    expect(xml.project.contentHeader.coordinateInfo.ld.scaling).toEqual({ '@x': '16', '@y': '16' })
    expect(xml.project.contentHeader.coordinateInfo.sfc.scaling).toEqual({ '@x': '16', '@y': '16' })
  })

  it('has empty types and instances', () => {
    const xml = getBaseOldEditorXmlStructure()
    expect(xml.project.types.dataTypes.dataType).toEqual([])
    expect(xml.project.types.pous.pou).toEqual([])
    expect(xml.project.instances.configurations.configuration['@name']).toBe('Config0')
    expect(xml.project.instances.configurations.configuration.resource['@name']).toBe('Res0')
    expect(xml.project.instances.configurations.configuration.resource.task).toEqual([])
  })

  it('returns a fresh object each time', () => {
    const a = getBaseOldEditorXmlStructure()
    const b = getBaseOldEditorXmlStructure()
    expect(a).not.toBe(b)
  })
})

describe('parseProjectToXML', () => {
  it('returns valid XML string for a minimal project', () => {
    const project = {
      meta: { name: 'TestProject', type: 'plc-project' as const },
      data: {
        pous: [
          {
            type: 'program' as const,
            data: {
              name: 'main',
              language: 'st' as const,
              variables: [],
              body: { language: 'st' as const, value: '' },
              documentation: '',
            },
          },
        ],
        dataTypes: [],
        configuration: {
          resource: {
            tasks: [],
            instances: [],
            globalVariables: [],
          },
        },
      },
    }
    const result = parseProjectToXML(project)
    expect(result).toContain('<?xml')
    expect(result).toContain('plcopen.org')
    expect(result).toContain('main')
  })
})
