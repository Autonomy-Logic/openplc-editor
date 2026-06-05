// import { PLCVariable } from '@root/backend/shared/types/PLC/open-plc'
import { FBDRungState, RungLadderState } from '@root/frontend/store/slices'
import { baseTypes } from '@root/frontend/utils/plc-constants/types'
import { PLCPou } from '@root/middleware/shared/ports/open-plc-types'
import { BaseXml } from '@root/middleware/shared/ports/xml-types/codesys'
import { InterfaceXML } from '@root/middleware/shared/ports/xml-types/codesys/pous/interface/interface-diagram'
import { VariableXML } from '@root/middleware/shared/ports/xml-types/codesys/variable/variable-diagram'

import { baseTypeTag } from '../base-type-tag'
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
          dimension: variable.type.data!.dimensions.map((dimension) => {
            const lower = dimension.dimension.split('..')[0]
            const upper = dimension.dimension.split('..')[1]
            return {
              '@lower': lower,
              '@upper': upper,
            }
          }),
          baseType: {
            [variable.type.data!.baseType.definition === 'user-data-type'
              ? 'derived'
              : baseTypeTag(variable.type.data!.baseType.value)]:
              variable.type.data!.baseType.definition === 'user-data-type'
                ? { '@name': variable.type.data!.baseType.value }
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
        [baseTypeTag(variable.type.value)]: '',
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
          /* istanbul ignore next -- guard: empty string is falsy so this branch is unreachable */
          $: variable.documentation === '' ? ' ' : variable.documentation,
        },
      }

    if (returnType) {
      /* istanbul ignore next -- guard: returnType object is unconditionally reassigned below */
      if (!xml.returnType) xml.returnType = {}

      const isBaseType = baseTypes.includes(returnType)
      xml.returnType = isBaseType ? { [baseTypeTag(returnType)]: '' } : { ['derived']: { '@name': returnType } }
    }

    switch (variable.class) {
      case 'input': {
        if (!xml.inputVars) xml.inputVars = { variable: [] }
        /* istanbul ignore next -- defensive: variable array always initialised above */
        if (!xml.inputVars.variable) xml.inputVars.variable = []
        xml.inputVars.variable.push(v)
        return
      }
      case 'output': {
        if (!xml.outputVars) xml.outputVars = { variable: [] }
        /* istanbul ignore next -- defensive: variable array always initialised above */
        if (!xml.outputVars.variable) xml.outputVars.variable = []
        xml.outputVars.variable.push(v)
        return
      }
      case 'inOut': {
        if (!xml.inOutVars) xml.inOutVars = { variable: [] }
        /* istanbul ignore next -- defensive: variable array always initialised above */
        if (!xml.inOutVars.variable) xml.inOutVars.variable = []
        xml.inOutVars.variable.push(v)
        return
      }
      case 'external': {
        if (!xml.externalVars) xml.externalVars = { variable: [] }
        /* istanbul ignore next -- defensive: variable array always initialised above */
        if (!xml.externalVars.variable) xml.externalVars.variable = []
        xml.externalVars.variable.push(v)
        return
      }
      case 'local': {
        if (!xml.localVars) xml.localVars = { variable: [] }
        /* istanbul ignore next -- defensive: variable array always initialised above */
        if (!xml.localVars.variable) xml.localVars.variable = []
        xml.localVars.variable.push(v)
        return
      }
      case 'temp': {
        if (!xml.tempVars) xml.tempVars = { variable: [] }
        /* istanbul ignore next -- defensive: variable array always initialised above */
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
        })
        return
      }
      default:
        return
    }
  })

  return xml
}
