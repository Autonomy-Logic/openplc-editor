import type { PLCVariable } from '../../../../../middleware/shared/ports/types'
import { resolveArrayVariableByName } from '../../../../utils/PLC/array-variable-utils'
import {
  getVariableRestrictionType,
  validateVariableType as _validateVariableType,
} from '../../../../utils/PLC/validate-variable-type'
import { BlockVariant } from '../ladder/utils/types'
import { BlockVariant as newBlockVariant } from '../types/block'

export const getVariableByName = (variables: PLCVariable[], name: string): PLCVariable | undefined => {
  const exact = variables.find((variable) => variable.name === name && variable.type.definition !== 'derived')
  if (exact) return exact

  return resolveArrayVariableByName(variables, name)
}

export const getBlockDocumentation = (blockVariant: newBlockVariant): string => {
  const inputVariables = blockVariant.variables.filter(
    (variable) => variable.class === 'input' || variable.class === 'inOut',
  )

  const outputVariables = blockVariant.variables.filter(
    (variable) => variable.class === 'output' || variable.class === 'inOut',
  )

  const documentationString = `${blockVariant.documentation ? `${blockVariant.documentation}\n\n` : ''}INPUT:
      ${inputVariables
        .map(
          (variable, index) =>
            `${variable.name}: ${variable.type.value}${index < inputVariables.length - 1 ? '\n' : ''}`,
        )
        .join('')}

      OUTPUT:
      ${outputVariables
        .map(
          (variable, index) =>
            `${variable.name}: ${variable.type.value}${index < outputVariables.length - 1 ? '\n' : ''}`,
        )
        .join('')}`

  return documentationString
}

export const validateVariableType = (
  selectedType: string,
  expectedType: BlockVariant['variables'][0] | string,
): { isValid: boolean; error?: string } => {
  if (typeof expectedType === 'string') {
    return _validateVariableType(selectedType, expectedType)
  }
  return _validateVariableType(selectedType, expectedType.type.value)
}

export { getVariableRestrictionType }
