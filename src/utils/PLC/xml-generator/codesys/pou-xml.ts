// import { PLCVariable } from '@root/types/PLC'
import { FBDRungState, RungLadderState } from '@root/renderer/store/slices'
import { baseTypes } from '@root/shared/data'
import { PLCPou } from '@root/types/PLC/open-plc'
import { BaseXml } from '@root/types/PLC/xml-data/codesys'
import { InterfaceXML } from '@root/types/PLC/xml-data/codesys/pous/interface/interface-diagram'
import { VariableXML } from '@root/types/PLC/xml-data/codesys/variable/variable-diagram'

import { fbdToXml } from './language/fbd-xml'
import { ilToXML } from './language/il-xml'
import { ladderToXml } from './language/ladder-xml'
import { stToXML } from './language/st-xml'

export const codeSysParseInterface = (pou: PLCPou) => {
  const variables = pou.data.variables
  const returnType = pou.type === 'function' ? pou.data.returnType : undefined

  const xml: InterfaceXML = {}
  variables.forEach((variable) => {
    // const variableIsDerived = variable.type.definition === 'derived' || variable.type.definition === 'user-data-type'

    let vType = {}
    if (variable.type.definition === 'array') {
      vType = {
        array: {
          dimension: variable.type.data.dimensions.map((dimension) => {
            const lower = dimension.dimension.split('..')[0]
            const upper = dimension.dimension.split('..')[1]
            return {
              '@lower': lower,
              '@upper': upper,
            }
          }),
          baseType: {
            [variable.type.data.baseType.definition === 'user-data-type'
              ? 'derived'
              : variable.type.data.baseType.value === 'string'
                ? variable.type.data.baseType.value
                : variable.type.data.baseType.value.toUpperCase()]:
              variable.type.data.baseType.definition === 'user-data-type'
                ? { '@name': variable.type.data.baseType.value }
                : '',
          },
        },
      }
    } else if (variable.type.definition === 'derived' || variable.type.definition === 'user-data-type') {
      vType = {
        derived: {
          '@name': variable.type.value,
        },
      }
    } else {
      vType = {
        [variable.type.value === 'string' ? variable.type.value : variable.type.value.toUpperCase()]: '',
      }
    }

    const v: VariableXML = {
      '@name': variable.name,
      type: vType,
    }

    if (variable.location) v['@address'] = variable.location

    if (variable.initialValue)
      v.initialValue = {
        simpleValue: {
          '@value': variable.initialValue,
        },
      }

    if (variable.documentation)
      v.documentation = {
        'xhtml:p': {
          $: variable.documentation === '' ? ' ' : variable.documentation,
        },
      }

    if (returnType) {
      if (!xml.returnType) xml.returnType = {}

      const isBaseType = baseTypes.includes(returnType as (typeof baseTypes)[number])
      xml.returnType = isBaseType
        ? { [returnType.trim().toUpperCase() === 'STRING' ? returnType.toLowerCase() : returnType.toUpperCase()]: '' }
        : { derived: { '@name': returnType } }
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

  return xml
}

export const codeSysParsePousToXML = (xml: BaseXml, pous: PLCPou[]) => {
  pous.forEach((pou) => {
    const interfaceResult = codeSysParseInterface(pou)

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
              $: pou.data.documentation === '' ? ' ' : pou.data.documentation,
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
              $: pou.data.documentation === '' ? ' ' : pou.data.documentation,
            },
          },
        })
        return
      }
      case 'ld': {
        const rungs = pou.data.body.value.rungs
        const result = ladderToXml(rungs as RungLadderState[])
        xml.project.types.pous.pou.push({
          '@name': pou.data.name,
          '@pouType': pou.type === 'function-block' ? 'functionBlock' : pou.type,
          interface: interfaceResult,
          body: result.body,
          documentation: {
            'xhtml:p': {
              $: pou.data.documentation === '' ? ' ' : pou.data.documentation,
            },
          },
        })
        return
      }
      case 'fbd': {
        const rung = pou.data.body.value.rung
        const result = fbdToXml(rung as FBDRungState)
        xml.project.types.pous.pou.push({
          '@name': pou.data.name,
          '@pouType': pou.type === 'function-block' ? 'functionBlock' : pou.type,
          interface: interfaceResult,
          body: result.body,
          documentation: {
            'xhtml:p': {
              $: pou.data.documentation === '' ? ' ' : pou.data.documentation,
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
