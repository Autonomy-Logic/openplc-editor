import type { PLCConfiguration, PLCPou } from '@root/middleware/shared/ports/open-plc-types'

import { codeSysInstanceToXml } from './codesys/instances-xml'
import { getBaseCodeSysXmlStructure } from './codesys/base-xml'
import { codeSysParseInterface } from './codesys/pou-xml'
import { getBaseOldEditorXmlStructure } from './old-editor/base-xml'
import { oldEditorInstanceToXml } from './old-editor/instances-xml'
import { oldEditorParseInterface } from './old-editor/pou-xml'

type RuntimeVariableInitialValue = boolean | number | string | null

type TestPou = Omit<PLCPou, 'data'> & {
  data: Omit<PLCPou['data'], 'variables'> & {
    variables: Array<Omit<PLCPou['data']['variables'][number], 'initialValue'> & { initialValue: RuntimeVariableInitialValue }>
  }
}

type TestConfiguration = Omit<PLCConfiguration, 'resource'> & {
  resource: Omit<PLCConfiguration['resource'], 'globalVariables'> & {
    globalVariables: Array<
      Omit<PLCConfiguration['resource']['globalVariables'][number], 'initialValue'> & {
        initialValue: RuntimeVariableInitialValue
      }
    >
  }
}

describe('XML generator initial values', () => {
  const buildPou = (initialValue: boolean | number): PLCPou => {
    const pou = {
      type: 'program',
      data: {
        name: 'Main',
        language: 'st',
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
        body: { language: 'st', value: '' },
        documentation: '',
      },
    } satisfies TestPou

    return pou as unknown as PLCPou
  }

  const buildConfiguration = (initialValue: boolean | number): PLCConfiguration => {
    const configuration = {
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
    } satisfies TestConfiguration

    return configuration as unknown as PLCConfiguration
  }

  const buildCodeSysXml = () => getBaseCodeSysXmlStructure()

  const buildOldEditorXml = () => getBaseOldEditorXmlStructure()

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

  it('keeps numeric zero initial values for codesys globals', () => {
    const xml = codeSysInstanceToXml(buildCodeSysXml(), buildConfiguration(0))
    expect(xml.project.instances.configurations.configuration.globalVars?.variable?.[0]?.initialValue).toEqual({
      simpleValue: {
        '@value': '0',
      },
    })
  })

  it('keeps numeric zero initial values for old editor globals', () => {
    const xml = oldEditorInstanceToXml(buildOldEditorXml(), buildConfiguration(0))
    expect(xml.project.instances.configurations.configuration.globalVars?.variable?.[0]?.initialValue).toEqual({
      simpleValue: {
        '@value': '0',
      },
    })
  })

  it('declares the xhtml namespace in codesys exports when variable documentation is present', () => {
    const xml = getBaseCodeSysXmlStructure()
    const pouWithDocumentation = {
      type: 'program',
      data: {
        name: 'Main',
        language: 'st',
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
        body: { language: 'st', value: '' },
        documentation: '',
      },
    } satisfies PLCPou
    const withDocumentation = codeSysParseInterface(pouWithDocumentation)

    expect(xml.project['@xmlns:xhtml']).toBe('http://www.w3.org/1999/xhtml')
    expect(withDocumentation.localVars?.variable?.[0]?.documentation).toEqual({
      'xhtml:p': {
        $: 'commento reset',
      },
    })
  })
})
