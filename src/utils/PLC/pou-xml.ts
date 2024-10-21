// import { PLCVariable } from '@root/types/PLC'
import { RungState } from '@root/renderer/store/slices'
import { PLCPou } from '@root/types/PLC/open-plc'
import { BaseXml } from '@root/types/PLC/xml-data'
import { InterfaceXML } from '@root/types/PLC/xml-data/pous/interface/interface-diagram'
import { VariableXML } from '@root/types/PLC/xml-data/variable/variable-diagram'

import { ilToXML } from './language/il-xml'
import { ladderToXml } from './language/ladder-xml'
import { stToXML } from './language/st-xml'

export const parseInterface = (pou: PLCPou) => {
  const variables = pou.data.variables
  const returnType = pou.type === 'function' ? pou.data.returnType : undefined

  const xml: InterfaceXML = {}
  variables.forEach((variable) => {
    const v: VariableXML = {
      '@name': variable.name,
      type: {
        // !BAD CODE
        [variable.type.value.toUpperCase()]: '',
      },
    }

    if (variable.location)
      v['@address'] = variable.location

    if (variable.initialValue)
      v.initialValue = variable.initialValue

    if (variable.documentation)
      v.documentation = {
        'xhtml:p': {
          $: variable.documentation,
        },
      }

    switch (variable.class) {
      case 'input': {
        if (!xml.inputVars) xml.inputVars = { variable: [] }
        if (!xml.inputVars.variable) xml.inputVars.variable = []
        xml.inputVars.variable.push(v)
        return
      }
      case 'output': {
        if (!xml.outputVars) xml.outputVars = { variable: [] }
        if (!xml.outputVars.variable) xml.outputVars.variable = []
        xml.outputVars.variable.push(v)
        return
      }
      case 'inOut': {
        if (!xml.inOutVars) xml.inOutVars = { variable: [] }
        if (!xml.inOutVars.variable) xml.inOutVars.variable = []
        xml.inOutVars.variable.push(v)
        return
      }
      case 'external': {
        if (!xml.externalVars) xml.externalVars = { variable: [] }
        if (!xml.externalVars.variable) xml.externalVars.variable = []
        xml.externalVars.variable.push(v)
        return
      }
      case 'local': {
        if (!xml.localVars) xml.localVars = { variable: [] }
        if (!xml.localVars.variable) xml.localVars.variable = []
        xml.localVars.variable.push(v)
        return
      }
      case 'temp': {
        if (!xml.tempVars) xml.tempVars = { variable: [] }
        if (!xml.tempVars.variable) xml.tempVars.variable = []
        xml.tempVars.variable.push(v)
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

  return xml
}
