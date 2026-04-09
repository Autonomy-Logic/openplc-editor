import { codeSysInstanceToXml } from './codesys/instances-xml'
import { getBaseCodeSysXmlStructure } from './codesys/base-xml'
import { codeSysParseInterface } from './codesys/pou-xml'
import { oldEditorInstanceToXml } from './old-editor/instances-xml'
import { oldEditorParseInterface } from './old-editor/pou-xml'

describe('XML generator initial values', () => {
  const buildPou = (initialValue: boolean | number) =>
    ({
      type: 'program',
      data: {
        name: 'Main',
        variables: [
          {
            name: 'flag',
            class: 'local',
            type: { definition: 'base-type', value: 'bool' },
            location: '%QX0.0',
            initialValue,
            documentation: '',
          },
        ],
      },
    }) as any

  const buildConfiguration = (initialValue: boolean | number) =>
    ({
      resource: {
        tasks: [],
        instances: [],
        globalVariables: [
          {
            name: 'globalFlag',
            location: '%QX0.0',
            type: { definition: 'base-type', value: 'bool' },
            initialValue,
            documentation: '',
          },
        ],
      },
    }) as any

  const buildCodeSysXml = () =>
    ({
      project: {
        instances: {
          configurations: {
            configuration: {
              resource: {},
            },
          },
        },
      },
    }) as any

  const buildOldEditorXml = buildCodeSysXml

  it.each([
    ['codesys interface', codeSysParseInterface],
    ['old editor interface', oldEditorParseInterface],
  ])('keeps false BOOL initial values for %s', (_label, parseInterface) => {
    const xml = parseInterface(buildPou(false))
    expect(xml.localVars?.variable?.[0]?.initialValue).toEqual({
      simpleValue: {
        '@value': 'false',
      },
    })
  })

  it.each([
    ['codesys globals', codeSysInstanceToXml, buildCodeSysXml],
    ['old editor globals', oldEditorInstanceToXml, buildOldEditorXml],
  ])('keeps numeric zero initial values for %s', (_label, toXml, buildXml) => {
    const xml = toXml(buildXml(), buildConfiguration(0))
    expect(xml.project.instances.configurations.configuration.globalVars?.variable?.[0]?.initialValue).toEqual({
      simpleValue: {
        '@value': '0',
      },
    })
  })

  it('declares the xhtml namespace in codesys exports when variable documentation is present', () => {
    const xml = getBaseCodeSysXmlStructure()
    const withDocumentation = codeSysParseInterface({
      type: 'program',
      data: {
        name: 'Main',
        variables: [
          {
            name: 'flag',
            class: 'local',
            type: { definition: 'base-type', value: 'bool' },
            location: '',
            initialValue: '',
            documentation: 'commento reset',
          },
        ],
      },
    } as any)

    expect(xml.project['@xmlns:xhtml']).toBe('http://www.w3.org/1999/xhtml')
    expect(withDocumentation.localVars?.variable?.[0]?.documentation).toEqual({
      'xhtml:p': {
        $: 'commento reset',
      },
    })
  })
})
