// import { PLCVariable } from '@root/types/PLC'
import { RungState } from '@root/renderer/store/slices'
import { PLCPou } from '@root/types/PLC/open-plc'
import { BaseXml } from '@root/types/PLC/xml-data'
import { InterfaceXML } from '@root/types/PLC/xml-data/pous/interface/interface-diagram'
import { VariableXML } from '@root/types/PLC/xml-data/variable/variable-diagram'

import { ilToXML } from './il-xml'
import { ladderToXml } from './ladder-xml'
import { stToXML } from './st-xml'

export const parseInterface = (pou: PLCPou) => {
  const variables = pou.data.variables
  const returnType = pou.type === 'function' ? pou.data.returnType : undefined

  const xml: InterfaceXML = {}
  variables.forEach((variable) => {
    const v: VariableXML = {
      '@name': variable.name,
      '@address': variable.location,
      type: {
        // !BAD CODE
        [variable.type.value.toUpperCase()]: '',
      },
      initialValue: variable.initialValue,
      documentation: {
        'xhtml:p': {
          $: variable.documentation,
        },
      },
    }

    switch (variable.class) {
      case 'input': {
        if (!xml.inputVars) xml.inputVars = []
        xml.inputVars.push(v)
        return
      }
      case 'output': {
        if (!xml.outputVars) xml.outputVars = []
        xml.outputVars.push(v)
        return
      }
      case 'inOut': {
        if (!xml.inOutVars) xml.inOutVars = []
        xml.inOutVars.push(v)
        return
      }
      case 'external': {
        if (!xml.externalVars) xml.externalVars = []
        xml.externalVars.push(v)
        return
      }
      case 'local': {
        if (!xml.localVars) xml.localVars = []
        xml.localVars.push(v)
        return
      }
      case 'temp': {
        if (!xml.tempVars) xml.tempVars = []
        xml.tempVars.push(v)
        return
      }
      default:
        return
    }
  })

  if (returnType) {
    if (!xml.returnType) xml.returnType
    xml.returnType = {
      [returnType]: '',
    }
  }

  return xml
}

export const parsePousToXML = (xml: BaseXml, pous: PLCPou[]) => {
  pous.forEach((pou) => {

    const interfaceResult = parseInterface(pou)

    switch (pou.data.body.language) {
      case 'il': {
        const result = ilToXML(pou.data.body.value)
        xml.project.types.pous.pou.push({
          '@name': pou.data.name,
          '@pouType': pou.type === 'function-block' ? 'functionBlock' : pou.type,
          interface: interfaceResult,
          body: result.body,
          documentation: {
            'xhtml:p': {
              $: pou.data.documentation,
            },
          },
        })
        return
      }
      case 'st': {
        const result = stToXML(pou.data.body.value)
        xml.project.types.pous.pou.push({
          '@name': pou.data.name,
          '@pouType': pou.type === 'function-block' ? 'functionBlock' : pou.type,
          interface: interfaceResult,
          body: result.body,
          documentation: {
            'xhtml:p': {
              $: pou.data.documentation,
            },
          },
        })
        return
      }
      case 'ld': {
        const rungs = pou.data.body.value.rungs
        const result = ladderToXml(rungs as RungState[])
        xml.project.types.pous.pou.push({
          '@name': pou.data.name,
          '@pouType': pou.type === 'function-block' ? 'functionBlock' : pou.type,
          interface: interfaceResult,
          body: result.body,
          documentation: {
            'xhtml:p': {
              $: pou.data.documentation,
            },
          },
        })
        return
      }
      default:
        return
    }
  })
}
