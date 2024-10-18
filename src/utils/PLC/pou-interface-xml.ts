// import { PLCVariable } from '@root/types/PLC'
import { PLCPou } from '@root/types/PLC/open-plc'
import { InterfaceXML } from '@root/types/PLC/xml-data/pous/interface/interface-diagram'
import { VariableXML } from '@root/types/PLC/xml-data/variable/variable-diagram'

// const parseType = (type: string) => {
//   return { `${type}`: '' }
// }

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
